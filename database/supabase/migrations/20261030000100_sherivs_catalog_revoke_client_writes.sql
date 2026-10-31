-- V1. Remove direct client writes from the website catalog tables.
-- Catalog writes continue through the existing SECURITY DEFINER RPCs.
-- REVOKE is idempotent and leaves SELECT privileges unchanged.
-- Rollback: database/supabase/rollbacks/20261030000100_sherivs_catalog_revoke_client_writes.sql
BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.websites FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.website_versions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.website_audit FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.website_block_types FROM anon, authenticated;

COMMIT;
