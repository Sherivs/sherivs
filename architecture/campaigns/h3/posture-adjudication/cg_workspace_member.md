# Posture Adjudication — `cg_workspace_member` (team H3-032, Squad D / D-032)

Role: Posture Adjudication Engineer (observation/workspace family). Wave: H3,
mission D-032. Scope of this document: the RLS posture of
`public.cg_workspace_member` ONLY. Nothing is applied; the posture JSON files
remain untouched (team J-099 merges rationales later).

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20260930000000_coregrid_v1_workspace_persistence.sql`
  (MISSION-V1-007 step 3, V1-minimal workspace persistence). Table defined at
  lines 68–80; RLS enabled at line 98; `REVOKE ALL ... FROM anon,
  authenticated` at line 101. No `CREATE POLICY` statement exists anywhere in
  the file. Rollback: `database/supabase/rollbacks/20260930000000_coregrid_v1_workspace_persistence.sql`
  (drops both workspace tables).
- **Domain contract:** `frontend/src/lib/workspace-core.ts` and its
  membership-adjacent consumers (`frontend/src/lib/workspace-membership.ts`,
  `workspace-governance.ts`, `workspace-composition.ts`) — the pure,
  domain-neutral membership lifecycle vocabulary (`invited` / `active` /
  `suspended` / `removed`) mirrored by the table's `state` CHECK.
- **Server paths (traced via rg):** none today. No server function reads or
  writes `cg_workspace_member` — `rg '\.from\("cg_workspace'` over the
  repository returns zero matches. The migration's security note (lines 23–25)
  states the intended writer class and its absence: "Service-role server
  functions are the only intended writer and are not created here."
- **The authority substrate it must never shadow:** `cg_role_assignment`,
  `cg_role_grant`, `cg_org_membership` (policy-backed, J-005/J-006,
  battery-proven) — the tables the platform actually resolves permissions
  through.
- **Status:** applied to the dev project (CTO directive Part 30;
  `COREGRID_V1_BLOCKERS.json` OPS-2) and battery-proven (below).

## EVIDENCE

1. **Battery scope (read-only confirmation):**
   `scripts/verify-rls-isolation-battery.mjs`, `BUILTIN_TABLE_POSTURES` line
   199: `{ name: "cg_workspace_member", source: "20260930000000_coregrid_v1_workspace_persistence.sql", posture: "zero-policy" }`.
   Neither `scripts/verification/rls-table-postures-substrate.json` nor
   `...-transport.json` contains a `cg_workspace_member` entry, so no posture
   file overrides or extends the built-in canonical zero-policy posture
   (`postureSource=builtin-canonical`; confirmed via the offline
   `--dry-parse-scope` registry resolution — no credentials, no network, no
   live database).
2. **Battery-proven live:** `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`
   §7 result tables, rows `cg_workspace_member`: posture zero-policy,
   `relrowsecurity = true`, `relforcerowsecurity = false (INFO)`, permissive
   policies 0, denial forms 401 / 42501 — **PASS** (36/36, canonical
   2026-10-02).
3. **Migration enforcement text (lines 95–101):** `ENABLE ROW LEVEL SECURITY`
   + `REVOKE ALL` from anon/authenticated, with the explicit comment
   "Deny-by-default: RLS on, zero policies (mirrors the foundation + kernel
   substrate security posture; verified by the RLS isolation check)."
4. **The table's own semantics disclaim authority:** `COMMENT ON TABLE
   public.cg_workspace_member` (lines 82–85): "Binding an actor to a workspace
   never grants authorization by itself; permissions are resolved through the
   authorization layer (cg_role_assignment / role gates) at request time."

## DECISION

**ZERO-POLICY-BY-DESIGN — adjudicated, unchanged.** The zero-policy posture is
the deliberate, documented, battery-proven V1 posture of
`cg_workspace_member`. A non-binding future policy direction is recorded
below; nothing is pending for V1 and nothing is applied.

## RATIONALE

1. **A membership row is NOT a permission, so a permissive read policy here
   would be an authorization smuggle.** The table comment states the platform
   law: workspace membership never grants authorization by itself; permissions
   resolve through `cg_role_assignment` / role gates at request time. A
   client-visible SELECT policy ("see the workspaces you are a member of")
   would let the membership binding act as an authorization decision — exactly
   the inversion the schema forbids. The V1 answer is that membership reads
   flow through the same gated authorization layer as everything else, once
   such a surface is authorized at all.
2. **No client surface exists to serve.** No server function reads or writes
   this table (`rg` trace above); the pure domain modules operate on
   contracts, not rows. A policy now would protect a surface with zero
   authorized consumers.
3. **Membership state transitions are sensitive lifecycle acts.** `state`
   spans `invited` / `active` / `suspended` / `removed`, with `invited_by`
   provenance. Suspensions and removals are exactly the records that must not
   be client-writable (a removed member must not be able to reinstate
   themselves); with zero policies AND zero privileges (REVOKE ALL), no client
   role can write at all — a stronger guarantee than any WITH CHECK predicate
   set authorable today without a designed invitation flow.
4. **The zero-policy posture is the strongest form of deny-by-default**
   (RLS_ISOLATION_BATTERY.md §7 dual-posture model): RLS enabled with zero
   policies means no policy expression anywhere can evaluate true — no
   identity can read a single row through the client data plane.
   Battery-proven live, not reasoned.
5. **Conversion readiness is clean but unexercised:** `tenant_id` is `NOT NULL`
   with an `(tenant_id, actor_id, state)` index, and the natural actor column
   (`actor_id`) exists for the `auth.uid()::text` self-derivation pin the
   substrate's policy-construction law allows (the
   `cg_event_route_subscription` exemplar shows the composite form). The
   conversion path is available the day a client-facing membership surface is
   authorized; until then it is unexercised by design.

## CONSTITUTION SECTIONS

- §13 Multi-Tenancy Law — the table is tenant-keyed (`tenant_id NOT NULL`);
  tenant context for any future surface is resolved server-side per §27.
- §15 Identity Principle — authentication ("who are you") and the membership
  binding ("where are you a member") must never be confused with
  authorization ("what can you do"), which resolves through the role gates.
- §16 Authorization Model — layered authorization; the membership row is at
  most a context input, never the decision.
- §17 Database Security — RLS mandatory and enabled; zero policies is the
  strongest deny-by-default expression.
- §26 API Governance / §27 Server Function Rule — never trust client-supplied
  identity/tenant; the intended writer class is gated server functions.
- §28 Database Law — RLS + revocable grants over application logic; the
  `UNIQUE (workspace_id, actor_id)` constraint and FK cascade carry integrity.
- §34 Frontend Security — the UI is not security; deny at the data plane.

## PROPOSED-POLICY-IF-ANY

**PROPOSED (non-binding, nothing applied, not required for V1):** if and when a
client-facing workspace-membership surface is authorized, author a follow-up
migration in the 20261002000013 (J-005/J-006 neutral membership policies)
exemplar form: FORCE RLS; `SELECT` policy
`tenant_id = public.get_my_tenant_id()`; `INSERT` policy
`public.is_tenant_admin(tenant_id) AND invited_by = auth.uid()::text` (the
inviter is the acting identity — the self-derivation pin class the
policy-construction law allows); no `UPDATE` policy (suspension/removal are
server-mediated lifecycle acts through gated server functions); zero
`anon`/`PUBLIC` grants; declare the entry in a posture JSON with
`tenantColumn: "tenant_id"` and a §4.4 probe recipe (probeSeedRows +
probeInsertPayload) so the battery's genuine cross-tenant probe stage covers
it. Until that authorization exists, this table stays zero-policy —
deny-by-default is the correct V1 answer, not a debt marker.
