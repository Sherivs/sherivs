# ADR-001: Canonical Tenant Identifier Type (text vs uuid) — COND-003 Ruling Dossier

- **Status:** PROPOSED (operator ruling pending — MISSION-R-02 human approval gate)
- **Date:** 2026-10-01
- **Mission:** MISSION-R-02 (tenant_id type divergence ruling dossier, wave 1)
- **Closes:** COND-003 (recorded condition deferred at migration `20261001000000_coregrid_v1_org_model.sql` lines 32–37)
- **Unblocks:** MISSION-R-20 (neutral tenant-membership DB primitives, J-005)
- **Authority:** Scope-lock freezeRule step 6 (migration impact assessment); Constitution Part 17 (database security / RLS), Part 24 (architecture rule — kernel must not depend on L2 vendor schema), Part 46 (domain neutrality), Part 39 (no destructive refactoring of applied migrations)
- **Author:** Data Model Strategist (Architecture team)

---

## 1. Decision (summary)

**Recommendation: `text` is the canonical tenant identifier type across the `cg_*` substrate.** The uuid PK of `cg_tenant(id)` remains the internal implementation detail of the L2 tenant entity. Referential integrity between the opaque `text` refs and the uuid tenant rows is restored **additively** via a narrow bridge table (`cg_tenant_ref`), never by rewriting applied or live-verified migrations. The full rationale and transition plan are in §5–§7.

This recommendation is a dossier conclusion; per the mission's `humanApprovalsRequired`, the ruling itself is an operator act recorded when it lands.

---

## 2. Context: the divergence

The substrate carries two tenant identifier styles:

| Style | Canonical site | Example |
|---|---|---|
| `uuid` | `cg_tenant.id` (L2 tenant entity) | `20260904020000_coregrid_l2_identity_tenancy.sql:46` |
| `text` (opaque ref, `CHECK length 1..128`) | every consumer of tenant scope in the `cg_*` substrate | `20261001000000…:58`, `20260930000000…:30` |

Migration `20261001000000_coregrid_v1_org_model.sql:32–37` records the deferral verbatim: tenant columns copy the workspace-persistence exemplar and the substrate-wide convention (`cg_identity.tenant_id`, `cg_org_profile.tenant_ref`) — all `text` — while `cg_tenant.id` is `uuid`, "so a hard FK to cg_tenant(id) is not type-compatible without a substrate-wide migration; that decision is deferred to the operator." COND-003 is that deferral.

The divergence also has a **legacy third style**: the Scholar runtime uses `school_id uuid REFERENCES public.schools(id)` as its de-facto tenant key, with the uuid→text seam already exercised in production SQL (`20260626133249_…sql:19` casts `get_my_school_id()::text` for storage paths; `20260907000800…:112` casts `p_tenant::text` to compare against `tenant_ref`).

---

## 3. Inventory — every site carrying a tenant identifier

### 3.1 `cg_*` substrate (all AUTHORED, NOT APPLIED to the canonical database)

Per STREAM_H_IMPLEMENTATION_MAP.json (`durableState` entries at lines 53, 87, 153, 170, 199; reconciliation note at line 667): every `cg_*` durable-state migration is authored-not-applied in the repo posture; some were live-verified once on a **disposable** Supabase dev project. The canonical/production database has none of the `cg_*` tables. No applied migration is touched by either ruling.

