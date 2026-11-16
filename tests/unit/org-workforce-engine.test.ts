import { describe, expect, it } from "vitest";
import { ORG_AGENTS } from "../../frontend/src/lib/org-workforce/org-agents";
import {
  holdersOf,
  isEligibleHolder,
  planOrgAgentActivation,
  reportTargets,
  type MemberFact,
} from "../../frontend/src/lib/org-workforce/activation";
import {
  ACK_WINDOW_MIN,
  buildWeeklyReport,
  collapseDuplicates,
  isQuietHour,
  nextWeeklySendAt,
  overdueForEscalation,
  pickChannel,
  quietEndsAt,
  routeEvent,
  type OrgEvent,
  type Recipient,
} from "../../frontend/src/lib/org-workforce/escalation";
import { buildContextSwitcher } from "../../frontend/src/lib/org-workforce/context-switcher";

const member = (
  identityId: string,
  role: MemberFact["role"],
  over: Partial<MemberFact> = {},
): MemberFact => ({
  identityId,
  role,
  active: true,
  invitation: "accepted",
  ...over,
});
const tenant = (tier: string | null, active = true) => ({ tenantId: "t1", tier, active });
const status = (plan: ReturnType<typeof planOrgAgentActivation>, code: string) =>
  plan.find((p) => p.code === code)!;

describe("ENGINE-18 activation", () => {
  const members = [
    member("bursar-1", "bursar"),
    member("admin-1", "admin"),
    member("principal-1", "principal"),
  ];

  it("covers all seventeen agents, deterministically", () => {
    const a = planOrgAgentActivation({ tenant: tenant("enterprise"), members, enabledCodes: [] });
    expect(a).toHaveLength(17);
    expect(a).toEqual(
      planOrgAgentActivation({ tenant: tenant("enterprise"), members, enabledCodes: [] }),
    );
  });

  it("is active only when entitled, switched on, not paused and held", () => {
    const run = (over: object) =>
      status(
        planOrgAgentActivation({
          tenant: tenant("starter"),
          members,
          enabledCodes: ["org-fees"],
          ...over,
        }),
        "org-fees",
      );
    expect(run({})).toMatchObject({ status: "active", holders: ["bursar-1"], reason: "ok" });
    expect(run({ pausedCodes: ["org-fees"] }).status).toBe("paused");
    expect(run({ enabledCodes: [] })).toMatchObject({ status: "available", holders: [] });
    expect(run({ members: [] })).toMatchObject({ status: "waiting_for_holder", holders: [] });
    expect(run({ tenant: tenant("trial") })).toMatchObject({
      status: "locked",
      minTier: "starter",
    });
    expect(run({ tenant: tenant("starter", false) }).status).toBe("tenant_inactive");
    expect(run({ tenant: { tenantId: "  ", tier: "enterprise", active: true } })).toMatchObject({
      status: "tenant_inactive",
      reason: "no_tenant",
    });
  });

  it("precedence: inactive beats locked, locked beats available, available beats paused", () => {
    const base = { members, enabledCodes: ["org-fees"], pausedCodes: ["org-fees"] };
    expect(
      status(planOrgAgentActivation({ ...base, tenant: tenant("trial", false) }), "org-fees")
        .status,
    ).toBe("tenant_inactive");
    expect(
      status(planOrgAgentActivation({ ...base, tenant: tenant("trial") }), "org-fees").status,
    ).toBe("locked");
    expect(
      status(
        planOrgAgentActivation({ ...base, tenant: tenant("starter"), enabledCodes: [] }),
        "org-fees",
      ).status,
    ).toBe("available");
    expect(
      status(planOrgAgentActivation({ ...base, tenant: tenant("starter") }), "org-fees").status,
    ).toBe("paused");
  });

  it("an unknown plan is the trial: only the support agent can run", () => {
    const plan = planOrgAgentActivation({
      tenant: tenant("mystery"),
      members,
      enabledCodes: ORG_AGENTS.map((a) => a.pack.code),
    });
    expect(plan.filter((p) => p.status === "locked")).toHaveLength(16);
    expect(plan.filter((p) => p.status === "active").map((p) => p.code)).toEqual(["org-support"]);
  });

  it("a holder needs an active membership AND an accepted invitation, in the accountable role", () => {
    for (const invitation of ["pending", "expired", "revoked", "none"] as const) {
      expect(isEligibleHolder(member("x", "bursar", { invitation }))).toBe(false);
    }
    expect(isEligibleHolder(member("x", "bursar", { active: false }))).toBe(false);
    expect(isEligibleHolder(member("x", "bursar"))).toBe(true);
    const rows = [
      member("a", "bursar", { invitation: "pending" }),
      member("b", "bursar", { active: false }),
      member("c", "teacher"),
      member("d", "bursar"),
      member("d", "bursar"),
      member("e", "bursar"),
    ];
    expect(holdersOf(rows, "bursar")).toEqual(["d", "e"]);
  });

  it("one person with two roles holds both: the same identity can serve two agents", () => {
    const both = [member("p", "bursar"), member("p", "principal")];
    const plan = planOrgAgentActivation({
      tenant: tenant("growth"),
      members: both,
      enabledCodes: ["org-fees", "org-attendance"],
    });
    expect(status(plan, "org-fees").holders).toEqual(["p"]);
    expect(status(plan, "org-attendance").holders).toEqual(["p"]);
  });

  it("the twin reports to admin, else principal, else hq, else nobody", () => {
    expect(reportTargets(members)).toEqual({ role: "admin", holders: ["admin-1"] });
    expect(
      reportTargets([member("a", "admin", { invitation: "pending" }), member("p", "principal")]),
    ).toEqual({
      role: "principal",
      holders: ["p"],
    });
    expect(reportTargets([member("h", "hq"), member("t", "teacher")])).toEqual({
      role: "hq",
      holders: ["h"],
    });
    expect(reportTargets([member("t", "teacher")])).toEqual({ role: null, holders: [] });
  });
});

