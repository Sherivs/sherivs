# Posture Adjudication — `cg_knowledge_source` (H3-038, Squad D)

Role: Posture Adjudication Engineer (provenance/usage family). Mission D-038.
Status: ADJUDICATED — zero-policy-by-design. Nothing applied; no posture file, migration, or policy was modified.

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000011_coregrid_v1_knowledge_currency.sql` (J-019 / V1CAP-040 / MISSION-R-71, wave 3). Rollback: `database/supabase/rollbacks/20261002000011_coregrid_v1_knowledge_currency.sql`.
- **Owning server paths (the only write/read paths found by `rg` repo-wide):**
  - Adapter: `frontend/src/lib/adapters/knowledge-currency-store.adapter.ts` — exports `KNOWLEDGE_SOURCE_TABLE = "cg_knowledge_source"`; service-role-only injected client; append-only, idempotent writes (`ON CONFLICT DO NOTHING`); no UPDATE/DELETE path authored (ADR-005 tombstone law: acts append, records never rewritten).
  - Pure contract: `frontend/src/lib/memory/knowledge-currency.ts` (J-019 / V1CAP-040) — freshness, invalidation and source-reliability composed OVER the phase-36 memory tier (`frontend/src/lib/memory/memory-store.ts`, migration `20261002000004` — untouched).
  - Test pin: `tests/unit/adapter-knowledge-currency.test.ts` (mechanically pins the migration text).
- **Client-facing surface:** none. Source reliability tiers are consumed at query time by the pure contract through server functions; no REST/UI path touches this table.

## EVIDENCE

- **Battery scope (READ-ONLY confirmation):** `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` (offline, no credentials) resolves
  `cg_knowledge_source posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000011_coregrid_v1_knowledge_currency.sql postureSource=rls-table-postures-substrate.json`.
- **Posture registry:** `scripts/verification/rls-table-postures-substrate.json` declares the table as `"posture": "zero-policy"` with rationale "knowledge-currency family not authorized for tenant-scoped client access by H2-04 — unchanged deny-by-default". The battery's built-in canonical posture (source migration `20261002000011`) agrees.
- **Migration text:** `ENABLE ROW LEVEL SECURITY` with ZERO policies; `REVOKE ALL ... FROM anon, authenticated`. The migration header states under "Deliberately NOT in scope": "RLS policies: ZERO policies authored (deny-by-default strongest form; policies come later from the policy team and the RLS battery)" and under the deny-by-default posture section: "no tenant-scoped policy yet exists that provably cannot widen reads beyond the record's tenant — access runs through service-role server functions that enforce the contract's tenant isolation (every act is same-tenant by construction)".
- **Policy layer:** migration `20261002000015_coregrid_v1_substrate_policies.sql` (H2-04) lists this table explicitly under "Unchanged (out of scope; remain zero-policy deny-by-default)".

## DECISION

**ZERO-POLICY-BY-DESIGN.** The zero-policy deny-by-default posture is correct and legitimate for V1. No client-facing policy is proposed.

## RATIONALE

1. **Reliability governance, not client content.** `cg_knowledge_source` is a registry of declared reliability tiers (`authoritative` > `verified` > `provisional` > `unverified`), each declared WITH evidence provenance (G-047/G-052 — a tier is a claim, and the claim carries its evidence). It carries no subject-identifying personal values by design (migration retention posture: classification governance-config, non-personal); its sensitivity is epistemic, not personal. A client-writable policy would let callers mint or move trust tiers; the substrate forbids that structurally (downgrades only, CHECK-ranked strict-down, no upgrade path authored) and the V1 access model forbids it operationally (service-role server functions only).
2. **Integrity of the trust chain (§9/§12).** Every knowledge record inherits its source's CURRENT tier at query time — propagation is structural. The tier registry is therefore an integrity surface for everything downstream: if a tier could be read through a policy path that a compromised or over-scoped client role can reach, every record's currency flag inherits the corruption. Zero policies + zero grants is the strongest available database-level guarantee that only the server path touches trust state.
3. **Same-tenant integrity is already database-enforced (§17/§28).** Cross-tenant acts are impossible by composite FKs (`cg_knowledge_freshness_contract` and `cg_knowledge_downgrade` bind by `(id, tenant_id)`); tenant isolation at rest does not depend on a policy predicate, so no policy is required for isolation — RLS-enabled zero-policy deny for all client roles is strictly stronger than any tenant-scoped predicate for a table with no legitimate client consumer.
4. **Fail-closed default.** The H2-04 policy layer explicitly left this table "unchanged"; the migration's own law requires any future policy to be "authored by a follow-up migration under explicit authorization, never silently."

## CONSTITUTION SECTIONS

- §9 (Canonical truth vs Intelligence — reliability tiers are governed claims about knowledge, evaluated at read time, never silently raised)
- §11 (Knowledge-graph principle — relationships between sources and records must preserve provenance/ownership/authorization/confidence; this registry is where the confidence tier lives)
- §12 (Data provenance — the declared tier carries its evidence ref; provenance columns are never filtered or rewritten)
- §17 (Database security — RLS enabled, deny-by-default; composite-FK tenant binding enforces same-tenant acts at rest)
- §28 (Database law — append-only tombstone acts, UNIQUE one-act-per-record invalidation, strict-down CHECK; constraints carry the invariants, not application logic)

## PROPOSED-POLICY-IF-ANY

**None.** No client-facing policy is legitimate in V1: there is no client consumer of the source-reliability registry, and exposing trust tiers through a client policy would put the epistemic governance surface on the network edge before any authorization decision defines which principals may see (let alone influence) knowledge-reliability state. If a future phase builds a client-facing knowledge-currency view, the direction would be: tenant-equality SELECT via `public.get_my_tenant_id()` for registry reads, zero write policies (declaration and acts are server-path appends only), declared as posture-file data with a §4.4 probe recipe. Recorded here as direction only — nothing authored, nothing applied.
