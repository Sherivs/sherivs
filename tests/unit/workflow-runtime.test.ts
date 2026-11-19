import { describe, expect, it } from "vitest";
import {
  effectiveWorkflowAutonomy,
  InMemoryWorkflowRuntimePort,
  isWithinWorkflowDepth,
  retryDelaySeconds,
  stepFailureStatus,
  runWorkflowTick,
} from "@/lib/workflow/workflow-runtime";
import type { WorkflowEvent } from "@/lib/workflow/workflow-runtime";
import { startRun, type WorkflowActorScope } from "@/lib/workflow/workflow-engine";
import { tenantId } from "@/lib/tenant-core";
import type { WorkflowDefinition } from "@/lib/workflow/workflow-contract";
import type { WorkflowActionDefinition } from "@/lib/workflow/workflow-actions";

const event: WorkflowEvent = {
  id: "event-1",
  orgId: "org-1",
  leaseOwner: "worker-1",
  eventType: "workflow.requested",
  dedupeKey: "request-key-1",
  depth: 0,
  attempts: 1,
  payload: {},
};

async function runBudgetScenario(
  budgetUnits: number,
  spentUnits: number,
  costUnits = 1,
  autonomyLevel: "suggest" | "draft" | "act_with_approval" | "act_and_report" = "act_and_report",
  action?: WorkflowActionDefinition,
  firstStatus?: "draft" | "executed",
) {
  const orgId = "org-budget";
  const actor: WorkflowActorScope = {
    actorId: "agent-budget",
    tenantRef: tenantId(orgId),
    kind: "ai",
    roleRef: null,
    agentRef: "agent-budget",
    revoked: false,
  };
  const definition: WorkflowDefinition = {
    definitionId: "budget-workflow",
    tenantRef: tenantId(orgId),
    name: "Budget workflow",
    version: "1",
    trigger: { kind: "event", eventType: "workflow.requested" },
    steps: [
      {
        stepId: "act",
        kind: "action",
        assignment: { kind: "ai", agentRef: "agent-budget" },
        authorizedActions: ["internal.action"],
        actionClass: "internal",
        ...(action ? { action } : {}),
      },
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  };
  const started = startRun(definition, {
    runId: "run-budget",
    actor,
    trigger: { kind: "event", eventType: "workflow.requested" },
    now: "2026-11-17T00:00:00.000Z",
  });
  if (!started.ok) throw new Error("budget_workflow_start_failed");
  const port = new InMemoryWorkflowRuntimePort();
  port.runs.set("run-budget", {
    orgId,
    id: "run-budget",
    versionId: "version-budget",
    run: started.run,
    actor,
  });
  port.versions.set("version-budget", {
    orgId,
    id: "version-budget",
    definition,
    maxLoopIterations: 5,
  });
  port.steps.set("run-budget", [{ id: "step-budget", stepKey: "act", iteration: 0, input: {} }]);
  const claimable = {
    id: "step-budget",
    orgId,
    leaseOwner: "worker-budget",
    runId: "run-budget",
    stepKey: "act",
    iteration: 0,
    status: "claimed",
    attempt: 1,
    maxAttempts: 2,
    idempotencyKey: "wf-step-run-budget-act-0",
    timeoutSeconds: 30,
    actionClass: "internal",
    autonomyLevel,
    budgetUnits,
    spentUnits,
  } as const;
  port.stepsToClaim.push(claimable);
  let actionCalls = 0;
  const counts = await runWorkflowTick(port, {
    worker: "worker-budget",
    executeAction: async () => {
      actionCalls += 1;
      return firstStatus === undefined
        ? autonomyLevel === "draft"
          ? { status: "draft" as const }
          : undefined
        : { status: firstStatus };
    },
    estimateActionCost: () => costUnits,
  });
  /** Re-claims the same step (same idempotency key) as after a lease expiry or crash. */
  const replay = async (actionOutcome?: () => Promise<"draft" | "executed" | null>) => {
    port.stepsToClaim.push({ ...claimable, attempt: 2 });
    const before = port.transitions.length;
    let outcomeCalls = 0;
    await runWorkflowTick(port, {
      worker: "worker-budget-2",
      executeAction: async () => {
        actionCalls += 1;
        return { status: "executed" as const };
      },
      ...(actionOutcome
        ? {
            actionOutcome: async () => {
              outcomeCalls += 1;
              return actionOutcome();
            },
          }
        : {}),
      estimateActionCost: () => costUnits,
    });
    return { transition: port.transitions[before], outcomeCalls };
  };
  return { actionCalls: () => actionCalls, counts, transition: port.transitions[0], replay };
}

describe("workflow runtime reliability", () => {
  it("creates one run for duplicate organization event keys", async () => {
    const port = new InMemoryWorkflowRuntimePort();
    expect(await port.dispatchEvent(event)).toBe("succeeded");
    expect(await port.dispatchEvent(event)).toBe("skipped");
    expect(port.createdEventRunCount).toBe(1);
  });

  it("refuses an effect whose estimated cost exceeds the remaining budget", async () => {
    for (const [budget, spent, cost] of [
      [0, 0, 1],
      [2, 1, 2],
    ]) {
      const result = await runBudgetScenario(budget, spent, cost);
      expect(result.actionCalls()).toBe(0);
      expect(result.transition.status).toBe("dead");
      expect(result.transition.errorCode).toBe("budget.exhausted");
    }
  });

  it("runs the action callback at draft autonomy so it can persist a review draft", async () => {
    const result = await runBudgetScenario(0, 0, 0, "draft", {
      kind: "email",
      templateRef: "attendance.notice",
      templateParams: {},
      recipientIds: [],
    });
    expect(result.actionCalls()).toBe(1);
    expect(result.transition.status).toBe("waiting");
  });

  it("executes an effect when its estimated cost fits the remaining budget", async () => {
    const result = await runBudgetScenario(3, 1, 2);
    expect(result.actionCalls()).toBe(1);
    expect(result.counts.dead).toBe(0);
  });

  it("does not advance a replayed action whose original dispatch produced a draft", async () => {
    const action: WorkflowActionDefinition = {
      kind: "sms",
      templateRef: "attendance.notice",
      templateParams: {},
      recipientIds: [],
      dataClass: "internal",
    };
    // The step is act_and_report, but the dispatcher drafted (e.g. mass or confidential).
    const draftedOnce = await runBudgetScenario(5, 0, 0, "act_and_report", action, "draft");
    expect(draftedOnce.transition.status).toBe("waiting");
    const draftReplay = await draftedOnce.replay(async () => "draft");
    expect(draftReplay.outcomeCalls).toBe(1);
    expect(draftReplay.transition.status).toBe("waiting");
    expect(draftedOnce.actionCalls()).toBe(1);

    // Unknown outcome (or no lookup wired) fails closed: the run waits, never advances.
    const unknown = await runBudgetScenario(5, 0, 0, "act_and_report", action, "draft");
    expect((await unknown.replay(async () => null)).transition.status).toBe("waiting");
    const unwired = await runBudgetScenario(5, 0, 0, "act_and_report", action, "draft");
    expect((await unwired.replay()).transition.status).toBe("waiting");
    expect(unwired.actionCalls()).toBe(1);

    // A replay of an action that really executed may advance, without re-running the effect.
    const executedOnce = await runBudgetScenario(5, 0, 0, "act_and_report", action, "executed");
    expect(executedOnce.transition.status).not.toBe("waiting");
    const executedReplay = await executedOnce.replay(async () => "executed");
    expect(executedReplay.outcomeCalls).toBe(1);
    expect(executedReplay.transition.status).not.toBe("waiting");
    expect(executedOnce.actionCalls()).toBe(1);
  });

  it("does not repeat a completed effect after lease expiry and step re-claim", async () => {
    const port = new InMemoryWorkflowRuntimePort();
    let effects = 0;
    const step = {
      id: "step-1",
      orgId: "org-1",
      leaseOwner: "worker-1",
      runId: "run-1",
      stepKey: "charge",
      iteration: 0,
      status: "claimed",
      attempt: 1,
      maxAttempts: 3,
      idempotencyKey: "wf-step-run-1-charge-0",
      timeoutSeconds: 30,
      actionClass: "internal",
      autonomyLevel: "act_and_report",
      budgetUnits: 1,
      spentUnits: 0,
    } as const;
    await port.executeIdempotentEffect("org-1", step, 1, async () => {
      effects += 1;
    });
    port.stepsToClaim.push({ ...step, status: "claimed", attempt: 2 });
    const [reclaimed] = await port.claimDueSteps("worker-2", 1, 60);
    expect(reclaimed.attempt).toBe(2);
    await port.executeIdempotentEffect("org-1", reclaimed, 1, async () => {
      effects += 1;
    });
    expect(effects).toBe(1);
  });

  it("enforces the loop-depth cap and dead-letters at max attempts", () => {
    expect(isWithinWorkflowDepth(2, 3)).toBe(true);
    expect(isWithinWorkflowDepth(3, 3)).toBe(false);
    expect(stepFailureStatus(2, 3)).toBe("retried");
    expect(stepFailureStatus(3, 3)).toBe("dead");
  });

  it("leaves approval steps waiting instead of retrying step_input", async () => {
    const orgId = "org-1";
    const actor: WorkflowActorScope = {
      actorId: "reviewer-1",
      tenantRef: tenantId(orgId),
      kind: "human",
      roleRef: "reviewer",
      agentRef: null,
      revoked: false,
    };
    const definition: WorkflowDefinition = {
      definitionId: "approval-workflow",
      tenantRef: tenantId(orgId),
      name: "Approval workflow",
      version: "1",
      trigger: { kind: "event", eventType: "workflow.requested" },
      steps: [
        {
          stepId: "approve",
          kind: "approval",
          assignment: { kind: "human", roleRef: "reviewer" },
          authorizedActions: [],
        },
      ],
      onFailure: { kind: "halt" },
      requiredApprovals: [{ stepId: "approve", approverRoleRef: "reviewer" }],
    };
    const started = startRun(definition, {
      runId: "run-approval",
      actor,
      trigger: { kind: "event", eventType: "workflow.requested" },
      now: "2026-11-17T00:00:00.000Z",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const port = new InMemoryWorkflowRuntimePort();
    port.runs.set("run-approval", {
      orgId,
      id: "run-approval",
      versionId: "version-1",
      run: started.run,
      actor,
    });
    port.versions.set("version-1", { orgId, id: "version-1", definition, maxLoopIterations: 5 });
    port.steps.set("run-approval", [
      { id: "approval-step", stepKey: "approve", iteration: 0, input: {} },
    ]);
    port.stepsToClaim.push({
      id: "approval-step",
      orgId,
      leaseOwner: "worker-1",
      runId: "run-approval",
      stepKey: "approve",
      iteration: 0,
      status: "claimed",
      attempt: 1,
      maxAttempts: 1,
      idempotencyKey: "wf-step-run-approval-approve-0",
      timeoutSeconds: 30,
      actionClass: "unclassified",
      autonomyLevel: "suggest",
      budgetUnits: 0,
      spentUnits: 0,
    });

    const counts = await runWorkflowTick(port, { worker: "worker-1" });

    expect(port.transitions[0].status).toBe("waiting");
    expect(port.transitions[0].run?.state).toBe("waiting_approval");
    expect(counts.retried).toBe(0);
    expect(counts.skipped).toBe(1);
  });

  it("fails the run when the step attempt limit is exhausted", async () => {
    const orgId = "org-1";
    const actor: WorkflowActorScope = {
      actorId: "agent-1",
      tenantRef: tenantId(orgId),
      kind: "ai",
      roleRef: null,
      agentRef: "agent-1",
      revoked: false,
    };
    const definition: WorkflowDefinition = {
      definitionId: "action-workflow",
      tenantRef: tenantId(orgId),
      name: "Action workflow",
      version: "1",
      trigger: { kind: "event", eventType: "workflow.requested" },
      steps: [
        {
          stepId: "act",
          kind: "action",
          assignment: { kind: "ai", agentRef: "agent-1" },
          authorizedActions: ["internal.action"],
          actionClass: "internal",
        },
      ],
      onFailure: { kind: "retry", maxAttempts: 3, backoffSeconds: 1 },
      requiredApprovals: [],
    };
    const started = startRun(definition, {
      runId: "run-action",
      actor,
      trigger: { kind: "event", eventType: "workflow.requested" },
      now: "2026-11-17T00:00:00.000Z",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const port = new InMemoryWorkflowRuntimePort();
    port.runs.set("run-action", {
      orgId,
      id: "run-action",
      versionId: "version-1",
      run: started.run,
      actor,
    });
    port.versions.set("version-1", {
      orgId,
      id: "version-1",
      definition,
      maxLoopIterations: 5,
    });
    port.steps.set("run-action", [{ id: "action-step", stepKey: "act", iteration: 0, input: {} }]);
    port.stepsToClaim.push({
      id: "action-step",
      orgId,
      leaseOwner: "worker-1",
      runId: "run-action",
      stepKey: "act",
      iteration: 0,
      status: "claimed",
      attempt: 2,
      maxAttempts: 2,
      idempotencyKey: "wf-step-run-action-act-0",
      timeoutSeconds: 30,
      actionClass: "internal",
      autonomyLevel: "act_and_report",
      budgetUnits: 1,
      spentUnits: 0,
    });

    await runWorkflowTick(port, {
      worker: "worker-1",
      executeAction: async () => {
        throw new Error("action_failed");
      },
    });

    expect(port.transitions[0].status).toBe("dead");
    expect(port.transitions[0].run?.state).toBe("failed");
  });

  it("bounds exponential retry jitter", () => {
    expect(retryDelaySeconds(4, 2, 300, () => 0)).toBe(8);
    expect(retryDelaySeconds(4, 2, 300, () => 1)).toBe(24);
    expect(retryDelaySeconds(20, 2, 30, () => 1)).toBe(30);
  });

  it("uses the lowest autonomy ceiling and hard-caps protected action classes", () => {
    expect(
      effectiveWorkflowAutonomy({
        template: "act_and_report",
        tenant: "act_with_approval",
        agent: "act_and_report",
        actionClass: "internal",
      }),
    ).toBe("act_with_approval");
    expect(
      effectiveWorkflowAutonomy({
        template: "act_and_report",
        tenant: "act_and_report",
        agent: "act_and_report",
        actionClass: "unclassified",
      }),
    ).toBe("draft");

    for (const actionClass of [
      "money_movement",
      "safeguarding",
      "credential_change",
      "public_publish",
      "mass_message",
      "external_authority_share",
    ]) {
      expect(
        effectiveWorkflowAutonomy({
          template: "act_and_report",
          tenant: "act_and_report",
          agent: "act_and_report",
          actionClass,
        }),
      ).toBe("draft");
    }
  });
});
