# Internal Console and Scholar: Current Architecture

**Snapshot:** 2026-10-31
**Version target:** V1 organizational capability envelope. This is an inspection record, not an implementation plan; V2, V3, and future-unassigned capabilities remain frozen (`AGENTS.md:923-924`). No live database or deployment was accessed for this snapshot.

## Product and runtime boundary

- The Internal Console is a staff control-plane surface rooted at `/console`; the retired `/internal`, `/super-admin`, and `/command-centre` prototypes are explicitly excluded (`frontend/src/lib/internal-console/paths.ts:1-7`; `frontend/src/lib/experience/console-host-routing.ts:5-16`).
- Scholar remains the single operational runtime, with its runtime contract pointing to `https://app.sherivs.com/home` (`frontend/src/lib/internal-console/runtime-contract.ts:1-35`; `tests/unit/internal-console.test.ts:60-64`). Scholar’s tenant-facing home resolves an organization and role context from the identity/profile model (`frontend/src/components/app-shell/home-screen.tsx:36-73`; `frontend/src/contexts/app-context.tsx:27-88,447-458`).
- Host routing is not authorization. Console APIs still authenticate and check identity/capability; host classification only constrains which surface is served on each host (`frontend/src/lib/experience/console-host-routing.ts:1-16,91-124`; `frontend/src/lib/internal-console/overview.functions.ts:105-112`).

## Identity and authorization

The control-plane workforce has two existing identity sources: `public.super_admins` and `public.platform_staff`, with role grants in `public.platform_staff_roles`. The database helper `has_platform_capability()` accepts a capability when the caller is a super-admin or an active staff member holds a role whose catalog contains it (`database/supabase/migrations/20261020000150_sherivs_008_platform_staff.sql:42-83`). The platform role catalogue is fixed by migrations and mirrored in TypeScript for presentation; the database remains authoritative (`frontend/src/lib/platform-staff/catalogue.ts:1-6,21-66`).

The console’s six V1 workspace labels are a presentation mapping, not a second authority model. `presentationRoleFor()` selects a label from existing platform role codes; `viewerCapabilities()` unions database-derived role capabilities and adds the super-admin display set (`frontend/src/lib/internal-console/roles.ts:15-53,363-380`). Server functions re-check capability and, for privileged mutations, step-up authentication (`frontend/src/lib/platform-staff/staff.functions.ts:45-60,147-155`; `frontend/src/lib/internal-console/organization.store.server.ts:83-95,466-470`).

Scholar tenant roles are a separate boundary: the local `AppRole` vocabulary and directional Scholar-to-neutral mapping are defined in the runtime layer (`frontend/src/lib/roles.ts:1-20`; `frontend/src/lib/runtime/scholar-role-mappings.ts:1-10,46-102`). SHERIVS-017 defines institution-scoped `role_catalog`, `user_role_assignments`, and permission tables; its migration header says it was not applied to production (`database/supabase/migrations/20261024000240_sherivs_017_role_permission_catalog.sql:1-15,37-86`).

## Workspace and invitation persistence

SHERIVS-030 stores console workspaces, membership, runtime registrations, recent access, and invitation expiry. `personal`, `shared`, and (after SHERIVS-031) `role` are workspace kinds; the schema explicitly says workspace membership does not grant platform authorization (`database/supabase/migrations/20261027001000_sherivs_030_internal_console.sql:12-18,24-64,78-106`; `database/supabase/migrations/20261027002000_sherivs_031_control_plane_engines.sql:34-60`).

Accepted invitations require the matching authenticated identity and confirmed email, then provision the personal workspace and synchronize role workspaces (`database/supabase/migrations/20261027001000_sherivs_030_internal_console.sql:111-201`; `database/supabase/migrations/20261027002000_sherivs_031_control_plane_engines.sql:162-230,234-271`). Role/status changes also call the synchronization RPC (`frontend/src/lib/platform-staff/staff.functions.ts:303-343,349-394`). Personal workspaces are per-user; role workspace memberships are reconciled separately (`database/supabase/migrations/20261027001000_sherivs_030_internal_console.sql:44-64,203-238`; `database/supabase/migrations/20261027002000_sherivs_031_control_plane_engines.sql:201-230`).

## Organization lifecycle and tenant boundary

