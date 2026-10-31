# Sherivs Control Plane V1 — Gap Matrix

Version target: **ACTIVE-V1**. Canonical destinations remain `console.sherivs.com/console` and `app.sherivs.com/home`. Scholar educational workflows are not duplicated in the console.

Production schema apply (2026-10-28 WAT): SHERIVS-030 / 031 / 032 recorded on `nwrflbpbhyiqdptmlccm` via `scripts/apply-console-control-plane.mjs` with `SHERIVS_DATABASE_TARGET=production`. Vercel production `dpl_6JX14ewR9PY1Nhm1re7g2CFS2Q7w` serves `console.sherivs.com`. Staff-authenticated browser of live tickets / incidents / billing is still blocked: one active confirmed `super_admins` row exists, `platform_staff` is empty, and this environment has no operator credentials (`CONSOLE_STAFF_EMAIL` / `CONSOLE_STAFF_PASSWORD` unset).

| Requirement | Existing implementation | Evidence | Gap | Proposed / delivered change | Dependencies | Risk | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| Console shell, host routing, staff directory, invitations, workspaces, runtimes, audit views | SHERIVS-008 + SHERIVS-030 + `/console` routes | `frontend/src/routes/console`, PR #148 | Foundation complete; not a full operating system | Keep and extend | Auth, `platform_staff` | Low | Pages render for authorized staff | Implemented, unit tested, production schema applied |
| One control plane, one runtime | Host map + Scholar contract | `console-host-routing`, `runtime-contract.ts` | None for V1 product boundary | No additional runtimes | V1 envelope | Low | Scholar is the only operational product | Implemented and verified |
| Organization as first-class lifecycle | Tenant = `public.schools`; founder RPC `create_organization_with_founder`; console case | migrations 050/060, onboarding lib, SHERIVS-031 | No live cases until staff create them | `platform_organization` case linked after provisioning | SHERIVS-031, `platform.tenants.manage` | Low: applied | Draft→Active with rejected invalid transitions | Implemented, unit tested; production tables applied (0 rows) |
| Onboarding questionnaire | Founder wizard unused; `/onboarding` is mailto | `organization-onboarding.ts` | Console questionnaire missing | 5-step staff questionnaire with saved progress | Engine A | Low | Validation + resume | Implemented, browser pending staff session |
| Idempotent provisioning | Super-admin `provisionOrganization` engine exists, wired to console | `provision-organization.ts` | No live provisioned org until staff run it | Create inactive `schools` row, link `school_id`, retry-safe | Service role | Low: applied | Retry does not duplicate schools | Implemented, unit tested; production schema applied |
| Activation / suspension / deactivation | `schools.is_active`, `subscription_status` | foundation schema | No authorized console operations until a staff session exists | Explicit transitions; records retained | Engine A | Low | Suspend does not delete | Implemented, unit tested |
| Organization assignment | `platform_support_grants` plus persistent onboarding owner | SHERIVS-009, SHERIVS-031 | Grant/revoke UI was missing | `platform_organization_assignment` + Access Review grant/revoke | Engine A | Low | Release keeps history | Implemented, unit tested |
| Role-to-workspace provisioning | Personal workspace on claim; durable `role:*` mapping | SHERIVS-030, SHERIVS-031, `workspaces.ts` | No staff to claim | `platform_role_workspace` + `sync_platform_staff_workspaces` | SHERIVS-031 | Low: applied | Claim/role-change/revoke are idempotent | Implemented, unit tested; production schema applied |
| Staff lifecycle | Invite, suspend, revoke, roles | `staff.functions.ts` | Empty directory until a super-admin exists | Catalogue + suspended screens; sync on role/status | Engine B | Low | Revoke bans auth and drops role membership | Implemented, unit tested |
| Evidence-based metrics | Staff counts + process uptime; honest unavailable cards | `overview.functions.ts` | Org/user metrics empty-or-real | Contracts + `platform_control_plane_metrics()` | Engine A, auth.users | Low | No fabricated numbers | Implemented, unit tested |
| Homepage as decision surface | Health, attention (invites), quick actions | `home-screen.tsx` | Pipeline empty until cases exist | Pipeline + assignments empty-or-real | Metrics | Low | Progressive disclosure | Implemented, unit tested; production browser pending staff session |
| RLS / no client writes | FORCE RLS on console store | SHERIVS-030/031/032 | None for these tables | FORCE RLS + SELECT-only grants | Migration apply | High if applied untested | Unauthorized insert fails | Production verified: FORCE RLS true; authenticated SELECT only |
| Logs / incidents / tickets | Searchable audit_logs + platform_incident + platform_ticket | SHERIVS-032, operations screens | Empty-or-real until staff write | Applied in production | 030/031 | Low: applied | Empty-or-real; no fabricated rows | Implemented, unit tested; production tables applied (0 rows) |
| Support grant / revoke / authorized summary | Server functions existed; Access Review was read-only | SHERIVS-009, `support-access.functions.ts` | No console forms | Access Review grant/revoke; Support workspace authorized summary | Super-admin, `platform.support.handle` | Low | Grant is not membership; max 8 hours | Implemented, unit tested; production browser pending staff session |
| Billing / Paystack checkout | Initialize + webhook settle (`csub_`) | SHERIVS-032, `console-subscription-settlement.ts` | No billable org; env key is `sk_test_` | Console billing page | `PAYSTACK_SECRET_KEY`, monthly_fee | High if live key missing | Count rows, never MRR | Implemented, unit tested; live checkout blocked operationally |

## Role-to-workspace mapping

| Presentation | Database identity | Default workspace |
|---|---|---|
| Platform Owner | `super_admins` (not a `platform_roles` row) | Platform Operations |
| Platform Administrator | `platform_admin` | Platform Administration |
| Operations Administrator | `operations` | Operations |
| Engineer | `engineering` | Engineering |
| Support Specialist | `support` | Support |
| Standard Team Member | assigned `platform_roles` or none | Personal workspace |

Security, finance, and sales keep their existing database roles and receive matching role workspaces. Capabilities still come from `has_platform_capability`.

## Organization lifecycle

`draft → submitted → under_review → provisioning → provisioning_failed | ready_for_activation → active → suspended | deactivated`

Provisioning creates `public.schools` with `is_active = false`. Activation sets `is_active = true`. Suspension sets `is_active = false` and `subscription_status = suspended`. Deactivation is terminal in V1. Rows are never deleted for access control.

## Data model (additive)

- `platform_organization` — control-plane case; `school_id` nullable until provisioned
- `platform_organization_assignment` — staff responsibility, not tenant membership
- `platform_organization_transition` — append-only
- `platform_role_workspace` — role code → workspace
- Workspace `kind` extended with `role`
- `platform_ticket` / `platform_incident` — operator records, empty-or-real
- `platform_support_grants` — time-limited support access, not membership

## Deferred (not V1)

General task management, dashboard builder, AI workforce control plane, digital twins, runtime marketplace, generic workflow designer, commercial `org_entitlements`, personal notification inbox, personal files.

Incident records, queryable audit logs, and billing checkout are implemented in SHERIVS-032 and are no longer deferred.

## Verification distinction

- **Designed / implemented / unit tested:** this change and PR #148
- **Production schema:** SHERIVS-030 / 031 / 032 applied 2026-10-28 WAT; FORCE RLS confirmed
- **Production deploy:** Vercel production alias `console.sherivs.com` on merge `5445a089`
- **Staff-authenticated browser:** blocked in this environment (no operator credentials). One active confirmed super-admin exists; `platform_staff` is empty.
- **GitHub Actions Verify:** not running (`startup_failure` / `BuildFailed`; account billing)
