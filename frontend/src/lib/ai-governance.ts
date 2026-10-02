/**
 * CoreGrid AI Intelligence Layer — AI governance domain.
 *
 * Implements `architecture/phase-26-ai-intelligence-layer.md`:
 * - High-risk AI classification (93): low/medium/high/critical. High-risk action
 *   gate (94): high-risk outputs require stronger validation or human approval.
 * - Human-in-the-loop (95): approval, rejection, modification, escalation, override.
 * - AI escalation (96): low confidence, evidence conflicts, high risk, ambiguous
 *   authorization, unclear policy. AI decision record (97): request, context id,
 *   model, result, confidence, evidence refs, policy decision, approval state.
 * - AI audit (98), observability (99), telemetry (100), privacy-preserving
 *   logging (101).
 * - AI cost management (102), budgets (103), quotas (104), priority queues (105).
 * - Caching (106) + semantic caching (107): sensitive results require isolation.
 * - AI resilience (108): retry, timeout, fallback, circuit breaker, queueing,
 *   graceful degradation.
 * - AI policy engine (141) + precedence (142): Platform → Jurisdiction → Tenant →
 *   Application → User; the more restrictive policy wins.
 * - AI consent (143), transparency (144), disclosure (145).
 * - AI feedback (146) + feedback loop (147).
 * - No unsupervised self-modification (148), safe learning (149).
 * - AI evaluation platform (120), golden datasets (121), African evaluation (122).
 * - AI release pipeline (131): Research → Evaluation → Safety Review → Pilot →
 *   Canary → Production → Monitoring. Model promotion (132), rollback (133),
 *   canary (134).
 * - AI kill switch (181), capability isolation (182), health checks (183).
 */

import type { TenantId } from "./tenant-core";
import type { AiRequestId, AiModelId, AiRiskLevel } from "./ai-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type AiDecisionId = string & { readonly __brand: "AiDecisionId" };
export type AiEvaluationId = string & { readonly __brand: "AiEvaluationId" };
export type AiIncidentId = string & { readonly __brand: "AiIncidentId" };
export type AiBudgetId = string & { readonly __brand: "AiBudgetId" };

export function aiDecisionId(raw: string): AiDecisionId {
  return raw as AiDecisionId;
}
export function aiEvaluationId(raw: string): AiEvaluationId {
  return raw as AiEvaluationId;
}
export function aiIncidentId(raw: string): AiIncidentId {
  return raw as AiIncidentId;
}
export function aiBudgetId(raw: string): AiBudgetId {
  return raw as AiBudgetId;
}

/* ─────────────────────────────────────────────────────────────
 * High-risk classification (93) + action gate (94)
 * ────────────────────────────────────────────────────────────*/

/** Classify a task's risk from its impact and autonomy dimensions (Section 93). */
export function classifyAiRisk(input: {
  impact: "informational" | "operational" | "financial" | "safety" | "privacy";
  autonomy: "advisory" | "assisted" | "autonomous" | "irreversible";
  dataClassification: "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";
}): AiRiskLevel {
  if (input.autonomy === "irreversible") return "critical";
  if (input.dataClassification === "RESTRICTED") return "high";
  if (input.impact === "safety") return "high";
  if (input.impact === "financial" && input.autonomy === "autonomous") return "high";
  if (input.autonomy === "autonomous") return "medium";
  if (input.dataClassification === "SENSITIVE") return "medium";
  return "low";
}

/**
 * High-risk action gate (Section 94): high/critical risk outputs require stronger
 * validation or human approval before release.
 */
export function evaluateHighRiskGate(input: {
  riskLevel: AiRiskLevel;
  humanApproval: boolean;
  multiModelVerified: boolean;
}): { allowed: boolean; requiresApproval: boolean } {
  if (input.riskLevel === "low" || input.riskLevel === "medium") {
    return { allowed: true, requiresApproval: false };
  }
  if (input.riskLevel === "high") {
    return {
      allowed: input.multiModelVerified || input.humanApproval,
      requiresApproval: !input.multiModelVerified,
    };
  }
  // critical: human approval is mandatory.
  return { allowed: input.humanApproval && input.multiModelVerified, requiresApproval: true };
}

/* ─────────────────────────────────────────────────────────────
 * Human-in-the-loop (95) + escalation (96) + decision record (97)
 * ────────────────────────────────────────────────────────────*/

export type HumanReviewDecision = "approved" | "rejected" | "modified" | "escalated" | "overridden";

export const HUMAN_REVIEW_DECISIONS: readonly HumanReviewDecision[] = [
  "approved",
  "rejected",
  "modified",
  "escalated",
  "overridden",
] as const;

