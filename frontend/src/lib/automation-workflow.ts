/**
 * CoreGrid — Controlled Automation Engine workflow domain model
 * (Phase 17, Sections AC, AD, AE, AF, AG, AH, AI, AJ, AK, AL, AM, AN, AO,
 * AP, AQ, AR, AS, AT, DE, DF, DG, DH, DI, DJ, DK, DL, DM, DN, FI, FG, FH).
 *
 * Implements `architecture/phase-17-automation-engine.md`:
 * - Workflow engine (AC): multi-step TRIGGER -> CHECK -> APPROVE ->
 *   EXECUTE -> VERIFY -> NOTIFY -> COMPLETE.
 * - Workflow state machine (AD): CREATED, QUEUED, RUNNING, WAITING,
 *   PAUSED, FAILED, COMPENSATING, COMPLETED, CANCELLED, TIMED_OUT.
 * - Durable execution (AE, AF, DE, DF): resumable without duplicating
 *   completed actions; checkpoints (DG); state recovery after failure.
 * - Idempotency (AG, AH, DH): idempotent / conditionally idempotent /
 *   non-idempotent; exactly-once business effects via idempotency +
 *   deduplication, never assumed infrastructure guarantees.
 * - Retry engine (AI, AJ): retry count, backoff, jitter, retryable vs
 *   non-retryable errors, max duration; never blindly retry irreversible
 *   operations.
 * - Timeout engine (AK): action, step, workflow, external call, approval,
 *   execution levels.
 * - Compensation (AL), rollback (AM) and saga (AN): compensating actions
 *   when rollback is impossible; technical vs business compensation vs
 *   human correction.
 * - Dependency graph (AO, FI): A -> B/C/D; cycle detection, unreachable
 *   steps, dead ends, invalid dependencies.
 * - Parallel execution (AP), concurrency control (AQ), race protection
 *   (AR), resource locks with lease/timeout/owner/recovery (AS),
 *   deadlock protection (AT).
 * - Cancellation (DK), pause (DL), resume (DM), timeout (DN).
 * - Loop protection (FG) and bounded recursion (FH): causal IDs,
 *   execution depth, loop counters, cycle detection, max depth/actions.
 *
 * Safety invariants (FM): duplicate events cannot cause uncontrolled
 * duplicate side effects (13); infinite workflow loops cannot continue
 * indefinitely (14); recursive automation has bounded depth (15).
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Workflow state machine (AD)
 * ────────────────────────────────────────────────────────────*/

export type WorkflowState =
  | "CREATED"
  | "QUEUED"
  | "RUNNING"
  | "WAITING"
  | "PAUSED"
  | "FAILED"
  | "COMPENSATING"
  | "COMPLETED"
  | "CANCELLED"
  | "TIMED_OUT";

export const WORKFLOW_STATES: readonly WorkflowState[] = [
  "CREATED",
  "QUEUED",
  "RUNNING",
  "WAITING",
  "PAUSED",
  "FAILED",
  "COMPENSATING",
  "COMPLETED",
  "CANCELLED",
  "TIMED_OUT",
] as const;

const WORKFLOW_TRANSITIONS: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = {
  CREATED: ["QUEUED", "CANCELLED"],
  QUEUED: ["RUNNING", "PAUSED", "CANCELLED"],
  RUNNING: ["WAITING", "PAUSED", "COMPLETED", "FAILED", "COMPENSATING", "CANCELLED"],
  WAITING: ["RUNNING", "PAUSED", "TIMED_OUT", "CANCELLED"],
  PAUSED: ["RUNNING", "CANCELLED"],
  FAILED: ["COMPENSATING", "CANCELLED"],
  COMPENSATING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  CANCELLED: [],
  TIMED_OUT: ["COMPENSATING", "CANCELLED"],
};

