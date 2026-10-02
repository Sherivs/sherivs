-- =============================================================================
-- CoreGrid V1 — durable practical/organizational memory tier (MISSION-R-36)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000004_coregrid_v1_memory_tier.sql
--
-- Authority:
--   D1 ratification (DOSSIER_D1_MEMORY_OWNER.md): phase 36 is the canonical
--   owner of the practical/organizational memory tier (V1CAP-034/035), with
--   phase 07 as scoped consumer/enforcer (J-018), phase 08 as retrieval-policy
--   enforcer (J-017), phase 14 as provenance/freshness owner (J-019).
--   Chain: J-016 (blocking) — "Persisted practical/organizational memory
--   store (durable Memory tier)"; the loop's Outcome -> Memory -> Observation
--   tail cannot iterate without durable memory. Ratification condition: the
--   schema must not reach retrieval capability without the J-017
--   authorization-gated, non-vector-only retrieval guard — which is authored
--   CONCURRENTLY in frontend/src/lib/memory/memory-store.ts.
--   Mission: MISSION-R-36 (blocking J-016; V1CAP-034/035/036).
--   Style exemplar: 20261002000002_coregrid_v1_worker_definitions.sql.
--
-- Scope:
--   cg_memory_scope      — declared memory scopes: the explicit boundary of
--                          every read AND write (tenant, mission ref, actor
--                          scope, domains, sensitivity ceiling). Empty bounds
--                          grant NOTHING (deny-by-default).
--   cg_memory_record     — the durable memory records: practical vs
--                          organizational class (V1CAP-034), content, the
--                          canonical CoreObject envelope (V1CAP-002),
--                          bi-temporal validity (V1CAP-004), freshness
--                          (J-019 posture), sensitivity (context-assembly
--                          vocabulary), and an optional per-record retrieval
--                          permission.
--   cg_memory_access_log — append-only auditable access records: ONE row per
--                          retrieval attempt, granted/partial/denied, with
--                          returned ids, exclusion ledger, denial reason, and
--                          the audit instant.
--
-- Non-vector-only law (G-015 / J-017):
--   DELIBERATELY NO embedding, vector, or similarity column is authored on
--   any table. Semantic-similarity search is a classic authorization bypass;
--   retrieval authorization (identity AND tenant AND scope AND policy) lives
--   in the memory-store contract, and any future ANN index would be an
--   ADDITIVE migration requiring its own authorization and its own
--   authorization-gated join — never a standalone retrieval path.
--
-- Tenant posture (COND-003 parameterization, UNRESOLVED):
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per applied reality
--   (cg_identity.tenant_id and the worker-definitions exemplar). If COND-003
--   rules uuid (MISSION-R-02), a follow-up migration converts the substrate.
--
-- Envelope posture (V1CAP-002 / J-001 / G-010):
--   cg_memory_record authors its envelope columns NATIVELY (new table, so the
--   nullable-then-constrain phasing of the kernel envelope migration is
--   unnecessary). created_by is NOT NULL, which makes the all-NULL branch of
--   the atomicity CHECK unsatisfiable: every memory record row is fully
--   stamped or rejected — an anonymous persistent memory record can never
--   exist. object_type is pinned to 'memory_record' (the registry type owned
--   by this mission's contract; registration in the kernel object-type
--   registry is a write-path gate).
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (see posture note below).
--   • The civilization-scale memory tier (V2CAP-020) — V2, not authored here.
--   • In-process agent memory (`agent-memory.ts`, phase 07 consumer side —
--     unchanged by this migration).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_memory_scope — declared scope boundary (reads and writes)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_memory_scope (
  id               text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id        text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  mission_ref      text CHECK (mission_ref IS NULL OR length(mission_ref) BETWEEN 1 AND 200),
  -- Explicit actor identities bounded by the scope. An empty array bounds
  -- nothing: a scope is a boundary, never an implicit wildcard.
  actor_scope      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(actor_scope) = 'array'),
  -- Memory domains the scope covers. An empty array covers nothing.
  domains          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(domains) = 'array'),
  max_sensitivity  text NOT NULL CHECK (max_sensitivity IN ('public','internal','restricted')),
  declared_by      text NOT NULL CHECK (length(declared_by) BETWEEN 1 AND 160),
  declared_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

COMMENT ON TABLE public.cg_memory_scope IS
  $comment$MISSION-R-36 / J-016 declared memory scope: the explicit boundary of every
  memory read AND write — tenant, mission ref, actor scope, domains, and the
  sensitivity ceiling (context-assembly vocabulary). Empty actor_scope or
  domains grant nothing (deny-by-default). No silent memory expansion
  (J-017/E-027): writes exceeding a declared scope are rejected, never
  clamped.$comment$;

