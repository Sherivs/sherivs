-- WF-06 action catalogue, autonomy caps, draft isolation and service-only writes.
-- Local disposable Postgres only. All synthetic records roll back.
BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WF06 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.wf_action_type') IS NULL
     OR to_regclass('public.wf_action_template') IS NULL
     OR to_regclass('public.wf_action_draft') IS NULL
     OR to_regclass('public.wf_action_sandbox_outbox') IS NULL
     OR to_regclass('public.wf_webhook_target') IS NULL THEN
    RAISE EXCEPTION 'WF06 FAIL: WF-06 migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA wf06t;
GRANT USAGE ON SCHEMA wf06t TO anon, authenticated, service_role;
CREATE TABLE wf06t.passed (n serial PRIMARY KEY, label text NOT NULL);
GRANT SELECT, INSERT ON wf06t.passed TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE wf06t.passed_n_seq TO anon, authenticated, service_role;
CREATE FUNCTION wf06t.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wf06t.passed (label) VALUES (p_label);
  RAISE NOTICE 'WF06 PASS %', p_label;
END $$;
CREATE FUNCTION wf06t.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WF06 FAIL [%]', p_label; END IF;
  PERFORM wf06t.pass(p_label);
END $$;
CREATE FUNCTION wf06t.expect_error(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN
      PERFORM wf06t.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'WF06 FAIL [%]: expected SQLSTATE % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'WF06 FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION wf06t.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION wf06t.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION wf06t.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf06t TO anon, authenticated, service_role;

SELECT wf06t.expect_true('all action stores force RLS',
  (SELECT count(*) = 5 FROM pg_class WHERE oid = ANY(ARRAY[
    'public.wf_action_type'::regclass,
    'public.wf_action_template'::regclass,
    'public.wf_action_draft'::regclass,
    'public.wf_action_sandbox_outbox'::regclass,
    'public.wf_webhook_target'::regclass
  ]) AND relrowsecurity AND relforcerowsecurity));
SELECT wf06t.expect_true('action catalog and templates are readable only by authorized roles',
  has_table_privilege('authenticated', 'public.wf_action_type', 'SELECT')
  AND has_table_privilege('authenticated', 'public.wf_action_template', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.wf_action_type', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.wf_action_template', 'SELECT')
  AND has_table_privilege('service_role', 'public.wf_action_draft', 'INSERT')
  AND has_table_privilege('service_role', 'public.wf_action_sandbox_outbox', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.wf_action_draft', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.wf_action_draft', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.wf_action_sandbox_outbox', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.wf_webhook_target', 'SELECT'));
SELECT wf06t.expect_true('catalog seeds exactly the seven v1 action kinds and binds effects',
  (SELECT count(*) = 7 FROM public.wf_action_type)
  AND (SELECT count(*) = 5 FROM public.wf_action_type WHERE broker_tool_id IS NOT NULL)
  AND (SELECT count(*) = 2 FROM public.wf_action_type WHERE broker_tool_id IS NULL));
SELECT wf06t.expect_error('SQL catalog cannot raise a protected category above draft',
  $q$INSERT INTO public.wf_action_type
       (kind,category,broker_tool_id,broker_version,effect,max_autonomy)
     VALUES ('task','mass_message',NULL,NULL,'internal_state','act_and_report')$q$, '23514');

INSERT INTO auth.users (id) VALUES
  ('f0600000-0000-4000-8000-000000000001'),
  ('f0600000-0000-4000-8000-000000000002'),
  ('f0600000-0000-4000-8000-000000000003'),
  ('f0600000-0000-4000-8000-000000000004');
INSERT INTO public.schools (id, name, slug) VALUES
  ('f0600000-0000-4000-8000-0000000000a1', 'WF06 Org A', 'wf06-org-a'),
  ('f0600000-0000-4000-8000-0000000000b2', 'WF06 Org B', 'wf06-org-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('f0600000-0000-4000-8000-000000000001', 'f0600000-0000-4000-8000-0000000000a1', 'WF06 User A', 'user-a@wf06.invalid', 'admin', true),
  ('f0600000-0000-4000-8000-000000000002', 'f0600000-0000-4000-8000-0000000000b2', 'WF06 User B', 'user-b@wf06.invalid', 'admin', true),
  ('f0600000-0000-4000-8000-000000000003', 'f0600000-0000-4000-8000-0000000000a1', 'WF06 Editor A', 'editor-a@wf06.invalid', 'teacher', true),
  ('f0600000-0000-4000-8000-000000000004', 'f0600000-0000-4000-8000-0000000000a1', 'WF06 Publisher A', 'publisher-a@wf06.invalid', 'teacher', true);

SELECT set_config('request.jwt.claim.sub', 'f0600000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"f0600000-0000-4000-8000-000000000003","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, assigned_by)
SELECT v.org_id, v.user_id, r.code, t.default_scope, NULL, v.assigned_by
  FROM (VALUES
    ('f0600000-0000-4000-8000-0000000000a1'::uuid, 'f0600000-0000-4000-8000-000000000003'::uuid, 'f0600000-0000-4000-8000-000000000004'::uuid, 'head_of_institution'),
    ('f0600000-0000-4000-8000-0000000000b2'::uuid, 'f0600000-0000-4000-8000-000000000002'::uuid, 'f0600000-0000-4000-8000-000000000003'::uuid, 'head_of_institution')
  ) v(org_id,user_id,assigned_by,template_code)
  JOIN public.role_catalog r ON r.template_code = v.template_code AND r.org_id IS NULL
    AND NOT coalesce(r.requires_verified_authority_link, false)
  JOIN public.role_templates t ON t.code = r.template_code
 WHERE r.code = (
   SELECT min(r2.code) FROM public.role_catalog r2
    WHERE r2.template_code = v.template_code AND r2.org_id IS NULL
      AND NOT coalesce(r2.requires_verified_authority_link, false)
 );
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling) VALUES
  ('f0600000-0000-4000-8000-0000000000a1', true, 'act_and_report'),
  ('f0600000-0000-4000-8000-0000000000b2', true, 'act_and_report');
INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES
  ('f0600000-0000-4000-8000-0000000000a1', 'wf06-agent', 'act_and_report'),
  ('f0600000-0000-4000-8000-0000000000b2', 'wf06-agent', 'act_and_report');
UPDATE public.wf_template SET autonomy_max = 'act_and_report'
 WHERE template_key = 'payment_due_reminder_ladder' AND version = 1;

INSERT INTO public.wf_definition (id, org_id, key, name, created_by) VALUES
  ('f0610000-0000-4000-8000-0000000000a1', 'f0600000-0000-4000-8000-0000000000a1', 'wf06-a', 'WF06 A', 'f0600000-0000-4000-8000-000000000003'),
  ('f0610000-0000-4000-8000-0000000000b2', 'f0600000-0000-4000-8000-0000000000b2', 'wf06-b', 'WF06 B', 'f0600000-0000-4000-8000-000000000002');
INSERT INTO public.wf_version (id, org_id, definition_id, version, created_by) VALUES
  ('f0620000-0000-4000-8000-0000000000a1', 'f0600000-0000-4000-8000-0000000000a1', 'f0610000-0000-4000-8000-0000000000a1', 1, 'f0600000-0000-4000-8000-000000000003'),
  ('f0620000-0000-4000-8000-0000000000b2', 'f0600000-0000-4000-8000-0000000000b2', 'f0610000-0000-4000-8000-0000000000b2', 1, 'f0600000-0000-4000-8000-000000000002');
SELECT set_config('request.jwt.claim.sub', 'f0600000-0000-4000-8000-000000000004', true);
UPDATE public.wf_version SET graph = '{"steps":[]}' WHERE id IN (
  'f0620000-0000-4000-8000-0000000000a1', 'f0620000-0000-4000-8000-0000000000b2'
);
SELECT set_config('request.jwt.claim.sub', 'f0600000-0000-4000-8000-000000000001', true);
UPDATE public.wf_version SET state = 'published', published_by = 'f0600000-0000-4000-8000-000000000001'
 WHERE id = 'f0620000-0000-4000-8000-0000000000a1';
SELECT set_config('request.jwt.claim.sub', 'f0600000-0000-4000-8000-000000000004', true);
UPDATE public.wf_version SET state = 'published', published_by = 'f0600000-0000-4000-8000-000000000004'
 WHERE id = 'f0620000-0000-4000-8000-0000000000b2';
UPDATE public.wf_definition SET current_version_id = 'f0620000-0000-4000-8000-0000000000a1'
 WHERE id = 'f0610000-0000-4000-8000-0000000000a1';
UPDATE public.wf_definition SET current_version_id = 'f0620000-0000-4000-8000-0000000000b2'
 WHERE id = 'f0610000-0000-4000-8000-0000000000b2';
SELECT set_config('request.jwt.claim.sub', '', true);
INSERT INTO public.wf_run (
  id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
  started_by, deadline_at, started_at, template_id, agent_ref
) VALUES
  ('f0630000-0000-4000-8000-0000000000a1', 'f0600000-0000-4000-8000-0000000000a1', 'f0610000-0000-4000-8000-0000000000a1', 'f0620000-0000-4000-8000-0000000000a1', 'wf06-run-a', 'running', 2, 20, 'f0600000-0000-4000-8000-000000000003', now() + interval '1 hour', now(), (SELECT id FROM public.wf_template WHERE template_key = 'payment_due_reminder_ladder' AND version = 1), 'wf06-agent'),
  ('f0630000-0000-4000-8000-0000000000b2', 'f0600000-0000-4000-8000-0000000000b2', 'f0610000-0000-4000-8000-0000000000b2', 'f0620000-0000-4000-8000-0000000000b2', 'wf06-run-b', 'running', 2, 20, 'f0600000-0000-4000-8000-000000000002', now() + interval '1 hour', now(), (SELECT id FROM public.wf_template WHERE template_key = 'payment_due_reminder_ladder' AND version = 1), 'wf06-agent');

INSERT INTO public.wf_step_run (
  id, org_id, run_id, step_key, kind, idempotency_key, action_class, autonomy_level, agent_ref
) VALUES
  ('f0640000-0000-4000-8000-000000000001', 'f0600000-0000-4000-8000-0000000000a1', 'f0630000-0000-4000-8000-0000000000a1', 'money', 'action', 'wf06-a-money', 'money_movement', 'act_and_report', 'wf06-agent'),
  ('f0640000-0000-4000-8000-000000000002', 'f0600000-0000-4000-8000-0000000000a1', 'f0630000-0000-4000-8000-0000000000a1', 'safety', 'action', 'wf06-a-safety', 'safeguarding', 'act_and_report', 'wf06-agent'),
  ('f0640000-0000-4000-8000-000000000003', 'f0600000-0000-4000-8000-0000000000a1', 'f0630000-0000-4000-8000-0000000000a1', 'credentials', 'action', 'wf06-a-credentials', 'credential_change', 'act_and_report', 'wf06-agent'),
  ('f0640000-0000-4000-8000-000000000004', 'f0600000-0000-4000-8000-0000000000a1', 'f0630000-0000-4000-8000-0000000000a1', 'publishing', 'action', 'wf06-a-publishing', 'public_publish', 'act_and_report', 'wf06-agent'),
  ('f0640000-0000-4000-8000-000000000005', 'f0600000-0000-4000-8000-0000000000a1', 'f0630000-0000-4000-8000-0000000000a1', 'mass-message', 'action', 'wf06-a-mass-message', 'mass_message', 'act_and_report', 'wf06-agent'),
  ('f0640000-0000-4000-8000-000000000006', 'f0600000-0000-4000-8000-0000000000a1', 'f0630000-0000-4000-8000-0000000000a1', 'authority-share', 'action', 'wf06-a-authority-share', 'external_authority_share', 'act_and_report', 'wf06-agent'),
  ('f0640000-0000-4000-8000-000000000007', 'f0600000-0000-4000-8000-0000000000a1', 'f0630000-0000-4000-8000-0000000000a1', 'communication', 'action', 'wf06-a-communication', 'communication', 'act_and_report', 'wf06-agent'),
  ('f0640000-0000-4000-8000-000000000008', 'f0600000-0000-4000-8000-0000000000a1', 'f0630000-0000-4000-8000-0000000000a1', 'unclassified', 'action', 'wf06-a-unclassified', 'unclassified', 'act_and_report', 'wf06-agent'),
  ('f0640000-0000-4000-8000-000000000009', 'f0600000-0000-4000-8000-0000000000a1', 'f0630000-0000-4000-8000-0000000000a1', 'internal', 'action', 'wf06-a-internal', 'internal', 'act_and_report', 'wf06-agent'),
  ('f0640000-0000-4000-8000-000000000010', 'f0600000-0000-4000-8000-0000000000a1', 'f0630000-0000-4000-8000-0000000000a1', 'draft', 'action', 'wf06-a-draft', 'mass_message', 'act_and_report', 'wf06-agent'),
  ('f0640000-0000-4000-8000-000000000011', 'f0600000-0000-4000-8000-0000000000b2', 'f0630000-0000-4000-8000-0000000000b2', 'draft', 'action', 'wf06-b-draft', 'mass_message', 'act_and_report', 'wf06-agent');

SELECT wf06t.expect_true('SQL autonomy trigger holds all six caps and fails closed on unknown classes',
  (SELECT count(*) = 6 FROM public.wf_step_run
    WHERE org_id = 'f0600000-0000-4000-8000-0000000000a1'
      AND step_key IN ('money','safety','credentials','publishing','mass-message','authority-share')
      AND autonomy_level = 'draft')
  AND (SELECT autonomy_level = 'draft' FROM public.wf_step_run WHERE id = 'f0640000-0000-4000-8000-000000000008')
  AND (SELECT autonomy_level = 'act_and_report' FROM public.wf_step_run WHERE id = 'f0640000-0000-4000-8000-000000000007')
  AND (SELECT autonomy_level = 'act_and_report' FROM public.wf_step_run WHERE id = 'f0640000-0000-4000-8000-000000000009'));

INSERT INTO public.wf_action_draft
  (org_id,run_id,step_run_id,kind,category,template_ref,recipient_ids,idempotency_key)
VALUES
  ('f0600000-0000-4000-8000-0000000000a1','f0630000-0000-4000-8000-0000000000a1','f0640000-0000-4000-8000-000000000010','sms','mass_message','attendance.notice',ARRAY['f0600000-0000-4000-8000-000000000003'::uuid],'wf06-draft-a'),
  ('f0600000-0000-4000-8000-0000000000b2','f0630000-0000-4000-8000-0000000000b2','f0640000-0000-4000-8000-000000000011','sms','mass_message','attendance.notice',ARRAY['f0600000-0000-4000-8000-000000000002'::uuid],'wf06-draft-b');
SELECT wf06t.expect_error('protected category draft cannot be approved',
  $q$UPDATE public.wf_action_draft SET status = 'approved'
      WHERE idempotency_key = 'wf06-draft-a'$q$, '23514');
SELECT wf06t.login('f0600000-0000-4000-8000-000000000003');
SELECT wf06t.expect_error('authenticated users cannot write action drafts',
  $q$INSERT INTO public.wf_action_draft
       (org_id,run_id,step_run_id,kind,category,template_ref,idempotency_key)
     VALUES ('f0600000-0000-4000-8000-0000000000a1','f0630000-0000-4000-8000-0000000000a1',
       'f0640000-0000-4000-8000-000000000010','sms','communication','attendance.notice','wf06-client-write')$q$, '42501');
SELECT wf06t.logout();

SELECT wf06t.login('f0600000-0000-4000-8000-000000000003');
SELECT wf06t.expect_true('Org A workflow member sees only Org A action drafts',
  public.wf_can('f0600000-0000-4000-8000-0000000000a1', 'workflows.view')
  AND (SELECT count(*) = 1 FROM public.wf_action_draft)
  AND NOT EXISTS (SELECT 1 FROM public.wf_action_draft
                   WHERE org_id = 'f0600000-0000-4000-8000-0000000000b2'));
SELECT wf06t.logout();
SELECT wf06t.login('f0600000-0000-4000-8000-000000000002');
SELECT wf06t.expect_true('Org B workflow member cannot read Org A action drafts',
  public.wf_can('f0600000-0000-4000-8000-0000000000b2', 'workflows.view')
  AND (SELECT count(*) = 1 FROM public.wf_action_draft)
  AND NOT EXISTS (SELECT 1 FROM public.wf_action_draft
                   WHERE org_id = 'f0600000-0000-4000-8000-0000000000a1'));
SELECT wf06t.logout();

DO $summary$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM wf06t.passed;
  IF v_count < 9 THEN RAISE EXCEPTION 'WF06 FAIL: expected at least 9 checks, got %', v_count; END IF;
  RAISE NOTICE 'WF06 ALL PASS: % checks', v_count;
END $summary$;
ROLLBACK;
