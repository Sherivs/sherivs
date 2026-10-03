-- =============================================================================
-- Rollback of 20261003000031_coregrid_delivery_evidence.sql
-- (R6 — delivery-evidence substrate: cg_delivery_evidence)
-- =============================================================================
-- GENUINE INVERSE: the migration creates one table, its three indexes, one
-- guard function and one trigger, one RLS enablement and one privilege
-- revocation. Its inverse drops the trigger, the function and the table —
-- DROP TABLE removes the indexes and RLS properties as catalog consequences
-- of the table itself. The re-asserted GRANT below restores the pre-migration
-- privilege state the project's ALTER DEFAULT PRIVILEGES confers on new
-- public tables (the posture 20261003000018 documents; same restoration
-- pattern as the 20261003000019 rollback), so the inverse is exact.
--
-- ROLLBACK PLAN (Constitution §38):
--   1. quiesce the communication dispatch paths that hold an evidence sink
--      (createResendEmailAdapter / createTwilioVoiceAdapter /
--      createVapiVoiceAdapter with a non-null sink); the adapters fail
--      NON-fatally on a missing substrate by design (typed results are
--      unaffected), so rollback is safe while sends/calls continue;
--   2. run this file in one transaction;
--   3. verify: the table and its guard function are absent, no other
--      cg_* substrate is touched.
-- DATA NOTE: dropping cg_delivery_evidence DISCARDS the durable evidence of
-- past delivery attempts (§12 provenance). No canonical communication state
-- is lost (notification delivery state lives in the notification pipeline),
-- but the attempt ledger is not reconstructible — treat rollback as an
-- explicit acceptance of evidence loss.
--
-- DATA PRESERVATION ALTERNATIVE (preferred when rows exist): export the
-- table before rollback, e.g.
--   psql -c "\copy cg_delivery_evidence TO 'delivery-evidence-backup.csv' CSV HEADER"
-- The append-only trigger does not block SELECT or COPY.

BEGIN;

DROP TRIGGER IF EXISTS cg_delivery_evidence_append_only ON public.cg_delivery_evidence;
DROP TABLE IF EXISTS public.cg_delivery_evidence;
DROP FUNCTION IF EXISTS public.cg_delivery_evidence_forbid_mutation();

-- Restore the pre-migration privilege posture: the project's ALTER DEFAULT
-- PRIVILEGES confers ALL on new public tables to anon/authenticated (the
-- defective-but-real state 20261003000018 documented); the inverse of this
-- migration's REVOKE re-asserts exactly that.
GRANT ALL ON TABLE public.cg_delivery_evidence TO anon, authenticated;

COMMIT;
