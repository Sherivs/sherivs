-- =============================================================================
-- Rollback for 20261007000051_coregrid_api_key_substrate.sql
-- (PLATFORM-019, DECISIONS.md #210)
--
-- Drops the platform API-key substrate table and its index. Additive only —
-- touches no other object. Re-running the forward migration recreates the
-- table empty (keys are re-issued; hashes are never restorable).
-- =============================================================================

DROP INDEX IF EXISTS public.cg_api_key_tenant_status_idx;
DROP TABLE IF EXISTS public.cg_api_key;