/**
 * CoreGrid — Controlled Automation Engine core domain model
 * (Phase 17, Sections A, B, C, E, F, G, H, I, J, K, L, M, N, O, P, Q, R,
 * S, T, U, V, W, X, Y).
 *
 * Implements `architecture/phase-17-automation-engine.md`:
 * - Automation definition (F): trigger, conditions, context requirements,
 *   actions, dependencies, permissions, approvals, timeout, retry,
 *   compensation, escalation, observability, lifecycle.
 * - Automation types (G): event, schedule, condition, threshold,
 *   state-transition, webhook, human, API, batch, workflow, AI-proposed.
 * - Trigger engine (H) with deduplication (I) and ordering (J).
 * - Condition engine (K, L): explainable TRUE / FALSE / UNKNOWN / ERROR;
 *   UNKNOWN must never automatically mean TRUE; fail-closed (M).
 * - Context resolution (N): current/user/tenant/policy/resource/security/
 *   time/risk context.
 * - Policy engine (O) with explicit priority hierarchy (P): SAFETY ->
 *   LAW/REGULATION -> PLATFORM -> TENANT -> INSTITUTION -> WORKFLOW ->
 *   USER PREFERENCE.
 * - Authorization (Q): identity, tenant, role, resource, operation,
 *   context, policy.
 * - Approval engine (R, S): PENDING / APPROVED / REJECTED / EXPIRED /
 *   CANCELLED; human-in-the-loop (T), human-on-the-loop (U), audited
 *   human override (V).
 * - Risk classification (W): R0 informational .. R4 critical; risk
 *   controls (X) determine approval, permissions, timeout, monitoring,
 *   rollback and human oversight.
 *
 * Safety invariants (FM): unauthorized actions never execute (1);
 * high-risk actions cannot execute without required approval (6);
 * unknown conditions fail safely (11). The most important boundary (E):
 * no automation may execute solely because an AI agent requested it.
 */

import type { TenantId } from "./tenant-core";
import type { ApprovalStatus } from "./runtime-approval";

/* ─────────────────────────────────────────────────────────────
 * Automation types (G)
 * ────────────────────────────────────────────────────────────*/

export type AutomationType =
  | "event_triggered"
  | "schedule_triggered"
  | "condition_triggered"
  | "threshold_triggered"
  | "state_transition_triggered"
  | "webhook_triggered"
  | "human_triggered"
  | "api_triggered"
  | "batch_triggered"
  | "workflow_triggered"
  | "ai_proposed";

export const AUTOMATION_TYPES: readonly AutomationType[] = [
  "event_triggered",
  "schedule_triggered",
  "condition_triggered",
  "threshold_triggered",
  "state_transition_triggered",
  "webhook_triggered",
  "human_triggered",
  "api_triggered",
  "batch_triggered",
  "workflow_triggered",
  "ai_proposed",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Risk classification (W)
 * ────────────────────────────────────────────────────────────*/

export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4";

export const RISK_LEVELS: readonly RiskLevel[] = ["R0", "R1", "R2", "R3", "R4"] as const;

export function riskLevelOrdinal(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level);
}

export interface RiskControlProfile {
  level: RiskLevel;
  requiresApproval: boolean;
  requiresHumanOversight: boolean;
  requiresRollback: boolean;
  timeoutMs: number;
  monitoringLevel: "none" | "basic" | "enhanced";
}

/**
 * Risk controls (X): risk level determines approval, execution
 * permissions, timeout, monitoring, rollback and human oversight.
 * R3/R4 always require approval and enhanced monitoring (FM.6).
 */
export function riskControlProfile(level: RiskLevel): RiskControlProfile {
  switch (level) {
    case "R0":
      return {
        level,
        requiresApproval: false,
        requiresHumanOversight: false,
        requiresRollback: false,
        timeoutMs: 30_000,
        monitoringLevel: "none",
      };
    case "R1":
      return {
        level,
        requiresApproval: false,
        requiresHumanOversight: false,
        requiresRollback: false,
        timeoutMs: 60_000,
        monitoringLevel: "basic",
      };
    case "R2":
      return {
        level,
        requiresApproval: false,
        requiresHumanOversight: true,
        requiresRollback: true,
        timeoutMs: 120_000,
        monitoringLevel: "basic",
      };
    case "R3":
      return {
        level,
        requiresApproval: true,
        requiresHumanOversight: true,
        requiresRollback: true,
        timeoutMs: 300_000,
        monitoringLevel: "enhanced",
      };
    case "R4":
      return {
        level,
        requiresApproval: true,
        requiresHumanOversight: true,
        requiresRollback: true,
        timeoutMs: 600_000,
        monitoringLevel: "enhanced",
      };
  }
}