const R = (id: string, over: Partial<Recipient> = {}): Recipient => ({
  identityId: id,
  push: true,
  whatsapp: true,
  email: true,
  ...over,
});
const ev = (over: Partial<OrgEvent> = {}): OrgEvent => ({
  id: "e1",
  tenantId: "t1",
  agentCode: "org-fees",
  kind: "operations",
  severity: "attention",
  summary: "Something happened",
  at: "2026-11-16T10:00:00.000Z",
  ...over,
});
const NOON = "2026-11-16T11:00:00.000Z"; // 12:00 Lagos
const NIGHT = "2026-11-15T21:30:00.000Z"; // 22:30 Lagos
const who = { accountable: [R("acc")], administrators: [R("adm")] };

describe("ENGINE-18 routing", () => {
  it("every money event reaches the administrator by push at once, even a tiny one", () => {
    for (const amountMinor of [1, 100, 5_000_000]) {
      const d = routeEvent(ev({ kind: "money", severity: "info", amountMinor }), who, NOON);
      const adm = d.notifications.filter((n) => n.toRole === "administrator");
      expect(adm).toEqual([
        expect.objectContaining({ identityId: "adm", channel: "push", when: "now" }),
      ]);
      expect(d.reasons).toContain("money_event_to_administrator");
      expect(d.inWeeklyReport).toBe(true);
    }
  });

  it("money is not held by quiet hours and a quiet-hour money push goes out now", () => {
    const d = routeEvent(ev({ kind: "money" }), who, NIGHT);
    expect(d.notifications.find((n) => n.toRole === "administrator")).toMatchObject({
      when: "now",
    });
  });

  it("an ordinary event stays with the accountable role and the weekly report", () => {
    const d = routeEvent(ev({ severity: "attention" }), who, NOON);
    expect(d.notifications).toEqual([
      expect.objectContaining({ identityId: "acc", channel: "in_app", toRole: "accountable" }),
    ]);
    expect(d.notifications.some((n) => n.toRole === "administrator")).toBe(false);
    expect(d.inWeeklyReport).toBe(true);
  });

  it("info events are not in the weekly report unless money", () => {
    expect(routeEvent(ev({ severity: "info" }), who, NOON).inWeeklyReport).toBe(false);
    expect(routeEvent(ev({ severity: "info", kind: "money" }), who, NOON).inWeeklyReport).toBe(
      true,
    );
  });

  it("urgent goes to the accountable role by push but not yet to the administrator", () => {
    const d = routeEvent(ev({ severity: "urgent" }), who, NOON);
    expect(d.notifications).toEqual([
      expect.objectContaining({ identityId: "acc", channel: "push", when: "now" }),
    ]);
  });

  it("critical reaches both, now, even at night", () => {
    const d = routeEvent(ev({ severity: "critical" }), who, NIGHT);
    expect(d.notifications.map((n) => [n.toRole, n.channel, n.when])).toEqual([
      ["accountable", "push", "now"],
      ["administrator", "push", "now"],
    ]);
  });

  it("quiet hours hold a non-critical push until the quiet period ends", () => {
    const d = routeEvent(ev({ severity: "urgent" }), who, NIGHT);
    expect(d.notifications[0]).toMatchObject({
      when: "held",
      heldUntil: "2026-11-16T05:00:00.000Z",
    });
  });

  it("safeguarding notifications are marked redacted; others are not", () => {
    const s = routeEvent(
      ev({ kind: "safeguarding", severity: "critical", agentCode: "org-safeguarding" }),
      who,
      NOON,
    );
    expect(s.notifications.length).toBeGreaterThan(0);
    expect(s.notifications.every((n) => n.redacted)).toBe(true);
    expect(
      routeEvent(ev({ severity: "critical" }), who, NOON).notifications.every((n) => !n.redacted),
    ).toBe(true);
  });

  it("falls back push, whatsapp, email, in-app", () => {
    expect(pickChannel(R("x"))).toBe("push");
    expect(pickChannel(R("x", { push: false }))).toBe("whatsapp");
    expect(pickChannel(R("x", { push: false, whatsapp: false }))).toBe("email");
    expect(pickChannel(R("x", { push: false, whatsapp: false, email: false }))).toBe("in_app");
    const d = routeEvent(
      ev({ kind: "money" }),
      { accountable: [], administrators: [R("a", { push: false })] },
      NOON,
    );
    expect(d.notifications[0]!.channel).toBe("whatsapp");
  });

  it("an event nobody can receive is unroutable, not dropped; an unknown agent is refused", () => {
    expect(routeEvent(ev(), { accountable: [], administrators: [] }, NOON)).toMatchObject({
      unroutable: true,
      reasons: expect.arrayContaining(["no_recipient"]),
    });
    expect(routeEvent(ev({ agentCode: "org-nope" }), who, NOON)).toMatchObject({
      unroutable: true,
      notifications: [],
      reasons: ["unknown_agent"],
    });
  });
});