export interface AiDecisionRecord {
  id: AiDecisionId;
  tenantId: TenantId;
  requestId: AiRequestId;
  contextRef: string;
  modelId: AiModelId;
  resultRef: string;
  confidence: number;
  evidenceRefs: string[];
  policyDecision: string;
  approvalState: "not_required" | "pending" | "approved" | "rejected";
  reviewerRef: string | null;
  createdAt: string;
}

export function createAiDecisionRecord(input: {
  id: AiDecisionId;
  tenantId: TenantId;
  requestId: AiRequestId;
  contextRef: string;
  modelId: AiModelId;
  resultRef: string;
  confidence: number;
  evidenceRefs?: string[];
  policyDecision: string;
  approvalState?: AiDecisionRecord["approvalState"];
  reviewerRef?: string | null;
  now?: string;
}): AiDecisionRecord {
  return {
    id: input.id,
    tenantId: input.tenantId,
    requestId: input.requestId,
    contextRef: input.contextRef,
    modelId: input.modelId,
    resultRef: input.resultRef,
    confidence: input.confidence,
    evidenceRefs: input.evidenceRefs ?? [],
    policyDecision: input.policyDecision,
    approvalState: input.approvalState ?? "not_required",
    reviewerRef: input.reviewerRef ?? null,
    createdAt: input.now ?? timeAuthority.now().at,
  };
}

/** Escalation triggers (Section 96): low confidence, evidence conflicts, high risk. */
export function shouldEscalate(input: {
  riskLevel: AiRiskLevel;
  confidence: number;
  evidenceConflict: boolean;
  authorizationAmbiguous: boolean;
  policyUnclear: boolean;
}): boolean {
  if (input.riskLevel === "high" || input.riskLevel === "critical") return true;
  if (input.confidence < 0.5) return true;
  if (input.evidenceConflict) return true;
  if (input.authorizationAmbiguous) return true;
  if (input.policyUnclear) return true;
  return false;
}

/* ─────────────────────────────────────────────────────────────
 * Cost, budgets, quotas, priority (Sections 102, 103, 104, 105)
 * ────────────────────────────────────────────────────────────*/

export interface AiBudget {
  id: AiBudgetId;
  tenantId: TenantId;
  /** Monthly token budget. */
  monthlyTokens: number;
  /** Monthly cost budget in minor units (e.g. kobo/cent). */
  monthlyCostMinorUnits: number;
  usedTokens: number;
  usedCostMinorUnits: number;
  monthRef: string;
}

export function consumeAiBudget(
  budget: AiBudget,
  tokens: number,
  costMinorUnits: number,
): { ok: true; budget: AiBudget } | { ok: false; error: string } {
  if (budget.usedTokens + tokens > budget.monthlyTokens) {
    return { ok: false, error: "AI token budget exceeded (Section 103)" };
  }
  if (budget.usedCostMinorUnits + costMinorUnits > budget.monthlyCostMinorUnits) {
    return { ok: false, error: "AI cost budget exceeded (Section 103)" };
  }
  return {
    ok: true,
    budget: {
      ...budget,
      usedTokens: budget.usedTokens + tokens,
      usedCostMinorUnits: budget.usedCostMinorUnits + costMinorUnits,
    },
  };
}

export type AiQuotaScope = "user" | "tenant" | "application" | "model";

export const AI_QUOTA_SCOPES: readonly AiQuotaScope[] = [
  "user",
  "tenant",
  "application",
  "model",
] as const;

export interface AiQuota {
  scope: AiQuotaScope;
  scopeRef: string;
  /** Requests allowed per window. */
  requestLimit: number;
  requestsUsed: number;
  windowRef: string;
}

export function consumeAiQuota(
  quota: AiQuota,
): { ok: true; quota: AiQuota } | { ok: false; error: string } {
  if (quota.requestsUsed >= quota.requestLimit) {
    return {
      ok: false,
      error: `AI quota exhausted for ${quota.scope}:${quota.scopeRef} (Section 104)`,
    };
  }
  return { ok: true, quota: { ...quota, requestsUsed: quota.requestsUsed + 1 } };
}

export type AiQueuePriority = "low" | "normal" | "high" | "critical";

export const AI_QUEUE_PRIORITIES: readonly AiQueuePriority[] = [
  "low",
  "normal",
  "high",
  "critical",
] as const;

/**
 * Priority queues (Section 105): high-priority AI tasks receive higher scheduling
 * priority subject to policy. Returns a comparable ordering weight.
 */
