-- =============================================================================
-- CoreGrid V1 — cost attribution persistence: usage-ledger roll-ups to
-- mission & tenant (J-043 / V1CAP-078, MISSION-R-70)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000010_coregrid_v1_cost_attribution.sql
--
-- Authority:
--   Contract: frontend/src/lib/metering/cost-attribution.ts (J-043 /
--   V1CAP-078 / MISSION-R-70; E-051 workforce economics) — the roll-up
--   arithmetic over the Part 49 usage ledger (metering/usage-ledger.ts).
--   Chain: Constitution §9 (token counts are observed reality;
--   estimated_cost_usd is derived intelligence and stays nullable), §20
--   (gateway cost tracking), §12 (bi-temporality: valid time `at` vs
--   transaction time `recordedAt`); J-031 quota evaluation refuses a
--   non-integral roll-up (fail closed); AGENTS §28 database law (the
--   conservation property is CHECK-surface-relevant and adapter-enforced).
--   Style exemplar: 20261002000004_coregrid_v1_memory_tier.sql.
--
-- Scope:
--   cg_usage_attribution_rollup — one row per persisted roll-up: the declared
--       half-open period (valid-time and optional transaction-time bounds),
--       the grand total, and the roll-up's integrity verdict (defects and
--       conservation problems are persisted verbatim, never absorbed —
--       J-043: an unattributed record is a DATA DEFECT, never a guess).
--   cg_usage_attribution_bucket — one row per (roll-up, dimension, key)
--       bucket: the partition that makes attribution auditable. Dimensions:
--       tenant | mission | actor | model | purpose | tenant_mission
--       (composite key `tenant::mission`, MISSION-R-70 T1).
--
-- Conservation law (contract): attribution is a PARTITION — every in-scope
--   record lands in exactly one bucket per dimension, so every dimension's
--   buckets reconcile to the grand total. Persistence is append-only and
--   idempotent (adapters use ON CONFLICT DO NOTHING); no UPDATE/DELETE path
--   is authored for the epistemic fields.
--
-- Envelope posture:
--   A roll-up is a derived AGGREGATE (Intelligence, Constitution §9), not a
--   canonical CoreObject: no envelope columns are authored here (mirrors
--   cg_memory_access_log, which is audit, not object). The usage records the
--   roll-up aggregates remain the canonical reality in their own substrate.
--
-- Tenant posture (COND-003 parameterization, UNRESOLVED):
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per applied reality
--   (cg_identity.tenant_id and the worker-definitions exemplar). If COND-003
--   rules uuid (MISSION-R-02), a follow-up migration converts the substrate.
--   The roll-up row carries the tenant context the roll-up was computed and
--   persisted under; the adapter refuses to persist a roll-up whose tenant
--   dimension names a tenant other than the owning tenant (cross-tenant cost
--   data never lands in another tenant's substrate; buckets under the
--   unassigned key are defects, surfaced by integrity, never absorbed).
--
-- Retention posture (ADR-005 / RETENTION_POLICY_SCHEDULE.json):
--   Record family: 'financial' (policy RP-FINAN-EDU / RP-FINAN-ORG, 2555-day
--   duration on clock recorded_at, lawful basis legal-obligation) — the
--   roll-ups are the metering substrate billing and quotas (J-031) consume.
--   Classification: personal (identity references: actor/tenant/mission
--   bucket keys); the family's transaction-fact retention applies (amounts,
--   attribution, timestamps retained in full).
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (deny-by-default strongest form;
--     policies come later from the policy team and the RLS battery).
--   • The usage ledger itself (metering/usage-ledger.ts records) — a separate
--     record family under the same metering authority; this migration
--     persists roll-ups OVER the ledger, never the ledger.
--   • Quota/billing enforcement — evaluateTenantQuota stays a pure contract
--     gate; enforcement is a server-function concern.
--   • Cost-estimation rate tables — config supplied by callers, never
--     persisted here.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_usage_attribution_rollup — the persisted roll-up header
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_usage_attribution_rollup (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- The declared attribution window: half-open [from, to) on VALID time —
  -- adjacent periods partition the timeline and never double-count. Both
  -- bounds present or none (an all-records roll-up declares no window).
  period_from         timestamptz,
  period_to           timestamptz,
  -- Optional transaction-time bounds (bi-temporal): both present or none.
  recorded_from       timestamptz,
  recorded_to         timestamptz,
  -- Totals over every record placed in the period (the conservation target).
  -- Shape: {requests,tokensIn,tokensOut,durationMs,estimatedCostUsd,unpricedRequests}.
  grand_total         jsonb NOT NULL CHECK (jsonb_typeof(grand_total) = 'object'),
  -- The roll-up's integrity verdict, persisted verbatim (J-043: defects are
  -- surfaced, never absorbed; enforcement refuses a non-integral roll-up).
  integrity_ok        boolean NOT NULL,
  integrity_conserves boolean NOT NULL,
  integrity_defects   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(integrity_defects) = 'array'),
  integrity_problems  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(integrity_problems) = 'array'),
  recorded_at         timestamptz NOT NULL,
  UNIQUE (id, tenant_id),
  CONSTRAINT cg_usage_attribution_rollup_period CHECK (
    (period_from IS NULL AND period_to IS NULL)
    OR (period_from IS NOT NULL AND period_to IS NOT NULL AND period_to > period_from)
  ),
  CONSTRAINT cg_usage_attribution_rollup_transaction_period CHECK (
    (recorded_from IS NULL AND recorded_to IS NULL)
    OR (recorded_from IS NOT NULL AND recorded_to IS NOT NULL AND recorded_to > recorded_from)
  )
);

