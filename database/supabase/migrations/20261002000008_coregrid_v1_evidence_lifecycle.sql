-- =============================================================================
-- CoreGrid V1 — evidence lifecycle persistence (MISSION-R-90 / MISSION-R-91)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000008_coregrid_v1_evidence_lifecycle.sql
--
-- Authority:
--   Contract: frontend/src/lib/evidence/capture.ts — the canonical evidence
--   capture law (J-034 / V1CAP-059 / MISSION-R-90) and its lifecycle
--   extension (J-033 / V1CAP-058 / MISSION-R-91): sufficiency, staleness,
--   confidence provenance citation, and authorized append-only revocation.
--   Chain: Constitution §9 (Reality vs Intelligence — direct_observation is
--   the ONLY canonical-truth class; quarantine classes can never silently
--   become direct observation), E-017 (authentic provenance for Verification),
--   E-018 invariants 12–13 (REVOKED evidence never silently supports active
--   claims; previously-supported claims are flagged for re-verification),
--   G-040/G-041 (temporal succession is not causation; simulation results
--   never become observed reality), ADR-005 (machine-readable retention
--   policy requirement — every record binds a retention policy id), and the
--   canonical CoreObject envelope (V1CAP-002 / J-001 / G-010) every captured
--   record is stamped through (MISSION-R-11 registry gate injected).
--   Style exemplars: 20261002000004_coregrid_v1_memory_tier.sql (envelope),
--   20261002000003_coregrid_v1_kernel_bitemporal.sql (validity windows).
--
-- Scope:
--   cg_evidence_record        — the append-only captured evidence record:
--       evidence class (the epistemic weight — J-034), prior class (set only
--       on promoted records), claim, bounded confidence WITH its provenance
--       citation basis, declared sufficiency assessment, validity window
--       (staleness law), retention policy binding (ADR-005), lineage,
--       supersession pointer, recorded promotion act, recorded revocation
--       act with its mirror pointer, and the canonical envelope. This is the
--       lifecycle part of the capture contract (capture, promotion,
--       supersession, revocation, sufficiency); the claim-support audit
--       REMAINS a pure consumption gate.
--   cg_evidence_lifecycle_act — one row per recorded lifecycle act
--       (promotion validation act, revocation act, sufficiency assessment):
--       the auditable act ledger, each act pointing at its target record
--       and (when evidence-bearing) at the act evidence record itself.
--
-- Append-only law (contract): capture, promotion, supersession and
--   revocation produce NEW records; an existing record is never mutated or
--   deleted. Superseded and revoked evidence is retained verbatim alongside
--   its successor/mirror. Adapters append idempotently (ON CONFLICT DO
--   NOTHING); no UPDATE/DELETE path is authored for the epistemic fields.
--
-- Canonical-truth law at rest: canonical_truth_eligible is pinned by CHECK
--   to (evidence_class = 'direct_observation' AND no revocation act) — a
--   revoked record is never canonical-truth eligible regardless of class
--   (E-018), and no quarantine-class record can silently carry the flag.
--
-- Class-laundering posture: promotion is an explicit, recorded validation
--   act (validator identity, declared validation method, validation instant —
--   AI validators rejected by the contract). prior_class is set ONLY on
--   promoted records and only to direct_observation (CHECK-pinned); a
--   quarantine class can never launder itself into the substrate.
--
-- Tenant posture (COND-003 parameterization, UNRESOLVED):
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per applied reality
--   (cg_identity.tenant_id and the worker-definitions exemplar). If COND-003
--   rules uuid (MISSION-R-02), a follow-up migration converts the substrate.
--   Provenance origin tenant must match the record tenant (kernel envelope
--   law); supersession, promotion and revocation never cross tenants
--   (contract-enforced before persistence).
--
-- Envelope posture (V1CAP-002 / J-001 / G-010):
--   cg_evidence_record authors its envelope columns NATIVELY — the contract
--   stamps every record through the canonical CoreObject envelope at capture
--   time, so the persisted row IS the stamped record. created_by is NOT NULL,
--   which makes the all-NULL branch of the atomicity CHECK unsatisfiable:
--   every evidence row is fully stamped or rejected — anonymous evidence can
--   never exist. object_type is pinned to 'core.evidence' (EVIDENCE_OBJECT_TYPE).
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (deny-by-default strongest form;
--     policies come later from the policy team and the RLS battery).
--   • The claim-support audit persistence (auditClaimSupport verdicts) — the
--     audit is a pure consumption gate over a record set; persisting audit
--     rows is a separate concern under the same authority.
--   • The pre-existing foundation evidence substrate
--     (cg_foundation_evidence, migration 20260929000000) — untouched; the
--     capture contract composes over it, never rewrites it.
--   • Retention EXECUTION (deletion schedules, expiry jobs) — ADR-005 binds
--     the policy id at capture; schedule enforcement is a separate
--     retention-pipeline concern.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_evidence_record — the append-only captured evidence record
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_evidence_record (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  evidence_type       text NOT NULL CHECK (length(evidence_type) BETWEEN 1 AND 128),
  -- The evidence CLASS carries the epistemic weight (J-034): direct_observation
  -- is the ONLY canonical-truth class; the rest are quarantine classes.
  evidence_class      text NOT NULL CHECK (evidence_class IN
                        ('direct_observation','generated','simulated',
                         'predicted','derived','attested')),
  -- Set only on promoted records: the quarantine class the record was
  -- promoted FROM (never the other way — no class laundering).
  prior_class         text CHECK (prior_class IS NULL OR prior_class IN
                        ('direct_observation','generated','simulated',
                         'predicted','derived','attested')),
  -- The claim content this evidence carries; opaque JSON object.
  claim               jsonb NOT NULL CHECK (jsonb_typeof(claim) = 'object'),
  -- Bounded scale ([0,1], kernel isConfidence law); usability additionally
  -- requires the provenance citation (confidence_basis) at consumption.
  confidence          double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  confidence_basis    text CHECK (confidence_basis IS NULL OR length(confidence_basis) BETWEEN 1 AND 500),
  observed_at         timestamptz,
  recorded_at         timestamptz NOT NULL,
  captured_by         text NOT NULL CHECK (length(captured_by) BETWEEN 1 AND 160),
  captured_at         timestamptz NOT NULL,
  source_ref          text CHECK (source_ref IS NULL OR length(source_ref) BETWEEN 1 AND 200),
  -- Canonical-truth gate (Constitution §9): true ONLY for active
  -- direct_observation records — CHECK-pinned so a revoked or quarantine
  -- row can never carry the flag.
  canonical_truth_eligible boolean NOT NULL DEFAULT false,
  lineage             jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lineage) = 'array'),
  -- Set only on supersession successors: the evidence id this record
  -- supersedes (append-only — the retained record is never mutated).
  supersedes          text CHECK (supersedes IS NULL OR length(supersedes) BETWEEN 1 AND 160),
  -- Set only on promoted records: the recorded validation act.
  promotion           jsonb CHECK (promotion IS NULL OR jsonb_typeof(promotion) = 'object'),
  -- Retention policy binding (ADR-005 machine-readable policy requirement).
  retention_policy_id text NOT NULL CHECK (length(retention_policy_id) BETWEEN 1 AND 160),
  -- Declared sufficiency assessment (J-033), when the capture declared one.
  sufficiency         jsonb CHECK (sufficiency IS NULL OR jsonb_typeof(sufficiency) = 'object'),
  -- Declared validity window (half-open, kernel V1CAP-004 law); evidence
  -- past valid_until is STALE — surfaced, never silently served.
  valid_from          timestamptz,
  valid_until         timestamptz,
  -- Set only on revocation-mirror records: the recorded revocation act
  -- (authorized, append-only — the original record is retained verbatim).
  revocation          jsonb CHECK (revocation IS NULL OR jsonb_typeof(revocation) = 'object'),
  -- Set only on revocation-mirror records: the evidence id this record revokes.
  revokes             text CHECK (revokes IS NULL OR length(revokes) BETWEEN 1 AND 160),
  UNIQUE (id, tenant_id),
  -- Canonical CoreObject envelope (V1CAP-002), authored natively — the row
  -- IS the envelope-stamped record:
  object_type         text NOT NULL,
  schema_version      text NOT NULL,
  status              text NOT NULL,
  created_by          text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 160),
  updated_by          text NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 160),
  provenance          jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  policy_context      jsonb NOT NULL CHECK (jsonb_typeof(policy_context) = 'object'),
  trace_id            text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 200),
  correlation_id      text NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 200),
  causation_id        text,
  parent_event_id     text,
  declared_origin     text,
  -- Append-only supersession: a successor corrects only a record of its OWN
  -- tenant (composite FK on the same table; NULL supersedes passes).
  CONSTRAINT cg_evidence_record_supersedes_fk
    FOREIGN KEY (supersedes, tenant_id)
    REFERENCES public.cg_evidence_record (id, tenant_id)
    ON DELETE RESTRICT,
  -- A revocation mirror points only at a record of its OWN tenant.
  CONSTRAINT cg_evidence_record_revokes_fk
    FOREIGN KEY (revokes, tenant_id)
    REFERENCES public.cg_evidence_record (id, tenant_id)
    ON DELETE RESTRICT,
  -- A record never supersedes/revokes itself.
  CONSTRAINT cg_evidence_record_no_self_supersede CHECK (supersedes IS NULL OR supersedes <> id),
  CONSTRAINT cg_evidence_record_no_self_revoke CHECK (revokes IS NULL OR revokes <> id),
  -- The revocation act and its mirror pointer are inseparable: a mirror row
  -- carries both or neither.
  CONSTRAINT cg_evidence_record_revocation_pair CHECK (
    (revocation IS NULL) = (revokes IS NULL)
  ),
  -- Promotion posture: prior_class exists ONLY on promoted records, which
  -- are always direct_observation and always carry the recorded act.
  CONSTRAINT cg_evidence_record_promotion_posture CHECK (
    (prior_class IS NULL AND promotion IS NULL)
    OR (prior_class IS NOT NULL AND promotion IS NOT NULL AND evidence_class = 'direct_observation')
  ),
  -- Validity windows are strictly ordered when both bounds are declared.
  CONSTRAINT cg_evidence_record_validity_window CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from
  )
);

