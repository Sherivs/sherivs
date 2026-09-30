/**
 * CoreGrid — AI Agent System task model.
 *
 * Implements `architecture/phase-07-ai-agent-system.md`:
 * - A task represents work assigned to an agent (Section AB).
 * - Task states: scheduled, awaiting_approval, running, paused, retrying,
 *   succeeded, failed, cancelled (Section AC).
 * - Task priority never overrides security controls (Section AD).
 * - Deadlines: start, completion, max execution (Section AE).
 * - Authorized cancellation (Section AF).
 * - Checkpoints preserve state for safe resume (Sections AG, AH).
 * - Recoverable failures allow controlled retry or resume (Section AI).
 */

import type { TenantId } from "./tenant-core";
import type { AgentId } from "./agent-core";

/* ─────────────────────────────────────────────
 * Branded IDs
 * ─────────────────────────────────────────────*/

export type TaskId = string & { readonly __brand: "TaskId" };
export type TaskCheckpointId = string & { readonly __brand: "TaskCheckpointId" };

export function taskId(raw: string): TaskId {
  return raw as TaskId;
}

export function taskCheckpointId(raw: string): TaskCheckpointId {
  return raw as TaskCheckpointId;
}

/* ─────────────────────────────────────────────
 * Task states (Section AC)
 * ─────────────────────────────────────────────*/

export type TaskState =
  | "scheduled"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "paused"
  | "retrying"
  | "succeeded"
  | "failed"
  | "cancelled";