describe("ENGINE-18 quiet hours, escalation and weekly time", () => {
  it("quiet hours are 22:00 to 06:00 Lagos", () => {
    expect(isQuietHour("2026-11-15T20:59:00.000Z")).toBe(false);
    expect(isQuietHour("2026-11-15T21:00:00.000Z")).toBe(true);
    expect(isQuietHour("2026-11-16T04:59:00.000Z")).toBe(true);
    expect(isQuietHour("2026-11-16T05:00:00.000Z")).toBe(false);
    expect(quietEndsAt("2026-11-15T21:30:00.000Z")).toBe("2026-11-16T05:00:00.000Z");
    expect(quietEndsAt("2026-11-16T03:00:00.000Z")).toBe("2026-11-16T05:00:00.000Z");
    expect(quietEndsAt(NOON)).toBe(NOON);
  });

  it("an unacknowledged event moves up after its window, and an acknowledged one does not", () => {
    expect(ACK_WINDOW_MIN).toEqual({ info: null, attention: 1440, urgent: 60, critical: 15 });
    const at = "2026-11-16T10:00:00.000Z";
    const events = [
      ev({ id: "c", severity: "critical", at }),
      ev({ id: "u", severity: "urgent", at }),
      ev({ id: "a", severity: "attention", at }),
      ev({ id: "i", severity: "info", at }),
      ev({ id: "done", severity: "critical", at, ackedAt: "2026-11-16T10:01:00.000Z" }),
    ];
    expect(overdueForEscalation(events, "2026-11-16T10:14:59.000Z")).toEqual([]);
    expect(overdueForEscalation(events, "2026-11-16T10:15:00.000Z")).toEqual(["c"]);
    expect(overdueForEscalation(events, "2026-11-16T11:00:00.000Z")).toEqual(["c", "u"]);
    expect(overdueForEscalation(events, "2026-11-17T10:00:00.000Z")).toEqual(["a", "c", "u"]);
  });

  it("repeats within an hour collapse; an hour apart or no key are kept", () => {
    const base = { dedupeKey: "k", kind: "money" as const };
    const kept = collapseDuplicates([
      ev({ id: "1", ...base, at: "2026-11-16T10:00:00.000Z" }),
      ev({ id: "2", ...base, at: "2026-11-16T10:30:00.000Z" }),
      ev({ id: "3", ...base, at: "2026-11-16T11:00:00.000Z" }),
      ev({ id: "4", at: "2026-11-16T10:31:00.000Z" }),
      ev({ id: "5", at: "2026-11-16T10:32:00.000Z" }),
      ev({ id: "6", ...base, agentCode: "org-roll", at: "2026-11-16T10:10:00.000Z" }),
    ]);
    expect(kept.map((e) => e.id)).toEqual(["1", "6", "4", "5", "3"]);
  });

  it("the weekly send is the next Monday 07:30 Lagos, strictly in the future", () => {
    expect(nextWeeklySendAt("2026-11-15T12:00:00.000Z")).toBe("2026-11-16T06:30:00.000Z");
    expect(nextWeeklySendAt("2026-11-16T06:00:00.000Z")).toBe("2026-11-16T06:30:00.000Z");
    expect(nextWeeklySendAt("2026-11-16T06:30:00.000Z")).toBe("2026-11-23T06:30:00.000Z");
    expect(nextWeeklySendAt("2026-11-18T09:00:00.000Z")).toBe("2026-11-23T06:30:00.000Z");
  });
});

