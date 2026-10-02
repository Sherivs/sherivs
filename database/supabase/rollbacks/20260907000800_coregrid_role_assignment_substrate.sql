-- =============================================================================
-- Rollback: 20260907000800_coregrid_role_assignment_substrate.sql
-- Status: AUTHORED (companion rollback for the canonical apply, MISSION-R-100).
-- WARNING: destructive — destroys the role-assignment substrate (assignments,
-- capability grants and their RPC surface). For retiring the schema, not for
-- undoing single executions (matches the foundation-001 rollback discipline).
-- =============================================================================

DROP FUNCTION IF EXISTS public.revoke_role_capability(uuid);
DROP FUNCTION IF EXISTS public.grant_role_capability(uuid, text, text);
DROP FUNCTION IF EXISTS public.list_role_grants(uuid);
DROP FUNCTION IF EXISTS public.end_role_assignment(uuid);
DROP FUNCTION IF EXISTS public.assign_role(uuid, uuid, text, date, date);
DROP FUNCTION IF EXISTS public.list_role_assignments(uuid);

DROP TABLE IF EXISTS public.cg_role_grant;
DROP TABLE IF EXISTS public.cg_role_assignment;
