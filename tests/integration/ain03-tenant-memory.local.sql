-- AIN-03 tenant memory and context scopes: structure and exact privileges, the value shape, person writes, agent
-- proposals, decisions, retirement, the guards as a backstop (insert, update, upsert, delete, truncate), caps, the closed
-- agent read path, retention, the ledger and the audit chain, member isolation. Local disposable Postgres only.
-- All synthetic records roll back.
BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'AIN03 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.wf_memory_item') IS NULL
     OR to_regprocedure('public.wf_memory_put(uuid,text,text,text,text,jsonb,integer,boolean)') IS NULL
     OR to_regclass('public.wf_autonomy_change') IS NULL THEN
    RAISE EXCEPTION 'AIN03 FAIL: the AIN-01, AIN-02 and AIN-03 migrations must be present';
  END IF;
END $guard$;

CREATE SCHEMA ain03t;
GRANT USAGE ON SCHEMA ain03t TO anon, authenticated, service_role;
CREATE TABLE ain03t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE ain03t.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT, UPDATE ON ain03t.passed, ain03t.ids TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE ain03t.passed_n_seq TO anon, authenticated, service_role;
CREATE FUNCTION ain03t.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ain03t.passed (label) VALUES (p_label);
  RAISE NOTICE 'AIN03 PASS %', p_label;
END $$;
CREATE FUNCTION ain03t.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'AIN03 FAIL [%]', p_label; END IF;
  PERFORM ain03t.pass(p_label);
