/**
 * CoreGrid AI Intelligence Layer — AI reasoning domain.
 *
 * Implements `architecture/phase-26-ai-intelligence-layer.md`:
 * - Reasoning engine (Section 39): decomposition, comparison, causal reasoning,
 *   constraint reasoning, temporal reasoning, probabilistic reasoning,
 *   hypothesis generation, evidence synthesis.
 * - Reasoning levels (Section 40): Simple → Structured → Multi-step →
 *   Domain-specialist → Cross-domain.
 * - Reasoning trace (Section 41): auditable representation of inputs, evidence,
 *   tools, decisions, output, confidence — without exposing private chain-of-thought.
 * - Explanation engine (Section 42): evidence used, factors considered,
 *   assumptions, uncertainty, recommendation rationale.
 * - Uncertainty engine (Section 43): confidence, uncertainty, evidence quality,
 *   source reliability. Calibration (44): stated confidence vs actual correctness.
 * - Hallucination detection (45): retrieval verification, source comparison,
 *   structured validation, domain rules, secondary models.
 * - Claim verification (46): Claim → Evidence → Verification → Confidence.
 * - AI self-checking (47), multi-model verification (48).
 * - AI consensus (49): identify disagreement, compare evidence, escalate where
 *   required — never manufacture consensus. AI debate (50).
 * - Specialist model routing (51): language, mathematics, vision, speech,
 *   documents, education, forecasting, code, reasoning.
 */

import type { AiModelId } from "./ai-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type ReasoningTraceId = string & { readonly __brand: "ReasoningTraceId" };
export type ClaimId = string & { readonly __brand: "ClaimId" };
export type VerificationId = string & { readonly __brand: "VerificationId" };
export type ExplanationId = string & { readonly __brand: "ExplanationId" };

export function reasoningTraceId(raw: string): ReasoningTraceId {
  return raw as ReasoningTraceId;
}
export function claimId(raw: string): ClaimId {
  return raw as ClaimId;
}
export function verificationId(raw: string): VerificationId {
  return raw as VerificationId;
}
export function explanationId(raw: string): ExplanationId {
  return raw as ExplanationId;
}

/* ─────────────────────────────────────────────────────────────
 * Reasoning levels (Section 40)
 * ────────────────────────────────────────────────────────────*/

export type ReasoningLevel =
  "simple" | "structured" | "multi_step" | "domain_specialist" | "cross_domain";

export const REASONING_LEVELS: readonly ReasoningLevel[] = [
  "simple",
  "structured",
  "multi_step",
  "domain_specialist",
  "cross_domain",
] as const;

export type ReasoningOperation =
  | "decomposition"
  | "comparison"
  | "causal_reasoning"
  | "constraint_reasoning"
  | "temporal_reasoning"
  | "probabilistic_reasoning"
  | "hypothesis_generation"
  | "evidence_synthesis";

