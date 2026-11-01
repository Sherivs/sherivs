import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { capabilitiesForRoles } from "@/lib/platform-staff/catalogue";

const migration = readFileSync(
  "database/supabase/migrations/20261101000030_sherivs_m1_phase_b_controls.sql",
  "utf8",
);
const workspaceStore = readFileSync(
  "frontend/src/lib/internal-console/organization.store.server.ts",
  "utf8",
);
const operationsStore = readFileSync(
  "frontend/src/lib/internal-console/operations.store.server.ts",
  "utf8",
);
const identityResolver = readFileSync(
  "frontend/src/lib/identity/resolve-identity.functions.ts",
  "utf8",
);
const accessHelper = readFileSync(
  "frontend/src/lib/internal-console/console-access.server.ts",
  "utf8",
);

describe("SV1 Console Phase B controls", () => {
  it("keeps the platform administrator role scoped to staff administration", () => {
    const capabilities = capabilitiesForRoles(["platform_admin"]);
    expect(capabilities.has("platform.staff.manage")).toBe(true);
    expect(capabilities.has("platform.tenants.read")).toBe(false);
    expect(capabilities.has("platform.tenants.manage")).toBe(false);
  });

  it("keeps super-admin bypasses out of direct RPC capability checks and audits server actions", () => {
    const definition = migration
      .split("CREATE OR REPLACE FUNCTION public.has_internal_console_capability")[1]
      ?.split("$$;")[0];
    expect(definition).not.toContain("public.is_super_admin()");
    expect(definition).toContain("s.status = 'active'");
    expect(accessHelper).toContain("writeAuditRecord");
    expect(accessHelper).toContain("platform_operations.capability_bypass");
    expect(accessHelper).toContain("PLATFORM_OPERATIONS_ACTIONS");
    expect(accessHelper).toContain("auditPlatformOperationsBypass(context, capability, operation)");
  });

  it("claims invitations once, provisions in one transaction, and audits the completed claim", () => {
    const claim = migration
      .split("CREATE OR REPLACE FUNCTION public.claim_platform_staff_invite")[1]
      ?.split("CREATE OR REPLACE FUNCTION public.set_platform_staff_roles")[0];
    expect(claim).toContain("s.status = 'invited'");
    expect(claim).toContain("u.email_confirmed_at IS NOT NULL");
    expect(claim).toContain("IF v_count = 0 THEN");
    expect(claim).toContain("public.ensure_platform_personal_workspace(auth.uid())");
    expect(claim).toContain("public.sync_platform_staff_workspaces(auth.uid())");
    expect(claim).toContain("'platform_staff.invite.claim'");
  });

  it("reconciles roles atomically and leaves personal workspace records intact", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.set_platform_staff_roles");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("PERFORM public.sync_platform_staff_workspaces(p_staff_id)");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.set_platform_staff_roles");
    expect(migration).toContain("WHEN 'security' THEN 'platform_admin'");
    expect(migration).toContain("WHEN 'finance' THEN 'operations'");
    expect(migration).toContain("WHEN 'sales' THEN 'operations'");
    expect(migration).toContain("public.ensure_platform_personal_workspace(p_user_id)");
  });

  it("enforces active, private, and assignment-scoped reads at RLS and server boundaries", () => {
    expect(migration).toContain("public.is_platform_staff()");
    expect(migration).toContain("NOT public.is_super_admin()");
    expect(migration).toContain("a.assignment_type = 'support'");
    expect(migration).toContain(
      "public.has_internal_console_capability('platform.support.handle')",
    );
    expect(migration).toContain("user_id = auth.uid()");
    expect(workspaceStore).toContain("loadAssignedSupportOrganizationIds");
    expect(workspaceStore).toContain("operationsSummary");
    expect(operationsStore).toContain("assertAssignedOrganization");
    expect(operationsStore).toContain("supportOrganizationScope");
    expect(identityResolver).toContain(
      'if (staff.status !== "active") throw new Error("Not authorized")',
    );
  });

  it("includes the local SQL proof for replay, suspension, support scope, and privacy", () => {
    const sql = readFileSync("tests/sql/phase-b-workspace-authorization.sql", "utf8");
    expect(sql).toContain("replayed invitation claim is a no-op");
    expect(sql).toContain("suspended staff cannot read own workspace");
    expect(sql).toContain("support reads only its assigned org");
    expect(sql).toContain("admin cannot read another personal workspace");
    expect(sql).toContain("platform operator cannot use a direct operations bypass");
  });
});
