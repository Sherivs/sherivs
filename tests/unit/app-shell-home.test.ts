import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compactPersonName } from "../../frontend/src/lib/shell/display-name";
import {
  membershipInviteDecision,
  mergeAffiliations,
  shouldShowContextSwitcher,
} from "../../frontend/src/lib/shell/membership-policy";
import { composeBottomSlots, toShellNavItem } from "../../frontend/src/lib/shell/chrome";
import { APP_SHELL_AI, APP_SHELL_HOME, appShellSectionPath } from "../../frontend/src/lib/shell/paths";
import { pickSwitchTarget } from "../../frontend/src/lib/identity/memberships.functions";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("application shell greeting", () => {
  it("keeps two names compact", () => {
    expect(compactPersonName("Muhammad Ali Musa").display).toBe("Muhammad Musa");
    expect(compactPersonName("Ada").display).toBe("Ada");
  });
});

describe("membership invite law", () => {
  it("invites an existing identity into another organization instead of creating a user", () => {
    const decision = membershipInviteDecision({
      existingUserId: "user-1",
      affiliations: [{ organizationId: "org-a", role: "parent" }],
      targetOrganizationId: "org-b",
      targetRole: "teacher",
    });
    expect(decision.kind).toBe("invite_existing");
  });

  it("adds a second role in the same organization", () => {
    const decision = membershipInviteDecision({
      existingUserId: "user-1",
      affiliations: [{ organizationId: "org-a", role: "parent" }],
      targetOrganizationId: "org-a",
      targetRole: "teacher",
    });
    expect(decision.kind).toBe("add_role");
  });

  it("hides the switcher for a single affiliation", () => {
    expect(
      shouldShowContextSwitcher([
        { organizationId: "a", organizationName: "A", role: "parent", active: true },
      ]),
    ).toBe(false);
    expect(
      shouldShowContextSwitcher([
        { organizationId: "a", organizationName: "A", role: "parent", active: true },
        { organizationId: "a", organizationName: "A", role: "teacher", active: false },
      ]),
    ).toBe(true);
    expect(
      shouldShowContextSwitcher(
        mergeAffiliations([
          { organizationId: "a", organizationName: "A", role: "parent", active: true },
          { organizationId: "b", organizationName: "B", role: "parent", active: false },
        ]),
      ),
    ).toBe(true);
  });
});

describe("shell chrome", () => {
  it("pins home and AI and leaves unused middle slots empty", () => {
    const slots = composeBottomSlots([
      toShellNavItem({ key: "nav.home", label: "Home", icon: "home", to: "/workspace" }),
      toShellNavItem({ key: "nav.children", label: "Children", icon: "baby", to: "/parent/children" }),
    ]);
    expect(slots).toHaveLength(5);
    expect(slots[0]?.href).toBe(APP_SHELL_HOME);
    expect(slots[1]?.kind).toBe("role");
    expect(slots[2]?.kind).toBe("empty");
    expect(slots[3]?.kind).toBe("empty");
    expect(slots[4]?.href).toBe(APP_SHELL_AI);
    expect(appShellSectionPath("nav.children")).toBe("/home/s/nav.children");
  });

  it("picks a role-specific membership when switching", () => {
    const rows = [
      { organizationId: "a", role: "parent" },
      { organizationId: "a", role: "teacher" },
    ];
    expect(pickSwitchTarget(rows, "a", "teacher")?.role).toBe("teacher");
  });
});

describe("application shell files", () => {
  it("adds the governed /home shell without restoring deleted prototypes", () => {
    expect(existsSync(join(ROOT, "frontend/src/routes/home/route.tsx"))).toBe(true);
    expect(existsSync(join(ROOT, "frontend/src/routes/_authenticated"))).toBe(false);
    expect(existsSync(join(ROOT, "frontend/src/components/portal-shell.tsx"))).toBe(false);
    const entry = read("frontend/src/components/app-entry/app-entry-screen.tsx");
    expect(entry).toContain('to="/home"');
    expect(entry).not.toContain("_authenticated");
    expect(entry).not.toContain("portal-shell");
    const css = read("frontend/src/components/app-shell/app-shell.css");
    expect(css).toContain("width: 75vw");
    expect(css).toContain("backdrop-filter");
    const shell = read("frontend/src/components/app-shell/app-shell.tsx");
    expect(shell).toContain("app-shell-menu");
    expect(shell).toContain("Biometric and authentication");
    expect(shell).not.toContain("portal-shell");
  });
});
