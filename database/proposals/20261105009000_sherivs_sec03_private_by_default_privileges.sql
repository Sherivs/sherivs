-- SEC-03 PROPOSAL (audit finding R-06): new objects in schema public are private by default.
-- Status: PROPOSED. This file is deliberately NOT in database/supabase/migrations, so no tool applies it.
-- It changes production configuration (pg_default_acl) and needs the owner's explicit approval.
-- Rollback: database/proposals/20261105009000_sherivs_sec03_private_by_default_privileges.rollback.sql
-- ADR-076.
--
-- Evidence (read-only production query, 2026-11-14): pg_default_acl for owner postgres in schema
-- public grants anon and authenticated all table rights (arwdxtm, no truncate), all sequence rights
-- and execute on functions, on every object created from now on. This is the root cause of the
-- SEC-02 defects (writable views, anon rights on ledger views).
--
-- What it does: removes anon and authenticated from the default privileges of tables, views and
-- sequences that the role postgres creates in schema public. service_role and postgres keep their
-- defaults. It does not
-- touch any existing object, policy or row, and it does not touch default privileges owned by
-- supabase_admin (objects created through the dashboard or by platform tooling).
--
-- IMPORTANT SEQUENCING: apply this LAST, after every pending migration. Any pending migration that
-- creates a table, sequence or function and relies on the implicit grant would lose it if this ran
-- first. After this change every new migration must grant explicitly, for example:
--   GRANT SELECT ON public.some_table TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.some_rpc(uuid) TO authenticated;
-- Row level security still decides which rows a granted role can see.
--
-- NOT COVERED (by design): functions. PostgreSQL gives PUBLIC execute on every new function, and a
-- schema-scoped default cannot remove that; a global revoke for the role postgres would also change
-- functions created by extensions in other schemas. Function exposure stays governed per migration
-- (REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, then grant) and by the SEC-03 allow-list work
-- for audit finding R-05.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
