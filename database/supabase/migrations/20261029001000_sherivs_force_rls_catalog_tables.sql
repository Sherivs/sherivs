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
BEGIN;

ALTER TABLE public.websites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_block_types FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exam_bodies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.connector_manifests FORCE ROW LEVEL SECURITY;

COMMIT;
