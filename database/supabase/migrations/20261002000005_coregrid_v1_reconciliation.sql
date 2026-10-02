-- =============================================================================
-- CoreGrid V1 — reconciliation verdict persistence (MISSION-R-14)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000005_coregrid_v1_reconciliation.sql
--
-- Authority:
--   Contract: frontend/src/lib/kernel/reconciliation.ts (V1CAP-005 / J-004 /
--   MISSION-R-14) — the state reconciliation & contradiction engine over
--   cg_observation. Chain: E-029 (REALITY.md §53-55) and G-094 demand that
--   conflicting observations are reconciled by EXPLICIT rules while unknown
--   remains unknown; V1CAP-004 / J-003 supplies the bi-temporal law
--   (style: 20261002000003_coregrid_v1_kernel_bitemporal.sql); J-034 supplies
--   the evidence-class vocabulary; V1CAP-002 / J-001 / G-010 the canonical
--   CoreObject envelope the verdict is stamped through (verdictDraft);
--   MISSION-R-11 the injected object-type registry gate.
--   Style exemplar: 20261002000004_coregrid_v1_memory_tier.sql.
--
-- Scope:
--   cg_reconciliation_verdict — the append-only verdict record: outcome, the
--       declared rule that decided, applied rules, resolution trace, the
--       reconciled ObservationValue, winner, input/superseded/duplicate
--       references, residual uncertainty (losing candidates retained,
--       never destroyed), verdict validity and provenance. Canonical-object
--       rows: envelope columns authored natively (V1CAP-002), object_type
--       pinned to the contract's own type 'core.reconciliation.verdict'.
--   cg_reconciliation_input — one row per observation fact that entered a
--       verdict, retaining the fact's declared evidence class, reliability
--       tier, confidence and bi-temporal coordinates: the explainability
--       substrate of the verdict (resolution_trace names candidates by id;
--       the candidates' decision-bearing fields persist here).
--
-- Append-only law (contract header): reconciliation never mutates, deletes
--   or overwrites a conflicting record; every verdict references its inputs
--   by id and retains every losing candidate. Running reconciliation twice
--   over the same inputs yields the same verdicts — persistence is idempotent
--   append (adapters use ON CONFLICT DO NOTHING), never destructive.
--
-- Outcome law (contract): value is null ONLY for UNRESOLVED_CONTRADICTION,
--   and an unresolved contradiction never names a deciding rule.
--
-- Tenant posture (COND-003 parameterization, UNRESOLVED):
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per applied reality
--   (cg_identity.tenant_id and the worker-definitions exemplar). If COND-003
--   rules uuid (MISSION-R-02), a follow-up migration converts the substrate.
--   Reconciliation is per-tenant by construction; tenant isolation is
--   additionally enforced by the contract before persistence.
--
-- Envelope posture (V1CAP-002 / J-001 / G-010):
--   cg_reconciliation_verdict authors its envelope columns NATIVELY (new
--   table, so the nullable-then-constrain phasing of the kernel envelope
--   migration is unnecessary). created_by is NOT NULL, which makes the
--   all-NULL branch of the atomicity CHECK unsatisfiable: every verdict row
--   is fully stamped or rejected — an anonymous verdict can never exist.
--   object_type is pinned to 'core.reconciliation.verdict' (the registry
--   type the contract's verdictDraft stamps; registration in the kernel
--   object-type registry remains a write-path gate, MISSION-R-11).
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (deny-by-default strongest form;
--     policies come later from the policy team and the RLS battery).
--   • Observation storage itself — kernel/reality.ts observationDraft rows
--     and the cg_observation substrate are owned by the kernel phase; this
--     migration persists verdict-side snapshots only, never observations.
--   • Evidence capture of verdicts (verdictEvidenceClaim) — owned by the
--     evidence lifecycle migration 20261002000008.
--   • Reconciliation SCHEDULING / triggers — verdicts are produced by the
--     pure contract and persisted explicitly; no automatic reconciliation
--     job is authored here.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_reconciliation_verdict — append-only reconciliation verdicts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_reconciliation_verdict (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  verdict_id          text NOT NULL CHECK (length(verdict_id) BETWEEN 1 AND 160),
  subject_entity_id   text NOT NULL CHECK (length(subject_entity_id) BETWEEN 1 AND 160),
  attribute           text NOT NULL CHECK (length(attribute) BETWEEN 1 AND 128),
  -- Declared outcome vocabulary (closed): CONVERGED | RESOLVED | UNKNOWN |
  -- UNRESOLVED_CONTRADICTION. An unknown value stays UNKNOWN through every
  -- path (G-094); an unresolved contradiction is surfaced, never picked.
  outcome             text NOT NULL CHECK (outcome IN
                        ('CONVERGED','RESOLVED','UNKNOWN','UNRESOLVED_CONTRADICTION')),
  -- The declared rule that decided the conflict (null when none did).
  rule_applied        text CHECK (rule_applied IS NULL OR rule_applied IN
                        ('evidence_class_rank','source_reliability',
                         'recency_within_validity','record_time_knowledge')),
  -- Every rule that was enabled for this reconciliation, in applied order.
  applied_rules       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applied_rules) = 'array'),
  -- How the front narrowed, rule by rule (explainability).
  resolution_trace    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(resolution_trace) = 'array'),
  -- The reconciled value: {known:true,value:...} or explicit UNKNOWN
  -- {known:false,value:null} — null ONLY for unresolved contradictions.
  value               jsonb CHECK (value IS NULL OR (
                        jsonb_typeof(value) = 'object'
                        AND jsonb_typeof(value -> 'known') = 'boolean'
                        AND (
                          ((value ->> 'known') = 'false'
                            AND (NOT value ? 'value' OR jsonb_typeof(value -> 'value') = 'null'))
                          OR ((value ->> 'known') = 'true' AND value ? 'value')
                        )
                      )),
  winner_id           text CHECK (winner_id IS NULL OR length(winner_id) BETWEEN 1 AND 160),
  -- Every candidate id that entered the reconciliation for this coordinate.
  inputs              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(inputs) = 'array'),
  -- Candidates retired by a supersession pointer (retained, never deleted).
  superseded          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(superseded) = 'array'),
  -- Duplicate deliveries collapsed behind a representative.
  duplicates          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(duplicates) = 'array'),
  -- Residual uncertainty: losing candidates, unknown-validity candidates,
  -- not-applicable candidates and unresolved ties — surfaced, never picked.
  residual_uncertainty jsonb NOT NULL CHECK (jsonb_typeof(residual_uncertainty) = 'object'),
  -- Verdict validity: the reconciled instant when `at` was given.
  valid_from          timestamptz,
  valid_until         timestamptz,
  valid_time_known    boolean NOT NULL DEFAULT false,
  -- RECORD time of the verdict — supplied by the caller, never sampled.
  recorded_at         timestamptz NOT NULL,
  -- The verdict's own reconciliation provenance (method + rule precedence),
  -- distinct from the envelope provenance column below.
  verdict_provenance  jsonb NOT NULL CHECK (jsonb_typeof(verdict_provenance) = 'object'),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, verdict_id, recorded_at),
  -- Canonical CoreObject envelope (V1CAP-002), authored natively:
  object_type         text,
  schema_version      text,
  status              text,
  created_by          text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 160),
  updated_by          text,
  provenance          jsonb,
  policy_context      jsonb,
  trace_id            text,
  correlation_id      text,
  causation_id        text,
  parent_event_id     text,
  declared_origin     text
);

