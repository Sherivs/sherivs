-- =============================================================================
-- CoreGrid — EXACT INVERSE ROLLBACK of 20261003000041 (TEAM T-D, post-R-wave)
-- =============================================================================
-- Restores public.transport_buses to the exact 20261002000014 zero-policy
-- deny-by-default posture (the strongest form): RLS enabled, NOT forced,
-- zero policies, zero client privileges for anon/authenticated/PUBLIC,
-- service_role unchanged, and the 20261002000014 posture COMMENT restored
-- verbatim. Every statement below is the strict inverse of one statement in
-- the forward migration, applied in reverse order.
--
-- NOTE (recorded, not hidden): after this rollback the driver assigned-bus
-- surface is unreachable for every client session again (the R1 finding
-- state) — the driver e2e case re-enters its typed skip naming
-- 20261002000014. This is the documented cost of the genuine inverse.
-- =============================================================================

-- Inverse of forward §5: restore the zero-policy posture comment verbatim.
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

-- Inverse of forward §4: the guard is procedural (no object created) — the
-- post-rollback verification below re-asserts the zero-policy invariant in
-- its strongest form instead.
DO $verify$
DECLARE
  v_policy_count integer;
  v_auth_privs   text;
  v_anon_privs   integer;
  v_unforced_ok  boolean;
BEGIN
  SELECT count(*) INTO v_policy_count
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'transport_buses';

  SELECT coalesce(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '')
    INTO v_auth_privs
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND table_name = 'transport_buses'
     AND grantee = 'authenticated';

  SELECT count(*) INTO v_anon_privs
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND table_name = 'transport_buses'
     AND grantee IN ('anon', 'public');

  SELECT c.relrowsecurity AND NOT c.relforcerowsecurity INTO v_unforced_ok
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'transport_buses';

  IF v_policy_count <> 0
     OR v_auth_privs IS DISTINCT FROM ''
     OR v_anon_privs <> 0
     OR v_unforced_ok IS NOT TRUE THEN
    RAISE EXCEPTION
      'ROLLBACK VIOLATION: public.transport_buses must return to the 20261002000014 zero-policy posture (zero policies, zero client privileges, RLS enabled and NOT forced); observed policies=% authenticated=[%] anon/public=% unforced_ok=% — investigate before proceeding',
      v_policy_count, v_auth_privs, v_anon_privs, v_unforced_ok;
  END IF;
END
$verify$;

-- Inverse of forward §3: drop the policy (the single policy the forward
-- migration authored).
DROP POLICY IF EXISTS transport_buses_select_driver_assigned
  ON public.transport_buses;

-- Inverse of forward §2: revoke the SELECT-only privilege — authenticated
-- returns to zero table privileges.
REVOKE SELECT ON TABLE public.transport_buses FROM authenticated;

-- Inverse of forward §1: un-force RLS (zero-policy convention: no policy
-- expression exists, so force cannot strengthen the denial).
ALTER TABLE public.transport_buses NO FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- End of rollback. Post-rollback verification (owned by the battery steward):
--   node scripts/verify-rls-isolation-battery.mjs
--     against scripts/verification/rls-table-postures-transport.json — NOTE
--     the posture file declares the policy-backed state, so a post-rollback
--     battery run reports FINDINGS for this table BY DESIGN (the posture file
--     documents the rollback's genuine-inverse contract).
-- =============================================================================