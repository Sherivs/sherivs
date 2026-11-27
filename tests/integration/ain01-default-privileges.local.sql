-- AIN-01: exact ACLs on the registry tables and functions.
--
-- Run it on a database where AIN-01 was applied by a migrator whose Supabase default privileges (ALTER DEFAULT
-- PRIVILEGES ... GRANT ALL ... TO anon, authenticated, service_role) were in force (see verify.yml, "AIN-01 privileges
-- under Supabase default privileges"). Under those defaults an object a migration forgets to revoke is exposed to the
-- service role or to clients; this file turns that into a failure.
DO $$
DECLARE
  v_tables text[] := ARRAY['wf_agent', 'wf_agent_capability', 'wf_agent_tier_action_class', 'wf_agent_platform_grant'];
  v_fns text[] := ARRAY['wf_ai_route_approved()', 'wf_agent_state_code(uuid,text)', 'wf_agent_class_allowed(text,text)',
    'wf_agent_step_guard()', 'wf_agent_step_immutable()', 'wf_agent_capability_guard()',
    'wf_agent_platform_grant_guard()', 'wf_agent_platform_grant_audit()', 'wf_agent_registry_get(uuid)'];
  v_exec text[] := ARRAY['wf_ai_route_approved()', 'wf_agent_registry_get(uuid)'];
  t text; f text; r text; p text; n integer := 0;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'AIN01-PRIV FAIL: RLS is not enabled and forced on %', t;
    END IF;
    n := n + 1;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege(r, 'public.' || t, p) THEN
          RAISE EXCEPTION 'AIN01-PRIV FAIL: % has % on %', r, p, t;
        END IF;
        n := n + 1;
      END LOOP;
    END LOOP;
    IF NOT has_table_privilege('service_role', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'AIN01-PRIV FAIL: service_role lost SELECT on %', t;
    END IF;
    FOREACH p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('service_role', 'public.' || t, p) THEN
        RAISE EXCEPTION 'AIN01-PRIV FAIL: service_role has % on % (SELECT only)', p, t;
      END IF;
      n := n + 1;
    END LOOP;
    IF EXISTS (SELECT 1 FROM information_schema.column_privileges
                WHERE table_schema = 'public' AND table_name = t
                  AND grantee IN ('anon', 'authenticated', 'PUBLIC')) THEN
      RAISE EXCEPTION 'AIN01-PRIV FAIL: a client role has a column privilege on %', t;
    END IF;
    n := n + 1;
  END LOOP;
  FOREACH f IN ARRAY v_fns LOOP
    IF to_regprocedure('public.' || f) IS NULL THEN RAISE EXCEPTION 'AIN01-PRIV FAIL: % is missing', f; END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(r, ('public.' || f)::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'AIN01-PRIV FAIL: % can execute %', r, f;
      END IF;
      n := n + 1;
    END LOOP;
    IF f = ANY (v_exec) THEN
      IF NOT has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'AIN01-PRIV FAIL: service_role cannot execute %', f;
      END IF;
    ELSIF has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'AIN01-PRIV FAIL: service_role can execute % (only the two read functions may be called)', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p2, aclexplode(coalesce(p2.proacl, acldefault('f', p2.proowner))) a
                WHERE p2.oid = ('public.' || f)::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'AIN01-PRIV FAIL: PUBLIC can execute %', f;
    END IF;
    n := n + 2;
  END LOOP;
  -- Every function with the wf_agent or wf_ai prefix is on the list above (by name).
  IF EXISTS (SELECT 1 FROM pg_proc p2 WHERE p2.pronamespace = 'public'::regnamespace
               AND (p2.proname LIKE 'wf\_agent\_%' OR p2.proname LIKE 'wf\_ai\_%')
               AND p2.proname NOT IN (SELECT split_part(x, '(', 1) FROM unnest(v_fns) x)) THEN
    RAISE EXCEPTION 'AIN01-PRIV FAIL: an unlisted wf_agent_* or wf_ai_* function exists';
  END IF;
  RAISE NOTICE 'AIN01-PRIV ALL PASS: % checks', n;
END $$;
