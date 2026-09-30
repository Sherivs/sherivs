/**
 * CoreGrid Scholar — Phase 17 Controlled Automation Engine unit tests
 * (automation-workflow).
 *
 * Validates:
 * - Workflow state machine (AD): legal/illegal transitions.
 * - Dependency graph (AO, FI): cycle detection, unknown deps, topological
 *   ready steps.
 * - Idempotency (AG, AH): non-idempotent steps never re-execute on replay.
 * - Retry safety (AI, AJ): irreversible actions never blindly retried.
 * - Compensation (AL, AM): unknown compensation is never silently skipped.
 * - Resource locks (AS) and deadlock detection (AT).
 * - Loop protection (FG, FH): bounded recursion, budget enforcement.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  isWorkflowTransitionAllowed,
  validateWorkflowGraph,
  nextReadySteps,
  mayReExecuteStep,
  isFailureRetryable,
  shouldRetryAction,
  buildCompensationPlan,
  hasUncompensableStep,
  acquireResourceLock,
  releaseResourceLock,
  isDeadlockPresent,
  isExecutionWithinBudget,
  canNestWorkflow,
  type WorkflowStep,
} from "@/lib/automation-workflow";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

function step(id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    stepId: id,
    actionId: `action-${id}`,
    dependsOn: [],
    compensationActionId: null,
    timeoutMs: 30_000,
    retryCount: 2,
    idempotent: true,
    ...overrides,
  };
}

describe("Workflow state machine (AD)", () => {
  it("walks the canonical happy path", () => {
    expect(isWorkflowTransitionAllowed("CREATED", "QUEUED")).toBe(true);
    expect(isWorkflowTransitionAllowed("QUEUED", "RUNNING")).toBe(true);
    expect(isWorkflowTransitionAllowed("RUNNING", "COMPLETED")).toBe(true);
  });

  it("allows compensation after failure", () => {
    expect(isWorkflowTransitionAllowed("FAILED", "COMPENSATING")).toBe(true);
    expect(isWorkflowTransitionAllowed("COMPENSATING", "COMPLETED")).toBe(true);
  });

  it("blocks an illegal CREATED -> COMPLETED jump", () => {
    expect(isWorkflowTransitionAllowed("CREATED", "COMPLETED")).toBe(false);
  });

  it("allows WAITING -> TIMED_OUT and then compensation", () => {
    expect(isWorkflowTransitionAllowed("WAITING", "TIMED_OUT")).toBe(true);
    expect(isWorkflowTransitionAllowed("TIMED_OUT", "COMPENSATING")).toBe(true);
  });
});

describe("Dependency graph (AO, FI)", () => {
  it("accepts a valid DAG", () => {
    const steps = [
      step("check", { dependsOn: [] }),
      step("approve", { dependsOn: ["check"] }),
      step("execute", { dependsOn: ["approve"] }),
    ];
    expect(validateWorkflowGraph(steps).ok).toBe(true);
  });

  it("rejects a dependency cycle (FI)", () => {
    const steps = [step("a", { dependsOn: ["b"] }), step("b", { dependsOn: ["a"] })];
    const result = validateWorkflowGraph(steps);
    expect(result.ok).toBe(false);
  });

  it("rejects a dependency on an unknown step", () => {
    const steps = [step("a", { dependsOn: ["ghost"] })];
    const result = validateWorkflowGraph(steps);
    expect(result.ok).toBe(false);
  });

  it("rejects a workflow with no steps", () => {
    expect(validateWorkflowGraph([]).ok).toBe(false);
  });

  it("computes ready steps topologically (AO)", () => {
    const steps = [step("a"), step("b", { dependsOn: ["a"] }), step("c", { dependsOn: ["a"] })];
    expect(nextReadySteps(steps, new Set())).toEqual(["a"]);
    expect(nextReadySteps(steps, new Set(["a"])).sort()).toEqual(["b", "c"]);
  });
});

describe("Idempotency (AG, AH)", () => {
  it("allows re-execution of idempotent steps", () => {
    const result = mayReExecuteStep(step("a", { idempotent: true }), true, false);
    expect(result.ok).toBe(true);
  });

  it("never re-executes non-idempotent completed steps on replay (AH, FM.13)", () => {
    const result = mayReExecuteStep(step("a", { idempotent: false }), true, true);
    expect(result.ok).toBe(false);
  });

  it("allows first-time execution of any step", () => {
    const result = mayReExecuteStep(step("a", { idempotent: false }), false, false);
    expect(result.ok).toBe(true);
  });
});

describe("Retry safety (AI, AJ)", () => {
  it("never retries authorization/policy failures", () => {
    expect(isFailureRetryable("AUTHORIZATION")).toBe(false);
    expect(isFailureRetryable("POLICY")).toBe(false);
    expect(isFailureRetryable("NETWORK")).toBe(true);
  });

  it("never blindly retries irreversible actions (AJ)", () => {
    const result = shouldRetryAction({
      failureClass: "NETWORK",
      retriesUsed: 0,
      maxRetries: 3,
      actionReversible: false,
      elapsedMs: 1000,
      maxDurationMs: 60_000,
    });
    expect(result.retry).toBe(false);
  });

  it("retries reversible actions within budget", () => {
    const result = shouldRetryAction({
      failureClass: "TIMEOUT",
      retriesUsed: 1,
      maxRetries: 3,
      actionReversible: true,
      elapsedMs: 1000,
      maxDurationMs: 60_000,
    });
    expect(result.retry).toBe(true);
  });

  it("stops retrying when the budget is exhausted", () => {
    const result = shouldRetryAction({
      failureClass: "NETWORK",
      retriesUsed: 3,
      maxRetries: 3,
      actionReversible: true,
      elapsedMs: 1000,
      maxDurationMs: 60_000,
    });
    expect(result.retry).toBe(false);
  });
});

describe("Compensation and rollback (AL, AM)", () => {
  it("maps completed steps to compensation actions", () => {
    const steps = [step("create", { compensationActionId: "delete" }), step("notify")];
    const plan = buildCompensationPlan(steps, ["create", "notify"]);
    expect(plan.find((p) => p.stepId === "create")?.compensationActionId).toBe("delete");
    expect(plan.find((p) => p.stepId === "notify")?.kind).toBe("human_correction");
  });

  it("flags uncompensable steps — never silently skipped", () => {
    const plan = buildCompensationPlan([step("a")], ["a"]);
    expect(hasUncompensableStep(plan)).toBe(true);
    const full = buildCompensationPlan([step("a", { compensationActionId: "undo-a" })], ["a"]);
    expect(hasUncompensableStep(full)).toBe(false);
  });
});

describe("Resource locks and deadlocks (AS, AT)", () => {
  it("acquires a lock with a lease, owner and recovery", () => {
    const result = acquireResourceLock([], "room-1", "exec-1", 60_000, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.locks[0].ownerExecutionId).toBe("exec-1");
      expect(Date.parse(result.locks[0].leaseExpiresAt)).toBeGreaterThan(Date.parse(NOW));
    }
  });

  it("rejects acquisition of a live lock held by another owner", () => {
    const acquired = acquireResourceLock([], "room-1", "exec-1", 60_000, NOW);
    if (!acquired.ok) throw new Error("fixture failed");
    const blocked = acquireResourceLock(acquired.locks, "room-1", "exec-2", 60_000, NOW);
    expect(blocked.ok).toBe(false);
  });

  it("reclaims an expired lease (AS recovery)", () => {
    const acquired = acquireResourceLock([], "room-1", "exec-1", 60_000, "2026-01-01T00:00:00Z");
    if (!acquired.ok) throw new Error("fixture failed");
    const reclaimed = acquireResourceLock(
      acquired.locks,
      "room-1",
      "exec-2",
      60_000,
      "2026-01-01T00:05:00Z",
    );
    expect(reclaimed.ok).toBe(true);
    if (reclaimed.ok) {
      expect(reclaimed.locks[0].ownerExecutionId).toBe("exec-2");
    }
  });

  it("releases a lock only by its owner", () => {
    const acquired = acquireResourceLock([], "room-1", "exec-1", 60_000, NOW);
    if (!acquired.ok) throw new Error("fixture failed");
    const after = releaseResourceLock(acquired.locks, "room-1", "exec-1");
    expect(after).toHaveLength(0);
  });

  it("detects a deadlock cycle in the wait-for graph (AT)", () => {
    const waits = [
      { executionId: "e1", waitsForExecutionId: "e2" },
      { executionId: "e2", waitsForExecutionId: "e1" },
    ];
    expect(isDeadlockPresent([], waits)).toBe(true);
    expect(isDeadlockPresent([], [{ executionId: "e1", waitsForExecutionId: "e2" }])).toBe(false);
  });
});

describe("Loop protection and budgets (FG, FH)", () => {
  it("enforces depth/action/duration budgets (FM.14, FM.15)", () => {
    const budget = { maxDepth: 3, maxActions: 10, maxDurationMs: 60_000 };
    expect(
      isExecutionWithinBudget(budget, { depth: 2, actionsExecuted: 5, elapsedMs: 10_000 }).ok,
    ).toBe(true);
    expect(
      isExecutionWithinBudget(budget, { depth: 4, actionsExecuted: 5, elapsedMs: 10_000 }).ok,
    ).toBe(false);
    expect(
      isExecutionWithinBudget(budget, { depth: 2, actionsExecuted: 11, elapsedMs: 10_000 }).ok,
    ).toBe(false);
  });

  it("detects causal cycles and enforces recursion depth", () => {
    expect(canNestWorkflow(["a"], "b", 3).ok).toBe(true);
    expect(canNestWorkflow(["a", "b"], "a", 3).ok).toBe(false);
    expect(canNestWorkflow(["a", "b", "c"], "d", 3).ok).toBe(false);
  });
});
