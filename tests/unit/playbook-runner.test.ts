import { describe, expect, it } from "vitest";
import type { ActingContext, BrokerState } from "../../frontend/src/lib/tool-broker/broker";
import type {
  AuthorityPort,
  DecisionRecord,
  LedgerPort,
} from "../../frontend/src/lib/tool-broker/broker-service.server";
import { toolById } from "../../frontend/src/lib/tool-broker/platform-tools";
import { JARVIS_EXECUTIVE_PACK } from "../../frontend/src/lib/jarvis-executive/executive-pack";
import {
  JARVIS_BINDINGS,
  validateBindings,
  type BindingTable,
} from "../../frontend/src/lib/playbook-runner/capability-bindings";
import {
  driveRun,
  resumeRun,
  type RunnerPorts,
} from "../../frontend/src/lib/playbook-runner/playbook-runner.server";
import {
  admitRun,
  shiftReport,
  startRun,
  type WakeEvent,
} from "../../frontend/src/lib/playbook-runner/run-state";
import type { EffectiveAutonomy } from "../../frontend/src/lib/twin-engine/autonomy-ladder";
import type { RolePack } from "../../frontend/src/lib/twin-engine/role-pack";
import { tierRank } from "../../frontend/src/lib/twin-engine/role-pack";

const pack = JARVIS_EXECUTIVE_PACK;
const CTX = "ctx-jarvis";
const TENANT = "sherivs-platform";

const event = (over: Partial<WakeEvent> = {}): WakeEvent => ({
  eventId: "ev-1",
  kind: "schedule.daily",
  source: "scheduler",
  tenantRef: TENANT,
  contextId: CTX,
  occurredAtMs: 1_000,
  correlationId: "corr-1",
  subjectRef: "subject-1",
  ...over,
});

const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

interface Rig {
  ports: RunnerPorts;
  executed: Array<{ toolId: string; approvalKind: string | null; decisionId: string }>;
  handled: string[];
  ledger: Array<DecisionRecord & { key?: string }>;
  setEffective: (capId: string, e: EffectiveAutonomy) => void;
  kill: { on: boolean; afterCalls: number | null; calls: number };
  failExecute: Set<string>;
  failHandler: Set<string>;
  missingBinding: Set<string>;
}

function rig(
  p: RolePack = pack,
  bindings: BindingTable = JARVIS_BINDINGS,
  defaultEffective: EffectiveAutonomy = "act_autonomously",
): Rig {
  const effective = new Map<string, EffectiveAutonomy>();
  const ledger: Rig["ledger"] = [];
  const executed: Rig["executed"] = [];
  const handled: string[] = [];
  const kill = { on: false, afterCalls: null as number | null, calls: 0 };
  const failExecute = new Set<string>();
  const failHandler = new Set<string>();
  const missingBinding = new Set<string>();
  const eff = (id: string) => effective.get(id) ?? defaultEffective;

  const capForTool = (toolId: string) =>
    Object.entries(bindings).find(([, b]) => b.kind === "tool" && b.toolId === toolId)?.[0];
  const authority: AuthorityPort = {
    async resolve({ tool }) {
      const capId = capForTool(tool.id);
      const cap = p.capabilities.find((c) => c.id === capId);
      if (!cap) return null;
      const ctx: ActingContext = {
        kind: "platform_staff",
        tenantRef: TENANT,
        status: "active",
        permissions: new Set(p.permissions),
        capability: {
          id: cap.id,
          tier: cap.tier,
          requiresPermission: cap.requiresPermission,
          connector: cap.connector,
          approver: cap.approver,
        },
        effective: eff(cap.id),
      };
      const state: BrokerState = {
        killSwitch: false,
        disabledTools: new Set(),
        callsThisHour: 0,
        binding: missingBinding.has(tool.connector)
          ? null
          : {
              connector: tool.connector,
              scope: "platform",
              secretRef: `vault://${tool.connector.split(/[.:]/)[0]}/main#v1`,
              status: "active",
            },
      };
      return { ctx, state };
    },
  };
  const ledgerPort: LedgerPort = {
    async findDecision({ idempotencyKey }) {
      return ledger.find((r) => r.key === idempotencyKey) ?? null;
    },
    async appendDecision(i) {
      const id = `row-${ledger.length + 1}`;
      ledger.push({ id, decision: i.decision, argsDigest: i.argsDigest, key: i.idempotencyKey });
      return { id };
    },
  };
  const handlers: RunnerPorts["handlers"] = Object.fromEntries(
    Object.values(bindings)
      .filter((b) => b.kind === "internal")
      .map((b) => [
        (b as { handlerId: string }).handlerId,
        async () => {
          handled.push((b as { handlerId: string }).handlerId);
          return failHandler.has((b as { handlerId: string }).handlerId) ? "failed" : "ok";
        },
      ]),
  );
  const ports: RunnerPorts = {
    broker: { authority, ledger: ledgerPort },
    killSwitch: async () => {
      kill.calls += 1;
      return kill.on || (kill.afterCalls !== null && kill.calls > kill.afterCalls);
    },
    effective: async (id) => eff(id),
    handlers,
    execute: async ({ tool, decisionId, approval }) => {
      executed.push({ toolId: tool.id, approvalKind: approval?.approverKind ?? null, decisionId });
      return failExecute.has(tool.id) ? "failed" : "succeeded";
    },
  };
  return {
    ports,
    executed,
    handled,
    ledger,
    setEffective: (c, e) => effective.set(c, e),
    kill,
    failExecute,
    failHandler,
    missingBinding,
  };
}

