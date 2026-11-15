import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NOT_APPLIED_TEXT,
  REASON_MAX,
  REASON_MIN,
  SAFEGUARDING_NOTE,
  SCHOOL_AGENT_ACTIONS,
  eventHeadline,
  foldAddOnEvents,
  isNotApplied,
  messageForError,
  parseAddOnEvents,
  parseAgentEvents,
  planAgentAction,
  sortEvents,
} from "../../frontend/src/lib/org-workforce/agent-actions";
import { ORG_AGENTS } from "../../frontend/src/lib/org-workforce/org-agents";
import {
  HOLDERS_NOT_CHECKED,
  MANAGE_ONLY,
  PLATFORM_PAUSED,
  STATE_NOT_SHOWN,
  buildOrgRoster,
} from "../../frontend/src/lib/org-workforce/roster-view";
import {
  EVENTS_PER_ORG,
  runWeeklyReports,
  toOrgEvent,
  weekWindowEnd,
  type JobClient,
} from "../../frontend/src/lib/org-workforce/weekly-report-job.server";
import {
  AgentEventsPanel,
  OrgAgentRosterPanel,
} from "../../frontend/src/components/app-shell/org-workforce-panels";
import { Route } from "../../frontend/src/routes/api/public/cron/org-weekly-reports";

const SQL = readFileSync(
  "database/proposals/ENGINE-20_org_agent_addons_events_reports.sql",
  "utf8",
);
const CODES = ORG_AGENTS.map((a) => a.pack.code);
const ORG = "11111111-1111-1111-1111-111111111111";

type Q = {
  eq: (c: string, v: unknown) => Q;
  gt?: (c: string, v: unknown) => Q;
  lte?: (c: string, v: unknown) => Q;
  order: (c: string, o?: unknown) => Q;
  limit: (n: number) => Q;
  then: (res: (r: unknown) => unknown) => Promise<unknown>;
};

describe("planAgentAction", () => {
  const plan = (over: Partial<Parameters<typeof planAgentAction>[0]> = {}) =>
    planAgentAction({
      orgId: ORG,
      agentCode: CODES[0]!,
      action: "enable",
      knownCodes: CODES,
      ...over,
    });

  it("builds the exact change_org_agent call, with no reason on enable and disable", () => {
    const p = plan({ reason: "left over text from an earlier pause" });
    expect(p).toEqual({
      ok: true,
      call: {
        rpc: "change_org_agent",
        args: { p_org: ORG, p_agent: CODES[0], p_action: "enable", p_reason: null },
      },
    });
    const d = plan({ action: "disable", reason: "ignored ignored" });
    expect(d.ok && d.call.args.p_reason).toBeNull();
  });

  it("requires a trimmed reason of 10 to 300 characters to pause or resume", () => {
    for (const action of ["pause", "resume"]) {
      expect(plan({ action, reason: "" }).ok).toBe(false);
      expect(plan({ action, reason: "   short   " }).ok).toBe(false);
      expect(plan({ action, reason: "x".repeat(REASON_MIN - 1) }).ok).toBe(false);
      expect(plan({ action, reason: "x".repeat(REASON_MAX + 1) }).ok).toBe(false);
      const ok = plan({ action, reason: `  ${"x".repeat(REASON_MIN)}  ` });
      expect(ok.ok && ok.call.args.p_reason).toBe("x".repeat(REASON_MIN));
      expect(plan({ action, reason: "x".repeat(REASON_MAX) }).ok).toBe(true);
    }
  });

  it("never offers the platform's own actions, unknown actions, unknown agents or a blank organization", () => {
    expect(plan({ action: "platform_pause", reason: "x".repeat(20) }).ok).toBe(false);
    expect(plan({ action: "platform_resume", reason: "x".repeat(20) }).ok).toBe(false);
    expect(plan({ action: "delete" }).ok).toBe(false);
    expect(plan({ agentCode: "org-nope" }).ok).toBe(false);
    expect(plan({ orgId: "  " }).ok).toBe(false);
  });

  it("stays in step with the database: actions, reason bounds and error codes", () => {
    const allowed = /p_action NOT IN \(([^)]*)\)/.exec(SQL)![1]!;
    for (const a of SCHOOL_AGENT_ACTIONS) expect(allowed).toContain(`'${a}'`);
    expect(SQL).toContain(`char_length(v_reason) < ${REASON_MIN}`);
    expect(SQL).toContain(`char_length(v_reason) > ${REASON_MAX}`);
    expect(SQL).toContain("ack_org_agent_event(p_event uuid)");
    expect(SQL).toContain(
      "change_org_agent(p_org uuid, p_agent text, p_action text, p_reason text",
    );
    expect(SQL).toContain("scholar_can(p_org, 'settings.manage')");
    // Every error code the screen words is one the database can raise.
    for (const code of [
      "not_allowed",
      "organization_inactive",
      "plan_excludes_agent",
      "already_enabled",
      "not_enabled",
      "already_paused",
      "not_paused",
      "paused_by_platform",
      "reason_too_short",
      "reason_too_long",
      "unknown_agent",
    ]) {
      expect(SQL).toContain(`'${code}'`);
      expect(messageForError({ message: `${code}` })).not.toMatch(/could not be saved/);
    }
  });
});

