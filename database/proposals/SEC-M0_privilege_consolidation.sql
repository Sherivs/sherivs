-- PROPOSAL ONLY. NOT APPLIED. NOT IN THE MIGRATIONS DIRECTORY.
-- SEC-M0: one consolidated privilege change. It replaces PR #417 (SEC-H3) and extends PR #377
-- (SEC-03). Origin: Claude Code agent, mission E-003 (M0), from the independent audit of
-- 2026-11-16. Needs the founder's written approval and an independent security review before any
-- apply; the orchestrator applies it from merged master only.
--
-- Facts it is built on (read-only queries on production, 2026-11-16):
--  * anon holds privileges on 81 public tables. Only 16 have a policy that lets an anonymous
--    visitor read rows (published website content and two lookups), and one accepts an anonymous
--    INSERT (admission_applications). On the rest RLS already denies anon, so those grants do
--    nothing useful and would expose data the day a policy is loosened by mistake.
--  * anon holds INSERT, UPDATE and DELETE on subscription_tier_plans (denied today only by RLS).
--  * authenticated holds INSERT, UPDATE and DELETE on subscriptions, and policy
--    tenant_all_subscriptions lets an organization admin write their own plan, amount and expiry.
--  * anon can execute 50 functions. 11 are deliberate public endpoints. 3 are helpers that RLS
--    policies call while an anonymous visitor reads a public table; they must stay executable or
--    those reads fail with "permission denied" instead of returning the published rows.
--  * Default privileges give anon and authenticated full rights on every NEW table, sequence and
--    function created by postgres or supabase_admin.
--
-- What it does:
--  1. SEC-H3      subscriptions: tenants read only. Every writer in the code uses the service role.
--  2. SEC-GRANTS  anon: revoke everything on every table, view and sequence in public, then grant
--                 back exactly the public surface below. Revoke EXECUTE from PUBLIC and anon on
--                 every function in public except the allowlist. authenticated and service_role
--                 keep exactly the EXECUTE rights they have now (granted explicitly first).
--  3. SEC-03      default privileges: new tables, sequences and functions are private until a
--                 migration grants them.
--
-- What it does not do: it does not change any policy except on subscriptions, does not touch
-- authenticated's table grants (except subscriptions), and does not review which functions
-- authenticated may execute. Those are separate, listed in progress/missions/M0.md.

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 1. SEC-H3: subscriptions are read-only for tenants.
-- ---------------------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.subscriptions FROM authenticated, anon;
DROP POLICY IF EXISTS tenant_all_subscriptions ON public.subscriptions;
DROP POLICY IF EXISTS tenant_read_subscriptions ON public.subscriptions;
CREATE POLICY tenant_read_subscriptions ON public.subscriptions
  FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() OR public.is_super_admin());

-- ---------------------------------------------------------------------------------------------
-- 2. SEC-GRANTS: anon gets the documented public surface and nothing else.
-- ---------------------------------------------------------------------------------------------
DO $sec_m0$
DECLARE
  -- Tables an anonymous visitor may read. Each has a policy limiting rows to published content.
  public_read constant text[] := ARRAY[
    'academic_programs', 'blog_posts', 'events', 'faqs', 'news', 'school_facilities',
    'school_gallery', 'school_meals', 'school_sports', 'school_staff', 'school_staff_types',
    'school_transport', 'testimonials', 'ui_translations', 'website_block_types', 'why_us_items'];
  -- Tables an anonymous visitor may insert into (the public admission form). No read.
  public_insert constant text[] := ARRAY['admission_applications'];
  -- Functions an anonymous visitor may execute: public endpoints, then RLS helpers.
  public_exec constant text[] := ARRAY[
    'check_result', 'donation_campaign_progress', 'gov_jurisdiction_by_host',
    'public_school_stats', 'public_teachers', 'resolve_school_by_host',
    'siwes_supervisor_verify', 'ui_strings', 'verify_transcript', 'website_public',
    'website_public_post',
    'get_my_school_id', 'is_school_admin', 'is_super_admin'];
  r record;
BEGIN
  -- Tables, views, materialized views, foreign and partitioned tables.
  FOR r IN
    SELECT c.oid::regclass AS obj, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', r.obj);
    IF r.relname = ANY (public_read) THEN
      EXECUTE format('GRANT SELECT ON TABLE %s TO anon', r.obj);
    ELSIF r.relname = ANY (public_insert) THEN
      EXECUTE format('GRANT INSERT ON TABLE %s TO anon', r.obj);
    END IF;
  END LOOP;

  -- Sequences: none for anon, except those a public-insert table's columns own.
  FOR r IN
    SELECT s.oid::regclass AS obj,
           EXISTS (SELECT 1 FROM pg_depend d JOIN pg_class t ON t.oid = d.refobjid
                    WHERE d.objid = s.oid AND d.deptype IN ('a', 'i')
                      AND t.relname = ANY (public_insert)) AS needed
      FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace
     WHERE n.nspname = 'public' AND s.relkind = 'S'
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', r.obj);
    IF r.needed THEN
      EXECUTE format('GRANT USAGE ON SEQUENCE %s TO anon', r.obj);
    END IF;
  END LOOP;

  -- Functions and procedures. Keep what authenticated and service_role can do today by granting
  -- it explicitly before PUBLIC is revoked, so this step changes nothing for them.
  FOR r IN
    SELECT p.oid::regprocedure AS obj, p.proname, p.prokind,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_can
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.objid = p.oid AND d.deptype = 'e')  -- skip extension members
  LOOP
    IF r.auth_can THEN
      EXECUTE format('GRANT EXECUTE ON %s %s TO authenticated',
                     CASE r.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.obj);
    END IF;
    IF r.svc_can THEN
      EXECUTE format('GRANT EXECUTE ON %s %s TO service_role',
                     CASE r.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.obj);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON %s %s FROM PUBLIC, anon',
                   CASE r.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.obj);
    IF r.proname = ANY (public_exec) THEN
      EXECUTE format('GRANT EXECUTE ON %s %s TO anon',
                     CASE r.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.obj);
    END IF;
  END LOOP;
END
$sec_m0$;

-- ---------------------------------------------------------------------------------------------
-- 3. SEC-03: private by default for new objects.
-- ---------------------------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
-- The built-in EXECUTE for PUBLIC can only be removed without IN SCHEMA.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- supabase_admin's defaults are the platform's. postgres may not be allowed to change them; if
-- not, this reports it and the rest still applies. Objects in this project are created by
-- postgres (migrations), so the lines above are the ones that matter.
DO $sec_m0_admin$
BEGIN
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE NOTICE 'SEC-M0: supabase_admin default privileges not changed (%). Ask Supabase support.', SQLERRM;
END
$sec_m0_admin$;

COMMIT;

-- Verification after an apply (read-only; expected values in brackets):
--   SELECT count(*) FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND grantee = 'anon';                                   [17]
--   SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public'
--      AND grantee = 'anon' AND privilege_type NOT IN ('SELECT', 'INSERT');                 [0]
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');       [14]
--   SELECT string_agg(privilege_type, ',') FROM information_schema.role_table_grants
--    WHERE table_name = 'subscriptions' AND grantee = 'authenticated';        [no INSERT/UPDATE/DELETE]
--
-- Rollback: database/proposals/SEC-M0_privilege_consolidation.rollback.sql
