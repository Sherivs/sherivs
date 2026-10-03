# RLS Posture Adjudication — `cg_worker_delegation`

Team: H3-034 · Squad D (Zero-policy posture adjudication) · Role: Posture Adjudication Engineer (delegation/memory family) · Mission: D-034
Adjudicated: 2026-10-03 · Status: ADJUDICATED (zero-policy-by-design) · Nothing applied; no posture file, migration, or policy was touched.

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000002_coregrid_v1_worker_definitions.sql` (MISSION-R-40 / J-027 / V1CAP-048; style exemplar `20261002000001_coregrid_v1_neutral_tenant_primitives.sql`). Table created at line 214; RLS enabled line 256; `REVOKE ALL ... FROM anon, authenticated` line 260. Rollback: `database/supabase/rollbacks/20261002000002_coregrid_v1_worker_definitions.sql`.
- **Owning server path (contract):** `frontend/src/lib/workforce/worker-definition.ts` — the persistent governed-worker contract (RULING-3 chain: Definition -> Delegation -> Mission Assignment -> Ephemeral Runtime -> ...). It owns the delegation-history write semantics (`recordDelegation`) and the authority-bounds intersection (`claimWorkerRuntime`): a runtime claims authority ONLY by intersecting an explicit delegation with the definition's declared capability set and authority bounds; claimed authority beyond the definition is DENIED, never clamped.
- **Consuming server paths (read):** `frontend/src/lib/agent-runtime/ephemeral-lifecycle.ts` (ephemeral runtime claims at the Definition -> Runtime edge) and `frontend/src/lib/agent-runtime/capability-matching.ts` (J-028 capability-over-agent-count matching reads capability declarations; workers are never matched by name). `frontend/src/lib/memory/memory-store.ts` resolves worker memory sessions against governed worker definitions (J-007).
- **Data role:** append-only delegation history references — every delegation that ever bound a runtime to a definition, with the risk class (`max_granted_risk_class` CHECK: low|medium|high|critical) and capability set actually granted. Unique per (definition, delegation_ref). These rows are governance-critical AUTHORITY records, not user content.

## EVIDENCE

- **Battery scope (READ-ONLY confirmation, 2026-10-03):** `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` (offline; no credentials, no network, no database) reports:
  `cg_worker_delegation posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000002_coregrid_v1_worker_definitions.sql postureSource=builtin-canonical`
- The table is a `BUILTIN_TABLE_POSTURES` entry in `scripts/verify-rls-isolation-battery.mjs` (line 239). Neither `scripts/verification/rls-table-postures-substrate.json` nor `rls-table-postures-transport.json` declares `cg_worker_delegation` — the resolved registry (`DRY_PARSE_OK tables=37 zero-policy=30 policy-backed=7`) leaves the built-in canonical zero-policy entry authoritative with exactly one source of truth (duplicate declarations are rejected by `resolvePostureRegistry`).
- **Migration posture note (lines 242–251):** "RLS ENABLED with ZERO policies and all anon/authenticated privileges REVOKED ... Zero policies are deliberate: worker definitions are governance-critical authority records, and no tenant-scoped policy exists yet that provably cannot widen worker authority — worker administration runs through service-role server functions only. Policies may be authored by a follow-up migration under explicit authorization, never silently."
- **Contract boundary note (`worker-definition.ts` lines 17–34):** workers are ACTORS with no separate authorization path; every claim resolves through the same identity-actor primitive as human identities; the module is pure data + pure functions with NO persistence/IO/vendor — database truth is the migration above.
- **Enforcement evidence:** `tests/unit/h3-016-worker-bounds.test.ts` proves the bounds (risk ceiling, scope/capability subset, non-escalating delegation depth) over these contracts; its report (`progress/h3-wave/H3-016.report.md`) is the enforcement-side input this adjudication cites.

## DECISION

**ZERO-POLICY-BY-DESIGN — confirmed and upheld.** RLS enabled, zero policies, no anon/authenticated grants. This is the strongest form of deny-by-default: with zero policies, no policy expression anywhere can evaluate true for any identity; the only data path is the explicit, logged service-role server channel. No policy is proposed for V1.

## RATIONALE

1. **Governance-critical authority records.** A delegation row IS an authorization fact (who granted what risk class/capability to which worker). Any client-facing row-level policy on such a table would put a piece of the authorization system in the hands of the identities it constrains — a policy that reads its own authority table. The migration's own law states the exact reason: no tenant-scoped policy exists yet that provably cannot widen worker authority.
2. **No legitimate V1 client-facing path.** The owning contract (`worker-definition.ts`) is pure functions with no I/O; all persistence runs through service-role server functions under the §27 server-function rule (authenticate -> resolve tenant -> authorize -> validate -> execute -> audit -> return permitted data). Delegation administration is a governance operation, not a tenant CRUD surface.
3. **Append-only attribution substrate.** The table exists to prove Delegation -> Worker Execution attribution across process restarts (G-014); per Constitution §28 it must be immutable history, which zero-policy + zero client grants guarantee absolutely (no client UPDATE/DELETE policy can even be contemplated).
4. **Strongest-form isolation is provable now.** The battery's zero-policy derivation (RLS battery §7, canonical 36/36) proves Tenant A cannot read Tenant B, User A cannot read User B, revoked/expired access fails, and agents cannot exceed permissions — mechanically, not by policy reasoning. A policy-backed conversion would WEAKEN the proof class from "no expression can evaluate true" to "expression evaluates true only under predicates".

## CONSTITUTION SECTIONS

- **§5 Agent Identity Model** — agents are untrusted by default; worker authority is declared, not self-claimed.
- **§8 Self-Improvement Law** — AI improvement ≠ AI permission expansion; zero-policy guarantees no silent widening of worker authority at the data layer.
- **§16 Authorization Model** — the decision inputs (identity, tenant, role, relationship) resolve through the shared actor/authorization layer, not a table policy.
- **§17 Database Security** — RLS mandatory; application code never the only security layer; RLS is enabled here with the strongest zero-policy form.
- **§26 API Governance** — never trust client tenant/role/identity; no client surface exists on this table.
- **§28 Database Law** — append-only immutable audit/delegation records; constraints + RLS over application logic.
- **§31 Testing Standard** — revoked/expired access fails and agents cannot exceed permissions are exactly the zero-policy invariants the battery proves.
- **§37 Autonomous Coding Agent Rules** — agents may not expand permissions; this posture is the enforcement substrate.

## PROPOSED-POLICY-IF-ANY

**None.** No client-facing policy is proposed in V1. If a future mission authorizes tenant-scoped worker-delegation reads (e.g., a tenant governance dashboard), the conversion path is: a neutral tenant-scoped policy migration in the `20261002000013_coregrid_v1_neutral_membership_policies.sql` exemplar pattern (FORCE RLS + `tenant_id = public.get_my_tenant_id()` SELECT, `is_tenant_admin` INSERT), with append-only law preserved (no UPDATE/DELETE policy ever) AND a data-declared §4.4 cross-tenant probe recipe (`probeSeedRows` + `probeInsertPayload` in the posture file) so the battery can prove tenant-scoped visibility rather than assume it. Authoring such a migration requires explicit human authorization and re-adjudication — it is deliberately NOT pre-authored here.