-- =============================================================================
-- Rollback for 20261007000050_coregrid_org_communication_sender.sql
-- (PLATFORM-019, DECISIONS.md #210)
--
-- Drops the organization communication sender identity table and its
-- indexes. Additive only — touches no other object. Re-running the forward
-- migration recreates the table empty (identities are re-declared, never
-- silently restored).
-- =============================================================================

DROP INDEX IF EXISTS public.cg_org_communication_sender_tenant_org_idx;
DROP INDEX IF EXISTS public.cg_org_communication_sender_active_unique;
DROP TABLE IF EXISTS public.cg_org_communication_sender;