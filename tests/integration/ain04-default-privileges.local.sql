-- AIN-04: exact ACLs on the guardrail tables and functions.
--
-- Run it on a database where AIN-04 was applied by a migrator whose Supabase default privileges (ALTER DEFAULT
-- PRIVILEGES ... GRANT ALL ... TO anon, authenticated, service_role) were in force (see verify.yml, "AIN-04 privileges
-- under Supabase default privileges"). Under those defaults an object a migration forgets to revoke is exposed to the
-- service role or to clients; this file turns that into a failure.
DO $$
DECLARE
  -- table => the privileges service_role and authenticated may hold (everything else, for any role, must be absent)
  v_tables text[] := ARRAY['wf_safety_pattern', 'wf_safety_eval_suite', 'wf_safety_eval_case', 'wf_safety_eval_run',
    'wf_safety_check', 'wf_safety_review'];
  v_fns text[] := ARRAY['wf_safety_max_text_chars()', 'wf_safety_run_check_cap()', 'wf_safety_org_daily_cap()',
    'wf_safety_eval_daily_cap()', 'wf_safety_norm(text)', 'wf_safety_screen(text,text)', 'wf_safety_suite_sha(text,integer)',
    'wf_safety_eval_compute(text,integer)', 'wf_safety_verified()', 'wf_safety_open(text)', 'wf_safety_close()',
    'wf_safety_eval_run_guard()', 'wf_safety_check_guard()', 'wf_safety_review_guard()', 'wf_safety_audit()',
    'wf_safety_run_eval()', 'wf_safety_check_text(uuid,text,text,text)', 'wf_safety_review_check(uuid,uuid,text,text)',
    'wf_safety_check_usable(uuid,text)'];
  v_exec text[] := ARRAY['wf_safety_run_eval()', 'wf_safety_check_text(uuid,text,text,text)',
    'wf_safety_review_check(uuid,uuid,text,text)', 'wf_safety_check_usable(uuid,text)'];
  t text; f text; r text; p text; n integer := 0; v_svc_select boolean; v_auth_select boolean;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'AIN04-PRIV FAIL: RLS is not enabled and forced on %', t;
    END IF;
    n := n + 1;
    -- Who may SELECT: the service role every table (the ledgers hold hashes and codes, never content); signed-in members only
    -- the two tenant ledgers (through RLS); nobody else the corpus, the cases or the platform runs.
    v_svc_select := true;
    v_auth_select := t IN ('wf_safety_check', 'wf_safety_review');
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('anon', 'public.' || t, p) THEN
        RAISE EXCEPTION 'AIN04-PRIV FAIL: anon has % on %', p, t;
      END IF;
      IF has_table_privilege('service_role', 'public.' || t, p) IS DISTINCT FROM (p = 'SELECT' AND v_svc_select) THEN
        RAISE EXCEPTION 'AIN04-PRIV FAIL: service_role has the wrong % on %', p, t;
      END IF;
      IF has_table_privilege('authenticated', 'public.' || t, p) IS DISTINCT FROM (p = 'SELECT' AND v_auth_select) THEN
        RAISE EXCEPTION 'AIN04-PRIV FAIL: authenticated has the wrong % on %', p, t;
      END IF;
      n := n + 3;
    END LOOP;
    -- No column-level grant to a client role or PUBLIC either, beyond the table SELECT above.
    IF EXISTS (SELECT 1 FROM information_schema.column_privileges
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'PUBLIC')) THEN
      RAISE EXCEPTION 'AIN04-PRIV FAIL: anon or PUBLIC has a column privilege on %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.column_privileges
                WHERE table_schema = 'public' AND table_name = t AND grantee = 'service_role'
                  AND NOT v_svc_select) THEN
      RAISE EXCEPTION 'AIN04-PRIV FAIL: service_role has a column privilege on %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.column_privileges
                WHERE table_schema = 'public' AND table_name = t AND grantee = 'authenticated'
                  AND (NOT v_auth_select OR privilege_type <> 'SELECT')) THEN
      RAISE EXCEPTION 'AIN04-PRIV FAIL: authenticated has a column privilege beyond SELECT on %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                WHERE c.oid = ('public.' || t)::regclass AND a.grantee = 0) THEN
      RAISE EXCEPTION 'AIN04-PRIV FAIL: PUBLIC holds a privilege on %', t;
    END IF;
    n := n + 4;
  END LOOP;
  FOREACH f IN ARRAY v_fns LOOP
    IF to_regprocedure('public.' || f) IS NULL THEN RAISE EXCEPTION 'AIN04-PRIV FAIL: % is missing', f; END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(r, ('public.' || f)::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'AIN04-PRIV FAIL: % can execute %', r, f;
      END IF;
      n := n + 1;
    END LOOP;
    IF f = ANY (v_exec) THEN
      IF NOT has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'AIN04-PRIV FAIL: service_role cannot execute %', f;
      END IF;
    ELSIF has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'AIN04-PRIV FAIL: service_role can execute % (only the four entry points may be called)', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p2, aclexplode(coalesce(p2.proacl, acldefault('f', p2.proowner))) a
                WHERE p2.oid = ('public.' || f)::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'AIN04-PRIV FAIL: PUBLIC can execute %', f;
    END IF;
    IF NOT (SELECT p2.proconfig @> ARRAY['search_path=""'] FROM pg_proc p2 WHERE p2.oid = ('public.' || f)::regprocedure) THEN
      RAISE EXCEPTION 'AIN04-PRIV FAIL: % does not pin an empty search_path', f;
    END IF;
    n := n + 3;
  END LOOP;
  -- Every function with the wf_safety prefix is on the list.
  IF EXISTS (SELECT 1 FROM pg_proc p2 WHERE p2.pronamespace = 'public'::regnamespace AND p2.proname LIKE 'wf\_safety\_%'
               AND p2.proname NOT IN (SELECT split_part(x, '(', 1) FROM unnest(v_fns) x)) THEN
    RAISE EXCEPTION 'AIN04-PRIV FAIL: an unlisted safety function exists';
  END IF;
  RAISE NOTICE 'AIN04-PRIV ALL PASS: % checks', n;
END $$;
