-- =============================================================================
-- CoreGrid V1 — persistent governed worker definition substrate (MISSION-R-40)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000002_coregrid_v1_worker_definitions.sql
--
-- Authority:
--   CTO RULING-3 (binding): workers are governed actors, an extension of the
--   CoreGrid actor/delegation model. Persistent: definition, capability,
--   authority boundary, delegation history. Ephemeral: runtime instance.
--   Chain: Definition -> Delegation -> Mission Assignment -> Ephemeral
--   Runtime -> Execution -> Evidence -> Verification -> Outcome -> Terminate.
--   J-027 (blocking, LAUNCH_BLOCKER) — persistent governed worker definition:
--   identity-linked capability set, authority bounds and delegation history
--   surviving worker process termination (G-014: "registered agent identity
--   survives worker process termination").
--   Mission: MISSION-R-40 (blocking J-027; V1CAP-048).
--   Style exemplar: 20261002000001_coregrid_v1_neutral_tenant_primitives.sql.
--
-- Scope:
--   cg_worker_definition — the PERSISTENT half of a governed worker: identity
--                          FK, human/ai classification, authority bounds
--                          (max risk class + resource scopes), delegation
--                          history refs, identity-aligned lifecycle, and the
--                          canonical CoreObject envelope (V1CAP-002).
--   cg_worker_capability — the owned capability set: explicit declarations,
--                          one row per capability. Capability-over-agent-count
--                          matching (J-028) reads these declarations; workers
--                          are never matched by name.
--   cg_worker_delegation — append-only delegation history references: every
--                          delegation that ever bound a runtime to this
--                          definition, with the risk class and capability set
--                          actually granted.
--
-- Identity linkage (RULING-3: workers are actors, not parallel principals):
--   identity_id is a hard FK to public.cg_identity(id) (phase 02 registry).
--   A worker definition CANNOT exist without a governed identity, and the
--   worker's authorization is resolved through the SAME actor/authority
--   primitives as human identities (identity-actor.ts); these tables grant
--   nothing by themselves. There is deliberately NO worker-specific role,
--   permission or authorization table here — capability declarations and
--   bounds are inputs to the shared authorization layer.
--
-- Lifecycle alignment:
--   lifecycle_state mirrors the cg_identity state CHECK exactly
--   (provisioned|active|suspended|archived|deleted — the subset of the
--   identity lifecycle model a cg_identity row can hold). The TypeScript
--   contract (frontend/src/lib/workforce/worker-definition.ts) asserts the
--   subset relation mechanically. Suspended/archived/deleted workers can
--   never claim an ephemeral runtime.
--
-- Envelope posture (V1CAP-002 / J-001 / G-010):
--   cg_worker_definition authors its envelope columns NATIVELY (it is a new
--   table, so the nullable-then-constrain phasing of the kernel envelope
--   migration is unnecessary). created_by is NOT NULL, which makes the
--   all-NULL branch of the atomicity CHECK unsatisfiable: every worker
--   definition row is fully stamped or rejected — an anonymous persistent
--   worker definition can never exist. object_type is pinned to
--   'worker_definition' (the registry type owned by this mission's contract;
--   registration in the kernel object-type registry is a write-path gate).
--
-- COND-003 parameterization (tenant_id text vs uuid — UNRESOLVED):
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per applied reality
--   (cg_identity.tenant_id, cg_org_membership.tenant_id, and the workspace
--   persistence exemplar). If COND-003 rules uuid (MISSION-R-02), a
--   follow-up migration converts the substrate; uuid::text comparisons in
--   the neutral helpers remain type-correct under either outcome.
--
-- Delegation history (RULING-3):
--   cg_worker_delegation rows are append-only references (delegation_ref to
--   the owning delegation/mission-contract record), unique per (definition,
--   ref). They exist to prove Delegation -> Worker Execution attribution
--   across process restarts; the definition's delegation_history_refs column
--   mirrors them for contract-level consumption.
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (see posture note below).
--   • Capability-registry matching / delegation-contract matching (J-028,
--     MISSION-R-41) — this migration only authors the declaration storage.
--   • Runtime leases, budgets, termination (ephemeral half — owned by
--     agent-runtime/ephemeral-lifecycle.ts, unchanged by this migration).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_worker_definition — persistent governed worker definition
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_worker_definition (
  id                      text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id               text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  identity_id             uuid NOT NULL REFERENCES public.cg_identity (id) ON DELETE RESTRICT,
  classification          text NOT NULL CHECK (classification IN ('human','ai')),
  lifecycle_state         text NOT NULL DEFAULT 'provisioned'
                            CHECK (lifecycle_state IN ('provisioned','active','suspended','archived','deleted')),
  max_risk_class          text NOT NULL CHECK (max_risk_class IN ('low','medium','high','critical')),
  resource_scopes         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(resource_scopes) = 'array'),
  delegation_history_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(delegation_history_refs) = 'array'),
  created_by              text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 160),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  -- One governed definition per worker identity per tenant (RULING-3: the
  -- definition IS the worker's persistent governing record, not one of many).
  UNIQUE (tenant_id, identity_id),
  -- Canonical CoreObject envelope (V1CAP-002), authored natively:
  object_type             text,
  schema_version          text,
  status                  text,
  updated_by              text,
  provenance              jsonb,
  policy_context          jsonb,
  trace_id                text,
  correlation_id          text,
  causation_id            text,
  parent_event_id         text,
  declared_origin         text
);

