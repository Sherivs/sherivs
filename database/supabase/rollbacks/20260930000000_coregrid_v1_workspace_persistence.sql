-- =============================================================================
-- Rollback: 20260930000000_coregrid_v1_workspace_persistence.sql
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — destroys workspace persistence history. For retiring
-- the schema, not for undoing single executions (matches the foundation-001
-- rollback discipline).
-- =============================================================================

DROP TABLE IF EXISTS public.cg_workspace_member;
DROP TABLE IF EXISTS public.cg_workspace;
