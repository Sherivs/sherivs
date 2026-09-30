/**
 * CoreGrid — Controlled Automation Engine governance domain model
 * (Phase 17, Sections AU, AV, AW, AX, AY, AZ, BA, BB, BC, BD, BE, BF, BG,
 * BH, BI, BJ, CS, CT, CU, CV, CW, CX, CZ, DA, DB, DC, DD, CJ, CK, CL, CM,
 * CN, CO, CP, CQ, CR, DR, DU, DV, DW, FB, FC, FD, FF, FG).
 *
 * Implements `architecture/phase-17-automation-engine.md`:
 * - Scheduling (AU-AX): one-time/recurring/calendar/timezone-aware
 *   schedules with explicit timezone (never assume server timezone) and
 *   DST handling; blackout periods.
 * - Events and queues (AY-BD): event filtering, replay, dead-letter
 *   queue, queue priority/visibility timeout/backpressure — never silently
 *   lose critical actions.
 * - Circuit breaker (BE), bulkhead isolation (BF), execution priority
 *   (BG), quotas (BH), cost controls (BI) and financial guardrails (BJ):
 *   maximum amount, daily limit, approval requirement, emergency stop.
 * - Registry (CS) and lifecycle (CT): DRAFT -> VALIDATING -> APPROVED ->
 *   SHADOW -> CANARY -> ACTIVE -> PAUSED -> DEPRECATED -> RETIRED.
 * - Ownership (CU), change management (CV), dependency management (CW,
 *   CX).
 * - Secrets (CZ) and credential rotation (DA): never embedded in
 *   definitions.
 * - Tenant isolation (DB): every execution carries tenant ID,
 *   authorization context and resource scope; cross-tenant execution is
 *   prohibited unless explicitly authorized (FM.2). Multi-tenant quotas
 *   (DC) and fair scheduling (DD).
 * - Audit (CJ), execution evidence (CK) and explainability (CL-CN):
 *   answer "why did this execute / why not".
 * - AI-proposed automation (CO-CR): proposals carry confidence, rationale,
 *   evidence, expected impact and uncertainty; AI cannot directly call
 *   unrestricted execution APIs (CP); generated code passes static
 *   analysis, security analysis, testing, policy validation and sandbox
 *   execution (CR).
 * - Agent interfaces (FB), minimum permissions (FC), short-lived scoped
 *   execution tokens (FD), misbehavior protection (FF) and loop
 *   protection (FG).
 * - Correlation IDs (DR), failure classification (DU) and recovery
 *   strategy (DV); unknown failures never silently become success (DW).
 *
 * Reuse: circuit breaker / rate limiter / bulkhead primitives ship in
 * Phase 05 runtime-resilience.ts and are consumed by reference — never
 * duplicated (AGENTS.md 65).
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Automation registry and lifecycle (CS, CT)
 * ────────────────────────────────────────────────────────────*/

export type AutomationLifecycleState =
  | "DRAFT"
  | "VALIDATING"
  | "APPROVED"
  | "SHADOW"
  | "CANARY"
  | "ACTIVE"
  | "PAUSED"
  | "DEPRECATED"
  | "RETIRED";

export const AUTOMATION_LIFECYCLE_STATES: readonly AutomationLifecycleState[] = [
  "DRAFT",
  "VALIDATING",
  "APPROVED",
  "SHADOW",
  "CANARY",
  "ACTIVE",
  "PAUSED",
  "DEPRECATED",
  "RETIRED",
] as const;

const LIFECYCLE_TRANSITIONS: Readonly<
  Record<AutomationLifecycleState, readonly AutomationLifecycleState[]>
> = {
  DRAFT: ["VALIDATING", "RETIRED"],
  VALIDATING: ["APPROVED", "DRAFT", "RETIRED"],
  APPROVED: ["SHADOW", "CANARY", "ACTIVE", "PAUSED", "RETIRED"],
  SHADOW: ["CANARY", "ACTIVE", "PAUSED", "RETIRED"],
  CANARY: ["ACTIVE", "PAUSED", "DEPRECATED", "RETIRED"],
  ACTIVE: ["PAUSED", "DEPRECATED", "RETIRED"],
  PAUSED: ["ACTIVE", "DEPRECATED", "RETIRED"],
  DEPRECATED: ["RETIRED"],
  RETIRED: [],
};