describe("ENGINE-18 weekly report", () => {
  const end = "2026-11-16T06:00:00.000Z";
  const wev = (over: Partial<OrgEvent> = {}): OrgEvent =>
    ev({ at: "2026-11-12T10:00:00.000Z", ...over });
  const input = (events: OrgEvent[], verified = true) => ({
    tenantId: "t1",
    events,
    windowEndIso: end,
    administratorWhatsappVerified: verified,
  });

  it("counts only this tenant and the seven days ending at the window end", () => {
    const r = buildWeeklyReport(
      input([
        wev({ id: "in", at: "2026-11-12T10:00:00.000Z" }),
        wev({ id: "other-tenant", tenantId: "t2", at: "2026-11-12T10:00:00.000Z" }),
        wev({ id: "too-old", at: "2026-11-09T06:00:00.000Z" }),
        wev({ id: "edge-in", at: "2026-11-16T06:00:00.000Z" }),
        wev({ id: "future", at: "2026-11-16T06:00:01.000Z" }),
      ]),
    );
    expect(r.totals.events).toBe(2);
    expect(r.windowStart).toBe("2026-11-09T06:00:00.000Z");
  });

  it("sums money in minor units, ignores a negative or missing amount, and reports it", () => {
    const r = buildWeeklyReport(
      input([
        wev({ id: "1", kind: "money", amountMinor: 250_000 }),
        wev({ id: "2", kind: "money", amountMinor: 5_050 }),
        wev({ id: "3", kind: "money", amountMinor: -999 }),
        wev({ id: "4", kind: "money" }),
      ]),
    );
    expect(r.totals).toMatchObject({ money: 4, moneyTotalMinor: 255_050 });
    expect(r.lines[1]).toBe("Money: 4 events, 2550.50 NGN in total.");
  });

  it("never copies safeguarding content into the report", () => {
    const secret = "Pupil Ada Obi disclosed abuse at home";
    const r = buildWeeklyReport(
      input([
        wev({
          kind: "safeguarding",
          severity: "critical",
          agentCode: "org-safeguarding",
          summary: secret,
        }),
      ]),
    );
    expect(JSON.stringify(r)).not.toContain("Ada Obi");
    expect(r.lines.join(" ")).toContain("1 safeguarding item. Open the console to view them.");
    expect(r.totals.byKind.safeguarding).toBe(1);
  });

  it("lists urgent items, clips long text, and counts unanswered urgent ones", () => {
    const long = "x".repeat(300);
    const r = buildWeeklyReport(
      input([
        wev({ id: "1", severity: "urgent", summary: long }),
        wev({
          id: "2",
          severity: "critical",
          ackedAt: "2026-11-13T10:00:00.000Z",
          at: "2026-11-13T09:00:00.000Z",
        }),
      ]),
    );
    expect(r.totals.unacknowledgedUrgent).toBe(1);
    expect(r.lines.some((l) => l === `org-fees: ${"x".repeat(137)}...`)).toBe(true);
    expect(r.lines).toContain("1 urgent item still need a reply.");
  });

  it("uses WhatsApp only when verified, otherwise email, and sends next Monday 07:30", () => {
    expect(buildWeeklyReport(input([], true)).channel).toBe("whatsapp");
    expect(buildWeeklyReport(input([], false)).channel).toBe("email");
    expect(buildWeeklyReport(input([])).sendAt).toBe("2026-11-16T06:30:00.000Z");
    expect(buildWeeklyReport(input([])).lines[0]).toBe("0 items this week.");
  });

  it("per-agent rows are sorted and count urgent events", () => {
    const r = buildWeeklyReport(
      input([
        wev({ id: "1", agentCode: "org-roll", severity: "urgent" }),
        wev({ id: "2", agentCode: "org-fees" }),
        wev({ id: "3", agentCode: "org-roll" }),
      ]),
    );
    expect(r.perAgent).toEqual([
      { agentCode: "org-fees", events: 1, urgent: 0 },
      { agentCode: "org-roll", events: 2, urgent: 1 },
    ]);
  });
});

