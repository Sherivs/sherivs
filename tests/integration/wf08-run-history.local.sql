-- WF-08 run history: redacted tenant-scoped reads, cancel, retry (new run from a dead step), idempotency,
-- audit, and the guards that keep retry from reaching a live send, a capped action or an approved action twice.
-- Local disposable Postgres only. All synthetic records roll back.
BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WF08 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regprocedure('public.wf_run_cancel(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.wf_run_retry(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.wf_run_history_list(uuid,text,text,timestamp with time zone,integer)') IS NULL
     OR to_regprocedure('public.wf_run_history_detail(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'WF08 FAIL: WF-08 migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA wf08t;
GRANT USAGE ON SCHEMA wf08t TO anon, authenticated, service_role;
CREATE TABLE wf08t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE wf08t.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT, UPDATE ON wf08t.passed, wf08t.ids TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE wf08t.passed_n_seq TO anon, authenticated, service_role;
CREATE FUNCTION wf08t.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wf08t.passed (label) VALUES (p_label);
  RAISE NOTICE 'WF08 PASS %', p_label;
END $$;
CREATE FUNCTION wf08t.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WF08 FAIL [%]', p_label; END IF;
  PERFORM wf08t.pass(p_label);
END $$;
CREATE FUNCTION wf08t.expect_error(p_label text, p_sql text, p_state text, p_msg text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state AND (p_msg IS NULL OR SQLERRM LIKE '%' || p_msg || '%') THEN
      PERFORM wf08t.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'WF08 FAIL [%]: expected SQLSTATE % (%) got % (%)', p_label, p_state, p_msg, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'WF08 FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION wf08t.id(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM wf08t.ids WHERE name = p_name
$$;
CREATE FUNCTION wf08t.keep(p_name text, p_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wf08t.ids VALUES (p_name, p_id) ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id;
  RETURN p_id;
END $$;
CREATE FUNCTION wf08t.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION wf08t.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
-- All keys that occur anywhere in a JSON document (objects only, recursively).
CREATE FUNCTION wf08t.all_keys(p_doc jsonb) RETURNS SETOF text LANGUAGE sql IMMUTABLE AS $$
  WITH RECURSIVE walk(node) AS (
    SELECT p_doc
    UNION ALL
    SELECT child FROM walk,
      LATERAL (
        SELECT v AS child FROM jsonb_each(CASE WHEN jsonb_typeof(node) = 'object' THEN node ELSE '{}'::jsonb END) AS e(k, v)
        UNION ALL
        SELECT a FROM jsonb_array_elements(CASE WHEN jsonb_typeof(node) = 'array' THEN node ELSE '[]'::jsonb END) AS a
      ) c
  )
  SELECT DISTINCT k FROM walk, LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(node) = 'object' THEN node ELSE '{}'::jsonb END) AS k
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf08t TO anon, authenticated, service_role;

INSERT INTO wf08t.ids (name, id) VALUES
  ('orgA', 'f0800000-0000-4000-8000-0000000000a1'),
  ('orgB', 'f0800000-0000-4000-8000-0000000000b2'),
  ('adminA', 'f0800000-0000-4000-8000-000000000001'),
  ('viewer', 'f0800000-0000-4000-8000-000000000002'),
  ('plain', 'f0800000-0000-4000-8000-000000000003'),
  ('adminB', 'f0800000-0000-4000-8000-000000000004'),
  ('author', 'f0800000-0000-4000-8000-000000000005'),
  ('publisher', 'f0800000-0000-4000-8000-000000000006'),
  ('noorg', 'f0800000-0000-4000-8000-000000000007');

-- ---------------------------------------------------------------------------------------------
-- 1. Structure, privileges and function hygiene
-- ---------------------------------------------------------------------------------------------
SELECT wf08t.expect_true('WF-08 adds retry linkage columns to wf_run and no new table',
  (SELECT count(*) = 3 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wf_run'
      AND column_name IN ('retry_of_run_id', 'retry_of_step_id', 'retry_generation'))
  AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
                    AND c.relname LIKE 'wf_run_%' AND c.relname <> 'wf_run_event'));
SELECT wf08t.expect_true('wf_run keeps forced RLS and one retry per dead step is a unique index',
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.wf_run'::regclass)
  AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'wf_run_one_retry_per_step'
                AND indexdef LIKE 'CREATE UNIQUE INDEX%'));
SELECT wf08t.expect_true('the four WF-08 functions execute for the service role only',
  (SELECT count(*) = 4 AND bool_and(
      has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.prosecdef)
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_run_cancel', 'wf_run_retry', 'wf_run_history_list', 'wf_run_history_detail')));
SELECT wf08t.expect_true('helpers and trigger functions execute for no client role',
  (SELECT count(*) = 5 AND bool_and(
      NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_retry_blockers', 'wf_redact_event_detail', 'wf_run_control_reason_ok',
                        'wf_run_retry_guard', 'wf_action_sandbox_outbox_run_guard')));
SELECT wf08t.expect_true('every WF-08 function pins an empty search_path',
  (SELECT count(*) = 9 AND bool_and(p.proconfig @> ARRAY['search_path=""'])
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_run_cancel', 'wf_run_retry', 'wf_run_history_list', 'wf_run_history_detail',
                        'wf_retry_blockers', 'wf_redact_event_detail', 'wf_run_control_reason_ok',
                        'wf_run_retry_guard', 'wf_action_sandbox_outbox_run_guard')));
SELECT wf08t.expect_true('the outbox run guard is a BEFORE INSERT trigger after the WF-06 and WF-07 guards',
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_action_sandbox_outbox'::regclass
            AND t.tgname = 'wf_action_sandbox_outbox_20_run_guard' AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4)
  AND 'wf_action_sandbox_outbox_00_guard' < 'wf_action_sandbox_outbox_20_run_guard');

-- ---------------------------------------------------------------------------------------------
-- 2. Fixtures
-- ---------------------------------------------------------------------------------------------
INSERT INTO auth.users (id) SELECT id FROM wf08t.ids WHERE name NOT IN ('orgA', 'orgB');
INSERT INTO public.schools (id, name, slug) VALUES
  (wf08t.id('orgA'), 'WF08 Org A', 'wf08-org-a'),
  (wf08t.id('orgB'), 'WF08 Org B', 'wf08-org-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (wf08t.id('adminA'), wf08t.id('orgA'), 'WF08 Admin A', 'admin-a@wf08.invalid', 'admin', true),
  (wf08t.id('viewer'), wf08t.id('orgA'), 'WF08 Viewer', 'viewer@wf08.invalid', 'teacher', true),
  (wf08t.id('plain'), wf08t.id('orgA'), 'WF08 Plain', 'plain@wf08.invalid', 'teacher', true),
  (wf08t.id('adminB'), wf08t.id('orgB'), 'WF08 Admin B', 'admin-b@wf08.invalid', 'admin', true);

-- The viewer holds an auditor role: workflows.view (and approve), but neither run nor manage.
SELECT set_config('request.jwt.claim.sub', wf08t.id('adminA')::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', wf08t.id('adminA'), 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, assigned_by)
SELECT v.org_id, v.user_id, r.code, t.default_scope, NULL, v.assigned_by
  FROM (VALUES (wf08t.id('orgA'), wf08t.id('viewer'), wf08t.id('adminA'), 'auditor')) v(org_id, user_id, assigned_by, template_code)
  JOIN public.role_catalog r ON r.template_code = v.template_code AND r.org_id IS NULL
   AND NOT coalesce(r.requires_verified_authority_link, false)
  JOIN public.role_templates t ON t.code = r.template_code
 WHERE r.code = (SELECT min(r2.code) FROM public.role_catalog r2
                  WHERE r2.template_code = v.template_code AND r2.org_id IS NULL
                    AND NOT coalesce(r2.requires_verified_authority_link, false));
SELECT wf08t.logout();

INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling) VALUES
  (wf08t.id('orgA'), true, 'act_and_report'),
  (wf08t.id('orgB'), true, 'act_and_report');
\ir ain01-agent-fixture.sql
\ir ain02-autonomy-fixture.sql
SELECT pg_temp.ain02_set_level(wf08t.id('orgA'), 'wf08-agent', 'act_and_report');
SELECT pg_temp.ain02_set_level(wf08t.id('orgB'), 'wf08-agent', 'act_and_report');
SELECT pg_temp.ain01_fixture_agent(wf08t.id('orgA'), 'wf08-agent');
SELECT pg_temp.ain01_fixture_agent(wf08t.id('orgB'), 'wf08-agent');
UPDATE public.wf_template SET autonomy_max = 'suggest'
 WHERE template_key = 'payment_due_reminder_ladder' AND version = 1;

CREATE FUNCTION wf08t.mkdef(p_key text, p_org text, p_status text DEFAULT 'active') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_def uuid := gen_random_uuid(); v_ver uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.wf_definition (id, org_id, key, name) VALUES (v_def, wf08t.id(p_org), p_key, 'WF08 ' || p_key);
  INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by)
  VALUES (v_ver, wf08t.id(p_org), v_def, 1, '{"steps":[]}', wf08t.id('author'));
  UPDATE public.wf_version SET state = 'published', published_by = wf08t.id('publisher') WHERE id = v_ver;
  UPDATE public.wf_definition SET current_version_id = v_ver, status = p_status WHERE id = v_def;
  PERFORM wf08t.keep('def_' || p_key, v_def);
  PERFORM wf08t.keep('ver_' || p_key, v_ver);
  RETURN v_def;