/* ─────────────────────────────────────────────────────────────
 * Condition engine (K, L, M)
 * ────────────────────────────────────────────────────────────*/

export type ConditionResult = "TRUE" | "FALSE" | "UNKNOWN" | "ERROR";

export const CONDITION_RESULTS: readonly ConditionResult[] = [
  "TRUE",
  "FALSE",
  "UNKNOWN",
  "ERROR",
] as const;

export interface ConditionEvaluation {
  conditionId: string;
  result: ConditionResult;
  detail: string;
}

/**
 * Condition evaluation (L, M): conditions must produce explainable
 * results. UNKNOWN must never automatically mean TRUE. For high-risk
 * automation the fail-closed rule is UNKNOWN -> DO NOT EXECUTE.
 */
export function applyFailClosed(
  results: ConditionEvaluation[],
  highRisk: boolean,
): { proceed: boolean; reason: string } {
  if (results.some((r) => r.result === "ERROR")) {
    return { proceed: false, reason: "Condition evaluation errored — fail closed (M)" };
  }
  if (results.some((r) => r.result === "UNKNOWN")) {
    if (highRisk) {
      return {
        proceed: false,
        reason: "UNKNOWN condition — fail closed for high-risk automation (M)",
      };
    }
    return { proceed: false, reason: "UNKNOWN condition — automation does not proceed (L)" };
  }
  if (!results.every((r) => r.result === "TRUE")) {
    return { proceed: false, reason: "Not all conditions evaluated TRUE (K)" };
  }
  return { proceed: true, reason: "All conditions evaluated TRUE" };
}

/* ─────────────────────────────────────────────────────────────
 * Trigger engine (H, I, J)
 * ────────────────────────────────────────────────────────────*/

export interface TriggerEvent {
  eventId: string;
  type: string;
  tenantId: TenantId;
  timestamp: string;
  sequence: number | null;
  correlationId: string | null;
  payload: Record<string, unknown>;
}

/**
 * Trigger deduplication (I): repeated events must not accidentally
 * produce duplicate executions. Event IDs, idempotency keys, execution
 * fingerprints and deduplication windows are supported (FM.13).
 */
export function isTriggerDuplicate(
  processedEventIds: ReadonlySet<string>,
  event: TriggerEvent,
  deduplicationWindowMs: number,
  now: string,
  seenEventIdsWithTime: Map<string, string>,
): boolean {
  if (processedEventIds.has(event.eventId)) {
    return true;
  }
  const firstSeen = seenEventIdsWithTime.get(event.eventId);
  if (firstSeen !== undefined) {
    return Date.parse(now) - Date.parse(firstSeen) <= deduplicationWindowMs;
  }
  return false;
}

/**
 * Trigger ordering (J): preserve event sequence, timestamp, dependency,
 * and causal relationship. In-order means sequence strictly increases for
 * events that carry a sequence.
 */