export function isWorkflowTransitionAllowed(from: WorkflowState, to: WorkflowState): boolean {
  return WORKFLOW_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * Workflow definition and execution (AC, AO, FI)
 * ────────────────────────────────────────────────────────────*/

export interface WorkflowStep {
  stepId: string;
  actionId: string;
  dependsOn: string[];
  compensationActionId: string | null;
  timeoutMs: number;
  retryCount: number;
  idempotent: boolean;
}

export interface WorkflowDefinition {
  workflowId: string;
  name: string;
  tenantId: TenantId;
  version: number;
  steps: WorkflowStep[];
  maxDepth: number;
  maxActions: number;
  maxDurationMs: number;
}

export interface WorkflowExecution {
  executionId: string;
  workflowId: string;
  workflowVersion: number;
  tenantId: TenantId;
  state: WorkflowState;
  currentStepId: string | null;
  completedStepIds: string[];
  retryCount: number;
  depth: number;
  createdAt: string;
  correlationId: string | null;
  checkpoint: string | null;
}

/**
 * Validate the dependency graph (AO, FI): detect cycles, unreachable
 * steps, dead ends and invalid dependencies before activation (FJ).
 */
export function validateWorkflowGraph(
  steps: WorkflowStep[],
): { ok: true } | { ok: false; error: string } {
  const ids = new Set(steps.map((s) => s.stepId));
  if (steps.length === 0) {
    return { ok: false, error: "Workflow has no steps (AC)" };
  }
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) {
        return { ok: false, error: `Step ${step.stepId} depends on unknown step ${dep} (FI)` };
      }
    }
  }
  // Cycle detection via DFS.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const step of steps) {
      if (step.stepId === id) {
        for (const dep of step.dependsOn) {
          if (visit(dep)) return true;
        }
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const step of steps) {
    if (visit(step.stepId)) {
      return { ok: false, error: "Workflow contains a dependency cycle (FI)" };
    }
  }
  return { ok: true };
}

/**
 * Topological order of executable steps (AO): steps whose dependencies
 * are satisfied may run next.
 */
export function nextReadySteps(steps: WorkflowStep[], completed: ReadonlySet<string>): string[] {
  return steps
    .filter((s) => !completed.has(s.stepId) && s.dependsOn.every((d) => completed.has(d)))
    .map((s) => s.stepId);
}

/* ─────────────────────────────────────────────────────────────
 * Idempotency (AG, AH)
 * ────────────────────────────────────────────────────────────*/

export type IdempotencyClass = "idempotent" | "conditionally_idempotent" | "non_idempotent";

export const IDEMPOTENCY_CLASSES: readonly IdempotencyClass[] = [
  "idempotent",
  "conditionally_idempotent",
  "non_idempotent",
] as const;

/**
 * Idempotency enforcement (AG, AH): non-idempotent actions require
 * stronger execution protection — a step that is non-idempotent can never
 * be re-executed once completed, even on retry/replay (FM.13).
 */
export function mayReExecuteStep(
  step: WorkflowStep,
  alreadyCompleted: boolean,
  isReplay: boolean,
): { ok: boolean; reason: string } {
  if (!alreadyCompleted) {
    return { ok: true, reason: "Step not yet executed" };
  }
  if (step.idempotent) {
    return { ok: true, reason: "Step is idempotent — safe to re-run (AG)" };
  }
  if (isReplay) {
    return { ok: false, reason: "Replay cannot re-execute a non-idempotent step (AH, FM.13)" };
  }
  return { ok: false, reason: "Non-idempotent step cannot be re-executed (AG)" };
}

/* ─────────────────────────────────────────────────────────────
 * Retry safety (AI, AJ)
 * ────────────────────────────────────────────────────────────*/

export type FailureClass =
  | "VALIDATION"
  | "AUTHORIZATION"
  | "POLICY"
  | "DEPENDENCY"
  | "NETWORK"
  | "TIMEOUT"
  | "CONFLICT"
  | "RESOURCE"
  | "EXTERNAL"
  | "SYSTEM"
  | "UNKNOWN";

