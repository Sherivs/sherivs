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
import { composeActivity } from "../../frontend/src/lib/shell/activity";
import { SHELL_ACCOUNT_NAV } from "../../frontend/src/lib/shell/account";
import {
  compactBottomLabel,
  composeBottomSlots,
  composeHomeSections,
  composeSidePanel,
} from "../../frontend/src/lib/shell/chrome";
import {
  BIOMETRIC_PASKEY_STEPS,
  GOOGLE_PROVIDER_STEPS,
  PUSH_DEVICE_STEPS,
} from "../../frontend/src/lib/shell/auth-setup";
import { fallbackManifest } from "../../frontend/src/lib/shell/fallback-manifest";
import { formatWidgetMetric } from "../../frontend/src/lib/shell/metrics";
import { APP_SHELL_AI, APP_SHELL_HOME, APP_SHELL_PROFILE, appShellSectionPath } from "../../frontend/src/lib/shell/paths";
import { pickSwitchTarget } from "../../frontend/src/lib/identity/memberships.functions";
import type { AppRole } from "../../frontend/src/lib/roles";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const ORG = "11111111-1111-1111-1111-111111111111";

function manifestFor(role: AppRole) {
  return fallbackManifest({
    organizationId: ORG,
    organizationName: "ThinkTech Organization",
    role,
  });
}

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
      affiliations: [{ organizationId: "org-a", role: "teacher" }],
      targetOrganizationId: "org-b",
      targetRole: "bursar",
    });
    expect(decision.kind).toBe("invite_existing");
  });

  it("adds a second role in the same organization", () => {
    const decision = membershipInviteDecision({
      existingUserId: "user-1",
      affiliations: [{ organizationId: "org-a", role: "teacher" }],
      targetOrganizationId: "org-a",
      targetRole: "admin",
    });
    expect(decision.kind).toBe("add_role");
  });

  it("hides the switcher for a single affiliation", () => {
    expect(
      shouldShowContextSwitcher([
        { organizationId: "a", organizationName: "A", role: "teacher", active: true },
      ]),
    ).toBe(false);
    expect(
      shouldShowContextSwitcher([
        { organizationId: "a", organizationName: "A", role: "teacher", active: true },
        { organizationId: "a", organizationName: "A", role: "admin", active: false },
      ]),
    ).toBe(true);
    expect(
      shouldShowContextSwitcher(
        mergeAffiliations([
          { organizationId: "a", organizationName: "A", role: "teacher", active: true },
          { organizationId: "b", organizationName: "B", role: "teacher", active: false },
        ]),
      ),
    ).toBe(true);
  });
});

describe("shell chrome", () => {
  it("pins home and AI and fills three role-priority slots from widgets", () => {
    const slots = composeBottomSlots({
      widgets: [
        { key: "w.today_classes", label: "Today's lessons", icon: "calendar", to: "/teacher/timetable" },
        { key: "w.attendance_todo", label: "Registers to mark", icon: "check-square", to: "/teacher/attendance" },
        { key: "w.announcements", label: "Announcements", icon: "megaphone", to: "/messages" },
        { key: "w.grading_queue", label: "Scores to enter", icon: "clipboard", to: "/teacher/gradebook" },
      ],
      nav: [{ key: "nav.home", label: "Home", icon: "home", to: "/workspace" }],
    });
    expect(slots).toHaveLength(5);
    expect(slots[0]?.href).toBe(APP_SHELL_HOME);
    expect(slots[1]?.key).toBe("w.today_classes");
    expect(slots[2]?.key).toBe("w.attendance_todo");
    expect(slots[3]?.key).toBe("w.grading_queue");
    expect(slots[4]?.href).toBe(APP_SHELL_AI);
    expect(compactBottomLabel("Registers to mark")).toBe("Registers");
    expect(appShellSectionPath("w.today_classes")).toBe("/home/s/w.today_classes");
  });

  it("picks a role-specific membership when switching", () => {
    const rows = [
      { organizationId: "a", role: "teacher" },
      { organizationId: "a", role: "admin" },
    ];
    expect(pickSwitchTarget(rows, "a", "admin")?.role).toBe("admin");
  });
});

