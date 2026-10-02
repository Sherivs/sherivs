-- =============================================================================
-- CoreGrid V1 — governed tool runtime persistence: registration substrate and
-- invocation audit (J-008 / V1CAP-056, MISSION-R-62, wave 3)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000012_coregrid_v1_tool_runtime.sql
--
-- Authority:
--   Contract: frontend/src/lib/workforce/tool-runtime.ts (J-008 / V1CAP-056 /
--   MISSION-R-62, wave 3) — the governed tool runtime & sandbox, THE ONLY way
--   workers execute tools. Chain: E-035 (capability gate: registered AND
--   declared, evaluated fresh — no cached grant survives a revocation), J-007
--   (lease mediation: handles, never secrets; invocation records carry lease
--   handle REFERENCES only), E-045 / Constitution §21 (delegation bounding:
--   valid as-of the invocation instant, action bounded), AGENTS §29 (every
--   invocation — executed, rejected or failed — is an audited record with
--   REDACTED params), Constitution §17/§28.
--   Style exemplar: 20261002000004_coregrid_v1_memory_tier.sql.
--
-- Scope:
--   cg_tool_runtime_tool       — the persisted registration surface: tool id,
--       contract text, required capability ids, risk class, credential
--       requirements (REFS + purposes only — never secret material),
--       sensitive param keys, rate/budget guards, and the registration
--       instant. The executor function is code, not data — deliberately NOT
--       persisted.
--   cg_tool_runtime_invocation — the append-only invocation record ledger:
--       ONE row per invocation — executed, rejected or failed — with the
--       typed reason code (closed vocabulary), redacted params, lease handle
--       REFERENCES (never handles, never secrets), result summary (never
--       secret material — the contract's non-observability probe refuses
--       recording it), and the failure surface for lease invalidation.
--
-- Non-observability law at rest (J-007 posture): params are recorded only in
--   their REDACTED form (the contract redacted them before the record
--   exists), and a summary carrying live secret material is never recorded —
--   the runtime fails that invocation closed with
--   result_secret_material_detected and the row carries no summary. The
--   substrate adds a length bound, never a content guarantee: minimization
--   remains the contract's enforcement, the DB the second wall.
--
-- Envelope posture:
--   These tables are registry rows and AUDIT records bound to runtime events,
--   NOT canonical CoreObjects: the worker/mission/delegation objects the
--   runtime gates against carry their own envelopes in their own substrates.
--   No envelope columns are authored here (mirrors cg_memory_access_log,
--   which is audit, not object).
--
-- Tenant posture (COND-003 parameterization, UNRESOLVED):
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per applied reality
--   (cg_identity.tenant_id and the worker-definitions exemplar). If COND-003
--   rules uuid (MISSION-R-02), a follow-up migration converts the substrate.
--   The runtime refuses cross-tenant invocations (contract step 4), so every
--   persisted record is single-tenant by construction.
--
-- Retention posture (ADR-005 / RETENTION_POLICY_SCHEDULE.json):
--   cg_tool_runtime_invocation is an audit record family row (identity refs,
--   redacted params): record family 'audit' (policies RP-AUDIT-EDU /
--   RP-AUDIT-ORG / RP-AUDIT-PLT, 2555-day duration on clock recorded_at) —
--   decision facts (outcome, reason, actor refs, timestamps) are never
--   forgotten per the family's tombstone invariant.
--   cg_tool_runtime_tool carries NO subject-identifying personal values by
--   design (tool/credential/capability references only): governance-config
--   classification, non-personal (schedule family 'governance-config',
--   policyId null).
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (deny-by-default strongest form;
--     policies come later from the policy team and the RLS battery).
--   • Worker definitions, capability registry, credential vault and
--     delegation contracts — owned by their own substrates
--     (20261002000002 worker definitions and the workforce/ security
--     phases); the runtime gates against them, it does not persist them.
--   • Executor code storage — the executor is an injected function; the
--     substrate persists the declaration's data fields only.
--   • Rate/budget guard STATE (windows, counters) — guards are declarable
--     per tool and persisted here as declarations; their live counters stay
--     runtime state (V1 in-memory), a separate persistence concern.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_tool_runtime_tool — the persisted registration surface
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_tool_runtime_tool (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- id IS the toolId (the sandbox's registered execution boundary identity).
  tool_id             text NOT NULL CHECK (length(tool_id) BETWEEN 1 AND 200),
  contract            text NOT NULL CHECK (length(contract) BETWEEN 1 AND 500),
  required_capability_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_capability_ids) = 'array'),
  risk_class          text NOT NULL CHECK (risk_class IN ('low','medium','high','critical')),
  -- Credential requirements: credentialRef + declared purpose + lease
  -- bounds. REFERENCE data only — never secret material (J-007).
  credential_requirements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(credential_requirements) = 'array'),
  sensitive_param_keys jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sensitive_param_keys) = 'array'),
  rate_guard          jsonb CHECK (rate_guard IS NULL OR jsonb_typeof(rate_guard) = 'object'),
  budget_guard        jsonb CHECK (budget_guard IS NULL OR jsonb_typeof(budget_guard) = 'object'),
  registered_at_ms    bigint NOT NULL,
  registered_at       timestamptz NOT NULL,
  UNIQUE (tenant_id, tool_id),
  CONSTRAINT cg_tool_runtime_tool_id_is_tool CHECK (id = tool_id)
);