export function isLifecycleTransitionAllowed(
  from: AutomationLifecycleState,
  to: AutomationLifecycleState,
): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to);
}

export interface AutomationRegistryEntry {
  automationId: string;
  name: string;
  owner: string;
  version: number;
  status: AutomationLifecycleState;
  riskLevel: string;
  scope: string[];
  triggers: string[];
  actions: string[];
  policyRef: string;
  createdAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Ownership (CU)
 * ────────────────────────────────────────────────────────────*/

export interface AutomationOwnership {
  technicalOwner: string;
  businessOwner: string;
  tenantOwner: TenantId;
  riskOwner: string | null;
}

export function isOwnershipComplete(ownership: AutomationOwnership): boolean {
  return (
    ownership.technicalOwner.trim() !== "" &&
    ownership.businessOwner.trim() !== "" &&
    ownership.riskOwner !== null
  );
}

/* ─────────────────────────────────────────────────────────────
 * Scheduling (AU, AV, AW, AX)
 * ────────────────────────────────────────────────────────────*/

export interface AutomationSchedule {
  scheduleId: string;
  automationId: string;
  tenantId: TenantId;
  cron: string | null;
  timezone: string;
  blackoutWindows: Array<{ start: string; end: string }>;
  enabled: boolean;
}

/**
 * Schedule timezone (AV): schedules must store explicit timezone
 * information; server timezone is never assumed.
 */
export function validateSchedule(
  schedule: Omit<AutomationSchedule, "scheduleId" | "automationId" | "tenantId">,
): { ok: true } | { ok: false; error: string } {
  if (schedule.cron === null && schedule.blackoutWindows.length === 0) {
    return { ok: false, error: "Schedule requires a cron expression or blackout policy (AU)" };
  }
  if (schedule.timezone.trim() === "") {
    return { ok: false, error: "Schedule must declare an explicit timezone (AV)" };
  }
  return { ok: true };
}

export function isWithinBlackoutWindow(
  windows: Array<{ start: string; end: string }>,
  at: string,
): boolean {
  return windows.some((w) => at >= w.start && at <= w.end);
}

/* ─────────────────────────────────────────────────────────────
 * Quotas, cost controls and financial guardrails (BH, BI, BJ, DC)
 * ────────────────────────────────────────────────────────────*/

export interface AutomationQuotas {
  maxActionsPerMinute: number;
  maxWorkflowsPerTenant: number;
  maxConcurrentExecutions: number;
  maxExternalApiCalls: number;
}

export interface QuotaSnapshot {
  actionsThisMinute: number;
  activeWorkflows: number;
  concurrentExecutions: number;
  externalApiCalls: number;
}

export function isWithinQuota(
  quotas: AutomationQuotas,
  current: QuotaSnapshot,
): { ok: boolean; reason: string } {
  if (current.actionsThisMinute >= quotas.maxActionsPerMinute) {
    return { ok: false, reason: "Actions-per-minute quota exceeded (BH)" };
  }
  if (current.activeWorkflows >= quotas.maxWorkflowsPerTenant) {
    return { ok: false, reason: "Workflow-per-tenant quota exceeded (BH/DC)" };
  }
  if (current.concurrentExecutions >= quotas.maxConcurrentExecutions) {
    return { ok: false, reason: "Concurrency limit reached (BH)" };
  }
  if (current.externalApiCalls >= quotas.maxExternalApiCalls) {
    return { ok: false, reason: "External API call quota exceeded (BH)" };
  }
  return { ok: true, reason: "Within quotas (BH)" };
}

export interface FinancialGuardrail {
  maxAmountMinor: number;
  dailyLimitMinor: number;
  requiresApproval: boolean;
  accountRestricted: boolean;
  maxTransactionsPerDay: number;
}

/**
 * Financial guardrails (BJ): maximum amount, daily limit, approval
 * requirement, account restriction, transaction frequency and emergency
 * stop. Financial execution must integrate with Phase 13 rather than
 * bypass it — this domain contract enforces the guardrail boundary.
 */
export function evaluateFinancialAction(input: {
  amountMinor: number;
  todayTotalMinor: number;
  transactionsToday: number;
  approvalGranted: boolean;
  guardrail: FinancialGuardrail;
}): { allowed: boolean; reason: string } {
  if (input.amountMinor > input.guardrail.maxAmountMinor) {
    return { allowed: false, reason: "Amount exceeds per-transaction maximum (BJ)" };
  }
  if (input.todayTotalMinor + input.amountMinor > input.guardrail.dailyLimitMinor) {
    return { allowed: false, reason: "Amount would exceed daily limit (BJ)" };
  }
  if (input.transactionsToday + 1 > input.guardrail.maxTransactionsPerDay) {
    return { allowed: false, reason: "Transaction frequency limit exceeded (BJ)" };
  }
  if (input.guardrail.requiresApproval && !input.approvalGranted) {
    return { allowed: false, reason: "Financial action requires approval (BJ)" };
  }
  if (input.guardrail.accountRestricted) {
    return { allowed: false, reason: "Account is restricted (BJ)" };
  }
  return { allowed: true, reason: "Financial guardrails satisfied (BJ)" };
}

/* ─────────────────────────────────────────────────────────────
 * Tenant isolation (DB, FM.2)
 * ────────────────────────────────────────────────────────────*/

export interface ExecutionTenantContext {
  tenantId: TenantId;
  resourceScope: string[];
  authorizationContext: string;
  crossTenantAuthorized: boolean;
}

/**
 * Tenant isolation (DB): every execution carries tenant ID, authorization
 * context and resource scope. Cross-tenant execution is prohibited unless
 * explicitly authorized (FM.2).
 */
export function isCrossTenantExecutionAllowed(
  executionTenantId: TenantId,
  targetTenantId: TenantId,
  crossTenantAuthorized: boolean,
): { ok: boolean; reason: string } {
  if (executionTenantId === targetTenantId) {
    return { ok: true, reason: "Same-tenant execution (DB)" };
  }
  if (crossTenantAuthorized) {
    return { ok: true, reason: "Cross-tenant execution explicitly authorized (DB, FM.2)" };
  }
  return {
    ok: false,
    reason: "Cross-tenant execution prohibited without explicit authorization (DB, FM.2)",
  };
}

/* ─────────────────────────────────────────────────────────────
 * Audit, evidence and explainability (CJ, CK, CL, CM, CN)
 * ────────────────────────────────────────────────────────────*/

export type AuditEventKind =
  | "automation_created"
  | "automation_modified"
  | "automation_enabled"
  | "automation_disabled"
  | "automation_executed"
  | "automation_approved"
  | "automation_rejected"
  | "automation_retried"
  | "automation_failed"
  | "automation_rolled_back"
  | "automation_compensated"
  | "automation_overridden"
  | "kill_switch_activated";

export const AUDIT_EVENT_KINDS: readonly AuditEventKind[] = [
  "automation_created",
  "automation_modified",
  "automation_enabled",
  "automation_disabled",
  "automation_executed",
  "automation_approved",
  "automation_rejected",
  "automation_retried",
  "automation_failed",
  "automation_rolled_back",
  "automation_compensated",
  "automation_overridden",
  "kill_switch_activated",
] as const;

export interface AutomationAuditEvent {
  auditId: string;
  kind: AuditEventKind;
  automationId: string;
  tenantId: TenantId;
  actor: string;
  at: string;
  correlationId: string | null;
  detail: string;
}

export interface DecisionRecord {
  conditions: string[];
  policyResults: string[];
  authorizationResult: string;
  riskClassification: string;
  approvals: string[];
  selectedActions: string[];
  decision: "executed" | "not_executed";
  reason: string;
}

/**
 * Explainability (CL, CM): automation must answer "why did this execute"
 * and "why did it not execute". Every decision record carries the full
 * evidence chain.
 */
export function buildDecisionRecord(input: {
  conditions: string[];
  policyResults: string[];
  authorizationResult: string;
  riskClassification: string;
  approvals: string[];
  selectedActions: string[];
  executed: boolean;
  reason: string;
}): DecisionRecord {
  return {
    conditions: input.conditions,
    policyResults: input.policyResults,
    authorizationResult: input.authorizationResult,
    riskClassification: input.riskClassification,
    approvals: input.approvals,
    selectedActions: input.selectedActions,
    decision: input.executed ? "executed" : "not_executed",
    reason: input.reason,
  };
}

/* ─────────────────────────────────────────────────────────────
 * AI and agent governance (CO, CP, CQ, CR, FB, FC, FD, FF)
 * ────────────────────────────────────────────────────────────*/

export interface AIAutomationProposal {
  proposalId: string;
  automationId: string | null;
  confidence: number;
  rationale: string;
  evidence: string[];
  expectedImpact: string;
  uncertainty: string;
}

/**
 * AI proposals (CO, CQ): AI may propose automation, but proposals must
 * pass validation and governance before they can execute. AI cannot
 * directly call unrestricted execution APIs (CP) — the proposal only
 * enters the automation API boundary.
 */
export function isAIAutomationProposalComplete(proposal: AIAutomationProposal): {
  ok: boolean;
  reason: string;
} {
  if (proposal.confidence < 0 || proposal.confidence > 1 || Number.isNaN(proposal.confidence)) {
    return { ok: false, reason: "AI proposal requires a valid confidence in [0, 1] (CQ)" };
  }
  if (proposal.rationale.trim() === "") {
    return { ok: false, reason: "AI proposal requires a rationale (CQ)" };
  }
  if (proposal.uncertainty.trim() === "") {
    return { ok: false, reason: "AI proposal must declare its uncertainty (CQ)" };
  }
  return { ok: true, reason: "AI proposal carries required metadata (CQ)" };
}

export type AgentPermission =
  "READ_TWIN" | "REQUEST_AUTOMATION" | "REQUEST_DRY_RUN" | "REQUEST_APPROVAL";

export const AGENT_PERMISSIONS: readonly AgentPermission[] = [
  "READ_TWIN",
  "REQUEST_AUTOMATION",
  "REQUEST_DRY_RUN",
  "REQUEST_APPROVAL",
] as const;

/**
 * Agent permissions (FC): agents receive minimum necessary permissions —
 * never EXECUTE_ANYTHING.
 */
export function authorizeAgentRequest(
  permissions: readonly AgentPermission[],
  requested: AgentPermission,
): { ok: boolean; reason: string } {
  if (permissions.includes(requested)) {
    return { ok: true, reason: `Agent authorized for ${requested} (FC)` };
  }
  return { ok: false, reason: `Agent lacks permission for ${requested} — minimum privilege (FC)` };
}

export interface ScopedExecutionToken {
  tokenId: string;
  agentId: string;
  scope: string;
  issuedAt: string;
  expiresAt: string;
  used: boolean;
}

/** Agent action tokens (FD): high-risk agent requests require short-lived
 * scoped execution tokens. */
export function isScopedExecutionTokenValid(token: ScopedExecutionToken, now: string): boolean {
  return !token.used && now <= token.expiresAt;
}

/* ─────────────────────────────────────────────────────────────
 * Failure classification and recovery (DU, DV, DW)
 * ────────────────────────────────────────────────────────────*/

import type { FailureClass } from "./automation-workflow";

const RECOVERY_BY_CLASS: Readonly<Record<FailureClass, string>> = {
  VALIDATION: "Correct definition and redeploy (DV)",
  AUTHORIZATION: "Review authorization policy (DV)",
  POLICY: "Review policy decision record (DV)",
  DEPENDENCY: "Restore dependency and retry (DV)",
  NETWORK: "Retry with backoff (DV)",
  TIMEOUT: "Investigate latency; retry if reversible (DV)",
  CONFLICT: "Reconcile conflicting execution (DV)",
  RESOURCE: "Release resources and retry (DV)",
  EXTERNAL: "Check external provider status (DV)",
  SYSTEM: "Check system health and recover (DV)",
  UNKNOWN: "Human investigation required — never silent success (DV, DW)",
};

export function recoveryStrategyFor(failureClass: FailureClass): string {
  return RECOVERY_BY_CLASS[failureClass];
}

export function isUnknownFailure(failureClass: FailureClass): boolean {
  return failureClass === "UNKNOWN";
}