| # | Table.column | Type | Migration : line | Applied to canonical DB? |
|---|---|---|---|---|
| 1 | `cg_entity.tenant_id` | `text` (nullable) | `20260903000000_coregrid_universal_kernel_substrate.sql:35` | No (authored) |
| 2 | `cg_relationship.tenant_id` | `text` (nullable) | `20260903000000…:81` | No (authored) |
| 3 | `cg_event.tenant_id` | `text` (nullable) | `20260903000000…:119` | No (authored) |
| 4 | `cg_observation.tenant_id` | `text` (nullable) | `20260903000000…:157` | No (authored) |
| 5 | `cg_domain_runtime` | (no tenant column — control-plane runtime registry) | `20260903000000…:188–191` | No (authored) |
| 6 | `cg_identity.tenant_id` | `text` (nullable) | `20260904020000_coregrid_l2_identity_tenancy.sql:25` | No (authored; header says "dev validated", H-map records AUTHORED, NOT APPLIED) |
| 7 | `cg_tenant.id` | **`uuid` PK** (the divergent anchor) | `20260904020000…:46` | No (authored) |
| 8 | `cg_tenant.parent_tenant_id` | `uuid` self-FK | `20260904020000…:52` | No (authored) |
| 9 | `cg_tenant.slug` | `text UNIQUE` (already a stable text handle for a tenant) | `20260904020000…:49` | No (authored) |
| 10 | `cg_workforce_position.tenant_ref` | `text NOT NULL CHECK 1..128` | `20260907000000_coregrid_workforce_kind_substrate.sql:100` | No (authored) |
| 11 | `cg_org_profile.tenant_ref` | `text NOT NULL CHECK 1..128` | `20260907000700_coregrid_org_profile_substrate.sql:17` | No (authored) |
| 12 | `cg_role_assignment.tenant_ref` | `text NOT NULL` | `20260907000800_coregrid_role_assignment_substrate.sql:30` | No (authored) |
| 13 | `cg_role_grant.tenant_ref` | `text NOT NULL` | `20260907000800…:66` | No (authored) |
| 14 | RPC params `p_tenant uuid` casting `::text` at the seam | uuid→text casts in `list_role_assignments`, `assign_role`, `revoke_…`, `list_role_grants`, `grant_role_capability`, … | `20260907000800…:100–260` (e.g. `:112`, `:138`, `:151`, `:174`, `:202`, `:236`) | No (authored) |
| 15 | `cg_workforce_position` RPC gates (`tenant_ref` vs `get_my_school_id() ::uuid`) | text→uuid casts | `20260907000300_coregrid_workforce_position_rpc.sql:96,123,130` | No (authored) |
| 16 | `cg_mission_intent.tenant_id` | `text NOT NULL CHECK 1..128` | `20260929000000_coregrid_foundation_mission_001.sql:26` | No (authored; live-verified once on disposable dev project) |
| 17 | `cg_execution_record.tenant_id` | `text NOT NULL` (+ composite FK to intent `(tenant_id, mission_id, mission_version)` at `:70–71`) | `20260929000000…:57` | No (authored) |
| 18 | `cg_foundation_evidence.tenant_id` | `text NOT NULL CHECK 1..128` | `20260929000000…:122` | No (authored) |
| 19 | `cg_workspace.tenant_id` | `text NOT NULL CHECK 1..128` | `20260930000000_coregrid_v1_workspace_persistence.sql:30` | No (authored) |
| 20 | `cg_workspace_member.tenant_id` | `text NOT NULL CHECK 1..128` | `20260930000000…:70` | No (authored) |
| 21 | `cg_org_unit.tenant_id` | `text NOT NULL CHECK 1..128` (+ same-tenant composite FK at `:69–72`) | `20261001000000_coregrid_v1_org_model.sql:58` | No (authored) |
| 22 | `cg_org_membership.tenant_id` | `text NOT NULL CHECK 1..128` | `20261001000000…:95` | No (authored) |

Note: `cg_verification_result`, `cg_conformance_assessment`, `cg_execution_history` carry no tenant column of their own; their tenant scope is inherited through FKs from `cg_execution_record`/`cg_foundation_evidence` (`20260929000000…:69–71`).

### 3.2 Legacy Scholar runtime (uuid tenant key; **applied** to the live dev/production schema)

All are `school_id uuid NOT NULL REFERENCES public.schools(id)`. These are Scholar-slice state (STREAM I classification LEGACY; I-001 ordering). **Neither ruling rewrites them.**

