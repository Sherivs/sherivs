-- AIN-05: exact ACLs on the three console read models. Run on a database where AIN-05 was applied by a migrator whose
-- Supabase default privileges were in force (verify.yml, "AIN-05 privileges under Supabase default privileges").
DO $$
DECLARE
  v_fns text[] := ARRAY['wf_console_agents(uuid)', 'wf_console_memory_list(uuid,text,timestamp with time zone,uuid,integer)',
    'wf_console_safety_list(uuid,text,timestamp with time zone,uuid,integer)'];
  f text; r text; n integer := 0;
BEGIN
  FOREACH f IN ARRAY v_fns LOOP
    IF to_regprocedure('public.' || f) IS NULL THEN RAISE EXCEPTION 'AIN05-PRIV FAIL: % is missing', f; END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(r, ('public.' || f)::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'AIN05-PRIV FAIL: % can execute %', r, f;
      END IF;
      n := n + 1;
    END LOOP;
    IF NOT has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'AIN05-PRIV FAIL: service_role cannot execute %', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p2, aclexplode(coalesce(p2.proacl, acldefault('f', p2.proowner))) a
                WHERE p2.oid = ('public.' || f)::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'AIN05-PRIV FAIL: PUBLIC can execute %', f;
    END IF;
    IF NOT (SELECT p2.prosecdef AND p2.proconfig @> ARRAY['search_path=""'] FROM pg_proc p2
             WHERE p2.oid = ('public.' || f)::regprocedure) THEN
      RAISE EXCEPTION 'AIN05-PRIV FAIL: % is not SECURITY DEFINER with an empty search_path', f;
    END IF;
    n := n + 3;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p2 WHERE p2.pronamespace = 'public'::regnamespace AND p2.proname LIKE 'wf\_console\_%'
               AND p2.proname NOT IN (SELECT split_part(x, '(', 1) FROM unnest(v_fns) x)) THEN
    RAISE EXCEPTION 'AIN05-PRIV FAIL: an unlisted console function exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'wf\_console%') THEN
    RAISE EXCEPTION 'AIN05-PRIV FAIL: AIN-05 must add no table';
  END IF;
  RAISE NOTICE 'AIN05-PRIV ALL PASS: % checks', n + 2;
END $$;
