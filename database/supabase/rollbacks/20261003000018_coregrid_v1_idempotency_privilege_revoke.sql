-- =============================================================================
-- Rollback of 20261003000018_coregrid_v1_idempotency_privilege_revoke.sql
-- (H3-000 battery finding — idempotency substrate privilege correction)
-- =============================================================================
-- GENUINE INVERSE: the corrective migration's only durable effects are the
-- privilege grants below (a REVOKE leaves no catalog object to remove — its
-- inverse is the state the project's ALTER DEFAULT PRIVILEGES would grant a
-- new table, which is exactly what re-asserting ALL restores). Running this
-- returns cg_idempotency_record to the pre-correction (defective) privilege
-- posture: broad client privileges beneath the RLS policy layer.
--
-- NEVER run outside a coordinator-authorized rollback drill; the defective
-- posture weakens defense-in-depth (AGENTS §17) but NOT the row gate (the
-- RLS policies are the operative boundary and remain FORCEd).
-- =============================================================================

GRANT ALL ON TABLE public.cg_idempotency_record TO anon, authenticated;

-- =============================================================================
-- End of rollback. The declared posture after this rollback matches the live
-- catalog state the 2026-10-03 battery run found (anon/authenticated: ALL).
-- =============================================================================
