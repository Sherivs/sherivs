import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import {
  AgentDashboardView,
  AgentWorkbenchView,
} from "../../frontend/src/components/internal-console/workforce-views";
import {
  UNAVAILABLE_SOURCE,
  buildWorkbench,
  type WorkbenchDataSource,
} from "../../frontend/src/lib/internal-console/workbench-view";
import { CONSOLE_PATHS } from "../../frontend/src/lib/internal-console/paths";
import {
  ENGINE_TABLES_NOTE,
  buildAgentDashboard,
} from "../../frontend/src/lib/internal-console/workforce-view";
import { workforceRoster } from "../../frontend/src/lib/workforce-charter/roster";

const roster = workforceRoster();
const codes = roster.map((m) => m.pack.code);

describe("ENGINE-16 workbench view model", () => {
  it("every agent has a workbench built from its workspace, with every queue honestly unavailable", async () => {
    for (const m of roster) {
      const w = (await buildWorkbench(m.pack.code))!;
      expect(w, m.pack.code).not.toBeNull();
      expect(w.headline).toBe(m.workspace.ui.headline);
      expect(w.kind).toBe(m.workspace.ui.workbench);
      expect(w.queues.map((q) => q.id)).toEqual(m.workspace.ui.queues.map((q) => q.id));
      for (const q of w.queues) {
        expect(q.state, `${m.pack.code} ${q.id}`).toEqual({
          available: false,
          reason: ENGINE_TABLES_NOTE,
        });
        expect(m.workspace.scopes.some((s) => s.resource === q.source)).toBe(true);
      }
      expect(w.quickActions.map((a) => a.id)).toEqual(m.workspace.ui.quickActions.map((a) => a.id));
    }
  });

  it("an unknown agent has no workbench", async () => {
    expect(await buildWorkbench("nobody")).toBeNull();
  });

  it("quick actions that change something are disabled with a reason; navigation is enabled and read-only", async () => {
    for (const code of codes) {
      for (const a of (await buildWorkbench(code))!.quickActions) {
        if (a.kind === "view_runs" || a.kind === "review_proposals") {
          expect(a.enabled).toBe(true);
          expect(a.disabledReason).toBeNull();
          expect(a.anchor).toBe(a.kind === "view_runs" ? "panel-runs" : "panel-proposals");
        } else {
          expect(a.enabled, `${code} ${a.id}`).toBe(false);
          expect(a.disabledReason!.length).toBeGreaterThan(10);
          expect(a.anchor).toBeNull();
        }
        expect(a.effect.length).toBeGreaterThan(10);
      }
    }
  });

  it("the pause control states what the policy says, and is never available yet", async () => {
    const support = (await buildWorkbench("support-agent"))!;
    expect(support.pause).toMatchObject({
      available: false,
      pauseNeeds: "operations capability",
      resumeNeeds: "the sheriff",
    });
    expect(support.pause.reach).toContain("this agent only");
    const jarvis = (await buildWorkbench("jarvis-executive"))!;
    expect(jarvis.pause.pauseNeeds).toBe("the sheriff");
    expect(jarvis.pause.reach).toContain("every agent except the assurance agents");
    const sentinel = (await buildWorkbench("sentinel-agent"))!;
    expect(sentinel.pause.pauseNeeds).toBe("the sheriff");
    expect(sentinel.pause.reach).toContain("never silences it");
    for (const code of codes) expect((await buildWorkbench(code))!.pause.available).toBe(false);
  });
});

