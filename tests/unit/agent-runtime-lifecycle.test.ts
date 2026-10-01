/**
 * CoreGrid — ephemeral agent runtime lifecycle unit tests (V5.3 Part 14).
 *
 * Validates:
 * - Happy-path lifecycle through every Part 14 stage.
 * - Lease expiry forces terminate.
 * - Action-limit termination and budget-exhaustion termination.
 * - Cross-tenant mission binding rejection.
 * - Illegal-transition rejection (fail closed).
 * - A terminated lease cannot be resurrected (no persist-forever).
 * - No legal path to escalated permissions.
 */

import { describe, expect, it } from "vitest";
import { agentDefinitionId } from "@/lib/agent-core";
import {
  issueLease,
  isLeaseTerminal,
  transition,
  type AgentDefinition,
  type LifecycleEvent,
} from "@/lib/agent-runtime/ephemeral-lifecycle";

const T0 = 1_000_000;
const TENANT_A = "tenant-a";

function makeDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: agentDefinitionId("agent-def:attendance_worker:v1"),
    tenantRef: TENANT_A,
    capabilities: ["attendance.read", "attendance.annotate"],
    allowedTools: ["read_attendance", "annotate_record"],
    permissions: [{ kind: "tool", toolId: "read_attendance" }],
    budget: { maxTokens: 10_000, maxFinancialCost: 5 },
    timeLimitMs: 60_000,
    actionLimit: 3,
    evidenceRequirements: ["execution_record", "evidence_record"],
    ...overrides,
  };
}

/** Drives the lease through the full Part 14 happy path up to a target stage. */
function driveTo(definition: AgentDefinition, ...events: LifecycleEvent[]) {
  let lease = issueLease(definition, T0);
  for (const event of events) {
    const result = transition(lease, event);
    if (!result.ok) {
      throw new Error(`driveTo failed at ${event.type}: ${result.reason}`);
    }
    lease = result.lease;
  }
  return lease;
}

const HAPPY_PATH: LifecycleEvent[] = [
  { type: "TRIGGER", atMs: T0 + 10 },
  { type: "MISSION_BIND", atMs: T0 + 20, missionId: "mission-001", missionTenantRef: TENANT_A },
  { type: "ENQUEUE", atMs: T0 + 30 },
  { type: "WORKER_START", atMs: T0 + 40, workerRef: "worker-1" },
  { type: "CONTEXT_ASSEMBLE", atMs: T0 + 50, contextRef: "cprim-1" },
  { type: "REASON", atMs: T0 + 60, tokensUsed: 100 },
  { type: "ACT", atMs: T0 + 70, toolId: "read_attendance", financialCost: 1 },
  { type: "EVIDENCE", atMs: T0 + 80, evidenceRef: "ev-1" },
  { type: "VERIFY", atMs: T0 + 90, passed: true },
  { type: "PERSIST_RESULT", atMs: T0 + 100 },
  { type: "SLEEP", atMs: T0 + 110 },
  { type: "TERMINATE", atMs: T0 + 120, reason: "mission_completed" },
];

