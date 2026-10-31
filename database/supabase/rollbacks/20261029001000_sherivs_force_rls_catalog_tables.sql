-- Rollback for 20261029001000_sherivs_force_rls_catalog_tables.sql
-- Returns these catalogs to RLS-enabled but not forced. Does not drop policies.
BEGIN;

ALTER TABLE public.websites NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_block_types NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_audit NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exam_bodies NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.connector_manifests NO FORCE ROW LEVEL SECURITY;

COMMIT;