END $$;
CREATE FUNCTION ain03t.expect_error(p_label text, p_sql text, p_state text, p_msg text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state AND (p_msg IS NULL OR SQLERRM LIKE '%' || p_msg || '%') THEN
      PERFORM ain03t.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'AIN03 FAIL [%]: expected SQLSTATE % (%) got % (%)', p_label, p_state, p_msg, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'AIN03 FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION ain03t.id(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM ain03t.ids WHERE name = p_name
$$;
CREATE FUNCTION ain03t.keep(p_name text, p_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ain03t.ids VALUES (p_name, p_id) ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id;
  RETURN p_id;
END $$;
CREATE FUNCTION ain03t.login_as(p_role text, p_user uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', p_user)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION ain03t.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
-- Run one statement as the database owner (the harness is local and disposable): used to age rows, to change the reviewed
-- data a test needs and to simulate a bug in a function by opening the write window by hand.
CREATE FUNCTION ain03t.owner(p_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN EXECUTE p_sql; END $$;
CREATE FUNCTION ain03t.window(p_actor text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('ain03.writer', 'tx:' || txid_current()::text, true);
  PERFORM set_config('ain03.actor', p_actor, true);
END $$;
CREATE FUNCTION ain03t.shut() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('ain03.writer', '', true);
  PERFORM set_config('ain03.actor', '', true);
  PERFORM set_config('ain03.purge', '', true);
END $$;
-- Move an item's whole lifetime into the past (a harness cannot wait): created and expired p_days_ago days back.
CREATE FUNCTION ain03t.age(p_item uuid, p_days integer, p_expired boolean DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  ALTER TABLE public.wf_memory_item DISABLE TRIGGER USER;
  UPDATE public.wf_memory_item
     SET created_at = created_at - make_interval(days => p_days) - interval '2 hours',
         expires_at = CASE WHEN p_expired THEN now() - make_interval(days => p_days) ELSE expires_at END,
         retired_at = CASE WHEN retired_at IS NULL THEN NULL ELSE retired_at - make_interval(days => p_days) END
   WHERE id = p_item;
  ALTER TABLE public.wf_memory_item ENABLE TRIGGER USER;
END $$;
CREATE FUNCTION ain03t.age_keys(p_org text, p_like text, p_days integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ids uuid[]; v_id uuid;
BEGIN
  SELECT array_agg(id) INTO v_ids FROM public.wf_memory_item WHERE org_id = ain03t.id(p_org) AND key LIKE p_like;
  FOREACH v_id IN ARRAY v_ids LOOP PERFORM ain03t.age(v_id, p_days); END LOOP;
END $$;
CREATE FUNCTION ain03t.age_ledger(p_org uuid, p_hours integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  ALTER TABLE public.wf_memory_change DISABLE TRIGGER USER;
  UPDATE public.wf_memory_change SET created_at = created_at - make_interval(hours => p_hours) WHERE org_id = p_org;
  ALTER TABLE public.wf_memory_change ENABLE TRIGGER USER;
END $$;
CREATE FUNCTION ain03t.ops(p_org text, p_op text) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*) FROM public.wf_memory_change WHERE org_id = ain03t.id(p_org) AND op = p_op
$$;
CREATE FUNCTION ain03t.audits(p_org text, p_action text) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*) FROM public.audit_chain WHERE org_id = ain03t.id(p_org) AND action = p_action
$$;
CREATE FUNCTION ain03t.item(p_org text, p_kind text, p_ref text, p_key text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id FROM public.wf_memory_item WHERE org_id = ain03t.id(p_org) AND scope_kind = p_kind AND scope_ref = p_ref
     AND key = p_key AND status <> 'retired'
$$;
CREATE FUNCTION ain03t.facts(p_item uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
  SELECT to_jsonb(i) FROM public.wf_memory_item i WHERE i.id = p_item
$$;
CREATE FUNCTION ain03t.live(p_org text) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*) FROM public.wf_memory_item WHERE org_id = ain03t.id(p_org) AND status <> 'retired'
$$;
-- SQL text for the entry points, so a refused call can be passed to expect_error.
CREATE FUNCTION ain03t.put(p_who text, p_kind text, p_ref text, p_key text, p_class text, p_value text,
  p_ttl integer DEFAULT NULL, p_ai boolean DEFAULT false) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.wf_memory_put(%L, %L, %L, %L, %L, %L::jsonb, %s, %L)',
    ain03t.id(p_who), p_kind, p_ref, p_key, p_class, p_value, coalesce(p_ttl::text, 'NULL'), p_ai)
$$;
CREATE FUNCTION ain03t.propose(p_run text, p_kind text, p_ref text, p_key text, p_value text, p_ttl integer DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.wf_memory_agent_propose(%L, %L, %L, %L, %L::jsonb, %s)',
    ain03t.id('run_' || p_run), p_kind, p_ref, p_key, p_value, coalesce(p_ttl::text, 'NULL'))
$$;
CREATE FUNCTION ain03t.decide(p_who text, p_item uuid, p_decision text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.wf_memory_decide(%L, %L, %L)', ain03t.id(p_who), p_item, p_decision)
$$;
CREATE FUNCTION ain03t.retire(p_who text, p_item uuid) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.wf_memory_retire(%L, %L)', ain03t.id(p_who), p_item)
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ain03t TO anon, authenticated, service_role;

INSERT INTO ain03t.ids (name, id) VALUES
  ('orgA', 'f3600000-0000-4000-8000-0000000000a1'),
  ('orgB', 'f3600000-0000-4000-8000-0000000000b2'),
  ('orgC', 'f3600000-0000-4000-8000-0000000000c3'),
  ('adminA', 'f3600000-0000-4000-8000-000000000001'),
  ('viewer', 'f3600000-0000-4000-8000-000000000002'),
  ('adminB', 'f3600000-0000-4000-8000-000000000004'),
  ('adminC', 'f3600000-0000-4000-8000-000000000005'),
  ('stranger', 'f3600000-0000-4000-8000-000000000006'),
  ('author', 'f3600000-0000-4000-8000-000000000007'),
  ('publisher', 'f3600000-0000-4000-8000-000000000008'),
  ('founder', 'f3600000-0000-4000-8000-000000000009');

-- ---------------------------------------------------------------------------------------------
-- 1. Structure, exact privileges and function hygiene
-- ---------------------------------------------------------------------------------------------
SELECT ain03t.expect_true('the three new tables have RLS enabled and forced',
  (SELECT count(*) = 3 AND bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
    WHERE oid IN ('public.wf_memory_scope_kind'::regclass, 'public.wf_memory_item'::regclass, 'public.wf_memory_change'::regclass)));
SELECT ain03t.expect_true('anon has no privilege on any memory table',
  NOT EXISTS (SELECT 1 FROM (VALUES ('public.wf_memory_scope_kind'), ('public.wf_memory_item'), ('public.wf_memory_change')) t(n)
               WHERE has_table_privilege('anon', t.n, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')));
SELECT ain03t.expect_true('the service role has NO privilege on wf_memory_item (the engine cannot read a stored value)',
  NOT has_table_privilege('service_role', 'public.wf_memory_item', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges
                   WHERE table_schema = 'public' AND table_name = 'wf_memory_item' AND grantee = 'service_role'));
SELECT ain03t.expect_true('the service role only reads the reference data and the ledger',
  has_table_privilege('service_role', 'public.wf_memory_scope_kind', 'SELECT')
  AND has_table_privilege('service_role', 'public.wf_memory_change', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.wf_memory_scope_kind', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT has_table_privilege('service_role', 'public.wf_memory_change', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
SELECT ain03t.expect_true('signed-in members can only SELECT the items and the ledger, and nothing on the reference data',
  has_table_privilege('authenticated', 'public.wf_memory_item', 'SELECT')
  AND has_table_privilege('authenticated', 'public.wf_memory_change', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.wf_memory_item', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT has_table_privilege('authenticated', 'public.wf_memory_change', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT has_table_privilege('authenticated', 'public.wf_memory_scope_kind', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));
SELECT ain03t.expect_true('PUBLIC holds no privilege on any memory table',
  NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
               WHERE c.oid IN ('public.wf_memory_scope_kind'::regclass, 'public.wf_memory_item'::regclass,
                               'public.wf_memory_change'::regclass) AND a.grantee = 0));
SELECT ain03t.expect_true('exactly six AIN-03 functions execute for the service role; no client role executes any',
  (SELECT count(*) = 6 AND bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_memory_put', 'wf_memory_agent_propose', 'wf_memory_decide', 'wf_memory_retire',
                        'wf_memory_agent_read', 'wf_memory_purge_expired'))
  AND (SELECT count(*) = 8 AND bool_and(NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_memory_org_item_cap', 'wf_memory_agent_daily_proposals', 'wf_memory_value_ok', 'wf_memory_open',
                        'wf_memory_close', 'wf_memory_item_guard', 'wf_memory_item_delete_guard', 'wf_memory_item_audit')));
SELECT ain03t.expect_true('PUBLIC can execute no AIN-03 function',
  NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               WHERE p.pronamespace = 'public'::regnamespace AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
                 AND p.proname LIKE 'wf\_memory\_%'));
SELECT ain03t.expect_true('every AIN-03 function pins an empty search_path',
  (SELECT count(*) = 14 AND bool_and(p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'wf\_memory\_%'));
SELECT ain03t.expect_true('the entry points and the guards are SECURITY DEFINER; the pure helpers and the window helpers are not',
  (SELECT bool_and(p.prosecdef) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('wf_memory_put', 'wf_memory_agent_propose', 'wf_memory_decide', 'wf_memory_retire', 'wf_memory_agent_read',
                      'wf_memory_purge_expired', 'wf_memory_item_guard', 'wf_memory_item_delete_guard', 'wf_memory_item_audit'))
  AND (SELECT NOT bool_or(p.prosecdef) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('wf_memory_org_item_cap', 'wf_memory_agent_daily_proposals', 'wf_memory_value_ok', 'wf_memory_open', 'wf_memory_close')));
SELECT ain03t.expect_true('the guards are wired where the design says (insert and update; delete; truncate; audit after every row change)',
  EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_memory_item'::regclass AND t.tgname = 'wf_memory_item_10_guard'
            AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4 AND t.tgtype & 16 = 16 AND t.tgtype & 1 = 1 AND NOT t.tgisinternal)
  AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_memory_item'::regclass AND t.tgname = 'wf_memory_item_20_delete_guard'
            AND t.tgtype & 2 = 2 AND t.tgtype & 8 = 8 AND t.tgtype & 1 = 1)
  AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_memory_item'::regclass AND t.tgname = 'wf_memory_item_20_no_truncate'
            AND t.tgtype & 2 = 2 AND t.tgtype & 32 = 32 AND t.tgtype & 1 = 0)
  AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_memory_item'::regclass AND t.tgname = 'wf_memory_item_90_audit'
            AND t.tgtype & 2 = 0 AND t.tgtype & 4 = 4 AND t.tgtype & 8 = 8 AND t.tgtype & 16 = 16)
  AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_memory_change'::regclass AND t.tgname = 'wf_memory_change_no_mutation')
  AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.wf_memory_change'::regclass AND t.tgname = 'wf_memory_change_no_truncate'));
SELECT ain03t.expect_true('the ledger has no column that could hold content', NOT EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wf_memory_change'
     AND column_name IN ('value', 'payload', 'content', 'detail', 'note', 'text')));
SELECT ain03t.expect_true('the AI route is still closed in this migration set', NOT public.wf_ai_route_approved());

-- ---------------------------------------------------------------------------------------------
-- 2. Reviewed data and the value shape
-- ---------------------------------------------------------------------------------------------
SELECT ain03t.expect_true('four scopes with the reviewed lifetimes and caps; only agent and run take agent proposals',
  (SELECT string_agg(kind || ':' || default_ttl_days || ':' || max_ttl_days || ':' || max_items || ':' || agent_may_propose, ',' ORDER BY kind)
     FROM public.wf_memory_scope_kind) = 'agent:90:365:200:true,organization:365:1095:300:false,run:7:30:50:true,workflow:180:730:200:false');
SELECT ain03t.expect_true('the cross-scope caps are 2000 items per organization and 50 proposals per agent per day',
  public.wf_memory_org_item_cap() = 2000 AND public.wf_memory_agent_daily_proposals() = 50);
SELECT ain03t.expect_error('an agent can never be given the organization scope in the data',
  $q$UPDATE public.wf_memory_scope_kind SET agent_may_propose = true WHERE kind = 'organization'$q$, '23514');
SELECT ain03t.expect_error('an agent can never be given the workflow scope in the data',
  $q$UPDATE public.wf_memory_scope_kind SET agent_may_propose = true WHERE kind = 'workflow'$q$, '23514');
SELECT ain03t.expect_error('the agent scope cannot be taken from agents by a data edit either (the rule is the CHECK, both ways)',
  $q$UPDATE public.wf_memory_scope_kind SET agent_may_propose = false WHERE kind = 'run'$q$, '23514');
SELECT ain03t.expect_error('a default lifetime above the maximum is refused',
  $q$UPDATE public.wf_memory_scope_kind SET default_ttl_days = 400 WHERE kind = 'run'$q$, '23514');
SELECT ain03t.expect_error('a maximum lifetime above three years is refused',
  $q$UPDATE public.wf_memory_scope_kind SET max_ttl_days = 1096 WHERE kind = 'organization'$q$, '23514');
SELECT ain03t.expect_error('a scope kind that is not one of the four is refused',
  $q$INSERT INTO public.wf_memory_scope_kind (kind, default_ttl_days, max_ttl_days, max_items, agent_may_propose, label)
     VALUES ('person', 1, 1, 1, false, 'A person scope')$q$, '23514');
SELECT ain03t.expect_true('value shape: a flat object of codes is accepted in reference class',
  public.wf_memory_value_ok('reference', '{"plan_code":"term-1","limit":3,"enabled":true,"ref":"a/b:c.d_e-f"}'));
SELECT ain03t.expect_true('value shape: short text is accepted in note class',
  public.wf_memory_value_ok('note', '{"text":"Prefers a reminder before the due date."}'));
SELECT ain03t.expect_true('value shape: nested objects, lists, nulls, empty objects and non-objects are refused',
  NOT public.wf_memory_value_ok('note', '{"a":{"b":1}}') AND NOT public.wf_memory_value_ok('note', '{"a":[1]}')
  AND NOT public.wf_memory_value_ok('note', '{"a":null}') AND NOT public.wf_memory_value_ok('note', '{}')
  AND NOT public.wf_memory_value_ok('note', '[1]') AND NOT public.wf_memory_value_ok('note', '"x"')
  AND NOT public.wf_memory_value_ok('note', NULL));
SELECT ain03t.expect_true('value shape: reference strings are ids and codes only (no space, no @, no empty string)',
  NOT public.wf_memory_value_ok('reference', '{"a":"two words"}') AND NOT public.wf_memory_value_ok('reference', '{"a":"x@y.example"}')
  AND NOT public.wf_memory_value_ok('reference', '{"a":""}') AND NOT public.wf_memory_value_ok('reference', '{"a":"+234 801 000 0000"}')
  AND NOT public.wf_memory_value_ok('reference', ('{"a":"' || repeat('x', 201) || '"}')::jsonb));
SELECT ain03t.expect_true('value shape: keys are lower-case words; at most 20 entries; a note is at most 300 characters; at most 4096 bytes',
  NOT public.wf_memory_value_ok('note', '{"Bad":"x"}') AND NOT public.wf_memory_value_ok('note', '{"a-b":"x"}')
  AND NOT public.wf_memory_value_ok('note', '{"1a":"x"}')
  AND NOT public.wf_memory_value_ok('note', (SELECT jsonb_object_agg('k' || g, 1) FROM generate_series(1, 21) g))
  AND public.wf_memory_value_ok('note', (SELECT jsonb_object_agg('k' || g, 1) FROM generate_series(1, 20) g))
  AND NOT public.wf_memory_value_ok('note', ('{"a":"' || repeat('x', 301) || '"}')::jsonb)
  AND public.wf_memory_value_ok('note', ('{"a":"' || repeat('x', 300) || '"}')::jsonb)
  AND NOT public.wf_memory_value_ok('note', (SELECT jsonb_object_agg('k' || lpad(g::text, 2, '0'), repeat('x', 300)) FROM generate_series(1, 20) g))
  AND NOT public.wf_memory_value_ok('other', '{"a":1}') AND NOT public.wf_memory_value_ok(NULL, '{"a":1}'));

-- ---------------------------------------------------------------------------------------------
-- 3. Fixtures: organizations, people, agents, workflows, runs
-- ---------------------------------------------------------------------------------------------
INSERT INTO auth.users (id) SELECT id FROM ain03t.ids WHERE name NOT IN ('orgA', 'orgB', 'orgC');
INSERT INTO public.schools (id, name, slug) VALUES
  (ain03t.id('orgA'), 'AIN03 Org A', 'ain03-org-a'),
  (ain03t.id('orgB'), 'AIN03 Org B', 'ain03-org-b'),
  (ain03t.id('orgC'), 'AIN03 Org C', 'ain03-org-c');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (ain03t.id('adminA'), ain03t.id('orgA'), 'AIN03 Admin A', 'admin-a@ain03.invalid', 'admin', true),
  (ain03t.id('viewer'), ain03t.id('orgA'), 'AIN03 Viewer', 'viewer@ain03.invalid', 'teacher', true),
  (ain03t.id('adminB'), ain03t.id('orgB'), 'AIN03 Admin B', 'admin-b@ain03.invalid', 'admin', true),
  (ain03t.id('adminC'), ain03t.id('orgC'), 'AIN03 Admin C', 'admin-c@ain03.invalid', 'admin', true);
INSERT INTO public.super_admins (id, full_name, email, is_active)
VALUES (ain03t.id('founder'), 'AIN03 Founder', 'founder@ain03.invalid', true);
INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling) VALUES
  (ain03t.id('orgA'), true, 'act_and_report'),
  (ain03t.id('orgB'), true, 'act_and_report'),
  (ain03t.id('orgC'), false, 'draft');

CREATE FUNCTION ain03t.mkagent(p_ref text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.agent_pause_rules (agent_code, tier, kill_scope) VALUES (p_ref, 'department', 'agent');
  INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version, max_tier,
      context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
  VALUES (p_ref, 'platform', 'Fixture', 'department', 'fixture', 'jarvis-executive', '1.0.0', 'T3', 'internal', 100000, 0, 0);
END $$;
SELECT ain03t.mkagent('ain03-a');
SELECT ain03t.mkagent('ain03-b');
SELECT ain03t.mkagent('ain03-ungranted');
INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES
  (ain03t.id('orgA'), 'ain03-a'), (ain03t.id('orgB'), 'ain03-a'), (ain03t.id('orgA'), 'ain03-b'), (ain03t.id('orgC'), 'ain03-a');

CREATE FUNCTION ain03t.mkdef(p_key text, p_org text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_def uuid := gen_random_uuid(); v_ver uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.wf_definition (id, org_id, key, name) VALUES (v_def, ain03t.id(p_org), p_key, 'AIN03 ' || p_key);
  INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by)
  VALUES (v_ver, ain03t.id(p_org), v_def, 1, '{"steps":[]}', ain03t.id('author'));
  UPDATE public.wf_version SET state = 'published', published_by = ain03t.id('publisher') WHERE id = v_ver;
  UPDATE public.wf_definition SET current_version_id = v_ver, status = 'active' WHERE id = v_def;
  PERFORM ain03t.keep('ver_' || p_key, v_ver);
  RETURN v_def;
END $$;
SELECT ain03t.mkdef('ain03-wf', 'orgA');
SELECT ain03t.mkdef('ain03-wf2', 'orgA');
SELECT ain03t.mkdef('ain03-wfb', 'orgB');
SELECT ain03t.mkdef('ain03-wfc', 'orgC');

CREATE FUNCTION ain03t.mkrun(p_name text, p_def text, p_agent text, p_status text DEFAULT 'running') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_ver public.wf_version%ROWTYPE;
BEGIN
  SELECT * INTO v_ver FROM public.wf_version WHERE id = ain03t.id('ver_' || p_def);
  INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
    step_count, started_by, deadline_at, started_at, agent_ref)
  VALUES (v_id, v_ver.org_id, v_ver.definition_id, v_ver.id, 'ain03-run-' || p_name, 'running', 3, 200, 0,
    ain03t.id('adminA'), now() + interval '1 hour', now(), p_agent);
  IF p_status <> 'running' THEN
    UPDATE public.wf_run SET status = p_status, finished_at = now() WHERE id = v_id;
  END IF;
  RETURN ain03t.keep('run_' || p_name, v_id);
END $$;
SELECT ain03t.mkrun('a', 'ain03-wf', 'ain03-a');
SELECT ain03t.mkrun('a2', 'ain03-wf', 'ain03-a');
SELECT ain03t.mkrun('b', 'ain03-wf2', 'ain03-b');
SELECT ain03t.mkrun('ab', 'ain03-wfb', 'ain03-a');
SELECT ain03t.mkrun('done', 'ain03-wf', 'ain03-a', 'succeeded');
SELECT ain03t.mkrun('none', 'ain03-wf', NULL);
SELECT ain03t.mkrun('ungranted', 'ain03-wf', 'ain03-ungranted');
SELECT ain03t.mkrun('c', 'ain03-wfc', 'ain03-a');
SELECT ain03t.expect_true('fixtures: the runs exist with the agents and statuses the tests rely on',
  (SELECT status FROM public.wf_run WHERE id = ain03t.id('run_done')) = 'succeeded'
  AND (SELECT agent_ref FROM public.wf_run WHERE id = ain03t.id('run_none')) IS NULL
  AND public.wf_agent_state_code(ain03t.id('orgA'), 'ain03-a') = 'ok'
  AND public.wf_agent_state_code(ain03t.id('orgA'), 'ain03-ungranted') <> 'ok');

-- ---------------------------------------------------------------------------------------------
-- 4. A person writes
-- ---------------------------------------------------------------------------------------------
SELECT ain03t.login_as('service_role');
SELECT ain03t.keep('put1', (public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'term-plan', 'reference',
  '{"plan_code":"term-1","term_count":3}', NULL, false) ->> 'id')::uuid);
SELECT ain03t.logout();
SELECT ain03t.expect_true('a manager writes an organization item: active, version 1, source person, default lifetime of 365 days',
  (SELECT status = 'active' AND version = 1 AND source_kind = 'person' AND source_person = ain03t.id('adminA')
          AND data_class = 'reference' AND NOT ai_readable AND org_id = ain03t.id('orgA') AND scope_ref = ''
          AND expires_at = now() + interval '365 days'
     FROM public.wf_memory_item WHERE id = ain03t.id('put1')));
SELECT ain03t.expect_true('the write left one ledger row (write, person, a hash and no content) and one audit entry',
  ain03t.ops('orgA', 'write') = 1 AND ain03t.audits('orgA', 'workflow.memory.write') = 1
  AND (SELECT actor_kind = 'person' AND actor_person = ain03t.id('adminA') AND version = 1
              AND value_sha256 = encode(sha256(convert_to('{"plan_code": "term-1", "term_count": 3}', 'UTF8')), 'hex')
         FROM public.wf_memory_change WHERE item_id = ain03t.id('put1')));
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_true('writing the same key again replaces it in place: same row, version 2, new value, one live row',
  (public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'term-plan', 'reference', '{"plan_code":"term-2"}', 30, false) ->> 'version')::int = 2);
SELECT ain03t.logout();
SELECT ain03t.expect_true('the replace is one live row, the same id, a 30 day lifetime, and a second ledger row of kind update',
  (SELECT count(*) = 1 AND min(version) = 2 AND min(value ->> 'plan_code') = 'term-2' AND min(id::text) = ain03t.id('put1')::text
          AND min(expires_at) = now() + interval '30 days'
     FROM public.wf_memory_item WHERE org_id = ain03t.id('orgA') AND key = 'term-plan')
  AND ain03t.ops('orgA', 'update') = 1);
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_error('a person without workflows.manage cannot write',
  ain03t.put('viewer', 'organization', '', 'denied-key', 'reference', '{"a":"b"}'), '42501', 'ain03:not_authorized');
SELECT ain03t.expect_error('a stranger with no organization cannot write',
  ain03t.put('stranger', 'organization', '', 'denied-key', 'reference', '{"a":"b"}'), '42501', 'ain03:not_authorized');
SELECT ain03t.expect_error('an unknown person id cannot write',
  format($q$SELECT public.wf_memory_put(%L, 'organization', '', 'denied-key', 'reference', '{"a":"b"}', NULL, false)$q$, gen_random_uuid()),
  '42501', 'ain03:not_authorized');
SELECT ain03t.expect_error('a null person is refused',
  $q$SELECT public.wf_memory_put(NULL, 'organization', '', 'denied-key', 'reference', '{"a":"b"}', NULL, false)$q$, '42501');
SELECT ain03t.expect_error('an organization with workflows off cannot get memory',
  ain03t.put('adminC', 'organization', '', 'off-key', 'reference', '{"a":"b"}'), '42501', 'ain03:workflows_disabled');
SELECT ain03t.expect_error('a lifetime of zero days is refused',
  ain03t.put('adminA', 'organization', '', 'ttl-key', 'reference', '{"a":"b"}', 0), '22023', 'ain03:lifetime_out_of_bounds');
SELECT ain03t.expect_error('a lifetime above the scope maximum is refused (run: 30)',
  ain03t.put('adminA', 'run', ain03t.id('run_a')::text, 'ttl-key', 'reference', '{"a":"b"}', 31), '22023', 'ain03:lifetime_out_of_bounds');
SELECT ain03t.expect_true('a lifetime exactly at the maximum is accepted (positive twin)',
  (public.wf_memory_put(ain03t.id('adminA'), 'run', ain03t.id('run_a')::text, 'ttl-key', 'reference', '{"a":"b"}', 30, false) ->> 'version')::int = 1);
SELECT ain03t.expect_error('a negative lifetime is refused',
  ain03t.put('adminA', 'organization', '', 'ttl-key2', 'reference', '{"a":"b"}', -3), '22023', 'ain03:lifetime_out_of_bounds');
SELECT ain03t.expect_error('a bad key is refused', ain03t.put('adminA', 'organization', '', 'Bad Key', 'reference', '{"a":"b"}'), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('a key of one character is refused', ain03t.put('adminA', 'organization', '', 'k', 'reference', '{"a":"b"}'), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('an unknown class is refused', ain03t.put('adminA', 'organization', '', 'kk', 'secret', '{"a":"b"}'), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('an unknown scope kind is refused', ain03t.put('adminA', 'person', 'x', 'kk', 'reference', '{"a":"b"}'), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('a name or sentence in reference class is refused', ain03t.put('adminA', 'organization', '', 'kk', 'reference', '{"owner":"Ada Obi"}'), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('an email address in reference class is refused', ain03t.put('adminA', 'organization', '', 'kk', 'reference', '{"owner":"a@b.example"}'), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('a nested value is refused', ain03t.put('adminA', 'organization', '', 'kk', 'note', '{"a":{"b":1}}'), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('a note that is too long is refused', format('SELECT public.wf_memory_put(%L, ''organization'', '''', ''kk'', ''note'', %L::jsonb, NULL, false)', ain03t.id('adminA'), ('{"a":"' || repeat('x', 301) || '"}')), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('a null value is refused', format('SELECT public.wf_memory_put(%L, ''organization'', '''', ''kk'', ''note'', NULL, NULL, false)', ain03t.id('adminA')), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('a note can never be marked readable by an agent',
  ain03t.put('adminA', 'organization', '', 'kk', 'note', '{"a":"b"}', NULL, true), '22023', 'ain03:only_reference_memory_can_be_ai_readable');
SELECT ain03t.expect_error('the organization scope takes no reference', ain03t.put('adminA', 'organization', 'something', 'kk', 'reference', '{"a":"b"}'), '23514');
SELECT ain03t.expect_error('a workflow scope must name a workflow of this organization',
  ain03t.put('adminA', 'workflow', 'no-such-workflow', 'kk', 'reference', '{"a":"b"}'), '23503', 'ain03:scope_reference_unknown');
SELECT ain03t.expect_error('a workflow of another organization is not a valid scope here',
  ain03t.put('adminA', 'workflow', 'ain03-wfb', 'kk', 'reference', '{"a":"b"}'), '23503', 'ain03:scope_reference_unknown');
SELECT ain03t.expect_error('an agent scope must name a registered agent',
  ain03t.put('adminA', 'agent', 'nobody-here', 'kk', 'reference', '{"a":"b"}'), '23503', 'ain03:scope_reference_unknown');
SELECT ain03t.expect_error('a run scope must name a run of this organization (a run of another organization is not found)',
  ain03t.put('adminA', 'run', ain03t.id('run_ab')::text, 'kk', 'reference', '{"a":"b"}'), '23503', 'ain03:scope_reference_unknown');
SELECT ain03t.expect_true('workflow and agent scopes accept real references (positive twins)',
  (public.wf_memory_put(ain03t.id('adminA'), 'workflow', 'ain03-wf', 'wf-setting', 'reference', '{"mode":"strict"}', NULL, false) ->> 'version')::int = 1
  AND (public.wf_memory_put(ain03t.id('adminA'), 'agent', 'ain03-a', 'agent-setting', 'reference', '{"mode":"quiet"}', NULL, false) ->> 'version')::int = 1);
SELECT ain03t.expect_true('the same key in the other organization is independent',
  (public.wf_memory_put(ain03t.id('adminB'), 'organization', '', 'term-plan', 'reference', '{"plan_code":"b-1"}', NULL, false) ->> 'version')::int = 1
  AND ain03t.item('orgA', 'organization', '', 'term-plan') IS NOT NULL AND ain03t.item('orgB', 'organization', '', 'term-plan') IS NOT NULL
  AND ain03t.item('orgA', 'organization', '', 'term-plan') <> ain03t.item('orgB', 'organization', '', 'term-plan'));
SELECT ain03t.logout();

-- ---------------------------------------------------------------------------------------------
-- 5. Caps: per scope, per organization (the reviewed numbers are lowered for the test and restored)
-- ---------------------------------------------------------------------------------------------
SELECT ain03t.owner($q$UPDATE public.wf_memory_scope_kind SET max_items = 3 WHERE kind = 'run'$q$);
SELECT ain03t.login_as('service_role');
SELECT public.wf_memory_put(ain03t.id('adminA'), 'run', ain03t.id('run_a2')::text, 'cap-' || g, 'reference', '{"a":"b"}', NULL, false)
  FROM generate_series(1, 3) g;
SELECT ain03t.expect_error('the fourth item in a scope that holds three is refused',
  ain03t.put('adminA', 'run', ain03t.id('run_a2')::text, 'cap-4', 'reference', '{"a":"b"}'), '53400', 'ain03:scope_is_full');
SELECT ain03t.expect_true('replacing an existing item in a full scope still works (no new row)',
  (public.wf_memory_put(ain03t.id('adminA'), 'run', ain03t.id('run_a2')::text, 'cap-1', 'reference', '{"a":"c"}', NULL, false) ->> 'version')::int = 2);
SELECT ain03t.expect_true('another run is a different scope with its own room (positive twin)',
  (public.wf_memory_put(ain03t.id('adminA'), 'run', ain03t.id('run_a')::text, 'cap-1', 'reference', '{"a":"b"}', NULL, false) ->> 'version')::int = 1);
SELECT public.wf_memory_retire(ain03t.id('adminA'), ain03t.item('orgA', 'run', ain03t.id('run_a2')::text, 'cap-2'));
SELECT ain03t.expect_true('retiring one frees a place in the scope',
  (public.wf_memory_put(ain03t.id('adminA'), 'run', ain03t.id('run_a2')::text, 'cap-4', 'reference', '{"a":"b"}', NULL, false) ->> 'version')::int = 1);
SELECT ain03t.logout();
SELECT ain03t.owner($q$UPDATE public.wf_memory_scope_kind SET max_items = 50 WHERE kind = 'run'$q$);
SELECT ain03t.owner(format($q$CREATE OR REPLACE FUNCTION public.wf_memory_org_item_cap() RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = '' AS $f$ SELECT %s $f$$q$, ain03t.live('orgA')));
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_error('the organization-wide cap holds across scopes',
  ain03t.put('adminA', 'organization', '', 'over-cap', 'reference', '{"a":"b"}'), '53400', 'ain03:organization_is_full');
SELECT ain03t.expect_true('the other organization is not affected by the first one being full (positive twin)',
  (public.wf_memory_put(ain03t.id('adminB'), 'organization', '', 'b-two', 'reference', '{"a":"b"}', NULL, false) ->> 'version')::int = 1);
SELECT ain03t.logout();
SELECT ain03t.owner($q$CREATE OR REPLACE FUNCTION public.wf_memory_org_item_cap() RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = '' AS $f$ SELECT 2000 $f$$q$);
SELECT ain03t.expect_true('the reviewed caps are back (run scope 50, organization cap 2000)',
  public.wf_memory_org_item_cap() = 2000 AND (SELECT max_items = 50 FROM public.wf_memory_scope_kind WHERE kind = 'run'));

-- ---------------------------------------------------------------------------------------------
-- 6. An agent proposes
-- ---------------------------------------------------------------------------------------------
SELECT ain03t.login_as('service_role');
SELECT ain03t.keep('prop1', (public.wf_memory_agent_propose(ain03t.id('run_a'), 'agent', NULL, 'follow-up-hint', '{"text":"Parents answer after 18:00."}', NULL) ->> 'id')::uuid);
SELECT ain03t.logout();
SELECT ain03t.expect_true('a proposal is a note from the run''s agent in its own notebook, not yet live, never readable by an agent',
  (SELECT status = 'proposed' AND data_class = 'note' AND NOT ai_readable AND source_kind = 'agent' AND source_agent = 'ain03-a'
          AND source_run = ain03t.id('run_a') AND scope_kind = 'agent' AND scope_ref = 'ain03-a' AND decided_by IS NULL
          AND source_person IS NULL AND expires_at = now() + interval '90 days' AND org_id = ain03t.id('orgA')
     FROM public.wf_memory_item WHERE id = ain03t.id('prop1')));
SELECT ain03t.expect_true('the proposal left a propose ledger row by the agent and an audit entry',
  ain03t.ops('orgA', 'propose') = 1 AND ain03t.audits('orgA', 'workflow.memory.propose') = 1
  AND (SELECT actor_kind = 'agent' AND actor_agent = 'ain03-a' AND actor_person IS NULL FROM public.wf_memory_change WHERE item_id = ain03t.id('prop1')));
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_true('a proposal into the run scope names the run itself',
  (public.wf_memory_agent_propose(ain03t.id('run_a'), 'run', ain03t.id('run_a')::text, 'run-hint', '{"text":"x"}', 5) ->> 'status') = 'proposed'
  AND (ain03t.facts(ain03t.item('orgA', 'run', ain03t.id('run_a')::text, 'run-hint')) ->> 'expires_at')::timestamptz = now() + interval '5 days');
SELECT ain03t.expect_error('an agent cannot propose into the organization scope', ain03t.propose('a', 'organization', NULL, 'org-hint', '{"text":"x"}'), '42501', 'ain03:agent_cannot_write_this_scope');
SELECT ain03t.expect_error('an agent cannot propose into a workflow scope', ain03t.propose('a', 'workflow', 'ain03-wf', 'wf-hint', '{"text":"x"}'), '42501', 'ain03:agent_cannot_write_this_scope');
SELECT ain03t.expect_error('an unknown scope kind is refused', ain03t.propose('a', 'secret', NULL, 'hint', '{"text":"x"}'), '42501', 'ain03:agent_cannot_write_this_scope');
SELECT ain03t.expect_error('an agent cannot name another agent''s notebook', ain03t.propose('a', 'agent', 'ain03-b', 'other-hint', '{"text":"x"}'), '42501', 'ain03:agent_writes_own_scope_only');
SELECT ain03t.expect_error('an agent cannot name another run as its run scope', ain03t.propose('a', 'run', ain03t.id('run_b')::text, 'other-hint', '{"text":"x"}'), '42501', 'ain03:agent_writes_own_scope_only');
SELECT ain03t.expect_error('a proposal over a live key is refused', ain03t.propose('a', 'agent', NULL, 'follow-up-hint', '{"text":"y"}'), '23505', 'ain03:key_exists');
SELECT ain03t.expect_error('a run that is finished cannot propose', ain03t.propose('done', 'agent', NULL, 'late-hint', '{"text":"x"}'), '42501', 'ain03:run_not_active_for_agent');
SELECT ain03t.expect_error('a run with no agent cannot propose', ain03t.propose('none', 'run', NULL, 'late-hint', '{"text":"x"}'), '42501', 'ain03:run_not_active_for_agent');
SELECT ain03t.expect_error('an unknown run cannot propose', format($q$SELECT public.wf_memory_agent_propose(%L, 'agent', NULL, 'late-hint', '{"text":"x"}'::jsonb, NULL)$q$, gen_random_uuid()), '42501', 'ain03:run_not_active_for_agent');
SELECT ain03t.expect_error('a null run is refused', $q$SELECT public.wf_memory_agent_propose(NULL, 'agent', NULL, 'late-hint', '{"text":"x"}'::jsonb, NULL)$q$, '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('an agent that is not granted to the organization cannot propose', ain03t.propose('ungranted', 'agent', NULL, 'late-hint', '{"text":"x"}'), '42501', 'ain03:agent_not_usable_here');
SELECT ain03t.expect_error('an organization with workflows off takes no proposal', ain03t.propose('c', 'agent', NULL, 'late-hint', '{"text":"x"}'), '42501', 'ain03:workflows_disabled');
SELECT ain03t.expect_error('a proposal lifetime above the scope maximum is refused', ain03t.propose('a', 'run', NULL, 'long-hint', '{"text":"x"}', 31), '22023', 'ain03:lifetime_out_of_bounds');
SELECT ain03t.expect_error('a nested proposal value is refused', ain03t.propose('a', 'agent', NULL, 'nested-hint', '{"a":{"b":1}}'), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('an over-long proposal is refused', format('SELECT public.wf_memory_agent_propose(%L, ''agent'', NULL, ''long-hint'', %L::jsonb, NULL)', ain03t.id('run_a'), '{"text":"' || repeat('x', 301) || '"}'), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('a bad key is refused', ain03t.propose('a', 'agent', NULL, 'Bad Key', '{"text":"x"}'), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_true('the same agent in another organization has its own notebook (positive twin)',
  (public.wf_memory_agent_propose(ain03t.id('run_ab'), 'agent', NULL, 'follow-up-hint', '{"text":"b side"}', NULL) ->> 'status') = 'proposed'
  AND ain03t.item('orgB', 'agent', 'ain03-a', 'follow-up-hint') IS NOT NULL);
SELECT ain03t.logout();
-- Daily cap of 50 per agent and organization.
SELECT ain03t.login_as('service_role');
SELECT public.wf_memory_agent_propose(ain03t.id('run_a2'), 'agent', NULL, 'bulk-' || g, '{"text":"x"}', NULL) FROM generate_series(1, 48) g;
SELECT ain03t.expect_error('the 51st proposal of an agent in 24 hours is refused (2 earlier + 48 = 50 already)',
  ain03t.propose('a2', 'agent', NULL, 'bulk-49', '{"text":"x"}'), '53400', 'ain03:agent_daily_proposals_exceeded');
SELECT ain03t.expect_true('another agent in the same organization has its own allowance (positive twin)',
  (public.wf_memory_agent_propose(ain03t.id('run_b'), 'agent', NULL, 'bulk-1', '{"text":"x"}', NULL) ->> 'status') = 'proposed');
SELECT ain03t.logout();
SELECT ain03t.age_ledger(ain03t.id('orgA'), 25);
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_true('once the old proposals are more than a day old the agent may propose again',
  (public.wf_memory_agent_propose(ain03t.id('run_a2'), 'agent', NULL, 'bulk-49', '{"text":"x"}', NULL) ->> 'status') = 'proposed');
SELECT ain03t.logout();

-- ---------------------------------------------------------------------------------------------
-- 7. A person decides on a proposal
-- ---------------------------------------------------------------------------------------------
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_error('a person without workflows.manage cannot decide', ain03t.decide('viewer', ain03t.id('prop1'), 'accept'), '42501', 'ain03:not_authorized');
SELECT ain03t.expect_error('an id that is not a person (an agent has none) cannot decide',
  format($q$SELECT public.wf_memory_decide(%L, %L, 'accept')$q$, gen_random_uuid(), ain03t.id('prop1')), '42501', 'ain03:not_authorized');
SELECT ain03t.expect_error('a manager of another organization does not even find the proposal', ain03t.decide('adminB', ain03t.id('prop1'), 'accept'), 'P0002', 'ain03:not_found');
SELECT ain03t.expect_error('a decision other than accept or reject is refused', ain03t.decide('adminA', ain03t.id('prop1'), 'approve'), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('a null decision is refused', format($q$SELECT public.wf_memory_decide(%L, %L, NULL)$q$, ain03t.id('adminA'), ain03t.id('prop1')), '22023', 'ain03:invalid_request');
SELECT ain03t.expect_error('a person-written item is not a proposal', ain03t.decide('adminA', ain03t.id('put1'), 'accept'), '42501', 'ain03:not_a_pending_proposal');
SELECT ain03t.expect_true('a manager accepts a proposal', (public.wf_memory_decide(ain03t.id('adminA'), ain03t.id('prop1'), 'accept') ->> 'decision') = 'accept');
SELECT ain03t.expect_error('a proposal can be decided once only', ain03t.decide('adminA', ain03t.id('prop1'), 'accept'), '42501', 'ain03:not_a_pending_proposal');
SELECT ain03t.expect_error('an accepted proposal cannot then be rejected', ain03t.decide('adminA', ain03t.id('prop1'), 'reject'), '42501', 'ain03:not_a_pending_proposal');
SELECT ain03t.logout();
SELECT ain03t.expect_true('the accepted item is live, keeps the agent as its source, records who accepted it, kept its content and is still not readable by an agent',
  (SELECT status = 'active' AND decided_by = ain03t.id('adminA') AND source_kind = 'agent' AND source_agent = 'ain03-a' AND version = 2
          AND value = '{"text": "Parents answer after 18:00."}'::jsonb AND NOT ai_readable AND data_class = 'note'
     FROM public.wf_memory_item WHERE id = ain03t.id('prop1'))
  AND ain03t.ops('orgA', 'accept') = 1 AND ain03t.audits('orgA', 'workflow.memory.accept') = 1
  AND (SELECT actor_kind = 'person' AND actor_person = ain03t.id('adminA') FROM public.wf_memory_change WHERE item_id = ain03t.id('prop1') AND op = 'accept'));
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_error('a person cannot overwrite a key an agent holds (retire it first)',
  ain03t.put('adminA', 'agent', 'ain03-a', 'follow-up-hint', 'note', '{"text":"mine"}'), '42501', 'ain03:key_held_by_agent_memory');
SELECT ain03t.expect_error('nor one still waiting as a proposal',
  ain03t.put('adminA', 'agent', 'ain03-a', 'bulk-2', 'note', '{"text":"mine"}'), '42501', 'ain03:key_held_by_agent_memory');
SELECT ain03t.keep('prop_run', ain03t.item('orgA', 'run', ain03t.id('run_a')::text, 'run-hint'));
SELECT ain03t.expect_true('a manager rejects a proposal',
  (public.wf_memory_decide(ain03t.id('adminA'), ain03t.id('prop_run'), 'reject') ->> 'decision') = 'reject');
SELECT ain03t.logout();
SELECT ain03t.expect_true('the rejected proposal keeps no content and is retired by the person; the ledger says reject',
  (SELECT status = 'retired' AND value = '{}'::jsonb AND retired_at IS NOT NULL AND decided_by = ain03t.id('adminA') AND NOT ai_readable
     FROM public.wf_memory_item WHERE id = ain03t.id('prop_run'))
  AND ain03t.ops('orgA', 'reject') = 1 AND ain03t.audits('orgA', 'workflow.memory.reject') = 1
  AND (SELECT value_sha256 IS NULL FROM public.wf_memory_change WHERE item_id = ain03t.id('prop_run') AND op = 'reject'));
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_true('after a rejection the agent may propose the same key again',
  (public.wf_memory_agent_propose(ain03t.id('run_a'), 'run', NULL, 'run-hint', '{"text":"second try"}', NULL) ->> 'status') = 'proposed');
SELECT ain03t.logout();
SELECT ain03t.age(ain03t.item('orgA', 'agent', 'ain03-a', 'bulk-1'), 2);
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_error('an expired proposal cannot be accepted', ain03t.decide('adminA', ain03t.item('orgA', 'agent', 'ain03-a', 'bulk-1'), 'accept'), '42501', 'ain03:expired');
SELECT ain03t.expect_true('an agent may propose over an expired key: the expired row is retired by the system and the key is free',
  (public.wf_memory_agent_propose(ain03t.id('run_a2'), 'agent', NULL, 'bulk-1', '{"text":"fresh"}', NULL) ->> 'status') = 'proposed');
SELECT ain03t.logout();

-- ---------------------------------------------------------------------------------------------
-- 8. Retirement wipes the content
-- ---------------------------------------------------------------------------------------------
SELECT ain03t.keep('wfset', ain03t.item('orgA', 'workflow', 'ain03-wf', 'wf-setting'));
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_error('a person without workflows.manage cannot retire', ain03t.retire('viewer', ain03t.id('wfset')), '42501', 'ain03:not_authorized');
SELECT ain03t.expect_error('a manager of another organization does not find the item', ain03t.retire('adminB', ain03t.id('wfset')), 'P0002', 'ain03:not_found');
SELECT ain03t.expect_error('an unknown item is not found', format($q$SELECT public.wf_memory_retire(%L, %L)$q$, ain03t.id('adminA'), gen_random_uuid()), 'P0002', 'ain03:not_found');
SELECT ain03t.expect_true('a manager retires an item', (public.wf_memory_retire(ain03t.id('adminA'), ain03t.id('wfset')) ->> 'status') = 'retired');
SELECT ain03t.expect_error('a retired item cannot be retired again', ain03t.retire('adminA', ain03t.id('wfset')), '42501', 'ain03:already_retired');
SELECT ain03t.logout();
SELECT ain03t.expect_true('the retired row holds no content, its lifetime is unchanged, and the ledger says retire with no hash',
  (SELECT status = 'retired' AND value = '{}'::jsonb AND NOT ai_readable AND retired_at IS NOT NULL AND version = 2
     FROM public.wf_memory_item WHERE id = ain03t.id('wfset'))
  AND ain03t.ops('orgA', 'retire') = 3 AND ain03t.audits('orgA', 'workflow.memory.retire') = 3
  AND (SELECT value_sha256 IS NULL AND actor_kind = 'person' FROM public.wf_memory_change WHERE item_id = ain03t.id('wfset') AND op = 'retire')
  AND (SELECT count(*) = 1 FROM public.wf_memory_change WHERE org_id = ain03t.id('orgA') AND op = 'retire' AND actor_kind = 'system'));
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_true('the key can be written again after retirement: a new row at version 1',
  (public.wf_memory_put(ain03t.id('adminA'), 'workflow', 'ain03-wf', 'wf-setting', 'reference', '{"mode":"new"}', NULL, false) ->> 'version')::int = 1
  AND ain03t.item('orgA', 'workflow', 'ain03-wf', 'wf-setting') <> ain03t.id('wfset'));
SELECT ain03t.expect_true('a manager may retire an accepted agent note too',
  (public.wf_memory_retire(ain03t.id('adminA'), ain03t.id('prop1')) ->> 'status') = 'retired');
SELECT ain03t.logout();

-- ---------------------------------------------------------------------------------------------
-- 9. The guards as a backstop: direct writes, simulated bugs, upserts
-- ---------------------------------------------------------------------------------------------
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_error('the service role cannot insert a memory item', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'sneaky', 'reference', '{"a":"b"}', 'active', 'person', %L, now() + interval '1 day')$q$, ain03t.id('orgA'), ain03t.id('adminA')), '42501');
SELECT ain03t.expect_error('the service role cannot read an item', $q$SELECT value FROM public.wf_memory_item$q$, '42501');
SELECT ain03t.expect_error('the service role cannot update an item', $q$UPDATE public.wf_memory_item SET ai_readable = true$q$, '42501');
SELECT ain03t.expect_error('the service role cannot delete an item', $q$DELETE FROM public.wf_memory_item$q$, '42501');
SELECT ain03t.expect_error('the service role cannot truncate the items', $q$TRUNCATE public.wf_memory_item$q$, '42501');
SELECT ain03t.expect_error('the service role cannot write the ledger', format($q$INSERT INTO public.wf_memory_change (org_id, item_id, scope_kind, scope_ref, key, op, actor_kind, data_class, version)
   VALUES (%L, gen_random_uuid(), 'organization', '', 'x', 'purge', 'system', 'note', 1)$q$, ain03t.id('orgA')), '42501');
SELECT ain03t.expect_error('the service role cannot write the reference data', $q$UPDATE public.wf_memory_scope_kind SET max_items = 1000$q$, '42501');
SELECT ain03t.expect_error('the service role cannot call the window helper', $q$SELECT public.wf_memory_open('system')$q$, '42501');
SELECT ain03t.expect_error('the service role cannot call a guard function directly', $q$SELECT public.wf_memory_item_guard()$q$, '42501');
SELECT ain03t.login_as('authenticated', ain03t.id('adminA'));
SELECT ain03t.expect_error('a signed-in manager cannot insert directly', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'sneaky', 'reference', '{"a":"b"}', 'active', 'person', %L, now() + interval '1 day')$q$, ain03t.id('orgA'), ain03t.id('adminA')), '42501');
SELECT ain03t.expect_error('a signed-in manager cannot update directly', $q$UPDATE public.wf_memory_item SET ai_readable = true$q$, '42501');
SELECT ain03t.expect_error('a signed-in manager cannot delete directly', $q$DELETE FROM public.wf_memory_item$q$, '42501');
SELECT ain03t.expect_error('a signed-in manager cannot call the entry points (service role only)', ain03t.put('adminA', 'organization', '', 'sneaky', 'reference', '{"a":"b"}'), '42501');
SELECT ain03t.login_as('anon');
SELECT ain03t.expect_error('anon cannot read', $q$SELECT 1 FROM public.wf_memory_item$q$, '42501');
SELECT ain03t.expect_error('anon cannot call the entry points', ain03t.put('adminA', 'organization', '', 'sneaky', 'reference', '{"a":"b"}'), '42501');
SELECT ain03t.logout();
-- The database owner without the window (what a hand-written script would be).
SELECT ain03t.expect_error('the owner cannot insert outside the window', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'sneaky', 'reference', '{"a":"b"}', 'active', 'person', %L, now() + interval '1 day')$q$, ain03t.id('orgA'), ain03t.id('adminA')), '42501', 'ain03:write_only_through_the_memory_functions');
SELECT ain03t.expect_error('the owner cannot update outside the window', $q$UPDATE public.wf_memory_item SET expires_at = expires_at + interval '1 day'$q$, '42501', 'ain03:write_only_through_the_memory_functions');
SELECT ain03t.expect_error('the owner cannot upsert outside the window', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'term-plan', 'reference', '{"a":"b"}', 'active', 'person', %L, now() + interval '1 day')
   ON CONFLICT (org_id, scope_kind, scope_ref, key) WHERE status <> 'retired' DO UPDATE SET expires_at = now() + interval '1 day'$q$, ain03t.id('orgA'), ain03t.id('adminA')), '42501', 'ain03:write_only_through_the_memory_functions');
SELECT ain03t.expect_error('the owner cannot delete a row outside the retention pass', $q$DELETE FROM public.wf_memory_item$q$, '42501', 'ain03:deletion_is_the_retention_pass_only');
SELECT ain03t.expect_error('nobody truncates the items', $q$TRUNCATE public.wf_memory_item$q$, '42501', 'ain03:memory_is_never_truncated');
SELECT ain03t.expect_error('the ledger cannot be updated', $q$UPDATE public.wf_memory_change SET op = 'purge'$q$, '42501');
SELECT ain03t.expect_error('the ledger cannot be deleted from', $q$DELETE FROM public.wf_memory_change$q$, '42501');
SELECT ain03t.expect_error('the ledger cannot be truncated', $q$TRUNCATE public.wf_memory_change$q$, '42501');
SELECT ain03t.expect_error('an acceptance recorded by an agent in the ledger is refused by its own constraint', format($q$INSERT INTO public.wf_memory_change (org_id, item_id, scope_kind, scope_ref, key, op, actor_kind, actor_agent, data_class, version)
   VALUES (%L, gen_random_uuid(), 'agent', 'ain03-a', 'x', 'accept', 'agent', 'ain03-a', 'note', 1)$q$, ain03t.id('orgA')), '23514');
SELECT ain03t.expect_error('a proposal recorded by a person in the ledger is refused by its own constraint', format($q$INSERT INTO public.wf_memory_change (org_id, item_id, scope_kind, scope_ref, key, op, actor_kind, actor_person, data_class, version)
   VALUES (%L, gen_random_uuid(), 'agent', 'ain03-a', 'x', 'propose', 'person', %L, 'note', 1)$q$, ain03t.id('orgA'), ain03t.id('adminA')), '23514');

-- Simulated bugs: the window is opened by hand (as a faulty function would), and the rules must still hold.
SELECT ain03t.keep('live1', ain03t.item('orgA', 'organization', '', 'term-plan'));
SELECT ain03t.keep('agentnote', ain03t.item('orgA', 'agent', 'ain03-a', 'bulk-2'));
SELECT ain03t.window('person:' || ain03t.id('adminA'));
SELECT ain03t.expect_error('identity: the scope cannot be changed', format($q$UPDATE public.wf_memory_item SET scope_kind = 'workflow', scope_ref = 'ain03-wf', version = version + 1 WHERE id = %L$q$, ain03t.id('live1')), '42501', 'ain03:identity_is_immutable');
SELECT ain03t.expect_error('identity: the key cannot be changed', format($q$UPDATE public.wf_memory_item SET key = 'other-key', version = version + 1 WHERE id = %L$q$, ain03t.id('live1')), '42501', 'ain03:identity_is_immutable');
SELECT ain03t.expect_error('identity: the organization cannot be changed', format($q$UPDATE public.wf_memory_item SET org_id = %L, version = version + 1 WHERE id = %L$q$, ain03t.id('orgB'), ain03t.id('live1')), '42501', 'ain03:identity_is_immutable');
SELECT ain03t.expect_error('identity: the source cannot be changed', format($q$UPDATE public.wf_memory_item SET source_person = %L, version = version + 1 WHERE id = %L$q$, ain03t.id('adminB'), ain03t.id('live1')), '42501', 'ain03:identity_is_immutable');
SELECT ain03t.expect_error('identity: a person item cannot be turned into an agent item', format($q$UPDATE public.wf_memory_item SET source_kind = 'agent', source_person = NULL, source_agent = 'ain03-a', source_run = %L, version = version + 1 WHERE id = %L$q$, ain03t.id('run_a'), ain03t.id('live1')), '42501', 'ain03:identity_is_immutable');
SELECT ain03t.expect_error('upsert: the update half cannot stretch the lifetime past the scope maximum', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'term-plan', 'reference', '{"a":"b"}', 'active', 'person', %L, now() + interval '10 days')
   ON CONFLICT (org_id, scope_kind, scope_ref, key) WHERE status <> 'retired'
   DO UPDATE SET expires_at = now() + interval '4000 days', version = public.wf_memory_item.version + 1$q$, ain03t.id('orgA'), ain03t.id('adminA')), '23514', 'ain03:lifetime_out_of_bounds');
SELECT ain03t.expect_error('upsert: the insert half cannot stretch it either', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'upsert-new', 'reference', '{"a":"b"}', 'active', 'person', %L, now() + interval '4000 days')
   ON CONFLICT (org_id, scope_kind, scope_ref, key) WHERE status <> 'retired' DO NOTHING$q$, ain03t.id('orgA'), ain03t.id('adminA')), '23514', 'ain03:lifetime_out_of_bounds');
SELECT ain03t.expect_error('upsert: the update half cannot replace the value with something that breaks the shape', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'term-plan', 'reference', '{"a":"b"}', 'active', 'person', %L, now() + interval '10 days')
   ON CONFLICT (org_id, scope_kind, scope_ref, key) WHERE status <> 'retired'
   DO UPDATE SET value = '{"a":{"nested":1}}'::jsonb, version = public.wf_memory_item.version + 1$q$, ain03t.id('orgA'), ain03t.id('adminA')), '23514');
SELECT ain03t.expect_error('upsert: the update half cannot move an item to another scope', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'term-plan', 'reference', '{"a":"b"}', 'active', 'person', %L, now() + interval '10 days')
   ON CONFLICT (org_id, scope_kind, scope_ref, key) WHERE status <> 'retired'
   DO UPDATE SET scope_kind = 'run', scope_ref = %L, version = public.wf_memory_item.version + 1$q$, ain03t.id('orgA'), ain03t.id('adminA'), ain03t.id('run_a')::text), '42501', 'ain03:identity_is_immutable');
SELECT ain03t.expect_error('upsert: the update half cannot make a proposal live without a person', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_agent, source_run, expires_at)
   VALUES (%L, 'agent', 'ain03-a', 'bulk-2', 'note', '{"text":"x"}', 'proposed', 'agent', 'ain03-a', %L, now() + interval '10 days')
   ON CONFLICT (org_id, scope_kind, scope_ref, key) WHERE status <> 'retired'
   DO UPDATE SET status = 'active', version = public.wf_memory_item.version + 1$q$, ain03t.id('orgA'), ain03t.id('run_a')), '42501', 'ain03:writer_is_not_the_source');