export const TASK_STATES: readonly TaskState[] = [
  "scheduled",
  "planning",
  "awaiting_approval",
  "running",
  "paused",
  "retrying",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export interface TaskTransition {
  from: TaskState;
  to: TaskState;
  allowed: boolean;
}

export const TASK_TRANSITIONS: readonly TaskTransition[] = [
  { from: "scheduled", to: "planning", allowed: true },
  { from: "scheduled", to: "cancelled", allowed: true },
  { from: "planning", to: "awaiting_approval", allowed: true },
  { from: "planning", to: "running", allowed: true },
  { from: "planning", to: "cancelled", allowed: true },
  { from: "awaiting_approval", to: "running", allowed: true },
  { from: "awaiting_approval", to: "cancelled", allowed: true },
  { from: "running", to: "paused", allowed: true },
  { from: "running", to: "retrying", allowed: true },
  { from: "running", to: "succeeded", allowed: true },
  { from: "running", to: "failed", allowed: true },
  { from: "running", to: "cancelled", allowed: true },
  { from: "paused", to: "running", allowed: true },
  { from: "paused", to: "cancelled", allowed: true },
  { from: "retrying", to: "running", allowed: true },
  { from: "retrying", to: "failed", allowed: true },
  { from: "retrying", to: "cancelled", allowed: true },
] as const;

export function isTaskTransitionAllowed(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS.some((t) => t.from === from && t.to === to && t.allowed);
}

/* ─────────────────────────────────────────────
 * Task priority (Section AD)
 * ─────────────────────────────────────────────*/

export type TaskPriority = "low" | "normal" | "high" | "critical";

export const TASK_PRIORITIES: readonly TaskPriority[] = [
  "low",
  "normal",
  "high",
  "critical",
] as const;

/* ─────────────────────────────────────────────
 * Task model (Sections AB, AD, AE)
 * ─────────────────────────────────────────────*/

export interface AgentTask {
  id: TaskId;
  tenantId: TenantId;
  agentId: AgentId;
  objective: string;
  state: TaskState;
  priority: TaskPriority;
  startDeadline: string | null;
  completionDeadline: string | null;
  maxExecutionSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  parentTaskId: TaskId | null;
  retryCount: number;
  maxRetries: number;
}

export interface CreateTaskInput {
  tenantId: TenantId;
  agentId: AgentId;
  objective: string;
  priority?: TaskPriority;
  startDeadline?: string | null;
  completionDeadline?: string | null;
  maxExecutionSeconds?: number | null;
  parentTaskId?: TaskId | null;
  maxRetries?: number;
  now: string;
}

export type CreateTaskResult = { ok: true; task: AgentTask } | { ok: false; error: string };

export function createAgentTask(input: CreateTaskInput): CreateTaskResult {
  if (input.objective.trim() === "") {
    return { ok: false, error: "Task objective is required" };
  }
  if (
    input.completionDeadline !== undefined &&
    input.completionDeadline !== null &&
    input.startDeadline !== undefined &&
    input.startDeadline !== null &&
    input.completionDeadline < input.startDeadline
  ) {
    return { ok: false, error: "Completion deadline must be after start deadline" };
  }
  if ((input.maxRetries ?? 0) < 0 || (input.maxRetries ?? 0) > 5) {
    return { ok: false, error: "Task max retries must be between 0 and 5" };
  }

  const id = taskId(`${input.tenantId}:${input.agentId}:${input.now}`);
  return {
    ok: true,
    task: {
      id,
      tenantId: input.tenantId,
      agentId: input.agentId,
      objective: input.objective,
      state: "scheduled",
      priority: input.priority ?? "normal",
      startDeadline: input.startDeadline ?? null,
      completionDeadline: input.completionDeadline ?? null,
      maxExecutionSeconds: input.maxExecutionSeconds ?? null,
      createdAt: input.now,
      updatedAt: input.now,
      startedAt: null,
      completedAt: null,
      cancelledBy: null,
      cancelReason: null,
      parentTaskId: input.parentTaskId ?? null,
      retryCount: 0,
      maxRetries: input.maxRetries ?? 0,
    },
  };
}

export type TaskTransitionResult = { ok: true; task: AgentTask } | { ok: false; error: string };

export function transitionTask(
  task: AgentTask,
  to: TaskState,
  now: string,
  cancelledBy?: string,
  cancelReason?: string | null,
): TaskTransitionResult {
  if (!isTaskTransitionAllowed(task.state, to)) {
    return { ok: false, error: `Task transition ${task.state} → ${to} is not allowed` };
  }

  const updated: AgentTask = {
    ...task,
    state: to,
    updatedAt: now,
    startedAt: task.startedAt ?? (to === "running" ? now : null),
    completedAt: to === "succeeded" || to === "failed" || to === "cancelled" ? now : null,
    cancelledBy: to === "cancelled" ? (cancelledBy ?? null) : null,
    cancelReason: to === "cancelled" ? (cancelReason ?? null) : null,
  };
  return { ok: true, task: updated };
}

/* ─────────────────────────────────────────────
 * Checkpoints (Sections AG, AH)
 * ─────────────────────────────────────────────*/

export interface TaskCheckpoint {
  id: TaskCheckpointId;
  taskId: TaskId;
  agentId: AgentId;
  stateSummary: string;
  stepIndex: number;
  toolCallsUsed: number;
  createdAt: string;
}

export function createTaskCheckpoint(
  task: AgentTask,
  stateSummary: string,
  stepIndex: number,
  toolCallsUsed: number,
  now: string,
): TaskCheckpoint {
  return {
    id: taskCheckpointId(`${task.id}:${now}`),
    taskId: task.id,
    agentId: task.agentId,
    stateSummary,
    stepIndex,
    toolCallsUsed,
    createdAt: now,
  };
}

export function canResumeFromCheckpoint(task: AgentTask, checkpoint: TaskCheckpoint): boolean {
  return task.id === checkpoint.taskId && task.state === "paused";
}

/* ─────────────────────────────────────────────
 * Cancellation (Section AF)
 * ─────────────────────────────────────────────*/

export function canCancelTask(
  task: AgentTask,
  actorId: string,
  isSupervisor: boolean,
): { ok: true } | { ok: false; error: string } {
  if (task.state === "succeeded" || task.state === "failed" || task.state === "cancelled") {
    return { ok: false, error: `Task in state ${task.state} cannot be cancelled` };
  }
  if (!isSupervisor && task.cancelledBy && task.cancelledBy !== actorId) {
    return { ok: false, error: "Only the canceling actor or a supervisor may cancel this task" };
  }
  return { ok: true };
}