| Migration | Tables with `school_id uuid` |
|---|---|
| `20260620122048_…sql` | `schools` (the uuid anchor, `:55–62`), `users` (`:77`), `classes` (`:143`), `students` (`:156`), `parent_student_map` (`:186`), `grades` (`:198`), `attendance` (`:218`), plus `attendance_logs`, `lesson_plans`, `timetables`, `timetable_slots`, `school_calendar`, `news`, `events`, `teacher_performance_profiles`, `fees`, `fraud_attempts`, `qr_tokens`, `notifications`, `testimonials`, `faqs`, `academic_programs`, `school_facilities`, `why_us_items` |
| `20260622044140_…sql` | RLS policies on `messages`, `notifications` keyed on `school_id = get_my_school_id()` (`:2–17`) |
| `20260626111823_…sql` | `school_api_keys.school_id` (`:31`), `news_reads.school_id` (`:76`) |
| `20260705002543_…sql` | `school_staff.school_id` (`:4`), `school_gallery.school_id` (`:35`) |
| `20260725063636_…sql` | `hostel_rooms`, `hostel_allocations`, `hostel_attendance`, `clinic_visits`, `library_books`, `library_borrowings`, `discipline_records` (`:5`–`:143`) |
| `20260726085612_…sql` | `student_platform_fee_ledger.school_id` (`:3`) |
| `20260729052237_…sql` | `teacher_biometrics.school_id` (`:3`), `attendance_verification_log.school_id` (`:25`), `school_geofence.school_id` (`:51`) |
| `20260729054314_…sql` | `ai_conversations`, `ai_interaction_log`, `study_sessions` (`:3`–`:52`) |
| `20260904010000_…sql` | Transport RLS policies keyed on `school_id` (`:19–44`) |

Scholar helper primitives reading the uuid key: `get_my_school_id()`, `get_my_role()`, `is_school_admin()` (`20260620122048_…sql:117–119`, `20260620151525_…sql:2ff`). These are the helpers STREAM I-002/I-003 require be replaced by neutral ones — which is exactly where the type decision lands (§6).

### 3.3 Code impact surface (frontend universal lib)

- `frontend/src/lib/tenant-core.ts:93` — `export type TenantId = string & { readonly __brand: "TenantId" }`: the universal tenant identifier is already an **opaque branded string**. Entire API surface (`tenantId(raw)`, `TenantResource`, `hasTenantBoundary` at `:332`) is type-only; no format assumption.
- `frontend/src/lib/org-model.ts:97,108,121,174,215,247` — org tree, roles-by-tenant maps and membership state all keyed on `TenantId`.
- `frontend/src/lib/workspace-core.ts:16,113,258,284,310` — workspace entities, code-uniqueness checks and the deterministic id derivation `` `${input.tenantId}:${code}` `` are all `TenantId`-keyed.

Because uuids are strings, **neither ruling forces a rewrite of these modules** — but under uuid-as-canonical there would be strong temptation to narrow `TenantId` to a uuid-branded type, which would retro-fit a format constraint into every universal primitive and break the kernel's opaque-identifier posture (Part 24 layering).

---

## 4. Both rulings, costed honestly

### 4.1 Ruling A — `text` as canonical (recommended)

**What stays as authored:** all 22 substrate sites in §3.1 unchanged. Zero churn to the kernel, L2, workforce, role-assignment, foundation, workspace, and org-model migrations.

**Honest costs / risks:**
1. **No declarative FK to `cg_tenant(id)`.** A `text` column cannot hard-FK a uuid PK. Without mitigation, a typo'd or unregistered `tenant_ref` is storable — referential integrity is then app-enforced, which Constitution Part 28 forbids relying on *alone*. Mitigation is mandatory and is part of this ADR (the `cg_tenant_ref` bridge, §7); without it this ruling is incomplete.
2. **Type asymmetry is permanent vocabulary.** The substrate speaks `tenant_ref: text`; `cg_tenant` speaks `id: uuid`. Every reader must learn the bridge once. The existing `::text` / `::uuid` casts (`20260907000800…:112,151`, `20260907000300…:130`) codify the seam but are exactly the smell MISSION-R-20's neutral helpers are meant to replace; under this ruling the helpers compare text-to-text and the casts disappear at the RPC gate, not inside them.
3. **CHECK-only length validation (1..128) permits unregistered refs** until the bridge + helpers land. The transition plan sequences this so no *applied* posture is ever weaker than today's deny-by-default (§7).
4. The deferral comment block at `20261001000000…:32–37` must be superseded by a follow-up (or, since the file is authored-not-applied, edited in place) so the recorded condition doesn't outlive the ruling.

