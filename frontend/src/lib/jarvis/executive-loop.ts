/**
 * CoreGrid — Jarvis executive loop (V1, directive §§28/30/34/55).
 *
 * The executable half of the executive-orchestrator contract: a PURE planning
 * cycle that turns evidence-classed platform observations into
 *  - detected conditions (fixed §30 vocabulary, severity by deterministic rule),
 *  - staffed mission proposals (matched against the V1 workforce role catalog,
 *    with executor/verifier role independence — directive §20),
 *  - escalations (including every proposal the authority model cannot staff),
 *  - an executive briefing whose every item carries an anti-hallucination
 *    claim class; executed/verified claims without an evidence ref FAIL CLOSED.
 *
 * This module PLANS and never EXECUTES: it performs no I/O, calls no model,
 * grants no authority, and signs nothing with any actor other than the fixed
 * "jarvis" ref. Adoption into a live server function remains the separate
 * authorization boundary (worker-launch functions, RLS, capability gate) —
 * the same discipline as mission-runner.ts ("plans, never executes").
 */
import { AGENT_RISK_CLASSIFICATIONS, type AgentRiskClassification } from "../agent-core";
import {
  staffingIsIndependenceSafe,
  verifierRolesForCapability,
  executorRolesForCapability,
  type WorkforceRole,
  WORKFORCE_ROLE_CATALOG_VALIDATED,
} from "../workforce/role-catalog";
import {
  computeWorkforcePerformance,
  type MissionTransitionObservation,
  type WorkforcePerformanceReport,
} from "../workforce/performance-metrics";
import type { MissionContractCore, MissionEvidenceRecord } from "../mission/mission-contract";
import type { UsageRecord } from "../metering/usage-ledger";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

/** Directive §21 anti-hallucination claim classes (model output is never truth). */
export const EXECUTIVE_CLAIM_CLASSES = [
  "observed",
  "inferred",
  "proposed",
  "executed",
  "verified",
  "unknown",
] as const;
export type ExecutiveClaimClass = (typeof EXECUTIVE_CLAIM_CLASSES)[number];

/** Directive §30 condition vocabulary — unknown conditions fail closed. */
export const EXECUTIVE_CONDITION_CODES = [
  "database_degradation",
  "api_failure",
  "provider_outage",
  "queue_backlog",
  "redis_failure",
  "email_failure",
  "ai_rate_limit",
  "deployment_failure",
  "test_regression",
  "security_vulnerability",
  "cost_anomaly",
  "traffic_spike",
  "storage_growth",
  "webhook_failure",
  "auth_anomaly",
  "worker_failure",
  "mission_timeout",
] as const;
export type ExecutiveConditionCode = (typeof EXECUTIVE_CONDITION_CODES)[number];

export const EXECUTIVE_SEVERITIES = ["info", "warning", "critical"] as const;
export type ExecutiveSeverity = (typeof EXECUTIVE_SEVERITIES)[number];

const EXECUTIVE_OBSERVATION_SOURCES = [
  "provider_health",
  "mission_state",
  "database",
  "log",
  "metric",
  "provider",
  "operator",
] as const;
export type ExecutiveObservationSource = (typeof EXECUTIVE_OBSERVATION_SOURCES)[number];

/** Signals that are critical on a single evidence-backed report (§30 examples). */
const CRITICAL_SIGNALS: readonly ExecutiveConditionCode[] = [
  "security_vulnerability",
  "auth_anomaly",
  "deployment_failure",
];

/** Condition → staffing capability map (executor slugs, verifier slugs). */
const CONDITION_CAPABILITY_MAP: Readonly<
  Record<ExecutiveConditionCode, { executor: readonly string[]; verifier: readonly string[] }>
