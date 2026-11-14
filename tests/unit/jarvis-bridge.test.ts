import { describe, expect, it } from "vitest";
import {
  EMPTY_APPROVAL_INBOX,
  MAX_APPROVAL_TTL_MS,
  decideApproval,
  type ApprovalInboxState,
  type DecideApprovalInput,
} from "../../frontend/src/lib/jarvis/approval-inbox";
import {
  DEFAULT_ESCALATION_CONFIG,
  planEscalation,
} from "../../frontend/src/lib/jarvis/inbox-escalation";
import {
  ACTION_MAP,
  MIN_APPROVAL_TTL_MS,
  approvalIdFor,
  inboxVerdict,
  raiseApproval,
  resumeFromInbox,
  validateActionMap,
} from "../../frontend/src/lib/jarvis-bridge/approval-bridge.server";
import { JARVIS_EXECUTIVE_PACK } from "../../frontend/src/lib/jarvis-executive/executive-pack";
import { JARVIS_BINDINGS } from "../../frontend/src/lib/playbook-runner/capability-bindings";
import type { RunnerPorts } from "../../frontend/src/lib/playbook-runner/playbook-runner.server";
import {
  awaitApproval,
  recordStep,
  startRun,
  type PlaybookRun,
} from "../../frontend/src/lib/playbook-runner/run-state";
import type { RolePack } from "../../frontend/src/lib/twin-engine/role-pack";

const base = JARVIS_EXECUTIVE_PACK;
const NOW = "2026-11-15T10:00:00.000Z";
const LATER = "2026-11-15T10:05:00.000Z";
const TTL = 15 * 60_000;
const pack = (cap: string): RolePack => ({
  ...base,
  playbooks: [
    {
      id: "gated",
      title: "Gated playbook",
      wakeOn: ["gated.wake"],
      steps: [cap],
      maxRunsPerDay: 5,
    },
  ],
});

function waiting(
  capabilityId: string,
  approver: "role_owner" | "platform_staff" | "sheriff",
  over: { decisionId?: string | null; subjectRef?: string | null; runId?: string } = {},
): PlaybookRun {
  let run = startRun(
    {
      eventId: "e1",
      kind: "gated.wake",
      source: "scheduler",
      tenantRef: "sherivs-platform",
      contextId: "ctx-1",
      occurredAtMs: 1,
      correlationId: "corr-1",
      subjectRef: over.subjectRef === undefined ? "tenant:abc" : over.subjectRef,
    },
    "gated",
    over.runId ?? "run-1",
  );
  const decisionId = over.decisionId === undefined ? "dec-1" : over.decisionId;
  run = recordStep(run, capabilityId, { kind: "awaiting", approver, decisionId });
  return awaitApproval(run, { stepIndex: 0, decisionId, approver });
}

function rig(opts: { killed?: boolean } = {}) {
  const executed: Array<{ toolId: string; approval: unknown }> = [];
  const ports: RunnerPorts = {
    broker: {
      authority: {
        resolve: async () => {
          throw new Error("not used on resume");
        },
      },
      ledger: {
        findDecision: async () => null,
        appendDecision: async () => {
          throw new Error("not used");
        },
      },
    },
    killSwitch: async () => opts.killed ?? false,
    effective: async () => "act_with_approval",
    handlers: {},
    execute: async ({ tool, approval }) => {
      executed.push({ toolId: tool.id, approval });
      return "succeeded";
    },
  };
  return { ports, executed };
}

const human = (over: Partial<DecideApprovalInput> = {}): DecideApprovalInput => ({
  approvalId: approvalIdFor({ runId: "run-1" }, 0),
  decision: "approve",
  channel: "console",
  approverId: "human:sheriff-1",
  approverRole: "sheriff",
  identityKind: "human",
  humanIdentityVerified: true,
  passkeyStepUpVerified: true,
  ...over,
});

function raised(cap: string, approver: "platform_staff" | "sheriff", run = waiting(cap, approver)) {
  const r = raiseApproval(EMPTY_APPROVAL_INBOX, run, pack(cap), { ttlMs: TTL }, NOW);
  if (!r.ok) throw new Error(`raise failed: ${r.code}`);
  return { run, state: r.state };
}

describe("ENGINE-08 action map", () => {
  it("maps every bridged capability to a JARVIS action of the same tier", () => {
    expect(validateActionMap(base)).toEqual([]);
    expect(Object.keys(ACTION_MAP)).not.toContain("publish.social.post");
  });

  it("flags tier mismatches, unknown actions and unknown capabilities", () => {
    const problems = validateActionMap(base, {
      "request.refund": "send_customer_communications",
      "request.deploy": "no_such_action",
      "ghost.cap": "spend_money",
    });
    expect(problems).toHaveLength(3);
    expect(problems.join("|")).toMatch(
      /tier T3 differs from JARVIS send_customer_communications T2/,
    );
    expect(problems.join("|")).toMatch(/unknown JARVIS action no_such_action/);
    expect(problems.join("|")).toMatch(/ghost.cap: not a capability/);
  });
});

