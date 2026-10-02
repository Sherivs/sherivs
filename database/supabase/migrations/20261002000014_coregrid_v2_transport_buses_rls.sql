-- =============================================================================
-- CoreGrid V2 — transport fleet table RLS re-verify + normalization +
-- declared posture (MISSION H2-03, driver-family substrate)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000014_coregrid_v2_transport_buses_rls.sql
--
-- Authority:
--   AGENTS.md §17 (PostgreSQL row level security is mandatory for
--     tenant-sensitive data; application code is never the only security
--     layer), §28 (database law: prefer RLS and revocable grants over
--     application logic), §31 (revoked/expired access fails; agents cannot
--     exceed permissions), §22 (repository discovery — schema source
--     inspected, cited below, never assumed);
--   RULING-2 (deny-by-default posture approved);
--   architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md
--     — the dual-posture model (§7: zero-policy deny-by-default |
--     policy-backed tenant-scoped), whose §2 note reserves the force-RLS
--     re-evaluation for the moment tenant-scoped policies are authored;
--   The queued re-verify finding, recorded in
--     tests/unit/p08-enforcement-surface.test.ts (DOCUMENTED_EXEMPT ledger)
--     and tests/unit/*-invariant-self-scope.test.ts (findings arrays):
--     the fleet-table policy was campus-wide rather than operator-scoped,
--     database re-verify queued. The verbatim finding strings live in those
--     two test files; they are paraphrased here (this file is scanned by the
--     shrink-only domain-neutrality guard and may not reproduce legacy
--     helper or column vocabulary — see "why zero-policy" below).
--
-- Schema source (inspected, not assumed):
--   public.transport_buses is defined by the LEGACY migration
--     database/supabase/migrations/20260626150625_35a08443-45fd-46ae-807b-3644b44efe26.sql
--     (CREATE TABLE, ENABLE ROW LEVEL SECURITY, the campus-wide
--     `buses_school_rw` FOR ALL policy, authenticated client grants, and the
--     supabase_realtime publication entry), then corrected by
--     database/supabase/migrations/20260904010000_coregrid_rls_transport_and_grants.sql
--     (the FOR ALL policy replaced by four scoped policies;
--     TRUNCATE/TRIGGER/REFERENCES revoked from client roles).
--
-- Scope — exactly the one bus table the driver families read:
--   public.transport_buses  →  declared posture: ZERO-POLICY
--     (deny-by-default, the RLS_ISOLATION_BATTERY.md strongest form).
--   No other transport table is in scope: the driver families
--   (frontend/src/lib/runtime/*-tracking.functions.ts and
--   *-portal.functions.ts) read and write exactly this table.
--   public.school_transport is the payments/config family's table, holds its
--   own product-decision anon-read policy, and is NOT touched here.
--
-- Why ZERO-POLICY and not tenant-scoped policies (the honest trade-off):
--   1. The only row-scoping column available on this legacy table is the
--      campus scoping column, and the only predicates available to express
--      row visibility with it are the LEGACY domain helpers (20260904010000)
--      — exactly the helper class the J-005/J-006 law removes from the
--      policy layer, and the class the domain-neutrality guard can never
--      re-admit into new migration SQL (shrink-only baseline).
--   2. The table carries no neutral tenant reference, so the J-005 neutral
--      primitives (get_my_tenant_id / is_tenant_admin, the
--      20261002000013 pattern) cannot gate its rows without a substrate
--      conversion owned by another mission.
--   3. Deny-by-default is the approved platform posture (RULING-2) and
--      resolves the queued re-verify finding in its STRONGEST form: no
--      policy exists, so no policy can be campus-wide. The battery's
--      zero-policy proof (§1 sections a–d) is the exact expected verification.
--
-- Consumer impact (stated, not hidden):
--   After this migration every client-role read/write on this table through
--   the REST data plane DENIES — operator self-scoped reads, live location
--   pushes, and caregiver tracking return zero rows — until the owning
--   mission re-provisions access through neutral tenant-scoped policies (the
--   20261002000013 pattern) or a dedicated substrate conversion. Server-only
--   paths through the sanctioned service role are unaffected, and realtime
--   subscribers see the same denial (row visibility follows RLS). This is
--   the same declared interim posture held by cg_org_unit and the other
--   zero-policy substrate tables (RLS_ISOLATION_BATTERY.md §7 matrix).
--
-- Force-RLS note (battery §2 INFO convention):
--   relforcerowsecurity is intentionally left FALSE: on the zero-policy
--   posture no policy expression exists, so forcing cannot strengthen the
--   denial (the battery reports force=false as INFO for zero-policy tables).
--   A future policy-backed conversion MUST add FORCE in the same migration
--   that authors its policies (the 20261002000013 exemplar).
--
-- Provenance (AGENTS §12):
--   This migration records observed schema history and normalizes it; it
--   invents no data, filters no provenance column, and touches no audit
--   record. Erasure and retention behavior are untouched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Verify: RLS stays ENABLED (idempotent re-assert of the legacy substrate's
--    own posture — the table has held RLS since 20260626150625).
-- -----------------------------------------------------------------------------
ALTER TABLE public.transport_buses ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. Normalize: drop EVERY permissive policy this table is known to have
--    carried — the legacy campus-wide FOR ALL policy (20260626150625) and
--    the four corrected scoped policies (20260904010000). IF EXISTS keeps
--    this idempotent across environments regardless of which correction
--    wave reached them.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS buses_school_rw              ON public.transport_buses;
DROP POLICY IF EXISTS buses_school_read            ON public.transport_buses;
DROP POLICY IF EXISTS buses_driver_or_admin_update ON public.transport_buses;
DROP POLICY IF EXISTS buses_school_admin_insert    ON public.transport_buses;
DROP POLICY IF EXISTS buses_school_admin_delete    ON public.transport_buses;

-- -----------------------------------------------------------------------------
-- 3. Normalize privileges: zero table privileges for every client role
--    (the battery's section (c) expectation; supersedes the partial
--    TRUNCATE/TRIGGER/REFERENCES revocation of 20260904010000).
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.transport_buses FROM anon;
REVOKE ALL ON public.transport_buses FROM authenticated;
REVOKE ALL ON public.transport_buses FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 4. The sanctioned server-only bypass path keeps full table privilege —
--    the only data path left (explicit, logged, never a client role).
-- -----------------------------------------------------------------------------
GRANT ALL ON TABLE public.transport_buses TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Verification guard: the apply FAILS LOUDLY if any permissive policy
--    survived normalization — the declared zero-policy posture must be
--    exact, not assumed.
-- -----------------------------------------------------------------------------
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transport_buses'
  ) THEN
    RAISE EXCEPTION
      'POSTURE VIOLATION: public.transport_buses must hold zero policies after 20261002000014 normalization; a permissive policy survived — investigate before proceeding';
  END IF;
END
$verify$;

-- -----------------------------------------------------------------------------
-- 6. Declared posture (machine-readable audit string, dollar-quoted; the
--    exemplar shape of 20261002000013 §4).
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.transport_buses IS
  $comment$Posture declared by 20261002000014 (MISSION H2-03): ZERO-POLICY
  deny-by-default, the RLS_ISOLATION_BATTERY.md strongest form — row level
  security ENABLED, zero policies of any kind, zero table privileges for
  anon / authenticated / PUBLIC; the sanctioned service role retains full
  table privilege as the only data path (server-only, explicit, logged).
  Every client read/write through REST denies until neutral tenant-scoped
  policies are authored by the owning mission (the J-005/J-006 pattern of
  20261002000013). This resolves the queued re-verify finding
  (p08-enforcement-surface DOCUMENTED_EXEMPT ledger) in its strongest form:
  no policy exists, so no policy can be campus-wide. Realtime subscribers
  on the supabase_realtime publication see the same denial. Rollback:
  database/supabase/rollbacks/20261002000014_coregrid_v2_transport_buses_rls.sql.$comment$;

-- =============================================================================
-- End of migration. Post-apply verification (owned by the battery steward —
-- this migration runs no live probe itself):
--   node scripts/verify-rls-isolation-battery.mjs
--     adopting scripts/verification/rls-table-postures-transport.json as the
--     declarative expected state for public.transport_buses (zero-policy
--     posture: relrowsecurity=true, zero policies, zero client grants, anon
--     REST denied; relforcerowsecurity=false reported INFO).
-- =============================================================================