> = {
  database_degradation: { executor: ["lease_substrate_operation", "bounded_recovery_execution"], verifier: ["recovery_drill_execution"] },
  api_failure: { executor: ["provider_integration"], verifier: ["verification_independent"] },
  provider_outage: { executor: ["provider_integration", "fallback_policy_review"], verifier: ["verification_independent"] },
  queue_backlog: { executor: ["concurrency_analysis"], verifier: ["verification_independent"] },
  redis_failure: { executor: ["bounded_recovery_execution"], verifier: ["verification_independent"] },
  email_failure: { executor: ["communication_dispatch"], verifier: ["verification_independent"] },
  ai_rate_limit: { executor: ["ai_gateway_operation"], verifier: ["verification_independent"] },
  deployment_failure: { executor: ["rollback_execution"], verifier: ["release_gate_review"] },
  test_regression: { executor: ["regression_analysis"], verifier: ["verification_independent"] },
  security_vulnerability: { executor: ["incident_response"], verifier: ["verification_independent"] },
  cost_anomaly: { executor: ["cost_analysis"], verifier: ["metering_review"] },
  traffic_spike: { executor: ["performance_analysis"], verifier: ["verification_independent"] },
  storage_growth: { executor: ["data_modeling"], verifier: ["verification_independent"] },
  webhook_failure: { executor: ["webhook_hardening"], verifier: ["verification_independent"] },
  auth_anomaly: { executor: ["incident_response"], verifier: ["verification_independent"] },
  worker_failure: { executor: ["bounded_recovery_execution"], verifier: ["verification_independent"] },
  mission_timeout: { executor: ["bounded_recovery_execution"], verifier: ["verification_independent"] },
};

/** Deny codes — aligned with the Jarvis prohibition vocabulary (§21/§65). */
export type ExecutiveDenyCode =
  | "state_fabrication"
  | "unverified_claim"
  | "unknown_condition"
  | "unknown_claim_class"
  | "missing_rollback_plan"
  | "missing_verification_plan"
  | "missing_evidence_plan"
  | "staffing_independence_violation"
  | "unparseable_instant"
  | "empty_objective";

/* ─────────────────────────────────────────────────────────────
 * Inputs
 * ────────────────────────────────────────────────────────────*/

export interface ExecutiveObservation {
  id: string;
  tenantRef: string;
  summary: string;
  claimClass: ExecutiveClaimClass;
  source: ExecutiveObservationSource;
  /** Where this observation came from (probe, route, table, drill) — provenance law §12. */
  sourceRef: string;
  /** Mandatory for executed/verified claims — the pointer that makes them truth. */
  evidenceRef?: string;
  observedAt: string;
  /** Evidence-backed condition signals the observing surface declares. */
  conditionSignals?: readonly ExecutiveConditionCode[];
}

/**
 * Caller-supplied workforce record inputs (§40): the loop owns the tenant
 * and the clock; callers supply only the governed records the lens reads.
 */
export interface ExecutiveWorkforceRecords {
  readonly missions: readonly MissionContractCore[];
  readonly evidence: readonly MissionEvidenceRecord[];
  readonly transitions: readonly MissionTransitionObservation[];
  /**
   * Optional governed metering records (lib/metering/usage-ledger). When
   * supplied, the §40 token/cost metrics become observed and join the
   * briefing; omitted, they stay not_observable (§65).
   */
  readonly usage?: readonly UsageRecord[];
}

export interface ExecutiveLoopInput {
  tenantRef: string;
  objectives: readonly string[];
  observations: readonly ExecutiveObservation[];
  /** Caller-supplied TimeAuthority instant (ISO). Unparseable instants fail closed. */
  now: string;
  roles?: readonly WorkforceRole[];
  /**
   * Optional workforce record inputs (§40): when supplied, the §40
   * performance lens runs inside the cycle and its metrics join the
   * briefing with their own claim classes. Omit for a purely
   * observation-driven cycle.
   */
  workforce?: ExecutiveWorkforceRecords;
}

/* ─────────────────────────────────────────────────────────────
 * Outputs
 * ────────────────────────────────────────────────────────────*/

