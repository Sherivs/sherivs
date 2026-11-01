# Internal Console Security Findings

**Version target:** V1 organizational capability envelope.

**Assessment type:** source and repository-evidence review only; no production database, credentials, or live staff session was accessed. No behavior changes are made by this document.

## Positive controls observed

1. **Capability checks are server-side.** The legacy `has_platform_capability()` checks active staff role capabilities and retains its super-admin short-circuit for non-console consumers. Phase B Console functions use `has_internal_console_capability()` for active staff and a server-only, audited Platform Operations path for super-admin actions (`database/supabase/migrations/20261020000150_sherivs_008_platform_staff.sql:67-83`; `database/supabase/migrations/20261101000030_sherivs_m1_phase_b_controls.sql`; `frontend/src/lib/internal-console/console-access.server.ts`).
2. **Super-admin self-claim is constrained.** SHERIVS-007 removes client INSERT/DELETE and limits client profile updates; the only supported creation path is service-role/operator provision (`database/supabase/migrations/20261020000140_sherivs_007_lock_super_admins.sql:12-35`; `tests/unit/super-admin-no-self-claim.test.ts`).
3. **Workspace records are not grants.** SHERIVS-030/031 force RLS on workspace tables and grant authenticated users SELECT, not writes; role/workspace membership is explicitly not authorization (`database/supabase/migrations/20261027001000_sherivs_030_internal_console.sql:240-304`; `database/supabase/migrations/20261027002000_sherivs_031_control_plane_engines.sql:9-13,484-506`).
4. **Organization cases are distinct from tenant records.** The SHERIVS-031 case may link to `public.schools` after provisioning; assignments are not tenant membership (`database/supabase/migrations/20261027002000_sherivs_031_control_plane_engines.sql:7-14,379-400`).
5. **Sensitive support reads are grant-checked and audited.** The support summary first checks `has_support_access(school)`, returns only school metadata and member count, and writes success/failure audit events (`frontend/src/lib/platform-staff/support-access.functions.ts:178-220`; `database/supabase/migrations/20261020000160_sherivs_009_support_access.sql:13-50`).
6. **Health and metric claims are bounded.** Missing storage/integration checks are shown as Unknown/not configured, and the health code warns that process health does not prove all workflows work (`frontend/src/lib/internal-console/overview.functions.ts:160-227`; `frontend/src/lib/internal-console/metrics.ts:1-17`).

## Findings requiring follow-up

### SF-1 — Super-admin bypass is scoped for the V1 Console

The legacy `has_platform_capability(p_capability)` remains a global helper for non-console consumers. M1's `has_internal_console_capability()` resolves active staff roles only; the server helper separately permits Platform Operations overview/organization-summary reads, audit reads, and audited Operations assignment. Each server bypass is appended to the existing audit stream. Direct super-admin reads of personal workspaces, staff directories, organization case tables, tickets, and incidents are denied by their RLS policies (`database/supabase/migrations/20261101000030_sherivs_m1_phase_b_controls.sql`; `frontend/src/lib/internal-console/console-access.server.ts`).

**Residual boundary:** This change scopes the Internal Console only. The legacy helper and other non-console domain policies were not redefined by Phase B; callers outside the Console still require their own authorization review.

**Status:** Implemented for the V1 Console without creating a `platform_owner` platform role or changing the `#176` tenant-scoped role engine.

### SF-2 — Navigation and role labels are not enforcement

Presentation role selection chooses one UI label, while capability calculation unions all assigned platform roles. `navVisible()` and `quickActionsFor()` filter UI only; server functions must independently enforce capability/AAL2 checks (`frontend/src/lib/internal-console/roles.ts:34-53,255-276,352-380`; `frontend/src/lib/platform-staff/catalogue.ts:61-66`; `frontend/src/lib/platform-staff/staff.functions.ts:45-60`).

**Risk:** A visible/hidden navigation item cannot establish that an API call is authorized, and one displayed role may conceal other effective role grants.

**Recommendation:** Keep the existing database checks authoritative. When documenting the six workspaces, show all assigned identifiers and effective capabilities, not only the selected presentation label.

### SF-3 — Support organization scope is assignment-scoped

M1 scopes organization directory, detail, overview metrics, tickets, and incidents to the caller’s active `support` assignments in server functions and RLS. Support metrics are calculated from those assigned cases; global school/user aggregates are omitted. Super-admin organization details are summary-only and require an audited Platform Operations read (`frontend/src/lib/internal-console/organization.store.server.ts`; `frontend/src/lib/internal-console/operations.store.server.ts`; `database/supabase/migrations/20261101000030_sherivs_m1_phase_b_controls.sql`).

**Status:** Implemented in source and covered by the Phase B SQL proof. The proof has not been run against a local Supabase database in this task.

### SF-4 — M009-A1 is tenant-scoped; production prerequisite remains unresolved

Merged PR #196 builds the M009-A1 contract over tenant-scoped role assignments and active organization membership. Its migration alters `public.user_role_assignments`; the checked-in SHERIVS-017 migration that creates `role_catalog` and `user_role_assignments` explicitly says “NOT APPLIED TO PRODUCTION” (`database/supabase/migrations/20261024000240_sherivs_017_role_permission_catalog.sql:1-15,37-86`; M009 migration `20261101000010_sherivs_m009_a1_role_responsibility_engine.sql:21-36,55-61`).

**Risk:** Implementing/merging M009 without confirming its prerequisite schema and release sequence may fail in environments that lack SHERIVS-017. Applying M009 to console staff would also cross the tenant/control-plane identity boundary.

**Recommendation:** Keep platform workforce on `platform_roles` and coordinate SHERIVS-017 deployment separately; do not add a console role-assignment schema.

### SF-5 — Audit UI does not expose the complete event payload

Audit writes use the shared `writeAuditRecord()` path and SHERIVS-016 makes `audit_logs` append-only with a hash-chain bridge (`frontend/src/lib/platform-staff/staff.functions.ts:88-105`; `database/supabase/migrations/20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql:557-609`). The console reader selects `id, action, user_id, record_id, created_at, new_value`, not `old_value`, and returns a reduced event shape (`frontend/src/lib/internal-console/activity.functions.ts:58-86`).

**Risk:** Issue #197’s metrics/audit requirements call for actor, action, target, timestamp, outcome, correlation ID, and before/after. The current reader does not establish that all of those fields are presented or populated.

**Recommendation:** Compare the write schema and each mutation path to the required audit-event catalogue before claiming the full contract is satisfied.

## Verification limits

The repository records a production apply/deploy for SHERIVS-030/031/032 but also records that staff-authenticated browser verification was blocked for lack of operator credentials (`progress/internal-console/CONTROL-PLANE-V1-GAP-MATRIX.md:5,60-66`). The migration and SQL test files prove intended controls, not the current live database posture. This phase did not inspect production or validate current credentials.