SELECT ain03t.expect_error('content: an agent item''s value cannot change', format($q$UPDATE public.wf_memory_item SET value = '{"text":"changed"}', version = version + 1 WHERE id = %L$q$, ain03t.id('agentnote')), '42501', 'ain03:agent_memory_content_is_fixed');
SELECT ain03t.expect_error('content: an agent item cannot be made readable by an agent', format($q$UPDATE public.wf_memory_item SET ai_readable = true, version = version + 1 WHERE id = %L$q$, ain03t.id('agentnote')), '42501', 'ain03:agent_memory_content_is_fixed');
SELECT ain03t.expect_error('content: a note cannot be made readable by an agent', format($q$UPDATE public.wf_memory_item SET data_class = 'note', value = '{"text":"x"}', ai_readable = true, version = version + 1 WHERE id = %L$q$, ain03t.id('live1')), '23514');
SELECT ain03t.expect_error('content: a reference item''s class cannot turn it into free text while it stays readable', format($q$UPDATE public.wf_memory_item SET ai_readable = true, data_class = 'note', version = version + 1 WHERE id = %L$q$, ain03t.id('live1')), '23514');
SELECT ain03t.expect_error('acceptance: a person''s window is not enough without a decided_by', format($q$UPDATE public.wf_memory_item SET status = 'active', version = version + 1 WHERE id = %L$q$, ain03t.id('agentnote')), '42501', 'ain03:acceptance_needs_a_person');
SELECT ain03t.expect_error('acceptance: the decider must be the person in the window', format($q$UPDATE public.wf_memory_item SET status = 'active', decided_by = %L, version = version + 1 WHERE id = %L$q$, ain03t.id('adminB'), ain03t.id('agentnote')), '42501', 'ain03:acceptance_needs_a_person');
SELECT ain03t.shut();
SELECT ain03t.window('agent:ain03-a');
SELECT ain03t.expect_error('acceptance: an agent in the window cannot accept even its own proposal', format($q$UPDATE public.wf_memory_item SET status = 'active', decided_by = %L, version = version + 1 WHERE id = %L$q$, ain03t.id('adminA'), ain03t.id('agentnote')), '42501', 'ain03:acceptance_needs_a_person');
SELECT ain03t.shut();
SELECT ain03t.window('person:' || ain03t.id('adminA'));
SELECT ain03t.expect_error('transitions: a live item cannot go back to proposed', format($q$UPDATE public.wf_memory_item SET status = 'proposed', version = version + 1 WHERE id = %L$q$, ain03t.id('live1')), '42501', 'ain03:status_transition_refused');
SELECT ain03t.expect_error('transitions: a retired item stays retired', format($q$UPDATE public.wf_memory_item SET status = 'active', value = '{"a":"b"}', retired_at = NULL, version = version + 1 WHERE id = %L$q$, ain03t.id('wfset')), '42501', 'ain03:retired_is_terminal');
SELECT ain03t.expect_error('version: a change must advance it by one', format($q$UPDATE public.wf_memory_item SET value = '{"a":"zz"}' WHERE id = %L$q$, ain03t.id('live1')), '23514', 'ain03:version_must_advance_by_one');
SELECT ain03t.expect_error('version: it cannot jump', format($q$UPDATE public.wf_memory_item SET value = '{"a":"zz"}', version = version + 2 WHERE id = %L$q$, ain03t.id('live1')), '23514', 'ain03:version_must_advance_by_one');
SELECT ain03t.expect_error('version: it cannot move without a change', format($q$UPDATE public.wf_memory_item SET version = version + 1 WHERE id = %L$q$, ain03t.id('live1')), '23514', 'ain03:version_moves_only_with_a_change');
SELECT ain03t.expect_error('lifetime: an update cannot move the end into the past', format($q$UPDATE public.wf_memory_item SET expires_at = now() - interval '1 second', version = version + 1 WHERE id = %L$q$, ain03t.id('live1')), '23514', 'ain03:lifetime_out_of_bounds');
UPDATE public.wf_memory_item SET value = '{"plan_code":"direct-ok"}', version = version + 1 WHERE id = ain03t.id('live1');
SELECT ain03t.expect_true('positive twin: a valid change inside the window passes every rule and is audited',
  (SELECT version = 3 AND value = '{"plan_code": "direct-ok"}'::jsonb FROM public.wf_memory_item WHERE id = ain03t.id('live1'))
  AND ain03t.ops('orgA', 'update') = 3 AND ain03t.audits('orgA', 'workflow.memory.update') = 3);
