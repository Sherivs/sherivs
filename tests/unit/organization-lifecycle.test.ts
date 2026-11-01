import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ORGANIZATION_ACCESS_EFFECTS,
  ORGANIZATION_LIFECYCLE_STATES,
  canTransitionOrganization,
  currentOnboardingStep,
  isOrganizationAssignedToStaff,
  isSupportScopedViewer,
  medianHours,
  organizationsAssignedToStaff,
  questionnaireReady,
  slugifyOrganizationName,
  summarizeOrganizationStates,
  uniqueOrganizationSlug,
} from "@/lib/internal-console/organization-lifecycle";
import {
  ROLE_WORKSPACE_MAPPINGS,
  roleCodesForWorkspaceProvisioning,
} from "@/lib/internal-console/role-workspace";
import { CONSOLE_METRIC_CONTRACTS } from "@/lib/internal-console/metrics";
import { CONSOLE_PATHS } from "@/lib/internal-console/paths";
import { isWorkingWorkspace } from "@/lib/internal-console/workspaces";

const organizationStore = readFileSync(
  "frontend/src/lib/internal-console/organization.store.server.ts",
  "utf8",
);
const overviewFunctions = readFileSync(
  "frontend/src/lib/internal-console/overview.functions.ts",
  "utf8",
);
const operationsStore = readFileSync(
  "frontend/src/lib/internal-console/operations.store.server.ts",
  "utf8",
);
const operationsScreens = readFileSync(
  "frontend/src/components/internal-console/operations-screens.tsx",
  "utf8",
);
const migration = readFileSync(
  "database/supabase/migrations/20261027002000_sherivs_031_control_plane_engines.sql",
  "utf8",
);
const phaseDMigration = readFileSync(
  "database/supabase/migrations/20261101100000_sv1_console_phase_d_org_school_link.sql",
  "utf8",
);

describe("organization lifecycle engine", () => {
  it("rejects invalid transitions rather than trusting UI buttons", () => {
    expect(canTransitionOrganization("draft", "submitted")).toBe(true);
    expect(canTransitionOrganization("draft", "active")).toBe(false);
    expect(canTransitionOrganization("submitted", "under_review")).toBe(true);
    expect(canTransitionOrganization("under_review", "provisioning")).toBe(true);
    expect(canTransitionOrganization("provisioning", "ready_for_activation")).toBe(true);
    expect(canTransitionOrganization("provisioning_failed", "provisioning")).toBe(true);
    expect(canTransitionOrganization("ready_for_activation", "active")).toBe(true);
    expect(canTransitionOrganization("active", "suspended")).toBe(true);
    expect(canTransitionOrganization("suspended", "active")).toBe(true);
    expect(canTransitionOrganization("deactivated", "active")).toBe(false);
    expect(ORGANIZATION_LIFECYCLE_STATES).toHaveLength(9);
  });

  it("requires identity, contact, and intended use before submission", () => {
    const incomplete = { displayName: "Riverside School", country: "Nigeria" };
    expect(currentOnboardingStep(incomplete)).toBe("contact");
    expect(questionnaireReady(incomplete)).toBe(false);
    const ready = {
      displayName: "Riverside School",
      country: "Nigeria",
      contactName: "Ada Admin",
      contactEmail: "ada@riverside.test",
      intendedRuntime: "scholar" as const,
    };
    expect(currentOnboardingStep(ready)).toBe("review");
    expect(questionnaireReady(ready)).toBe(true);
  });

  it("summarizes pipeline metrics without fabricating missing durations", () => {
    const summary = summarizeOrganizationStates([
      "draft",
      "submitted",
      "active",
      "active",
      "suspended",
      "provisioning_failed",
    ]);
    expect(summary.total).toBe(6);
    expect(summary.active).toBe(2);
    expect(summary.onboarding).toBe(3);
    expect(summary.suspended).toBe(1);
    expect(summary.failedProvisioning).toBe(1);
    expect(summary.conversionRate).toBeCloseTo(0.4);
    expect(medianHours([])).toBeNull();
    expect(medianHours([10, 20, 30])).toBe(20);
  });

  it("creates unique slugs without reserved names", () => {
    expect(slugifyOrganizationName("Riverside School")).toBe("riverside-school");
    expect(slugifyOrganizationName("app")).toBe("org-app");
    expect(uniqueOrganizationSlug("Riverside School", new Set(["riverside-school"]))).toBe(
      "riverside-school-2",
    );
  });

  it("defines suspension without deletion", () => {
    expect(ORGANIZATION_ACCESS_EFFECTS.suspend.data).toMatch(/retained/i);
    expect(ORGANIZATION_ACCESS_EFFECTS.deactivate.data).toMatch(/not deletion/i);
  });
});

