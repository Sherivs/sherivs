import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compactPersonName } from "../../frontend/src/lib/shell/display-name";
import {
  membershipInviteDecision,
  mergeAffiliations,
  shouldShowContextSwitcher,
  affiliationForOrganization,
  organizationOptions,
  rolesForOrganization,
} from "../../frontend/src/lib/shell/membership-policy";
import { composeActivity } from "../../frontend/src/lib/shell/activity";
import { SHELL_ACCOUNT_NAV } from "../../frontend/src/lib/shell/account";
import {
  compactBottomLabel,
  composeBottomSlots,
  composeHomeSections,
  composeSidePanel,
  homeHrefForScope,
  toShellNavItem,
} from "../../frontend/src/lib/shell/chrome";
import {
  BIOMETRIC_PASKEY_STEPS,
  GOOGLE_PROVIDER_STEPS,
  PUSH_DEVICE_STEPS,
} from "../../frontend/src/lib/shell/auth-setup";
import { fallbackManifest } from "../../frontend/src/lib/shell/fallback-manifest";
import { focusScope } from "../../frontend/src/lib/sherivs-ws/engine";
import { formatWidgetMetric } from "../../frontend/src/lib/shell/metrics";
import { rankByUsage, shellUsageStorageKey } from "../../frontend/src/lib/shell/usage";
import {
  APP_SHELL_AI,
  APP_SHELL_HOME,
  APP_SHELL_PROFILE,
  appShellSectionPath,
} from "../../frontend/src/lib/shell/paths";
import { pickSwitchTarget } from "../../frontend/src/lib/identity/memberships.functions";
import type { AppRole } from "../../frontend/src/lib/roles";
import {
  assistantProposalIsDenied,
  assistantProposalRequiresPasskey,
  createAssistantClient,
} from "../../frontend/src/lib/assistant/assistant-client";
import { assistantPersonaForRole } from "../../frontend/src/lib/assistant/assistant-persona";

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

