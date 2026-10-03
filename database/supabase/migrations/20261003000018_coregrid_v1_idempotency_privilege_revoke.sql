-- =============================================================================
-- CoreGrid V1 — idempotency substrate privilege correction (H3-000, battery finding)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only via the coordinator's serialized canonical apply
-- (scripts/apply-canonical-hardening.mjs). Rollback (genuine inverse):
--   database/supabase/rollbacks/20261003000018_coregrid_v1_idempotency_privilege_revoke.sql
--
-- Authority:
--   Live RLS isolation battery run 2026-10-03, finding
--   cg_idempotency_record / privileges: PRIVILEGE_POSTURE_MISMATCH —
--   anon and authenticated held ALL table privileges (DELETE, INSERT,
--   REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE) because this project
--   carries broad ALTER DEFAULT PRIVILEGES on public tables and migration
--   20261003000017 omitted the table-level REVOKE that its own comment
--   ("anon stays revoked (zero privileges, zero policy grants)") claims and
--   that every exemplar (20261003000016 §3, 20261002000013, 20261002000015)
--   performs. RLS policies still gated every row (the battery's cross-tenant
--   probes PASSED — policies are the operative gate), but the DECLARED
--   privilege posture (defense-in-depth: least privilege beneath the policy
--   layer) did not hold. The already-applied, checksum-bound migration is
--   never edited; this corrective migration restores the declared posture.
--
--   AGENTS.md §17 (RLS mandatory; application code is never the only security
--   layer — privileges are the second layer), §26 (never trust the client),
--   §28 (no client DELETE path may erase a recorded outcome).
--
-- Intended end state (identical to the 20261003000017 header's declaration):
--   anon:           zero privileges
--   authenticated:  exactly SELECT + INSERT + UPDATE (policy-gated)
--   service_role:   ALL (sanctioned bypass-path parity grant)
--
-- Idempotency: REVOKE ALL is absolute (not a delta), so re-running is a
-- no-op; the GRANT statements are the declared posture re-asserted.
-- =============================================================================

-- 1. Deny-by-default base posture (defense-in-depth beneath the RLS policies).
REVOKE ALL ON public.cg_idempotency_record FROM anon, authenticated;

-- 2. Re-assert the declared client grant: exactly the policy-gated commands
--    (no DELETE — recorded outcomes are immutable within their TTL; the only
--    deletion surface is the service-role-only SECURITY DEFINER prune).
GRANT SELECT, INSERT, UPDATE ON TABLE public.cg_idempotency_record TO authenticated;

-- 3. Service-role bypass-path parity grant (idempotent re-assertion of the
--    20261003000017 grant).
GRANT ALL ON TABLE public.cg_idempotency_record TO service_role;

-- =============================================================================
-- End of migration. Post-apply verification: re-run
--   node scripts/verify-rls-isolation-battery.mjs
-- — the privileges stage must report the declared posture (anon: [],
-- authenticated: [SELECT, INSERT, UPDATE]) and the verdict must be PASS.
-- =============================================================================