-- The envelope is ATOMIC: a complete envelope or none — and because
-- created_by is NOT NULL, "none" is unsatisfiable, so every row is fully
-- stamped (no anonymous persistent worker definition, J-001).
ALTER TABLE public.cg_worker_definition DROP CONSTRAINT IF EXISTS cg_worker_definition_envelope_atomic;
ALTER TABLE public.cg_worker_definition
  ADD CONSTRAINT cg_worker_definition_envelope_atomic CHECK (
    object_type IS NOT NULL AND schema_version IS NOT NULL AND status IS NOT NULL
      AND created_by IS NOT NULL AND updated_by IS NOT NULL AND provenance IS NOT NULL
      AND policy_context IS NOT NULL AND trace_id IS NOT NULL AND correlation_id IS NOT NULL
  );

-- G-010: a causation chain root is explicit — continued from a cause or
-- declared as an origin. Unrooted worker definitions never exist.
ALTER TABLE public.cg_worker_definition DROP CONSTRAINT IF EXISTS cg_worker_definition_envelope_causation_root;
ALTER TABLE public.cg_worker_definition
  ADD CONSTRAINT cg_worker_definition_envelope_causation_root CHECK (
    causation_id IS NOT NULL OR parent_event_id IS NOT NULL OR declared_origin IS NOT NULL
  );