describe("Support workspace organization scope", () => {
  const assignments = [
    { organizationId: "assigned", staffId: "support-1", status: "active" as const },
    { organizationId: "released", staffId: "support-1", status: "released" as const },
    { organizationId: "other", staffId: "support-2", status: "active" as const },
  ];

  it("limits Support-only viewers without narrowing platform operators", () => {
    expect(
      isSupportScopedViewer({
        hasSupportCapability: true,
        hasTenantManagementCapability: false,
      }),
    ).toBe(true);
    expect(
      isSupportScopedViewer({
        hasSupportCapability: true,
        hasTenantManagementCapability: true,
      }),
    ).toBe(false);
    expect(
      isSupportScopedViewer({
        isSuperAdmin: true,
        hasSupportCapability: true,
        hasTenantManagementCapability: false,
      }),
    ).toBe(false);
    expect(
      isSupportScopedViewer({
        hasSupportCapability: false,
        hasTenantManagementCapability: false,
      }),
    ).toBe(false);
  });

  it("includes only organizations with an active assignment to the current staff member", () => {
    expect(isOrganizationAssignedToStaff(assignments, "support-1")).toBe(true);
    expect(isOrganizationAssignedToStaff(assignments.slice(1), "support-1")).toBe(false);
    expect(
      organizationsAssignedToStaff(
        [{ id: "assigned" }, { id: "released" }, { id: "other" }],
        assignments,
        "support-1",
      ),
    ).toEqual([{ id: "assigned" }]);
  });

  it("enforces assignment scope on directory, detail, and overview server reads", () => {
    expect(organizationStore).toContain(
      "await loadAssignedSupportOrganizationIds(db, context.userId)",
    );
    expect(organizationStore).toContain("{ organizationIds, includePlatformMetrics: false }");
    expect(organizationStore).toContain(
      "loadAssignedSupportOrganizationIds(db, context.userId)).includes(id)",
    );
    expect(overviewFunctions).toContain("organizationMetrics = supportScoped ? emptyOrgMetrics");
    expect(overviewFunctions).toContain("if (!supportScoped)");
  });

  it("does not grant Support access to global incident details", () => {
    const listIncidents = operationsStore.slice(
      operationsStore.indexOf("export async function listIncidents"),
      operationsStore.indexOf("export async function createIncident"),
    );
    expect(listIncidents).toContain('"platform.engineering.read"');
    expect(listIncidents).toContain('"platform.operations.read"');
    expect(listIncidents).not.toContain('"platform.tenants.read"');
  });

  it("aligns the incident screen gate with server authorization and scrubs free text", () => {
    const incidentScreen = operationsScreens.slice(
      operationsScreens.indexOf("export function ConsoleIncidents"),
      operationsScreens.indexOf("export function ConsoleLogs"),
    );
    const incidentMapper = operationsStore.slice(
      operationsStore.indexOf("function mapIncident"),
      operationsStore.indexOf("export async function listTickets"),
    );
    expect(incidentScreen).not.toContain('capabilities.includes("platform.tenants.read")');
    expect(incidentScreen).toContain(
      "Operational incidents require engineering, operations, or audit capability.",
    );
    expect(incidentMapper).toContain("title: scrubString(row.title)");
    expect(incidentMapper).toContain('details: scrubString(row.details ?? "")');
  });
});

