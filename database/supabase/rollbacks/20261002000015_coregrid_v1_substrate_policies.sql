-- =============================================================================
-- CoreGrid V1 — ROLLBACK for 20261002000015_coregrid_v1_substrate_policies.sql
-- =============================================================================
-- Status: AUTHORED (genuine inverse of the substrate policy migration; apply
--   only to undo the H2-04 batch-A/B policy posture — a security-posture
--   regression that requires explicit human authorization per governance law,
--   because it returns the four policy-backed tables toward deny-by-default
--   zero-policy and revokes authenticated client access).
--
-- Inverse of, in reverse order:
--   §4 COMMENT statements (comments are dropped implicitly with their
--      policies/tables — no-op to reverse beyond policy drops)
--   §3 policies (drop all eight — the exact policy inventory authored)
--   §2 table privileges (revoke authenticated SELECT/INSERT and the
--      service_role ALL grants, restoring the pre-migration grant state
--      authored by the source migrations: anon/authenticated revoked,
--      service_role silent)
--   §1 FORCE ROW LEVEL SECURITY (relforcerowsecurity back to false; RLS
--      stays ENABLED — the pre-migration deny-by-default posture is
--      re-established exactly: RLS on, zero policies, no client grants)
--
-- What this rollback deliberately does NOT touch: the four append-only audit
--   tables (cg_event_security_denial, cg_event_security_redaction,
--   cg_event_route_outcome, cg_evidence_lifecycle_act) and the twelve
--   out-of-scope tables were never altered by the migration — their
--   zero-policy deny-by-default posture is untouched by both directions.
-- =============================================================================

-- ── inverse of §3: drop the eight policies ──────────────────────────────────
DROP POLICY IF EXISTS reconciliation_input_select_own_tenant
  ON public.cg_reconciliation_input;
DROP POLICY IF EXISTS reconciliation_input_insert_tenant_admin
  ON public.cg_reconciliation_input;

DROP POLICY IF EXISTS event_route_subscription_select_own_tenant
  ON public.cg_event_route_subscription;
DROP POLICY IF EXISTS event_route_subscription_insert_tenant_admin
  ON public.cg_event_route_subscription;

DROP POLICY IF EXISTS evidence_record_select_own_tenant
  ON public.cg_evidence_record;
DROP POLICY IF EXISTS evidence_record_insert_tenant_admin
  ON public.cg_evidence_record;

DROP POLICY IF EXISTS usage_attribution_bucket_select_own_tenant
  ON public.cg_usage_attribution_bucket;
DROP POLICY IF EXISTS usage_attribution_bucket_insert_tenant_admin
  ON public.cg_usage_attribution_bucket;

-- ── inverse of §2: restore the pre-migration grant state ────────────────────
REVOKE SELECT, INSERT ON TABLE public.cg_reconciliation_input     FROM authenticated;
REVOKE SELECT, INSERT ON TABLE public.cg_event_route_subscription FROM authenticated;
REVOKE SELECT, INSERT ON TABLE public.cg_evidence_record          FROM authenticated;
REVOKE SELECT, INSERT ON TABLE public.cg_usage_attribution_bucket FROM authenticated;

REVOKE ALL ON TABLE public.cg_reconciliation_input     FROM service_role;
REVOKE ALL ON TABLE public.cg_event_route_subscription FROM service_role;
REVOKE ALL ON TABLE public.cg_evidence_record          FROM service_role;
REVOKE ALL ON TABLE public.cg_usage_attribution_bucket FROM service_role;

-- ── inverse of §1: unforce RLS (RLS remains ENABLED — deny-by-default) ──────
ALTER TABLE public.cg_reconciliation_input     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_event_route_subscription NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_evidence_record          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_usage_attribution_bucket NO FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- End of rollback. Post-rollback verification:
--   node scripts/verify-rls-isolation-battery.mjs — the four tables must
--   report the zero-policy strongest-form posture again (relforcerowsecurity
--   back to false, INFO for zero-policy tables), and every other table of the
--   eight batch-A/B families must be unchanged throughout.
-- =============================================================================