-- =============================================================================
-- CoreGrid V1 — ROLLBACK for 20261003000016_coregrid_v1_file_substrate.sql
-- =============================================================================
-- Status: AUTHORED (genuine inverse of the file-substrate migration; apply
--   only to undo the V1 file-plane substrate — a security-posture regression
--   that requires explicit human authorization per governance law, because
--   it removes the database-level tenant boundary that THREAT_MITIGATIONS_
--   LT.md L-T-011 records as the closure of the file-plane path-escape
--   finding, and revokes authenticated client access to the file plane).
--
-- Naming-convention note: the repository stores rollback files in
--   database/supabase/rollbacks/ under the migration's own basename (see the
--   existing rollbacks for 20261002000001..20261002000015) — no `.rollback`
--   infix, and not inside migrations/ itself.
--
-- Inverse of, in reverse order:
--   §4 policies (drop all three)
--   §3 table privileges (revoke authenticated + the service_role parity
--      grant, restoring the pre-migration deny-by-privilege state)
--   §2 FORCE ROW LEVEL SECURITY (relforcerowsecurity back to false)
--   §1 the table itself (the migration CREATED cg_file_object — its genuine
--      inverse DROPS it, indexes and column comments with it; the staged
--      drops above exist so a partial rollback can stop short of losing the
--      data and return the table to its exact pre-policy zero-policy
--      deny-by-default posture)
-- =============================================================================

-- ── inverse of §4: drop the three policies ──────────────────────────────────
DROP POLICY IF EXISTS file_object_select_own_tenant ON public.cg_file_object;
DROP POLICY IF EXISTS file_object_insert_own_tenant ON public.cg_file_object;
DROP POLICY IF EXISTS file_object_update_own_tenant ON public.cg_file_object;

-- ── inverse of §3: restore the pre-migration grant state ────────────────────
REVOKE SELECT, INSERT, UPDATE ON TABLE public.cg_file_object FROM authenticated;
REVOKE ALL ON TABLE public.cg_file_object FROM service_role;
REVOKE ALL ON public.cg_file_object FROM anon, authenticated;

-- ── inverse of §2: unforce RLS (RLS remains ENABLED — deny-by-default) ──────
ALTER TABLE public.cg_file_object NO FORCE ROW LEVEL SECURITY;

-- ── inverse of §1: drop the substrate table (data-losing step) ──────────────
-- Genuine inverse: the migration created the table; undoing it removes the
-- table, its indexes and its comments. Run ONLY with explicit authorization
-- and a recorded reason (the descriptor rows are system truth for the file
-- plane; their loss orphans the storage objects' metadata).
DROP TABLE IF EXISTS public.cg_file_object;

-- =============================================================================
-- End of rollback. Post-rollback verification:
--   node scripts/verify-rls-isolation-battery.mjs — cg_file_object must no
--   longer exist (or, if the staged inverse alone was applied, must report
--   the zero-policy strongest-form posture again: relforcerowsecurity back
--   to false, INFO for zero-policy tables, anon/authenticated revoked).
-- =============================================================================