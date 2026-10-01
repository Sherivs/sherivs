/**
 * CoreGrid Workflow Engine tests (V5.3 Part 17, MISSION-V1-008).
 *
 * Validates the pure in-memory evaluator in frontend/src/lib/workflow/
 * workflow-engine.ts. Security negatives are mandatory (Constitution §31):
 * - approval steps block AI-satisfied approvals (humanRef mandatory, Part 13);
 * - cross-tenant triggers and actors are denied;
 * - trigger mismatches are denied;
 * - completed runs are immutable;
 * - action plans are bounded by authorizedActions;
 * - a run cannot complete while any step lacks its evidence record.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import type { WorkflowDefinition, WorkflowStep } from "@/lib/workflow/workflow-contract";
import {
  advance,
  planAuthorizedAction,
  recordStepEvidence,
  startRun,
  type AdvanceContext,
  type WorkflowActorScope,
} from "@/lib/workflow/workflow-engine";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");
const NOW = "2026-10-01T00:00:00.000Z";

const humanAdmin: WorkflowActorScope = {
  actorId: "user-1",
  tenantRef: TENANT_A,
  kind: "human",
  roleRef: "admin",
  agentRef: null,
  revoked: false,
};

function taskStep(id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    stepId: id,
    kind: "task",
    assignment: { kind: "unassigned" },
    authorizedActions: [],
    ...overrides,
  };
}

function happyDefinition(): WorkflowDefinition {
  return {
    definitionId: "wf-badge",
    tenantRef: TENANT_A,
    name: "Badge issuance",
    version: "1",
    trigger: { kind: "manual", actorRef: "user-1" },
    steps: [
      taskStep("enroll", {
        assignment: { kind: "human", roleRef: "admin" },
        nextStepId: "issue",
      }),
      {
        stepId: "issue",
        kind: "action",
        assignment: { kind: "human", roleRef: "admin" },
        authorizedActions: ["badge.issue"],
        nextStepId: "notify",
      },
      taskStep("notify", { kind: "notification" }),
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  };
}

function advanceCtx(actor: WorkflowActorScope = humanAdmin, at = NOW): AdvanceContext {
  return { actor, now: at };
}

function evidenceFor(
  runId: string,
  stepId: string,
  evidenceKind: "task_completed" | "action_planned" | "notification_delivered" | "approval_recorded" | "condition_evaluated",
) {
  return {
    evidenceId: `ev-${stepId}`,
    runId,
    stepId,
    evidenceKind,
    producer: "workflow-runtime",
    actorId: "user-1",
    tenantRef: TENANT_A,
    recordedAt: NOW,
    provenance: "controlled-fixture",
    integrity: `hash-${stepId}`,
  };
}

describe("happy path — manual trigger to completion with all evidence", () => {
  it("runs a manual-trigger workflow to completion with all evidence present", () => {
    const def = happyDefinition();
    const started = startRun(def, {
      runId: "run-1",
      actor: humanAdmin,
      trigger: { kind: "manual", actorRef: "user-1" },
      now: NOW,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    let run = started.run;
    expect(run.state).toBe("running");
    expect(run.currentStepId).toBe("enroll");

    // Step 1: task
    const step1 = advance(def, run, { kind: "step_input", payload: {}, at: NOW }, advanceCtx());
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    run = step1.run;
    expect(run.currentStepId).toBe("issue");
    expect(run.pendingEvidence).toEqual([
      { stepId: "enroll", evidenceKind: "task_completed", reason: "Step enroll completed" },
    ]);

    const ev1 = recordStepEvidence(run, evidenceFor("run-1", "enroll", "task_completed"));
    expect(ev1.ok).toBe(true);
    if (!ev1.ok) return;
    run = ev1.run;

    // Step 2: action — emits an AuthorizedActionPlan, never executes it.
    const step2 = advance(def, run, { kind: "step_input", payload: {}, at: NOW }, advanceCtx());
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    run = step2.run;
    expect(step2.actionPlan).not.toBeNull();
    expect(step2.actionPlan).toEqual({
      planId: "run-1:issue:plan",
      runId: "run-1",
      stepId: "issue",
      tenantRef: TENANT_A,
      authorizedActions: ["badge.issue"],
      proposedBy: "user-1",
      createdAt: NOW,
      note: "execution_is_external_to_the_workflow_engine",
    });
    expect(run.currentStepId).toBe("notify");

    const ev2 = recordStepEvidence(run, evidenceFor("run-1", "issue", "action_planned"));
    expect(ev2.ok).toBe(true);
    if (!ev2.ok) return;
    run = ev2.run;

    // Step 3: notification — the completion gate demands evidence first.
    const step3 = advance(def, run, { kind: "step_input", payload: {}, at: NOW }, advanceCtx());
    expect(step3.ok).toBe(false);
    if (step3.ok) return;
    expect(step3.denyCode).toBe("evidence_pending");
    expect(step3.reason).toContain("EVIDENCE before COMPLETION");
    run = step3.run;
    expect(run.state).toBe("running");
    expect(run.pendingEvidence).toEqual([
      { stepId: "notify", evidenceKind: "notification_delivered", reason: "Step notify completed" },
    ]);

    const ev3 = recordStepEvidence(run, evidenceFor("run-1", "notify", "notification_delivered"));
    expect(ev3.ok).toBe(true);
    if (!ev3.ok) return;
    run = ev3.run;
    expect(run.pendingEvidence).toEqual([]);

    const completion = advance(def, run, { kind: "complete", at: NOW }, advanceCtx());
    expect(completion.ok).toBe(true);
    if (!completion.ok) return;
    run = completion.run;
    expect(run.state).toBe("completed");
    expect(run.currentStepId).toBeNull();
    expect(run.completedAt).toBe(NOW);
    expect(run.pendingEvidence).toEqual([]);
    expect(run.evidence.map((e) => e.stepId)).toEqual(["enroll", "issue", "notify"]);
    expect(run.history.map((h) => h.kind)).toEqual([
      "run_started",
      "step_completed",
      "evidence_recorded",
      "step_completed",
      "evidence_recorded",
      "step_completed",
      "evidence_recorded",
      "run_completed",
    ]);
  });
});

describe("approval steps (Part 13 law)", () => {
  function approvalDefinition(): WorkflowDefinition {
    return {
      definitionId: "wf-access",
      tenantRef: TENANT_A,
      name: "Escalated access",
      version: "1",
      trigger: { kind: "manual", actorRef: "user-2" },
      steps: [
        taskStep("submit", { nextStepId: "approve" }),
        {
          stepId: "approve",
          kind: "approval",
          assignment: { kind: "human", roleRef: "principal" },
          authorizedActions: [],
          nextStepId: "grant",
        },
        taskStep("grant", { kind: "notification" }),
      ],
      onFailure: { kind: "halt" },
      requiredApprovals: [{ stepId: "approve", approverRoleRef: "principal" }],
    };
  }

  const teacher: WorkflowActorScope = {
    actorId: "user-2",
    tenantRef: TENANT_A,
    kind: "human",
    roleRef: "teacher",
    agentRef: null,
    revoked: false,
  };

  function startedRun() {
    const def = approvalDefinition();
    const started = startRun(def, {
      runId: "run-ap",
      actor: teacher,
      trigger: { kind: "manual", actorRef: "user-2" },
      now: NOW,
    });
    if (!started.ok) throw new Error("startRun should succeed");
    const entered = advance(
      def,
      started.run,
      { kind: "step_input", payload: {}, at: NOW },
      advanceCtx(teacher),
    );
    if (!entered.ok) throw new Error("submit should advance");
    return { def, run: entered.run };
  }

  it("enters waiting_approval and cannot be bypassed by step_input", () => {
    const { run } = startedRun();
    expect(run.state).toBe("waiting_approval");
    expect(run.currentStepId).toBe("approve");

    const bypass = advance(
      approvalDefinition(),
      run,
      { kind: "step_input", payload: {}, at: NOW },
      advanceCtx(teacher),
    );
    expect(bypass.ok).toBe(false);
    if (bypass.ok) return;
    expect(bypass.denyCode).toBe("approval_not_awaited");
    expect(bypass.run.state).toBe("waiting_approval");
  });

  it("blocks an AI-satisfied approval (humanRef mandatory)", () => {
    const { def, run } = startedRun();
    const aiApproval = advance(
      def,
      run,
      {
        kind: "approval",
        record: {
          recordId: "apr-1",
          stepId: "approve",
          decision: "approved",
          approver: { kind: "ai", agentRef: "agent-9" },
          decidedAt: NOW,
        },
        at: NOW,
      },
      advanceCtx(teacher),
    );
    expect(aiApproval.ok).toBe(false);
    if (aiApproval.ok) return;
    expect(aiApproval.denyCode).toBe("ai_cannot_satisfy_approval");
    expect(aiApproval.reason).toContain("Part 13 law");
    // The run remains waiting for a human.
    expect(aiApproval.run.state).toBe("waiting_approval");
    expect(aiApproval.run.currentStepId).toBe("approve");
  });

  it("denies an approval record without a humanRef and a role mismatch", () => {
    const { def, run } = startedRun();
    const emptyHumanRef = advance(
      def,
      run,
      {
        kind: "approval",
        record: {
          recordId: "apr-2",
          stepId: "approve",
          decision: "approved",
          approver: { kind: "human", humanRef: " ", roleRef: "principal" },
          decidedAt: NOW,
        },
        at: NOW,
      },
      advanceCtx(teacher),
    );
    expect(emptyHumanRef.ok).toBe(false);
    if (!emptyHumanRef.ok) {
      expect(emptyHumanRef.denyCode).toBe("human_ref_required");
    }

    const wrongRole = advance(
      def,
      run,
      {
        kind: "approval",
        record: {
          recordId: "apr-3",
          stepId: "approve",
          decision: "approved",
          approver: { kind: "human", humanRef: "user-2", roleRef: "teacher" },
          decidedAt: NOW,
        },
        at: NOW,
      },
      advanceCtx(teacher),
    );
    expect(wrongRole.ok).toBe(false);
    if (!wrongRole.ok) {
      expect(wrongRole.denyCode).toBe("approver_role_mismatch");
    }
  });

  it("proceeds only on a human approval from the required role", () => {
    const { def, run } = startedRun();
    const approved = advance(
      def,
      run,
      {
        kind: "approval",
        record: {
          recordId: "apr-4",
          stepId: "approve",
          decision: "approved",
          approver: { kind: "human", humanRef: "principal-1", roleRef: "principal" },
          decidedAt: NOW,
        },
        at: NOW,
      },
      advanceCtx(teacher),
    );
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.run.state).toBe("running");
    expect(approved.run.currentStepId).toBe("grant");
    expect(
      approved.run.pendingEvidence.some(
        (e) => e.stepId === "approve" && e.evidenceKind === "approval_recorded",
      ),
    ).toBe(true);
  });

  it("cancels the run on a human rejection", () => {
    const { def, run } = startedRun();
    const rejected = advance(
      def,
      run,
      {
        kind: "approval",
        record: {
          recordId: "apr-5",
          stepId: "approve",
          decision: "rejected",
          approver: { kind: "human", humanRef: "principal-1", roleRef: "principal" },
          decidedAt: NOW,
        },
        at: NOW,
      },
      advanceCtx(teacher),
    );
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.run.state).toBe("cancelled");
    expect(rejected.run.currentStepId).toBeNull();
  });
});

describe("branching conditions", () => {
  function branchDefinition(): WorkflowDefinition {
    return {
      definitionId: "wf-branch",
      tenantRef: TENANT_A,
      name: "Fee waiver routing",
      version: "1",
      trigger: { kind: "event", eventType: "fee.assessed" },
      steps: [
        {
          stepId: "route",
          kind: "condition",
          assignment: { kind: "unassigned" },
          authorizedActions: [],
          condition: { field: "outstanding", operator: "gte", value: 100 },
          branches: { onTrueStepId: "review", onFalseStepId: "autoClear" },
        },
        taskStep("review", { assignment: { kind: "human", roleRef: "bursar" } }),
        taskStep("autoClear", { kind: "notification" }),
      ],
      onFailure: { kind: "halt" },
      requiredApprovals: [],
    };
  }

  function runToCondition(payload: Record<string, unknown>) {
    const def = branchDefinition();
    const started = startRun(def, {
      runId: `run-${payload.outstanding ?? "none"}`,
      actor: humanAdmin,
      trigger: { kind: "event", eventType: "fee.assessed" },
      now: NOW,
    });
    if (!started.ok) throw new Error("startRun should succeed");
    const advanced = advance(
      def,
      started.run,
      { kind: "step_input", payload, at: NOW },
      advanceCtx(),
    );
    return { def, result: advanced };
  }

  it("routes to the true branch when the condition is TRUE", () => {
    const { result } = runToCondition({ outstanding: 150 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.currentStepId).toBe("review");
    expect(
      result.run.pendingEvidence.some(
        (e) => e.stepId === "route" && e.evidenceKind === "condition_evaluated",
      ),
    ).toBe(true);
    expect(result.run.history.at(-1)?.reason).toContain("evaluated TRUE");
  });

  it("routes to the false branch when the condition is FALSE", () => {
    const { result } = runToCondition({ outstanding: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.currentStepId).toBe("autoClear");
    expect(result.run.history.at(-1)?.reason).toContain("evaluated FALSE");
  });

  it("fails closed to the false branch when the payload field is UNKNOWN", () => {
    const { result } = runToCondition({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.currentStepId).toBe("autoClear");
    expect(result.run.history.at(-1)?.reason).toContain("evaluated UNKNOWN");
  });
});

describe("failure policy — retry then halt on exhausted attempts", () => {
  function retryDefinition(): WorkflowDefinition {
    return {
      definitionId: "wf-retry",
      tenantRef: TENANT_A,
      name: "Retry then halt",
      version: "1",
      trigger: { kind: "manual", actorRef: "user-1" },
      steps: [taskStep("process")],
      onFailure: { kind: "retry", maxAttempts: 2, backoffSeconds: 45 },
      requiredApprovals: [],
    };
  }

  it("retries within budget and halts when attempts are exhausted", () => {
    const def = retryDefinition();
    const started = startRun(def, {
      runId: "run-retry",
      actor: humanAdmin,
      trigger: { kind: "manual", actorRef: "user-1" },
      now: NOW,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    let run = started.run;

    const retry1 = advance(
      def,
      run,
      { kind: "failure", reason: "dependency unavailable", at: NOW },
      advanceCtx(),
    );
    expect(retry1.ok).toBe(true);
    if (!retry1.ok) return;
    run = retry1.run;
    expect(run.state).toBe("running");
    expect(run.currentStepId).toBe("process");
    expect(run.attempts).toEqual([
      { stepId: "process", attempt: 2, lastFailureReason: "dependency unavailable", backoffSeconds: 45 },
    ]);
    expect(run.history.at(-1)?.kind).toBe("retry_scheduled");

    const retry2 = advance(
      def,
      run,
      { kind: "failure", reason: "dependency still unavailable", at: NOW },
      advanceCtx(),
    );
    expect(retry2.ok).toBe(false);
    if (retry2.ok) return;
    expect(retry2.denyCode).toBe("retry_exhausted");
    run = retry2.run;
    expect(run.state).toBe("failed");
    expect(run.currentStepId).toBe("process");
    expect(run.history.at(-1)?.kind).toBe("run_failed");
    expect(run.history.at(-1)?.reason).toContain("Retry budget exhausted after 2 attempts");
  });

  it.each([
    ["halt", { kind: "halt" } as const],
    ["escalate", { kind: "escalate" } as const],
  ])("fails immediately under the %s policy", (_label, policy) => {
    const def: WorkflowDefinition = { ...retryDefinition(), onFailure: policy };
    const started = startRun(def, {
      runId: `run-${policy.kind}`,
      actor: humanAdmin,
      trigger: { kind: "manual", actorRef: "user-1" },
      now: NOW,
    });
    if (!started.ok) throw new Error("startRun should succeed");
    const failed = advance(
      def,
      started.run,
      { kind: "failure", reason: "boom", at: NOW },
      advanceCtx(),
    );
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.run.state).toBe("failed");
    expect(failed.denyCode).toBe(policy.kind === "halt" ? "halted" : "escalation_required");
  });
});

describe("trigger validation", () => {
  it("rejects a trigger kind mismatch", () => {
    const def = happyDefinition();
    const result = startRun(def, {
      runId: "run-x",
      actor: humanAdmin,
      trigger: { kind: "event", eventType: "attendance.marked" },
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denyCode).toBe("trigger_mismatch");
  });

  it("rejects a manual trigger whose actorRef does not match the starting actor", () => {
    const def = happyDefinition();
    const result = startRun(def, {
      runId: "run-y",
      actor: humanAdmin,
      trigger: { kind: "manual", actorRef: "user-2" },
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denyCode).toBe("trigger_mismatch");
  });

  it("rejects an AI trigger started by a non-AI actor", () => {
    const def: WorkflowDefinition = {
      ...happyDefinition(),
      trigger: { kind: "ai", agentRef: "agent-1", proposalRef: "proposal-7" },
    };
    const result = startRun(def, {
      runId: "run-z",
      actor: humanAdmin,
      trigger: { kind: "ai", agentRef: "agent-1", proposalRef: "proposal-7" },
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denyCode).toBe("ai_trigger_actor_mismatch");
  });
});

describe("cross-tenant denial", () => {
  it("denies starting a run from another tenant", () => {
    const def = happyDefinition();
    const outsider: WorkflowActorScope = { ...humanAdmin, tenantRef: TENANT_B };
    const result = startRun(def, {
      runId: "run-ct",
      actor: outsider,
      trigger: { kind: "manual", actorRef: "user-1" },
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denyCode).toBe("cross_tenant");
  });

  it("denies advancing a run from another tenant", () => {
    const def = happyDefinition();
    const started = startRun(def, {
      runId: "run-ct2",
      actor: humanAdmin,
      trigger: { kind: "manual", actorRef: "user-1" },
      now: NOW,
    });
    if (!started.ok) throw new Error("startRun should succeed");
    const outsider: WorkflowActorScope = { ...humanAdmin, tenantRef: TENANT_B };
    const result = advance(
      def,
      started.run,
      { kind: "step_input", payload: {}, at: NOW },
      advanceCtx(outsider),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denyCode).toBe("cross_tenant");
    expect(result.run).toEqual(started.run);
  });

  it("denies evidence from another tenant", () => {
    const def = happyDefinition();
    const started = startRun(def, {
      runId: "run-ct3",
      actor: humanAdmin,
      trigger: { kind: "manual", actorRef: "user-1" },
      now: NOW,
    });
    if (!started.ok) throw new Error("startRun should succeed");
    const step1 = advance(
      def,
      started.run,
      { kind: "step_input", payload: {}, at: NOW },
      advanceCtx(),
    );
    if (!step1.ok) throw new Error("advance should succeed");
    const result = recordStepEvidence(step1.run, {
      ...evidenceFor("run-ct3", "enroll", "task_completed"),
      tenantRef: TENANT_B,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.denyCode).toBe("cross_tenant");
  });
});

describe("revoked actors (Constitution §31)", () => {
  it("denies startRun and advance for a revoked actor", () => {
    const def = happyDefinition();
    const revoked: WorkflowActorScope = { ...humanAdmin, revoked: true };
    const started = startRun(def, {
      runId: "run-revoked",
      actor: revoked,
      trigger: { kind: "manual", actorRef: "user-1" },
      now: NOW,
    });
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.denyCode).toBe("revoked_actor");

    const live = startRun(def, {
      runId: "run-revoked-2",
      actor: humanAdmin,
      trigger: { kind: "manual", actorRef: "user-1" },
      now: NOW,
    });
    if (!live.ok) throw new Error("startRun should succeed");
    const advanced = advance(
      def,
      live.run,
      { kind: "step_input", payload: {}, at: NOW },
      advanceCtx(revoked),
    );
    expect(advanced.ok).toBe(false);
    if (advanced.ok) return;
    expect(advanced.denyCode).toBe("revoked_actor");
  });
});

describe("completed-run immutability", () => {
  it("refuses every event on a completed run without mutation", () => {
    const def = happyDefinition();
    const started = startRun(def, {
      runId: "run-done",
      actor: humanAdmin,
      trigger: { kind: "manual", actorRef: "user-1" },
      now: NOW,
    });
    if (!started.ok) throw new Error("startRun should succeed");
    let run = started.run;
    for (const stepId of ["enroll", "issue"] as const) {
      const advanced = advance(
        def,
        run,
        { kind: "step_input", payload: {}, at: NOW },
        advanceCtx(),
      );
      if (!advanced.ok) throw new Error(`advance ${stepId} should succeed`);
      run = advanced.run;
      const ev = recordStepEvidence(
        run,
        evidenceFor("run-done", stepId, stepId === "issue" ? "action_planned" : "task_completed"),
      );
      if (!ev.ok) throw new Error(`evidence ${stepId} should record`);
      run = ev.run;
    }
    const gate = advance(def, run, { kind: "step_input", payload: {}, at: NOW }, advanceCtx());
    if (gate.ok) throw new Error("gate should block");
    run = gate.run;
    const ev = recordStepEvidence(
      run,
      evidenceFor("run-done", "notify", "notification_delivered"),
    );
    if (!ev.ok) throw new Error("evidence notify should record");
    run = ev.run;
    const completed = advance(def, run, { kind: "complete", at: NOW }, advanceCtx());
    if (!completed.ok) throw new Error("completion should succeed");
    run = completed.run;
    expect(run.state).toBe("completed");

    for (const event of [
      { kind: "step_input", payload: {}, at: NOW },
      { kind: "complete", at: NOW },
      { kind: "cancel", reason: "late cancel", at: NOW },
      { kind: "failure", reason: "late failure", at: NOW },
    ] as const) {
      const denied = advance(def, run, event, advanceCtx());
      expect(denied.ok).toBe(false);
      if (denied.ok) continue;
      expect(denied.denyCode).toBe("terminal_state_immutable");
      expect(denied.run).toEqual(run);
    }
    const lateEvidence = recordStepEvidence(
      run,
      evidenceFor("run-done", "enroll", "task_completed"),
    );
    expect(lateEvidence.ok).toBe(false);
    if (!lateEvidence.ok) {
      expect(lateEvidence.denyCode).toBe("terminal_state_immutable");
      expect(lateEvidence.run).toEqual(run);
    }
  });
});

describe("action plans bounded by authorizedActions", () => {
  function actionRun() {
    const def = happyDefinition();
    const started = startRun(def, {
      runId: "run-plan",
      actor: humanAdmin,
      trigger: { kind: "manual", actorRef: "user-1" },
      now: NOW,
    });
    if (!started.ok) throw new Error("startRun should succeed");
    const entered = advance(
      def,
      started.run,
      { kind: "step_input", payload: {}, at: NOW },
      advanceCtx(),
    );
    if (!entered.ok) throw new Error("advance should succeed");
    return { def, run: entered.run };
  }

  it("denies planning an unlisted action", () => {
    const { def, run } = actionRun();
    const denied = planAuthorizedAction(def, run, "badge.delete", advanceCtx());
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.denyCode).toBe("action_not_authorized");
    expect(denied.reason).toContain("badge.delete");
  });

  it("denies planning on a step_input carrying an unlisted action", () => {
    const { def, run } = actionRun();
    const denied = advance(
      def,
      run,
      { kind: "step_input", payload: {}, requestedAction: "badge.revoke", at: NOW },
      advanceCtx(),
    );
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.denyCode).toBe("action_not_authorized");
    expect(denied.run).toEqual(run);
  });

  it("issues a plan bounded to the requested listed action", () => {
    const { def, run } = actionRun();
    const plan = planAuthorizedAction(def, run, "badge.issue", advanceCtx());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.authorizedActions).toEqual(["badge.issue"]);
    expect(plan.plan.note).toBe("execution_is_external_to_the_workflow_engine");
  });

  it("denies planning when the current step is not an action step", () => {
    const { def } = actionRun();
    const started = startRun(def, {
      runId: "run-plan-2",
      actor: humanAdmin,
      trigger: { kind: "manual", actorRef: "user-1" },
      now: NOW,
    });
    if (!started.ok) throw new Error("startRun should succeed");
    const denied = planAuthorizedAction(def, started.run, "badge.issue", advanceCtx());
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.denyCode).toBe("not_action_step");
  });
});

describe("evidence integrity", () => {
  it("denies evidence with no pending expectation, duplicates, and unusable records", () => {
    const def = happyDefinition();
    const started = startRun(def, {
      runId: "run-ev",
      actor: humanAdmin,
      trigger: { kind: "manual", actorRef: "user-1" },
      now: NOW,
    });
    if (!started.ok) throw new Error("startRun should succeed");
    const advanced = advance(
      def,
      started.run,
      { kind: "step_input", payload: {}, at: NOW },
      advanceCtx(),
    );
    if (!advanced.ok) throw new Error("advance should succeed");
    const run = advanced.run;

    const unexpected = recordStepEvidence(
      run,
      evidenceFor("run-ev", "notify", "notification_delivered"),
    );
    expect(unexpected.ok).toBe(false);
    if (!unexpected.ok) expect(unexpected.denyCode).toBe("unexpected_evidence");

    const unusable = recordStepEvidence(run, {
      ...evidenceFor("run-ev", "enroll", "task_completed"),
      provenance: " ",
    });
    expect(unusable.ok).toBe(false);
    if (!unusable.ok) expect(unusable.denyCode).toBe("evidence_not_usable");

    const wrongRun = recordStepEvidence(run, {
      ...evidenceFor("run-ev", "enroll", "task_completed"),
      runId: "other-run",
    });
    expect(wrongRun.ok).toBe(false);
    if (!wrongRun.ok) expect(wrongRun.denyCode).toBe("evidence_run_mismatch");

    const theRecord = evidenceFor("run-ev", "enroll", "task_completed");
    const good = recordStepEvidence(run, theRecord);
    expect(good.ok).toBe(true);
    if (!good.ok) return;

    // Same evidenceId while the expectation is still pending (constructed run).
    const duplicateId = recordStepEvidence({ ...run, evidence: [theRecord] }, theRecord);
    expect(duplicateId.ok).toBe(false);
    if (!duplicateId.ok) expect(duplicateId.denyCode).toBe("duplicate_evidence");

    // After recording, the same evidenceId is still a duplicate (fail closed).
    const replay = recordStepEvidence(good.run, theRecord);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.denyCode).toBe("duplicate_evidence");
      expect(replay.reason).toContain("already recorded");
    }
    expect(
      good.run.evidence.some((e) => e.evidenceId === "ev-enroll" && e.stepId === "enroll"),
    ).toBe(true);
  });
});