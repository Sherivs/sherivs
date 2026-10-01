-- =============================================================================
-- Rollback: 20261001000000_coregrid_v1_org_model.sql (MISSION-V1-006)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — destroys organization structure and membership
-- history. For retiring the schema, not for undoing single executions
-- (matches the foundation-001 / workspace-persistence rollback discipline).
-- =============================================================================

DROP TABLE IF EXISTS public.cg_org_membership;
DROP TABLE IF EXISTS public.cg_org_unit;
