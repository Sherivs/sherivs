# ADR-102: The Canonical Organization Root

| Field                      | Value                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (the founder chose option A on 2026-11-17; the migration is not applied)                                                               |
| Date                       | 2026-11-17                                                                                                                                      |
| Author                     | Claude Code agent (mission M1 implementation)                                                                                                   |
| Creator                    | Claude Code agent, mission E-004 (M1 foundation convergence)                                                                                    |
| Mission                    | M1 (foundation convergence)                                                                                                                     |
| Capabilities               | Name one organization root; keep the other two records 1:1 with it; one unit tree; an institution profile                                       |
| Cites                      | [ADR-077](./ADR-077_ENGINE_PERSON_PASSPORT_AND_MEMBERSHIP_CONTEXTS.md); [ADR-101](./ADR-101_SEC_M0_ANONYMOUS_SURFACE_AND_PRIVATE_BY_DEFAULT.md) |
| Minimal ownership artifact | `database/supabase/migrations/20261117000200_sherivs_m1_organization_root.sql`                                                                  |

## Context

Three tables each describe "an organization": `public.schools` (the Scholar root, keyed by `school_id`, behind `get_my_school_id()`), `cg_tenant` (the kernel, `tenant_ref`) and `platform_organization` (the internal console). On master 5902f231 the migrations hold 2,389 `school_id` references and 378 calls to `get_my_school_id()`; app code holds 933 `tenant_ref` references. Production has no organization in any of the three, so choosing now costs no data migration.

## Options

- **A. `public.schools` is the root; the other two map to it 1:1.** Every existing policy and helper stays as written.
- **B. `platform_organization` is the root.** A neutral name, at the price of repointing every Scholar policy.
- **C. `cg_tenant` is the root.** The same rewrite as B, and Scholar tables do not key on it.

## Decision

**Option A**, chosen by the founder on 2026-11-17.

1. **Root:** `public.schools`. Its name stays in the database. The product and new code say "organization".
2. **Neutral name:** `public.get_my_organization_id()` returns exactly what `public.get_my_school_id()` returns. New code uses the neutral name; nothing existing is renamed.
3. **Mapping, already enforced by constraints found in production:** `school_tenant_map` (primary key on the organization, unique kernel record) and `platform_organization.school_id` (unique). Each organization therefore has at most one kernel record and one console record, and each of those serves one organization.
4. **Completeness:** `public.organization_root_gaps()` (service role only) lists any organization missing its kernel record, console record or current profile. Provisioning (mission M6) must leave it empty for the organization it creates, in the same transaction.
5. **One unit tree:** `workspace_org_units`, with more unit types (section, school or college, programme, level, class arm, house, hostel, clinical site, farm unit, directorate, agency, zone, LGA, LGEA). Its existing composite foreign key already makes a parent in another organization impossible; a check now forbids a unit being its own parent.
6. **Institution profile:** `institution_profile`, effective-dated, one current row per organization, readable by members, written by the service role only, audited.
7. **Role logic owner:** the database functions (`effective_permissions`, `has_permission`, `scholar_can`) with `frontend/src/lib/scholar/roles/` are canonical. The other role modules carry a notice and take no new logic; mission M2 folds them in.

## RLS helpers and compatibility

| Helper                                                                                             | Change                                                                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `get_my_school_id()`                                                                               | None here. (Its search path is tightened separately in `20261117000100`.) |
| `get_my_role()`, `is_school_admin()`, `is_super_admin()`, `my_active_role()`, `get_my_tenant_id()` | None.                                                                     |
| `get_my_organization_id()`                                                                         | New; an alias.                                                            |

No policy is created, altered or dropped on any existing table.

## Consequences

- The security boundary is untouched, which is the reason for the choice.
- The database keeps a school-shaped name for the root. That is a naming cost, not a behaviour cost.
- Kernel code that only knows `tenant_ref` must resolve it through `school_tenant_map`; a missing row is a provisioning defect that `organization_root_gaps()` makes visible.
- Cycles longer than one step in the unit tree are not prevented by a constraint; unit writes go through server functions that must check ancestry (mission M2).
- Quarantining unreferenced modules is a separate change under this mission: a first import scan found importers for six of the ten modules named in the brief, so each is traced before anything moves.
- Nothing is applied by this ADR.
