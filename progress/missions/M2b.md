# Mission M2 part B: Roles Pack Engine data model and database functions

Authority: SHERIVS MASTER EXECUTION PROMPT v1.0 (16 Nov 2026), §7.1 to §7.3 and §12.1 M2; AGENTS.md §§12, 17, 26.
Origin: Claude Code agent, mission E-007 (M2 part B, Roles Pack Engine data model)
Creator: Claude Code agent
Created: 2026-11-17

Status: IMPLEMENTED and TESTED on branch `mission/M2b-role-pack-engine`; not merged, nothing applied.
Active persona: Postgres and RLS Security Engineer, with the Identity and Access Engineer.

## Objective

Give the Roles Pack Engine its database: institution packs in the existing pack registry, their
catalogue content, tenant installation and upgrade, narrowing-only overrides and four-eyes custom
roles, with the authority checks and separation of duties enforced in Postgres.

## Reconnaissance (2026-11-17)

| Item                       | Finding                                                                                                                                                                                                                          | Evidence                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Latest applied migration   | `20261117000300_sherivs_sec_m0_privilege_consolidation`                                                                                                                                                                          | read-only `SELECT` on production `supabase_migrations.schema_migrations` |
| `cg_role_pack`             | kinds `tenant_role`, `platform_role`; 31 rows; check `cg_role_pack_kind_check`; triggers `cg_role_pack_guard_trg`, `cg_role_pack_after_publish_trg`                                                                              | read-only `SELECT` on production catalog views                           |
| New table names            | none of the five exist in production                                                                                                                                                                                             | read-only `SELECT` on `pg_class`                                         |
| `postgres`, `service_role` | both BYPASSRLS, neither superuser                                                                                                                                                                                                | read-only `SELECT` on `pg_roles`                                         |
| `approval_limit_ngn` NULL  | 48 templates, including cashier and accountant                                                                                                                                                                                   | read-only `SELECT` on `role_templates`                                   |
| Reused                     | `cg_role_pack` and its guard (ENGINE-01); `role_templates`, `role_template_permissions`, `permission_catalog`, `sod_permission_rules` (017); `can_administer_org` (016); `scholar_audit` (018); `get_my_school_id`; `audit_logs` | migration files                                                          |

Only read-only `SELECT` statements were sent to production, to confirm column and constraint shapes.

## Scope and file boundaries

- `database/supabase/migrations/20261117001100_sherivs_m2_role_pack_engine.sql` and its rollback
- `tests/sql/m2-role-pack-engine.sql`, `tests/unit/m2-role-pack-engine-migration.test.ts`
- `architecture/adr/ADR-114_M2_ROLE_PACK_ENGINE_DATA_MODEL.md`, one row in `architecture/adr/INDEX.md`
- neutrality baseline entries added by the quarantine tool (ref ADR-114)
- Not touched: `tools/role-catalog` (another agent), TypeScript runtime, routes, components.

## Data changes

See ADR-114. One migration, NOT APPLIED. Rollback fails closed while institution packs exist
unless `sherivs.rollback_purge_institution_packs = on` is set in the session.

## Risks

- Changing `cg_role_pack_guard` touches ENGINE-01: the body is unchanged except the tier ceiling
  line; the rollback restores the ENGINE-01 body verbatim, and the SQL test checks it.
- One active institution pack per organization is an assumption (ADR-114 UNKNOWNs).

## Acceptance tests

`tests/sql/m2-role-pack-engine.sql` (local Postgres 16, database `m2b_test`) proves: overrides
cannot remove a guardrail or SoD rule or add a protected permission; install is idempotent; a
non-published pack is refused; installing for another organization as a tenant user is refused;
the upgrade preview diff is exact on a two-version fixture and writes nothing; published items are
immutable; a custom role cannot be self-approved; cross-organization reads return nothing; a second
run; the rollback; a re-apply after rollback.

## Report

MISSION: M2 part B. STATUS: implemented, tested locally; draft PR open; not applied.

- IMPLEMENTED: migration, rollback, guards, functions, ADR-114, INDEX row.
- TESTED: SQL behaviour test passes (114 assertions); unit test (17 tests) passes; grants,
  neutrality, provenance checks PASS.
- NOT ATTEMPTED: resolver and its cache, builder UI (M4), seeds (generator owner).

## Migration handoff

1. `database/supabase/migrations/20261117001100_sherivs_m2_role_pack_engine.sql`
   (rollback `database/supabase/rollbacks/20261117001100_sherivs_m2_role_pack_engine.sql`).
   Verify after applying:
   `SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('role_pack_items','role_pack_migrations','tenant_role_pack_installations','tenant_role_overrides','org_custom_roles');`
   and `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'cg_role_pack_kind_check';`.
