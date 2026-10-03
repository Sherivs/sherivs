# RLS Posture Adjudication — `cg_memory_scope`

Team: H3-034 · Squad D (Zero-policy posture adjudication) · Role: Posture Adjudication Engineer (delegation/memory family) · Mission: D-034
Adjudicated: 2026-10-03 · Status: ADJUDICATED (zero-policy-by-design) · Nothing applied; no posture file, migration, or policy was touched.

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000004_coregrid_v1_memory_tier.sql` (MISSION-R-36 / J-016 / V1CAP-034/035/036; D1 ratification via DOSSIER_D1_MEMORY_OWNER.md — phase 36 is the canonical owner of the practical/organizational memory tier). Table created at line 75; RLS enabled line 273; `REVOKE ALL ... FROM anon, authenticated` line 277. Rollback: `database/supabase/rollbacks/20261002000004_coregrid_v1_memory_tier.sql`.
- **Owning server path (contract):** `frontend/src/lib/memory/memory-store.ts` — the durable tier's authorization-gated contract (ratification condition: the schema must not reach retrieval capability without the J-017 authorization-gated, non-vector-only retrieval guard). It enforces: retrieval REQUIRES identity AND tenant AND declared scope (any missing -> DENIAL before any record is evaluated, fail-closed); NO vector/semantic-similarity surface anywhere (G-015); every retrieval — granted, partial, or DENIED — appends one auditable access record (`cg_memory_access_log`); no silent memory expansion (J-017/E-027 — out-of-scope writes are REJECTED, never clamped; an undeclared scope grants nothing).
- **Consuming server path:** `frontend/src/lib/agent-runtime/ephemeral-lifecycle.ts` — worker memory sessions (J-007/V1CAP-016) resolve against a governed worker definition; every session write/retrieval is evaluated against the DECLARED scope; a session cannot widen its own scope (widening requires a new governed worker-definition revision).
- **Data role:** `cg_memory_scope` is the DECLARED scope boundary of every memory read AND write — tenant, mission ref, actor scope, domains, sensitivity ceiling. Empty bounds grant NOTHING (deny-by-default). It is the policy-input of the memory tier, i.e., itself an authorization artifact.

## EVIDENCE

- **Battery scope (READ-ONLY confirmation, 2026-10-03):** `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` (offline; no credentials, no network, no database) reports:
  `cg_memory_scope posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000004_coregrid_v1_memory_tier.sql postureSource=builtin-canonical`
- The table is a `BUILTIN_TABLE_POSTURES` entry in `scripts/verify-rls-isolation-battery.mjs` (line 240). Neither `scripts/verification/rls-table-postures-substrate.json` nor `rls-table-postures-transport.json` declares `cg_memory_scope`; the resolved registry (`DRY_PARSE_OK tables=37 zero-policy=30 policy-backed=7`) keeps the built-in canonical zero-policy entry as the single source of truth.
- **Migration posture note (lines 261–270):** "RLS ENABLED with ZERO policies and all anon/authenticated privileges REVOKED ... Zero policies are deliberate: memory is tenant-sensitive platform data (Constitution §17/§35) and no tenant-scoped policy exists yet that provably cannot widen retrieval beyond the declared scope — memory access runs through service-role server functions that enforce the identity AND tenant AND scope AND policy authorization contract (memory-store.ts) and write the access log. Policies may be authored by a follow-up migration under explicit authorization, never silently."
- **Non-vector-only law (migration lines 41–47):** deliberately NO embedding/vector/similarity column is authored on any table; semantic-similarity search is a classic authorization bypass; any future ANN index is an ADDITIVE migration requiring its own authorization and authorization-gated join.
- **Contract boundary note (`memory-store.ts` lines 39–45):** pure data + pure functions, no persistence/IO/vendor; database truth is authored (NOT applied) in the migration above with deny-by-default RLS (enabled, zero policies, no anon/authenticated grants); application code is never the only security layer (Constitution §17).
- **Adversarial enforcement evidence:** `tests/unit/h3-029-memory-retrieval-authz.test.ts` (mission C-029, L-T-015 Memory Retrieval Defender) proves retrieval is authorization-gated with no bypass path; `tests/unit/memory-store.test.ts` pins the contract semantics.

## DECISION

**ZERO-POLICY-BY-DESIGN — confirmed and upheld.** RLS enabled, zero policies, no anon/authenticated grants. Every memory access resolves through the service-role server functions that enforce the identity AND tenant AND scope AND policy contract and write the access log. No client-facing policy is proposed in V1.

## RATIONALE

1. **Authorization artifact, not tenant content.** `cg_memory_scope` declares the boundary of what memory reads/writes may touch. A client-facing row policy on the scope-declaration table would let client identities read (and thus probe or influence) the authorization surface itself — the reverse of deny-by-default. The declared-scope model already grants nothing until a governed write/retrieval is authorized server-side.
2. **L-T-015 closure at the data layer.** Threat L-T-015 (memory retrieval authorization bypass — "memory must not be a side door around authorization", J-017; worker memory scopes can silently expand, J-018/J-029) is precisely the threat a permissive policy surface would widen. Zero policies close the entire direct client data plane: similarity or not, no identity can reach rows except through the gated contract whose denials are themselves audited (`cg_memory_access_log` records granted/partial/denied).
3. **AGENTS §19 AI Privacy Law.** Before data reaches a model, the pipeline is Identity -> Authorization -> Classification -> Purpose Check -> Minimization -> Redaction -> AI Context -> Model. Memory records are exactly the AI-context feedstock. Zero-policy RLS guarantees that only the server-side gate — which performs that §19 sequence — can ever produce rows for an AI context; no client path can feed the gateway unminimized data.
4. **No policy that provably cannot widen retrieval exists yet.** The migration states it verbatim: no tenant-scoped policy exists yet that provably cannot widen retrieval beyond the declared scope. Retrieval authorization is conjunctive (identity AND tenant AND scope AND policy); expressing that conjunct safely in a policy predicate would require the J-017 scope semantics inside SQL — a capability the platform has not ratified for the policy layer.
5. **Strongest-form proof is live.** The battery's zero-policy derivation proves all four §31 invariants mechanically for this table; a policy-backed conversion would downgrade the proof class and re-open the L-T-015 surface it exists to close.

## CONSTITUTION SECTIONS

- **§17 Database Security** — RLS mandatory, enabled in its strongest form; application code (the memory-store gate) is layered ON TOP of deny-by-default, never the only layer.
- **§19 AI Privacy Law** — AI receives only authorized information; the zero-policy posture makes the authorization gate the sole path from memory rows to any model context.
- **§21 AI Output Trust / §9 Canonical Truth** — memory records carry provenance and bi-temporal validity; nothing client-writable may mutate that truth surface.
- **§26 API Governance** — never trust client identity/tenant/scope; the scope declaration is resolved server-side, never client-asserted.
- **§28 Database Law** — access denials are recorded (append-only `cg_memory_access_log`), immutable audit posture across the tier.
- **§35 Realtime Security** — zero policies means zero client-visible realtime events from this table (row visibility follows RLS).
- **§31 Testing Standard** — revoked/expired access fails; agents cannot exceed permissions: both are proven mechanically by the battery's zero-policy derivation.
- **§37 Autonomous Coding Agent Rules** — agents may not expand memory access; the declared-scope + zero-policy posture is the enforcement substrate (J-029).

## PROPOSED-POLICY-IF-ANY

**None for V1.** The only coherent future direction — if and when a mission explicitly authorizes tenant-scoped memory-scope introspection (e.g., a tenant's own governance view of its declared scopes) — is a policy-backed conversion in the `20261002000013` exemplar pattern: FORCE RLS, SELECT restricted to `tenant_id = public.get_my_tenant_id()`, INSERT gated by `is_tenant_admin` WITH CHECK, no UPDATE/DELETE ever (scopes are retired, not mutated — J-017), plus a data-declared §4.4 probe recipe so the battery proves tenant-scoped visibility. That conversion would need to demonstrate the policy predicate cannot widen retrieval beyond the declared scope — the exact condition the migration requires — and must go through explicit human authorization and re-adjudication. It is deliberately NOT pre-authored here.