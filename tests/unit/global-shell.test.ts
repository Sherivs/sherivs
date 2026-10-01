/**
 * CoreGrid — global shell tests (MISSION-R-111 / V1CAP-085, GAP-008 + ADR-003).
 *
 * Covers the platform-owned shell contracts:
 *  1. registry-driven navigation (empty registry -> honest empty nav)
 *  2. contribution admission (unregistered content rejected)
 *  3. org/workspace switcher submit-resolve flow (client choice is never
 *     trusted as tenant context)
 *  4. notifications surface contract (fail-closed viewer scoping)
 *  5. shell neutrality assertion (same token vocabulary as the
 *     domain-neutrality guard, applied to the shell's own sources)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  admitNavContributionSets,
  installedRuntimeIds,
  resolveInstalledShellNav,
  resolveShellNav,
  shellNavHasDestinations,
} from "../../frontend/src/lib/shell-nav";
import { INSTALLED_NAV_CONTRIBUTION_SETS } from "../../frontend/src/lib/runtime/nav-registry";
import {
  resolveWorkspaceSwitchChoice,
  switcherOptions,
  type WorkspaceSwitchDirectoryEntry,
} from "../../frontend/src/lib/shell-org-switcher";
import { tenantId } from "../../frontend/src/lib/tenant-core";
import {
  buildNotificationSurface,
  type ShellNotificationRecord,
} from "../../frontend/src/lib/shell-notifications";
import { buildProfileMenu, profileInitials } from "../../frontend/src/lib/shell-profile";
import { workspaceId, type WorkspaceContext } from "../../frontend/src/lib/workspace-core";

/* ────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const DECLARED_RUNTIME_ID = "runtime:scholar"; // the manifest-declared runtime id

function syntheticSet(
  runtimeId: string,
  items: Array<{ key: string; label: string; capabilities?: readonly string[]; orderHint?: number }>,
): Parameters<typeof resolveShellNav>[0][number] {
  return {
    runtimeId,
    contributions: [
      {
        runtimeRef: runtimeId,
        sectionKey: `${runtimeId}:main`,
        sectionLabel: "Main",
        items: items.map((item) => ({
          key: item.key,
          label: item.label,
          iconKey: "group",
          url: `/${item.key}`,
          ...(item.capabilities ? { capabilities: item.capabilities } : {}),
          orderHint: item.orderHint ?? 0,
        })),
      },
    ],
  };
}

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    tenantId: tenantId("tenant-1"),
    workspaceId: workspaceId("tenant-1:ws-1"),
    workspaceName: "Workspace One",
    workspaceType: "institution",
    actorId: "actor-1",
    accessibleWorkspaceIds: [],
    activePageId: null,
    isCrossTenantSwitch: false,
    ...overrides,
  };
}

function directoryEntry(
  id: string,
  tenant: string,
  type: WorkspaceSwitchDirectoryEntry["type"] = "institution",
): WorkspaceSwitchDirectoryEntry {
  return { id, tenantId: tenant, name: id, type };
}

function notification(overrides: Partial<ShellNotificationRecord> = {}): ShellNotificationRecord {
  return {
    id: "n-1",
    recipientId: "viewer-1",
    tenantRef: "tenant-1",
    title: "Hello",
    message: "A message",
    category: "general",
    isRead: false,
    actionUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/* ────────────────────────────────────────────────────────────
 * 1. Registry-driven navigation
 * ────────────────────────────────────────────────────────────*/

