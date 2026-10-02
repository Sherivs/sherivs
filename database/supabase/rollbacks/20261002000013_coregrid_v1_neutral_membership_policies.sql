-- =============================================================================
-- CoreGrid V1 — ROLLBACK for 20261002000013_coregrid_v1_neutral_membership_policies.sql
-- =============================================================================
-- Status: AUTHORED (genuine inverse of the policy migration; apply only to
--   undo the neutral tenant-membership policy posture — a security-posture
--   regression that requires explicit human authorization per governance law,
--   because it returns these tables toward deny-by-default zero-policy and
--   revokes authenticated client access).
--
-- Inverse of, in reverse order:
--   §4 COMMENT statements (comments are dropped implicitly with their
--      policies/tables — no-op to reverse beyond policy drops)
--   §3 policies (drop all nine)
--   §2 table privileges (revoke authenticated + the service_role parity
--      grant on cg_org_membership, restoring the pre-migration grant state)
--   §1 FORCE ROW LEVEL SECURITY (relforcerowsecurity back to false; RLS
--      stays ENABLED — the pre-migration deny-by-default posture is
--      re-established exactly: RLS on, zero policies, no client grants)
-- =============================================================================

-- ── inverse of §3: drop the nine policies ───────────────────────────────────
DROP POLICY IF EXISTS role_assignment_select_own_tenant  ON public.cg_role_assignment;
DROP POLICY IF EXISTS role_assignment_insert_tenant_admin ON public.cg_role_assignment;
DROP POLICY IF EXISTS role_assignment_update_tenant_admin ON public.cg_role_assignment;

DROP POLICY IF EXISTS role_grant_select_own_tenant  ON public.cg_role_grant;
DROP POLICY IF EXISTS role_grant_insert_tenant_admin ON public.cg_role_grant;
DROP POLICY IF EXISTS role_grant_update_tenant_admin ON public.cg_role_grant;

DROP POLICY IF EXISTS org_membership_select_own_tenant  ON public.cg_org_membership;
DROP POLICY IF EXISTS org_membership_insert_tenant_admin ON public.cg_org_membership;
DROP POLICY IF EXISTS org_membership_update_tenant_admin ON public.cg_org_membership;

-- ── inverse of §2: restore the pre-migration grant state ────────────────────
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.cg_role_assignment FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.cg_role_grant      FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.cg_org_membership  FROM authenticated;
REVOKE ALL ON TABLE public.cg_org_membership FROM service_role;

-- ── inverse of §1: unforce RLS (RLS remains ENABLED — deny-by-default) ─────
ALTER TABLE public.cg_role_assignment NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_role_grant      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_org_membership  NO FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- End of rollback. Post-rollback verification:
--   node scripts/verify-rls-isolation-battery.mjs — the three tables must
--   report the zero-policy strongest-form posture again (relforcerowsecurity
--   back to false, INFO for zero-policy tables).
-- =============================================================================
