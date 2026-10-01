-- =============================================================================
-- CoreGrid V1 — Bi-temporal law on the kernel substrate
-- (V1CAP-004, MISSION-R-13 / J-003)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000003_coregrid_v1_kernel_bitemporal.sql
--
-- Authority:
--   V1CAP-004 — bi-temporal law: every reality object carries valid-
--               time and transaction-time; historical states are immutable;
--               no rewriting transaction-time
--   J-003     — separate valid_time from record_time across state/event/
--               observation records so late-arriving or corrected data
--               reconstructs a true history (Evidence->Verification, Memory)
--   G-039     — audited verification distinguishes when something WAS
--               true from when it was RECORDED
--   E-029/G-094 — unknown must remain unknown (explicit unknown-validity
--               representation, never silently assumed 'now')
--   Style exemplar: 20261002000000_coregrid_v1_kernel_envelope.sql
--
-- Scope:
--   Additive bi-temporal columns on the mission's tables:
--     cg_entity, cg_event, cg_observation
--   cg_relationship is deliberately excluded: it already carries the
--   substrate valid_from/valid_to pair and recorded_at, and its records are
--   derived links, not state/event/observation records (J-003 names exactly
--   the three tables above). Harmonizing cg_relationship's validity flag is
--   a Phase B decision, not done here.
--
-- Columns (mirrored 1:1 by kernel/reality.ts KERNEL_BITEMPORAL_COLUMNS):
--   valid_from       — when the fact became true in reality (valid time)
--   valid_until      — when it stopped being true (half-open: exclusive);
--                      NULL means open-endedly true from valid_from
--   valid_time_known — explicit validity knowledge flag. FALSE declares the
--                      fact's valid time UNKNOWN: representable, flagged and
--                      queryable, never silently assumed 'now'
--   supersedes       — append-only correction pointer to the record this
--                      record corrects; NO destructive updates
--
-- recorded_at (record time / transaction time) already exists NOT NULL on
-- every cg_* table (substrate 20260903000000) and is NOT re-authored here.
-- cg_entity already carries valid_from/valid_to (substrate) and receives
-- only the flag and the pointer; cg_event/cg_observation receive the full
-- valid_from/valid_until pair (they had none).
--
-- WHY NULLABLE-THEN-CONSTRAINED (not NOT NULL with defaults):
--   NOT NULL + DEFAULT would MINT bi-temporal claims for pre-existing rows —
--   a defaulted valid_from asserts "this fact was valid at the default
--   instant", exactly the silent assumption J-003 forbids. Instead:
--     Phase A (this migration): columns are nullable; CHECKs below enforce
--       coherence the moment a row touches them (legacy all-NULL rows pass
--       trivially; half-declared validity is rejected immediately; fully
--       declared records are fully verified).
--     Phase B (follow-up): backfill legacy rows with explicit validity
--       declarations (or flagged-unknown), then VALIDATE + SET NOT NULL.
--     Legacy validity-absent rows remain enumerable via
--     `WHERE valid_time_known IS NULL` until then.
--
-- RECORD-TIME IMMUTABILITY: guard triggers reject any UPDATE that changes
-- recorded_at on the three tables — record time is never backdated or
-- rewritten (V1CAP-004 security boundary: historical states are immutable).
-- Corrections go through `supersedes` as NEW rows, never by editing the past.
--
-- Security: no change to the deny-by-default posture. RLS remains enabled
-- with zero policies and anon/authenticated remain fully revoked (kernel
-- substrate migration 20260903000000). No new grants.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Record-time immutability guard (shared function)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cg_guard_record_time_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
    RAISE EXCEPTION 'record_time is immutable: %.% cannot be changed from % to % (correct via supersedes, never by rewriting record time)',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.recorded_at, NEW.recorded_at;
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. cg_entity — universal entity registry
--    (substrate already provides valid_from/valid_to/recorded_at)
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_entity
  ADD COLUMN IF NOT EXISTS valid_time_known boolean,
  ADD COLUMN IF NOT EXISTS supersedes       uuid REFERENCES public.cg_entity(id);

ALTER TABLE public.cg_entity DROP CONSTRAINT IF EXISTS cg_entity_bitemporal_validity;
ALTER TABLE public.cg_entity
  ADD CONSTRAINT cg_entity_bitemporal_validity CHECK (
    (
      -- known validity: the interval start is stated
      (valid_time_known IS TRUE AND valid_from IS NOT NULL)
      OR
      -- explicitly unknown validity: flagged, and NO interval is claimed
      -- (unknown is never dressed up as 'now' or any other instant)
      (valid_time_known IS FALSE AND valid_from IS NULL AND valid_to IS NULL)
      OR
      -- legacy posture: flag untouched, substrate pair governs
      (valid_time_known IS NULL)
    )
    AND (supersedes IS NULL OR supersedes <> id)
  );

CREATE INDEX IF NOT EXISTS cg_entity_valid_time_known_idx ON public.cg_entity (tenant_id, valid_time_known);
CREATE INDEX IF NOT EXISTS cg_entity_supersedes_idx       ON public.cg_entity (supersedes) WHERE supersedes IS NOT NULL;

CREATE TRIGGER cg_entity_record_time_immutable
  BEFORE UPDATE ON public.cg_entity
  FOR EACH ROW EXECUTE FUNCTION public.cg_guard_record_time_immutable();

COMMENT ON COLUMN public.cg_entity.valid_time_known IS
  'Bi-temporal validity knowledge flag (V1CAP-004). FALSE: the fact''s valid time is explicitly UNKNOWN — flagged, never assumed ''now''.';