`platform_organization` is a staff-operated lifecycle case, not a second school identity. Its `school_id` link is nullable until provisioning and references canonical `public.schools`; assignments and lifecycle transitions are separate records (`database/supabase/migrations/20261027002000_sherivs_031_control_plane_engines.sql:7-14,280-314,379-423`). The server implementation validates lifecycle transitions, checks capabilities, and writes transition/audit records (`frontend/src/lib/internal-console/organization.store.server.ts:97-114,184-220`; `frontend/src/lib/internal-console/organization-lifecycle.ts:1-120`).

Console staff identity is distinct from Scholar tenant membership: staff administration reads and mutates `platform_staff`/`platform_staff_roles`, while organization cases link to Scholar tenants only after provisioning (`database/supabase/migrations/20261020000150_sherivs_008_platform_staff.sql:42-64`; `database/supabase/migrations/20261027002000_sherivs_031_control_plane_engines.sql:316-380`).

## Audit, health, and commercial data

- Staff and organization actions write to the existing `audit_logs`; SHERIVS-016 makes that log append-only and bridges entries to the audit chain (`frontend/src/lib/platform-staff/staff.functions.ts:88-105`; `frontend/src/lib/internal-console/organization.store.server.ts:97-114`; `database/supabase/migrations/20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql:557-609`). Console audit readers query control-plane actions from that store (`frontend/src/lib/internal-console/activity.functions.ts:47-87`).
- Health is based on `/health.json` process/dependency evidence. The console distinguishes operational, degraded, unavailable, unknown, and maintenance; an application-process success is explicitly not proof that every workflow works (`frontend/src/lib/observability/health.ts:1-12,16-25`; `frontend/src/lib/internal-console/status.ts:7-40`; `frontend/src/lib/internal-console/overview.functions.ts:160-227`).
- The billing read model uses existing `public.subscriptions` and `school_platform_pricing`; it describes payment history and explicitly disclaims recognized revenue/MRR. Entitlement records also exist separately in `org_entitlements` (`frontend/src/lib/internal-console/operations.store.server.ts:455-523`; `frontend/src/lib/internal-console/metrics.ts:142-152`; `database/supabase/migrations/20261022000200_sherivs_013_payments_audit_entitlements.sql:161-224`).
- SHERIVS-032 adds console ticket/incident stores with forced RLS and authenticated SELECT-only grants; it does not replace the tenant audit or subscription stores (`database/supabase/migrations/20261027003000_sherivs_032_control_plane_operations.sql:1-11,15-75`).

## SHERIVS-030 / SHERIVS-031 status

Both forward migrations and matching rollback files are present (`database/supabase/rollbacks/20261027001000_sherivs_030_internal_console.sql`; `database/supabase/rollbacks/20261027002000_sherivs_031_control_plane_engines.sql`). Unit-test source checks the console store’s forced-RLS/client-write posture and the SHERIVS-031 lifecycle/workspace constraints (`tests/unit/internal-console.test.ts:397-442`; `tests/unit/organization-lifecycle.test.ts:139-163`). `progress/internal-console/CONTROL-PLANE-V1-GAP-MATRIX.md:5,60-66` records a 2026-10-28 production schema apply and production console deployment, while also stating that live staff-authenticated browser verification was blocked by the lack of operator credentials. Those are repository-recorded claims; Phase A did not independently verify production.

## M009-A1 / #176 role-engine boundary

Issue #176 defines a shared tenant-scoped role/responsibility contract. Draft PR #196 adds `frontend/src/lib/workspaces/contract.ts` and `manifest-resolver.ts`, and migration `database/supabase/migrations/20261031000010_sherivs_m009_a1_role_responsibility_engine.sql` extends institution role assignments with org units, responsibilities, grants, delegations, and active-membership checks (`#176`; draft PR #196; PR migration lines 6-25, 45-61, 460-487, 980-1016).

The control-plane staff model remains `platform_roles`/`platform_staff_roles` plus `super_admins`; M009-A1 is tenant-scoped through `public.schools`, `organization_memberships`, and `public.users`. Recommendation: do not create a console-specific role engine or map platform staff into tenant assignments. Keep authorization at each existing scope boundary, make the shared M009 contract the authority for Scholar tenant assignments, and agree any cross-scope adapter in #176/#196 before implementation. Confirm the production prerequisite: SHERIVS-017 currently labels its `role_catalog`/`user_role_assignments` migration “NOT APPLIED TO PRODUCTION,” while PR #196 alters those objects (SHERIVS-017 migration lines 1-15, 37-86; PR #196 migration lines 21-36).
