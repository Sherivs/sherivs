import { describe, expect, it } from "vitest";
import {
  EVENTS_SHOWN,
  loadAgentState,
  runAgentCall,
  type AgentDb,
} from "../../frontend/src/lib/org-workforce/agent-state-loader";
import { readFileSync } from "node:fs";
import { NOT_APPLIED_TEXT } from "../../frontend/src/lib/org-workforce/agent-actions";
import {
  parseHolders,
  rosterFromState,
} from "../../frontend/src/lib/org-workforce/agent-state-loader";
import { ORG_AGENTS } from "../../frontend/src/lib/org-workforce/org-agents";
import { buildOrgRoster } from "../../frontend/src/lib/org-workforce/roster-view";

const ORG = "22222222-2222-2222-2222-222222222222";
type E = { message: string; code?: string } | null;

function db(opts: {
  can?: { data: unknown; error: E };
  log?: { data: unknown; error: E };
  raised?: { data: unknown; error: E };
  rpcResult?: { data: unknown; error: E };
  holders?: { data: unknown; error: E };
}) {
  const log: string[] = [];
  const filters: Record<string, unknown[]> = {};
  const client: AgentDb = {
    rpc(name, args) {
      log.push(`rpc:${name}:${JSON.stringify(args)}`);
      if (name === "scholar_can") return Promise.resolve(opts.can ?? { data: true, error: null });
      if (name === "org_agent_holders")
        return Promise.resolve(opts.holders ?? { data: [], error: null });
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

describe("role holders (ENGINE-22)", () => {
  const fees = ORG_AGENTS.find((a) => a.pack.code === "org-fees")!;
  const log = {
    data: [{ agent_code: "org-fees", action: "enable", seq: 1 }],
    error: null,
  };
  const row = (id: string, role: string) => ({ holder_id: id, holder_role: role });
  const tenant = { tenantId: ORG, tier: "enterprise", active: true };
  const card = (s: Awaited<ReturnType<typeof loadAgentState>>) =>
    buildOrgRoster({
      tenant,
      addOnsApplied: s.applied,
      enabledCodes: s.switches.enabledCodes,
      members: s.members,
      holdersKnown: s.holdersKnown,
    }).included.find((c) => c.code === "org-fees")!;

  it("maps holders and shows Running when the accountable role is held", async () => {
    const d = db({
      log,
      holders: { data: [row("u1", fees.accountable), row("u2", "admin")], error: null },
    });
    const s = await loadAgentState(d.client, ORG);
    expect(s.holdersKnown).toBe(true);
    expect(s.members).toEqual([
      { identityId: "u1", role: fees.accountable, active: true, invitation: "accepted" },
      { identityId: "u2", role: "admin", active: true, invitation: "accepted" },
    ]);
    expect(card(s).status).toBe("active");
    expect(d.log).toContain(`rpc:org_agent_holders:${JSON.stringify({ p_org: ORG })}`);
  });

  it("shows Waiting only when the holders were read and nobody holds the role", async () => {
    const none = await loadAgentState(
      db({ log, holders: { data: [row("u2", "teacher")], error: null } }).client,
      ORG,
    );
    expect(none.holdersKnown).toBe(true);
    expect(card(none).status).toBe("waiting_for_holder");
    expect(card(none).statusLabel).toMatch(/Waiting/);
  });

  it("claims nothing about holders when the function is missing, and keeps the switches", async () => {
    const d = db({
      log,
      holders: { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
    });
    const s = await loadAgentState(d.client, ORG);
    expect(s).toMatchObject({ applied: true, holdersKnown: false, error: "", members: [] });
    expect(s.switches.enabledCodes).toEqual(["org-fees"]);
    expect(card(s).statusLabel).toMatch(/not checked/);
    expect(card(s).status).not.toBe("active");
  });

  it("claims nothing about holders on any other failure and says so in a sentence", async () => {
    const s = await loadAgentState(
      db({ log, holders: { data: null, error: { code: "XX000", message: "internal detail" } } })
        .client,
      ORG,
    );
    expect(s.holdersKnown).toBe(false);
    expect(s.error).not.toContain("internal detail");
    expect(s.error).not.toBe("");
    expect(s.switches.enabledCodes).toEqual(["org-fees"]);
    expect(s.events).toEqual([]);
  });

  it("does not ask for holders when the viewer cannot manage or the log is unreadable", async () => {
    const a = db({ can: { data: false, error: null } });
    await loadAgentState(a.client, ORG);
    expect(a.log.some((l) => l.includes("org_agent_holders"))).toBe(false);
    const b = db({ log: { data: null, error: { code: "42P01", message: "does not exist" } } });
    await loadAgentState(b.client, ORG);
    expect(b.log.some((l) => l.includes("org_agent_holders"))).toBe(false);
  });

  it("needs a clean answer: an error or a non-list means the holders are not known", async () => {
    const nulls = await loadAgentState(
      db({ log, holders: { data: null, error: null } }).client,
      ORG,
    );
    expect(nulls.holdersKnown).toBe(false);
    const both = await loadAgentState(
      db({ log, holders: { data: [row("u1", "bursar")], error: { code: "XX000", message: "x" } } })
        .client,
      ORG,
    );
    expect(both.holdersKnown).toBe(false);
    expect(both.members).toEqual([]);
  });

  it("builds the roster from the loaded state, and from nothing else", async () => {
    const school = { id: ORG, subscription_tier: "enterprise", subscription_status: "active" };
    const s = await loadAgentState(
      db({ log, holders: { data: [row("u1", fees.accountable)], error: null } }).client,
      ORG,
    );
    const view = rosterFromState(school, s);
    const c = view.included.find((x) => x.code === "org-fees")!;
    expect(c.status).toBe("active");
    expect(c.switchOn.enabled).toBe(false);
    expect(c.manage.switchOff).toBe(true);
    expect(
      rosterFromState({ ...school, subscription_status: "suspended" }, s).organizationActive,
    ).toBe(false);
    const missing = await loadAgentState(
      db({ log: { data: null, error: { code: "42P01", message: "does not exist" } } }).client,
      ORG,
    );
    const off = rosterFromState(school, missing).included[0]!;
    expect(off.switchOn.enabled).toBe(false);
    expect(off.switchOn.disabledReason).toMatch(/not applied/);
    const viewer = await loadAgentState(db({ can: { data: false, error: null } }).client, ORG);
    expect(rosterFromState(school, viewer).included[0]!.statusLabel).toBe("Included in your plan.");
  });

  it("drops malformed rows and roles that do not exist", () => {
    expect(parseHolders("nope")).toEqual([]);
    expect(
      parseHolders([
        row("u1", "bursar"),
        row("u2", "wizard"),
        { holder_id: 3, holder_role: "admin" },
        { holder_id: "u4" },
        null,
      ]).map((m) => m.identityId),
    ).toEqual(["u1"]);
  });
});

describe("ENGINE-22 SQL proposal stays in step with the app", () => {
  const sql = readFileSync("database/proposals/ENGINE-22_org_agent_role_holders.sql", "utf8");
  const live = sql.split("-- Rollback")[0]!;
  const e20 = readFileSync(
    "database/proposals/ENGINE-20_org_agent_addons_events_reports.sql",
    "utf8",
  );

  it("the function the loader calls exists with the columns the parser reads", () => {
    expect(live).toContain("FUNCTION public.org_agent_holders(p_org uuid)");
    expect(live).toContain("RETURNS TABLE (holder_id uuid, holder_role text)");
  });

  it("is gated on settings.manage and signed-in, and closed to anon and public", () => {
    expect(live).toContain("auth.uid() IS NULL");
    expect(live).toContain("scholar_can(p_org, 'settings.manage')");
    expect(live).toContain(
      "REVOKE ALL ON FUNCTION public.org_agent_holders(uuid) FROM PUBLIC, anon",
    );
    expect(live).toContain(
      "GRANT EXECUTE ON FUNCTION public.org_agent_holders(uuid) TO authenticated",
    );
    expect(live).not.toMatch(/TO[^;]*service_role/);
    expect(live).toContain("SET search_path = ''");
    expect(live).toContain("SECURITY DEFINER");
  });

  it("returns only active members of roles an agent answers to, never learners or parents", () => {
    expect(live).toContain("m.is_active");
    expect(live).toContain("SELECT DISTINCT c.accountable FROM public.org_agent_catalog c");
    const roles = new Set([...e20.matchAll(/\('org-[a-z-]+', '([a-z]+)'/g)].map((m) => m[1]!));
    expect(roles.size).toBeGreaterThan(0);
    for (const r of ["parent", "student", "alumni", "driver"]) expect(roles.has(r)).toBe(false);
    expect(new Set(ORG_AGENTS.map((a) => a.accountable))).toEqual(roles);
  });

  it("has a rollback that removes the function", () => {
    expect(sql).toContain("-- DROP FUNCTION IF EXISTS public.org_agent_holders(uuid);");
  });
});