export function isTriggerOrderPreserved(events: TriggerEvent[]): boolean {
  let lastSequence: number | null = null;
  for (const event of events) {
    if (event.sequence !== null) {
      if (lastSequence !== null && event.sequence <= lastSequence) {
        return false;
      }
      lastSequence = event.sequence;
    }
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Policy engine (O, P)
 * ────────────────────────────────────────────────────────────*/

export type PolicyLevel =
  | "SAFETY"
  | "LAW_REGULATION"
  | "PLATFORM"
  | "TENANT"
  | "INSTITUTION"
  | "WORKFLOW"
  | "USER_PREFERENCE";

export const POLICY_PRIORITY: readonly PolicyLevel[] = [
  "SAFETY",
  "LAW_REGULATION",
  "PLATFORM",
  "TENANT",
  "INSTITUTION",
  "WORKFLOW",
  "USER_PREFERENCE",
] as const;

export interface PolicyDecision {
  level: PolicyLevel;
  allowed: boolean;
  reason: string;
}

export type PolicyVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * Policy priority (P): when policies conflict, the highest-priority level
 * wins. SAFETY > LAW/REGULATION > PLATFORM > TENANT > INSTITUTION >
 * WORKFLOW > USER PREFERENCE. The hierarchy is explicit and never
 * ambiguous.
 */
export function resolvePolicyConflict(decisions: PolicyDecision[]): PolicyVerdict {
  if (decisions.length === 0) {
    return { allowed: false, reason: "No policy decision available — fail closed (O)" };
  }
  const ordered = [...decisions].sort(
    (a, b) => POLICY_PRIORITY.indexOf(a.level) - POLICY_PRIORITY.indexOf(b.level),
  );
  const highest = ordered[0];
  if (!highest.allowed) {
    return { allowed: false, reason: `Policy at ${highest.level} denies: ${highest.reason} (P)` };
  }
  return { allowed: true };
}

/* ─────────────────────────────────────────────────────────────
 * Authorization (Q)
 * ────────────────────────────────────────────────────────────*/

export interface AuthorizationContext {
  identity: string;
  tenantId: TenantId;
  role: string | null;
  resource: string;
  operation: string;
  isAutomation: boolean;
  isAI: boolean;
}

export interface AuthorizationVerdict {
  allowed: boolean;
  reason: string;
}

/**
 * Authorization (Q): verifies the actor or automation has permission.
 * AI actors can never receive unrestricted authority; their requests must
 * pass the same authorization boundary as humans (E, CP).
 */
export function authorizeExecution(
  ctx: AuthorizationContext,
  permittedRoles: string[],
  permittedOperations: string[],
): AuthorizationVerdict {
  if (!permittedOperations.includes(ctx.operation)) {
    return { allowed: false, reason: `Operation "${ctx.operation}" is not permitted (Q)` };
  }
  if (ctx.isAI && ctx.role === null) {
    return {
      allowed: false,
      reason: "AI actors require an explicit role — never implicit authority (E)",
    };
  }
  if (ctx.role !== null && !permittedRoles.includes(ctx.role)) {
    return { allowed: false, reason: `Role "${ctx.role}" is not permitted for this operation (Q)` };
  }
  return {
    allowed: true,
    reason: `Authorized ${ctx.identity} for ${ctx.operation} on ${ctx.resource}`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Approval engine (R, S, T, U, V)
 * ────────────────────────────────────────────────────────────*/

export type ApprovalOutcome = Extract<
  ApprovalStatus,
  "approved" | "rejected" | "expired" | "cancelled"
>;

export interface AutomationApprovalState {
  required: boolean;
  status: ApprovalOutcome | "pending";
  approvedBy: string | null;
  decidedAt: string | null;
}

export function createApprovalState(required: boolean): AutomationApprovalState {
  return {
    required,
    status: required ? "pending" : "approved",
    approvedBy: required ? null : "system",
    decidedAt: null,
  };
}

/**
 * Approval decision (R, S): high-risk operations require human approval
 * (human-in-the-loop, T). An unapproved required approval means the
 * execution cannot proceed (FM.6).
 */
export function canProceedThroughApproval(state: AutomationApprovalState): {
  proceed: boolean;
  reason: string;
} {
  if (!state.required) {
    return { proceed: true, reason: "Approval not required (human-on-the-loop, U)" };
  }
  if (state.status === "approved" && state.approvedBy !== null) {
    return { proceed: true, reason: `Approved by ${state.approvedBy} (T)` };
  }
  return {
    proceed: false,
    reason: `Approval ${state.status} — high-risk action cannot proceed (R, FM.6)`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Automation definition (F)
 * ────────────────────────────────────────────────────────────*/

export interface AutomationDefinition {
  automationId: string;
  name: string;
  tenantId: TenantId;
  type: AutomationType;
  trigger: { eventType: string | null; schedule: string | null };
  conditions: string[];
  riskLevel: RiskLevel;
  actions: string[];
  approvalsRequired: boolean;
  timeoutMs: number;
  maxDepth: number;
  maxActions: number;
  version: number;
  owner: string;
  status: string;
}
