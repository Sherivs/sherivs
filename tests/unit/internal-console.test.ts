import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  presentationRoleFor,
  quickActionsFor,
  filterNav,
  CONSOLE_NAV,
  viewerCapabilities,
} from "@/lib/internal-console/roles";
import {
  workspacesForViewer,
  workspaceById,
  workspaceFromAuthorized,
  workspaceIdFromPath,
  isWorkingWorkspace,
} from "@/lib/internal-console/workspaces";
import { presentationStaffStatus } from "@/lib/internal-console/overview";
import { isUniqueViolation } from "@/lib/internal-console/store";
import { searchConsole } from "@/lib/internal-console/search";
import { isMissingRelation, slugifyWorkspaceName } from "@/lib/internal-console/store";
import { mapProcessHealth, overallFromCards } from "@/lib/internal-console/status";
import {
  REGISTERED_RUNTIMES,
  SCHOLAR_RUNTIME_CONTRACT,
} from "@/lib/internal-console/runtime-contract";
import { CONSOLE_PATHS } from "@/lib/internal-console/paths";
import {
  decideHostRoute,
  isConsolePath,
  isConsoleSurfacePath,
  isPublicConsolePath,
} from "@/lib/experience/console-host-routing";
import { SHERIVS_INTERNAL_HOME } from "@/lib/identity/identity";
import { isRetiredApplicationHostname } from "@/lib/experience/retired-application-host";

const operator = { signedIn: true, isConsoleOperator: true };