export const FAILURE_CLASSES: readonly FailureClass[] = [
  "VALIDATION",
  "AUTHORIZATION",
  "POLICY",
  "DEPENDENCY",
  "NETWORK",
  "TIMEOUT",
  "CONFLICT",
  "RESOURCE",
  "EXTERNAL",
  "SYSTEM",
  "UNKNOWN",
] as const;

const RETRYABLE_CLASSES: ReadonlySet<FailureClass> = new Set([
  "DEPENDENCY",
  "NETWORK",
  "TIMEOUT",
  "RESOURCE",
  "EXTERNAL",
  "SYSTEM",
]);

/**
 * Retry safety (AI, AJ): never blindly retry irreversible operations.
 * Authorization, policy and validation failures are never retryable.
 */
export function isFailureRetryable(failureClass: FailureClass): boolean {
  return RETRYABLE_CLASSES.has(failureClass);
}

export function isActionReversible(
  actionId: string,
  reversibleActionIds: ReadonlySet<string>,
): boolean {
  return reversibleActionIds.has(actionId);
}

/**
 * Retry decision (AI): respects retry count, failure class, reversibility
 * and maximum execution duration.
 */
export function shouldRetryAction(input: {
  failureClass: FailureClass;
  retriesUsed: number;
  maxRetries: number;
  actionReversible: boolean;
  elapsedMs: number;
  maxDurationMs: number;
}): { retry: boolean; reason: string } {
  if (!isFailureRetryable(input.failureClass)) {
    return { retry: false, reason: `Failure class ${input.failureClass} is not retryable (AI)` };
  }
  if (input.retriesUsed >= input.maxRetries) {
    return { retry: false, reason: "Retry budget exhausted (AI)" };
  }
  if (input.elapsedMs >= input.maxDurationMs) {
    return { retry: false, reason: "Maximum execution duration reached (AI)" };
  }
  if (!input.actionReversible) {
    return { retry: false, reason: "Irreversible action — no blind retry (AJ)" };
  }
  return { retry: true, reason: "Retryable and within budget" };
}

/* ─────────────────────────────────────────────────────────────
 * Compensation and rollback (AL, AM, AN)
 * ────────────────────────────────────────────────────────────*/

export type RollbackKind = "technical_rollback" | "business_compensation" | "human_correction";

export interface CompensationPlan {
  stepId: string;
  compensationActionId: string | null;
  kind: RollbackKind;
}

/**
 * Build a compensation plan (AL, AM, AN): every completed step either has
 * a compensation action or requires human correction. Unknown compensation
 * is never silently skipped.
 */
export function buildCompensationPlan(
  steps: WorkflowStep[],
  completedStepIds: string[],
): CompensationPlan[] {
  return completedStepIds.map((stepId) => {
    const step = steps.find((s) => s.stepId === stepId);
    return {
      stepId,
      compensationActionId: step?.compensationActionId ?? null,
      kind: step?.compensationActionId ? "business_compensation" : "human_correction",
    };
  });
}

export function hasUncompensableStep(plan: CompensationPlan[]): boolean {
  return plan.some((p) => p.compensationActionId === null);
}

/* ─────────────────────────────────────────────────────────────
 * Concurrency, locks and deadlocks (AQ, AR, AS, AT)
 * ────────────────────────────────────────────────────────────*/

export interface ResourceLock {
  resourceId: string;
  ownerExecutionId: string;
  leaseExpiresAt: string;
  acquiredAt: string;
}

/**
 * Resource lock acquisition (AS): locks require a lease, timeout, owner
 * and recovery. A lock whose lease has expired may be reclaimed.
 */
