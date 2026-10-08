/**
 * Post-authentication destination — resolved from context, never defaulted.
 *
 * LAW: Authentication must resolve the user's actual context.
 *      Never LOGIN → <runtime> by default.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAuthenticatedDestination } from "@/lib/experience/destination";
import {
  ALL_NAV_CONTRIBUTIONS,
  authenticatedDestinationForRole,
  authenticatedHomeForRole,
  installedCapabilitiesForRole,
} from "@/lib/runtime/nav-registry";
import type { NavContribution } from "@/lib/workspace-engine/navigation";
import type { AppRole } from "@/lib/roles";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

const CONTRIBUTIONS: readonly NavContribution[] = [
  {
    runtimeRef: "runtime:test",
    sectionKey: "ops",
    sectionLabel: "Operations",
    items: [
      { key: "home", label: "Home", iconKey: "home", url: "/ops", capabilities: ["ops.view"], orderHint: 0 },
      { key: "reports", label: "Reports", iconKey: "chart", url: "/ops/reports", capabilities: ["ops.reports"], orderHint: 1 },
    ],
  },
];

describe("resolveAuthenticatedDestination (platform contract)", () => {
  it("anonymous sessions resolve to anonymous", () => {
    expect(
      resolveAuthenticatedDestination({
        authenticated: false,
        linked: false,
        contributions: CONTRIBUTIONS,
        capabilities: new Set(["ops.view"]),
      }),
    ).toEqual({ kind: "anonymous" });
  });

  it("authenticated but unlinked identities resolve to unlinked, never to a workspace", () => {
    expect(
      resolveAuthenticatedDestination({
        authenticated: true,
        linked: false,
        contributions: CONTRIBUTIONS,
        capabilities: new Set(["ops.view"]),
      }),
    ).toEqual({ kind: "unlinked" });
  });

  it("linked identities with no authorized destination resolve to unlinked (no guessing)", () => {
    expect(
      resolveAuthenticatedDestination({
        authenticated: true,
        linked: true,
        contributions: CONTRIBUTIONS,
        capabilities: new Set(),
      }),
    ).toEqual({ kind: "unlinked" });
  });

  it("linked identities land on the authorized home item", () => {
    expect(
      resolveAuthenticatedDestination({
        authenticated: true,
        linked: true,
        contributions: CONTRIBUTIONS,
        capabilities: new Set(["ops.view", "ops.reports"]),
      }),
    ).toEqual({ kind: "workspace", path: "/ops" });
  });

  it("falls back to the first authorized item when no home is authorized", () => {
    expect(
      resolveAuthenticatedDestination({
        authenticated: true,
        linked: true,
        contributions: CONTRIBUTIONS,
        capabilities: new Set(["ops.reports"]),
      }),
    ).toEqual({ kind: "workspace", path: "/ops/reports" });
  });
});

describe("authenticatedDestinationForRole (runtime layer adapter)", () => {
  it("resolves every installed membership kind to a destination inside its own contributions", () => {
    const roles: AppRole[] = ["super_admin", "admin", "teacher", "student", "parent", "bursar", "driver"];
    const allUrls = new Set(ALL_NAV_CONTRIBUTIONS.flatMap((c) => c.items.map((i) => i.url)));
    for (const role of roles) {
      const destination = authenticatedDestinationForRole(role);
      expect(destination.kind, role).toBe("workspace");
      if (destination.kind === "workspace") {
        expect(allUrls.has(destination.path), `${role} → ${destination.path}`).toBe(true);
        expect(authenticatedHomeForRole(role)).toBe(destination.path);
      }
      expect(installedCapabilitiesForRole(role).size).toBeGreaterThan(0);
    }
  });

  it("a missing role is unlinked and the home falls back to the platform root", () => {
    expect(authenticatedDestinationForRole(null)).toEqual({ kind: "unlinked" });
    expect(authenticatedHomeForRole(null)).toBe("/");
  });

  it("different membership kinds do not all collapse onto one runtime surface", () => {
    const homes = new Set(
      (["admin", "teacher", "student", "parent"] as AppRole[]).map((role) => authenticatedHomeForRole(role)),
    );
    expect(homes.size).toBeGreaterThan(1);
  });
});

describe("Auth and root surfaces consume the resolver", () => {
  it("auth, index and the authenticated shell no longer hardcode a runtime home", () => {
    for (const file of [
      "frontend/src/routes/auth.tsx",
      "frontend/src/routes/index.tsx",
      "frontend/src/routes/_authenticated/route.tsx",
      "frontend/src/components/role-guard.tsx",
      "frontend/src/contexts/app-context.tsx",
    ]) {
      const text = read(file);
      expect(text, file).not.toContain("scholarWorkspaceHome(");
      expect(text, file).toMatch(/authenticated(Destination|Home)ForRole\(/);
    }
  });
});
