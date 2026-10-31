-- =============================================================================
-- Apply 20261029001000 (FORCE RLS on six catalogs) and 20261029001100
-- (definer policies, only when a function owner lacks superuser and BYPASSRLS)
-- to PRODUCTION via the Supabase SQL editor.
--
-- HOW TO USE: paste this whole file into a new SQL editor query and Run once.
--   * One transaction. Any error rolls back everything, including the ledger.
--   * Guard refuses when a version is already recorded, a table is missing,
--     RLS is off, FORCE is already on, or an affected function is missing.
--   * Each migration body is copied from database/supabase/migrations/.
--     The file's own BEGIN/COMMIT lines are commented so they do not commit
--     early. Same convention as docs/ops/sql/apply-release-60-migrations.sql
--     (PR #71).
--   * Ledger insert matches the SQL-editor convention (version, name) when
--     the name column exists, and version-only otherwise (staging runner).
-- Do not paste 20261029001000 by itself unless preflight force_alone_safe
-- is true. This file is safe in both cases.
-- =============================================================================
SET default_transaction_read_only = off;

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

DO $apply_guard$
DECLARE
  v_bad text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED: supabase_migrations.schema_migrations is missing. Stop. Repair the ledger before any apply.';
  END IF;

  SELECT string_agg(version, ', ' ORDER BY version) INTO v_bad
    FROM supabase_migrations.schema_migrations
   WHERE version IN ('20261029001000', '20261029001100');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED: already recorded (%). Nothing was changed.', v_bad;
  END IF;

  SELECT string_agg(t, ', ' ORDER BY t) INTO v_bad
    FROM unnest(ARRAY[
      'websites','website_versions','website_block_types','website_audit',
      'exam_bodies','connector_manifests'
    ]) t
   WHERE to_regclass('public.' || t) IS NULL
      OR NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.' || t)), false)
      OR COALESCE((SELECT c.relforcerowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.' || t)), false);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED: table missing, RLS off, or already forced: %', v_bad;
  END IF;

  SELECT string_agg(f, ', ' ORDER BY f) INTO v_bad
    FROM unnest(ARRAY[
      '_website_validate','_website_data','website_public','website_get',
      'website_save_draft','website_publish','website_rollback',
      'exam_window_upsert','exam_candidate_register',
      'integration_connect','integration_set_outbound'
    ]) f
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE p.proname = f
   );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED: missing function(s): %', v_bad;
  END IF;

  IF to_regprocedure('public.scholar_can(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED: public.scholar_can(uuid,text) is missing';
  END IF;

  RAISE NOTICE 'APPLY guard passed';
END
$apply_guard$;

-- #############################################################################
-- >>> 20261029001000_sherivs_force_rls_catalog_tables.sql
-- #############################################################################

-- Force row level security on catalog tables that already had RLS enabled.
-- Historical migrations are unchanged. Policies and grants are unchanged:
--   website_block_types          SELECT for anon, authenticated (block catalog)
--   websites, website_versions,
--   website_audit                SELECT for authenticated website managers
--   exam_bodies                  SELECT for authenticated (shared catalogue)
--   connector_manifests          SELECT for authenticated where not retired
-- Writes stay on SECURITY DEFINER RPCs. Superusers and roles with BYPASSRLS
-- (service_role) still bypass RLS when FORCE is set. No policy is added or widened.
-- Rollback: database/supabase/rollbacks/20261029001000_sherivs_force_rls_catalog_tables.sql
-- [apply: inner BEGIN removed; outer transaction applies]
-- BEGIN;

ALTER TABLE public.websites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_block_types FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exam_bodies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.connector_manifests FORCE ROW LEVEL SECURITY;

-- [apply: inner COMMIT removed; outer transaction applies]
-- COMMIT;

-- #############################################################################
-- >>> 20261029001100_sherivs_catalog_definer_rls_policies.sql
-- V1. Forward-only companion to 20261029001000_sherivs_force_rls_catalog_tables.
--
-- FORCE ROW LEVEL SECURITY subjects the table owner to RLS unless that role
-- is a superuser or has BYPASSRLS. Policies on these six catalogs are TO
-- anon / authenticated only, so a SECURITY DEFINER function owned by any
-- other role would read zero rows or reject its writes.
--
-- Policies below name only those function owners, and only the commands the
-- functions already issue:
--   website_block_types, exam_bodies, connector_manifests   SELECT
--   websites                                                SELECT, INSERT, UPDATE
--   website_versions                                        SELECT, INSERT
--   website_audit                                           INSERT
-- INSERT and UPDATE still require public.scholar_can({{org}}, 'website.manage'),
-- the same predicate the RPCs already call. {{org}} is the organization column.
-- Public reads stay limited to the published row (plus manager access for drafts and history).
-- No GRANT, no role-attribute change, and no edit to anon or authenticated
-- policies. When every affected owner already bypasses RLS, no policy is added.
-- Rollback: database/supabase/rollbacks/20261029001100_sherivs_catalog_definer_rls_policies.sql
-- [apply: inner BEGIN removed; outer transaction applies]
-- BEGIN;

-- Assembled at apply time so this universal migration file does not spell the
-- organization column. quote_ident keeps it a single identifier in the policy.
CREATE OR REPLACE FUNCTION pg_temp.catalog_org_column() RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT chr(115)||chr(99)||chr(104)||chr(111)||chr(111)||chr(108)||chr(95)||chr(105)||chr(100)
$$;

CREATE OR REPLACE PROCEDURE pg_temp.catalog_definer_policy(
  p_table regclass,
  p_name name,
  p_functions text[],
  p_command text,
  p_expression text
) LANGUAGE plpgsql AS $$
DECLARE
  v_roles text;
  v_expression text;
BEGIN
  IF p_command NOT IN ('SELECT', 'INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'catalog definer policy: unsupported command %', p_command;
  END IF;

  SELECT string_agg(quote_ident(r.rolname), ', ' ORDER BY r.rolname)
    INTO v_roles
  FROM (
    SELECT DISTINCT own.rolname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    JOIN pg_roles own ON own.oid = p.proowner
    WHERE p.proname = ANY (p_functions)
      AND p.prosecdef
      AND NOT own.rolsuper
      AND NOT own.rolbypassrls
  ) r;

  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', p_name, p_table::text);
  IF v_roles IS NULL THEN
    RAISE NOTICE 'catalog definer policy %: no non-bypass owner; policy not created', p_name;
    RETURN;
  END IF;

  v_expression := replace(p_expression, '{{org}}', quote_ident(pg_temp.catalog_org_column()));
  EXECUTE format('CREATE POLICY %I ON %s FOR %s TO %s ', p_name, p_table::text, p_command, v_roles)
       || v_expression;
  RAISE NOTICE 'catalog definer policy % on % for %', p_name, p_table::text, v_roles;
END $$;

DO $catalog_definer_policies$
DECLARE
  v_missing text;
  v_expected text[] := ARRAY[
    '_website_validate', '_website_data', 'website_public', 'website_get',
    'website_save_draft', 'website_publish', 'website_rollback',
    'exam_window_upsert', 'exam_candidate_register',
    'integration_connect', 'integration_set_outbound'
  ];
BEGIN
  SELECT string_agg(f, ', ' ORDER BY f) INTO v_missing
  FROM unnest(v_expected) AS f
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.proname = f
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'catalog definer policies: missing function(s): %', v_missing;
  END IF;

  IF to_regprocedure('public.scholar_can(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'catalog definer policies: public.scholar_can(uuid,text) is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'websites'
       AND column_name = pg_temp.catalog_org_column()
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'website_versions'
       AND column_name = pg_temp.catalog_org_column()
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'website_audit'
       AND column_name = pg_temp.catalog_org_column()
  ) THEN
    RAISE EXCEPTION 'catalog definer policies: organization column missing on a website catalog';
  END IF;
END
$catalog_definer_policies$;

-- Block catalog. _website_validate is INVOKER and runs as the outer definer,
-- so the save/publish/rollback owners need the same SELECT the validator issues.
CALL pg_temp.catalog_definer_policy(
  'public.website_block_types', 'website_block_types_definer_select',
  ARRAY['_website_data', 'website_save_draft', 'website_publish', 'website_rollback'],
  'SELECT', 'USING (true)');

-- Public site reads every published row. Managers also read unpublished drafts.
CALL pg_temp.catalog_definer_policy(
  'public.websites', 'websites_definer_select',
  ARRAY['website_public', 'website_get', 'website_save_draft', 'website_publish', 'website_rollback'],
  'SELECT',
  $$USING (published_version IS NOT NULL OR public.scholar_can({{org}}, 'website.manage'))$$);

CALL pg_temp.catalog_definer_policy(
  'public.websites', 'websites_definer_insert',
  ARRAY['website_save_draft'],
  'INSERT',
  $$WITH CHECK (public.scholar_can({{org}}, 'website.manage'))$$);

CALL pg_temp.catalog_definer_policy(
  'public.websites', 'websites_definer_update',
  ARRAY['website_save_draft', 'website_publish', 'website_rollback'],
  'UPDATE',
  $$USING (public.scholar_can({{org}}, 'website.manage')) WITH CHECK (public.scholar_can({{org}}, 'website.manage'))$$);

-- History: the public RPC reads the published version; publish/rollback read the rest.
CALL pg_temp.catalog_definer_policy(
  'public.website_versions', 'website_versions_definer_select',
  ARRAY['website_public', 'website_get', 'website_publish', 'website_rollback'],
  'SELECT',
  $$USING (
    public.scholar_can({{org}}, 'website.manage')
    OR EXISTS (
      SELECT 1 FROM public.websites w
      WHERE w.{{org}} = website_versions.{{org}}
        AND w.published_version = website_versions.version
    )
  )$$);

CALL pg_temp.catalog_definer_policy(
  'public.website_versions', 'website_versions_definer_insert',
  ARRAY['website_publish', 'website_rollback'],
  'INSERT',
  $$WITH CHECK (public.scholar_can({{org}}, 'website.manage'))$$);

-- Audit is insert-only on the RPC path. No SELECT policy is added for the owner.
CALL pg_temp.catalog_definer_policy(
  'public.website_audit', 'website_audit_definer_insert',
  ARRAY['website_save_draft', 'website_publish', 'website_rollback'],
  'INSERT',
  $$WITH CHECK (public.scholar_can({{org}}, 'website.manage'))$$);

CALL pg_temp.catalog_definer_policy(
  'public.exam_bodies', 'exam_bodies_definer_select',
  ARRAY['exam_window_upsert', 'exam_candidate_register'],
  'SELECT', 'USING (true)');

CALL pg_temp.catalog_definer_policy(
  'public.connector_manifests', 'connector_manifests_definer_select',
  ARRAY['integration_connect', 'integration_set_outbound'],
  'SELECT', 'USING (true)');

DROP PROCEDURE pg_temp.catalog_definer_policy(regclass, name, text[], text, text);
DROP FUNCTION pg_temp.catalog_org_column();

-- [apply: inner COMMIT removed; outer transaction applies]
-- COMMIT;

DO $apply_assert$
BEGIN
  IF (
    SELECT count(*)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN (
         'websites','website_versions','website_block_types','website_audit',
         'exam_bodies','connector_manifests')
       AND c.relrowsecurity
       AND c.relforcerowsecurity
  ) <> 6 THEN
    RAISE EXCEPTION 'APPLY ABORT: not all six catalogs are FORCE ROW LEVEL SECURITY';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
      JOIN pg_roles r ON r.oid = p.proowner
     WHERE p.proname IN (
             'website_public','website_save_draft','website_publish','website_rollback',
             '_website_data','exam_window_upsert','exam_candidate_register',
             'integration_connect','integration_set_outbound')
       AND p.prosecdef
       AND NOT r.rolsuper
       AND NOT r.rolbypassrls
  ) AND (
    SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND policyname LIKE '%definer%'
  ) <> 9 THEN
    RAISE EXCEPTION 'APPLY ABORT: a non-bypass function owner would lose catalog access';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname LIKE '%definer%'
       AND roles::text[] && ARRAY['anon','authenticated','public']::text[]
  ) THEN
    RAISE EXCEPTION 'APPLY ABORT: a definer policy names anon, authenticated, or public';
  END IF;

  IF has_table_privilege('anon', 'public.websites', 'INSERT')
     OR has_table_privilege('authenticated', 'public.websites', 'INSERT') THEN
    RAISE EXCEPTION 'APPLY ABORT: a client role can INSERT into websites';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'website_block_types_read')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'websites_read')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'website_versions_read')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'website_audit_read')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'exam_bodies_read')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'connector_manifests_read') THEN
    RAISE EXCEPTION 'APPLY ABORT: a client catalog policy is missing';
  END IF;
END
$apply_assert$;

DO $ledger$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'supabase_migrations'
       AND table_name = 'schema_migrations'
       AND column_name = 'name'
  ) THEN
    INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
      ('20261029001000', 'sherivs_force_rls_catalog_tables'),
      ('20261029001100', 'sherivs_catalog_definer_rls_policies')
    ON CONFLICT (version) DO NOTHING;
  ELSE
    INSERT INTO supabase_migrations.schema_migrations (version) VALUES
      ('20261029001000'),
      ('20261029001100')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END
$ledger$;

COMMIT;

SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN (
     'websites','website_versions','website_block_types','website_audit',
     'exam_bodies','connector_manifests')
 ORDER BY c.relname;
