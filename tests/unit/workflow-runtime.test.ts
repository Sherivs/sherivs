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

describe("workflow runtime reliability", () => {
  it("creates one run for duplicate organization event keys", async () => {
    const port = new InMemoryWorkflowRuntimePort();
    expect(await port.dispatchEvent(event)).toBe("succeeded");
    expect(await port.dispatchEvent(event)).toBe("skipped");
    expect(port.createdEventRunCount).toBe(1);
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
    } as const;
    await port.executeIdempotentEffect("org-1", step, async () => {
      effects += 1;
    });
    port.stepsToClaim.push({ ...step, status: "claimed", attempt: 2 });
    const [reclaimed] = await port.claimDueSteps("worker-2", 1, 60);
    expect(reclaimed.attempt).toBe(2);
    await port.executeIdempotentEffect("org-1", reclaimed, async () => {
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
