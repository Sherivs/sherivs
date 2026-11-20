-- AIN-02 one autonomy scale, per-step enforcement and the promotion gate: structure and exact privileges, the reviewed
-- data, the effective-level function, the earned-level write gate (insert, update, upsert, delete, replay), evidence,
-- promotion (founder only, one rung, fresh single-use evidence, ceilings, boundary cases), demotion, automatic demotion on
-- regression, the ledger guard as a backstop, the outbox backstop, the run freeze, cross-organization isolation and audit.
-- Local disposable Postgres only. All synthetic records roll back.
BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'AIN02 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.wf_autonomy_change') IS NULL
     OR to_regprocedure('public.wf_autonomy_promote(uuid,uuid,text,text,uuid,text)') IS NULL
     OR to_regprocedure('public.wf_agent_state_code(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'AIN02 FAIL: the AIN-01 and AIN-02 migrations must be present';
  END IF;
  IF to_regclass('public.org_agent_addon_events') IS NOT NULL THEN
    RAISE EXCEPTION 'AIN02 FAIL: the real organization add-on log exists; replace the stub in this harness with it';
  END IF;
END $guard$;

CREATE SCHEMA ain02t;
GRANT USAGE ON SCHEMA ain02t TO anon, authenticated, service_role;
CREATE TABLE ain02t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE ain02t.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT, UPDATE ON ain02t.passed, ain02t.ids TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE ain02t.passed_n_seq TO anon, authenticated, service_role;
CREATE FUNCTION ain02t.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ain02t.passed (label) VALUES (p_label);
  RAISE NOTICE 'AIN02 PASS %', p_label;
END $$;
CREATE FUNCTION ain02t.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'AIN02 FAIL [%]', p_label; END IF;
  PERFORM ain02t.pass(p_label);
END $$;
CREATE FUNCTION ain02t.expect_error(p_label text, p_sql text, p_state text, p_msg text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state AND (p_msg IS NULL OR SQLERRM LIKE '%' || p_msg || '%') THEN
      PERFORM ain02t.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'AIN02 FAIL [%]: expected SQLSTATE % (%) got % (%)', p_label, p_state, p_msg, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'AIN02 FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION ain02t.id(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM ain02t.ids WHERE name = p_name
$$;
CREATE FUNCTION ain02t.keep(p_name text, p_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ain02t.ids VALUES (p_name, p_id) ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id;
  RETURN p_id;
END $$;
CREATE FUNCTION ain02t.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION ain02t.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ain02t TO anon, authenticated, service_role;

INSERT INTO ain02t.ids (name, id) VALUES
  ('orgA', 'f2600000-0000-4000-8000-0000000000a1'),
  ('orgB', 'f2600000-0000-4000-8000-0000000000b2'),
  ('adminA', 'f2600000-0000-4000-8000-000000000001'),
  ('viewer', 'f2600000-0000-4000-8000-000000000002'),
  ('adminB', 'f2600000-0000-4000-8000-000000000004'),
  ('founder', 'f2600000-0000-4000-8000-000000000005'),
  ('retired_founder', 'f2600000-0000-4000-8000-000000000006'),
  ('author', 'f2600000-0000-4000-8000-000000000007'),
  ('publisher', 'f2600000-0000-4000-8000-000000000008');

-- ---------------------------------------------------------------------------------------------
-- 1. Structure, exact privileges and function hygiene
-- ---------------------------------------------------------------------------------------------
SELECT ain02t.expect_true('the six new tables have RLS enabled and forced',
  (SELECT count(*) = 6 AND bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
    WHERE oid IN ('public.wf_autonomy_scale'::regclass, 'public.wf_autonomy_class_cap'::regclass,
                  'public.wf_autonomy_agent_tier_cap'::regclass, 'public.wf_autonomy_bar'::regclass,
                  'public.wf_autonomy_evidence'::regclass, 'public.wf_autonomy_change'::regclass)));
SELECT ain02t.expect_true('no client role can touch a new table; the service role only reads',
  NOT EXISTS (SELECT 1 FROM (VALUES ('public.wf_autonomy_scale'), ('public.wf_autonomy_class_cap'),
                ('public.wf_autonomy_agent_tier_cap'), ('public.wf_autonomy_bar'), ('public.wf_autonomy_evidence'),
                ('public.wf_autonomy_change')) t(n)
               WHERE has_table_privilege('anon', t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                  OR has_table_privilege('authenticated', t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                  OR has_table_privilege('service_role', t.n, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                  OR NOT has_table_privilege('service_role', t.n, 'SELECT')));
SELECT ain02t.expect_true('PUBLIC holds no privilege on any new table',
  NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
               WHERE c.oid IN ('public.wf_autonomy_scale'::regclass, 'public.wf_autonomy_class_cap'::regclass,
                  'public.wf_autonomy_agent_tier_cap'::regclass, 'public.wf_autonomy_bar'::regclass,
                  'public.wf_autonomy_evidence'::regclass, 'public.wf_autonomy_change'::regclass)
                 AND a.grantee = 0));
SELECT ain02t.expect_true('the earned level: the service role keeps SELECT and has no write, truncate or trigger right',
  has_table_privilege('service_role', 'public.wf_agent_autonomy', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.wf_agent_autonomy', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT has_table_privilege('authenticated', 'public.wf_agent_autonomy', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('anon', 'public.wf_agent_autonomy', 'SELECT,INSERT,UPDATE,DELETE'));
SELECT ain02t.expect_true('exactly three AIN-02 functions execute for the service role; nothing executes for tenant roles',
  (SELECT count(*) = 3 AND bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_autonomy_record_evidence', 'wf_autonomy_promote', 'wf_autonomy_demote'))
  AND (SELECT count(*) = 13 AND bool_and(NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_autonomy_rank', 'wf_autonomy_level_of', 'wf_autonomy_demote_floor', 'wf_autonomy_append_only',
        'wf_autonomy_ceiling', 'wf_effective_autonomy', 'wf_autonomy_write_gate', 'wf_autonomy_change_guard',
        'wf_autonomy_change_audit', 'wf_autonomy_apply', 'wf_action_sandbox_outbox_autonomy_guard',
        'wf_run_freeze_actor', 'wf_autonomy_guard'))
);
SELECT ain02t.expect_true('PUBLIC can execute no AIN-02 function',
  NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               WHERE p.pronamespace = 'public'::regnamespace AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
                 AND (p.proname LIKE 'wf\_autonomy\_%' OR p.proname IN ('wf_effective_autonomy',
                      'wf_action_sandbox_outbox_autonomy_guard', 'wf_run_freeze_actor'))));
SELECT ain02t.expect_true('every AIN-02 function pins an empty search_path',
  (SELECT count(*) = 16 AND bool_and(p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND (p.proname LIKE 'wf\_autonomy\_%' OR p.proname IN ('wf_effective_autonomy',
           'wf_action_sandbox_outbox_autonomy_guard', 'wf_run_freeze_actor'))));
SELECT ain02t.expect_true('the three entry points and every guard are SECURITY DEFINER; the pure helpers are not',
  (SELECT bool_and(p.prosecdef) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('wf_autonomy_record_evidence', 'wf_autonomy_promote', 'wf_autonomy_demote', 'wf_autonomy_apply',
      'wf_autonomy_write_gate', 'wf_autonomy_change_guard', 'wf_autonomy_change_audit', 'wf_autonomy_ceiling',
      'wf_effective_autonomy', 'wf_autonomy_guard', 'wf_action_sandbox_outbox_autonomy_guard', 'wf_run_freeze_actor'))
  AND (SELECT NOT bool_or(p.prosecdef) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('wf_autonomy_rank', 'wf_autonomy_level_of', 'wf_autonomy_demote_floor', 'wf_autonomy_append_only')));
SELECT ain02t.expect_true('the guards are wired where the design says',
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_agent_autonomy'::regclass
            AND t.tgname = 'wf_agent_autonomy_05_gate' AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4
            AND t.tgtype & 8 = 8 AND t.tgtype & 16 = 16 AND NOT t.tgisinternal)
  AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_action_sandbox_outbox'::regclass
            AND t.tgname = 'wf_action_sandbox_outbox_90_autonomy' AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4
            AND t.tgtype & 16 = 16)
  AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_run'::regclass
            AND t.tgname = 'wf_run_08_freeze_actor' AND t.tgtype & 16 = 16)
  AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_autonomy_change'::regclass
            AND t.tgname = 'wf_autonomy_change_10_guard' AND t.tgtype & 4 = 4)
  AND 'wf_action_sandbox_outbox_90_autonomy' > 'wf_action_sandbox_outbox_30_quota');
SELECT ain02t.expect_true('the step guard is now one function over the one scale (SECURITY DEFINER, empty search_path)',
  EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.wf_autonomy_guard()'::regprocedure AND p.prosecdef
            AND p.proconfig @> ARRAY['search_path=""'])
  AND pg_get_functiondef('public.wf_autonomy_guard()'::regprocedure) LIKE '%wf_effective_autonomy%');

-- ---------------------------------------------------------------------------------------------
-- 2. The scale and the reviewed data
-- ---------------------------------------------------------------------------------------------
SELECT ain02t.expect_true('the scale has four levels in one order, each on its own ladder state',
  (SELECT count(*) = 4 FROM public.wf_autonomy_scale)
  AND (SELECT string_agg(level, ',' ORDER BY rank) = 'suggest,draft,act_with_approval,act_and_report'
         FROM public.wf_autonomy_scale)
  AND (SELECT string_agg(ladder_state, ',' ORDER BY rank) = 'shadow,propose,assist,autonomous' FROM public.wf_autonomy_scale));
SELECT ain02t.expect_true('the rank function agrees with the table for every level and ranks nothing else above suggest',
  NOT EXISTS (SELECT 1 FROM public.wf_autonomy_scale s WHERE public.wf_autonomy_rank(s.level) <> s.rank)
  AND public.wf_autonomy_rank(NULL) = 0 AND public.wf_autonomy_rank('act_and_reportt') = 0
  AND public.wf_autonomy_rank('ACT_AND_REPORT') = 0 AND public.wf_autonomy_rank('') = 0);
SELECT ain02t.expect_true('level_of is the inverse for ranks 0 to 3 and clamps anything else',
  NOT EXISTS (SELECT 1 FROM public.wf_autonomy_scale s WHERE public.wf_autonomy_level_of(s.rank) <> s.level)
  AND public.wf_autonomy_level_of(-5) = 'suggest' AND public.wf_autonomy_level_of(99) = 'act_and_report'
  AND public.wf_autonomy_level_of(NULL) = 'suggest');
SELECT ain02t.expect_true('the promotion bars restate the ladder (20/0.90, 50/0.95, 200/0.98, 30 days) and the demote floor is 0.90',
  (SELECT count(*) = 3 FROM public.wf_autonomy_bar)
  AND EXISTS (SELECT 1 FROM public.wf_autonomy_bar WHERE target_level = 'draft' AND min_graded = 20 AND min_pass_rate = 0.900 AND max_age_days = 30)
  AND EXISTS (SELECT 1 FROM public.wf_autonomy_bar WHERE target_level = 'act_with_approval' AND min_graded = 50 AND min_pass_rate = 0.950 AND max_age_days = 30)
  AND EXISTS (SELECT 1 FROM public.wf_autonomy_bar WHERE target_level = 'act_and_report' AND min_graded = 200 AND min_pass_rate = 0.980 AND max_age_days = 30)
  AND public.wf_autonomy_demote_floor() = 0.900);
SELECT ain02t.expect_true('the six capped classes, unclassified and ai_model never exceed draft; the four plain classes reach act_and_report',
  (SELECT count(*) = 12 FROM public.wf_autonomy_class_cap)
  AND (SELECT bool_and(max_level = 'draft') FROM public.wf_autonomy_class_cap
        WHERE action_class IN ('money_movement', 'safeguarding', 'credential_change', 'public_publish', 'mass_message',
                               'external_authority_share', 'unclassified'))
  AND (SELECT max_level = 'suggest' FROM public.wf_autonomy_class_cap WHERE action_class = 'ai_model')
  AND (SELECT bool_and(max_level = 'act_and_report') FROM public.wf_autonomy_class_cap
        WHERE action_class IN ('internal', 'communication', 'task', 'wait')));
SELECT ain02t.expect_true('every class the AIN-01 tier table can reach has a cap row',
  NOT EXISTS (SELECT 1 FROM public.wf_agent_tier_action_class t
               WHERE NOT EXISTS (SELECT 1 FROM public.wf_autonomy_class_cap c WHERE c.action_class = t.action_class)));
SELECT ain02t.expect_true('the agent tier caps: executive approval, department and organization act_and_report, assurance draft',
  (SELECT string_agg(agent_tier || '=' || max_level, ',' ORDER BY agent_tier) =
     'assurance=draft,department=act_and_report,executive=act_with_approval,organization=act_and_report'
     FROM public.wf_autonomy_agent_tier_cap));
SELECT ain02t.expect_error('money movement cannot be raised above draft in the class table',
  $q$UPDATE public.wf_autonomy_class_cap SET max_level = 'act_with_approval' WHERE action_class = 'money_movement'$q$, '23514');
SELECT ain02t.expect_error('safeguarding cannot be raised above draft in the class table',
  $q$UPDATE public.wf_autonomy_class_cap SET max_level = 'act_and_report' WHERE action_class = 'safeguarding'$q$, '23514');
SELECT ain02t.expect_error('unclassified cannot be raised above draft',
  $q$UPDATE public.wf_autonomy_class_cap SET max_level = 'act_with_approval' WHERE action_class = 'unclassified'$q$, '23514');
SELECT ain02t.expect_error('ai_model cannot be raised above draft',
  $q$UPDATE public.wf_autonomy_class_cap SET max_level = 'act_and_report' WHERE action_class = 'ai_model'$q$, '23514');
SELECT ain02t.expect_error('an assurance agent tier cannot be given more than draft',
  $q$UPDATE public.wf_autonomy_agent_tier_cap SET max_level = 'act_with_approval' WHERE agent_tier = 'assurance'$q$, '23514');
SELECT ain02t.expect_error('the executive tier cannot be made autonomous',
  $q$UPDATE public.wf_autonomy_agent_tier_cap SET max_level = 'act_and_report' WHERE agent_tier = 'executive'$q$, '23514');
SELECT ain02t.expect_error('a level that is not on the scale is refused in a cap',
  $q$INSERT INTO public.wf_autonomy_class_cap (action_class, max_level) VALUES ('odd_class', 'autonomous')$q$, '23503');
SELECT ain02t.expect_error('there is no bar for the floor level',
  $q$INSERT INTO public.wf_autonomy_bar (target_level, min_graded, min_pass_rate, max_age_days) VALUES ('suggest', 1, 0.9, 30)$q$, '23514');
SELECT ain02t.expect_error('a bar cannot be set below 50 percent',
  $q$UPDATE public.wf_autonomy_bar SET min_pass_rate = 0.4 WHERE target_level = 'draft'$q$, '23514');
SELECT ain02t.expect_error('the scale rows cannot disagree with the rank function',
  $q$UPDATE public.wf_autonomy_scale SET rank = 2 WHERE level = 'draft'$q$, '23514');
SELECT ain02t.expect_error('two levels cannot share a ladder state',
  $q$UPDATE public.wf_autonomy_scale SET ladder_state = 'shadow' WHERE level = 'draft'$q$, '23505');

-- ---------------------------------------------------------------------------------------------
-- 3. Fixtures: organizations, people, a founder, agents, a template, runs
-- ---------------------------------------------------------------------------------------------
INSERT INTO auth.users (id) SELECT id FROM ain02t.ids WHERE name NOT IN ('orgA', 'orgB');
INSERT INTO public.schools (id, name, slug) VALUES
  (ain02t.id('orgA'), 'AIN02 Org A', 'ain02-org-a'),
  (ain02t.id('orgB'), 'AIN02 Org B', 'ain02-org-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (ain02t.id('adminA'), ain02t.id('orgA'), 'AIN02 Admin A', 'admin-a@ain02.invalid', 'admin', true),
  (ain02t.id('viewer'), ain02t.id('orgA'), 'AIN02 Viewer', 'viewer@ain02.invalid', 'teacher', true),
  (ain02t.id('adminB'), ain02t.id('orgB'), 'AIN02 Admin B', 'admin-b@ain02.invalid', 'admin', true);
INSERT INTO public.super_admins (id, full_name, email, is_active) VALUES
  (ain02t.id('founder'), 'AIN02 Founder', 'founder@ain02.invalid', true),
  (ain02t.id('retired_founder'), 'AIN02 Former founder', 'former@ain02.invalid', false);

SELECT set_config('request.jwt.claim.sub', ain02t.id('adminA')::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', ain02t.id('adminA'), 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, assigned_by)
SELECT v.org_id, v.user_id, r.code, t.default_scope, NULL, v.assigned_by
  FROM (VALUES (ain02t.id('orgA'), ain02t.id('viewer'), ain02t.id('adminA'), 'auditor')) v(org_id, user_id, assigned_by, template_code)
  JOIN public.role_catalog r ON r.template_code = v.template_code AND r.org_id IS NULL
   AND NOT coalesce(r.requires_verified_authority_link, false)
  JOIN public.role_templates t ON t.code = r.template_code
 WHERE r.code = (SELECT min(r2.code) FROM public.role_catalog r2
                  WHERE r2.template_code = v.template_code AND r2.org_id IS NULL
                    AND NOT coalesce(r2.requires_verified_authority_link, false));
SELECT ain02t.logout();

INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling) VALUES
  (ain02t.id('orgA'), true, 'act_and_report'),
  (ain02t.id('orgB'), true, 'act_and_report');

CREATE FUNCTION ain02t.mkagent(p_ref text, p_tier text, p_max text, p_supervisor text DEFAULT 'jarvis-executive',
  p_budget integer DEFAULT 100000) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.agent_pause_rules (agent_code, tier, kill_scope) VALUES (p_ref, 'department', 'agent');
  INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier,
      context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
  VALUES (p_ref, 'platform', 'Fixture', p_tier, 'fixture', p_supervisor, '1.0.0', p_max, 'internal', p_budget, 0, 0);
END $$;
SELECT ain02t.mkagent('ain02-dept', 'department', 'T3');
SELECT ain02t.mkagent('ain02-dept2', 'department', 'T1');
SELECT ain02t.mkagent('ain02-assure', 'assurance', 'T1', 'sheriff');
SELECT ain02t.mkagent('ain02-exec', 'executive', 'T1', 'sheriff');
SELECT ain02t.mkagent('ain02-ungranted', 'department', 'T3');
SELECT ain02t.mkagent('ain02-retired', 'department', 'T3');
SELECT ain02t.mkagent('ain02-extra', 'department', 'T3');
UPDATE public.wf_agent SET status = 'retired' WHERE agent_ref = 'ain02-retired';
INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES
  (ain02t.id('orgA'), 'ain02-dept'), (ain02t.id('orgB'), 'ain02-dept'),
  (ain02t.id('orgA'), 'ain02-dept2'), (ain02t.id('orgA'), 'ain02-assure'), (ain02t.id('orgA'), 'ain02-exec'),
  (ain02t.id('orgA'), 'ain02-extra'), (ain02t.id('orgB'), 'ain02-extra');

CREATE FUNCTION ain02t.mkdef(p_key text, p_org text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_def uuid := gen_random_uuid(); v_ver uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.wf_definition (id, org_id, key, name) VALUES (v_def, ain02t.id(p_org), p_key, 'AIN02 ' || p_key);
  INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by)
  VALUES (v_ver, ain02t.id(p_org), v_def, 1, '{"steps":[]}', ain02t.id('author'));
  UPDATE public.wf_version SET state = 'published', published_by = ain02t.id('publisher') WHERE id = v_ver;
  UPDATE public.wf_definition SET current_version_id = v_ver, status = 'active' WHERE id = v_def;
  PERFORM ain02t.keep('ver_' || p_key, v_ver);
  RETURN v_def;
END $$;
SELECT ain02t.mkdef('ain02-a', 'orgA');
SELECT ain02t.mkdef('ain02-b', 'orgB');

-- Two templates, so the template ceiling is a real input: one at act_and_report, one at draft.
INSERT INTO public.wf_template (id, template_key, version, name, description, graph, agent_ref, autonomy_max) VALUES
  ('f2600000-0000-4000-8000-0000000000c3', 'ain02-open', 1, 'AIN02 open template', 'fixture', '{"steps":[]}', NULL, 'act_and_report'),
  ('f2600000-0000-4000-8000-0000000000c4', 'ain02-low', 1, 'AIN02 low template', 'fixture', '{"steps":[]}', NULL, 'draft');

CREATE FUNCTION ain02t.mkrun(p_name text, p_def text, p_agent text, p_template uuid DEFAULT 'f2600000-0000-4000-8000-0000000000c3')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_ver public.wf_version%ROWTYPE;
BEGIN
  SELECT * INTO v_ver FROM public.wf_version WHERE id = ain02t.id('ver_' || p_def);
  INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
    step_count, started_by, deadline_at, started_at, agent_ref, template_id)
  VALUES (v_id, v_ver.org_id, v_ver.definition_id, v_ver.id, 'ain02-run-' || p_name, 'running', 3, 200, 0,
    ain02t.id('adminA'), now() + interval '1 hour', now(), p_agent, p_template);
  RETURN ain02t.keep('run_' || p_name, v_id);
END $$;
CREATE FUNCTION ain02t.stepsql(p_run text, p_key text, p_kind text, p_class text) RETURNS text LANGUAGE sql AS $$
  SELECT format($f$INSERT INTO public.wf_step_run (org_id, run_id, step_key, kind, idempotency_key, action_class)
     SELECT r.org_id, r.id, %L, %L, %L, %L FROM public.wf_run r WHERE r.id = %L$f$,
     p_key, p_kind, 'ain02-step-' || p_run || '-' || p_key, p_class, ain02t.id('run_' || p_run))
$$;
CREATE FUNCTION ain02t.step(p_run text, p_key text, p_kind text, p_class text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE ain02t.stepsql(p_run, p_key, p_kind, p_class);
  RETURN (SELECT autonomy_level FROM public.wf_step_run WHERE idempotency_key = 'ain02-step-' || p_run || '-' || p_key);
END $$;
CREATE FUNCTION ain02t.lvl(p_org text, p_agent text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT coalesce((SELECT earned_level FROM public.wf_agent_autonomy
                    WHERE org_id = ain02t.id(p_org) AND agent_ref = p_agent), 'suggest')
$$;
CREATE FUNCTION ain02t.audits(p_org text, p_action text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.audit_chain WHERE org_id = ain02t.id(p_org) AND action = p_action
$$;
-- Evidence as the evaluation runner would record it (as the service role in the tests that need it).
CREATE FUNCTION ain02t.ev(p_name text, p_agent text, p_graded integer, p_passed integer, p_crit integer DEFAULT 0,
  p_ungraded integer DEFAULT 0, p_age interval DEFAULT interval '1 hour') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  v := public.wf_autonomy_record_evidence(p_agent, 'suite-' || p_agent, p_graded, p_passed, p_crit, p_ungraded,
         now() - p_age, encode(sha256(convert_to('ain02:' || p_name, 'UTF8')), 'hex'));
  RETURN ain02t.keep('ev_' || p_name, (v ->> 'evidence_id')::uuid);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ain02t TO anon, authenticated, service_role;

SELECT ain02t.mkrun('dept', 'ain02-a', 'ain02-dept');
SELECT ain02t.mkrun('dept_low', 'ain02-a', 'ain02-dept', 'f2600000-0000-4000-8000-0000000000c4');
SELECT ain02t.mkrun('deptb', 'ain02-b', 'ain02-dept');
SELECT ain02t.mkrun('assure', 'ain02-a', 'ain02-assure');
SELECT ain02t.mkrun('exec', 'ain02-a', 'ain02-exec');
SELECT ain02t.mkrun('extra', 'ain02-a', 'ain02-extra');
SELECT ain02t.mkrun('none', 'ain02-a', NULL);

-- Stub with the reviewed ENGINE-20 shape (database/proposals/ENGINE-20_org_agent_addons_events_reports.sql).
CREATE TABLE public.org_agent_addon_events (
  seq        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     uuid NOT NULL,
  agent_code text NOT NULL,
  action     text NOT NULL CHECK (action IN ('enable','disable','pause','resume','platform_pause','platform_resume')),
  reason     text,
  actor_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION ain02t.addon(p_org text, p_agent text, p_action text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.org_agent_addon_events (org_id, agent_code, action, reason, actor_id)
  VALUES (ain02t.id(p_org), p_agent, p_action, NULL, ain02t.id('adminA'));
END $$;

-- ---------------------------------------------------------------------------------------------
-- 4. The effective level: lowest of template, organization, earned level, agent ceiling and class cap
-- ---------------------------------------------------------------------------------------------
SELECT ain02t.expect_true('an agent that earned nothing stays at suggest whatever the template and class allow',
  public.wf_effective_autonomy(ain02t.id('orgA'), 'ain02-dept', 'act_and_report', 'internal') = 'suggest'
  AND ain02t.step('dept', 'e0', 'action', 'internal') = 'suggest');
SELECT ain02t.expect_true('an agentless step is at suggest (the WF-03 rule is unchanged)',
  public.wf_effective_autonomy(ain02t.id('orgA'), NULL, 'act_and_report', 'internal') = 'suggest'
  AND ain02t.step('none', 'n0', 'action', 'internal') = 'suggest');
SELECT ain02t.expect_true('ceilings by agent tier: department and organization act_and_report, executive approval, assurance draft',
  public.wf_autonomy_ceiling('ain02-dept') = 'act_and_report'
  AND public.wf_autonomy_ceiling('org-support') = 'act_and_report'
  AND public.wf_autonomy_ceiling('ain02-exec') = 'act_with_approval'
  AND public.wf_autonomy_ceiling('ain02-assure') = 'draft');
SELECT ain02t.expect_true('an unknown, null or retired agent has the floor as its ceiling',
  public.wf_autonomy_ceiling('nobody') = 'suggest' AND public.wf_autonomy_ceiling(NULL) = 'suggest'
  AND public.wf_autonomy_ceiling('ain02-retired') = 'suggest');
SELECT ain02t.expect_true('every registered agent has a ceiling that is on the scale',
  NOT EXISTS (SELECT 1 FROM public.wf_agent a
               WHERE NOT EXISTS (SELECT 1 FROM public.wf_autonomy_scale s WHERE s.level = public.wf_autonomy_ceiling(a.agent_ref))));

-- ---------------------------------------------------------------------------------------------
-- 5. The write gate: the earned level does not change except through the gate
-- ---------------------------------------------------------------------------------------------
SELECT ain02t.expect_error('INSERT of a level above suggest is refused without the gate',
  format($q$INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES (%L, 'ain02-dept', 'draft')$q$, ain02t.id('orgA')),
  '42501', 'ain02:promotion_needs_the_gate');
SELECT ain02t.expect_error('upsert of a level above suggest is refused without the gate (insert half)',
  format($q$INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES (%L, 'ain02-dept', 'act_and_report')
     ON CONFLICT (org_id, agent_ref) DO UPDATE SET earned_level = EXCLUDED.earned_level$q$, ain02t.id('orgA')),
  '42501', 'ain02:promotion_needs_the_gate');
INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES (ain02t.id('orgA'), 'ain02-extra', 'suggest');
SELECT ain02t.expect_true('inserting the floor level is harmless and allowed (positive twin)', ain02t.lvl('orgA', 'ain02-extra') = 'suggest');
SELECT ain02t.expect_error('UPDATE that raises a level is refused without the gate',
  $q$UPDATE public.wf_agent_autonomy SET earned_level = 'draft' WHERE agent_ref = 'ain02-extra'$q$, '42501', 'ain02:promotion_needs_the_gate');
SELECT ain02t.expect_error('upsert that raises an existing level is refused without the gate (update half)',
  format($q$INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES (%L, 'ain02-extra', 'draft')
     ON CONFLICT (org_id, agent_ref) DO UPDATE SET earned_level = EXCLUDED.earned_level$q$, ain02t.id('orgA')),
  '42501', 'ain02:promotion_needs_the_gate');
SELECT ain02t.expect_error('a level cannot exceed the agent''s ceiling even when written directly: assurance agent',
  format($q$INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES (%L, 'ain02-assure', 'act_with_approval')$q$, ain02t.id('orgA')),
  '42501', 'ain02:above_agent_ceiling');
SELECT ain02t.expect_error('an unknown agent can hold only the floor',
  format($q$INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES (%L, 'nobody-here', 'draft')$q$, ain02t.id('orgA')),
  '42501', 'ain02:above_agent_ceiling');
SELECT ain02t.expect_error('a retired agent can hold only the floor',
  format($q$INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES (%L, 'ain02-retired', 'draft')$q$, ain02t.id('orgA')),
  '42501', 'ain02:above_agent_ceiling');
SELECT ain02t.expect_error('a row key cannot be rewritten to move a level to another organization',
  format($q$UPDATE public.wf_agent_autonomy SET org_id = %L WHERE agent_ref = 'ain02-extra'$q$, ain02t.id('orgB')), '42501', 'ain02:earned_level_key_is_immutable');
SELECT ain02t.expect_error('a row key cannot be rewritten to move a level to another agent',
  $q$UPDATE public.wf_agent_autonomy SET agent_ref = 'ain02-dept' WHERE agent_ref = 'ain02-extra'$q$, '42501', 'ain02:earned_level_key_is_immutable');
SELECT ain02t.expect_error('a level row is never deleted',
  $q$DELETE FROM public.wf_agent_autonomy WHERE agent_ref = 'ain02-extra'$q$, '42501', 'ain02:earned_level_rows_are_not_deleted');
SELECT ain02t.expect_error('the service role cannot insert an earned level (privilege)',
  format($q$SELECT ain02t.login_as('service_role'); INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES (%L, 'ain02-dept2', 'suggest')$q$, ain02t.id('orgA')), '42501');
SELECT ain02t.logout();
SELECT ain02t.expect_error('the service role cannot update an earned level (privilege)',
  $q$SELECT ain02t.login_as('service_role'); UPDATE public.wf_agent_autonomy SET earned_level = 'suggest' WHERE agent_ref = 'ain02-extra'$q$, '42501');
SELECT ain02t.logout();
SELECT ain02t.expect_error('the service role cannot delete an earned level (privilege)',
  $q$SELECT ain02t.login_as('service_role'); DELETE FROM public.wf_agent_autonomy WHERE agent_ref = 'ain02-extra'$q$, '42501');
SELECT ain02t.logout();
SELECT ain02t.expect_error('the service role cannot truncate the earned levels (privilege)',
  $q$SELECT ain02t.login_as('service_role'); TRUNCATE public.wf_agent_autonomy$q$, '42501');
SELECT ain02t.logout();
SELECT ain02t.expect_error('a tenant administrator role cannot read or write the earned levels',
  $q$SELECT ain02t.login_as('authenticated'); SELECT count(*) FROM public.wf_agent_autonomy$q$, '42501');
SELECT ain02t.logout();
SELECT ain02t.expect_error('anonymous cannot read the evidence or the ledger',
  $q$SELECT ain02t.login_as('anon'); SELECT count(*) FROM public.wf_autonomy_change$q$, '42501');
SELECT ain02t.logout();
SELECT ain02t.login_as('service_role');
SELECT ain02t.expect_true('the service role can still read the earned levels, the evidence and the ledger',
  (SELECT count(*) >= 1 FROM public.wf_agent_autonomy) AND (SELECT count(*) >= 0 FROM public.wf_autonomy_evidence)
  AND (SELECT count(*) >= 0 FROM public.wf_autonomy_change));
SELECT ain02t.logout();

-- ---------------------------------------------------------------------------------------------
-- 6. Evidence
-- ---------------------------------------------------------------------------------------------
SELECT ain02t.login_as('service_role');
SELECT ain02t.expect_true('recording evidence stores the numbers and returns the id',
  (SELECT (v ->> 'recorded')::boolean AND NOT (v ->> 'regression')::boolean AND (v ->> 'demoted')::integer = 0
     FROM (SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-a', 20, 18, 0, 0, now() - interval '1 hour',
             encode(sha256(convert_to('ain02:first', 'UTF8')), 'hex')) v) x));
SELECT ain02t.expect_true('the same result recorded twice is one row, and a replay is not a regression',
  (SELECT NOT (v ->> 'recorded')::boolean AND NOT (v ->> 'regression')::boolean
     FROM (SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-a', 20, 18, 0, 0, now() - interval '1 hour',
             encode(sha256(convert_to('ain02:first', 'UTF8')), 'hex')) v) x)
  AND (SELECT count(*) = 1 FROM public.wf_autonomy_evidence WHERE agent_ref = 'ain02-dept'));
SELECT ain02t.expect_error('evidence cannot be dated in the future',
  $q$SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-a', 20, 19, 0, 0, now() + interval '1 hour', repeat('a', 64))$q$, '22023');
SELECT ain02t.expect_error('evidence needs a date',
  $q$SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-a', 20, 19, 0, 0, NULL, repeat('b', 64))$q$, '22023');
SELECT ain02t.expect_error('evidence for an unregistered agent is refused',
  $q$SELECT public.wf_autonomy_record_evidence('nobody-here', 'suite-a', 20, 19, 0, 0, now(), repeat('c', 64))$q$, '23503', 'ain02:agent_unknown');
SELECT ain02t.expect_error('more passed than graded is refused',
  $q$SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-a', 20, 21, 0, 0, now(), repeat('d', 64))$q$, '23514');
SELECT ain02t.expect_error('more critical failures than failures is refused',
  $q$SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-a', 20, 19, 2, 0, now(), repeat('e', 64))$q$, '23514');
SELECT ain02t.expect_error('a malformed content hash is refused',
  $q$SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-a', 20, 19, 0, 0, now(), 'not-a-hash')$q$, '23514');
SELECT ain02t.expect_error('a malformed suite id is refused',
  $q$SELECT public.wf_autonomy_record_evidence('ain02-dept', 'bad suite!', 20, 19, 0, 0, now(), repeat('f', 64))$q$, '23514');
SELECT ain02t.logout();
SELECT ain02t.login_as('authenticated');
SELECT ain02t.expect_error('a tenant role cannot record evidence',
  $q$SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-a', 20, 19, 0, 0, now(), repeat('1', 64))$q$, '42501');
SELECT ain02t.logout();
SELECT ain02t.login_as('anon');
SELECT ain02t.expect_error('anonymous cannot record evidence',
  $q$SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-a', 20, 19, 0, 0, now(), repeat('2', 64))$q$, '42501');
SELECT ain02t.logout();
SELECT ain02t.expect_error('evidence is append-only: no update',
  $q$UPDATE public.wf_autonomy_evidence SET passed = 20$q$, '42501', 'append-only');
SELECT ain02t.expect_error('evidence is append-only: no delete',
  $q$DELETE FROM public.wf_autonomy_evidence$q$, '42501', 'append-only');
SELECT ain02t.expect_true('evidence is append-only: a truncate trigger is installed (the foreign key from the ledger refuses a truncate first)',
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_autonomy_evidence'::regclass
            AND t.tgname = 'wf_autonomy_evidence_01_no_truncate' AND t.tgtype & 32 = 32 AND t.tgenabled = 'O'));
SELECT ain02t.expect_error('evidence cannot be truncated',
  $q$TRUNCATE public.wf_autonomy_evidence$q$, '0A000');
SELECT ain02t.keep('ev_first', (SELECT id FROM public.wf_autonomy_evidence WHERE agent_ref = 'ain02-dept' LIMIT 1));

-- ---------------------------------------------------------------------------------------------
-- 7. Promotion: the founder, one rung, fresh single-use evidence
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION ain02t.promote_sql(p_actor text, p_org text, p_agent text, p_to text, p_ev text, p_reason text DEFAULT 'AIN02 harness promotion on evidence')
RETURNS text LANGUAGE sql AS $$
  SELECT format($f$SELECT public.wf_autonomy_promote(%L, %L, %L, %L, %L, %L)$f$,
    ain02t.id(p_actor), ain02t.id(p_org), p_agent, p_to, ain02t.id('ev_' || p_ev), p_reason)
$$;
CREATE FUNCTION ain02t.promote(p_actor text, p_org text, p_agent text, p_to text, p_ev text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  EXECUTE ain02t.promote_sql(p_actor, p_org, p_agent, p_to, p_ev) INTO v;
  RETURN v;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ain02t TO anon, authenticated, service_role;

SELECT ain02t.login_as('service_role');
SELECT ain02t.ev('d_ok_draft', 'ain02-dept', 20, 18);
SELECT ain02t.expect_error('a tenant administrator cannot promote (only the founder does)',
  ain02t.promote_sql('adminA', 'orgA', 'ain02-dept', 'draft', 'd_ok_draft'), '42501', 'ain02:only_the_founder_promotes');
SELECT ain02t.expect_error('a person with view rights only cannot promote',
  ain02t.promote_sql('viewer', 'orgA', 'ain02-dept', 'draft', 'd_ok_draft'), '42501', 'ain02:only_the_founder_promotes');
SELECT ain02t.expect_error('a former super admin (inactive) cannot promote',
  ain02t.promote_sql('retired_founder', 'orgA', 'ain02-dept', 'draft', 'd_ok_draft'), '42501', 'ain02:only_the_founder_promotes');
SELECT ain02t.expect_error('a promotion needs a person',
  format($q$SELECT public.wf_autonomy_promote(NULL, %L, 'ain02-dept', 'draft', %L, 'AIN02 harness promotion on evidence')$q$,
    ain02t.id('orgA'), ain02t.id('ev_d_ok_draft')), '42501', 'wf07:actor_required');
SELECT ain02t.expect_true('none of those changed the level or wrote a ledger row',
  ain02t.lvl('orgA', 'ain02-dept') = 'suggest' AND (SELECT count(*) = 0 FROM public.wf_autonomy_change WHERE org_id IN (ain02t.id('orgA'), ain02t.id('orgB'))));
SELECT ain02t.expect_error('the founder cannot promote in an organization that has no workflow settings',
  format($q$SELECT public.wf_autonomy_promote(%L, gen_random_uuid(), 'ain02-dept', 'draft', %L, 'AIN02 harness promotion on evidence')$q$,
    ain02t.id('founder'), ain02t.id('ev_d_ok_draft')), '23503', 'ain02:organization_unknown');
SELECT ain02t.expect_error('the founder cannot promote an agent that is not granted to the organization',
  ain02t.promote_sql('founder', 'orgB', 'ain02-dept2', 'draft', 'd_ok_draft'), '42501', 'agent_not_granted');
SELECT ain02t.expect_error('the founder cannot promote an unknown agent',
  ain02t.promote_sql('founder', 'orgA', 'nobody-here', 'draft', 'd_ok_draft'), '42501', 'agent_unknown');
SELECT ain02t.expect_error('the founder cannot promote a retired agent',
  ain02t.promote_sql('founder', 'orgA', 'ain02-retired', 'draft', 'd_ok_draft'), '42501', 'agent_unknown');
SELECT ain02t.expect_error('an organization agent that the organization has not enabled is refused',
  ain02t.promote_sql('founder', 'orgA', 'org-support', 'draft', 'd_ok_draft'), '42501', 'agent_not_enabled');
SELECT ain02t.expect_error('a reason shorter than ten characters is refused',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'draft', 'd_ok_draft', 'too short'), '23514');
SELECT ain02t.expect_error('a reason is required',
  format($q$SELECT public.wf_autonomy_promote(%L, %L, 'ain02-dept', 'draft', %L, NULL)$q$,
    ain02t.id('founder'), ain02t.id('orgA'), ain02t.id('ev_d_ok_draft')), '23502');
SELECT ain02t.expect_error('evidence is required',
  format($q$SELECT public.wf_autonomy_promote(%L, %L, 'ain02-dept', 'draft', NULL, 'AIN02 harness promotion on evidence')$q$,
    ain02t.id('founder'), ain02t.id('orgA')), '23514');
SELECT ain02t.expect_error('an unknown evidence id is refused',
  format($q$SELECT public.wf_autonomy_promote(%L, %L, 'ain02-dept', 'draft', gen_random_uuid(), 'AIN02 harness promotion on evidence')$q$,
    ain02t.id('founder'), ain02t.id('orgA')), '23514', 'ain02:evidence_is_not_for_this_agent');
SELECT ain02t.expect_error('a level that is not on the scale is refused',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'autonomous', 'd_ok_draft'), '23514', 'ain02:no_bar_for_level');
SELECT ain02t.expect_error('a promotion cannot skip a rung',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'act_with_approval', 'd_ok_draft'), '23514');
SELECT ain02t.expect_error('a promotion to the level the agent already holds is refused',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'suggest', 'd_ok_draft'), '23514');

-- Evidence bars at the boundary: limit-1 fails, limit passes (draft: 20 cases at 0.90).
SELECT ain02t.ev('d_n19', 'ain02-dept', 19, 19);
SELECT ain02t.ev('d_r17', 'ain02-dept', 20, 17);
SELECT ain02t.ev('d_crit', 'ain02-dept', 40, 40 - 1, 1);
SELECT ain02t.ev('d_stale', 'ain02-dept', 25, 25, 0, 0, interval '30 days 1 minute');
SELECT ain02t.ev('d_ungraded', 'ain02-dept', 30, 30, 0, 3);
SELECT ain02t.ev('o_other', 'ain02-dept2', 30, 30);
SELECT ain02t.expect_error('limit - 1 on cases: 19 graded cases are below the bar of 20',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'draft', 'd_n19'), '23514', 'ain02:evidence_below_bar');
SELECT ain02t.expect_error('limit - 1 on rate: 17 of 20 (0.85) is below 0.90',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'draft', 'd_r17'), '23514', 'ain02:evidence_below_bar');
SELECT ain02t.expect_error('one critical failure blocks a promotion whatever the pass rate',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'draft', 'd_crit'), '23514', 'ain02:evidence_has_critical_failures');
SELECT ain02t.expect_error('evidence older than 30 days is refused (30 days and a minute)',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'draft', 'd_stale'), '23514', 'ain02:evidence_stale_or_invalid');
SELECT ain02t.expect_error('evidence about another agent is refused',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'draft', 'o_other'), '23514', 'ain02:evidence_is_not_for_this_agent');
SELECT ain02t.expect_true('still nothing was promoted',
  ain02t.lvl('orgA', 'ain02-dept') = 'suggest' AND (SELECT count(*) = 0 FROM public.wf_autonomy_change WHERE org_id IN (ain02t.id('orgA'), ain02t.id('orgB'))));

SELECT ain02t.expect_true('limit: 18 of 20 (exactly 0.90) is enough for draft; the founder promotes one rung',
  (SELECT v ->> 'from' = 'suggest' AND v ->> 'to' = 'draft'
     FROM (SELECT ain02t.promote('founder', 'orgA', 'ain02-dept', 'draft', 'd_ok_draft') v) x)
  AND ain02t.lvl('orgA', 'ain02-dept') = 'draft');
SELECT ain02t.expect_true('the ledger row names the founder, the evidence and the reason; the verified person was restored',
  (SELECT kind = 'promote' AND from_level = 'suggest' AND to_level = 'draft' AND decided_by = ain02t.id('founder')
          AND evidence_id = ain02t.id('ev_d_ok_draft') AND length(reason) >= 10
     FROM public.wf_autonomy_change WHERE agent_ref = 'ain02-dept' AND org_id = ain02t.id('orgA'))
  AND coalesce(current_setting('request.jwt.claim.sub', true), '') = '');
SELECT ain02t.expect_true('the promotion wrote the audit chain (ledger entry and level change)',
  ain02t.audits('orgA', 'workflow.autonomy.promote') = 1
  AND ain02t.audits('orgA', 'workflow.wf_agent_autonomy.changed') >= 1);
SELECT ain02t.ev('reuse', 'ain02-dept2', 260, 260);
SELECT ain02t.promote('founder', 'orgA', 'ain02-dept2', 'draft', 'reuse');
SELECT ain02t.expect_error('a piece of evidence promotes once: evidence that clears the next bar too cannot buy a second rung',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept2', 'act_with_approval', 'reuse'), '23505');
SELECT ain02t.expect_error('nor can it be spent in another organization',
  ain02t.promote_sql('founder', 'orgB', 'ain02-dept', 'draft', 'd_ok_draft'), '23505');
SELECT ain02t.expect_true('the other organization is untouched',
  ain02t.lvl('orgB', 'ain02-dept') = 'suggest');
SELECT ain02t.ev('a_ungraded', 'ain02-dept', 60, 60, 0, 3);
SELECT ain02t.expect_error('ungraded model cases block act_with_approval even with a perfect graded record',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'act_with_approval', 'a_ungraded'), '23514', 'ain02:ungraded_cases_block_this_level');
SELECT ain02t.ev('a_ok', 'ain02-dept', 50, 48);
SELECT ain02t.ev('a_r47', 'ain02-dept', 50, 47);
SELECT ain02t.ev('a_n49', 'ain02-dept', 49, 49);
SELECT ain02t.expect_error('act_with_approval: 47 of 50 (0.94) is below 0.95',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'act_with_approval', 'a_r47'), '23514', 'ain02:evidence_below_bar');
SELECT ain02t.expect_error('act_with_approval: 49 cases are below the bar of 50',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'act_with_approval', 'a_n49'), '23514', 'ain02:evidence_below_bar');
SELECT ain02t.expect_error('the evidence that was enough for draft is not enough for the next rung',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'act_with_approval', 'd_n19'), '23514');
SELECT ain02t.expect_true('act_with_approval: 48 of 50 (0.96) passes',
  (SELECT v ->> 'to' = 'act_with_approval' FROM (SELECT ain02t.promote('founder', 'orgA', 'ain02-dept', 'act_with_approval', 'a_ok') v) x)
  AND ain02t.lvl('orgA', 'ain02-dept') = 'act_with_approval');
SELECT ain02t.ev('r_ok', 'ain02-dept', 200, 196);
SELECT ain02t.ev('r_r195', 'ain02-dept', 200, 195);
SELECT ain02t.ev('r_n199', 'ain02-dept', 199, 199);
SELECT ain02t.ev('r_ungraded', 'ain02-dept', 300, 300, 0, 1);
SELECT ain02t.expect_error('act_and_report: 195 of 200 (0.975) is below 0.98',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'act_and_report', 'r_r195'), '23514', 'ain02:evidence_below_bar');
SELECT ain02t.expect_error('act_and_report: 199 cases are below the bar of 200',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'act_and_report', 'r_n199'), '23514', 'ain02:evidence_below_bar');
SELECT ain02t.expect_error('one ungraded model case blocks act_and_report whatever the rest looks like',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'act_and_report', 'r_ungraded'), '23514', 'ain02:ungraded_cases_block_this_level');
SELECT ain02t.expect_true('act_and_report: 196 of 200 (exactly 0.98) passes',
  (SELECT v ->> 'to' = 'act_and_report' FROM (SELECT ain02t.promote('founder', 'orgA', 'ain02-dept', 'act_and_report', 'r_ok') v) x)
  AND ain02t.lvl('orgA', 'ain02-dept') = 'act_and_report');
