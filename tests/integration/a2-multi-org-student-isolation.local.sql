-- A2 (decision D-07) tenant isolation for a person who belongs to several organisations: a student enrolled in two
-- schools, and a staff member of one school who is a student in another. Structure of every wf_* table with an
-- org_id, then behaviour as signed-in people, then the fee-reminder scan for the same student in two schools.
-- Local disposable Postgres only; everything rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'A2ISO FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regprocedure('public.wf_fee_reminder_scan(timestamptz,integer)') IS NULL OR to_regprocedure('public.wf_can(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'A2ISO FAIL: the WF-01 and WF-15a2 migrations must be present';
  END IF;
END $guard$;

CREATE SCHEMA a2;
GRANT USAGE ON SCHEMA a2 TO anon, authenticated, service_role;
CREATE TABLE a2.passed (n serial PRIMARY KEY, label text NOT NULL);
GRANT ALL ON a2.passed TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE a2.passed_n_seq TO anon, authenticated, service_role;
CREATE FUNCTION a2.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'A2ISO FAIL [%]', p_label; END IF;
  INSERT INTO a2.passed (label) VALUES (p_label);
END $$;
GRANT EXECUTE ON FUNCTION a2.ok(text, boolean) TO anon, authenticated, service_role;
CREATE FUNCTION a2.login_as(p_role text, p_user uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', p_user)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION a2.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
-- Rows the current role can see in every wf_* table that has an org_id, outside the given organisations (SECURITY INVOKER,
-- so row security applies as the signed-in person).
CREATE FUNCTION a2.rows_outside(p_orgs uuid[]) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE t text; n bigint; total bigint := 0;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
            JOIN pg_tables p ON p.schemaname = 'public' AND p.tablename = c.table_name
           WHERE c.table_schema = 'public' AND c.table_name LIKE 'wf\_%' AND c.column_name = 'org_id' ORDER BY 1 LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id <> ALL ($1)', t) INTO n USING p_orgs;
      total := total + n;
    EXCEPTION WHEN insufficient_privilege THEN NULL;  -- no read grant at all is isolation too
    END;
  END LOOP;
  RETURN total;
END $$;
CREATE FUNCTION a2.rows_inside(p_org uuid, p_table text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id = $1', p_table) INTO n USING p_org;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION a2.rows_outside(uuid[]), a2.rows_inside(uuid, text), a2.login_as(text, uuid), a2.logout() TO authenticated, service_role;

-- 1. Structure: every workflow table with an org_id has row security on, and no policy opens it to everyone
SELECT a2.ok('every wf_* table with an org_id has row security enabled and forced off the public roles',
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'wf\_%' AND NOT c.relrowsecurity
      AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'org_id')) = 0);
SELECT a2.ok('no policy on a wf_* table that holds organisation rows lets anon or authenticated read with a constant-true condition',
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename LIKE 'wf\_%'
    AND (p.roles && ARRAY['anon','authenticated','public']::name[])
    AND p.cmd IN ('SELECT', 'ALL') AND coalesce(p.qual, 'true') IN ('true', '(true)')
    AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = p.tablename AND k.column_name = 'org_id')) = 0);
SELECT a2.ok('the only wf_* tables readable by everyone signed in are the three platform catalogs, and they hold no organisation column',
  (SELECT array_agg(DISTINCT p.tablename ORDER BY p.tablename) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename LIKE 'wf\_%'
    AND (p.roles && ARRAY['anon','authenticated','public']::name[]) AND p.cmd IN ('SELECT', 'ALL') AND coalesce(p.qual, 'true') IN ('true', '(true)'))
  = ARRAY['wf_action_type', 'wf_event_source', 'wf_template']::name[]);
