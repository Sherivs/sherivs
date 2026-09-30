/**
 * CoreGrid — Academic Learning Intelligence risk engine,
 * fairness, aggregates, and recommendations (Phase 11, Sections AI, AJ, AK,
 * AL, AM, AN, AV, AW).
 *
 * Implements `architecture/phase-11-academic-intelligence.md`:
 * - Academic Risk Engine (AI): risk signals include persistent learning
 *   gaps, declining performance, repeated failed assessments, missing
 *   prerequisites, prolonged inactivity, unusual performance changes. Risk
 *   must be treated as a probabilistic signal, not a factual diagnosis.
 * - Risk Explainability (AJ): every signal provides evidence, contributing
 *   factors, confidence, uncertainty, model version, timestamp.
 * - Fairness (AK): academic intelligence must be evaluated for demographic,
 *   socioeconomic, accessibility, language, data-sparsity, and historical
 *   institutional bias. Sensitive attributes must not be used improperly.
 * - Teacher/Classroom/Cohort intelligence (AL, AM, AN): aggregate views must
 *   never expose individual data without authorization; individual data must
 *   not be derivable from aggregate views.
 * - Recommendations (AV, AW): every recommendation carries reason, evidence,
 *   confidence, uncertainty, expected benefit, limitations. Recommendations
 *   must not fabricate academic evidence, expose unauthorized student
 *   information, make unsupported high-impact claims, or silently alter
 *   academic records.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Academic risk engine (AI)
 * ────────────────────────────────────────────────────────────*/

export type AcademicRiskType =
  | "persistent_learning_gap"
  | "declining_performance"
  | "repeated_failed_assessments"
  | "missing_prerequisite"
  | "prolonged_inactivity"
  | "unusual_performance_change";

export const ACADEMIC_RISK_TYPES: readonly AcademicRiskType[] = [
  "persistent_learning_gap",
  "declining_performance",
  "repeated_failed_assessments",
  "missing_prerequisite",
  "prolonged_inactivity",
  "unusual_performance_change",
] as const;

export interface AcademicRiskSignal {
  id: string;
  learnerId: string;
  tenantId: TenantId;
  type: AcademicRiskType;
  /** 0-100 probabilistic signal strength (never a diagnosis). */
  strength: number;
  evidenceRefs: string[];
  contributingFactors: string[];
  confidence: number;
  uncertainty: number;
  modelVersion: string;
  detectedAt: string;
  status: "active" | "resolved";
}

export interface EvaluateRiskInput {
  learnerId: string;
  tenantId: TenantId;
  persistentGaps: number;
  performanceDelta: number;
  failedAssessments: number;
  missingPrerequisiteCount: number;
  inactivityDays: number;
  hasUnusualPerformanceChange: boolean;
  modelVersion: string;
  now: string;
}

export interface EvaluateRiskOutput {
  signals: AcademicRiskSignal[];
}

/**
 * Evaluate academic risk signals (AI). Risk is always a probabilistic
 * signal, never a factual diagnosis: every signal carries confidence,
 * uncertainty, contributing factors, and model version (AJ).
 */
export function evaluateAcademicRisk(input: EvaluateRiskInput): EvaluateRiskOutput {
  const signals: AcademicRiskSignal[] = [];
  const makeSignal = (
    type: AcademicRiskType,
    strength: number,
    evidenceRefs: string[],
    contributingFactors: string[],
  ): AcademicRiskSignal => ({
    id: `risk-${input.learnerId}-${type}-${input.now}`,
    learnerId: input.learnerId,
    tenantId: input.tenantId,
    type,
    strength: Math.max(0, Math.min(100, strength)),
    evidenceRefs,
    contributingFactors,
    confidence: 0.7,
    uncertainty: 0.3,
    modelVersion: input.modelVersion,
    detectedAt: input.now,
    status: "active",
  });

  if (input.persistentGaps >= 2) {
    signals.push(
      makeSignal(
        "persistent_learning_gap",
        Math.min(90, 40 + input.persistentGaps * 15),
        [`${input.persistentGaps} persistent gaps`],
        ["Persistent learning gaps across competencies"],
      ),
    );
  }
  if (input.performanceDelta <= -15) {
    signals.push(
      makeSignal(
        "declining_performance",
        Math.min(85, 50 + Math.abs(input.performanceDelta)),
        [`Performance delta ${input.performanceDelta}`],
        ["Recent evidence below earlier evidence"],
      ),
    );
  }
  if (input.failedAssessments >= 2) {
    signals.push(
      makeSignal(
        "repeated_failed_assessments",
        Math.min(85, 40 + input.failedAssessments * 15),
        [`${input.failedAssessments} failed assessments`],
        ["Repeated failed assessments"],
      ),
    );
  }
  if (input.missingPrerequisiteCount > 0) {
    signals.push(
      makeSignal(
        "missing_prerequisite",
        Math.min(80, 30 + input.missingPrerequisiteCount * 20),
        [`${input.missingPrerequisiteCount} missing prerequisites`],
        ["Prerequisite gaps detected"],
      ),
    );
  }
  if (input.inactivityDays >= 14) {
    signals.push(
      makeSignal(
        "prolonged_inactivity",
        Math.min(70, 30 + input.inactivityDays / 2),
        [`${input.inactivityDays} days inactive`],
        ["Prolonged inactivity"],
      ),
    );
  }
  if (input.hasUnusualPerformanceChange) {
    signals.push(
      makeSignal(
        "unusual_performance_change",
        60,
        ["Unusual performance change detected"],
        ["Performance changed unexpectedly"],
      ),
    );
  }

  return { signals };
}

