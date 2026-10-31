# Workspace gap matrix — ACTIVE-V1

Production schema apply (2026-10-28 WAT): SHERIVS-030 / 031 / 032 are recorded on production. Live staff session, invitation delivery, and Paystack live checkout remain operational.

| Workspace or capability | Current implementation | Missing | Backend dependencies | Permissions | Data sources | Security risks | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|
| Universal shell | `/console` chrome, selector, search | Staff session | Host routing | Console operator | Overview | UI is not authz | Shell shared | Implemented, browser tested (fixture); production /auth verified |
| Role-to-workspace engine | SHERIVS-031 RPC + TS mapping | Staff to claim | `platform_role_workspace` | Staff membership | platform_roles / super_admins | Duplicate identities | Idempotent claim | Implemented, unit tested; production schema applied |
| Derived fallback | Compatibility workspaces | Used when the store is unavailable | None | Role codes | Mapping contract | Must not authorize | Names match mapping | Implemented, unit tested |
| Platform Operations | Experience on `role:platform_owner` | Operator credentials in this environment | tenants.read, audit.read | Super-admin | Org metrics, health, audit | School-data bleed | Oversight without school SIS | Implemented, unit tested; browser pending (credentials not in this environment) |
| Platform Administration | Experience on `platform_admin` | Live invite delivery | staff.read/manage, AAL2 writes | platform_admin | platform_staff | Super-admin grant | Cannot grant owner | Implemented, fixture browser tested |
| Operations | Experience + org queue | Live cases | tenants.read/manage | operations | platform_organization | Tenant data | Lifecycle ≠ school records | Implemented, fixture browser tested; production tables empty |
| Engineering | Health, runtimes, log search, incidents | Observability provider traces | engineering.read | engineering | health.json, audit_logs, platform_incident | Secret leakage | Unknown ≠ healthy | Implemented, unit tested |
| Support | Assignments, directory, tickets, grant summary | Live grant + staff | tenants.read, support.handle | support | platform_ticket, assignments, grants | Student/fee data | Tickets are org cases only | Implemented, unit tested |
| Personal | Identity, recent, shortcuts | Notifications, files (deferred) | Personal membership | Every staff | recent resources | staff.manage peek | Private by default | Implemented, fixture browser tested |
| Invitation claim sync | claim + sync RPC | First invitee | SHERIVS-031 | Authenticated invitee | platform_staff | Duplicate workspaces | Idempotent | Implemented; production schema applied |
| Organization-to-school | Provisioning links school_id | Staff-run provision | schools insert | tenants.manage | public.schools | Duplicate schools | Retry-safe | Implemented, unit tested; production schema applied |
| Subscriptions | Billing page + Paystack Inline | Live monthly_fee checkout; env is test key | finance.read / tenants.manage | finance, operations | public.subscriptions, school_platform_pricing | Fake revenue | Count rows, never MRR | Implemented, unit tested |
| Metrics / audit | Contracts + searchable audit_logs | Provider traces | audit.read / engineering.read | As contracted | audit_logs, platform_organization, staff | Over-claim | Source on every card | Implemented, unit tested |
| Support grants | Access Review grant/revoke + Support authorized summary | Super-admin session | SHERIVS-009 | Super-admin grant; support.read under grant | platform_support_grants | Grant as membership | Max 8 hours; audited | Implemented, unit tested |
