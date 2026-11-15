import { describe, expect, it } from "vitest";
import { assignTask, type Candidate } from "../../frontend/src/lib/jarvis-executive/dispatch";
import { JARVIS_EXECUTIVE_PACK } from "../../frontend/src/lib/jarvis-executive/executive-pack";
import {
  assessWorkforce,
  OVERSIGHT_THRESHOLDS,
  type WorkforceMember,
} from "../../frontend/src/lib/jarvis-executive/oversight";
import {
  CHANNELS_BY_SEVERITY,
  inQuietHours,
  planOwnerAlert,
  type AlertInput,
} from "../../frontend/src/lib/jarvis-executive/owner-alert";
import {
  classifySeverity,
  routeDecision,
  SEVERITIES,
  type SeverityFacts,
} from "../../frontend/src/lib/jarvis-executive/severity";
import type { Decision, Verdict } from "../../frontend/src/lib/tool-broker/broker";
import { VERDICTS } from "../../frontend/src/lib/tool-broker/broker";
import { PLATFORM_TOOLS } from "../../frontend/src/lib/tool-broker/platform-tools";
import type { EffectiveAutonomy } from "../../frontend/src/lib/twin-engine/autonomy-ladder";
import {
  ROLE_PACK_TIERS,
  tierRank,
  validateRolePack,
  type RolePackTier,
} from "../../frontend/src/lib/twin-engine/role-pack";

const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

describe("ENGINE-04 executive pack", () => {
  const caps = JARVIS_EXECUTIVE_PACK.capabilities;

  it("is valid under the same validator as every other agent", () => {
    expect(validateRolePack(JARVIS_EXECUTIVE_PACK)).toEqual([]);
  });

  it("acts alone only up to T1; T2 needs approval; T3 goes to the sheriff", () => {
    for (const c of caps) {
      if (c.autonomy === "act_autonomously") expect(tierRank(c.tier), c.id).toBeLessThanOrEqual(1);
      if (c.tier === "T2") expect(c.autonomy, c.id).toBe("act_with_approval");
      if (c.tier === "T3") {
        expect(c.autonomy, c.id).toBe("act_with_approval");
        expect(c.approver, c.id).toBe("sheriff");
      }
      expect(c.tier).not.toBe("T4");
    }
    expect(JARVIS_EXECUTIVE_PACK.startsInShadow).toBe(true);
    expect(JARVIS_EXECUTIVE_PACK.memory.crossTenant).toBe(false);
  });

  it("pins the tier of every outward-facing capability", () => {
    const want: Record<string, string> = {
      "send.customer.message": "T2",
      "publish.social.post": "T3",
      "request.deploy": "T3",
      "request.refund": "T3",
      "request.access.grant": "T3",
    };
    for (const [id, tier] of Object.entries(want)) {
      expect(caps.find((c) => c.id === id)?.tier, id).toBe(tier);
    }
    for (const c of caps.filter((x) => /^(publish|request)\./.test(x.id)))
      expect(c.tier, c.id).toBe("T3");
  });

  it("has no capability over its own authority, the audit log or the kill switch", () => {
    for (const c of caps)
      expect(c.id + c.title).not.toMatch(/authority|audit|kill|own (limit|permission)/i);
  });

  it("every connector it names has a broker tool at or below the capability tier", () => {
    for (const c of caps) {
      if (!c.connector) continue;
      expect(
        PLATFORM_TOOLS.some(
          (t) => t.connector === c.connector && tierRank(t.tier) <= tierRank(c.tier),
        ),
        c.id,
      ).toBe(true);
    }
  });

  it("playbooks only chain capabilities the pack declares", () => {
    const ids = new Set(caps.map((c) => c.id));
    for (const p of JARVIS_EXECUTIVE_PACK.playbooks)
      for (const s of p.steps) expect(ids.has(s), s).toBe(true);
  });
});