describe("foldAddOnEvents matches org_agent_state", () => {
  const ev = (seq: number, agentCode: string, action: string) => ({ seq, agentCode, action });
  it("latest enable or disable decides on; latest pause or resume decides paused", () => {
    const s = foldAddOnEvents([
      ev(3, "a", "disable"),
      ev(1, "a", "enable"),
      ev(2, "b", "enable"),
      ev(4, "b", "pause"),
      ev(5, "c", "enable"),
      ev(6, "c", "platform_pause"),
      ev(7, "d", "enable"),
      ev(8, "d", "pause"),
      ev(9, "d", "resume"),
    ]);
    expect(s.enabledCodes).toEqual(["b", "c", "d"]);
    expect(s.pausedCodes).toEqual(["b", "c"]);
    expect(s.platformPausedCodes).toEqual(["c"]);
  });

  it("orders by seq, not by arrival", () => {
    const s = foldAddOnEvents([ev(2, "a", "disable"), ev(1, "a", "enable")]);
    expect(s.enabledCodes).toEqual([]);
    expect(foldAddOnEvents([ev(2, "a", "enable"), ev(1, "a", "disable")]).enabledCodes).toEqual([
      "a",
    ]);
  });

  it("a platform resume clears a platform pause", () => {
    const s = foldAddOnEvents([
      ev(1, "a", "enable"),
      ev(2, "a", "platform_pause"),
      ev(3, "a", "platform_resume"),
    ]);
    expect(s.pausedCodes).toEqual([]);
    expect(s.platformPausedCodes).toEqual([]);
  });

  it("keeps the SQL's own definition in view", () => {
    expect(SQL).toContain("action IN ('enable','disable')");
    expect(SQL).toContain("action IN ('pause','resume','platform_pause','platform_resume')");
  });

  it("parses rows defensively", () => {
    expect(parseAddOnEvents("nope")).toEqual([]);
    expect(
      parseAddOnEvents([{ agent_code: "a", action: "enable", seq: "5" }, { agent_code: 1 }, null]),
    ).toEqual([{ agentCode: "a", action: "enable", seq: 5 }]);
  });
});

