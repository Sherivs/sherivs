-- =============================================================================
-- CoreGrid V1 — widen cg_execution_record / cg_execution_history status vocab
-- =============================================================================
-- HUMAN AUTHORIZED 2026-10-13. ACTIVE-V1 (AGENTS.md §45).
-- does not edit 20261003000019 (checksum-bound sibling
--   database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql).
--
-- Status: AUTHORED under explicit human authorization:
--   "Authorize the CoreGrid execution records status, and execute the v1 004
--    lease write also, and then extract the phase 52 corpus that related to
--    this execution we are doing and then also apply resident for Hermes and
--    the jarvis."
-- Apply only with that authorization (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (exact inverse, same basename):
--   database/supabase/rollbacks/20261013000050_coregrid_v1_execution_record_status.sql
--
-- Authority:
--   MISSION V1-004 remaining-work (team MISSIONS). Closes the status-vocabulary
--   gap that kept cg_execution_record.status at admitted|denied|rolled_back
--   while the execution-path machine (assigned/leased/evidenced/verified/
--   requeued/exhausted) and the V1-003 cg_mission_lease substrate already
--   exist. Does NOT implement Phase 52 engines. Does NOT add lease columns.
--   Does NOT rewrite 20261003000019.
--
-- Scope:
--   Drop the 3-value status IN (...) CHECKs on cg_execution_record and
--   cg_execution_history (the ones whose pg_get_constraintdef mentions
--   admitted/denied/rolled_back AND status AND does NOT mention
--   external_effect). Leave the status<>admitted/denied/rolled_back →
--   external_effect coupling CHECKs untouched.
--   Then ADD named:
--     cg_execution_record_status_vocab_check
--     cg_execution_history_status_vocab_check
--   CHECK (status IN ('admitted','denied','rolled_back','assigned','leased',
--                     'evidenced','verified','requeued','exhausted'))
--
-- Idempotent: re-running drops any matching unnamed/named status-vocab CHECKs
-- (including these named ones) and re-ADDs the named constraints.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname AS conname,
           con.conrelid::regclass AS tbl
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE con.contype = 'c'
       AND nsp.nspname = 'public'
       AND rel.relname IN ('cg_execution_record', 'cg_execution_history')
       AND pg_get_constraintdef(con.oid) ILIKE '%admitted%'
       AND pg_get_constraintdef(con.oid) ILIKE '%denied%'
       AND pg_get_constraintdef(con.oid) ILIKE '%rolled_back%'
       AND pg_get_constraintdef(con.oid) ILIKE '%status%'
       AND pg_get_constraintdef(con.oid) NOT ILIKE '%external_effect%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END
$$;

ALTER TABLE public.cg_execution_record
  DROP CONSTRAINT IF EXISTS cg_execution_record_status_vocab_check;
ALTER TABLE public.cg_execution_record
  ADD CONSTRAINT cg_execution_record_status_vocab_check
  CHECK (status IN (
    'admitted',
    'denied',
    'rolled_back',
    'assigned',
    'leased',
    'evidenced',
    'verified',
    'requeued',
    'exhausted'
  ));

ALTER TABLE public.cg_execution_history
  DROP CONSTRAINT IF EXISTS cg_execution_history_status_vocab_check;
ALTER TABLE public.cg_execution_history
  ADD CONSTRAINT cg_execution_history_status_vocab_check
  CHECK (status IN (
    'admitted',
    'denied',
    'rolled_back',
    'assigned',
    'leased',
    'evidenced',
    'verified',
    'requeued',
    'exhausted'
  ));

COMMENT ON CONSTRAINT cg_execution_record_status_vocab_check
  ON public.cg_execution_record IS
  'HUMAN AUTHORIZED 2026-10-13 ACTIVE-V1: execution-path stages plus the original admission vocabulary. Does not edit 20261003000019. External-effect coupling CHECKs stay.';

COMMENT ON CONSTRAINT cg_execution_history_status_vocab_check
  ON public.cg_execution_history IS
  'HUMAN AUTHORIZED 2026-10-13 ACTIVE-V1: append-only history uses the same status vocabulary as cg_execution_record.';

COMMIT;