export interface DetectedCondition {
  condition: ExecutiveConditionCode;
  severity: ExecutiveSeverity;
  tenantRef: string;
  basisObservationIds: readonly string[];
}

export interface ExecutiveStaffingPlan {
  executorRoleIds: readonly string[];
  verifierRoleIds: readonly string[];
  /** Capabilities no V1 role can staff — the honest gap that triggers escalation. */
  unstaffedCapabilities: readonly string[];
}

export interface ExecutiveMissionProposal {
  missionRef: string;
  tenantRef: string;
  objective: string;
  reason: string;
  priority: "low" | "medium" | "high";
  riskClass: AgentRiskClass;
  status: "proposed";
  requiresApproval: boolean;
  staffing: ExecutiveStaffingPlan;
  verificationPlan: string;
  evidencePlan: string;
  rollbackPlan: string;
  acceptanceCriteria: readonly string[];
  basisObservationIds: readonly string[];
  detectedAt: string;
}

export interface ExecutiveEscalation {
  tenantRef: string;
  severity: ExecutiveSeverity;
  summary: string;
  basisObservationIds: readonly string[];
  reason: string;
}

export interface ExecutiveBriefingItem {
  summary: string;
  claimClass: ExecutiveClaimClass;
  evidenceRef?: string;
}

export interface ExecutiveBriefing {
  tenantRef: string;
  whatHappened: readonly ExecutiveBriefingItem[];
  whatBroke: readonly ExecutiveBriefingItem[];
  whatJarvisProposes: readonly ExecutiveBriefingItem[];
  whatRequiresHumanDecision: readonly ExecutiveBriefingItem[];
}

export interface ExecutiveLoopResult {
  evaluatedAt: string;
  tenantRef: string;
  acceptedObservations: readonly ExecutiveObservation[];
  rejectedObservations: readonly { id: string; denyCode: ExecutiveDenyCode; reason: string }[];
  detectedConditions: readonly DetectedCondition[];
  missionProposals: readonly ExecutiveMissionProposal[];
  escalations: readonly ExecutiveEscalation[];
  briefing: ExecutiveBriefing;
  /** Present only when `workforce` inputs were supplied (§40 lens integrated). */
  workforcePerformance?: WorkforcePerformanceReport;
}

type AgentRiskClass = AgentRiskClassification;

/* ─────────────────────────────────────────────────────────────
 * Fail-closed validation
 * ────────────────────────────────────────────────────────────*/

function isNonEmptyTrimmed(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= maxLength;
}

function isParseableInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function reject(
  id: string,
  denyCode: ExecutiveDenyCode,
  reason: string,
): { id: string; denyCode: ExecutiveDenyCode; reason: string } {
  return { id, denyCode, reason };
}