describe("events and errors", () => {
  const raw = (over: Record<string, unknown>) => ({
    id: "e1",
    agent_code: "org-fees",
    kind: "money",
    severity: "urgent",
    summary: "Fee batch failed",
    amount_minor: "250000",
    created_at: "2026-11-15T10:00:00Z",
    acked_at: null,
    ...over,
  });

  it("never shows safeguarding text, even if a row carries some", () => {
    const [e] = parseAgentEvents([raw({ kind: "safeguarding", summary: "A child named X" })]);
    expect(e!.summary).toBeNull();
    expect(eventHeadline(e!)).toBe(SAFEGUARDING_NOTE);
    expect(
      renderToStaticMarkup(
        <AgentEventsPanel events={[e!]} busy={false} onAcknowledge={() => {}} />,
      ),
    ).not.toContain("child");
  });

  it("drops malformed rows and sorts open, severe, newest first", () => {
    const parsed = parseAgentEvents([
      raw({ id: "old-info", severity: "info", created_at: "2026-11-10T00:00:00Z" }),
      raw({ id: "acked", severity: "critical", acked_at: "2026-11-11T00:00:00Z" }),
      raw({ id: "urgent-new", severity: "urgent", created_at: "2026-11-14T00:00:00Z" }),
      raw({ id: "urgent-old", severity: "urgent", created_at: "2026-11-12T00:00:00Z" }),
      raw({ id: "crit", severity: "critical" }),
      raw({ id: "bad-kind", kind: "weather" }),
      raw({ id: "bad-sev", severity: "panic" }),
      { id: 7 },
    ]);
    expect(sortEvents(parsed).map((e) => e.id)).toEqual([
      "crit",
      "urgent-new",
      "urgent-old",
      "old-info",
      "acked",
    ]);
  });

  it("acknowledged events offer no second acknowledge button", () => {
    const events = parseAgentEvents([
      raw({ id: "x" }),
      raw({ id: "y", acked_at: "2026-11-15T11:00:00Z" }),
    ]);
    const html = renderToStaticMarkup(
      <AgentEventsPanel events={events} busy={false} onAcknowledge={() => {}} />,
    );
    expect(html.match(/Acknowledge</g)).toHaveLength(1);
    expect(html).toContain("2500.00 NGN");
    expect(
      renderToStaticMarkup(<AgentEventsPanel events={[]} busy={false} onAcknowledge={() => {}} />),
    ).toContain("Nothing has been raised.");
  });

  it("says plainly when the proposal is not applied and never leaks raw database text", () => {
    for (const e of [
      { code: "PGRST202", message: "Could not find the function public.change_org_agent" },
      { code: "42P01", message: 'relation "org_agent_events" does not exist' },
    ]) {
      expect(isNotApplied(e)).toBe(true);
      expect(messageForError(e)).toBe(NOT_APPLIED_TEXT);
    }
    expect(isNotApplied({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isNotApplied({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isNotApplied({ code: "42883", message: "x" })).toBe(true);
    expect(isNotApplied({ code: "42501", message: "not_allowed" })).toBe(false);
    expect(isNotApplied(null)).toBe(false);
    const leak = messageForError({
      message: "duplicate key value violates unique constraint org_x_pkey",
    });
    expect(leak).not.toContain("org_x_pkey");
    expect(messageForError({ message: "P0001: paused_by_platform" })).toMatch(/platform/);
    expect(messageForError(null)).toBe("");
  });
});

describe("roster with real state", () => {
  const tenant = { tenantId: ORG, tier: "enterprise", active: true };
  const first = ORG_AGENTS[0]!.pack.code;
  const second = ORG_AGENTS[1]!.pack.code;
  const find = (v: ReturnType<typeof buildOrgRoster>, code: string) =>
    [...v.included, ...v.upgrade].find((c) => c.code === code)!;

  it("enables Switch on only when the tables exist and the agent is available", () => {
    expect(find(buildOrgRoster({ tenant, addOnsApplied: false }), first).switchOn.enabled).toBe(
      false,
    );
    expect(find(buildOrgRoster({ tenant, addOnsApplied: true }), first).switchOn.enabled).toBe(
      true,
    );
    const on = buildOrgRoster({ tenant, addOnsApplied: true, enabledCodes: [first] });
    expect(find(on, first).switchOn.enabled).toBe(false);
    expect(find(on, first).manage.switchOff).toBe(true);
  });

  it("does not claim someone is missing when holders were never loaded", () => {
    const view = buildOrgRoster({
      tenant,
      addOnsApplied: true,
      enabledCodes: [first],
      holdersKnown: false,
    });
    expect(find(view, first).statusLabel).toBe(HOLDERS_NOT_CHECKED);
    const known = buildOrgRoster({ tenant, addOnsApplied: true, enabledCodes: [first] });
    expect(find(known, first).statusLabel).toMatch(/Waiting/);
  });

  it("claims nothing about what is on for someone who may not see it", () => {
    const view = buildOrgRoster({
      tenant,
      addOnsApplied: false,
      stateKnown: false,
      enabledCodes: [first],
    });
    expect(find(view, first).statusLabel).toBe(STATE_NOT_SHOWN);
    expect(find(view, second).switchOn.disabledReason).toBe(MANAGE_ONLY);
    expect(find(view, first).manage.switchOff).toBe(false);
    const applied = buildOrgRoster({
      tenant,
      addOnsApplied: true,
      stateKnown: false,
      enabledCodes: [first],
    });
    expect(find(applied, first).manage.switchOff).toBe(false);
  });

  it("offers pause on a running agent and resume on a paused one, but not a platform pause", () => {
    const on = buildOrgRoster({ tenant, addOnsApplied: true, enabledCodes: [first] });
    expect(find(on, first).manage).toMatchObject({ pause: true, resume: false });
    const paused = buildOrgRoster({
      tenant,
      addOnsApplied: true,
      enabledCodes: [first],
      pausedCodes: [first],
    });
    expect(find(paused, first).manage).toMatchObject({ pause: false, resume: true });
    const held = buildOrgRoster({
      tenant,
      addOnsApplied: true,
      enabledCodes: [first],
      pausedCodes: [first],
      platformPausedCodes: [first],
    });
    expect(find(held, first).manage).toMatchObject({
      resume: false,
      resumeBlockedReason: PLATFORM_PAUSED,
    });
  });

  it("renders Switch on enabled only when wired and available", () => {
    const view = buildOrgRoster({ tenant, addOnsApplied: true });
    const wired = renderToStaticMarkup(
      <OrgAgentRosterPanel view={view} actions={{ busy: false, onAction: () => {} }} />,
    );
    const unwired = renderToStaticMarkup(<OrgAgentRosterPanel view={view} />);
    const enabledButtons = (h: string) =>
      (h.match(/<button(?![^>]*\sdisabled="")[^>]*>Switch on</g) ?? []).length;
    expect(enabledButtons(wired)).toBeGreaterThan(0);
    expect(enabledButtons(unwired)).toBe(0);
    const busy = renderToStaticMarkup(
      <OrgAgentRosterPanel view={view} actions={{ busy: true, onAction: () => {} }} />,
    );
    expect(enabledButtons(busy)).toBe(0);
  });
});

describe("weekly window", () => {
  const w = (iso: string) => weekWindowEnd(new Date(iso)).toISOString();
  it("is the most recent Monday 06:30 UTC at or before now", () => {
    expect(w("2026-11-15T14:00:00Z")).toBe("2026-11-09T06:30:00.000Z"); // Sunday
    expect(w("2026-11-16T06:30:00Z")).toBe("2026-11-16T06:30:00.000Z"); // exactly Monday 06:30
    expect(w("2026-11-16T06:29:59Z")).toBe("2026-11-09T06:30:00.000Z"); // a second before
    expect(w("2026-11-16T06:29:59.999Z")).toBe("2026-11-09T06:30:00.000Z"); // a millisecond before
    expect(w("2026-11-16T09:00:00Z")).toBe("2026-11-16T06:30:00.000Z"); // later Monday
    expect(w("2026-11-18T12:00:00Z")).toBe("2026-11-16T06:30:00.000Z"); // Wednesday
    expect(w("2026-12-01T00:00:00Z")).toBe("2026-11-30T06:30:00.000Z"); // across the month
    expect(w("2027-01-03T10:00:00Z")).toBe("2026-12-28T06:30:00.000Z"); // across the year
  });
  it("is Monday 07:30 in Lagos, the time the report is promised", () => {
    const d = weekWindowEnd(new Date("2026-11-18T12:00:00Z"));
    expect(d.getUTCDay()).toBe(1);
    expect(new Date(d.getTime() + 60 * 60 * 1000).toISOString().slice(11, 16)).toBe("07:30");
  });
});

describe("runWeeklyReports", () => {
  type Call = { table: string; filters: [string, unknown][] };
  function stub(opts: {
    requestResult?: { data: unknown; error: { message: string; code?: string } | null };
    reports?: { id: string; org_id: string }[];
    events?: Record<string, Record<string, unknown>[]>;
    failStoreFor?: string;
  }) {
    const rpcs: { name: string; args: Record<string, unknown> }[] = [];
    const reads: Call[] = [];
    const client: JobClient = {
      rpc(name, args) {
        rpcs.push({ name, args });
        if (name === "request_org_weekly_reports")
          return Promise.resolve(opts.requestResult ?? { data: 2, error: null });
        if (name === "store_org_weekly_report" && args.p_id === opts.failStoreFor)
          return Promise.resolve({ data: null, error: { message: "report_not_requested" } });
        return Promise.resolve({ data: null, error: null });
      },
      from(table) {
        const call: Call = { table, filters: [] };
        reads.push(call);
        const q: Q = {
          eq: (c: string, v: unknown) => (call.filters.push([`eq:${c}`, v]), q),
          gt: (c: string, v: unknown) => (call.filters.push([`gt:${c}`, v]), q),
          lte: (c: string, v: unknown) => (call.filters.push([`lte:${c}`, v]), q),
          order: () => q,
          limit: (n: number) => (call.filters.push(["limit", n]), q),
          then: (res: (r: unknown) => unknown) => {
            const org = call.filters.find(([k]) => k === "eq:org_id")?.[1] as string | undefined;
            const data =
              table === "org_weekly_reports"
                ? (opts.reports ?? [])
                : ((org && opts.events?.[org]) ?? []);
            return Promise.resolve({ data, error: null }).then(res);
          },
        };
        return { select: () => q as never };
      },
    };
    return { client, rpcs, reads };
  }
  const NOW = new Date("2026-11-16T06:31:00Z");
  const event = (over: Record<string, unknown> = {}) => ({
    id: "e1",
    agent_code: "org-fees",
    kind: "money",
    severity: "urgent",
    summary: "Fee batch failed",
    amount_minor: 150000,
    created_at: "2026-11-12T10:00:00Z",
    acked_at: null,
    dedupe_key: null,
    ...over,
  });

  it("asks for the deterministic window, builds each report from its own organization, and sends nothing", async () => {
    const s = stub({
      reports: [
        { id: "r1", org_id: "orgA" },
        { id: "r2", org_id: "orgB" },
      ],
      events: {
        orgA: [
          event(),
          event({
            id: "s1",
            kind: "safeguarding",
            summary: "Named child text",
            amount_minor: null,
          }),
        ],
        orgB: [],
      },
    });
    const out = await runWeeklyReports({ admin: s.client, now: NOW });
    expect(out).toMatchObject({
      status: "ok",
      windowEnd: "2026-11-16T06:30:00.000Z",
      newlyRequested: 2,
      built: 2,
      sent: 0,
      failed: [],
    });
    expect(s.rpcs[0]).toEqual({
      name: "request_org_weekly_reports",
      args: { p_window_end: "2026-11-16T06:30:00.000Z" },
    });
    const stores = s.rpcs.filter((r) => r.name === "store_org_weekly_report");
    expect(stores.map((r) => r.args.p_id)).toEqual(["r1", "r2"]);
    const a = stores[0]!.args;
    expect(a.p_channel).toBe("email");
    expect(JSON.stringify(a)).not.toContain("Named child");
    expect(
      (a.p_totals as { byKind: { safeguarding: number; money: number } }).byKind,
    ).toMatchObject({ safeguarding: 1, money: 1 });
    expect((stores[1]!.args.p_totals as { events: number }).events).toBe(0);
    // Every event read is scoped to one organization and to the seven-day window.
    const eventReads = s.reads.filter((r) => r.table === "org_agent_events");
    expect(eventReads.map((r) => r.filters.find(([k]) => k === "eq:org_id")![1])).toEqual([
      "orgA",
      "orgB",
    ]);
    for (const r of eventReads) {
      expect(r.filters).toContainEqual(["gt:created_at", "2026-11-09T06:30:00.000Z"]);
      expect(r.filters).toContainEqual(["lte:created_at", "2026-11-16T06:30:00.000Z"]);
      expect(r.filters).toContainEqual(["limit", EVENTS_PER_ORG]);
    }
    const pendingRead = s.reads.find((r) => r.table === "org_weekly_reports")!;
    expect(pendingRead.filters).toContainEqual(["eq:status", "requested"]);
    expect(pendingRead.filters).toContainEqual(["eq:window_end", "2026-11-16T06:30:00.000Z"]);
  });

  it("one organization failing does not stop the others", async () => {
    const s = stub({
      reports: [
        { id: "r1", org_id: "orgA" },
        { id: "r2", org_id: "orgB" },
      ],
      failStoreFor: "r1",
    });
    const out = await runWeeklyReports({ admin: s.client, now: NOW });
    expect(out).toMatchObject({ status: "ok", built: 1 });
    expect(out.status === "ok" && out.failed).toEqual([
      { reportId: "r1", error: "report_not_requested" },
    ]);
  });

  it("reports not_applied when the function is missing, and throws on any other failure", async () => {
    const missing = stub({
      requestResult: {
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      },
    });
    expect(await runWeeklyReports({ admin: missing.client, now: NOW })).toEqual({
      status: "not_applied",
    });
    expect(missing.rpcs.filter((r) => r.name === "store_org_weekly_report")).toHaveLength(0);
    const bad = stub({
      requestResult: { data: null, error: { code: "42501", message: "service_role_only" } },
    });
    await expect(runWeeklyReports({ admin: bad.client, now: NOW })).rejects.toThrow(
      "service_role_only",
    );
  });

  it("a repeat run in the same week asks for the same window", async () => {
    const s = stub({});
    await runWeeklyReports({ admin: s.client, now: new Date("2026-11-16T06:31:00Z") });
    await runWeeklyReports({ admin: s.client, now: new Date("2026-11-19T15:00:00Z") });
    const asked = s.rpcs
      .filter((r) => r.name === "request_org_weekly_reports")
      .map((r) => r.args.p_window_end);
    expect(asked[0]).toBe(asked[1]);
  });

  it("maps rows safely", () => {
    expect(toOrgEvent(event({ kind: "weather" }), "o")).toBeNull();
    expect(toOrgEvent(null, "o")).toBeNull();
    expect(toOrgEvent(event({ kind: "safeguarding", summary: "x" }), "o")!.summary).toBe("");
    expect(toOrgEvent(event(), "o")).toMatchObject({ tenantId: "o", amountMinor: 150000 });
  });
});

describe("cron route", () => {
  const handler = (
    Route as unknown as {
      options: { server: { handlers: { POST: (i: { request: Request }) => Promise<Response> } } };
    }
  ).options.server.handlers.POST;
  const call = (auth?: string) =>
    handler({
      request: new Request("https://x.test/api/public/cron/org-weekly-reports", {
        method: "POST",
        ...(auth ? { headers: { authorization: auth } } : {}),
      }),
    });

  it("is closed until CRON_SECRET is set, and rejects a wrong or missing secret", async () => {
    const prev = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect((await call("Bearer anything")).status).toBe(503);
      process.env.CRON_SECRET = "s3cret-value-for-test-only-0123456789";
      expect((await call()).status).toBe(401);
      expect((await call("Bearer wrong")).status).toBe(401);
      expect((await call("Bearer s3cret-value-for-test-only-012345678X")).status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});