SELECT ain02t.expect_error('there is no rung above act_and_report: a promotion to the level already held is refused',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept', 'act_and_report', 'r_ok'), '23514');
SELECT ain02t.expect_true('four promotions so far in orgA: four ledger rows, four audit entries; the other organization still at suggest',
  (SELECT count(*) = 4 FROM public.wf_autonomy_change WHERE org_id = ain02t.id('orgA') AND kind = 'promote')
  AND ain02t.audits('orgA', 'workflow.autonomy.promote') = 4 AND ain02t.lvl('orgB', 'ain02-dept') = 'suggest');
SELECT ain02t.logout();

-- Ceilings: the ledger guard refuses a level above the agent's ceiling even for the founder with perfect evidence.
SELECT ain02t.login_as('service_role');
SELECT ain02t.ev('as_d', 'ain02-assure', 30, 30);
SELECT ain02t.ev('as_a', 'ain02-assure', 60, 60);
SELECT ain02t.ev('ex_a', 'ain02-exec', 60, 60);
SELECT ain02t.ev('ex_r', 'ain02-exec', 220, 220);
SELECT ain02t.expect_true('an assurance agent can be promoted to draft',
  (SELECT v ->> 'to' = 'draft' FROM (SELECT ain02t.promote('founder', 'orgA', 'ain02-assure', 'draft', 'as_d') v) x));
SELECT ain02t.expect_error('but not to act_with_approval (assurance ceiling), with perfect evidence',
  ain02t.promote_sql('founder', 'orgA', 'ain02-assure', 'act_with_approval', 'as_a'), '42501', 'ain02:above_agent_ceiling');
SELECT ain02t.ev('ex_d', 'ain02-exec', 30, 30);
SELECT ain02t.expect_true('the executive agent climbs to act_with_approval in two steps',
  (SELECT v ->> 'to' = 'draft' FROM (SELECT ain02t.promote('founder', 'orgA', 'ain02-exec', 'draft', 'ex_d') v) x)
  AND (SELECT v ->> 'to' = 'act_with_approval' FROM (SELECT ain02t.promote('founder', 'orgA', 'ain02-exec', 'act_with_approval', 'ex_a') v) x));
SELECT ain02t.expect_error('the executive agent cannot be made autonomous',
  ain02t.promote_sql('founder', 'orgA', 'ain02-exec', 'act_and_report', 'ex_r'), '42501', 'ain02:above_agent_ceiling');
SELECT ain02t.logout();

-- ---------------------------------------------------------------------------------------------
-- 8. The ledger guard as a backstop (a direct write by a database owner is held to the same rules)
-- ---------------------------------------------------------------------------------------------
SELECT ain02t.login_as('service_role');
SELECT ain02t.ev('bk_ok', 'ain02-extra', 30, 30);
SELECT ain02t.ev('bk_below', 'ain02-extra', 20, 10);
SELECT ain02t.ev('bk_crit', 'ain02-extra', 40, 39, 1);
SELECT ain02t.ev('bk_other', 'ain02-dept2', 30, 30);
SELECT ain02t.ev('bk_reg_ok', 'ain02-extra', 40, 40);
SELECT ain02t.logout();
SELECT ain02t.expect_error('a hand-written promote row by a non-founder is refused by the ledger guard',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-extra', 'promote', 'suggest', 'draft', %L, %L, 'AIN02 backstop non-founder')$q$,
     ain02t.id('orgA'), ain02t.id('ev_bk_ok'), ain02t.id('adminA')), '42501', 'ain02:only_the_founder_promotes');