describe("ENGINE-04 severity and routing", () => {
  const f = (o: Partial<SeverityFacts> = {}): SeverityFacts => ({
    tier: "T1",
    scope: "single_user",
    reversible: true,
    securityIncident: false,
    customerVisible: false,
    ...o,
  });

  it("classifies the anchor cases", () => {
    expect(classifySeverity(f())).toBe("S4");
    expect(classifySeverity(f({ tier: "T2" }))).toBe("S3");
    expect(classifySeverity(f({ scope: "tenant" }))).toBe("S3");
    expect(classifySeverity(f({ tier: "T3" }))).toBe("S2");
    expect(classifySeverity(f({ scope: "tenant", reversible: false }))).toBe("S2");
    expect(classifySeverity(f({ scope: "platform" }))).toBe("S2");
    expect(classifySeverity(f({ scope: "platform", reversible: false }))).toBe("S1");
    expect(classifySeverity(f({ securityIncident: true }))).toBe("S1");
  });

  it("property: a higher tier or wider scope never lowers severity", () => {
    const rank = (s: string) => SEVERITIES.indexOf(s as never);
    const scopes = ["single_user", "tenant", "platform"] as const;
    for (const rev of [true, false])
      for (const sec of [true, false])
        for (const cv of [true, false])
          for (const sc of scopes)
            for (let i = 0; i < ROLE_PACK_TIERS.length - 1; i++) {
              const lo = classifySeverity(
                f({
                  tier: ROLE_PACK_TIERS[i] as RolePackTier,
                  scope: sc,
                  reversible: rev,
                  securityIncident: sec,
                  customerVisible: cv,
                }),
              );
              const hi = classifySeverity(
                f({
                  tier: ROLE_PACK_TIERS[i + 1] as RolePackTier,
                  scope: sc,
                  reversible: rev,
                  securityIncident: sec,
                  customerVisible: cv,
                }),
              );
              expect(rank(hi)).toBeLessThanOrEqual(rank(lo));
            }
  });

  const dec = (verdict: Verdict, tier: RolePackTier, extra: Partial<Decision> = {}): Decision => ({
    verdict,
    tier,
    reasons: ["x"],
    ...extra,
  });
  const budget = { actionsToday: 0, dailyActionLimit: 10 };

  it("routes each verdict", () => {
    expect(routeDecision(dec("execute", "T1"), "S4", budget).route).toBe("act");
    expect(routeDecision(dec("execute", "T2"), "S3", budget).route).toBe("approval_inbox");
    expect(
      routeDecision(dec("execute", "T1"), "S4", { actionsToday: 10, dailyActionLimit: 10 }),
    ).toMatchObject({ route: "approval_inbox", alertOwner: true });
    expect(
      routeDecision(dec("queue_approval", "T2", { approver: "role_owner" }), "S3", budget).route,
    ).toBe("approval_inbox");
    expect(
      routeDecision(dec("sheriff_passkey", "T3", { approver: "sheriff" }), "S2", budget),
    ).toMatchObject({ route: "sheriff_console", alertOwner: true });
    expect(routeDecision(dec("propose", "T1"), "S4", budget).route).toBe("inbox_proposal");
    expect(routeDecision(dec("shadow", "T1"), "S4", budget).route).toBe("log_only");
    expect(
      routeDecision(dec("deny", "T1", { denyCode: "kill_switch" }), "S1", budget),
    ).toMatchObject({ route: "refuse", alertOwner: true });
    expect(
      routeDecision(dec("deny", "T1", { denyCode: "rate_limited" }), "S4", budget),
    ).toMatchObject({ route: "refuse", alertOwner: false });
  });

  it("property: JARVIS acts only on an execute at T1 or below inside its budget", () => {
    const r = lcg(7);
    for (let i = 0; i < 2000; i++) {
      const verdict = VERDICTS[Math.floor(r() * VERDICTS.length)] as Verdict;
      const tier = ROLE_PACK_TIERS[Math.floor(r() * 4)] as RolePackTier;
      const sev = SEVERITIES[Math.floor(r() * 4)]!;
      const b = { actionsToday: Math.floor(r() * 12), dailyActionLimit: 10 };
      const out = routeDecision(dec(verdict, tier), sev, b);
      if (out.route === "act") {
        expect(verdict).toBe("execute");
        expect(tierRank(tier)).toBeLessThanOrEqual(1);
        expect(b.actionsToday).toBeLessThan(b.dailyActionLimit);
      }
      if (verdict === "sheriff_passkey") expect(out.route).toBe("sheriff_console");
      if (verdict === "deny") expect(out.route).toBe("refuse");
    }
  });
});