SELECT ain03t.shut();
-- Insert rules, each with the window naming the right source so only the rule under test can fail.
SELECT ain03t.window('agent:ain03-a');
SELECT ain03t.expect_error('insert: an agent cannot write the organization scope', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_agent, source_run, expires_at)
   VALUES (%L, 'organization', '', 'agent-org', 'note', '{"text":"x"}', 'proposed', 'agent', 'ain03-a', %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('run_a')), '42501', 'ain03:agent_cannot_write_this_scope');
SELECT ain03t.expect_error('insert: an agent cannot write a workflow scope', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_agent, source_run, expires_at)
   VALUES (%L, 'workflow', 'ain03-wf', 'agent-wf', 'note', '{"text":"x"}', 'proposed', 'agent', 'ain03-a', %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('run_a')), '42501', 'ain03:agent_cannot_write_this_scope');
SELECT ain03t.expect_error('insert: an agent cannot write live memory', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_agent, source_run, decided_by, expires_at)
   VALUES (%L, 'agent', 'ain03-a', 'agent-live', 'note', '{"text":"x"}', 'active', 'agent', 'ain03-a', %L, %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('run_a'), ain03t.id('adminA')), '42501', 'ain03:an_agent_only_proposes');
SELECT ain03t.expect_error('insert: an agent cannot write into another agent''s notebook', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_agent, source_run, expires_at)
   VALUES (%L, 'agent', 'ain03-b', 'agent-other', 'note', '{"text":"x"}', 'proposed', 'agent', 'ain03-a', %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('run_a')), '42501', 'ain03:agent_writes_own_scope_only');
