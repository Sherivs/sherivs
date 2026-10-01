/**
 * CoreGrid — Workflow Engine contracts (V5.3 Part 17, MISSION-V1-008).
 *
 * Pure, in-memory contracts for governed workflows:
 * TRIGGER -> CONDITIONS -> CONTEXT -> TASKS -> HUMAN/AI ASSIGNMENT ->
 * ACTION -> STATE CHANGE -> NOTIFICATION -> EVIDENCE -> COMPLETION.
 *
 * Triggers cover the eight Part 17 kinds: manual, event, scheduled, form,
 * payment, user action, AI, webhook. Steps support conditions with explicit
 * branching, tasks, approval steps (human approvers only — an AI actor can
 * never satisfy an approval step, Part 13 law), actions, and notifications.
 * A step can never authorize an action outside its declared
 * `authorizedActions`, mirroring MissionIntent.authorizedActions in
 * control-plane/foundation-mission.ts (the durable mission loop remains the
 * only durable-execution authority; this module is contracts only).
 *
 * Vocabulary is reused, not redefined: tenant identity comes from
 * tenant-core (`TenantId`), evidence semantics (producer, provenance,
 * integrity, usable-or-not) mirror the foundation mission EvidenceRecord,
 * and every non-allow path fails closed. This module performs no persistence
 * and no I/O: durable persistence of workflow runs requires an approved
 * migration and is out of scope here.
 */

import type { TenantId } from "../tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Triggers (Part 17: eight kinds)
 * ────────────────────────────────────────────────────────────*/

export const WORKFLOW_TRIGGER_KINDS = [
  "manual",
  "event",
  "scheduled",
  "form",
  "payment",
  "user_action",
  "ai",
  "webhook",
] as const;

export type WorkflowTriggerKind = (typeof WORKFLOW_TRIGGER_KINDS)[number];

export type WorkflowTrigger =
  | { kind: "manual"; actorRef: string }
  | { kind: "event"; eventType: string }
  | { kind: "scheduled"; schedule: string }
  | { kind: "form"; formRef: string }
  | { kind: "payment"; paymentEvent: string }
  | { kind: "user_action"; action: string }
  | { kind: "ai"; agentRef: string; proposalRef: string }
  | { kind: "webhook"; source: string };

/**
 * Trigger match (fail closed): the offered trigger must be the same kind as
 * the declared trigger AND carry identical identifying fields. An AI
 * trigger additionally requires a non-empty proposal reference — an AI
 * actor proposes, it never self-authorizes (Part 13).
 */