COMMENT ON TABLE public.cg_tool_runtime_tool IS
  $comment$J-008 / V1CAP-056 (MISSION-R-62) persisted governed-tool
  registration: the sandbox surface a worker may invoke — contract text,
  required capability ids (registry-checked fresh at invocation), risk class
  bounding which workers may call it, credential requirements (refs and
  purposes only — the runtime never sees raw secret material, J-007),
  sensitive param keys (redaction at the record boundary) and rate/budget
  guard declarations. The executor function is code, not data, and is
  deliberately not persisted.$comment$;

CREATE INDEX IF NOT EXISTS cg_tool_runtime_tool_tenant_idx
  ON public.cg_tool_runtime_tool (tenant_id, registered_at);

-- -----------------------------------------------------------------------------
-- 2. cg_tool_runtime_invocation — append-only invocation record ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_tool_runtime_invocation (
  record_id          text PRIMARY KEY CHECK (length(record_id) BETWEEN 1 AND 300),
  tenant_id          text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  at_ms              bigint NOT NULL,
  at                 timestamptz NOT NULL,
  -- Worker identity may be absent on a pre-resolution rejection (invalid
  -- input before the worker resolved); the attempt is still audited.
  worker_id          text CHECK (worker_id IS NULL OR length(worker_id) BETWEEN 1 AND 200),
  worker_identity_ref text CHECK (worker_identity_ref IS NULL OR length(worker_identity_ref) BETWEEN 1 AND 200),
  tool_id            text NOT NULL CHECK (length(tool_id) BETWEEN 1 AND 200),
  required_capability_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_capability_ids) = 'array'),
  -- Lease handle REFERENCES only — never handles, never secrets (J-007).
  lease_handle_refs  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lease_handle_refs) = 'array'),
  delegation_ref     text CHECK (delegation_ref IS NULL OR length(delegation_ref) BETWEEN 1 AND 200),
  outcome            text NOT NULL CHECK (outcome IN ('executed','rejected','failed')),
  -- The closed typed vocabulary: every denial names its axis (E-035 / J-007 /
  -- E-045) — 14 rejection codes + 3 execution-failure codes.
  reason_code        text CHECK (reason_code IS NULL OR reason_code IN
                       ('invalid_invocation_input','tool_not_registered',
                        'cross_tenant_invocation_denied','worker_lifecycle_unusable',
                        'capability_not_registered','capability_not_declared',
                        'capability_risk_escalation_denied','tool_risk_class_bounding_denied',
                        'delegation_denied','delegation_action_denied',
                        'tool_rate_guard_exceeded','tool_budget_guard_exceeded',
                        'param_secret_material_detected','credential_lease_denied',
                        'lease_invalidated','tool_execution_failed',
                        'result_secret_material_detected')),
  reason_detail      text CHECK (reason_detail IS NULL OR length(reason_detail) BETWEEN 1 AND 2000),
  lease_invalidated  boolean NOT NULL DEFAULT false,
  -- REDACTED params only (sensitive keys replaced before the record exists).
  redacted_params    jsonb NOT NULL CHECK (jsonb_typeof(redacted_params) = 'object'),
  result_summary     text CHECK (result_summary IS NULL OR length(result_summary) BETWEEN 1 AND 100000),
  evidence_ref       text CHECK (evidence_ref IS NULL OR length(evidence_ref) BETWEEN 1 AND 200),
  -- Outcome law: an executed invocation names no rejection/failure reason; a
  -- rejected or failed invocation always names one.
  CONSTRAINT cg_tool_runtime_invocation_outcome_law CHECK (
    (outcome = 'executed' AND reason_code IS NULL)
    OR (outcome <> 'executed' AND reason_code IS NOT NULL)
  ),
  -- Lease invalidation is only ever the failure path's marker.
  CONSTRAINT cg_tool_runtime_invocation_lease_law CHECK (
    lease_invalidated = false OR (outcome = 'failed' AND reason_code = 'lease_invalidated')
  )
);

