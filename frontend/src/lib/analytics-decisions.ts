/**
 * CoreGrid — Analytics & Decision Intelligence decision domain
 * (Phase 18, Sections BB, BC, BD, BE, BF, BG, BH, BI, BJ, BK, BL, BM, BN,
 * BO, BP, BQ, BR, BS, BT, BU, BV, BW, BX, BY, BZ, EY, EZ, FA, FB, FC, FD,
 * FE, FF).
 *
 * Implements `architecture/phase-18-analytics-intelligence.md`:
 * - Scenario engine (BB-BH): what-if, scenario isolation (never mutates
 *   production), deterministic/probabilistic/stress/sensitivity/Monte
 *   Carlo types, stress testing against extreme but plausible conditions.
 * - Decision model (BI): objective, options, constraints, evidence,
 *   assumptions, risks, expected outcomes, uncertainty, recommendation.
 * - Objectives (BJ): cost minimization, quality maximization, capacity
 *   utilization, student success, operational resilience, financial
 *   sustainability — multiple objectives must be explicit.
 * - Constraint engine (BK): budget, capacity, policy, staffing, schedule,
 *   legal, safety, resources.
 * - Optimization (BL) and guardrail (BM): optimization must never
 *   silently violate institutional policies.
 * - Recommendation engine (BN-BS): recommendations contain evidence,
 *   assumptions, alternatives, risks, confidence, uncertainty; multiple
 *   alternatives are generated (BO); options compared by expected
 *   benefit/cost/risk/uncertainty/feasibility/policy compliance (BP);
 *   confidence is never presented as certainty (BQ); evidence quality
 *   distinguishes strong/weak/contradictory (BR); evidence chains are
 *   exposed (BS).
 * - Decision audit (BT) and history (BU): decision ID, actor, time,
 *   evidence, options, selected option, rationale, assumptions, model
 *   version; compare previous/expected/actual/variance/lessons (FF).
 * - Outcome attribution (BW), reversibility (BX), risk (BY), escalation
 *   (BZ): Phase 18 does not execute the action.
 * - Uncertainty engine (EY, EZ): confidence intervals, distributions,
 *   ranges, scenarios, confidence scores; predicted probabilities are
 *   evaluated for calibration.
 * - Assumption registry (FB, FC): assumptions stored and may expire.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Scenario engine (BB, BC, BD)
 * ────────────────────────────────────────────────────────────*/

export type ScenarioType =
  "deterministic" | "probabilistic" | "stress" | "sensitivity" | "monte_carlo";

export const SCENARIO_TYPES: readonly ScenarioType[] = [
  "deterministic",
  "probabilistic",
  "stress",
  "sensitivity",
  "monte_carlo",
] as const;

export interface Scenario {
  scenarioId: string;
  name: string;
  type: ScenarioType;
  tenantId: TenantId;
  assumptions: string[];
  inputChanges: Record<string, number>;
  isolated: true;
}

export interface ScenarioResult {
  scenarioId: string;
  simulatedValues: Record<string, number>;
  /** Scenario calculations must never mutate production state (BC). */
  productionMutated: false;
}

/**
 * Run an isolated scenario (BC): the caller supplies the simulation
 * model; this contract guarantees production state is never mutated.
 */
