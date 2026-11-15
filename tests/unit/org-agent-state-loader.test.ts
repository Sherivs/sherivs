import { describe, expect, it } from "vitest";
import {
  EVENTS_SHOWN,
  loadAgentState,
  runAgentCall,
  type AgentDb,
} from "../../frontend/src/lib/org-workforce/agent-state-loader";
import { NOT_APPLIED_TEXT } from "../../frontend/src/lib/org-workforce/agent-actions";

const ORG = "22222222-2222-2222-2222-222222222222";
type E = { message: string; code?: string } | null;

function db(opts: {
  can?: { data: unknown; error: E };
  log?: { data: unknown; error: E };
  raised?: { data: unknown; error: E };
  rpcResult?: { data: unknown; error: E };
}) {
  const log: string[] = [];
  const filters: Record<string, unknown[]> = {};
  const client: AgentDb = {
    rpc(name, args) {
      log.push(`rpc:${name}:${JSON.stringify(args)}`);
      if (name === "scholar_can") return Promise.resolve(opts.can ?? { data: true, error: null });
      return Promise.resolve(opts.rpcResult ?? { data: null, error: null });
    },
    from(table) {
      log.push(`from:${table}`);
      const f = (filters[table] = [] as unknown[]);
      const q: Q = {
        eq: (c: string, v: unknown) => (f.push(["eq", c, v]), q),
        order: (c: string, o?: unknown) => (f.push(["order", c, o]), q),
        limit: (n: number) => (f.push(["limit", n]), q),
        then: (res: (r: unknown) => unknown) =>
          Promise.resolve(
            table === "org_agent_addon_events"
              ? (opts.log ?? { data: [], error: null })
              : (opts.raised ?? { data: [], error: null }),
          ).then(res),
      };
      return { select: () => q as never };
    },
  };
  return { client, log, filters };
}

type Q = {
  eq: (c: string, v: unknown) => Q;
  gt?: (c: string, v: unknown) => Q;
  lte?: (c: string, v: unknown) => Q;
  order: (c: string, o?: unknown) => Q;
  limit: (n: number) => Q;
  then: (res: (r: unknown) => unknown) => Promise<unknown>;
};

describe("loadAgentState", () => {
  it("asks for settings.manage first and reads nothing else for someone without it", async () => {
    for (const can of [
      { data: false, error: null },
      { data: null, error: null },
      { data: "true", error: null },
      { data: true, error: { message: "boom" } },
    ]) {
      const d = db({ can });
      const s = await loadAgentState(d.client, ORG);
      expect(s).toMatchObject({ canManage: false, applied: false, events: [], error: "" });
      expect(s.switches.enabledCodes).toEqual([]);
      expect(d.log).toEqual([
        `rpc:scholar_can:${JSON.stringify({ p_org: ORG, p_perm: "settings.manage" })}`,
      ]);
    }
  });

  it("reads nothing for a blank organization", async () => {
    const d = db({});
    expect((await loadAgentState(d.client, "  ")).canManage).toBe(false);
    expect(d.log).toEqual([]);
  });

  it("treats a missing table as not applied, without an error message", async () => {
    const d = db({
      log: { data: null, error: { code: "42P01", message: 'relation "x" does not exist' } },
    });
    const s = await loadAgentState(d.client, ORG);
    expect(s).toMatchObject({ canManage: true, applied: false, error: "" });
    expect(d.log).not.toContain("from:org_agent_events");
  });

  it("shows a plain sentence for any other read failure, never the database text", async () => {
    const d = db({
      log: { data: null, error: { code: "XX000", message: "internal secret detail" } },
    });
    const s = await loadAgentState(d.client, ORG);
    expect(s.applied).toBe(false);
    expect(s.error).not.toContain("secret");
    expect(s.error).toMatch(/could not be saved|not available/);
  });

  it("folds the log and sorts the events, scoped to the organization and limited", async () => {
    const d = db({
      log: {
        data: [
          { agent_code: "org-fees", action: "enable", seq: 1 },
          { agent_code: "org-fees", action: "pause", seq: 2 },
          { agent_code: "org-support", action: "enable", seq: 3 },
        ],
        error: null,
      },
      raised: {
        data: [
          {
            id: "a",
            agent_code: "org-fees",
            kind: "info",
            severity: "info",
            summary: "s",
            created_at: "2026-11-15T10:00:00Z",
            acked_at: null,
          },
          {
            id: "b",
            agent_code: "org-fees",
            kind: "money",
            severity: "critical",
            summary: "s",
            amount_minor: 100,
            created_at: "2026-11-14T10:00:00Z",
            acked_at: null,
          },
        ],
        error: null,
      },
    });
    const s = await loadAgentState(d.client, ORG);
    expect(s).toMatchObject({ canManage: true, applied: true, error: "" });
    expect(s.switches).toMatchObject({
      enabledCodes: ["org-fees", "org-support"],
      pausedCodes: ["org-fees"],
    });
    expect(s.events.map((e) => e.id)).toEqual(["b", "a"]);
    expect(d.filters.org_agent_addon_events).toContainEqual(["eq", "org_id", ORG]);
    expect(d.filters.org_agent_events).toContainEqual(["eq", "org_id", ORG]);
    expect(d.filters.org_agent_events).toContainEqual(["limit", EVENTS_SHOWN]);
    expect(d.filters.org_agent_events).toContainEqual([
      "order",
      "created_at",
      { ascending: false },
    ]);
  });

  it("keeps the switches when only the events fail to load", async () => {
    const d = db({
      log: { data: [{ agent_code: "org-fees", action: "enable", seq: 1 }], error: null },
      raised: { data: null, error: { message: "denied", code: "42501" } },
    });
    const s = await loadAgentState(d.client, ORG);
    expect(s.applied).toBe(true);
    expect(s.switches.enabledCodes).toEqual(["org-fees"]);
    expect(s.events).toEqual([]);
    expect(s.error).not.toBe("");
  });
});

describe("runAgentCall", () => {
  it("returns an empty string on success and a plain sentence on failure", async () => {
    expect(await runAgentCall(db({}).client, "ack_org_agent_event", { p_event: "e" })).toBe("");
    const failed = await runAgentCall(
      db({ rpcResult: { data: null, error: { message: "ERROR: plan_excludes_agent" } } }).client,
      "change_org_agent",
      {},
    );
    expect(failed).toMatch(/plan does not include/i);
    const missing = await runAgentCall(
      db({ rpcResult: { data: null, error: { code: "PGRST202", message: "x" } } }).client,
      "change_org_agent",
      {},
    );
    expect(missing).toBe(NOT_APPLIED_TEXT);
  });

  it("passes the name and arguments through unchanged", async () => {
    const d = db({});
    await runAgentCall(d.client, "change_org_agent", { p_org: ORG, p_agent: "org-fees" });
    expect(d.log).toEqual([
      `rpc:change_org_agent:${JSON.stringify({ p_org: ORG, p_agent: "org-fees" })}`,
    ]);
  });
});
