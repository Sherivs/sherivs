-- Rollback for 20261022000190_sherivs_012_credential_vault.sql (NOT APPLIED).
-- WARNING: dropping org_credentials destroys stored school credentials; export
-- and re-provision them first.
BEGIN;
DROP VIEW IF EXISTS public.org_credential_inventory;
DROP TABLE IF EXISTS public.credential_access_log;
DROP FUNCTION IF EXISTS public.credential_access_log_append_only();
DROP TABLE IF EXISTS public.credential_grants;
DROP TABLE IF EXISTS public.org_credentials;
COMMIT;
