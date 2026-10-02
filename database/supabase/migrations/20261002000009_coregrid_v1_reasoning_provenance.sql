-- =============================================================================
-- CoreGrid V1 — reasoning provenance / intelligence-snapshot persistence
-- (MISSION-R-33)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000009_coregrid_v1_reasoning_provenance.sql
--
-- Authority:
--   Contract: frontend/src/lib/ai-gateway/reasoning-provenance.ts (J-015 /
--   V1CAP-029 / MISSION-R-33) — the INTELLIGENCE SNAPSHOT every AI output
--   leaves the gateway with. Chain: Constitution §9 (Reality vs Intelligence —
--   a snapshot is derived-intelligence provenance, never canonical truth),
--   §12 (data provenance), §20 (AI gateway), §21 (AI output trust — AI output
--   is untrusted by default); J-034 the quarantine evidence class "generated"
--   (E-017: AI output can never silently become direct observation); V1CAP-002
--   / J-001 / G-010 the canonical CoreObject envelope the snapshot is stamped
--   onto persistent kernel objects with; J-011 the context trace id
--   (context-assembly); metering Part 49 the usage attribution.
--   Style exemplar: 20261002000004_coregrid_v1_memory_tier.sql.
--
-- Scope:
--   cg_reasoning_provenance_snapshot — one row per built intelligence
--       snapshot: WHICH model (registry id + vendor-neutral provider class),
--       WHICH context version (trace id + deterministic content digest), the
--       routing rationale chain, token/cost attribution, the deterministic
--       output digest and self-digest (snapshot_id), and the kernel
--       provenance fields with generated_by_ai pinned true / verified pinned
--       false. Canonical-object rows: envelope columns authored natively
--       (V1CAP-002), object_type pinned to 'core.intelligence.snapshot'.
--
-- Intelligence-at-rest law (Constitution §9 / §21):
--   The row persists the snapshot METADATA only — the AI output itself is
--   never stored, only its deterministic digest (output_digest); the
--   generated_by_ai / verified markers are CHECK-pinned (true / false) so a
--   snapshot row can never present AI provenance as verified canonical
--   observation. Promotion of AI-derived material is Evidence's recorded act,
--   never this table's.
--
-- Temporal posture: a snapshot is an instant record — recorded_at is the
--   supplied snapshot instant (never wall-clock sampled). The contract
--   declares NO validity window on a snapshot (supersession happens by
--   producing a new snapshot), so no bi-temporal validity columns are
--   authored; adding one later is an additive migration.
--
-- Tenant posture (COND-003 parameterization, UNRESOLVED):
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per applied reality
--   (cg_identity.tenant_id and the worker-definitions exemplar). If COND-003
--   rules uuid (MISSION-R-02), a follow-up migration converts the substrate.
--   The snapshot's attribution tenant (attribution.tenantRef) and the kernel
--   provenance origin tenant must agree (CHECK-pinned).
--
-- Envelope posture (V1CAP-002 / J-001 / G-010):
--   Envelope columns are authored NATIVELY (new table, so the
--   nullable-then-constrain phasing of the kernel envelope migration is
--   unnecessary). created_by is NOT NULL, which makes the all-NULL branch of
--   the atomicity CHECK unsatisfiable: every snapshot row is fully stamped or
--   rejected — an anonymous intelligence snapshot can never exist.
--   schema_version doubles as the envelope schema_version and the snapshot
--   contract version (both are the snapshot's own "1.0").
--
-- Retention posture (ADR-005 / RETENTION_POLICY_SCHEDULE.json):
--   Record family: 'ai-snapshot' (policy RP-AISNAP-EDU / RP-AISNAP-ORG,
--   180-day duration on clock created_at). This table carries the OPERATIONAL
--   METADATA subset the policy retains in full (model, tokens, latency-class
--   digests, routing rationale) and NO personal conversation content — the
--   output is persisted as a SHA-256 digest only. Classification: personal
--   (identity references: actor_ref / agent_ref), metadata-only payload.
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (deny-by-default strongest form;
--     policies come later from the policy team and the RLS battery).
--   • AI output storage itself — the output payload is digested, never
--     persisted here (Constitution §19 minimization).
--   • Cost roll-ups over snapshots — owned by the cost-attribution migration
--     20261002000010 (metering).
--   • Evidence promotion of AI output — owned by the evidence lifecycle
--     migration 20261002000008 (E-017).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_reasoning_provenance_snapshot — append-only intelligence snapshots
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_reasoning_provenance_snapshot (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- Deterministic self-digest of the whole snapshot body (the contract's
  -- snapshotId); the row id IS the snapshot id — persistence is idempotent
  -- on content, never on guessable sequence.
  snapshot_id         text NOT NULL CHECK (snapshot_id ~ '^sha256:[0-9a-f]{64}$'),
  -- Snapshot contract version (= envelope schema_version).
  schema_version      text NOT NULL CHECK (schema_version ~ '^[0-9]+\.[0-9]+$'),
  -- J-034 quarantine class, pinned: AI output is "generated" evidence.
  evidence_class      text NOT NULL CHECK (evidence_class = 'generated'),
  generated_by_ai     boolean NOT NULL CHECK (generated_by_ai = true),
  -- WHICH model: registry model id + vendor-neutral provider class (§25;
  -- null on the legacy declared path).
  model_id            text NOT NULL CHECK (length(model_id) BETWEEN 1 AND 200),
  model_provider_class text CHECK (model_provider_class IS NULL OR length(model_provider_class) BETWEEN 1 AND 200),
  -- WHICH context version: explicit null when none was declared — never
  -- silently assumed empty (J-011).
  context_trace_id    text CHECK (context_trace_id IS NULL OR length(context_trace_id) BETWEEN 1 AND 200),
  context_content_digest text CHECK (context_content_digest IS NULL OR length(context_content_digest) BETWEEN 1 AND 200),
  -- The routing rationale chain: every policy decision that produced the
  -- output (registry route resolution, requirement filtering, health gates,
  -- fallback attempts, or the explicit legacy declared path).
  routed_via_registry boolean NOT NULL,
  routing_rationale   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(routing_rationale) = 'array'),
  -- WHO the output is attributed to (tenant/actor/agent/mission/purpose).
  actor_ref           text NOT NULL CHECK (length(actor_ref) BETWEEN 1 AND 200),
  agent_ref           text CHECK (agent_ref IS NULL OR length(agent_ref) BETWEEN 1 AND 200),
  mission_ref         text CHECK (mission_ref IS NULL OR length(mission_ref) BETWEEN 1 AND 200),
  purpose             text NOT NULL CHECK (length(purpose) BETWEEN 1 AND 200),
  -- Token/cost attribution of THIS output (metering Part 49); unpriced
  -- snapshots carry NULL cost, never a guessed number.
  tokens_in           bigint NOT NULL CHECK (tokens_in >= 0),
  tokens_out          bigint NOT NULL CHECK (tokens_out >= 0),
  estimated_cost_usd  double precision CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  -- Deterministic digest of the exact output payload — the output itself is
  -- NEVER stored here (Constitution §19 minimization).
  output_digest       text NOT NULL CHECK (output_digest ~ '^sha256:[0-9a-f]{64}$'),
  -- Kernel provenance fields (V1CAP-002 shape). verified is PINNED false:
  -- AI output is untrusted by default (§21); only a recorded validation act
  -- verifies it, and that act lives in the evidence substrate.
  provenance_source   text NOT NULL CHECK (length(provenance_source) BETWEEN 1 AND 200),
  provenance_source_ref text CHECK (provenance_source_ref IS NULL OR length(provenance_source_ref) BETWEEN 1 AND 200),
  recorded_by         text CHECK (recorded_by IS NULL OR length(recorded_by) BETWEEN 1 AND 200),
  origin_tenant_id    text NOT NULL CHECK (length(origin_tenant_id) BETWEEN 1 AND 128),
  verified            boolean NOT NULL CHECK (verified = false),
  recorded_at         timestamptz NOT NULL,
  UNIQUE (id, tenant_id),
  -- The snapshot id is its own content identity: a row's id can never
  -- disagree with the digest it claims to persist.
  CONSTRAINT cg_reasoning_provenance_snapshot_id_is_digest CHECK (id = snapshot_id),
  -- The attribution tenant and the kernel provenance origin tenant are the
  -- same tenant (snapshot provenance is stamped from the attribution).
  CONSTRAINT cg_reasoning_provenance_snapshot_tenant_agreement CHECK (tenant_id = origin_tenant_id),
  -- Canonical CoreObject envelope (V1CAP-002), authored natively:
  object_type         text,
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

-- The snapshot is THIS contract's canonical object type only.
ALTER TABLE public.cg_reasoning_provenance_snapshot
  ADD CONSTRAINT cg_reasoning_provenance_snapshot_object_type
  CHECK (object_type = 'core.intelligence.snapshot');

-- The envelope is ATOMIC: a complete envelope or none — and because
-- created_by is NOT NULL, "none" is unsatisfiable, so every row is fully
-- stamped (no anonymous intelligence snapshot, J-001).
ALTER TABLE public.cg_reasoning_provenance_snapshot DROP CONSTRAINT IF EXISTS cg_reasoning_provenance_snapshot_envelope_atomic;
ALTER TABLE public.cg_reasoning_provenance_snapshot
  ADD CONSTRAINT cg_reasoning_provenance_snapshot_envelope_atomic CHECK (
    object_type IS NOT NULL AND status IS NOT NULL
      AND updated_by IS NOT NULL AND provenance IS NOT NULL
      AND policy_context IS NOT NULL AND trace_id IS NOT NULL AND correlation_id IS NOT NULL
  );

-- G-010: a causation chain root is explicit — continued from a cause or
-- declared as an origin. Unrooted snapshots never exist.
ALTER TABLE public.cg_reasoning_provenance_snapshot DROP CONSTRAINT IF EXISTS cg_reasoning_provenance_snapshot_envelope_causation_root;
ALTER TABLE public.cg_reasoning_provenance_snapshot
  ADD CONSTRAINT cg_reasoning_provenance_snapshot_envelope_causation_root CHECK (
    causation_id IS NOT NULL OR parent_event_id IS NOT NULL OR declared_origin IS NOT NULL
  );

ALTER TABLE public.cg_reasoning_provenance_snapshot DROP CONSTRAINT IF EXISTS cg_reasoning_provenance_snapshot_envelope_format;
ALTER TABLE public.cg_reasoning_provenance_snapshot
  ADD CONSTRAINT cg_reasoning_provenance_snapshot_envelope_format CHECK (
    length(object_type) BETWEEN 1 AND 128
    AND status IN ('draft','active','suspended','archived','deleted')
    AND (updated_by IS NULL OR length(updated_by) BETWEEN 1 AND 160)
    AND (trace_id IS NULL OR length(trace_id) BETWEEN 1 AND 200)
    AND (correlation_id IS NULL OR length(correlation_id) BETWEEN 1 AND 200)
    AND (causation_id IS NULL OR length(causation_id) BETWEEN 1 AND 200)
    AND (parent_event_id IS NULL OR length(parent_event_id) BETWEEN 1 AND 200)
    AND (declared_origin IS NULL OR length(declared_origin) BETWEEN 1 AND 200)
  );

COMMENT ON TABLE public.cg_reasoning_provenance_snapshot IS
  $comment$MISSION-R-33 / J-015 (V1CAP-029) intelligence-snapshot persistence:
  every AI output that leaves the gateway carries an immutable record of WHICH
  model produced it, WHICH context version it drew on, WHICH routing decision
  produced it, its token/cost attribution, and deterministic digests of the
  output and the snapshot body. Derived-intelligence provenance, never
  canonical truth (Constitution §9): generated_by_ai CHECK-pinned true and
  verified CHECK-pinned false — AI output is untrusted by default (§21) and
  the output payload is never stored, only its SHA-256 digest (§19
  minimization). Envelope-bearing (V1CAP-002), object_type pinned
  'core.intelligence.snapshot'. Record family 'ai-snapshot'
  (RETENTION_POLICY_SCHEDULE.json: RP-AISNAP-EDU/RP-AISNAP-ORG).$comment$;

CREATE INDEX IF NOT EXISTS cg_reasoning_provenance_snapshot_tenant_idx
  ON public.cg_reasoning_provenance_snapshot (tenant_id, recorded_at);

CREATE INDEX IF NOT EXISTS cg_reasoning_provenance_snapshot_model_idx
  ON public.cg_reasoning_provenance_snapshot (tenant_id, model_id, recorded_at);

-- -----------------------------------------------------------------------------
-- 2. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the memory-tier / worker-definitions substrate posture).
-- Zero policies are deliberate: intelligence snapshots are tenant-sensitive
-- AI provenance records (Constitution §17/§20/§21) and no tenant-scoped
-- policy yet exists that provably cannot widen reads beyond the snapshot's
-- tenant — access runs through service-role server functions that enforce
-- the contract's attribution (snapshots are per-tenant by construction)
-- through the adapter. Policies may be authored by a follow-up migration
-- under explicit authorization, never silently.
-- =============================================================================

ALTER TABLE public.cg_reasoning_provenance_snapshot ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_reasoning_provenance_snapshot FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • the table exists with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges on the table;
--   • snapshot rows reject unstamped inserts (envelope atomicity), unrooted
--     causation chains, non-digest ids, tenant/provenance disagreement, and
--     any verified=true or generated_by_ai=false mutation of the markers.
-- The TypeScript adapter (frontend/src/lib/adapters/reasoning-provenance-store.adapter.ts)
-- and its suite pin the migration text mechanically until live verification
-- is authorized.
-- =============================================================================