describe("ENGINE-04 owner alerts", () => {
  const base: AlertInput = {
    severity: "S2",
    title: "Refund request waiting",
    consoleOrigin: "https://console.sherivs.example",
    consolePath: "/inbox/approvals/123",
    nowMs: Date.UTC(2026, 10, 14, 12, 0, 0),
    quiet: null,
    lastSentMs: null,
    sentInLastHour: 0,
  };

  it("sends a console link and nothing that could approve", () => {
    const p = planOwnerAlert(base);
    expect(p.send).toBe(true);
    if (p.send) {
      expect(p.body).toContain("https://console.sherivs.example/inbox/approvals/123");
      expect(p.body.length).toBeLessThanOrEqual(280);
      expect(p.body).not.toMatch(/approve now|reply (yes|1)|code|token/i);
      expect(p.channels).toEqual(CHANNELS_BY_SEVERITY.S2);
    }
  });

  it("refuses unsafe links", () => {
    const bad = [
      "https://evil.example/x",
      "http://console.sherivs.example/x",
      "/inbox?token=abc",
      "/inbox?approve=1",
      "/inbox?x=1&code=123456",
      "/inbox#frag",
      "//evil.example/x",
      "https://user:pw@console.sherivs.example/x",
    ];
    for (const path of bad) {
      expect(planOwnerAlert({ ...base, consolePath: path }), path).toEqual({
        send: false,
        reason: "unsafe_link",
      });
    }
  });

  it("refuses a console origin that is not https, even if the link matches it", () => {
    expect(planOwnerAlert({ ...base, consoleOrigin: "http://console.sherivs.example" })).toEqual({
      send: false,
      reason: "unsafe_link",
    });
  });

  it("quiet hours hold everything except S1", () => {
    const quiet = { startHour: 22, endHour: 6, utcOffsetMinutes: 60 }; // wraps midnight, Lagos
    const night = Date.UTC(2026, 10, 14, 23, 30, 0); // 00:30 local
    expect(inQuietHours(night, quiet)).toBe(true);
    expect(inQuietHours(Date.UTC(2026, 10, 14, 12, 0, 0), quiet)).toBe(false);
    for (const s of ["S2", "S3", "S4"] as const) {
      expect(planOwnerAlert({ ...base, severity: s, nowMs: night, quiet })).toEqual({
        send: false,
        reason: "quiet_hours",
      });
    }
    const s1 = planOwnerAlert({ ...base, severity: "S1", nowMs: night, quiet });
    expect(s1.send && s1.channels).toEqual(["voice", "whatsapp", "sms", "console"]);
  });

  it("dedupes, rate limits, and withholds secret-shaped titles", () => {
    expect(planOwnerAlert({ ...base, lastSentMs: base.nowMs - 60_000 })).toEqual({
      send: false,
      reason: "deduped",
    });
    expect(planOwnerAlert({ ...base, sentInLastHour: 6 })).toEqual({
      send: false,
      reason: "rate_limited",
    });
    const p = planOwnerAlert({ ...base, title: "ghp_" + "a".repeat(30) });
    expect(p.send && p.body).toContain("[withheld]");
    expect(JSON.stringify(p)).not.toContain("ghp_");
  });
});

describe("ENGINE-04 workforce oversight", () => {
  const T = OVERSIGHT_THRESHOLDS;
  const m = (o: Partial<WorkforceMember> = {}): WorkforceMember => ({
    contextId: "c1",
    kind: "ai",
    role: "support",
    status: "active",
    pending: [],
    calls24h: 0,
    failures24h: 0,
    denials24h: 0,
    budgetUsed: 0,
    trust: [],
    ...o,
  });

  it("a quiet, healthy workforce yields no findings", () => {
    expect(assessWorkforce([m(), m({ contextId: "h1", kind: "human" })])).toEqual([]);
  });

  it("detects each condition with the right severity and recommendation", () => {
    const f = assessWorkforce([
      m({ contextId: "a", calls24h: 20, failures24h: 6 }),
      m({ contextId: "b", calls24h: 20, denials24h: 12 }),
      m({ contextId: "c", budgetUsed: 1 }),
      m({ contextId: "d", budgetUsed: 0.92 }),
      m({
        contextId: "e",
        trust: [{ capabilityId: "send.reply", state: "autonomous", evidenceAgeMs: null }],
      }),
      m({ contextId: "f", status: "suspended", pending: [{ id: "x", ageMs: 1 }] }),
      m({
        contextId: "g",
        kind: "human",
        pending: [
          { id: "p1", ageMs: T.approvalSlaMs + 1 },
          { id: "p2", ageMs: T.approvalCriticalMs },
        ],
      }),
    ]);
    const by = (k: string) => f.filter((x) => x.kind === k);
    expect(by("agent_failure_spike")[0]).toMatchObject({
      severity: "S2",
      recommended: "demote_capability",
    });
    expect(by("agent_denial_spike")[0]).toMatchObject({ recommended: "review_role_pack" });
    expect(
      by("budget_exhausted")
        .map((x) => x.recommended)
        .sort(),
    ).toEqual(["notify_owner", "pause_agent"]);
    expect(by("autonomy_evidence_stale")).toHaveLength(1);
    expect(by("context_suspended_with_work")[0]).toMatchObject({
      recommended: "reassign_to_human",
    });
    expect(by("approval_stalled")[0]).toMatchObject({
      severity: "S3",
      recommended: "notify_owner",
    });
    expect(by("approval_near_expiry")[0]).toMatchObject({ severity: "S2" });
    expect(f.every((x) => x.actionTier === "T1")).toBe(true);
  });

  it("does not judge rates on thin data and does not apply AI findings to humans", () => {
    expect(assessWorkforce([m({ calls24h: T.minCallsForRates - 1, failures24h: 9 })])).toEqual([]);
    expect(
      assessWorkforce([m({ kind: "human", calls24h: 50, failures24h: 40, budgetUsed: 1 })]),
    ).toEqual([]);
  });

  it("property: output is sorted by severity and independent of input order", () => {
    const r = lcg(42);
    const members: WorkforceMember[] = Array.from({ length: 25 }, (_, i) =>
      m({
        contextId: `c${i}`,
        kind: r() < 0.3 ? "human" : "ai",
        status: r() < 0.1 ? "suspended" : "active",
        calls24h: Math.floor(r() * 40),
        failures24h: Math.floor(r() * 15),
        denials24h: Math.floor(r() * 25),
        budgetUsed: r() * 1.2,
        pending: r() < 0.5 ? [{ id: `p${i}`, ageMs: Math.floor(r() * 24 * 3600_000) }] : [],
      }),
    );
    const a = assessWorkforce(members);
    const shuffled = members.slice().sort(() => r() - 0.5);
    expect(assessWorkforce(shuffled)).toEqual(a);
    const order = ["S1", "S2", "S3", "S4"];
    for (let i = 1; i < a.length; i++) {
      expect(order.indexOf(a[i - 1]!.severity)).toBeLessThanOrEqual(order.indexOf(a[i]!.severity));
    }
  });
});

