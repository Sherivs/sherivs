-- =============================================================================
-- CoreGrid V1 — Hermes observation substrate (V1 remediation wave, team R4 /
-- HERMES-PORT; follow-up of mission V1-002)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback: database/supabase/rollbacks/20261003000030_coregrid_hermes_observation_substrate.sql
-- (exact inverse, same basename).
--
-- Authority (V1 authorization):
--   V1 remediation wave, team R4 (HERMES-PORT). Closes the two follow-ups
--   recorded by mission V1-002 (progress/v1-wave/V1-002-report.md):
--     (1) a DB-backed Hermes observation port — until now Hermes observations
--         existed only in memory (test fixtures); and
--     (2) event-trigger wiring — Hermes observations now arrive from the
--         event substrate (cg_event) and from direct calls, through ONE
--         governed recording port.
--   Style exemplars: 20261003000019_coregrid_v1_mission_lease.sql
--   (deny-by-default posture: RLS enabled, ZERO policies, REVOKE all from
--   anon/authenticated, service-role only) and 20261002000002 (cg_ naming).
--
-- Scope:
--   cg_hermes_observation — the APPEND-ONLY observation substrate: one row
--   per observation that arrived at Hermes (source 'direct' via a server
--   function call, or 'event' via the cg_event substrate), carrying the full
--   §12 provenance chain (where it came from, who/what created it, when —
--   both valid time observed_at and record time recorded_at — and the
--   AI-generated flag), plus the envelope provenance refs (trace /
--   correlation / declared origin).
--
-- Canonical-truth law (§9): observation rows are DERIVED INTELLIGENCE, never
-- canonical truth. The database ENFORCES this: every row must carry
-- generated_by_ai = true and verified = false (the
-- cg_hermes_observation_intelligence_only CHECK). The state of record about
-- missions, workers, evidence and verification lives exclusively in the
-- cg_* ports of record (cg_execution_record, cg_worker_definition,
-- cg_foundation_evidence, cg_verification_result); an observation row can
-- point at that state (subject_ref) but can never BECOME it. There is no
-- supersession, no update and no delete: corrections are NEW rows
-- (append-only trigger below), so the observation history a consumer reads
-- is the history that was recorded.
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (same posture as the mission-lease
--     and worker substrates). Hermes observations are AI-workforce
--     intelligence records; no tenant-scoped policy exists yet that provably
--     cannot widen what an AI identity may read. Service-role server
--     functions are the only intended writer and reader; the hermes event
--     source + observation port validate every row and scope every query in
--     SQL by tenant before any observation enters Hermes state.
--   • The cg_event substrate itself (owned by the universal kernel migration
--     20260903000000) — this migration only REFERENCES event identity
--     (event_ref); the outbox delivery state machine (kernel/outbox.ts)
--     remains the sole owner of event state transitions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_hermes_observation — the append-only Hermes observation substrate
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_hermes_observation (
  id              text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id       text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- Closed observation vocabulary: what KIND of thing was observed.
  kind            text NOT NULL CHECK (kind IN
                    ('mission_observation','worker_observation',
                     'verification_observation','event_observation')),
  -- What the observation is about: a stable ref into the state of record
  -- (e.g. 'cg_execution_record:<id>') or the event coordinate
  -- ('cg_event:<aggregate_type>:<aggregate_id>'). A pointer, never a copy
  -- of canonical truth (§9).
  subject_ref     text NOT NULL CHECK (length(subject_ref) BETWEEN 1 AND 200),
  -- The observed claim as a JSON object (the intelligence content).
  statement       jsonb NOT NULL DEFAULT '{}'::jsonb
                    CHECK (jsonb_typeof(statement) = 'object'),
  -- VALID time — when the observed fact was true in reality (caller
  -- supplied, never backdated by the writer).
  observed_at     timestamptz NOT NULL,
  -- RECORD time — when the substrate learned it (database clock; the
  -- adapter never supplies this column).
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  -- §12 WHERE IT CAME FROM: 'direct' (a server function call recorded the
  -- observation) or 'event' (it arrived through the cg_event substrate).
  source          text NOT NULL CHECK (source IN ('direct','event')),
  -- The cg_event coordinate when source = 'event' (event id, or the
  -- content+cause digest stand-in). REQUIRED for event-sourced observations.
  event_ref       text CHECK (length(event_ref) BETWEEN 1 AND 200),
  -- Envelope provenance refs (§12): trace / correlation / declared origin.
  trace_id        text CHECK (length(trace_id) BETWEEN 1 AND 200),
  correlation_id  text CHECK (length(correlation_id) BETWEEN 1 AND 200),
  declared_origin text NOT NULL CHECK (length(declared_origin) BETWEEN 1 AND 200),
  -- §12 WHO/WHAT created it: the governed Hermes identity that observed.
  created_by      text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 160),
  -- §12 AI-GENERATED flag: observations arrive through the Hermes AI
  -- worker; the database refuses any row that denies it (see the
  -- intelligence-only CHECK below).
  generated_by_ai boolean NOT NULL DEFAULT true,
  -- §9 canonical-truth marking: an observation is never verified state.
  verified        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- §12 provenance coherence (fail closed, database-enforced): an
  -- event-sourced observation MUST cite its event.
  CONSTRAINT cg_hermes_observation_event_source_coherence CHECK (
    (source = 'event' AND event_ref IS NOT NULL) OR source = 'direct'
  ),

  -- §9 canonical-truth law (database-enforced): an observation row is
  -- AI-generated intelligence, NEVER verified state. Canonical truth lives
  -- only in the cg_* ports of record the subject_ref points at.
  CONSTRAINT cg_hermes_observation_intelligence_only CHECK (
    generated_by_ai IS TRUE AND verified IS FALSE
  )
);

