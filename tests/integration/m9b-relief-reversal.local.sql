-- M9B relief reversal: a posted relief is reversed in the fee ledger by a second person. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M9R FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regprocedure('public.cg_fee_reverse_relief(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'M9R FAIL: the relief-reversal migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA m9r;
CREATE TABLE m9r.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE m9r.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO m9r.ids (name) VALUES ('org'), ('campus'), ('requester'), ('approver'), ('poster'), ('reverser'), ('nobody'),
  ('s1'), ('s2'), ('s3'), ('s4'), ('a1'), ('a2'), ('a3'), ('a4');
CREATE FUNCTION m9r.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM m9r.ids WHERE name = p $$;
CREATE FUNCTION m9r.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'M9R FAIL [%]', p_label; END IF;
  INSERT INTO m9r.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION m9r.err(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN INSERT INTO m9r.passed (label) VALUES (p_label); RETURN; END IF;
    RAISE EXCEPTION 'M9R FAIL [%]: expected % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'M9R FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION m9r.act(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', m9r.id(p_user)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', m9r.id(p_user), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m9r.back() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT USAGE ON SCHEMA m9r TO PUBLIC;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA m9r TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA m9r TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m9r TO PUBLIC;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) SELECT id FROM m9r.ids WHERE name IN ('requester', 'approver', 'poster', 'reverser', 'nobody');
INSERT INTO public.schools (id, name, slug) VALUES (m9r.id('org'), 'M9R Org', 'm9r-org');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
  SELECT id, m9r.id('org'), name, name || '@m9r.invalid', 'admin', true FROM m9r.ids WHERE name IN ('requester', 'approver', 'poster', 'reverser', 'nobody');
INSERT INTO public.organization_memberships (user_id, school_id, role)
  SELECT id, m9r.id('org'), 'admin' FROM m9r.ids WHERE name IN ('requester', 'approver', 'poster', 'reverser', 'nobody');
INSERT INTO public.campuses (id, school_id, name, code) VALUES (m9r.id('campus'), m9r.id('org'), 'M9R Campus', 'm9r-a');
INSERT INTO public.students (id, school_id, status) SELECT id, m9r.id('org'), 'active' FROM m9r.ids WHERE name IN ('s1', 's2', 's3', 's4');
INSERT INTO public.cg_org_unit (id, tenant_id, kind, created_by) VALUES ('m9r-org-ref', m9r.id('org')::text, 'organization', 'm9r-fixture');
INSERT INTO public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref, provisioned_by) VALUES ('m9r-scope', m9r.id('org')::text, 'm9r-org-ref', 'test');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, started_at)
  SELECT m9r.id('org'), id, 'ng.bursar', 'institution', NULL, now() - interval '1 day' FROM m9r.ids WHERE name IN ('requester', 'approver', 'poster', 'reverser');
-- approved relief: a1 (s1), a2 (s2), a3 (s3, never posted), a4 (s4, pending)
INSERT INTO public.fee_adjustments (id, school_id, student_id, kind, mode, value, term, academic_year, reason, status, created_by, decided_by, decided_at)
  SELECT m9r.id(a), m9r.id('org'), m9r.id(s), 'discount', 'percent', 20, 'Term 1', '2026/27', 'test', 'approved', m9r.id('requester'), m9r.id('approver'), now()
  FROM (VALUES ('a1','s1'), ('a2','s2'), ('a3','s3')) v(a, s);
INSERT INTO public.fee_adjustments (id, school_id, student_id, kind, mode, value, term, academic_year, reason, status, created_by)
  VALUES (m9r.id('a4'), m9r.id('org'), m9r.id('s4'), 'discount', 'percent', 10, 'Term 1', '2026/27', 'test', 'pending', m9r.id('requester'));
SET LOCAL session_replication_role = origin;

SELECT m9r.act('poster');
CREATE TEMP TABLE inv (n text PRIMARY KEY, id uuid NOT NULL);
DO $mk$
DECLARE v_sch uuid;
BEGIN
  v_sch := public.cg_fee_create_schedule('m9r-scope', 'M9R-TUITION', 'M9R tuition', '2026/27', 'Term 1', 10000, current_date, NULL);
  INSERT INTO inv VALUES
    ('s1', public.cg_fee_issue_invoice('m9r-scope', v_sch, m9r.id('campus'), m9r.id('s1')::text, 'payer-s1', now() + interval '14 days')),
    ('s2', public.cg_fee_issue_invoice('m9r-scope', v_sch, m9r.id('campus'), m9r.id('s2')::text, 'payer-s2', now() + interval '14 days'));