const withPlaybook = (steps: string[], wakeOn = "custom.wake"): RolePack => ({
  ...pack,
  playbooks: [
    { id: "custom", title: "Custom playbook", wakeOn: [wakeOn], steps, maxRunsPerDay: 5 },
  ],
});

const start = (p: RolePack, wake = "custom.wake", id = "run-1") => {
  const pb = p.playbooks.find((x) => x.wakeOn.includes(wake))!;
  return startRun(event({ kind: wake }), pb.id, id);
};

describe("ENGINE-05 capability bindings", () => {
  it("every JARVIS capability is bound safely", () => {
    expect(validateBindings(pack, JARVIS_BINDINGS)).toEqual([]);
  });

  it("rejects missing, unknown, over-tier and mismatched bindings", () => {
    const { "notify.owner": _drop, ...missing } = JARVIS_BINDINGS;
    expect(validateBindings(pack, missing as BindingTable).join()).toContain("no binding");
    expect(
      validateBindings(pack, {
        ...JARVIS_BINDINGS,
        "ghost.cap": { kind: "internal", handlerId: "x" },
      }).join(),
    ).toContain("unknown capability");
    expect(
      validateBindings(pack, {
        ...JARVIS_BINDINGS,
        "send.customer.message": { kind: "internal", handlerId: "x" },
      }).join(),
    ).toContain("limited to T1");
    expect(
      validateBindings(pack, {
        ...JARVIS_BINDINGS,
        "notify.owner": { kind: "internal", handlerId: "x" },
      }).join(),
    ).toContain("must be a tool");
    expect(
      validateBindings(pack, {
        ...JARVIS_BINDINGS,
        "send.customer.message": { kind: "tool", toolId: "slack.post.internal" },
      }).join(),
    ).toContain("differs from capability connector");
    expect(
      validateBindings(pack, {
        ...JARVIS_BINDINGS,
        "send.customer.message": { kind: "tool", toolId: "no.such.tool" },
      }).join(),
    ).toContain("unknown tool");
    expect(
      validateBindings(pack, {
        ...JARVIS_BINDINGS,
        "request.refund": { kind: "tool", toolId: "social.read" },
      }).join(),
    ).toContain("differs");
  });

  it("a tool above its capability's tier is rejected", () => {
    const lowered: RolePack = {
      ...pack,
      capabilities: pack.capabilities.map((c) =>
        c.id === "send.customer.message" ? { ...c, tier: "T1" as const } : c,
      ),
    };
    expect(validateBindings(lowered, JARVIS_BINDINGS).join()).toContain("exceeds capability tier");
  });
});

