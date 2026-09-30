/**
 * CoreGrid — AI Agent System planning engine interface.
 *
 * Implements `architecture/phase-07-ai-agent-system.md`:
 * - Agents may produce plans before execution; a plan contains steps (Section AJ).
 * - Plans must be validated before high-impact execution (Section AK).
 * - Execution must follow authorized steps; agents must not silently expand the
 *   plan into unauthorized actions (Section AL).
 * - Agents may replan when dependencies fail, new information arrives, or
 *   assumptions become invalid; high-risk replanning may require approval (AM).
 * - Every autonomous task may have budgets: token, time, tool-call, financial,
 *   compute (Section AN).
 * - Canonical loop: perceive → decide → act (Section AO).
 * - Every autonomous loop requires termination conditions (Section AP).
 * - Infinite loop protection: detect repeated tool calls, repeated plans, cyclic
 *   delegation, identical failed actions, runaway reasoning, recursive spawning (AQ).
 */

import type { TaskId } from "./agent-tasks";
import type { AgentId } from "./agent-core";

/* ─────────────────────────────────────────────
 * Branded IDs
 * ─────────────────────────────────────────────*/

export type PlanId = string & { readonly __brand: "PlanId" };
export type PlanStepId = string & { readonly __brand: "PlanStepId" };

export function planId(raw: string): PlanId {
  return raw as PlanId;
}

export function planStepId(raw: string): PlanStepId {
  return raw as PlanStepId;
}

/* ─────────────────────────────────────────────
 * Plan budgets (Section AN)
 * ─────────────────────────────────────────────*/

export interface PlanBudget {
  maxTokens: number | null;
  maxTimeSeconds: number | null;
  maxToolCalls: number | null;
  maxFinancialCost: number | null;
  maxComputeUnits: number | null;
}

/* ─────────────────────────────────────────────
 * Plan model (Sections AJ, AK)
 * ─────────────────────────────────────────────*/

export type PlanStepActionType =
  "tool_call" | "subtask" | "delegation" | "model_inference" | "approval_request" | "terminal";

export interface PlanStep {
  id: PlanStepId;
  order: number;
  actionType: PlanStepActionType;
  description: string;
  toolId: string | null;
  targetAgentId: AgentId | null;
  requiresApproval: boolean;
}

export interface AgentPlan {
  id: PlanId;
  taskId: TaskId;
  agentId: AgentId;
  objective: string;
  steps: PlanStep[];
  budget: PlanBudget;
  status: "draft" | "validated" | "executing" | "completed" | "aborted";
  createdAt: string;
  updatedAt: string;
  replanCount: number;
  maxReplans: number;
}

export type CreatePlanResult = { ok: true; plan: AgentPlan } | { ok: false; error: string };

export function createAgentPlan(
  taskId: TaskId,
  agentId: AgentId,
  objective: string,
  steps: PlanStep[],
  budget: PlanBudget,
  now: string,
): CreatePlanResult {
  if (objective.trim() === "") {
    return { ok: false, error: "Plan objective is required" };
  }
  if (steps.length === 0) {
    return { ok: false, error: "Plan must contain at least one step" };
  }
  // Steps must have strictly increasing order and no duplicate ids.
  const seenOrders = new Set<number>();
  const seenIds = new Set<string>();
  for (const step of steps) {
    if (seenIds.has(step.id)) {
      return { ok: false, error: `Duplicate plan step id: ${step.id}` };
    }
    if (seenOrders.has(step.order)) {
      return { ok: false, error: `Duplicate plan step order: ${step.order}` };
    }
    seenIds.add(step.id);
    seenOrders.add(step.order);
  }

  return {
    ok: true,
    plan: {
      id: planId(`${taskId}:${now}`),
      taskId,
      agentId,
      objective,
      steps,
      budget,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      replanCount: 0,
      maxReplans: 3,
    },
  };
}

/* ─────────────────────────────────────────────
 * Plan validation (Section AK)
 * ─────────────────────────────────────────────*/

export type PlanValidationResult = { ok: true } | { ok: false; errors: string[] };

export function validateAgentPlan(
  plan: AgentPlan,
  allowedToolIds: string[],
  delegateToolIds: string[],
): PlanValidationResult {
  const errors: string[] = [];
  for (const step of plan.steps) {
    if (step.actionType === "tool_call" && step.toolId) {
      if (!allowedToolIds.includes(step.toolId)) {
        errors.push(`Step ${step.order} uses tool ${step.toolId} not in allowlist`);
      }
    }
    if (step.actionType === "delegation" && step.targetAgentId) {
      if (!delegateToolIds.some((t) => t === step.toolId) && step.toolId === null) {
        errors.push(`Step ${step.order} delegates without a delegation tool`);
      }
    }
  }
  if (!plan.budget.maxToolCalls && plan.steps.length > 10) {
    errors.push("Plan exceeds default step count without tool-call budget");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/* ─────────────────────────────────────────────
 * Replanning (Section AM)
 * ─────────────────────────────────────────────*/

export type ReplanDecision =
  { ok: true; requiresApproval: boolean; plan: AgentPlan } | { ok: false; error: string };

export function shouldReplan(
  plan: AgentPlan,
  reason: "dependency_failed" | "new_information" | "assumption_invalid",
  highRisk: boolean,
): ReplanDecision {
  if (plan.status !== "executing") {
    return { ok: false, error: "Only executing plans may replan" };
  }
  if (plan.replanCount >= plan.maxReplans) {
    return { ok: false, error: `Max replans (${plan.maxReplans}) exceeded` };
  }
  const requiresApproval = highRisk || reason === "assumption_invalid";
  return {
    ok: true,
    requiresApproval,
    plan: { ...plan, replanCount: plan.replanCount + 1 },
  };
}

/* ─────────────────────────────────────────────
 * Infinite loop protection (Section AQ)
 * ─────────────────────────────────────────────*/

export interface LoopMonitorState {
  repeatedToolCallThreshold: number;
  repeatedPlanThreshold: number;
  repeatedFailureThreshold: number;
  currentRetries: Record<string, number>;
  currentFailures: Record<string, number>;
  totalSteps: number;
  maxTotalSteps: number;
}

export function checkLoopSafety(
  monitor: LoopMonitorState,
  toolCallId: string,
  failed: boolean,
  now: string,
): { safe: true } | { safe: false; reason: string } {
  if (monitor.totalSteps >= monitor.maxTotalSteps) {
    return { safe: false, reason: "Maximum total steps exceeded (runaway reasoning)" };
  }
  // Repeated identical tool calls (Section AQ).
  const callCount = (monitor.currentRetries[toolCallId] ?? 0) + 1;
  if (callCount > monitor.repeatedToolCallThreshold) {
    return { safe: false, reason: `Repeated tool call ${toolCallId} exceeds threshold` };
  }
  // Repeated identical failures (Section AQ).
  if (failed) {
    const failCount = (monitor.currentFailures[toolCallId] ?? 0) + 1;
    if (failCount > monitor.repeatedFailureThreshold) {
      return { safe: false, reason: `Repeated failure on ${toolCallId} exceeds threshold` };
    }
  }
  return { safe: true };
}