SELECT ain02t.expect_error('a hand-written promote row signed by an inactive super admin is refused',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-extra', 'promote', 'suggest', 'draft', %L, %L, 'AIN02 backstop inactive founder')$q$,
     ain02t.id('orgA'), ain02t.id('ev_bk_ok'), ain02t.id('retired_founder')), '42501', 'ain02:only_the_founder_promotes');
SELECT ain02t.expect_error('a hand-written row cannot claim a from_level that is not the current level',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-extra', 'promote', 'draft', 'act_with_approval', %L, %L, 'AIN02 backstop wrong from')$q$,
     ain02t.id('orgA'), ain02t.id('ev_bk_ok'), ain02t.id('founder')), '23514', 'ain02:from_level_is_not_the_current_level');
SELECT ain02t.expect_error('a hand-written row with evidence below the bar is refused',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-extra', 'promote', 'suggest', 'draft', %L, %L, 'AIN02 backstop low evidence')$q$,
     ain02t.id('orgA'), ain02t.id('ev_bk_below'), ain02t.id('founder')), '23514', 'ain02:evidence_below_bar');
SELECT ain02t.expect_error('a hand-written row with a critical failure in the evidence is refused',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-extra', 'promote', 'suggest', 'draft', %L, %L, 'AIN02 backstop critical')$q$,
     ain02t.id('orgA'), ain02t.id('ev_bk_crit'), ain02t.id('founder')), '23514', 'ain02:evidence_has_critical_failures');
