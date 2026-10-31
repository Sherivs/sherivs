-- =============================================================================
-- ROLLBACK of the combined apply (FORCE + definer policies + ledger rows).
-- Paste only if verify.sql is not all true, or a smoke test fails.
-- One transaction. Does not drop client policies, grants, or table data.
--
-- The NO FORCE statements are the existing rollback:
--   database/supabase/rollbacks/20261029001000_sherivs_force_rls_catalog_tables.sql
-- The DROP POLICY statements are:
--   database/supabase/rollbacks/20261029001100_sherivs_catalog_definer_rls_policies.sql
-- =============================================================================
SET default_transaction_read_only = off;

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- [rollback: inner BEGIN removed; outer transaction applies]
-- BEGIN;
ALTER TABLE public.websites NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_block_types NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_audit NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exam_bodies NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.connector_manifests NO FORCE ROW LEVEL SECURITY;
-- [rollback: inner COMMIT removed; outer transaction applies]
-- COMMIT;

-- [rollback: inner BEGIN removed; outer transaction applies]
-- BEGIN;
DROP POLICY IF EXISTS website_block_types_definer_select ON public.website_block_types;
DROP POLICY IF EXISTS websites_definer_select ON public.websites;
DROP POLICY IF EXISTS websites_definer_insert ON public.websites;
DROP POLICY IF EXISTS websites_definer_update ON public.websites;
DROP POLICY IF EXISTS website_versions_definer_select ON public.website_versions;
DROP POLICY IF EXISTS website_versions_definer_insert ON public.website_versions;
DROP POLICY IF EXISTS website_audit_definer_insert ON public.website_audit;
DROP POLICY IF EXISTS exam_bodies_definer_select ON public.exam_bodies;
DROP POLICY IF EXISTS connector_manifests_definer_select ON public.connector_manifests;
-- [rollback: inner COMMIT removed; outer transaction applies]
-- COMMIT;

DELETE FROM supabase_migrations.schema_migrations
 WHERE version IN ('20261029001000', '20261029001100');

DO $rollback_assert$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN (
         'websites','website_versions','website_block_types','website_audit',
         'exam_bodies','connector_manifests')
       AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'ROLLBACK ABORT: a catalog is still FORCE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND policyname LIKE '%definer%'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK ABORT: a definer policy is still present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
     WHERE version IN ('20261029001000', '20261029001100')
  ) THEN
    RAISE EXCEPTION 'ROLLBACK ABORT: ledger row still present';
  END IF;
END
$rollback_assert$;

COMMIT;
