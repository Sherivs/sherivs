/**
 * CoreGrid — Academic Learning Intelligence Mastery Engine
 * (Phase 11, Sections W, X, Y).
 *
 * Implements `architecture/phase-11-academic-intelligence.md`:
 * - Mastery Engine (W): estimates learner mastery of competencies and
 *   objectives. It must distinguish observed performance, estimated
 *   mastery, confidence in the estimate, and uncertainty.
 * - Mastery Model (X): learner, competency, estimated level, confidence,
 *   evidence count, last evidence, trend, uncertainty, model version.
 * - Mastery Updating (Y): new evidence may update mastery, but the system
 *   must retain the evidence history rather than replacing previous
 *   observations.
 * - Explainability (AC): personalization and mastery must remain
 *   explainable.
 *
 * Boundary: Phase 04 owns authoritative grades/assessments. This engine
 * consumes evidence (academic-core) and produces *estimates* — an estimate
 * is never an authoritative academic record (P, AW).
 */

import type { TenantId } from "./tenant-core";
import type { LearningEvidence } from "./academic-core";

/* ─────────────────────────────────────────────────────────────
 * Mastery state (X)
 * ────────────────────────────────────────────────────────────*/

export interface MasteryState {
  learnerId: string;
  tenantId: TenantId;
  competencyId: string;
  /** 0-100 estimated mastery. */
  estimatedLevel: number;
  /** 0-1 confidence in the estimate. */
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: string | null;
  trend: "improving" | "stable" | "declining" | "insufficient_data";
  /** 0-1 uncertainty. */
  uncertainty: number;
  modelVersion: string;
  updatedAt: string;
}

export interface EstimateMasteryInput {
  learnerId: string;
  tenantId: TenantId;
  competencyId: string;
  evidence: LearningEvidence[];
  modelVersion: string;
  now: string;
}

export type EstimateMasteryResult =
  { ok: true; mastery: MasteryState } | { ok: false; error: string };

/**
 * Estimate mastery from evidence (W, X).
 *
 * The estimate is a confidence-weighted mean of evidence scores, adjusted
 * so that fewer observations yield higher uncertainty and lower confidence.
 * Evidence is never discarded: this function consumes the full evidence
 * history (Y) and returns the aggregated estimate, leaving the history
 * intact.
 */
export function estimateMastery(input: EstimateMasteryInput): EstimateMasteryResult {
  if (input.evidence.length === 0) {
    return { ok: false, error: "Mastery cannot be estimated without evidence (W)" };
  }

  const totalWeight = input.evidence.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight <= 0) {
    return { ok: false, error: "Evidence weights must be positive" };
  }

  // Confidence-weighted mean: higher-confidence evidence contributes more.
  const weightedScore = input.evidence.reduce(
    (sum, e) => sum + e.score * e.weight * (0.5 + e.confidence / 2),
    0,
  );
  const weightBasis = input.evidence.reduce(
    (sum, e) => sum + e.weight * (0.5 + e.confidence / 2),
    0,
  );
  const estimatedLevel = Math.round((weightedScore / weightBasis) * 10) / 10;

  // Confidence grows with evidence count and average evidence confidence,
  // but never reaches 1 (mastery is always an estimate, never a fact).
  const avgEvidenceConfidence =
    input.evidence.reduce((sum, e) => sum + e.confidence, 0) / input.evidence.length;
  const confidence =
    Math.round(
      Math.min(0.95, avgEvidenceConfidence * 0.5 + 0.3 + input.evidence.length * 0.06) * 100,
    ) / 100;
  const uncertainty = Math.round((1 - confidence) * 100) / 100;

  // Trend: compare the mean of the most recent half of evidence to the mean
  // of the earlier half.
  const sorted = [...input.evidence].sort(
    (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt),
  );
  const midpoint = Math.floor(sorted.length / 2);
  const earlier = sorted.slice(0, midpoint);
  const recent = sorted.slice(midpoint);
  const mean = (list: LearningEvidence[]) => list.reduce((s, e) => s + e.score, 0) / list.length;

  let trend: MasteryState["trend"];
  if (sorted.length < 2) {
    trend = "insufficient_data";
  } else {
    const delta = mean(recent) - mean(earlier);
    trend = delta > 3 ? "improving" : delta < -3 ? "declining" : "stable";
  }

  const lastEvidenceAt = [...input.evidence].sort(
    (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt),
  )[0].observedAt;

  return {
    ok: true,
    mastery: {
      learnerId: input.learnerId,
      tenantId: input.tenantId,
      competencyId: input.competencyId,
      estimatedLevel,
      confidence,
      evidenceCount: input.evidence.length,
      lastEvidenceAt,
      trend,
      uncertainty,
      modelVersion: input.modelVersion,
      updatedAt: input.now,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Explainability (AC)
 * ────────────────────────────────────────────────────────────*/

export interface MasteryExplanation {
  learnerId: string;
  competencyId: string;
  estimate: number;
  confidence: number;
  uncertainty: number;
  /** Ordered list of the strongest contributing evidence. */
  topEvidence: { evidenceId: string; score: number; source: string; observedAt: string }[];
  note: string;
}

/**
 * Produce an explainable breakdown of a mastery estimate (AC). Every
 * personalization/mastery decision must be explainable — the explanation
 * references the actual evidence used, not a generic justification.
 */
export function explainMastery(
  mastery: MasteryState,
  evidence: LearningEvidence[],
): MasteryExplanation {
  const topEvidence = [...evidence]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((e) => ({
      evidenceId: e.id,
      score: e.score,
      source: e.source,
      observedAt: e.observedAt,
    }));
  return {
    learnerId: mastery.learnerId,
    competencyId: mastery.competencyId,
    estimate: mastery.estimatedLevel,
    confidence: mastery.confidence,
    uncertainty: mastery.uncertainty,
    topEvidence,
    note: "Mastery is an evidence-weighted estimate, not an official academic record (AW).",
  };
}