describe("ENGINE-05 admission", () => {
  const base = {
    pack,
    event: event(),
    contextId: CTX,
    contextTenantRef: TENANT,
    contextStatus: "active" as const,
    killSwitch: false,
    usage: { runsToday: {}, actionsToday: 0 },
  };

  it("admits a declared wake and names the playbook", () => {
    expect(admitRun(base)).toEqual({ admit: true, playbookId: "daily.workforce.review" });
  });

  it("refuses with the specific reason", () => {
    expect(admitRun({ ...base, event: event({ source: "agent" }) })).toEqual({
      admit: false,
      reason: "self_wake",
    });
    expect(admitRun({ ...base, event: event({ source: "twin" }) })).toEqual({
      admit: false,
      reason: "self_wake",
    });
    expect(admitRun({ ...base, event: event({ kind: "nope" }) })).toEqual({
      admit: false,
      reason: "unknown_wake",
    });
    expect(admitRun({ ...base, killSwitch: true })).toEqual({
      admit: false,
      reason: "kill_switch",
    });
    expect(admitRun({ ...base, contextStatus: "suspended" })).toEqual({
      admit: false,
      reason: "context_inactive",
    });
    expect(admitRun({ ...base, contextStatus: "pending_pack" })).toEqual({
      admit: false,
      reason: "context_inactive",
    });
    expect(admitRun({ ...base, event: event({ contextId: "other" }) })).toEqual({
      admit: false,
      reason: "wrong_context",
    });
    expect(admitRun({ ...base, event: event({ tenantRef: "other" }) })).toEqual({
      admit: false,
      reason: "wrong_context",
    });
    expect(
      admitRun({ ...base, usage: { runsToday: { "daily.workforce.review": 4 }, actionsToday: 0 } }),
    ).toEqual({ admit: false, reason: "run_cap" });
    expect(
      admitRun({ ...base, usage: { runsToday: {}, actionsToday: pack.budget.dailyActions } }),
    ).toEqual({ admit: false, reason: "action_budget" });
  });
});

