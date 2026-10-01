-- =============================================================================
-- Rollback: 20261002000000_coregrid_v1_kernel_envelope.sql
-- (V1CAP-002 / MISSION-R-10 canonical CoreObject envelope)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the canonical CoreObject envelope columns
-- from every kernel substrate table. After rollback, envelope provenance,
-- causation chains and trace/correlation identity on pre-existing rows are
-- unrecoverable (J-001/G-010 conformance evidence is destroyed). For retiring
-- the schema, not for undoing single executions (matches the org-model /
-- workspace-persistence rollback discipline).
--
-- Reversibility note: the columns are additive and nullable in Phase A, so
-- this rollback is lossless ONLY before Phase B (backfill + NOT NULL) runs.
-- =============================================================================

DROP INDEX IF EXISTS public.cg_entity_object_type_idx;
DROP INDEX IF EXISTS public.cg_entity_trace_idx;
DROP INDEX IF EXISTS public.cg_entity_correlation_idx;
DROP INDEX IF EXISTS public.cg_entity_causation_idx;
DROP INDEX IF EXISTS public.cg_entity_parent_event_idx;

DROP INDEX IF EXISTS public.cg_relationship_object_type_idx;
DROP INDEX IF EXISTS public.cg_relationship_trace_idx;
DROP INDEX IF EXISTS public.cg_relationship_correlation_idx;
DROP INDEX IF EXISTS public.cg_relationship_causation_idx;
DROP INDEX IF EXISTS public.cg_relationship_parent_event_idx;

DROP INDEX IF EXISTS public.cg_event_object_type_idx;
DROP INDEX IF EXISTS public.cg_event_trace_idx;
DROP INDEX IF EXISTS public.cg_event_correlation_idx;
DROP INDEX IF EXISTS public.cg_event_causation_idx;
DROP INDEX IF EXISTS public.cg_event_parent_event_idx;

DROP INDEX IF EXISTS public.cg_observation_object_type_idx;
DROP INDEX IF EXISTS public.cg_observation_trace_idx;
DROP INDEX IF EXISTS public.cg_observation_correlation_idx;
DROP INDEX IF EXISTS public.cg_observation_causation_idx;
DROP INDEX IF EXISTS public.cg_observation_parent_event_idx;

ALTER TABLE public.cg_entity
  DROP CONSTRAINT IF EXISTS cg_entity_envelope_atomic,
  DROP CONSTRAINT IF EXISTS cg_entity_envelope_causation_root,
  DROP CONSTRAINT IF EXISTS cg_entity_envelope_format,
  DROP COLUMN IF EXISTS object_type,
  DROP COLUMN IF EXISTS schema_version,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS provenance,
  DROP COLUMN IF EXISTS policy_context,
  DROP COLUMN IF EXISTS trace_id,
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS causation_id,
  DROP COLUMN IF EXISTS parent_event_id,
  DROP COLUMN IF EXISTS declared_origin;

ALTER TABLE public.cg_relationship
  DROP CONSTRAINT IF EXISTS cg_relationship_envelope_atomic,
  DROP CONSTRAINT IF EXISTS cg_relationship_envelope_causation_root,
  DROP CONSTRAINT IF EXISTS cg_relationship_envelope_format,
  DROP COLUMN IF EXISTS object_type,
  DROP COLUMN IF EXISTS schema_version,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS provenance,
  DROP COLUMN IF EXISTS policy_context,
  DROP COLUMN IF EXISTS trace_id,
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS causation_id,
  DROP COLUMN IF EXISTS parent_event_id,
  DROP COLUMN IF EXISTS declared_origin;

ALTER TABLE public.cg_event
  DROP CONSTRAINT IF EXISTS cg_event_envelope_atomic,
  DROP CONSTRAINT IF EXISTS cg_event_envelope_causation_root,
  DROP CONSTRAINT IF EXISTS cg_event_envelope_format,
  DROP COLUMN IF EXISTS object_type,
  DROP COLUMN IF EXISTS schema_version,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS provenance,
  DROP COLUMN IF EXISTS policy_context,
  DROP COLUMN IF EXISTS trace_id,
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS causation_id,
  DROP COLUMN IF EXISTS parent_event_id,
  DROP COLUMN IF EXISTS declared_origin;

ALTER TABLE public.cg_observation
  DROP CONSTRAINT IF EXISTS cg_observation_envelope_atomic,
  DROP CONSTRAINT IF EXISTS cg_observation_envelope_causation_root,
  DROP CONSTRAINT IF EXISTS cg_observation_envelope_format,
  DROP COLUMN IF EXISTS object_type,
  DROP COLUMN IF EXISTS schema_version,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS provenance,
  DROP COLUMN IF EXISTS policy_context,
  DROP COLUMN IF EXISTS trace_id,
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS causation_id,
  DROP COLUMN IF EXISTS parent_event_id,
  DROP COLUMN IF EXISTS declared_origin;
