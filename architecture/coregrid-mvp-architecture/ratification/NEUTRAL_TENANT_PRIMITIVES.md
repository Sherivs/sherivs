# NEUTRAL_TENANT_PRIMITIVES — MISSION-R-20 ratification artifact

- Mission: MISSION-R-20 (wave 1, Identity team, V1CAP-013; closes blocking gap J-005)
- Status: **AUTHORED, NOT APPLIED** — live proof is gated on apply authorization (governance law)
- Date: 2026-10-01
- Authority: STREAM_I findings I-002 / I-003 / I-004 / I-005 / I-007; `neutralRoleModelRequirement`; AGENTS.md Constitution 16, 17, 26, 31, 46-equivalent (Part 46 no-domain-contamination)
- Depends on: COND-003 ruling (MISSION-R-02, tenant_id text vs uuid) is **UNRESOLVED** — this work is parameterized for both outcomes (see §4)

---

## 1. Problem (the exact defect being closed)

Every universal `cg_` substrate RPC is gated on helpers resolved from the
Scholar runtime slice table `public.users`:

- `get_my_school_id()` — `SELECT school_id FROM public.users WHERE id = auth.uid()` (20260620122110_178748dc-376f-4c78-911d-ec879dfffce1.sql:7, re-defined 20260620151525:2, 20260620122048:117)
- `is_school_admin()` — `role IN ('admin','principal')` on `public.users` (20260620122110:17)

A restaurant (or any non-Scholar) tenant has no `users.school_id` semantics,
therefore it can neither **hold** nor **administer** a role assignment, a
capability grant, a workforce position, or an org profile — despite all four
substrates being declared domain-neutral (STREAM_I I-003/I-004/I-005).

## 2. Authored files

| Artifact | Path |
| --- | --- |
| Migration (AUTHORED, NOT APPLIED) | `database/supabase/migrations/20261002000001_coregrid_v1_neutral_tenant_primitives.sql` |
| Rollback (restores Scholar-gated bodies + drops helpers) | `database/supabase/rollbacks/20261002000001_coregrid_v1_neutral_tenant_primitives.sql` |
| Read-only verification script | `scripts/verify-neutral-tenant-primitives.mjs` |
| Baseline transcript (dev project `nwrflbpbhyiqdptmlccm`) | `/opt/cursor/artifacts/verify-neutral-tenant-primitives-baseline.log` |

## 3. Neutral primitives introduced

All three are `STABLE SECURITY DEFINER SET search_path = public`, tenancy
resolved **only** from the neutral substrate (`cg_org_membership` 20261001000000,
`cg_role_assignment` 20260907000800) — zero school vocabulary in function
sources (Constitution Part 46). SECURITY DEFINER is mandatory and documented in
the migration header: both substrate tables are deny-by-default RLS (zero
policies, anon/authenticated revoked), so an INVOKER helper would always
observe nothing; the helpers expose exactly three answers (tenant ref, per-
tenant role predicate, per-tenant admin predicate), return no substrate rows,
and `EXECUTE` is revoked from `PUBLIC`/`anon` and granted only to
`authenticated` + `service_role`. The actor is always re-derived from
`auth.uid()` — never a client parameter.

| Function | Semantics |
| --- | --- |
| `get_my_tenant_id() RETURNS text` | The actor's single tenant ref from active neutral bindings; `NULL` when unbound; raises `AMBIGUOUS_TENANCY` when bound in more than one tenant (fail-closed; multi-tenant actors use the per-tenant predicates). |
| `holds_tenant_role(p_tenant text, p_role_ref text) RETURNS boolean` | Actor holds the neutral role ref in the tenant via an active, time-valid `cg_role_assignment` row (expired/revoked access fails: `started_on <= CURRENT_DATE AND (ended_on IS NULL OR ended_on >= CURRENT_DATE)`) OR an active `cg_org_membership` row. NULL args answer false. |
| `is_tenant_admin(p_tenant text) RETURNS boolean` | `holds_tenant_role(p_tenant, 'role:administrator')` — the neutral ADMINISTRATOR binding (lowercase form to satisfy the `cg_role_assignment.role_id` CHECK; vocabulary ownership stays with MISSION-R-21). The per-tenant argument makes "own tenant" inherent, replacing the Scholar pair `is_school_admin() AND get_my_school_id() = tenant`. |

