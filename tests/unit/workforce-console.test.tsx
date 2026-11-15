import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import {
  AgentDashboardView,
  WorkforceRosterView,
} from "../../frontend/src/components/internal-console/workforce-views";
import { CONSOLE_PATHS } from "../../frontend/src/lib/internal-console/paths";
import {
  CONSOLE_NAV,
  filterNav,
  viewerCapabilities,
} from "../../frontend/src/lib/internal-console/roles";
import {
  ENGINE_TABLES_NOTE,
  buildAgentDashboard,
  buildRoster,
  canViewWorkforce,
  workforceEntries,
} from "../../frontend/src/lib/internal-console/workforce-view";

const viewerFor = (roles: string[], isSuperAdmin = false) => ({
  isSuperAdmin,
  capabilities: viewerCapabilities(roles, isSuperAdmin),
});
const asList = (v: ReturnType<typeof viewerFor>) => ({
  isSuperAdmin: v.isSuperAdmin,
  capabilities: [...v.capabilities],
});

describe("ENGINE-12 workforce view-model", () => {
  it("lists all twenty-five agents in three tiers with one executive and two independent auditors", () => {
    const roster = buildRoster();
    expect(roster.total).toBe(25);
    expect(roster.groups.map((g) => [g.tier, g.rows.length])).toEqual([
      ["executive", 1],
      ["department", 22],
      ["assurance", 2],
    ]);
    expect(roster.boundCount).toBe(7);
    expect(roster.definitionOnlyCount).toBe(18);
    expect(roster.rosterProblems).toEqual([]);
    expect(roster.groups.flatMap((g) => g.rows).every((r) => r.state === "shadow")).toBe(true);
  });

  it("counts capabilities, approvals and the highest tier per agent", () => {
    const rows = Object.fromEntries(
      buildRoster()
        .groups.flatMap((g) => g.rows)
        .map((r) => [r.code, r]),
    );
    expect(rows["support-agent"]).toMatchObject({
      capabilityCount: 5,
      gatedCount: 1,
      highestTier: "T2",
    });
    expect(rows["jarvis-executive"]).toMatchObject({ gatedCount: 5, highestTier: "T3" });
    expect(rows["sentinel-agent"]).toMatchObject({ gatedCount: 0, highestTier: "T1" });
  });

  it("reports roster problems instead of hiding them", () => {
    const entries = workforceEntries().map((e) =>
      e.pack.code === "sales-agent" ? { ...e, charter: { ...e.charter, t3Rules: {} } } : e,
    );
    const roster = buildRoster(entries);
    expect(roster.rosterProblems.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(<WorkforceRosterView roster={roster} />);
    expect(html).toContain("The roster check reports");
    expect(html).not.toContain("Roster check passed");
  });

  it("marks the eighteen additional agents as defined but not wired", () => {
    const rows = buildRoster().groups.flatMap((g) => g.rows);
    const unwired = rows.filter((r) => r.binding === "definition_only").map((r) => r.code);
    expect([...unwired].sort()).toEqual(
      [
        "compliance-agent",
        "reliability-agent",
        "customer-success-agent",
        "revenue-assurance-agent",
        "archivist-agent",
        "product-intelligence-agent",
        "market-intelligence-agent",
        "sentinel-agent",
        "onboarding-agent",
        "safeguarding-agent",
        "qa-agent",
        "evaluation-agent",
        "marketing-agent",
        "localisation-agent",
        "data-agent",
        "legal-agent",
        "people-agent",
        "investor-agent",
      ].sort(),
    );
  });

  it("builds a dashboard with every mandatory panel for each agent", () => {
    for (const e of workforceEntries()) {
      const d = buildAgentDashboard(e.pack.code)!;
      for (const p of ["charter", "permissions", "autonomy", "budget", "proposals", "safety"]) {
        expect(d.panels, `${e.pack.code} ${p}`).toContain(p);
      }
    }
  });

  it("returns null for an unknown agent", () => {
    expect(buildAgentDashboard("no-such-agent")).toBeNull();
    expect(buildAgentDashboard("")).toBeNull();
  });

  it("reports live data as unavailable with a reason, never as a number", () => {
    const d = buildAgentDashboard("support-agent")!;
    for (const live of [d.budget.used, d.proposals.recorded, d.runs.recorded, d.slos.measured]) {
      expect(live).toEqual({ available: false, reason: ENGINE_TABLES_NOTE });
    }
    expect(d.autonomy.current).toBe("shadow");
    expect(d.safety.shadowStart).toBe(true);
    expect(d.proposals.routes.map((r) => r.capabilityId)).toEqual(["send.reply"]);
  });

  it("shows the approval action and approver for a gated capability", () => {
    const d = buildAgentDashboard("finance-agent")!;
    const refund = d.permissions.capabilities.find((c) => c.id === "request.refund")!;
    expect(refund).toMatchObject({
      tier: "T3",
      approvalAction: "spend_money",
      t3Rule: "owner",
      approver: "sheriff",
      connector: "payments",
    });
    expect(refund.evalSuite).toBe("eval.finance-agent.request.refund");
    expect(refund.evalBar).toBe(0.99);
    expect(d.proposals.routes).toContainEqual({
      capabilityId: "request.refund",
      approver: "sheriff",
      action: "spend_money",
    });
  });

  it("shows that publishing a social post has no approval action yet", () => {
    const d = buildAgentDashboard("sales-agent")!;
    const post = d.permissions.capabilities.find((c) => c.id === "publish.social.post")!;
    expect(post.approvalAction).toBeNull();
    expect(
      d.proposals.routes.find((r) => r.capabilityId === "publish.social.post")?.action,
    ).toBeNull();
  });

  it("lists what is never autonomous from the JARVIS policy", () => {
    const d = buildAgentDashboard("jarvis-executive")!;
    expect(d.safety.neverAutonomous.sort()).toEqual([
      "delete_audit_records",
      "disable_guardrails",
      "mix_cross_tenant_data",
    ]);
    expect(d.safety.independentOversight).toMatch(/sheriff/);
    expect(d.safety.killScope).toBe("workforce");
  });

  it("describes the audit agent as read-only and reporting to the sheriff", () => {
    const d = buildAgentDashboard("sentinel-agent")!;
    expect(d.safety.independentOversight).toMatch(/Read-only/);
    expect(d.charter.supervisor).toBe("sheriff");
    expect(d.permissions.capabilities.every((c) => c.tier === "T0" || c.tier === "T1")).toBe(true);
  });

  it("carries the memory and model limits of each agent", () => {
    const c = buildAgentDashboard("compliance-agent")!.context;
    expect(c).toMatchObject({
      maxSensitivity: "restricted",
      seesCustomerContent: true,
      crossTenant: false,
    });
    expect(buildAgentDashboard("market-intelligence-agent")!.context.seesCustomerContent).toBe(
      false,
    );
  });
});

describe("ENGINE-12 access and navigation", () => {
  it("only operations, audit and owner staff may view the workforce", () => {
    expect(canViewWorkforce(asList(viewerFor(["operations"])))).toBe(true);
    expect(canViewWorkforce(asList(viewerFor(["security"])))).toBe(true);
    expect(canViewWorkforce(asList(viewerFor(["platform_admin"])))).toBe(true);
    expect(canViewWorkforce(asList(viewerFor([], true)))).toBe(true);
    expect(canViewWorkforce(asList(viewerFor(["support"])))).toBe(false);
    expect(canViewWorkforce(asList(viewerFor(["sales"])))).toBe(false);
    expect(canViewWorkforce(asList(viewerFor(["finance"])))).toBe(false);
    expect(canViewWorkforce({ isSuperAdmin: false, capabilities: [] })).toBe(false);
    expect(canViewWorkforce({ isSuperAdmin: true, capabilities: [] })).toBe(true);
  });

  it("the console nav shows AI Workforce under the same rule", () => {
    const keys = (roles: string[]) =>
      filterNav(CONSOLE_NAV, viewerFor(roles))
        .filter((i) => i.navigable !== false)
        .map((i) => i.key);
    expect(keys(["operations"])).toContain("workforce");
    expect(keys(["security"])).toContain("workforce");
    expect(keys(["support"])).not.toContain("workforce");
    expect(keys(["engineering"])).not.toContain("workforce");
    const item = CONSOLE_NAV.find((i) => i.key === "workforce")!;
    expect(item.href).toBe("/console/workforce");
  });

  it("builds agent paths safely", () => {
    expect(CONSOLE_PATHS.workforce).toBe("/console/workforce");
    expect(CONSOLE_PATHS.workforceAgent("support-agent")).toBe("/console/workforce/support-agent");
    expect(CONSOLE_PATHS.workforceAgent("a/b c")).toBe("/console/workforce/a%2Fb%20c");
  });
});

describe("ENGINE-12 rendered markup", () => {
  it("renders the roster with every agent linking to its dashboard", () => {
    const html = renderToStaticMarkup(<WorkforceRosterView />);
    expect(html).toContain('data-testid="console-workforce"');
    expect(html).toContain("25 agents: 7 wired to the engine and 18 defined but not yet wired");
    expect(html).toContain("Roster check passed");
    for (const e of workforceEntries()) {
      expect(html).toContain(`href="/console/workforce/${e.pack.code}"`);
    }
    expect(html).toContain("Independent assurance");
    expect(html).toContain("Defined, not yet wired to the engine");
  });

  it("renders a dashboard panel for every panel of the charter and says live data is unavailable", () => {
    const d = buildAgentDashboard("support-agent")!;
    const html = renderToStaticMarkup(<AgentDashboardView dashboard={d} />);
    for (const p of d.panels) expect(html, p).toContain(`data-testid="panel-${p}"`);
    expect(html).toContain("Current level: shadow");
    expect(html).toContain("Recorded proposals: Not available");
    expect(html).toContain("Used today: Not available");
    expect(html).toContain("Pausing is not available from this page.");
    expect(html).not.toMatch(/<button/);
  });

  it("omits a panel the charter does not list", () => {
    const d = buildAgentDashboard("support-agent")!;
    const html = renderToStaticMarkup(
      <AgentDashboardView dashboard={{ ...d, panels: d.panels.filter((p) => p !== "handoffs") }} />,
    );
    expect(html).not.toContain('data-testid="panel-handoffs"');
    expect(html).toContain('data-testid="panel-safety"');
  });

  it("states plainly when an agent is defined but not wired", () => {
    const html = renderToStaticMarkup(
      <AgentDashboardView dashboard={buildAgentDashboard("compliance-agent")!} />,
    );
    expect(html).toContain("Defined only");
    expect(html).toContain("platform roles are a proposal");
    const wired = renderToStaticMarkup(
      <AgentDashboardView dashboard={buildAgentDashboard("support-agent")!} />,
    );
    expect(wired).toContain("Wired to the engine");
  });

  it("shows the sheriff rule for a T3 capability the agent owns and one it only requests", () => {
    const jarvis = renderToStaticMarkup(
      <AgentDashboardView dashboard={buildAgentDashboard("jarvis-executive")!} />,
    );
    expect(jarvis).toContain("This agent owns the request; the sheriff decides with a passkey.");
    expect(jarvis).toContain("This agent may only ask the agent that owns the request.");
  });

  it("escapes agent text rather than injecting markup", () => {
    const d = buildAgentDashboard("support-agent")!;
    const html = renderToStaticMarkup(
      <AgentDashboardView
        dashboard={{ ...d, charter: { ...d.charter, mission: "<script>alert(1)</script>" } }}
      />,
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("ENGINE-13 workspace panels in the console", () => {
  it("every agent dashboard shows what it can reach, its boundaries and its workbench", () => {
    for (const e of workforceEntries()) {
      const d = buildAgentDashboard(e.pack.code)!;
      expect(d.workspace, e.pack.code).not.toBeNull();
      const html = renderToStaticMarkup(<AgentDashboardView dashboard={d} />);
      expect(html, e.pack.code).toContain('data-testid="panel-workspace"');
      expect(html, e.pack.code).toContain('data-testid="panel-boundaries"');
      expect(html, e.pack.code).toContain('data-testid="panel-workbench"');
      expect(html, e.pack.code).toContain('data-testid="workspace-scope-agent_proposals"');
      for (const b of d.workspace!.boundaries) {
        expect(html, e.pack.code).toContain(b.replace(/'/g, "&#x27;"));
      }
    }
  });

  it("says plainly whether an agent can read organization rows", () => {
    const sg = renderToStaticMarkup(
      <AgentDashboardView dashboard={buildAgentDashboard("safeguarding-agent")!} />,
    );
    expect(sg).toContain("can read some organization rows, only under the rule shown");
    expect(sg).toContain("Only rows the organization itself flagged to the platform");
    const fin = renderToStaticMarkup(
      <AgentDashboardView dashboard={buildAgentDashboard("finance-agent")!} />,
    );
    expect(fin).toContain("never reads an organization&#x27;s content");
    expect(fin).not.toContain("can read some organization rows");
  });

  it("shows the grant limit on a grant-scoped resource and nothing invented", () => {
    const d = buildAgentDashboard("support-agent")!;
    const tickets = d.workspace!.scopes.find((s) => s.resource === "support_tickets")!;
    expect(tickets.grantMaxMinutes).toBe(60);
    expect(tickets.rowScope).toBe("tenant_with_grant");
    const html = renderToStaticMarkup(<AgentDashboardView dashboard={d} />);
    expect(html).toContain("grant up to 60 minutes");
    expect(d.workspace!.reachesOrganizationRows).toBe(true);
    expect(buildAgentDashboard("finance-agent")!.workspace!.reachesOrganizationRows).toBe(false);
  });

  it("an unknown agent has no dashboard and so no workspace", () => {
    expect(buildAgentDashboard("ghost-agent")).toBeNull();
  });
});