END $mk$;
GRANT SELECT ON inv TO PUBLIC;
SELECT public.cg_fee_post_relief((SELECT id FROM inv WHERE n = 's1'), m9r.id('a1'));
SELECT public.cg_fee_post_relief((SELECT id FROM inv WHERE n = 's2'), m9r.id('a2'));
SELECT m9r.back();

CREATE FUNCTION m9r.ar(p_student text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(l.debit_kobo - l.credit_kobo), 0)::bigint FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
    JOIN public.cg_fee_invoice i ON i.id = p.invoice_id WHERE i.subject_ref = m9r.id(p_student)::text AND l.account_code = 'accounts_receivable' $$;

SELECT m9r.ok('posted relief lowered the receivable to 8000', m9r.ar('s1') = 8000 AND m9r.ar('s2') = 8000);

-- revoke is refused while the posted relief is unreversed
SELECT m9r.act('reverser');
SELECT m9r.err('revoking a posted, unreversed relief is refused', format($q$SELECT public.fee_relief_revoke(%L)$q$, m9r.id('a1')), '55000');
-- who may reverse
SELECT m9r.back(); SELECT m9r.act('requester');
SELECT m9r.err('the requester cannot reverse their own relief', format($q$SELECT public.cg_fee_reverse_relief(%L,%L,'student withdrew')$q$, (SELECT id FROM inv WHERE n='s1'), m9r.id('a1')), '42501');
SELECT m9r.back(); SELECT m9r.act('approver');
SELECT m9r.err('the person who decided the relief cannot reverse it', format($q$SELECT public.cg_fee_reverse_relief(%L,%L,'student withdrew')$q$, (SELECT id FROM inv WHERE n='s1'), m9r.id('a1')), '42501');
SELECT m9r.back(); SELECT m9r.act('nobody');
SELECT m9r.err('a user with no bursar role cannot reverse', format($q$SELECT public.cg_fee_reverse_relief(%L,%L,'student withdrew')$q$, (SELECT id FROM inv WHERE n='s1'), m9r.id('a1')), '42501');
SELECT m9r.back(); SELECT m9r.act('reverser');
SELECT m9r.err('a reason is required', format($q$SELECT public.cg_fee_reverse_relief(%L,%L,'x')$q$, (SELECT id FROM inv WHERE n='s1'), m9r.id('a1')), '22023');
SELECT m9r.err('an adjustment that was never posted has nothing to reverse', format($q$SELECT public.cg_fee_reverse_relief(%L,%L,'student withdrew')$q$, (SELECT id FROM inv WHERE n='s1'), m9r.id('a3')), '22023');

-- the invoice cannot be reversed while relief is unreversed
SELECT m9r.err('an invoice carrying unreversed relief cannot be reversed', format($q$SELECT public.cg_fee_reverse_invoice(%L,'issued in error')$q$, (SELECT id FROM inv WHERE n='s2')), '23514');

CREATE TEMP TABLE rv AS SELECT public.cg_fee_reverse_relief((SELECT id FROM inv WHERE n='s1'), m9r.id('a1'), 'student withdrew') AS j;
GRANT SELECT ON rv TO PUBLIC;
SELECT m9r.back();
SELECT m9r.ok('a second bursar reverses the relief for its full amount', (SELECT (j->>'amount_kobo')::bigint = 2000 AND (j->>'duplicate')::boolean = false FROM rv));
SELECT m9r.ok('the receivable is restored to 10000', m9r.ar('s1') = 10000);
SELECT m9r.ok('the relief account nets to zero and cash is untouched',
  (SELECT coalesce(sum(l.debit_kobo - l.credit_kobo), 0) = 0 FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
     JOIN public.cg_fee_invoice i ON i.id = p.invoice_id WHERE i.subject_ref = m9r.id('s1')::text AND l.account_code = 'fee_relief')
  AND (SELECT count(*) = 0 FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
     JOIN public.cg_fee_invoice i ON i.id = p.invoice_id WHERE i.subject_ref = m9r.id('s1')::text AND l.account_code = 'cash'));
