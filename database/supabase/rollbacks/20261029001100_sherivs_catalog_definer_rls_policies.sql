-- Rollback for 20261029001100_sherivs_catalog_definer_rls_policies.sql
-- Drops only the definer policies. Does not change FORCE, client policies, or grants.
BEGIN;

DROP POLICY IF EXISTS website_block_types_definer_select ON public.website_block_types;
DROP POLICY IF EXISTS websites_definer_select ON public.websites;
DROP POLICY IF EXISTS websites_definer_insert ON public.websites;
DROP POLICY IF EXISTS websites_definer_update ON public.websites;
DROP POLICY IF EXISTS website_versions_definer_select ON public.website_versions;
DROP POLICY IF EXISTS website_versions_definer_insert ON public.website_versions;
DROP POLICY IF EXISTS website_audit_definer_insert ON public.website_audit;
DROP POLICY IF EXISTS exam_bodies_definer_select ON public.exam_bodies;
DROP POLICY IF EXISTS connector_manifests_definer_select ON public.connector_manifests;

COMMIT;