-- The canonical-truth flag is DERIVED at rest, never free-form: active
-- direct_observation only (Constitution §9 / E-018 — revoked evidence is
-- never canonical-truth eligible regardless of class).
ALTER TABLE public.cg_evidence_record DROP CONSTRAINT IF EXISTS cg_evidence_record_canonical_truth;
ALTER TABLE public.cg_evidence_record
  ADD CONSTRAINT cg_evidence_record_canonical_truth CHECK (
    canonical_truth_eligible = (evidence_class = 'direct_observation' AND revocation IS NULL)
  );

-- The record is THIS substrate's canonical object type only.
ALTER TABLE public.cg_evidence_record
  ADD CONSTRAINT cg_evidence_record_object_type CHECK (object_type = 'core.evidence');

-- The envelope is ATOMIC: a complete envelope or none — and because
-- created_by is NOT NULL, "none" is unsatisfiable, so every row is fully
-- stamped (no anonymous evidence, J-034/J-001).
ALTER TABLE public.cg_evidence_record DROP CONSTRAINT IF EXISTS cg_evidence_record_envelope_atomic;
ALTER TABLE public.cg_evidence_record
  ADD CONSTRAINT cg_evidence_record_envelope_atomic CHECK (
    object_type IS NOT NULL AND schema_version IS NOT NULL AND status IS NOT NULL
      AND created_by IS NOT NULL AND updated_by IS NOT NULL AND provenance IS NOT NULL
      AND policy_context IS NOT NULL AND trace_id IS NOT NULL AND correlation_id IS NOT NULL
  );