-- The verdict is THIS contract's canonical object type only.
ALTER TABLE public.cg_reconciliation_verdict
  ADD CONSTRAINT cg_reconciliation_verdict_object_type
  CHECK (object_type = 'core.reconciliation.verdict');

-- The envelope is ATOMIC: a complete envelope or none — and because
-- created_by is NOT NULL, "none" is unsatisfiable, so every row is fully
-- stamped (no anonymous reconciliation verdict, J-001).
ALTER TABLE public.cg_reconciliation_verdict DROP CONSTRAINT IF EXISTS cg_reconciliation_verdict_envelope_atomic;
ALTER TABLE public.cg_reconciliation_verdict
  ADD CONSTRAINT cg_reconciliation_verdict_envelope_atomic CHECK (
    object_type IS NOT NULL AND schema_version IS NOT NULL AND status IS NOT NULL
      AND updated_by IS NOT NULL AND provenance IS NOT NULL
      AND policy_context IS NOT NULL AND trace_id IS NOT NULL AND correlation_id IS NOT NULL
  );

-- G-010: a causation chain root is explicit — continued from a cause or
-- declared as an origin. Unrooted verdicts never exist.
ALTER TABLE public.cg_reconciliation_verdict DROP CONSTRAINT IF EXISTS cg_reconciliation_verdict_envelope_causation_root;
ALTER TABLE public.cg_reconciliation_verdict
  ADD CONSTRAINT cg_reconciliation_verdict_envelope_causation_root CHECK (
    causation_id IS NOT NULL OR parent_event_id IS NOT NULL OR declared_origin IS NOT NULL
  );

