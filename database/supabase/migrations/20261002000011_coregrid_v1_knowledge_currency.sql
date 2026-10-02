-- =============================================================================
-- CoreGrid V1 — knowledge currency persistence: freshness contracts, explicit
-- invalidation & source reliability (J-019 / V1CAP-040 / MISSION-R-71, wave 3)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000011_coregrid_v1_knowledge_currency.sql
--
-- Authority:
--   Contract: frontend/src/lib/memory/knowledge-currency.ts (J-019 / V1CAP-040
--   / MISSION-R-71, wave 3) — knowledge freshness, invalidation and source
--   reliability composed OVER the phase-36 durable memory tier
--   (memory/memory-store.ts, migration 20261002000004 — NOT modified).
--   Chain: E-018 invariants 25-26 (stale stays distinguishable from current
--   on loop re-entry; the freshness boundary is INCLUSIVE — fresh at
--   freshUntil, stale strictly after), G-047/G-052 (source reliability tiers
--   with evidence provenance; downgrades only — trust never rises silently),
--   ADR-005 (invalidation is an append-only tombstone act: records stay,
--   marked invalid, never deleted), Constitution §9/§17/§28.
--   Style exemplar: 20261002000004_coregrid_v1_memory_tier.sql.
--
-- Scope:
--   cg_knowledge_source              — declared knowledge sources: the
--       reliability tier a record inherits, declared WITH evidence
--       provenance (a tier is a claim, and the claim carries its evidence).
--   cg_knowledge_freshness_contract  — one freshness contract per registered
--       knowledge record: freshUntil (inclusive boundary), revalidation
--       requirement (+ periodic interval), the declared source, and the tier
--       inherited at registration (the downgrade-propagation baseline).
--   cg_knowledge_invalidation        — append-only explicit invalidation acts
--       (who, why, evidence ref, when): the record is NEVER deleted; one act
--       per record, and the first act stands (append-only tombstone).
--   cg_knowledge_downgrade           — append-only evidence-bearing
--       reliability downgrade acts (from→to tier strictly down, reason and
--       evidence ref required): propagation is structural — records inherit
--       the source's CURRENT tier at query time.
--
-- Currency law at rest (E-018 invariants 25-26):
--   Invalidation is CHECK-surface-relevant and database-enforced where the
--   contract states it: exactly ONE invalidation act per record (UNIQUE), the
--   act is evidence-bearing (evidence_ref NOT NULL), and a downgrade act's
--   target tier is CHECK-ranked strictly BELOW its from-tier — no silent
--   upgrade, no no-op downgrade can exist in the substrate either.
--
-- Tenant posture (COND-003 parameterization, UNRESOLVED):
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per applied reality
--   (cg_identity.tenant_id and the worker-definitions exemplar). If COND-003
--   rules uuid (MISSION-R-02), a follow-up migration converts the substrate.
--   Every act (downgrade, invalidation) is same-tenant by composite FK:
--   cross-tenant acts can never be bound into the substrate.
--
-- Envelope posture:
--   These tables are registry entries and ACT records bound to memory records
--   that already live in the phase-36 memory tier — the memory record is the
--   canonical object and its envelope lives on cg_memory_record. No envelope
--   columns are authored here (mirrors cg_memory_access_log, which is audit,
--   not object); these tables reference records by id, never embed content.
--
-- Retention posture (ADR-005 / RETENTION_POLICY_SCHEDULE.json):
--   cg_knowledge_source and cg_knowledge_freshness_contract carry NO
--   subject-identifying personal values by design (identity/record references
--   only): governance-config classification, non-personal (schedule family
--   'governance-config', policyId null). cg_knowledge_invalidation and
--   cg_knowledge_downgrade are evidence-bearing ACT records (actor refs,
--   free-text reasons): record family 'audit' (policies RP-AUDIT-EDU /
--   RP-AUDIT-ORG / RP-AUDIT-PLT, 2555-day duration on clock recorded_at).
--   The knowledge records themselves remain in the 'memory' family
--   (RP-MEMORY-EDU/ORG/PLT) on cg_memory_record — untouched here.
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (deny-by-default strongest form;
--     policies come later from the policy team and the RLS battery).
--   • Memory-record persistence itself — owned by the phase-36 memory tier
--     migration 20261002000004; currency composes, it never invents records.
--   • Retention EXECUTION and staleness sweeps — currency is evaluated at
--     read time by the pure contract; no revalidation job is authored here.
--   • Reliability UPGRADES — this layer never silently raises trust
--     (G-047/G-052); no upgrade path is authored.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_knowledge_source — declared knowledge sources (reliability registry)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_knowledge_source (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- Reliability tier at declaration time (G-047/G-052); downgrades move it,
  -- never up (no upgrade path is authored).
  tier                text NOT NULL CHECK (tier IN
                        ('authoritative','verified','provisional','unverified')),
  description         text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  -- Evidence provenance for the declared tier: a tier is a claim, and the
  -- claim carries its evidence (null allowed at declaration).
  evidence_ref        text CHECK (evidence_ref IS NULL OR length(evidence_ref) BETWEEN 1 AND 200),
  declared_by         text NOT NULL CHECK (length(declared_by) BETWEEN 1 AND 160),
  declared_at         timestamptz NOT NULL,
  UNIQUE (id, tenant_id)
);

