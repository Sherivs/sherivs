/**
 * Sherivs global command palette and member landing — authorization-derived, not
 * role-listed.
 *
 * Laws under test:
 *  - palette commands derive from the member's resolved workspace navigation; a
 *    destination absent from that navigation is absent from the palette;
 *  - record search is offered only when its destination is authorized;
 *  - the palette component carries no role list or runtime route of its own;
 *  - sign-in lands on the home of the member's authorized workspace across every
 *    installed runtime (never a fixed runtime dashboard).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AppRole } from "@/lib/roles";
import {
  PLATFORM_DESTINATIONS,
  PREFERENCE_COMMANDS,
  authorizedDestinationForKey,
  buildPaletteCommands,
  groupCommands,
  navigationCommands,
  recordHitHref,
  searchCommands,
} from "@/lib/platform/command-registry";
import {
  ALL_NAV_CONTRIBUTIONS,
  resolveMemberWorkspaceHome,
  scholarCapabilitiesForRole,
  scholarWorkspaceHome,
} from "@/lib/runtime/nav-registry";
import { resolveWorkspaceNav, type WorkspaceNavSection } from "@/lib/workspace-engine/navigation";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

const ROLES: AppRole[] = [
  "super_admin",
  "hq",
  "admin",
  "principal",
  "teacher",
  "bursar",
  "parent",
  "student",
  "driver",
];

function sectionsFor(role: AppRole): readonly WorkspaceNavSection[] {
  return resolveWorkspaceNav(ALL_NAV_CONTRIBUTIONS, scholarCapabilitiesForRole(role));
}

function authorizedUrls(sections: readonly WorkspaceNavSection[]): Set<string> {
  return new Set(sections.flatMap((section) => section.items.map((item) => item.url)));
}

describe("Palette commands are the authorized navigation, nothing more", () => {
  for (const role of ROLES) {
    it(`${role}: every navigation command is an authorized destination`, () => {
      const sections = sectionsFor(role);
      const allowed = authorizedUrls(sections);
      const commands = navigationCommands(sections);
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect(allowed.has(command.href ?? ""), `${role} -> ${command.href}`).toBe(true);
      }
    });
  }

  it("does not offer another workspace's destinations", () => {
    const teacher = buildPaletteCommands(sectionsFor("teacher"));
    expect(teacher.some((command) => command.href === "/admin/dashboard")).toBe(false);
    expect(teacher.some((command) => command.href?.startsWith("/super-admin/"))).toBe(false);
    expect(teacher.some((command) => command.href?.startsWith("/bursar/"))).toBe(false);
    const parent = buildPaletteCommands(sectionsFor("parent"));
    expect(parent.some((command) => command.href?.startsWith("/bursar/"))).toBe(false);
  });

  it("offers no navigation commands to a member with no resolved workspace", () => {
    const commands = buildPaletteCommands([]);
    expect(commands.filter((command) => command.source !== "platform")).toEqual([]);
    expect(
      commands.filter((command) => command.kind === "navigate").map((command) => command.href),
    ).toEqual(PLATFORM_DESTINATIONS.map((destination) => destination.href));
  });

  it("deduplicates platform destinations already present in the workspace", () => {
    const sections: WorkspaceNavSection[] = [
      {
        sectionKey: "s",
        sectionLabel: "Workspace",
        runtimeRef: "runtime:test",
        iconKey: "home",
        collapsible: false,
        items: [
          {
            key: "a",
            label: "Inbox",
            iconKey: "messages",
            url: "/messages",
            orderHint: 0,
            runtimeRef: "runtime:test",
          },
          {
            key: "b",
            label: "Inbox again",
            iconKey: "messages",
            url: "/messages/",
            orderHint: 1,
            runtimeRef: "runtime:test",
          },
        ],
      },
    ];
    const commands = buildPaletteCommands(sections);
    expect(commands.filter((command) => command.href?.startsWith("/messages"))).toHaveLength(1);
    expect(commands.slice(-PREFERENCE_COMMANDS.length)).toEqual([...PREFERENCE_COMMANDS]);
  });

  it("ranks label prefix over word prefix over substring over keyword", () => {
    const commands = buildPaletteCommands(sectionsFor("admin"));
    const ranked = searchCommands(commands, "set");
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].label.toLowerCase().startsWith("set")).toBe(true);
    expect(searchCommands(commands, "zzzz-not-a-command")).toEqual([]);
    expect(searchCommands(commands, "")).toHaveLength(commands.length);
    const groups = groupCommands(commands);
    expect(groups.flatMap((group) => group.commands)).toHaveLength(commands.length);
  });
});

describe("Record search is gated by authorized navigation", () => {
  const LEARNER_KEYS = ["r001.org_admin.students"];

  it("is available to organization administrators at their authorized destination", () => {
    expect(authorizedDestinationForKey(sectionsFor("admin"), LEARNER_KEYS)).toBe("/admin/students");
  });

  it("is not offered where the destination is not authorized", () => {
    for (const role of ["teacher", "parent", "student", "driver", "bursar"] as const) {
      expect(authorizedDestinationForKey(sectionsFor(role), LEARNER_KEYS), role).toBeNull();
    }
  });

  it("opens hits at the authorized destination with an encoded record reference", () => {
    expect(recordHitHref("/admin/students", { recordRef: "a b/c", label: "X" })).toBe(
      "/admin/students?id=a%20b%2Fc",
    );
  });

  it("declares the learner search in the runtime layer as an authenticated, tenant-resolving server function", () => {
    const provider = read("frontend/src/lib/runtime/scholar-record-search.ts");
    expect(provider).toContain('navItemKeys: ["r001.org_admin.students"]');
    const serverFn = read("frontend/src/lib/runtime/scholar/learner-search.functions.ts");
    expect(serverFn).toContain(".middleware([requireSupabaseAuth])");
    expect(serverFn).toContain("requireSchoolAdminScope(context.supabase");
    expect(serverFn).toContain("learnerSearchSchema.parse(input)");
    expect(serverFn).toContain('.eq("school_id", schoolId)');
    expect(serverFn).not.toContain("supabaseAdmin");
    const registry = read("frontend/src/lib/runtime/installed-record-search.ts");
    expect(registry).toContain("INSTALLED_RECORD_SEARCH_PROVIDERS");
  });
});

describe("The palette component holds no role list or runtime route", () => {
  const palette = read("frontend/src/components/command-center/command-palette.tsx");
  const registry = read("frontend/src/lib/platform/command-registry.ts");

  it("contains no role switch, role literal or hard-coded workspace route", () => {
    for (const source of [palette, registry]) {
      expect(source).not.toMatch(/switch\s*\(\s*role\s*\)/u);
      expect(source).not.toMatch(/role\s*===/u);
      expect(source).not.toMatch(
        /"(admin|principal|teacher|parent|student|bursar|driver|hq|super_admin)"/u,
      );
      expect(source).not.toMatch(
        /"\/(admin|teacher|parent|student|bursar|driver|hq|super-admin)\//u,
      );
    }
  });

  it("is fed the same resolved sections as the sidebar", () => {
    const shell = read("frontend/src/routes/_authenticated/route.tsx");
    expect(shell).toContain("<CommandCenterMount sections={sidebarSections} />");
    expect(shell).toContain("<PortalSidebar sections={sidebarSections} />");
  });

  it("uses an accessible dialog with a title and combobox semantics", () => {
    expect(palette).toContain("<DialogTitle");
    expect(palette).toContain("CommandPrimitive.Input");
  });
});

describe("Member landing after sign-in", () => {
  it.each(ROLES)("%s lands on the home of its authorized workspace", (role) => {
    const home = resolveMemberWorkspaceHome(role);
    expect(home).toBe(scholarWorkspaceHome(role));
    expect(authorizedUrls(sectionsFor(role)).has(home)).toBe(true);
  });

  it("is resolved through the neutral helper at every landing site", () => {
    for (const file of [
      "frontend/src/routes/index.tsx",
      "frontend/src/routes/auth.tsx",
      "frontend/src/contexts/app-context.tsx",
      "frontend/src/routes/_authenticated/route.tsx",
      "frontend/src/components/role-guard.tsx",
    ]) {
      const source = read(file);
      expect(source, file).toContain("resolveMemberWorkspaceHome");
      expect(source, file).not.toContain("scholarWorkspaceHome");
    }
  });
});

describe("Internal Sherivs surfaces sit behind the control-plane boundary", () => {
  it("mounts the internal organization and provisioning simulator under super-admin", () => {
    expect(routeTreeContains("'/super-admin/platform-org'")).toBe(true);
    expect(routeTreeContains("'/super-admin/provisioning-simulator'")).toBe(true);
    expect(routeTreeContains("'/platform/org'")).toBe(false);
    expect(read("frontend/src/routes/_authenticated/super-admin/route.tsx")).toContain(
      'allow={["super_admin"]}',
    );
  });

  it("never links internal surfaces from public navigation", () => {
    const siteMap = read("frontend/src/content/sherivs/site-map.ts");
    expect(siteMap).not.toMatch(/super-admin|platform-org|provisioning/u);
  });
});

function routeTreeContains(fragment: string): boolean {
  return read("frontend/src/routeTree.gen.ts").includes(fragment);
}
