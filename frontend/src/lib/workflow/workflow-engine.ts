/**
 * CoreGrid — Workflow Engine, pure in-memory evaluator
 * (V5.3 Part 17, MISSION-V1-008).
 *
 * Generalizes the live-tested durable mission loop vocabulary
 * (control-plane/foundation-loop.ts + foundation-mission.ts) — it does not
 * rebuild or compete with it. This module:
 * - starts runs only for matched, same-tenant, non-revoked actors and
 *   matched triggers (cross-tenant and mismatched triggers are denied);
 * - evaluates condition steps against event payloads (UNKNOWN never means
 *   TRUE — fail closed, mirroring automation-core law M);
 * - blocks approval steps behind an approval record referencing a human:
 *   an AI actor can NEVER satisfy an approval step (Part 13 law);
 * - emits AuthorizedActionPlans bounded by a step's authorizedActions and
 *   NEVER executes actions itself;
 * - applies the definition's failure policy (retry with attempt
 *   accounting, halt, escalate);
 * - enforces EVIDENCE before COMPLETION: a run cannot reach completed
 *   while any completed step lacks its evidence record;
 * - treats terminal states as immutable (transitions fail closed).
 *
 * This module performs no persistence, no timers and no I/O. Durable
 * persistence of workflow runs requires an approved migration; the retry
 * backoff is recorded as data, not scheduled here.
 */

import {
  isActionAuthorized,
  isRunTransitionAllowed,
  isTriggerMatch,
  validateWorkflowDefinition,
  workflowEvidenceIsUsable,
  type AdvanceContext,
  type ApprovalRequirement,
  type AuthorizedActionPlan,
  type EvidenceExpectation,
  type FailurePolicy,
  type RunHistoryEntry,
  type StepAssignment,
  type StepAttempt,
  type StepBranches,
  type StepCondition,
  type WorkflowActorScope,
  type WorkflowDefinition,
  type WorkflowEvidenceRecord,
  type WorkflowRun,
  type WorkflowRunEvent,
  type WorkflowRunState,
  type WorkflowStep,
  type WorkflowTrigger,
} from "./workflow-contract";

// Convenience re-exports so consumers of the engine get the full contract
// vocabulary from one module.
export type {
  AdvanceContext,
  ApprovalRecord,
  AuthorizedActionPlan,
  EvidenceExpectation,
  WorkflowActorScope,
  WorkflowEvidenceRecord,
  WorkflowRunEvent,
  WorkflowTrigger,
} from "./workflow-contract";

/* ─────────────────────────────────────────────────────────────
 * Results
 * ────────────────────────────────────────────────────────────*/

export type StartRunDenyCode =
  | "invalid_definition"
  | "revoked_actor"
  | "cross_tenant"
  | "trigger_mismatch"
  | "ai_trigger_actor_mismatch";

export type AdvanceDenyCode =
  | "terminal_state_immutable"
  | "revoked_actor"
  | "cross_tenant"
  | "unknown_step"
  | "event_kind_mismatch"
  | "assignment_mismatch"
  | "action_not_authorized"
  | "not_action_step"
  | "approval_step_mismatch"
  | "approval_not_awaited"
  | "ai_cannot_satisfy_approval"
  | "human_ref_required"
  | "approver_role_mismatch"
  | "retry_exhausted"
  | "halted"
  | "escalation_required"
  | "step_already_completed"
  | "completion_not_ready"
  | "evidence_pending";

export type EvidenceDenyCode =
  | "terminal_state_immutable"
  | "evidence_run_mismatch"
  | "cross_tenant"
  | "evidence_not_usable"
  | "unexpected_evidence"
  | "duplicate_evidence";

export type StartRunResult =
  | { ok: true; run: WorkflowRun }
  | { ok: false; denyCode: StartRunDenyCode; reason: string };

export type AdvanceResult =
  | {
      ok: true;
      run: WorkflowRun;
      actionPlan: AuthorizedActionPlan | null;
      reason: string;
    }
  | { ok: false; run: WorkflowRun; denyCode: AdvanceDenyCode; reason: string };