COMMENT ON TABLE public.cg_tool_runtime_invocation IS
  $comment$J-008 / V1CAP-056 (MISSION-R-62) append-only invocation record:
  ONE row per tool invocation — executed, rejected or failed — with the typed
  reason code (closed vocabulary, every denial names its axis), REDACTED
  params, lease handle REFERENCES (never handles, never secrets — J-007), and
  the lease-invalidation failure surface (rotation/revocation is surfaced,
  never retried with a stale handle). Nothing executes outside the gate and
  every attempt leaves evidence (AGENTS §29). Record family 'audit'
  (RETENTION_POLICY_SCHEDULE.json: RP-AUDIT-EDU/RP-AUDIT-ORG/RP-AUDIT-PLT).$comment$;

CREATE INDEX IF NOT EXISTS cg_tool_runtime_invocation_tenant_idx
  ON public.cg_tool_runtime_invocation (tenant_id, at);

CREATE INDEX IF NOT EXISTS cg_tool_runtime_invocation_tool_idx
  ON public.cg_tool_runtime_invocation (tenant_id, tool_id, at);

CREATE INDEX IF NOT EXISTS cg_tool_runtime_invocation_outcome_idx
  ON public.cg_tool_runtime_invocation (tenant_id, outcome, at);

-- -----------------------------------------------------------------------------
-- 3. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the memory-tier / worker-definitions substrate posture).
-- Zero policies are deliberate: invocation records are tenant-sensitive
-- security audit data (Constitution §17/§29/§35) and no tenant-scoped policy
-- yet exists that provably cannot widen reads beyond the record's tenant —
-- access runs through service-role server functions that enforce the
-- runtime's tenant gate through the adapter. Policies may be authored by a
-- follow-up migration under explicit authorization, never silently.
-- =============================================================================

ALTER TABLE public.cg_tool_runtime_tool ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_tool_runtime_invocation ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_tool_runtime_tool FROM anon, authenticated;
REVOKE ALL ON public.cg_tool_runtime_invocation FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • both tables exist with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges on either table;
--   • invocation rows reject out-of-vocabulary reason codes, an executed
--     row naming a reason, a rejected/failed row naming none, a
--     lease_invalidated marker outside the lease failure path, and object-
--     shaped redacted_params violations;
--   • tool rows reject id/tool_id disagreement and out-of-vocabulary risk
--     classes.
-- The TypeScript adapter (frontend/src/lib/adapters/tool-runtime-store.adapter.ts)
-- and its suite pin the migration text mechanically until live verification
-- is authorized.
-- =============================================================================
