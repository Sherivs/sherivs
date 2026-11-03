-- CORE-06 — cg_memory_* client isolation checks (LOCAL, DISPOSABLE DATABASE ONLY).
-- Run only against a loopback disposable Supabase database named
-- `coregrid_memory_test`, with the explicit marker shown below:
--   PGOPTIONS='-c coregrid.test_disposable_database=on' \
--     psql "postgresql://postgres@127.0.0.1:<port>/coregrid_memory_test" \
--     -v ON_ERROR_STOP=1 -f tests/integration/coregrid-memory-isolation.local.sql
-- No production/hosted project. All test objects are rolled back.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'CORE-06: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'CORE-06: refusing non-loopback database server %', inet_server_addr();
  END IF;
  IF current_database() <> 'coregrid_memory_test'
     OR current_setting('coregrid.test_disposable_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'CORE-06: requires the named, explicitly marked disposable database';
  END IF;
  IF to_regclass('public.cg_memory_scope') IS NULL
     OR to_regclass('public.cg_memory_record') IS NULL
     OR to_regclass('public.cg_memory_access_log') IS NULL THEN
    RAISE EXCEPTION 'CORE-06: existing cg_memory_* tables are required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    WHERE c.oid IN (
      'public.cg_memory_scope'::regclass,
      'public.cg_memory_record'::regclass,
      'public.cg_memory_access_log'::regclass
    )
      AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'CORE-06: RLS is disabled on a cg_memory_* table';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('cg_memory_scope', 'cg_memory_record', 'cg_memory_access_log')
  ) THEN
    RAISE EXCEPTION 'CORE-06: cg_memory_* tables must remain zero-policy';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY['cg_memory_scope', 'cg_memory_record', 'cg_memory_access_log']) AS t(name)
    WHERE has_table_privilege('anon', format('public.%I', t.name), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', t.name), 'SELECT')
  ) THEN
    RAISE EXCEPTION 'CORE-06: client roles must not have cg_memory_* SELECT privileges';
  END IF;
END
$guard$;

CREATE SCHEMA coregrid_memory_test;
GRANT USAGE ON SCHEMA coregrid_memory_test TO authenticated;

CREATE FUNCTION coregrid_memory_test.must_deny(_label text, _sql text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  RAISE EXCEPTION 'CORE-06 FAIL [%]: unauthorized memory read was allowed', _label;
END
$fn$;
GRANT EXECUTE ON FUNCTION coregrid_memory_test.must_deny(text, text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT coregrid_memory_test.must_deny(
  'cross-tenant scope lookup',
  $$SELECT 1 FROM public.cg_memory_scope WHERE tenant_id = 'synthetic-tenant-b' AND id = 'synthetic-scope-b'$$
);
SELECT coregrid_memory_test.must_deny(
  'cross-scope record lookup',
  $$SELECT 1 FROM public.cg_memory_record WHERE tenant_id = 'synthetic-tenant-a' AND scope_id = 'synthetic-scope-b'$$
);
SELECT coregrid_memory_test.must_deny(
  'cross-tenant access-log lookup',
  $$SELECT 1 FROM public.cg_memory_access_log WHERE tenant_id = 'synthetic-tenant-b' AND scope_id = 'synthetic-scope-b'$$
);
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'CORE-06 cg_memory_* isolation checks: ALL PASS'; END $$;
ROLLBACK;