export function isTriggerMatch(declared: WorkflowTrigger, offered: WorkflowTrigger): boolean {
  if (declared.kind !== offered.kind) return false;
  switch (declared.kind) {
    case "manual":
      return offered.kind === "manual" && offered.actorRef === declared.actorRef;
    case "event":
      return offered.kind === "event" && offered.eventType === declared.eventType;
    case "scheduled":
      return offered.kind === "scheduled" && offered.schedule === declared.schedule;
    case "form":
      return offered.kind === "form" && offered.formRef === declared.formRef;
    case "payment":
      return offered.kind === "payment" && offered.paymentEvent === declared.paymentEvent;
    case "user_action":
      return offered.kind === "user_action" && offered.action === declared.action;
    case "ai":
      return (
        offered.kind === "ai" &&
        offered.agentRef === declared.agentRef &&
        offered.proposalRef.trim().length > 0
      );
    case "webhook":
      return offered.kind === "webhook" && offered.source === declared.source;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Steps
 * ────────────────────────────────────────────────────────────*/

export type WorkflowStepKind = "condition" | "task" | "approval" | "action" | "notification";

/**
 * Assignment (Part 17 HUMAN/AI ASSIGNMENT): every step declares who may
 * carry it out. Approval steps MUST be human-assigned (Part 13 law).
 */
export type StepAssignment =
  | { kind: "human"; roleRef: string }
  | { kind: "ai"; agentRef: string }
  | { kind: "unassigned" };

export type ConditionOperator = "equals" | "not_equals" | "exists" | "gte";

export interface StepCondition {
  field: string;
  operator: ConditionOperator;
  /** Required for every operator except "exists". */
  value?: unknown;
}

export interface StepBranches {
  /** null means the workflow proceeds to the completion gate. */
  onTrueStepId: string | null;
  /** null means the workflow proceeds to the completion gate. */
  onFalseStepId: string | null;
}

export interface WorkflowStep {
  stepId: string;
  kind: WorkflowStepKind;
  assignment: StepAssignment;
  /**
   * The complete, closed set of actions this step may ever plan. Nothing
   * outside this declaration can be authorized by the step (Part 17).
   */
  authorizedActions: readonly string[];
  condition?: StepCondition;
  branches?: StepBranches;
  /** Absent (or for condition steps, a null branch target) ends the run. */
  nextStepId?: string;
}

/* ─────────────────────────────────────────────────────────────
 * Definition, failure policy, approvals
 * ────────────────────────────────────────────────────────────*/

export type FailurePolicy =
  | { kind: "retry"; maxAttempts: number; backoffSeconds: number }
  | { kind: "halt" }
  | { kind: "escalate" };

export interface ApprovalRequirement {
  stepId: string;
  /** The human role that may approve; must match the step's human roleRef. */
  approverRoleRef: string;
}

export interface WorkflowDefinition {
  definitionId: string;
  tenantRef: TenantId;
  name: string;
  version: string;
  trigger: WorkflowTrigger;
  steps: readonly WorkflowStep[];
  onFailure: FailurePolicy;
  requiredApprovals: readonly ApprovalRequirement[];
}

export type DefinitionValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate a definition (fail closed, Constitution §26/§31): unknown step
 * references, unapproved approval steps, AI-assigned approval steps,
 * condition steps without an explicit condition and branches, and action
 * steps with an empty authorizedActions set are all invalid.
 */
export function validateWorkflowDefinition(def: WorkflowDefinition): DefinitionValidation {
  if (!def.definitionId.trim()) return { ok: false, error: "definitionId is required" };
  if (!def.tenantRef.trim()) return { ok: false, error: "tenantRef is required" };
  if (!def.name.trim()) return { ok: false, error: "name is required" };
  if (def.steps.length === 0) return { ok: false, error: "Workflow has no steps" };

  const ids = new Set(def.steps.map((s) => s.stepId));
  if (ids.size !== def.steps.length) {
    return { ok: false, error: "Duplicate stepId in workflow definition" };
  }

  const approvalsByStep = new Map(def.requiredApprovals.map((a) => [a.stepId, a]));
  for (const step of def.steps) {
    if (!step.stepId.trim()) return { ok: false, error: "stepId is required" };

    if (step.kind === "condition") {
      if (!step.condition) {
        return { ok: false, error: `Condition step ${step.stepId} has no condition` };
      }
      if (step.condition.operator !== "exists" && step.condition.value === undefined) {
        return {
          ok: false,
          error: `Condition step ${step.stepId} uses ${step.condition.operator} without a value`,
        };
      }
      if (!step.branches) {
        return { ok: false, error: `Condition step ${step.stepId} has no branches` };
      }
      for (const target of [step.branches.onTrueStepId, step.branches.onFalseStepId]) {
        if (target !== null && !ids.has(target)) {
          return { ok: false, error: `Step ${step.stepId} branches to unknown step ${target}` };
        }
      }
    } else if (step.nextStepId !== undefined && !ids.has(step.nextStepId)) {
      return { ok: false, error: `Step ${step.stepId} points to unknown step ${step.nextStepId}` };
    }

    if (step.kind === "approval") {
      const requirement = approvalsByStep.get(step.stepId);
      if (!requirement) {
        return {
          ok: false,
          error: `Approval step ${step.stepId} has no declared approval requirement`,
        };
      }
      if (step.assignment.kind !== "human") {
        return {
          ok: false,
          error: `Approval step ${step.stepId} must be human-assigned (Part 13 law)`,
        };
      }
      if (step.assignment.roleRef !== requirement.approverRoleRef) {
        return {
          ok: false,
          error: `Approval step ${step.stepId} approver role does not match its assignment`,
        };
      }
    } else if (approvalsByStep.has(step.stepId)) {
      return {
        ok: false,
        error: `Step ${step.stepId} declares an approval requirement but is not an approval step`,
      };
    }

    if (step.kind === "action" && step.authorizedActions.length === 0) {
      return {
        ok: false,
        error: `Action step ${step.stepId} must declare at least one authorized action`,
      };
    }
  }

  if (def.onFailure.kind === "retry") {
    if (!Number.isInteger(def.onFailure.maxAttempts) || def.onFailure.maxAttempts < 1) {
      return { ok: false, error: "retry.maxAttempts must be a positive integer" };
    }
    if (def.onFailure.backoffSeconds < 0) {
      return { ok: false, error: "retry.backoffSeconds must not be negative" };
    }
  }

  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Run state machine (transitions fail closed)
 * ────────────────────────────────────────────────────────────*/

export type WorkflowRunState =
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export const WORKFLOW_RUN_STATES: readonly WorkflowRunState[] = [
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

const RUN_TRANSITIONS: Readonly<Record<WorkflowRunState, readonly WorkflowRunState[]>> = {
  running: ["waiting_approval", "completed", "failed", "cancelled"],
  waiting_approval: ["running", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

/** Terminal states are immutable; every non-allow path fails closed. */
export function isRunTransitionAllowed(from: WorkflowRunState, to: WorkflowRunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * Evidence (Part 17: EVIDENCE before COMPLETION)
 * ────────────────────────────────────────────────────────────*/

export type EvidenceKind =
  | "condition_evaluated"
  | "task_completed"
  | "approval_recorded"
  | "action_planned"
  | "notification_delivered";

export interface EvidenceExpectation {
  stepId: string;
  evidenceKind: EvidenceKind;
  reason: string;
}

/**
 * Evidence vocabulary mirrors the foundation mission EvidenceRecord
 * (producer, actor, tenant, provenance, integrity, usable-or-not) scoped to
 * a workflow step.
 */
export interface WorkflowEvidenceRecord {
  evidenceId: string;
  runId: string;
  stepId: string;
  evidenceKind: EvidenceKind;
  producer: string;
  actorId: string;
  tenantRef: TenantId;
  recordedAt: string;
  provenance: string;
  integrity: string;
}

export function workflowEvidenceIsUsable(record: WorkflowEvidenceRecord): boolean {
  return (
    record.evidenceId.trim().length > 0 &&
    record.producer.trim().length > 0 &&
    record.actorId.trim().length > 0 &&
    record.tenantRef.trim().length > 0 &&
    record.recordedAt.trim().length > 0 &&
    record.provenance.trim().length > 0 &&
    record.integrity.trim().length > 0
  );
}

/* ─────────────────────────────────────────────────────────────
 * Run, history, attempts
 * ────────────────────────────────────────────────────────────*/

export interface RunHistoryEntry {
  at: string;
  stepId: string | null;
  fromState: WorkflowRunState;
  /** null means the state did not change. */
  toState: WorkflowRunState | null;
  kind: string;
  reason: string;
}

export interface StepAttempt {
  stepId: string;
  /** Attempt number of the NEXT execution (1 = first execution). */
  attempt: number;
  lastFailureReason: string;
  backoffSeconds: number;
}

export interface WorkflowRun {
  runId: string;
  definitionId: string;
  tenantRef: TenantId;
  state: WorkflowRunState;
  currentStepId: string | null;
  history: readonly RunHistoryEntry[];
  pendingEvidence: readonly EvidenceExpectation[];
  evidence: readonly WorkflowEvidenceRecord[];
  attempts: readonly StepAttempt[];
  startedAt: string;
  completedAt: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Actors, approvals, authorized actions
 * ────────────────────────────────────────────────────────────*/

/**
 * Actor scope (vocabulary reused from the foundation mission ActorScope:
 * actor, tenant, revoked) extended with the Part 17 HUMAN/AI distinction.
 */
export interface WorkflowActorScope {
  actorId: string;
  tenantRef: TenantId;
  kind: "human" | "ai" | "system";
  /** Required for human actors. */
  roleRef: string | null;
  /** Required for AI actors. */
  agentRef: string | null;
  revoked: boolean;
}

export type ApproverRef =
  | { kind: "human"; humanRef: string; roleRef: string }
  | { kind: "ai"; agentRef: string };

export interface ApprovalRecord {
  recordId: string;
  stepId: string;
  decision: "approved" | "rejected";
  approver: ApproverRef;
  decidedAt: string;
}

/**
 * An AuthorizedActionPlan is the ONLY thing an action step produces. It is
 * bounded by the step's authorizedActions and is never executed by the
 * workflow engine itself — execution belongs to authorized runtime layers
 * behind their own authorization boundary (Constitution §21).
 */
export interface AuthorizedActionPlan {
  planId: string;
  runId: string;
  stepId: string;
  tenantRef: TenantId;
  authorizedActions: readonly string[];
  proposedBy: string;
  createdAt: string;
  note: "execution_is_external_to_the_workflow_engine";
}

/**
 * Authorization containment: a step can never authorize an action outside
 * its declared authorizedActions (fail closed on anything unlisted).
 */
export function isActionAuthorized(step: WorkflowStep, action: string): boolean {
  return step.authorizedActions.includes(action);
}

/* ─────────────────────────────────────────────────────────────
 * Run events and advance context
 * ────────────────────────────────────────────────────────────*/

export type WorkflowRunEvent =
  | {
      kind: "step_input";
      payload: Record<string, unknown>;
      /** Required when the current step is an action step. */
      requestedAction?: string;
      at: string;
    }
  | { kind: "approval"; record: ApprovalRecord; at: string }
  | { kind: "failure"; reason: string; at: string }
  | { kind: "cancel"; reason: string; at: string }
  | { kind: "complete"; at: string };

export interface AdvanceContext {
  actor: WorkflowActorScope;
  now: string;
}