describe("role-dynamic home", () => {
  it("builds teacher widgets, news, drawer, and bottom slots from the catalog", () => {
    const manifest = manifestFor("teacher");
    const home = composeHomeSections(manifest);
    const drawer = composeSidePanel(manifest);
    const bottom = composeBottomSlots(manifest);
    expect(home.widgets.map((row) => row.key)).toEqual(
      expect.arrayContaining(["w.today_classes", "w.attendance_todo", "w.grading_queue"]),
    );
    expect(home.widgets.some((row) => row.key === "w.announcements")).toBe(false);
    expect(home.news.some((row) => /announce/i.test(row.key + row.label))).toBe(true);
    expect(home.actions.some((row) => row.key === "a.take_attendance")).toBe(true);
    expect(drawer.length).toBeGreaterThan(3);
    expect(bottom[1]?.key).toBe("w.today_classes");
    expect(bottom[2]?.key).toBe("w.attendance_todo");
    expect(bottom[3]?.key).toBe("w.grading_queue");
  });

  it("gives bursar and admin their own priority sections", () => {
    const bursar = composeBottomSlots(manifestFor("bursar"));
    const admin = composeBottomSlots(manifestFor("admin"));
    expect(bursar[1]?.key).toBe("w.fee_collection");
    expect(admin[1]?.key).toBe("w.school_health");
    expect(bursar[1]?.key).not.toBe(admin[1]?.key);
  });

  it("keeps account items under the portrait and formats live metrics only", () => {
    expect(SHELL_ACCOUNT_NAV[0]?.href).toBe(APP_SHELL_PROFILE);
    expect(SHELL_ACCOUNT_NAV.map((row) => row.label)).toEqual([
      "Profile",
      "Settings",
      "Biometric and authentication",
      "Help and support",
    ]);
    expect(formatWidgetMetric({ metric: 2 }).text).toBe("2");
    expect(formatWidgetMetric({ metric: "98.6%", money: false }).tone).toBe("green");
    expect(formatWidgetMetric(undefined).text).toBe("—");
  });

  it("composes activity from inbox and never invents Digital Twin events", () => {
    const items = composeActivity({
      inbox: [{ key: "in.alerts", label: "Alerts", icon: "bell" }],
      cards: {},
    });
    expect(items[0]?.title).toBe("Alerts");
    expect(JSON.stringify(items)).not.toMatch(/digital twin/i);
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
    expect(css).toContain("app-shell-sheet");
    const shell = read("frontend/src/components/app-shell/app-shell.tsx");
    expect(shell).toContain("app-shell-menu");
    expect(shell).toContain("SHELL_ACCOUNT_NAV");
    expect(shell).not.toContain("portal-shell");
    const home = read("frontend/src/components/app-shell/home-screen.tsx");
    expect(home).toContain("Quick actions");
    expect(home).toContain("News and announcements");
    expect(home).toContain("shell.clock");
    expect(home).not.toContain("Digital Twin");
    expect(GOOGLE_PROVIDER_STEPS[1]).toMatch(/Google/);
    expect(BIOMETRIC_PASKEY_STEPS[1]).toMatch(/WebAuthn/);
    expect(PUSH_DEVICE_STEPS[1]).toMatch(/Enable push/);
    const notifications = read("frontend/src/components/app-shell/account-screens.tsx");
    expect(notifications).toContain("push-enable");
    expect(notifications).toContain("sendTestPush");
    expect(notifications).toContain("registerPushSubscription");
    expect(notifications).toContain("app-shell-push-actions");
    expect(read("frontend/src/components/app-shell/app-shell.css")).toContain("app-shell-push-actions");
    const chrome = read("frontend/src/components/app-shell/app-shell.tsx");
    expect(chrome).toContain("refreshPushTokenIfGranted");
  });
});
