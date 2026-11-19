# ADR-121: Custom Role Builder, Access Reviews and Delegation Bounds

| Field                      | Value                                                                                                                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (founder approval and an independent security review are required before any apply)                                                                                                                                                                                |
| Date                       | 2026-11-18                                                                                                                                                                                                                                                                  |
| Author                     | Claude Code agent (mission M4)                                                                                                                                                                                                                                              |
| Creator                    | Claude Code agent, mission E-015 (M4 custom role and responsibility builder)                                                                                                                                                                                                |
| Mission                    | M4 (custom role and responsibility builder, access-review campaigns, delegation and acting roles)                                                                                                                                                                           |
| Capabilities               | Admin-only builder with SoD/risk preview and simulate-as; four-eyes approval; activation into the assignable catalogue; time-boxed delegation                                                                                                                               |
| Cites                      | [ADR-114](./ADR-114_M2_ROLE_PACK_ENGINE_DATA_MODEL.md); [ADR-113](./ADR-113_M2A_ROLE_CATALOGUE_EXTENSION_AND_WORKSPACE_MODE.md); [ADR-106](./ADR-106_M3_EVERY_CARD_IS_A_CONTRACT.md); [ADR-101](./ADR-101_SEC_M0_ANONYMOUS_SURFACE_AND_PRIVATE_BY_DEFAULT.md); M009-A1; M13 |
| Minimal ownership artifact | `database/supabase/migrations/20261117003000_sherivs_m4_role_builder.sql`                                                                                                                                                                                                   |

## Context

ADR-114 (PR #438) stores custom roles in `org_custom_roles` with a guard that enforces four-eyes,
refuses protected permissions and SoD-violating sets, and requires three navigation sections on
activation. Only the service role can write the table, nothing makes an approved role assignable,
and there is no UI. M009-A1 has delegations but checks the source assignment's window only in its
RPC, so a direct write, or a later shortening of the source, can leave a delegation outliving the
assignment it came from. The responsibility catalogue has no description, evidence or review
cadence. M13 access reviews are complete in the database but have no screen.

## Options

- **A. Server functions write `org_custom_roles` with the service role.** Rejected: under the
  service role `auth.uid()` is NULL, so the guard's "approver is the caller" check never runs,
  and the M009 audit trigger refuses every role mutation without an authenticated actor.
- **B. A second approval path through the WF engine.** Rejected: four-eyes is already enforced by
  the ADR-114 guard; a second path would be a duplicate engine (ADDENDUM rule).
- **C. Definer functions called with the caller's JWT that drive the ADR-114 status machine, plus
  an activation function that materialises an approved version into the existing 017/M009
  tables.** Chosen.

## Decision

1. `custom_role_save_draft / _submit / _withdraw / _approve / _activate` are `SECURITY DEFINER`,
   `search_path = ''`, executable by `authenticated` only. The organization is
   `get_my_school_id()`; the caller must be an administrator (`role_pack_caller_is_org_admin`).
   Approval is the ADR-114 `pending_approval -> active` transition with `approved_by = auth.uid()`;
   the guard refuses the creator. Approving version N retires the previous active version.
2. Activation writes, for code `custom.<org hex>.<slug>`: a `role_catalog` row on the base
   template; `org_role_permission_settings` (optional template permissions on exactly when
   drafted); `org_role_custom_grants` for permissions outside the template; and three
   permissionless organization responsibilities (`daily_priority` 0, 1, 2) carrying the three
   navigation sections, linked in `workspace_role_responsibilities`. The existing resolvers then
   give a holder exactly those three sections. Chosen add-on responsibilities stay linked as
   grantable add-ons; core or custom ones are folded into the permission list by the builder so
   they do not compete for navigation. Activation is idempotent and refused for a holder of the role.
3. A role started from scratch can be drafted, previewed and approved, but cannot be activated
   for assignment (the catalogue requires a template). The builder says so.
4. Delegations: a row guard refuses a window outside the source assignment, a different
   organization, a widening update, or a new delegation of an inactive assignment; an
   `AFTER UPDATE OF status, valid_until` trigger trims or revokes delegations when the source is
   shortened or ended. `workspace_my_acting_context()` returns the caller's own active
   delegations and acting/temporary assignments for the shell banner.
5. `workspace_responsibility_catalog` gains `description`, `evidence_required` (at most 12) and
   `review_cadence_days` (7 to 730); `workspace_responsibility_define` creates an organization
   responsibility, refusing protected permissions and SoD pairs.
6. The SoD/risk preview and "simulate as" run in TypeScript over the database's own rules
   (`sod_permission_rules`, `role_template_permissions`), read-only, with the existing
   `resolveWorkspaceManifest` and `denialReason`. They explain; the database decides.
7. Screens `role-builder`, `access-reviews`, `delegations` are live card-registry sections,
   lazily loaded; the banner lives in the deferred `app-shell.tsx`.

## Consequences

- Every mutation is audited by existing triggers: `scholar_audit` on `org_custom_roles`, the M009
  audit on catalogue, settings, grants, responsibilities and delegations, the M13 audit table for
  reviews. All of them have the real actor because the JWT is preserved.
- Widgets of a custom role are stored in its layout and shown by simulate-as; the live shell
  manifest does not yet read them (no widget column on responsibilities).

## Golden Questions

- WHO may draft, approve, activate: administrators of the caller's own organization; approval by
  someone other than the creator. WHO may delegate or run reviews: `roles.assign` holders.
- WHAT can change: drafts only; approved versions are immutable (ADR-114); delegations only shrink.
- WHERE enforced: ADR-114 guard, M4 definer functions and triggers, M009/M13 functions.
- WHY: master brief §7.3 and §12.1 M4; §2.1 SoD cannot be configured away.
- UNDER WHICH POLICY: ADR-101 private by default; NDPA audit duty.

## UNKNOWNs

- Whether scratch roles should become assignable through a catalogue "blank" template (founder).
- Whether `roles.custom_create` / `roles.custom_approve` holders who are not administrators should
  use the builder; today it is administrators only, as the brief says.