-- G-010: a causation chain root is explicit — continued from a cause or
-- declared as an origin. Unrooted evidence records never exist.
ALTER TABLE public.cg_evidence_record DROP CONSTRAINT IF EXISTS cg_evidence_record_envelope_causation_root;
ALTER TABLE public.cg_evidence_record
  ADD CONSTRAINT cg_evidence_record_envelope_causation_root CHECK (
    causation_id IS NOT NULL OR parent_event_id IS NOT NULL OR declared_origin IS NOT NULL
  );

ALTER TABLE public.cg_evidence_record DROP CONSTRAINT IF EXISTS cg_evidence_record_envelope_format;
ALTER TABLE public.cg_evidence_record
  ADD CONSTRAINT cg_evidence_record_envelope_format CHECK (
    length(object_type) BETWEEN 1 AND 128
    AND schema_version ~ '^[0-9]+\.[0-9]+$'
    AND status IN ('draft','active','suspended','archived','deleted')
    AND (trace_id IS NOT NULL AND length(trace_id) BETWEEN 1 AND 200)
    AND (correlation_id IS NOT NULL AND length(correlation_id) BETWEEN 1 AND 200)
    AND (causation_id IS NULL OR length(causation_id) BETWEEN 1 AND 200)
    AND (parent_event_id IS NULL OR length(parent_event_id) BETWEEN 1 AND 200)
    AND (declared_origin IS NULL OR length(declared_origin) BETWEEN 1 AND 200)
  );

COMMENT ON TABLE public.cg_evidence_record IS
  $comment$MISSION-R-90 / J-034 (V1CAP-059) + MISSION-R-91 / J-033 (V1CAP-058)
  append-only captured evidence: the evidence CLASS carries the epistemic
  weight — direct_observation is the ONLY canonical-truth class (Constitution
  §9), quarantine classes (generated/simulated/predicted/derived/attested)
  inform Intelligence and proposals only and become direct observation solely
  through an explicit recorded promotion act. No class laundering, no
  anonymous evidence, append-only lifecycle (promotion, supersession,
  authorized revocation — the original record is retained verbatim), ADR-005
  retention-policy binding, envelope-stamped (V1CAP-002, object_type pinned
  'core.evidence'), validity-window staleness (V1CAP-004). REVOKED evidence
  is never canonical-truth eligible (E-018).$comment$;