SELECT m9r.ok('the reversal is linked to the relief posting and the adjustment, and records who and why',
  (SELECT count(*) = 1 FROM public.cg_fee_ledger_posting r JOIN public.cg_fee_ledger_posting o ON o.id = r.reverses_posting_id
    WHERE r.event_type = 'relief_reversal' AND o.event_type = 'relief' AND r.adjustment_id = m9r.id('a1') AND r.actor_id = m9r.id('reverser') AND r.reversal_reason = 'student withdrew'));

-- idempotence and what follows
SELECT m9r.act('reverser');
SELECT m9r.ok('calling again changes nothing and says duplicate', (public.cg_fee_reverse_relief((SELECT id FROM inv WHERE n='s1'), m9r.id('a1'), 'again')->>'duplicate')::boolean);
SELECT public.fee_relief_revoke(m9r.id('a1'));
SELECT public.fee_relief_revoke(m9r.id('a4'));
SELECT m9r.err('an adjustment cannot be revoked twice', format($q$SELECT public.fee_relief_revoke(%L)$q$, m9r.id('a1')), 'P0001');
SELECT m9r.back();
SELECT m9r.ok('after reversal the adjustment can be revoked, and a never-posted pending one too',
  (SELECT count(*) = 2 FROM public.fee_adjustments WHERE id IN (m9r.id('a1'), m9r.id('a4')) AND status = 'revoked'));
SELECT m9r.ok('still exactly one reversal posting for that relief', (SELECT count(*) = 1 FROM public.cg_fee_ledger_posting WHERE event_type = 'relief_reversal'));

-- reversing the relief frees the invoice to be reversed
SELECT m9r.act('reverser');
SELECT public.cg_fee_reverse_relief((SELECT id FROM inv WHERE n='s2'), m9r.id('a2'), 'granted in error');
SELECT m9r.ok('once relief is reversed the invoice can be reversed', (public.cg_fee_reverse_invoice((SELECT id FROM inv WHERE n='s2'), 'issued in error')) IS NOT NULL);
SELECT m9r.back();

-- table shape and grants
SELECT m9r.err('a relief reversal row must name the posting it reverses',
  format($q$INSERT INTO public.cg_fee_ledger_posting (scope_ref, tenant_id, org_ref, invoice_id, campus_id, subject_ref, principal_ref, event_type, amount_kobo, actor_id, adjustment_id, reversal_reason)
    SELECT scope_ref, tenant_id, org_ref, invoice_id, campus_id, subject_ref, principal_ref, 'relief_reversal', 100, actor_id, adjustment_id, 'x' FROM public.cg_fee_ledger_posting WHERE event_type = 'relief' LIMIT 1$q$), '23514');
SELECT m9r.err('a relief cannot be reversed twice at the table level',
  $q$INSERT INTO public.cg_fee_ledger_posting (scope_ref, tenant_id, org_ref, invoice_id, campus_id, subject_ref, principal_ref, event_type, amount_kobo, actor_id, adjustment_id, reverses_posting_id, reversal_reason)
     SELECT r.scope_ref, r.tenant_id, r.org_ref, r.invoice_id, r.campus_id, r.subject_ref, r.principal_ref, 'relief_reversal', r.amount_kobo, r.actor_id, r.adjustment_id, r.reverses_posting_id, 'dup'
       FROM public.cg_fee_ledger_posting r WHERE r.event_type = 'relief_reversal' LIMIT 1$q$, '23505');
SELECT m9r.ok('grants: authenticated may call the reversal, anon and service_role may not',
  has_function_privilege('authenticated', 'public.cg_fee_reverse_relief(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.cg_fee_reverse_relief(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.cg_fee_reverse_relief(uuid,uuid,text)', 'EXECUTE'));

DO $done$
DECLARE n int; BEGIN SELECT count(*) INTO n FROM m9r.passed; RAISE NOTICE 'M9R ALL PASS: % checks', n; END $done$;
ROLLBACK;