**What it buys:**
- No applied migration is touched; no authored migration's SQL semantics change (only the deferral comment is retired). Zero rewrite risk, zero dual-write at the substrate level.
- Kernel stays decoupled from L2 identity schema (Part 24: kernel identifiers remain opaque scope keys).
- Matches the shipped code contract (`TenantId` branded string) with no code change.
- The uuid→text seam already exists in applied SQL (`20260626133249_…sql:19`), proving text interoperability with the legacy uuid world is the *established* direction, not a new one.

### 4.2 Ruling B — `uuid` as canonical

**What it would take:**
1. **Rewrite ~7 authored migrations** to alter 14+ text columns to `uuid` (rows 1–4, 10–13, 16–22 in §3.1), plus their indexes, CHECK constraints, and both composite same-tenant FKs (`20261001000000…:69–72`, `20260929000000…:70–71`, which reference the text-typed columns being altered). Because none are applied canonically, this is *possible* without violating the forward-only rule — but it silently invalidates the disposable-dev live-verification evidence recorded in STREAM H (line 199, 667): every verified surface changes, so kernel-purity and tenant-isolation suites must re-run against a new schema. The "verified" label is lost, not carried.
2. **FK becomes feasible** — genuinely the strongest argument for B: every tenant-scoped row could hard-FK `cg_tenant(id)`, giving Part 28-grade integrity declaratively.
3. **RPC signature churn:** every `p_tenant uuid` signature (`20260907000800…:100–260`) survives unchanged under B — but the *nullable* kernel columns (`cg_entity/cg_event/cg_observation/cg_relationship.tenant_id`) must either become uuid-nullable FKs or acquire `NULL`-tolerant semantics; the kernel currently treats tenant as an optional opaque scope tag, and B couples that optionality to L2 row existence.
4. **Legacy mapping still needs a bridge anyway.** The applied Scholar schema keys on `schools.id uuid`, which is *not* `cg_tenant.id` (different table, different provenance; the L2 header explicitly says Scholar "maps their tenant rows onto cg_tenant at runtime", `20260904020000…:13–14`). So even under B, a `schools.id → cg_tenant.id` mapping surface is required — the bridge table is not avoided, it is merely inverted.
5. **Code impact:** `TenantId` would remain a string at the type level (no forced rewrite), but the universal lib would be under permanent pressure to uuid-validate, and the neutral helpers of MISSION-R-20 would have to resolve `get_my_tenant_id()` through a join from `cg_identity.tenant_id (text)` → uuid, i.e. **the text world does not disappear under B; it just moves into the hot path of the identity split (I-001)** — `cg_identity.tenant_id` is text and universal identity is being *promoted*, not demoted, by I-001's correction.

**Honest verdict:** B's FK benefit is real but is achievable under A via the bridge (§7) at near-zero churn; B's costs (lost verification evidence, kernel–L2 coupling, identity-split friction) are immediate and structural.

---

## 5. Recommendation

**Adopt `text` (opaque `tenant_ref`, `CHECK length 1..128`) as the canonical tenant identifier for the `cg_*` substrate.** `cg_tenant.id uuid` remains the L2 tenant entity's surrogate key; `cg_tenant.slug` (text, unique) and/or the bridge below provide the binding. Canonical truth about *which tenants exist* remains `cg_tenant` (Reality, Part 9); the `text` ref is an addressing scheme, not a second registry.

## 6. Interaction with the I-001 identity split

I-001 (users.school_id fusion) orders: promote `cg_identity` to canonical universal identity; demote `public.users` to a Scholar runtime slice. Under text-as-canonical:

- `cg_identity.tenant_id text` (`20260904020000…:25`) is already the canonical universal tenant scope field — no change.
- `public.users.school_id uuid` stays Scholar-slice, mapped to a `tenant_ref` **at the Scholar adapter boundary only** (the same `::text` seam the runtime already uses at `20260626133249_…:19`). Universal code never reads `school_id` again after I-011's rename (`schoolId → tenantRef`).
- MISSION-R-20's neutral helpers (`get_my_tenant_id()`, `holds_tenant_role(p_tenant, p_role_ref)`) resolve from `cg_role_assignment.tenant_ref` / `cg_org_membership` — text-to-text comparisons, no casts, replacing the Scholar gates at `20260907000800…:114,132,174` and `20260907000300…:130`.

## 7. Transition plan (forward-only, additive, RLS never weakened)

