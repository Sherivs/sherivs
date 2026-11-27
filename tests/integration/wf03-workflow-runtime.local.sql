-- WF-03 runtime claims, autonomy limits and tenant access checks.
-- Local disposable Postgres only. All synthetic records are rolled back.
BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WF03 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.wf_org_settings') IS NULL
     OR to_regprocedure('public.wf_claim_due_events(text,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'WF03 FAIL: WF-03 migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA wf03t;
GRANT USAGE ON SCHEMA wf03t TO anon, authenticated, service_role;
CREATE TABLE wf03t.passed (n serial PRIMARY KEY, label text NOT NULL);
GRANT SELECT, INSERT ON wf03t.passed TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE wf03t.passed_n_seq TO anon, authenticated, service_role;

CREATE FUNCTION wf03t.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wf03t.passed (label) VALUES (p_label);
  RAISE NOTICE 'WF03 PASS %', p_label;
END $$;
CREATE FUNCTION wf03t.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WF03 FAIL [%]', p_label; END IF;
  PERFORM wf03t.pass(p_label);
END $$;
CREATE FUNCTION wf03t.expect_error(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN
      PERFORM wf03t.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'WF03 FAIL [%]: expected SQLSTATE % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'WF03 FAIL [%]: statement was allowed but must fail with %', p_label, p_state;
END $$;
CREATE FUNCTION wf03t.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf03t TO anon, authenticated, service_role;

INSERT INTO public.wf_org_settings (org_id)
VALUES ('f0300000-0000-4000-8000-0000000000a1');
SELECT wf03t.expect_true('organization settings default off and both tenant tables force RLS',
  (SELECT workflows_enabled = false FROM public.wf_org_settings
    WHERE org_id = 'f0300000-0000-4000-8000-0000000000a1')
  AND (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.wf_org_settings'::regclass)
  AND (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.wf_agent_autonomy'::regclass));

SELECT wf03t.login_as('service_role');
INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling)
VALUES ('f0300000-0000-4000-8000-0000000000b2', true, 'act_with_approval');
RESET ROLE;
\ir ain01-agent-fixture.sql
SELECT pg_temp.ain01_fixture_agent('f0300000-0000-4000-8000-0000000000b2', 'agent-one');
\ir ain02-autonomy-fixture.sql
SELECT pg_temp.ain02_set_level('f0300000-0000-4000-8000-0000000000b2', 'agent-one', 'act_and_report');
SELECT wf03t.login_as('service_role');
UPDATE public.wf_template SET autonomy_max = 'act_and_report'
 WHERE template_key = 'payment_due_reminder_ladder' AND version = 1;

INSERT INTO public.wf_definition (id, org_id, key, name)
VALUES ('f0310000-0000-4000-8000-0000000000b2', 'f0300000-0000-4000-8000-0000000000b2', 'runtime', 'Runtime');
INSERT INTO public.wf_version (id, org_id, definition_id, version, created_by)
VALUES ('f0320000-0000-4000-8000-0000000000b2', 'f0300000-0000-4000-8000-0000000000b2',
        'f0310000-0000-4000-8000-0000000000b2', 1, 'f0330000-0000-4000-8000-000000000001');
UPDATE public.wf_version SET state = 'published', published_by = 'f0330000-0000-4000-8000-000000000002'
 WHERE id = 'f0320000-0000-4000-8000-0000000000b2';
UPDATE public.wf_definition SET current_version_id = 'f0320000-0000-4000-8000-0000000000b2'
 WHERE id = 'f0310000-0000-4000-8000-0000000000b2';
INSERT INTO public.wf_run (
  id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
  deadline_at, started_at, template_id, agent_ref
) VALUES (
  'f0340000-0000-4000-8000-0000000000b2', 'f0300000-0000-4000-8000-0000000000b2',
  'f0310000-0000-4000-8000-0000000000b2', 'f0320000-0000-4000-8000-0000000000b2',
  'wf03-run-0001', 'running', 2, 20, now() + interval '1 hour', now(),
  (SELECT id FROM public.wf_template WHERE template_key = 'payment_due_reminder_ladder' AND version = 1),
  'agent-one'
);
INSERT INTO public.wf_step_run (
  id, org_id, run_id, step_key, kind, idempotency_key, action_class, autonomy_level,
  budget_units, spent_units, agent_ref
) VALUES (
  'f0350000-0000-4000-8000-0000000000b2', 'f0300000-0000-4000-8000-0000000000b2',
  'f0340000-0000-4000-8000-0000000000b2', 'publish', 'action', 'wf03-step-0001',
  'public_publish', 'act_and_report', 10, 4, 'agent-one'
);
SELECT wf03t.expect_true('direct SQL autonomy elevation is capped at draft',
  (SELECT autonomy_level = 'draft' FROM public.wf_step_run WHERE id = 'f0350000-0000-4000-8000-0000000000b2'));
INSERT INTO public.wf_step_run (
  org_id, run_id, step_key, kind, idempotency_key, action_class, autonomy_level, agent_ref
) VALUES (
  'f0300000-0000-4000-8000-0000000000b2', 'f0340000-0000-4000-8000-0000000000b2',
  'internal', 'action', 'wf03-step-0002', 'internal', 'act_and_report', 'agent-one'
);
SELECT wf03t.expect_true('effective autonomy uses the lowest template, tenant and agent ceiling',
  (SELECT autonomy_level = 'act_with_approval' FROM public.wf_step_run
    WHERE idempotency_key = 'wf03-step-0002'));
SELECT wf03t.expect_error('spent units cannot exceed the step budget',
  $q$UPDATE public.wf_step_run SET spent_units = 11 WHERE id = 'f0350000-0000-4000-8000-0000000000b2'$q$, '23514');

SELECT wf03t.expect_error('run depth cannot exceed its copied maximum',
  $q$INSERT INTO public.wf_run (
       org_id, definition_id, version_id, idempotency_key, status, depth, max_depth, max_steps,
       deadline_at, started_at
     ) VALUES (
       'f0300000-0000-4000-8000-0000000000b2', 'f0310000-0000-4000-8000-0000000000b2',
       'f0320000-0000-4000-8000-0000000000b2', 'wf03-too-deep', 'running', 3, 2, 20, now() + interval '1 hour', now()
     )$q$, '23514');

INSERT INTO public.wf_event (id, org_id, event_type, source, dedupe_key, payload)
VALUES
  ('f0360000-0000-4000-8000-0000000000a1', 'f0300000-0000-4000-8000-0000000000a1',
   'workflow.requested', 'wf03', 'disabled-event-a', '{}'),
  ('f0360000-0000-4000-8000-0000000000b2', 'f0300000-0000-4000-8000-0000000000b2',
   'workflow.requested', 'wf03', 'enabled-event-b', '{"request_ref":"wf03-fixture"}');
SELECT wf03t.expect_error('event dedupe is unique per organization',
  $q$INSERT INTO public.wf_event (org_id, event_type, source, dedupe_key)
     VALUES ('f0300000-0000-4000-8000-0000000000b2', 'workflow.requested', 'wf03', 'enabled-event-b')$q$, '23505');
CREATE TEMP TABLE wf03_claimed ON COMMIT DROP AS
  SELECT * FROM public.wf_claim_due_events('wf03-worker', 20, 30);
GRANT SELECT ON wf03_claimed TO service_role;
SELECT wf03t.expect_true('only enabled organization events are claimed',
  (SELECT count(*) = 1 AND min(org_id::text) = 'f0300000-0000-4000-8000-0000000000b2' FROM wf03_claimed)
  AND (SELECT status = 'pending' FROM public.wf_event WHERE id = 'f0360000-0000-4000-8000-0000000000a1'));

INSERT INTO public.wf_trigger_binding (id, org_id, definition_id, kind, event_type, enabled)
VALUES (
  'f0380000-0000-4000-8000-0000000000b2', 'f0300000-0000-4000-8000-0000000000b2',
  'f0310000-0000-4000-8000-0000000000b2', 'event', 'workflow.requested', true
);
DO $duplicate_event$
DECLARE
  first_created boolean;
  second_created boolean;
  run_count integer;
  v_template uuid;
BEGIN
  SELECT id INTO v_template FROM public.wf_template
   WHERE template_key = 'payment_due_reminder_ladder' AND version = 1;
  SELECT created INTO first_created FROM public.wf_create_event_run(
    'f0370000-0000-4000-8000-0000000000b2', 'f0360000-0000-4000-8000-0000000000b2',
    'wf03-worker', 'f0380000-0000-4000-8000-0000000000b2', v_template, 'agent-one', now(),
    now() + interval '1 hour', 5, 200, 'first-step', 'action', 'internal', 0, 5, 60,
    '{"request_ref":"wf03-fixture"}',
    '{"run":{"runId":"runtime-run","definitionId":"runtime","tenantRef":"tenant-b","state":"running","history":[],"pendingEvidence":[],"evidence":[],"attempts":[]}}'
  );
  PERFORM wf03t.expect_true('event payload is persisted as first-step input',
    (SELECT input_ref->>'request_ref' = 'wf03-fixture'
       FROM public.wf_step_run WHERE run_id = 'f0370000-0000-4000-8000-0000000000b2'));
  SELECT created INTO second_created FROM public.wf_create_event_run(
    'f0390000-0000-4000-8000-0000000000b2', 'f0360000-0000-4000-8000-0000000000b2',
    'wf03-worker', 'f0380000-0000-4000-8000-0000000000b2', v_template, 'agent-one', now(),
    now() + interval '1 hour', 5, 200, 'first-step', 'action', 'internal', 0, 5, 60,
    '{"request_ref":"wf03-fixture"}',
    '{"run":{"runId":"runtime-run","definitionId":"runtime","tenantRef":"tenant-b","state":"running","history":[],"pendingEvidence":[],"evidence":[],"attempts":[]}}'
  );
  SELECT count(*) INTO run_count FROM public.wf_run
   WHERE org_id = 'f0300000-0000-4000-8000-0000000000b2'
     AND idempotency_key = 'wf-event:f0360000-0000-4000-8000-0000000000b2';
  IF first_created IS DISTINCT FROM true OR second_created IS DISTINCT FROM false OR run_count <> 1 THEN
    RAISE EXCEPTION 'WF03 FAIL: duplicate event run creation was not idempotent';
  END IF;
  PERFORM wf03t.pass('duplicate event creates exactly one run');
END $duplicate_event$;

SELECT wf03t.expect_true('authenticated settings permissions and gate-only earned autonomy (service role reads it, AIN-02)',
  has_table_privilege('authenticated', 'public.wf_org_settings', 'SELECT')
  AND has_table_privilege('authenticated', 'public.wf_org_settings', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.wf_org_settings', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.wf_org_settings', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.wf_agent_autonomy', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.wf_agent_autonomy', 'SELECT')
  AND has_table_privilege('service_role', 'public.wf_agent_autonomy', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.wf_agent_autonomy', 'UPDATE')  -- AIN-02: the gate writes it
  AND NOT has_table_privilege('authenticated', 'public.wf_run', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.wf_step_run', 'INSERT')
  AND has_function_privilege('service_role', 'public.wf_claim_due_events(text,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.wf_claim_due_events(text,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.wf_claim_due_events(text,integer,integer)', 'EXECUTE'));

SELECT wf03t.login_as('authenticated');
SELECT wf03t.expect_error('authenticated cannot raise earned autonomy',
  $q$UPDATE public.wf_agent_autonomy SET earned_level = 'act_and_report' WHERE agent_ref = 'agent-one'$q$, '42501');
SELECT wf03t.expect_error('authenticated cannot write workflow steps',
  $q$INSERT INTO public.wf_step_run (org_id, run_id, step_key, kind, idempotency_key)
     VALUES ('f0300000-0000-4000-8000-0000000000b2', 'f0340000-0000-4000-8000-0000000000b2', 'client', 'action', 'wf03-client-step')$q$, '42501');

SELECT wf03t.login_as('service_role');
SELECT wf03t.expect_true('WF-03 settings changes append to the existing audit chain',
  EXISTS (SELECT 1 FROM public.audit_chain
           WHERE org_id = 'f0300000-0000-4000-8000-0000000000b2'
             AND action = 'workflow.wf_org_settings.changed'));

SELECT wf03t.expect_true('WF03 ALL PASS: runtime claims, autonomy cap, grants and audit',
  (SELECT count(*) >= 8 FROM wf03t.passed));
ROLLBACK;
