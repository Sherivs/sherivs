-- =============================================================================
-- Rollback of 20261003000030_coregrid_hermes_observation_substrate.sql
-- (V1 wave R4 / HERMES-PORT — Hermes observation substrate: cg_hermes_observation)
-- =============================================================================
-- GENUINE INVERSE: the migration creates one table, four indexes (including
-- the partial unique event-consumption index), one guard function and one
-- trigger, one RLS enablement, one REVOKE and one GRANT. Its inverse drops
-- the trigger and table (dropping the table removes its indexes and RLS
-- properties as catalog consequences of the table itself), then drops the
-- guard function, and re-asserts the pre-migration DEFAULT PRIVILEGES grants
-- the project's ALTER DEFAULT PRIVILEGES confers on new public tables (the
-- same restoration posture as the 20261003000019 rollback), so the inverse
-- is exact.
--
-- ROLLBACK PLAN (Constitution §38):
--   1. quiesce the Hermes wiring (no hermes observation port / event source
--      instance may be mid-write; the DB adapter fails closed once the table
--      is absent, writing nothing);
--   2. run this file in one transaction;
--   3. verify: the table, trigger and function are absent; no other cg_*
--      substrate is touched.
-- DATA NOTE: dropping cg_hermes_observation discards recorded OBSERVATIONS —
-- derived intelligence only (§9). No canonical truth is lost: the state of
-- record (cg_execution_record, cg_worker_definition, cg_foundation_evidence,
-- cg_verification_result, cg_event) is untouched, and every observation's
-- subject_ref remains resolvable against it.
-- =============================================================================

BEGIN;

DROP TRIGGER IF EXISTS cg_hermes_observation_no_rewrite ON public.cg_hermes_observation;
DROP TABLE IF EXISTS public.cg_hermes_observation;
DROP FUNCTION IF EXISTS public.cg_hermes_observation_append_only();

-- Restore the pre-migration privilege posture: the project's ALTER DEFAULT
-- PRIVILEGES confers ALL on new public tables to anon/authenticated (the
-- defective-but-real state the 20261003000018/20261003000019 rollbacks
-- document); the inverse of this migration's REVOKE re-asserts exactly that.
GRANT ALL ON TABLE public.cg_hermes_observation TO anon, authenticated;

COMMIT;

-- Component: database/supabase/rollbacks/20261003000030_coregrid_hermes_observation_substrate.sql
-- Owner: V1 remediation wave team R4 (HERMES-PORT) — Hermes observation port + event wiring