1. **Step 1 — record the ruling.** Update the deferral comment at `20261001000000…:32–37` (file is authored-not-applied; editing an unapplied file's comments is not a destructive rewrite) to cite this ADR. No SQL semantics change.
2. **Step 2 — additive bridge migration (new, forward-only).** Author (not apply) `cg_tenant_ref`:
   ```sql
   CREATE TABLE IF NOT EXISTS public.cg_tenant_ref (
     tenant_ref  text PRIMARY KEY CHECK (length(tenant_ref) BETWEEN 1 AND 128),
     tenant_id   uuid NOT NULL UNIQUE REFERENCES public.cg_tenant(id) ON DELETE RESTRICT,
     created_at  timestamptz NOT NULL DEFAULT now()
   );
   ALTER TABLE public.cg_tenant_ref ENABLE ROW LEVEL SECURITY;   -- zero policies: deny-by-default
   REVOKE ALL ON public.cg_tenant_ref FROM anon, authenticated;  -- service-role writers only
   ```
   This restores Part 28-grade declarative integrity (every registered ref hard-FKs a real tenant; one ref ↔ one tenant, `UNIQUE`) without touching any existing column. A follow-up CHECK/trigger may additionally constrain `cg_*` writes to registered refs — authored as a separate additive step, never retro-fitted into applied files.
3. **Step 3 — MISSION-R-20 consumes the ruling.** Neutral helpers are parameterized for the text outcome (their T1 already requires this): `get_my_tenant_id() returns text`, gates compare `tenant_ref` directly. The uuid casts at `20260907000800…:112,138,151,174,202,236` and `20260907000300…:130` are superseded when the universal RPC gates re-point; the Scholar-slice helpers remain untouched until every Scholar policy is remapped (I-002's preserve-evidence rule).
4. **Step 4 — verification.** Rerun the full verify pipeline plus kernel-purity and tenant-isolation suites. The deny-by-default posture is checked on every touched table: RLS enabled, zero policies, all anon/authenticated privileges revoked — the bridge adds one more table to that invariant, never a policy that grants.

**Invariants held:** no applied migration is rewritten (Part 39); RLS deny-by-default is never weakened — the only new table ships fully denied (Part 17); kernel never learns uuid (Part 24); the canonical-truth boundary (Part 9) is untouched.

## 8. Golden questions

- **WHO?** Architecture team authors; operator rules (COND-003 approval gate); service-role server functions are the only writers to `cg_tenant_ref`; kernel/substrate ownership unchanged.
- **WHAT?** One canonical tenant identifier type for all `cg_*` substrate tables: opaque `text` ref, bound to `cg_tenant.id uuid` via the bridge.
- **WHERE?** `database/supabase/migrations/` (one new additive migration) + the deferral comment in `20261001000000…`; code side mirrors `frontend/src/lib/tenant-core.ts` `TenantId`.
- **WHY?** Close COND-003 so J-005/MISSION-R-20 neutral tenancy primitives can be finalized; eliminate the divergent-cast seam; keep the I-001 identity split on one type.
- **UNDER WHICH POLICY?** Scope-lock freezeRule steps 6+8 (this ADR is the recorded decision); Constitution Parts 9, 17, 24, 28, 39, 46; forward-only additive migration law.

## 9. Open questions

- **UNKNOWN** — L-H-001 hardening token: the hardening artifact is absent from the repo (per the mission graph's provenance note); the hardening obligations here are derived from STREAM J/H refs. Back-fill `hardeningRefs` when the artifact lands.
- **UNKNOWN** — whether a future audit/BI requirement will demand direct FKs from high-value substrate tables (not just the bridge). If so, a *new* additive ADR may alter specific authored-not-yet-applied columns before their first canonical apply; decided then, not now.
- **UNKNOWN** — the exact canonical apply ordering of the authored migrations (J-040 "applied-migration posture + environment state truth" remains an open scope-lock item; this ADR deliberately does not depend on it).
- **UNKNOWN** — final neutral helper signatures/names (MISSION-R-20 T1); this ADR constrains only their *type* (`text`).

---

## Verification evidence

- `npm run verify:registry` — PASS (run once after authoring; see mission report).
- Inventory citations: every row in §3.1/§3.2 carries `file:line` references verified against the working tree at authoring time.