ALTER TABLE public.cg_reconciliation_verdict DROP CONSTRAINT IF EXISTS cg_reconciliation_verdict_envelope_format;
ALTER TABLE public.cg_reconciliation_verdict
  ADD CONSTRAINT cg_reconciliation_verdict_envelope_format CHECK (
    length(object_type) BETWEEN 1 AND 128
    AND schema_version ~ '^[0-9]+\.[0-9]+$'
    AND status IN ('draft','active','suspended','archived','deleted')
    AND (updated_by IS NULL OR length(updated_by) BETWEEN 1 AND 160)
    AND (trace_id IS NULL OR length(trace_id) BETWEEN 1 AND 200)
    AND (correlation_id IS NULL OR length(correlation_id) BETWEEN 1 AND 200)
    AND (causation_id IS NULL OR length(causation_id) BETWEEN 1 AND 200)
    AND (parent_event_id IS NULL OR length(parent_event_id) BETWEEN 1 AND 200)
    AND (declared_origin IS NULL OR length(declared_origin) BETWEEN 1 AND 200)
  );

-- Bi-temporal integrity, mirroring the kernel bi-temporal contract
-- (V1CAP-004 / J-003): unknown validity must not claim an interval; known
-- validity requires one; the interval is never empty or inverted.
ALTER TABLE public.cg_reconciliation_verdict DROP CONSTRAINT IF EXISTS cg_reconciliation_verdict_bitemporal;
ALTER TABLE public.cg_reconciliation_verdict
  ADD CONSTRAINT cg_reconciliation_verdict_bitemporal CHECK (
    (valid_time_known = false AND valid_from IS NULL AND valid_until IS NULL)
    OR (valid_time_known = true AND valid_from IS NOT NULL
        AND (valid_until IS NULL OR valid_until > valid_from))
  );

-- Outcome law of the contract: value is null ONLY for unresolved
-- contradictions; an unresolved contradiction never names a deciding rule.
ALTER TABLE public.cg_reconciliation_verdict DROP CONSTRAINT IF EXISTS cg_reconciliation_verdict_outcome_law;
ALTER TABLE public.cg_reconciliation_verdict
  ADD CONSTRAINT cg_reconciliation_verdict_outcome_law CHECK (
    (outcome = 'UNRESOLVED_CONTRADICTION' AND value IS NULL AND rule_applied IS NULL)
    OR (outcome <> 'UNRESOLVED_CONTRADICTION' AND value IS NOT NULL)
  );

COMMENT ON TABLE public.cg_reconciliation_verdict IS
  $comment$MISSION-R-14 / J-004 (V1CAP-005) append-only reconciliation verdict.
  Every verdict records the outcome (CONVERGED / RESOLVED / UNKNOWN /
  UNRESOLVED_CONTRADICTION), the declared rule that decided, the resolution
  trace, the reconciled ObservationValue (explicit UNKNOWN is a first-class
  truth state, G-094), retained losing candidates and residual uncertainty —
  a derived record, never a destructive act. Envelope-bearing (V1CAP-002),
  object_type pinned 'core.reconciliation.verdict', bi-temporally explicit
  (V1CAP-004). Value is null ONLY for unresolved contradictions.$comment$;

