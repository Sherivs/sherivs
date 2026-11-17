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
    )) a
     WHERE a.grantee IN (0, (SELECT oid FROM pg_roles WHERE rolname = 'anon'))
  ));
SELECT wf02t.expect_true('WF-02 guard functions have no client, service or public execute grants',
  NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid IN (
       'public.wf_version_editor_stamp()'::regprocedure,
       'public.wf_version_sod_guard()'::regprocedure,
       'public.wf_approval_sod_guard()'::regprocedure
     )
       AND a.grantee IN (
         0,
         (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
         (SELECT oid FROM pg_roles WHERE rolname = 'authenticated'),
         (SELECT oid FROM pg_roles WHERE rolname = 'service_role')
       )
       AND a.privilege_type = 'EXECUTE'
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
  ('f0200000-0000-4000-8000-000000000005'),
  ('f0200000-0000-4000-8000-000000000006');
INSERT INTO public.schools (id, name, slug)
VALUES ('f0200000-0000-4000-8000-0000000000a1', 'WF02 Synthetic Org', 'wf02-synthetic');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('f0200000-0000-4000-8000-000000000001', 'f0200000-0000-4000-8000-0000000000a1', 'WF02 Editor A', 'editor-a@wf02.invalid', 'teacher', true),
  ('f0200000-0000-4000-8000-000000000002', 'f0200000-0000-4000-8000-0000000000a1', 'WF02 Editor B', 'editor-b@wf02.invalid', 'teacher', true),
  ('f0200000-0000-4000-8000-000000000003', 'f0200000-0000-4000-8000-0000000000a1', 'WF02 Approver', 'approver@wf02.invalid', 'teacher', true),
  ('f0200000-0000-4000-8000-000000000004', 'f0200000-0000-4000-8000-0000000000a1', 'WF02 Classroom User', 'classroom@wf02.invalid', 'teacher', true),
  ('f0200000-0000-4000-8000-000000000005', 'f0200000-0000-4000-8000-0000000000a1', 'WF02 Caregiver', 'caregiver@wf02.invalid', 'parent', true),
  ('f0200000-0000-4000-8000-000000000006', 'f0200000-0000-4000-8000-0000000000a1', 'WF02 Administrator', 'administrator@wf02.invalid', 'admin', true);

SELECT set_config('request.jwt.claim.sub', 'f0200000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"f0200000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, assigned_by)
SELECT 'f0200000-0000-4000-8000-0000000000a1', u.user_id, r.code,
       CASE WHEN u.template_code IN ('teacher', 'parent') THEN 'self' ELSE t.default_scope END,
       CASE WHEN u.template_code IN ('teacher', 'parent') THEN u.user_id::text END,
       u.assigned_by
  FROM (VALUES
    ('f0200000-0000-4000-8000-000000000001'::uuid, 'f0200000-0000-4000-8000-000000000002'::uuid, 'head_of_institution'),
    ('f0200000-0000-4000-8000-000000000002'::uuid, 'f0200000-0000-4000-8000-000000000001'::uuid, 'head_of_institution'),
    ('f0200000-0000-4000-8000-000000000003'::uuid, 'f0200000-0000-4000-8000-000000000001'::uuid, 'auditor'),
    ('f0200000-0000-4000-8000-000000000004'::uuid, 'f0200000-0000-4000-8000-000000000001'::uuid, 'teacher'),
    ('f0200000-0000-4000-8000-000000000005'::uuid, 'f0200000-0000-4000-8000-000000000001'::uuid, 'parent')
  ) u(user_id, assigned_by, template_code)
  JOIN public.role_catalog r ON r.template_code = u.template_code AND r.org_id IS NULL
   AND NOT coalesce(r.requires_verified_authority_link, false)
  JOIN public.role_templates t ON t.code = r.template_code
 WHERE r.code = (
   SELECT min(r2.code) FROM public.role_catalog r2
    WHERE r2.template_code = u.template_code AND r2.org_id IS NULL
      AND NOT coalesce(r2.requires_verified_authority_link, false)
 );
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

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

SELECT wf02t.login('f0200000-0000-4000-8000-000000000006');
INSERT INTO public.wf_version (id, org_id, definition_id, version, graph)
VALUES ('f0220000-0000-4000-8000-0000000000a2', 'f0200000-0000-4000-8000-0000000000a1',
        'f0210000-0000-4000-8000-0000000000a1', 2, '{"steps":[{"id":"release","kind":"approval"}]}');
SELECT wf02t.logout();

SELECT wf02t.login('f0200000-0000-4000-8000-000000000002');
UPDATE public.wf_version SET graph = '{"steps":[{"id":"approve","kind":"approval"},{"id":"notify"}]}'
 WHERE id = 'f0220000-0000-4000-8000-0000000000a1';
UPDATE public.wf_version SET graph = '{"steps":[{"id":"release","kind":"approval"},{"id":"notify"}]}'
 WHERE id = 'f0220000-0000-4000-8000-0000000000a2';
SELECT wf02t.logout();

SELECT wf02t.expect_true('draft captures author and latest editor',
  (SELECT created_by = 'f0200000-0000-4000-8000-000000000001'
       AND updated_by = 'f0200000-0000-4000-8000-000000000002'
     FROM public.wf_version WHERE id = 'f0220000-0000-4000-8000-0000000000a1'));
SELECT wf02t.expect_true('administrator remains recorded as author after a different editor changes the draft',
  (SELECT created_by = 'f0200000-0000-4000-8000-000000000006'
       AND updated_by = 'f0200000-0000-4000-8000-000000000002'
     FROM public.wf_version WHERE id = 'f0220000-0000-4000-8000-0000000000a2'));

SELECT wf02t.login('f0200000-0000-4000-8000-000000000004');
SELECT wf02t.expect_true('classroom role receives neither manage nor approve',
  NOT public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.manage')
  AND NOT public.wf_can('f0200000-0000-4000-8000-0000000000a1', 'workflows.approve'));
SELECT wf02t.logout();
SELECT wf02t.login('f0200000-0000-4000-8000-000000000006');
SELECT wf02t.expect_true('organization administrator is identified for SoD coverage',
  public.can_administer_org('f0200000-0000-4000-8000-0000000000a1'));
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
SELECT wf02t.expect_error('administrator cannot publish a version they authored',
  $q$UPDATE public.wf_version SET state = 'published', published_by = 'f0200000-0000-4000-8000-000000000006'
      WHERE id = 'f0220000-0000-4000-8000-0000000000a2'$q$, '42501');
SELECT wf02t.expect_error('last editor cannot publish the target version',
  $q$UPDATE public.wf_version SET state = 'published', published_by = 'f0200000-0000-4000-8000-000000000002'
      WHERE id = 'f0220000-0000-4000-8000-0000000000a2'$q$, '42501');
INSERT INTO public.wf_definition (id, org_id, key, name)
VALUES ('f0210000-0000-4000-8000-0000000000b1', 'f0200000-0000-4000-8000-0000000000a1', 'approval-run', 'Approval run');
INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by, updated_by)
VALUES ('f0220000-0000-4000-8000-0000000000b1', 'f0200000-0000-4000-8000-0000000000a1',
        'f0210000-0000-4000-8000-0000000000b1', 1, '{"steps":[{"id":"approve","kind":"approval"}]}',
        'f0200000-0000-4000-8000-000000000003', 'f0200000-0000-4000-8000-000000000001');
SELECT wf02t.expect_true('service preserves author and last editor independently',
  (SELECT created_by = 'f0200000-0000-4000-8000-000000000003'
       AND updated_by = 'f0200000-0000-4000-8000-000000000001'
     FROM public.wf_version WHERE id = 'f0220000-0000-4000-8000-0000000000b1'));
UPDATE public.wf_version SET state = 'published', published_by = 'f0200000-0000-4000-8000-000000000002'
 WHERE id = 'f0220000-0000-4000-8000-0000000000b1';
INSERT INTO public.wf_run (
  id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps, deadline_at, started_at
) VALUES (
  'f0230000-0000-4000-8000-0000000000a1', 'f0200000-0000-4000-8000-0000000000a1',
  'f0210000-0000-4000-8000-0000000000b1', 'f0220000-0000-4000-8000-0000000000b1',
  'wf02-run-sod-0001', 'running', 5, 200, now() + interval '1 day', now()
);
INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, idempotency_key)
VALUES ('f0240000-0000-4000-8000-0000000000a1', 'f0200000-0000-4000-8000-0000000000a1',
        'f0230000-0000-4000-8000-0000000000a1', 'approve', 'approval', 'wf02-step-sod-0001');
INSERT INTO public.wf_approval (
  id, org_id, run_id, step_run_id, required_permission, target_version_id,
  summary, requested_by_kind, requested_by_ref, expires_at
) VALUES (
  'f0250000-0000-4000-8000-0000000000a1', 'f0200000-0000-4000-8000-0000000000a1',
  'f0230000-0000-4000-8000-0000000000a1', 'f0240000-0000-4000-8000-0000000000a1',
  'workflows.manage', 'f0220000-0000-4000-8000-0000000000a2',
  'Approve pending request', 'system', 'scheduler', now() + interval '1 day'
);
SELECT wf02t.expect_error('administrator cannot decide a request for the target version',
  $q$UPDATE public.wf_approval SET status = 'approved', decided_by = 'f0200000-0000-4000-8000-000000000006',
       decided_at = now(), decision_channel = 'console' WHERE id = 'f0250000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf02t.expect_error('last editor cannot decide a request for the target version',
  $q$UPDATE public.wf_approval SET status = 'approved', decided_by = 'f0200000-0000-4000-8000-000000000002',
       decided_at = now(), decision_channel = 'console' WHERE id = 'f0250000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf02t.expect_error('run-version author cannot decide its approval',
  $q$UPDATE public.wf_approval SET status = 'approved', decided_by = 'f0200000-0000-4000-8000-000000000003',
       decided_at = now(), decision_channel = 'console' WHERE id = 'f0250000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf02t.expect_error('run-version editor cannot decide its approval',
  $q$UPDATE public.wf_approval SET status = 'approved', decided_by = 'f0200000-0000-4000-8000-000000000001',
       decided_at = now(), decision_channel = 'console' WHERE id = 'f0250000-0000-4000-8000-0000000000a1'$q$, '42501');
SELECT wf02t.expect_error('management approval must identify its target version',
  $q$INSERT INTO public.wf_approval (
       org_id, run_id, step_run_id, required_permission, summary,
       requested_by_kind, requested_by_ref, expires_at
     ) VALUES (
       'f0200000-0000-4000-8000-0000000000a1', 'f0230000-0000-4000-8000-0000000000a1',
       'f0240000-0000-4000-8000-0000000000a1', 'workflows.manage', 'Missing target',
       'system', 'scheduler', now() + interval '1 day'
     )$q$, '23514');
SELECT wf02t.expect_error('approval target version is immutable',
  $q$UPDATE public.wf_approval SET target_version_id = 'f0220000-0000-4000-8000-0000000000b1'
      WHERE id = 'f0250000-0000-4000-8000-0000000000a1'$q$, '42501');
UPDATE public.wf_approval SET status = 'approved', decided_by = 'f0200000-0000-4000-8000-000000000004',
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
