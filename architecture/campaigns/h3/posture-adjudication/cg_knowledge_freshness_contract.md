# RLS Posture Adjudication — `cg_knowledge_freshness_contract`

Mission: H3-039 (Squad D, knowledge family). Role: Posture Adjudication Engineer.
Adjudication date: 2026-10-03. Status: ZERO-POLICY-BY-DESIGN — CONFIRMED (nothing applied).

## OWNERSHIP

| Question | Answer |
| --- | --- |
| Creating migration | `database/supabase/migrations/20261002000011_coregrid_v1_knowledge_currency.sql` (J-019 / V1CAP-040 / MISSION-R-71 — AUTHORED, NOT APPLIED; verified live-apply is coordinator-gated) |
| Rollback | `database/supabase/rollbacks/20261002000011_coregrid_v1_knowledge_currency.sql` |
| Owning contract (domain) | `frontend/src/lib/memory/knowledge-currency.ts` — pure freshness/invalidation/reliability currency contract composed over the phase-36 memory tier |
| Only server write/read path | `frontend/src/lib/adapters/knowledge-currency-store.adapter.ts` — the ONLY place DB calls appear (Constitution §24/§25); injected **service-role** client surface (`KnowledgeCurrencyDbClient`); writes are append-only, idempotent (`ON CONFLICT (record_id, tenant_id) DO NOTHING`); reads are strictly `WHERE tenant_id = $1` (`loadContracts`) |
| Registry/apply provenance | `scripts/apply-canonical-hardening.mjs` declares the table + indexes `cg_knowledge_freshness_contract_tenant_idx`, `cg_knowledge_freshness_contract_source_idx` for migration 20261002000011 |
| Telemetry family | `frontend/src/lib/observability/substrate-telemetry.ts` — knowledge-currency substrate family |
| Battery owner (not us) | `scripts/verify-rls-isolation-battery.mjs` TABLES registry, line 259: `{ name: "cg_knowledge_freshness_contract", source: "20261002000011_…", posture: "zero-policy" }` |
| Posture file owner (not us) | `scripts/verification/rls-table-postures-substrate.json` — entry `cg_knowledge_freshness_contract`, `posture: "zero-policy"`, source 20261002000011 |

No client-facing route, page, or React surface reads or writes this table: the only frontend references to `cg_knowledge_freshness_contract` are inside the server adapter module (verified by repo-wide search of `frontend/src`).

## EVIDENCE

1. **Battery scope (read-only dry parse, run 2026-10-03):**
   `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` → exit 0, `DRY_PARSE_OK tables=37 zero-policy=30 policy-backed=7`, line:
   `cg_knowledge_freshness_contract posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000011_coregrid_v1_knowledge_currency.sql postureSource=rls-table-postures-substrate.json`
2. **Posture JSON (READ-ONLY):** `rls-table-postures-substrate.json` tables entry carries `posture: "zero-policy"` and the file's `batteryExpectations.zeroPolicyTables` array includes `cg_knowledge_freshness_contract`.
3. **Migration DDL:** `ENABLE ROW LEVEL SECURITY` (line 260), `REVOKE ALL ON public.cg_knowledge_freshness_contract FROM anon, authenticated` (line 265), zero `CREATE POLICY` statements in the whole migration ("Deliberately NOT in scope: RLS policies: ZERO policies authored (deny-by-default strongest form…)", lines 73–74, and §5 deny-by-default posture, lines 246–267).
4. **Migration integrity pinning already exists:** `tests/unit/adapter-knowledge-currency.test.ts` pins migration/rollback text for 20261002000011 (including the per-table REVOKE) — independent confirmation that the authored posture is zero-policy.
5. **Access path is service-role only:** adapter header — "Service-role access only: the tables are zero-policy deny-by-default (RLS enabled, all anon/authenticated privileges revoked), so no policy-bearing client is accepted." Every read is tenant-parameterized; every write is same-tenant by composite FK at the substrate level.

## DECISION

**ZERO-POLICY-BY-DESIGN — CONFIRMED.** The zero-policy posture is correct for V1 and must not be changed this wave. No policy migration is authored; nothing is applied.

## RATIONALE

- The freshness contract is a **knowledge-governance record** that feeds the AGENTS §9 canonical-truth boundary: it is the platform-side declaration of when a memory record's currency state (fresh/stale) may be asserted, i.e. an input to how *Intelligence* (derived) is kept distinguishable from *Reality* (canonical). Per §9, AI inference must never overwrite canonical truth without validation — the currency boundary is part of that validation substrate, and it is enforced server-side by the pure contract plus the adapter, not by client opinion.
- There is **no legitimate V1 client surface** for freshness contracts: no API/page consumes them directly. Clients observe currency effects (stale-flagging, revalidation duties) through the contract's read-time evaluation; the storage rows themselves are tenant-sensitive platform state (Constitution §17 classifies this as mandatory-RLS data — RLS **is** enabled; the zero-policy form is the strongest deny-by-default).
- Deny-by-default + privilege revocation means the database itself refuses anon/authenticated access regardless of application bugs (Constitution §34 "the UI is not security", §17 "application code must never be the only security layer"). The service-role adapter path is the single audited choke point, per §27 server-function law (authenticate → tenant resolve → authorize → validate → execute → audit).
- Same-tenant integrity is already database-enforced beneath the posture layer: composite FK `(source_id, tenant_id) → cg_knowledge_source (id, tenant_id)` ON DELETE RESTRICT makes cross-tenant contracts unbindable (migration lines 139–145). The migration explicitly defers policies to "the policy team and the RLS battery" under explicit authorization (lines 73–74, 253–256) — which is exactly this adjudication.
- The migration is AUTHORED, NOT APPLIED; live posture verification is the coordinator's canonical-apply + battery run (campaign law §5). The battery scope already carries this table as zero-policy, so the deny posture is probe-verified when the wave's live battery runs.

## CONSTITUTION SECTIONS

§9 (canonical truth vs intelligence), §13 (multi-tenancy — tenant context on every request), §15 (identity/authorization/policy separation), §16 (layered authorization — service-role path with tenant checks), §17 (RLS mandatory — enabled; application never the only layer), §24/§25 (domain → adapter → provider layering), §26 (never trust client identity/tenant), §27 (server functions are APIs), §28 (database law — constraints, composite FKs, append-only acts), §34 (frontend is not security), §45 (V1 execution boundary).

## PROPOSED-POLICY-IF-ANY

**None applied. Direction only (PROPOSED, requires explicit human authorization per §8/§40):**

1. *If* a future V1.x phase authorizes a tenant-facing knowledge-currency read surface, the only defensible first policy is a SELECT-only, tenant-equality policy on `cg_knowledge_freshness_contract` built exclusively on the J-005 neutral primitives: `tenant_id = public.get_my_tenant_id()` to `authenticated`, with anon privileges remaining revoked and **no** INSERT/UPDATE/DELETE policy (registration is a server-adapter act, never client-writable — append-only law ADR-005/§28).
2. `cg_knowledge_invalidation` and `cg_knowledge_downgrade` acts should remain permanently zero-client-write (audit-grade tombstones); any future read policy for them must be proposed separately with an immutability argument, not bundled with the contract table.
3. Until (1) is authorized and battery-proven, any posture-file change for this table is out of our authority (owner: J-099 merge; live proof: coordinator battery run).