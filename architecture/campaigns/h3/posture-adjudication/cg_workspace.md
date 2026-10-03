# Posture Adjudication — `cg_workspace` (team H3-032, Squad D / D-032)

Role: Posture Adjudication Engineer (observation/workspace family). Wave: H3,
mission D-032. Scope of this document: the RLS posture of
`public.cg_workspace` ONLY. Nothing is applied; the posture JSON files remain
untouched (team J-099 merges rationales later).

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20260930000000_coregrid_v1_workspace_persistence.sql`
  (MISSION-V1-007 step 3, V1-minimal workspace persistence). Table defined at
  lines 28–50; RLS enabled at line 97; `REVOKE ALL ... FROM anon,
  authenticated` at line 100. No `CREATE POLICY` statement exists anywhere in
  the file. Rollback: `database/supabase/rollbacks/20260930000000_coregrid_v1_workspace_persistence.sql`.
- **Domain contract:** `frontend/src/lib/workspace-core.ts` — the pure,
  domain-neutral workspace model (`Workspace` interface, `WORKSPACE_TYPES`,
  `WORKSPACE_LIFECYCLE_STATES`) whose type/lifecycle vocabulary the
  migration's CHECK constraints mirror line-for-line (migration header lines
  18–21).
- **Server paths (traced via rg):** none today. No server function reads or
  writes `cg_workspace` — `rg '\.from\("cg_workspace'` over the repository
  returns zero matches. The migration's own security note (lines 23–25)
  states the intended writer class and its absence: "No anon or authenticated
  privileges. RLS is enabled with zero policies, so those roles are denied.
  Service-role server functions are the only intended writer and are not
  created here." The consumers of the workspace model
  (`frontend/src/lib/workspace-membership.ts`, `shell-org-switcher.ts`,
  `workspace-governance.ts`, `workspace-composition.ts`) consume the pure
  domain module, not the table.
- **Status:** applied to the dev project (CTO directive Part 30;
  `COREGRID_V1_BLOCKERS.json` OPS-2, applied via the authorized
  management-API path) and battery-proven (below).

## EVIDENCE

1. **Battery scope (read-only confirmation):**
   `scripts/verify-rls-isolation-battery.mjs`, `BUILTIN_TABLE_POSTURES` line
   198: `{ name: "cg_workspace", source: "20260930000000_coregrid_v1_workspace_persistence.sql", posture: "zero-policy" }`.
   Neither `scripts/verification/rls-table-postures-substrate.json` nor
   `...-transport.json` contains a `cg_workspace` entry, so no posture file
   overrides or extends the built-in canonical zero-policy posture
   (`postureSource=builtin-canonical`; confirmed via the offline
   `--dry-parse-scope` registry resolution — no credentials, no network, no
   live database).
2. **Battery-proven live:** `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`
   §7 result tables, rows `cg_workspace`: posture zero-policy,
   `relrowsecurity = true`, `relforcerowsecurity = false (INFO)`, permissive
   policies 0, denial forms 401 / 42501 — **PASS** (36/36, canonical
   2026-10-02).
3. **Migration enforcement text (lines 95–101):** `ENABLE ROW LEVEL SECURITY`
   + `REVOKE ALL` from anon/authenticated, with the explicit comment
   "Deny-by-default: RLS on, zero policies (mirrors the foundation + kernel
   substrate security posture; verified by the RLS isolation check)."
4. **The table's own semantics disclaim authority:** `COMMENT ON TABLE
   public.cg_workspace` (lines 52–55): "Authorized projection backing store
   per V5.3 Part 12: never a source of organizational truth beyond its own
   configuration; never grants authority by existence."

## DECISION

**ZERO-POLICY-BY-DESIGN — adjudicated, unchanged.** The zero-policy posture is
the deliberate, documented, battery-proven V1 posture of `cg_workspace`. A
non-binding future policy direction is recorded below; nothing is pending for
V1 and nothing is applied.

## RATIONALE

1. **Projection, not truth — and not yet a surface.** `cg_workspace` is the
   durable backing store for workspace configuration (V5.3 Part 12). No V1
   server function exposes it to clients; the workspace domain modules
   operate on the pure contract in `workspace-core.ts`. A client-facing
   SELECT policy now would protect a surface no contract consumes — pure
   attack-surface expansion with zero authorized consumer.
2. **The writers that will exist are service-role server functions.** The
   migration says so explicitly (lines 23–25). When a workspace server
   surface ships, it must implement the §27 sequence (authenticate, resolve
   tenant, authorize, validate, execute, audit) and would be the operative
   gate; RLS zero-policy remains the second layer guaranteeing even a buggy
   future client path denies by default (§17: application code is never the
   only security layer).
3. **Authorization never flows through workspace existence.** The table
   comment disclaims it, and the platform's authority substrate is the
   policy-backed `cg_role_assignment` / `cg_role_grant` pair plus
   `cg_org_membership` (J-005/J-006, battery-proven by genuine cross-tenant
   probes). Workspace membership binding lives in the sibling
   `cg_workspace_member` and likewise never grants authority by itself —
   granting a client read policy on the workspace record would invert that
   law by making configuration rows an authorization input.
4. **Zero-policy is the strongest form of deny-by-default** (RLS_ISOLATION_BATTERY.md
   §7 dual-posture model): RLS enabled with zero policies means no policy
   expression anywhere can evaluate true — no identity can read a single row
   through the client data plane. Battery-proven live, not reasoned.
5. **Conversion readiness is clean but unexercised:** `tenant_id` is `NOT NULL`
   (migration line 30) with a `(tenant_id, code)` unique constraint and a
   `(tenant_id, lifecycle_state)` index, so the J-005/J-006 neutral-predicate
   conversion path is available the day a client-facing workspace surface is
   authorized. Until then, authoring the policy would only pre-authorize an
   access decision that no policy layer (§16) currently defines.

## CONSTITUTION SECTIONS

- §13 Multi-Tenancy Law — the table is tenant-keyed (`tenant_id NOT NULL`);
  tenant context for any future surface is resolved server-side per §27.
- §16 Authorization Model — layered authorization; no decision inputs are
  defined for a client workspace read path, so the data plane denies.
- §17 Database Security — RLS mandatory and enabled; zero policies is the
  strongest deny-by-default expression.
- §26 API Governance / §27 Server Function Rule — never trust client-supplied
  tenant/identity; the intended writer class is gated server functions.
- §28 Database Law — RLS + revocable grants over application logic; FKs,
  CHECK constraints and unique constraints carry integrity in the migration.
- §34 Frontend Security — the UI is not security; deny at the data plane.
- §10 Digital Twin Governance (analogy, same law): holding configuration
  inside a projection does not mean everyone can access it.

## PROPOSED-POLICY-IF-ANY

**PROPOSED (non-binding, nothing applied, not required for V1):** if and when a
client-facing workspace read surface is authorized, author a follow-up
migration in the 20261002000013 (J-005/J-006 neutral membership policies)
exemplar form: FORCE RLS; `SELECT` policy
`tenant_id = public.get_my_tenant_id()`; `INSERT`/`UPDATE` policies gated by
`public.is_tenant_admin(tenant_id)` (workspace configuration is an
administrative act); zero `anon`/`PUBLIC` grants; declare the entry in a
posture JSON with `tenantColumn: "tenant_id"` and a §4.4 probe recipe
(probeSeedRows + probeInsertPayload) so the battery's genuine cross-tenant
probe stage covers it. Until that authorization exists, this table stays
zero-policy — deny-by-default is the correct V1 answer, not a debt marker.
