-- =============================================================================
-- Rollback: 20261002000003_coregrid_v1_kernel_bitemporal.sql
-- (V1CAP-004 / MISSION-R-13 bi-temporal discipline)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the bi-temporal validity flags, validity
-- intervals and append-only supersession pointers from the kernel substrate.
-- After rollback, the distinction between valid time and record time on
-- corrected/late-arriving records is unrecoverable: supersession chains
-- (J-003 as-of reconstruction evidence) collapse and unknown-validity flags
-- are lost. For retiring the schema, not for undoing single executions
-- (matches the org-model / workspace-persistence rollback discipline).
--
-- Reversibility note: the columns are additive and nullable in Phase A, so
-- this rollback is lossless ONLY before Phase B (backfill + NOT NULL) runs.
-- =============================================================================

DROP TRIGGER IF EXISTS cg_entity_record_time_immutable ON public.cg_entity;
DROP TRIGGER IF EXISTS cg_event_record_time_immutable ON public.cg_event;
DROP TRIGGER IF EXISTS cg_observation_record_time_immutable ON public.cg_observation;
DROP FUNCTION IF EXISTS public.cg_guard_record_time_immutable();

DROP INDEX IF EXISTS public.cg_entity_valid_time_known_idx;
DROP INDEX IF EXISTS public.cg_entity_supersedes_idx;

DROP INDEX IF EXISTS public.cg_event_valid_time_idx;
DROP INDEX IF EXISTS public.cg_event_supersedes_idx;

DROP INDEX IF EXISTS public.cg_observation_valid_time_idx;
DROP INDEX IF EXISTS public.cg_observation_supersedes_idx;

ALTER TABLE public.cg_entity
  DROP CONSTRAINT IF EXISTS cg_entity_bitemporal_validity,
  DROP COLUMN IF EXISTS valid_time_known,
  DROP COLUMN IF EXISTS supersedes;

ALTER TABLE public.cg_event
  DROP CONSTRAINT IF EXISTS cg_event_bitemporal_interval,
  DROP CONSTRAINT IF EXISTS cg_event_bitemporal_validity,
  DROP COLUMN IF EXISTS valid_from,
  DROP COLUMN IF EXISTS valid_until,
  DROP COLUMN IF EXISTS valid_time_known,
  DROP COLUMN IF EXISTS supersedes;

ALTER TABLE public.cg_observation
  DROP CONSTRAINT IF EXISTS cg_observation_bitemporal_interval,
  DROP CONSTRAINT IF EXISTS cg_observation_bitemporal_validity,
  DROP COLUMN IF EXISTS valid_from,
  DROP COLUMN IF EXISTS valid_until,
  DROP COLUMN IF EXISTS valid_time_known,
  DROP COLUMN IF EXISTS supersedes;