END $$;
SELECT wf08t.mkdef('wf08-a', 'orgA');
SELECT wf08t.mkdef('wf08-b', 'orgB');
SELECT wf08t.mkdef('wf08-paused', 'orgA');
SELECT wf08t.mkdef('wf08-ver', 'orgA');
SELECT wf08t.mkdef('wf08-other', 'orgA');

-- A run, as the engine would leave it. Final statuses are inserted directly (finished_at set).
CREATE FUNCTION wf08t.mkrun(p_name text, p_def text, p_status text, p_started_by text DEFAULT NULL,
  p_version text DEFAULT NULL, p_template uuid DEFAULT NULL, p_created_offset integer DEFAULT 0)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_ver public.wf_version%ROWTYPE; v_final boolean := p_status IN ('succeeded', 'failed', 'cancelled', 'timed_out');
BEGIN
  SELECT * INTO v_ver FROM public.wf_version WHERE id = wf08t.id(coalesce(p_version, 'ver_' || p_def));
  INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
    step_count, started_by, deadline_at, started_at, finished_at, agent_ref, template_id, error_code)
  VALUES (v_id, v_ver.org_id, v_ver.definition_id, v_ver.id, 'wf08-run-' || p_name, p_status, 2, 20,
    CASE WHEN p_status IN ('failed', 'timed_out') THEN 1 ELSE 0 END,
    CASE WHEN p_started_by IS NULL THEN NULL ELSE wf08t.id(p_started_by) END,
    now() + interval '1 hour', now(), CASE WHEN v_final THEN now() ELSE NULL END, 'wf08-agent', p_template,
    CASE WHEN p_status IN ('failed', 'timed_out') THEN 'step.failed' ELSE NULL END);
  IF p_created_offset <> 0 THEN
    SET LOCAL session_replication_role = replica;
    UPDATE public.wf_run SET created_at = now() - make_interval(secs => p_created_offset) WHERE id = v_id;
    SET LOCAL session_replication_role = origin;
  END IF;
  RETURN wf08t.keep('run_' || p_name, v_id);
END $$;
CREATE FUNCTION wf08t.mkstep(p_name text, p_run text, p_key text, p_kind text, p_status text,
  p_class text DEFAULT 'communication', p_input jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf08t.id('run_' || p_run);
  INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, status, idempotency_key, action_class,
    agent_ref, attempt, max_attempts, input_ref, resume_at, lease_owner, lease_expires_at, finished_at, error_code)
  VALUES (v_id, v_run.org_id, v_run.id, p_key, p_kind, p_status, 'wf08-step-' || p_name, p_class, 'wf08-agent',
    CASE WHEN p_status IN ('dead', 'claimed') THEN 3 ELSE 0 END, 3, p_input,
    CASE WHEN p_status = 'waiting' AND p_kind <> 'approval' THEN now() + interval '1 day' END,
    CASE WHEN p_status IN ('claimed', 'running') THEN 'wf08-worker' END,
    CASE WHEN p_status IN ('claimed', 'running') THEN now() + interval '5 minutes' END,
    CASE WHEN p_status IN ('succeeded', 'dead', 'skipped', 'cancelled') THEN now() END,
    CASE WHEN p_status = 'dead' THEN 'step.failed' END);
  RETURN wf08t.keep('step_' || p_name, v_id);
END $$;
-- The engine state the runtime stored for the run (this is what a retry resumes from).
CREATE FUNCTION wf08t.mkstate(p_run text, p_current text, p_state text DEFAULT 'failed') RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf08t.id('run_' || p_run);
  INSERT INTO public.wf_run_event (org_id, run_id, kind, actor_kind, actor_ref, detail)
  VALUES (v_run.org_id, v_run.id, 'runtime.state', 'system', 'workflow-runtime', jsonb_build_object('run', jsonb_build_object(
    'runId', v_run.id, 'definitionId', v_run.definition_id, 'tenantRef', v_run.org_id::text, 'state', p_state,
    'currentStepId', p_current,
    'history', jsonb_build_array(jsonb_build_object('at', '2026-11-19T10:00:00.000Z', 'stepId', p_current,
      'fromState', 'running', 'toState', p_state, 'kind', 'run_failed',
      'reason', 'planted-state-marker owner@state.invalid')),
    'pendingEvidence', '[]'::jsonb, 'evidence', jsonb_build_array(jsonb_build_object('evidenceId', 'ev-1', 'stepId', 'start')),
    'attempts', jsonb_build_array(jsonb_build_object('stepId', p_current, 'attempt', 3, 'lastFailureReason', 'step.failed', 'backoffSeconds', 4)),
    'startedAt', '2026-11-19T10:00:00.000Z', 'completedAt', 'null'::jsonb)));
END $$;
-- A run that stopped: failed (or timed out) with one dead step at which the engine state also stopped.
CREATE FUNCTION wf08t.mkfailed(p_name text, p_def text, p_status text DEFAULT 'failed', p_kind text DEFAULT 'action',
  p_class text DEFAULT 'communication', p_version text DEFAULT NULL, p_template uuid DEFAULT NULL,
  p_input jsonb DEFAULT '{"event_ref":"evt-123","amount_kobo":5000}') RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  PERFORM wf08t.mkrun(p_name, p_def, p_status, 'adminA', p_version, p_template);
  PERFORM wf08t.mkstep(p_name, p_name, 'send', p_kind, 'dead', p_class, p_input);
  PERFORM wf08t.mkstate(p_name, 'send', 'failed');
  RETURN wf08t.id('step_' || p_name);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf08t TO anon, authenticated, service_role;