/* ─────────────────────────────────────────────────────────────
 * Fairness guard (AK)
 * ────────────────────────────────────────────────────────────*/

export type SensitiveAttribute =
  "demographic" | "socioeconomic" | "accessibility" | "language" | "historical_institutional";

export const SENSITIVE_ATTRIBUTES: readonly SensitiveAttribute[] = [
  "demographic",
  "socioeconomic",
  "accessibility",
  "language",
  "historical_institutional",
] as const;

/**
 * Fairness guard (AK): sensitive attributes must not be used improperly in
 * academic intelligence. This check rejects risk evaluations that attempt to
 * condition academic decisions directly on sensitive attributes.
 */
export function usesSensitiveAttributeImproperly(attributes: string[]): {
  improper: boolean;
  rejected: string[];
} {
  const rejected = attributes.filter((a) => SENSITIVE_ATTRIBUTES.includes(a as SensitiveAttribute));
  return { improper: rejected.length > 0, rejected };
}

/* ─────────────────────────────────────────────────────────────
 * Classroom/cohort aggregate intelligence (AM, AN)
 * ────────────────────────────────────────────────────────────*/

export interface AggregateStat {
  count: number;
  mean: number;
  min: number;
  max: number;
}

export function computeAggregateStat(values: number[]): AggregateStat | null {
  if (values.length === 0) return null;
  return {
    count: values.length,
    mean: Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export interface AggregateViewPolicy {
  minimumGroupSize: number;
  /** Small groups must not expose individual data (AM). */
  allowSmallGroups: boolean;
}

/**
 * Enforce aggregate privacy (AM): individual data must not be derivable
 * through aggregate views. Groups smaller than the configured minimum are
 * refused unless explicitly allowed by policy — and even then the caller is
 * responsible for Phase 08 authorization.
 */
export function canExposeAggregate(groupSize: number, policy: AggregateViewPolicy): boolean {
  if (groupSize === 0) return false;
  if (groupSize < policy.minimumGroupSize && !policy.allowSmallGroups) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Recommendation safety (AV, AW)
 * ────────────────────────────────────────────────────────────*/

export interface AcademicRecommendation {
  id: string;
  learnerId: string;
  tenantId: TenantId;
  recommendation: string;
  reason: string;
  evidenceRefs: string[];
  confidence: number;
  uncertainty: number;
  expectedBenefit: string;
  limitations: string[];
  createdAt: string;
}

export interface CreateRecommendationInput {
  learnerId: string;
  tenantId: TenantId;
  recommendation: string;
  reason: string;
  evidenceRefs: string[];
  confidence: number;
  uncertainty: number;
  expectedBenefit: string;
  limitations: string[];
  now: string;
}

export type CreateRecommendationResult =
  { ok: true; recommendation: AcademicRecommendation } | { ok: false; error: string };

/**
 * Create a recommendation with mandatory explainability (AV) and safety
 * guards (AW): the recommendation must carry evidence, a reason, confidence,
 * uncertainty, expected benefit, and limitations. It must never fabricate
 * evidence — an empty evidence list is rejected.
 */
export function createAcademicRecommendation(
  input: CreateRecommendationInput,
): CreateRecommendationResult {
  if (input.recommendation.trim() === "") {
    return { ok: false, error: "Recommendation is required (AV)" };
  }
  if (input.reason.trim() === "") {
    return { ok: false, error: "Recommendation requires a reason (AV)" };
  }
  if (input.evidenceRefs.length === 0) {
    return { ok: false, error: "Recommendations must not fabricate academic evidence (AW)" };
  }
  if (
    input.confidence < 0 ||
    input.confidence > 1 ||
    input.uncertainty < 0 ||
    input.uncertainty > 1
  ) {
    return { ok: false, error: "Confidence and uncertainty must be between 0 and 1 (AV)" };
  }
  return {
    ok: true,
    recommendation: {
      id: `recommendation-${input.learnerId}-${input.now}-${Math.random().toString(36).slice(2, 8)}`,
      learnerId: input.learnerId,
      tenantId: input.tenantId,
      recommendation: input.recommendation,
      reason: input.reason,
      evidenceRefs: input.evidenceRefs,
      confidence: input.confidence,
      uncertainty: input.uncertainty,
      expectedBenefit: input.expectedBenefit,
      limitations: input.limitations,
      createdAt: input.now,
    },
  };
}