describe("ENGINE-16 workbench data source", () => {
  const real: WorkbenchDataSource = {
    queue: async (_a, id) => ({
      available: true,
      items:
        id === "empty"
          ? []
          : [
              {
                id: "i1",
                title: "Refund of 4,000",
                detail: "needs sheriff",
                at: "2026-11-15T09:00:00Z",
              },
            ],
    }),
  };

  it("shows what a real source returns, and falls back to the empty state for an empty queue", async () => {
    const w = (await buildWorkbench("finance-agent", real))!;
    const q = w.queues[0]!;
    expect(q.state).toMatchObject({ available: true });
    const html = renderToStaticMarkup(<AgentWorkbenchView view={w} />);
    expect(html).toContain("Refund of 4,000");
    expect(html).toContain("needs sheriff");
    const emptied = await buildWorkbench("finance-agent", {
      queue: async () => ({ available: true, items: [] }),
    });
    expect(renderToStaticMarkup(<AgentWorkbenchView view={emptied!} />)).toContain(
      emptied!.emptyState,
    );
  });

  it("a source that throws is reported as unavailable without its message", async () => {
    const w = (await buildWorkbench("finance-agent", {
      queue: async () => {
        throw new Error("row content: Ada Lovelace");
      },
    }))!;
    for (const q of w.queues)
      expect(q.state).toEqual({
        available: false,
        reason: "Not available: the data could not be read just now.",
      });
    expect(JSON.stringify(w)).not.toContain("Ada");
  });

  it("a queue that points outside the workspace is never read", async () => {
    const calls: string[] = [];
    const m = roster.find((x) => x.pack.code === "finance-agent")!;
    const widened = {
      ...m,
      workspace: {
        ...m.workspace,
        ui: {
          ...m.workspace.ui,
          queues: [{ id: "sneaky", title: "Sneaky queue", source: "payroll_secrets" }],
        },
      },
    };
    const w = (await buildWorkbench(
      "finance-agent",
      { queue: async (_a, _q, s) => (calls.push(s), { available: true, items: [] }) },
      [widened],
    ))!;
    expect(calls).toEqual([]);
    expect(w.queues[0]!.state).toEqual({
      available: false,
      reason: "Not available: this agent's workspace does not include that data.",
    });
  });

  it("the shipped source never invents rows", async () => {
    expect(await UNAVAILABLE_SOURCE.queue("a", "b", "c")).toEqual({
      available: false,
      reason: ENGINE_TABLES_NOTE,
    });
  });
});

describe("ENGINE-16 workbench screen", () => {
  it("renders every agent's workbench with queues, actions, pause control and no fake data", async () => {
    for (const code of codes) {
      const w = (await buildWorkbench(code))!;
      const html = renderToStaticMarkup(<AgentWorkbenchView view={w} />);
      expect(html, code).toContain(`data-testid="console-workbench-${code}"`);
      expect(html).toContain('data-testid="panel-workbench-queues"');
      expect(html).toContain('data-testid="panel-workbench-actions"');
      expect(html).toContain('data-testid="panel-workbench-pause"');
      expect(html).toContain("Read-only: nothing on this page changes the agent.");
      expect(html).toContain(ENGINE_TABLES_NOTE);
      for (const q of w.queues) expect(html).toContain(`data-testid="workbench-queue-${q.id}"`);
      for (const a of w.quickActions)
        expect(html).toContain(`data-testid="workbench-action-${a.id}"`);
      expect(html).not.toMatch(/<button(?![^>]*disabled)/);
    }
  });

  it("disabled actions are real disabled buttons and enabled ones are links to this agent's page", async () => {
    const w = (await buildWorkbench("finance-agent"))!;
    const html = renderToStaticMarkup(<AgentWorkbenchView view={w} />);
    const pause = w.quickActions.find((a) => a.kind === "pause_agent")!;
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(pause.disabledReason!.replace(/'/g, "&#x27;"));
    expect(html).toContain(`${CONSOLE_PATHS.workforceAgent("finance-agent")}#panel-proposals`);
  });

  it("the dashboard links to the workbench", () => {
    const d = buildAgentDashboard("finance-agent")!;
    const html = renderToStaticMarkup(<AgentDashboardView dashboard={d} />);
    expect(html).toContain('data-testid="open-workbench"');
    expect(html).toContain(CONSOLE_PATHS.workforceWorkbench("finance-agent"));
  });

  it("the workbench path is the route the router knows about", () => {
    expect(CONSOLE_PATHS.workforceWorkbench("a b")).toBe(
      `${CONSOLE_PATHS.workforce}/a%20b/workbench`,
    );
  });
});