export function priorityWeight(priority: AiQueuePriority): number {
  switch (priority) {
    case "low":
      return 1;
    case "normal":
      return 2;
    case "high":
      return 3;
    case "critical":
      return 4;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Caching (106) + semantic caching (107)
 * ────────────────────────────────────────────────────────────*/

export interface AiCacheEntry {
  key: string;
  tenantId: TenantId;
  resultRef: string;
  /** Sensitive results require appropriate isolation (Section 106). */
  dataClassification: "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";
  createdAt: string;
  expiresAt: string | null;
}

/**
 * Semantic caching (Section 107): similar requests may reuse verified results when
 * context is equivalent, freshness permits, and authorization permits.
 */
export function canReuseCachedResult(input: {
  cached: AiCacheEntry;
  requesterTenantId: TenantId;
  now: string;
}): boolean {
  if (input.cached.tenantId !== input.requesterTenantId) return false;
  if (input.cached.dataClassification === "RESTRICTED") return false;
  if (input.cached.expiresAt !== null && input.cached.expiresAt <= input.now) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Resilience (Section 108): circuit breaker
 * ────────────────────────────────────────────────────────────*/

export interface CircuitBreakerState {
  key: string;
  failureCount: number;
  failureThreshold: number;
  openedAt: string | null;
  halfOpenAllowed: boolean;
}

export function recordCircuitFailure(
  state: CircuitBreakerState,
  now: string = timeAuthority.now().at,
): CircuitBreakerState {
  const failures = state.failureCount + 1;
  if (failures >= state.failureThreshold && state.openedAt === null) {
    return { ...state, failureCount: failures, openedAt: now };
  }
  return { ...state, failureCount: failures };
}

export function isCircuitOpen(
  state: CircuitBreakerState,
  now: string = timeAuthority.now().at,
): boolean {
  if (state.openedAt === null) return false;
  // Half-open probe after the configured cooldown is out of scope here; the state
  // exposes halfOpenAllowed for the caller to manage graceful degradation (108).
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * AI policy precedence (Section 142) + consent (143) + disclosure (145)
 * ────────────────────────────────────────────────────────────*/

export type AiPolicyLevel = "platform" | "jurisdiction" | "tenant" | "application" | "user";

export const AI_POLICY_LEVELS: readonly AiPolicyLevel[] = [
  "platform",
  "jurisdiction",
  "tenant",
  "application",
  "user",
] as const;

export const AI_POLICY_LEVEL_RANK: Record<AiPolicyLevel, number> = {
  platform: 5,
  jurisdiction: 4,
  tenant: 3,
  application: 2,
  user: 1,
};

/**
 * Section 142: deterministic precedence — Platform → Jurisdiction → Tenant →
 * Application → User. The more restrictive policy wins unless explicitly
 * overridden by an authorized higher-level rule.
 */
export function resolvePolicyPrecedence(input: {
  permissionsByLevel: Partial<Record<AiPolicyLevel, "allow" | "deny" | "restrict">>;
}): { decision: "allow" | "deny" | "restrict"; appliedLevel: AiPolicyLevel | null } {
  for (const level of AI_POLICY_LEVELS) {
    const decision = input.permissionsByLevel[level];
    if (decision === "deny") return { decision: "deny", appliedLevel: level };
    if (decision === "restrict") return { decision: "restrict", appliedLevel: level };
  }
  return { decision: "allow", appliedLevel: null };
}

export interface AiConsentRecord {
  tenantId: TenantId;
  identityRef: string;
  /** Capability the consent covers (Section 143). */
  capability: string;
  consented: boolean;
  consentedAt: string;
}

export function hasConsent(record: AiConsentRecord): boolean {
  return record.consented;
}

export type AiDisclosureKind = "ai_generated" | "ai_assisted" | "human_reviewed";

export const AI_DISCLOSURE_KINDS: readonly AiDisclosureKind[] = [
  "ai_generated",
  "ai_assisted",
  "human_reviewed",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Feedback (146) + safe learning (148, 149)
 * ────────────────────────────────────────────────────────────*/

export type AiFeedbackKind = "incorrect" | "unsafe" | "irrelevant" | "missing_context" | "harmful";

export const AI_FEEDBACK_KINDS: readonly AiFeedbackKind[] = [
  "incorrect",
  "unsafe",
  "irrelevant",
  "missing_context",
  "harmful",
] as const;

export interface AiFeedback {
  tenantId: TenantId;
  requestId: AiRequestId;
  kind: AiFeedbackKind;
  detail: string | null;
  submittedAt: string;
}

/** Section 148: production AI behavior must not silently modify itself. */
export function allowsUnsupervisedSelfModification(): boolean {
  return false;
}

/**
 * Safe learning (Section 149): learning systems must use evaluation, validation,
 * approval, and controlled deployment before production changes.
 */
export function isLearningDeploymentPermitted(input: {
  evaluated: boolean;
  validated: boolean;
  approved: boolean;
  controlledDeployment: boolean;
}): boolean {
  return input.evaluated && input.validated && input.approved && input.controlledDeployment;
}

/* ─────────────────────────────────────────────────────────────
 * Evaluation platform (120) + golden datasets (121)
 * ────────────────────────────────────────────────────────────*/

export interface AiEvaluation {
  id: AiEvaluationId;
  tenantId: TenantId | null;
  datasetRef: string;
  modelId: AiModelId;
  promptVersion: string | null;
  correctness: number;
  relevance: number;
  groundedness: number;
  safety: number;
  consistency: number;
  evaluatedAt: string;
}

export function evaluateAiOutput(input: {
  id: AiEvaluationId;
  tenantId?: TenantId | null;
  datasetRef: string;
  modelId: AiModelId;
  promptVersion?: string | null;
  correctness: number;
  relevance: number;
  groundedness: number;
  safety: number;
  consistency: number;
  now?: string;
}): AiEvaluation {
  return {
    id: input.id,
    tenantId: input.tenantId ?? null,
    datasetRef: input.datasetRef,
    modelId: input.modelId,
    promptVersion: input.promptVersion ?? null,
    correctness: input.correctness,
    relevance: input.relevance,
    groundedness: input.groundedness,
    safety: input.safety,
    consistency: input.consistency,
    evaluatedAt: input.now ?? timeAuthority.now().at,
  };
}

/** A model must pass all quality gates before promotion (Section 132). */
export function isModelPromotable(evaluation: AiEvaluation, minScore: number = 0.8): boolean {
  return (
    evaluation.correctness >= minScore &&
    evaluation.relevance >= minScore &&
    evaluation.groundedness >= minScore &&
    evaluation.safety >= minScore &&
    evaluation.consistency >= minScore
  );
}

/* ─────────────────────────────────────────────────────────────
 * Release pipeline (131) + kill switch (181) + isolation (182)
 * ────────────────────────────────────────────────────────────*/

export type AiReleaseStage =
  "research" | "evaluation" | "safety_review" | "pilot" | "canary" | "production" | "monitoring";

export const AI_RELEASE_STAGES: readonly AiReleaseStage[] = [
  "research",
  "evaluation",
  "safety_review",
  "pilot",
  "canary",
  "production",
  "monitoring",
] as const;

const RELEASE_ORDER: Record<AiReleaseStage, number> = {
  research: 0,
  evaluation: 1,
  safety_review: 2,
  pilot: 3,
  canary: 4,
  production: 5,
  monitoring: 6,
};

/**
 * Section 131: a model advances through the release pipeline only one stage at a
 * time. A model cannot enter production merely because it performs well on one
 * benchmark (Section 132).
 */
export function canAdvanceReleaseStage(current: AiReleaseStage, next: AiReleaseStage): boolean {
  return RELEASE_ORDER[next] === RELEASE_ORDER[current] + 1;
}

/**
 * Model canary (Section 134): canary traffic is a controlled fraction of
 * production traffic; it must stay below the configured maximum.
 */
export function canaryWithinLimit(canaryFraction: number, maxFraction: number): boolean {
  return canaryFraction > 0 && canaryFraction <= maxFraction;
}

export interface AiKillSwitch {
  capabilityKey: string;
  disabled: boolean;
  disabledAt: string | null;
  disabledByRef: string | null;
}

/**
 * AI kill switch (Section 181): critical AI capabilities may be disabled
 * independently without shutting down CoreGrid (capability isolation, 182).
 */
export function disableAiCapability(
  sw: AiKillSwitch,
  byRef: string,
  now: string = timeAuthority.now().at,
): AiKillSwitch {
  return { ...sw, disabled: true, disabledAt: now, disabledByRef: byRef };
}

export function isAiCapabilityEnabled(sw: AiKillSwitch): boolean {
  return !sw.disabled;
}

/**
 * AI observability telemetry (Sections 99, 100, 101): capture structured telemetry
 * WITHOUT storing sensitive content. PII/credentials/secrets are excluded.
 */
export function sanitizeAiTelemetry(
  raw: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const sensitiveKeys = [
    "email",
    "phone",
    "password",
    "token",
    "secret",
    "api_key",
    "student",
    "finance",
    "content",
  ];
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) continue;
    if (typeof value === "string" && value.length > 120) {
      out[key] = value.slice(0, 120);
    } else {
      out[key] = value;
    }
  }
  return out;
}
