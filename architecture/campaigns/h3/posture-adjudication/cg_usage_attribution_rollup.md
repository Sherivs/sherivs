# Posture Adjudication — `cg_usage_attribution_rollup` (H3-038, Squad D)

Role: Posture Adjudication Engineer (provenance/usage family). Mission D-038.
Status: ADJUDICATED — zero-policy-by-design. Nothing applied; no posture file, migration, or policy was modified.

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000010_coregrid_v1_cost_attribution.sql` (J-043 / V1CAP-078 / MISSION-R-70). Rollback: `database/supabase/rollbacks/20261002000010_coregrid_v1_cost_attribution.sql`.
- **Owning server paths (the only write/read paths found by `rg` repo-wide):**
  - Adapter: `frontend/src/lib/adapters/cost-attribution-store.adapter.ts` — exports `COST_ATTRIBUTION_ROLLUP_TABLE = "cg_usage_attribution_rollup"`; service-role-only injected client; append-only, idempotent writes (`ON CONFLICT DO NOTHING`); no UPDATE/DELETE path authored; refuses (fail closed) a roll-up whose tenant dimension names a tenant other than the owning tenant.
  - Pure contract: `frontend/src/lib/metering/cost-attribution.ts` (J-043 / V1CAP-078) — roll-up arithmetic over the Part 49 usage ledger (`frontend/src/lib/metering/usage-ledger.ts`); conservation defects persisted verbatim, never absorbed.
  - Test pin: `tests/unit/adapter-cost-attribution.test.ts` (mechanically pins the migration text).
- **Client-facing surface:** none. Billing/quota consumers (J-031 quota evaluation, metering) read through server-side functions; no REST/UI path touches this table.

## EVIDENCE

- **Battery scope (READ-ONLY confirmation):** `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` (offline, no credentials) resolves
  `cg_usage_attribution_rollup posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000010_coregrid_v1_cost_attribution.sql postureSource=rls-table-postures-substrate.json`.
- **Posture registry:** `scripts/verification/rls-table-postures-substrate.json` declares the table as `"posture": "zero-policy"` with rationale "roll-up headers are financial-metering aggregates consumed via the service-role adapter; unchanged deny-by-default". The battery's built-in canonical posture (source migration `20261002000010`) agrees.
- **Migration text:** `ENABLE ROW LEVEL SECURITY` with ZERO policies; `REVOKE ALL ... FROM anon, authenticated`. The migration header states under "Deliberately NOT in scope": "RLS policies: ZERO policies authored (deny-by-default strongest form)".
- **Policy layer:** migration `20261002000015_coregrid_v1_substrate_policies.sql` (H2-04) lists this table explicitly under "Unchanged (out of scope; remain zero-policy deny-by-default)". Notably its sibling `cg_usage_attribution_bucket` WAS made policy-backed in that migration — the contrast is deliberate (see Rationale 3).

## DECISION

**ZERO-POLICY-BY-DESIGN.** The zero-policy deny-by-default posture is correct and legitimate for V1. No client-facing policy is proposed.

## RATIONALE

1. **Financial-metering aggregate, server-consumed.** A roll-up header is the billing/quota substrate (record family `financial`, lawful basis legal-obligation per the migration's retention posture). Client-facing financial aggregates without an authorization model for WHO may read a tenant's money data would leak cost/intensity signals. The V1 consumers are server-side (quota evaluation J-031, metering), reached through the service-role path that enforces tenant attribution.
2. **Derived Intelligence over observed reality (§9).** Token counts are observed reality; `estimated_cost_usd` inside the totals stays nullable derived intelligence. The roll-up is an aggregate with a persisted integrity verdict (`integrity_ok`, `integrity_defects` — defects surfaced, never absorbed, J-043). Aggregates whose defects are part of the record must not be rewritten or selectively read through client paths; immutability (no UPDATE/DELETE path) is what keeps the verdict trustworthy.
3. **The bucket/rollup split proves the posture is deliberate, not neglect.** H2-04 made the sibling partition table `cg_usage_attribution_bucket` policy-backed (auditable partition layer with a declared §4.4 probe recipe) while deliberately leaving the roll-up header zero-policy. The same migration that granted a client path to one table left the other untouched — the header's posture is a considered authorization decision, reaffirmed by the policy team, not a gap.
4. **Fail-closed default (§17).** Zero policies mean no policy expression anywhere can evaluate true — the strongest-form denial; no client role holds grants, so revoked/expired access fails identically. Policies remain possible later "under explicit authorization, never silently" (migration's own law).

## CONSTITUTION SECTIONS

- §9 (Canonical truth vs Intelligence — token counts are reality; cost/roll-up is derived and conserved, never silently corrected)
- §12 (Data provenance — the roll-up carries bi-temporal valid/transaction-time bounds per §12; integrity verdicts are recorded, never recomputed away)
- §16 (Layered authorization — the operative gates for financial data are server-function authorization + service-role isolation, not a client policy)
- §17 (Database security — RLS enabled, deny-by-default, zero grants; the database-level gate is the zero-policy posture itself)
- §20 (AI gateway cost tracking — the roll-up aggregates gateway usage; the gateway's server path owns access)
- §28 (Database law — append-only idempotent persistence, CHECK-constrained periods, composite-FK tenant binding on the buckets)
- §36 (Payment-adjacent financial integrity — signature-of-trust is the server path; frontend payment/roll-up state is never trusted)

## PROPOSED-POLICY-IF-ANY

**None.** No client-facing policy is legitimate in V1: there is no client consumer of roll-up headers, and a tenant-scoped SELECT policy on financial aggregates would need an authorization decision (tenant administrators only? billing-role vocabulary would violate J-006 if placed in the policy layer) that has not been made. If a future phase introduces a client billing surface, the direction would be: tenant-equality SELECT via `public.get_my_tenant_id()` restricted to an administrator predicate (`public.is_tenant_admin`), zero write policies (append-only substrate), declared as posture-file data with a §4.4 probe recipe mirroring the bucket entry. Recorded here as direction only — nothing authored, nothing applied.