COMMENT ON COLUMN public.cg_entity.supersedes IS
  'Append-only correction pointer (V1CAP-004): the entity record this record corrects. No destructive updates.';

-- -----------------------------------------------------------------------------
-- 2. cg_event — versioned event / outbox registry
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_event
  ADD COLUMN IF NOT EXISTS valid_from       timestamptz,
  ADD COLUMN IF NOT EXISTS valid_until      timestamptz,
  ADD COLUMN IF NOT EXISTS valid_time_known boolean,
  ADD COLUMN IF NOT EXISTS supersedes       uuid REFERENCES public.cg_event(id);

ALTER TABLE public.cg_event DROP CONSTRAINT IF EXISTS cg_event_bitemporal_interval;
ALTER TABLE public.cg_event
  ADD CONSTRAINT cg_event_bitemporal_interval CHECK (
    valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from
  );

ALTER TABLE public.cg_event DROP CONSTRAINT IF EXISTS cg_event_bitemporal_validity;
ALTER TABLE public.cg_event
  ADD CONSTRAINT cg_event_bitemporal_validity CHECK (
    (
      (valid_time_known IS TRUE AND valid_from IS NOT NULL)
      OR
      (valid_time_known IS FALSE AND valid_from IS NULL AND valid_until IS NULL)
      OR
      (valid_time_known IS NULL)
    )
    AND (supersedes IS NULL OR supersedes <> id)
  );

CREATE INDEX IF NOT EXISTS cg_event_valid_time_idx ON public.cg_event (tenant_id, valid_from, valid_until);
CREATE INDEX IF NOT EXISTS cg_event_supersedes_idx ON public.cg_event (supersedes) WHERE supersedes IS NOT NULL;

CREATE TRIGGER cg_event_record_time_immutable
  BEFORE UPDATE ON public.cg_event
  FOR EACH ROW EXECUTE FUNCTION public.cg_guard_record_time_immutable();

COMMENT ON COLUMN public.cg_event.valid_from IS
  'Valid time (V1CAP-004): when the fact the event records became true in reality. Distinct from recorded_at (record time).';
COMMENT ON COLUMN public.cg_event.valid_until IS
  'Valid-time interval end, half-open/exclusive (V1CAP-004). NULL: open-endedly true from valid_from.';
COMMENT ON COLUMN public.cg_event.valid_time_known IS
  'Bi-temporal validity knowledge flag (V1CAP-004). FALSE: the event''s valid time is explicitly UNKNOWN — flagged, never assumed ''now''.';
COMMENT ON COLUMN public.cg_event.supersedes IS
  'Append-only correction pointer (V1CAP-004): the event record this record corrects. No destructive updates.';

-- -----------------------------------------------------------------------------
-- 3. cg_observation — truth-hierarchy observation registry
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_observation
  ADD COLUMN IF NOT EXISTS valid_from       timestamptz,
  ADD COLUMN IF NOT EXISTS valid_until      timestamptz,
  ADD COLUMN IF NOT EXISTS valid_time_known boolean,
  ADD COLUMN IF NOT EXISTS supersedes       uuid REFERENCES public.cg_observation(id);

ALTER TABLE public.cg_observation DROP CONSTRAINT IF EXISTS cg_observation_bitemporal_interval;
ALTER TABLE public.cg_observation
  ADD CONSTRAINT cg_observation_bitemporal_interval CHECK (
    valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from
  );

ALTER TABLE public.cg_observation DROP CONSTRAINT IF EXISTS cg_observation_bitemporal_validity;
ALTER TABLE public.cg_observation
  ADD CONSTRAINT cg_observation_bitemporal_validity CHECK (
    (
      (valid_time_known IS TRUE AND valid_from IS NOT NULL)
      OR
      (valid_time_known IS FALSE AND valid_from IS NULL AND valid_until IS NULL)
      OR
      (valid_time_known IS NULL)
    )
    AND (supersedes IS NULL OR supersedes <> id)
  );

CREATE INDEX IF NOT EXISTS cg_observation_valid_time_idx ON public.cg_observation (tenant_id, valid_from, valid_until);
CREATE INDEX IF NOT EXISTS cg_observation_supersedes_idx ON public.cg_observation (supersedes) WHERE supersedes IS NOT NULL;

CREATE TRIGGER cg_observation_record_time_immutable
  BEFORE UPDATE ON public.cg_observation
  FOR EACH ROW EXECUTE FUNCTION public.cg_guard_record_time_immutable();

COMMENT ON COLUMN public.cg_observation.valid_from IS
  'Valid time (V1CAP-004): when the observed fact was true in reality. Distinct from recorded_at (record time).';
COMMENT ON COLUMN public.cg_observation.valid_until IS
  'Valid-time interval end, half-open/exclusive (V1CAP-004). NULL: open-endedly true from valid_from.';
COMMENT ON COLUMN public.cg_observation.valid_time_known IS
  'Bi-temporal validity knowledge flag (V1CAP-004). FALSE: the observation''s valid time is explicitly UNKNOWN — flagged, never assumed ''now''.';
COMMENT ON COLUMN public.cg_observation.supersedes IS
  'Append-only correction pointer (V1CAP-004): the observation record this record corrects. No destructive updates.';

-- -----------------------------------------------------------------------------
-- 4. Security posture (unchanged)
-- -----------------------------------------------------------------------------
-- No new grants. RLS stays enabled with zero policies on all cg_* substrate
-- tables and anon/authenticated remain fully revoked (20260903000000). The
-- bi-temporal columns widen what service-role writers MUST declare about
-- time, never who may write. Cross-tenant supersession is rejected by the
-- kernel contract (kernel/reality.ts resolveSupersession); a same-tenant
-- composite-FK tightening is a Phase B decision.