describe("happy-path lifecycle through every Part 14 stage", () => {
  it("walks AGENT DEFINITION through SLEEP/TERMINATE in order", () => {
    const definition = makeDefinition();
    let lease = issueLease(definition, T0);
    expect(lease.state).toBe("defined");

    const expectedStates = [
      "triggered",
      "mission_bound",
      "queued",
      "worker_running",
      "context_assembled",
      "reasoning",
      "acting",
      "evidence_collected",
      "verifying",
      "result_persisted",
      "sleeping",
      "terminated",
    ];

    for (let i = 0; i < HAPPY_PATH.length; i++) {
      const result = transition(lease, HAPPY_PATH[i]!);
      expect(result.ok, `stage ${HAPPY_PATH[i]!.type}`).toBe(true);
      if (result.ok) {
        lease = result.lease;
        expect(lease.state).toBe(expectedStates[i]);
      }
    }
    expect(lease.missionId).toBe("mission-001");
    expect(lease.actionsTaken).toBe(1);
    expect(lease.budgetUsed).toEqual({ tokensUsed: 100, financialCostUsed: 1 });
    expect(lease.lastVerification).toBe("passed");
    expect(isLeaseTerminal(lease)).toBe(true);
  });

  it("allows the perceive→decide→act loop to re-enter reasoning from evidence", () => {
    const lease = driveTo(
      makeDefinition(),
      { type: "TRIGGER", atMs: T0 + 10 },
      { type: "MISSION_BIND", atMs: T0 + 20, missionId: "mission-001", missionTenantRef: TENANT_A },
      { type: "ENQUEUE", atMs: T0 + 30 },
      { type: "WORKER_START", atMs: T0 + 40, workerRef: "worker-1" },
      { type: "CONTEXT_ASSEMBLE", atMs: T0 + 50, contextRef: "cprim-1" },
      { type: "REASON", atMs: T0 + 60, tokensUsed: 100 },
      { type: "ACT", atMs: T0 + 70, toolId: "read_attendance", financialCost: 0 },
      { type: "EVIDENCE", atMs: T0 + 80, evidenceRef: "ev-1" },
      { type: "REASON", atMs: T0 + 90, tokensUsed: 100 },
    );
    expect(lease.state).toBe("reasoning");
    expect(lease.budgetUsed.tokensUsed).toBe(200);
  });

  it("allows TERMINATE from any working state", () => {
    const lease = driveTo(
      makeDefinition(),
      { type: "TRIGGER", atMs: T0 + 10 },
      { type: "TERMINATE", atMs: T0 + 20, reason: "operator_stop" },
    );
    expect(lease.state).toBe("terminated");
  });
});

describe("lease expiry forces terminate", () => {
  it("terminates instead of applying an event past the expiry instant", () => {
    const definition = makeDefinition({ timeLimitMs: 1_000 });
    let lease = issueLease(definition, T0);
    const trigger = transition(lease, { type: "TRIGGER", atMs: T0 + 10 });
    expect(trigger.ok).toBe(true);
    lease = (trigger as { ok: true; lease: typeof lease }).lease;

    const late = transition(lease, { type: "ENQUEUE", atMs: T0 + 1_500 });
    expect(late.ok).toBe(true);
    if (late.ok) {
      expect(late.forcedTermination).toBe("lease_expired");
      expect(late.lease.state).toBe("terminated");
      expect(late.lease.state).not.toBe("queued");
    }
  });

  it("accepts an explicit TERMINATE event even past expiry", () => {
    const lease = driveTo(
      makeDefinition({ timeLimitMs: 1_000 }),
      { type: "TRIGGER", atMs: T0 + 10 },
      { type: "TERMINATE", atMs: T0 + 5_000, reason: "lease_expired" },
    );
    expect(lease.state).toBe("terminated");
  });
});

describe("action-limit termination", () => {
  it("forces terminate when an ACT would exceed the action limit", () => {
    const definition = makeDefinition({ actionLimit: 2 });
    const act = (atMs: number): LifecycleEvent => ({
      type: "ACT",
      atMs,
      toolId: "read_attendance",
      financialCost: 0,
    });
    // Two loop iterations consume the full action limit.
    let lease = driveTo(
      definition,
      { type: "TRIGGER", atMs: T0 + 10 },
      { type: "MISSION_BIND", atMs: T0 + 20, missionId: "m", missionTenantRef: TENANT_A },
      { type: "ENQUEUE", atMs: T0 + 30 },
      { type: "WORKER_START", atMs: T0 + 40, workerRef: "w" },
      { type: "CONTEXT_ASSEMBLE", atMs: T0 + 50, contextRef: "c" },
      { type: "REASON", atMs: T0 + 60, tokensUsed: 0 },
      act(T0 + 70),
      { type: "EVIDENCE", atMs: T0 + 80, evidenceRef: "ev-1" },
      { type: "REASON", atMs: T0 + 90, tokensUsed: 0 },
      act(T0 + 100),
    );
    expect(lease.actionsTaken).toBe(2);

    const third = transition(lease, { type: "EVIDENCE", atMs: T0 + 110, evidenceRef: "ev-2" });
    expect(third.ok).toBe(true);
    lease = (third as { ok: true; lease: typeof lease }).lease;

    const attempt = transition(lease, { type: "REASON", atMs: T0 + 120, tokensUsed: 0 });
    expect(attempt.ok).toBe(true);
    if (attempt.ok) {
      const actOver = transition(attempt.lease, {
        type: "ACT",
        atMs: T0 + 130,
        toolId: "read_attendance",
        financialCost: 0,
      });
      expect(actOver.ok).toBe(true);
      if (actOver.ok) {
        expect(actOver.forcedTermination).toBe("action_limit_exceeded");
        expect(actOver.lease.state).toBe("terminated");
      }
    }
  });
});

