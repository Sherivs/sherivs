-- SUP-01 integration checks: support access grants. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'SUP01 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.support_access_grant') IS NULL THEN
    RAISE EXCEPTION 'SUP01 FAIL: the SUP-01 migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA s1t;
CREATE TABLE s1t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE s1t.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO s1t.ids (name) VALUES ('orgA'),('orgB'),('adminA'),('adminB'),('teacher'),('founder'),('second'),('grantold');
CREATE FUNCTION s1t.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM s1t.ids WHERE name = p $$;
CREATE FUNCTION s1t.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'SUP01 FAIL [%]', p_label; END IF;
  INSERT INTO s1t.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION s1t.err(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN INSERT INTO s1t.passed (label) VALUES (p_label); RETURN; END IF;
    RAISE EXCEPTION 'SUP01 FAIL [%]: expected % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'SUP01 FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION s1t.act(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', s1t.id(p_user)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1t.id(p_user), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION s1t.back() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT USAGE ON SCHEMA s1t TO PUBLIC;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA s1t TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA s1t TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA s1t TO PUBLIC;

INSERT INTO auth.users (id) SELECT id FROM s1t.ids WHERE name NOT IN ('orgA', 'orgB');
INSERT INTO public.schools (id, name, slug) VALUES (s1t.id('orgA'), 'SUP01 Org A', 'sup01-a'), (s1t.id('orgB'), 'SUP01 Org B', 'sup01-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (s1t.id('adminA'), s1t.id('orgA'), 'Admin A', 'a@sup01.invalid', 'admin', true),
  (s1t.id('adminB'), s1t.id('orgB'), 'Admin B', 'b@sup01.invalid', 'admin', true),
  (s1t.id('teacher'), s1t.id('orgA'), 'Teacher', 't@sup01.invalid', 'teacher', true);
INSERT INTO public.super_admins (id, full_name, email, is_active) VALUES
  (s1t.id('founder'), 'Founder', 'f@sup01.invalid', true), (s1t.id('second'), 'Second', 's@sup01.invalid', true);

-- 1. Tables are closed to clients
SELECT s1t.ok('row security is on and forced for both tables',
  (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE oid IN ('public.support_access_grant'::regclass, 'public.support_access_audit'::regclass)));
SELECT s1t.ok('clients have no table privileges; anon cannot execute the functions',
  NOT has_table_privilege('authenticated', 'public.support_access_grant', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.support_access_audit', 'SELECT')
  AND NOT has_function_privilege('anon', 'public.support_grant_request(uuid,text,text,text,text[],text,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.support_audit_write(uuid,text,text,jsonb)', 'EXECUTE'));

-- 2. Requests
SELECT s1t.act('teacher');
SELECT s1t.err('a non-platform user cannot request', format($q$SELECT public.support_grant_request(%L,'ticket','T-1','Fix a report that will not open',ARRAY['reports'],'read')$q$, s1t.id('orgA')), '42501');
SELECT s1t.back();
SELECT s1t.act('founder');
SELECT s1t.err('a request cannot claim to be break-glass', format($q$SELECT public.support_grant_request(%L,'break_glass','T-1','Fix a report that will not open',ARRAY['reports'],'read')$q$, s1t.id('orgA')), '22023');
SELECT s1t.err('a request must come from the organisation', format($q$SELECT public.support_grant_request(%L,'platform','T-1','Fix a report that will not open',ARRAY['reports'],'read')$q$, s1t.id('orgA')), '22023');
SELECT s1t.err('bad module names are refused', format($q$SELECT public.support_grant_request(%L,'ticket','T-1','Fix a report that will not open',ARRAY['Bad Module'],'read')$q$, s1t.id('orgA')), '22023');
SELECT s1t.err('the duration is capped at 24 hours', format($q$SELECT public.support_grant_request(%L,'ticket','T-1','Fix a report that will not open',ARRAY['reports'],'read',1441)$q$, s1t.id('orgA')), '22023');
SELECT set_config('s1t.read', public.support_grant_request(s1t.id('orgA'), 'ticket', 'T-1', 'Fix a report that will not open', ARRAY['reports'], 'read')::text, true);
SELECT s1t.back();
SELECT s1t.ok('a requested grant is not active and cannot be used', (SELECT starts_at IS NULL AND minutes = 240 FROM public.support_access_grant WHERE id = current_setting('s1t.read')::uuid));
SELECT s1t.act('founder');
SELECT s1t.err('an unconfirmed grant cannot be used', format($q$SELECT public.support_access_log(%L,'reports','read','report:1')$q$, current_setting('s1t.read')), '42501');
SELECT s1t.err('the holder cannot confirm their own request', format($q$SELECT public.support_grant_confirm(%L)$q$, current_setting('s1t.read')), '42501');
SELECT s1t.back();

-- 3. Confirmation by the organisation's own administrator, read
SELECT s1t.act('adminB');
SELECT s1t.err('another organisation''s administrator cannot confirm', format($q$SELECT public.support_grant_confirm(%L)$q$, current_setting('s1t.read')), '42501');
SELECT s1t.back();
SELECT s1t.act('adminA');
SELECT s1t.ok('the administrator confirms and a read grant becomes active', public.support_grant_confirm(current_setting('s1t.read')::uuid)->>'state' = 'active');
SELECT s1t.err('a grant cannot be confirmed twice', format($q$SELECT public.support_grant_confirm(%L)$q$, current_setting('s1t.read')), '42501');
SELECT s1t.back();
SELECT s1t.ok('the grant runs for the requested time from confirmation',
  (SELECT expires_at - starts_at = interval '240 minutes' FROM public.support_access_grant WHERE id = current_setting('s1t.read')::uuid));

-- 4. Use is audited and bounded
SELECT s1t.act('founder');
SELECT public.support_access_log(current_setting('s1t.read')::uuid, 'reports', 'read', 'report:1');
SELECT s1t.err('a module outside the grant is refused', format($q$SELECT public.support_access_log(%L,'finance','read','x')$q$, current_setting('s1t.read')), '42501');
SELECT s1t.err('a read grant cannot write', format($q$SELECT public.support_access_log(%L,'reports','write','report:1')$q$, current_setting('s1t.read')), '42501');
SELECT s1t.back();
SELECT s1t.act('second');
SELECT s1t.err('only the holder can use a grant', format($q$SELECT public.support_access_log(%L,'reports','read','report:1')$q$, current_setting('s1t.read')), '42501');
SELECT s1t.back();
SELECT s1t.ok('the use was written to the audit trail',
  (SELECT count(*) = 1 FROM public.support_access_audit WHERE grant_id = current_setting('s1t.read')::uuid AND action = 'access:read' AND detail->>'module' = 'reports'));

-- 5. The administrator sees the grants and the log; another organisation does not
SELECT s1t.act('adminA');
SELECT s1t.ok('the administrator sees the grant and its state', (SELECT public.support_grants_list(s1t.id('orgA')) -> 0 ->> 'state') = 'active');
SELECT s1t.ok('the administrator sees the audit trail', jsonb_array_length(public.support_audit_list(s1t.id('orgA'))) >= 3);
SELECT s1t.err('another organisation cannot list them', format($q$SELECT public.support_grants_list(%L)$q$, s1t.id('orgB')), '42501');
SELECT s1t.back();
SELECT s1t.act('adminB');
SELECT s1t.err('another organisation cannot read the audit trail', format($q$SELECT public.support_audit_list(%L)$q$, s1t.id('orgA')), '42501');
SELECT s1t.back();

-- 6. Revocation ends access at once
SELECT s1t.act('adminA');
SELECT public.support_grant_revoke(current_setting('s1t.read')::uuid);
SELECT s1t.back();
SELECT s1t.act('founder');
SELECT s1t.err('a revoked grant cannot be used', format($q$SELECT public.support_access_log(%L,'reports','read','report:1')$q$, current_setting('s1t.read')), '42501');
SELECT s1t.back();

-- 7. Write needs the organisation, a second platform approver and a fresh passkey step-up
SELECT s1t.act('founder');
SELECT set_config('s1t.write', public.support_grant_request(s1t.id('orgA'), 'head_request', 'Head call 27 Nov', 'Repair a broken import for the head', ARRAY['imports'], 'write')::text, true);
SELECT s1t.back();
SELECT s1t.ok('write defaults to 60 minutes', (SELECT minutes = 60 FROM public.support_access_grant WHERE id = current_setting('s1t.write')::uuid));
SELECT s1t.act('adminA');
SELECT s1t.ok('after confirmation a write grant waits for a second approver', public.support_grant_confirm(current_setting('s1t.write')::uuid)->>'state' = 'waiting_second_approver');
SELECT s1t.back();
SELECT s1t.act('founder');
SELECT s1t.err('a write grant is unusable before the second approval', format($q$SELECT public.support_access_log(%L,'imports','write','import:1')$q$, current_setting('s1t.write')), '42501');
SELECT s1t.err('the holder cannot be the second approver', format($q$SELECT public.support_grant_second_approve(%L)$q$, current_setting('s1t.write')), '42501');
SELECT s1t.back();
SELECT s1t.act('adminA');
SELECT s1t.err('an organisation administrator cannot be the second approver', format($q$SELECT public.support_grant_second_approve(%L)$q$, current_setting('s1t.write')), '42501');
SELECT s1t.back();
SELECT s1t.act('second');
SELECT s1t.err('the second approver needs a fresh passkey step-up', format($q$SELECT public.support_grant_second_approve(%L)$q$, current_setting('s1t.write')), '42501');
SELECT s1t.back();
INSERT INTO public.wf_sensitive_step_up (user_id, action_kind, subject_digest, expires_at)
VALUES (s1t.id('second'), 'support_write', public.wf_step_up_digest('support_write', ARRAY[current_setting('s1t.write')]), now() + interval '4 minutes');
SELECT s1t.act('second');
SELECT s1t.ok('with the step-up the second approver activates it', public.support_grant_second_approve(current_setting('s1t.write')::uuid)->>'state' = 'active');
SELECT s1t.back();
SELECT s1t.ok('the step-up was spent', (SELECT used_at IS NOT NULL FROM public.wf_sensitive_step_up WHERE user_id = s1t.id('second') AND action_kind = 'support_write'));
SELECT s1t.act('founder');
SELECT public.support_access_log(current_setting('s1t.write')::uuid, 'imports', 'write', 'import:1', '{"table":"imports","before":1,"after":2}'::jsonb);
SELECT s1t.back();
SELECT s1t.ok('the write was audited with its detail',
  (SELECT detail->'detail'->>'after' = '2' FROM public.support_access_audit WHERE grant_id = current_setting('s1t.write')::uuid AND action = 'access:write'));

-- 8. Step-up for one grant cannot approve another
SELECT s1t.act('founder');
SELECT set_config('s1t.write2', public.support_grant_request(s1t.id('orgA'), 'ticket', 'T-2', 'Repair a second broken import', ARRAY['imports'], 'write')::text, true);
SELECT s1t.back();
SELECT s1t.act('adminA');
SELECT public.support_grant_confirm(current_setting('s1t.write2')::uuid);
SELECT s1t.back();
SELECT s1t.act('second');
SELECT s1t.err('the spent step-up cannot approve a second grant', format($q$SELECT public.support_grant_second_approve(%L)$q$, current_setting('s1t.write2')), '42501');
SELECT s1t.back();

-- 9. Break-glass
SELECT s1t.act('adminA');
SELECT s1t.err('only a platform admin opens break-glass', format($q$SELECT public.support_break_glass_open(%L,'Safety incident in progress',ARRAY['reports'])$q$, s1t.id('orgA')), '42501');
SELECT s1t.back();
SELECT s1t.act('founder');
SELECT set_config('s1t.glass', public.support_break_glass_open(s1t.id('orgA'), 'Safety incident in progress', ARRAY['reports'])::text, true);
SELECT public.support_access_log(current_setting('s1t.glass')::uuid, 'reports', 'read', 'report:9');
SELECT s1t.err('break-glass is read only', format($q$SELECT public.support_access_log(%L,'reports','write','report:9')$q$, current_setting('s1t.glass')), '42501');
SELECT s1t.back();
SELECT s1t.ok('break-glass lasts one hour and is flagged high severity',
  (SELECT expires_at - starts_at = interval '60 minutes' FROM public.support_access_grant WHERE id = current_setting('s1t.glass')::uuid)
  AND (SELECT severity = 'high' FROM public.support_access_audit WHERE grant_id = current_setting('s1t.glass')::uuid AND action = 'break_glass_opened'));
SELECT s1t.act('adminA');
SELECT s1t.ok('the organisation sees the break-glass in its trail', jsonb_path_exists(public.support_audit_list(s1t.id('orgA')), '$[*] ? (@.action == "break_glass_opened" && @.severity == "high")'));
SELECT s1t.err('break-glass cannot be confirmed into something larger', format($q$SELECT public.support_grant_confirm(%L)$q$, current_setting('s1t.glass')), '42501');
SELECT s1t.back();
SELECT s1t.err('break-glass cannot be made a write grant', format($q$INSERT INTO public.support_access_grant (org_id, holder, request_source, request_ref, reason, modules, mode, minutes) VALUES (%L,%L,'break_glass','x','Long enough reason',ARRAY['a1'],'write',60)$q$, s1t.id('orgA'), s1t.id('founder')), '23514');

-- 10. Expiry and lapse (rows inserted directly, as the clock cannot move inside one transaction)
INSERT INTO public.support_access_grant (id, org_id, holder, request_source, request_ref, reason, modules, mode, minutes, confirmed_by, confirmed_at, starts_at, expires_at)
VALUES (s1t.id('grantold'), s1t.id('orgA'), s1t.id('founder'), 'ticket', 'T-old', 'An old grant that has run out', ARRAY['reports'], 'read', 60,
        s1t.id('adminA'), now() - interval '3 hours', now() - interval '2 hours', now() - interval '1 hour');
SELECT s1t.act('founder');
SELECT s1t.err('an expired grant cannot be used', format($q$SELECT public.support_access_log(%L,'reports','read','x')$q$, s1t.id('grantold')), '42501');
SELECT s1t.back();
INSERT INTO public.support_access_grant (id, org_id, holder, request_source, request_ref, reason, modules, mode, minutes, created_at)
VALUES (gen_random_uuid(), s1t.id('orgA'), s1t.id('founder'), 'ticket', 'T-late', 'A request nobody answered in time', ARRAY['reports'], 'read', 60, now() - interval '25 hours');
SELECT set_config('s1t.late', (SELECT id::text FROM public.support_access_grant WHERE request_ref = 'T-late'), true);
SELECT s1t.act('adminA');
SELECT s1t.err('a request older than 24 hours cannot be confirmed', format($q$SELECT public.support_grant_confirm(%L)$q$, current_setting('s1t.late')), '42501');
SELECT s1t.back();

-- 11. The record cannot be rewritten
SELECT s1t.err('the audit trail cannot be edited', $q$UPDATE public.support_access_audit SET action = 'access:none'$q$, '42501');
SELECT s1t.err('the audit trail cannot be deleted', $q$DELETE FROM public.support_access_audit$q$, '42501');
SELECT s1t.err('the audit trail cannot be truncated', $q$TRUNCATE public.support_access_audit$q$, '42501');
SELECT s1t.err('a grant cannot be deleted', $q$DELETE FROM public.support_access_grant$q$, '42501');
SELECT s1t.err('a grant request cannot be edited', format($q$UPDATE public.support_access_grant SET reason = 'A different story entirely' WHERE id = %L$q$, current_setting('s1t.write')), '42501');
SELECT s1t.err('a grant cannot be extended', format($q$UPDATE public.support_access_grant SET expires_at = expires_at + interval '1 hour' WHERE id = %L$q$, current_setting('s1t.write')), '42501');
SELECT s1t.ok('each trail is a contiguous hash chain',
  NOT EXISTS (SELECT 1 FROM public.support_access_audit a
               LEFT JOIN public.support_access_audit p ON p.grant_id = a.grant_id AND p.seq = a.seq - 1
              WHERE (a.seq = 1 AND a.prev_hash IS NOT NULL) OR (a.seq > 1 AND (p.row_hash IS NULL OR a.prev_hash <> p.row_hash))));

DO $$ BEGIN RAISE NOTICE 'SUP01 ALL PASS: % checks', (SELECT count(*) FROM s1t.passed); END $$;
ROLLBACK;
