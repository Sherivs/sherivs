# POSTURE ADJUDICATION — `cg_relationship`

Team: H3-031 (Posture Adjudication Engineer, Squad D, kernel family) — mission D-031.
Status: ADJUDICATED 2026-10-03. Nothing applied; decision input for J-099 rationale merge.

TABLE: cg_relationship
SOURCE MIGRATION: 20260903000000_coregrid_universal_kernel_substrate.sql
BATTERY POSTURE: zero-policy
DECISION: zero-policy-by-design

## OWNERSHIP

- Schema owner: Phase 33 Universal Reality Intelligence Kernel (URIK) substrate, S2 slice.
- Creating migration: `database/supabase/migrations/20260903000000_coregrid_universal_kernel_substrate.sql` (§2 "Typed relationship registry"; comment: "Relationship and entity registries form the substrate of a universal reality graph"; header declares the zero-policy service-role posture for the whole substrate).
- Writing server paths (all service-role via `asKernelAdmin(supabaseAdmin)`, all behind `requireSupabaseAuth` + tenant authorization):
  - `frontend/src/lib/kernel-reality.functions.ts` — `writeRelationship` server function: authenticates, resolves tenant via `requireSchoolAdminScope`, then enforces the tenant boundary with `assertEntitiesInScope` (BOTH relationship endpoints must already be `cg_entity` rows of the actor's resolved tenant) before inserting with `tenant_id` pinned to the resolved school scope.
  - `frontend/src/lib/runtime/scholar/scholar-foundation-loop.functions.ts` — `executeScholarFoundationLoop`: inserts `cg_relationship` rows (`admin.from("cg_relationship").insert(row)`) for the entity pairs it provisions.
- Reading server paths: the same two server modules (endpoint-scope validation reads and provisioning reads). No other read surface exists.
- Client surface: NONE. Relationships are written only as part of gated server-side entity provisioning; no client component touches this table.

## EVIDENCE

- Battery scope: `scripts/verify-rls-isolation-battery.mjs` `BUILTIN_TABLE_POSTURES` — `{ name: "cg_relationship", source: "20260903000000_coregrid_universal_kernel_substrate.sql", posture: "zero-policy" }` (builtin-canonical entry).
- Posture files: `scripts/verification/rls-table-postures-substrate.json` and `rls-table-postures-transport.json` declare NO entry for `cg_relationship` — the merged registry resolves this table solely from the built-in canonical posture, zero-policy, with zero overrides.
- Battery-proven live: `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` §7 canonical 2026-10-02 — `cg_relationship | zero-policy | relrowsecurity=true | relforcerowsecurity=false (INFO) | 0 policies | PASS`.
- Migration security posture (same file, §5): `ALTER TABLE public.cg_relationship ENABLE ROW LEVEL SECURITY;`, `REVOKE ALL ... FROM anon, authenticated;`, `GRANT ALL ... TO service_role;` — zero `CREATE POLICY` statements in the whole migration.

## DECISION

**zero-policy-by-design.** RLS enabled, zero policies, nothing granted to anon/authenticated/PUBLIC. Deny-by-default in its strongest form. No client-facing policy is added in V1; nothing is applied by this mission.

## RATIONALE

1. No authorized client surface exists in V1: `cg_relationship` rows are created exclusively inside gated server functions whose authorization is already layered (§16): authentication (`requireSupabaseAuth`), tenant resolution + role gate (`requireSchoolAdminScope`), resource-boundary authorization (`assertEntitiesInScope` on both endpoints — the ReBAC-style check that the relationship graph cannot link cross-tenant entities), and Zod schema validation. The data plane adding a client policy would duplicate — and potentially weaken — that server-side layer without serving any owned path.
2. The Knowledge Graph principle (§11) is honored by posture: every relationship must preserve provenance/ownership/authorization/confidence — those are column-level invariants (source/target FKs, `confidence` CHECK, tenant pinning server-side), and opening any client-visible row set before a scoped surface is authorized would leak graph topology across tenant boundaries the server layer currently refuses.
3. Same substrate constraint as `cg_entity`: `tenant_id` is a free `text` column predating the J-005/J-006 neutral policy primitives; a policy authored now would set precedent on a predicate class the policy layer has since banned or superseded. The correct conversion path is the future exemplar-following migration (see PROPOSED-POLICY-IF-ANY).
4. Deny-by-default is the approved platform posture (RULING-2; battery §7 dual-posture model), and the battery proves the strongest-form denial live. §31's mandatory negative proofs (Tenant B invisible, unbound actor sees nothing, revoked/expired access fails) all hold trivially — and provably — under zero policies.

## CONSTITUTION SECTIONS

- §11 Knowledge Graph Principle — relationships carry provenance/ownership/authorization/confidence; posture prevents unscoped topology exposure.
- §13 Multi-Tenancy — tenant_id pinned server-side; both endpoints tenant-boundary-checked before insert.
- §16 Authorization Model — layered decision lives in the server path; data plane denies all else.
- §17 Database Security — RLS enabled; the deny is enforced by the database itself, independent of application correctness.
- §26 API Governance — client identity/tenant never trusted; server functions validate and authorize.
- §27 Server Function Rule — writeRelationship follows authenticate → resolve tenant → authorize → validate → execute.
- §28 Database Law — FK RESTRICT endpoints, CHECK constraints, RLS, REVOKE/GRANT discipline.
- §31 Testing Standard — strongest-form negative proofs hold by construction.
- §45 V1 Execution Boundary — no client-facing policy authorized for kernel substrates in V1.

## PROPOSED-POLICY-IF-ANY

NONE — zero-policy-by-design is affirmed for V1. Future direction (PROPOSED only, not applied): a future policy-backed conversion for a client-facing relationship surface must, in one NEW exemplar-following migration (20261002000013 pattern), introduce the neutral tenant reference, `FORCE ROW LEVEL SECURITY`, a `tenant_id = public.get_my_tenant_id()` SELECT policy, an `is_tenant_admin` INSERT policy, declare `probeSeedRows`/`probeInsertPayload` for the cross-tenant probe stage, and preserve the both-endpoints-same-tenant server-side check (an RLS policy alone cannot express the endpoint-boundary invariant). Until then, deny-by-default remains the proven posture.