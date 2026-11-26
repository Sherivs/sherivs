-- WF-12 quotas, wallet caps and retention: every quota at limit-1 / limit / limit+1, per-kind and cross-organization
-- isolation, fail-closed defaults, the zero wallet ceiling and read-only wallet, the settings functions, and the
-- retention dry run and purge with every preservation rule, the legal-hold refusal and the append-only locks.
-- Local disposable Postgres only. All synthetic records roll back.
BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WF12 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regprocedure('public.wf_limits_get(uuid)') IS NULL
     OR to_regprocedure('public.wf_limits_update(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.wf_retention_run_manual(uuid,boolean,uuid)') IS NULL
     OR to_regprocedure('public.wf_retention_run_scheduled(integer)') IS NULL
     OR to_regprocedure('public.wf_quota_check_action(uuid,text,integer,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'WF12 FAIL: WF-12 migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA wf12t;
GRANT USAGE ON SCHEMA wf12t TO anon, authenticated, service_role;
CREATE TABLE wf12t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE wf12t.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT, UPDATE ON wf12t.passed, wf12t.ids TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE wf12t.passed_n_seq TO anon, authenticated, service_role;
CREATE FUNCTION wf12t.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wf12t.passed (label) VALUES (p_label);
  RAISE NOTICE 'WF12 PASS %', p_label;
END $$;
CREATE FUNCTION wf12t.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WF12 FAIL [%]', p_label; END IF;
  PERFORM wf12t.pass(p_label);
END $$;
CREATE FUNCTION wf12t.expect_error(p_label text, p_sql text, p_state text, p_msg text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state AND (p_msg IS NULL OR SQLERRM LIKE '%' || p_msg || '%') THEN
      PERFORM wf12t.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'WF12 FAIL [%]: expected SQLSTATE % (%) got % (%)', p_label, p_state, p_msg, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'WF12 FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION wf12t.id(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM wf12t.ids WHERE name = p_name
$$;
CREATE FUNCTION wf12t.keep(p_name text, p_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wf12t.ids VALUES (p_name, p_id) ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id;
  RETURN p_id;
END $$;
CREATE FUNCTION wf12t.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION wf12t.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf12t TO anon, authenticated, service_role;

INSERT INTO wf12t.ids (name, id) VALUES
  ('orgA', 'f1200000-0000-4000-8000-0000000000a1'),
  ('orgB', 'f1200000-0000-4000-8000-0000000000b2'),
  ('adminA', 'f1200000-0000-4000-8000-000000000001'),
  ('viewer', 'f1200000-0000-4000-8000-000000000002'),
  ('plain', 'f1200000-0000-4000-8000-000000000003'),
  ('adminB', 'f1200000-0000-4000-8000-000000000004'),
  ('author', 'f1200000-0000-4000-8000-000000000005'),
  ('publisher', 'f1200000-0000-4000-8000-000000000006'),
  ('noorg', 'f1200000-0000-4000-8000-000000000007');

-- ---------------------------------------------------------------------------------------------
-- 1. Structure, privileges and function hygiene
-- ---------------------------------------------------------------------------------------------
SELECT wf12t.expect_true('the four WF-12 tables have RLS enabled and forced',
  (SELECT count(*) = 4 AND bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
    WHERE oid IN ('public.wf_org_limits'::regclass, 'public.wf_quota_denial'::regclass,
                  'public.wf_action_spend_rate'::regclass, 'public.wf_retention_run'::regclass)));
SELECT wf12t.expect_true('no client role can write any WF-12 table; anon reads none; authenticated reads three',
  NOT EXISTS (SELECT 1 FROM (VALUES ('public.wf_org_limits'), ('public.wf_quota_denial'),
                ('public.wf_action_spend_rate'), ('public.wf_retention_run')) t(n)
               WHERE has_table_privilege('anon', t.n, 'SELECT,INSERT,UPDATE,DELETE')
                  OR has_table_privilege('authenticated', t.n, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                  OR has_table_privilege('service_role', t.n, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  AND has_table_privilege('authenticated', 'public.wf_org_limits', 'SELECT')
  AND has_table_privilege('authenticated', 'public.wf_quota_denial', 'SELECT')
  AND has_table_privilege('authenticated', 'public.wf_retention_run', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.wf_action_spend_rate', 'SELECT'));
-- Exact ACLs, read from the catalog: this holds whether or not the database hands service_role default privileges
-- to what the migrator creates (the CI step that runs this file again under those defaults is "privileges under
-- Supabase default privileges" in verify.yml).
SELECT wf12t.expect_true('the four tables carry exactly these grants: authenticated SELECT on three, service_role SELECT on all four, nobody else',
  (SELECT array_agg(g ORDER BY g) FROM (
     SELECT c.relname || ':' || coalesce(NULLIF(a.grantee::regrole::text, '-'), 'PUBLIC') || ':' || a.privilege_type AS g
       FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid IN ('public.wf_org_limits'::regclass, 'public.wf_quota_denial'::regclass,
                      'public.wf_action_spend_rate'::regclass, 'public.wf_retention_run'::regclass)
        AND a.grantee <> c.relowner) x)
  = ARRAY['wf_action_spend_rate:service_role:SELECT', 'wf_org_limits:authenticated:SELECT', 'wf_org_limits:service_role:SELECT',
          'wf_quota_denial:authenticated:SELECT', 'wf_quota_denial:service_role:SELECT',
          'wf_retention_run:authenticated:SELECT', 'wf_retention_run:service_role:SELECT']);
SELECT wf12t.expect_true('no WF-12 function has a PUBLIC grant, and the only roles granted EXECUTE are the owner and service_role (on nine of them)',
  (SELECT count(*) FILTER (WHERE a.grantee = 0) = 0
          AND count(*) FILTER (WHERE a.grantee NOT IN (p.proowner, 0) AND a.grantee::regrole::text <> 'service_role') = 0
          AND count(DISTINCT p.oid) FILTER (WHERE a.grantee::regrole::text = 'service_role') = 9
     FROM pg_proc p LEFT JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a ON true
    WHERE p.pronamespace = 'public'::regnamespace
      AND (p.proname LIKE 'wf\_quota\_%' OR p.proname LIKE 'wf\_retention\_%' OR p.proname LIKE 'wf\_limit%'
           OR p.proname IN ('wf_wallet_cap_ceiling_kobo', 'wf_default_actions_per_hour', 'wf_org_limits_effective',
                            'wf_usage_snapshot', 'wf_action_cost_kobo', 'wf_org_limits_guard', 'wf_run_quota_guard',
                            'wf_action_draft_quota_guard', 'wf_action_sandbox_outbox_quota_guard',
                            'wf_block_draft_dispatch', 'wf_approved_drafts_ready'))));
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_error('the service role cannot call the purge pass directly',
  format($q$SELECT public.wf_retention_pass(%L, '{}'::jsonb, 5000)$q$, wf12t.id('orgA')), '42501');
SELECT wf12t.expect_error('the service role cannot call the purge execute directly (no legal-hold, dry-run or opt-in bypass)',
  format($q$SELECT public.wf_retention_execute(%L, false, NULL, 'scheduler')$q$, wf12t.id('orgA')), '42501');
SELECT wf12t.expect_error('the service role cannot reprice SMS', $q$UPDATE public.wf_action_spend_rate SET unit_kobo = 0 WHERE kind = 'sms'$q$, '42501');
SELECT wf12t.expect_error('the service role cannot write limits directly',
  format($q$INSERT INTO public.wf_org_limits (org_id) VALUES (%L)$q$, wf12t.id('orgA')), '42501');
SELECT wf12t.expect_error('the service role cannot reset a denial counter', $q$DELETE FROM public.wf_quota_denial$q$, '42501');
SELECT wf12t.expect_error('the service role cannot edit the retention log', $q$UPDATE public.wf_retention_run SET truncated = true$q$, '42501');
SELECT wf12t.expect_error('the service role cannot read the limits through the helper',
  format($q$SELECT public.wf_org_limits_effective(%L)$q$, wf12t.id('orgA')), '42501');
SELECT wf12t.logout();
SELECT wf12t.expect_true('the nine functions the server and the event run call execute for the service role only',
  (SELECT count(*) = 9 AND bool_and(
      has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_limits_get', 'wf_limits_update', 'wf_retention_run_manual', 'wf_retention_run_scheduled',
                        'wf_quota_check_action', 'wf_quota_runs_exceeded', 'wf_quota_note_denial',
                        'wf_block_draft_dispatch', 'wf_approved_drafts_ready')));
SELECT wf12t.expect_true('every other WF-12 helper and trigger function executes for no client role',
  (SELECT count(*) = 18 AND bool_and(
      NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_wallet_cap_ceiling_kobo', 'wf_default_actions_per_hour', 'wf_limit_bounds', 'wf_limit_defaults',
                        'wf_org_limits_effective', 'wf_usage_snapshot', 'wf_quota_violation', 'wf_action_cost_kobo',
                        'wf_org_limits_guard', 'wf_run_quota_guard', 'wf_action_draft_quota_guard',
                        'wf_action_sandbox_outbox_quota_guard', 'wf_retention_delete_allowed',
                        'wf_retention_delete_guard', 'wf_retention_legal_hold', 'wf_retention_pass',
                        'wf_retention_execute', 'wf_retention_windows')));
SELECT wf12t.expect_true('every WF-12 function pins an empty search_path',
  (SELECT count(*) = 27 AND bool_and(p.proconfig @> ARRAY['search_path=""'])
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_limits_get', 'wf_limits_update', 'wf_retention_run_manual', 'wf_retention_run_scheduled',
                        'wf_quota_check_action', 'wf_quota_runs_exceeded', 'wf_quota_note_denial',
                        'wf_wallet_cap_ceiling_kobo', 'wf_default_actions_per_hour', 'wf_limit_bounds', 'wf_limit_defaults',
                        'wf_org_limits_effective', 'wf_usage_snapshot', 'wf_quota_violation', 'wf_action_cost_kobo',
                        'wf_org_limits_guard', 'wf_run_quota_guard', 'wf_action_draft_quota_guard',
                        'wf_action_sandbox_outbox_quota_guard', 'wf_retention_delete_allowed',
                        'wf_retention_delete_guard', 'wf_retention_legal_hold', 'wf_retention_pass',
                        'wf_retention_execute', 'wf_retention_windows', 'wf_block_draft_dispatch',
                        'wf_approved_drafts_ready')));
SELECT wf12t.expect_true('the limits, draft, run and executed-record guards are BEFORE INSERT triggers after the earlier guards',
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_run'::regclass AND t.tgname = 'wf_run_15_quota'
            AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4)
  AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_action_draft'::regclass
                AND t.tgname = 'wf_action_draft_30_quota' AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4)
  AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_action_sandbox_outbox'::regclass
                AND t.tgname = 'wf_action_sandbox_outbox_30_quota' AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4)
  AND 'wf_run_10_guard' < 'wf_run_15_quota'
  AND 'wf_action_sandbox_outbox_20_run_guard' < 'wf_action_sandbox_outbox_30_quota');
SELECT wf12t.expect_true('the platform wallet ceiling is zero and the bounds say so',
  public.wf_wallet_cap_ceiling_kobo() = 0
  AND (public.wf_limit_bounds() -> 'wallet_cap_kobo_per_day' ->> 'max')::bigint = 0
  AND (public.wf_limit_bounds() -> 'wallet_cap_kobo_per_run' ->> 'max')::bigint = 0);
SELECT wf12t.expect_true('SMS and WhatsApp are the spend-bearing kinds and neither has a decided rate',
  (SELECT count(*) = 2 AND bool_and(unit_kobo IS NULL) FROM public.wf_action_spend_rate WHERE kind IN ('sms', 'whatsapp'))
  AND (SELECT count(*) = 2 FROM public.wf_action_spend_rate));
SELECT wf12t.expect_true('the hourly defaults: email, in-app, task, wait and webhook can act; SMS, WhatsApp and unknown kinds cannot',
  public.wf_default_actions_per_hour('email') = 100 AND public.wf_default_actions_per_hour('in_app') = 300
  AND public.wf_default_actions_per_hour('webhook') = 60 AND public.wf_default_actions_per_hour('sms') = 0
  AND public.wf_default_actions_per_hour('whatsapp') = 0 AND public.wf_default_actions_per_hour('anything') = 0
  AND public.wf_default_actions_per_hour(NULL) = 0);
SELECT wf12t.expect_error('the retention log cannot be truncated', $q$TRUNCATE public.wf_retention_run$q$, '42501');
SELECT wf12t.expect_error('window order is a table rule (a draft window shorter than the outbox window)',
  $q$INSERT INTO public.wf_org_limits (org_id, retention_outbox_days, retention_draft_days)
     VALUES (gen_random_uuid(), 100, 90)$q$, '23514');

-- ---------------------------------------------------------------------------------------------
-- 2. Fixtures
-- ---------------------------------------------------------------------------------------------
INSERT INTO auth.users (id) SELECT id FROM wf12t.ids WHERE name NOT IN ('orgA', 'orgB');
INSERT INTO public.schools (id, name, slug) VALUES
  (wf12t.id('orgA'), 'WF12 Org A', 'wf12-org-a'),
  (wf12t.id('orgB'), 'WF12 Org B', 'wf12-org-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (wf12t.id('adminA'), wf12t.id('orgA'), 'WF12 Admin A', 'admin-a@wf12.invalid', 'admin', true),
  (wf12t.id('viewer'), wf12t.id('orgA'), 'WF12 Viewer', 'viewer@wf12.invalid', 'teacher', true),
  (wf12t.id('plain'), wf12t.id('orgA'), 'WF12 Plain', 'plain@wf12.invalid', 'teacher', true),
  (wf12t.id('adminB'), wf12t.id('orgB'), 'WF12 Admin B', 'admin-b@wf12.invalid', 'admin', true);

-- The viewer holds an auditor role: workflows.view (and approve), but neither run nor manage.
SELECT set_config('request.jwt.claim.sub', wf12t.id('adminA')::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', wf12t.id('adminA'), 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, assigned_by)
SELECT v.org_id, v.user_id, r.code, t.default_scope, NULL, v.assigned_by
  FROM (VALUES (wf12t.id('orgA'), wf12t.id('viewer'), wf12t.id('adminA'), 'auditor')) v(org_id, user_id, assigned_by, template_code)
  JOIN public.role_catalog r ON r.template_code = v.template_code AND r.org_id IS NULL
   AND NOT coalesce(r.requires_verified_authority_link, false)
  JOIN public.role_templates t ON t.code = r.template_code
 WHERE r.code = (SELECT min(r2.code) FROM public.role_catalog r2
                  WHERE r2.template_code = v.template_code AND r2.org_id IS NULL
                    AND NOT coalesce(r2.requires_verified_authority_link, false));
SELECT wf12t.logout();

INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling) VALUES
  (wf12t.id('orgA'), true, 'act_and_report'),
  (wf12t.id('orgB'), true, 'act_and_report');
INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES
  (wf12t.id('orgA'), 'wf12-agent', 'act_and_report'),
  (wf12t.id('orgB'), 'wf12-agent', 'act_and_report');

CREATE FUNCTION wf12t.mkdef(p_key text, p_org text, p_max_steps integer DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_def uuid := gen_random_uuid(); v_ver uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.wf_definition (id, org_id, key, name) VALUES (v_def, wf12t.id(p_org), p_key, 'WF12 ' || p_key);
  INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by)
  VALUES (v_ver, wf12t.id(p_org), v_def, 1, '{"steps":[]}', wf12t.id('author'));
  IF p_max_steps IS NOT NULL THEN
    UPDATE public.wf_version SET max_steps_per_run = p_max_steps WHERE id = v_ver;
  END IF;
  UPDATE public.wf_version SET state = 'published', published_by = wf12t.id('publisher') WHERE id = v_ver;
  UPDATE public.wf_definition SET current_version_id = v_ver, status = 'active' WHERE id = v_def;
  PERFORM wf12t.keep('def_' || p_key, v_def);
  PERFORM wf12t.keep('ver_' || p_key, v_ver);
  RETURN v_def;
END $$;
SELECT wf12t.mkdef('wf12-a', 'orgA');
SELECT wf12t.mkdef('wf12-b', 'orgB');
SELECT wf12t.mkdef('wf12-short', 'orgA', 3);

-- A run as the engine would leave it. p_age_days backdates created_at / started_at / finished_at (fixture only).
CREATE FUNCTION wf12t.mkrun(p_name text, p_def text, p_status text, p_age_days integer DEFAULT 0,
  p_parent text DEFAULT NULL, p_max_steps integer DEFAULT 20, p_key text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_ver public.wf_version%ROWTYPE; v_final boolean := p_status IN ('succeeded', 'failed', 'cancelled', 'timed_out');
BEGIN
  SELECT * INTO v_ver FROM public.wf_version WHERE id = wf12t.id('ver_' || p_def);
  INSERT INTO public.wf_run (id, org_id, definition_id, version_id, parent_run_id, idempotency_key, status, max_depth, max_steps,
    step_count, started_by, deadline_at, started_at, finished_at, agent_ref, error_code)
  VALUES (v_id, v_ver.org_id, v_ver.definition_id, v_ver.id,
    CASE WHEN p_parent IS NULL THEN NULL ELSE wf12t.id('run_' || p_parent) END,
    coalesce(p_key, 'wf12-run-' || p_name), p_status, 3, p_max_steps, 0, wf12t.id('adminA'),
    now() + interval '1 hour', now(), CASE WHEN v_final THEN now() ELSE NULL END, 'wf12-agent',
    CASE WHEN p_status IN ('failed', 'timed_out') THEN 'step.failed' ELSE NULL END);
  IF p_age_days <> 0 THEN
    SET LOCAL session_replication_role = replica;
    UPDATE public.wf_run SET created_at = now() - make_interval(days => p_age_days),
      started_at = now() - make_interval(days => p_age_days),
      finished_at = CASE WHEN v_final THEN now() - make_interval(days => p_age_days) ELSE NULL END
     WHERE id = v_id;
    SET LOCAL session_replication_role = origin;
  END IF;
  RETURN wf12t.keep('run_' || p_name, v_id);
END $$;
CREATE FUNCTION wf12t.mkstep(p_name text, p_run text, p_key text, p_kind text, p_status text,
  p_class text DEFAULT 'communication') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf12t.id('run_' || p_run);
  INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, status, idempotency_key, action_class,
    agent_ref, attempt, max_attempts, resume_at, lease_owner, lease_expires_at, finished_at, error_code)
  VALUES (v_id, v_run.org_id, v_run.id, p_key, p_kind, p_status, 'wf12-step-' || p_name, p_class, 'wf12-agent',
    CASE WHEN p_status IN ('dead', 'claimed') THEN 3 ELSE 0 END, 3,
    CASE WHEN p_status = 'waiting' AND p_kind <> 'approval' THEN now() + interval '1 day' END,
    CASE WHEN p_status IN ('claimed', 'running') THEN 'wf12-worker' END,
    CASE WHEN p_status IN ('claimed', 'running') THEN now() + interval '5 minutes' END,
    CASE WHEN p_status IN ('succeeded', 'dead', 'skipped', 'cancelled') THEN now() END,
    CASE WHEN p_status = 'dead' THEN 'step.failed' END);
  RETURN wf12t.keep('step_' || p_name, v_id);
END $$;
-- Rows that only a backdated fixture can make (triggers and constraints are skipped on purpose; the purge itself runs
-- with everything on).
CREATE FUNCTION wf12t.mkevent(p_run text, p_kind text, p_age_days integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.wf_run_event (org_id, run_id, kind, actor_kind, actor_ref, detail, at)
  SELECT r.org_id, r.id, p_kind, 'system', 'wf12', '{}'::jsonb, now() - make_interval(days => p_age_days)
    FROM public.wf_run r WHERE r.id = wf12t.id('run_' || p_run);
  SET LOCAL session_replication_role = origin;
END $$;
CREATE FUNCTION wf12t.decision(p_org uuid, p_kind text, p_key text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.cg_tool_call_ledger
    (kind,twin_context_id,tenant_ref,tool_id,tool_version,tier,verdict,args_digest,idempotency_key)
  SELECT 'decision', c.id, p_org::text, 'workflow.action.' || p_kind, '1.0.0', r.tier, 'execute', repeat('a',64), p_key
    FROM public.cg_twin_context c
    JOIN public.cg_tool_registry r ON r.tool_id = 'workflow.action.' || p_kind AND r.version = '1.0.0'
   WHERE c.tenant_ref = p_org::text AND c.role_code = 'wf12-role'
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'WF12 FAIL: fixture decision missing'; END IF;
  RETURN v_id;
END $$;
CREATE FUNCTION wf12t.rids(p_n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(('f1290000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid), '{}')
    FROM generate_series(1, p_n) g
$$;
-- An executed record as the production path writes it (all guards on).
CREATE FUNCTION wf12t.mkoutbox(p_org text, p_kind text, p_run text, p_key text, p_recipients integer DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_run public.wf_run%ROWTYPE; v_step uuid;
BEGIN
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf12t.id('run_' || p_run);
  v_step := coalesce(wf12t.id('step_' || p_run || '_s'), (SELECT id FROM public.wf_step_run WHERE run_id = v_run.id LIMIT 1));
  INSERT INTO public.wf_action_sandbox_outbox (org_id, run_id, step_run_id, kind, category, template_ref, recipient_ids,
    broker_decision_id, idempotency_key)
  VALUES (v_run.org_id, v_run.id, v_step, p_kind, 'communication', 'notice.a', wf12t.rids(p_recipients),
    wf12t.decision(v_run.org_id, p_kind, p_key), p_key);
END $$;
CREATE FUNCTION wf12t.mkdraft(p_org text, p_run text, p_kind text, p_key text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf12t.id('run_' || p_run);
  INSERT INTO public.wf_action_draft (org_id, run_id, step_run_id, kind, category, template_ref, recipient_ids, idempotency_key)
  VALUES (v_run.org_id, v_run.id, coalesce(wf12t.id('step_' || p_run || '_s'), (SELECT id FROM public.wf_step_run WHERE run_id = v_run.id LIMIT 1)),
          p_kind, 'communication', 'notice.a', wf12t.rids(1), p_key);
END $$;
CREATE FUNCTION wf12t.setlimits(p_actor text, p_patch jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.wf_limits_update(wf12t.id(p_actor), p_patch)
$$;
CREATE FUNCTION wf12t.usage(p_org text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.wf_usage_snapshot(wf12t.id(p_org))
$$;
CREATE FUNCTION wf12t.audits(p_org text, p_action text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.audit_chain WHERE org_id = wf12t.id(p_org) AND action = p_action
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf12t TO anon, authenticated, service_role;

-- Broker fixtures for executed records.
INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition) VALUES
 ('wf12-pack','1.0.0','tenant_role',ARRAY['wf12-role'],'published',
  jsonb_build_object(
    'schema','sherivs.role-pack.v1','code','wf12-pack','version','1.0.0','kind','tenant_role',
    'title','WF12 synthetic pack','permissions',jsonb_build_array('workflows.run'),
    'capabilities',jsonb_build_array(jsonb_build_object('id','workflow.in-app','title','In-app',
      'tier','T1','autonomy','act_autonomously','requiresPermission','workflows.run','connector','in-app')),
    'playbooks','[]'::jsonb,
    'memory',jsonb_build_object('domains',jsonb_build_array('work'),'maxSensitivity','internal','retentionDays',90,'crossTenant',false),
    'budget',jsonb_build_object('dailyActions',50,'dailyModelCalls',20,'dailyCostCapMinor',1000),
    'escalation',jsonb_build_object('defaultApprover','role_owner','t3Approver','sheriff'),
    'startsInShadow',true));
SELECT public.cg_twin_ensure_context(wf12t.id('adminA'), 'tenant_membership', wf12t.id('orgA')::text, 'wf12-role', 'wf12-src-a', true);
SELECT public.cg_twin_ensure_context(wf12t.id('adminB'), 'tenant_membership', wf12t.id('orgB')::text, 'wf12-role', 'wf12-src-b', true);

-- A row made only of column defaults equals the platform defaults function (so "no row" and "default row" agree).
INSERT INTO public.wf_org_limits (org_id) VALUES (wf12t.id('orgB'));
SELECT wf12t.expect_true('the table column defaults equal the platform defaults function',
  (SELECT to_jsonb(l) - 'org_id' - 'updated_by' - 'created_at' - 'updated_at' = public.wf_limit_defaults()
     FROM public.wf_org_limits l WHERE l.org_id = wf12t.id('orgB'))
  AND public.wf_org_limits_effective(wf12t.id('orgB')) = public.wf_limit_defaults());
DELETE FROM public.wf_org_limits WHERE org_id = wf12t.id('orgB');
SELECT wf12t.expect_true('with no row the effective limits are the platform defaults, never unlimited',
  public.wf_org_limits_effective(wf12t.id('orgA')) = public.wf_limit_defaults()
  AND (public.wf_org_limits_effective(wf12t.id('orgA')) ->> 'runs_per_day')::integer = 500
  AND (public.wf_org_limits_effective(wf12t.id('orgA')) ->> 'wallet_cap_kobo_per_day')::bigint = 0
  AND (public.wf_org_limits_effective(wf12t.id('orgA')) ->> 'retention_auto_purge')::boolean = false);

-- ---------------------------------------------------------------------------------------------
-- 3. Settings functions: authority, validation, merge, audit
-- ---------------------------------------------------------------------------------------------
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_true('an admin reads limits, usage, bounds and permissions for their own organization only',
  (SELECT d -> 'limits' ->> 'runs_per_day' = '500' AND d -> 'bounds' -> 'runs_per_day' ->> 'max' = '10000'
      AND d -> 'usage' ->> 'runs_24h' = '0' AND (d ->> 'can_manage')::boolean AND NOT (d ->> 'configured')::boolean
      AND (d ->> 'settings_exist')::boolean AND (d ->> 'wallet_cap_ceiling_kobo') = '0'
     FROM (SELECT public.wf_limits_get(wf12t.id('adminA')) AS d) x));
SELECT wf12t.expect_true('a viewer can read but is told they cannot manage',
  (SELECT NOT (d ->> 'can_manage')::boolean FROM (SELECT public.wf_limits_get(wf12t.id('viewer')) AS d) x));
SELECT wf12t.expect_error('a person with no workflow permission cannot read limits',
  format($q$SELECT public.wf_limits_get(%L)$q$, wf12t.id('plain')), '42501', 'wf12:not_authorized');
SELECT wf12t.expect_error('a person with no organization cannot read limits',
  format($q$SELECT public.wf_limits_get(%L)$q$, wf12t.id('noorg')), '42501');
SELECT wf12t.expect_error('a missing actor is refused', $q$SELECT public.wf_limits_get(NULL)$q$, '42501');
SELECT wf12t.expect_error('a viewer cannot change limits',
  format($q$SELECT public.wf_limits_update(%L, '{"runs_per_day": 10}')$q$, wf12t.id('viewer')), '42501', 'wf12:not_authorized');
SELECT wf12t.expect_error('a person with no permission cannot change limits',
  format($q$SELECT public.wf_limits_update(%L, '{"runs_per_day": 10}')$q$, wf12t.id('plain')), '42501', 'wf12:not_authorized');
SELECT wf12t.expect_true('admin B changes limits and the result echoes them',
  (SELECT (r -> 'limits' ->> 'runs_per_day') = '77' FROM (SELECT wf12t.setlimits('adminB', '{"runs_per_day": 77}') r) x));
SELECT wf12t.expect_true('the organization comes from the actor: only organization B has a row',
  (SELECT count(*) = 1 FROM public.wf_org_limits WHERE org_id = wf12t.id('orgB') AND runs_per_day = 77)
  AND NOT EXISTS (SELECT 1 FROM public.wf_org_limits WHERE org_id = wf12t.id('orgA')));
SELECT wf12t.expect_error('an empty patch is refused', format($q$SELECT public.wf_limits_update(%L, '{}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('a non-object patch is refused', format($q$SELECT public.wf_limits_update(%L, '[1]')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('an unknown key is refused', format($q$SELECT public.wf_limits_update(%L, '{"workflows_enabled": true}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('a string is not a number', format($q$SELECT public.wf_limits_update(%L, '{"runs_per_day": "10"}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('a fraction is refused', format($q$SELECT public.wf_limits_update(%L, '{"runs_per_day": 10.5}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('a negative number is refused', format($q$SELECT public.wf_limits_update(%L, '{"runs_per_day": -1}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('runs per day below its minimum is refused', format($q$SELECT public.wf_limits_update(%L, '{"runs_per_day": 0}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('runs per day above its maximum is refused', format($q$SELECT public.wf_limits_update(%L, '{"runs_per_day": 10001}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('steps per run above 1000 is refused', format($q$SELECT public.wf_limits_update(%L, '{"steps_per_run": 1001}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('a retention window below its safe minimum is refused (outbox 29 days)', format($q$SELECT public.wf_limits_update(%L, '{"retention_outbox_days": 29}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('a retention window below its safe minimum is refused (evidence 729 days)', format($q$SELECT public.wf_limits_update(%L, '{"retention_evidence_days": 729}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('a retention window above ten years is refused', format($q$SELECT public.wf_limits_update(%L, '{"retention_run_days": 3651}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('window order: the draft window cannot be longer than the run window',
  format($q$SELECT public.wf_limits_update(%L, '{"retention_draft_days": 400}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('window order: the run window cannot be longer than the evidence window',
  format($q$SELECT public.wf_limits_update(%L, '{"retention_run_days": 3000}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('the wallet cap cannot be raised above the platform ceiling of zero',
  format($q$SELECT public.wf_limits_update(%L, '{"wallet_cap_kobo_per_day": 1}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('the per-run wallet cap cannot be raised either',
  format($q$SELECT public.wf_limits_update(%L, '{"wallet_cap_kobo_per_run": 1}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('auto purge must be a boolean', format($q$SELECT public.wf_limits_update(%L, '{"retention_auto_purge": "yes"}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_error('an unknown action kind in the hourly map is refused',
  format($q$SELECT public.wf_limits_update(%L, '{"actions_per_hour": {"carrier_pigeon": 5}}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_actions_per_hour');
SELECT wf12t.expect_error('an hourly value above 5000 is refused',
  format($q$SELECT public.wf_limits_update(%L, '{"actions_per_hour": {"email": 5001}}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_actions_per_hour');
SELECT wf12t.expect_error('an hourly value that is not a number is refused',
  format($q$SELECT public.wf_limits_update(%L, '{"actions_per_hour": {"email": "many"}}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_actions_per_hour');
SELECT wf12t.expect_error('an hourly map that is not an object is refused',
  format($q$SELECT public.wf_limits_update(%L, '{"actions_per_hour": 5}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.expect_true('a refused update leaves no row for the organization',
  NOT EXISTS (SELECT 1 FROM public.wf_org_limits WHERE org_id = wf12t.id('orgA')));
SELECT wf12t.expect_true('a valid patch is merged: only the named keys move and the hourly map merges per kind',
  (SELECT r -> 'limits' ->> 'drafts_pending' = '200'
      AND r -> 'limits' -> 'actions_per_hour' ->> 'email' = '40'
      AND r -> 'limits' -> 'actions_per_hour' ->> 'in_app' = '300'
      AND r -> 'limits' -> 'actions_per_hour' ->> 'sms' = '0'
      FROM (SELECT wf12t.setlimits('adminA', '{"actions_per_hour": {"email": 40}}') r) x));
SELECT wf12t.expect_true('the editor is recorded and the table change is audited',
  (SELECT updated_by = wf12t.id('adminA') FROM public.wf_org_limits WHERE org_id = wf12t.id('orgA'))
  AND wf12t.audits('orgA', 'workflow.wf_org_limits.changed') = 1);
SELECT wf12t.expect_true('a second change is applied',
  (SELECT r -> 'limits' ->> 'retention_event_days' = '120' FROM (SELECT wf12t.setlimits('adminA', '{"retention_event_days": 120}') r) x));
SELECT wf12t.expect_true('a second change is audited again', wf12t.audits('orgA', 'workflow.wf_org_limits.changed') = 2);
SELECT wf12t.expect_error('the service role cannot write the limits table directly either (only the function can)',
  $q$INSERT INTO public.wf_org_limits (org_id) VALUES (gen_random_uuid())$q$, '42501');
SELECT wf12t.logout();
SELECT wf12t.expect_error('no limits row can exist without a workflow settings row',
  $q$INSERT INTO public.wf_org_limits (org_id) VALUES (gen_random_uuid())$q$, '23503');

SELECT wf12t.login_as('authenticated');
SELECT wf12t.expect_error('an authenticated client cannot call the settings function',
  format($q$SELECT public.wf_limits_update(%L, '{"runs_per_day": 5}')$q$, wf12t.id('adminA')), '42501');
SELECT wf12t.expect_error('an authenticated client cannot write limits directly', $q$UPDATE public.wf_org_limits SET runs_per_day = 1$q$, '42501');
SELECT wf12t.expect_error('an authenticated client cannot insert limits directly',
  format($q$INSERT INTO public.wf_org_limits (org_id) VALUES (%L)$q$, wf12t.id('orgA')), '42501');
SELECT wf12t.expect_error('an authenticated client cannot delete limits', $q$DELETE FROM public.wf_org_limits$q$, '42501');
SELECT wf12t.expect_error('an authenticated client cannot call the retention functions',
  format($q$SELECT public.wf_retention_run_manual(%L, true, NULL)$q$, wf12t.id('adminA')), '42501');
SELECT wf12t.logout();
SELECT wf12t.login_as('anon');
SELECT wf12t.expect_error('anon reads nothing', $q$SELECT count(*) FROM public.wf_org_limits$q$, '42501');
SELECT wf12t.logout();

-- Row-level reads: members of an organization see only their own row.
SELECT set_config('request.jwt.claim.sub', wf12t.id('viewer')::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', wf12t.id('viewer'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT wf12t.expect_true('a viewer reads their own organization limits and nothing of another organization',
  (SELECT count(*) = 1 AND min(org_id::text) = wf12t.id('orgA')::text FROM public.wf_org_limits));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', wf12t.id('plain')::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', wf12t.id('plain'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT wf12t.expect_true('a person without workflows.view reads no limits row',
  (SELECT count(*) = 0 FROM public.wf_org_limits));
RESET ROLE;
SELECT wf12t.logout();

-- ---------------------------------------------------------------------------------------------
-- 4. Quotas: runs per day, steps per run, drafts pending, actions per hour per kind
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION wf12t.replay_run(p_run text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.wf_run (org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps, deadline_at)
  SELECT org_id, definition_id, version_id, idempotency_key, 'running', 3, 20, now() + interval '1 hour'
    FROM public.wf_run WHERE id = wf12t.id('run_' || p_run)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
CREATE FUNCTION wf12t.replay_draft(p_key text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.wf_action_draft (org_id, run_id, step_run_id, kind, category, template_ref, recipient_ids, idempotency_key)
  SELECT org_id, run_id, step_run_id, kind, category, template_ref, recipient_ids, idempotency_key
    FROM public.wf_action_draft WHERE idempotency_key = p_key
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
CREATE FUNCTION wf12t.replay_outbox(p_key text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.wf_action_sandbox_outbox (org_id, run_id, step_run_id, kind, category, template_ref, recipient_ids,
    broker_decision_id, idempotency_key)
  SELECT org_id, run_id, step_run_id, kind, category, template_ref, recipient_ids, broker_decision_id, idempotency_key
    FROM public.wf_action_sandbox_outbox WHERE idempotency_key = p_key
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf12t TO anon, authenticated, service_role;
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"runs_per_day": 3}');
SELECT wf12t.logout();
SELECT wf12t.mkrun('q1', 'wf12-a', 'running');
SELECT wf12t.mkrun('q2', 'wf12-a', 'running');
SELECT wf12t.expect_true('limit - 1: two runs are inside a limit of three', (wf12t.usage('orgA') ->> 'runs_24h')::integer = 2
  AND NOT public.wf_quota_runs_exceeded(wf12t.id('orgA')));
SELECT wf12t.mkrun('q3', 'wf12-a', 'running');
SELECT wf12t.expect_true('limit: the third run is allowed and fills the day', (wf12t.usage('orgA') ->> 'runs_24h')::integer = 3
  AND public.wf_quota_runs_exceeded(wf12t.id('orgA')));
SELECT wf12t.expect_error('limit + 1: the fourth run is refused by the database',
  $q$SELECT wf12t.mkrun('q4', 'wf12-a', 'running')$q$, '54000', 'wf12:quota_runs_per_day');
SELECT wf12t.mkrun('qb', 'wf12-b', 'running');
SELECT wf12t.expect_true('another organization is unaffected by this organization''s limit', (wf12t.usage('orgB') ->> 'runs_24h')::integer = 1);
SELECT wf12t.expect_true('a replay of an existing run key is not a new run and is not refused', wf12t.replay_run('q1') = 0);
SET LOCAL session_replication_role = replica;
UPDATE public.wf_run SET created_at = now() - interval '25 hours' WHERE id = wf12t.id('run_q1');
SET LOCAL session_replication_role = origin;
SELECT wf12t.expect_true('a run older than 24 hours no longer counts', (wf12t.usage('orgA') ->> 'runs_24h')::integer = 2);
SELECT wf12t.mkrun('q5', 'wf12-a', 'running');
SELECT wf12t.expect_error('the window slides but the limit still holds',
  $q$SELECT wf12t.mkrun('q6', 'wf12-a', 'running')$q$, '54000', 'wf12:quota_runs_per_day');
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"runs_per_day": 1}');
SELECT wf12t.logout();
SELECT wf12t.expect_error('lowering the limit below current use refuses new runs at once',
  $q$SELECT wf12t.mkrun('q7', 'wf12-a', 'running')$q$, '54000', 'wf12:quota_runs_per_day');
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"runs_per_day": 500}');
SELECT wf12t.logout();

-- Event-driven creation defers instead of failing: no attempt is spent, nothing is dropped, and the refusal is counted.
INSERT INTO public.wf_trigger_binding (id, org_id, definition_id, kind, event_type, enabled)
VALUES ('f1230000-0000-4000-8000-0000000000a1', wf12t.id('orgA'), wf12t.id('def_wf12-a'), 'event', 'workflow.requested', true);
INSERT INTO public.wf_event (id, org_id, event_type, source, dedupe_key, payload)
VALUES ('f1240000-0000-4000-8000-0000000000a1', wf12t.id('orgA'), 'workflow.requested', 'wf12', 'wf12-event-0001', '{}'),
       ('f1240000-0000-4000-8000-0000000000a2', wf12t.id('orgA'), 'workflow.requested', 'wf12', 'wf12-event-0002', '{}');
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"runs_per_day": 1}');
CREATE TEMP TABLE wf12_claimed ON COMMIT DROP AS SELECT * FROM public.wf_claim_due_events('wf12-worker', 20, 30);
GRANT SELECT ON wf12_claimed TO service_role;
SELECT wf12t.expect_true('both events were claimed for the organization', (SELECT count(*) = 2 FROM wf12_claimed WHERE org_id = wf12t.id('orgA')));
SELECT wf12t.expect_true('with the day full the event run is deferred (created = false)',
  (SELECT NOT created FROM public.wf_create_event_run(
     'f1250000-0000-4000-8000-0000000000a1', 'f1240000-0000-4000-8000-0000000000a1', 'wf12-worker',
     'f1230000-0000-4000-8000-0000000000a1', (SELECT id FROM public.wf_template WHERE template_key = 'payment_due_reminder_ladder' AND version = 1),
     'wf12-agent', now(), now() + interval '1 hour', 3, 20, 'first', 'action', 'internal', 0, 5, 60, '{}',
     '{"run":{"runId":"r","definitionId":"d","tenantRef":"t","state":"running","history":[],"pendingEvidence":[],"evidence":[],"attempts":[]}}')));
SELECT wf12t.logout();
SELECT wf12t.expect_true('the deferred event went back to pending, later, with no attempt burned, and made no run',
  (SELECT status = 'pending' AND attempts = 0 AND lease_owner IS NULL AND next_attempt_at > now() + interval '4 minutes'
     FROM public.wf_event WHERE id = 'f1240000-0000-4000-8000-0000000000a1')
  AND NOT EXISTS (SELECT 1 FROM public.wf_run WHERE idempotency_key = 'wf-event:f1240000-0000-4000-8000-0000000000a1'));
SELECT wf12t.expect_true('the deferral is counted for the organization (hourly counter, no identifiers)',
  (SELECT denied >= 1 FROM public.wf_quota_denial WHERE org_id = wf12t.id('orgA') AND limit_name = 'runs_per_day' AND kind = ''));
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"runs_per_day": 500}');
SELECT wf12t.logout();
SET LOCAL session_replication_role = replica;
UPDATE public.wf_event SET status = 'claimed', lease_owner = 'wf12-worker', lease_expires_at = now() + interval '10 minutes',
  next_attempt_at = now() WHERE id = 'f1240000-0000-4000-8000-0000000000a1';
SET LOCAL session_replication_role = origin;
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_true('once the limit allows it the same event creates its run (nothing was dropped)',
  (SELECT created FROM public.wf_create_event_run(
     'f1250000-0000-4000-8000-0000000000a1', 'f1240000-0000-4000-8000-0000000000a1', 'wf12-worker',
     'f1230000-0000-4000-8000-0000000000a1', (SELECT id FROM public.wf_template WHERE template_key = 'payment_due_reminder_ladder' AND version = 1),
     'wf12-agent', now(), now() + interval '1 hour', 3, 20, 'first', 'action', 'internal', 0, 5, 60, '{}',
     '{"run":{"runId":"r","definitionId":"d","tenantRef":"t","state":"running","history":[],"pendingEvidence":[],"evidence":[],"attempts":[]}}')));
SELECT wf12t.setlimits('adminA', '{"runs_per_day": 1}');
SELECT wf12t.logout();
SET LOCAL session_replication_role = replica;
UPDATE public.wf_event SET status = 'claimed', lease_owner = 'wf12-worker', lease_expires_at = now() + interval '10 minutes'
 WHERE id = 'f1240000-0000-4000-8000-0000000000a1';
SET LOCAL session_replication_role = origin;
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_true('a replay of an event whose run exists is never deferred, even with the day full',
  (SELECT NOT created FROM public.wf_create_event_run(
     'f1250000-0000-4000-8000-0000000000a9', 'f1240000-0000-4000-8000-0000000000a1', 'wf12-worker',
     'f1230000-0000-4000-8000-0000000000a1', (SELECT id FROM public.wf_template WHERE template_key = 'payment_due_reminder_ladder' AND version = 1),
     'wf12-agent', now(), now() + interval '1 hour', 3, 20, 'first', 'action', 'internal', 0, 5, 60, '{}',
     '{"run":{"runId":"r","definitionId":"d","tenantRef":"t","state":"running","history":[],"pendingEvidence":[],"evidence":[],"attempts":[]}}')));
SELECT wf12t.setlimits('adminA', '{"runs_per_day": 500}');
SELECT wf12t.logout();
SELECT wf12t.expect_true('the replay was recorded as dispatched, not pending',
  (SELECT status = 'dispatched' FROM public.wf_event WHERE id = 'f1240000-0000-4000-8000-0000000000a1'));

-- Steps per run: the organization limit can only lower what the published version allows.
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"steps_per_run": 5}');
SELECT wf12t.logout();
SELECT wf12t.mkrun('st1', 'wf12-a', 'running', 0, NULL, 20);
SELECT wf12t.mkrun('st2', 'wf12-short', 'running', 0, NULL, 20);
SELECT wf12t.expect_true('a run is clamped to the organization steps limit (20 -> 5)',
  (SELECT max_steps = 5 FROM public.wf_run WHERE id = wf12t.id('run_st1')));
SELECT wf12t.expect_true('a version with a lower limit keeps its own (3 stays 3 under an organization limit of 5)',
  (SELECT max_steps = 3 FROM public.wf_run WHERE id = wf12t.id('run_st2')));
SELECT wf12t.expect_error('a run cannot take more steps than its clamped limit (the existing step-limit check still applies)',
  format($q$UPDATE public.wf_run SET step_count = 6 WHERE id = %L$q$, wf12t.id('run_st1')), '23514');
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"steps_per_run": 1000}');
SELECT wf12t.logout();
SELECT wf12t.mkrun('st3', 'wf12-a', 'running', 0, NULL, 20);
SELECT wf12t.expect_true('raising the organization limit never raises a run above what it asked for',
  (SELECT max_steps = 20 FROM public.wf_run WHERE id = wf12t.id('run_st3')));

-- Drafts pending.
SELECT wf12t.mkrun('d', 'wf12-a', 'running');
SELECT wf12t.mkstep('d_s', 'd', 'send', 'action', 'pending');
SELECT wf12t.mkrun('db', 'wf12-b', 'running');
SELECT wf12t.mkstep('db_s', 'db', 'send', 'action', 'pending');
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"drafts_pending": 2}');
SELECT wf12t.logout();
SELECT wf12t.mkdraft('orgA', 'd', 'in_app', 'wf12-draft-1');
SELECT wf12t.expect_true('limit - 1: one pending draft is inside a limit of two', (wf12t.usage('orgA') ->> 'drafts_pending')::integer = 1);
SELECT wf12t.mkdraft('orgA', 'd', 'in_app', 'wf12-draft-2');
SELECT wf12t.expect_error('limit + 1: the third pending draft is refused',
  $q$SELECT wf12t.mkdraft('orgA', 'd', 'in_app', 'wf12-draft-3')$q$, '54000', 'wf12:quota_drafts_pending');
SELECT wf12t.expect_true('a replay of an existing draft is not refused at the limit', wf12t.replay_draft('wf12-draft-1') = 0);
SELECT wf12t.mkdraft('orgB', 'db', 'in_app', 'wf12-draft-b1');
SELECT wf12t.expect_true('another organization''s drafts do not count', (wf12t.usage('orgB') ->> 'drafts_pending')::integer = 1);
SET LOCAL session_replication_role = replica;
UPDATE public.wf_action_draft SET status = 'rejected' WHERE idempotency_key = 'wf12-draft-1';
SET LOCAL session_replication_role = origin;
SELECT wf12t.expect_true('a decided draft no longer counts as pending', (wf12t.usage('orgA') ->> 'drafts_pending')::integer = 1);
SELECT wf12t.mkdraft('orgA', 'd', 'sms', 'wf12-draft-sms');
SELECT wf12t.expect_true('a spend-bearing draft can still be written for a person to review (spend is judged at execution)',
  EXISTS (SELECT 1 FROM public.wf_action_draft WHERE idempotency_key = 'wf12-draft-sms'));
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"drafts_pending": 200}');
SELECT wf12t.logout();

-- Actions per hour, per kind.
SELECT wf12t.mkrun('a', 'wf12-a', 'running');
SELECT wf12t.mkstep('a_s', 'a', 'send', 'action', 'pending');
SELECT wf12t.mkrun('ab', 'wf12-b', 'running');
SELECT wf12t.mkstep('ab_s', 'ab', 'send', 'action', 'pending');
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"actions_per_hour": {"email": 2, "task": 1, "wait": 0}}');
SELECT wf12t.logout();
SELECT wf12t.mkoutbox('orgA', 'email', 'a', 'wf12-out-e1');
SELECT wf12t.expect_true('limit - 1: one email is inside a limit of two', (wf12t.usage('orgA') -> 'actions_1h' ->> 'email')::integer = 1);
SELECT wf12t.mkoutbox('orgA', 'email', 'a', 'wf12-out-e2');
SELECT wf12t.expect_error('limit + 1: the third email in the hour is refused',
  $q$SELECT wf12t.mkoutbox('orgA', 'email', 'a', 'wf12-out-e3')$q$, '54000', 'wf12:quota_actions_per_hour');
SELECT wf12t.mkoutbox('orgA', 'in_app', 'a', 'wf12-out-i1');
SELECT wf12t.expect_true('another kind is unaffected by the email limit', (wf12t.usage('orgA') -> 'actions_1h' ->> 'in_app')::integer = 1);
SELECT wf12t.mkoutbox('orgB', 'email', 'ab', 'wf12-out-be1');
SELECT wf12t.mkoutbox('orgB', 'email', 'ab', 'wf12-out-be2');
SELECT wf12t.mkoutbox('orgB', 'email', 'ab', 'wf12-out-be3');
SELECT wf12t.expect_true('another organization keeps its own hourly budget', (wf12t.usage('orgB') -> 'actions_1h' ->> 'email')::integer = 3);
SELECT wf12t.expect_true('a replay of an executed record at the limit is not refused', wf12t.replay_outbox('wf12-out-e1') = 0);
SELECT wf12t.mkoutbox('orgA', 'task', 'a', 'wf12-out-t1');
SELECT wf12t.expect_error('a kind limited to one allows exactly one',
  $q$SELECT wf12t.mkoutbox('orgA', 'task', 'a', 'wf12-out-t2')$q$, '54000', 'wf12:quota_actions_per_hour');
SELECT wf12t.expect_error('a kind set to zero allows none',
  $q$SELECT wf12t.mkoutbox('orgA', 'wait', 'a', 'wf12-out-w1')$q$, '54000', 'wf12:quota_actions_per_hour');
SET LOCAL session_replication_role = replica;
UPDATE public.wf_action_sandbox_outbox SET created_at = now() - interval '2 hours' WHERE idempotency_key IN ('wf12-out-e1', 'wf12-out-e2');
SET LOCAL session_replication_role = origin;
SELECT wf12t.mkoutbox('orgA', 'email', 'a', 'wf12-out-e4');
SELECT wf12t.expect_true('records older than an hour no longer count', (wf12t.usage('orgA') -> 'actions_1h' ->> 'email')::integer = 1);

-- Fail closed.
SET LOCAL session_replication_role = replica;
UPDATE public.wf_org_limits SET actions_per_hour = '{}'::jsonb WHERE org_id = wf12t.id('orgA');
SET LOCAL session_replication_role = origin;
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_true('a kind missing from the hourly map falls back to the platform default, not to unlimited',
  (public.wf_quota_check_action(wf12t.id('orgA'), 'email', 1, 'execute', wf12t.id('run_a')) ->> 'allowed')::boolean
  AND NOT (public.wf_quota_check_action(wf12t.id('orgA'), 'sms', 1, 'execute', wf12t.id('run_a')) ->> 'allowed')::boolean);
SELECT wf12t.logout();
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"actions_per_hour": {"email": 2, "task": 300, "wait": 300}}');
SELECT wf12t.expect_true('the pre-check agrees with the database: email has room for one more only',
  (public.wf_quota_check_action(wf12t.id('orgA'), 'email', 1, 'execute', wf12t.id('run_a')) ->> 'allowed')::boolean);
SELECT wf12t.logout();
SELECT wf12t.mkoutbox('orgA', 'email', 'a', 'wf12-out-e5');
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_true('the pre-check refuses with the code once the hour is full',
  (SELECT NOT (c ->> 'allowed')::boolean AND c ->> 'code' = 'actions_per_hour'
     FROM (SELECT public.wf_quota_check_action(wf12t.id('orgA'), 'email', 1, 'execute', wf12t.id('run_a')) c) x));
SELECT wf12t.expect_true('the pre-check refuses an unknown kind (fail closed)',
  (SELECT NOT (c ->> 'allowed')::boolean AND c ->> 'code' = 'kind_unknown'
     FROM (SELECT public.wf_quota_check_action(wf12t.id('orgA'), 'carrier_pigeon', 1, 'execute', NULL) c) x));
SELECT wf12t.expect_true('the pre-check in draft mode looks at pending drafts, not the hourly limit',
  (public.wf_quota_check_action(wf12t.id('orgA'), 'email', 1, 'draft', wf12t.id('run_a')) ->> 'allowed')::boolean);
SELECT wf12t.expect_error('an unknown mode is refused', format($q$SELECT public.wf_quota_check_action(%L, 'email', 1, 'live', NULL)$q$, wf12t.id('orgA')), '22023', 'wf12:invalid_check');
SELECT wf12t.expect_error('a recipient count above 500 is refused', format($q$SELECT public.wf_quota_check_action(%L, 'email', 501, 'execute', NULL)$q$, wf12t.id('orgA')), '22023', 'wf12:invalid_check');
SELECT wf12t.expect_error('a missing organization is refused', $q$SELECT public.wf_quota_check_action(NULL, 'email', 1, 'execute', NULL)$q$, '22023', 'wf12:invalid_check');
SELECT wf12t.expect_true('refusals are counted per limit and kind for the hour',
  (SELECT denied = 1 FROM public.wf_quota_denial WHERE org_id = wf12t.id('orgA') AND limit_name = 'actions_per_hour'
      AND kind = 'email' AND bucket = date_trunc('hour', now()))
  AND (SELECT denied = 1 FROM public.wf_quota_denial WHERE org_id = wf12t.id('orgA') AND limit_name = 'spend_rate_unknown' AND kind = 'sms')
  AND (SELECT denied = 1 FROM public.wf_quota_denial WHERE org_id = wf12t.id('orgA') AND limit_name = 'kind_unknown' AND kind = ''));
SELECT wf12t.expect_true('the settings read shows the last 24 hours of refusals and the live usage',
  (SELECT d -> 'denials_24h' @> '[{"limit":"actions_per_hour","kind":"email","denied":1}]'::jsonb
      AND (d -> 'usage' -> 'actions_1h' ->> 'email')::integer = 2
     FROM (SELECT public.wf_limits_get(wf12t.id('adminA')) d) x));
SELECT wf12t.expect_true('another organization sees none of these refusals',
  (SELECT NOT (d -> 'denials_24h' @> '[{"limit":"actions_per_hour"}]'::jsonb) FROM (SELECT public.wf_limits_get(wf12t.id('adminB')) d) x));
SELECT wf12t.logout();

-- ---------------------------------------------------------------------------------------------
-- 5. Wallet caps: default zero, ceiling zero, read-only wallet
-- ---------------------------------------------------------------------------------------------
INSERT INTO public.school_wallets (school_id, balance) VALUES (wf12t.id('orgA'), 100);
CREATE TEMP TABLE wf12_wallet_before ON COMMIT DROP AS
  SELECT (SELECT balance FROM public.school_wallets WHERE school_id = wf12t.id('orgA')) AS balance,
         (SELECT count(*) FROM public.wallet_ledger) AS ledger_rows,
         (SELECT count(*) FROM public.school_wallets) AS wallets;
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"actions_per_hour": {"email": 500, "sms": 50, "whatsapp": 50}}');
SELECT wf12t.logout();
SELECT wf12t.mkrun('w1', 'wf12-a', 'running');
SELECT wf12t.mkstep('w1_s', 'w1', 'send', 'action', 'pending');
SELECT wf12t.mkrun('w2', 'wf12-a', 'running');
SELECT wf12t.mkstep('w2_s', 'w2', 'send', 'action', 'pending');
SELECT wf12t.mkrun('w3', 'wf12-a', 'running');
SELECT wf12t.mkstep('w3_s', 'w3', 'send', 'action', 'pending');
SELECT wf12t.expect_error('no rate is decided for SMS, so an SMS cannot be recorded as executed (even with room in the hour)',
  $q$SELECT wf12t.mkoutbox('orgA', 'sms', 'w1', 'wf12-sms-0')$q$, '54000', 'wf12:quota_spend_rate_unknown');
SELECT wf12t.expect_error('the same holds for WhatsApp',
  $q$SELECT wf12t.mkoutbox('orgA', 'whatsapp', 'w1', 'wf12-wa-0')$q$, '54000', 'wf12:quota_spend_rate_unknown');
SELECT wf12t.mkoutbox('orgA', 'email', 'w1', 'wf12-free-e1');
SELECT wf12t.mkoutbox('orgA', 'in_app', 'w1', 'wf12-free-i1');
SELECT wf12t.expect_true('free kinds cost nothing and are not touched by the wallet cap',
  (SELECT bool_and(cost_kobo = 0) FROM public.wf_action_sandbox_outbox WHERE idempotency_key IN ('wf12-free-e1', 'wf12-free-i1'))
  AND public.wf_action_cost_kobo('email', 10) = 0 AND public.wf_action_cost_kobo('webhook', 1) = 0);

-- A rate is decided (fixture only: rates are changed by a reviewed migration, never by an organization).
UPDATE public.wf_action_spend_rate SET unit_kobo = 500 WHERE kind = 'sms';
SELECT wf12t.expect_true('a decided rate prices an SMS per recipient (at least one)',
  public.wf_action_cost_kobo('sms', 1) = 500 AND public.wf_action_cost_kobo('sms', 3) = 1500
  AND public.wf_action_cost_kobo('sms', 0) = 500);
SELECT wf12t.expect_error('the default cap is zero, so even a priced SMS is refused',
  $q$SELECT wf12t.mkoutbox('orgA', 'sms', 'w1', 'wf12-sms-1')$q$, '54000', 'wf12:quota_spend_cap_day');
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_true('the pre-check says the same, and counts it',
  (SELECT NOT (c ->> 'allowed')::boolean AND c ->> 'code' = 'spend_cap_day'
     FROM (SELECT public.wf_quota_check_action(wf12t.id('orgA'), 'sms', 1, 'execute', wf12t.id('run_w1')) c) x));
SELECT wf12t.expect_error('an organization cannot lift its cap while the platform ceiling is zero',
  format($q$SELECT public.wf_limits_update(%L, '{"wallet_cap_kobo_per_day": 5000, "wallet_cap_kobo_per_run": 1000}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.logout();
SELECT wf12t.expect_error('even a direct write cannot put a cap above the ceiling',
  format($q$UPDATE public.wf_org_limits SET wallet_cap_kobo_per_day = 1 WHERE org_id = %L$q$, wf12t.id('orgA')), '22023', 'wf12:wallet_cap_above_ceiling');

-- The founder raises the ceiling in a later migration (fixture: replace the function for this transaction only).
CREATE OR REPLACE FUNCTION public.wf_wallet_cap_ceiling_kobo() RETURNS bigint LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT 1000000::bigint $$;
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_true('with a higher ceiling an admin can set caps (per-day 2000, per-run 1000)',
  (SELECT r -> 'limits' ->> 'wallet_cap_kobo_per_day' = '2000' AND r -> 'limits' ->> 'wallet_cap_kobo_per_run' = '1000'
     FROM (SELECT wf12t.setlimits('adminA', '{"wallet_cap_kobo_per_day": 2000, "wallet_cap_kobo_per_run": 1000}') r) x));
SELECT wf12t.expect_error('the per-run cap can never exceed the per-day cap',
  format($q$SELECT public.wf_limits_update(%L, '{"wallet_cap_kobo_per_run": 3000}')$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_limit');
SELECT wf12t.logout();
SELECT wf12t.mkoutbox('orgA', 'sms', 'w1', 'wf12-sms-1');
SELECT wf12t.mkoutbox('orgA', 'sms', 'w1', 'wf12-sms-2');
SELECT wf12t.expect_true('priced records carry their cost, set by the database', 
  (SELECT bool_and(cost_kobo = 500) FROM public.wf_action_sandbox_outbox WHERE idempotency_key IN ('wf12-sms-1', 'wf12-sms-2'))
  AND (wf12t.usage('orgA') ->> 'spend_24h_kobo')::bigint = 1000);
SELECT wf12t.expect_error('the per-run cap stops the third SMS of one run',
  $q$SELECT wf12t.mkoutbox('orgA', 'sms', 'w1', 'wf12-sms-3')$q$, '54000', 'wf12:quota_spend_cap_run');
CREATE FUNCTION wf12t.mkoutbox_forged(p_run text, p_key text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf12t.id('run_' || p_run);
  INSERT INTO public.wf_action_sandbox_outbox (org_id, run_id, step_run_id, kind, category, template_ref, recipient_ids,
    broker_decision_id, idempotency_key, cost_kobo)
  VALUES (v_run.org_id, v_run.id, wf12t.id('step_' || p_run || '_s'), 'sms', 'communication', 'notice.a', wf12t.rids(1),
    wf12t.decision(v_run.org_id, 'sms', p_key), p_key, 0);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf12t TO anon, authenticated, service_role;
SELECT wf12t.mkoutbox_forged('w2', 'wf12-sms-4');
SELECT wf12t.expect_true('forging cost_kobo = 0 on insert is overwritten by the trigger',
  (SELECT cost_kobo = 500 FROM public.wf_action_sandbox_outbox WHERE idempotency_key = 'wf12-sms-4'));
SELECT wf12t.mkoutbox('orgA', 'sms', 'w2', 'wf12-sms-5');
SELECT wf12t.expect_true('the day total is 2000 after four SMS', (wf12t.usage('orgA') ->> 'spend_24h_kobo')::bigint = 2000);
SELECT wf12t.expect_error('the day cap stops a new run at the cap',
  $q$SELECT wf12t.mkoutbox('orgA', 'sms', 'w3', 'wf12-sms-6')$q$, '54000', 'wf12:quota_spend_cap_day');
SELECT wf12t.expect_error('the cost of a stored record cannot be changed',
  $q$UPDATE public.wf_action_sandbox_outbox SET cost_kobo = 0 WHERE idempotency_key = 'wf12-sms-1'$q$, '42501', 'created_at are immutable');
SELECT wf12t.expect_error('a free kind''s cost cannot be set either',
  $q$UPDATE public.wf_action_sandbox_outbox SET cost_kobo = 7 WHERE idempotency_key = 'wf12-free-e1'$q$, '42501', 'created_at are immutable');
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"wallet_cap_kobo_per_day": 1000000, "wallet_cap_kobo_per_run": 1000000}');
SELECT wf12t.logout();
SELECT wf12t.expect_error('the wallet is a second limit: 25 SMS cost 12500 kobo, the wallet holds 10000',
  $q$SELECT wf12t.mkoutbox('orgA', 'sms', 'w3', 'wf12-sms-7', 25)$q$, '54000', 'wf12:quota_spend_wallet');
SELECT wf12t.mkoutbox('orgA', 'sms', 'w3', 'wf12-sms-8', 3);
SELECT wf12t.expect_true('a multi-recipient send is priced per recipient',
  (SELECT cost_kobo = 1500 FROM public.wf_action_sandbox_outbox WHERE idempotency_key = 'wf12-sms-8'));
SELECT wf12t.expect_true('workflows only read the wallet: balance, ledger and wallet rows are exactly as they were',
  (SELECT w.balance = b.balance AND (SELECT count(*) FROM public.wallet_ledger) = b.ledger_rows
          AND (SELECT count(*) FROM public.school_wallets) = b.wallets
     FROM wf12_wallet_before b, public.school_wallets w WHERE w.school_id = wf12t.id('orgA')));
SELECT wf12t.expect_true('WhatsApp still has no rate and stays refused while SMS is priced',
  NOT EXISTS (SELECT 1 FROM public.wf_action_spend_rate WHERE kind = 'whatsapp' AND unit_kobo IS NOT NULL));
SELECT wf12t.expect_error('WhatsApp is still refused',
  $q$SELECT wf12t.mkoutbox('orgA', 'whatsapp', 'w3', 'wf12-wa-1')$q$, '54000', 'wf12:quota_spend_rate_unknown');

-- The ceiling goes back to zero: every cap an organization holds is clamped with it.
CREATE OR REPLACE FUNCTION public.wf_wallet_cap_ceiling_kobo() RETURNS bigint LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT 0::bigint $$;
SELECT wf12t.expect_true('lowering the ceiling lowers the effective cap with it',
  (public.wf_org_limits_effective(wf12t.id('orgA')) ->> 'wallet_cap_kobo_per_day')::bigint = 0
  AND (public.wf_org_limits_effective(wf12t.id('orgA')) ->> 'wallet_cap_kobo_per_run')::bigint = 0);
SELECT wf12t.expect_error('and spending is refused again',
  $q$SELECT wf12t.mkoutbox('orgA', 'sms', 'w3', 'wf12-sms-9')$q$, '54000', 'wf12:quota_spend_cap_day');
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_true('an unrelated change still works for an organization whose stored cap is above the new ceiling',
  (SELECT r -> 'limits' ->> 'wallet_cap_kobo_per_day' = '0' FROM (SELECT wf12t.setlimits('adminA', '{"runs_per_day": 400}') r) x));
SELECT wf12t.logout();
UPDATE public.wf_action_spend_rate SET unit_kobo = NULL WHERE kind = 'sms';

-- ---------------------------------------------------------------------------------------------
-- 6. Retention
-- ---------------------------------------------------------------------------------------------
-- Fixture builders for aged rows. Rows are written with triggers and constraints skipped (a backdated row cannot be
-- made any other way); the purge itself always runs with every guard on.
CREATE FUNCTION wf12t.old_approval(p_name text, p_run text, p_step text, p_status text, p_age integer, p_risk text DEFAULT 'normal')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf12t.id('run_' || p_run);
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.wf_approval (id, org_id, run_id, step_run_id, status, risk, summary, requested_by_kind, requested_by_ref,
    requested_at, expires_at, decided_by, decided_at, decision_channel)
  VALUES (v_id, v_run.org_id, v_run.id, wf12t.id('step_' || p_step), p_status, p_risk, 'fixture summary', 'system', 'wf12',
    now() - make_interval(days => p_age), now() - make_interval(days => p_age) + interval '7 days',
    CASE WHEN p_status IN ('approved', 'rejected') THEN wf12t.id('adminA') END,
    CASE WHEN p_status IN ('approved', 'rejected') THEN now() - make_interval(days => p_age) + interval '1 day' END,
    CASE WHEN p_status IN ('approved', 'rejected') THEN 'console' END);
  SET LOCAL session_replication_role = origin;
  RETURN wf12t.keep('appr_' || p_name, v_id);
END $$;
CREATE FUNCTION wf12t.old_stepup(p_name text, p_appr text, p_age integer, p_used boolean) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_a public.wf_approval%ROWTYPE;
BEGIN
  SELECT * INTO v_a FROM public.wf_approval WHERE id = wf12t.id('appr_' || p_appr);
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.wf_approval_step_up (id, org_id, approval_id, user_id, content_digest, verified_at, expires_at, used_at)
  VALUES (v_id, v_a.org_id, v_a.id, wf12t.id('viewer'), repeat('b', 64), now() - make_interval(days => p_age),
          now() - make_interval(days => p_age) + interval '4 minutes',
          CASE WHEN p_used THEN now() - make_interval(days => p_age) + interval '1 minute' END);
  SET LOCAL session_replication_role = origin;
  RETURN wf12t.keep('stepup_' || p_name, v_id);
END $$;
CREATE FUNCTION wf12t.old_decision(p_name text, p_appr text, p_stepup text, p_age integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_a public.wf_approval%ROWTYPE;
BEGIN
  SELECT * INTO v_a FROM public.wf_approval WHERE id = wf12t.id('appr_' || p_appr);
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.wf_approval_decision (id, org_id, approval_id, approver_id, decision, high_risk, step_up_id, content_digest, note, decided_at)
  VALUES (v_id, v_a.org_id, v_a.id, wf12t.id('viewer'), CASE WHEN v_a.status = 'rejected' THEN 'reject' ELSE 'approve' END,
          p_stepup IS NOT NULL, CASE WHEN p_stepup IS NULL THEN NULL ELSE wf12t.id('stepup_' || p_stepup) END,
          repeat('c', 64), NULL, now() - make_interval(days => p_age));
  SET LOCAL session_replication_role = origin;
  RETURN wf12t.keep('dec_' || p_name, v_id);
END $$;
CREATE FUNCTION wf12t.old_draft(p_name text, p_run text, p_step text, p_status text, p_appr text, p_age integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf12t.id('run_' || p_run);
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.wf_action_draft (id, org_id, run_id, step_run_id, kind, category, template_ref, recipient_ids, idempotency_key,
    status, approval_id, created_at, updated_at)
  VALUES (v_id, v_run.org_id, v_run.id, wf12t.id('step_' || p_step), 'email', 'communication', 'notice.a', wf12t.rids(2),
    'wf12-old-draft-' || p_name, p_status, CASE WHEN p_appr IS NULL THEN NULL ELSE wf12t.id('appr_' || p_appr) END,
    now() - make_interval(days => p_age), now() - make_interval(days => p_age));
  SET LOCAL session_replication_role = origin;
  RETURN wf12t.keep('draft_' || p_name, v_id);
END $$;
CREATE FUNCTION wf12t.old_outbox(p_name text, p_run text, p_step text, p_draft text, p_age integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf12t.id('run_' || p_run);
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.wf_action_sandbox_outbox (id, org_id, run_id, step_run_id, kind, category, template_ref, recipient_ids,
    broker_decision_id, idempotency_key, draft_id, created_at)
  VALUES (v_id, v_run.org_id, v_run.id, wf12t.id('step_' || p_step), 'email', 'communication', 'notice.a', wf12t.rids(2),
    wf12t.decision(v_run.org_id, 'email', 'wf12-old-out-' || p_name), 'wf12-old-out-' || p_name,
    CASE WHEN p_draft IS NULL THEN NULL ELSE wf12t.id('draft_' || p_draft) END, now() - make_interval(days => p_age));
  SET LOCAL session_replication_role = origin;
  RETURN wf12t.keep('out_' || p_name, v_id);
END $$;
CREATE FUNCTION wf12t.old_event(p_name text, p_org text, p_status text, p_age integer, p_cause text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.wf_event (id, org_id, event_type, source, dedupe_key, payload, status, causation_run_id, occurred_at, created_at)
  VALUES (v_id, wf12t.id(p_org), 'workflow.requested', 'wf12', 'wf12-old-event-' || p_name, '{}', p_status,
          CASE WHEN p_cause IS NULL THEN NULL ELSE wf12t.id('run_' || p_cause) END,
          now() - make_interval(days => p_age), now() - make_interval(days => p_age));
  SET LOCAL session_replication_role = origin;
  RETURN wf12t.keep('event_' || p_name, v_id);
END $$;
CREATE FUNCTION wf12t.link_event(p_run text, p_event text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE public.wf_run SET event_id = wf12t.id('event_' || p_event) WHERE id = wf12t.id('run_' || p_run);
  SET LOCAL session_replication_role = origin;
END $$;
CREATE FUNCTION wf12t.count_of(p_table text, p_org text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id = $1', p_table) INTO n USING wf12t.id(p_org);
  RETURN n;
END $$;
CREATE FUNCTION wf12t.snapshot_counts(p_org text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'outbox', wf12t.count_of('wf_action_sandbox_outbox', p_org), 'drafts', wf12t.count_of('wf_action_draft', p_org),
    'run_events', wf12t.count_of('wf_run_event', p_org), 'step_up', wf12t.count_of('wf_approval_step_up', p_org),
    'decisions', wf12t.count_of('wf_approval_decision', p_org), 'approvals', wf12t.count_of('wf_approval', p_org),
    'steps', wf12t.count_of('wf_step_run', p_org), 'runs', wf12t.count_of('wf_run', p_org),
    'events', wf12t.count_of('wf_event', p_org))
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf12t TO anon, authenticated, service_role;

-- Short windows (the safe minimums) so fixtures stay small; evidence stays at its long default for phase A.
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"runs_per_day": 5000, "actions_per_hour": {"email": 5000, "in_app": 5000, "task": 5000, "wait": 5000},
  "retention_outbox_days": 30, "retention_draft_days": 90, "retention_event_days": 90, "retention_run_days": 180,
  "retention_stepup_days": 90, "retention_evidence_days": 2555}');
SELECT wf12t.setlimits('adminB', '{"retention_outbox_days": 30, "retention_draft_days": 90, "retention_event_days": 90,
  "retention_run_days": 180, "retention_stepup_days": 90, "retention_evidence_days": 730}');
SELECT wf12t.logout();

-- R1: a finished run with everything a purge can reach (all of it old enough). Event E3 is its trigger event.
SELECT wf12t.mkrun('r1', 'wf12-a', 'succeeded', 400);
SELECT wf12t.mkstep('r1_s', 'r1', 'send', 'action', 'succeeded');
SELECT wf12t.mkevent('r1', 'runtime.state', 300);
SELECT wf12t.mkevent('r1', 'run.finished', 300);
SELECT wf12t.old_draft('d1', 'r1', 'r1_s', 'rejected', NULL, 300);
SELECT wf12t.old_outbox('o1', 'r1', 'r1_s', NULL, 300);
SELECT wf12t.old_event('e3', 'orgA', 'dispatched', 380);
SELECT wf12t.link_event('r1', 'e3');
-- R2: still running, old everything: nothing of it may go.
SELECT wf12t.mkrun('r2', 'wf12-a', 'running', 400);
SELECT wf12t.mkstep('r2_s', 'r2', 'send', 'action', 'waiting');
SELECT wf12t.mkevent('r2', 'runtime.state', 300);
SELECT wf12t.old_draft('d2', 'r2', 'r2_s', 'draft', NULL, 300);
SELECT wf12t.old_outbox('o2', 'r2', 'r2_s', NULL, 300);
-- R3: a pending approval pins its draft, executed record, events, step-up evidence and the run itself.
SELECT wf12t.mkrun('r3', 'wf12-a', 'failed', 400);
SELECT wf12t.mkstep('r3_s', 'r3', 'send', 'action', 'dead');
SELECT wf12t.mkstep('r3_rev', 'r3', 'review', 'approval', 'waiting', 'internal');
SELECT wf12t.old_approval('a3', 'r3', 'r3_rev', 'pending', 400);
SELECT wf12t.old_draft('d3', 'r3', 'r3_s', 'draft', 'a3', 300);
SELECT wf12t.old_outbox('o3', 'r3', 'r3_s', 'd3', 300);
SELECT wf12t.mkevent('r3', 'runtime.state', 300);
SELECT wf12t.old_stepup('s3', 'a3', 300, false);
SELECT wf12t.old_event('e4', 'orgA', 'dispatched', 380);
SELECT wf12t.link_event('r3', 'e4');
-- R4: approval evidence (approved, high risk, one used step-up and one decision) older than the long window? Not yet:
-- the evidence window is 2555 days in phase A, so only the draft, executed record and events may go.
SELECT wf12t.mkrun('r4', 'wf12-a', 'succeeded', 800);
SELECT wf12t.mkstep('r4_s', 'r4', 'send', 'action', 'succeeded');
SELECT wf12t.mkstep('r4_rev', 'r4', 'review', 'approval', 'succeeded', 'internal');
SELECT wf12t.old_approval('a4', 'r4', 'r4_rev', 'approved', 850, 'high');
SELECT wf12t.old_stepup('s4', 'a4', 850, true);
SELECT wf12t.old_decision('dec4', 'a4', 's4', 850);
SELECT wf12t.old_draft('d4', 'r4', 'r4_s', 'approved', 'a4', 850);
SELECT wf12t.old_outbox('o4', 'r4', 'r4_s', 'd4', 849);
SELECT wf12t.mkevent('r4', 'runtime.state', 800);
SELECT wf12t.mkevent('r4', 'run.finished', 800);
-- R5/R6: a finished parent with a recent child. R7/R8: a failed source with a live retry. R9: a run whose event outlives it.
SELECT wf12t.mkrun('r5', 'wf12-a', 'succeeded', 400);
SELECT wf12t.mkstep('r5_s', 'r5', 'send', 'action', 'succeeded');
SELECT wf12t.mkevent('r5', 'runtime.state', 300);
SELECT wf12t.mkrun('r6', 'wf12-a', 'succeeded', 10, 'r5');
SELECT wf12t.mkrun('r7', 'wf12-a', 'failed', 400);
SELECT wf12t.mkstep('r7_s', 'r7', 'send', 'action', 'dead');
SELECT wf12t.mkevent('r7', 'runtime.state', 300);
SELECT wf12t.mkrun('r8', 'wf12-a', 'running', 5);
SET LOCAL session_replication_role = replica;
UPDATE public.wf_run SET retry_of_run_id = wf12t.id('run_r7'), retry_of_step_id = wf12t.id('step_r7_s'), retry_generation = 1
 WHERE id = wf12t.id('run_r8');
SET LOCAL session_replication_role = origin;
SELECT wf12t.mkrun('r9', 'wf12-a', 'succeeded', 400);
SELECT wf12t.mkstep('r9_s', 'r9', 'send', 'action', 'succeeded');
SELECT wf12t.old_event('e9', 'orgA', 'dispatched', 10, 'r9');
-- R10: finished 100 days ago: past the 90-day event window, inside the 180-day run window, with a rejected approval whose
-- step-up evidence was never used.
SELECT wf12t.mkrun('r10', 'wf12-a', 'cancelled', 100);
SELECT wf12t.mkstep('r10_s', 'r10', 'send', 'action', 'cancelled');
SELECT wf12t.mkstep('r10_rev', 'r10', 'review', 'approval', 'cancelled', 'internal');
SELECT wf12t.mkevent('r10', 'run.cancelled', 100);
SELECT wf12t.old_approval('au', 'r10', 'r10_rev', 'rejected', 200);
SELECT wf12t.old_stepup('su', 'au', 200, false);
SELECT wf12t.old_decision('decu', 'au', NULL, 200);
-- Inbound events: unreferenced and old (goes), old but still pending (stays).
SELECT wf12t.old_event('e1', 'orgA', 'dispatched', 200);
SELECT wf12t.old_event('e2', 'orgA', 'pending', 200);
-- Another organization with old rows of its own.
SELECT wf12t.mkrun('rb', 'wf12-b', 'succeeded', 400);
SELECT wf12t.mkstep('rb_s', 'rb', 'send', 'action', 'succeeded');
SELECT wf12t.mkevent('rb', 'runtime.state', 300);
SELECT wf12t.old_outbox('ob', 'rb', 'rb_s', NULL, 300);

CREATE TEMP TABLE wf12_before ON COMMIT DROP AS SELECT
  wf12t.snapshot_counts('orgA') AS a, wf12t.snapshot_counts('orgB') AS b,
  (SELECT count(*) FROM public.cg_tool_call_ledger) AS ledger,
  (SELECT count(*) FROM public.audit_chain WHERE org_id = wf12t.id('orgA') AND action NOT LIKE 'workflow.retention.%') AS audit_a;
GRANT SELECT ON wf12_before TO service_role;

-- Permissions first.
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_error('a viewer cannot run a retention dry run',
  format($q$SELECT public.wf_retention_run_manual(%L, true, NULL)$q$, wf12t.id('viewer')), '42501', 'wf12:not_authorized');
SELECT wf12t.expect_error('a person with no permission cannot run one',
  format($q$SELECT public.wf_retention_run_manual(%L, true, NULL)$q$, wf12t.id('plain')), '42501', 'wf12:not_authorized');
SELECT wf12t.expect_error('a real purge needs the id of a recent dry run',
  format($q$SELECT public.wf_retention_run_manual(%L, false, NULL)$q$, wf12t.id('adminA')), '42501', 'wf12:dry_run_required');
SELECT wf12t.expect_error('an id that is not a dry run of this organization does not count',
  format($q$SELECT public.wf_retention_run_manual(%L, false, gen_random_uuid())$q$, wf12t.id('adminA')), '42501', 'wf12:dry_run_required');
SELECT wf12t.expect_error('a null mode is refused', format($q$SELECT public.wf_retention_run_manual(%L, NULL, NULL)$q$, wf12t.id('adminA')), '22023', 'wf12:invalid_request');
SELECT wf12t.logout();
SELECT wf12t.expect_true('nothing was written by the refused attempts', (SELECT count(*) = 0 FROM public.wf_retention_run));

-- Phase A: dry run.
SELECT wf12t.login_as('service_role');
SELECT public.wf_retention_run_manual(wf12t.id('adminA'), true, NULL) AS dry \gset phaseA_
SELECT wf12t.logout();
SELECT wf12t.keep('dry_a', (:'phaseA_dry'::jsonb ->> 'run_id')::uuid);
SELECT wf12t.expect_true('the dry run reports exactly what a purge would remove (phase A, evidence window 2555 days)',
  (:'phaseA_dry'::jsonb -> 'counts') = '{"outbox":2,"drafts":2,"run_events":7,"unused_step_up":1,"approval_decisions":0,"approval_step_up":0,"approvals":0,"step_runs":1,"runs":1,"inbound_events":2}'::jsonb
  AND :'phaseA_dry'::jsonb ->> 'mode' = 'dry_run' AND :'phaseA_dry'::jsonb ->> 'outcome' = 'completed'
  AND NOT (:'phaseA_dry'::jsonb ->> 'truncated')::boolean);
SELECT wf12t.expect_true('a dry run deletes nothing in any organization', wf12t.snapshot_counts('orgA') = (SELECT a FROM wf12_before)
  AND wf12t.snapshot_counts('orgB') = (SELECT b FROM wf12_before));
SELECT wf12t.expect_true('a dry run leaves a log row and an audit row, with counts and windows only',
  (SELECT mode = 'dry_run' AND trigger_kind = 'manual' AND actor_id = wf12t.id('adminA') AND outcome = 'completed'
      AND windows ->> 'run_days' = '180' AND counts ->> 'runs' = '1'
     FROM public.wf_retention_run WHERE id = wf12t.id('dry_a'))
  AND wf12t.audits('orgA', 'workflow.retention.dry_run') = 1);
SELECT wf12t.expect_true('the audit entry for a dry run carries no identifier of any row',
  NOT EXISTS (SELECT 1 FROM public.audit_chain WHERE org_id = wf12t.id('orgA') AND action LIKE 'workflow.retention.%'
                AND (target_id <> wf12t.id('dry_a')::text OR target_type <> 'wf_retention_run')));
SELECT wf12t.expect_error('another organization''s admin cannot use this dry run to purge',
  format($q$SELECT public.wf_retention_run_manual(%L, false, %L)$q$, wf12t.id('adminB'), wf12t.id('dry_a')), '42501', 'wf12:dry_run_required');

-- The windows are part of what a person looked at: changing one after the dry run makes that dry run void.
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"retention_evidence_days": 2000}');
SELECT wf12t.expect_error('a purge naming a dry run made with other windows is refused',
  format($q$SELECT public.wf_retention_run_manual(%L, false, %L)$q$, wf12t.id('adminA'), wf12t.id('dry_a')), '42501', 'wf12:dry_run_required');
SELECT wf12t.setlimits('adminA', '{"retention_evidence_days": 2555}');
SELECT wf12t.logout();
SELECT wf12t.expect_true('nothing was deleted by the refused purge', wf12t.snapshot_counts('orgA') = (SELECT a FROM wf12_before));

-- Phase A: purge.
SELECT wf12t.login_as('service_role');
SELECT public.wf_retention_run_manual(wf12t.id('adminA'), false, wf12t.id('dry_a')) AS purge \gset phaseA_
SELECT wf12t.logout();
SELECT wf12t.keep('purge_a', (:'phaseA_purge'::jsonb ->> 'run_id')::uuid);
SELECT wf12t.expect_true('the purge deleted exactly what the dry run said',
  (:'phaseA_purge'::jsonb -> 'counts') = (:'phaseA_dry'::jsonb -> 'counts') AND :'phaseA_purge'::jsonb ->> 'mode' = 'purge');
SELECT wf12t.expect_true('the counts in the table match what is gone (outbox 5->3 of this organization''s fixtures, runs -1)',
  (wf12t.snapshot_counts('orgA') ->> 'runs')::integer = ((SELECT a ->> 'runs' FROM wf12_before)::integer - 1)
  AND (wf12t.snapshot_counts('orgA') ->> 'run_events')::integer = ((SELECT a ->> 'run_events' FROM wf12_before)::integer - 7)
  AND (wf12t.snapshot_counts('orgA') ->> 'drafts')::integer = ((SELECT a ->> 'drafts' FROM wf12_before)::integer - 2)
  AND (wf12t.snapshot_counts('orgA') ->> 'events')::integer = ((SELECT a ->> 'events' FROM wf12_before)::integer - 2));
SELECT wf12t.expect_true('R1 and everything that hung off it is gone, including its trigger event, in one pass',
  NOT EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r1'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_step_run WHERE run_id = wf12t.id('run_r1'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_run_event WHERE run_id = wf12t.id('run_r1'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_action_draft WHERE id = wf12t.id('draft_d1'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox WHERE id = wf12t.id('out_o1'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_event WHERE id = wf12t.id('event_e3')));
SELECT wf12t.expect_true('a running run keeps its draft, executed record, events and steps however old they are',
  EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r2'))
  AND EXISTS (SELECT 1 FROM public.wf_action_draft WHERE id = wf12t.id('draft_d2'))
  AND EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox WHERE id = wf12t.id('out_o2'))
  AND EXISTS (SELECT 1 FROM public.wf_run_event WHERE run_id = wf12t.id('run_r2'))
  AND EXISTS (SELECT 1 FROM public.wf_step_run WHERE run_id = wf12t.id('run_r2')));
SELECT wf12t.expect_true('everything a pending approval points at is kept: approval, draft, executed record, events, step-up evidence, run',
  EXISTS (SELECT 1 FROM public.wf_approval WHERE id = wf12t.id('appr_a3'))
  AND EXISTS (SELECT 1 FROM public.wf_action_draft WHERE id = wf12t.id('draft_d3'))
  AND EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox WHERE id = wf12t.id('out_o3'))
  AND EXISTS (SELECT 1 FROM public.wf_run_event WHERE run_id = wf12t.id('run_r3'))
  AND EXISTS (SELECT 1 FROM public.wf_approval_step_up WHERE id = wf12t.id('stepup_s3'))
  AND EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r3'))
  AND EXISTS (SELECT 1 FROM public.wf_event WHERE id = wf12t.id('event_e4')));
SELECT wf12t.expect_true('approval evidence inside its window is kept (approval, decision, used step-up, run) while its draft, record and events go',
  EXISTS (SELECT 1 FROM public.wf_approval WHERE id = wf12t.id('appr_a4'))
  AND EXISTS (SELECT 1 FROM public.wf_approval_decision WHERE id = wf12t.id('dec_dec4'))
  AND EXISTS (SELECT 1 FROM public.wf_approval_step_up WHERE id = wf12t.id('stepup_s4'))
  AND EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r4'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_action_draft WHERE id = wf12t.id('draft_d4'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_action_sandbox_outbox WHERE id = wf12t.id('out_o4'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_run_event WHERE run_id = wf12t.id('run_r4')));
SELECT wf12t.expect_true('a finished parent with a surviving child is kept, and so is a failed source with a live retry',
  EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r5'))
  AND EXISTS (SELECT 1 FROM public.wf_step_run WHERE run_id = wf12t.id('run_r5'))
  AND EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r7'))
  AND EXISTS (SELECT 1 FROM public.wf_step_run WHERE id = wf12t.id('step_r7_s'))
  AND EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r6'))
  AND EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r8')));
SELECT wf12t.expect_true('a run whose emitted event is still inside the window is kept',
  EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r9')) AND EXISTS (SELECT 1 FROM public.wf_event WHERE id = wf12t.id('event_e9')));
SELECT wf12t.expect_true('the window order works: R10''s events went (100 > 90 days), R10 stayed (100 < 180)',
  NOT EXISTS (SELECT 1 FROM public.wf_run_event WHERE run_id = wf12t.id('run_r10'))
  AND EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r10'))
  AND EXISTS (SELECT 1 FROM public.wf_step_run WHERE run_id = wf12t.id('run_r10')));
SELECT wf12t.expect_true('unused step-up evidence went; the decided approval and its decision stayed',
  NOT EXISTS (SELECT 1 FROM public.wf_approval_step_up WHERE id = wf12t.id('stepup_su'))
  AND EXISTS (SELECT 1 FROM public.wf_approval WHERE id = wf12t.id('appr_au'))
  AND EXISTS (SELECT 1 FROM public.wf_approval_decision WHERE id = wf12t.id('dec_decu')));
SELECT wf12t.expect_true('inbound events: the unreferenced one went, the pending one stayed',
  NOT EXISTS (SELECT 1 FROM public.wf_event WHERE id = wf12t.id('event_e1'))
  AND EXISTS (SELECT 1 FROM public.wf_event WHERE id = wf12t.id('event_e2')));
SELECT wf12t.expect_true('the other organization''s rows were not touched by this organization''s purge',
  wf12t.snapshot_counts('orgB') = (SELECT b FROM wf12_before));
SELECT wf12t.expect_true('the audit chain lost nothing and the broker ledger lost nothing',
  (SELECT count(*) FROM public.audit_chain WHERE org_id = wf12t.id('orgA') AND action NOT LIKE 'workflow.retention.%')
    >= (SELECT audit_a FROM wf12_before)
  AND (SELECT count(*) FROM public.cg_tool_call_ledger) = (SELECT ledger FROM wf12_before));
SELECT wf12t.expect_true('the purge is logged and audited with counts only',
  (SELECT mode = 'purge' AND outcome = 'completed' AND counts = (:'phaseA_dry'::jsonb -> 'counts')
     FROM public.wf_retention_run WHERE id = wf12t.id('purge_a'))
  AND wf12t.audits('orgA', 'workflow.retention.purge') = 1);
SELECT wf12t.expect_true('the purge records which dry run authorized it',
  (SELECT dry_run_id = wf12t.id('dry_a') FROM public.wf_retention_run WHERE id = wf12t.id('purge_a')));
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_error('a dry run authorizes one purge, once: naming it again is refused',
  format($q$SELECT public.wf_retention_run_manual(%L, false, %L)$q$, wf12t.id('adminA'), wf12t.id('dry_a')), '42501', 'wf12:dry_run_required');
SELECT wf12t.logout();
SELECT wf12t.expect_error('the log is append-only (no update)',
  $q$UPDATE public.wf_retention_run SET truncated = true$q$, '42501');
SELECT wf12t.expect_error('the retention log cannot be deleted from', $q$DELETE FROM public.wf_retention_run$q$, '42501');
SELECT wf12t.login_as('service_role');
SELECT public.wf_retention_run_manual(wf12t.id('adminA'), true, NULL) AS dry2 \gset again_
SELECT wf12t.logout();
SELECT wf12t.expect_true('a second pass finds nothing more to do (idempotent)',
  (SELECT bool_and(value::integer = 0) FROM jsonb_each_text(:'again_dry2'::jsonb -> 'counts')));

-- Phase B: the evidence window shrinks to its minimum; approval evidence now goes with its run.
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminA', '{"retention_evidence_days": 730}');
SELECT public.wf_retention_run_manual(wf12t.id('adminA'), true, NULL) AS dry \gset phaseB_
SELECT wf12t.logout();
SELECT wf12t.expect_true('phase B dry run: the approval, its decision, its step-up evidence, both steps and the run',
  (:'phaseB_dry'::jsonb -> 'counts') = '{"outbox":0,"drafts":0,"run_events":0,"unused_step_up":0,"approval_decisions":1,"approval_step_up":1,"approvals":1,"step_runs":2,"runs":1,"inbound_events":0}'::jsonb);
SELECT wf12t.expect_true('evidence is still there after a dry run', EXISTS (SELECT 1 FROM public.wf_approval_decision WHERE id = wf12t.id('dec_dec4')));
SELECT wf12t.keep('dry_b', (:'phaseB_dry'::jsonb ->> 'run_id')::uuid);
SELECT wf12t.login_as('service_role');
SELECT public.wf_retention_run_manual(wf12t.id('adminA'), false, wf12t.id('dry_b')) AS purge \gset phaseB_
SELECT wf12t.logout();
SELECT wf12t.expect_true('phase B purge removed the evidence tree and the run, and nothing else',
  NOT EXISTS (SELECT 1 FROM public.wf_approval WHERE id = wf12t.id('appr_a4'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_approval_decision WHERE id = wf12t.id('dec_dec4'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_approval_step_up WHERE id = wf12t.id('stepup_s4'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r4'))
  AND EXISTS (SELECT 1 FROM public.wf_approval WHERE id = wf12t.id('appr_a3'))
  AND EXISTS (SELECT 1 FROM public.wf_approval WHERE id = wf12t.id('appr_au'))
  AND (:'phaseB_purge'::jsonb -> 'counts') = (:'phaseB_dry'::jsonb -> 'counts'));
SELECT wf12t.expect_true('the dry run id is single-use in effect: a later purge with it deletes whatever is eligible now (nothing)',
  (SELECT bool_and(value::integer = 0) FROM jsonb_each_text(
     public.wf_retention_execute(wf12t.id('orgA'), false, wf12t.id('adminA'), 'manual') -> 'counts')));

-- Bulk and truncation: more than one batch of events.
SELECT wf12t.mkrun('bulk', 'wf12-a', 'succeeded', 120);
SET LOCAL session_replication_role = replica;
INSERT INTO public.wf_run_event (org_id, run_id, kind, actor_kind, actor_ref, detail, at)
SELECT wf12t.id('orgA'), wf12t.id('run_bulk'), 'bulk.event', 'system', 'wf12', '{}'::jsonb, now() - interval '100 days'
  FROM generate_series(1, 5001);
SET LOCAL session_replication_role = origin;
SELECT wf12t.login_as('service_role');
SELECT public.wf_retention_run_manual(wf12t.id('adminA'), true, NULL) AS dry \gset bulk_
SELECT wf12t.logout();
SELECT wf12t.expect_true('a pass is bounded: 5000 rows at most per class, and it says it was cut short',
  (:'bulk_dry'::jsonb -> 'counts' ->> 'run_events')::integer = 5000 AND (:'bulk_dry'::jsonb ->> 'truncated')::boolean);
SELECT wf12t.keep('dry_bulk', (:'bulk_dry'::jsonb ->> 'run_id')::uuid);
SELECT wf12t.login_as('service_role');
SELECT public.wf_retention_run_manual(wf12t.id('adminA'), false, wf12t.id('dry_bulk')) AS p1 \gset bulk_
SELECT public.wf_retention_run_manual(wf12t.id('adminA'), true, NULL) AS d2 \gset bulk_
SELECT wf12t.logout();
SELECT wf12t.expect_true('the next pass takes the rest and is no longer truncated',
  (:'bulk_d2'::jsonb -> 'counts' ->> 'run_events')::integer = 1 AND NOT (:'bulk_d2'::jsonb ->> 'truncated')::boolean
  AND (SELECT count(*) = 1 FROM public.wf_run_event WHERE run_id = wf12t.id('run_bulk') AND kind = 'bulk.event'));

-- A stale dry run (older than 24 hours) cannot authorize a purge.
SET LOCAL session_replication_role = replica;
INSERT INTO public.wf_retention_run (id, org_id, mode, trigger_kind, actor_id, outcome, created_at)
VALUES ('f1260000-0000-4000-8000-000000000001', wf12t.id('orgA'), 'dry_run', 'manual', wf12t.id('adminA'), 'completed', now() - interval '2 days');
SET LOCAL session_replication_role = origin;
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_error('a dry run from two days ago does not authorize a purge',
  format($q$SELECT public.wf_retention_run_manual(%L, false, 'f1260000-0000-4000-8000-000000000001')$q$, wf12t.id('adminA')), '42501', 'wf12:dry_run_required');
SELECT wf12t.expect_error('a purge log row is not a dry run either',
  format($q$SELECT public.wf_retention_run_manual(%L, false, %L)$q$, wf12t.id('adminA'), wf12t.id('purge_a')), '42501', 'wf12:dry_run_required');
SELECT wf12t.logout();

-- Legal hold (the M12 retention work): refused, logged, nothing deleted, and it ends when the hold is released.
INSERT INTO public.retention_legal_holds (id, org_id, hold_scope, reason, created_by)
VALUES ('f1270000-0000-4000-8000-000000000001', wf12t.id('orgB'), 'tenant', 'fixture hold', wf12t.id('adminB'));
SELECT wf12t.expect_true('the hold is visible to the purge', public.wf_retention_legal_hold(wf12t.id('orgB'))
  AND NOT public.wf_retention_legal_hold(wf12t.id('orgA')));
SELECT wf12t.login_as('service_role');
SELECT public.wf_retention_run_manual(wf12t.id('adminB'), true, NULL) AS dry \gset hold_
SELECT wf12t.logout();
SELECT wf12t.expect_true('a dry run under a legal hold is refused with a code and counts nothing',
  :'hold_dry'::jsonb ->> 'outcome' = 'refused' AND :'hold_dry'::jsonb ->> 'refusal_code' = 'legal_hold'
  AND :'hold_dry'::jsonb -> 'counts' = '{}'::jsonb
  AND EXISTS (SELECT 1 FROM public.wf_retention_run WHERE org_id = wf12t.id('orgB') AND outcome = 'refused' AND refusal_code = 'legal_hold')
  AND wf12t.audits('orgB', 'workflow.retention.refused') = 1);
SELECT wf12t.expect_true('a scheduled-style purge under the hold deletes nothing either',
  (public.wf_retention_execute(wf12t.id('orgB'), false, NULL, 'scheduler') ->> 'refusal_code') = 'legal_hold'
  AND wf12t.snapshot_counts('orgB') = (SELECT b FROM wf12_before));
UPDATE public.retention_legal_holds SET active = false, released_by = wf12t.id('adminB'), released_at = now(), release_reason = 'fixture release'
 WHERE id = 'f1270000-0000-4000-8000-000000000001';
SELECT wf12t.login_as('service_role');
SELECT public.wf_retention_run_manual(wf12t.id('adminB'), true, NULL) AS dry \gset hold2_
SELECT wf12t.logout();
SELECT wf12t.expect_true('after the hold is released the same organization''s dry run counts its eligible rows',
  :'hold2_dry'::jsonb ->> 'outcome' = 'completed' AND (:'hold2_dry'::jsonb -> 'counts' ->> 'runs')::integer = 1
  AND (:'hold2_dry'::jsonb -> 'counts' ->> 'outbox')::integer = 1);

-- The scheduler: only organizations that opted in, each at most once a day, never a person.
SELECT wf12t.mkrun('r11', 'wf12-a', 'succeeded', 400);
SELECT wf12t.mkstep('r11_s', 'r11', 'send', 'action', 'succeeded');
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_true('with no organization opted in the scheduler does nothing',
  public.wf_retention_run_scheduled(20) = '{"orgs": []}'::jsonb);
SELECT wf12t.setlimits('adminA', '{"retention_auto_purge": true}');
SELECT public.wf_retention_run_scheduled(20) AS sched \gset s1_
SELECT wf12t.logout();
SELECT wf12t.expect_true('the scheduler purged the opted-in organization only (not organization B)',
  jsonb_array_length(:'s1_sched'::jsonb -> 'orgs') = 1 AND :'s1_sched'::jsonb -> 'orgs' -> 0 ->> 'org_id' = wf12t.id('orgA')::text
  AND NOT EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r11'))
  AND wf12t.snapshot_counts('orgB') = (SELECT b FROM wf12_before));
SELECT wf12t.expect_true('a scheduled purge is logged as the scheduler with no person, and audited',
  EXISTS (SELECT 1 FROM public.wf_retention_run WHERE org_id = wf12t.id('orgA') AND trigger_kind = 'scheduler'
            AND actor_id IS NULL AND mode = 'purge' AND outcome = 'completed')
  AND wf12t.audits('orgA', 'workflow.retention.purge') = 5);
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_true('a second scheduler call within a day skips the organization',
  public.wf_retention_run_scheduled(20) = '{"orgs": []}'::jsonb);
SELECT wf12t.logout();
SELECT wf12t.login_as('authenticated');
SELECT wf12t.expect_error('a client cannot call the scheduler', $q$SELECT public.wf_retention_run_scheduled(20)$q$, '42501');
SELECT wf12t.logout();

-- One organization failing does not stop the others. Organization B opts in and gets a failing insert on its log;
-- both organizations are made eligible again (their earlier scheduler rows are removed with triggers skipped).
SELECT wf12t.mkrun('r12', 'wf12-a', 'succeeded', 400);
SELECT wf12t.mkstep('r12_s', 'r12', 'send', 'action', 'succeeded');
SET LOCAL session_replication_role = replica;
DELETE FROM public.wf_retention_run WHERE org_id IN (wf12t.id('orgA'), wf12t.id('orgB')) AND trigger_kind = 'scheduler';
SET LOCAL session_replication_role = origin;
CREATE FUNCTION wf12t.fail_orgb() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.org_id = wf12t.id('orgB') THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER wf12_fail_orgb BEFORE INSERT ON public.wf_retention_run FOR EACH ROW EXECUTE FUNCTION wf12t.fail_orgb();
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminB', '{"retention_auto_purge": true}');
SELECT public.wf_retention_run_scheduled(20) AS sched \gset s3_
SELECT wf12t.logout();
SELECT wf12t.expect_true('the scheduler reported organization B as failed (by code only) and still purged organization A',
  jsonb_array_length(:'s3_sched'::jsonb -> 'orgs') = 2
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'s3_sched'::jsonb -> 'orgs') o
               WHERE o ->> 'org_id' = wf12t.id('orgB')::text AND o ->> 'outcome' = 'failed' AND o ->> 'sqlstate' = 'P0001')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'s3_sched'::jsonb -> 'orgs') o
               WHERE o ->> 'org_id' = wf12t.id('orgA')::text AND o ->> 'outcome' = 'completed')
  AND NOT EXISTS (SELECT 1 FROM public.wf_run WHERE id = wf12t.id('run_r12'))
  AND wf12t.snapshot_counts('orgB') = (SELECT b FROM wf12_before));
SELECT wf12t.expect_true('the failure is audited and left no log row (the audit entry holds hashes, never the error text)',
  wf12t.audits('orgB', 'workflow.retention.failed') = 1
  AND NOT EXISTS (SELECT 1 FROM public.wf_retention_run WHERE org_id = wf12t.id('orgB') AND trigger_kind = 'scheduler'));
-- A second and third call while the fault persists still report the failure but add no audit rows.
SELECT wf12t.login_as('service_role');
SELECT public.wf_retention_run_scheduled(20) AS sched4 \gset s4_
SELECT public.wf_retention_run_scheduled(20) AS sched5 \gset s5_
SELECT wf12t.logout();
SELECT wf12t.expect_true('a persistent failure is reported on every call but audited once',
  EXISTS (SELECT 1 FROM jsonb_array_elements(:'s4_sched4'::jsonb -> 'orgs') o
           WHERE o ->> 'org_id' = wf12t.id('orgB')::text AND o ->> 'outcome' = 'failed')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'s5_sched5'::jsonb -> 'orgs') o
               WHERE o ->> 'org_id' = wf12t.id('orgB')::text AND o ->> 'outcome' = 'failed')
  AND wf12t.audits('orgB', 'workflow.retention.failed') = 1);
DROP TRIGGER wf12_fail_orgb ON public.wf_retention_run;
SELECT wf12t.login_as('service_role');
SELECT wf12t.setlimits('adminB', '{"retention_auto_purge": false}');
SELECT wf12t.logout();

-- The quota windows count created_at, so a caller cannot choose it (all triggers on).
SELECT wf12t.mkrun('forge', 'wf12-a', 'running', 0);
SELECT wf12t.mkstep('forge_s', 'forge', 'send', 'action', 'waiting');
CREATE FUNCTION wf12t.forge_created() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ver public.wf_version%ROWTYPE; v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_ver FROM public.wf_version WHERE id = wf12t.id('ver_wf12-a');
  INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
    step_count, started_by, deadline_at, started_at, agent_ref, created_at)
  VALUES (wf12t.keep('run_forged', gen_random_uuid()), v_ver.org_id, v_ver.definition_id, v_ver.id, 'wf12-forged-run', 'running',
    3, 20, 0, wf12t.id('adminA'), now() + interval '1 hour', now(), 'wf12-agent', now() - interval '3 days');
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf12t.id('run_forge');
  INSERT INTO public.wf_action_draft (org_id, run_id, step_run_id, kind, category, template_ref, recipient_ids, idempotency_key, created_at)
  VALUES (v_run.org_id, v_run.id, wf12t.id('step_forge_s'), 'email', 'communication', 'notice.a', wf12t.rids(1), 'wf12-forged-d1', now() - interval '3 days');
  INSERT INTO public.wf_action_sandbox_outbox (org_id, run_id, step_run_id, kind, category, template_ref, recipient_ids,
    broker_decision_id, idempotency_key, created_at)
  VALUES (v_run.org_id, v_run.id, wf12t.id('step_forge_s'), 'email', 'communication', 'notice.a', wf12t.rids(1),
    wf12t.decision(v_run.org_id, 'email', 'wf12-forged-o1'), 'wf12-forged-o1', now() - interval '3 days');
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf12t TO anon, authenticated, service_role;
SELECT wf12t.forge_created();
SELECT wf12t.expect_true('a run, a draft and an executed record inserted with a created_at three days ago are stamped with now',
  (SELECT created_at > now() - interval '1 minute' FROM public.wf_run WHERE id = wf12t.id('run_forged'))
  AND (SELECT created_at > now() - interval '1 minute' FROM public.wf_action_draft WHERE idempotency_key = 'wf12-forged-d1')
  AND (SELECT created_at > now() - interval '1 minute' FROM public.wf_action_sandbox_outbox WHERE idempotency_key = 'wf12-forged-o1'));
SELECT wf12t.expect_error('the stamp of an executed record cannot be moved later',
  $q$UPDATE public.wf_action_sandbox_outbox SET created_at = created_at - interval '3 days' WHERE idempotency_key = 'wf12-forged-o1'$q$, '42501', 'immutable');

-- An approved draft that can never execute is parked once a day, with a clear code, and re-listed after that.
SELECT wf12t.old_approval('pk', 'forge', 'forge_s', 'approved', 0);
SELECT wf12t.old_draft('park', 'forge', 'forge_s', 'approved', 'pk', 0);
SELECT wf12t.expect_true('the approved draft is on the sweep''s work list',
  EXISTS (SELECT 1 FROM public.wf_approved_drafts_ready(200) w WHERE w.draft_id = (SELECT id FROM public.wf_action_draft WHERE idempotency_key = 'wf12-old-draft-park')));
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_error('only the two codes that cannot clear by themselves can park a draft',
  format($q$SELECT public.wf_block_draft_dispatch(%L, %L, 'spend_cap_day')$q$, wf12t.id('orgA'),
         (SELECT id FROM public.wf_action_draft WHERE idempotency_key = 'wf12-old-draft-park')), '22023');
SELECT public.wf_block_draft_dispatch(wf12t.id('orgA'), (SELECT id FROM public.wf_action_draft WHERE idempotency_key = 'wf12-old-draft-park'), 'spend_rate_unknown') AS first \gset park_
SELECT public.wf_block_draft_dispatch(wf12t.id('orgA'), (SELECT id FROM public.wf_action_draft WHERE idempotency_key = 'wf12-old-draft-park'), 'spend_rate_unknown') AS again \gset park_
SELECT wf12t.logout();
SELECT wf12t.expect_true('parking writes one clear timeline event, and a second call within the day writes nothing more',
  :'park_first' = 't' AND :'park_again' = 'f'
  AND (SELECT count(*) = 1 AND bool_and(detail ->> 'code' = 'spend_rate_unknown') FROM public.wf_run_event
        WHERE kind = 'draft.dispatch_blocked' AND detail ->> 'draft_id' = (SELECT id::text FROM public.wf_action_draft WHERE idempotency_key = 'wf12-old-draft-park')));
SELECT wf12t.expect_true('a parked draft leaves the work list',
  NOT EXISTS (SELECT 1 FROM public.wf_approved_drafts_ready(200) w WHERE w.draft_id = (SELECT id FROM public.wf_action_draft WHERE idempotency_key = 'wf12-old-draft-park')));
SET LOCAL session_replication_role = replica;
UPDATE public.wf_run_event SET at = at - interval '2 days' WHERE kind = 'draft.dispatch_blocked';
SET LOCAL session_replication_role = origin;
SELECT wf12t.expect_true('after a day it is listed again, so a decided price releases it without anyone touching the draft',
  EXISTS (SELECT 1 FROM public.wf_approved_drafts_ready(200) w WHERE w.draft_id = (SELECT id FROM public.wf_action_draft WHERE idempotency_key = 'wf12-old-draft-park')));

-- The append-only locks stay shut for everybody who is not the purge.
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_error('the service role cannot delete run events', $q$DELETE FROM public.wf_run_event$q$, '42501');
SELECT wf12t.expect_error('the service role cannot delete approval decisions', $q$DELETE FROM public.wf_approval_decision$q$, '42501');
SELECT wf12t.expect_error('the service role cannot delete step-up evidence', $q$DELETE FROM public.wf_approval_step_up$q$, '42501');
SELECT wf12t.expect_error('the service role cannot delete runs', $q$DELETE FROM public.wf_run$q$, '42501');
SELECT wf12t.logout();
SELECT wf12t.login_as('authenticated');
SELECT wf12t.expect_error('an authenticated client cannot delete run events', $q$DELETE FROM public.wf_run_event$q$, '42501');
SELECT wf12t.logout();
SELECT wf12t.expect_error('without the purge marker even the owner cannot delete a run event',
  format($q$DELETE FROM public.wf_run_event WHERE run_id = %L$q$, wf12t.id('run_r3')), '42501', 'append-only');
SELECT wf12t.expect_error('without the purge marker even the owner cannot delete a decision',
  format($q$DELETE FROM public.wf_approval_decision WHERE id = %L$q$, wf12t.id('dec_decu')), '42501', 'append-only');
SELECT wf12t.expect_error('without the purge marker even the owner cannot delete step-up evidence',
  format($q$DELETE FROM public.wf_approval_step_up WHERE id = %L$q$, wf12t.id('stepup_s3')), '42501', 'append-only');
SELECT set_config('wf.retention_purge', 'org:' || wf12t.id('orgB')::text || ':' || txid_current()::text, true);
SELECT wf12t.expect_error('a marker for another organization does not open this organization''s rows',
  format($q$DELETE FROM public.wf_run_event WHERE run_id = %L$q$, wf12t.id('run_r3')), '42501', 'append-only');
SELECT set_config('wf.retention_purge', 'org:' || wf12t.id('orgA')::text || ':' || (txid_current() + 1)::text, true);
SELECT wf12t.expect_error('a marker from another transaction does not open anything',
  format($q$DELETE FROM public.wf_run_event WHERE run_id = %L$q$, wf12t.id('run_r3')), '42501', 'append-only');
SELECT set_config('wf.retention_purge', 'org:' || wf12t.id('orgA')::text || ':' || txid_current()::text, true);
SELECT wf12t.expect_true('the marker is honoured for its own organization and transaction when the session is not a client role',
  public.wf_retention_delete_allowed(wf12t.id('orgA')) AND NOT public.wf_retention_delete_allowed(wf12t.id('orgB')));
SELECT wf12t.login_as('service_role');
SELECT wf12t.expect_error('a client role cannot even call the marker check (and has no DELETE privilege anyway)',
  format($q$SELECT public.wf_retention_delete_allowed(%L)$q$, wf12t.id('orgA')), '42501');
SELECT wf12t.logout();
SELECT set_config('wf.retention_purge', '', true);
SELECT wf12t.expect_error('UPDATE of a run event is still refused', format($q$UPDATE public.wf_run_event SET kind = 'x.y' WHERE run_id = %L$q$, wf12t.id('run_r3')), '42501', 'append-only');
SELECT wf12t.expect_error('UPDATE of a decision is still refused', format($q$UPDATE public.wf_approval_decision SET note = 'x' WHERE id = %L$q$, wf12t.id('dec_decu')), '42501', 'append-only');
SELECT wf12t.expect_error('UPDATE of step-up evidence fields is still refused', format($q$UPDATE public.wf_approval_step_up SET content_digest = repeat('f', 64) WHERE id = %L$q$, wf12t.id('stepup_s3')), '42501', 'immutable');
SELECT wf12t.expect_error('TRUNCATE of run events is still refused', $q$TRUNCATE public.wf_run_event$q$, '42501', 'append-only');
SELECT wf12t.expect_error('TRUNCATE of decisions is still refused', $q$TRUNCATE public.wf_approval_decision$q$, '42501', 'append-only');
SELECT wf12t.expect_error('TRUNCATE of step-up evidence is still refused (a foreign key from decisions stops it)', $q$TRUNCATE public.wf_approval_step_up$q$, '0A000');
SELECT wf12t.expect_true('the settings read now reports a last retention run (ties inside one transaction are unordered) for the organization',
  (SELECT d -> 'last_retention' ->> 'outcome' = 'completed' AND d -> 'last_retention' -> 'counts' IS NOT NULL
     FROM (SELECT public.wf_limits_get(wf12t.id('adminA')) d) x));

SELECT wf12t.logout();
SELECT 'WF12 ALL PASS: ' || count(*) || ' checks' FROM wf12t.passed;
ROLLBACK;
