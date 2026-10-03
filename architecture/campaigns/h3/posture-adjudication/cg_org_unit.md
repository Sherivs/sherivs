# Posture Adjudication — `cg_org_unit` (team H3-033, Squad D / D-033)

Role: Posture Adjudication Engineer (org/worker family). Wave: H3, mission D-033.
Scope of this document: the RLS posture of `public.cg_org_unit` ONLY. Nothing
is applied; the posture JSON files remain untouched (team J-099 merges
rationales later).

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261001000000_coregrid_v1_org_model.sql`
  (MISSION-V1-006, universal organization model; status header: AUTHORED, NOT
  APPLIED). Rollback: `database/supabase/rollbacks/20261001000000_coregrid_v1_org_model.sql`.
- **Domain contract:** `frontend/src/lib/org-model.ts` — pure, domain-neutral
  org-tree vocabulary (`orgUnitRef`, `ORG_UNIT_KINDS`, org-unit lifecycle
  states) that the migration's CHECK constraints mirror line-for-line.
- **Server paths (traced via rg):** no client-facing server function reads or
  writes `cg_org_unit` today. `rg '\.from\("cg_org_unit'` over
  `frontend/src/` returns zero matches; the universal org profile surface
  (`frontend/src/lib/runtime/scholar/org-profile.functions.ts`) uses the
  `cg_org_profile` RPCs, not the org-unit tree. The only non-migration
  consumers are the security tooling, all service-role/server-side:
  `scripts/verify-rls-isolation-battery.mjs` (seed/cleanup SQL for the
  policy-backed `cg_org_membership` cross-tenant probes, lines ~1001–1064,
  executed through the management API channel) and
  `scripts/verify-neutral-tenant-primitives.mjs` (catalog checks only). In
  V1 the intended writer class is service-role server functions, per the
  migration's own security note (lines 44–53).
- **Sibling in the same migration:** `cg_org_membership` is the tenant-binding
  surface and IS policy-backed (battery registry: forceRls + three neutral
  membership policies). The org-unit TREE itself has no client policy.

## EVIDENCE

1. **Battery scope (read-only confirmation):**
   `scripts/verify-rls-isolation-battery.mjs`, `BUILTIN_TABLE_POSTURES`
   line 200: `{ name: "cg_org_unit", source: "20261001000000_coregrid_v1_org_model.sql", posture: "zero-policy" }`.
   No `rls-table-postures-*.json` file overrides or extends this entry
   (`scripts/verification/rls-table-postures-substrate.json` and
   `...-transport.json` contain no `cg_org_unit` entry), so the built-in
   canonical zero-policy posture is operative.
2. **Battery-proven live:** `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`
   §7 result table, row `cg_org_unit`: posture zero-policy,
   `relrowsecurity = true`, `relforcerowsecurity = false (INFO)`, permissive
   policies 0, denial forms 401 / 42501 — **PASS** (36/36, canonical
   2026-10-02).
3. **Migration enforcement text (lines 130–136):**
   `ALTER TABLE public.cg_org_unit ENABLE ROW LEVEL SECURITY;` and
   `REVOKE ALL ON public.cg_org_unit FROM anon, authenticated;` — plus zero
   `CREATE POLICY` and zero client `GRANT` statements anywhere in the file.
   Same-tenant tree integrity is enforced by the composite FK
   `cg_org_unit_parent_same_tenant_fk` ((parent_org_unit_id, tenant_id) →
   (id, tenant_id)), i.e. database-enforced, not application-enforced.
4. **Migration's own posture rationale (lines 47–53):** tenant-scoped
   policies for authenticated members were deliberately NOT authored because
   the only existing membership helpers at authoring time
   (`get_my_school_id` / `is_school_admin`) carry Scholar-domain vocabulary;
   wiring them into the universal organization model would violate the
   domain-neutrality law. Policies may be added by a follow-up migration
   "if and when a domain-neutral tenant-membership helper exists" — which is
   now the case (J-005, migration 20261002000013), but no such follow-up has
   been authorized for the org tree.

## DECISION

**ZERO-POLICY-BY-DESIGN — adjudicated, unchanged.** The zero-policy posture is
the deliberate, documented, battery-proven V1 posture of `cg_org_unit`. No
policy direction is recorded as pending for V1 beyond the non-binding
proposal below.

## RATIONALE

1. **No client surface exists to serve.** The only traced readers of
   `cg_org_unit` are security tooling and the battery's own privileged
   seeding; no server function exposes the org tree to clients. Authoring a
   client-facing SELECT policy now would create an attack surface no V1
   contract consumes — pure surface expansion with zero authorized consumer.
2. **Client access to org structure legitimately flows through
   `cg_org_membership`,** which is policy-backed and battery-proven by genuine
   cross-tenant probes. A tenant member reaches the org units that matter to
   them through their membership binding; the full tenant org tree is a
   governance artifact resolved server-side.
3. **The zero-policy posture is the strongest form of deny-by-default** under
   the battery's dual-posture model (RLS_ISOLATION_BATTERY.md §7): with RLS
   enabled and zero policies, no policy expression anywhere can evaluate
   true — no identity can read via the client data plane. This is strictly
   stronger than any tenant-scoped policy we could author today.
4. **Domain neutrality was the original blocking reason** (migration lines
   47–53) and remains a real constraint: the policy layer may only use the
   neutral predicates (`public.get_my_tenant_id()`, `public.is_tenant_admin`,
   `public.holds_tenant_role` per the substrate convention), never the legacy
   domain helpers. That constraint is now satisfiable (J-005), but until a
   client-facing org-tree read surface is authorized, satisfying it buys
   nothing.
5. **Why no client-facing policy is legitimate in V1:** §27/§34 of the
   Constitution make server functions the enforcement plane; V1 org
   administration is designed to run through service-role server functions
   (§26/§27 posture: authenticate, resolve tenant, authorize, validate,
   execute, audit). RLS here is the second layer that guarantees even a
   buggy or future client path denies by default — exactly the §17
   "application code is never the only security layer" invariant.

## CONSTITUTION SECTIONS

- §13 Multi-Tenancy Law — every request must have tenant context; the tree is
  tenant-keyed (`tenant_id` NOT NULL) and the composite FK makes cross-tenant
  parents impossible at the database level.
- §16 Authorization Model — layered authorization; the decision inputs for
  org-tree reads are not yet defined for any client path, so the data plane
  denies.
- §17 Database Security — RLS mandatory; ENABLED with zero policies is the
  strongest deny-by-default expression; application/service-role code is
  never the sole layer.
- §26 API Governance / §27 Server Function Rule — never trust client
  tenant/role; org-tree mutations belong to gated server functions.
- §28 Database Law — constraints, FKs, RLS over application logic.
- §33 Design System / domain neutrality (the migration cites V5.3 Part 46) —
  the original reason the first policy layer was not authored.
- §34 Frontend Security — the UI is not security; deny-at-the-data-plane.

## PROPOSED-POLICY-IF-ANY

**PROPOSED (non-binding, nothing applied, not required for V1):** if and when
a client-facing org-tree read surface is authorized, author a follow-up
migration in the exact 20261002000013 (J-005/J-006 neutral membership
policies) exemplar form: FORCE RLS; `SELECT` policy
`tenant_id = public.get_my_tenant_id()`; `INSERT`/`UPDATE` policies gated by
`public.is_tenant_admin(tenant_id)`; zero `anon`/`PUBLIC` grants; declare the
entry in a posture JSON so the battery's genuine cross-tenant probe stage
covers it (probeSeedRows + probeInsertPayload per §4.4). Until that
authorization exists, this table stays zero-policy — deny-by-default is the
correct V1 answer, not a debt marker.