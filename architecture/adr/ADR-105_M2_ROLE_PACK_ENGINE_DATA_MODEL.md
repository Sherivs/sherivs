# ADR-105: Roles Pack Engine Data Model and Database Functions

| Field                      | Value                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (founder approval and an independent security review are required before any apply)                                           |
| Date                       | 2026-11-17                                                                                                                             |
| Author                     | Claude Code agent (mission M2, part B)                                                                                                 |
| Creator                    | Claude Code agent, mission E-007 (M2 part B, Roles Pack Engine data model)                                                             |
| Mission                    | M2 (Roles Pack Engine core), part B                                                                                                    |
| Capabilities               | Versioned institution packs, tenant installation and upgrade with a preview diff, narrowing-only overrides, four-eyes custom roles     |
| Cites                      | [ADR-101](./ADR-101_SEC_M0_ANONYMOUS_SURFACE_AND_PRIVATE_BY_DEFAULT.md); ENGINE-01 `cg_role_pack`; SHERIVS-017 role catalogue; M009-A1 |
| Minimal ownership artifact | `database/supabase/migrations/20261117001100_sherivs_m2_role_pack_engine.sql`                                                          |

## Context

Master brief §7.1 to §7.3 define a Role Pack as a versioned, immutable bundle for an institution
type that a tenant installs and later upgrades. ENGINE-01 already has a pack registry
(`cg_role_pack`: versioned, immutable once published, digest-guarded) but only for the AI twin's
ceiling of one role. SHERIVS-017 owns templates, permissions, guardrails and separation-of-duties
(SoD) rules. Nothing records which pack a tenant runs, how a tenant may adjust it, or how a tenant
builds its own role.

## Options

- **A. A new pack registry next to `cg_role_pack`.** Rejected: a second registry (AGENTS rule 17).
- **B. Copy pack content into tenant tables at install.** Rejected: an upgrade would rewrite tenant
  rows and drift from the catalogue; a pointer swap is simpler to audit and to reverse.
- **C. Widen `cg_role_pack.kind` with `institution_pack`, keep content in a catalogue table keyed by
  pack version, and record tenants' installations, overrides and custom roles separately.** Chosen.

## Decision

1. `cg_role_pack.kind` gains `institution_pack`. All ENGINE-01 guards stay; the only guard change
   is that an institution pack gets the tenant tier ceiling (T2), not the platform one (T3).
   `cg_twin_latest_pack` still binds twins to `tenant_role` / `platform_role` packs only.
2. `role_pack_items` holds catalogue content (template, responsibility, layout, policy,
   approval_chain, notification_rule, audit_event, seed). It has no tenant column. Items can change
   only while their pack is a draft. A template item can never drop a mandatory permission or a
   guardrail of the 017 template it names, and every permission must exist in `permission_catalog`.
3. `role_pack_migrations` declares an upgrade path; it is immutable once the target is published.
4. `tenant_role_pack_installations`: one active institution pack per organization. The table is
   history (no delete); only the status moves on (`active -> superseded | uninstalled`).
5. `tenant_role_overrides` may only narrow or add a non-protected optional permission. The guard
   accepts only the keys of each kind, so a guardrail or SoD key is refused. There is no kind that
   removes a guardrail or an SoD rule. A permission or responsibility that would complete an SoD
   pair with what the role holds is refused. Scope may only narrow, and an approval limit may only
   go down (a template with no approval authority, a NULL limit, cannot get one). The approver must
   differ from the creator and both must belong to the organization. An override is immutable; it
   is ended with `effective_to`.
6. `org_custom_roles`: status `draft -> pending_approval -> active -> retired`. Activation needs an
   approver who is not the creator (four-eyes), who is the caller when a user JWT is present, and a
   layout with exactly three primary navigation sections. Permissions must exist, none may be
   protected, and the set (with the base template's mandatory permissions) must not break an SoD
   rule. An active version is immutable; changes make a new version.
7. Functions, all `SECURITY DEFINER` with `search_path = ''`:
   `role_pack_install` (service role only, idempotent, refuses a non-published or non-institution
   pack), `role_pack_upgrade_preview` (read-only diff of templates and permissions gained and lost
   and the overrides that would end), `role_pack_upgrade_apply` (only along a declared migration,
   with an expected-from-version check, in one transaction, audited in `audit_logs`). For a user
   caller the organization must be the caller's own (`get_my_school_id`) and the caller an
   administrator (`can_administer_org`).
8. Privileges (ADR-101): FORCE RLS everywhere, nothing for `anon`, `SELECT` only for
   `authenticated` (published catalogue rows; tenant rows to the organization's administrators),
   writes by the service role or through the functions. Tenant tables carry `scholar_audit`.

## Consequences

- An upgrade is a pointer swap plus ending the overrides of lost templates; it can be reasoned
  about and audited as one event.
- Rollback must delete institution pack rows that ENGINE-01 treats as permanent, so it stops unless
  the operator sets `sherivs.rollback_purge_institution_packs = on`.
- The steps in `role_pack_migrations` are recorded and returned, but only the structural effects
  above are applied by the database today.

## Deliberately left for later

- The resolver of §7.3 (effective permissions narrowed by overrides) and its TypeScript session
  cache: a later M2 or M3 change. Overrides and custom roles are stored and guarded here but do not
  yet change `effective_permissions`.
- The custom role and override builder UI, simulate-as and the approval inbox: mission M4.
- Bridging `org_custom_roles` to `role_create_custom` / `org_role_custom_grants` and assignment.
- Validation of `workspace_category` against a fixed list (no canonical codes exist yet) and of
  custom-role responsibility codes against a catalogue.
- Seeding packs: owned by the catalogue generator (`tools/role-catalog`), not this change.

## Golden Questions

- WHO may install: the provisioning service only. WHO may upgrade: an administrator of that same
  organization, or the service. WHO may approve: a second member of the organization.
- WHAT can change: narrowing overrides and non-protected optional additions; never guardrails, SoD
  rules or protected permissions.
- WHERE enforced: database triggers and definer functions, not the UI.
- WHY: §2.1 rule 6 (SoD cannot be configured away) and §7 of the master brief.
- UNDER WHICH POLICY: ADR-101 private by default; NDPA audit duty through `audit_logs`.

## UNKNOWNs

- Whether one active institution pack per organization fits multi-type groups (A10). Assumed yes
  for now because the brief's upgrade signature takes only an organization and a version.
- Whether `NULL approval_limit_ngn` means "no approval authority". Production shows cashier and
  accountant with NULL, so the guard treats NULL as no authority (fail closed). Founder to confirm.
