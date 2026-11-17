-- WF-02 catalog, template access and version-level SoD checks.
-- Local disposable Postgres only. All synthetic records are rolled back.
BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WF02 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.wf_version') IS NULL OR to_regclass('public.wf_template') IS NULL THEN
    RAISE EXCEPTION 'WF02 FAIL: WF-01 and WF-02 migrations must be present';
  END IF;
END $guard$;

CREATE SCHEMA wf02t;
GRANT USAGE ON SCHEMA wf02t TO anon, authenticated, service_role;
CREATE TABLE wf02t.passed (n serial PRIMARY KEY, label text NOT NULL);
GRANT SELECT, INSERT ON wf02t.passed TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE wf02t.passed_n_seq TO anon, authenticated, service_role;

CREATE FUNCTION wf02t.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wf02t.passed (label) VALUES (p_label);
  RAISE NOTICE 'WF02 PASS %', p_label;
END $$;
CREATE FUNCTION wf02t.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WF02 FAIL [%]', p_label; END IF;
  PERFORM wf02t.pass(p_label);
END $$;
CREATE FUNCTION wf02t.expect_error(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN
      PERFORM wf02t.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'WF02 FAIL [%]: expected SQLSTATE % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'WF02 FAIL [%]: statement was allowed but must fail with %', p_label, p_state;
END $$;
CREATE FUNCTION wf02t.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION wf02t.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION wf02t.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf02t TO anon, authenticated, service_role;

SELECT wf02t.expect_true('template catalogue is forced RLS and service-role writable',
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.wf_template'::regclass)
  AND has_table_privilege('authenticated', 'public.wf_template', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.wf_template', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.wf_template', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.wf_template', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.wf_template', 'INSERT')
  AND has_table_privilege('service_role', 'public.wf_template', 'INSERT')
  AND has_table_privilege('service_role', 'public.wf_template', 'UPDATE')
  AND has_table_privilege('service_role', 'public.wf_template', 'DELETE')
  AND NOT EXISTS (
    SELECT 1 FROM aclexplode(coalesce(
      (SELECT relacl FROM pg_class WHERE oid = 'public.wf_template'::regclass),
      acldefault('r', (SELECT relowner FROM pg_class WHERE oid = 'public.wf_template'::regclass))
    )) a WHERE a.grantee = 0
  ));
SELECT wf02t.expect_true('all three global template records are seeded',
  (SELECT count(*) = 3 FROM public.wf_template)
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'wf_template' AND column_name = 'org_id'
  ));

INSERT INTO auth.users (id) VALUES
  ('f0200000-0000-4000-8000-000000000001'),
  ('f0200000-0000-4000-8000-000000000002'),
  ('f0200000-0000-4000-8000-000000000003'),
  ('f0200000-0000-4000-8000-000000000004'),
  ('f0200000-0000-4000-8000-000000000005');
INSERT INTO public.schools (id, name, slug)
VALUES ('f0200000-0000-4000-8000-0000000000a1', 'WF02 Synthetic Org', 'wf02-synthetic');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('f0200000-0000-4000-8000-000000000001', 'f0200000-0000-4000-8000-0000000000a1', 'WF02 Editor A', 'editor-a@wf02.invalid', 'teacher', true),
  ('f0200000-0000-4000-8000-000000000002', 'f0200000-0000-4000-8000-0000000000a1', 'WF02 Editor B', 'editor-b@wf02.invalid', 'teacher', true),
  ('f0200000-0000-4000-8000-000000000003', 'f0200000-0000-4000-8000-0000000000a1', 'WF02 Approver', 'approver@wf02.invalid', 'teacher', true),
  ('f0200000-0000-4000-8000-000000000004', 'f0200000-0000-4000-8000-0000000000a1', 'WF02 Classroom User', 'classroom@wf02.invalid', 'teacher', true),
  ('f0200000-0000-4000-8000-000000000005', 'f0200000-0000-4000-8000-0000000000a1', 'WF02 Caregiver', 'caregiver@wf02.invalid', 'parent', true);

INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, assigned_by)
SELECT 'f0200000-0000-4000-8000-0000000000a1', u.user_id, r.code, 'org', u.assigned_by
  FROM (VALUES
    ('f0200000-0000-4000-8000-000000000001'::uuid, 'f0200000-0000-4000-8000-000000000002'::uuid, 'head_of_institution'),
    ('f0200000-0000-4000-8000-000000000002'::uuid, 'f0200000-0000-4000-8000-000000000001'::uuid, 'proprietor'),
    ('f0200000-0000-4000-8000-000000000003'::uuid, 'f0200000-0000-4000-8000-000000000001'::uuid, 'auditor'),
    ('f0200000-0000-4000-8000-000000000004'::uuid, 'f0200000-0000-4000-8000-000000000001'::uuid, 'teacher'),
    ('f0200000-0000-4000-8000-000000000005'::uuid, 'f0200000-0000-4000-8000-000000000001'::uuid, 'parent')
  ) u(user_id, assigned_by, template_code)
  JOIN public.role_catalog r ON r.template_code = u.template_code AND r.org_id IS NULL
 WHERE r.code = (
   SELECT min(r2.code) FROM public.role_catalog r2
    WHERE r2.template_code = u.template_code AND r2.org_id IS NULL
 );

SELECT wf02t.login('f0200000-0000-4000-8000-000000000001');
SELECT wf02t.expect_true('authenticated users can read the global catalogue',
  (SELECT count(*) = 3 FROM public.wf_template));
