/**
 * CoreGrid — workspace landing derivation tests.
 *
 * The legacy `dashboardPathForRole` role-switch was removed (de-hardcoding
 * wave-4). Post-login landings are now derived from workspace chrome:
 * Scholar R-001 contributions × authorized capabilities → home item.
 * These tests pin the observable behaviour the legacy redirects provided so
 * no consumer regresses.
 */
import { describe, expect, it } from "vitest";
import type { AppRole } from "../../frontend/src/lib/roles";
import { scholarWorkspaceHome, scholarWorkspaceLabelForRole } from "@/lib/runtime/nav-registry";

describe("workspace landing derivation (formerly dashboardPathForRole)", () => {
  const cases: Array<[AppRole, string]> = [
    ["super_admin", "/super-admin/dashboard"],
    ["hq", "/hq/dashboard"],
    ["admin", "/admin/dashboard"],
    ["principal", "/admin/dashboard"],
    ["teacher", "/teacher/dashboard"],
    ["bursar", "/bursar/dashboard"],
    ["parent", "/parent/dashboard"],
    ["student", "/student/dashboard"],
    ["driver", "/driver/dashboard"],
  ];

  it.each(cases)("resolves the workspace home for %s -> %s", (role, path) => {
    expect(scholarWorkspaceHome(role)).toBe(path);
  });

  it("has a display label for every membership kind that resolves to a workspace", () => {
    for (const [role] of cases) {
      expect(scholarWorkspaceLabelForRole(role)).toBeTruthy();
      expect(scholarWorkspaceHome(role).startsWith("/")).toBe(true);
    }
  });

  it("redirects when a user's role changes (realtime bounce lands on the new home)", () => {
    const before = scholarWorkspaceHome("admin");
    const after = scholarWorkspaceHome("teacher");
    expect(before).not.toBe(after);
    expect(after).toBe("/teacher/dashboard");
  });

  it("keeps principals on the org-admin workspace (shared admin chrome)", () => {
    expect(scholarWorkspaceHome("principal")).toBe(scholarWorkspaceHome("admin"));
  });
});
