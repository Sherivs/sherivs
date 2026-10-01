-- =============================================================================
-- CoreGrid V1 — Canonical CoreObject envelope on the kernel substrate
-- (V1CAP-002, MISSION-R-10 / J-001 / G-001 / G-010)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000000_coregrid_v1_kernel_envelope.sql
--
-- Authority:
--   G-001  — universal CoreObject envelope: "no anonymous persistent object
--            exists inside CoreGrid"
--   G-010  — event causation and correlation chain (causation_id,
--            correlation_id, parent_event_id)
--   J-001  — envelope conformance pass over the kernel substrate (the column/
--            contract conformance pass over the existing live tables)
--   L-H-013— hardening law: envelope on EVERY state change; unknown-type
--            rejection lives in the type registry (MISSION-R-11), not here
--   Style exemplar: 20261001000000_coregrid_v1_org_model.sql
--
-- Scope:
--   Additive envelope columns on the persistent kernel object tables:
--     cg_entity, cg_relationship, cg_event, cg_observation
--   Mission objective names cg_entity/cg_event/cg_observation; cg_relationship
--   is included because G-001's law is universal over persistent kernel
--   objects and excluding it would create an anonymous-object carve-out.
--   Existing columns, constraints, RLS and grants are untouched.
--
-- Envelope columns (mirrored 1:1 by kernel/reality.ts KERNEL_ENVELOPE_COLUMNS):
--   object_type      — canonical registry type (MISSION-R-11 owns the
--                      registry; until it lands the TS contract accepts the
--                      type through the `knownObjectTypes` parameter)
--   schema_version   — MAJOR.MINOR, starts at '1.0'
--   status           — lifecycle: draft|active|suspended|archived|deleted
--   created_by       — creator principal ref (human, agent, service)
--   updated_by       — last mutating principal ref
--   provenance       — JSON: source, source_ref, recorded_by, origin tenant,
--                      generated_by_ai, verified (Constitution §12)
--   policy_context   — JSON: policy refs governing the object; never
--                      interpreted by the kernel
--   trace_id         — distributed trace the state change belongs to
--   correlation_id   — business-flow correlation
--   causation_id     — direct cause ref (event/object id) when chained
--   parent_event_id  — parent event in the causation chain when chained
--   declared_origin  — explicit chain root when the object ORIGINATES a chain
--
-- id and tenant_id are already mandatory envelope members on every cg_* table
-- (primary key; tenant column present on all four). Tightening the NULLABLE
-- tenant columns to NOT NULL is a substrate-wide decision owned by the
-- neutral tenant primitives mission (R-20) and is deliberately NOT done here.
--
-- WHY NULLABLE-THEN-CONSTRAINED (not NOT NULL with defaults):
--   NOT NULL + DEFAULT would silently MINT synthetic envelopes for anonymous
--   objects — a defaulted created_by or object_type is exactly the anonymous
--   persistent object J-001 forbids, wearing a costume. Instead:
--     Phase A (this migration): columns are nullable; CHECKs below are fully
--       enforced (legacy all-NULL rows pass trivially, half-stamped writes are
--       rejected immediately, fully stamped writes are fully verified).
--     Phase B (follow-up, once every server write path stamps the envelope):
--       backfill legacy rows with real migration provenance (no synthetic
--       identities), then VALIDATE + SET NOT NULL. Legacy envelope-absent
--       rows remain enumerable via `WHERE object_type IS NULL` until then.
--
-- Security: no change to the deny-by-default posture. RLS remains enabled
-- with zero policies and anon/authenticated remain fully revoked (kernel
-- substrate migration 20260903000000); service-role server functions are the
-- only intended writers, and each must stamp the envelope through
-- kernel/reality.ts `stampKernelDraft` (fail-closed, unit-proven).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_entity — universal entity registry
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_entity
  ADD COLUMN IF NOT EXISTS object_type     text,
  ADD COLUMN IF NOT EXISTS schema_version  text,
  ADD COLUMN IF NOT EXISTS status          text,
  ADD COLUMN IF NOT EXISTS created_by      text,
  ADD COLUMN IF NOT EXISTS updated_by      text,
  ADD COLUMN IF NOT EXISTS provenance      jsonb,
  ADD COLUMN IF NOT EXISTS policy_context  jsonb,
  ADD COLUMN IF NOT EXISTS trace_id        text,
  ADD COLUMN IF NOT EXISTS correlation_id  text,
  ADD COLUMN IF NOT EXISTS causation_id    text,
  ADD COLUMN IF NOT EXISTS parent_event_id text,
  ADD COLUMN IF NOT EXISTS declared_origin text;