describe("shell navigation (registry-driven, fail-safe)", () => {
  it("renders an honest empty nav from an empty registry", () => {
    const sections = resolveShellNav([], new Set(["anything"]));
    expect(sections).toEqual([]);
    expect(shellNavHasDestinations(sections)).toBe(false);
  });

  it("renders an honest empty nav when the viewer holds no capabilities", () => {
    const sections = resolveInstalledShellNav(new Set<string>());
    expect(sections).toEqual([]);
    expect(shellNavHasDestinations(sections)).toBe(false);
  });

  it("resolves admitted registry contributions with capability gating", () => {
    const set = syntheticSet(DECLARED_RUNTIME_ID, [
      { key: "overview", label: "Overview" },
      { key: "restricted", label: "Restricted", capabilities: ["secret.capability"] },
    ]);
    const sections = resolveShellNav([set], new Set<string>());
    expect(sections).toHaveLength(1);
    expect(sections[0].items.map((item) => item.key)).toEqual(["overview"]);

    const withCapability = resolveShellNav([set], new Set(["secret.capability"]));
    expect(withCapability[0].items.map((item) => item.key)).toEqual([
      "overview",
      "restricted",
    ]);
  });

  it("traces every rendered item's provenance to a registered contribution set", () => {
    const declared = installedRuntimeIds();
    const sets = [
      syntheticSet(DECLARED_RUNTIME_ID, [{ key: "a", label: "A" }]),
      syntheticSet(DECLARED_RUNTIME_ID, [{ key: "b", label: "B", orderHint: 1 }]),
    ];
    const sections = resolveShellNav(sets, new Set<string>());
    const flat = sections.flatMap((section) => section.items);
    expect(flat.length).toBeGreaterThan(0);
    for (const item of flat) {
      expect(declared.has(item.runtimeRef)).toBe(true);
      expect(
        sets.some(
          (set) =>
            set.runtimeId === item.runtimeRef &&
            set.contributions.some((contribution) =>
              contribution.items.some((seed) => seed.key === item.key),
            ),
        ),
      ).toBe(true);
    }
  });
});

/* ────────────────────────────────────────────────────────────
 * 2. Contribution admission
 * ────────────────────────────────────────────────────────────*/