SELECT a2.ok('anon has no table privilege on any wf_* table with an org_id',
  (SELECT count(*) FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public' AND g.table_name LIKE 'wf\_%' AND g.grantee = 'anon') = 0);

-- 2. Fixtures
SET session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('a2000000-0000-4000-8000-000000000001'), ('a2000000-0000-4000-8000-000000000002'), ('a2000000-0000-4000-8000-000000000003'),
  ('a2000000-0000-4000-8000-000000000004'), ('a2000000-0000-4000-8000-000000000005');
INSERT INTO public.schools (id, name, slug) VALUES
  ('a2a00000-0000-4000-8000-00000000000a', 'A2 School A', 'a2-school-a'),
  ('a2a00000-0000-4000-8000-00000000000b', 'A2 School B', 'a2-school-b'),
  ('a2a00000-0000-4000-8000-00000000000c', 'A2 School C', 'a2-school-c');
-- 01 student (home A, also enrolled in B); 02 admin of A who is also a student in B; 03 admin of B; 04 student only in C
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a2000000-0000-4000-8000-000000000001', 'a2a00000-0000-4000-8000-00000000000a', 'A2 Student AB', 'stu-ab@a2.invalid', 'student', true),
  ('a2000000-0000-4000-8000-000000000002', 'a2a00000-0000-4000-8000-00000000000a', 'A2 Admin A', 'admin-a@a2.invalid', 'admin', true),
  ('a2000000-0000-4000-8000-000000000003', 'a2a00000-0000-4000-8000-00000000000b', 'A2 Admin B', 'admin-b@a2.invalid', 'admin', true),
  ('a2000000-0000-4000-8000-000000000004', 'a2a00000-0000-4000-8000-00000000000c', 'A2 Student C', 'stu-c@a2.invalid', 'student', true);
INSERT INTO public.user_role_assignments (org_id, user_id, role_code) VALUES
  ('a2a00000-0000-4000-8000-00000000000a', 'a2000000-0000-4000-8000-000000000001', 'ng.student'),
  ('a2a00000-0000-4000-8000-00000000000b', 'a2000000-0000-4000-8000-000000000001', 'ng.student'),
  ('a2a00000-0000-4000-8000-00000000000b', 'a2000000-0000-4000-8000-000000000002', 'ng.student'),
  ('a2a00000-0000-4000-8000-00000000000c', 'a2000000-0000-4000-8000-000000000004', 'ng.student');
INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling) VALUES
  ('a2a00000-0000-4000-8000-00000000000a', true, 'draft'), ('a2a00000-0000-4000-8000-00000000000b', true, 'draft'),
  ('a2a00000-0000-4000-8000-00000000000c', true, 'draft')
  ON CONFLICT (org_id) DO UPDATE SET workflows_enabled = EXCLUDED.workflows_enabled;
-- the same student reference owes fees in A and in B
CREATE FUNCTION a2.inv(p_id text, p_org text, p_subject text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.cg_fee_invoice (id, scope_ref, tenant_id, org_ref, schedule_id, campus_id, subject_ref, principal_ref, amount_kobo, due_at, issued_by, issued_at)
  VALUES (('a2b00000-0000-4000-8000-0000000000' || p_id)::uuid, 's', 'a2a00000-0000-4000-8000-00000000000' || p_org, 'o',
          gen_random_uuid(), gen_random_uuid(), p_subject, 'pri', 100000, '2026-12-04 11:00+00', gen_random_uuid(), '2026-10-01 00:00+00');
END $$;
SELECT a2.inv('01', 'a', 'student-ab'), a2.inv('02', 'b', 'student-ab'), a2.inv('03', 'c', 'student-c');
SET session_replication_role = DEFAULT;
CREATE TABLE a2.scan_out (n serial, r jsonb);
INSERT INTO a2.scan_out (r) SELECT public.wf_fee_reminder_scan('2026-11-02 08:00+00');

-- 3. The scan: one event per organisation, each stamped with its own organisation, none shared
SELECT a2.ok('the scan emitted one week-4 event for each of the three organisations',
  (SELECT count(*) FROM public.wf_event WHERE event_type = 'fees.reminder_week_start' AND org_id IN
     ('a2a00000-0000-4000-8000-00000000000a', 'a2a00000-0000-4000-8000-00000000000b', 'a2a00000-0000-4000-8000-00000000000c')) = 3);
SELECT a2.ok('each event carries the organisation of its own invoice and a dedupe key that names its own invoice',
  (SELECT bool_and((e.org_id = i.tenant_id::uuid) AND e.dedupe_key LIKE '%' || i.id::text || '%')
     FROM public.wf_event e JOIN public.cg_fee_invoice i ON e.dedupe_key LIKE '%' || i.id::text || '%'
    WHERE e.event_type = 'fees.reminder_week_start' AND i.id::text LIKE 'a2b00000%'));
SELECT a2.ok('the same student reference in two organisations never shares an event, key or payload invoice',
  (SELECT count(DISTINCT dedupe_key) FROM public.wf_event WHERE event_type = 'fees.reminder_week_start' AND dedupe_key LIKE '%a2b00000%') = 3
  AND (SELECT count(DISTINCT payload ->> 'invoice_id') FROM public.wf_event WHERE event_type = 'fees.reminder_week_start' AND dedupe_key LIKE '%a2b00000%') = 3);

-- 4. People
-- 4a. The student enrolled in A and B holds no workflow permission anywhere, and sees no workflow row of any organisation
SELECT a2.login_as('authenticated', 'a2000000-0000-4000-8000-000000000001');
SELECT a2.ok('a student of two schools passes no workflow permission check in either school or the third',
  NOT EXISTS (SELECT 1 FROM unnest(ARRAY['a2a00000-0000-4000-8000-00000000000a','a2a00000-0000-4000-8000-00000000000b','a2a00000-0000-4000-8000-00000000000c']::uuid[]) o,
                     unnest(ARRAY['workflows.view','workflows.manage','workflows.run','workflows.approve']) p
               WHERE public.wf_can(o, p)));
SELECT a2.ok('a student of two schools sees no workflow row at all (events, runs, approvals, definitions, memory)',
  a2.rows_outside(ARRAY[]::uuid[]) = 0);
SELECT a2.logout();

-- 4b. The admin of A who is a student in B sees A and only A
SELECT a2.login_as('authenticated', 'a2000000-0000-4000-8000-000000000002');
SELECT a2.ok('admin of A: workflows.view in A, none in B or C',
  public.wf_can('a2a00000-0000-4000-8000-00000000000a', 'workflows.view')
  AND NOT public.wf_can('a2a00000-0000-4000-8000-00000000000b', 'workflows.view')
  AND NOT public.wf_can('a2a00000-0000-4000-8000-00000000000c', 'workflows.view'));
SELECT a2.ok('admin of A: being a student in B grants no authority in B (approve, manage, run all refused)',
  NOT public.wf_can('a2a00000-0000-4000-8000-00000000000b', 'workflows.approve')
  AND NOT public.wf_can('a2a00000-0000-4000-8000-00000000000b', 'workflows.manage')
  AND NOT public.wf_can('a2a00000-0000-4000-8000-00000000000b', 'workflows.run'));
SELECT a2.ok('admin of A sees A events and no row of B or C in any workflow table',
  a2.rows_inside('a2a00000-0000-4000-8000-00000000000a', 'wf_event') >= 1
  AND a2.rows_outside(ARRAY['a2a00000-0000-4000-8000-00000000000a']::uuid[]) = 0);
SELECT a2.logout();

-- 4c. The admin of B sees B and only B (the same student appears in both A and B)
SELECT a2.login_as('authenticated', 'a2000000-0000-4000-8000-000000000003');
SELECT a2.ok('admin of B sees B events and no row of A or C in any workflow table',
  a2.rows_inside('a2a00000-0000-4000-8000-00000000000b', 'wf_event') >= 1
  AND a2.rows_outside(ARRAY['a2a00000-0000-4000-8000-00000000000b']::uuid[]) = 0);
SELECT a2.ok('admin of B cannot read the event of the same student in A',
  NOT EXISTS (SELECT 1 FROM public.wf_event WHERE org_id = 'a2a00000-0000-4000-8000-00000000000a'));
SELECT a2.logout();

-- 4d. Writes across the line are refused
SELECT a2.login_as('authenticated', 'a2000000-0000-4000-8000-000000000003');
DO $w$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.wf_event (org_id, event_type, source, dedupe_key)
    VALUES ('a2a00000-0000-4000-8000-00000000000a', 'fees.reminder_week_start', 'a2', 'a2-cross-write-0001');
  EXCEPTION WHEN OTHERS THEN v_ok := true;  -- any refusal (privilege or row security) is the intended outcome
  END;
  PERFORM a2.ok('admin of B cannot insert an event into A', v_ok);
END $w$;
DO $w$
DECLARE v_ok boolean := false; v_n bigint;
BEGIN
  BEGIN
    UPDATE public.wf_event SET status = 'ignored' WHERE org_id = 'a2a00000-0000-4000-8000-00000000000a';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_ok := v_n = 0;
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  PERFORM a2.ok('admin of B cannot update events of A', v_ok);
END $w$;
SELECT a2.logout();

-- 4e. A student of a third school sees nothing of A or B, and the scan function is closed to signed-in people
SELECT a2.login_as('authenticated', 'a2000000-0000-4000-8000-000000000004');
SELECT a2.ok('a student of C sees no workflow row of any organisation', a2.rows_outside(ARRAY[]::uuid[]) = 0);
SELECT a2.logout();
SELECT a2.login_as('authenticated', 'a2000000-0000-4000-8000-000000000001');
DO $w$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN PERFORM public.wf_fee_reminder_scan(now()); EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  PERFORM a2.ok('a student cannot run the reminder scan', v_ok);
END $w$;
SELECT a2.logout();

-- 4f. Control: the checks above can fail. With row security switched off on wf_event the same admin of A sees other schools.
ALTER TABLE public.wf_event DISABLE ROW LEVEL SECURITY;
SELECT a2.login_as('authenticated', 'a2000000-0000-4000-8000-000000000002');
SELECT a2.ok('control: with row security off on wf_event the leak check detects other organisations rows',
  a2.rows_outside(ARRAY['a2a00000-0000-4000-8000-00000000000a']::uuid[]) > 0);
SELECT a2.logout();
ALTER TABLE public.wf_event ENABLE ROW LEVEL SECURITY;
SELECT a2.login_as('authenticated', 'a2000000-0000-4000-8000-000000000002');
SELECT a2.ok('control: with row security restored the leak check is clean again',
  a2.rows_outside(ARRAY['a2a00000-0000-4000-8000-00000000000a']::uuid[]) = 0);
SELECT a2.logout();

-- 5. Switching the student's second school off stops events there and leaves the first school untouched
UPDATE public.wf_org_settings SET workflows_enabled = false WHERE org_id = 'a2a00000-0000-4000-8000-00000000000b';
INSERT INTO a2.scan_out (r) SELECT public.wf_fee_reminder_scan('2026-12-04 08:00+00');
SELECT a2.ok('with school B off, the due-day event exists for A and C and not for B',
  (SELECT count(*) FROM public.wf_event WHERE event_type = 'fees.reminder_due_day' AND org_id = 'a2a00000-0000-4000-8000-00000000000a') = 1
  AND (SELECT count(*) FROM public.wf_event WHERE event_type = 'fees.reminder_due_day' AND org_id = 'a2a00000-0000-4000-8000-00000000000b') = 0
  AND (SELECT count(*) FROM public.wf_event WHERE event_type = 'fees.reminder_due_day' AND org_id = 'a2a00000-0000-4000-8000-00000000000c') = 1);

DO $done$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM a2.passed;
  RAISE NOTICE 'A2ISO ALL PASS: % checks', n;
END $done$;
ROLLBACK;