describe("ENGINE-08 raising the inbox request", () => {
  it("creates a request bound to the ledger decision, the tenant and the step arguments", () => {
    const { state } = raised("request.refund", "sheriff");
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).toMatchObject({
      approvalId: "appr:run-1:0",
      idempotencyKey: "appr:run-1:0",
      actionId: "spend_money",
      actionRef: "dec-1",
      agentDefinitionId: "jarvis-executive",
      requesterRef: "agent:ctx-1",
      platformRef: "sherivs-platform",
      riskTier: "T3",
      status: "pending",
      expiresAt: "2026-11-15T10:15:00.000Z",
    });
    expect(state.requests[0]!.preconditionsDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent: raising twice returns the same request", () => {
    const { run, state } = raised("request.refund", "sheriff");
    const again = raiseApproval(state, run, pack("request.refund"), { ttlMs: TTL }, NOW);
    expect(again).toMatchObject({ ok: true, replayed: true, approvalId: "appr:run-1:0" });
    if (again.ok) expect(again.state.requests).toHaveLength(1);
  });

  it("clamps the lifetime to the inbox maximum", () => {
    const run = waiting("request.refund", "sheriff");
    const r = raiseApproval(
      EMPTY_APPROVAL_INBOX,
      run,
      pack("request.refund"),
      { ttlMs: MAX_APPROVAL_TTL_MS * 10 },
      NOW,
    );
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(Date.parse(r.state.requests[0]!.expiresAt) - Date.parse(NOW)).toBe(
        MAX_APPROVAL_TTL_MS,
      );
  });

  it("refuses what the inbox cannot honour, writing nothing", () => {
    const cases: Array<[string, PlaybookRun, RolePack, { ttlMs: number }, string]> = [
      [
        "unmapped capability",
        waiting("publish.social.post", "sheriff"),
        pack("publish.social.post"),
        { ttlMs: TTL },
        "unmapped_capability",
      ],
      [
        "tenant approver",
        waiting("request.refund", "role_owner"),
        pack("request.refund"),
        { ttlMs: TTL },
        "unsupported_approver",
      ],
      [
        "internal step",
        waiting("request.refund", "sheriff", { decisionId: null }),
        pack("request.refund"),
        { ttlMs: TTL },
        "internal_step",
      ],
      [
        "ttl too short",
        waiting("request.refund", "sheriff"),
        pack("request.refund"),
        { ttlMs: MIN_APPROVAL_TTL_MS - 1 },
        "invalid_ttl",
      ],
      [
        "ttl NaN",
        waiting("request.refund", "sheriff"),
        pack("request.refund"),
        { ttlMs: Number.NaN },
        "invalid_ttl",
      ],
    ];
    for (const [name, run, p, opts, code] of cases) {
      const r = raiseApproval(EMPTY_APPROVAL_INBOX, run, p, opts, NOW);
      expect(r, name).toMatchObject({ ok: false, code });
      expect(r.state.requests, name).toHaveLength(0);
    }
    const running = {
      ...waiting("request.refund", "sheriff"),
      status: "running" as const,
      pending: null,
    };
    expect(
      raiseApproval(EMPTY_APPROVAL_INBOX, running, pack("request.refund"), { ttlMs: TTL }, NOW),
    ).toMatchObject({ ok: false, code: "not_waiting" });
  });

  it("refuses a mapping whose tier disagrees with the JARVIS policy", () => {
    const skewed: RolePack = {
      ...pack("request.refund"),
      capabilities: pack("request.refund").capabilities.map((c) =>
        c.id === "request.refund" ? { ...c, tier: "T2" as const } : c,
      ),
    };
    const r = raiseApproval(
      EMPTY_APPROVAL_INBOX,
      waiting("request.refund", "sheriff"),
      skewed,
      { ttlMs: TTL },
      NOW,
    );
    expect(r).toMatchObject({ ok: false, code: "unmapped_capability" });
  });
});