CREATE INDEX IF NOT EXISTS cg_memory_scope_tenant_idx
  ON public.cg_memory_scope (tenant_id);

-- -----------------------------------------------------------------------------
-- 2. cg_memory_record — the durable memory tier (practical/organizational)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_memory_record (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  scope_id            text NOT NULL,
  mission_ref         text CHECK (mission_ref IS NULL OR length(mission_ref) BETWEEN 1 AND 200),
  -- D1 tier split (V1CAP-034): the civilization tier is V2 and has no row here.
  memory_class        text NOT NULL CHECK (memory_class IN ('practical','organizational')),
  domain              text NOT NULL CHECK (length(domain) BETWEEN 1 AND 128),
  content             text NOT NULL CHECK (length(content) BETWEEN 1 AND 100000),
  sensitivity         text NOT NULL CHECK (sensitivity IN ('public','internal','restricted')),
  required_permission text CHECK (required_permission IS NULL OR length(required_permission) BETWEEN 1 AND 200),
  -- Freshness (J-019 posture): stale stays distinguishable from current.
  freshness_at        timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  -- Same-tenant integrity: a record can never be bound to a scope of another
  -- tenant (composite FK, database-enforced).
  CONSTRAINT cg_memory_record_scope_fk
    FOREIGN KEY (scope_id, tenant_id)
    REFERENCES public.cg_memory_scope (id, tenant_id)
    ON DELETE RESTRICT,
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
  declared_origin     text,
  -- Bi-temporal validity (V1CAP-004 / J-003): explicit valid time vs record
  -- time; unknown validity is flagged, never assumed "now".
  valid_from          timestamptz,
  valid_until         timestamptz,
  valid_time_known    boolean NOT NULL DEFAULT true,
  supersedes          text CHECK (supersedes IS NULL OR length(supersedes) BETWEEN 1 AND 160),
  -- Append-only supersession: a record may only correct a record of its OWN
  -- tenant (composite FK on the same table; NULL supersedes passes).
  CONSTRAINT cg_memory_record_supersedes_fk
    FOREIGN KEY (supersedes, tenant_id)
    REFERENCES public.cg_memory_record (id, tenant_id)
    ON DELETE RESTRICT
);

-- The envelope is ATOMIC: a complete envelope or none — and because
-- created_by is NOT NULL, "none" is unsatisfiable, so every row is fully
-- stamped (no anonymous persistent memory record, J-001).
ALTER TABLE public.cg_memory_record DROP CONSTRAINT IF EXISTS cg_memory_record_envelope_atomic;
ALTER TABLE public.cg_memory_record
  ADD CONSTRAINT cg_memory_record_envelope_atomic CHECK (
    object_type IS NOT NULL AND schema_version IS NOT NULL AND status IS NOT NULL
      AND updated_by IS NOT NULL AND provenance IS NOT NULL
      AND policy_context IS NOT NULL AND trace_id IS NOT NULL AND correlation_id IS NOT NULL
  );

-- G-010: a causation chain root is explicit — continued from a cause or
-- declared as an origin. Unrooted memory records never exist.
ALTER TABLE public.cg_memory_record DROP CONSTRAINT IF EXISTS cg_memory_record_envelope_causation_root;
ALTER TABLE public.cg_memory_record
  ADD CONSTRAINT cg_memory_record_envelope_causation_root CHECK (
    causation_id IS NOT NULL OR parent_event_id IS NOT NULL OR declared_origin IS NOT NULL
  );