COMMENT ON TABLE public.cg_knowledge_source IS
  $comment$J-019 / V1CAP-040 (MISSION-R-71) declared knowledge source: the
  reliability tier records inherit from it, declared WITH evidence provenance
  (G-047/G-052). Downgrades move the tier, never up — no upgrade path exists
  in this substrate. Tenant-bound; every act on a source is same-tenant
  (composite FKs).$comment$;

CREATE INDEX IF NOT EXISTS cg_knowledge_source_tenant_idx
  ON public.cg_knowledge_source (tenant_id, declared_at);

-- -----------------------------------------------------------------------------
-- 2. cg_knowledge_freshness_contract — one freshness contract per record
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_knowledge_freshness_contract (
  record_id             text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 160),
  tenant_id             text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  source_id             text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 160),
  -- INCLUSIVE fresh boundary: fresh at the instant itself, stale strictly
  -- after (E-018 invariants 25-26 — stale never conflated with current).
  fresh_until           timestamptz NOT NULL,
  -- The revalidation duty surfaced on every retrieval view.
  revalidation          text NOT NULL CHECK (revalidation IN ('none','before_use','periodic')),
  -- Positive integer required for "periodic"; forbidden otherwise (the
  -- contract fails closed on a periodic requirement without an interval).
  revalidate_after_seconds bigint,
  registered_at         timestamptz NOT NULL,
  -- The source tier the record inherited at registration: the baseline the
  -- downgrade-propagation flag is computed against.
  tier_at_registration  text NOT NULL CHECK (tier_at_registration IN
                          ('authoritative','verified','provisional','unverified')),
  PRIMARY KEY (record_id, tenant_id),
  CONSTRAINT cg_knowledge_freshness_contract_revalidation CHECK (
    (revalidation = 'periodic' AND revalidate_after_seconds IS NOT NULL AND revalidate_after_seconds > 0)
    OR (revalidation <> 'periodic' AND revalidate_after_seconds IS NULL)
  ),
  -- Same-tenant integrity: a record can never inherit its tier from a source
  -- of another tenant (composite FK, database-enforced).
  CONSTRAINT cg_knowledge_freshness_contract_source_fk
    FOREIGN KEY (source_id, tenant_id)
    REFERENCES public.cg_knowledge_source (id, tenant_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.cg_knowledge_freshness_contract IS
  $comment$J-019 / V1CAP-040 (MISSION-R-71) freshness contract bound to one
  registered knowledge record: the INCLUSIVE freshUntil boundary (fresh at
  the instant, stale strictly after — E-018 invariants 25-26), the
  revalidation duty (none / before_use / periodic with its interval), the
  declared source, and the tier inherited at registration. References the
  memory record by id — currency composes with the phase-36 memory tier, it
  never invents records.$comment$;

CREATE INDEX IF NOT EXISTS cg_knowledge_freshness_contract_tenant_idx
  ON public.cg_knowledge_freshness_contract (tenant_id, fresh_until);

CREATE INDEX IF NOT EXISTS cg_knowledge_freshness_contract_source_idx
  ON public.cg_knowledge_freshness_contract (source_id, tenant_id);

-- -----------------------------------------------------------------------------
-- 3. cg_knowledge_invalidation — append-only explicit invalidation acts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_knowledge_invalidation (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  record_id           text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 160),
  invalidated_by      text NOT NULL CHECK (length(invalidated_by) BETWEEN 1 AND 160),
  reason              text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  evidence_ref        text NOT NULL CHECK (length(evidence_ref) BETWEEN 1 AND 200),
  invalidated_at      timestamptz NOT NULL,
  -- Append-only tombstone law (ADR-005): exactly ONE invalidation act per
  -- record, and the first act stands — invalidated knowledge can never
  -- re-enter Observation as current.
  UNIQUE (tenant_id, record_id),
  -- Same-tenant integrity: invalidation never crosses tenants (composite FK).
  CONSTRAINT cg_knowledge_invalidation_contract_fk
    FOREIGN KEY (record_id, tenant_id)
    REFERENCES public.cg_knowledge_freshness_contract (record_id, tenant_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.cg_knowledge_invalidation IS
  $comment$J-019 / V1CAP-040 (MISSION-R-71) explicit invalidation act (who,
  why, evidence ref, when — all required): the knowledge record is NEVER
  deleted; it stays in the memory tier marked invalid through this appended
  act (ADR-005 append-only tombstone). One act per record; the existing act
  stands. Evidence-bearing: an act without its evidence ref can never exist
  in the substrate. Record family 'audit'
  (RETENTION_POLICY_SCHEDULE.json: RP-AUDIT-EDU/RP-AUDIT-ORG/RP-AUDIT-PLT).$comment$;

CREATE INDEX IF NOT EXISTS cg_knowledge_invalidation_tenant_idx
  ON public.cg_knowledge_invalidation (tenant_id, invalidated_at);

-- -----------------------------------------------------------------------------
-- 4. cg_knowledge_downgrade — append-only reliability downgrade acts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_knowledge_downgrade (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  source_id           text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 160),
  -- The source's CURRENT tier at act time (recorded, never recomputed).
  from_tier           text NOT NULL CHECK (from_tier IN
                        ('authoritative','verified','provisional','unverified')),
  to_tier             text NOT NULL CHECK (to_tier IN
                        ('authoritative','verified','provisional','unverified')),
  downgraded_by       text NOT NULL CHECK (length(downgraded_by) BETWEEN 1 AND 160),
  reason              text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  evidence_ref        text NOT NULL CHECK (length(evidence_ref) BETWEEN 1 AND 200),
  downgraded_at       timestamptz NOT NULL,
  -- Trust never rises silently through this contract (G-047/G-052): the
  -- target tier must be strictly BELOW the from-tier, ranked
  -- authoritative > verified > provisional > unverified — a no-op or upgrade
  -- downgrade act can never exist in the substrate.
  CONSTRAINT cg_knowledge_downgrade_strict_down CHECK (
    CASE to_tier
      WHEN 'authoritative' THEN 3 WHEN 'verified' THEN 2
      WHEN 'provisional' THEN 1 WHEN 'unverified' THEN 0 END
    < CASE from_tier
      WHEN 'authoritative' THEN 3 WHEN 'verified' THEN 2
      WHEN 'provisional' THEN 1 WHEN 'unverified' THEN 0 END
  ),
  -- Same-tenant integrity: downgrades never cross tenants (composite FK).
  CONSTRAINT cg_knowledge_downgrade_source_fk
    FOREIGN KEY (source_id, tenant_id)
    REFERENCES public.cg_knowledge_source (id, tenant_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.cg_knowledge_downgrade IS
  $comment$J-019 / V1CAP-040 (MISSION-R-71) evidence-bearing reliability
  downgrade act: from→to tier strictly DOWN (CHECK-ranked — trust never rises
  silently through this contract, G-047/G-052), with reason and evidence ref
  required. Propagation is structural: records inherit their source's CURRENT
  tier at query time, so records from the source are flagged and filterable
  the moment the act lands. Record family 'audit'
  (RETENTION_POLICY_SCHEDULE.json: RP-AUDIT-EDU/RP-AUDIT-ORG/RP-AUDIT-PLT).$comment$;

CREATE INDEX IF NOT EXISTS cg_knowledge_downgrade_tenant_idx
  ON public.cg_knowledge_downgrade (tenant_id, source_id, downgraded_at);

-- -----------------------------------------------------------------------------
-- 5. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the memory-tier / worker-definitions substrate posture).
-- Zero policies are deliberate: the freshness/invalidation/reliability state
-- of knowledge is tenant-sensitive platform data (Constitution §17) and no
-- tenant-scoped policy yet exists that provably cannot widen reads beyond
-- the record's tenant — access runs through service-role server functions
-- that enforce the contract's tenant isolation (every act is same-tenant by
-- construction) through the adapter. Policies may be authored by a follow-up
-- migration under explicit authorization, never silently.
-- =============================================================================

ALTER TABLE public.cg_knowledge_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_knowledge_freshness_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_knowledge_invalidation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_knowledge_downgrade ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_knowledge_source FROM anon, authenticated;
REVOKE ALL ON public.cg_knowledge_freshness_contract FROM anon, authenticated;
REVOKE ALL ON public.cg_knowledge_invalidation FROM anon, authenticated;
REVOKE ALL ON public.cg_knowledge_downgrade FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • all four tables exist with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges on any of the four tables;
--   • contract rows reject a periodic requirement without a positive
--     interval (and the converse), downgrade rows reject upgrade/no-op tiers
--     (strict-down CHECK), invalidation rows reject a second act per record
--     (UNIQUE) and acts without evidence;
--   • cross-tenant source/act bindings are impossible (composite FKs).
-- The TypeScript adapter (frontend/src/lib/adapters/knowledge-currency-store.adapter.ts)
-- and its suite pin the migration text mechanically until live verification
-- is authorized.
-- =============================================================================