export type RecordEvidenceResult =
  | { ok: true; run: WorkflowRun; reason: string }
  | { ok: false; run: WorkflowRun; denyCode: EvidenceDenyCode; reason: string };

export type PlanActionResult =
  | { ok: true; plan: AuthorizedActionPlan }
  | { ok: false; denyCode: AdvanceDenyCode; reason: string };

/* ─────────────────────────────────────────────────────────────
 * Condition evaluation (fail closed: UNKNOWN is never TRUE)
 * ────────────────────────────────────────────────────────────*/

export type ConditionOutcome = "TRUE" | "FALSE" | "UNKNOWN";

export function evaluateStepCondition(
  condition: StepCondition,
  payload: Record<string, unknown>,
): ConditionOutcome {
  const present = Object.prototype.hasOwnProperty.call(payload, condition.field);
  switch (condition.operator) {
    case "exists":
      return present ? "TRUE" : "FALSE";
    case "equals":
      if (!present) return "UNKNOWN";
      return payload[condition.field] === condition.value ? "TRUE" : "FALSE";
    case "not_equals":
      if (!present) return "UNKNOWN";
      return payload[condition.field] !== condition.value ? "TRUE" : "FALSE";
    case "gte": {
      const actual = payload[condition.field];
      const expected = condition.value;
      if (!present || typeof actual !== "number" || typeof expected !== "number") {
        return "UNKNOWN";
      }
      return actual >= expected ? "TRUE" : "FALSE";
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * Internals
 * ────────────────────────────────────────────────────────────*/

function findStep(def: WorkflowDefinition, stepId: string | null): WorkflowStep | undefined {
  if (stepId === null) return undefined;
  return def.steps.find((s) => s.stepId === stepId);
}

function approvalRequirementFor(
  def: WorkflowDefinition,
  stepId: string,
): ApprovalRequirement | undefined {
  return def.requiredApprovals.find((a) => a.stepId === stepId);
}

function withHistory(run: WorkflowRun, entry: RunHistoryEntry): WorkflowRun {
  return { ...run, history: [...run.history, entry] };
}

function setState(
  run: WorkflowRun,
  to: WorkflowRunState,
  entry: RunHistoryEntry,
): WorkflowRun {
  if (!isRunTransitionAllowed(run.state, to)) {
    // Transitions fail closed; the caller must never reach here.
    return run;
  }
  return {
    ...run,
    state: to,
    history: [...run.history, { ...entry, fromState: run.state, toState: to }],
  };
}

function addExpectation(run: WorkflowRun, expectation: EvidenceExpectation): WorkflowRun {
  const alreadyPending = run.pendingEvidence.some(
    (e) => e.stepId === expectation.stepId && e.evidenceKind === expectation.evidenceKind,
  );
  const alreadySatisfied = run.evidence.some(
    (e) => e.stepId === expectation.stepId && e.evidenceKind === expectation.evidenceKind,
  );
  if (alreadyPending || alreadySatisfied) return run;
  return { ...run, pendingEvidence: [...run.pendingEvidence, expectation] };
}

function stepEvidenceKind(step: WorkflowStep): EvidenceExpectation["evidenceKind"] {
  switch (step.kind) {
    case "condition":
      return "condition_evaluated";
    case "task":
      return "task_completed";
    case "approval":
      return "approval_recorded";
    case "action":
      return "action_planned";
    case "notification":
      return "notification_delivered";
  }
}

function assignmentAllows(assignment: StepAssignment, actor: WorkflowActorScope): boolean {
  if (assignment.kind === "unassigned") return true;
  if (assignment.kind === "human") {
    return actor.kind === "human" && actor.roleRef === assignment.roleRef;
  }
  return actor.kind === "ai" && actor.agentRef === assignment.agentRef;
}

function buildPlan(
  run: WorkflowRun,
  step: WorkflowStep,
  actor: WorkflowActorScope,
  now: string,
  requestedAction: string | null,
): AuthorizedActionPlan {
  return {
    planId: `${run.runId}:${step.stepId}:plan`,
    runId: run.runId,
    stepId: step.stepId,
    tenantRef: run.tenantRef,
    authorizedActions: requestedAction === null ? step.authorizedActions : [requestedAction],
    proposedBy: actor.actorId,
    createdAt: now,
    note: "execution_is_external_to_the_workflow_engine",
  };
}

/**
 * Complete the current step, record its evidence expectation, and move to
 * the next step (or the completion gate when target is null).
 */
function completeAndMove(
  def: WorkflowDefinition,
  run: WorkflowRun,
  step: WorkflowStep,
  target: string | null,
  now: string,
  reason: string,
  actionPlan: AuthorizedActionPlan | null,
): AdvanceResult {
  const expectation: EvidenceExpectation = {
    stepId: step.stepId,
    evidenceKind: stepEvidenceKind(step),
    reason,
  };
  let next = addExpectation(run, expectation);
  next = withHistory(next, {
    at: now,
    stepId: step.stepId,
    fromState: next.state,
    toState: null,
    kind: "step_completed",
    reason,
  });

  if (target !== null) {
    const targetStep = findStep(def, target);
    if (targetStep === undefined) {
      return {
        ok: false,
        run: next,
        denyCode: "unknown_step",
        reason: `Step ${step.stepId} targets unknown step ${target}`,
      };
    }
    next = { ...next, currentStepId: target };
    if (targetStep.kind === "approval" && next.state === "running") {
      next = setState(next, "waiting_approval", {
        at: now,
        stepId: target,
        fromState: "running",
        toState: "waiting_approval",
        kind: "awaiting_approval",
        reason: `Step ${target} requires human approval`,
      });
    }
    return { ok: true, run: next, actionPlan, reason };
  }

  // Completion gate: EVIDENCE before COMPLETION (Part 17).
  if (next.pendingEvidence.length > 0) {
    const missing = next.pendingEvidence.map((e) => `${e.stepId}:${e.evidenceKind}`).join(", ");
    return {
      ok: false,
      run: next,
      denyCode: "evidence_pending",
      reason: `EVIDENCE before COMPLETION — missing evidence for ${missing} (Part 17)`,
    };
  }
  const completed = setState(
    { ...next, currentStepId: null, completedAt: now },
    "completed",
    {
      at: now,
      stepId: step.stepId,
      fromState: next.state,
      toState: "completed",
      kind: "run_completed",
      reason: "All steps completed with evidence",
    },
  );
  return { ok: true, run: completed, actionPlan, reason: "Run completed with evidence" };
}

function applyFailurePolicy(
  def: WorkflowDefinition,
  run: WorkflowRun,
  step: WorkflowStep,
  event: Extract<WorkflowRunEvent, { kind: "failure" }>,
): AdvanceResult {
  const policy: FailurePolicy = def.onFailure;
  const fail = (reason: string): AdvanceResult => {
    const failed = setState(run, "failed", {
      at: event.at,
      stepId: step.stepId,
      fromState: run.state,
      toState: "failed",
      kind: "run_failed",
      reason,
    });
    return { ok: false, run: failed, denyCode: "retry_exhausted", reason };
  };

  if (policy.kind === "halt") {
    const failed = setState(run, "failed", {
      at: event.at,
      stepId: step.stepId,
      fromState: run.state,
      toState: "failed",
      kind: "run_failed",
      reason: `Halt policy — ${event.reason}`,
    });
    return {
      ok: false,
      run: failed,
      denyCode: "halted",
      reason: `Halt policy — ${event.reason}`,
    };
  }
  if (policy.kind === "escalate") {
    const failed = setState(run, "failed", {
      at: event.at,
      stepId: step.stepId,
      fromState: run.state,
      toState: "failed",
      kind: "run_failed",
      reason: `Escalation required — ${event.reason}`,
    });
    return {
      ok: false,
      run: failed,
      denyCode: "escalation_required",
      reason: `Escalation required — ${event.reason}`,
    };
  }

  const consumed = run.attempts.find((a) => a.stepId === step.stepId)?.attempt ?? 1;
  if (consumed < policy.maxAttempts) {
    const attempt: StepAttempt = {
      stepId: step.stepId,
      attempt: consumed + 1,
      lastFailureReason: event.reason,
      backoffSeconds: policy.backoffSeconds,
    };
    const attempts = [
      ...run.attempts.filter((a) => a.stepId !== step.stepId),
      attempt,
    ];
    const retried = withHistory({ ...run, attempts }, {
      at: event.at,
      stepId: step.stepId,
      fromState: run.state,
      toState: null,
      kind: "retry_scheduled",
      reason: `Retry ${consumed + 1}/${policy.maxAttempts} in ${policy.backoffSeconds}s — ${event.reason}`,
    });
    return {
      ok: true,
      run: retried,
      actionPlan: null,
      reason: `Retry scheduled (attempt ${consumed + 1} of ${policy.maxAttempts})`,
    };
  }
  return fail(`Retry budget exhausted after ${policy.maxAttempts} attempts — ${event.reason}`);
}

/* ─────────────────────────────────────────────────────────────
 * startRun
 * ────────────────────────────────────────────────────────────*/

export function startRun(
  def: WorkflowDefinition,
  input: {
    runId: string;
    actor: WorkflowActorScope;
    trigger: WorkflowTrigger;
    now: string;
  },
): StartRunResult {
  const validation = validateWorkflowDefinition(def);
  if (!validation.ok) {
    return { ok: false, denyCode: "invalid_definition", reason: validation.error };
  }
  if (input.actor.revoked) {
    return { ok: false, denyCode: "revoked_actor", reason: "Actor is revoked" };
  }
  if (input.actor.tenantRef !== def.tenantRef) {
    return {
      ok: false,
      denyCode: "cross_tenant",
      reason: `Actor tenant ${input.actor.tenantRef} cannot start a run for ${def.tenantRef}`,
    };
  }
  if (!isTriggerMatch(def.trigger, input.trigger)) {
    return {
      ok: false,
      denyCode: "trigger_mismatch",
      reason: `Trigger ${input.trigger.kind} does not match declared trigger ${def.trigger.kind}`,
    };
  }
  if (
    input.trigger.kind === "ai" &&
    (input.actor.kind !== "ai" || input.actor.agentRef !== input.trigger.agentRef)
  ) {
    return {
      ok: false,
      denyCode: "ai_trigger_actor_mismatch",
      reason: "AI triggers may only be started by the declared AI agent",
    };
  }
  if (input.trigger.kind === "manual" && input.trigger.actorRef !== input.actor.actorId) {
    return {
      ok: false,
      denyCode: "trigger_mismatch",
      reason: "Manual trigger actor does not match the starting actor",
    };
  }

  const first = def.steps[0];
  let run: WorkflowRun = {
    runId: input.runId,
    definitionId: def.definitionId,
    tenantRef: def.tenantRef,
    state: "running",
    currentStepId: first.stepId,
    history: [],
    pendingEvidence: [],
    evidence: [],
    attempts: [],
    startedAt: input.now,
    completedAt: null,
  };
  run = withHistory(run, {
    at: input.now,
    stepId: first.stepId,
    fromState: "running",
    toState: null,
    kind: "run_started",
    reason: `Started from ${input.trigger.kind} trigger`,
  });
  if (first.kind === "approval") {
    run = setState(run, "waiting_approval", {
      at: input.now,
      stepId: first.stepId,
      fromState: "running",
      toState: "waiting_approval",
      kind: "awaiting_approval",
      reason: `Step ${first.stepId} requires human approval`,
    });
  }
  return { ok: true, run };
}

/* ─────────────────────────────────────────────────────────────
 * advance
 * ────────────────────────────────────────────────────────────*/

export function advance(
  def: WorkflowDefinition,
  run: WorkflowRun,
  event: WorkflowRunEvent,
  ctx: AdvanceContext,
): AdvanceResult {
  // Terminal states are immutable — fail closed without mutation.
  if (run.state === "completed" || run.state === "failed" || run.state === "cancelled") {
    return {
      ok: false,
      run,
      denyCode: "terminal_state_immutable",
      reason: `Run is ${run.state} — terminal states are immutable`,
    };
  }
  if (ctx.actor.revoked) {
    return { ok: false, run, denyCode: "revoked_actor", reason: "Actor is revoked" };
  }
  if (ctx.actor.tenantRef !== run.tenantRef) {
    return {
      ok: false,
      run,
      denyCode: "cross_tenant",
      reason: `Actor tenant ${ctx.actor.tenantRef} cannot advance a run in ${run.tenantRef}`,
    };
  }

  const step = findStep(def, run.currentStepId);
  if (step === undefined) {
    return {
      ok: false,
      run,
      denyCode: "unknown_step",
      reason: `Run references unknown step ${String(run.currentStepId)}`,
    };
  }

  if (event.kind === "cancel") {
    const cancelled = setState(run, "cancelled", {
      at: event.at,
      stepId: step.stepId,
      fromState: run.state,
      toState: "cancelled",
      kind: "run_cancelled",
      reason: event.reason,
    });
    return { ok: true, run: { ...cancelled, currentStepId: null }, actionPlan: null, reason: "Run cancelled" };
  }

  if (event.kind === "failure") {
    return applyFailurePolicy(def, run, step, event);
  }

  if (event.kind === "complete") {
    const expectedKind = stepEvidenceKind(step);
    const evidenced = run.evidence.some(
      (e) => e.stepId === step.stepId && e.evidenceKind === expectedKind,
    );
    if (!evidenced) {
      return {
        ok: false,
        run,
        denyCode: "completion_not_ready",
        reason: `Step ${step.stepId} has not been evidenced — complete all steps and record evidence before completion (Part 17)`,
      };
    }
    if (run.pendingEvidence.length > 0) {
      const missing = run.pendingEvidence.map((e) => `${e.stepId}:${e.evidenceKind}`).join(", ");
      return {
        ok: false,
        run,
        denyCode: "evidence_pending",
        reason: `EVIDENCE before COMPLETION — missing evidence for ${missing} (Part 17)`,
      };
    }
    const completed = setState(
      { ...run, currentStepId: null, completedAt: event.at },
      "completed",
      {
        at: event.at,
        stepId: step.stepId,
        fromState: run.state,
        toState: "completed",
        kind: "run_completed",
        reason: "All steps completed with evidence",
      },
    );
    return { ok: true, run: completed, actionPlan: null, reason: "Run completed with evidence" };
  }

  if (event.kind === "approval") {
    if (step.kind !== "approval") {
      return {
        ok: false,
        run,
        denyCode: "approval_step_mismatch",
        reason: `Step ${step.stepId} is not an approval step`,
      };
    }
    if (run.state !== "waiting_approval") {
      return {
        ok: false,
        run,
        denyCode: "approval_not_awaited",
        reason: "Run is not waiting for an approval",
      };
    }
    if (event.record.stepId !== step.stepId) {
      return {
        ok: false,
        run,
        denyCode: "approval_step_mismatch",
        reason: `Approval record targets step ${event.record.stepId}, not the current step`,
      };
    }
    // Part 13 law: an AI actor can never satisfy an approval step.
    if (event.record.approver.kind === "ai") {
      return {
        ok: false,
        run,
        denyCode: "ai_cannot_satisfy_approval",
        reason: "An AI actor can never satisfy an approval step (Part 13 law)",
      };
    }
    if (!event.record.approver.humanRef.trim()) {
      return {
        ok: false,
        run,
        denyCode: "human_ref_required",
        reason: "Approval record must reference a human (humanRef is mandatory)",
      };
    }
    const requirement = approvalRequirementFor(def, step.stepId);
    if (requirement && event.record.approver.roleRef !== requirement.approverRoleRef) {
      return {
        ok: false,
        run,
        denyCode: "approver_role_mismatch",
        reason: `Approver role ${event.record.approver.roleRef} does not match required role ${requirement.approverRoleRef}`,
      };
    }
    if (event.record.decision === "rejected") {
      const rejected = setState(run, "cancelled", {
        at: event.at,
        stepId: step.stepId,
        fromState: run.state,
        toState: "cancelled",
        kind: "approval_rejected",
        reason: `Approval rejected by ${event.record.approver.humanRef}`,
      });
      return {
        ok: true,
        run: { ...rejected, currentStepId: null },
        actionPlan: null,
        reason: "Approval rejected — run cancelled",
      };
    }
    const approved = setState(run, "running", {
      at: event.at,
      stepId: step.stepId,
      fromState: run.state,
      toState: "running",
      kind: "approval_granted",
      reason: `Approved by ${event.record.approver.humanRef}`,
    });
    const target =
      step.nextStepId !== undefined
        ? step.nextStepId
        : null;
    return completeAndMove(
      def,
      approved,
      step,
      target,
      event.at,
      `Approved by ${event.record.approver.humanRef}`,
      null,
    );
  }

  // step_input
  const expectedKind = stepEvidenceKind(step);
  const alreadyCompleted =
    run.pendingEvidence.some(
      (e) => e.stepId === step.stepId && e.evidenceKind === expectedKind,
    ) ||
    run.evidence.some((e) => e.stepId === step.stepId && e.evidenceKind === expectedKind);
  if (alreadyCompleted) {
    return {
      ok: false,
      run,
      denyCode: "step_already_completed",
      reason: `Step ${step.stepId} already completed — record its evidence and send a complete event (Part 17)`,
    };
  }

  if (step.kind === "approval") {
    return {
      ok: false,
      run,
      denyCode: "approval_not_awaited",
      reason: `Step ${step.stepId} requires an approval record; step_input cannot complete it`,
    };
  }

  if (step.kind === "condition") {
    const condition = step.condition;
    const branches: StepBranches | undefined = step.branches;
    if (!condition || !branches) {
      return {
        ok: false,
        run,
        denyCode: "unknown_step",
        reason: `Condition step ${step.stepId} is not fully declared`,
      };
    }
    const outcome = evaluateStepCondition(condition, event.payload);
    // Fail closed: UNKNOWN is never TRUE; it routes to the false branch.
    const target = outcome === "TRUE" ? branches.onTrueStepId : branches.onFalseStepId;
    return completeAndMove(
      def,
      run,
      step,
      target,
      event.at,
      `Condition ${condition.field} ${condition.operator} evaluated ${outcome}`,
      null,
    );
  }

  if (!assignmentAllows(step.assignment, ctx.actor)) {
    return {
      ok: false,
      run,
      denyCode: "assignment_mismatch",
      reason: `Actor ${ctx.actor.actorId} does not satisfy the assignment of step ${step.stepId}`,
    };
  }

  if (step.kind === "action") {
    const planResult = planAuthorizedAction(def, run, event.requestedAction ?? null, ctx);
    if (!planResult.ok) {
      return { ok: false, run, denyCode: planResult.denyCode, reason: planResult.reason };
    }
    const target = step.nextStepId !== undefined ? step.nextStepId : null;
    return completeAndMove(
      def,
      run,
      step,
      target,
      event.at,
      `Authorized action plan issued for ${planResult.plan.authorizedActions.join(", ")}`,
      planResult.plan,
    );
  }

  const target = step.nextStepId !== undefined ? step.nextStepId : null;
  return completeAndMove(def, run, step, target, event.at, `Step ${step.stepId} completed`, null);
}

/* ─────────────────────────────────────────────────────────────
 * planAuthorizedAction (bounded by authorizedActions)
 * ────────────────────────────────────────────────────────────*/

export function planAuthorizedAction(
  def: WorkflowDefinition,
  run: WorkflowRun,
  requestedAction: string | null,
  ctx: AdvanceContext,
): PlanActionResult {
  if (run.state !== "running") {
    return {
      ok: false,
      denyCode: "terminal_state_immutable",
      reason: `Run is ${run.state} — action planning requires a running run`,
    };
  }
  if (ctx.actor.revoked) {
    return { ok: false, denyCode: "revoked_actor", reason: "Actor is revoked" };
  }
  if (ctx.actor.tenantRef !== run.tenantRef) {
    return {
      ok: false,
      denyCode: "cross_tenant",
      reason: `Actor tenant ${ctx.actor.tenantRef} cannot plan actions for a run in ${run.tenantRef}`,
    };
  }
  const step = findStep(def, run.currentStepId);
  if (step === undefined) {
    return { ok: false, denyCode: "unknown_step", reason: "Run references an unknown step" };
  }
  if (step.kind !== "action") {
    return {
      ok: false,
      denyCode: "not_action_step",
      reason: `Step ${step.stepId} is not an action step`,
    };
  }
  if (!assignmentAllows(step.assignment, ctx.actor)) {
    return {
      ok: false,
      denyCode: "assignment_mismatch",
      reason: `Actor ${ctx.actor.actorId} does not satisfy the assignment of step ${step.stepId}`,
    };
  }
  if (requestedAction !== null && !isActionAuthorized(step, requestedAction)) {
    return {
      ok: false,
      denyCode: "action_not_authorized",
      reason: `Action "${requestedAction}" is not in the authorizedActions of step ${step.stepId}`,
    };
  }
  return {
    ok: true,
    plan: buildPlan(run, step, ctx.actor, ctx.now, requestedAction),
  };
}

/* ─────────────────────────────────────────────────────────────
 * recordStepEvidence
 * ────────────────────────────────────────────────────────────*/

export function recordStepEvidence(
  run: WorkflowRun,
  record: WorkflowEvidenceRecord,
): RecordEvidenceResult {
  if (run.state === "completed" || run.state === "failed" || run.state === "cancelled") {
    return {
      ok: false,
      run,
      denyCode: "terminal_state_immutable",
      reason: `Run is ${run.state} — evidence cannot be recorded on a terminal run`,
    };
  }
  if (record.runId !== run.runId) {
    return {
      ok: false,
      run,
      denyCode: "evidence_run_mismatch",
      reason: `Evidence references run ${record.runId}, not ${run.runId}`,
    };
  }
  if (record.tenantRef !== run.tenantRef) {
    return {
      ok: false,
      run,
      denyCode: "cross_tenant",
      reason: `Evidence tenant ${record.tenantRef} does not match run tenant ${run.tenantRef}`,
    };
  }
  if (!workflowEvidenceIsUsable(record)) {
    return {
      ok: false,
      run,
      denyCode: "evidence_not_usable",
      reason: "Evidence record is missing producer, provenance or integrity",
    };
  }
  if (run.evidence.some((e) => e.evidenceId === record.evidenceId)) {
    return {
      ok: false,
      run,
      denyCode: "duplicate_evidence",
      reason: `Evidence ${record.evidenceId} was already recorded`,
    };
  }
  const pending = run.pendingEvidence.find(
    (e) => e.stepId === record.stepId && e.evidenceKind === record.evidenceKind,
  );
  if (pending === undefined) {
    return {
      ok: false,
      run,
      denyCode: "unexpected_evidence",
      reason: `No pending expectation for step ${record.stepId} (${record.evidenceKind})`,
    };
  }
  const next: WorkflowRun = {
    ...run,
    pendingEvidence: run.pendingEvidence.filter((e) => e !== pending),
    evidence: [...run.evidence, record],
    history: [
      ...run.history,
      {
        at: record.recordedAt,
        stepId: record.stepId,
        fromState: run.state,
        toState: null,
        kind: "evidence_recorded",
        reason: `${record.evidenceKind} evidenced by ${record.evidenceId}`,
      },
    ],
  };
  return { ok: true, run: next, reason: "Evidence recorded against pending expectation" };
}