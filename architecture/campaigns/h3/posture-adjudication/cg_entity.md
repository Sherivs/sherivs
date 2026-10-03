# POSTURE ADJUDICATION — `cg_entity`

Team: H3-031 (Posture Adjudication Engineer, Squad D, kernel family) — mission D-031.
Status: ADJUDICATED 2026-10-03. Nothing applied; decision input for J-099 rationale merge.

TABLE: cg_entity
SOURCE MIGRATION: 20260903000000_coregrid_universal_kernel_substrate.sql
BATTERY POSTURE: zero-policy
DECISION: zero-policy-by-design

## OWNERSHIP

- Schema owner: Phase 33 Universal Reality Intelligence Kernel (URIK) substrate, S2 slice.
- Creating migration: `database/supabase/migrations/20260903000000_coregrid_universal_kernel_substrate.sql` (§1 "Universal entity registry"; header declares the posture verbatim: "Row-Level Security is enabled with zero policies ... Access is limited to the service role (server functions). Consuming domain runtimes author their own scoped policies when installed.").
- Writing server paths (all service-role via `asKernelAdmin(supabaseAdmin)`, all behind `requireSupabaseAuth` + tenant authorization):
  - `frontend/src/lib/kernel-reality.functions.ts` — `writeEntity` server function (`createServerFn`): authenticates, resolves tenant via `requireSchoolAdminScope`, then inserts the row with `tenant_id` pinned to the resolved school scope (never client-supplied).
  - `frontend/src/lib/foundation-loop.functions.ts` — `executeRecordFoundationLoop` / `persistFoundationPlan`: reads `cg_entity` for the reality ref and persists the plan entity under the resolved tenant.
  - `frontend/src/lib/runtime/scholar/scholar-foundation-loop.functions.ts` — `executeScholarFoundationLoop`: writes/reads `cg_entity` through the same admin-client pattern.
  - `frontend/src/lib/runtime/scholar/scholar-institution-config.functions.ts` — `publishInstitutionOperatingModel` / `getCurrentInstitutionOperatingModelDetail`: reads `latestOperatingModel` from `cg_entity` and writes versioned operating-model entities, tenant-scoped by `requireSchoolAdminScope`.
- Reading server paths: the same four server modules plus `assertEntitiesInScope` (kernel-reality) which reads `cg_entity` to enforce the tenant boundary for cross-table writes.
- Client surface: NONE. No client component, route handler, or REST surface reads or writes this table directly; every path is a server function (Constitution §34: the UI is not security — here the UI never even appears as a path).

## EVIDENCE

- Battery scope: `scripts/verify-rls-isolation-battery.mjs` `BUILTIN_TABLE_POSTURES` — `{ name: "cg_entity", source: "20260903000000_coregrid_universal_kernel_substrate.sql", posture: "zero-policy" }` (builtin-canonical entry).
- Posture files: `scripts/verification/rls-table-postures-substrate.json` and `rls-table-postures-transport.json` declare NO entry for `cg_entity` — the merged registry (`resolvePostureRegistry`) therefore resolves this table solely from the built-in canonical posture, zero-policy, with zero overrides.
- Battery-proven live: `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` §7 canonical 2026-10-02 — `cg_entity | zero-policy | relrowsecurity=true | relforcerowsecurity=false (INFO) | 0 policies | PASS`.
- Migration security posture (same file, §5): `ALTER TABLE public.cg_entity ENABLE ROW LEVEL SECURITY;`, `REVOKE ALL ... FROM anon, authenticated;`, `GRANT ALL ... TO service_role;` — zero `CREATE POLICY` statements in the whole migration.

## DECISION

**zero-policy-by-design.** The table keeps RLS enabled with zero policies and no anon/authenticated grants: deny-by-default in its strongest form (no policy expression anywhere can evaluate true — the battery's ISOLATION_PROOF strongest-form derivation). No client-facing policy is added in V1; nothing is applied by this mission.

## RATIONALE

1. No authorized client surface exists in V1: every write/read flows through server functions that satisfy Constitution §27 (authenticate via `requireSupabaseAuth`, resolve tenant via `requireSchoolAdminScope`, authorize + validate via Zod validators and `assertEntitiesInScope`, execute through the service-role adapter, audit via `cg_event`). A client-facing RLS policy would authorize a data-plane surface that no owned path currently serves — an unearned permission expansion (§7/§8: AI improvement ≠ permission expansion; likewise an adjudication must not manufacture surface).
2. The substrate predates the J-005/J-006 neutral policy convention: `tenant_id` here is a free `text` column (nullable by design for control-plane rows), not the neutral tenant primitives the 20261002000013 exemplar policies are built on. Authoring policies over the raw column now would bake a weaker predicate class into the policy layer before the substrate conversion happens.
3. Deny-by-default is the approved platform posture (RULING-2; RLS_ISOLATION_BATTERY.md dual-posture model §7) and the battery proves it continuously: anon REST probe denied, catalog shows RLS on + 0 policies, privileges grant nothing to anon/authenticated/PUBLIC, zero-policy isolation is the strongest-form derivation. Service-role bypass is compensated by explicit server-side tenant checks (the migration's own design, restated in kernel-reality's `assertEntitiesInScope` comment: "Bypassed RLS is replaced by this explicit check").
4. V1 execution boundary (§45): the kernel substrate is V1 organizational envelope; the consuming domain runtimes that would want scoped client reads are the future owners of that conversion, and per the migration's contract they author their own scoped policies in their own migrations — never by editing this posture.

## CONSTITUTION SECTIONS

- §13 Multi-Tenancy — tenant_id present; every server path pins it from the resolved scope, never from the client.
- §16 Authorization Model — service-role server path + explicit RBAC/scope gate is the layered decision; data plane denies all else.
- §17 Database Security — RLS enabled; application code is not the only layer because the data plane independently denies (defense in depth, not the only layer).
- §26 API Governance — server functions validate authentication/tenant/schema; client identity never trusted.
- §27 Server Function Rule — writeEntity/persist paths follow authenticate → resolve tenant → authorize → validate → execute → audit.
- §28 Database Law — RLS, REVOKE/GRANT discipline, FKs and CHECK constraints carried by the migration, not application logic.
- §31 Testing Standard — battery proves unauthenticated access fails; revoked/expired identity paths deny at the data plane.
- §34 Frontend Security — no hidden-UI dependency: there is no client surface at all.
- §45 V1 Execution Boundary — no client-facing policy authorized for the kernel substrate in V1; conversion requires explicit future authority.

## PROPOSED-POLICY-IF-ANY

NONE — zero-policy-by-design is affirmed for V1. Future direction (PROPOSED only, authoring deferred to the owning substrate-conversion mission): when a client-facing read surface on `cg_entity` is formally authorized, convert to the policy-backed posture in a NEW migration following the 20261002000013 exemplar — `FORCE ROW LEVEL SECURITY`, `tenant_id = public.get_my_tenant_id()` SELECT policy, `public.is_tenant_admin(tenant_id)` INSERT policy, authenticated privileges SELECT (+INSERT only if append-only semantics apply), anon/PUBLIC untouched, and a declared cross-tenant probe stage (`probeSeedRows` + `probeInsertPayload`) added to a posture JSON by the battery steward. Until that authority exists, the strongest deny-by-default remains correct and proven.