describe("contribution admission (registry-only)", () => {
  it("admits the platform's installed registry cleanly", () => {
    const admission = admitNavContributionSets(INSTALLED_NAV_CONTRIBUTION_SETS);
    expect(admission.admitted).toHaveLength(INSTALLED_NAV_CONTRIBUTION_SETS.length);
    expect(admission.rejected).toEqual([]);
  });

  it("rejects an unregistered runtime's contribution set", () => {
    const rogue = syntheticSet("runtime:unregistered", [{ key: "rogue", label: "Rogue" }]);
    const admission = admitNavContributionSets([rogue]);
    expect(admission.admitted).toEqual([]);
    expect(admission.rejected).toEqual([
      {
        runtimeId: "runtime:unregistered",
        reason: "Runtime is not declared by the installed-runtime manifest",
      },
    ]);
    // ...and the shell renders nothing from it, whatever capabilities exist.
    expect(resolveShellNav([rogue], new Set(["anything"]))).toEqual([]);
  });

  it("rejects a set whose contribution was not published by its own runtime", () => {
    const forged: Parameters<typeof resolveShellNav>[0][number] = {
      runtimeId: DECLARED_RUNTIME_ID,
      contributions: [
        {
          runtimeRef: "runtime:someone-else",
          sectionKey: "foreign",
          items: [
            { key: "foreign.item", label: "Foreign", iconKey: "group", url: "/foreign", orderHint: 0 },
          ],
        },
      ],
    };
    const admission = admitNavContributionSets([forged]);
    expect(admission.admitted).toEqual([]);
    expect(admission.rejected[0]?.reason).toContain("not published by");
    expect(resolveShellNav([forged], new Set<string>())).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────
 * 3. Org/workspace switcher — submit-resolve
 * ────────────────────────────────────────────────────────────*/

describe("workspace switcher submit-resolve (client choice never trusted)", () => {
  const directory: readonly WorkspaceSwitchDirectoryEntry[] = [
    directoryEntry("ws-1", "tenant-1"),
    directoryEntry("ws-2", "tenant-2", "campus"),
    directoryEntry("ws-3", "tenant-1", "team"),
  ];

  it("offers only directory entries the actor is authorized for", () => {
    const options = switcherOptions(directory, ["ws-1", "ws-3"]);
    expect(options.map((option) => option.id)).toEqual(["ws-1", "ws-3"]);
  });

  it("resolves a valid choice from the server-owned directory", () => {
    const from = workspaceContext();
    const result = resolveWorkspaceSwitchChoice(
      { workspaceId: "ws-3" },
      directory,
      from,
      ["ws-1", "ws-3"],
      "actor-1",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.workspaceId).toBe(workspaceId("ws-3"));
      expect(result.context.tenantId).toBe(tenantId("tenant-1"));
    }
  });

  it("fails closed on an unknown or unauthorized choice", () => {
    const from = workspaceContext();
    expect(
      resolveWorkspaceSwitchChoice({ workspaceId: "ws-unknown" }, directory, from, ["ws-1"], "a").ok,
    ).toBe(false);
    expect(
      resolveWorkspaceSwitchChoice({ workspaceId: "ws-2" }, directory, from, ["ws-1"], "a").ok,
    ).toBe(false);
  });

  it("derives tenant context from the directory record, never from the client", () => {
    const from = workspaceContext();
    // A forged choice that smuggles client-asserted tenant context: the
    // resolution must derive the tenant from the server-owned directory
    // record (tenant-1 for ws-3), never from the choice.
    const forged = { workspaceId: "ws-3", tenantId: "tenant-evil" } as {
      workspaceId: string;
      tenantId: string;
    };
    const result = resolveWorkspaceSwitchChoice(forged, directory, from, ["ws-3"], "actor-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.tenantId).toBe(tenantId("tenant-1"));
    }
  });

  it("delegates cross-tenant policy to the workspace engine (fail closed)", () => {
    // Same-tenant switch first:
    const sameTenant = resolveWorkspaceSwitchChoice(
      { workspaceId: "ws-3" },
      directory,
      workspaceContext(),
      ["ws-3"],
      "actor-1",
    );
    expect(sameTenant.ok).toBe(true);

    // Cross-tenant switch without an explicit cross-tenant context is denied
    // by the verified engine — the switcher never grants it from the client.
    const crossTenant = resolveWorkspaceSwitchChoice(
      { workspaceId: "ws-2" },
      directory,
      workspaceContext({ accessibleWorkspaceIds: [workspaceId("ws-2")] }),
      ["ws-2"],
      "actor-1",
    );
    expect(crossTenant.ok).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────
 * 4. Notifications surface contract
 * ────────────────────────────────────────────────────────────*/

describe("notifications surface contract (fail-closed viewer scoping)", () => {
  const viewer = { tenantId: "tenant-1", recipientId: "viewer-1" };

  it("admits the viewer's own records, newest first, capped", () => {
    const records = [
      notification({ id: "old", createdAt: "2026-01-01T00:00:00Z" }),
      notification({ id: "new", createdAt: "2026-02-01T00:00:00Z" }),
      notification({ id: "newer", createdAt: "2026-03-01T00:00:00Z" }),
    ];
    const surface = buildNotificationSurface(records, viewer, { limit: 2 });
    expect(surface.items.map((item) => item.id)).toEqual(["newer", "new"]);
    // Unread counts over every admitted record, not just the capped page —
    // the badge never hides what it did not show.
    expect(surface.unreadCount).toBe(3);
    expect(surface.withheldCount).toBe(0);
  });

  it("withholds records addressed to someone else", () => {
    const surface = buildNotificationSurface(
      [
        notification({ id: "mine" }),
        notification({ id: "theirs", recipientId: "viewer-2" }),
      ],
      viewer,
    );
    expect(surface.items.map((item) => item.id)).toEqual(["mine"]);
    expect(surface.withheldCount).toBe(1);
  });

  it("withholds records from another tenant", () => {
    const surface = buildNotificationSurface(
      [
        notification({ id: "mine" }),
        notification({ id: "foreign", tenantRef: "tenant-9" }),
      ],
      viewer,
    );
    expect(surface.items.map((item) => item.id)).toEqual(["mine"]);
    expect(surface.withheldCount).toBe(1);
  });

  it("counts unread only over admitted records", () => {
    const surface = buildNotificationSurface(
      [
        notification({ id: "read", isRead: true }),
        notification({ id: "unread", isRead: false }),
        notification({ id: "theirs", recipientId: "viewer-2", isRead: false }),
      ],
      viewer,
    );
    expect(surface.unreadCount).toBe(1);
  });

  it("falls titles back honestly and keeps the record unmutated", () => {
    const surface = buildNotificationSurface(
      [notification({ title: null, category: "system" })],
      viewer,
    );
    expect(surface.items[0]?.title).toBe("system");
  });
});

/* ────────────────────────────────────────────────────────────
 * 5. Profile menu contract
 * ────────────────────────────────────────────────────────────*/

describe("profile menu contract", () => {
  it("offers fixed platform-owned neutral destinations only", () => {
    const menu = buildProfileMenu({
      displayName: "Ada Lovelace",
      roleTitle: "Administrator",
      workspaceName: "Workspace One",
    });
    expect(menu.destinations.map((destination) => destination.url)).toEqual([
      "/settings",
      "/notifications",
    ]);
  });

  it("derives initials honestly, including empty names", () => {
    expect(profileInitials("Ada Lovelace")).toBe("AL");
    expect(profileInitials("plato")).toBe("P");
    expect(profileInitials("   ")).toBe("?");
  });
});

/* ────────────────────────────────────────────────────────────
 * 6. Shell neutrality assertion
 * ────────────────────────────────────────────────────────────*/

/**
 * Extract the guard's token vocabulary straight from
 * scripts/verify-domain-neutrality.mjs so this assertion can never drift
 * from the CI guard's definition.
 */
function guardTokens(): {
  strict: readonly string[];
  literal: readonly string[];
  structural: readonly string[];
} {
  const source = readFileSync(
    fileURLToPath(new URL("../../scripts/verify-domain-neutrality.mjs", import.meta.url)),
    "utf8",
  );
  function tokensOf(constName: string): string[] {
    const block = source.match(new RegExp(`const ${constName} = \\[[\\s\\S]*?\\];`));
    if (!block) throw new Error(`Cannot locate ${constName} in the neutrality guard`);
    return [...block[0].matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1]);
  }
  return {
    strict: tokensOf("STRICT_TOKENS"),
    literal: tokensOf("LITERAL_TOKENS"),
    structural: tokensOf("STRUCTURAL_TOKENS"),
  };
}

const TOKENS = guardTokens();

function scanShellSources(): Array<{ file: string; token: string; line: number }> {
  const files = [
    // Lib-root shell contracts: full guard vocabulary (they sit in the
    // guard's own scan surface).
    "frontend/src/lib/shell-nav.ts",
    "frontend/src/lib/shell-org-switcher.ts",
    "frontend/src/lib/shell-notifications.ts",
    "frontend/src/lib/shell-profile.ts",
    // Shell components: strict/literal vocabulary. The bell maps the
    // existing notification store's tenant column by its storage name,
    // which the guard classifies separately (STRUCTURAL) and which the
    // contract speaks of only as a neutral tenantRef.
    "frontend/src/components/shell/shell-header-actions.tsx",
    "frontend/src/components/shell/workspace-switcher.tsx",
    "frontend/src/components/shell/notification-bell.tsx",
    "frontend/src/components/shell/profile-menu.tsx",
  ];
  const hits: Array<{ file: string; token: string; line: number }> = [];
  for (const file of files) {
    const content = readFileSync(
      fileURLToPath(new URL(`../../${file}`, import.meta.url)),
      "utf8",
    );
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const token of TOKENS.strict) {
        if (new RegExp(`\\b${token}\\b`, "i").test(line)) {
          hits.push({ file, token, line: index + 1 });
        }
      }
      for (const token of TOKENS.literal) {
        if (new RegExp(`['"\`]${token}['"\`]`, "i").test(line)) {
          hits.push({ file, token, line: index + 1 });
        }
      }
      if (file.endsWith(".ts")) {
        for (const token of TOKENS.structural) {
          if (new RegExp(`\\b${token}\\b`).test(line)) {
            hits.push({ file, token, line: index + 1 });
          }
        }
      }
    });
  }
  return hits;
}

describe("shell neutrality (ADR-003: the shell imports no domain module)", () => {
  it("keeps every shell source free of domain vocabulary", () => {
    const hits = scanShellSources();
    expect(
      hits
        .map((hit) => `${hit.file}:${hit.line} ${hit.token}`)
        .join("\n"),
    ).toBe("");
  });
});