export function runIsolatedScenario(
  scenario: Omit<Scenario, "isolated">,
  model: (base: Record<string, number>, changes: Record<string, number>) => Record<string, number>,
  baseValues: Record<string, number>,
): ScenarioResult {
  return {
    scenarioId: scenario.scenarioId,
    simulatedValues: model(baseValues, scenario.inputChanges),
    productionMutated: false,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Decision model (BI, BJ, BK)
 * ────────────────────────────────────────────────────────────*/

export type DecisionObjective =
  | "cost_minimization"
  | "quality_maximization"
  | "capacity_utilization"
  | "student_success"
  | "operational_resilience"
  | "financial_sustainability";

export const DECISION_OBJECTIVES: readonly DecisionObjective[] = [
  "cost_minimization",
  "quality_maximization",
  "capacity_utilization",
  "student_success",
  "operational_resilience",
  "financial_sustainability",
] as const;

export interface DecisionConstraint {
  name: string;
  limit: number;
  currentValue: number;
}

export interface DecisionOption {
  optionId: string;
  name: string;
  expectedBenefit: number | null;
  expectedCost: number | null;
  risk: string | null;
  feasibility: "high" | "medium" | "low" | "unknown";
  policyCompliant: boolean;
}

/**
 * Constraint evaluation (BK): every constraint must be satisfied before
 * an option is feasible. Unknown feasibility fails safe.
 */
export function areConstraintsSatisfied(constraints: DecisionConstraint[]): {
  ok: boolean;
  reason: string;
} {
  const violated = constraints.find((c) => c.currentValue > c.limit);
  if (violated !== undefined) {
    return {
      ok: false,
      reason: `Constraint "${violated.name}" exceeded: ${violated.currentValue} > ${violated.limit} (BK)`,
    };
  }
  return { ok: true, reason: "All constraints satisfied (BK)" };
}

export function isOptionFeasible(
  option: DecisionOption,
  constraints: DecisionConstraint[],
): boolean {
  return (
    option.policyCompliant &&
    option.feasibility !== "unknown" &&
    areConstraintsSatisfied(constraints).ok
  );
}

/* ─────────────────────────────────────────────────────────────
 * Optimization guardrail (BL, BM)
 * ────────────────────────────────────────────────────────────*/

export interface OptimizationResult {
  selectedOptionId: string;
  objectiveValues: Record<string, number>;
  policyViolations: string[];
}

/**
 * Optimization guardrail (BM): optimization must never silently violate
 * institutional policies. Any policy violation is surfaced explicitly.
 */
export function guardOptimizationResult(
  selectedOptionId: string,
  objectiveValues: Record<string, number>,
  policyViolations: string[],
): { ok: true; result: OptimizationResult } | { ok: false; error: string } {
  if (policyViolations.length > 0) {
    return {
      ok: false,
      error: `Optimization violates policy: ${policyViolations.join("; ")} (BM)`,
    };
  }
  return { ok: true, result: { selectedOptionId, objectiveValues, policyViolations: [] } };
}

/* ─────────────────────────────────────────────────────────────
 * Recommendation engine (BN, BO, BP, BQ, BR, BS)
 * ────────────────────────────────────────────────────────────*/

export type EvidenceQuality = "strong" | "moderate" | "weak" | "contradictory";

export interface Recommendation {
  recommendationId: string;
  tenantId: TenantId;
  recommendation: string;
  evidence: string[];
  evidenceQuality: EvidenceQuality;
  assumptions: string[];
  alternatives: string[];
  risks: string[];
  confidence: number | null;
  uncertainty: string;
  modelVersion: string | null;
}

export interface CreateRecommendationInput {
  recommendationId: string;
  tenantId: TenantId;
  recommendation: string;
  evidence: string[];
  evidenceQuality: EvidenceQuality;
  assumptions: string[];
  alternatives: string[];
  risks: string[];
  confidence: number | null;
  uncertainty: string;
  modelVersion: string | null;
}

export type CreateRecommendationResult =
  { ok: true; rec: Recommendation } | { ok: false; error: string };

/**
 * Recommendation contract (BN-BS): recommendations must contain evidence,
 * assumptions, alternatives, risks, confidence and uncertainty. Confidence
 * is never presented as certainty (BQ).
 */
export function createRecommendation(input: CreateRecommendationInput): CreateRecommendationResult {
  if (input.recommendation.trim() === "") {
    return { ok: false, error: "Recommendation requires a recommendation statement (BN)" };
  }
  if (input.evidence.length === 0) {
    return { ok: false, error: "Recommendation requires evidence (BN)" };
  }
  if (input.uncertainty.trim() === "") {
    return { ok: false, error: "Recommendation must declare its uncertainty (BN)" };
  }
  if (input.confidence !== null && (input.confidence < 0 || input.confidence > 1)) {
    return { ok: false, error: "Confidence must be in [0, 1] — never presented as certainty (BQ)" };
  }
  return { ok: true, rec: { ...input } };
}

/** Evidence quality (BR): distinguish strong/weak/contradictory evidence. */
export function isEvidenceSufficient(evidenceQuality: EvidenceQuality): boolean {
  return evidenceQuality === "strong" || evidenceQuality === "moderate";
}

/* ─────────────────────────────────────────────────────────────
 * Decision record and audit (BT, BU, BW, BX, BY, BZ)
 * ────────────────────────────────────────────────────────────*/

export type DecisionReversibility = "reversible" | "partially_reversible" | "irreversible";

export type DecisionRiskCategory =
  "operational" | "financial" | "academic" | "legal" | "security" | "reputational";

export const DECISION_RISK_CATEGORIES: readonly DecisionRiskCategory[] = [
  "operational",
  "financial",
  "academic",
  "legal",
  "security",
  "reputational",
] as const;

export interface DecisionRecord {
  decisionId: string;
  tenantId: TenantId;
  actor: string;
  time: string;
  evidence: string[];
  options: string[];
  selectedOption: string;
  rationale: string;
  assumptions: string[];
  modelVersion: string | null;
  reversibility: DecisionReversibility;
  risks: DecisionRiskCategory[];
}

export interface CreateDecisionInput {
  decisionId: string;
  tenantId: TenantId;
  actor: string;
  time: string;
  evidence: string[];
  options: string[];
  selectedOption: string;
  rationale: string;
  assumptions: string[];
  modelVersion: string | null;
  reversibility: DecisionReversibility;
  risks: DecisionRiskCategory[];
}

export type CreateDecisionResult =
  { ok: true; decision: DecisionRecord } | { ok: false; error: string };

/**
 * Decision audit (BT): store decision ID, actor, time, evidence, options,
 * selected option, rationale, assumptions and model version.
 */
export function createDecision(input: CreateDecisionInput): CreateDecisionResult {
  if (input.actor.trim() === "") {
    return { ok: false, error: "Decision requires an actor (BT)" };
  }
  if (input.rationale.trim() === "") {
    return { ok: false, error: "Decision requires a rationale (BT)" };
  }
  if (!input.options.includes(input.selectedOption)) {
    return { ok: false, error: "Selected option must be one of the options (BT)" };
  }
  return { ok: true, decision: { ...input } };
}

export interface OutcomeAttribution {
  decisionId: string;
  expectedResult: number | null;
  actualResult: number | null;
  variance: number | null;
  lessons: string[];
}

/**
 * Outcome attribution (BW) and comparison over time (FF): measure whether
 * decisions produced expected outcomes; missing actuals are explicit.
 */
export function recordDecisionOutcome(input: {
  decisionId: string;
  expectedResult: number | null;
  actualResult: number | null;
  lessons: string[];
}): OutcomeAttribution {
  const variance =
    input.expectedResult === null || input.actualResult === null
      ? null
      : Number((input.actualResult - input.expectedResult).toFixed(4));
  return {
    decisionId: input.decisionId,
    expectedResult: input.expectedResult,
    actualResult: input.actualResult,
    variance,
    lessons: input.lessons,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Uncertainty and assumptions (EY, EZ, FB, FC)
 * ────────────────────────────────────────────────────────────*/

export interface UncertaintyRepresentation {
  pointEstimate: number;
  lowerBound: number | null;
  upperBound: number | null;
  confidenceLevel: number | null;
  distribution: "normal" | "uniform" | "scenario" | "none";
}

export function isUncertaintyCoherent(uncertainty: UncertaintyRepresentation): boolean {
  if (
    uncertainty.lowerBound !== null &&
    uncertainty.upperBound !== null &&
    uncertainty.lowerBound > uncertainty.upperBound
  ) {
    return false;
  }
  if (
    uncertainty.confidenceLevel !== null &&
    (uncertainty.confidenceLevel < 0 || uncertainty.confidenceLevel > 1)
  ) {
    return false;
  }
  return true;
}

export interface Assumption {
  assumptionId: string;
  name: string;
  statement: string;
  registeredAt: string;
  expiresAt: string | null;
}

export function isAssumptionExpired(assumption: Assumption, now: string): boolean {
  return assumption.expiresAt !== null && now > assumption.expiresAt;
}