CREATE INDEX IF NOT EXISTS cg_evidence_record_tenant_idx
  ON public.cg_evidence_record (tenant_id, evidence_class);

CREATE INDEX IF NOT EXISTS cg_evidence_record_retention_idx
  ON public.cg_evidence_record (tenant_id, retention_policy_id);

CREATE INDEX IF NOT EXISTS cg_evidence_record_supersedes_idx
  ON public.cg_evidence_record (tenant_id, supersedes);

CREATE INDEX IF NOT EXISTS cg_evidence_record_revokes_idx
  ON public.cg_evidence_record (tenant_id, revokes);

CREATE INDEX IF NOT EXISTS cg_evidence_record_window_idx
  ON public.cg_evidence_record (tenant_id, valid_until);

-- -----------------------------------------------------------------------------
-- 2. cg_evidence_lifecycle_act — the auditable lifecycle act ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_evidence_lifecycle_act (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- The evidence record this act acts upon.
  target_evidence_id  text NOT NULL CHECK (length(target_evidence_id) BETWEEN 1 AND 160),
  -- promotion = recorded validation act (J-034); revocation = authorized
  -- append-only act (E-018); sufficiency_assessment = declared J-033
  -- assessment.
  act_kind            text NOT NULL CHECK (act_kind IN
                        ('promotion','revocation','sufficiency_assessment')),
  -- The human (never AI — Constitution §21) actor behind the act.
  actor_id            text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 160),
  -- The recorded act payload (validation act / revocation act / assessment).
  act                 jsonb NOT NULL CHECK (jsonb_typeof(act) = 'object'),
  -- The evidence-bearing act record id, when the act is itself evidence
  -- (promotion validation acts and revocation acts are — J-034/E-018).
  act_evidence_id     text CHECK (act_evidence_id IS NULL OR length(act_evidence_id) BETWEEN 1 AND 160),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  CONSTRAINT cg_evidence_lifecycle_act_target_fk
    FOREIGN KEY (target_evidence_id, tenant_id)
    REFERENCES public.cg_evidence_record (id, tenant_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.cg_evidence_lifecycle_act IS
  $comment$MISSION-R-91 / J-033 auditable evidence lifecycle act ledger: one
  row per promotion validation act, authorized revocation act and declared
  sufficiency assessment, each pointing at its target record and (when
  evidence-bearing) at the act evidence record itself. Promotion requires a
  non-AI validator and a declared validation method; revocation requires an
  explicit authorization reference (no anonymous revocation, no self-granted
  authority). Acts are records, never mutations — the target evidence is
  never altered in place (append-only law).$comment$;

CREATE INDEX IF NOT EXISTS cg_evidence_lifecycle_act_tenant_idx
  ON public.cg_evidence_lifecycle_act (tenant_id, recorded_at);

CREATE INDEX IF NOT EXISTS cg_evidence_lifecycle_act_target_idx
  ON public.cg_evidence_lifecycle_act (target_evidence_id, act_kind);

-- -----------------------------------------------------------------------------
-- 3. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the memory-tier / worker-definitions substrate posture).
-- Zero policies are deliberate: evidence is the substrate of Verification
-- and canonical truth (Constitution §9/§17) and no tenant-scoped policy yet
-- exists that provably cannot widen reads beyond the record's tenant and the
-- capture contract's gates — access runs through service-role server
-- functions that enforce the capture/consumption contract through the
-- adapter. Policies may be authored by a follow-up migration under explicit
-- authorization, never silently.
-- =============================================================================

ALTER TABLE public.cg_evidence_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_evidence_lifecycle_act ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_evidence_record FROM anon, authenticated;
REVOKE ALL ON public.cg_evidence_lifecycle_act FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • both tables exist with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges on either table;
--   • evidence rows reject unstamped inserts (envelope atomicity), unrooted
--     causation chains, canonical-truth flags on revoked/quarantine rows,
--     self-superseding or self-revoking records, promotion postures without
--     a recorded act, and inverted validity windows;
--   • lifecycle acts reject cross-tenant targets (composite FK) and record
--     their actor and instant.
-- The TypeScript adapter (frontend/src/lib/adapters/evidence-capture-store.adapter.ts)
-- and its suite pin the migration text mechanically until live verification
-- is authorized.
-- =============================================================================