describe("budget exhaustion forces terminate", () => {
  it("terminates when token usage exceeds the budget", () => {
    const definition = makeDefinition({ budget: { maxTokens: 500, maxFinancialCost: null } });
    const pre = driveTo(
      definition,
      { type: "TRIGGER", atMs: T0 + 10 },
      { type: "MISSION_BIND", atMs: T0 + 20, missionId: "m", missionTenantRef: TENANT_A },
      { type: "ENQUEUE", atMs: T0 + 30 },
      { type: "WORKER_START", atMs: T0 + 40, workerRef: "w" },
      { type: "CONTEXT_ASSEMBLE", atMs: T0 + 50, contextRef: "c" },
      { type: "REASON", atMs: T0 + 60, tokensUsed: 400 },
      { type: "ACT", atMs: T0 + 70, toolId: "read_attendance", financialCost: 0 },
      { type: "EVIDENCE", atMs: T0 + 80, evidenceRef: "ev-1" },
    );
    expect(pre.budgetUsed.tokensUsed).toBe(400);

    const over = transition(pre, { type: "REASON", atMs: T0 + 90, tokensUsed: 200 });
    expect(over.ok).toBe(true);
    if (over.ok) {
      expect(over.forcedTermination).toBe("budget_exhausted");
      expect(over.lease.state).toBe("terminated");
    }
  });

  it("terminates when financial cost exceeds the budget", () => {
    const definition = makeDefinition({ budget: { maxTokens: null, maxFinancialCost: 10 } });
    const pre = driveTo(
      definition,
      { type: "TRIGGER", atMs: T0 + 10 },
      { type: "MISSION_BIND", atMs: T0 + 20, missionId: "m", missionTenantRef: TENANT_A },
      { type: "ENQUEUE", atMs: T0 + 30 },
      { type: "WORKER_START", atMs: T0 + 40, workerRef: "w" },
      { type: "CONTEXT_ASSEMBLE", atMs: T0 + 50, contextRef: "c" },
      { type: "REASON", atMs: T0 + 60, tokensUsed: 0 },
    );
    const act = transition(pre, { type: "ACT", atMs: T0 + 70, toolId: "read_attendance", financialCost: 9 });
    expect(act.ok).toBe(true);
    if (act.ok) {
      const evidence = transition(act.lease, { type: "EVIDENCE", atMs: T0 + 80, evidenceRef: "ev" });
      expect(evidence.ok).toBe(true);
      if (evidence.ok) {
        const over = transition(evidence.lease, { type: "REASON", atMs: T0 + 90, tokensUsed: 0 });
        expect(over.ok).toBe(true);
        if (over.ok) {
          const secondAct = transition(over.lease, {
            type: "ACT",
            atMs: T0 + 100,
            toolId: "read_attendance",
            financialCost: 2,
          });
          expect(secondAct.ok).toBe(true);
          if (secondAct.ok) {
            expect(secondAct.forcedTermination).toBe("budget_exhausted");
            expect(secondAct.lease.state).toBe("terminated");
          }
        }
      }
    }
  });
});

