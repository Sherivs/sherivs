/**
 * SV1-JARVIS-05 — Hermes routing, budgets/kill switch, daily brief and the
 * minimized read-only report feed. Offline and deterministic.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createApprovalRequest,
  EMPTY_APPROVAL_INBOX,
  type ApprovalInboxState,
} from "../../frontend/src/lib/jarvis/approval-inbox";
import type { BriefingEvent } from "../../frontend/src/lib/jarvis/briefing";
import {
  createRoutingControls,
  engageKillSwitch,
  JARVIS_TO_HERMES_CLASS,
  releaseKillSwitch,
  routeJarvisAction,
  type RouteLogEntry,
  type RouteRequest,
  type RoutingControls,
} from "../../frontend/src/lib/jarvis/hermes-routing";
import { JARVIS_PLAYBOOKS } from "../../frontend/src/lib/jarvis/playbooks";
import {
  buildJarvisReportFeed,
  composeDailyBrief,
  REPORT_FEED_SCHEMA,
} from "../../frontend/src/lib/jarvis/report-feed";
import {
  JARVIS_RISK_TIER_POLICY,
  type JarvisRiskActionId,
} from "../../frontend/src/lib/jarvis/risk-policy";
import { classifyHermesAction } from "../../frontend/src/lib/hermes/hermes-classifier";

const NOW = "2026-11-04T05:00:00.000Z";
const ENG = "playbook.engineering";
const OPS = "playbook.platform_operations";
const ACTIONS = Object.keys(JARVIS_RISK_TIER_POLICY) as JarvisRiskActionId[];

const controls = (
  over: Partial<{ maxRequests: number; maxEscalations: number; windowMs: number }> = {},
) =>
  createRoutingControls({
    now: NOW,
    windowMs: 60_000,
    maxRequests: 10,
    maxEscalations: 3,
    ...over,
  });

const req = (playbookId: string, actionId: string, n = 1): RouteRequest => ({
  requestId: `req-${n}`,
  playbookId,
  actionId,
  actionRef: `ref-${n}`,
});

describe("routing goes through the Hermes classifier", () => {
  it("maps every JARVIS action to a known Hermes action class; T4 and deploy map to Hermes deny classes", () => {
    expect(Object.keys(JARVIS_TO_HERMES_CLASS).sort()).toEqual([...ACTIONS].sort());
    for (const a of ACTIONS) {
      const verdict = classifyHermesAction({
        actionClass: JARVIS_TO_HERMES_CLASS[a],
        underlyingAction: a,
      });
      const tier = JARVIS_RISK_TIER_POLICY[a];
      if (tier === "T4" || a === "deploy_production") expect(verdict.decision).toBe("DENY");
      else if (tier === "T2" || tier === "T3") expect(verdict.decision).toBe("REQUIRE_APPROVAL");
      else expect(verdict.decision).toBe("ALLOW");
    }
  });

  it("allows a declared read and returns the Hermes verdict", () => {
    const r = routeJarvisAction(req(OPS, "observe_platform_state"), controls(), NOW);
    expect(r.result).toMatchObject({
      decision: "allow",
      workspace: "platform_operations",
      tier: "T0",
    });
    expect(r.result.hermes).toMatchObject({ decision: "ALLOW" });
  });

  it("escalates a declared T3 action to the sheriff; Hermes requires approval", () => {
    const r = routeJarvisAction(req(OPS, "suspend_organization"), controls(), NOW);
    expect(r.result).toMatchObject({ decision: "escalate", tier: "T3", approver: "sheriff" });
    expect(r.result.hermes).toMatchObject({
      decision: "REQUIRE_APPROVAL",
      routedTo: "human_operator",
    });
  });

  it("escalates a declared T2 action to platform staff", () => {
    const r = routeJarvisAction(req(ENG, "change_platform_configuration"), controls(), NOW);
    expect(r.result).toMatchObject({
      decision: "escalate",
      tier: "T2",
      approver: "platform_staff",
    });
  });

  it("denies undeclared, T4, unknown actions and unknown playbooks without calling approval", () => {
    for (const a of ["deploy_production", "access_secrets", "disable_guardrails", "made_up"]) {
      const r = routeJarvisAction(req(ENG, a), controls(), NOW);
      expect(r.result).toMatchObject({ decision: "deny", code: "not_declared" });
    }
    expect(
      routeJarvisAction(req("playbook.nope", "observe_platform_state"), controls(), NOW).result,
    ).toMatchObject({
      decision: "deny",
      code: "unknown_playbook",
    });
  });

  it("rejects malformed requests", () => {
    for (const bad of [
      { ...req(OPS, "x"), requestId: "" },
      { ...req(OPS, "x"), actionRef: " " },
    ]) {
      expect(routeJarvisAction(bad, controls(), NOW).result).toMatchObject({
        code: "invalid_request",
      });
    }
    expect(
      routeJarvisAction(req(OPS, "observe_platform_state"), controls(), "not-a-time").result,
    ).toMatchObject({
      code: "invalid_request",
    });
  });

  it("the stricter of playbook and Hermes wins for every declared action", () => {
    for (const p of JARVIS_PLAYBOOKS) {
      for (const a of ACTIONS) {
        const r = routeJarvisAction(
          req(p.id, a),
          controls({ maxRequests: 1000, maxEscalations: 1000 }),
          NOW,
        ).result;
        const tier = JARVIS_RISK_TIER_POLICY[a];
        if (r.decision === "allow") expect(["T0", "T1"]).toContain(tier);
        if (tier === "T2" || tier === "T3" || tier === "T4") expect(r.decision).not.toBe("allow");
      }
    }
  });
});

describe("kill switch halts routing immediately", () => {
  it("denies every request while engaged and consumes no budget", () => {
    const engaged = engageKillSwitch(controls(), "human-sheriff", NOW);
    const before = JSON.stringify(engaged.budget);
    for (const a of ["observe_platform_state", "request_approval"]) {
      const r = routeJarvisAction(req(OPS, a), engaged, NOW);
      expect(r.result).toMatchObject({ decision: "deny", code: "kill_switch_engaged" });
      expect(JSON.stringify(r.controls.budget)).toBe(before);
    }
  });

  it("takes effect on the very next request after a running sequence", () => {
    let c = controls();
    const first = routeJarvisAction(req(OPS, "observe_platform_state", 1), c, NOW);
    expect(first.result.decision).toBe("allow");
    c = engageKillSwitch(first.controls, "agent-watchdog", NOW);
    expect(routeJarvisAction(req(OPS, "observe_platform_state", 2), c, NOW).result).toMatchObject({
      code: "kill_switch_engaged",
    });
  });

  it("anyone can engage it, but only a verified human sheriff with passkey can release it", () => {
    const engaged = engageKillSwitch(controls(), "agent-x", NOW);
    expect(engaged.killSwitch).toMatchObject({ engaged: true, engagedBy: "agent-x" });
    const bad = [
      {
        identityKind: "ai",
        humanIdentityVerified: true,
        role: "sheriff",
        passkeyStepUpVerified: true,
      },
      {
        identityKind: "human",
        humanIdentityVerified: false,
        role: "sheriff",
        passkeyStepUpVerified: true,
      },
      {
        identityKind: "human",
        humanIdentityVerified: true,
        role: "platform_staff",
        passkeyStepUpVerified: true,
      },
      {
        identityKind: "human",
        humanIdentityVerified: true,
        role: "sheriff",
        passkeyStepUpVerified: false,
      },
    ] as const;
    for (const actor of bad) {
      const r = releaseKillSwitch(engaged, actor);
      expect(r.ok).toBe(false);
      expect(r.controls.killSwitch.engaged).toBe(true);
    }
    const ok = releaseKillSwitch(engaged, {
      identityKind: "human",
      humanIdentityVerified: true,
      role: "sheriff",
      passkeyStepUpVerified: true,
    });
    expect(ok.ok && ok.controls.killSwitch.engaged).toBe(false);
  });

  it("engaging twice keeps the original record", () => {
    const a = engageKillSwitch(controls(), "first", NOW);
    const b = engageKillSwitch(a, "second", "2026-11-04T06:00:00.000Z");
    expect(b.killSwitch.engagedBy).toBe("first");
  });
});

describe("budget stops runaway routing", () => {
  it("denies after maxRequests, counting denials too", () => {
    let c = controls({ maxRequests: 3 });
    const codes: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const r = routeJarvisAction(
        req(ENG, i % 2 ? "deploy_production" : "observe_platform_state", i),
        c,
        NOW,
      );
      c = r.controls;
      codes.push(r.result.decision === "deny" ? r.result.code : r.result.decision);
    }
    expect(codes).toEqual([
      "not_declared",
      "allow",
      "not_declared",
      "budget_exhausted",
      "budget_exhausted",
    ]);
    expect(c.budget.requests).toBe(3);
  });

  it("caps escalations separately", () => {
    let c = controls({ maxEscalations: 1 });
    const a = routeJarvisAction(req(OPS, "suspend_organization", 1), c, NOW);
    c = a.controls;
    const b = routeJarvisAction(req(OPS, "suspend_organization", 2), c, NOW);
    expect(a.result.decision).toBe("escalate");
    expect(b.result).toMatchObject({ decision: "deny", code: "budget_exhausted" });
    const read = routeJarvisAction(req(OPS, "observe_platform_state", 3), b.controls, NOW);
    expect(read.result.decision).toBe("allow");
  });

  it("starts a fresh window after windowMs", () => {
    let c = controls({ maxRequests: 1, windowMs: 60_000 });
    c = routeJarvisAction(req(OPS, "observe_platform_state", 1), c, NOW).controls;
    expect(routeJarvisAction(req(OPS, "observe_platform_state", 2), c, NOW).result).toMatchObject({
      code: "budget_exhausted",
    });
    const later = routeJarvisAction(
      req(OPS, "observe_platform_state", 3),
      c,
      "2026-11-04T05:01:00.000Z",
    );
    expect(later.result.decision).toBe("allow");
  });

  it("end to end: budget exhaustion, then kill switch, then a sheriff release resumes in a new window", () => {
    let c = controls({ maxRequests: 2 });
    c = routeJarvisAction(req(OPS, "observe_platform_state", 1), c, NOW).controls;
    c = routeJarvisAction(req(OPS, "observe_platform_state", 2), c, NOW).controls;
    expect(routeJarvisAction(req(OPS, "observe_platform_state", 3), c, NOW).result).toMatchObject({
      code: "budget_exhausted",
    });
    c = engageKillSwitch(c, "human-sheriff", NOW);
    expect(
      routeJarvisAction(req(OPS, "observe_platform_state", 4), c, "2026-11-04T05:02:00.000Z")
        .result,
    ).toMatchObject({ code: "kill_switch_engaged" });
    const released = releaseKillSwitch(c, {
      identityKind: "human",
      humanIdentityVerified: true,
      role: "sheriff",
      passkeyStepUpVerified: true,
    });
    if (!released.ok) throw new Error("release failed");
    expect(
      routeJarvisAction(
        req(OPS, "observe_platform_state", 5),
        released.controls,
        "2026-11-04T05:02:00.000Z",
      ).result.decision,
    ).toBe("allow");
  });
});

describe("report feed is aggregate, minimized and read-only", () => {
  const PII = [
    "sentinel-email@example.test",
    "Amina Student",
    "tenant-secret-ref",
    "free text summary",
    "human-approver-77",
  ];

  function fixture(): { log: RouteLogEntry[]; inbox: ApprovalInboxState; c: RoutingControls } {
    let c = controls();
    const log: RouteLogEntry[] = [];
    for (const [pb, a] of [
      [OPS, "observe_platform_state"],
      [OPS, "suspend_organization"],
      [ENG, "deploy_production"],
    ] as const) {
      const r = routeJarvisAction(req(pb, a, log.length + 1), c, NOW);
      c = r.controls;
      // Simulate a careless caller attaching personal fields to log entries.
      log.push({
        ...r.log,
        ...({ email: PII[0], note: PII[3], tenantRef: PII[2] } as object),
      } as RouteLogEntry);
    }
    const created = createApprovalRequest(
      EMPTY_APPROVAL_INBOX,
      {
        approvalId: "ap-1",
        idempotencyKey: "k1",
        actionId: "suspend_organization",
        actionRef: PII[1],
        agentDefinitionId: "agent-ops",
        requesterRef: PII[4],
        platformRef: "coregrid",
        preconditionsDigest: PII[2],
        expiresAt: "2026-11-04T06:00:00.000Z",
      },
      NOW,
    );
    if (!created.ok) throw new Error(created.code);
    return { log, inbox: created.state, c };
  }

  const ALLOWED_KEYS = new Set([
    "schema",
    "policyVersion",
    "generatedAt",
    "routing",
    "total",
    "byWorkspace",
    "platform_operations",
    "platform_administration",
    "operations",
    "engineering",
    "support",
    "allow",
    "escalate",
    "deny",
    "approvals",
    "pending",
    "approved",
    "denied",
    "expired",
    "executed",
    "pendingT3",
    "controls",
    "killSwitchEngaged",
    "requestsUsed",
    "requestsMax",
    "escalationsUsed",
    "escalationsMax",
  ]);
  const collectKeys = (v: unknown, out = new Set<string>()): Set<string> => {
    if (v !== null && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        out.add(k);
        collectKeys(val, out);
      }
    }
    return out;
  };

  it("contains only allowlisted keys and none of the input personal content", () => {
    const { log, inbox, c } = fixture();
    const feed = buildJarvisReportFeed({
      generatedAt: NOW,
      routeLog: log,
      approvals: inbox,
      controls: c,
    });
    for (const k of collectKeys(feed)) expect(ALLOWED_KEYS.has(k)).toBe(true);
    const text = JSON.stringify(feed);
    for (const p of PII) expect(text).not.toContain(p);
    expect(feed.schema).toBe(REPORT_FEED_SCHEMA);
  });

  it("aggregates counts correctly", () => {
    const { log, inbox, c } = fixture();
    const feed = buildJarvisReportFeed({
      generatedAt: NOW,
      routeLog: log,
      approvals: inbox,
      controls: c,
    });
    expect(feed.routing.total).toBe(3);
    expect(feed.routing.byWorkspace.platform_operations).toEqual({
      allow: 1,
      escalate: 1,
      deny: 0,
    });
    expect(feed.routing.byWorkspace.engineering).toEqual({ allow: 0, escalate: 0, deny: 1 });
    expect(feed.approvals).toMatchObject({ pending: 1, pendingT3: 1, approved: 0 });
    expect(feed.controls).toMatchObject({
      killSwitchEngaged: false,
      requestsUsed: 3,
      requestsMax: 10,
    });
  });

  it("is read-only: deeply frozen and not aliased to the inputs", () => {
    const { log, inbox, c } = fixture();
    const feed = buildJarvisReportFeed({
      generatedAt: NOW,
      routeLog: log,
      approvals: inbox,
      controls: c,
    });
    expect(Object.isFrozen(feed)).toBe(true);
    expect(Object.isFrozen(feed.routing.byWorkspace.engineering)).toBe(true);
    expect(() => {
      (feed.routing as { total: number }).total = 99;
    }).toThrow();
    expect(feed.routing.byWorkspace.engineering).not.toBe(c);
  });
});

describe("daily brief", () => {
  const ev = (
    at: string,
    summary: string,
    severity: BriefingEvent["severity"] = "info",
  ): BriefingEvent => ({
    kind: "platform",
    tenantRef: "platform",
    at,
    severity,
    summary,
  });

  it("restates only the last 24 hours, verbatim, critical first", () => {
    const r = composeDailyBrief(
      [
        ev("2026-11-02T05:00:00.000Z", "too old"),
        ev("2026-11-04T01:00:00.000Z", "recent info"),
        ev("2026-11-04T02:00:00.000Z", "recent critical", "critical"),
        ev("2026-11-04T06:00:00.000Z", "future"),
      ],
      NOW,
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.briefing.lines.map((l) => l.summary)).toEqual(["recent critical", "recent info"]);
  });

  it("fails closed on a bad time or a malformed event", () => {
    expect(composeDailyBrief([], "nope").ok).toBe(false);
    expect(composeDailyBrief([ev("garbage", "x")], NOW).ok).toBe(false);
  });
});

describe("no second agent runtime", () => {
  const sources = [
    "hermes-routing.ts",
    "report-feed.ts",
    "playbooks.ts",
    "approval-inbox.ts",
    "inbox-escalation.ts",
  ].map((f) => [f, readFileSync(`frontend/src/lib/jarvis/${f}`, "utf8")] as const);

  it("routing imports and calls the existing Hermes classifier", () => {
    const routing = readFileSync("frontend/src/lib/jarvis/hermes-routing.ts", "utf8");
    expect(routing).toMatch(/from "\.\.\/hermes\/hermes-classifier"/);
    expect(routing).toMatch(/classifyHermesAction\(/);
  });

  it("JARVIS modules start no loop, timer, worker, process or network call", () => {
    for (const [file, src] of sources) {
      expect(src, file).not.toMatch(/\b(setInterval|setTimeout|setImmediate|queueMicrotask)\b/);
      expect(src, file).not.toMatch(
        /\b(new Worker|worker_threads|child_process|fetch\(|XMLHttpRequest|WebSocket)\b/,
      );
      expect(src, file).not.toMatch(/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/);
      expect(src, file).not.toMatch(/process\.env/);
    }
  });
});