-- The envelope is ATOMIC: a row carries a COMPLETE envelope or none at all.
-- Half-stamped anonymous objects are rejected at write time, not at audit time.
ALTER TABLE public.cg_entity DROP CONSTRAINT IF EXISTS cg_entity_envelope_atomic;
ALTER TABLE public.cg_entity
  ADD CONSTRAINT cg_entity_envelope_atomic CHECK (
    (object_type IS NULL AND schema_version IS NULL AND status IS NULL
      AND created_by IS NULL AND updated_by IS NULL AND provenance IS NULL
      AND policy_context IS NULL AND trace_id IS NULL AND correlation_id IS NULL)
    OR
    (object_type IS NOT NULL AND schema_version IS NOT NULL AND status IS NOT NULL
      AND created_by IS NOT NULL AND updated_by IS NOT NULL AND provenance IS NOT NULL
      AND policy_context IS NOT NULL AND trace_id IS NOT NULL AND correlation_id IS NOT NULL)
  );

-- G-010: a causation chain root is explicit — continued from a cause or
-- declared as an origin. Unrooted envelope-bearing rows never exist.
ALTER TABLE public.cg_entity DROP CONSTRAINT IF EXISTS cg_entity_envelope_causation_root;
ALTER TABLE public.cg_entity
  ADD CONSTRAINT cg_entity_envelope_causation_root CHECK (
    object_type IS NULL
    OR causation_id IS NOT NULL OR parent_event_id IS NOT NULL OR declared_origin IS NOT NULL
  );

ALTER TABLE public.cg_entity DROP CONSTRAINT IF EXISTS cg_entity_envelope_format;
ALTER TABLE public.cg_entity
  ADD CONSTRAINT cg_entity_envelope_format CHECK (
    (object_type    IS NULL OR length(object_type) BETWEEN 1 AND 128)
    AND (schema_version IS NULL OR schema_version ~ '^[0-9]+\.[0-9]+$')
    AND (status     IS NULL OR status IN ('draft','active','suspended','archived','deleted'))
    AND (created_by IS NULL OR length(created_by) BETWEEN 1 AND 160)
    AND (updated_by IS NULL OR length(updated_by) BETWEEN 1 AND 160)
    AND (provenance     IS NULL OR jsonb_typeof(provenance) = 'object')
    AND (policy_context IS NULL OR jsonb_typeof(policy_context) = 'object')
    AND (trace_id       IS NULL OR length(trace_id) BETWEEN 1 AND 200)
    AND (correlation_id IS NULL OR length(correlation_id) BETWEEN 1 AND 200)
    AND (causation_id    IS NULL OR length(causation_id) BETWEEN 1 AND 200)
    AND (parent_event_id IS NULL OR length(parent_event_id) BETWEEN 1 AND 200)
    AND (declared_origin IS NULL OR length(declared_origin) BETWEEN 1 AND 200)
  );