SELECT ain03t.expect_error('insert: an agent cannot claim another agent''s run', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_agent, source_run, expires_at)
   VALUES (%L, 'agent', 'ain03-a', 'agent-claim', 'note', '{"text":"x"}', 'proposed', 'agent', 'ain03-a', %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('run_b')), '42501', 'ain03:run_not_active_for_agent');
SELECT ain03t.expect_error('insert: an agent cannot use a finished run', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_agent, source_run, expires_at)
   VALUES (%L, 'agent', 'ain03-a', 'agent-done', 'note', '{"text":"x"}', 'proposed', 'agent', 'ain03-a', %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('run_done')), '42501', 'ain03:run_not_active_for_agent');
SELECT ain03t.expect_error('insert: an agent cannot use a run of another organization', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_agent, source_run, expires_at)
   VALUES (%L, 'agent', 'ain03-a', 'agent-xorg', 'note', '{"text":"x"}', 'proposed', 'agent', 'ain03-a', %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('run_ab')), '42501', 'ain03:run_not_active_for_agent');
SELECT ain03t.expect_error('insert: an agent cannot be readable by an agent', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_agent, source_run, ai_readable, expires_at)
   VALUES (%L, 'agent', 'ain03-a', 'agent-ai', 'note', '{"text":"x"}', 'proposed', 'agent', 'ain03-a', %L, true, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('run_a')), '23514');
