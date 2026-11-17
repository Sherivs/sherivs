-- APPLIED TO PRODUCTION 2026-11-17 04:45 UTC as 20261117000300_sherivs_sec_m0_privilege_consolidation,
-- on the founder's written approval, after backup run 37. Kept outside the migrations directory.
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
--  * anon also holds COLUMN-level SELECT on two tables, which information_schema.role_table_grants
--    does not show: schools (69 of 71 columns; the SHERIVS-002 design behind sitemap.xml, the web
--    manifest, tenant branding before sign-in, and the admission form's policy, which looks the
--    organization up) and users (33 of 38 columns; no anonymous path reads it).
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
--  0. SNAPSHOT    record every privilege held by anon and PUBLIC on public objects, in a schema
--                 clients cannot reach, so the rollback can restore exactly what was there.
--  2. SEC-GRANTS  anon: revoke everything on every table, view and sequence in public, then grant
--                 back exactly the public surface below. schools keeps its existing column-level
--                 read and loses everything else; users loses its column-level read on purpose. Revoke EXECUTE from PUBLIC and anon on
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
-- 0. SNAPSHOT: what anon and PUBLIC hold now, for an exact rollback. Taken once; a second run of
--    this file keeps the first snapshot (the true "before").
-- ---------------------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS ops_private;
REVOKE ALL ON SCHEMA ops_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS ops_private.sec_m0_acl_snapshot (
  kind        text NOT NULL CHECK (kind IN ('relation', 'sequence', 'column', 'routine')),
  object_oid  oid  NOT NULL,
  object_name text NOT NULL,
  column_name text,
  grantee     text NOT NULL CHECK (grantee IN ('anon', 'PUBLIC')),
  privilege   text NOT NULL,
  taken_at    timestamptz NOT NULL DEFAULT now()
);
-- RLS on with no policy: only the owner (the migration role) can read or write it. Not FORCED,
-- because the owner must be able to write the snapshot and read it back in a rollback.
ALTER TABLE ops_private.sec_m0_acl_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ops_private.sec_m0_acl_snapshot FROM PUBLIC, anon, authenticated;

INSERT INTO ops_private.sec_m0_acl_snapshot (kind, object_oid, object_name, column_name, grantee, privilege)
SELECT * FROM (
  SELECT CASE WHEN c.relkind = 'S' THEN 'sequence' ELSE 'relation' END, c.oid, c.oid::regclass::text,
         NULL::text, CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE 'anon' END, e.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) e
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     AND (e.grantee = 0 OR e.grantee = 'anon'::regrole)
  UNION ALL
  SELECT 'column', c.oid, c.oid::regclass::text, a.attname::text,
         CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE 'anon' END, e.privilege_type
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(a.attacl) e
   WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
     AND (e.grantee = 0 OR e.grantee = 'anon'::regrole)
  UNION ALL
  -- A function with no ACL yet has the built-in default: EXECUTE for PUBLIC.
  SELECT 'routine', p.oid, p.oid::regprocedure::text, NULL::text,
         CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE 'anon' END, e.privilege_type
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
         aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
   WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
     AND (e.grantee = 0 OR e.grantee = 'anon'::regrole)
) before_state
WHERE NOT EXISTS (SELECT 1 FROM ops_private.sec_m0_acl_snapshot);

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
  -- Tables where anon keeps the column-level SELECT it already has, and nothing else. The apply
  -- stops if anon holds table-level SELECT there, because that would expose withheld columns.
  column_read constant text[] := ARRAY['schools'];
  -- Functions an anonymous visitor may execute, by exact signature (an overload added later is
  -- not covered): public endpoints, then helpers that policies on the readable tables call.
  public_exec constant text[] := ARRAY[
    'check_result(text, text, text)', 'donation_campaign_progress(uuid)',
    'gov_jurisdiction_by_host(text)', 'public_school_stats(text)', 'public_teachers(text)',
    'resolve_school_by_host(text)', 'siwes_supervisor_verify(uuid, text, integer, text)',
    'ui_strings(text)', 'verify_transcript(text)', 'website_public(text, text)',
    'website_public_post(text, text, text)',
    'get_my_school_id()', 'is_school_admin()', 'is_super_admin()'];
  r record;
BEGIN
  -- Tables, views, materialized views, foreign and partitioned tables.
  FOR r IN
    SELECT c.oid::regclass AS obj, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    IF r.relname = ANY (column_read) THEN
      IF has_table_privilege('anon', r.obj, 'SELECT') THEN
        RAISE EXCEPTION 'SEC-M0: anon holds table-level SELECT on %; expected column-level only', r.obj;
      END IF;
      -- Revoking these at table level also removes any column-level grant of the same kind, and
      -- leaves the column-level SELECT untouched.
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER%s ON TABLE %s FROM anon',
                     CASE WHEN current_setting('server_version_num')::int >= 170000 THEN ', MAINTAIN' ELSE '' END,
                     r.obj);
      CONTINUE;
    END IF;
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
    SELECT p.oid::regprocedure AS obj, p.prokind,
           p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS signature,
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
    IF r.signature = ANY (public_exec) THEN
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

-- Verification after an apply (read-only; expected values in brackets). Note that
-- information_schema.role_table_grants does not list column-level grants; use the has_* functions.
--   SELECT count(*) FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND grantee = 'anon';                                   [17]
--   SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public'
--      AND grantee = 'anon' AND privilege_type NOT IN ('SELECT', 'INSERT');                 [0]
--   SELECT has_column_privilege('anon', 'public.schools', 'slug', 'SELECT'),               [true]
--          has_column_privilege('anon', 'public.schools', 'is_active', 'SELECT'),          [true]
--          has_column_privilege('anon', 'public.schools', 'grading_scale_id', 'SELECT'),   [false]
--          has_table_privilege('anon', 'public.schools', 'SELECT'),                        [false]
--          has_any_column_privilege('anon', 'public.users', 'SELECT');                     [false]
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');       [14]
--   SELECT string_agg(privilege_type, ',') FROM information_schema.role_table_grants
--    WHERE table_name = 'subscriptions' AND grantee = 'authenticated';        [no INSERT/UPDATE/DELETE]
--   SELECT count(*) FROM ops_private.sec_m0_acl_snapshot;                    [> 0: rollback is possible]
-- Then open, signed out: an organization site, /sitemap.xml, /manifest.webmanifest?school=<slug>,
-- the sign-in page on an organization host, result check, transcript verify and SIWES verify.
--
-- Rollback: database/proposals/SEC-M0_privilege_consolidation.rollback.sql