SELECT wf02t.expect_true('head template receives view, manage and run but not approve',
  public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.view')
  AND public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.manage')
  AND public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.run')
  AND NOT public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.approve')
  AND EXISTS (SELECT 1 FROM public.effective_permissions('f0200000-0000-4000-8000-0000000000a1', auth.uid())
               WHERE permission_code = 'workflows.manage'));
INSERT INTO public.wf_definition (id, org_id, key, name)
VALUES ('f0210000-0000-4000-8000-0000000000a1', 'f0200000-0000-4000-8000-0000000000a1', 'sod-sample', 'SoD sample');
INSERT INTO public.wf_version (id, org_id, definition_id, version, graph)
VALUES ('f0220000-0000-4000-8000-0000000000a1', 'f0200000-0000-4000-8000-0000000000a1',
        'f0210000-0000-4000-8000-0000000000a1', 1, '{"steps":[{"id":"approve","kind":"approval"}]}');
SELECT wf02t.logout();

SELECT wf02t.login('f0200000-0000-4000-8000-000000000002');
UPDATE public.wf_version SET graph = '{"steps":[{"id":"approve","kind":"approval"},{"id":"notify"}]}'
 WHERE id = 'f0220000-0000-4000-8000-0000000000a1';
SELECT wf02t.logout();

SELECT wf02t.expect_true('draft captures author and latest editor',
  (SELECT created_by = 'f0200000-0000-4000-8000-000000000001'
       AND updated_by = 'f0200000-0000-4000-8000-000000000002'
     FROM public.wf_version WHERE id = 'f0220000-0000-4000-8000-0000000000a1'));

SELECT wf02t.login('f0200000-0000-4000-8000-000000000004');
SELECT wf02t.expect_true('classroom role receives neither manage nor approve',
  NOT public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.manage')
  AND NOT public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.approve'));
SELECT wf02t.logout();
SELECT wf02t.login('f0200000-0000-4000-8000-000000000005');
SELECT wf02t.expect_true('caregiver role receives neither manage nor approve',
  NOT public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.manage')
  AND NOT public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.approve'));
SELECT wf02t.logout();
SELECT wf02t.login('f0200000-0000-4000-8000-000000000003');
SELECT wf02t.expect_true('approver role receives approve without manage',
  public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.view')
  AND public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.approve')
  AND NOT public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.manage'));
SELECT wf02t.logout();

SELECT wf02t.login_as('service_role');
SELECT wf02t.expect_error('author cannot publish the authored version',
  $q$UPDATE public.wf_version SET state = 'published', published_by = 'f0200000-0000-4000-8000-000000000001'
      WHERE id = 'f0220000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf02t.expect_error('last editor cannot publish the edited version',
  $q$UPDATE public.wf_version SET state = 'published', published_by = 'f0200000-0000-4000-8000-000000000002'
      WHERE id = 'f0220000-0000-4000-8000-0000000000a1'$q$, '42501');
UPDATE public.wf_version SET state = 'published', published_by = 'f0200000-0000-4000-8000-000000000003'
 WHERE id = 'f0220000-0000-4000-8000-0000000000a1';
INSERT INTO public.wf_run (
  id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps, deadline_at, started_at
) VALUES (
  'f0230000-0000-4000-8000-0000000000a1', 'f0200000-0000-4000-8000-0000000000a1',
  'f0210000-0000-4000-8000-0000000000a1', 'f0220000-0000-4000-8000-0000000000a1',
  'wf02-run-sod-0001', 'running', 5, 200, now() + interval '1 day', now()
);
INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, idempotency_key)
VALUES ('f0240000-0000-4000-8000-0000000000a1', 'f0200000-0000-4000-8000-0000000000a1',
        'f0230000-0000-4000-8000-0000000000a1', 'approve', 'approval', 'wf02-step-sod-0001');
INSERT INTO public.wf_approval (
  id, org_id, run_id, step_run_id, summary, requested_by_kind, requested_by_ref, expires_at
) VALUES (
  'f0250000-0000-4000-8000-0000000000a1', 'f0200000-0000-4000-8000-0000000000a1',
  'f0230000-0000-4000-8000-0000000000a1', 'f0240000-0000-4000-8000-0000000000a1',
  'Approve pending request', 'system', 'scheduler', now() + interval '1 day'
);
SELECT wf02t.expect_error('author cannot decide a request for the authored version',
  $q$UPDATE public.wf_approval SET status = 'approved', decided_by = 'f0200000-0000-4000-8000-000000000001',
       decided_at = now(), decision_channel = 'console' WHERE id = 'f0250000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf02t.expect_error('last editor cannot decide a request for the edited version',
  $q$UPDATE public.wf_approval SET status = 'approved', decided_by = 'f0200000-0000-4000-8000-000000000002',
       decided_at = now(), decision_channel = 'console' WHERE id = 'f0250000-0000-4000-8000-0000000000a1'$q$, '42501');
UPDATE public.wf_approval SET status = 'approved', decided_by = 'f0200000-0000-4000-8000-000000000003',
       decided_at = now(), decision_channel = 'console' WHERE id = 'f0250000-0000-4000-8000-0000000000a1';
SELECT wf02t.pass('an unrelated person in the console can decide the approval');
SELECT wf02t.logout();

DO $finish$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM wf02t.passed;
  RAISE NOTICE 'WF02 ALL PASS: % checks', v_count;
END $finish$;
ROLLBACK;