describe("ENGINE-08 applying the inbox verdict", () => {
  it("a sheriff's console approval with passkey executes the step exactly once and finishes the run", async () => {
    const { run, state } = raised("request.refund", "sheriff");
    const d = decideApproval(state, human(), NOW);
    expect(d.ok).toBe(true);
    const r = rig();
    const out = await resumeFromInbox(
      r.ports,
      pack("request.refund"),
      JARVIS_BINDINGS,
      run,
      d.state,
      { actionsToday: 0 },
      LATER,
    );
    expect(out.kind).toBe("resumed");
    if (out.kind !== "resumed" || !out.result.resumed) throw new Error("not resumed");
    expect(out.result.run.status).toBe("completed");
    expect(r.executed).toEqual([
      {
        toolId: "payments.refund.issue",
        approval: { approvalRef: "appr:run-1:0", approverKind: "sheriff" },
      },
    ]);
    expect(out.state.requests[0]!.status).toBe("executed");

    const replay = await resumeFromInbox(
      r.ports,
      pack("request.refund"),
      JARVIS_BINDINGS,
      run,
      out.state,
      { actionsToday: 0 },
      LATER,
    );
    expect(replay).toMatchObject({ kind: "aborted", reason: "approval_already_used" });
    if (replay.kind === "aborted") expect(replay.run.abortReason).toBe("approval_already_used");
    expect(r.executed).toHaveLength(1);
  });

  it("a T2 step runs on a platform staff console approval", async () => {
    const { run, state } = raised("send.customer.message", "platform_staff");
    const d = decideApproval(
      state,
      human({
        approverId: "human:staff-1",
        approverRole: "platform_staff",
        passkeyStepUpVerified: false,
      }),
      NOW,
    );
    expect(d.ok).toBe(true);
    const r = rig();
    const out = await resumeFromInbox(
      r.ports,
      pack("send.customer.message"),
      JARVIS_BINDINGS,
      run,
      d.state,
      { actionsToday: 0 },
      LATER,
    );
    expect(out.kind).toBe("resumed");
    expect(r.executed.map((e) => e.toolId)).toEqual(["whatsapp.send.customer"]);
  });

  it("the inbox refuses approvals that must not count, and the run keeps waiting", async () => {
    const { run, state } = raised("request.refund", "sheriff");
    const attempts: Array<[string, Partial<DecideApprovalInput>]> = [
      ["staff on T3", { approverId: "human:staff-1", approverRole: "platform_staff" }],
      ["no passkey", { passkeyStepUpVerified: false }],
      ["phone channel", { channel: "whatsapp" }],
      ["voice channel", { channel: "voice" }],
      ["ai identity", { identityKind: "ai" }],
      ["unverified human", { humanIdentityVerified: false }],
      ["the agent itself", { approverId: "agent:ctx-1" }],
    ];
    for (const [name, over] of attempts) {
      const d = decideApproval(state, human(over), NOW);
      expect(d.ok, name).toBe(false);
      const r = rig();
      const out = await resumeFromInbox(
        r.ports,
        pack("request.refund"),
        JARVIS_BINDINGS,
        run,
        d.state,
        { actionsToday: 0 },
        NOW,
      );
      expect(out.kind, name).toBe("still_pending");
      expect(r.executed, name).toHaveLength(0);
    }
  });

  it("a denial aborts the run and never executes", async () => {
    const { run, state } = raised("request.refund", "sheriff");
    const d = decideApproval(state, human({ decision: "deny", passkeyStepUpVerified: false }), NOW);
    const r = rig();
    const out = await resumeFromInbox(
      r.ports,
      pack("request.refund"),
      JARVIS_BINDINGS,
      run,
      d.state,
      { actionsToday: 0 },
      NOW,
    );
    expect(out).toMatchObject({ kind: "aborted", reason: "approval_denied" });
    expect(r.executed).toHaveLength(0);
    if (out.kind === "aborted")
      expect([out.run.status, out.run.abortReason]).toEqual(["aborted", "approval_denied"]);
  });

  it("an expired approval aborts the run, even if it was approved just before expiry", async () => {
    const { run, state } = raised("request.refund", "sheriff");
    const d = decideApproval(state, human(), NOW);
    const r = rig();
    const out = await resumeFromInbox(
      r.ports,
      pack("request.refund"),
      JARVIS_BINDINGS,
      run,
      d.state,
      { actionsToday: 0 },
      "2026-11-15T10:16:00.000Z",
    );
    expect(out).toMatchObject({ kind: "aborted", reason: "approval_expired" });
    if (out.kind === "aborted") expect(out.run.abortReason).toBe("approval_expired");
    expect(r.executed).toHaveLength(0);
  });

  it("the kill switch stops the run without consuming the approval", async () => {
    const { run, state } = raised("request.refund", "sheriff");
    const d = decideApproval(state, human(), NOW);
    const r = rig({ killed: true });
    const out = await resumeFromInbox(
      r.ports,
      pack("request.refund"),
      JARVIS_BINDINGS,
      run,
      d.state,
      { actionsToday: 0 },
      LATER,
    );
    expect(out).toMatchObject({ kind: "aborted", reason: "kill_switch" });
    if (out.kind === "aborted") expect(out.run.abortReason).toBe("kill_switch");
    expect(out.state.requests[0]!.status).toBe("approved");
    expect(r.executed).toHaveLength(0);
  });

  it("an approver of a different role than the step requires is not accepted and is not consumed", async () => {
    const { run, state } = raised("send.customer.message", "platform_staff");
    const d = decideApproval(state, human(), NOW);
    expect(d.ok).toBe(true);
    const r = rig();
    const out = await resumeFromInbox(
      r.ports,
      pack("send.customer.message"),
      JARVIS_BINDINGS,
      run,
      d.state,
      { actionsToday: 0 },
      LATER,
    );
    expect(out.kind).toBe("wrong_approver");
    expect(out.state.requests[0]!.status).toBe("approved");
    expect(r.executed).toHaveLength(0);
  });

  it("changed arguments after approval abort the run and execute nothing", async () => {
    const { run, state } = raised("request.refund", "sheriff");
    const d = decideApproval(state, human(), NOW);
    const changed = { ...run, subjectRef: "tenant:other" };
    const r = rig();
    const out = await resumeFromInbox(
      r.ports,
      pack("request.refund"),
      JARVIS_BINDINGS,
      changed,
      d.state,
      { actionsToday: 0 },
      LATER,
    );
    expect(out).toMatchObject({ kind: "aborted", reason: "approval_preconditions_changed" });
    if (out.kind === "aborted") expect(out.run.abortReason).toBe("approval_preconditions_changed");
    expect(r.executed).toHaveLength(0);
  });

  it("reports no request or not waiting without side effects", async () => {
    const run = waiting("request.refund", "sheriff");
    const r = rig();
    expect(
      await resumeFromInbox(
        r.ports,
        pack("request.refund"),
        JARVIS_BINDINGS,
        run,
        EMPTY_APPROVAL_INBOX,
        { actionsToday: 0 },
        NOW,
      ),
    ).toMatchObject({ kind: "no_request" });
    const running = { ...run, status: "running" as const, pending: null };
    expect(
      await resumeFromInbox(
        r.ports,
        pack("request.refund"),
        JARVIS_BINDINGS,
        running,
        EMPTY_APPROVAL_INBOX,
        { actionsToday: 0 },
        NOW,
      ),
    ).toMatchObject({ kind: "not_waiting" });
    expect(r.executed).toHaveLength(0);
  });

  it("a run that is no longer awaiting approval is not resumed even if a pending marker remains", async () => {
    const { run, state } = raised("request.refund", "sheriff");
    const d = decideApproval(state, human(), NOW);
    const r = rig();
    const stale = { ...run, status: "running" as const };
    const out = await resumeFromInbox(
      r.ports,
      pack("request.refund"),
      JARVIS_BINDINGS,
      stale,
      d.state,
      { actionsToday: 0 },
      LATER,
    );
    expect(out.kind).toBe("not_waiting");
    expect(
      raiseApproval(EMPTY_APPROVAL_INBOX, stale, pack("request.refund"), { ttlMs: TTL }, NOW),
    ).toMatchObject({ ok: false, code: "not_waiting" });
    expect(r.executed).toHaveLength(0);
  });

  it("an approval raised for one run never satisfies another run's step", async () => {
    const a = raised(
      "request.refund",
      "sheriff",
      waiting("request.refund", "sheriff", { runId: "run-1" }),
    );
    const d = decideApproval(a.state, human(), NOW);
    const other = waiting("request.refund", "sheriff", { runId: "run-2" });
    const r = rig();
    const out = await resumeFromInbox(
      r.ports,
      pack("request.refund"),
      JARVIS_BINDINGS,
      other,
      d.state,
      { actionsToday: 0 },
      LATER,
    );
    expect(out.kind).toBe("no_request");
    expect(r.executed).toHaveLength(0);
  });

  it("inboxVerdict applies due expiry without consuming", () => {
    const { run, state } = raised("request.refund", "sheriff");
    expect(inboxVerdict(state, run, NOW).verdict.kind).toBe("pending");
    expect(inboxVerdict(state, run, "2026-11-15T11:00:00.000Z").verdict.kind).toBe("expired");
  });
});

describe("ENGINE-08 escalation ladder integration", () => {
  it("a bridged request is planned by the JARVIS ladder: console first, nothing external without authorization", () => {
    const { state } = raised("request.refund", "sheriff");
    const plan = planEscalation({
      state,
      approvalId: "appr:run-1:0",
      attempts: [],
      now: NOW,
      config: DEFAULT_ESCALATION_CONFIG,
    });
    expect(plan).toMatchObject({ action: "send", channel: "console" });
    const unknown = planEscalation({
      state: EMPTY_APPROVAL_INBOX as ApprovalInboxState,
      approvalId: "appr:run-1:0",
      attempts: [],
      now: NOW,
      config: DEFAULT_ESCALATION_CONFIG,
    });
    expect(unknown).toMatchObject({ action: "stop", reason: "not_found" });
  });
});