describe("ENGINE-05 running a playbook", () => {
  it("runs the daily review end to end with earned autonomy, once through the broker", async () => {
    const r = rig();
    const { run, actionsToday } = await driveRun(
      r.ports,
      pack,
      JARVIS_BINDINGS,
      start(pack, "schedule.daily"),
      { actionsToday: 0 },
    );
    expect(run.status).toBe("completed");
    expect(r.handled).toEqual(["executive.observe", "executive.assess", "executive.coordinate"]);
    expect(r.executed.map((e) => e.toolId)).toEqual(["owner.alert.send"]);
    expect(r.ledger).toHaveLength(1);
    expect(actionsToday).toBe(2); // coordinate (T1 internal) + the brokered alert
    const rep = shiftReport(run);
    expect(rep).toMatchObject({ status: "completed", stepsTotal: 4, executed: 4, denied: 0 });
    expect(JSON.stringify(rep)).not.toContain("subject-1");
  });

  it("in shadow, only T0 steps act; everything else is recorded as not executed", async () => {
    const r = rig(pack, JARVIS_BINDINGS, "shadow");
    const { run } = await driveRun(r.ports, pack, JARVIS_BINDINGS, start(pack, "schedule.daily"), {
      actionsToday: 0,
    });
    expect(run.status).toBe("completed");
    expect(r.handled).toEqual(["executive.observe", "executive.assess"]);
    expect(r.executed).toEqual([]);
    expect(shiftReport(run)).toMatchObject({ executed: 2, notExecuted: 2 });
  });

  it("stops at an internal step that needs approval, and resumes only for the right approver", async () => {
    const r = rig();
    r.setEffective("pause.agent", "act_with_approval");
    const first = await driveRun(r.ports, pack, JARVIS_BINDINGS, start(pack, "incident.opened"), {
      actionsToday: 0,
    });
    expect(first.run.status).toBe("awaiting_approval");
    expect(r.handled).toEqual(["executive.observe", "executive.assess"]);
    expect(r.executed).toEqual([]);

    const wrong = await resumeRun(
      r.ports,
      pack,
      JARVIS_BINDINGS,
      first.run,
      { approved: true, evidence: { approvalRef: "a1", approverKind: "sheriff" } },
      { actionsToday: first.actionsToday },
    );
    expect(wrong).toMatchObject({ resumed: false, reason: "wrong_approver" });
    expect(r.handled).not.toContain("executive.pause");

    const ok = await resumeRun(
      r.ports,
      pack,
      JARVIS_BINDINGS,
      first.run,
      { approved: true, evidence: { approvalRef: "a2", approverKind: "role_owner" } },
      { actionsToday: first.actionsToday },
    );
    expect(ok.resumed && ok.run.status).toBe("completed");
    expect(r.handled).toEqual(["executive.observe", "executive.assess", "executive.pause"]);
    expect(r.executed.map((e) => e.toolId)).toEqual(["owner.alert.send"]);
  });

  it("T3 always waits for the sheriff; the executor runs only with sheriff evidence", async () => {
    const p = withPlaybook(["request.refund", "notify.owner"]);
    const r = rig(p);
    const first = await driveRun(r.ports, p, JARVIS_BINDINGS, start(p), { actionsToday: 0 });
    expect(first.run).toMatchObject({
      status: "awaiting_approval",
      pending: { approver: "sheriff" },
    });
    expect(r.executed).toEqual([]);

    const staff = await resumeRun(
      r.ports,
      p,
      JARVIS_BINDINGS,
      first.run,
      { approved: true, evidence: { approvalRef: "x", approverKind: "platform_staff" } },
      { actionsToday: 1 },
    );
    expect(staff).toMatchObject({ resumed: false, reason: "wrong_approver" });
    expect(r.executed).toEqual([]);

    const done = await resumeRun(
      r.ports,
      p,
      JARVIS_BINDINGS,
      first.run,
      { approved: true, evidence: { approvalRef: "x", approverKind: "sheriff" } },
      { actionsToday: 1 },
    );
    expect(done.resumed && done.run.status).toBe("completed");
    expect(r.executed.map((e) => [e.toolId, e.approvalKind])).toEqual([
      ["payments.refund.issue", "sheriff"],
      ["owner.alert.send", null],
    ]);
  });

  it("an engaged kill switch refuses a resume and nothing executes", async () => {
    const p = withPlaybook(["request.refund", "notify.owner"]);
    const r = rig(p);
    const first = await driveRun(r.ports, p, JARVIS_BINDINGS, start(p), { actionsToday: 0 });
    r.kill.on = true;
    const res = await resumeRun(
      r.ports,
      p,
      JARVIS_BINDINGS,
      first.run,
      { approved: true, evidence: { approvalRef: "k", approverKind: "sheriff" } },
      { actionsToday: 1 },
    );
    expect(res).toMatchObject({
      resumed: false,
      reason: "kill_switch",
      run: { status: "aborted", abortReason: "kill_switch" },
    });
    expect(r.executed).toEqual([]);
  });

  it("a denied approval aborts the run and nothing executes", async () => {
    const p = withPlaybook(["request.refund", "notify.owner"]);
    const r = rig(p);
    const first = await driveRun(r.ports, p, JARVIS_BINDINGS, start(p), { actionsToday: 0 });
    const res = await resumeRun(
      r.ports,
      p,
      JARVIS_BINDINGS,
      first.run,
      { approved: false, evidence: { approvalRef: "n", approverKind: "sheriff" } },
      { actionsToday: 1 },
    );
    expect(res.resumed && res.run).toMatchObject({
      status: "aborted",
      abortReason: "approval_denied",
    });
    expect(r.executed).toEqual([]);
  });

  it("a broker denial aborts at that step and later steps never run", async () => {
    const p = withPlaybook(["notify.owner", "send.customer.message", "notify.owner"]);
    const r = rig(p);
    r.missingBinding.add("whatsapp");
    const { run } = await driveRun(r.ports, p, JARVIS_BINDINGS, start(p), { actionsToday: 0 });
    expect(run).toMatchObject({ status: "aborted", abortReason: "denied:binding_missing" });
    expect(run.steps).toHaveLength(2);
    expect(r.executed.map((e) => e.toolId)).toEqual(["owner.alert.send"]);
  });

  it("the kill switch stops a run between steps", async () => {
    const r = rig();
    r.kill.afterCalls = 2;
    const { run } = await driveRun(r.ports, pack, JARVIS_BINDINGS, start(pack, "schedule.daily"), {
      actionsToday: 0,
    });
    expect(run).toMatchObject({ status: "aborted", abortReason: "kill_switch" });
    expect(run.steps).toHaveLength(2);
    expect(r.executed).toEqual([]);
  });

  it("the daily action budget stops a run", async () => {
    const tight: RolePack = { ...pack, budget: { ...pack.budget, dailyActions: 1 } };
    const r = rig(tight);
    const { run } = await driveRun(
      r.ports,
      tight,
      JARVIS_BINDINGS,
      start(tight, "schedule.daily"),
      { actionsToday: 0 },
    );
    expect(run).toMatchObject({ status: "aborted", abortReason: "action_budget" });
    expect(r.executed).toEqual([]);
  });

  it("a failed step aborts the run; a replayed step is not executed twice", async () => {
    const r = rig();
    r.failExecute.add("owner.alert.send");
    const failed = await driveRun(r.ports, pack, JARVIS_BINDINGS, start(pack, "schedule.daily"), {
      actionsToday: 0,
    });
    expect(failed.run).toMatchObject({ status: "aborted", abortReason: "step_failed" });

    const r2 = rig();
    await driveRun(r2.ports, pack, JARVIS_BINDINGS, start(pack, "schedule.daily", "same-run"), {
      actionsToday: 0,
    });
    const again = await driveRun(
      r2.ports,
      pack,
      JARVIS_BINDINGS,
      start(pack, "schedule.daily", "same-run"),
      { actionsToday: 0 },
    );
    expect(r2.executed).toHaveLength(1);
    expect(shiftReport(again.run).notExecuted).toBe(1);
    expect(r2.ledger).toHaveLength(1);
  });

  it("property: invariants hold over 1500 random runs", async () => {
    const rnd = lcg(20261115);
    const efs: EffectiveAutonomy[] = [
      "shadow",
      "propose_only",
      "act_with_approval",
      "act_autonomously",
    ];
    const chains = [
      ["observe.platform", "coordinate.workforce", "notify.owner"],
      ["request.refund", "notify.owner"],
      ["send.customer.message", "publish.social.post", "notify.owner"],
      ["pause.agent", "request.deploy", "notify.owner"],
    ];
    for (let i = 0; i < 1500; i++) {
      const steps = chains[Math.floor(rnd() * chains.length)]!;
      const p = withPlaybook(steps);
      const r = rig(p, JARVIS_BINDINGS, efs[Math.floor(rnd() * 4)]!);
      for (const c of p.capabilities) r.setEffective(c.id, efs[Math.floor(rnd() * 4)]!);
      if (rnd() < 0.2) r.kill.afterCalls = Math.floor(rnd() * 4);
      if (rnd() < 0.15) r.missingBinding.add("whatsapp");
      if (rnd() < 0.1) r.failExecute.add("owner.alert.send");
      const budget = 1 + Math.floor(rnd() * 5);
      const tight: RolePack = { ...p, budget: { ...p.budget, dailyActions: budget } };
      let out = await driveRun(r.ports, tight, JARVIS_BINDINGS, start(tight), { actionsToday: 0 });
      // The run may need several approvals; grant them with the right approver half the time.
      for (let hops = 0; hops < 4 && out.run.status === "awaiting_approval"; hops++) {
        const approver = out.run.pending!.approver;
        const res = await resumeRun(
          r.ports,
          tight,
          JARVIS_BINDINGS,
          out.run,
          { approved: rnd() < 0.7, evidence: { approvalRef: `a${hops}`, approverKind: approver } },
          { actionsToday: out.actionsToday },
        );
        if (!res.resumed) break;
        out = {
          run: res.run,
          actionsToday: res.actionsToday === undefined ? out.actionsToday : res.actionsToday,
        };
      }
      const run = out.run;
      // 1. never more steps recorded than the playbook has
      expect(run.steps.length).toBeLessThanOrEqual(steps.length);
      // 2. nothing recorded after an abort or an unresolved wait: statuses are terminal or waiting
      expect(["completed", "aborted", "awaiting_approval"]).toContain(run.status);
      // 3. every execute call of a T3 tool carried sheriff evidence
      for (const e of r.executed) {
        const t = toolById(e.toolId)!;
        if (t.tier === "T3") expect(e.approvalKind).toBe("sheriff");
        // 4. every executed tool has a ledger decision that allowed it
        const row = r.ledger.find((l) => l.id === e.decisionId)!;
        expect(["execute", "queue_approval", "sheriff_passkey"]).toContain(row.decision.verdict);
        if (e.approvalKind === null) expect(row.decision.verdict).toBe("execute");
      }
      // 5. internal T1 handlers never ran for a shadow or propose-only capability without approval
      for (const s of run.steps) {
        const cap = p.capabilities.find((c) => c.id === s.capabilityId)!;
        const b = JARVIS_BINDINGS[cap.id]!;
        if (b.kind === "internal" && tierRank(cap.tier) >= 1 && s.result.kind === "executed") {
          expect(["act_autonomously", "act_with_approval"]).toContain(
            await r.ports.effective(cap.id),
          );
        }
      }
      // 6. budget respected (the run never starts a step at or past the limit)
      expect(out.actionsToday).toBeLessThanOrEqual(budget);
      // 7. a denied or aborted run executed nothing after the stop
      if (run.status === "aborted" && run.abortReason?.startsWith("denied:")) {
        expect(run.steps.at(-1)!.result.kind).toBe("denied");
      }
    }
  });
});