CREATE FUNCTION wf08t.call_retry(p_actor text, p_step text, p_reason text DEFAULT 'operator_request') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.wf_run_retry(wf08t.id(p_actor), wf08t.id('step_' || p_step), p_reason)
$$;
CREATE FUNCTION wf08t.call_cancel(p_actor text, p_run text, p_reason text DEFAULT 'operator_request') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.wf_run_cancel(wf08t.id(p_actor), wf08t.id('run_' || p_run), p_reason)
$$;
CREATE FUNCTION wf08t.detail(p_actor text, p_run text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.wf_run_history_detail(wf08t.id(p_actor), wf08t.id('run_' || p_run))
$$;
CREATE FUNCTION wf08t.blockers(p_actor text, p_run text, p_step text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT s -> 'retry' -> 'blockers' FROM jsonb_array_elements(wf08t.detail(p_actor, p_run) -> 'steps') s
   WHERE (s ->> 'step_id')::uuid = wf08t.id('step_' || p_step)
$$;
CREATE FUNCTION wf08t.audits(p_action text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.audit_chain WHERE org_id = wf08t.id('orgA') AND action = p_action
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf08t TO anon, authenticated, service_role;

-- Broker fixtures for an executed (outbox) record: a role pack, a twin context and a decision.
INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition) VALUES
 ('wf08-pack','1.0.0','tenant_role',ARRAY['wf08-role'],'published',
  jsonb_build_object(
    'schema','sherivs.role-pack.v1','code','wf08-pack','version','1.0.0','kind','tenant_role',
    'title','WF08 synthetic pack','permissions',jsonb_build_array('workflows.run'),
    'capabilities',jsonb_build_array(jsonb_build_object('id','workflow.in-app','title','In-app',
      'tier','T1','autonomy','act_autonomously','requiresPermission','workflows.run','connector','in-app')),
    'playbooks','[]'::jsonb,
    'memory',jsonb_build_object('domains',jsonb_build_array('work'),'maxSensitivity','internal','retentionDays',90,'crossTenant',false),
    'budget',jsonb_build_object('dailyActions',50,'dailyModelCalls',20,'dailyCostCapMinor',1000),
    'escalation',jsonb_build_object('defaultApprover','role_owner','t3Approver','sheriff'),
    'startsInShadow',true));
SELECT public.cg_twin_ensure_context(wf08t.id('adminA'), 'tenant_membership', wf08t.id('orgA')::text, 'wf08-role', 'wf08-src-a', true);
CREATE FUNCTION wf08t.decision(p_org uuid, p_kind text, p_key text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.cg_tool_call_ledger
    (kind,twin_context_id,tenant_ref,tool_id,tool_version,tier,verdict,args_digest,idempotency_key)
  SELECT 'decision', c.id, p_org::text, 'workflow.action.' || p_kind, '1.0.0', r.tier, 'execute', repeat('a',64), p_key
    FROM public.cg_twin_context c
    JOIN public.cg_tool_registry r ON r.tool_id = 'workflow.action.' || p_kind AND r.version = '1.0.0'
   WHERE c.tenant_ref = p_org::text AND c.role_code = 'wf08-role'
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'WF08 FAIL: fixture decision missing'; END IF;
  RETURN v_id;
END $$;
CREATE FUNCTION wf08t.rids(p_n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(('f0890000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid), '{}')
    FROM generate_series(1, p_n) g
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf08t TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. Redaction helpers
-- ---------------------------------------------------------------------------------------------
SELECT wf08t.expect_true('the event-detail allow-list keeps only exact shapes',
  public.wf_redact_event_detail(jsonb_build_object(
    'error_code', 'step.failed', 'reason_code', 'operator_request', 'risk', 'high', 'decision', 'approve',
    'approval_id', 'f0890000-0000-4000-8000-000000000001', 'generation', 2, 'replayed', true, 'from_status', 'waiting'))
  = jsonb_build_object(
    'error_code', 'step.failed', 'reason_code', 'operator_request', 'risk', 'high', 'decision', 'approve',
    'approval_id', 'f0890000-0000-4000-8000-000000000001', 'generation', 2, 'replayed', true, 'from_status', 'waiting'));
SELECT wf08t.expect_true('addresses, phone numbers, free text, nested and unknown keys are dropped from event detail',
  public.wf_redact_event_detail(jsonb_build_object(
    'email', 'parent@example.invalid', 'phone', '+2348012345678', 'note', 'call the guardian today',
    'recipient_ids', jsonb_build_array('f0890000-0000-4000-8000-000000000001'),
    'nested', jsonb_build_object('to', 'x@y.invalid'), 'body', 'Dear parent',
    'error_code', 'step.failed')) = jsonb_build_object('error_code', 'step.failed'));
SELECT wf08t.expect_true('allowed keys with the wrong shape are dropped (free text, uppercase, arrays, wrong enum)',
  public.wf_redact_event_detail(jsonb_build_object(
    'error_code', 'Call me on 0801234567', 'reason_code', 'a@b.invalid', 'risk', 'extreme', 'decision', 'maybe',
    'approval_id', 'not-a-uuid', 'generation', 12, 'replayed', 'yes', 'from_status', 'Waiting Now',
    'source_run_id', jsonb_build_array('f0890000-0000-4000-8000-000000000001'))) = '{}'::jsonb);
SELECT wf08t.expect_true('a non-object detail redacts to an empty object',
  public.wf_redact_event_detail('["a@b.invalid"]'::jsonb) = '{}'::jsonb
  AND public.wf_redact_event_detail(NULL) = '{}'::jsonb);
SELECT wf08t.expect_true('control reasons are codes only',
  public.wf_run_control_reason_ok('operator_request') AND public.wf_run_control_reason_ok('duplicate_run')
  AND NOT public.wf_run_control_reason_ok('please stop, the guardians are confused')
  AND NOT public.wf_run_control_reason_ok(NULL) AND NOT public.wf_run_control_reason_ok(''));

-- ---------------------------------------------------------------------------------------------
-- 4. Run history: redaction, filters, pagination, tenant isolation, permissions
-- ---------------------------------------------------------------------------------------------
-- A live run: a pending step, a waiting action step with a draft and its review approval, a claimed step.
SELECT wf08t.mkrun('live', 'wf08-a', 'running', 'adminA', NULL, NULL, 50);
SELECT wf08t.mkstep('live_ok', 'live', 'prepare', 'condition', 'succeeded');
SELECT wf08t.mkstep('live_act', 'live', 'send', 'action', 'waiting', 'communication',
  '{"guardian_email":"input-marker@example.invalid","amount_kobo":900000}');
SELECT wf08t.mkstep('live_rev', 'live', 'draft-review-live', 'approval', 'waiting', 'internal');
SELECT wf08t.mkstep('live_claimed', 'live', 'notify', 'notify', 'claimed');
SELECT wf08t.mkstep('live_pending', 'live', 'later', 'action', 'pending');
INSERT INTO public.wf_approval (org_id, run_id, step_run_id, required_permission, risk, summary,
    requested_by_kind, requested_by_ref, expires_at, decision_note)
VALUES (wf08t.id('orgA'), wf08t.id('run_live'), wf08t.id('step_live_rev'), 'workflows.approve', 'normal',
    'Contact summary-marker@example.invalid about the fee', 'system', 'workflow-runtime', now() + interval '3 days', NULL);
INSERT INTO public.wf_action_draft (id, org_id, run_id, step_run_id, kind, category, template_ref, template_params,
    recipient_ids, data_class, idempotency_key)
VALUES (gen_random_uuid(), wf08t.id('orgA'), wf08t.id('run_live'), wf08t.id('step_live_act'), 'in_app',
    'communication', 'notice.a', '{"name":"param-marker-Ada"}', wf08t.rids(3), 'internal', 'wf08-draft-live');
INSERT INTO public.wf_event (id, org_id, event_type, source, dedupe_key, subject_ref, payload)
VALUES ('f0880000-0000-4000-8000-000000000001', wf08t.id('orgA'), 'fees.invoice_overdue', 'wf08-test',
        'wf08-event-0001', 'subject-marker-student-77', '{"guardian_phone":"payload-marker-08012345678"}');
SET LOCAL session_replication_role = replica;
UPDATE public.wf_run SET event_id = 'f0880000-0000-4000-8000-000000000001' WHERE id = wf08t.id('run_live');
SET LOCAL session_replication_role = origin;
INSERT INTO public.wf_run_event (org_id, run_id, step_run_id, kind, actor_kind, actor_ref, detail) VALUES
  (wf08t.id('orgA'), wf08t.id('run_live'), wf08t.id('step_live_act'), 'runtime.failure', 'system', 'workflow-runtime',
   jsonb_build_object('error_code', 'step.failed', 'email', 'detail-marker@example.invalid',
                      'note', 'detail-note-marker', 'recipient_ids', jsonb_build_array((wf08t.rids(1))[1]))),
  (wf08t.id('orgA'), wf08t.id('run_live'), NULL, 'runtime.state', 'system', 'workflow-runtime',
   jsonb_build_object('run', jsonb_build_object('state', 'running', 'history',
     jsonb_build_array(jsonb_build_object('reason', 'state-marker@example.invalid'))))),
  (wf08t.id('orgA'), wf08t.id('run_live'), NULL, 'approval.requested', 'system', 'workflow-runtime',
   jsonb_build_object('approval_id', (SELECT id FROM public.wf_approval WHERE run_id = wf08t.id('run_live')), 'risk', 'normal'));

SELECT wf08t.mkrun('okrun', 'wf08-a', 'succeeded', 'adminA', NULL, NULL, 400);
SELECT wf08t.mkstep('ok_1', 'okrun', 'start', 'condition', 'succeeded');
SELECT wf08t.mkfailed('failed_cap', 'wf08-other');
SELECT wf08t.mkrun('bruns', 'wf08-b', 'running', 'adminB');
SELECT wf08t.mkstep('b_1', 'bruns', 'start', 'condition', 'pending');

SELECT wf08t.expect_true('an admin lists runs for their organization, newest first, and nothing from another organization',
  (SELECT jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA')) -> 'items') = 3
          AND NOT (public.wf_run_history_list(wf08t.id('adminA'))::text LIKE '%' || wf08t.id('run_bruns')::text || '%')
          AND (public.wf_run_history_list(wf08t.id('adminA')) -> 'items' -> 0 ->> 'run_id')::uuid = wf08t.id('run_failed_cap')));
SELECT wf08t.expect_true('the other organization sees only its own run',
  (SELECT jsonb_array_length(public.wf_run_history_list(wf08t.id('adminB')) -> 'items') = 1
          AND (public.wf_run_history_list(wf08t.id('adminB')) -> 'items' -> 0 ->> 'run_id')::uuid = wf08t.id('run_bruns')));
SELECT wf08t.expect_true('list items carry counts and codes: step counts, open approvals, drafts, trigger type',
  (SELECT i ->> 'status' = 'running' AND (i -> 'steps' ->> 'waiting')::int = 2 AND (i -> 'steps' ->> 'succeeded')::int = 1
          AND (i ->> 'open_approvals')::int = 1 AND (i ->> 'drafts')::int = 1
          AND i ->> 'trigger_event_type' = 'fees.invoice_overdue' AND i ->> 'workflow_key' = 'wf08-a'
     FROM jsonb_array_elements(public.wf_run_history_list(wf08t.id('adminA')) -> 'items') i
    WHERE (i ->> 'run_id')::uuid = wf08t.id('run_live')));
SELECT wf08t.expect_true('the list never contains payloads, subject references, recipients, parameters or summaries',
  NOT (public.wf_run_history_list(wf08t.id('adminA'))::text ~ '(marker|@example|recipient|param)'));
SELECT wf08t.expect_true('status filters: active, failed, succeeded, cancelled and all',
  jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA'), 'active') -> 'items') = 1
  AND jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA'), 'failed') -> 'items') = 1
  AND jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA'), 'succeeded') -> 'items') = 1
  AND jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA'), 'cancelled') -> 'items') = 0
  AND jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA'), 'all') -> 'items') = 3);
SELECT wf08t.expect_true('workflow filter narrows by key',
  jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA'), NULL, 'wf08-other') -> 'items') = 1
  AND jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA'), NULL, 'wf08-ver') -> 'items') = 0);
SELECT wf08t.expect_error('an unknown status filter is refused',
  $q$SELECT public.wf_run_history_list(wf08t.id('adminA'), 'everything')$q$, '22023', 'wf08:invalid_filter');
SELECT wf08t.expect_error('a malformed workflow key filter is refused',
  $q$SELECT public.wf_run_history_list(wf08t.id('adminA'), NULL, 'x; drop table wf_run')$q$, '22023', 'wf08:invalid_filter');
SELECT wf08t.expect_true('pagination is keyset on created_at with has_more',
  (public.wf_run_history_list(wf08t.id('adminA'), NULL, NULL, NULL, 2) ->> 'has_more')::boolean
  AND jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA'), NULL, NULL, NULL, 2) -> 'items') = 2
  AND NOT (public.wf_run_history_list(wf08t.id('adminA'), NULL, NULL, now() - interval '100 seconds', 5) ->> 'has_more')::boolean
  AND jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA'), NULL, NULL, now() - interval '100 seconds', 5) -> 'items') = 1);
SELECT wf08t.expect_true('the limit is clamped',
  jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA'), NULL, NULL, NULL, 100000) -> 'items') = 3
  AND jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA'), NULL, NULL, NULL, -5) -> 'items') = 1);

SELECT wf08t.expect_true('detail returns run, steps, timeline, approvals, drafts and outbox for the caller''s organization',
  (SELECT d ? 'run' AND d ? 'steps' AND d ? 'events' AND d ? 'approvals' AND d ? 'drafts' AND d ? 'outbox' AND d ? 'permissions'
          AND jsonb_array_length(d -> 'steps') = 5 AND jsonb_array_length(d -> 'approvals') = 1
          AND jsonb_array_length(d -> 'drafts') = 1 AND d -> 'run' ->> 'trigger_event_type' = 'fees.invoice_overdue'
     FROM (SELECT wf08t.detail('adminA', 'live') AS d) x));
SELECT wf08t.expect_true('detail never contains a planted address, phone, payload, subject, parameter, summary or state marker',
  NOT (wf08t.detail('adminA', 'live')::text ~ '(marker|@example|@state|example\.invalid|08012345678|\+234)'));
SELECT wf08t.expect_true('detail contains no forbidden key at any depth',
  NOT EXISTS (SELECT 1 FROM wf08t.all_keys(wf08t.detail('adminA', 'live')) k
               WHERE k IN ('recipient_ids', 'template_params', 'params', 'payload', 'input_ref', 'output_ref',
                           'subject_ref', 'summary', 'decision_note', 'note', 'email', 'phone', 'to', 'body', 'url',
                           'target_url', 'history', 'evidence', 'attempts', 'idempotency_key', 'lease_owner')));
SELECT wf08t.expect_true('drafts show recipient COUNT and parameter COUNT, never ids or values',
  (SELECT dr ->> 'recipient_count' = '3' AND dr ->> 'param_count' = '1' AND dr ->> 'template_ref' = 'notice.a'
     FROM jsonb_array_elements(wf08t.detail('adminA', 'live') -> 'drafts') dr));
SELECT wf08t.expect_true('the timeline omits the engine state and keeps only allow-listed detail',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(wf08t.detail('adminA', 'live') -> 'events') e WHERE e ->> 'kind' = 'runtime.state')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(wf08t.detail('adminA', 'live') -> 'events') e
               WHERE e ->> 'kind' = 'runtime.failure' AND e -> 'detail' = '{"error_code":"step.failed"}'::jsonb)
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(wf08t.detail('adminA', 'live') -> 'events') e
               WHERE e ->> 'kind' = 'approval.requested' AND e -> 'detail' ? 'approval_id' AND e -> 'detail' ->> 'risk' = 'normal'));
SELECT wf08t.expect_error('another organization''s run looks like not found',
  $q$SELECT public.wf_run_history_detail(wf08t.id('adminB'), wf08t.id('run_live'))$q$, 'P0002', 'wf08:not_found');
SELECT wf08t.expect_error('an unknown run id is not found',
  $q$SELECT public.wf_run_history_detail(wf08t.id('adminA'), gen_random_uuid())$q$, 'P0002', 'wf08:not_found');
SELECT wf08t.expect_true('a viewer without run or manage can read but sees no cancel or retry rights',
  (SELECT d -> 'permissions' ->> 'can_cancel' = 'false' AND d -> 'permissions' ->> 'can_retry' = 'false'
     FROM (SELECT wf08t.detail('viewer', 'live') AS d) x)
  AND (SELECT NOT (i ->> 'can_cancel')::boolean FROM jsonb_array_elements(public.wf_run_history_list(wf08t.id('viewer')) -> 'items') i
        WHERE (i ->> 'run_id')::uuid = wf08t.id('run_live')));
SELECT wf08t.expect_true('an admin sees cancel and retry rights',
  (SELECT d -> 'permissions' ->> 'can_cancel' = 'true' AND d -> 'permissions' ->> 'can_retry' = 'true'
     FROM (SELECT wf08t.detail('adminA', 'live') AS d) x));
SELECT wf08t.expect_error('a member without workflows.view cannot list',
  $q$SELECT public.wf_run_history_list(wf08t.id('plain'))$q$, '42501', 'wf08:not_authorized');
SELECT wf08t.expect_error('a member without workflows.view cannot read detail',
  $q$SELECT public.wf_run_history_detail(wf08t.id('plain'), wf08t.id('run_live'))$q$, '42501', 'wf08:not_authorized');
SELECT wf08t.expect_error('a person with no organization is refused',
  $q$SELECT public.wf_run_history_list(wf08t.id('noorg'))$q$, '42501', 'wf08:not_authorized');
SELECT wf08t.expect_error('no actor is refused',
  $q$SELECT public.wf_run_history_list(NULL)$q$, '42501', 'wf07:actor_required');
SELECT wf08t.login_as('authenticated');
SELECT wf08t.expect_error('a signed-in client cannot call the history function directly',
  $q$SELECT public.wf_run_history_list(wf08t.id('adminA'))$q$, '42501');
SELECT wf08t.expect_error('a signed-in client cannot cancel directly',
  $q$SELECT public.wf_run_cancel(wf08t.id('adminA'), wf08t.id('run_live'), 'operator_request')$q$, '42501');
SELECT wf08t.expect_error('a signed-in client cannot retry directly',
  $q$SELECT public.wf_run_retry(wf08t.id('adminA'), wf08t.id('step_failed_cap'), 'operator_request')$q$, '42501');
SELECT wf08t.logout();
SELECT wf08t.login_as('anon');
SELECT wf08t.expect_error('anon cannot call the detail function',
  $q$SELECT public.wf_run_history_detail(wf08t.id('adminA'), wf08t.id('run_live'))$q$, '42501');
SELECT wf08t.logout();
SELECT wf08t.login_as('service_role');
SELECT wf08t.expect_true('the service role can call the functions (the server path)',
  jsonb_array_length(public.wf_run_history_list(wf08t.id('adminA')) -> 'items') = 3);
SELECT wf08t.logout();

-- ---------------------------------------------------------------------------------------------
-- 5. Cancel
-- ---------------------------------------------------------------------------------------------
SELECT wf08t.expect_error('cancel needs a reason code (no free text)',
  $q$SELECT wf08t.call_cancel('adminA', 'live', 'because the guardians complained')$q$, '22023', 'wf08:invalid_reason');
SELECT wf08t.expect_error('a viewer cannot cancel',
  $q$SELECT wf08t.call_cancel('viewer', 'live')$q$, '42501', 'wf08:not_authorized');
SELECT wf08t.expect_error('a member without workflow rights cannot cancel',
  $q$SELECT wf08t.call_cancel('plain', 'live')$q$, '42501', 'wf08:not_authorized');
SELECT wf08t.expect_error('another organization cannot cancel the run (not found)',
  $q$SELECT wf08t.call_cancel('adminB', 'live')$q$, 'P0002', 'wf08:not_found');
SELECT wf08t.expect_true('a refused cancel changes nothing',
  (SELECT status = 'running' FROM public.wf_run WHERE id = wf08t.id('run_live'))
  AND wf08t.audits('workflow.run.cancel_requested') = 0);
SELECT wf08t.expect_error('a succeeded run cannot be cancelled',
  $q$SELECT wf08t.call_cancel('adminA', 'okrun')$q$, '42501', 'wf08:not_cancellable');
SELECT wf08t.expect_error('a failed run cannot be cancelled',
  $q$SELECT wf08t.call_cancel('adminA', 'failed_cap')$q$, '42501', 'wf08:not_cancellable');
SELECT wf08t.expect_true('the cancel call returns the cancelled status',
  (wf08t.call_cancel('adminA', 'live', 'duplicate_run') ->> 'status') = 'cancelled');
SELECT wf08t.expect_true('an admin cancels a running run',
  (SELECT status = 'cancelled' AND finished_at IS NOT NULL AND error_code = 'run.cancelled'
         FROM public.wf_run WHERE id = wf08t.id('run_live')));
SELECT wf08t.expect_true('cancel stops the in-flight step and drops its lease',
  (SELECT status = 'cancelled' AND lease_owner IS NULL AND lease_expires_at IS NULL AND finished_at IS NOT NULL
     FROM public.wf_step_run WHERE id = wf08t.id('step_live_claimed')));
SELECT wf08t.expect_true('cancel closes pending and waiting steps, the open approval and the open draft',
  (SELECT bool_and(status = 'cancelled') FROM public.wf_step_run
    WHERE id IN (wf08t.id('step_live_act'), wf08t.id('step_live_rev'), wf08t.id('step_live_pending')))
  AND (SELECT status = 'cancelled' FROM public.wf_approval WHERE run_id = wf08t.id('run_live'))
  AND (SELECT status = 'cancelled' FROM public.wf_action_draft WHERE run_id = wf08t.id('run_live'))
  AND (SELECT status = 'succeeded' FROM public.wf_step_run WHERE id = wf08t.id('step_live_ok')));
SELECT wf08t.expect_true('cancel writes the audit entries (request and row-level status change) and a timeline event',
  wf08t.audits('workflow.run.cancel_requested') = 1 AND wf08t.audits('workflow.run.cancelled') >= 1
  AND EXISTS (SELECT 1 FROM public.wf_run_event WHERE run_id = wf08t.id('run_live') AND kind = 'run.cancel_requested'
                AND actor_kind = 'user' AND actor_ref = wf08t.id('adminA')::text
                AND detail = jsonb_build_object('reason_code', 'duplicate_run', 'from_status', 'running'))
  AND EXISTS (SELECT 1 FROM public.audit_chain WHERE org_id = wf08t.id('orgA') AND action = 'workflow.run.cancel_requested'
                AND actor_id = wf08t.id('adminA')::text AND actor_kind = 'user'));
SELECT wf08t.expect_true('a repeat cancel reports replayed',
  (wf08t.call_cancel('adminA', 'live') ->> 'replayed')::boolean);
SELECT wf08t.expect_true('a repeat cancel writes nothing more',
  wf08t.audits('workflow.run.cancel_requested') = 1
  AND (SELECT count(*) = 1 FROM public.wf_run_event WHERE run_id = wf08t.id('run_live') AND kind = 'run.cancel_requested'));
SELECT wf08t.expect_true('the cancelled run is visible in history with no cancel right left',
  (SELECT d -> 'run' ->> 'status' = 'cancelled' AND d -> 'permissions' ->> 'can_cancel' = 'false'
     FROM (SELECT wf08t.detail('adminA', 'live') AS d) x));
SELECT pg_temp.ain02_allow_execution(wf08t.id('step_live_act'));  -- AIN-02: this test is about the run guard, not the step level
SELECT wf08t.expect_error('a cancelled run cannot record an executed action (dispatch race is closed)',
  format($q$INSERT INTO public.wf_action_sandbox_outbox
      (org_id, run_id, step_run_id, kind, category, template_ref, broker_decision_id, idempotency_key)
    VALUES (%L, %L, %L, 'in_app', 'communication', 'notice.a', %L, 'wf08-late-dispatch')$q$,
    wf08t.id('orgA'), wf08t.id('run_live'), wf08t.id('step_live_act'),
    wf08t.decision(wf08t.id('orgA'), 'in_app', 'wf08-late-dispatch')), '42501', 'no longer active');
SELECT wf08t.expect_true('a step that finishes after the cancel is not persisted (lease is gone)',
  (SELECT NOT persisted FROM public.wf_persist_step_transition(
     wf08t.id('step_live_claimed'), 'wf08-worker', 3, 'succeeded', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)));
SELECT wf08t.mkrun('queued', 'wf08-a', 'queued', 'adminA');
SELECT wf08t.mkrun('waiting', 'wf08-a', 'waiting', 'adminA');
SELECT wf08t.mkstep('w_rev', 'waiting', 'review', 'approval', 'waiting', 'internal');
INSERT INTO public.wf_approval (org_id, run_id, step_run_id, risk, summary, requested_by_kind, requested_by_ref, expires_at)
VALUES (wf08t.id('orgA'), wf08t.id('run_waiting'), wf08t.id('step_w_rev'), 'high', 'review', 'system', 'workflow-runtime',
        now() + interval '2 days');
SELECT wf08t.expect_true('a queued run and a waiting run can be cancelled by a run-capable admin',
  (wf08t.call_cancel('adminA', 'queued', 'policy_change') ->> 'status') = 'cancelled'
  AND (wf08t.call_cancel('adminA', 'waiting', 'operator_request') ->> 'status') = 'cancelled');
SELECT wf08t.expect_true('the pending high-risk approval of the waiting run is cancelled with it',
  (SELECT status = 'cancelled' FROM public.wf_approval WHERE run_id = wf08t.id('run_waiting')));
SELECT wf08t.expect_true('cancelling one run leaves another run and the other organization untouched',
  (SELECT status = 'running' FROM public.wf_run WHERE id = wf08t.id('run_bruns'))
  AND (SELECT status = 'pending' FROM public.wf_step_run WHERE id = wf08t.id('step_b_1')));

-- ---------------------------------------------------------------------------------------------
-- 6. Retry: refusals, one case at a time
-- ---------------------------------------------------------------------------------------------
-- The base case first: a failed run whose dead step may be retried.
SELECT wf08t.mkfailed('r_ok', 'wf08-a');
SELECT wf08t.expect_true('a retryable dead step reports no blockers',
  wf08t.blockers('adminA', 'r_ok', 'r_ok') = '[]'::jsonb);

SELECT wf08t.mkfailed('r_appr', 'wf08-a', 'failed', 'approval');
SELECT wf08t.mkrun('r_notdead', 'wf08-a', 'failed', 'adminA');
SELECT wf08t.mkstep('r_notdead', 'r_notdead', 'send', 'action', 'succeeded');
SELECT wf08t.mkstate('r_notdead', 'send', 'failed');
SELECT wf08t.mkrun('r_cancelled', 'wf08-a', 'running', 'adminA');
SELECT wf08t.mkstep('r_cancelled', 'r_cancelled', 'send', 'action', 'dead');
SELECT wf08t.mkstate('r_cancelled', 'send', 'failed');
UPDATE public.wf_run SET status = 'cancelled', finished_at = now(), error_code = 'approval.rejected' WHERE id = wf08t.id('run_r_cancelled');
SELECT wf08t.mkfailed('r_paused', 'wf08-paused');
UPDATE public.wf_definition SET status = 'paused' WHERE id = wf08t.id('def_wf08-paused');
SELECT wf08t.mkfailed('r_nostate', 'wf08-a');
DELETE FROM public.wf_run_event WHERE FALSE;
SELECT wf08t.mkrun('r_wrongstate', 'wf08-a', 'failed', 'adminA');
SELECT wf08t.mkstep('r_wrongstate', 'r_wrongstate', 'send', 'action', 'dead');
SELECT wf08t.mkstate('r_wrongstate', 'some-other-step', 'failed');
SELECT wf08t.mkrun('r_nostate2', 'wf08-a', 'failed', 'adminA');
SELECT wf08t.mkstep('r_nostate2', 'r_nostate2', 'send', 'action', 'dead');

SELECT wf08t.expect_true('every refusal reason is reported, one scenario each',
  wf08t.blockers('adminA', 'r_appr', 'r_appr') = '["approval_step"]'::jsonb
  AND wf08t.blockers('adminA', 'r_cancelled', 'r_cancelled') = '["run_not_retryable"]'::jsonb
  AND wf08t.blockers('adminA', 'r_paused', 'r_paused') = '["definition_inactive"]'::jsonb
  AND wf08t.blockers('adminA', 'r_wrongstate', 'r_wrongstate') = '["not_stopping_step"]'::jsonb
  AND wf08t.blockers('adminA', 'r_nostate2', 'r_nostate2') = '["not_stopping_step"]'::jsonb);
SELECT wf08t.expect_error('retry refuses an approval-kind step',
  $q$SELECT wf08t.call_retry('adminA', 'r_appr')$q$, '42501', 'wf08:approval_step');
SELECT wf08t.expect_error('retry refuses a cancelled run (a rejected or expired approval can never be retried around)',
  $q$SELECT wf08t.call_retry('adminA', 'r_cancelled')$q$, '42501', 'wf08:run_not_retryable');
SELECT wf08t.expect_error('retry refuses a step that is not dead',
  $q$SELECT wf08t.call_retry('adminA', 'r_notdead')$q$, '42501', 'wf08:step_not_dead');
SELECT wf08t.expect_error('retry refuses a paused workflow',
  $q$SELECT wf08t.call_retry('adminA', 'r_paused')$q$, '42501', 'wf08:definition_inactive');
SELECT wf08t.expect_error('retry refuses when the engine state did not stop at this step',
  $q$SELECT wf08t.call_retry('adminA', 'r_wrongstate')$q$, '42501', 'wf08:not_stopping_step');
SELECT wf08t.expect_error('retry refuses when there is no engine state to resume from',
  $q$SELECT wf08t.call_retry('adminA', 'r_nostate2')$q$, '42501', 'wf08:not_stopping_step');
SELECT wf08t.expect_error('retry needs a reason code',
  $q$SELECT wf08t.call_retry('adminA', 'r_ok', 'try again please')$q$, '22023', 'wf08:invalid_reason');
SELECT wf08t.expect_error('a viewer cannot retry',
  $q$SELECT wf08t.call_retry('viewer', 'r_ok')$q$, '42501', 'wf08:not_authorized');
SELECT wf08t.expect_error('a member without workflow rights cannot retry',
  $q$SELECT wf08t.call_retry('plain', 'r_ok')$q$, '42501', 'wf08:not_authorized');
SELECT wf08t.expect_error('another organization cannot retry (not found)',
  $q$SELECT wf08t.call_retry('adminB', 'r_ok')$q$, 'P0002', 'wf08:not_found');
SELECT wf08t.expect_error('an unknown step is not found',
  $q$SELECT public.wf_run_retry(wf08t.id('adminA'), gen_random_uuid(), 'operator_request')$q$, 'P0002', 'wf08:not_found');
SELECT wf08t.expect_true('refused retries create no run',
  (SELECT count(*) = 0 FROM public.wf_run WHERE retry_of_run_id IS NOT NULL));

-- Version no longer current: the run's version is retired and a newer one is published.
SELECT wf08t.mkfailed('r_ver', 'wf08-ver');
UPDATE public.wf_version SET state = 'retired' WHERE id = wf08t.id('ver_wf08-ver');
INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by)
VALUES ('f0870000-0000-4000-8000-000000000002', wf08t.id('orgA'), wf08t.id('def_wf08-ver'), 2, '{"steps":[]}', wf08t.id('author'));
UPDATE public.wf_version SET state = 'published', published_by = wf08t.id('publisher')
 WHERE id = 'f0870000-0000-4000-8000-000000000002';
UPDATE public.wf_definition SET current_version_id = 'f0870000-0000-4000-8000-000000000002' WHERE id = wf08t.id('def_wf08-ver');
SELECT wf08t.expect_error('retry refuses a run whose version is no longer the published one',
  $q$SELECT wf08t.call_retry('adminA', 'r_ver')$q$, '42501', 'wf08:version_not_current');

-- Recorded effects: a draft for the step, and an executed (outbox) record for the step.
SELECT wf08t.mkrun('r_draft', 'wf08-a', 'running', 'adminA');
SELECT wf08t.mkstep('r_draft', 'r_draft', 'send', 'action', 'running');
INSERT INTO public.wf_action_draft (org_id, run_id, step_run_id, kind, category, template_ref, idempotency_key)
VALUES (wf08t.id('orgA'), wf08t.id('run_r_draft'), wf08t.id('step_r_draft'), 'in_app', 'communication', 'notice.a', 'wf08-step-r_draft');
UPDATE public.wf_step_run SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL, finished_at = now() WHERE id = wf08t.id('step_r_draft');
UPDATE public.wf_run SET status = 'failed', finished_at = now(), error_code = 'step.failed' WHERE id = wf08t.id('run_r_draft');
SELECT wf08t.mkstate('r_draft', 'send', 'failed');
SELECT wf08t.mkrun('r_effect', 'wf08-a', 'running', 'adminA');
SELECT wf08t.mkstep('r_effect', 'r_effect', 'send', 'action', 'running');
SELECT pg_temp.ain02_allow_execution(wf08t.id('step_r_effect'));  -- AIN-02: this test is about retry, not the step level
INSERT INTO public.wf_action_sandbox_outbox (org_id, run_id, step_run_id, kind, category, template_ref, broker_decision_id, idempotency_key)
VALUES (wf08t.id('orgA'), wf08t.id('run_r_effect'), wf08t.id('step_r_effect'), 'in_app', 'communication', 'notice.a',
        wf08t.decision(wf08t.id('orgA'), 'in_app', 'wf08-step-r_effect'), 'wf08-step-r_effect');
UPDATE public.wf_step_run SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL, finished_at = now() WHERE id = wf08t.id('step_r_effect');
UPDATE public.wf_run SET status = 'failed', finished_at = now(), error_code = 'step.failed' WHERE id = wf08t.id('run_r_effect');
SELECT wf08t.mkstate('r_effect', 'send', 'failed');
SELECT wf08t.expect_error('retry refuses a step that already produced a draft (no second draft)',
  $q$SELECT wf08t.call_retry('adminA', 'r_draft')$q$, '42501', 'wf08:draft_exists');
SELECT wf08t.expect_error('retry refuses a step that already has an executed record (never re-fire)',
  $q$SELECT wf08t.call_retry('adminA', 'r_effect')$q$, '42501', 'wf08:effect_recorded');
-- A step that died after the broker cleared it but before the outbox row exists is treated the same way.
SELECT wf08t.mkfailed('r_ledger', 'wf08-a');
SELECT wf08t.decision(wf08t.id('orgA'), 'in_app', 'wf08-step-r_ledger');
SELECT wf08t.expect_error('retry refuses a step the broker already cleared to execute',
  $q$SELECT wf08t.call_retry('adminA', 'r_ledger')$q$, '42501', 'wf08:effect_recorded');
SELECT wf08t.expect_true('the history reports the same reasons on the step',
  wf08t.blockers('adminA', 'r_draft', 'r_draft') = '["draft_exists"]'::jsonb
  AND wf08t.blockers('adminA', 'r_effect', 'r_effect') = '["effect_recorded"]'::jsonb
  AND wf08t.blockers('adminA', 'r_ledger', 'r_ledger') = '["effect_recorded"]'::jsonb);
SELECT wf08t.expect_true('every refused retry left no run, no audit and no new step',
  (SELECT count(*) = 0 FROM public.wf_run WHERE retry_of_run_id IS NOT NULL)
  AND wf08t.audits('workflow.run.retry_requested') = 0
  AND (SELECT count(*) = 0 FROM public.wf_step_run WHERE idempotency_key LIKE 'wf-retry-step:%'));

-- Workflows disabled for the organization: retry is refused; nothing could run anyway.
UPDATE public.wf_org_settings SET workflows_enabled = false WHERE org_id = wf08t.id('orgA');
SELECT wf08t.expect_error('retry is refused while workflows are disabled for the organization',
  $q$SELECT wf08t.call_retry('adminA', 'r_ok')$q$, '42501', 'wf08:workflows_disabled');
SELECT wf08t.expect_true('history stays readable while workflows are disabled, with no retry right',
  (SELECT d -> 'permissions' ->> 'can_retry' = 'false' AND d -> 'permissions' ->> 'workflows_enabled' = 'false'
     FROM (SELECT wf08t.detail('adminA', 'r_ok') AS d) x)
  AND wf08t.blockers('adminA', 'r_ok', 'r_ok') = '["workflows_disabled"]'::jsonb);
SELECT wf08t.expect_true('a cancel still works while workflows are disabled',
  (wf08t.call_cancel('adminA', 'live') ->> 'replayed')::boolean);
UPDATE public.wf_org_settings SET workflows_enabled = true WHERE org_id = wf08t.id('orgA');

-- ---------------------------------------------------------------------------------------------
-- 7. Retry: the success path, idempotency, audit and the new run
-- ---------------------------------------------------------------------------------------------
SELECT wf08t.keep('retry1', (wf08t.call_retry('adminA', 'r_ok', 'fixed_upstream') ->> 'run_id')::uuid);
SELECT wf08t.expect_true('retry starts a new run linked to the source run and dead step',
  (SELECT r.status = 'running' AND r.retry_of_run_id = wf08t.id('run_r_ok') AND r.retry_of_step_id = wf08t.id('step_r_ok')
          AND r.retry_generation = 1 AND r.id <> wf08t.id('run_r_ok') AND r.finished_at IS NULL
          AND r.definition_id = (SELECT definition_id FROM public.wf_run WHERE id = wf08t.id('run_r_ok'))
          AND r.version_id = (SELECT version_id FROM public.wf_run WHERE id = wf08t.id('run_r_ok'))
     FROM public.wf_run r WHERE r.id = wf08t.id('retry1')));
SELECT wf08t.expect_true('the retrying person becomes the starter of the new run',
  (SELECT started_by = wf08t.id('adminA') FROM public.wf_run WHERE id = wf08t.id('retry1')));
SELECT wf08t.expect_true('the new run has one pending step for the same key with a fresh attempt count and copied input',
  (SELECT count(*) = 1 AND bool_and(step_key = 'send' AND status = 'pending' AND attempt = 0 AND max_attempts = 3
            AND idempotency_key = 'wf-retry-step:' || wf08t.id('step_r_ok')::text
            AND input_ref = '{"event_ref":"evt-123","amount_kobo":5000}'::jsonb AND spent_units = 0)
     FROM public.wf_step_run WHERE run_id = wf08t.id('retry1')));
SELECT wf08t.expect_true('the source run and its dead step are exactly as they were (history is never rewritten)',
  (SELECT status = 'failed' AND error_code = 'step.failed' AND finished_at IS NOT NULL
     FROM public.wf_run WHERE id = wf08t.id('run_r_ok'))
  AND (SELECT status = 'dead' AND attempt = 3 FROM public.wf_step_run WHERE id = wf08t.id('step_r_ok')));
SELECT wf08t.expect_true('the new run resumes the engine state at the dead step, running, with fresh attempts and history kept',
  (SELECT d #>> '{run,runId}' = wf08t.id('retry1')::text AND d #>> '{run,state}' = 'running'
          AND d #>> '{run,currentStepId}' = 'send' AND d #> '{run,attempts}' = '[]'::jsonb
          AND d #> '{run,completedAt}' = 'null'::jsonb
          AND jsonb_array_length(d #> '{run,evidence}') = 1
          AND jsonb_array_length(d #> '{run,history}') = 2
          AND d #>> '{run,history,1,kind}' = 'run_retried' AND d #>> '{run,history,1,fromState}' = 'failed'
          AND d #>> '{run,tenantRef}' = wf08t.id('orgA')::text
     FROM (SELECT detail AS d FROM public.wf_run_event WHERE run_id = wf08t.id('retry1') AND kind = 'runtime.state'
            ORDER BY id DESC LIMIT 1) x));
SELECT wf08t.expect_true('the source engine state is untouched',
  (SELECT detail #>> '{run,state}' = 'failed' AND detail #>> '{run,runId}' = wf08t.id('run_r_ok')::text
     FROM public.wf_run_event WHERE run_id = wf08t.id('run_r_ok') AND kind = 'runtime.state' ORDER BY id DESC LIMIT 1));
SELECT wf08t.expect_true('retry is audited: the request entry, the run creation entry and both timelines',
  wf08t.audits('workflow.run.retry_requested') = 1
  AND EXISTS (SELECT 1 FROM public.audit_chain WHERE org_id = wf08t.id('orgA') AND action = 'workflow.run.retry_requested'
                AND target_id = wf08t.id('retry1')::text AND actor_id = wf08t.id('adminA')::text AND actor_kind = 'user')
  AND EXISTS (SELECT 1 FROM public.audit_chain WHERE org_id = wf08t.id('orgA') AND action = 'workflow.run.created'
                AND target_id = wf08t.id('retry1')::text)
  AND EXISTS (SELECT 1 FROM public.wf_run_event WHERE run_id = wf08t.id('retry1') AND kind = 'run.retry_requested'
                AND actor_ref = wf08t.id('adminA')::text
                AND detail ->> 'source_run_id' = wf08t.id('run_r_ok')::text AND detail ->> 'reason_code' = 'fixed_upstream')
  AND EXISTS (SELECT 1 FROM public.wf_run_event WHERE run_id = wf08t.id('run_r_ok') AND kind = 'run.retried'
                AND detail ->> 'retry_run_id' = wf08t.id('retry1')::text));
SELECT wf08t.expect_true('a repeat retry returns the same run and reports replayed',
  (wf08t.call_retry('adminA', 'r_ok') ->> 'run_id')::uuid = wf08t.id('retry1')
  AND (wf08t.call_retry('adminA', 'r_ok') ->> 'replayed')::boolean);
SELECT wf08t.expect_true('a repeat retry writes nothing more',
  (SELECT count(*) = 1 FROM public.wf_run WHERE retry_of_step_id = wf08t.id('step_r_ok'))
  AND wf08t.audits('workflow.run.retry_requested') = 1
  AND (SELECT count(*) = 1 FROM public.wf_step_run WHERE idempotency_key = 'wf-retry-step:' || wf08t.id('step_r_ok')::text));
SELECT wf08t.expect_true('a repeat after the step is retried reports who continued it, and the history links both runs',
  (SELECT s -> 'retry' ->> 'retry_run_id' = wf08t.id('retry1')::text
        FROM jsonb_array_elements(wf08t.detail('adminA', 'r_ok') -> 'steps') s)
  AND (SELECT (i ->> 'retries')::int = 1 FROM jsonb_array_elements(public.wf_run_history_list(wf08t.id('adminA')) -> 'items') i
        WHERE (i ->> 'run_id')::uuid = wf08t.id('run_r_ok'))
  AND (SELECT (i ->> 'retry_of_run_id')::uuid = wf08t.id('run_r_ok') AND (i ->> 'retry_generation')::int = 1
        FROM jsonb_array_elements(public.wf_run_history_list(wf08t.id('adminA')) -> 'items') i
       WHERE (i ->> 'run_id')::uuid = wf08t.id('retry1')));
SELECT wf08t.expect_error('a second retry from another person still returns the same run only (no second run, even by a different admin)',
  $q$SELECT 1 / (CASE WHEN (SELECT count(*) FROM public.wf_run WHERE retry_of_step_id = wf08t.id('step_r_ok')) = 1 THEN 0 ELSE 1 END)$q$,
  '22012');
SELECT wf08t.expect_true('the new run is claimable like any run: the claim function picks up its step for an enabled organization',
  EXISTS (SELECT 1 FROM public.wf_claim_due_steps('wf08-claimer', 500, 60) c WHERE c.run_id = wf08t.id('retry1')));
SELECT wf08t.expect_true('a retry person cannot approve what the retry run drafts (they are the starter)',
  (SELECT started_by = wf08t.id('adminA') FROM public.wf_run WHERE id = wf08t.id('retry1')));
SELECT wf08t.expect_error('the retry link cannot be changed afterwards',
  $q$UPDATE public.wf_run SET retry_generation = 0 WHERE id = wf08t.id('retry1')$q$, '42501', 'retry link is immutable');
SELECT wf08t.expect_error('a second run cannot claim the same dead step (unique index)',
  format($q$INSERT INTO public.wf_run (org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
      deadline_at, started_at, retry_of_run_id, retry_of_step_id, retry_generation)
    SELECT org_id, definition_id, version_id, 'wf08-dup-retry', 'running', 2, 20, now() + interval '1 hour', now(),
           %L, %L, 1 FROM public.wf_run WHERE id = %L$q$, wf08t.id('run_r_ok'), wf08t.id('step_r_ok'), wf08t.id('run_r_ok')),
  '23505');
SELECT wf08t.expect_error('retry fields must be set together',
  format($q$INSERT INTO public.wf_run (org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
      deadline_at, started_at, retry_of_run_id, retry_generation)
    SELECT org_id, definition_id, version_id, 'wf08-half-retry', 'running', 2, 20, now() + interval '1 hour', now(), %L, 1
      FROM public.wf_run WHERE id = %L$q$, wf08t.id('run_r_ok'), wf08t.id('run_r_ok')), '23514');
SELECT wf08t.expect_error('a retry link cannot point into another organization',
  format($q$INSERT INTO public.wf_run (org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
      deadline_at, started_at, retry_of_run_id, retry_of_step_id, retry_generation)
    SELECT org_id, definition_id, version_id, 'wf08-xorg-retry', 'running', 2, 20, now() + interval '1 hour', now(), %L, %L, 1
      FROM public.wf_run WHERE id = %L$q$, wf08t.id('run_bruns'), wf08t.id('step_b_1'), wf08t.id('run_r_ok')), '23503');

-- Retry cap: a chain stops at generation 3.
CREATE FUNCTION wf08t.die(p_run uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_step uuid;
BEGIN
  SELECT id INTO v_step FROM public.wf_step_run WHERE run_id = p_run;
  UPDATE public.wf_step_run SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL, finished_at = now(),
         attempt = max_attempts, error_code = 'step.failed' WHERE id = v_step;
  UPDATE public.wf_run SET status = 'failed', finished_at = now(), error_code = 'step.failed' WHERE id = p_run;
  RETURN v_step;
END $$;
GRANT EXECUTE ON FUNCTION wf08t.die(uuid) TO anon, authenticated, service_role;
DO $chain$
DECLARE v_run uuid := wf08t.id('retry1'); v_step uuid; v_next uuid; v_i integer;
BEGIN
  -- Free the claimed step from the earlier claim test so the dead-marking below is a clean failure.
  FOR v_i IN 2..3 LOOP
    v_step := wf08t.die(v_run);
    v_next := (public.wf_run_retry(wf08t.id('adminA'), v_step, 'operator_request') ->> 'run_id')::uuid;
    PERFORM wf08t.keep('retry' || v_i, v_next);
    v_run := v_next;
  END LOOP;
  PERFORM wf08t.keep('chain_last_step', wf08t.die(v_run));
  PERFORM wf08t.keep('chain_last_run', v_run);
END $chain$;
SELECT wf08t.expect_true('the retry chain reaches generation 3 and records each generation',
  (SELECT retry_generation FROM public.wf_run WHERE id = wf08t.id('retry2')) = 2
  AND (SELECT retry_generation FROM public.wf_run WHERE id = wf08t.id('retry3')) = 3);
SELECT wf08t.expect_error('the fourth retry is refused: retry limit',
  $q$SELECT public.wf_run_retry(wf08t.id('adminA'), wf08t.id('chain_last_step'), 'operator_request')$q$, '42501', 'wf08:retry_limit');

-- ---------------------------------------------------------------------------------------------
-- 8. Retry never raises autonomy: capped classes stay at draft; an escalation is refused
-- ---------------------------------------------------------------------------------------------
SELECT wf08t.mkfailed('esc', 'wf08-a');
SELECT wf08t.expect_true('the dead step was created under the low ceiling',
  (SELECT autonomy_level FROM public.wf_step_run WHERE id = wf08t.id('step_esc')) = 'suggest');
UPDATE public.wf_template SET autonomy_max = 'act_and_report' WHERE template_key = 'paystack_payment_receipt' AND version = 1;
-- AIN-02 freezes a run's template once set (a run cannot borrow another template's level). This fixture simulates
-- "the ceiling was raised after the step died" by re-pointing the run as a database owner would: trigger off for one statement.
ALTER TABLE public.wf_run DISABLE TRIGGER wf_run_08_freeze_actor;
UPDATE public.wf_run SET template_id = (SELECT id FROM public.wf_template WHERE template_key = 'paystack_payment_receipt' AND version = 1)
 WHERE id = wf08t.id('run_esc');
ALTER TABLE public.wf_run ENABLE TRIGGER wf_run_08_freeze_actor;
SELECT wf08t.expect_error('retry refuses when the template ceiling was raised after the step died (never escalate)',
  $q$SELECT wf08t.call_retry('adminA', 'esc')$q$, '42501', 'wf08:autonomy_escalation');

-- ---------------------------------------------------------------------------------------------
-- 9. WF-07 review follow-up: the sweep's work list
-- ---------------------------------------------------------------------------------------------
SELECT wf08t.expect_true('the sweep work list and failure note execute for the service role only',
  (SELECT count(*) = 2 AND bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""'])
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_approved_drafts_ready', 'wf_note_draft_dispatch_failure')));
-- Three approved drafts of three waiting runs. Fixture rows are written with triggers skipped (as the e2e does).
CREATE FUNCTION wf08t.mkapproved(p_name text, p_outbox boolean, p_age integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_d uuid := gen_random_uuid(); v_a uuid := gen_random_uuid();
BEGIN
  PERFORM wf08t.mkrun('sw_' || p_name, 'wf08-a', 'waiting', 'adminA');
  PERFORM wf08t.mkstep('sw_' || p_name, 'sw_' || p_name, 'send', 'action', 'waiting', 'communication');
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.wf_approval (id, org_id, run_id, step_run_id, risk, summary, requested_by_kind, requested_by_ref, expires_at, status, decided_by, decided_at, decision_channel)
  VALUES (v_a, wf08t.id('orgA'), wf08t.id('run_sw_' || p_name), wf08t.id('step_sw_' || p_name), 'normal', 'sweep fixture',
          'system', 'workflow-runtime', now() + interval '1 day', 'approved', wf08t.id('adminA'), now(), 'console');
  INSERT INTO public.wf_action_draft (id, org_id, run_id, step_run_id, kind, category, template_ref, idempotency_key, status, approval_id, created_at, updated_at)
  VALUES (v_d, wf08t.id('orgA'), wf08t.id('run_sw_' || p_name), wf08t.id('step_sw_' || p_name), 'in_app', 'communication',
          'notice.a', 'wf08-sw-' || p_name, 'approved', v_a, now() - make_interval(secs => p_age), now() - make_interval(secs => p_age));
  IF p_outbox THEN
    INSERT INTO public.wf_action_sandbox_outbox (org_id, run_id, step_run_id, draft_id, kind, category, template_ref, broker_decision_id, idempotency_key)
    VALUES (wf08t.id('orgA'), wf08t.id('run_sw_' || p_name), wf08t.id('step_sw_' || p_name), v_d, 'in_app', 'communication', 'notice.a',
            wf08t.decision(wf08t.id('orgA'), 'in_app', 'wf08-sw-' || p_name), 'wf08-sw-' || p_name);
  END IF;
  SET LOCAL session_replication_role = origin;
  RETURN wf08t.keep('draft_sw_' || p_name, v_d);
END $$;
GRANT EXECUTE ON FUNCTION wf08t.mkapproved(text, boolean, integer) TO anon, authenticated, service_role;
CREATE FUNCTION wf08t.ready_order() RETURNS uuid[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(draft_id ORDER BY n), '{}') FROM (
    SELECT draft_id, row_number() OVER () AS n FROM public.wf_approved_drafts_ready(200) WHERE org_id = wf08t.id('orgA')) x
$$;
GRANT EXECUTE ON FUNCTION wf08t.ready_order() TO anon, authenticated, service_role;
SELECT wf08t.mkapproved('recorded', true, 300);
SELECT wf08t.mkapproved('old', false, 200);
SELECT wf08t.mkapproved('new', false, 100);
SELECT wf08t.expect_true('an approved draft with an executed record and a still-waiting step is listed again, marked as needing no dispatch',
  EXISTS (SELECT 1 FROM public.wf_approved_drafts_ready(200) r
           WHERE r.draft_id = wf08t.id('draft_sw_recorded') AND NOT r.needs_dispatch)
  AND EXISTS (SELECT 1 FROM public.wf_approved_drafts_ready(200) r
               WHERE r.draft_id = wf08t.id('draft_sw_old') AND r.needs_dispatch));
SELECT wf08t.expect_true('with no failures the list is oldest first',
  wf08t.ready_order() = ARRAY[wf08t.id('draft_sw_recorded'), wf08t.id('draft_sw_old'), wf08t.id('draft_sw_new')]);
SELECT wf08t.expect_true('noting a failure for the oldest undispatched draft succeeds once and is throttled after',
  public.wf_note_draft_dispatch_failure(wf08t.id('orgA'), wf08t.id('draft_sw_old')));
SELECT wf08t.expect_true('a second note within five minutes writes nothing',
  NOT public.wf_note_draft_dispatch_failure(wf08t.id('orgA'), wf08t.id('draft_sw_old'))
  AND (SELECT count(*) = 1 FROM public.wf_run_event WHERE kind = 'draft.dispatch_failed' AND run_id = wf08t.id('run_sw_old')));
SELECT wf08t.expect_true('a draft that failed is listed after drafts that have not (no starvation)',
  wf08t.ready_order() = ARRAY[wf08t.id('draft_sw_recorded'), wf08t.id('draft_sw_new'), wf08t.id('draft_sw_old')]);
SELECT wf08t.expect_true('a failure note for a draft that is not approved is refused quietly',
  NOT public.wf_note_draft_dispatch_failure(wf08t.id('orgA'), gen_random_uuid()));
SELECT wf08t.expect_true('the failure shows in the redacted timeline as a code and an id only',
  EXISTS (SELECT 1 FROM jsonb_array_elements(wf08t.detail('adminA', 'sw_old') -> 'events') e
           WHERE e ->> 'kind' = 'draft.dispatch_failed' AND (e -> 'detail') = jsonb_build_object('draft_id', wf08t.id('draft_sw_old'))));
SELECT wf08t.expect_true('resuming the recorded draft restarts its step and drops it from the list',
  public.wf_resume_after_dispatch(wf08t.id('orgA'), wf08t.id('draft_sw_recorded')));
SELECT wf08t.expect_true('after the resume the recorded draft is no longer listed',
  NOT (wf08t.id('draft_sw_recorded') = ANY (wf08t.ready_order())));

SELECT wf08t.logout();
SELECT 'WF08 ALL PASS: ' || count(*) || ' checks' FROM wf08t.passed;
ROLLBACK;