## 4. COND-003 parameterization (text vs uuid — both outcomes supported)

All helper signatures take/return `text`, and every re-pointed gate compares
tenant refs through explicit `::text` casts (`public.is_tenant_admin(p_tenant::text)`).
Today the applied reality is text (`cg_org_membership.tenant_id`,
`cg_role_assignment.tenant_ref`, `cg_identity.tenant_id` are `text`; `cg_tenant.id`
is `uuid`). If COND-003 rules uuid, a follow-up migration converts the
substrate columns and these helpers keep working unchanged because
`uuid::text` renders in canonical lowercase form, so `p_tenant::text = tenant_ref`
remains type-correct under both outcomes. No signature churn under either
outcome; the type choice stays with the operator ruling (MISSION-R-02).

## 5. Universal RPC gate inventory — every re-point, with file:line evidence

Enumeration method: `grep -rn "get_my_school_id\|is_school_admin" database/supabase/migrations/*.sql`.
All `cg_` substrate RPC/function gates found are listed below. RLS policy
usages of the Scholar helpers on Scholar slice tables (schools, buses, fees,
storage buckets, ...) are NOT touched — those are legitimately Scholar-owned
(I-009; remap happens with the users-table split ADR).

| # | Function (signature) | Source migration (gate evidence) | Original Scholar gate | Re-pointed gate (new migration §2) |
| --- | --- | --- | --- | --- |
| 1 | `list_workforce_positions(uuid)` | 20260907000300_coregrid_workforce_position_rpc.sql:24–49 (gate 46–47) | `is_school_admin() AND get_my_school_id() = p_tenant` | `public.is_tenant_admin(p_tenant::text)` |
| 2 | `assign_workforce_position(uuid, uuid, text, text, boolean, text, date)` | 20260907000300:56–107 (gate 70) | same | same (error text neutralized: `'Forbidden: tenant administrator role required'`) |
| 3 | `end_workforce_position(uuid, date)` | 20260907000300:114–143, superseded by 20260907000500_coregrid_end_position_promotion.sql:16–67 (gate 35) | `is_school_admin() AND get_my_school_id() <> v_tenant::uuid` (inverted) | `public.is_tenant_admin(v_tenant)` — 20260907000500 primary-promotion body preserved verbatim |
| 4 | `get_org_profile(uuid, text, text)` | 20260907000700_coregrid_org_profile_substrate.sql:43–57 (gate 53–54) | same as #1 | `public.is_tenant_admin(p_tenant::text)` |
| 5 | `upsert_org_profile(uuid, text, text, jsonb)` | 20260907000700:59–84 (gate 67) | same as #2 | same as #2 |
| 6 | `list_role_assignments(uuid)` | 20260907000800_coregrid_role_assignment_substrate.sql:100–118 (gate 113–114) | same as #1 | `public.is_tenant_admin(p_tenant::text)` |
| 7 | `assign_role(uuid, uuid, text, date, date)` | 20260907000800:120–158 (gate 132) | same as #2 (message `'Not authorized to assign roles for this tenant'` kept) | `public.is_tenant_admin(p_tenant::text)` |
| 8 | `end_role_assignment(uuid)` | 20260907000800:160–186 (gate 174) | `... get_my_school_id()::text <> v_tenant` (inverted) | `public.is_tenant_admin(v_tenant)` |
| 9 | `list_role_grants(uuid)` | 20260907000800:188–206 (gate 201–202) | same as #1 | `public.is_tenant_admin(p_tenant::text)` |
| 10 | `grant_role_capability(uuid, text, text)` | 20260907000800:209–243 (gate 219) | same as #2 | `public.is_tenant_admin(p_tenant::text)` |
| 11 | `revoke_role_capability(uuid)` | 20260907000800:245–271 (gate 259) | `... get_my_school_id()::text <> v_tenant` (inverted) | `public.is_tenant_admin(v_tenant)` |