ALTER TABLE public.cg_memory_record DROP CONSTRAINT IF EXISTS cg_memory_record_envelope_format;
ALTER TABLE public.cg_memory_record
  ADD CONSTRAINT cg_memory_record_envelope_format CHECK (
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

-- The record is THIS substrate's canonical object type only.
ALTER TABLE public.cg_memory_record
  ADD CONSTRAINT cg_memory_record_object_type CHECK (object_type = 'memory_record');

-- Bi-temporal integrity, mirroring the kernel bi-temporal contract:
-- unknown validity must not claim an interval; known validity requires one;
-- the interval is never empty or inverted.
ALTER TABLE public.cg_memory_record DROP CONSTRAINT IF EXISTS cg_memory_record_bitemporal;
ALTER TABLE public.cg_memory_record
  ADD CONSTRAINT cg_memory_record_bitemporal CHECK (
    (valid_time_known = false AND valid_from IS NULL AND valid_until IS NULL)
    OR (valid_time_known = true AND valid_from IS NOT NULL
        AND (valid_until IS NULL OR valid_until > valid_from))
  );

COMMENT ON TABLE public.cg_memory_record IS
  $comment$MISSION-R-36 / J-016 durable practical/organizational memory tier
  (V1CAP-034/035). Envelope-bearing (V1CAP-002), bi-temporally explicit
  (V1CAP-004), scope-bound (every row is written through a declared
  cg_memory_scope of its own tenant), freshness-stamped, and carries NO
  embedding/vector column — retrieval is authorization-gated and
  non-vector-only (G-015). Memory remains platform-owned data, never
  agent-owned (G-061, L-H-007).$comment$;

CREATE INDEX IF NOT EXISTS cg_memory_record_tenant_class_idx
  ON public.cg_memory_record (tenant_id, memory_class);

CREATE INDEX IF NOT EXISTS cg_memory_record_scope_idx
  ON public.cg_memory_record (scope_id, tenant_id);

CREATE INDEX IF NOT EXISTS cg_memory_record_freshness_idx
  ON public.cg_memory_record (tenant_id, freshness_at);

CREATE INDEX IF NOT EXISTS cg_memory_record_object_type_idx
  ON public.cg_memory_record (tenant_id, object_type);

-- -----------------------------------------------------------------------------
-- 3. cg_memory_access_log — append-only auditable access records (J-017)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_memory_access_log (
  id                   text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  -- Nullable only when a denial occurred BEFORE tenant resolution (e.g. no
  -- tenant on the request at all): the failed attempt is still audited.
  tenant_id            text CHECK (tenant_id IS NULL OR length(tenant_id) BETWEEN 1 AND 128),
  identity_ref         text CHECK (identity_ref IS NULL OR length(identity_ref) BETWEEN 1 AND 160),
  scope_id             text CHECK (scope_id IS NULL OR length(scope_id) BETWEEN 1 AND 160),
  purpose              text NOT NULL DEFAULT '',
  outcome              text NOT NULL CHECK (outcome IN ('granted','partial','denied')),
  returned_record_ids  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(returned_record_ids) = 'array'),
  -- First-class exclusion ledger: in-scope records withheld by authorization
  -- (the memory twin of context-assembly's drop ledger).
  exclusions           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(exclusions) = 'array'),
  denial_reason        text,
  recorded_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cg_memory_access_log IS
  $comment$MISSION-R-36 / J-017 append-only memory access audit: one row per
  retrieval attempt — granted, partial, or DENIED — with the identity,
  tenant, scope, purpose, returned record ids, exclusion ledger, denial
  reason and audit instant. Denied attempts are recorded, never discarded:
  retrieval without identity AND tenant AND declared scope fails closed and
  leaves evidence. Immutable audit record (Constitution §28/§29); no UPDATE
  or DELETE path is authored.$comment$;

CREATE INDEX IF NOT EXISTS cg_memory_access_log_tenant_idx
  ON public.cg_memory_access_log (tenant_id, recorded_at);

CREATE INDEX IF NOT EXISTS cg_memory_access_log_identity_idx
  ON public.cg_memory_access_log (identity_ref, recorded_at);

-- -----------------------------------------------------------------------------
-- 4. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the worker-definitions / kernel substrate posture;
-- verified by the RLS isolation battery). Zero policies are deliberate:
-- memory is tenant-sensitive platform data (Constitution §17/§35) and no
-- tenant-scoped policy exists yet that provably cannot widen retrieval
-- beyond the declared scope — memory access runs through service-role server
-- functions that enforce the identity AND tenant AND scope AND policy
-- authorization contract (memory-store.ts) and write the access log.
-- Policies may be authored by a follow-up migration under explicit
-- authorization, never silently.
-- =============================================================================

ALTER TABLE public.cg_memory_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_memory_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_memory_access_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_memory_scope FROM anon, authenticated;
REVOKE ALL ON public.cg_memory_record FROM anon, authenticated;
REVOKE ALL ON public.cg_memory_access_log FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • all three tables exist with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges on any of the three tables;
--   • no embedding/vector/similarity column exists on any table (G-015);
--   • cg_memory_record rows reject unstamped inserts (envelope atomicity),
--     unrooted causation chains, non-explicit bi-temporal validity, and
--     cross-tenant scope/supersession bindings (composite FKs);
--   • cg_memory_access_log records denials as well as grants.
-- The TypeScript contract (frontend/src/lib/memory/memory-store.ts) and its
-- suite pin the migration text mechanically until live verification is
-- authorized (MISSION-R-85 battery hooks: cg_memory_* RLS isolation).
-- =============================================================================
