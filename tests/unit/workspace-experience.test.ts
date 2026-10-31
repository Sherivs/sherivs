import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { workspacesForViewer, parseWorkspaceId, workspaceById } from "@/lib/internal-console/workspaces";
import { roleCodesForWorkspaceProvisioning } from "@/lib/internal-console/role-workspace";
import {
  WORKSPACE_EXPERIENCES,
  experienceKeyForWorkspace,
  visibleWorkspaceNav,
} from "@/lib/internal-console/workspace-experience";
import { CONSOLE_METRIC_CONTRACTS } from "@/lib/internal-console/metrics";

const provisionSource = readFileSync(
  "frontend/src/lib/internal-console/organization.store.server.ts",
  "utf8",
);

describe("role workspace operating environments", () => {
  it("maps super-admin to Platform Operations rather than every database role", () => {
    const workspaces = workspacesForViewer({
      displayName: "Ada",
      isSuperAdmin: true,
      roles: [],
    });
    expect(workspaces.map((row) => row.id)).toEqual(["me", "role:platform_owner"]);
    expect(workspaces[1]?.name).toBe("Platform Operations");
    expect(workspaces[1]?.type).toBe("role");
    expect(roleCodesForWorkspaceProvisioning({ isSuperAdmin: true, roles: [] })).toEqual([
      "platform_owner",
    ]);
  });

  it("keeps personal workspaces private and role workspaces separate", () => {
    const workspaces = workspacesForViewer({
      displayName: "Ada",
      isSuperAdmin: false,
      roles: ["engineering"],
    });
    expect(workspaces.map((row) => row.id)).toEqual(["me", "role:engineering"]);
    expect(workspaces[1]?.name).toBe("Engineering");
    expect(
      workspaceById("role:operations", {
        displayName: "Ada",
        isSuperAdmin: false,
        roles: ["engineering"],
      }),
    ).toBeNull();
    expect(parseWorkspaceId("role:platform_owner")).toEqual({
      kind: "role",
      role: "platform_owner",
    });
    expect(parseWorkspaceId("role-platform-operations")).toEqual({
      kind: "role",
      role: "platform_owner",
    });
  });

  it("resolves each initial internal role to a dedicated experience", () => {
    expect(
      experienceKeyForWorkspace({
        id: "role:platform_owner",
        slug: "role-platform-operations",
        type: "role",
        name: "Platform Operations",
      }),
    ).toBe("platform_operations");
    expect(
      experienceKeyForWorkspace({
        id: "role:platform_admin",
        slug: "role-platform-admin",
        type: "role",
        name: "Platform Administration",
      }),
    ).toBe("platform_administration");
    expect(
      experienceKeyForWorkspace({
        id: "role:operations",
        slug: "role-operations",
        type: "role",
        name: "Operations",
      }),
    ).toBe("operations");
    expect(
      experienceKeyForWorkspace({
        id: "role:engineering",
        slug: "role-engineering",
        type: "role",
        name: "Engineering",
      }),
    ).toBe("engineering");
    expect(
      experienceKeyForWorkspace({
        id: "role:support",
        slug: "role-support",
        type: "role",
        name: "Support",
      }),
    ).toBe("support");
    expect(
      experienceKeyForWorkspace({ id: "me", slug: "me", type: "personal", name: "My Workspace" }),
    ).toBe("personal");
    expect(Object.keys(WORKSPACE_EXPERIENCES)).toEqual([
      "platform_operations",
      "platform_administration",
      "operations",
      "engineering",
      "support",
      "personal",
      "shared",
    ]);
  });

  it("hides workspace destinations the viewer cannot use", () => {
    const nav = visibleWorkspaceNav(WORKSPACE_EXPERIENCES.engineering, {
      isSuperAdmin: false,
      capabilities: new Set(["platform.engineering.read"]),
    });
    expect(nav.map((item) => item.label)).toEqual([
      "Runtime health",
      "Sherivs Scholar",
      "Metrics",
      "Logs",
      "Incidents",
      "Help",
    ]);
    expect(nav.some((item) => item.label === "Security events")).toBe(false);
  });

  it("does not write an invalid trial subscription_status during provisioning", () => {
    expect(provisionSource).not.toMatch(/subscription_status:\s*"trial"/);
    expect(provisionSource).toContain('subscription_status: "active"');
    expect(provisionSource).toContain('subscription_status: "suspended"');
  });

  it("documents the commercial subscription ledger as a payment-history count", () => {
    const metric = CONSOLE_METRIC_CONTRACTS.find((row) => row.key === "subscription-ledger");
    expect(metric?.calculation).toMatch(/count/i);
    expect(metric?.source).toMatch(/public.subscriptions/i);
  });
});