ALTER TABLE public.cg_worker_definition DROP CONSTRAINT IF EXISTS cg_worker_definition_envelope_format;
ALTER TABLE public.cg_worker_definition
  ADD CONSTRAINT cg_worker_definition_envelope_format CHECK (
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

-- The definition is THIS substrate's canonical object type only.
ALTER TABLE public.cg_worker_definition
  ADD CONSTRAINT cg_worker_definition_object_type CHECK (object_type = 'worker_definition');

COMMENT ON TABLE public.cg_worker_definition IS
  $comment$MISSION-R-40 / J-027 persistent governed worker definition (CTO RULING-3).
  The persistent half of a governed worker: identity-linked capability
  declarations, authority bounds and delegation history that survive worker
  process termination (G-014). Grants nothing by itself; authority is
  resolved through the shared identity-actor primitives at request time.
  Envelope-bearing (V1CAP-002); anonymous rows are unsatisfiable by
  construction (created_by NOT NULL + atomicity CHECK).$comment$;

CREATE INDEX IF NOT EXISTS cg_worker_definition_tenant_idx
  ON public.cg_worker_definition (tenant_id, lifecycle_state);

CREATE INDEX IF NOT EXISTS cg_worker_definition_identity_idx
  ON public.cg_worker_definition (identity_id);

CREATE INDEX IF NOT EXISTS cg_worker_definition_object_type_idx
  ON public.cg_worker_definition (tenant_id, object_type);

DROP TRIGGER IF EXISTS cg_worker_definition_touch ON public.cg_worker_definition;
CREATE TRIGGER cg_worker_definition_touch
  BEFORE UPDATE ON public.cg_worker_definition
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2. cg_worker_capability — the owned capability set (declarations)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_worker_capability (
  definition_id text NOT NULL,
  tenant_id     text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  capability_id text NOT NULL CHECK (length(capability_id) BETWEEN 1 AND 160),
  description   text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  PRIMARY KEY (definition_id, capability_id),
  -- Same-tenant integrity: a capability declaration can never point at a
  -- definition in another tenant (composite FK, database-enforced).
  CONSTRAINT cg_worker_capability_definition_fk
    FOREIGN KEY (definition_id, tenant_id)
    REFERENCES public.cg_worker_definition (id, tenant_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.cg_worker_capability IS
  $comment$MISSION-R-40 owned capability declarations of a persistent worker
  definition. Explicit and documented only: a capability absent here is
  unclaimable by any runtime instance (deny-by-default, untrusted
  new-worker posture). Matched by declaration id, never by worker name
  (J-028 capability-over-agent-count).$comment$;

CREATE INDEX IF NOT EXISTS cg_worker_capability_capability_idx
  ON public.cg_worker_capability (capability_id);

-- -----------------------------------------------------------------------------
-- 3. cg_worker_delegation — append-only delegation history references
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_worker_delegation (
  id                    text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id             text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  definition_id         text NOT NULL,
  delegation_ref        text NOT NULL CHECK (length(delegation_ref) BETWEEN 1 AND 200),
  delegated_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb
                          CHECK (jsonb_typeof(delegated_capabilities) = 'array'),
  max_granted_risk_class text NOT NULL CHECK (max_granted_risk_class IN ('low','medium','high','critical')),
  recorded_by           text NOT NULL CHECK (length(recorded_by) BETWEEN 1 AND 160),
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, delegation_ref),
  CONSTRAINT cg_worker_delegation_definition_fk
    FOREIGN KEY (definition_id, tenant_id)
    REFERENCES public.cg_worker_definition (id, tenant_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.cg_worker_delegation IS
  $comment$MISSION-R-40 append-only delegation history (CTO RULING-3 persistent
  delegation history). Every delegation that bound a runtime instance to a
  worker definition, with the capability set and risk ceiling actually
  granted. Never mutated, never deleted except with the definition;
  Delegation -> Worker Execution attribution survives process restarts.$comment$;

CREATE INDEX IF NOT EXISTS cg_worker_delegation_tenant_idx
  ON public.cg_worker_delegation (tenant_id, definition_id);

-- -----------------------------------------------------------------------------
-- 4. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the workspace persistence / org-model / kernel substrate
-- posture; verified by the RLS isolation check). Zero policies are
-- deliberate: worker definitions are governance-critical authority records,
-- and no tenant-scoped policy exists yet that provably cannot widen worker
-- authority — worker administration runs through service-role server
-- functions only. Policies may be authored by a follow-up migration under
-- explicit authorization, never silently.
-- =============================================================================

ALTER TABLE public.cg_worker_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_worker_capability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_worker_delegation ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_worker_definition FROM anon, authenticated;
REVOKE ALL ON public.cg_worker_capability FROM anon, authenticated;
REVOKE ALL ON public.cg_worker_delegation FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • all three tables exist with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges on any of the three tables;
--   • cg_worker_definition rows reject unstamped inserts (envelope atomicity);
--   • cg_worker_capability rows cannot reference a cross-tenant definition;
--   • lifecycle_state vocabulary matches cg_identity.state exactly.
-- The TypeScript contract (worker-definition.ts) and its suite pin the
-- migration text mechanically until live verification is authorized.
-- =============================================================================