SELECT ain02t.expect_error('a hand-written row with another agent''s evidence is refused',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-extra', 'promote', 'suggest', 'draft', %L, %L, 'AIN02 backstop other agent')$q$,
     ain02t.id('orgA'), ain02t.id('ev_bk_other'), ain02t.id('founder')), '23514', 'ain02:evidence_is_not_for_this_agent');
SELECT ain02t.expect_error('a hand-written promote row without evidence is refused by the shape check',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-extra', 'promote', 'suggest', 'draft', NULL, %L, 'AIN02 backstop no evidence')$q$,
     ain02t.id('orgA'), ain02t.id('founder')), '23514');
SELECT ain02t.expect_error('a hand-written promote row that skips a rung is refused by the shape check',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-extra', 'promote', 'suggest', 'act_with_approval', %L, %L, 'AIN02 backstop skipped rung')$q$,
     ain02t.id('orgA'), ain02t.id('ev_bk_ok'), ain02t.id('founder')), '23514');
SELECT ain02t.expect_error('a hand-written auto_demote row on evidence that is not a regression is refused',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-dept', 'auto_demote', 'act_and_report', 'act_with_approval', %L, NULL, 'AIN02 backstop no regression')$q$,
     ain02t.id('orgA'), ain02t.id('ev_r_ok')), '23514', 'ain02:evidence_is_not_a_regression');
