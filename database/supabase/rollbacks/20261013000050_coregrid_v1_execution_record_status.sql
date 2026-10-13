-- =============================================================================
-- Rollback of 20261013000050_coregrid_v1_execution_record_status.sql
-- (V1-004 — restore the original 3-value status CHECK on cg_execution_record
--  and cg_execution_history)
-- =============================================================================
-- HUMAN AUTHORIZED 2026-10-13. ACTIVE-V1. Does not edit 20261003000019.
--
-- GENUINE INVERSE: the migration drops the 3-value status IN
-- (admitted,denied,rolled_back) CHECKs and ADDs named
-- cg_execution_record_status_vocab_check / cg_execution_history_status_vocab_check
-- with the 9-value vocabulary. This file drops those named constraints and
-- restores the original 3-value CHECK. External-effect coupling CHECKs are
-- not touched (the forward migration left them alone).
--
-- ROLLBACK PLAN (Constitution §38):
--   1. quiesce writers that persist assigned|leased|evidenced|verified|
--      requeued|exhausted onto cg_execution_record / cg_execution_history;
--   2. if any row already uses a widened status, this ADD CONSTRAINT will
--      fail closed (do not rewrite canonical rows here);
--   3. run this file in one transaction;
--   4. verify: status vocab is again admitted|denied|rolled_back; named
--      *_status_vocab_check constraints absent.
-- DATA NOTE: rows still at admitted|denied|rolled_back are valid under the
-- restored CHECK. Widened-stage rows must be drained before rollback.
-- =============================================================================

BEGIN;

ALTER TABLE public.cg_execution_record
  DROP CONSTRAINT IF EXISTS cg_execution_record_status_vocab_check;
ALTER TABLE public.cg_execution_record
  DROP CONSTRAINT IF EXISTS cg_execution_record_status_check;
ALTER TABLE public.cg_execution_record
  ADD CONSTRAINT cg_execution_record_status_check
  CHECK (status IN ('admitted','denied','rolled_back'));

ALTER TABLE public.cg_execution_history
  DROP CONSTRAINT IF EXISTS cg_execution_history_status_vocab_check;
ALTER TABLE public.cg_execution_history
  DROP CONSTRAINT IF EXISTS cg_execution_history_status_check;
ALTER TABLE public.cg_execution_history
  ADD CONSTRAINT cg_execution_history_status_check
  CHECK (status IN ('admitted','denied','rolled_back'));

COMMIT;