SELECT ain03t.expect_error('insert: an agent cannot write a reference item', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_agent, source_run, expires_at)
   VALUES (%L, 'agent', 'ain03-a', 'agent-ref', 'reference', '{"a":"b"}', 'proposed', 'agent', 'ain03-a', %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('run_a')), '23514');
SELECT ain03t.expect_error('insert: the window must name the agent the row claims', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_agent, source_run, expires_at)
   VALUES (%L, 'agent', 'ain03-b', 'agent-spoof', 'note', '{"text":"x"}', 'proposed', 'agent', 'ain03-b', %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('run_b')), '42501', 'ain03:writer_is_not_the_source');
SELECT ain03t.shut();
SELECT ain03t.window('person:' || ain03t.id('adminA'));
SELECT ain03t.expect_error('insert: a person cannot write a proposal', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'person-prop', 'reference', '{"a":"b"}', 'proposed', 'person', %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('adminA')), '23514', 'ain03:a_person_writes_live_memory');
SELECT ain03t.expect_error('insert: a new item starts at version 1', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, version, expires_at)
   VALUES (%L, 'organization', '', 'v2', 'reference', '{"a":"b"}', 'active', 'person', %L, 2, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('adminA')), '23514', 'ain03:a_new_item_starts_live_at_version_1');