SELECT ain02t.expect_error('an auto_demote row cannot carry a person (it is the automatic path)',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-dept', 'auto_demote', 'act_and_report', 'act_with_approval', %L, %L, 'AIN02 backstop person on auto')$q$,
     ain02t.id('orgA'), ain02t.id('ev_d_crit'), ain02t.id('founder')), '23514');
SELECT ain02t.expect_error('a demote row cannot raise a level',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-extra', 'demote', 'suggest', 'draft', NULL, %L, 'AIN02 backstop demote raising')$q$,
     ain02t.id('orgA'), ain02t.id('founder')), '23514');
SELECT ain02t.expect_error('a demote row must name a person',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-dept', 'demote', 'act_and_report', 'draft', NULL, NULL, 'AIN02 backstop nobody decided')$q$,
     ain02t.id('orgA')), '23514');
SELECT ain02t.expect_error('a ledger row needs a real reason',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-extra', 'promote', 'suggest', 'draft', %L, %L, 'short')$q$,
     ain02t.id('orgA'), ain02t.id('ev_bk_ok'), ain02t.id('founder')), '23514');
SELECT ain02t.expect_error('the ledger is append-only: no update',
  $q$UPDATE public.wf_autonomy_change SET reason = 'rewritten history x'$q$, '42501', 'append-only');