describe("internal console V1 contract", () => {
  it("routes internal workforce to /console, not the retired /internal shell", () => {
    expect(SHERIVS_INTERNAL_HOME).toBe("/console");
    expect(CONSOLE_PATHS.home).toBe("/console");
    expect(existsSync("frontend/src/routes/_authenticated/internal.tsx")).toBe(false);
    expect(existsSync("frontend/src/routes/console/route.tsx")).toBe(true);
    expect(existsSync("frontend/src/routes/console/index.tsx")).toBe(true);
  });

  it("un-retires the canonical console host and keeps gov/head/group retired", () => {
    expect(isRetiredApplicationHostname("console.sherivs.com")).toBe(false);
    expect(isRetiredApplicationHostname("internal.sherivs.com")).toBe(false);
    expect(isRetiredApplicationHostname("gov.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("head.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("group.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("admin.sherivs.com")).toBe(true);
  });

  it("registers only Sherivs Scholar as an operational runtime", () => {
    expect(REGISTERED_RUNTIMES).toHaveLength(1);
    expect(SCHOLAR_RUNTIME_CONTRACT.status).toBe("operational_product");
    expect(SCHOLAR_RUNTIME_CONTRACT.entryUrl).toContain("app.sherivs.com");
  });

  it("maps platform roles onto V1 presentation roles", () => {
    expect(presentationRoleFor({ isSuperAdmin: true, roles: [] })).toBe("platform_owner");
    expect(presentationRoleFor({ isSuperAdmin: false, roles: ["platform_admin"] })).toBe(
      "platform_administrator",
    );
    expect(presentationRoleFor({ isSuperAdmin: false, roles: ["engineering"] })).toBe("engineer");
    expect(presentationRoleFor({ isSuperAdmin: false, roles: ["support"] })).toBe(
      "support_specialist",
    );
    expect(presentationRoleFor({ isSuperAdmin: false, roles: ["finance"] })).toBe(
      "standard_team_member",
    );
  });

  it("hides unauthorized navigation and quick actions", () => {
    const support = {
      isSuperAdmin: false,
      capabilities: viewerCapabilities(["support"], false),
    };
    expect(filterNav(CONSOLE_NAV, support).map((item) => item.key)).toEqual([
      "home",
      "organizations",
      "workspaces",
      "runtimes",
      "activity",
    ]);
    const supportActivity = filterNav(CONSOLE_NAV, support).find((item) => item.key === "activity");
    expect(supportActivity?.navigable).toBe(false);
    expect(supportActivity?.children?.map((item) => item.key)).toEqual([
      "metrics",
      "incidents",
      "tickets",
    ]);
    expect(quickActionsFor(support).some((item) => item.key === "invite")).toBe(false);
    expect(
      quickActionsFor({ isSuperAdmin: true, capabilities: new Set() }).some(
        (item) => item.key === "invite",
      ),
    ).toBe(true);
    const engineer = {
      isSuperAdmin: false,
      capabilities: viewerCapabilities(["engineering"], false),
    };
    expect(filterNav(CONSOLE_NAV, engineer).map((item) => item.key)).toEqual([
      "home",
      "workspaces",
      "runtimes",
      "activity",
    ]);
    expect(filterNav(CONSOLE_NAV, engineer).some((item) => item.key === "organizations")).toBe(
      false,
    );
    const activity = filterNav(CONSOLE_NAV, engineer).find((item) => item.key === "activity");
    expect(activity?.navigable).toBe(false);
    expect(activity?.children?.map((item) => item.key)).toEqual(["metrics", "logs", "incidents"]);
    expect(quickActionsFor(engineer).some((item) => item.key === "invite")).toBe(false);
    const operations = {
      isSuperAdmin: false,
      capabilities: viewerCapabilities(["operations"], false),
    };
    const operationsNav = filterNav(CONSOLE_NAV, operations);
    expect(operationsNav.map((item) => item.key)).toEqual([
      "home",
      "organizations",
      "workspaces",
      "runtimes",
      "activity",
    ]);
    expect(
      operationsNav.find((item) => item.key === "activity")?.children?.map((item) => item.key),
    ).toEqual(["metrics", "incidents", "tickets"]);
    expect(quickActionsFor(operations).some((item) => item.key === "onboard")).toBe(true);
  });

  it("does not put another person's personal workspace in the working set", () => {
    expect(
      isWorkingWorkspace({
        kind: "personal",
        ownerId: "owner",
        viewerId: "admin",
        isMember: false,
        canManageShared: true,
      }),
    ).toBe(false);
    expect(
      isWorkingWorkspace({
        kind: "shared",
        ownerId: "owner",
        viewerId: "admin",
        isMember: false,
        canManageShared: true,
      }),
    ).toBe(true);
    expect(
      isWorkingWorkspace({
        kind: "role",
        ownerId: "owner",
        viewerId: "engineer",
        isMember: true,
        canManageShared: false,
      }),
    ).toBe(true);
    expect(
      isWorkingWorkspace({
        kind: "personal",
        ownerId: "owner",
        viewerId: "owner",
        isMember: true,
        canManageShared: false,
      }),
    ).toBe(true);
  });

  it("presents expired invitations without inventing a database status", () => {
    expect(
      presentationStaffStatus(
        { status: "invited", inviteExpiresAt: "2020-01-01T00:00:00.000Z" },
        "2026-10-27T00:00:00.000Z",
      ),
    ).toBe("expired");
    expect(
      presentationStaffStatus(
        { status: "invited", inviteExpiresAt: "2027-01-01T00:00:00.000Z" },
        "2026-10-27T00:00:00.000Z",
      ),
    ).toBe("invited");
  });

  it("does not list shared workspaces the viewer cannot access", () => {
    const workspaces = workspacesForViewer({
      displayName: "Ada",
      isSuperAdmin: false,
      roles: ["engineering"],
    });
    expect(workspaces.map((row) => row.id)).toEqual(["me", "role:engineering"]);
    expect(
      workspaceById("role:operations", {
        displayName: "Ada",
        isSuperAdmin: false,
        roles: ["engineering"],
      }),
    ).toBeNull();
  });

  it("resolves the active workspace from the console path", () => {
    expect(workspaceIdFromPath("/console/workspaces/me")).toBe("me");
    expect(workspaceIdFromPath("/console/workspaces/role:engineering")).toBe("role:engineering");
    expect(workspaceIdFromPath("/console/workspaces/8f14e45f-ea9d-4c2b-9b3a-1c2d3e4f5a67")).toBe(
      "8f14e45f-ea9d-4c2b-9b3a-1c2d3e4f5a67",
    );
    expect(workspaceIdFromPath("/console/workspaces/secret")).toBeNull();
    expect(workspaceIdFromPath("/console")).toBeNull();
  });

  it("keeps search permission-aware", () => {
    const hits = searchConsole({
      query: "secret",
      canReadStaff: false,
      staff: [
        { id: "1", fullName: "Secret Staff", email: "s@x", department: null, status: "active" },
      ],
      workspaces: [],
      runtimes: REGISTERED_RUNTIMES,
      pages: [],
      help: [],
    });
    expect(hits.some((hit) => hit.kind === "staff")).toBe(false);
    const orgHits = searchConsole({
      query: "riverside",
      canReadStaff: false,
      canReadOrganizations: false,
      staff: [],
      organizations: [{ id: "1", displayName: "Riverside School", lifecycleState: "active" }],
      workspaces: [],
      runtimes: REGISTERED_RUNTIMES,
      pages: [],
      help: [],
    });
    expect(orgHits.some((hit) => hit.kind === "organization")).toBe(false);
  });

  it("slugifies shared workspace names without inventing operational data", () => {
    expect(slugifyWorkspaceName("Engineering Workspace")).toBe("engineering-workspace");
    expect(isMissingRelation({ code: "PGRST205", message: "could not find the table" })).toBe(true);
    expect(isMissingRelation({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "42501" })).toBe(false);
  });

  it("resolves stored workspace records by uuid without falling back to role aliases", () => {
    const stored = [
      {
        ...workspacesForViewer({
          displayName: "Ada",
          isSuperAdmin: false,
          roles: ["engineering"],
        })[0],
        id: "8f14e45f-ea9d-4c2b-9b3a-1c2d3e4f5a67",
        recordId: "8f14e45f-ea9d-4c2b-9b3a-1c2d3e4f5a67",
        source: "database" as const,
      },
    ];
    expect(
      workspaceFromAuthorized("8f14e45f-ea9d-4c2b-9b3a-1c2d3e4f5a67", stored, {
        displayName: "Ada",
        isSuperAdmin: false,
        roles: ["engineering"],
      })?.recordId,
    ).toBe("8f14e45f-ea9d-4c2b-9b3a-1c2d3e4f5a67");
  });

  it("never treats a missing health signal as operational", () => {
    expect(mapProcessHealth("ok")).toBe("operational");
    expect(mapProcessHealth("failing")).toBe("unavailable");
    expect(mapProcessHealth(undefined)).toBe("unknown");
    expect(overallFromCards(["unknown", "unknown"])).toBe("unknown");
    expect(overallFromCards(["operational", "unknown"])).toBe("degraded");
  });
});

describe("console host routing for /console", () => {
  it("matches console paths and public auth paths", () => {
    expect(isConsolePath("/console")).toBe(true);
    expect(isConsolePath("/console/team")).toBe(true);
    expect(isConsolePath("/internal")).toBe(false);
    expect(isConsoleSurfacePath("/super-admin")).toBe(false);
    expect(isConsoleSurfacePath("/command-centre")).toBe(false);
    expect(isPublicConsolePath("/auth")).toBe(true);
  });

  it("keeps signed-in console status copy above the background orbs", () => {
    const css = readFileSync("frontend/src/components/internal-console/console.css", "utf8");
    expect(css).toContain(".sherivs-console-stage");
    expect(css).toMatch(/\.sherivs-console-stage\s*\{[\s\S]*z-index:\s*1/);
    const statusBlock = css.match(/\.sherivs-console-status\s*\{[^}]+\}/)?.[0];
    expect(statusBlock).toContain("inline-flex");
    expect(statusBlock).not.toContain("min-height");
    expect(css).toContain("minmax(0, 1fr)");
    const primitives = readFileSync(
      "frontend/src/components/internal-console/console-primitives.tsx",
      "utf8",
    );
    expect(primitives).toContain("sherivs-console-stage");
    expect(primitives).not.toContain('className="sherivs-console-status"');
    const gate = readFileSync("frontend/src/components/internal-console/console-gate.tsx", "utf8");
    expect(gate).toContain("ConsoleLoadingState");
    expect(gate).toContain("consoleSignInSearch");
    expect(gate).toContain("hostKindProp");
    const shell = readFileSync(
      "frontend/src/components/internal-console/console-shell.tsx",
      "utf8",
    );
    expect(shell).toContain("ConsoleLoadingState");
    expect(shell).toContain("consoleSignInSearch");
    const authz = readFileSync(
      "frontend/src/components/internal-console/not-authorised.tsx",
      "utf8",
    );
    expect(authz).toContain("ConsoleAtmosphere");
    expect(authz).toContain("console-not-authorised");
    expect(authz).not.toMatch(/Signing in with a school account/);
    const root = readFileSync("frontend/src/routes/__root.tsx", "utf8");
    expect(root).toContain("<ConsoleGate>");
    const index = readFileSync("frontend/src/routes/index.tsx", "utf8");
    expect(index).toContain("hostKind={data.hostKind}");
  });

  it("resolves workforce identity even when a tenant profile exists", () => {
    const src = readFileSync("frontend/src/contexts/app-context.tsx", "utf8");
    expect(src).toContain("loadWorkforce");
    expect(src).toContain("IDENTITY_LOAD_MS");
    expect(src).toContain('from("super_admins")');
    expect(src).toContain("claim_platform_staff_invite");
    expect(src).not.toContain("Try tenant profile first");
    expect(src).toMatch(/finally\s*\{[\s\S]*setLoading\(false\)/);
  });

  it("sends operators to /console and blocks non-staff", () => {
    expect(decideHostRoute({ hostKind: "internal", pathname: "/", ...operator })).toEqual({
      kind: "redirect",
      to: "/console",
    });
    expect(
      decideHostRoute({ hostKind: "internal", pathname: "/console/team", ...operator }),
    ).toEqual({ kind: "allow" });
    expect(
      decideHostRoute({
        hostKind: "internal",
        pathname: "/console",
        signedIn: true,
        isConsoleOperator: false,
      }),
    ).toEqual({ kind: "not_authorised" });
    expect(
      decideHostRoute({
        hostKind: "internal",
        pathname: "/auth",
        signedIn: false,
        isConsoleOperator: false,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("does not serve /console on app, public or tenant hosts", () => {
    for (const hostKind of ["app", "public_platform", "tenant"] as const) {
      expect(decideHostRoute({ hostKind, pathname: "/console", ...operator }).kind).toBe(
        "console_elsewhere",
      );
    }
    expect(decideHostRoute({ hostKind: "local", pathname: "/console", ...operator }).kind).toBe(
      "allow",
    );
  });
});

describe("console pages do not restore deleted prototypes", () => {
  it("keeps the sign-in page intact", () => {
    const auth = readFileSync("frontend/src/routes/auth.tsx", "utf8");
    expect(auth).toContain("authPageExperience");
    expect(auth).toContain("app-entry.css");
  });
});

describe("internal console store migration", () => {
  const sql = readFileSync(
    "database/supabase/migrations/20261027001000_sherivs_030_internal_console.sql",
    "utf8",
  );

  it("revokes client writes and forces RLS on console store tables", () => {
    for (const table of [
      "platform_workspace",
      "platform_workspace_member",
      "platform_runtime",
      "platform_recent_access",
    ]) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.platform_workspace[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
    expect(sql).toMatch(/GRANT ALL ON TABLE public\.platform_workspace[\s\S]*TO service_role/);
    expect(sql).not.toContain("FROM public.platform_workspace_member self");
    expect(sql).toContain("invite_expires_at");
    expect(sql).toContain("ensure_platform_personal_workspace");
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ensure_platform_personal_workspace\(uuid\) TO service_role/,
    );
    expect(sql).toContain("kind = 'shared'");
    expect(sql).toMatch(/platform_workspace_member_read[\s\S]*kind = 'shared'/);
  });

  it("does not statically import workspace store helpers from client-imported modules", () => {
    const overview = readFileSync(
      "frontend/src/lib/internal-console/overview.functions.ts",
      "utf8",
    );
    const shell = readFileSync(
      "frontend/src/components/internal-console/console-shell.tsx",
      "utf8",
    );
    expect(overview).not.toMatch(/from ["']\.\/workspace\.functions["']/);
    expect(overview).not.toMatch(/from ["']\.\/workspace\.store\.server["']/);
    expect(shell).not.toMatch(/workspace\.store\.server/);
    expect(existsSync("frontend/src/lib/internal-console/workspace.store.server.ts")).toBe(true);
  });
});

describe("local visual fixture", () => {
  it("activates only on Vite DEV, the explicit flag, and localhost", async () => {
    const { consoleVisualFixtureConfigured, buildConsoleVisualFixtureOverview } =
      await import("@/lib/internal-console/visual-fixture");
    expect(
      consoleVisualFixtureConfigured({
        dev: true,
        flag: "1",
        hostname: "127.0.0.1",
      }),
    ).toBe(true);
    expect(
      consoleVisualFixtureConfigured({
        dev: false,
        flag: "1",
        hostname: "127.0.0.1",
      }),
    ).toBe(false);
    expect(
      consoleVisualFixtureConfigured({
        dev: true,
        flag: "true",
        hostname: "localhost",
      }),
    ).toBe(false);
    expect(
      consoleVisualFixtureConfigured({
        dev: true,
        flag: "1",
        hostname: "console.sherivs.com",
      }),
    ).toBe(false);
    expect(
      consoleVisualFixtureConfigured({
        dev: true,
        flag: "1",
        hostname: null,
      }),
    ).toBe(false);

    const overview = buildConsoleVisualFixtureOverview();
    expect(overview.workspaceStore).toBe("derived-fallback");
    expect(overview.staff).toEqual([]);
    expect(overview.activity).toEqual([]);
    expect(overview.recent).toEqual([]);
    expect(overview.health.cards.every((card) => card.status === "unknown")).toBe(true);
    expect(overview.metrics.find((metric) => metric.key === "active-staff")?.available).toBe(false);
    expect(overview.metrics.find((metric) => metric.key === "control-plane-organizations")).toEqual(
      expect.objectContaining({ available: true, value: "0" }),
    );
    expect(overview.viewer.isSuperAdmin).toBe(false);
    expect(overview.viewer.email).toBe("console.fixture@localhost");
    expect(overview.organizationStore).toBe("fixture");
    expect(overview.organizationMetrics.available).toBe(true);
    expect(overview.organizationMetrics.total).toBe(0);
    expect(overview.organizations).toEqual([]);
    expect(overview.assignments).toEqual([]);
    expect(existsSync("frontend/src/routes/console/organizations/index.tsx")).toBe(true);
    expect(existsSync("frontend/src/routes/console/organizations/new.tsx")).toBe(true);
  });

  it("derives fixture pipeline metrics from the organization store without fabricating users", async () => {
    const {
      buildConsoleVisualFixtureOverview,
      CONSOLE_FIXTURE_ORGS_KEY,
      readFixtureOrganizationSnapshot,
    } = await import("@/lib/internal-console/visual-fixture");
    const raw = JSON.stringify({
      organizations: [
        {
          id: "org-active",
          displayName: "Riverside School",
          lifecycleState: "active",
          assignments: [
            {
              id: "asg-1",
              organizationId: "org-active",
              staffId: "00000000-0000-4000-8000-000000000001",
              staffName: "Fixture Operator",
              assignmentType: "onboarding_owner",
              status: "active",
              assignedBy: "00000000-0000-4000-8000-000000000001",
              assignedAt: "2026-10-27T00:00:00.000Z",
              releasedAt: null,
            },
          ],
          transitions: [
            {
              id: "tr-1",
              fromState: "ready_for_activation",
              toState: "active",
              actorId: "00000000-0000-4000-8000-000000000001",
              reason: "activated",
              at: "2026-10-27T01:00:00.000Z",
            },
          ],
        },
        {
          id: "org-draft",
          displayName: "Harbour Academy",
          lifecycleState: "submitted",
          transitions: [
            {
              id: "tr-2",
              fromState: "draft",
              toState: "submitted",
              actorId: "00000000-0000-4000-8000-000000000001",
              reason: "submitted",
              at: "2026-10-27T00:30:00.000Z",
            },
          ],
        },
      ],
    });
    const parsed = readFixtureOrganizationSnapshot(raw);
    expect(parsed.metrics.total).toBe(2);
    expect(parsed.metrics.active).toBe(1);
    expect(parsed.metrics.onboarding).toBe(1);
    expect(parsed.activity[0]?.description).toContain("Riverside School");
    const previous =
      typeof window === "undefined"
        ? null
        : window.sessionStorage.getItem(CONSOLE_FIXTURE_ORGS_KEY);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(CONSOLE_FIXTURE_ORGS_KEY, raw);
    }
    try {
      if (typeof window === "undefined") return;
      const overview = buildConsoleVisualFixtureOverview();
      expect(overview.organizationMetrics.active).toBe(1);
      expect(overview.organizationMetrics.onboarding).toBe(1);
      expect(overview.metrics.find((metric) => metric.key === "active-organizations")?.value).toBe(
        "1",
      );
      expect(overview.attention.some((item) => item.id === "onboarding-pipeline")).toBe(true);
      expect(overview.assignments).toHaveLength(1);
      expect(overview.registeredUsers).toBeNull();
      expect(overview.activeUsers30d).toBeNull();
    } finally {
      if (typeof window !== "undefined") {
        if (previous === null) window.sessionStorage.removeItem(CONSOLE_FIXTURE_ORGS_KEY);
        else window.sessionStorage.setItem(CONSOLE_FIXTURE_ORGS_KEY, previous);
      }
    }
  });

  it("keeps the fixture continue control behind the local gate", () => {
    const auth = readFileSync("frontend/src/routes/auth.tsx", "utf8");
    expect(auth).toContain("consoleVisualFixtureEnabled()");
    expect(auth).toContain("Continue as local fixture operator");
    expect(auth).toContain('data-testid="console-visual-fixture"');
    const context = readFileSync("frontend/src/contexts/app-context.tsx", "utf8");
    expect(context).toContain("consoleVisualFixtureActive()");
    expect(context).toContain("deactivateConsoleVisualFixture");
    expect(context).not.toMatch(/\bactivateConsoleVisualFixture\b/);
  });
});