CREATE INDEX IF NOT EXISTS cg_entity_object_type_idx  ON public.cg_entity (tenant_id, object_type);
CREATE INDEX IF NOT EXISTS cg_entity_trace_idx        ON public.cg_entity (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cg_entity_correlation_idx  ON public.cg_entity (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cg_entity_causation_idx    ON public.cg_entity (causation_id) WHERE causation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cg_entity_parent_event_idx ON public.cg_entity (parent_event_id) WHERE parent_event_id IS NOT NULL;

COMMENT ON COLUMN public.cg_entity.object_type IS
  'Canonical CoreObject registry type (V1CAP-002). Registry and unknown-type rejection are owned by MISSION-R-11.';

-- -----------------------------------------------------------------------------
-- 2. cg_relationship — typed relationship registry
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_relationship
  ADD COLUMN IF NOT EXISTS object_type     text,
  ADD COLUMN IF NOT EXISTS schema_version  text,
  ADD COLUMN IF NOT EXISTS status          text,
  ADD COLUMN IF NOT EXISTS created_by      text,
  ADD COLUMN IF NOT EXISTS updated_by      text,
  ADD COLUMN IF NOT EXISTS provenance      jsonb,
  ADD COLUMN IF NOT EXISTS policy_context  jsonb,
  ADD COLUMN IF NOT EXISTS trace_id        text,
  ADD COLUMN IF NOT EXISTS correlation_id  text,
  ADD COLUMN IF NOT EXISTS causation_id    text,
  ADD COLUMN IF NOT EXISTS parent_event_id text,
  ADD COLUMN IF NOT EXISTS declared_origin text;

ALTER TABLE public.cg_relationship DROP CONSTRAINT IF EXISTS cg_relationship_envelope_atomic;
ALTER TABLE public.cg_relationship
  ADD CONSTRAINT cg_relationship_envelope_atomic CHECK (
    (object_type IS NULL AND schema_version IS NULL AND status IS NULL
      AND created_by IS NULL AND updated_by IS NULL AND provenance IS NULL
      AND policy_context IS NULL AND trace_id IS NULL AND correlation_id IS NULL)
    OR
    (object_type IS NOT NULL AND schema_version IS NOT NULL AND status IS NOT NULL
      AND created_by IS NOT NULL AND updated_by IS NOT NULL AND provenance IS NOT NULL
      AND policy_context IS NOT NULL AND trace_id IS NOT NULL AND correlation_id IS NOT NULL)
  );

ALTER TABLE public.cg_relationship DROP CONSTRAINT IF EXISTS cg_relationship_envelope_causation_root;
ALTER TABLE public.cg_relationship
  ADD CONSTRAINT cg_relationship_envelope_causation_root CHECK (
    object_type IS NULL
    OR causation_id IS NOT NULL OR parent_event_id IS NOT NULL OR declared_origin IS NOT NULL
  );

ALTER TABLE public.cg_relationship DROP CONSTRAINT IF EXISTS cg_relationship_envelope_format;
ALTER TABLE public.cg_relationship
  ADD CONSTRAINT cg_relationship_envelope_format CHECK (
    (object_type    IS NULL OR length(object_type) BETWEEN 1 AND 128)
    AND (schema_version IS NULL OR schema_version ~ '^[0-9]+\.[0-9]+$')
    AND (status     IS NULL OR status IN ('draft','active','suspended','archived','deleted'))
    AND (created_by IS NULL OR length(created_by) BETWEEN 1 AND 160)
    AND (updated_by IS NULL OR length(updated_by) BETWEEN 1 AND 160)
    AND (provenance     IS NULL OR jsonb_typeof(provenance) = 'object')
    AND (policy_context IS NULL OR jsonb_typeof(policy_context) = 'object')
    AND (trace_id       IS NULL OR length(trace_id) BETWEEN 1 AND 200)
    AND (correlation_id IS NULL OR length(correlation_id) BETWEEN 1 AND 200)
    AND (causation_id    IS NULL OR length(causation_id) BETWEEN 1 AND 200)
    AND (parent_event_id IS NULL OR length(parent_event_id) BETWEEN 1 AND 200)
    AND (declared_origin IS NULL OR length(declared_origin) BETWEEN 1 AND 200)
  );

CREATE INDEX IF NOT EXISTS cg_relationship_object_type_idx  ON public.cg_relationship (tenant_id, object_type);
CREATE INDEX IF NOT EXISTS cg_relationship_trace_idx        ON public.cg_relationship (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cg_relationship_correlation_idx  ON public.cg_relationship (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cg_relationship_causation_idx    ON public.cg_relationship (causation_id) WHERE causation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cg_relationship_parent_event_idx ON public.cg_relationship (parent_event_id) WHERE parent_event_id IS NOT NULL;

COMMENT ON COLUMN public.cg_relationship.object_type IS
  'Canonical CoreObject registry type (V1CAP-002). Registry and unknown-type rejection are owned by MISSION-R-11.';

-- -----------------------------------------------------------------------------
-- 3. cg_event — versioned event / outbox registry
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_event
  ADD COLUMN IF NOT EXISTS object_type     text,
  ADD COLUMN IF NOT EXISTS schema_version  text,
  ADD COLUMN IF NOT EXISTS status          text,
  ADD COLUMN IF NOT EXISTS created_by      text,
  ADD COLUMN IF NOT EXISTS updated_by      text,
  ADD COLUMN IF NOT EXISTS provenance      jsonb,
  ADD COLUMN IF NOT EXISTS policy_context  jsonb,
  ADD COLUMN IF NOT EXISTS trace_id        text,
  ADD COLUMN IF NOT EXISTS correlation_id  text,
  ADD COLUMN IF NOT EXISTS causation_id    text,
  ADD COLUMN IF NOT EXISTS parent_event_id text,
  ADD COLUMN IF NOT EXISTS declared_origin text;

-- The delivery state machine (cg_event.state) is DISTINCT from the envelope
-- lifecycle status: delivery progress never mutates object identity.
ALTER TABLE public.cg_event DROP CONSTRAINT IF EXISTS cg_event_envelope_atomic;
ALTER TABLE public.cg_event
  ADD CONSTRAINT cg_event_envelope_atomic CHECK (
    (object_type IS NULL AND schema_version IS NULL AND status IS NULL
      AND created_by IS NULL AND updated_by IS NULL AND provenance IS NULL
      AND policy_context IS NULL AND trace_id IS NULL AND correlation_id IS NULL)
    OR
    (object_type IS NOT NULL AND schema_version IS NOT NULL AND status IS NOT NULL
      AND created_by IS NOT NULL AND updated_by IS NOT NULL AND provenance IS NOT NULL
      AND policy_context IS NOT NULL AND trace_id IS NOT NULL AND correlation_id IS NOT NULL)
  );

ALTER TABLE public.cg_event DROP CONSTRAINT IF EXISTS cg_event_envelope_causation_root;
ALTER TABLE public.cg_event
  ADD CONSTRAINT cg_event_envelope_causation_root CHECK (
    object_type IS NULL
    OR causation_id IS NOT NULL OR parent_event_id IS NOT NULL OR declared_origin IS NOT NULL
  );

ALTER TABLE public.cg_event DROP CONSTRAINT IF EXISTS cg_event_envelope_format;
ALTER TABLE public.cg_event
  ADD CONSTRAINT cg_event_envelope_format CHECK (
    (object_type    IS NULL OR length(object_type) BETWEEN 1 AND 128)
    AND (schema_version IS NULL OR schema_version ~ '^[0-9]+\.[0-9]+$')
    AND (status     IS NULL OR status IN ('draft','active','suspended','archived','deleted'))
    AND (created_by IS NULL OR length(created_by) BETWEEN 1 AND 160)
    AND (updated_by IS NULL OR length(updated_by) BETWEEN 1 AND 160)
    AND (provenance     IS NULL OR jsonb_typeof(provenance) = 'object')
    AND (policy_context IS NULL OR jsonb_typeof(policy_context) = 'object')
    AND (trace_id       IS NULL OR length(trace_id) BETWEEN 1 AND 200)
    AND (correlation_id IS NULL OR length(correlation_id) BETWEEN 1 AND 200)
    AND (causation_id    IS NULL OR length(causation_id) BETWEEN 1 AND 200)
    AND (parent_event_id IS NULL OR length(parent_event_id) BETWEEN 1 AND 200)
    AND (declared_origin IS NULL OR length(declared_origin) BETWEEN 1 AND 200)
  );

CREATE INDEX IF NOT EXISTS cg_event_object_type_idx  ON public.cg_event (tenant_id, object_type);
CREATE INDEX IF NOT EXISTS cg_event_trace_idx        ON public.cg_event (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cg_event_correlation_idx  ON public.cg_event (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cg_event_causation_idx    ON public.cg_event (causation_id) WHERE causation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cg_event_parent_event_idx ON public.cg_event (parent_event_id) WHERE parent_event_id IS NOT NULL;

COMMENT ON COLUMN public.cg_event.object_type IS
  'Canonical CoreObject registry type (V1CAP-002). Registry and unknown-type rejection are owned by MISSION-R-11.';

-- -----------------------------------------------------------------------------
-- 4. cg_observation — truth-hierarchy observation registry
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_observation
  ADD COLUMN IF NOT EXISTS object_type     text,
  ADD COLUMN IF NOT EXISTS schema_version  text,
  ADD COLUMN IF NOT EXISTS status          text,
  ADD COLUMN IF NOT EXISTS created_by      text,
  ADD COLUMN IF NOT EXISTS updated_by      text,
  ADD COLUMN IF NOT EXISTS provenance      jsonb,
  ADD COLUMN IF NOT EXISTS policy_context  jsonb,
  ADD COLUMN IF NOT EXISTS trace_id        text,
  ADD COLUMN IF NOT EXISTS correlation_id  text,
  ADD COLUMN IF NOT EXISTS causation_id    text,
  ADD COLUMN IF NOT EXISTS parent_event_id text,
  ADD COLUMN IF NOT EXISTS declared_origin text;

ALTER TABLE public.cg_observation DROP CONSTRAINT IF EXISTS cg_observation_envelope_atomic;
ALTER TABLE public.cg_observation
  ADD CONSTRAINT cg_observation_envelope_atomic CHECK (
    (object_type IS NULL AND schema_version IS NULL AND status IS NULL
      AND created_by IS NULL AND updated_by IS NULL AND provenance IS NULL
      AND policy_context IS NULL AND trace_id IS NULL AND correlation_id IS NULL)
    OR
    (object_type IS NOT NULL AND schema_version IS NOT NULL AND status IS NOT NULL
      AND created_by IS NOT NULL AND updated_by IS NOT NULL AND provenance IS NOT NULL
      AND policy_context IS NOT NULL AND trace_id IS NOT NULL AND correlation_id IS NOT NULL)
  );

ALTER TABLE public.cg_observation DROP CONSTRAINT IF EXISTS cg_observation_envelope_causation_root;
ALTER TABLE public.cg_observation
  ADD CONSTRAINT cg_observation_envelope_causation_root CHECK (
    object_type IS NULL
    OR causation_id IS NOT NULL OR parent_event_id IS NOT NULL OR declared_origin IS NOT NULL
  );

ALTER TABLE public.cg_observation DROP CONSTRAINT IF EXISTS cg_observation_envelope_format;
ALTER TABLE public.cg_observation
  ADD CONSTRAINT cg_observation_envelope_format CHECK (
    (object_type    IS NULL OR length(object_type) BETWEEN 1 AND 128)
    AND (schema_version IS NULL OR schema_version ~ '^[0-9]+\.[0-9]+$')
    AND (status     IS NULL OR status IN ('draft','active','suspended','archived','deleted'))
    AND (created_by IS NULL OR length(created_by) BETWEEN 1 AND 160)
    AND (updated_by IS NULL OR length(updated_by) BETWEEN 1 AND 160)
    AND (provenance     IS NULL OR jsonb_typeof(provenance) = 'object')
    AND (policy_context IS NULL OR jsonb_typeof(policy_context) = 'object')
    AND (trace_id       IS NULL OR length(trace_id) BETWEEN 1 AND 200)
    AND (correlation_id IS NULL OR length(correlation_id) BETWEEN 1 AND 200)
    AND (causation_id    IS NULL OR length(causation_id) BETWEEN 1 AND 200)
    AND (parent_event_id IS NULL OR length(parent_event_id) BETWEEN 1 AND 200)
    AND (declared_origin IS NULL OR length(declared_origin) BETWEEN 1 AND 200)
  );

CREATE INDEX IF NOT EXISTS cg_observation_object_type_idx  ON public.cg_observation (tenant_id, object_type);
CREATE INDEX IF NOT EXISTS cg_observation_trace_idx        ON public.cg_observation (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cg_observation_correlation_idx  ON public.cg_observation (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cg_observation_causation_idx    ON public.cg_observation (causation_id) WHERE causation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cg_observation_parent_event_idx ON public.cg_observation (parent_event_id) WHERE parent_event_id IS NOT NULL;

COMMENT ON COLUMN public.cg_observation.object_type IS
  'Canonical CoreObject registry type (V1CAP-002). Registry and unknown-type rejection are owned by MISSION-R-11.';

-- -----------------------------------------------------------------------------
-- 5. Security posture (unchanged)
-- -----------------------------------------------------------------------------
-- No new grants. RLS stays enabled with zero policies on all cg_* substrate
-- tables and anon/authenticated remain fully revoked (20260903000000). The
-- envelope widens what service-role writers MUST carry, never who may write.
