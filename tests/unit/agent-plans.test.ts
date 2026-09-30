/**
 * CoreGrid Scholar — Phase 07 AI Agent System unit tests (agent-plans).
 *
 * Validates:
 * - Plan creation and validation (Sections AJ, AK).
 * - Plan execution must follow authorized steps / tool allowlists (Section AL).
 * - Replanning rules and approval requirements (Section AM).
 * - Infinite loop protection (Section AQ).
 */

import { describe, expect, it } from "vitest";
import { agentId } from "@/lib/agent-core";
import { taskId } from "@/lib/agent-tasks";
import {
  createAgentPlan,
  validateAgentPlan,
  shouldReplan,
  checkLoopSafety,
  type PlanStep,
  type PlanBudget,
  type LoopMonitorState,
} from "@/lib/agent-plans";

const AGENT_A = agentId("attendance_assistant");
const TASK_A = taskId("task-1");
const NOW = "2026-01-01T00:00:00Z";

const NO_BUDGET: PlanBudget = {
  maxTokens: null,
  maxTimeSeconds: null,
  maxToolCalls: null,
  maxFinancialCost: null,
  maxComputeUnits: null,
};

function step(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: "step-1" as PlanStep["id"],
    order: 1,
    actionType: "tool_call",
    description: "read attendance",
    toolId: "attendance.read",
    targetAgentId: null,
    requiresApproval: false,
    ...overrides,
  };
}

describe("createAgentPlan", () => {
  it("creates a draft plan with at least one step", () => {
    const result = createAgentPlan(
      TASK_A,
      AGENT_A,
      "Summarize attendance",
      [step()],
      NO_BUDGET,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.status).toBe("draft");
      expect(result.plan.replanCount).toBe(0);
    }
  });

  it("rejects an empty objective", () => {
    const result = createAgentPlan(TASK_A, AGENT_A, "  ", [step()], NO_BUDGET, NOW);
    expect(result.ok).toBe(false);
  });

  it("rejects a plan with no steps", () => {
    const result = createAgentPlan(TASK_A, AGENT_A, "Objective", [], NO_BUDGET, NOW);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate step ids", () => {
    const result = createAgentPlan(
      TASK_A,
      AGENT_A,
      "Objective",
      [step({ id: "dup" as PlanStep["id"] }), step({ id: "dup" as PlanStep["id"], order: 2 })],
      NO_BUDGET,
      NOW,
    );
    expect(result.ok).toBe(false);
  });
});

describe("validateAgentPlan (Section AL)", () => {
  it("passes when all tools are in the allowlist", () => {
    const created = createAgentPlan(TASK_A, AGENT_A, "Objective", [step()], NO_BUDGET, NOW);
    if (!created.ok) throw new Error("fixture failed");
    const result = validateAgentPlan(created.plan, ["attendance.read"], []);
    expect(result.ok).toBe(true);
  });

  it("flags a step using a tool outside the allowlist", () => {
    const created = createAgentPlan(TASK_A, AGENT_A, "Objective", [step()], NO_BUDGET, NOW);
    if (!created.ok) throw new Error("fixture failed");
    const result = validateAgentPlan(created.plan, ["other.tool"], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("flags excessive steps without a tool-call budget", () => {
    const steps = Array.from({ length: 11 }, (_, i) =>
      step({ id: `step-${i}` as PlanStep["id"], order: i + 1 }),
    );
    const created = createAgentPlan(TASK_A, AGENT_A, "Objective", steps, NO_BUDGET, NOW);
    if (!created.ok) throw new Error("fixture failed");
    const result = validateAgentPlan(created.plan, ["attendance.read"], []);
    expect(result.ok).toBe(false);
  });
});

describe("shouldReplan (Section AM)", () => {
  function executingPlan(overrides: Partial<{ replanCount: number; maxReplans: number }> = {}) {
    const created = createAgentPlan(TASK_A, AGENT_A, "Objective", [step()], NO_BUDGET, NOW);
    if (!created.ok) throw new Error("fixture failed");
    return { ...created.plan, status: "executing" as const, ...overrides };
  }

  it("rejects replanning a non-executing plan", () => {
    const created = createAgentPlan(TASK_A, AGENT_A, "Objective", [step()], NO_BUDGET, NOW);
    if (!created.ok) throw new Error("fixture failed");
    const result = shouldReplan(created.plan, "dependency_failed", false);
    expect(result.ok).toBe(false);
  });

  it("rejects replanning beyond maxReplans", () => {
    const plan = executingPlan({ replanCount: 3, maxReplans: 3 });
    const result = shouldReplan(plan, "new_information", false);
    expect(result.ok).toBe(false);
  });

  it("requires approval for high-risk or assumption-invalid replans", () => {
    const plan = executingPlan();
    const result = shouldReplan(plan, "assumption_invalid", false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.requiresApproval).toBe(true);
    }
  });

  it("does not require approval for low-risk dependency failures", () => {
    const plan = executingPlan();
    const result = shouldReplan(plan, "dependency_failed", false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.requiresApproval).toBe(false);
      expect(result.plan.replanCount).toBe(1);
    }
  });
});

describe("checkLoopSafety (Section AQ)", () => {
  function baseMonitor(overrides: Partial<LoopMonitorState> = {}): LoopMonitorState {
    return {
      repeatedToolCallThreshold: 3,
      repeatedPlanThreshold: 3,
      repeatedFailureThreshold: 2,
      currentRetries: {},
      currentFailures: {},
      totalSteps: 0,
      maxTotalSteps: 100,
      ...overrides,
    };
  }

  it("allows a normal step", () => {
    const result = checkLoopSafety(baseMonitor(), "tool-call-1", false, NOW);
    expect(result.safe).toBe(true);
  });

  it("blocks when total steps exceed the max (runaway reasoning)", () => {
    const monitor = baseMonitor({ totalSteps: 100 });
    const result = checkLoopSafety(monitor, "tool-call-1", false, NOW);
    expect(result.safe).toBe(false);
  });

  it("blocks repeated identical tool calls beyond the threshold", () => {
    const monitor = baseMonitor({ currentRetries: { "tool-call-1": 3 } });
    const result = checkLoopSafety(monitor, "tool-call-1", false, NOW);
    expect(result.safe).toBe(false);
  });

  it("blocks repeated identical failures beyond the threshold", () => {
    const monitor = baseMonitor({ currentFailures: { "tool-call-1": 2 } });
    const result = checkLoopSafety(monitor, "tool-call-1", true, NOW);
    expect(result.safe).toBe(false);
  });
});