export function validateExecutiveObservation(
  observation: ExecutiveObservation,
): { ok: true } | { ok: false; denyCode: ExecutiveDenyCode; reason: string } {
  if (!isNonEmptyTrimmed(observation.id, 160)) {
    return { ok: false, denyCode: "state_fabrication", reason: "observation id missing" };
  }
  if (!isNonEmptyTrimmed(observation.tenantRef, 128)) {
    return { ok: false, denyCode: "state_fabrication", reason: "tenant ref missing (multi-tenancy law)" };
  }
  if (!isNonEmptyTrimmed(observation.summary, 400)) {
    return { ok: false, denyCode: "state_fabrication", reason: "observation summary missing or overlong" };
  }
  if (!(EXECUTIVE_CLAIM_CLASSES as readonly string[]).includes(observation.claimClass)) {
    return { ok: false, denyCode: "unknown_claim_class", reason: `unknown claim class: ${String(observation.claimClass)}` };
  }
  if (observation.claimClass === "unknown") {
    return { ok: false, denyCode: "state_fabrication", reason: "unknown claim class may never be asserted as fact" };
  }
  if (!(EXECUTIVE_OBSERVATION_SOURCES as readonly string[]).includes(observation.source)) {
    return { ok: false, denyCode: "state_fabrication", reason: `unknown observation source: ${String(observation.source)}` };
  }
  if (!isNonEmptyTrimmed(observation.sourceRef, 200)) {
    return { ok: false, denyCode: "state_fabrication", reason: "sourceRef missing (provenance law §12)" };
  }
  if (!isParseableInstant(observation.observedAt)) {
    return { ok: false, denyCode: "unparseable_instant", reason: "observedAt is not a parseable instant" };
  }
  const requiresEvidence = observation.claimClass === "executed" || observation.claimClass === "verified";
  if (requiresEvidence && !isNonEmptyTrimmed(observation.evidenceRef ?? "", 200)) {
    return {
      ok: false,
      denyCode: "unverified_claim",
      reason: `claim class ${observation.claimClass} requires an evidenceRef (no claim without evidence)`,
    };
  }
  if (observation.conditionSignals) {
    for (const signal of observation.conditionSignals) {
      if (!(EXECUTIVE_CONDITION_CODES as readonly string[]).includes(signal)) {
        return { ok: false, denyCode: "unknown_condition", reason: `unknown condition signal: ${String(signal)}` };
      }
    }
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Condition detection (deterministic severity rule)
 * ────────────────────────────────────────────────────────────*/

function deriveSeverity(
  condition: ExecutiveConditionCode,
  basisCount: number,
): ExecutiveSeverity {
  if (CRITICAL_SIGNALS.includes(condition)) return "critical";
  if (basisCount >= 2) return "warning";
  return "info";
}

/* ─────────────────────────────────────────────────────────────
 * Staffing (dynamic — §6/§50; no permanent workforce)
 * ────────────────────────────────────────────────────────────*/

export function planStaffing(
  condition: ExecutiveConditionCode,
  roles: readonly WorkforceRole[],
): ExecutiveStaffingPlan {
  const map = CONDITION_CAPABILITY_MAP[condition];
  const executorRoleIds = new Set<string>();
  const unstaffed: string[] = [];
  for (const capability of map.executor) {
    const matches = executorRolesForCapability(roles, capability);
    if (matches.length === 0) unstaffed.push(capability);
    for (const role of matches) executorRoleIds.add(role.roleId);
  }
  const verifierRoleIds = new Set<string>();
  for (const capability of map.verifier) {
    const matches = verifierRolesForCapability(roles, capability);
    if (matches.length === 0) unstaffed.push(capability);
    for (const role of matches) verifierRoleIds.add(role.roleId);
  }
  return {
    executorRoleIds: [...executorRoleIds].sort(),
    verifierRoleIds: [...verifierRoleIds].sort(),
    unstaffedCapabilities: [...new Set(unstaffed)],
  };
}

/* ─────────────────────────────────────────────────────────────
 * The loop
 * ────────────────────────────────────────────────────────────*/

const RISK_BY_SEVERITY: Readonly<Record<ExecutiveSeverity, AgentRiskClass>> = {
  info: "low",
  warning: "medium",
  critical: "high",
};

export function runExecutiveLoop(input: ExecutiveLoopInput): ExecutiveLoopResult {
  if (!isParseableInstant(input.now)) {
    throw new Error("executive loop: now must be a parseable instant (clock discipline)");
  }
  if (!isNonEmptyTrimmed(input.tenantRef, 128)) {
    throw new Error("executive loop: tenantRef required (multi-tenancy law)");
  }
  for (const objective of input.objectives) {
    if (!isNonEmptyTrimmed(objective, 400)) {
      throw new Error("executive loop: every objective must be a non-empty string (empty_objective)");
    }
  }
  const roles = input.roles ?? WORKFORCE_ROLE_CATALOG_VALIDATED;
  const evaluatedAtMs = new Date(input.now).getTime();
  const evaluatedAt = new Date(evaluatedAtMs).toISOString();

  // 1. OBSERVE — accept only evidence-classed observations (fail-closed).
  const acceptedObservations: ExecutiveObservation[] = [];
  const rejectedObservations: { id: string; denyCode: ExecutiveDenyCode; reason: string }[] = [];
  for (const observation of input.observations) {
    const verdict = validateExecutiveObservation(observation);
    if (verdict.ok) acceptedObservations.push(observation);
    else rejectedObservations.push(reject(observation.id ?? "<unidentified>", verdict.denyCode, verdict.reason));
  }

  // 2. DETECT — aggregate evidence-backed signals into conditions.
  const byCondition = new Map<ExecutiveConditionCode, string[]>();
  for (const observation of acceptedObservations) {
    for (const signal of observation.conditionSignals ?? []) {
      const basis = byCondition.get(signal) ?? [];
      basis.push(observation.id);
      byCondition.set(signal, basis);
    }
  }
  const detectedConditions: DetectedCondition[] = [...byCondition.entries()]
    .map(([condition, basisObservationIds]) => ({
      condition,
      severity: deriveSeverity(condition, basisObservationIds.length),
      tenantRef: input.tenantRef,
      basisObservationIds: [...basisObservationIds].sort(),
    }))
    .sort((a, b) => a.condition.localeCompare(b.condition));

  // 3. CREATE MISSIONS + 4. STAFF — proposal-only; Jarvis never implements.
  const missionProposals: ExecutiveMissionProposal[] = [];
  const escalations: ExecutiveEscalation[] = [];
  for (const condition of detectedConditions) {
    const map = CONDITION_CAPABILITY_MAP[condition.condition];
    const staffing = planStaffing(condition.condition, roles);
    if (!staffingIsIndependenceSafe(staffing.executorRoleIds, staffing.verifierRoleIds)) {
      escalations.push({
        tenantRef: input.tenantRef,
        severity: "critical",
        summary: `staffing independence violation while planning response for ${condition.condition}`,
        basisObservationIds: condition.basisObservationIds,
        reason: "staffing_independence_violation — executor and verifier role sets intersect; no proposal issued",
      });
      continue;
    }
    if (staffing.unstaffedCapabilities.length > 0 || staffing.executorRoleIds.length === 0) {
      // No staffed team → escalate honestly instead of fabricating a workforce.
      escalations.push({
        tenantRef: input.tenantRef,
        severity: condition.severity,
        summary: `no V1 workforce staffing available for ${condition.condition}`,
        basisObservationIds: condition.basisObservationIds,
        reason: `unstaffed capabilities: ${staffing.unstaffedCapabilities.join(", ") || "no executor capability matched"}`,
      });
      continue;
    }
    const riskClass = RISK_BY_SEVERITY[condition.severity];
    const missionRef = `jarvis-${condition.condition}-${evaluatedAtMs}`;
    const requiresApproval = condition.severity === "critical" || riskClass === "high";
    missionProposals.push({
      missionRef,
      tenantRef: input.tenantRef,
      objective: `restore stable operation after ${condition.condition.replace(/_/g, " ")}`,
      reason: `detected from evidence-backed observations: ${condition.basisObservationIds.join(", ")}`,
      priority: condition.severity === "critical" ? "high" : condition.severity === "warning" ? "medium" : "low",
      riskClass,
      status: "proposed",
      requiresApproval,
      staffing,
      verificationPlan: `independent verifier role (${staffing.verifierRoleIds.join(", ")}) validates the executed remediation against acceptance criteria before completion`,
      evidencePlan: `executor records evidence artifacts; verifier records its verdict with provenance into the evidence store`,
      rollbackPlan: `revert remediation via the bounded recovery policy; worker leases requeue and orphans recover via the lease substrate`,
      acceptanceCriteria: [
        `no active observation reports ${condition.condition.replace(/_/g, " ")} after remediation`,
        "independent verification verdict recorded",
      ],
      basisObservationIds: condition.basisObservationIds,
      detectedAt: evaluatedAt,
    });
    if (requiresApproval) {
      escalations.push({
        tenantRef: input.tenantRef,
        severity: condition.severity,
        summary: `${condition.severity} condition ${condition.condition} — mission ${missionRef} requires human approval`,
        basisObservationIds: condition.basisObservationIds,
        reason: "authority model: high-risk missions pass the human approval gate (directive §19/§43)",
      });
    }
  }

  // 5. REPORT — the §55 executive briefing, every item claim-classed (§21).
  const whatHappenedItems: ExecutiveBriefingItem[] = acceptedObservations.map((observation) => ({
    summary: observation.summary,
    claimClass: observation.claimClass,
    evidenceRef: observation.evidenceRef,
  }));

  // 5b. WORKFORCE LENS (§40/§41, DECISIONS #208): when workforce records are
  // supplied, compute the performance report inside the cycle and join its
  // metrics into the briefing with their own claim classes (computed metrics
  // are observed/inferred; unobservables stay silent — never fabricated).
  let workforcePerformance: WorkforcePerformanceReport | undefined;
  if (input.workforce) {
    workforcePerformance = computeWorkforcePerformance({
      tenantId: input.tenantRef,
      now: input.now,
      missions: input.workforce.missions,
      evidence: input.workforce.evidence,
      transitions: input.workforce.transitions,
      usage: input.workforce.usage,
    });
    const METRIC_LABELS: readonly (keyof WorkforcePerformanceReport["metrics"])[] = [
      "missionCompletionRate",
      "missionFailureRate",
      "verificationPassRate",
      "reworkRate",
      "rollbackRate",
      "meanTimeToCompletionMs",
      "meanTimeToRecoveryMs",
      "tokenUsage",
      "computeCost",
      "qualityScore",
    ];
    for (const key of METRIC_LABELS) {
      const metric = workforcePerformance.metrics[key];
      if (metric.status !== "computed") continue;
      whatHappenedItems.push({
        summary: `workforce metric ${key} = ${metric.value} (sample: ${metric.sample})`,
        claimClass: metric.claimClass,
        evidenceRef: `mission substrate + metering records: ${workforcePerformance.sampleSize} missions, ${workforcePerformance.resolvedMissions} resolved`,
      });
    }
  }

  const briefing: ExecutiveBriefing = {
    tenantRef: input.tenantRef,
    whatHappened: whatHappenedItems,
    whatBroke: detectedConditions
      .filter((condition) => condition.severity !== "info")
      .map((condition) => ({
        summary: `${condition.condition.replace(/_/g, " ")} (severity: ${condition.severity})`,
        claimClass: "observed" as const,
        evidenceRef: `observations: ${condition.basisObservationIds.join(", ")}`,
      })),
    whatJarvisProposes: missionProposals.map((proposal) => ({
      summary: `${proposal.objective} — mission ${proposal.missionRef}`,
      claimClass: "proposed" as const,
    })),
    whatRequiresHumanDecision: escalations
      .filter((escalation) => escalation.severity === "critical")
      .map((escalation) => ({
        summary: escalation.summary,
        claimClass: "observed" as const,
        evidenceRef: `observations: ${escalation.basisObservationIds.join(", ")}`,
      })),
  };

  // Construction-time briefing integrity: executed/verified items MUST carry evidence.
  for (const item of [...briefing.whatHappened, ...briefing.whatBroke, ...briefing.whatJarvisProposes, ...briefing.whatRequiresHumanDecision]) {
    const requiresEvidence = item.claimClass === "executed" || item.claimClass === "verified";
    if (requiresEvidence && !isNonEmptyTrimmed(item.evidenceRef ?? "", 400)) {
      throw new Error("executive loop: briefing emitted an executed/verified claim without evidence (unverified_claim)");
    }
  }

  return {
    evaluatedAt,
    tenantRef: input.tenantRef,
    acceptedObservations,
    rejectedObservations,
    detectedConditions,
    missionProposals,
    escalations,
    briefing,
    ...(workforcePerformance !== undefined ? { workforcePerformance } : {}),
  };
}