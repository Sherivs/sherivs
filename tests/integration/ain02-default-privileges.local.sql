-- AIN-02: exact ACLs on the autonomy tables and functions.
--
-- Run it on a database where AIN-02 was applied by a migrator whose Supabase default privileges (ALTER DEFAULT
-- PRIVILEGES ... GRANT ALL ... TO anon, authenticated, service_role) were in force (see verify.yml, "AIN-02 privileges
-- under Supabase default privileges"). Under those defaults an object a migration forgets to revoke is exposed to the
-- service role or to clients; this file turns that into a failure.
DO $$
DECLARE
  v_tables text[] := ARRAY['wf_autonomy_scale', 'wf_autonomy_class_cap', 'wf_autonomy_agent_tier_cap', 'wf_autonomy_bar',
    'wf_autonomy_evidence', 'wf_autonomy_change', 'wf_agent_autonomy'];
  v_fns text[] := ARRAY['wf_autonomy_rank(text)', 'wf_autonomy_level_of(integer)', 'wf_autonomy_demote_floor()',
    'wf_autonomy_append_only()', 'wf_autonomy_ceiling(text)', 'wf_effective_autonomy(uuid,text,text,text)',
    'wf_autonomy_guard()', 'wf_autonomy_write_gate()', 'wf_autonomy_change_guard()', 'wf_autonomy_change_audit()',
    'wf_autonomy_apply(uuid,text,text,text,uuid,uuid,text)', 'wf_action_sandbox_outbox_autonomy_guard()',
    'wf_run_freeze_actor()', 'wf_autonomy_record_evidence(text,text,integer,integer,integer,integer,timestamptz,text)',
    'wf_autonomy_promote(uuid,uuid,text,text,uuid,text)', 'wf_autonomy_demote(uuid,uuid,text,text,text)'];
  v_exec text[] := ARRAY['wf_autonomy_record_evidence(text,text,integer,integer,integer,integer,timestamptz,text)',
    'wf_autonomy_promote(uuid,uuid,text,text,uuid,text)', 'wf_autonomy_demote(uuid,uuid,text,text,text)'];
  t text; f text; r text; p text; n integer := 0;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'AIN02-PRIV FAIL: RLS is not enabled and forced on %', t;
    END IF;
    n := n + 1;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege(r, 'public.' || t, p) THEN
          RAISE EXCEPTION 'AIN02-PRIV FAIL: % has % on %', r, p, t;
        END IF;
        n := n + 1;
      END LOOP;
    END LOOP;
    IF NOT has_table_privilege('service_role', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'AIN02-PRIV FAIL: service_role lost SELECT on %', t;
    END IF;
    FOREACH p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('service_role', 'public.' || t, p) THEN
        RAISE EXCEPTION 'AIN02-PRIV FAIL: service_role has % on % (SELECT only)', p, t;
      END IF;
      n := n + 1;
    END LOOP;
    IF EXISTS (SELECT 1 FROM information_schema.column_privileges
                WHERE table_schema = 'public' AND table_name = t
                  AND grantee IN ('anon', 'authenticated', 'PUBLIC')) THEN
      RAISE EXCEPTION 'AIN02-PRIV FAIL: a client role has a column privilege on %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                WHERE c.oid = ('public.' || t)::regclass AND a.grantee = 0) THEN
      RAISE EXCEPTION 'AIN02-PRIV FAIL: PUBLIC holds a privilege on %', t;
    END IF;
    n := n + 2;
  END LOOP;
  FOREACH f IN ARRAY v_fns LOOP
    IF to_regprocedure('public.' || f) IS NULL THEN RAISE EXCEPTION 'AIN02-PRIV FAIL: % is missing', f; END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(r, ('public.' || f)::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'AIN02-PRIV FAIL: % can execute %', r, f;
      END IF;
      n := n + 1;
    END LOOP;
    IF f = ANY (v_exec) THEN
      IF NOT has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'AIN02-PRIV FAIL: service_role cannot execute %', f;
      END IF;
    ELSIF has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'AIN02-PRIV FAIL: service_role can execute % (only the three entry points may be called)', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p2, aclexplode(coalesce(p2.proacl, acldefault('f', p2.proowner))) a
                WHERE p2.oid = ('public.' || f)::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'AIN02-PRIV FAIL: PUBLIC can execute %', f;
    END IF;
    IF NOT (SELECT p2.proconfig @> ARRAY['search_path=""'] FROM pg_proc p2 WHERE p2.oid = ('public.' || f)::regprocedure)
       AND f NOT IN ('wf_autonomy_rank(text)', 'wf_autonomy_level_of(integer)', 'wf_autonomy_demote_floor()',
                     'wf_autonomy_append_only()') THEN
      RAISE EXCEPTION 'AIN02-PRIV FAIL: % does not pin an empty search_path', f;
    END IF;
    n := n + 3;
  END LOOP;
  -- Every function with the wf_autonomy prefix, plus the two guards and the effective-level function, is on the list.
  IF EXISTS (SELECT 1 FROM pg_proc p2 WHERE p2.pronamespace = 'public'::regnamespace
               AND (p2.proname LIKE 'wf\_autonomy\_%' OR p2.proname IN ('wf_effective_autonomy',
                    'wf_action_sandbox_outbox_autonomy_guard', 'wf_run_freeze_actor'))
               AND p2.proname NOT IN (SELECT split_part(x, '(', 1) FROM unnest(v_fns) x)) THEN
    RAISE EXCEPTION 'AIN02-PRIV FAIL: an unlisted autonomy function exists';
  END IF;
  RAISE NOTICE 'AIN02-PRIV ALL PASS: % checks', n;
END $$;