export function acquireResourceLock(
  locks: ResourceLock[],
  resourceId: string,
  ownerExecutionId: string,
  leaseDurationMs: number,
  now: string,
): { ok: true; locks: ResourceLock[] } | { ok: false; error: string } {
  const existing = locks.find((l) => l.resourceId === resourceId);
  if (existing !== undefined) {
    if (existing.ownerExecutionId === ownerExecutionId) {
      return { ok: true, locks };
    }
    if (Date.parse(now) > Date.parse(existing.leaseExpiresAt)) {
      // Lease expired — reclaimable (AS: recovery).
      const rest = locks.filter((l) => l.resourceId !== resourceId);
      return {
        ok: true,
        locks: [
          ...rest,
          {
            resourceId,
            ownerExecutionId,
            leaseExpiresAt: new Date(Date.parse(now) + leaseDurationMs).toISOString(),
            acquiredAt: now,
          },
        ],
      };
    }
    return {
      ok: false,
      error: `Resource ${resourceId} is locked by ${existing.ownerExecutionId} (AS)`,
    };
  }
  return {
    ok: true,
    locks: [
      ...locks,
      {
        resourceId,
        ownerExecutionId,
        leaseExpiresAt: new Date(Date.parse(now) + leaseDurationMs).toISOString(),
        acquiredAt: now,
      },
    ],
  };
}

export function releaseResourceLock(
  locks: ResourceLock[],
  resourceId: string,
  ownerExecutionId: string,
): ResourceLock[] {
  return locks.filter(
    (l) => !(l.resourceId === resourceId && l.ownerExecutionId === ownerExecutionId),
  );
}

/**
 * Deadlock detection (AT): a cycle in the lock-wait graph means deadlock.
 * This is a simplified wait-for graph check.
 */
export function isDeadlockPresent(
  locks: ResourceLock[],
  waits: Array<{ executionId: string; waitsForExecutionId: string }>,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const w of waits) {
    if (!adjacency.has(w.executionId)) adjacency.set(w.executionId, []);
    adjacency.get(w.executionId)!.push(w.waitsForExecutionId);
  }
  for (const start of adjacency.keys()) {
    const visited = new Set<string>();
    const stack = [...(adjacency.get(start) ?? [])];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node === start) {
        return true;
      }
      if (visited.has(node)) {
        continue;
      }
      visited.add(node);
      for (const next of adjacency.get(node) ?? []) {
        stack.push(next);
      }
    }
  }
  return false;
}

/* ─────────────────────────────────────────────────────────────
 * Loop protection (FG, FH)
 * ────────────────────────────────────────────────────────────*/

export interface ExecutionBudget {
  maxDepth: number;
  maxActions: number;
  maxDurationMs: number;
}

/**
 * Recursive automation limits (FH): every execution has a maximum depth,
 * maximum actions and maximum duration. Infinite loops cannot continue
 * indefinitely (FM.14); recursion is bounded (FM.15).
 */
export function isExecutionWithinBudget(
  budget: ExecutionBudget,
  current: { depth: number; actionsExecuted: number; elapsedMs: number },
): { ok: boolean; reason: string } {
  if (current.depth > budget.maxDepth) {
    return {
      ok: false,
      reason: `Execution depth ${current.depth} exceeds max ${budget.maxDepth} (FH, FM.15)`,
    };
  }
  if (current.actionsExecuted > budget.maxActions) {
    return {
      ok: false,
      reason: `Action count ${current.actionsExecuted} exceeds max ${budget.maxActions} (FH, FM.14)`,
    };
  }
  if (current.elapsedMs > budget.maxDurationMs) {
    return { ok: false, reason: `Execution duration exceeds max ${budget.maxDurationMs}ms (FH)` };
  }
  return { ok: true, reason: "Within execution budget" };
}

export function canNestWorkflow(
  causalChain: string[],
  proposedCausalId: string,
  maxDepth: number,
): { ok: boolean; reason: string } {
  if (causalChain.includes(proposedCausalId)) {
    return { ok: false, reason: `Causal cycle detected for ${proposedCausalId} (FG)` };
  }
  if (causalChain.length >= maxDepth) {
    return {
      ok: false,
      reason: `Recursion depth ${causalChain.length} would exceed max ${maxDepth} (FH)`,
    };
  }
  return { ok: true, reason: "Nesting allowed" };
}