SELECT ain03t.expect_error('insert: a new item cannot be born retired', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, retired_at, expires_at)
   VALUES (%L, 'organization', '', 'born-retired', 'reference', '{}', 'retired', 'person', %L, now(), now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('adminA')), '23514', 'ain03:a_new_item_starts_live_at_version_1');
SELECT ain03t.expect_error('insert: the writer must be the person the row names', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'spoof', 'reference', '{"a":"b"}', 'active', 'person', %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('adminB')), '42501', 'ain03:writer_is_not_the_source');
SELECT ain03t.expect_error('insert: an item that is already expired is refused', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'past', 'reference', '{"a":"b"}', 'active', 'person', %L, now())$q$, ain03t.id('orgA'), ain03t.id('adminA')), '23514', 'ain03:lifetime_out_of_bounds');
SELECT ain03t.expect_error('insert: an item cannot outlive the scope maximum', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'run', %L, 'forever', 'reference', '{"a":"b"}', 'active', 'person', %L, now() + interval '31 days')$q$, ain03t.id('orgA'), ain03t.id('run_a')::text, ain03t.id('adminA')), '23514', 'ain03:lifetime_out_of_bounds');
SELECT ain03t.expect_error('insert: the value must pass the shape rule', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'bad-shape', 'reference', '{"owner":"Ada Obi"}', 'active', 'person', %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('adminA')), '23514');
SELECT ain03t.expect_error('insert: a duplicate live key is refused', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'term-plan', 'reference', '{"a":"b"}', 'active', 'person', %L, now() + interval '10 days')$q$, ain03t.id('orgA'), ain03t.id('adminA')), '23505');
SELECT ain03t.shut();
SELECT ain03t.window('person:' || ain03t.id('adminC'));
SELECT ain03t.expect_error('insert: the organization must have workflows on', format($q$INSERT INTO public.wf_memory_item (org_id, scope_kind, scope_ref, key, data_class, value, status, source_kind, source_person, expires_at)
   VALUES (%L, 'organization', '', 'off-org', 'reference', '{"a":"b"}', 'active', 'person', %L, now() + interval '10 days')$q$, ain03t.id('orgC'), ain03t.id('adminC')), '42501', 'ain03:workflows_disabled');
SELECT ain03t.shut();
-- A window with no named actor: the change cannot be attributed, so it cannot be recorded.
SELECT set_config('ain03.writer', 'tx:' || txid_current()::text, true);
SELECT ain03t.expect_error('audit: a change with no named actor is refused after the fact (and rolls back)', format($q$UPDATE public.wf_memory_item SET status = 'retired', value = '{}'::jsonb, retired_at = now(), version = version + 1 WHERE id = %L$q$, ain03t.id('live1')), '42501', 'ain03:no_actor_for_this_change');
SELECT ain03t.shut();
SELECT ain03t.expect_true('the refused change left the item as it was', (SELECT status = 'active' FROM public.wf_memory_item WHERE id = ain03t.id('live1')));

-- ---------------------------------------------------------------------------------------------
-- 10. What an agent may read: closed now, narrow when opened
-- ---------------------------------------------------------------------------------------------
SELECT ain03t.login_as('service_role');
SELECT public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'rd-org', 'reference', '{"plan_code":"x1"}', NULL, true);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'workflow', 'ain03-wf', 'rd-wf', 'reference', '{"plan_code":"x2"}', NULL, true);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'workflow', 'ain03-wf2', 'rd-wf2', 'reference', '{"plan_code":"other-wf"}', NULL, true);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'agent', 'ain03-a', 'rd-a', 'reference', '{"plan_code":"x3"}', NULL, true);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'agent', 'ain03-b', 'rd-b', 'reference', '{"plan_code":"other-agent"}', NULL, true);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'run', ain03t.id('run_a')::text, 'rd-run', 'reference', '{"plan_code":"x4"}', NULL, true);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'run', ain03t.id('run_a2')::text, 'rd-run2', 'reference', '{"plan_code":"other-run"}', NULL, true);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'rd-not-flagged', 'reference', '{"plan_code":"unflagged"}', NULL, false);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'rd-note', 'note', '{"text":"a note"}', NULL, false);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'rd-expired', 'reference', '{"plan_code":"old"}', NULL, true);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'rd-retired', 'reference', '{"plan_code":"gone"}', NULL, true);
SELECT public.wf_memory_put(ain03t.id('adminB'), 'organization', '', 'rd-other-org', 'reference', '{"plan_code":"b-org"}', NULL, true);
SELECT public.wf_memory_retire(ain03t.id('adminA'), ain03t.item('orgA', 'organization', '', 'rd-retired'));
SELECT ain03t.logout();
SELECT ain03t.age(ain03t.item('orgA', 'organization', '', 'rd-expired'), 1);
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_error('the agent read path is closed while the AI route is closed (decision 3)',
  format($q$SELECT public.wf_memory_agent_read(%L, NULL, 50)$q$, ain03t.id('run_a')), '42501', 'ain03:ai_route_closed');
SELECT ain03t.expect_error('it is closed for every kind of caller, whatever the run', format($q$SELECT public.wf_memory_agent_read(%L)$q$, gen_random_uuid()), '42501', 'ain03:ai_route_closed');
SELECT ain03t.logout();
SELECT ain03t.owner($q$CREATE OR REPLACE FUNCTION public.wf_ai_route_approved() RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $f$ SELECT true $f$$q$);
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_true('route simulated open: the agent reads exactly the readable reference items of its organization, its notebook, its workflow and its run',
  (SELECT string_agg(e ->> 'key', ',' ORDER BY e ->> 'key') FROM jsonb_array_elements(public.wf_memory_agent_read(ain03t.id('run_a'), NULL, 50)) e)
  = 'rd-a,rd-org,rd-run,rd-wf');
SELECT ain03t.expect_true('what it reads carries the value and nothing from another agent, workflow, run, organization, a note, a proposal, an expired or retired row',
  (SELECT bool_and(e ->> 'key' NOT IN ('rd-b', 'rd-wf2', 'rd-run2', 'rd-other-org', 'rd-note', 'rd-not-flagged', 'rd-expired', 'rd-retired', 'follow-up-hint', 'bulk-1', 'ttl-key'))
     FROM jsonb_array_elements(public.wf_memory_agent_read(ain03t.id('run_a'), NULL, 50)) e)
  AND (SELECT (e -> 'value' ->> 'plan_code') = 'x1' FROM jsonb_array_elements(public.wf_memory_agent_read(ain03t.id('run_a'), 'organization', 50)) e));
SELECT ain03t.expect_true('the scope filter narrows it, and a limit caps it',
  jsonb_array_length(public.wf_memory_agent_read(ain03t.id('run_a'), 'workflow', 50)) = 1
  AND jsonb_array_length(public.wf_memory_agent_read(ain03t.id('run_a'), NULL, 2)) = 2
  AND jsonb_array_length(public.wf_memory_agent_read(ain03t.id('run_a'), 'person', 50)) = 0);
SELECT ain03t.expect_true('the other agent (another workflow, another notebook) reads its own and the shared ones',
  (SELECT string_agg(e ->> 'key', ',' ORDER BY e ->> 'key') FROM jsonb_array_elements(public.wf_memory_agent_read(ain03t.id('run_b'), NULL, 50)) e)
  = 'rd-b,rd-org,rd-wf2');
SELECT ain03t.expect_true('the other organization''s run reads only its own organization''s items',
  (SELECT string_agg(e ->> 'key', ',' ORDER BY e ->> 'key') FROM jsonb_array_elements(public.wf_memory_agent_read(ain03t.id('run_ab'), NULL, 50)) e)
  = 'rd-other-org');
SELECT ain03t.expect_error('a finished run reads nothing', format($q$SELECT public.wf_memory_agent_read(%L)$q$, ain03t.id('run_done')), '42501', 'ain03:run_not_active_for_agent');
SELECT ain03t.expect_error('a run with no agent reads nothing', format($q$SELECT public.wf_memory_agent_read(%L)$q$, ain03t.id('run_none')), '42501', 'ain03:run_not_active_for_agent');
SELECT ain03t.expect_error('an agent that is not usable here reads nothing', format($q$SELECT public.wf_memory_agent_read(%L)$q$, ain03t.id('run_ungranted')), '42501', 'ain03:run_not_active_for_agent');
SELECT ain03t.expect_error('an unknown run reads nothing', format($q$SELECT public.wf_memory_agent_read(%L)$q$, gen_random_uuid()), '42501', 'ain03:run_not_active_for_agent');
SELECT ain03t.logout();
SELECT ain03t.owner($q$CREATE OR REPLACE FUNCTION public.wf_ai_route_approved() RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $f$ SELECT false $f$$q$);
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_error('the route is closed again (the simulation did not leak)', format($q$SELECT public.wf_memory_agent_read(%L)$q$, ain03t.id('run_a')), '42501', 'ain03:ai_route_closed');
SELECT ain03t.logout();