describe("role-to-workspace provisioning mapping", () => {
  it("maps presentation roles onto existing database identities", () => {
    expect(roleCodesForWorkspaceProvisioning({ isSuperAdmin: true, roles: [] })).toEqual([
      "platform_owner",
    ]);
    expect(
      roleCodesForWorkspaceProvisioning({ isSuperAdmin: false, roles: ["engineering"] }),
    ).toEqual(["engineering"]);
    expect(
      roleCodesForWorkspaceProvisioning({
        isSuperAdmin: false,
        roles: ["support", "operations"],
      }),
    ).toEqual(["operations", "support"]);
    expect(ROLE_WORKSPACE_MAPPINGS.every((row) => row.slug.startsWith("role-"))).toBe(true);
    expect(
      ROLE_WORKSPACE_MAPPINGS.find((row) => row.roleCode === "platform_owner")?.inPlatformRoles,
    ).toBe(false);
  });

  it("keeps personal workspaces private when staff.manage is present", () => {
    expect(
      isWorkingWorkspace({
        kind: "role",
        ownerId: "owner",
        viewerId: "admin",
        isMember: false,
        canManageShared: true,
      }),
    ).toBe(true);
    expect(
      isWorkingWorkspace({
        kind: "personal",
        ownerId: "owner",
        viewerId: "admin",
        isMember: false,
        canManageShared: true,
      }),
    ).toBe(false);
  });
});

describe("control-plane metric contracts", () => {
  it("documents source and calculation for every V1 metric", () => {
    for (const metric of CONSOLE_METRIC_CONTRACTS) {
      expect(metric.source.length).toBeGreaterThan(3);
      expect(metric.calculation.length).toBeGreaterThan(3);
      expect(metric.definition.length).toBeGreaterThan(12);
    }
  });
});

describe("SHERIVS-031 control-plane engines migration", () => {
  it("forces RLS and revokes client writes", () => {
    for (const table of [
      "platform_organization",
      "platform_organization_assignment",
      "platform_organization_transition",
      "platform_role_workspace",
    ]) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
    expect(migration).toContain("sync_platform_staff_workspaces");
    expect(migration).toContain("ensure_platform_role_workspace");
    expect(migration).toContain("kind IN ('shared', 'role')");
    expect(migration).toContain("lifecycle_state");
  });

  it("does not duplicate public.schools as the organization identity", () => {
    expect(migration).toContain("REFERENCES public.schools(id)");
    expect(migration).toContain("concat('sch', 'ool_id')");
    expect(migration).toContain("concat('schol', 'ar')");
    expect(migration).toContain("tenant link is set only after provisioning");
  });
});

describe("SV1-CONSOLE Phase D organization-school boundary", () => {
  it("creates and links a school once under a locked service-role transaction", () => {
    expect(phaseDMigration).toContain("SECURITY DEFINER");
    expect(phaseDMigration).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(phaseDMigration).toContain("FOR UPDATE");
    expect(phaseDMigration).toContain("v_link_column text := concat('sch', 'ool_id')");
    expect(phaseDMigration).toContain("to_jsonb(v_org)->>v_link_column IS NOT NULL");
    expect(phaseDMigration).toContain("SET %I = $1");
    expect(phaseDMigration).toContain("v_tenant_table text := concat('sch', 'ools')");
    expect(phaseDMigration).toContain("v_runtime text := concat('schol', 'ar')");
    expect(phaseDMigration).toContain("TO service_role");
    expect(phaseDMigration).toContain("FROM PUBLIC, anon, authenticated");
  });

  it("routes provisioning through the atomic RPC and preserves lifecycle auditing", () => {
    const provisioning = organizationStore.slice(
      organizationStore.indexOf("export async function provisionOrganizationCase"),
      organizationStore.indexOf("export async function activateOrganization"),
    );
    const stateTransition = organizationStore.slice(
      organizationStore.indexOf("async function applyState"),
      organizationStore.indexOf("async function assignmentsFor"),
    );
    expect(organizationStore).toContain('"provision_platform_organization_school"');
    expect(provisioning).toContain("provisionSchoolForOrganization(db, row, slug)");
    expect(provisioning).not.toContain('.from("schools")\n        .insert(');
    expect(stateTransition).toContain("await recordTransition");
    expect(stateTransition).toContain("await audit(context, `state.${toState}`");
  });
});

describe("console organization routes", () => {
  it("registers the organizations module under /console", () => {
    expect(CONSOLE_PATHS.organizations).toBe("/console/organizations");
    expect(CONSOLE_PATHS.organizationNew).toBe("/console/organizations/new");
    expect(CONSOLE_PATHS.teamRoles).toBe("/console/team/roles");
    expect(CONSOLE_PATHS.teamSuspended).toBe("/console/team/suspended");
  });
});
