# Internal Console Security Findings

**Version target:** V1 organizational capability envelope.

**Assessment type:** source and repository-evidence review only; no production database, credentials, or live staff session was accessed. No behavior changes are made by this document.

## Positive controls observed

1. **Capability checks are server-side.** `has_platform_capability()` checks active platform staff role capabilities and retains the super-admin authority; protected staff and organization operations call it server-side (`database/supabase/migrations/20261020000150_sherivs_008_platform_staff.sql:67-83`; `frontend/src/lib/platform-staff/staff.functions.ts:45-60`; `frontend/src/lib/internal-console/organization.store.server.ts:83-95`).
2. **Super-admin self-claim is constrained.** SHERIVS-007 removes client INSERT/DELETE and limits client profile updates; the only supported creation path is service-role/operator provision (`database/supabase/migrations/20261020000140_sherivs_007_lock_super_admins.sql:12-35`; `tests/unit/super-admin-no-self-claim.test.ts`).
3. **Workspace records are not grants.** SHERIVS-030/031 force RLS on workspace tables and grant authenticated users SELECT, not writes; role/workspace membership is explicitly not authorization (`database/supabase/migrations/20261027001000_sherivs_030_internal_console.sql:240-304`; `database/supabase/migrations/20261027002000_sherivs_031_control_plane_engines.sql:9-13,484-506`).
4. **Organization cases are distinct from tenant records.** The SHERIVS-031 case may link to `public.schools` after provisioning; assignments are not tenant membership (`database/supabase/migrations/20261027002000_sherivs_031_control_plane_engines.sql:7-14,379-400`).
5. **Sensitive support reads are grant-checked and audited.** The support summary first checks `has_support_access(school)`, returns only school metadata and member count, and writes success/failure audit events (`frontend/src/lib/platform-staff/support-access.functions.ts:178-220`; `database/supabase/migrations/20261020000160_sherivs_009_support_access.sql:13-50`).
6. **Health and metric claims are bounded.** Missing storage/integration checks are shown as Unknown/not configured, and the health code warns that process health does not prove all workflows work (`frontend/src/lib/internal-console/overview.functions.ts:160-227`; `frontend/src/lib/internal-console/metrics.ts:1-17`).

## Findings requiring follow-up

### SF-1 — Super-admin authority is a global capability bypass

`has_platform_capability(p_capability)` returns true for `is_super_admin()` before checking any named staff role. Therefore `platform_owner` is not a least-privilege role with a dedicated capability list; it represents the existing global control-plane authority (`database/supabase/migrations/20261020000150_sherivs_008_platform_staff.sql:74-83`; `frontend/src/lib/internal-console/role-workspace.ts:22-30,95-105`).

**Risk:** Treating the Platform Operations workspace label as a scoped authorization boundary would misrepresent current authority and may conflict with the V1 requirement to avoid unrestricted school records.

**Recommendation:** Preserve the existing super-admin source; inventory every super-admin-gated endpoint and explicitly decide what aggregate/record-level access this V1 workspace needs before extending it. Do not implement a new `platform_owner` capability role here.

### SF-2 — Navigation and role labels are not enforcement

Presentation role selection chooses one UI label, while capability calculation unions all assigned platform roles. `navVisible()` and `quickActionsFor()` filter UI only; server functions must independently enforce capability/AAL2 checks (`frontend/src/lib/internal-console/roles.ts:34-53,255-276,352-380`; `frontend/src/lib/platform-staff/catalogue.ts:61-66`; `frontend/src/lib/platform-staff/staff.functions.ts:45-60`).

**Risk:** A visible/hidden navigation item cannot establish that an API call is authorized, and one displayed role may conceal other effective role grants.

**Recommendation:** Keep the existing database checks authoritative. When documenting the six workspaces, show all assigned identifiers and effective capabilities, not only the selected presentation label.

### SF-3 — Support organization scope is broader than assignment

Issue #197’s Support workspace requirement limits support to assigned organizations. Current `listOrganizationDirectory()` checks `platform.tenants.read`, loads all organization rows through the service-role client, and returns summaries without filtering by the caller’s assignments. SHERIVS-031 also permits `platform.tenants.read` to select all `platform_organization` cases (`frontend/src/lib/internal-console/organization.store.server.ts:348-381`; `database/supabase/migrations/20261027002000_sherivs_031_control_plane_engines.sql:508-524`). The detail path redacts questionnaire contact unless the caller created or is assigned the case (or has `platform.tenants.manage`), but it still returns other case details and assignments (`organization.store.server.ts:384-448`).

**Risk:** This is broader than the “assigned orgs only” boundary if organization summaries/lifecycle details are considered restricted; UI visibility is not an authorization boundary.

**Recommendation:** Record as an authorization gap for Phase B+ review. Decide which case fields are safe for all `platform.tenants.read` users and enforce assignment-scoped reads on the server/database for fields outside that approved aggregate. No change was made in this docs-only phase.

### SF-4 — M009-A1 is tenant-scoped; the production prerequisite is unresolved

Draft PR #196 builds the M009-A1 contract over tenant-scoped role assignments and active organization membership. Its migration alters `public.user_role_assignments`; the checked-in SHERIVS-017 migration that creates `role_catalog` and `user_role_assignments` explicitly says “NOT APPLIED TO PRODUCTION” (`database/supabase/migrations/20261024000240_sherivs_017_role_permission_catalog.sql:1- 15,37-86`; draft PR #196 migration `20261101000010_sherivs_m009_a1_role_responsibility_engine.sql:21-36,55-61`).

**Risk:** Implementing/merging M009 without confirming its prerequisite schema and release sequence may fail in environments that lack SHERIVS-017. Applying M009 to console staff would also cross the tenant/control-plane identity boundary.

**Recommendation:** Coordinate the SHERIVS-017 prerequisite and shared contract with #176/#196 before deployment; do not add a separate console role-assignment schema.

### SF-5 — Audit UI does not expose the complete event payload

Audit writes use the shared `writeAuditRecord()` path and SHERIVS-016 makes `audit_logs` append-only with a hash-chain bridge (`frontend/src/lib/platform-staff/staff.functions.ts:88-105`; `database/supabase/migrations/20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql:557-609`). The console reader selects `id, action, user_id, record_id, created_at, new_value`, not `old_value`, and returns a reduced event shape (`frontend/src/lib/internal-console/activity.functions.ts:58-86`).

**Risk:** Issue #197’s metrics/audit requirements call for actor, action, target, timestamp, outcome, correlation ID, and before/after. The current reader does not establish that all of those fields are presented or populated.

**Recommendation:** Compare the write schema and each mutation path to the required audit-event catalogue before claiming the full contract is satisfied.

## Verification limits

The repository records a production apply/deploy for SHERIVS-030/031/032 but also records that staff-authenticated browser verification was blocked for lack of operator credentials (`progress/internal-console/CONTROL-PLANE-V1-GAP-MATRIX.md:5,60-66`). The migration and SQL test files prove intended controls, not the current live database posture. This phase did not inspect production or validate current credentials.