describe("role-aware assistant boundary", () => {
  it("uses a role persona and falls back for unknown roles", () => {
    expect(assistantPersonaForRole("teacher")).toBe("My Teaching Assistant");
    expect(assistantPersonaForRole("student")).toBe("My Learning Companion");
    expect(assistantPersonaForRole("platform_owner")).toBe("My Platform Assistant");
    expect(assistantPersonaForRole("unknown")).toBe("My Assistant");
  });

  it("reports unavailable when no chat transport is connected", async () => {
    const client = createAssistantClient();
    await expect(client.send({ message: "Show my schedule", attachments: [] })).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("keeps T3 proposals behind human passkey approval and denies T4", () => {
    expect(
      assistantProposalRequiresPasskey({ id: "p1", summary: "Change access", riskTier: "T3" }),
    ).toBe(true);
    expect(
      assistantProposalRequiresPasskey({ id: "p2", summary: "Read a report", riskTier: "T1" }),
    ).toBe(false);
    expect(assistantProposalIsDenied({ id: "p3", summary: "Delete records", riskTier: "T4" })).toBe(
      true,
    );
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

  it("keeps role and organization choices limited to active memberships", () => {
    const affiliations = [
      { organizationId: "a", organizationName: "A", role: "teacher" as const, active: true },
      { organizationId: "a", organizationName: "A", role: "admin" as const, active: false },
      { organizationId: "b", organizationName: "B", role: "teacher" as const, active: false },
    ];

    expect(organizationOptions(affiliations)).toEqual([
      { organizationId: "a", organizationName: "A" },
      { organizationId: "b", organizationName: "B" },
    ]);
    expect(rolesForOrganization(affiliations, "a")).toEqual(["teacher", "admin"]);
    expect(affiliationForOrganization(affiliations, "b", "teacher")).toBe(affiliations[2]);
    expect(affiliationForOrganization(affiliations, "b", "admin")).toBe(affiliations[2]);
    expect(affiliationForOrganization(affiliations, "missing", "teacher")).toBeNull();
  });

  it("isolates usage history by identity, organization, and active role", () => {
    const scope = { userId: "user-a", organizationId: "org-a", role: "teacher" };
    expect(shellUsageStorageKey(scope)).not.toBe(
      shellUsageStorageKey({ ...scope, organizationId: "org-b" }),
    );
    expect(shellUsageStorageKey(scope)).not.toBe(shellUsageStorageKey({ ...scope, role: "admin" }));
    expect(shellUsageStorageKey({ ...scope, userId: "user-b" })).not.toBe(
      shellUsageStorageKey(scope),
    );
    expect(shellUsageStorageKey({ ...scope, role: "" })).toBeNull();
  });
});

describe("shell chrome", () => {
  it("pins home and Assistant and fills three role-priority slots from manifest widgets", () => {
    const slots = composeBottomSlots({
      widgets: [
        {
          key: "w.today_classes",
          label: "Today's lessons",
          icon: "calendar",
          to: "/teacher/timetable",
        },
        {
          key: "w.attendance_todo",
          label: "Registers to mark",
          icon: "check-square",
          to: "/teacher/attendance",
        },
        { key: "w.announcements", label: "Announcements", icon: "megaphone", to: "/messages" },
        {
          key: "w.grading_queue",
          label: "Scores to enter",
          icon: "clipboard",
          to: "/teacher/gradebook",
        },
      ],
      nav: [
        { key: "nav.home", label: "Home", icon: "home", to: "/workspace" },
        { key: "nav.classes", label: "Classes", icon: "class", to: "/classes" },
        { key: "nav.attendance", label: "Attendance", icon: "attendance", to: "/attendance" },
        { key: "nav.grades", label: "Grades", icon: "grades", to: "/grades" },
      ],
    });
    expect(slots).toHaveLength(5);
    expect(slots[0]?.href).toBe(APP_SHELL_HOME);
    expect(slots[1]?.key).toBe("w.today_classes");
    expect(slots[2]?.key).toBe("w.attendance_todo");
    expect(slots[3]?.key).toBe("w.grading_queue");
    expect(slots[4]?.href).toBe(APP_SHELL_AI);
    expect(slots[4]?.label).toBe("Assistant");
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

  it("preserves validated assigned-scope context on workspace links", () => {
    expect(
      toShellNavItem({
        key: "w.today_classes",
        label: "Today's lessons",
        icon: "calendar",
        to: "/teacher/timetable?scope=campus%3Anorth",
      }).href,
    ).toBe("/home/s/w.today_classes?scope=campus%3Anorth");
    expect(
      toShellNavItem({
        key: "nav.home",
        label: "Home",
        icon: "home",
        to: "/workspace?scope=campus%3Anorth",
      }).href,
    ).toBe("/home?scope=campus%3Anorth");
    expect(homeHrefForScope({ dim: "campus", ref: "north" })).toBe("/home?scope=campus%3Anorth");
    expect(homeHrefForScope(null)).toBe("/home");
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
    expect(bottom.slice(1, 4).map((slot) => slot.key)).toEqual([
      "w.today_classes",
      "w.attendance_todo",
      "w.grading_queue",
    ]);
  });

  it("gives bursar and admin their own priority sections", () => {
    const bursar = composeBottomSlots(manifestFor("bursar"));
    const admin = composeBottomSlots(manifestFor("admin"));
    expect(bursar[1]?.key).toBe("w.fee_collection");
    expect(admin[1]?.key).toBe("w.school_health");
    expect(bursar[1]?.key).not.toBe(admin[1]?.key);
  });

  it("generates different teacher homes from different authorized manifests", () => {
    const manifest = manifestFor("teacher");
    const [first, second] = manifest.widgets;
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const firstTeacher = composeHomeSections({
      ...manifest,
      widgets: [first!],
      nav: [],
      actions: [],
      inbox: [],
    });
    const secondTeacher = composeHomeSections({
      ...manifest,
      widgets: [second!],
      nav: [],
      actions: [],
      inbox: [],
    });

    expect(firstTeacher.widgets.map((item) => item.key)).toEqual([first!.key]);
    expect(secondTeacher.widgets.map((item) => item.key)).toEqual([second!.key]);
    expect(firstTeacher.widgets[0]?.key).not.toBe(secondTeacher.widgets[0]?.key);
  });

  it("fills four quick actions and up to eight add-on cards from the authorized manifest by usage", () => {
    const items = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        key: `${prefix}.${index + 1}`,
        label: `${prefix} ${index + 1}`,
        icon: "calendar",
        to: `/${prefix}/${index + 1}`,
      }));
    const actions = items("action", 5);
    const nav = items("section", 4);
    const available = items("addon", 3);
    const home = composeHomeSections({
      widgets: [items("widget", 1)[0]!],
      actions,
      nav,
      available,
      usage: { "section.2": 10, "action.3": 5 },
    });

    expect(home.actions).toHaveLength(4);
    expect(home.actions.map((item) => item.key)).toEqual([
      "section.2",
      "action.3",
      "action.1",
      "action.2",
    ]);
    expect(home.cards).toHaveLength(8);
    expect(home.cards.map((item) => item.key)).toContain("addon.1");
    expect(home.cards.map((item) => item.key)).not.toContain("widget.1");
  });

  it("does not pad quick actions or add-on cards beyond authorized manifest items", () => {
    const home = composeHomeSections({
      actions: [
        { key: "action.attendance", label: "Attendance", icon: "check", to: "/attendance" },
      ],
      nav: [{ key: "section.classes", label: "Classes", icon: "class", to: "/classes" }],
    });

    expect(home.actions.map((item) => item.key)).toEqual(["action.attendance", "section.classes"]);
    expect(home.cards).toEqual([]);
  });

  it("keeps focused scope on generated add-on and inbox routes", () => {
    const manifest = manifestFor("teacher");
    const focused = focusScope(
      {
        ...manifest,
        scopeOptions: { campus: ["north"] },
        available: [
          { ...manifest.widgets[0]!, key: "w.campus_addon", scopeDims: { campus: ["north"] } },
          { ...manifest.widgets[0]!, key: "w.shift_addon", scopeDims: { shift: ["day"] } },
        ],
        inbox: [{ ...manifest.widgets[0]!, key: "i.messages" }],
      },
      { dim: "campus", ref: "north" },
    );

    expect(focused.available.map((item) => item.key)).toEqual(["w.campus_addon"]);
    expect(focused.available[0]?.to).toContain("?scope=campus%3Anorth");
    expect(focused.inbox[0]?.to).toContain("?scope=campus%3Anorth");
  });

  it("ranks only authorized home items by scoped usage while preserving default order on ties", () => {
    const items = [
      { key: "w.schedule", label: "Schedule" },
      { key: "w.attendance", label: "Attendance" },
      { key: "w.grades", label: "Grades" },
    ];
    expect(rankByUsage(items, { "w.grades": 4, "w.attendance": 2 })).toEqual([
      items[2],
      items[1],
      items[0],
    ]);
    expect(rankByUsage(items, {})).toEqual(items);
    expect(rankByUsage(items.slice(0, 2), { "w.grades": 99 })).toEqual(items.slice(0, 2));
  });

  it("keeps account items under the portrait and formats live metrics only", () => {
    expect(SHELL_ACCOUNT_NAV[0]?.href).toBe(APP_SHELL_PROFILE);
    expect(SHELL_ACCOUNT_NAV.map((row) => row.label)).toEqual([
      "Profile",
      "Settings",
      "Biometric and authentication",
      "Help and support",
      "Communications",
    ]);
    expect(formatWidgetMetric({ metric: 2 }).text).toBe("2");
    expect(formatWidgetMetric({ metric: "98.6%", money: false }).tone).toBe("green");
    expect(formatWidgetMetric(undefined).text).toBe("No data yet");
    expect(formatWidgetMetric({ unavailable: true }).text).toBe("Unavailable");
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
    expect(shell).toContain('aria-label="Active role"');
    expect(shell).toContain('aria-label="Active organization"');
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
    expect(read("frontend/src/components/app-shell/app-shell.css")).toContain(
      "app-shell-push-actions",
    );
    const chrome = read("frontend/src/components/app-shell/app-shell.tsx");
    expect(chrome).toContain("refreshPushTokenIfGranted");
  });
});