-- ---------------------------------------------------------------------------------------------
-- 11. Retention
-- ---------------------------------------------------------------------------------------------
SELECT ain03t.login_as('service_role');
SELECT public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'ret-live', 'reference', '{"a":"b"}', 10, false);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'ret-old1', 'reference', '{"a":"b"}', 10, false);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'ret-old2', 'reference', '{"a":"b"}', 10, false);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'ret-retired-old', 'reference', '{"a":"b"}', 10, false);
SELECT public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'ret-retired-new', 'reference', '{"a":"b"}', 10, false);
SELECT public.wf_memory_put(ain03t.id('adminB'), 'organization', '', 'ret-b-old', 'reference', '{"a":"b"}', 10, false);
SELECT public.wf_memory_retire(ain03t.id('adminA'), ain03t.item('orgA', 'organization', '', 'ret-retired-old'));
SELECT public.wf_memory_retire(ain03t.id('adminA'), ain03t.item('orgA', 'organization', '', 'ret-retired-new'));
SELECT ain03t.logout();
SELECT ain03t.keep('ret_old1', ain03t.item('orgA', 'organization', '', 'ret-old1'));
SELECT ain03t.keep('ret_old2', ain03t.item('orgA', 'organization', '', 'ret-old2'));
SELECT ain03t.keep('ret_b_old', ain03t.item('orgB', 'organization', '', 'ret-b-old'));
SELECT ain03t.keep('ret_live', ain03t.item('orgA', 'organization', '', 'ret-live'));
SELECT ain03t.keep('ret_ret_old', (SELECT id FROM public.wf_memory_item WHERE org_id = ain03t.id('orgA') AND key = 'ret-retired-old'));
SELECT ain03t.keep('ret_ret_new', (SELECT id FROM public.wf_memory_item WHERE org_id = ain03t.id('orgA') AND key = 'ret-retired-new'));
SELECT ain03t.age(ain03t.id('ret_old1'), 3);
SELECT ain03t.age(ain03t.id('ret_old2'), 3);
SELECT ain03t.age(ain03t.id('ret_b_old'), 3);
SELECT ain03t.age(ain03t.id('ret_ret_old'), 31, false);
SELECT ain03t.age(ain03t.id('ret_ret_new'), 5, false);
-- Invisible before anything is purged.
SELECT ain03t.login_as('authenticated', ain03t.id('adminA'));
SELECT ain03t.expect_true('an expired item is invisible to the member at once, the live one is not, and a retired one is never shown',
  (SELECT count(*) = 0 FROM public.wf_memory_item WHERE key IN ('ret-old1', 'ret-old2', 'rd-expired', 'ret-retired-old', 'ret-retired-new', 'rd-retired'))
  AND (SELECT count(*) = 1 FROM public.wf_memory_item WHERE key = 'ret-live'));
SELECT ain03t.logout();
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_true('putting over the expired key rewrites it as a new row at version 1',
  (public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'rd-expired', 'reference', '{"plan_code":"new"}', NULL, false) ->> 'version')::int = 1);
SELECT ain03t.logout();
-- Legal hold on organization B blocks its purge only.
INSERT INTO public.retention_legal_holds (id, org_id, hold_scope, reason, created_by, active)
VALUES (ain03t.keep('hold', gen_random_uuid()), ain03t.id('orgB'), 'tenant', 'AIN03 harness hold', ain03t.id('adminB'), true);
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_true('the purge deletes expired and long-retired rows of the organization without a hold, and skips the one under hold',
  (SELECT (r ->> 'skipped_legal_hold')::int = 1 AND (r ->> 'failed')::int = 0 AND (r ->> 'purged')::int >= 4
     FROM (SELECT public.wf_memory_purge_expired(500) AS r) x));
SELECT ain03t.logout();
SELECT ain03t.expect_true('purged: the expired rows and the row retired 31 days ago are gone; the live row and the recently retired row remain; organization B is held back',
  ain03t.facts(ain03t.id('ret_old1')) IS NULL AND ain03t.facts(ain03t.id('ret_old2')) IS NULL AND ain03t.facts(ain03t.id('ret_ret_old')) IS NULL
  AND ain03t.facts(ain03t.id('ret_live')) IS NOT NULL AND ain03t.facts(ain03t.id('ret_ret_new')) IS NOT NULL
  AND ain03t.facts(ain03t.id('ret_b_old')) IS NOT NULL);
SELECT ain03t.expect_true('every purge is in the ledger as the system and in the audit chain; the ledger keeps the history of the purged rows',
  ain03t.ops('orgA', 'purge') >= 4 AND ain03t.audits('orgA', 'workflow.memory.purge') = ain03t.ops('orgA', 'purge')
  AND (SELECT bool_and(actor_kind = 'system' AND actor_person IS NULL AND actor_agent IS NULL) FROM public.wf_memory_change WHERE op = 'purge')
  AND (SELECT count(*) >= 2 FROM public.wf_memory_change WHERE item_id = ain03t.id('ret_old1'))
  AND ain03t.ops('orgB', 'purge') = 0);
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_true('a second pass finds nothing more for organization A (idempotent) and still skips B',
  (SELECT (r ->> 'purged')::int = 0 AND (r ->> 'skipped_legal_hold')::int = 1 FROM (SELECT public.wf_memory_purge_expired(500) AS r) x));
SELECT ain03t.logout();
UPDATE public.retention_legal_holds SET active = false, released_by = ain03t.id('adminB'), released_at = now(), release_reason = 'AIN03 harness release' WHERE id = ain03t.id('hold');
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_true('with the hold released the purge deletes organization B''s expired row',
  (SELECT (r ->> 'purged')::int = 1 AND (r ->> 'skipped_legal_hold')::int = 0 FROM (SELECT public.wf_memory_purge_expired(500) AS r) x));
SELECT ain03t.logout();
SELECT ain03t.expect_true('...and the ledger shows it', ain03t.facts(ain03t.id('ret_b_old')) IS NULL AND ain03t.ops('orgB', 'purge') = 1);
-- The batch limit.
SELECT ain03t.login_as('service_role');
SELECT public.wf_memory_put(ain03t.id('adminA'), 'organization', '', 'lim-' || g, 'reference', '{"a":"b"}', 10, false) FROM generate_series(1, 5) g;
SELECT ain03t.logout();
SELECT ain03t.age_keys('orgA', 'lim-%', 2);
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_true('the purge deletes at most the number asked for', (SELECT (r ->> 'purged')::int = 2 FROM (SELECT public.wf_memory_purge_expired(2) AS r) x));
SELECT ain03t.expect_true('and the next pass takes the rest', (SELECT (r ->> 'purged')::int = 3 FROM (SELECT public.wf_memory_purge_expired(500) AS r) x));
SELECT ain03t.expect_true('a null or absurd limit is clamped, not an error',
  (SELECT (r ->> 'purged')::int = 0 FROM (SELECT public.wf_memory_purge_expired(NULL) AS r) x)
  AND (SELECT (r ->> 'purged')::int = 0 FROM (SELECT public.wf_memory_purge_expired(-5) AS r) x));
SELECT ain03t.logout();
-- Deletion stays refused outside the purge, even with a marker for the wrong organization or a live row.
SELECT ain03t.keep('victim', ain03t.item('orgA', 'organization', '', 'ret-live'));
SELECT set_config('ain03.purge', 'org:' || ain03t.id('orgB')::text || ':' || txid_current()::text, true);
SELECT ain03t.expect_error('delete: a purge marker for another organization does not allow it', format($q$DELETE FROM public.wf_memory_item WHERE id = %L$q$, ain03t.id('victim')), '42501', 'ain03:deletion_is_the_retention_pass_only');
SELECT set_config('ain03.purge', 'org:' || ain03t.id('orgA')::text || ':' || txid_current()::text, true);
SELECT ain03t.expect_error('delete: even the right marker does not allow deleting a live row', format($q$DELETE FROM public.wf_memory_item WHERE id = %L$q$, ain03t.id('victim')), '42501', 'ain03:deletion_is_the_retention_pass_only');
SELECT ain03t.shut();
SELECT ain03t.expect_error('delete: a purge marker from another transaction is not honoured', format($q$DELETE FROM public.wf_memory_item WHERE id = %L$q$, ain03t.id('victim')), '42501', 'ain03:deletion_is_the_retention_pass_only');

-- ---------------------------------------------------------------------------------------------
-- 12. Ledger, audit chain and member reads
-- ---------------------------------------------------------------------------------------------
SELECT ain03t.expect_true('every ledger row has a matching audit entry (counts agree per operation)',
  NOT EXISTS (SELECT 1 FROM (SELECT op, count(*) c FROM public.wf_memory_change WHERE org_id = ain03t.id('orgA') GROUP BY op) l
               WHERE ain03t.audits('orgA', 'workflow.memory.' || l.op) <> l.c));
SELECT ain03t.expect_true('the ledger holds the hash of a value and never the value (spot check on one write)',
  (SELECT value_sha256 = encode(sha256(convert_to((SELECT value::text FROM public.wf_memory_item WHERE id = ain03t.id('ret_live'))::text, 'UTF8')), 'hex')
     FROM public.wf_memory_change WHERE item_id = ain03t.id('ret_live') AND op = 'write'));
SELECT ain03t.expect_true('the audit entries carry no memory content (the action is the operation, the hash is of a hash)',
  NOT EXISTS (SELECT 1 FROM public.audit_chain WHERE org_id = ain03t.id('orgA') AND action LIKE 'workflow.memory.%'
                AND coalesce(after_hash, '') = ''));
SELECT ain03t.login_as('authenticated', ain03t.id('adminA'));
SELECT ain03t.expect_true('a member sees their own organization''s live items and none of organization B''s',
  (SELECT count(*) > 5 AND bool_and(org_id = ain03t.id('orgA')) FROM public.wf_memory_item)
  AND NOT EXISTS (SELECT 1 FROM public.wf_memory_item WHERE key IN ('rd-other-org', 'b-two')));
SELECT ain03t.expect_true('a member sees only their organization''s ledger',
  (SELECT count(*) > 5 AND bool_and(org_id = ain03t.id('orgA')) FROM public.wf_memory_change));
SELECT ain03t.login_as('authenticated', ain03t.id('adminB'));
SELECT ain03t.expect_true('the other organization''s manager sees only theirs',
  (SELECT count(*) >= 2 AND bool_and(org_id = ain03t.id('orgB')) FROM public.wf_memory_item)
  AND (SELECT bool_and(org_id = ain03t.id('orgB')) FROM public.wf_memory_change));
SELECT ain03t.login_as('authenticated', ain03t.id('stranger'));
SELECT ain03t.expect_true('a person with no organization sees nothing', (SELECT count(*) = 0 FROM public.wf_memory_item) AND (SELECT count(*) = 0 FROM public.wf_memory_change));
SELECT ain03t.login_as('authenticated', ain03t.id('adminC'));
SELECT ain03t.expect_true('an organization with workflows off still sees only its own (nothing was written)', (SELECT count(*) = 0 FROM public.wf_memory_item));
SELECT ain03t.login_as('service_role');
SELECT ain03t.expect_true('the service role reads the ledger and the reference data, across organizations',
  (SELECT count(DISTINCT org_id) = 2 FROM public.wf_memory_change) AND (SELECT count(*) = 4 FROM public.wf_memory_scope_kind));
SELECT ain03t.logout();

-- ---------------------------------------------------------------------------------------------
-- 13. Result
-- ---------------------------------------------------------------------------------------------
DO $done$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM ain03t.passed;
  RAISE NOTICE 'AIN03 ALL PASS: % checks', n;
END $done$;
ROLLBACK;
