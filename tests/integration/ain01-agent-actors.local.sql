-- AIN-01 agents as engine actors: the seeded registry and its invariants, the constraint negatives, platform grants,
-- agent state (grant, pause, organization add-on state, fail closed), the step guard (identity, state, class, daily
-- budget at limit-1 / limit / limit+1, replay, the AI-route tripwire, no autonomy promotion), the organization read
-- surface and cross-organization isolation.
-- Local disposable Postgres only. All synthetic records roll back.
BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'AIN01 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.wf_agent') IS NULL
     OR to_regprocedure('public.wf_agent_registry_get(uuid)') IS NULL
     OR to_regprocedure('public.wf_agent_state_code(uuid,text)') IS NULL
     OR to_regprocedure('public.wf_ai_route_approved()') IS NULL THEN
    RAISE EXCEPTION 'AIN01 FAIL: AIN-01 migration must be present';
  END IF;
  IF to_regclass('public.org_agent_addon_events') IS NOT NULL THEN
    RAISE EXCEPTION 'AIN01 FAIL: the real organization add-on log exists; replace the stub in this harness with it';
  END IF;
END $guard$;

CREATE SCHEMA ain01t;
GRANT USAGE ON SCHEMA ain01t TO anon, authenticated, service_role;
CREATE TABLE ain01t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE ain01t.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT, UPDATE ON ain01t.passed, ain01t.ids TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE ain01t.passed_n_seq TO anon, authenticated, service_role;
CREATE FUNCTION ain01t.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ain01t.passed (label) VALUES (p_label);
  RAISE NOTICE 'AIN01 PASS %', p_label;
END $$;
CREATE FUNCTION ain01t.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'AIN01 FAIL [%]', p_label; END IF;
  PERFORM ain01t.pass(p_label);