COMMENT ON TABLE public.cg_usage_attribution_rollup IS
  $comment$J-043 / V1CAP-078 (MISSION-R-70) persisted usage-ledger roll-up:
  the declared half-open attribution period (valid time, optional
  transaction-time bounds — bi-temporal per §12), the grand total, and the
  roll-up's integrity verdict with its defects persisted verbatim —
  unattributed records are DATA DEFECTS, never silently absorbed, and quota
  enforcement refuses a non-integral roll-up (fail closed). Derived
  Intelligence (Constitution §9): token counts are observed reality;
  estimated_cost_usd stays nullable inside the totals. Record family
  'financial' (RETENTION_POLICY_SCHEDULE.json: RP-FINAN-EDU/RP-FINAN-ORG).$comment$;

CREATE INDEX IF NOT EXISTS cg_usage_attribution_rollup_tenant_idx
  ON public.cg_usage_attribution_rollup (tenant_id, recorded_at);

-- -----------------------------------------------------------------------------
-- 2. cg_usage_attribution_bucket — the partition buckets (per dimension)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_usage_attribution_bucket (
  rollup_row_id      text NOT NULL CHECK (length(rollup_row_id) BETWEEN 1 AND 160),
  tenant_id          text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- The closed dimension vocabulary of the roll-up contract; tenant_mission
  -- buckets carry the composite key `tenant::mission` (MISSION-R-70 T1).
  dimension          text NOT NULL CHECK (dimension IN
                       ('tenant','mission','actor','model','purpose','tenant_mission')),
  bucket_key         text NOT NULL CHECK (length(bucket_key) BETWEEN 1 AND 200),
  -- Shape: {requests,tokensIn,tokensOut,durationMs,estimatedCostUsd,unpricedRequests}.
  totals             jsonb NOT NULL CHECK (
                       jsonb_typeof(totals) = 'object'
                       AND jsonb_typeof(totals -> 'requests') = 'number'
                       AND jsonb_typeof(totals -> 'tokensIn') = 'number'
                       AND jsonb_typeof(totals -> 'tokensOut') = 'number'
                       AND jsonb_typeof(totals -> 'durationMs') = 'number'
                       AND jsonb_typeof(totals -> 'estimatedCostUsd') = 'number'
                       AND jsonb_typeof(totals -> 'unpricedRequests') = 'number'
                     ),
  PRIMARY KEY (rollup_row_id, dimension, bucket_key),
  -- Same-tenant integrity: a bucket can never be bound to a roll-up of
  -- another tenant (composite FK, database-enforced).
  CONSTRAINT cg_usage_attribution_bucket_rollup_fk
    FOREIGN KEY (rollup_row_id, tenant_id)
    REFERENCES public.cg_usage_attribution_rollup (id, tenant_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.cg_usage_attribution_bucket IS
  $comment$J-043 / V1CAP-078 (MISSION-R-70) roll-up partition buckets: one row
  per (roll-up, dimension, key) — the partition that makes cost attribution
  auditable and conserved (every in-scope record lands in exactly one bucket
  per dimension; bucket sums reconcile to the grand total). Unassigned
  attribution lands under the ledger's explicit unassigned key with its
  defect recorded, never dropped and never duplicated.$comment$;

CREATE INDEX IF NOT EXISTS cg_usage_attribution_bucket_tenant_idx
  ON public.cg_usage_attribution_bucket (tenant_id, dimension, bucket_key);

-- -----------------------------------------------------------------------------
-- 3. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the memory-tier / worker-definitions substrate posture).
-- Zero policies are deliberate: cost attribution is tenant-sensitive
-- financial-metering data (Constitution §17/§20) and no tenant-scoped policy
-- yet exists that provably cannot widen reads beyond the roll-up's tenant —
-- access runs through service-role server functions that enforce the
-- contract's attribution through the adapter. Policies may be authored by a
-- follow-up migration under explicit authorization, never silently.
-- =============================================================================

ALTER TABLE public.cg_usage_attribution_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_usage_attribution_bucket ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_usage_attribution_rollup FROM anon, authenticated;
REVOKE ALL ON public.cg_usage_attribution_bucket FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • both tables exist with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges on either table;
--   • roll-up rows reject inverted or half-declared periods (valid and
--     transaction time), and bucket rows reject totals missing any conserved
--     field and cross-tenant roll-up bindings (composite FK).
-- The TypeScript adapter (frontend/src/lib/adapters/cost-attribution-store.adapter.ts)
-- and its suite pin the migration text mechanically until live verification
-- is authorized.
-- =============================================================================