Scope discipline: redefinition-only — no table changes, no policy changes, no
signature changes, all other body logic byte-equivalent to the authoritative
source migrations. `get_my_primary_workforce_position()` (20260907000400) is
self-scoped inside the function (`identity_ref = auth.uid()`) and carries no
Scholar gate — out of scope. Super-admin bypass stays in RLS only (parity with
the original RPC gates).

## 6. Non-Scholar tenancy — proof plan and current proof level

**Statement:** a non-Scholar tenant can hold and administer a role assignment.

- **Proven now, at unit/catalog level (no apply needed):**
  - `scripts/verify-neutral-tenant-primitives.mjs` check (c): the helper
    sources resolve tenancy only from `cg_role_assignment`/`cg_org_membership`
    with the actor re-derived from `auth.uid()` and no domain vocabulary; the
    admin predicate binds `'role:administrator'`, not a domain role name; and
    `information_schema` proves `cg_role_assignment` / `cg_org_membership` /
    `cg_org_unit` carry **no foreign key into any domain table** — any tenant
    ref (including a non-Scholar one) is admissible. Baseline run on dev
    already proves the substrate half: tenant-ref columns are `text` and no
    domain FKs exist (see transcript).
  - Model-level unit tests: frontend call sites of the Scholar-gated RPCs are
    inventoried in §7 and remain untouched this mission; their re-point lands
    post-apply with the apply authorization. The capability/role model side is
    MISSION-R-21's contract (directional domain→neutral mapping), which depends
    on this mission.
- **Post-apply proof plan (gated on apply authorization):**
  1. `node scripts/verify-neutral-tenant-primitives.mjs` → `STATUS=PASS`
     (helpers exist; every re-pointed body references `is_tenant_admin` and no
     Scholar helper; substrate dry-checks hold).
  2. RPC-level battery (supabase-admin client): seed two tenants — one Scholar
     (`users.school_id`-resolved), one non-Scholar ref; give each actor an
     active `role:administrator` assignment in its own tenant; prove for each
     tenant: `assign_role` creates, `list_role_assignments` reads,
     `end_role_assignment` ends, `grant_role_capability` grants,
     `revoke_role_capability` revokes; cross-tenant attempts raise; a
     time-expired admin binding (`ended_on < CURRENT_DATE`) is denied;
     an actor with no neutral binding is denied. Tenant A cannot administer
     Tenant B (Constitution 31 invariants).
  3. Wire the battery as the permanent post-apply step for this migration
     (same discipline as `verify-role-assignment-substrate.mjs`).

## 7. TypeScript call-site inventory (recorded only — NOT edited this mission)

Frontend re-pointing of these call sites is a post-apply mission; nothing in
`frontend/src` was modified. Evidence: `grep -rn "get_my_school_id\|is_school_admin" frontend/src`
and RPC-name grep.