END $$;
CREATE FUNCTION ain01t.expect_error(p_label text, p_sql text, p_state text, p_msg text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state AND (p_msg IS NULL OR SQLERRM LIKE '%' || p_msg || '%') THEN
      PERFORM ain01t.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'AIN01 FAIL [%]: expected SQLSTATE % (%) got % (%)', p_label, p_state, p_msg, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'AIN01 FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION ain01t.id(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM ain01t.ids WHERE name = p_name
$$;
CREATE FUNCTION ain01t.keep(p_name text, p_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ain01t.ids VALUES (p_name, p_id) ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id;
  RETURN p_id;
END $$;
CREATE FUNCTION ain01t.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION ain01t.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ain01t TO anon, authenticated, service_role;

INSERT INTO ain01t.ids (name, id) VALUES
  ('orgA', 'f2500000-0000-4000-8000-0000000000a1'),
  ('orgB', 'f2500000-0000-4000-8000-0000000000b2'),
  ('adminA', 'f2500000-0000-4000-8000-000000000001'),
  ('viewer', 'f2500000-0000-4000-8000-000000000002'),
  ('plain', 'f2500000-0000-4000-8000-000000000003'),
  ('adminB', 'f2500000-0000-4000-8000-000000000004'),
  ('author', 'f2500000-0000-4000-8000-000000000005'),
  ('publisher', 'f2500000-0000-4000-8000-000000000006'),
  ('noorg', 'f2500000-0000-4000-8000-000000000007');

-- ---------------------------------------------------------------------------------------------
-- 1. Structure, privileges and function hygiene
-- ---------------------------------------------------------------------------------------------
SELECT ain01t.expect_true('the four registry tables have RLS enabled and forced',
  (SELECT count(*) = 4 AND bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
    WHERE oid IN ('public.wf_agent'::regclass, 'public.wf_agent_capability'::regclass,
                  'public.wf_agent_tier_action_class'::regclass, 'public.wf_agent_platform_grant'::regclass)));
SELECT ain01t.expect_true('no client role can write a registry table and no tenant role can read one; the service role only reads',
  NOT EXISTS (SELECT 1 FROM (VALUES ('public.wf_agent'), ('public.wf_agent_capability'),
                ('public.wf_agent_tier_action_class'), ('public.wf_agent_platform_grant')) t(n)
               WHERE has_table_privilege('anon', t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
                  OR has_table_privilege('authenticated', t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
                  OR has_table_privilege('service_role', t.n, 'INSERT,UPDATE,DELETE,TRUNCATE')
                  OR NOT has_table_privilege('service_role', t.n, 'SELECT')));
SELECT ain01t.expect_true('only the registry read and the AI-route check execute for the service role; nothing executes for tenant roles',
  (SELECT count(*) = 2 AND bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_agent_registry_get', 'wf_ai_route_approved'))
  AND (SELECT count(*) = 6 AND bool_and(NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_agent_state_code', 'wf_agent_class_allowed', 'wf_agent_step_guard',
                        'wf_agent_capability_guard', 'wf_agent_platform_grant_guard', 'wf_agent_platform_grant_audit')));
SELECT ain01t.expect_true('every AIN-01 function pins an empty search_path',
  (SELECT count(*) = 8 AND bool_and(p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_agent_registry_get', 'wf_ai_route_approved', 'wf_agent_state_code', 'wf_agent_class_allowed',
                        'wf_agent_step_guard', 'wf_agent_capability_guard', 'wf_agent_platform_grant_guard',
                        'wf_agent_platform_grant_audit')));
SELECT ain01t.expect_true('the step guard is a BEFORE INSERT trigger that runs after the autonomy guard and before the identity guard',
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_step_run'::regclass AND t.tgname = 'wf_step_run_07_agent'
            AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4 AND t.tgtype & 16 = 0)
  AND 'wf_step_run_05_autonomy' < 'wf_step_run_07_agent' AND 'wf_step_run_07_agent' < 'wf_step_run_10_guard'
  AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_step_run'::regclass AND t.tgname = 'wf_step_run_05_autonomy'));
SELECT ain01t.expect_true('the AI route is undecided',
  public.wf_ai_route_approved() IS FALSE);

-- ---------------------------------------------------------------------------------------------
-- 2. The seeded registry
-- ---------------------------------------------------------------------------------------------
SELECT ain01t.expect_true('25 platform agents and 17 organization agents are registered, all active',
  (SELECT count(*) FILTER (WHERE family = 'platform') = 25 AND count(*) FILTER (WHERE family = 'org') = 17
          AND bool_and(status = 'active') FROM public.wf_agent));
SELECT ain01t.expect_true('every organization agent code carries the org- prefix and no platform agent does',
  (SELECT bool_and((family = 'org') = (agent_ref LIKE 'org-%')) FROM public.wf_agent));
SELECT ain01t.expect_true('exactly one executive agent and it is supervised by the sheriff',
  (SELECT count(*) = 1 AND bool_and(supervisor = 'sheriff' AND agent_ref = 'jarvis-executive')
     FROM public.wf_agent WHERE agent_tier = 'executive'));
SELECT ain01t.expect_true('every platform supervisor is the sheriff or a registered agent, and no supervisor cycle exists',
  NOT EXISTS (SELECT 1 FROM public.wf_agent a WHERE a.family = 'platform' AND a.supervisor <> 'sheriff'
               AND NOT EXISTS (SELECT 1 FROM public.wf_agent s WHERE s.agent_ref = a.supervisor AND s.family = 'platform'))
  AND NOT EXISTS (
    WITH RECURSIVE up(agent_ref, cur, depth) AS (
      SELECT agent_ref, supervisor, 1 FROM public.wf_agent WHERE family = 'platform'
      UNION ALL
      SELECT u.agent_ref, a.supervisor, u.depth + 1 FROM up u JOIN public.wf_agent a ON a.agent_ref = u.cur
       WHERE u.depth < 10)
    SELECT 1 FROM up WHERE depth >= 10));
SELECT ain01t.expect_true('every department agent is supervised by the executive agent, every assurance agent by the sheriff',
  (SELECT bool_and(CASE agent_tier WHEN 'department' THEN supervisor = 'jarvis-executive'
                                   WHEN 'assurance' THEN supervisor = 'sheriff' ELSE true END)
     FROM public.wf_agent WHERE family = 'platform'));
SELECT ain01t.expect_true('assurance agents are at most T1 and none of their capabilities is above T1',
  (SELECT count(*) = 2 FROM public.wf_agent WHERE agent_tier = 'assurance')
  AND NOT EXISTS (SELECT 1 FROM public.wf_agent a JOIN public.wf_agent_capability c USING (agent_ref)
                   WHERE a.agent_tier = 'assurance' AND c.tier NOT IN ('T0', 'T1')));
SELECT ain01t.expect_true('no organization agent is above T2',
  NOT EXISTS (SELECT 1 FROM public.wf_agent WHERE family = 'org' AND max_tier = 'T3'));
SELECT ain01t.expect_true('every agent has capabilities and its highest tier equals its highest capability tier',
  NOT EXISTS (SELECT 1 FROM public.wf_agent a WHERE NOT EXISTS (SELECT 1 FROM public.wf_agent_capability c WHERE c.agent_ref = a.agent_ref))
  AND NOT EXISTS (SELECT 1 FROM public.wf_agent a
                   WHERE a.max_tier <> (SELECT max(c.tier) FROM public.wf_agent_capability c WHERE c.agent_ref = a.agent_ref)));
SELECT ain01t.expect_true('no capability above T1 is autonomous',
  NOT EXISTS (SELECT 1 FROM public.wf_agent_capability WHERE autonomy_mode = 'act_autonomously' AND tier NOT IN ('T0', 'T1')));
SELECT ain01t.expect_true('every agent has a positive action budget and zero or more model calls',
  (SELECT bool_and(daily_actions >= 1 AND daily_model_calls >= 0 AND daily_cost_cap_minor >= 0) FROM public.wf_agent));
SELECT ain01t.expect_true('every platform agent has a pause rule of the same tier (ENGINE-16), so the pause check never fails closed for it',
  NOT EXISTS (SELECT 1 FROM public.wf_agent a LEFT JOIN public.agent_pause_rules r ON r.agent_code = a.agent_ref
               WHERE a.family = 'platform' AND (r.agent_code IS NULL OR r.tier <> a.agent_tier)));
SELECT ain01t.expect_true('the tier action classes: observe-only tiers cannot communicate; money and the other capped classes need T3',
  NOT EXISTS (SELECT 1 FROM public.wf_agent_tier_action_class WHERE tier IN ('T0', 'T1') AND action_class = 'communication')
  AND EXISTS (SELECT 1 FROM public.wf_agent_tier_action_class WHERE tier = 'T2' AND action_class = 'communication')
  AND NOT EXISTS (SELECT 1 FROM public.wf_agent_tier_action_class
                   WHERE tier IN ('T0', 'T1', 'T2')
                     AND action_class IN ('money_movement', 'safeguarding', 'credential_change', 'public_publish',
                                          'mass_message', 'external_authority_share'))
  AND (SELECT count(*) = 6 FROM public.wf_agent_tier_action_class
        WHERE tier = 'T3' AND action_class IN ('money_movement', 'safeguarding', 'credential_change', 'public_publish',
                                               'mass_message', 'external_authority_share')));
SELECT ain01t.expect_true('an observe-only tier has no unclassified action; T1 and above do',
  NOT EXISTS (SELECT 1 FROM public.wf_agent_tier_action_class WHERE tier = 'T0' AND action_class = 'unclassified')
  AND (SELECT count(*) = 3 FROM public.wf_agent_tier_action_class WHERE tier IN ('T1', 'T2', 'T3') AND action_class = 'unclassified'));
SELECT ain01t.expect_true('no platform grant exists in the seed: no internal agent can act in any organization',
  NOT EXISTS (SELECT 1 FROM public.wf_agent_platform_grant));
SELECT ain01t.expect_true('the registry seeds no autonomy: AIN-01 never wrote an earned level',
  (SELECT count(*) = 0 FROM public.wf_agent_autonomy WHERE agent_ref IN (SELECT agent_ref FROM public.wf_agent)));

-- Constraint negatives.
SELECT ain01t.expect_error('a platform agent needs a supervisor',
  $q$INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ('ain01-bad1', 'platform', 'Bad', 'department', 'x', NULL, '1.0.0', 'T1', 'internal', 1, 0, 0)$q$, '23514');
SELECT ain01t.expect_error('an organization agent has no supervising agent',
  $q$INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ('org-bad2', 'org', 'Bad', 'organization', 'admin', 'jarvis-executive', '1.0.0', 'T1', 'internal', 1, 0, 0)$q$, '23514');
SELECT ain01t.expect_error('an organization agent code must start with org-',
  $q$INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ('ain01-bad3', 'org', 'Bad', 'organization', 'admin', NULL, '1.0.0', 'T1', 'internal', 1, 0, 0)$q$, '23514');
SELECT ain01t.expect_error('an organization agent cannot be T3',
  $q$INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ('org-bad4', 'org', 'Bad', 'organization', 'admin', NULL, '1.0.0', 'T3', 'internal', 1, 0, 0)$q$, '23514');
SELECT ain01t.expect_error('an assurance agent cannot be above T1',
  $q$INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ('ain01-bad5', 'platform', 'Bad', 'assurance', 'sheriff', 'sheriff', '1.0.0', 'T2', 'internal', 1, 0, 0)$q$, '23514');
SELECT ain01t.expect_error('an assurance agent reports to the sheriff, never to an agent it audits',
  $q$INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ('ain01-bad6', 'platform', 'Bad', 'assurance', 'sheriff', 'jarvis-executive', '1.0.0', 'T1', 'internal', 1, 0, 0)$q$, '23514');
SELECT ain01t.expect_error('the executive agent is supervised by the sheriff only',
  $q$INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ('ain01-bad7', 'platform', 'Bad', 'executive', 'sheriff', 'jarvis-executive', '1.0.0', 'T1', 'internal', 1, 0, 0)$q$, '23514');
SELECT ain01t.expect_error('an agent cannot supervise itself',
  $q$INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ('ain01-bad8', 'platform', 'Bad', 'department', 'x', 'ain01-bad8', '1.0.0', 'T1', 'internal', 1, 0, 0)$q$, '23514');
SELECT ain01t.expect_error('an agent code with a dot or a capital letter is refused',
  $q$INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ('Ain01.bad9', 'platform', 'Bad', 'department', 'x', 'jarvis-executive', '1.0.0', 'T1', 'internal', 1, 0, 0)$q$, '23514');
SELECT ain01t.expect_error('a zero action budget is refused',
  $q$INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ('ain01-bad10', 'platform', 'Bad', 'department', 'x', 'jarvis-executive', '1.0.0', 'T1', 'internal', 0, 0, 0)$q$, '23514');
SELECT ain01t.expect_error('a T4 agent is not representable',
  $q$INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ('ain01-bad11', 'platform', 'Bad', 'department', 'x', 'jarvis-executive', '1.0.0', 'T4', 'internal', 1, 0, 0)$q$, '23514');
SELECT ain01t.expect_error('a capability above its agent''s highest tier is refused',
  $q$INSERT INTO public.wf_agent_capability (agent_ref, capability_id, tier, autonomy_mode, requires_permission)
     SELECT agent_ref, 'ain01.too.high', 'T3', 'propose_only', 'x.y' FROM public.wf_agent WHERE max_tier = 'T1' LIMIT 1$q$,
  '23514', 'ain01:capability_above_agent_tier');
SELECT ain01t.expect_error('an autonomous capability above T1 is refused',
  $q$INSERT INTO public.wf_agent_capability (agent_ref, capability_id, tier, autonomy_mode, requires_permission)
     SELECT agent_ref, 'ain01.auto.t2', 'T2', 'act_autonomously', 'x.y' FROM public.wf_agent WHERE max_tier = 'T3' LIMIT 1$q$, '23514');
SELECT ain01t.expect_error('a capability for an unknown agent is refused',
  $q$INSERT INTO public.wf_agent_capability (agent_ref, capability_id, tier, autonomy_mode, requires_permission)
     VALUES ('no-such-agent', 'ain01.none', 'T0', 'propose_only', 'x.y')$q$, '23514');
SELECT ain01t.expect_error('a registered agent with capabilities cannot be deleted',
  $q$DELETE FROM public.wf_agent WHERE agent_ref = 'jarvis-executive'$q$, '23503');

-- ---------------------------------------------------------------------------------------------
-- 3. Fixtures: organizations, people, definitions, throwaway agents
-- ---------------------------------------------------------------------------------------------
INSERT INTO auth.users (id) SELECT id FROM ain01t.ids WHERE name NOT IN ('orgA', 'orgB');
INSERT INTO public.schools (id, name, slug) VALUES
  (ain01t.id('orgA'), 'AIN01 Org A', 'ain01-org-a'),
  (ain01t.id('orgB'), 'AIN01 Org B', 'ain01-org-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (ain01t.id('adminA'), ain01t.id('orgA'), 'AIN01 Admin A', 'admin-a@ain01.invalid', 'admin', true),
  (ain01t.id('viewer'), ain01t.id('orgA'), 'AIN01 Viewer', 'viewer@ain01.invalid', 'teacher', true),
  (ain01t.id('plain'), ain01t.id('orgA'), 'AIN01 Plain', 'plain@ain01.invalid', 'teacher', true),
  (ain01t.id('adminB'), ain01t.id('orgB'), 'AIN01 Admin B', 'admin-b@ain01.invalid', 'admin', true);

SELECT set_config('request.jwt.claim.sub', ain01t.id('adminA')::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', ain01t.id('adminA'), 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, assigned_by)
SELECT v.org_id, v.user_id, r.code, t.default_scope, NULL, v.assigned_by
  FROM (VALUES (ain01t.id('orgA'), ain01t.id('viewer'), ain01t.id('adminA'), 'auditor')) v(org_id, user_id, assigned_by, template_code)
  JOIN public.role_catalog r ON r.template_code = v.template_code AND r.org_id IS NULL
   AND NOT coalesce(r.requires_verified_authority_link, false)
  JOIN public.role_templates t ON t.code = r.template_code
 WHERE r.code = (SELECT min(r2.code) FROM public.role_catalog r2
                  WHERE r2.template_code = v.template_code AND r2.org_id IS NULL
                    AND NOT coalesce(r2.requires_verified_authority_link, false));
SELECT ain01t.logout();

INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling) VALUES
  (ain01t.id('orgA'), true, 'act_and_report'),
  (ain01t.id('orgB'), true, 'act_and_report');

-- A throwaway platform agent of a chosen ceiling and budget (the fixture inserts what only a migration can).
CREATE FUNCTION ain01t.mkagent(p_ref text, p_tier text, p_budget integer DEFAULT 1000, p_pause_rule boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_pause_rule THEN
    INSERT INTO public.agent_pause_rules (agent_code, tier, kill_scope) VALUES (p_ref, 'department', 'agent');
  END IF;
  INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier,
      context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
  VALUES (p_ref, 'platform', 'Fixture', 'department', 'fixture', 'jarvis-executive', '1.0.0', p_tier, 'internal',
      p_budget, 0, 0);
END $$;
SELECT ain01t.mkagent('ain01-t0', 'T0');
SELECT ain01t.mkagent('ain01-t1', 'T1');
SELECT ain01t.mkagent('ain01-t2', 'T2');
SELECT ain01t.mkagent('ain01-t3', 'T3');
SELECT ain01t.mkagent('ain01-small', 'T3', 3);
SELECT ain01t.mkagent('ain01-norule', 'T3', 1000, false);
INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES
  (ain01t.id('orgA'), 'ain01-t0'), (ain01t.id('orgA'), 'ain01-t1'), (ain01t.id('orgA'), 'ain01-t2'),
  (ain01t.id('orgA'), 'ain01-t3'), (ain01t.id('orgA'), 'ain01-small'), (ain01t.id('orgB'), 'ain01-small'),
  (ain01t.id('orgA'), 'ain01-norule'), (ain01t.id('orgA'), 'support-agent');

CREATE FUNCTION ain01t.mkdef(p_key text, p_org text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_def uuid := gen_random_uuid(); v_ver uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.wf_definition (id, org_id, key, name) VALUES (v_def, ain01t.id(p_org), p_key, 'AIN01 ' || p_key);
  INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by)
  VALUES (v_ver, ain01t.id(p_org), v_def, 1, '{"steps":[]}', ain01t.id('author'));
  UPDATE public.wf_version SET state = 'published', published_by = ain01t.id('publisher') WHERE id = v_ver;
  UPDATE public.wf_definition SET current_version_id = v_ver, status = 'active' WHERE id = v_def;
  PERFORM ain01t.keep('ver_' || p_key, v_ver);
  RETURN v_def;
END $$;
SELECT ain01t.mkdef('ain01-a', 'orgA');
SELECT ain01t.mkdef('ain01-b', 'orgB');

-- A template that names an agent, for the case where only the template carries the identity.
INSERT INTO public.wf_template (id, template_key, version, name, description, graph, agent_ref, autonomy_max)
VALUES ('f2500000-0000-4000-8000-0000000000c3', 'ain01-template', 1, 'AIN01 template', 'fixture', '{"steps":[]}',
        'ain01-t3', 'act_and_report');

-- A run as the engine would leave it.
CREATE FUNCTION ain01t.mkrun(p_name text, p_def text, p_agent text, p_template uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_ver public.wf_version%ROWTYPE;
BEGIN
  SELECT * INTO v_ver FROM public.wf_version WHERE id = ain01t.id('ver_' || p_def);
  INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
    step_count, started_by, deadline_at, started_at, agent_ref, template_id)
  VALUES (v_id, v_ver.org_id, v_ver.definition_id, v_ver.id, 'ain01-run-' || p_name, 'running', 3, 200, 0,
    ain01t.id('adminA'), now() + interval '1 hour', now(), p_agent, p_template);
  RETURN ain01t.keep('run_' || p_name, v_id);
END $$;
-- One step. The statement text is returned so a test can run it under a chosen role.
CREATE FUNCTION ain01t.stepsql(p_run text, p_key text, p_kind text, p_class text) RETURNS text LANGUAGE sql AS $$
  SELECT format($f$INSERT INTO public.wf_step_run (org_id, run_id, step_key, kind, idempotency_key, action_class)
     SELECT r.org_id, r.id, %L, %L, %L, %L FROM public.wf_run r WHERE r.id = %L$f$,
     p_key, p_kind, 'ain01-step-' || p_run || '-' || p_key, p_class, ain01t.id('run_' || p_run))
$$;
CREATE FUNCTION ain01t.step(p_run text, p_key text, p_kind text, p_class text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE ain01t.stepsql(p_run, p_key, p_kind, p_class);
END $$;
CREATE FUNCTION ain01t.steps_of(p_agent text, p_org text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.wf_step_run WHERE agent_ref = p_agent AND org_id = ain01t.id(p_org)
$$;
CREATE FUNCTION ain01t.audits(p_org text, p_action text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.audit_chain WHERE org_id = ain01t.id(p_org) AND action = p_action
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ain01t TO anon, authenticated, service_role;

SELECT ain01t.mkrun('none', 'ain01-a', NULL);
SELECT ain01t.mkrun('t0', 'ain01-a', 'ain01-t0');
SELECT ain01t.mkrun('t1', 'ain01-a', 'ain01-t1');
SELECT ain01t.mkrun('t2', 'ain01-a', 'ain01-t2');
SELECT ain01t.mkrun('t3', 'ain01-a', 'ain01-t3');
SELECT ain01t.mkrun('small', 'ain01-a', 'ain01-small');
SELECT ain01t.mkrun('smallb', 'ain01-b', 'ain01-small');
SELECT ain01t.mkrun('ungranted', 'ain01-b', 'ain01-t3');
SELECT ain01t.mkrun('unknown', 'ain01-a', 'ain01-never-registered');
SELECT ain01t.mkrun('norule', 'ain01-a', 'ain01-norule');
SELECT ain01t.mkrun('tpl', 'ain01-a', NULL, 'f2500000-0000-4000-8000-0000000000c3');
SELECT ain01t.mkrun('real', 'ain01-a', 'support-agent');
SELECT ain01t.mkrun('realb', 'ain01-b', 'support-agent');
SELECT ain01t.mkrun('orgag', 'ain01-a', 'org-support');
SELECT ain01t.mkrun('orgagb', 'ain01-b', 'org-support');

-- ---------------------------------------------------------------------------------------------
-- 4. Platform grants: guard and audit
-- ---------------------------------------------------------------------------------------------
SELECT ain01t.expect_error('an organization agent cannot be granted as a platform agent',
  format($q$INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES (%L, 'org-support')$q$, ain01t.id('orgA')),
  '23514', 'ain01:grant_needs_active_platform_agent');
SELECT ain01t.expect_error('an unknown agent cannot be granted',
  format($q$INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES (%L, 'nobody')$q$, ain01t.id('orgA')), '23514');
SELECT ain01t.expect_error('an organization without workflow settings cannot be granted anything',
  $q$INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES (gen_random_uuid(), 'support-agent')$q$, '23503');
SELECT ain01t.expect_error('a grant row is never updated',
  format($q$UPDATE public.wf_agent_platform_grant SET granted_by = %L WHERE agent_ref = 'support-agent'$q$, ain01t.id('adminA')), '42501');
SELECT ain01t.expect_true('granting wrote one audit entry per grant for the organization',
  ain01t.audits('orgA', 'workflow.agent_grant.granted') = 7 AND ain01t.audits('orgB', 'workflow.agent_grant.granted') = 1);
SELECT ain01t.expect_error('a tenant administrator cannot grant an internal agent to their own organization',
  format($q$SELECT ain01t.login_as('authenticated'); INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES (%L, 'sentinel-agent')$q$, ain01t.id('orgA')),
  '42501');
SELECT ain01t.logout();
SELECT ain01t.expect_error('the service role cannot grant either (only a reviewed migration writes grants)',
  format($q$SELECT ain01t.login_as('service_role'); INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES (%L, 'sentinel-agent')$q$, ain01t.id('orgA')),
  '42501');
SELECT ain01t.logout();

-- ---------------------------------------------------------------------------------------------
-- 5. Agent state, fail closed
-- ---------------------------------------------------------------------------------------------
SELECT ain01t.expect_true('an unregistered agent is unknown',
  public.wf_agent_state_code(ain01t.id('orgA'), 'ain01-never-registered') = 'agent_unknown'
  AND public.wf_agent_state_code(ain01t.id('orgA'), NULL) = 'agent_unknown');
SELECT ain01t.expect_true('a platform agent that is not granted to the organization is refused, granted ones are ok',
  public.wf_agent_state_code(ain01t.id('orgB'), 'ain01-t3') = 'agent_not_granted'
  AND public.wf_agent_state_code(ain01t.id('orgA'), 'ain01-t3') = 'ok'
  AND public.wf_agent_state_code(ain01t.id('orgB'), 'sentinel-agent') = 'agent_not_granted');
SELECT ain01t.expect_true('a platform agent with no pause rule counts as paused (ENGINE-16 fails closed)',
  public.wf_agent_state_code(ain01t.id('orgA'), 'ain01-norule') = 'agent_paused');
INSERT INTO public.agent_pause_events (action, target, reason, actor_id)
VALUES ('pause', 'ain01-t3', 'AIN01 harness pause of one agent', ain01t.id('adminA'));
SELECT ain01t.expect_true('pausing one agent stops it and no other',
  public.wf_agent_state_code(ain01t.id('orgA'), 'ain01-t3') = 'agent_paused'
  AND public.wf_agent_state_code(ain01t.id('orgA'), 'ain01-t2') = 'ok');
INSERT INTO public.agent_pause_events (action, target, reason, actor_id)
VALUES ('resume', 'ain01-t3', 'AIN01 harness resume of one agent', ain01t.id('adminA'));
SELECT ain01t.expect_true('resuming restores it',
  public.wf_agent_state_code(ain01t.id('orgA'), 'ain01-t3') = 'ok');
INSERT INTO public.agent_pause_events (action, target, reason, actor_id)
VALUES ('pause', 'all', 'AIN01 harness pause of everything', ain01t.id('adminA'));
SELECT ain01t.expect_true('a pause of everything stops every platform agent',
  public.wf_agent_state_code(ain01t.id('orgA'), 'ain01-t3') = 'agent_paused'
  AND public.wf_agent_state_code(ain01t.id('orgA'), 'ain01-t0') = 'agent_paused'
  AND public.wf_agent_state_code(ain01t.id('orgA'), 'support-agent') = 'agent_paused');
INSERT INTO public.agent_pause_events (action, target, reason, actor_id)
VALUES ('resume', 'all', 'AIN01 harness resume of everything', ain01t.id('adminA'));
SELECT ain01t.expect_true('and resuming everything restores them',
  public.wf_agent_state_code(ain01t.id('orgA'), 'ain01-t3') = 'ok'
  AND public.wf_agent_state_code(ain01t.id('orgA'), 'support-agent') = 'ok');

-- Organization agents: their state lives in objects applied outside this folder. Absent means refused.
SELECT ain01t.expect_true('with no organization add-on log the organization agent state is unavailable, never ok',
  public.wf_agent_state_code(ain01t.id('orgA'), 'org-support') = 'org_state_unavailable');
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
CREATE FUNCTION ain01t.addon(p_org text, p_agent text, p_action text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.org_agent_addon_events (org_id, agent_code, action, reason, actor_id)
  VALUES (ain01t.id(p_org), p_agent, p_action, NULL, ain01t.id('adminA'));
END $$;
GRANT EXECUTE ON FUNCTION ain01t.addon(text, text, text) TO service_role;
SELECT ain01t.expect_true('an organization agent that was never enabled is not enabled',
  public.wf_agent_state_code(ain01t.id('orgA'), 'org-support') = 'agent_not_enabled');
SELECT ain01t.addon('orgA', 'org-support', 'enable');
SELECT ain01t.expect_true('enabled in the add-on log is ok for that organization only',
  public.wf_agent_state_code(ain01t.id('orgA'), 'org-support') = 'ok'
  AND public.wf_agent_state_code(ain01t.id('orgB'), 'org-support') = 'agent_not_enabled');
SELECT ain01t.addon('orgA', 'org-support', 'pause');
SELECT ain01t.expect_true('an organization pause stops it',
  public.wf_agent_state_code(ain01t.id('orgA'), 'org-support') = 'agent_paused');
SELECT ain01t.addon('orgA', 'org-support', 'resume');
SELECT ain01t.expect_true('resume restores it',
  public.wf_agent_state_code(ain01t.id('orgA'), 'org-support') = 'ok');
SELECT ain01t.addon('orgA', 'org-support', 'platform_pause');
SELECT ain01t.expect_true('a platform pause of an organization agent stops it',
  public.wf_agent_state_code(ain01t.id('orgA'), 'org-support') = 'agent_paused');
SELECT ain01t.addon('orgA', 'org-support', 'platform_resume');
SELECT ain01t.addon('orgA', 'org-support', 'disable');
SELECT ain01t.expect_true('disabled means not enabled',
  public.wf_agent_state_code(ain01t.id('orgA'), 'org-support') = 'agent_not_enabled');
SELECT ain01t.addon('orgA', 'org-support', 'enable');
ALTER TABLE public.org_agent_addon_events RENAME COLUMN agent_code TO agent_code_renamed;
SELECT ain01t.expect_true('a log whose shape is not the reviewed one is unavailable, never ok',
  public.wf_agent_state_code(ain01t.id('orgA'), 'org-support') = 'org_state_unavailable');
ALTER TABLE public.org_agent_addon_events RENAME COLUMN agent_code_renamed TO agent_code;
SELECT ain01t.expect_true('and ok again when the shape is restored',
  public.wf_agent_state_code(ain01t.id('orgA'), 'org-support') = 'ok');

-- ---------------------------------------------------------------------------------------------
-- 6. The step guard
-- ---------------------------------------------------------------------------------------------
-- 6a. Steps with no agent are untouched.
SELECT ain01t.step('none', 'plain-action', 'action', 'communication');
SELECT ain01t.expect_true('a step with no agent is untouched and keeps a null agent',
  (SELECT agent_ref IS NULL FROM public.wf_step_run WHERE idempotency_key = 'ain01-step-none-plain-action'));

-- 6b. Identity, grant, pause.
SELECT ain01t.expect_error('an unregistered agent identity is refused',
  ain01t.stepsql('unknown', 's1', 'action', 'internal'), '42501', 'ain01:agent_unknown');
SELECT ain01t.expect_error('a platform agent not granted to the organization is refused',
  ain01t.stepsql('ungranted', 's1', 'action', 'internal'), '42501', 'ain01:agent_not_granted');
SELECT ain01t.expect_error('an agent with no pause rule is refused (paused, fail closed)',
  ain01t.stepsql('norule', 's1', 'action', 'internal'), '42501', 'ain01:agent_paused');
SELECT ain01t.step('t3', 'ok-internal', 'action', 'internal');
SELECT ain01t.expect_true('a granted, unpaused, registered agent runs and its identity is written on the step',
  ain01t.steps_of('ain01-t3', 'orgA') = 1);
INSERT INTO public.agent_pause_events (action, target, reason, actor_id)
VALUES ('pause', 'ain01-t3', 'AIN01 harness pause for the guard', ain01t.id('adminA'));
SELECT ain01t.expect_error('a paused agent gets no new step',
  ain01t.stepsql('t3', 'paused', 'action', 'internal'), '42501', 'ain01:agent_paused');
UPDATE public.wf_step_run SET status = 'running', lease_owner = 'ain01-worker', lease_expires_at = now() + interval '5 minutes'
 WHERE idempotency_key = 'ain01-step-t3-ok-internal';
SELECT ain01t.expect_true('a pause does not block finishing a step that already exists',
  (SELECT status = 'running' FROM public.wf_step_run WHERE idempotency_key = 'ain01-step-t3-ok-internal'));
INSERT INTO public.agent_pause_events (action, target, reason, actor_id)
VALUES ('resume', 'ain01-t3', 'AIN01 harness resume for the guard', ain01t.id('adminA'));
SELECT ain01t.step('t3', 'after-resume', 'action', 'internal');
SELECT ain01t.expect_true('after a resume new steps are accepted',
  ain01t.steps_of('ain01-t3', 'orgA') = 2);

-- 6c. The identity comes from the template when neither the run nor the step names one.
SELECT ain01t.step('tpl', 'from-template', 'action', 'internal');
SELECT ain01t.expect_true('a template-only agent identity is enforced and recorded on the step',
  (SELECT agent_ref = 'ain01-t3' FROM public.wf_step_run WHERE idempotency_key = 'ain01-step-tpl-from-template'));

-- 6d. Capability tier and action class.
SELECT ain01t.expect_error('an observe-only agent cannot send a communication',
  ain01t.stepsql('t0', 'comm', 'action', 'communication'), '42501', 'ain01:class_not_allowed');
SELECT ain01t.expect_error('an observe-only agent cannot run an unclassified action',
  ain01t.stepsql('t0', 'unc', 'action', 'unclassified'), '42501', 'ain01:class_not_allowed');
SELECT ain01t.step('t0', 'internal', 'action', 'internal');
SELECT ain01t.step('t0', 'wait-unc', 'wait', 'unclassified');
SELECT ain01t.step('t0', 'cond-unc', 'condition', 'unclassified');
SELECT ain01t.expect_true('an observe-only agent can run internal actions, and its waits and conditions need no class',
  ain01t.steps_of('ain01-t0', 'orgA') = 3);
SELECT ain01t.expect_error('a T1 agent cannot send a communication',
  ain01t.stepsql('t1', 'comm', 'action', 'communication'), '42501', 'ain01:class_not_allowed');
SELECT ain01t.step('t1', 'task', 'action', 'task');
SELECT ain01t.step('t1', 'unc', 'action', 'unclassified');
SELECT ain01t.expect_error('a T2 agent cannot move money',
  ain01t.stepsql('t2', 'money', 'action', 'money_movement'), '42501', 'ain01:class_not_allowed');
SELECT ain01t.expect_error('a T2 agent cannot send a mass message',
  ain01t.stepsql('t2', 'mass', 'action', 'mass_message'), '42501', 'ain01:class_not_allowed');
SELECT ain01t.step('t2', 'comm', 'action', 'communication');
SELECT ain01t.expect_error('an agent cannot invent a class outside the table',
  ain01t.stepsql('t3', 'weird', 'action', 'free_text_class'), '42501', 'ain01:class_not_allowed');
SELECT ain01t.expect_true('T1 and T2 positive twins were accepted',
  ain01t.steps_of('ain01-t1', 'orgA') = 2 AND ain01t.steps_of('ain01-t2', 'orgA') = 1);

-- 6e. No autonomy promotion: AIN-01 leaves the earned level and the draft cap exactly as WF-03 made them.
INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level)
VALUES (ain01t.id('orgA'), 'ain01-t3', 'act_and_report');
SELECT ain01t.step('tpl', 'cap-money', 'action', 'money_movement');
SELECT ain01t.step('tpl', 'cap-internal', 'action', 'internal');
SELECT ain01t.expect_true('a T3 agent can reach a capped class, but the autonomy guard still caps it at draft',
  (SELECT autonomy_level = 'draft' FROM public.wf_step_run WHERE idempotency_key = 'ain01-step-tpl-cap-money'));
SELECT ain01t.expect_true('the cap is specific: the same agent reaches its earned level on an internal action',
  (SELECT autonomy_level = 'act_and_report' FROM public.wf_step_run WHERE idempotency_key = 'ain01-step-tpl-cap-internal'));
SELECT ain01t.expect_true('an agent with no earned level stays at suggest whatever its tier',
  (SELECT autonomy_level = 'suggest' FROM public.wf_step_run WHERE idempotency_key = 'ain01-step-t2-comm')
  AND (SELECT count(*) = 0 FROM public.wf_agent_autonomy WHERE agent_ref IN ('ain01-t2', 'ain01-t1', 'ain01-t0', 'support-agent')));
SELECT ain01t.expect_true('registering and running agents wrote no autonomy row of its own',
  (SELECT count(*) = 1 FROM public.wf_agent_autonomy WHERE agent_ref LIKE 'ain01-%'));

-- 6f. Daily budget at limit-1 / limit / limit+1, per agent, per organization, with replay and aging.
SELECT ain01t.step('small', 's1', 'action', 'internal');
SELECT ain01t.step('small', 's2', 'action', 'internal');
SELECT ain01t.expect_true('limit-1: two of three used', ain01t.steps_of('ain01-small', 'orgA') = 2);
SELECT ain01t.step('small', 's3', 'action', 'internal');
SELECT ain01t.expect_true('limit: the third is accepted', ain01t.steps_of('ain01-small', 'orgA') = 3);
SELECT ain01t.expect_error('limit+1: the fourth is refused',
  ain01t.stepsql('small', 's4', 'action', 'internal'), '54000', 'ain01:budget_daily_actions');
SELECT ain01t.expect_true('a refused step left nothing behind', ain01t.steps_of('ain01-small', 'orgA') = 3);
DO $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.wf_step_run (org_id, run_id, step_key, kind, idempotency_key, action_class)
  SELECT r.org_id, r.id, 's1', 'action', 'ain01-step-small-s1', 'internal'
    FROM public.wf_run r WHERE r.id = ain01t.id('run_small')
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM ain01t.expect_true('a replay of an existing step at the limit is not refused and consumes nothing',
    v_n = 0 AND ain01t.steps_of('ain01-small', 'orgA') = 3);
END $$;
SELECT ain01t.step('smallb', 's1', 'action', 'internal');
SELECT ain01t.step('smallb', 's2', 'action', 'internal');
SELECT ain01t.step('smallb', 's3', 'action', 'internal');
SELECT ain01t.expect_true('the same agent in another organization has its own budget',
  ain01t.steps_of('ain01-small', 'orgB') = 3 AND ain01t.steps_of('ain01-small', 'orgA') = 3);
SELECT ain01t.expect_error('and that organization reaches its own limit',
  ain01t.stepsql('smallb', 's4', 'action', 'internal'), '54000', 'ain01:budget_daily_actions');
SELECT ain01t.expect_true('a different agent in the first organization is unaffected by the exhausted one',
  ain01t.steps_of('ain01-t3', 'orgA') >= 2);
CREATE FUNCTION ain01t.age_steps(p_agent text, p_org text, p_hours integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE public.wf_step_run SET created_at = now() - make_interval(hours => p_hours)
   WHERE agent_ref = p_agent AND org_id = ain01t.id(p_org);
  SET LOCAL session_replication_role = origin;
END $$;
SELECT ain01t.age_steps('ain01-small', 'orgA', 25);
SELECT ain01t.step('small', 's5', 'action', 'internal');
SELECT ain01t.step('small', 's6', 'action', 'internal');
SELECT ain01t.step('small', 's7', 'action', 'internal');
SELECT ain01t.expect_true('steps older than 24 hours stop counting: three fresh steps fit after three aged ones',
  ain01t.steps_of('ain01-small', 'orgA') = 6);
SELECT ain01t.expect_error('and the fresh three are at the limit',
  ain01t.stepsql('small', 's8', 'action', 'internal'), '54000', 'ain01:budget_daily_actions');
SELECT ain01t.age_steps('ain01-small', 'orgA', 23);
SELECT ain01t.expect_error('steps 23 hours old still count',
  ain01t.stepsql('small', 's9', 'action', 'internal'), '54000', 'ain01:budget_daily_actions');

-- 6g. The guard binds the service role too.
SELECT ain01t.login_as('service_role');
SELECT ain01t.expect_error('the service role is refused for an ungranted agent',
  ain01t.stepsql('ungranted', 's2', 'action', 'internal'), '42501', 'ain01:agent_not_granted');
SELECT ain01t.expect_error('the service role is refused beyond the daily budget',
  ain01t.stepsql('smallb', 's5', 'action', 'internal'), '54000', 'ain01:budget_daily_actions');
SELECT ain01t.logout();

-- 6h. The AI-route tripwire: no step of kind ai while decision 3 is open.
SELECT ain01t.expect_error('an ai step by an agent is refused while the AI route is undecided',
  ain01t.stepsql('t2', 'ai1', 'ai', 'ai_model'), '42501', 'ain01:ai_route_undecided');
SELECT ain01t.expect_error('an ai step with no agent is refused too',
  ain01t.stepsql('none', 'ai2', 'ai', 'ai_model'), '42501', 'ain01:ai_route_undecided');
SELECT ain01t.expect_error('an ai step is refused for the registered organization agent as well',
  ain01t.stepsql('orgag', 'ai3', 'ai', 'ai_model'), '42501', 'ain01:ai_route_undecided');
-- Simulate the reviewed migration that approves the route, inside this rolled-back transaction only.
CREATE OR REPLACE FUNCTION public.wf_ai_route_approved() RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER
  SET search_path = '' AS $$ SELECT true $$;
SELECT ain01t.step('t2', 'ai1', 'ai', 'ai_model');
SELECT ain01t.step('none', 'ai2', 'ai', 'ai_model');
SELECT ain01t.expect_true('once the route is approved an ai step is allowed for a capable agent and for no agent',
  ain01t.steps_of('ain01-t2', 'orgA') = 2
  AND (SELECT count(*) = 1 FROM public.wf_step_run WHERE idempotency_key = 'ain01-step-none-ai2'));
SELECT ain01t.expect_error('approving the route does not widen an observe-only agent: it still has no ai_model class',
  ain01t.stepsql('t0', 'ai4', 'ai', 'ai_model'), '42501', 'ain01:class_not_allowed');
SELECT ain01t.expect_error('nor does it bypass identity: an ungranted agent is still refused',
  ain01t.stepsql('ungranted', 'ai5', 'ai', 'ai_model'), '42501', 'ain01:agent_not_granted');
CREATE OR REPLACE FUNCTION public.wf_ai_route_approved() RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER
  SET search_path = '' AS $$ SELECT false $$;
SELECT ain01t.expect_error('restoring the function restores the refusal',
  ain01t.stepsql('t2', 'ai6', 'ai', 'ai_model'), '42501', 'ain01:ai_route_undecided');

-- 6i. Organization agents go through the add-on state.
SELECT ain01t.step('orgag', 'ok', 'action', 'communication');
SELECT ain01t.expect_true('an enabled organization agent runs',
  ain01t.steps_of('org-support', 'orgA') = 1);
SELECT ain01t.expect_error('the same agent in an organization that did not enable it is refused',
  ain01t.stepsql('orgagb', 'x', 'action', 'communication'), '42501', 'ain01:agent_not_enabled');
SELECT ain01t.addon('orgA', 'org-support', 'pause');
SELECT ain01t.expect_error('a paused organization agent gets no new step',
  ain01t.stepsql('orgag', 'paused', 'action', 'communication'), '42501', 'ain01:agent_paused');
SELECT ain01t.addon('orgA', 'org-support', 'resume');
ALTER TABLE public.org_agent_addon_events RENAME TO org_agent_addon_events_gone;
SELECT ain01t.expect_error('without the add-on log an organization agent step is refused (fail closed)',
  ain01t.stepsql('orgag', 'nolog', 'action', 'communication'), '42501', 'ain01:org_state_unavailable');
ALTER TABLE public.org_agent_addon_events_gone RENAME TO org_agent_addon_events;
SELECT ain01t.step('orgag', 'back', 'action', 'communication');
SELECT ain01t.expect_true('and the organization agent runs again when the log is back',
  ain01t.steps_of('org-support', 'orgA') = 2);
SELECT ain01t.expect_error('an organization agent cannot send money even when enabled (class table, T2 ceiling)',
  ain01t.stepsql('orgag', 'money', 'action', 'money_movement'), '42501', 'ain01:class_not_allowed');

-- 6j. A real catalogue agent with a real budget.
SELECT ain01t.step('real', 'r1', 'action', 'communication');
SELECT ain01t.expect_true('a seeded platform agent granted to the organization runs within its own tier',
  ain01t.steps_of('support-agent', 'orgA') = 1);
SELECT ain01t.expect_error('the same seeded agent is refused where it has no grant',
  ain01t.stepsql('realb', 'r1', 'action', 'communication'), '42501', 'ain01:agent_not_granted');

-- ---------------------------------------------------------------------------------------------
-- 7. The organization read surface
-- ---------------------------------------------------------------------------------------------
SELECT ain01t.login_as('service_role');
SELECT ain01t.expect_true('the administrator reads organization agents and the platform agents granted to the organization',
  (SELECT jsonb_array_length(d -> 'agents') = 17 + 7 AND (d ->> 'ai_route_approved')::boolean IS FALSE
          AND (d ->> 'can_manage')::boolean IS TRUE
     FROM (SELECT public.wf_agent_registry_get(ain01t.id('adminA')) d) x));
SELECT ain01t.expect_true('another organization sees the organization agents, the one platform agent granted to it, and not the others',
  (SELECT jsonb_array_length(d -> 'agents') = 17 + 1
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d -> 'agents') a
                           WHERE a ->> 'family' = 'platform' AND a ->> 'agent_ref' <> 'ain01-small')
     FROM (SELECT public.wf_agent_registry_get(ain01t.id('adminB')) d) x));
SELECT ain01t.expect_true('an internal agent that was never granted is not even listed',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.wf_agent_registry_get(ain01t.id('adminB')) -> 'agents') a
               WHERE a ->> 'agent_ref' IN ('jarvis-executive', 'sentinel-agent', 'support-agent', 'ain01-t3')));
SELECT ain01t.expect_true('a person with workflows.view reads it but cannot manage',
  (SELECT (d ->> 'can_manage')::boolean IS FALSE AND jsonb_array_length(d -> 'agents') = 24
     FROM (SELECT public.wf_agent_registry_get(ain01t.id('viewer')) d) x));
SELECT ain01t.expect_error('a person without workflows.view is refused',
  format($q$SELECT public.wf_agent_registry_get(%L)$q$, ain01t.id('plain')), '42501', 'ain01:not_authorized');
SELECT ain01t.expect_error('a person with no organization is refused',
  format($q$SELECT public.wf_agent_registry_get(%L)$q$, ain01t.id('noorg')), '42501', 'ain01:not_authorized');
SELECT ain01t.expect_error('an actor is required',
  $q$SELECT public.wf_agent_registry_get(NULL)$q$, '42501');
SELECT ain01t.expect_true('the entry for a granted agent carries its capability list, budget, class table and live state',
  (SELECT a ->> 'max_tier' = 'T2' AND a ->> 'state' = 'ok' AND a ->> 'effective_autonomy' = 'suggest'
          AND (a -> 'budget' ->> 'daily_actions')::integer > 0 AND jsonb_array_length(a -> 'capabilities') > 0
          AND (a -> 'action_classes') ? 'communication' AND NOT (a -> 'action_classes') ? 'money_movement'
          AND (a ->> 'steps_24h')::integer = 1
     FROM (SELECT x AS a FROM jsonb_array_elements(public.wf_agent_registry_get(ain01t.id('adminA')) -> 'agents') x
            WHERE x ->> 'agent_ref' = 'support-agent') s));
SELECT ain01t.expect_true('the step counts shown are the organization''s own',
  (SELECT (a ->> 'steps_24h')::integer = 3 FROM (SELECT x AS a FROM jsonb_array_elements(public.wf_agent_registry_get(ain01t.id('adminB')) -> 'agents') x
            WHERE x ->> 'agent_ref' = 'ain01-small') s)
  AND (SELECT (a ->> 'steps_24h')::integer = 0 FROM (SELECT x AS a FROM jsonb_array_elements(public.wf_agent_registry_get(ain01t.id('adminB')) -> 'agents') x
            WHERE x ->> 'agent_ref' = 'org-support') s));
SELECT ain01t.expect_true('organization agent state is shown as the guard sees it',
  (SELECT a ->> 'state' = 'ok' FROM (SELECT x AS a FROM jsonb_array_elements(public.wf_agent_registry_get(ain01t.id('adminA')) -> 'agents') x
            WHERE x ->> 'agent_ref' = 'org-support') s)
  AND (SELECT a ->> 'state' = 'agent_not_enabled' FROM (SELECT x AS a FROM jsonb_array_elements(public.wf_agent_registry_get(ain01t.id('adminB')) -> 'agents') x
            WHERE x ->> 'agent_ref' = 'org-support') s));
SELECT ain01t.expect_true('the read leaves no identity behind: the signed-in person is restored',
  coalesce(current_setting('request.jwt.claim.sub', true), '') = '');
SELECT ain01t.logout();
SELECT ain01t.login_as('authenticated');
SELECT ain01t.expect_error('a signed-in tenant role cannot call the read function directly',
  format($q$SELECT public.wf_agent_registry_get(%L)$q$, ain01t.id('adminA')), '42501');
SELECT ain01t.logout();
SELECT ain01t.login_as('anon');
SELECT ain01t.expect_error('anonymous cannot read the registry tables',
  $q$SELECT count(*) FROM public.wf_agent$q$, '42501');
SELECT ain01t.logout();

-- ---------------------------------------------------------------------------------------------
-- 8. Earlier guards and tables are intact
-- ---------------------------------------------------------------------------------------------
SELECT ain01t.expect_error('a step still cannot change its agent after insert (WF-03 identity rule)',
  $q$UPDATE public.wf_step_run SET agent_ref = 'ain01-t2' WHERE idempotency_key = 'ain01-step-t3-ok-internal'$q$, '42501', 'immutable');
SELECT ain01t.expect_error('a step still cannot name a different agent from its run (WF-03)',
  format($q$INSERT INTO public.wf_step_run (org_id, run_id, step_key, kind, idempotency_key, action_class, agent_ref)
     VALUES (%L, %L, 'mismatch', 'action', 'ain01-step-mismatch', 'internal', 'ain01-t2')$q$, ain01t.id('orgA'), ain01t.id('run_t3')),
  '42501', 'agent does not match run');
SELECT ain01t.expect_true('the registry does not weaken the autonomy table: its privileges are unchanged for tenant roles',
  NOT has_table_privilege('authenticated', 'public.wf_agent_autonomy', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('anon', 'public.wf_agent_autonomy', 'SELECT,INSERT,UPDATE,DELETE'));

SELECT 'AIN01 ALL PASS: ' || count(*) || ' checks' FROM ain01t.passed;
ROLLBACK;
