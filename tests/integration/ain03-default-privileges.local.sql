-- AIN-03: exact ACLs on the tenant memory tables and functions.
--
-- Run it on a database where AIN-03 was applied by a migrator whose Supabase default privileges (ALTER DEFAULT
-- PRIVILEGES ... GRANT ALL ... TO anon, authenticated, service_role) were in force (see verify.yml, "AIN-03 privileges
-- under Supabase default privileges"). Under those defaults an object a migration forgets to revoke is exposed to the
-- service role or to clients; this file turns that into a failure.
DO $$
DECLARE
  -- table => the privileges service_role and authenticated may hold (everything else, for any role, must be absent)
  v_tables text[] := ARRAY['wf_memory_scope_kind', 'wf_memory_item', 'wf_memory_change'];
  v_fns text[] := ARRAY['wf_memory_org_item_cap()', 'wf_memory_org_proposal_cap()', 'wf_memory_agent_daily_proposals()', 'wf_memory_value_ok(text,jsonb)',
    'wf_memory_open(text)', 'wf_memory_close()', 'wf_memory_item_guard()', 'wf_memory_item_delete_guard()',
    'wf_memory_item_audit()', 'wf_memory_put(uuid,text,text,text,text,jsonb,integer,boolean)',
    'wf_memory_agent_propose(uuid,text,text,text,jsonb,integer)', 'wf_memory_decide(uuid,uuid,text)',
    'wf_memory_retire(uuid,uuid)', 'wf_memory_agent_read(uuid,text,integer)', 'wf_memory_purge_expired(integer)'];
  v_exec text[] := ARRAY['wf_memory_put(uuid,text,text,text,text,jsonb,integer,boolean)',
    'wf_memory_agent_propose(uuid,text,text,text,jsonb,integer)', 'wf_memory_decide(uuid,uuid,text)',
    'wf_memory_retire(uuid,uuid)', 'wf_memory_agent_read(uuid,text,integer)', 'wf_memory_purge_expired(integer)'];
  t text; f text; r text; p text; n integer := 0; v_svc_select boolean; v_auth_select boolean;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'AIN03-PRIV FAIL: RLS is not enabled and forced on %', t;
    END IF;
    n := n + 1;
    -- Who may SELECT: the service role the reference data and the ledger (never the items); signed-in members the
    -- items and the ledger (through RLS); nobody the reference data but the service role.
    v_svc_select := t IN ('wf_memory_scope_kind', 'wf_memory_change');
    v_auth_select := t IN ('wf_memory_item', 'wf_memory_change');
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('anon', 'public.' || t, p) THEN
        RAISE EXCEPTION 'AIN03-PRIV FAIL: anon has % on %', p, t;
      END IF;
      IF has_table_privilege('service_role', 'public.' || t, p) IS DISTINCT FROM (p = 'SELECT' AND v_svc_select) THEN
        RAISE EXCEPTION 'AIN03-PRIV FAIL: service_role has the wrong % on %', p, t;
      END IF;
      IF has_table_privilege('authenticated', 'public.' || t, p) IS DISTINCT FROM (p = 'SELECT' AND v_auth_select) THEN
        RAISE EXCEPTION 'AIN03-PRIV FAIL: authenticated has the wrong % on %', p, t;
      END IF;
      n := n + 3;
    END LOOP;
    -- No column-level grant to a client role or PUBLIC either, beyond the table SELECT above.
    IF EXISTS (SELECT 1 FROM information_schema.column_privileges
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'PUBLIC')) THEN
      RAISE EXCEPTION 'AIN03-PRIV FAIL: anon or PUBLIC has a column privilege on %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.column_privileges
                WHERE table_schema = 'public' AND table_name = t AND grantee = 'service_role'
                  AND NOT v_svc_select) THEN
      RAISE EXCEPTION 'AIN03-PRIV FAIL: service_role has a column privilege on %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.column_privileges
                WHERE table_schema = 'public' AND table_name = t AND grantee = 'authenticated'
                  AND (NOT v_auth_select OR privilege_type <> 'SELECT')) THEN
      RAISE EXCEPTION 'AIN03-PRIV FAIL: authenticated has a column privilege beyond SELECT on %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                WHERE c.oid = ('public.' || t)::regclass AND a.grantee = 0) THEN
      RAISE EXCEPTION 'AIN03-PRIV FAIL: PUBLIC holds a privilege on %', t;
    END IF;
    n := n + 4;
  END LOOP;
  FOREACH f IN ARRAY v_fns LOOP
    IF to_regprocedure('public.' || f) IS NULL THEN RAISE EXCEPTION 'AIN03-PRIV FAIL: % is missing', f; END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(r, ('public.' || f)::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'AIN03-PRIV FAIL: % can execute %', r, f;
      END IF;
      n := n + 1;
    END LOOP;
    IF f = ANY (v_exec) THEN
      IF NOT has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'AIN03-PRIV FAIL: service_role cannot execute %', f;
      END IF;
    ELSIF has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'AIN03-PRIV FAIL: service_role can execute % (only the six entry points may be called)', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p2, aclexplode(coalesce(p2.proacl, acldefault('f', p2.proowner))) a
                WHERE p2.oid = ('public.' || f)::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'AIN03-PRIV FAIL: PUBLIC can execute %', f;
    END IF;
    IF NOT (SELECT p2.proconfig @> ARRAY['search_path=""'] FROM pg_proc p2 WHERE p2.oid = ('public.' || f)::regprocedure) THEN
      RAISE EXCEPTION 'AIN03-PRIV FAIL: % does not pin an empty search_path', f;
    END IF;
    n := n + 3;
  END LOOP;
  -- Every function with the wf_memory prefix is on the list.
  IF EXISTS (SELECT 1 FROM pg_proc p2 WHERE p2.pronamespace = 'public'::regnamespace AND p2.proname LIKE 'wf\_memory\_%'
               AND p2.proname NOT IN (SELECT split_part(x, '(', 1) FROM unnest(v_fns) x)) THEN
    RAISE EXCEPTION 'AIN03-PRIV FAIL: an unlisted memory function exists';
  END IF;
  RAISE NOTICE 'AIN03-PRIV ALL PASS: % checks', n;
END $$;