describe("ENGINE-04 work assignment", () => {
  const c = (o: Partial<Candidate>): Candidate => ({
    contextId: "x",
    kind: "ai",
    tenantRef: "t1",
    status: "active",
    hasCapability: true,
    effective: "act_autonomously",
    load: 0,
    ...o,
  });

  it("gives T1 work to the least-loaded autonomous agent", () => {
    const r = assignTask({ capabilityId: "k", tier: "T1", tenantRef: "t1" }, [
      c({ contextId: "a", load: 5 }),
      c({ contextId: "b", load: 1 }),
    ]);
    expect(r).toMatchObject({ assigned: true, contextId: "b", mode: "ai_autonomous" });
  });

  it("T2 work is prepared by an agent and approved by a human; T3 goes to a human", () => {
    const pool = [c({ contextId: "a" }), c({ contextId: "h", kind: "human" })];
    expect(assignTask({ capabilityId: "k", tier: "T2", tenantRef: "t1" }, pool)).toMatchObject({
      contextId: "a",
      mode: "ai_with_approval",
    });
    expect(assignTask({ capabilityId: "k", tier: "T3", tenantRef: "t1" }, pool)).toMatchObject({
      contextId: "h",
      mode: "human",
    });
  });

  it("never assigns across tenants, to suspended contexts, or to a context without the capability", () => {
    const r = assignTask({ capabilityId: "k", tier: "T1", tenantRef: "t1" }, [
      c({ contextId: "a", tenantRef: "t2" }),
      c({ contextId: "b", status: "suspended" }),
      c({ contextId: "d", hasCapability: false }),
    ]);
    expect(r).toEqual({ assigned: false, reason: "no eligible context in this tenant" });
  });

  it("a shadow or propose-only agent is never given autonomous work", () => {
    for (const e of ["shadow", "propose_only"] as EffectiveAutonomy[]) {
      const r = assignTask({ capabilityId: "k", tier: "T1", tenantRef: "t1" }, [
        c({ contextId: "a", effective: e }),
        c({ contextId: "h", kind: "human" }),
      ]);
      expect(r).toMatchObject({ contextId: "h", mode: "human" });
    }
  });

  it("property: an assignment is always eligible and tenant-correct", () => {
    const r = lcg(99);
    const effs: EffectiveAutonomy[] = [
      "shadow",
      "propose_only",
      "act_with_approval",
      "act_autonomously",
    ];
    for (let i = 0; i < 2000; i++) {
      const pool = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, j) =>
        c({
          contextId: `c${j}`,
          kind: r() < 0.4 ? "human" : "ai",
          tenantRef: r() < 0.7 ? "t1" : "t2",
          status: r() < 0.8 ? "active" : "suspended",
          hasCapability: r() < 0.8,
          effective: effs[Math.floor(r() * 4)]!,
          load: Math.floor(r() * 9),
        }),
      );
      const tier = ROLE_PACK_TIERS[Math.floor(r() * 4)] as RolePackTier;
      const out = assignTask({ capabilityId: "k", tier, tenantRef: "t1" }, pool);
      if (out.assigned) {
        const pick = pool.find((p) => p.contextId === out.contextId)!;
        expect(pick.status).toBe("active");
        expect(pick.tenantRef).toBe("t1");
        expect(pick.hasCapability).toBe(true);
        if (out.mode === "ai_autonomous") {
          expect(pick.effective).toBe("act_autonomously");
          expect(tierRank(tier)).toBeLessThanOrEqual(1);
        }
        if (tier === "T3") expect(out.mode).toBe("human");
      }
    }
  });
});