describe("cross-tenant mission rejection", () => {
  it("rejects MISSION_BIND whose tenant does not match the lease tenant", () => {
    const lease = driveTo(makeDefinition(), { type: "TRIGGER", atMs: T0 + 10 });
    const result = transition(lease, {
      type: "MISSION_BIND",
      atMs: T0 + 20,
      missionId: "mission-002",
      missionTenantRef: "tenant-b",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cross_tenant_mission_rejected");
      expect(result.lease.state).toBe("triggered");
      expect(result.lease.missionId).toBeNull();
    }
  });
});

describe("illegal-transition rejection (fail closed)", () => {
  it("rejects skipping stages (defined -> ACT)", () => {
    const lease = issueLease(makeDefinition(), T0);
    const result = transition(lease, { type: "ACT", atMs: T0 + 10, toolId: "read_attendance", financialCost: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("illegal_transition:defined->ACT");
    }
  });

  it("rejects waking a sleeping worker (sleep is pre-termination only)", () => {
    const lease = driveTo(
      makeDefinition(),
      { type: "TRIGGER", atMs: T0 + 10 },
      { type: "MISSION_BIND", atMs: T0 + 20, missionId: "m", missionTenantRef: TENANT_A },
      { type: "ENQUEUE", atMs: T0 + 30 },
      { type: "WORKER_START", atMs: T0 + 40, workerRef: "w" },
      { type: "CONTEXT_ASSEMBLE", atMs: T0 + 50, contextRef: "c" },
      { type: "REASON", atMs: T0 + 60, tokensUsed: 0 },
      { type: "ACT", atMs: T0 + 70, toolId: "read_attendance", financialCost: 0 },
      { type: "EVIDENCE", atMs: T0 + 80, evidenceRef: "ev" },
      { type: "VERIFY", atMs: T0 + 90, passed: true },
      { type: "PERSIST_RESULT", atMs: T0 + 100 },
      { type: "SLEEP", atMs: T0 + 110 },
    );
    expect(lease.state).toBe("sleeping");
    const wake = transition(lease, { type: "WORKER_START", atMs: T0 + 120, workerRef: "w2" });
    expect(wake.ok).toBe(false);
    if (!wake.ok) {
      expect(wake.reason).toBe("illegal_transition:sleeping->WORKER_START");
    }
  });

  it("rejects replayed events (non-monotonic clock)", () => {
    const lease = driveTo(makeDefinition(), { type: "TRIGGER", atMs: T0 + 10 });
    const replay = transition(lease, { type: "TRIGGER", atMs: T0 + 5 });
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.reason).toBe("event_time_before_last_event");
    }
  });

  it("rejects a forged escalation event — no permission-bearing path exists", () => {
    const lease = driveTo(makeDefinition(), { type: "TRIGGER", atMs: T0 + 10 });
    const forged = {
      type: "ESCALATE_PERMISSIONS",
      atMs: T0 + 20,
      permissions: [{ kind: "tenant", tenantId: "tenant-b" }],
    } as unknown as LifecycleEvent;
    const result = transition(lease, forged);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("illegal_transition:triggered->ESCALATE_PERMISSIONS");
      expect(result.lease.tenantRef).toBe(TENANT_A);
    }
  });
});

describe("terminated leases cannot be resurrected (no persist-forever)", () => {
  it("rejects every event on a terminated lease, including TERMINATE", () => {
    const lease = driveTo(
      makeDefinition(),
      { type: "TRIGGER", atMs: T0 + 10 },
      { type: "TERMINATE", atMs: T0 + 20, reason: "operator_stop" },
    );
    expect(isLeaseTerminal(lease)).toBe(true);

    const attempts: LifecycleEvent[] = [
      { type: "TRIGGER", atMs: T0 + 30 },
      { type: "MISSION_BIND", atMs: T0 + 31, missionId: "m2", missionTenantRef: TENANT_A },
      { type: "WORKER_START", atMs: T0 + 32, workerRef: "zombie" },
      { type: "TERMINATE", atMs: T0 + 33, reason: "operator_stop" },
    ];
    for (const event of attempts) {
      const result = transition(lease, event);
      expect(result.ok, `event ${event.type}`).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("terminated_lease_cannot_transition");
      }
    }
  });

  it("keeps the terminated lease state immutable after rejected attempts", () => {
    const lease = driveTo(
      makeDefinition(),
      { type: "TRIGGER", atMs: T0 + 10 },
      { type: "TERMINATE", atMs: T0 + 20, reason: "mission_completed" },
    );
    const after = transition(lease, { type: "TRIGGER", atMs: T0 + 40 });
    expect(after.ok).toBe(false);
    if (!after.ok) {
      expect(after.lease.state).toBe("terminated");
      expect(after.lease.missionId).toBeNull();
    }
  });
});