export const REASONING_OPERATIONS: readonly ReasoningOperation[] = [
  "decomposition",
  "comparison",
  "causal_reasoning",
  "constraint_reasoning",
  "temporal_reasoning",
  "probabilistic_reasoning",
  "hypothesis_generation",
  "evidence_synthesis",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Reasoning trace (Section 41)
 * ────────────────────────────────────────────────────────────*/

export interface ReasoningTrace {
  id: ReasoningTraceId;
  level: ReasoningLevel;
  operations: ReasoningOperation[];
  /** Evidence refs used. */
  evidenceRefs: string[];
  /** Tool refs used. */
  toolRefs: string[];
  decision: string;
  outputRef: string;
  confidence: number;
  /** Chain-of-thought is intentionally excluded (Section 41). */
  createdAt: string;
}

export function createReasoningTrace(input: {
  id: ReasoningTraceId;
  level: ReasoningLevel;
  operations: ReasoningOperation[];
  evidenceRefs?: string[];
  toolRefs?: string[];
  decision: string;
  outputRef: string;
  confidence: number;
  now?: string;
}): ReasoningTrace {
  return {
    id: input.id,
    level: input.level,
    operations: input.operations,
    evidenceRefs: input.evidenceRefs ?? [],
    toolRefs: input.toolRefs ?? [],
    decision: input.decision,
    outputRef: input.outputRef,
    confidence: input.confidence,
    createdAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Explanation engine (Section 42)
 * Useful explanations, never private hidden reasoning.
 * ────────────────────────────────────────────────────────────*/

export interface AiExplanation {
  id: ExplanationId;
  evidenceUsed: string[];
  factorsConsidered: string[];
  assumptions: string[];
  uncertainty: string;
  recommendationRationale: string;
}

export function buildExplanation(input: {
  id: ExplanationId;
  evidenceUsed?: string[];
  factorsConsidered?: string[];
  assumptions?: string[];
  uncertainty?: string;
  recommendationRationale: string;
}): AiExplanation {
  return {
    id: input.id,
    evidenceUsed: input.evidenceUsed ?? [],
    factorsConsidered: input.factorsConsidered ?? [],
    assumptions: input.assumptions ?? [],
    uncertainty: input.uncertainty ?? "",
    recommendationRationale: input.recommendationRationale,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Uncertainty engine (Section 43) + calibration (44)
 * ────────────────────────────────────────────────────────────*/

export interface UncertaintyEstimate {
  confidence: number;
  uncertainty: number;
  evidenceQuality: number;
  sourceReliability: number;
}

export function estimateUncertainty(input: {
  confidence: number;
  evidenceQuality: number;
  sourceReliability: number;
}): UncertaintyEstimate {
  const confidence = Math.max(0, Math.min(1, input.confidence));
  const uncertainty = 1 - confidence * input.evidenceQuality * input.sourceReliability;
  return {
    confidence,
    uncertainty,
    evidenceQuality: input.evidenceQuality,
    sourceReliability: input.sourceReliability,
  };
}

/**
 * Calibration (Section 44): measure whether stated confidence corresponds to
 * actual correctness. Returns a calibration error — the lower the better.
 */
export function calibrationError(
  samples: Array<{ statedConfidence: number; correct: boolean }>,
): number {
  if (samples.length === 0) return 0;
  const total = samples.reduce(
    (sum, s) => sum + Math.abs(s.statedConfidence - (s.correct ? 1 : 0)),
    0,
  );
  return total / samples.length;
}

/* ─────────────────────────────────────────────────────────────
 * Claim verification (Section 46) + hallucination detection (45)
 * ────────────────────────────────────────────────────────────*/

export type VerificationMethod =
  | "retrieval_verification"
  | "source_comparison"
  | "structured_validation"
  | "domain_rules"
  | "secondary_model";

export const VERIFICATION_METHODS: readonly VerificationMethod[] = [
  "retrieval_verification",
  "source_comparison",
  "structured_validation",
  "domain_rules",
  "secondary_model",
] as const;

export interface Claim {
  id: ClaimId;
  statement: string;
  /** Evidence refs supporting the claim. */
  evidenceRefs: string[];
  verification: VerificationStatus;
  confidence: number;
}

export interface VerificationStatus {
  id: VerificationId;
  method: VerificationMethod;
  /** True when the claim was supported by verification. */
  supported: boolean;
  checkedAt: string;
}

export function verifyClaim(input: {
  id: ClaimId;
  statement: string;
  evidenceRefs: string[];
  method: VerificationMethod;
  /** 0-1 score from the verification signal. */
  verificationScore: number;
  threshold?: number;
  now?: string;
}): Claim {
  const threshold = input.threshold ?? 0.7;
  const supported = input.verificationScore >= threshold && input.evidenceRefs.length > 0;
  return {
    id: input.id,
    statement: input.statement,
    evidenceRefs: input.evidenceRefs,
    verification: {
      id: verificationId(crypto.randomUUID()),
      method: input.method,
      supported,
      checkedAt: input.now ?? timeAuthority.now().at,
    },
    confidence: supported ? Math.min(1, input.verificationScore) : input.verificationScore * 0.5,
  };
}

/**
 * Hallucination detection (Section 45): an output is flagged as a suspected
 * hallucination when it cites no retrievable evidence OR cites evidence that
 * does not support the claim.
 */
export function detectHallucination(input: { claim: Claim; retrievableEvidenceRefs: string[] }): {
  suspected: boolean;
  reason: string | null;
} {
  if (input.claim.evidenceRefs.length === 0) {
    return { suspected: true, reason: "No evidence cited (unsupported generation)" };
  }
  const supported = input.claim.evidenceRefs.some((r) => input.retrievableEvidenceRefs.includes(r));
  if (!supported) {
    return { suspected: true, reason: "Cited evidence is not retrievable/authorized" };
  }
  if (!input.claim.verification.supported) {
    return { suspected: true, reason: "Verification did not support the claim" };
  }
  return { suspected: false, reason: null };
}

/* ─────────────────────────────────────────────────────────────
 * Multi-model verification (48) + consensus (49) + debate (50)
 * ────────────────────────────────────────────────────────────*/

export interface ModelVerdict {
  modelId: AiModelId;
  supports: boolean;
  confidence: number;
}

/**
 * AI consensus (Section 49): identify disagreement rather than manufacturing
 * consensus. When models disagree, the result escalates.
 */
export function evaluateConsensus(verdicts: ModelVerdict[]): {
  unanimous: boolean;
  supportCount: number;
  total: number;
  escalate: boolean;
} {
  if (verdicts.length === 0) return { unanimous: true, supportCount: 0, total: 0, escalate: false };
  const supportCount = verdicts.filter((v) => v.supports).length;
  const unanimous = supportCount === 0 || supportCount === verdicts.length;
  return {
    unanimous,
    supportCount,
    total: verdicts.length,
    escalate: !unanimous,
  };
}

/**
 * Multi-model verification (Section 48): high-risk outputs use independent models
 * to evaluate factuality/consistency/safety/policy compliance.
 */
export function multiModelVerify(
  verdicts: ModelVerdict[],
  requiredAgreement: "majority" | "unanimous",
): { passed: boolean; escalate: boolean } {
  if (verdicts.length === 0) return { passed: false, escalate: true };
  const supportCount = verdicts.filter((v) => v.supports).length;
  if (requiredAgreement === "unanimous") {
    return { passed: supportCount === verdicts.length, escalate: supportCount !== verdicts.length };
  }
  const majority = supportCount > verdicts.length / 2;
  return { passed: majority, escalate: !majority && verdicts.length >= 2 };
}

/* ─────────────────────────────────────────────────────────────
 * Specialist model routing (Section 51)
 * ────────────────────────────────────────────────────────────*/

export type SpecialistDomain =
  | "language"
  | "mathematics"
  | "vision"
  | "speech"
  | "documents"
  | "education"
  | "forecasting"
  | "code"
  | "reasoning";

export const SPECIALIST_DOMAINS: readonly SpecialistDomain[] = [
  "language",
  "mathematics",
  "vision",
  "speech",
  "documents",
  "education",
  "forecasting",
  "code",
  "reasoning",
] as const;