SELECT ain02t.expect_error('the ledger is append-only: no delete',
  $q$DELETE FROM public.wf_autonomy_change$q$, '42501', 'append-only');
SELECT ain02t.expect_error('the ledger is append-only: no truncate',
  $q$TRUNCATE public.wf_autonomy_change$q$, '42501', 'append-only');
SELECT ain02t.expect_error('the service role cannot write the ledger directly',
  format($q$SELECT ain02t.login_as('service_role'); INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-extra', 'promote', 'suggest', 'draft', %L, %L, 'AIN02 backstop service role')$q$,
     ain02t.id('orgA'), ain02t.id('ev_bk_ok'), ain02t.id('founder')), '42501');
SELECT ain02t.logout();
SELECT ain02t.expect_error('the service role cannot write evidence directly',
  $q$SELECT ain02t.login_as('service_role'); INSERT INTO public.wf_autonomy_evidence (agent_ref, suite_id, graded, passed, critical_failures, ungraded, evaluated_at, content_sha256)
     VALUES ('ain02-extra', 'suite-x', 99, 99, 0, 0, now(), repeat('9', 64))$q$, '42501');
SELECT ain02t.logout();
-- A ledger row from an earlier transaction cannot authorize a write now (replay): the row carries a txid that is not this one.
INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason, txid)
VALUES (ain02t.id('orgA'), 'ain02-extra', 'promote', 'suggest', 'draft', ain02t.id('ev_bk_ok'), ain02t.id('founder'),
        'AIN02 backstop replayed ledger row', txid_current() - 1);
SELECT ain02t.expect_error('a ledger row from another transaction does not authorize a level write (no replay)',
  $q$UPDATE public.wf_agent_autonomy SET earned_level = 'draft' WHERE agent_ref = 'ain02-extra'$q$, '42501', 'ain02:promotion_needs_the_gate');
SELECT ain02t.expect_true('the replay attempt changed nothing',
  ain02t.lvl('orgA', 'ain02-extra') = 'suggest');
SELECT ain02t.expect_error('a ledger row for another level does not authorize this write',
  $q$UPDATE public.wf_agent_autonomy SET earned_level = 'act_with_approval' WHERE agent_ref = 'ain02-extra'$q$, '42501', 'ain02:promotion_needs_the_gate');

-- ---------------------------------------------------------------------------------------------
-- 9. Demotion, and nobody can use it to raise
-- ---------------------------------------------------------------------------------------------
SELECT ain02t.login_as('service_role');
SELECT ain02t.expect_error('a person with view rights only cannot demote',
  format($q$SELECT public.wf_autonomy_demote(%L, %L, 'ain02-dept', 'draft', 'AIN02 harness demotion reason')$q$, ain02t.id('viewer'), ain02t.id('orgA')), '42501', 'ain02:not_authorized');
SELECT ain02t.expect_error('an administrator of another organization cannot demote this organization''s agent',
  format($q$SELECT public.wf_autonomy_demote(%L, %L, 'ain02-dept', 'draft', 'AIN02 harness demotion reason')$q$, ain02t.id('adminB'), ain02t.id('orgA')), '42501', 'ain02:not_authorized');
SELECT ain02t.expect_error('a demotion needs a person',
  format($q$SELECT public.wf_autonomy_demote(NULL, %L, 'ain02-dept', 'draft', 'AIN02 harness demotion reason')$q$, ain02t.id('orgA')), '42501', 'wf07:actor_required');
SELECT ain02t.expect_error('"demote" to the same level is refused',
  format($q$SELECT public.wf_autonomy_demote(%L, %L, 'ain02-dept', 'act_and_report', 'AIN02 harness demotion reason')$q$, ain02t.id('adminA'), ain02t.id('orgA')), '23514');
SELECT ain02t.expect_error('"demote" cannot raise a level (administrator)',
  format($q$SELECT public.wf_autonomy_demote(%L, %L, 'ain02-extra', 'draft', 'AIN02 harness demotion reason')$q$, ain02t.id('adminA'), ain02t.id('orgA')), '23514');
SELECT ain02t.expect_error('"demote" cannot raise a level (founder)',
  format($q$SELECT public.wf_autonomy_demote(%L, %L, 'ain02-extra', 'draft', 'AIN02 harness demotion reason')$q$, ain02t.id('founder'), ain02t.id('orgA')), '23514');
SELECT ain02t.expect_error('a demotion needs a reason',
  format($q$SELECT public.wf_autonomy_demote(%L, %L, 'ain02-dept', 'draft', 'short')$q$, ain02t.id('adminA'), ain02t.id('orgA')), '23514');
SELECT ain02t.expect_true('the organization administrator lowers their own organization''s agent by two rungs at once (safe direction)',
  (SELECT v ->> 'from' = 'act_and_report' AND v ->> 'to' = 'draft'
     FROM (SELECT public.wf_autonomy_demote(ain02t.id('adminA'), ain02t.id('orgA'), 'ain02-dept', 'draft', 'AIN02 harness demotion reason') v) x)
  AND ain02t.lvl('orgA', 'ain02-dept') = 'draft');
SELECT ain02t.expect_true('the demotion left a ledger row and an audit entry; the verified person was restored',
  (SELECT kind = 'demote' AND decided_by = ain02t.id('adminA') AND evidence_id IS NULL
     FROM public.wf_autonomy_change WHERE agent_ref = 'ain02-dept' AND kind = 'demote')
  AND ain02t.audits('orgA', 'workflow.autonomy.demote') = 1
  AND coalesce(current_setting('request.jwt.claim.sub', true), '') = '');
SELECT ain02t.expect_true('the founder can demote in any organization (and to the floor)',
  (SELECT v ->> 'to' = 'suggest'
     FROM (SELECT public.wf_autonomy_demote(ain02t.id('founder'), ain02t.id('orgA'), 'ain02-dept', 'suggest', 'AIN02 founder lowers to floor') v) x)
  AND ain02t.lvl('orgA', 'ain02-dept') = 'suggest');
SELECT ain02t.expect_true('a demotion does not use up any evidence: a fresh promotion needs fresh evidence, never the earlier piece',
  (SELECT count(*) = 3 FROM public.wf_autonomy_change WHERE kind = 'promote' AND agent_ref = 'ain02-dept'));
SELECT ain02t.ev('d2', 'ain02-dept', 30, 30, 0, 0, interval '0');
SELECT ain02t.expect_true('after a demotion the agent starts the climb again from the floor, one rung',
  (SELECT v ->> 'from' = 'suggest' AND v ->> 'to' = 'draft' FROM (SELECT ain02t.promote('founder', 'orgA', 'ain02-dept', 'draft', 'd2') v) x));
SELECT ain02t.logout();

-- ---------------------------------------------------------------------------------------------
-- 10. A regression lowers the agent at once, everywhere, without a person
-- ---------------------------------------------------------------------------------------------
SELECT ain02t.login_as('service_role');
SELECT ain02t.ev('x_b1', 'ain02-dept', 25, 25, 0, 0, interval '0');
SELECT ain02t.promote('founder', 'orgB', 'ain02-dept', 'draft', 'x_b1');
SELECT ain02t.ev('x_b2', 'ain02-dept', 60, 60, 0, 0, interval '0');
SELECT ain02t.promote('founder', 'orgB', 'ain02-dept', 'act_with_approval', 'x_b2');
SELECT ain02t.ev('x_a2', 'ain02-dept', 60, 59, 0, 0, interval '0');
SELECT ain02t.promote('founder', 'orgA', 'ain02-dept', 'act_with_approval', 'x_a2');
SELECT ain02t.expect_true('before the regression: orgA at act_with_approval, orgB at act_with_approval, the other agents untouched',
  ain02t.lvl('orgA', 'ain02-dept') = 'act_with_approval' AND ain02t.lvl('orgB', 'ain02-dept') = 'act_with_approval'
  AND ain02t.lvl('orgA', 'ain02-exec') = 'act_with_approval');
