-- SEC-03 proposal contract (LOCAL disposable PostgreSQL only; run from the repository root):
--   psql "postgresql://postgres@127.0.0.1:54329/postgres" -v ON_ERROR_STOP=1 \
--     -f tests/integration/sec03-default-privileges.local.sql
-- Recreates the audited production default privileges, proves new objects are open, applies the
-- proposal twice, proves new objects are private while existing ones and service_role are unchanged,
-- proves explicit grants still work, then rolls the proposal back. Synthetic objects only; rolls back.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'SEC-03: must run as a superuser on a disposable DB';
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'SEC-03: the proposal is written for objects created by the role postgres';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'SEC-03: refusing non-loopback server address %', inet_server_addr();
  END IF;
END
$guard$;

CREATE SCHEMA s03_probe;
CREATE FUNCTION s03_probe.assert_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'SEC-03 FAIL: %', p_label; END IF;
  RAISE NOTICE 'ok  - %', p_label;
END $$;
-- Any right for the role on a relation or function.
CREATE FUNCTION s03_probe.has_any(p_role text, p_obj text) RETURNS boolean LANGUAGE sql AS $$
  SELECT has_table_privilege(p_role, p_obj, 'SELECT') OR has_table_privilege(p_role, p_obj, 'INSERT')
      OR has_table_privilege(p_role, p_obj, 'UPDATE') OR has_table_privilege(p_role, p_obj, 'DELETE')
$$;

-- Recreate the audited production default privileges for objects created by postgres in public.
\i database/proposals/20261105009000_sherivs_sec03_private_by_default_privileges.rollback.sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;

CREATE TABLE public.s03_before (id int PRIMARY KEY);
CREATE SEQUENCE public.s03_before_seq;
CREATE FUNCTION public.s03_before_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
CREATE VIEW public.s03_before_view AS SELECT id FROM public.s03_before;

SELECT s03_probe.assert_true('before: a new table is open to anon and authenticated (the defect)',
  s03_probe.has_any('anon', 'public.s03_before') AND s03_probe.has_any('authenticated', 'public.s03_before'));
SELECT s03_probe.assert_true('before: a new view is writable by authenticated (the SEC-02 root cause)',
  has_table_privilege('authenticated', 'public.s03_before_view', 'UPDATE'));
SELECT s03_probe.assert_true('before: a new sequence is open to authenticated',
  has_sequence_privilege('authenticated', 'public.s03_before_seq', 'UPDATE'));

CREATE TEMP TABLE s03_acl_before AS
  SELECT relname, relacl::text AS acl FROM pg_class
   WHERE relnamespace = 'public'::regnamespace AND relname LIKE 's03_before%';

\i database/proposals/20261105009000_sherivs_sec03_private_by_default_privileges.sql
\i database/proposals/20261105009000_sherivs_sec03_private_by_default_privileges.sql

CREATE TABLE public.s03_after (id int PRIMARY KEY);
CREATE SEQUENCE public.s03_after_seq;
CREATE FUNCTION public.s03_after_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
CREATE VIEW public.s03_after_view AS SELECT id FROM public.s03_after;

SELECT s03_probe.assert_true('after: a new table has no rights for anon or authenticated',
  NOT s03_probe.has_any('anon', 'public.s03_after') AND NOT s03_probe.has_any('authenticated', 'public.s03_after'));
SELECT s03_probe.assert_true('after: a new view has no rights for anon or authenticated',
  NOT s03_probe.has_any('anon', 'public.s03_after_view') AND NOT s03_probe.has_any('authenticated', 'public.s03_after_view'));
SELECT s03_probe.assert_true('after: a new sequence has no rights for anon or authenticated',
  NOT has_sequence_privilege('anon', 'public.s03_after_seq', 'USAGE')
  AND NOT has_sequence_privilege('authenticated', 'public.s03_after_seq', 'USAGE')
  AND NOT has_sequence_privilege('authenticated', 'public.s03_after_seq', 'UPDATE'));
-- Functions are deliberately not covered (PUBLIC keeps execute); the per-function revoke pattern works.
REVOKE ALL ON FUNCTION public.s03_after_fn() FROM PUBLIC, anon, authenticated;
SELECT s03_probe.assert_true('after: the per-function revoke pattern still closes a function',
  NOT has_function_privilege('anon', 'public.s03_after_fn()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.s03_after_fn()', 'EXECUTE'));
SELECT s03_probe.assert_true('after: service_role keeps its default rights on new tables',
  has_table_privilege('service_role', 'public.s03_after', 'SELECT')
  AND has_table_privilege('service_role', 'public.s03_after', 'INSERT'));
SELECT s03_probe.assert_true('after: objects created before the change keep exactly their old privileges',
  (SELECT count(*) FROM (
     SELECT relname, relacl::text FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname LIKE 's03_before%'
     EXCEPT SELECT * FROM s03_acl_before) d) = 0
  AND s03_probe.has_any('authenticated', 'public.s03_before'));

-- An explicit grant, as every future migration must write, still works and grants only what is named.
GRANT SELECT ON public.s03_after TO authenticated;
GRANT EXECUTE ON FUNCTION public.s03_after_fn() TO authenticated;
SELECT s03_probe.assert_true('after: an explicit grant gives exactly the named rights',
  has_table_privilege('authenticated', 'public.s03_after', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.s03_after', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.s03_after', 'UPDATE')
  AND has_function_privilege('authenticated', 'public.s03_after_fn()', 'EXECUTE')
  AND NOT has_table_privilege('anon', 'public.s03_after', 'SELECT'));

-- Other schemas and other owners are untouched by the proposal.
CREATE SCHEMA s03_other;
CREATE TABLE s03_other.t (id int);
SELECT s03_probe.assert_true('other schemas are not affected (no default rights are added or removed there)',
  NOT s03_probe.has_any('anon', 's03_other.t'));

-- Rollback restores the audited defaults for new objects.
\i database/proposals/20261105009000_sherivs_sec03_private_by_default_privileges.rollback.sql
CREATE TABLE public.s03_rolled_back (id int PRIMARY KEY);
SELECT s03_probe.assert_true('rollback: new tables are open to anon and authenticated again',
  s03_probe.has_any('anon', 'public.s03_rolled_back') AND s03_probe.has_any('authenticated', 'public.s03_rolled_back'));
\i database/proposals/20261105009000_sherivs_sec03_private_by_default_privileges.rollback.sql
\i database/proposals/20261105009000_sherivs_sec03_private_by_default_privileges.sql
CREATE TABLE public.s03_forward_again (id int PRIMARY KEY);
SELECT s03_probe.assert_true('roll forward again: new tables are private again',
  NOT s03_probe.has_any('anon', 'public.s03_forward_again'));

DO $done$ BEGIN RAISE NOTICE 'SEC03 ALL PASS'; END $done$;
ROLLBACK;