COMMENT ON TABLE public.cg_hermes_observation IS
  $comment$V1 wave team R4 (HERMES-PORT) Hermes observation substrate —
  AUTHORIZES the DB-backed Hermes observation port reported as follow-up by
  mission V1-002. One APPEND-ONLY row per observation that arrived at Hermes
  (source direct via a server function, or event via the cg_event
  substrate), carrying the full §12 provenance chain: source + event_ref
  (where it came from), created_by (who/what — the governed Hermes
  identity), observed_at / recorded_at (valid vs record time), trace /
  correlation / declared_origin (envelope refs), and the AI-generated flag.
  The intelligence_only CHECK enforces §9 at the database: observations are
  generated_by_ai = true and verified = false — never canonical truth.
  UPDATE and DELETE are rejected by trigger (observations are never
  rewritten; corrections are new rows). Grants nothing by itself: RLS
  enabled with zero policies, anon/authenticated revoked; service-role
  server functions are the only writer.$comment$;

CREATE INDEX IF NOT EXISTS cg_hermes_observation_tenant_recorded_idx
  ON public.cg_hermes_observation (tenant_id, recorded_at);

CREATE INDEX IF NOT EXISTS cg_hermes_observation_tenant_kind_idx
  ON public.cg_hermes_observation (tenant_id, kind);

CREATE INDEX IF NOT EXISTS cg_hermes_observation_tenant_subject_idx
  ON public.cg_hermes_observation (tenant_id, subject_ref);

-- Idempotent event consumption at the database level: one observation per
-- (tenant, event) — a replayed event delivery collapses onto the row the
-- first delivery recorded (exactly-once intent, §10).
CREATE UNIQUE INDEX IF NOT EXISTS cg_hermes_observation_tenant_event_idx
  ON public.cg_hermes_observation (tenant_id, event_ref)
  WHERE event_ref IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Append-only enforcement (§9/§12: observations are never rewritten)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cg_hermes_observation_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'cg_hermes_observation is append-only: % on % is forbidden (AGENTS §9/§12 — observations are never rewritten; corrections are new rows)',
    TG_OP, TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS cg_hermes_observation_no_rewrite ON public.cg_hermes_observation;
CREATE TRIGGER cg_hermes_observation_no_rewrite
  BEFORE UPDATE OR DELETE ON public.cg_hermes_observation
  FOR EACH ROW EXECUTE FUNCTION public.cg_hermes_observation_append_only();

-- -----------------------------------------------------------------------------
-- 3. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the mission-lease / worker-definitions posture): Hermes
-- observations are AI-workforce intelligence records and run through
-- service-role server functions only. Policies may be authored by a
-- follow-up migration under explicit authorization, never silently.
-- =============================================================================

ALTER TABLE public.cg_hermes_observation ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_hermes_observation FROM anon, authenticated;
GRANT ALL ON public.cg_hermes_observation TO service_role;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • the table exists with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges; service_role holds ALL;
--   • an UPDATE or DELETE on any row raises the append-only exception;
--   • a row with generated_by_ai = false or verified = true is rejected
--     (intelligence-only CHECK);
--   • a source='event' row without event_ref is rejected (coherence CHECK);
--   • a second observation for the same (tenant_id, event_ref) is rejected
--     by the partial unique index (exactly-once event consumption).
-- =============================================================================

-- Component: database/supabase/migrations/20261003000030_coregrid_hermes_observation_substrate.sql
-- Owner: V1 remediation wave team R4 (HERMES-PORT) — Hermes observation port + event wiring