SELECT ain02t.expect_true('evidence with no regression lowers nobody',
  (SELECT (v ->> 'regression')::boolean IS FALSE AND (v ->> 'demoted')::integer = 0
     FROM (SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-n', 100, 91, 0, 0, now(), repeat('3', 64)) v) x)
  AND ain02t.lvl('orgA', 'ain02-dept') = 'act_with_approval');
SELECT ain02t.expect_true('a pass rate of exactly 0.90 is not a regression (the floor is strict)',
  (SELECT (v ->> 'regression')::boolean IS FALSE FROM (SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-n', 100, 90, 0, 0, now(), repeat('4', 64)) v) x));
SELECT ain02t.expect_true('89 of 100 is a regression: one rung down in both organizations, and only for that agent',
  (SELECT (v ->> 'regression')::boolean AND (v ->> 'demoted')::integer = 2
     FROM (SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-n', 100, 89, 0, 0, now(), repeat('5', 64)) v) x)
  AND ain02t.lvl('orgA', 'ain02-dept') = 'draft' AND ain02t.lvl('orgB', 'ain02-dept') = 'draft'
  AND ain02t.lvl('orgA', 'ain02-exec') = 'act_with_approval');
SELECT ain02t.expect_true('the automatic demotions are in the ledger with the evidence and without a person, and in the audit chain',
  (SELECT count(*) = 2 AND bool_and(decided_by IS NULL AND evidence_id IS NOT NULL AND from_level = 'act_with_approval' AND to_level = 'draft')
     FROM public.wf_autonomy_change WHERE kind = 'auto_demote' AND agent_ref = 'ain02-dept')
  AND ain02t.audits('orgA', 'workflow.autonomy.auto_demote') = 1 AND ain02t.audits('orgB', 'workflow.autonomy.auto_demote') = 1);
SELECT ain02t.expect_true('one critical failure is a regression even at a pass rate of 99 percent',
  (SELECT (v ->> 'regression')::boolean AND (v ->> 'demoted')::integer = 2
     FROM (SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-n', 200, 199, 1, 0, now(), repeat('6', 64)) v) x)
  AND ain02t.lvl('orgA', 'ain02-dept') = 'suggest' AND ain02t.lvl('orgB', 'ain02-dept') = 'suggest');
SELECT ain02t.expect_true('an agent already at the floor is not lowered further and writes no ledger row',
  (SELECT (v ->> 'regression')::boolean AND (v ->> 'demoted')::integer = 0
     FROM (SELECT public.wf_autonomy_record_evidence('ain02-dept', 'suite-n', 200, 100, 0, 0, now(), repeat('7', 64)) v) x)
  AND (SELECT count(*) = 4 FROM public.wf_autonomy_change WHERE kind = 'auto_demote' AND org_id IN (ain02t.id('orgA'), ain02t.id('orgB'))));
SELECT ain02t.expect_true('nothing graded counts as a pass rate of zero, which is a regression (as in the ladder)',
  (SELECT (v ->> 'regression')::boolean FROM (SELECT public.wf_autonomy_record_evidence('ain02-exec', 'suite-n', 0, 0, 0, 12, now(), repeat('8', 64)) v) x)
  AND ain02t.lvl('orgA', 'ain02-exec') = 'draft');
SELECT ain02t.expect_true('a regression that is replayed (same result recorded again) does not lower the agent twice',
  (SELECT NOT (v ->> 'recorded')::boolean AND (v ->> 'demoted')::integer = 0
     FROM (SELECT public.wf_autonomy_record_evidence('ain02-exec', 'suite-n', 0, 0, 0, 12, now(), repeat('8', 64)) v) x)
  AND ain02t.lvl('orgA', 'ain02-exec') = 'draft');
SELECT ain02t.logout();


-- ---------------------------------------------------------------------------------------------
-- 10b. Evidence is superseded by anything newer (a later piece of evidence, or a later demotion)
-- ---------------------------------------------------------------------------------------------
SELECT ain02t.login_as('service_role');
SELECT ain02t.ev('sup_g', 'ain02-extra', 40, 40, 0, 0, interval '3 hours');
SELECT ain02t.ev('sup_r', 'ain02-extra', 100, 50, 0, 0, interval '1 hour');
SELECT ain02t.expect_error('good evidence followed by regression evidence cannot be used to promote (superseded)',
  ain02t.promote_sql('founder', 'orgA', 'ain02-extra', 'draft', 'sup_g'), '23514', 'ain02:evidence_superseded');
SELECT ain02t.ev('sup_n', 'ain02-extra', 40, 40, 0, 0, interval '0');
SELECT ain02t.expect_error('older good evidence cannot be used once newer good evidence exists',
  ain02t.promote_sql('founder', 'orgA', 'ain02-extra', 'draft', 'sup_g'), '23514', 'ain02:evidence_superseded');
SELECT ain02t.expect_true('the newest evidence promotes (positive twin)',
  (SELECT v ->> 'to' = 'draft' FROM (SELECT ain02t.promote('founder', 'orgA', 'ain02-extra', 'draft', 'sup_n') v) x));
-- A later demotion in the same organization also supersedes older evidence. ain02-dept2 holds 'draft' in orgA.
SELECT public.wf_autonomy_demote(ain02t.id('founder'), ain02t.id('orgA'), 'ain02-dept2', 'suggest', 'AIN02 harness demotion for supersede');
SELECT ain02t.ev('sup_d', 'ain02-dept2', 40, 40, 0, 0, interval '30 minutes');
SELECT ain02t.expect_error('evidence older than a later demotion in the organization cannot promote (superseded)',
  ain02t.promote_sql('founder', 'orgA', 'ain02-dept2', 'draft', 'sup_d'), '23514', 'ain02:evidence_superseded');
SELECT ain02t.ev('sup_d2', 'ain02-dept2', 40, 40, 0, 0, interval '0');
SELECT ain02t.expect_true('evidence from after the demotion promotes (positive twin)',
  (SELECT v ->> 'to' = 'draft' FROM (SELECT ain02t.promote('founder', 'orgA', 'ain02-dept2', 'draft', 'sup_d2') v) x));
SELECT ain02t.logout();
SELECT ain02t.expect_error('the ledger guard holds the same rule for a hand-written row',
  format($q$INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
     VALUES (%L, 'ain02-extra', 'promote', 'draft', 'act_with_approval', %L, %L, 'AIN02 backstop superseded evidence')$q$,
     ain02t.id('orgA'), ain02t.id('ev_sup_g'), ain02t.id('founder')), '23514', 'ain02:evidence_superseded');
SELECT ain02t.expect_error('an organization administrator lowering an agent that holds no level there is told so plainly',
  format($q$SELECT public.wf_autonomy_demote(%L, %L, 'ain02-extra', 'suggest', 'AIN02 harness nothing to lower')$q$,
     ain02t.id('adminB'), ain02t.id('orgB')), '23514', 'ain02:nothing_to_lower');
SELECT ain02t.logout();

-- ---------------------------------------------------------------------------------------------
-- 11. Per-step enforcement: the step guard over the one scale
-- ---------------------------------------------------------------------------------------------
-- Put ain02-dept back at act_and_report in orgA through the gate (a fresh climb), so steps have a real level to test.
SELECT ain02t.login_as('service_role');
SELECT ain02t.ev('c_d', 'ain02-dept', 30, 30, 0, 0, interval '0');
SELECT ain02t.ev('c_a', 'ain02-dept', 60, 60, 0, 0, interval '0');
SELECT ain02t.ev('c_r', 'ain02-dept', 250, 250, 0, 0, interval '0');
SELECT ain02t.promote('founder', 'orgA', 'ain02-dept', 'draft', 'c_d');
SELECT ain02t.promote('founder', 'orgA', 'ain02-dept', 'act_with_approval', 'c_a');
SELECT ain02t.logout();
SELECT ain02t.expect_true('at act_with_approval an internal step is act_with_approval (earned level is the limit)',
  ain02t.step('dept', 's1', 'action', 'internal') = 'act_with_approval');
SELECT ain02t.login_as('service_role');
SELECT ain02t.promote('founder', 'orgA', 'ain02-dept', 'act_and_report', 'c_r');
SELECT ain02t.logout();
SELECT ain02t.expect_true('at act_and_report the four plain classes reach act_and_report',
  ain02t.step('dept', 's_internal', 'action', 'internal') = 'act_and_report'
  AND ain02t.step('dept', 's_comm', 'action', 'communication') = 'act_and_report'
  AND ain02t.step('dept', 's_task', 'action', 'task') = 'act_and_report'
  AND ain02t.step('dept', 's_wait', 'action', 'wait') = 'act_and_report');
SELECT ain02t.expect_true('the six capped classes stay at draft whatever was earned',
  ain02t.step('dept', 'c1', 'action', 'money_movement') = 'draft'
  AND ain02t.step('dept', 'c2', 'action', 'safeguarding') = 'draft'
  AND ain02t.step('dept', 'c3', 'action', 'credential_change') = 'draft'
  AND ain02t.step('dept', 'c4', 'action', 'public_publish') = 'draft'
  AND ain02t.step('dept', 'c5', 'action', 'mass_message') = 'draft'
  AND ain02t.step('dept', 'c6', 'action', 'external_authority_share') = 'draft');
SELECT ain02t.expect_true('an unclassified step is draft; a class the table does not know is draft too',
  ain02t.step('dept', 'u1', 'action', 'unclassified') = 'draft'
  AND public.wf_effective_autonomy(ain02t.id('orgA'), 'ain02-dept', 'act_and_report', 'brand_new_class') = 'draft');
SELECT ain02t.expect_true('the template ceiling still bounds the step: a run on the draft-level template stays at draft',
  ain02t.step('dept_low', 'low1', 'action', 'internal') = 'draft');
UPDATE public.wf_org_settings SET autonomy_ceiling = 'draft' WHERE org_id = ain02t.id('orgA');
SELECT ain02t.expect_true('with the organization ceiling at draft every step is draft, whatever the agent earned',
  public.wf_effective_autonomy(ain02t.id('orgA'), 'ain02-dept', 'act_and_report', 'internal') = 'draft'
  AND ain02t.step('dept', 'ceil1', 'action', 'internal') = 'draft');
UPDATE public.wf_org_settings SET autonomy_ceiling = 'act_and_report' WHERE org_id = ain02t.id('orgA');
SELECT ain02t.expect_true('an ai_model step cannot reach any level above suggest (and the AI route is closed anyway)',
  public.wf_effective_autonomy(ain02t.id('orgA'), 'ain02-dept', 'act_and_report', 'ai_model') = 'suggest');
SELECT ain02t.expect_true('the assurance agent is capped at draft even on an internal step',
  ain02t.step('assure', 'as1', 'action', 'internal') = 'draft');
SELECT ain02t.expect_true('the agent in the other organization has earned nothing there: suggest',
  ain02t.step('deptb', 'b1', 'action', 'internal') = 'suggest');
-- The step level cannot be raised by writing it, by an update or by an upsert.
SELECT ain02t.expect_true('a step cannot be inserted with a level of its own choosing',
  (SELECT autonomy_level = 'draft' FROM public.wf_step_run WHERE idempotency_key = 'ain02-step-dept-c1'));
INSERT INTO public.wf_step_run (org_id, run_id, step_key, kind, idempotency_key, action_class, autonomy_level)
SELECT r.org_id, r.id, 'forced', 'action', 'ain02-step-dept-forced', 'money_movement', 'act_and_report'
  FROM public.wf_run r WHERE r.id = ain02t.id('run_dept');
SELECT ain02t.expect_true('...even when the insert names act_and_report for a capped class',
  (SELECT autonomy_level = 'draft' FROM public.wf_step_run WHERE idempotency_key = 'ain02-step-dept-forced'));
UPDATE public.wf_step_run SET autonomy_level = 'act_and_report' WHERE idempotency_key = 'ain02-step-dept-c1';
SELECT ain02t.expect_true('a plain UPDATE cannot raise the level of an existing step',
  (SELECT autonomy_level = 'draft' FROM public.wf_step_run WHERE idempotency_key = 'ain02-step-dept-c1'));
INSERT INTO public.wf_step_run (org_id, run_id, step_key, kind, idempotency_key, action_class, autonomy_level)
SELECT r.org_id, r.id, 'c1', 'action', 'ain02-step-dept-c1', 'money_movement', 'act_and_report'
  FROM public.wf_run r WHERE r.id = ain02t.id('run_dept')
ON CONFLICT (org_id, idempotency_key) DO UPDATE SET autonomy_level = 'act_and_report';
SELECT ain02t.expect_true('an upsert (ON CONFLICT DO UPDATE) cannot raise the level of an existing step either',
  (SELECT autonomy_level = 'draft' FROM public.wf_step_run WHERE idempotency_key = 'ain02-step-dept-c1'));
-- A step made while the agent was lower is not raised by a later promotion; a demotion lowers it at its next update.
SELECT ain02t.expect_true('a step made at act_and_report keeps that until something lowers it',
  (SELECT autonomy_level = 'act_and_report' FROM public.wf_step_run WHERE idempotency_key = 'ain02-step-dept-s_internal'));
SELECT ain02t.login_as('service_role');
SELECT public.wf_autonomy_demote(ain02t.id('adminA'), ain02t.id('orgA'), 'ain02-dept', 'act_with_approval', 'AIN02 harness demotion mid-flight');
SELECT ain02t.logout();
UPDATE public.wf_step_run SET autonomy_level = 'act_and_report' WHERE idempotency_key = 'ain02-step-dept-s_internal';
SELECT ain02t.expect_true('after a demotion the next update of an existing step lowers it to the new level',
  (SELECT autonomy_level = 'act_with_approval' FROM public.wf_step_run WHERE idempotency_key = 'ain02-step-dept-s_internal'));
SELECT ain02t.expect_true('and new steps are made at the new level',
  ain02t.step('dept', 'after_demote', 'action', 'internal') = 'act_with_approval');

-- ---------------------------------------------------------------------------------------------
-- 12. Per-step enforcement where the effect is recorded (outbox backstop)
-- ---------------------------------------------------------------------------------------------
-- The other BEFORE triggers and the broker-decision foreign key are switched off for these inserts, so only the AIN-02
-- trigger is under test; they are switched back on before the next section.
SELECT ain02t.login_as('service_role');
SELECT ain02t.ev('c_r2', 'ain02-dept', 300, 300, 0, 0, interval '0');
SELECT ain02t.promote('founder', 'orgA', 'ain02-dept', 'act_and_report', 'c_r2');
SELECT ain02t.logout();
SELECT ain02t.mkrun('ob', 'ain02-a', 'ain02-dept');
SELECT ain02t.step('ob', 'high', 'action', 'internal');
SELECT ain02t.step('ob', 'low', 'action', 'money_movement');
SELECT ain02t.step('ob', 'low2', 'action', 'unclassified');
CREATE FUNCTION ain02t.outbox_sql(p_step text, p_key text) RETURNS text LANGUAGE sql AS $$
  SELECT format($f$INSERT INTO public.wf_action_sandbox_outbox (org_id, run_id, step_run_id, kind, category, template_ref,
       broker_decision_id, idempotency_key)
     SELECT s.org_id, s.run_id, s.id, 'in_app', 'communication', 'notice.a', gen_random_uuid(), %L
       FROM public.wf_step_run s WHERE s.idempotency_key = %L$f$, p_key, 'ain02-step-ob-' || p_step)
$$;
ALTER TABLE public.wf_action_sandbox_outbox DISABLE TRIGGER ALL;
ALTER TABLE public.wf_action_sandbox_outbox ENABLE TRIGGER wf_action_sandbox_outbox_90_autonomy;
ALTER TABLE public.wf_action_draft DISABLE TRIGGER ALL;
-- WF-07 requires a real approval row behind an approved draft. This section tests only the AIN-02 trigger, so that
-- check is dropped inside this rolled-back transaction and the approved drafts carry a random approval id.
ALTER TABLE public.wf_action_draft DROP CONSTRAINT wf_action_draft_cap_check;
SELECT ain02t.expect_true('the step at act_and_report may record an executed action',
  (SELECT autonomy_level = 'act_and_report' FROM public.wf_step_run WHERE idempotency_key = 'ain02-step-ob-high'));
DO $do$ BEGIN EXECUTE ain02t.outbox_sql('high', 'ain02-ob-high-rec1'); END $do$;
SELECT ain02t.expect_true('the executed record exists for the high step',
  (SELECT count(*) = 1 FROM public.wf_action_sandbox_outbox WHERE idempotency_key = 'ain02-ob-high-rec1'));
SELECT public.wf_autonomy_demote(ain02t.id('founder'), ain02t.id('orgA'), 'ain02-dept', 'act_with_approval', 'AIN02 harness demotion of an in-flight step');
SELECT ain02t.expect_true('the in-flight step is still stored at act_and_report after the demotion',
  (SELECT autonomy_level = 'act_and_report' FROM public.wf_step_run WHERE idempotency_key = 'ain02-step-ob-high'));
SELECT ain02t.expect_error('a stored act_and_report level that is stale after a demotion no longer authorizes an executed record',
  ain02t.outbox_sql('high', 'ain02-ob-high-rec9'), '42501', 'ain02:step_autonomy_does_not_allow_execution');
SELECT ain02t.expect_error('a draft-level step (capped class) cannot record an executed action without an approved draft',
  ain02t.outbox_sql('low', 'ain02-ob-low-rec1'), '42501', 'ain02:step_autonomy_does_not_allow_execution');
SELECT ain02t.expect_error('an unclassified step cannot either',
  ain02t.outbox_sql('low2', 'ain02-ob-low2-rec1'), '42501', 'ain02:step_autonomy_does_not_allow_execution');
INSERT INTO public.wf_action_draft (org_id, run_id, step_run_id, kind, category, template_ref, idempotency_key, status)
SELECT s.org_id, s.run_id, s.id, 'in_app', 'communication', 'notice.a', 'ain02-ob-low-rec2', 'draft'
  FROM public.wf_step_run s WHERE s.idempotency_key = 'ain02-step-ob-low';
SELECT ain02t.expect_error('a pending draft does not authorize an executed record',
  ain02t.outbox_sql('low', 'ain02-ob-low-rec2'), '42501', 'ain02:step_autonomy_does_not_allow_execution');
UPDATE public.wf_action_draft SET status = 'rejected' WHERE idempotency_key LIKE '%low-rec2';
SELECT ain02t.expect_error('a rejected draft does not either',
  ain02t.outbox_sql('low', 'ain02-ob-low-rec2'), '42501', 'ain02:step_autonomy_does_not_allow_execution');
INSERT INTO public.wf_action_draft (org_id, run_id, step_run_id, kind, category, template_ref, idempotency_key, status, approval_id)
SELECT s.org_id, s.run_id, s.id, 'in_app', 'communication', 'notice.a', 'ain02-ob-low-rec3', 'approved', gen_random_uuid()
  FROM public.wf_step_run s WHERE s.idempotency_key = 'ain02-step-ob-low';
SELECT ain02t.expect_error('an approved draft with a different idempotency key does not authorize this record',
  ain02t.outbox_sql('low', 'ain02-ob-low-rec4'), '42501', 'ain02:step_autonomy_does_not_allow_execution');
SELECT ain02t.expect_error('an approved draft for a different step does not authorize this step',
  ain02t.outbox_sql('low2', 'ain02-ob-low-rec3'), '42501', 'ain02:step_autonomy_does_not_allow_execution');
DO $do$ BEGIN EXECUTE ain02t.outbox_sql('low', 'ain02-ob-low-rec3'); END $do$;
SELECT ain02t.expect_true('an approved draft for this very step and key authorizes the record (positive twin)',
  (SELECT count(*) = 1 FROM public.wf_action_sandbox_outbox WHERE idempotency_key LIKE '%low-rec3'));
SELECT ain02t.expect_error('a stored record cannot be re-pointed to a step that does not allow execution (update path)',
  $q$UPDATE public.wf_action_sandbox_outbox SET step_run_id = (SELECT id FROM public.wf_step_run WHERE idempotency_key = 'ain02-step-ob-low2')
      WHERE idempotency_key = 'ain02-ob-high-rec1'$q$, '42501', 'ain02:step_autonomy_does_not_allow_execution');
ALTER TABLE public.wf_action_sandbox_outbox ENABLE TRIGGER ALL;
ALTER TABLE public.wf_action_draft ENABLE TRIGGER ALL;
SELECT ain02t.expect_true('every outbox and draft trigger is enabled again',
  NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid IN ('public.wf_action_sandbox_outbox'::regclass, 'public.wf_action_draft'::regclass)
               AND t.tgenabled <> 'O'));

-- ---------------------------------------------------------------------------------------------
-- 13. A run cannot borrow another agent's or template's level
-- ---------------------------------------------------------------------------------------------
SELECT ain02t.expect_error('a run cannot be re-pointed to another agent',
  format($q$UPDATE public.wf_run SET agent_ref = 'ain02-extra' WHERE id = %L$q$, ain02t.id('run_dept')), '42501', 'ain02:run_actor_is_frozen');
SELECT ain02t.expect_error('a run cannot lose its agent',
  format($q$UPDATE public.wf_run SET agent_ref = NULL WHERE id = %L$q$, ain02t.id('run_dept')), '42501', 'ain02:run_actor_is_frozen');
SELECT ain02t.expect_error('a run cannot be re-pointed to a more generous template',
  format($q$UPDATE public.wf_run SET template_id = 'f2600000-0000-4000-8000-0000000000c3' WHERE id = %L$q$, ain02t.id('run_dept_low')), '42501', 'ain02:run_actor_is_frozen');
SELECT ain02t.expect_error('the upsert path is covered too (ON CONFLICT DO UPDATE of the run agent)',
  format($q$INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps, step_count, started_by, deadline_at, started_at)
     SELECT id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps, step_count, started_by, deadline_at, started_at
       FROM public.wf_run WHERE id = %L
     ON CONFLICT (org_id, idempotency_key) DO UPDATE SET agent_ref = 'ain02-extra'$q$, ain02t.id('run_dept')), '42501', 'ain02:run_actor_is_frozen');
UPDATE public.wf_run SET agent_ref = 'ain02-dept', template_id = 'f2600000-0000-4000-8000-0000000000c3' WHERE id = ain02t.id('run_dept');
SELECT ain02t.expect_true('setting the same values again is harmless (positive twin)',
  (SELECT agent_ref = 'ain02-dept' FROM public.wf_run WHERE id = ain02t.id('run_dept')));

-- ---------------------------------------------------------------------------------------------
-- 14. Result
-- ---------------------------------------------------------------------------------------------
DO $done$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM ain02t.passed;
  RAISE NOTICE 'AIN02 ALL PASS: % checks', n;
END $done$;
ROLLBACK;
