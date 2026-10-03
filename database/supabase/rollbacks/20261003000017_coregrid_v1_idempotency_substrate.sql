-- =============================================================================
-- Rollback: 20261003000017_coregrid_v1_idempotency_substrate.sql (H3-028)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the durable idempotency substrate. After
-- rollback, recorded idempotent outcomes are unrecoverable: a retry after a
-- process restart re-executes instead of replaying (exactly-once survives
-- only in-process, via the in-memory reference store), and the prune function
-- disappears with its table. For retiring the substrate, not for routine
-- operations (matches the memory-tier / worker-definitions rollback
-- discipline).
--
-- Rollback order matters: the prune function depends on the table it deletes
-- from, so the function is dropped BEFORE the table. Policies and grants are
-- bound to the table and vanish with the DROP; they are stated as explicit
-- IF EXISTS drops/revoke/no-force steps first so the inverse is legible and
-- idempotent under partial states. Nothing else in the substrate references
-- this table; no RPC bodies need restoring (the migration is table-authoring
-- only, redefinition-free).
-- =============================================================================

-- ── inverse of §2 (function grants) + §2 function: drop the prune path ───────
REVOKE ALL ON FUNCTION public.cg_prune_expired_idempotency_records(timestamptz, integer) FROM service_role;
DROP FUNCTION IF EXISTS public.cg_prune_expired_idempotency_records(timestamptz, integer);

-- ── inverse of §5: drop the three policies (legibility; implicit in the drop)
DROP POLICY IF EXISTS idempotency_record_select_own_tenant
  ON public.cg_idempotency_record;
DROP POLICY IF EXISTS idempotency_record_insert_tenant_admin
  ON public.cg_idempotency_record;
DROP POLICY IF EXISTS idempotency_record_replace_expired
  ON public.cg_idempotency_record;

-- ── inverse of §4: restore the pre-migration grant state ────────────────────
REVOKE SELECT, INSERT, UPDATE ON TABLE public.cg_idempotency_record FROM authenticated;
REVOKE ALL ON TABLE public.cg_idempotency_record FROM service_role;

-- ── inverse of §3: unforce RLS (RLS remains ENABLED — deny-by-default) ──────
ALTER TABLE public.cg_idempotency_record NO FORCE ROW LEVEL SECURITY;

-- ── inverse of §1: drop the substrate (indexes, constraints and comments
--    are bound to the table and vanish with it) ──────────────────────────────
DROP TABLE IF EXISTS public.cg_idempotency_record;

-- =============================================================================
-- End of rollback. Post-rollback verification:
--   node scripts/verify-rls-isolation-battery.mjs — cg_idempotency_record
--   must be absent from the substrate inventory entirely, and every other
--   table must be unchanged throughout.
-- =============================================================================