| Call site (file:line) | RPC / helper consumed | Scholar-coupling |
| --- | --- | --- |
| `frontend/src/lib/scholar-role-assignments.functions.ts:139` | `assign_role` | `p_tenant` from `requireSchoolAdminScope` |
| `frontend/src/lib/scholar-role-assignments.functions.ts:156` | `end_role_assignment` | scope via `requireSchoolAdminScope` |
| `frontend/src/lib/scholar-role-assignments.functions.ts:169` | `list_role_assignments` | `p_tenant` from `requireSchoolAdminScope` |
| `frontend/src/lib/scholar-role-assignments.functions.ts:182` | `list_role_grants` | `p_tenant` from `requireSchoolAdminScope` |
| `frontend/src/lib/scholar-role-assignments.functions.ts:199` | `grant_role_capability` | `p_tenant` from `requireSchoolAdminScope` |
| `frontend/src/lib/scholar-role-assignments.functions.ts:214–215` | `revoke_role_capability` | scope via `requireSchoolAdminScope` |
| `frontend/src/lib/scholar-role-assignments.functions.ts:85` | `get_my_school_id` | self-scope resolution |
| `frontend/src/lib/scholar-feature-access.functions.ts:85` | `get_my_school_id` | self-scope resolution |
| `frontend/src/lib/workforce-positions.functions.ts:27` | `list_workforce_positions` | `p_tenant` from `requireSchoolAdminScope` |
| `frontend/src/lib/workforce-positions.functions.ts:68–77` | `assign_workforce_position` | relies on `p_runtime` default `'runtime:scholar'` (see §8 risk 3) |
| `frontend/src/lib/workforce-positions.functions.ts:90–93` | `end_workforce_position` | scope via `requireSchoolAdminScope` |
| `frontend/src/lib/workforce-positions.functions.ts:108–110` | `get_my_primary_workforce_position` | self-scoped RPC — no Scholar gate (no re-point needed) |
| `frontend/src/lib/org-profile.functions.ts:28` | `get_org_profile` | tenant from `requireSchoolAdminScope` |
| `frontend/src/lib/org-profile.functions.ts:44` | `upsert_org_profile` | kernel-admin client + `requireSchoolAdminScope` |
| `frontend/src/lib/security-role-gate.ts:119, :266, :354` | `is_school_admin` / `get_my_school_id` as role/scope map (`STAFF_SCOPE_RPC = "get_my_school_id"`) | the TS-side gate engine itself — re-points with MISSION-R-21 |
| `frontend/src/integrations/supabase/types.ts:4372–4373` | generated DB types for both Scholar helpers | regenerate post-apply |
| `frontend/src/lib/school-settings.functions.ts:5–6`, `driver-portal.functions.ts:8`, `facilities.functions.ts:82`, `teachers.functions.ts:10` | comment-level references to the Scholar helpers | doc-comment cleanup only |

Post-apply call-site re-point contract: `requireSchoolAdminScope` resolves the
tenant via `get_my_tenant_id()` (or a per-tenant `is_tenant_admin(ref)` check
where the tenant is already known) instead of `get_my_school_id`; RPC
signatures and arg names are unchanged, so no payload shape changes.

## 8. Known risks

1. **COND-003 unresolved.** Text is the applied reality; uuid remains
   `cg_tenant.id`. This migration is parameterized for both (§4), but the
   finalization task (MISSION-R-20 T3) re-runs full verify after the ruling.
2. **Migration application order.** The neutral helpers reference
   `cg_org_membership`/`cg_org_unit` (20261001000000) and `cg_role_assignment`
   (20260907000800). Applied chronologically (as supabase migration ordering
   enforces) all three exist first. Out-of-order application would leave the
   helpers failing closed (exception, not false-deny) until the substrate
   lands — acceptable, observable, never permissive.
3. **`assign_workforce_position` `p_runtime` default kept.** I-005 correction
   asks for explicit `p_runtime`; the live frontend call relies on the default
   `'runtime:scholar'`, and frontend call-sites may not be edited this
   mission. Default removal is deferred to the post-apply re-point (recorded
   in the migration header).
4. **AMBIGUOUS_TENANCY behavior change.** Actors with active neutral bindings
   in multiple tenants will get an exception from `get_my_tenant_id()` until
   callers adopt the per-tenant predicates. Fail-closed by design.
5. **`role:administrator` ref constant.** Defined here as the neutral
   ADMINISTRATOR token (lowercase to satisfy the substrate CHECK); MISSION-R-21
   owns the vocabulary contract and must keep this ref stable or migrate it.

## 9. Acceptance status

- Migration + rollback authored, parameterized for both COND-003 outcomes — done (§2, §4).
- Every universal RPC gate enumerated with its re-pointing — done (§5, 11 functions).
- Verification script exists and honestly reports the NOT_APPLIED baseline —
  done; run against dev project `nwrflbpbhyiqdptmlccm` returned
  `STATUS=NOT_APPLIED` exit 0 with the pre-apply contamination recorded
  (workforce/org-profile RPCs confirmed still Scholar-gated; role-assignment
  RPCs absent; neutral helpers absent; substrate tenant-refs text, no domain FKs).
- `node --check` on the script — passes.
- Not run (per coordinator instruction): `npm run verify` — SQL-only changes + docs.
- Not done by design: no git commit, no frontend edits, migration not applied.