describe("ENGINE-18 context switcher", () => {
  const rows = [
    { organizationId: "o2", organizationName: "Zenith College", role: "teacher", active: true },
    { organizationId: "o1", organizationName: "Alpha School", role: "principal", active: true },
    { organizationId: "o1", organizationName: "Alpha School", role: "teacher", active: true },
    { organizationId: "o3", organizationName: "Old School", role: "parent", active: false },
  ];

  it("groups by organization, lists each role, and drops inactive memberships", () => {
    const v = buildContextSwitcher(rows, { organizationId: "o1", role: "teacher" });
    expect(v.organizations.map((o) => o.name)).toEqual(["Alpha School", "Zenith College"]);
    expect(v.organizations[0]!.roles).toEqual([
      { role: "principal", current: false },
      { role: "teacher", current: true },
    ]);
    expect(v.organizations[0]!.current).toBe(true);
    expect(v.organizations[1]!.current).toBe(false);
    expect(v.canSwitch).toBe(true);
  });

  it("one context offers nothing to switch to, and nothing yields an empty view", () => {
    expect(
      buildContextSwitcher([rows[0]!], { organizationId: "o2", role: "teacher" }).canSwitch,
    ).toBe(false);
    expect(buildContextSwitcher([], null)).toEqual({ organizations: [], canSwitch: false });
  });

  it("two roles in one organization is already a switch", () => {
    expect(buildContextSwitcher([rows[1]!, rows[2]!], null).canSwitch).toBe(true);
  });
});
