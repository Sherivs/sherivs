# Sherivs V1 workspace architecture

Version target: **ACTIVE-V1**. Canonical destinations: `console.sherivs.com/console`, `app.sherivs.com/home`.

The Internal Console is one universal shell. Workspaces are operating environments composed from authorized data. Workspace membership never grants capabilities.

## Types

| Kind | Owner / membership | Persistence |
|---|---|---|
| Personal | The staff member | `platform_workspace.kind = personal` via `ensure_platform_personal_workspace` |
| Role | Members of the mapped `platform_roles` code, or super-admin → `platform_owner` | `platform_role_workspace` + `sync_platform_staff_workspaces` |
| Shared | Explicit membership | Staff-created rows; not a permission framework |

Derived fallback workspaces exist only when SHERIVS-030/031 are not applied. They use the same mapping contract and do not authorize access.

## Role mapping

| Presentation | Database identity | Workspace |
|---|---|---|
| Platform Owner | `is_super_admin()` | Platform Operations |
| Platform Administrator | `platform_admin` | Platform Administration |
| Operations Administrator | `operations` | Operations |
| Engineer | `engineering` | Engineering |
| Support Specialist | `support` | Support |
| Standard Team Member | assigned roles or none | Personal workspace |

Security, finance, and sales keep their existing database roles and receive matching role workspaces. They are not extra privileged identities.

## Provisioning

Invitation claim, overview load, role change, and status change call `sync_platform_staff_workspaces`. The RPC is idempotent. Personal ownership survives role change and revocation. Role membership is recalculated.

## Organization and school

`platform_organization` is the onboarding case. `public.schools` remains the tenant. Provisioning links `school_id` without duplicating tenant identity. Runtime access still requires an active school and an authorized school user.

## Subscriptions

The console does not host a commercial billing ledger. See `SUBSCRIPTION-ENTITLEMENT-ASSESSMENT.md`.