CREATE INDEX IF NOT EXISTS cg_reconciliation_verdict_tenant_idx
  ON public.cg_reconciliation_verdict (tenant_id, recorded_at);

CREATE INDEX IF NOT EXISTS cg_reconciliation_verdict_coordinate_idx
  ON public.cg_reconciliation_verdict (tenant_id, subject_entity_id, attribute);

-- -----------------------------------------------------------------------------
-- 2. cg_reconciliation_input — retained decision-bearing input facts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_reconciliation_input (
  verdict_row_id     text NOT NULL CHECK (length(verdict_row_id) BETWEEN 1 AND 160),
  tenant_id          text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  observation_id     text NOT NULL CHECK (length(observation_id) BETWEEN 1 AND 160),
  subject_entity_id  text NOT NULL CHECK (length(subject_entity_id) BETWEEN 1 AND 160),
  attribute          text NOT NULL CHECK (length(attribute) BETWEEN 1 AND 128),
  -- Observation kind (kernel truth hierarchy — never collapsed).
  kind               text NOT NULL CHECK (kind IN
                       ('observed','reported','inferred','predicted','simulated')),
  -- Declared evidence class (J-034 vocabulary) and reliability tier: the
  -- decision-bearing fields the rule cascade consumed.
  evidence_class     text NOT NULL CHECK (evidence_class IN
                       ('direct_observation','generated','simulated',
                        'predicted','derived','attested')),
  reliability        text NOT NULL CHECK (reliability IN
                       ('authoritative','reliable','provisional','unverified')),
  confidence         double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  observed_at        timestamptz,
  recorded_at        timestamptz NOT NULL,
  valid_from         timestamptz,
  valid_until        timestamptz,
  valid_time_known   boolean NOT NULL DEFAULT false,
  supersedes         text CHECK (supersedes IS NULL OR length(supersedes) BETWEEN 1 AND 160),
  PRIMARY KEY (verdict_row_id, observation_id),
  -- Same-tenant integrity: an input can never be bound to a verdict of
  -- another tenant (composite FK, database-enforced).
  CONSTRAINT cg_reconciliation_input_verdict_fk
    FOREIGN KEY (verdict_row_id, tenant_id)
    REFERENCES public.cg_reconciliation_verdict (id, tenant_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.cg_reconciliation_input IS
  $comment$MISSION-R-14 / J-004 retained reconciliation inputs: one row per
  observation fact that entered a verdict, carrying the decision-bearing
  fields the declared rule cascade consumed (evidence class, reliability
  tier, confidence, bi-temporal coordinates). Inputs are retained verbatim
  so the verdict's resolution trace remains explainable after the fact —
  never destroyed, never mutated (append-only resolution law).$comment$;

CREATE INDEX IF NOT EXISTS cg_reconciliation_input_tenant_idx
  ON public.cg_reconciliation_input (tenant_id, observation_id);

-- -----------------------------------------------------------------------------
-- 3. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the memory-tier / worker-definitions substrate posture).
-- Zero policies are deliberate: reconciliation verdicts are tenant-sensitive
-- platform truth records (Constitution §17) and no tenant-scoped policy yet
-- exists that provably cannot widen reads beyond the verdict's tenant —
-- access runs through service-role server functions that enforce the
-- contract's tenant isolation (reconciliation is per-tenant by construction)
-- through the adapter. Policies may be authored by a follow-up migration
-- under explicit authorization, never silently.
-- =============================================================================

ALTER TABLE public.cg_reconciliation_verdict ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_reconciliation_input ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_reconciliation_verdict FROM anon, authenticated;
REVOKE ALL ON public.cg_reconciliation_input FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • both tables exist with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges on either table;
--   • verdict rows reject unstamped inserts (envelope atomicity), unrooted
--     causation chains, non-explicit bi-temporal validity, null values on
--     non-unresolved outcomes, and cross-tenant input bindings (composite FK);
--   • unknown-validity inputs never claim an interval.
-- The TypeScript adapter (frontend/src/lib/adapters/reconciliation-store.adapter.ts)
-- and its suite pin the migration text mechanically until live verification
-- is authorized.
-- =============================================================================