-- =============================================================================
-- CoreGrid V2 — ROLLBACK for
--   database/supabase/migrations/20261002000014_coregrid_v2_transport_buses_rls.sql
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED (genuine inverse of the normalization
--   migration; apply only to undo the declared zero-policy posture on
--   public.transport_buses — a security-posture regression that requires
--   explicit human authorization per governance law, because it re-creates
--   permissive policies built on the LEGACY domain helpers (the helper class
--   the J-005/J-006 law removes from the policy layer) and re-grants client
--   table privileges).
--
-- The restored state is the corrected legacy posture recorded by
--   database/supabase/migrations/20260904010000_coregrid_rls_transport_and_grants.sql
-- (NOT the pre-correction posture of 20260626150625 — the campus-wide
-- `buses_school_rw` FOR ALL policy stays dropped; re-creating it would
-- resurrect the originally recorded finding, which no rollback may do).
--
-- Honest battery note: the restored posture is OUTSIDE the battery's two
-- declared postures — policies exist but are built on legacy helpers, not
-- the J-005 neutral primitives. After a rollback the battery's zero-policy
-- section would report FINDINGS for this table by design; the battery
-- steward must be informed before any rollback is applied.
--
-- Inverse of, in reverse order:
--   §6 COMMENT (the table held no comment before the migration —
--     20260626150625 and 20260904010000 set none — so the declared-posture
--     comment is set to NULL)
--   §5 verification guard (a DO block; no persistent state to reverse)
--   §4/§3 privileges (authenticated client privileges restored exactly as
--     20260904010000 left them; anon/PUBLIC stay revoked, as they were)
--   §2 policies (the four 20260904010000 scoped policies re-created
--     verbatim; the legacy campus-wide FOR ALL policy stays dropped)
--   §1 RLS enable (idempotent no-op — the pre-migration state already held
--     RLS ENABLED; no row-security disablement statement is ever issued)
-- =============================================================================

-- ── inverse of §6: the pre-migration comment state (none) ───────────────────
COMMENT ON TABLE public.transport_buses IS NULL;

-- ── inverse of §2: re-create the pre-migration policy set (20260904010000
--    verbatim). The legacy buses_school_rw FOR ALL policy stays dropped. ─────
DROP POLICY IF EXISTS buses_school_read ON public.transport_buses;
DROP POLICY IF EXISTS buses_driver_or_admin_update ON public.transport_buses;
DROP POLICY IF EXISTS buses_school_admin_insert ON public.transport_buses;
DROP POLICY IF EXISTS buses_school_admin_delete ON public.transport_buses;

CREATE POLICY buses_school_read ON public.transport_buses
  FOR SELECT
  USING ((school_id = public.get_my_school_id()) OR public.is_super_admin());

CREATE POLICY buses_driver_or_admin_update ON public.transport_buses
  FOR UPDATE
  USING (
    ((school_id = public.get_my_school_id())
      AND ((driver_id = auth.uid()) OR public.is_school_admin()))
    OR public.is_super_admin()
  )
  WITH CHECK (
    ((school_id = public.get_my_school_id())
      AND ((driver_id = auth.uid()) OR public.is_school_admin()))
    OR public.is_super_admin()
  );

CREATE POLICY buses_school_admin_insert ON public.transport_buses
  FOR INSERT
  WITH CHECK (
    ((school_id = public.get_my_school_id()) AND public.is_school_admin())
    OR public.is_super_admin()
  );

CREATE POLICY buses_school_admin_delete ON public.transport_buses
  FOR DELETE
  USING (
    ((school_id = public.get_my_school_id()) AND public.is_school_admin())
    OR public.is_super_admin()
  );

-- ── inverse of §3/§4: restore the pre-migration grant state
--    (20260904010000 posture: authenticated client access, service_role ALL,
--    anon/PUBLIC none — as recorded, not widened) ─────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_buses TO authenticated;
GRANT ALL ON public.transport_buses TO service_role;

-- ── inverse of §1: RLS remains ENABLED (pre-migration state) ────────────────
ALTER TABLE public.transport_buses ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- End of rollback. Post-rollback state (recorded, for the battery steward):
--   public.transport_buses: RLS ENABLED, relforcerowsecurity=false, exactly
--   the four scoped legacy-helper policies above, authenticated =
--   SELECT/INSERT/UPDATE/DELETE, service_role = ALL, anon/PUBLIC = none.
--   This posture is outside the battery's dual-posture model — expect
--   FINDINGS from the zero-policy section, by design of the regression.
-- =============================================================================
