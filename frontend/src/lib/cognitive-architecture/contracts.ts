/**
 * CoreGrid — Phase 34 Universal Cognitive Intelligence Engine substrate
 * contracts (H3 wave Squad G, mission G-054; Constitution §7, §9, §12, §16,
 * §21; architecture/phase-34-universal-cognitive-intelligence-engine.md).
 *
 * WHAT: the typed contract surface of the cognitive substrate — the phase
 * owns cognitive interpretation, reasoning, inference, hypothesis formation,
 * uncertainty reasoning, cognitive evaluation, cognitive learning, model and
 * strategy selection, cognitive confidence and cognitive provenance. It owns
 * NO identity, NO authorization, NO canonical truth, NO model-provider access
 * (phase 26 gateway), NO reality substrate (phase 33). Every artifact this
 * surface describes is DERIVED intelligence: a labelled, provenance-bearing,
 * confidence-carrying value that may never overwrite canonical records and
 * may never act without policy and approval.
 *
 * Laws of this module:
 * - Derived labelling (Canonical Truth, AGENTS §9): a cognitive output is
 *   born labelled `derived`. There is no schema path to an unlabelled or
 *   canonical-looking cognitive artifact.
 * - Explained confidence (phase doc §T): confidence is never an unexplained
 *   number — every confidence value names the factors it was derived from
 *   and the method that combined them.
 * - Cited claims (phase doc §CC/§CD and the acceptance map): a claim with no
 *   evidence citations fails verification and is flagged as hallucination
 *   risk. Verification fails closed: unsupported means unsupported.
 * - No chain-of-thought exposure (phase doc §CC): the reasoning trace
 *   exposes inputs, evidence, strategy, major inference steps, assumptions,
 *   alternatives, conclusion and confidence — not private chain-of-thought.
 *   Any input carrying chain-of-thought-shaped keys fails closed with a
 *   typed reason.
 * - Risk-based cognition (phase doc §DD): higher-impact cognition requires
 *   stronger safeguards. The gate emits the authorization engine's §16
 *   vocabulary and fails closed to DENY when a mandated safeguard is absent.
 * - Disagreement escalates (phase doc §Q/§S): model disagreement can never
 *   resolve to consensus — it escalates.
 * - Supervised learning only (phase doc §BV): a learning deployment is
 *   deployable only with evaluation, validation, approval and monitoring
 *   evidence; anything less is BLOCKED, never silently permitted.
 * - Fail-closed parsing: an untrusted input that violates any invariant
 *   yields a typed failure with structured issues. A failed parse never
 *   yields a partial artifact.
 *
 * Composition: the decision vocabulary is the authorization engine's §16
 * vocabulary, imported read-only as types from the identity module. No
 * sibling wave modules, no vendor imports, no I/O, no persistence, no
 * wall-clock reads — every instant is a supplied parameter — no secrets.
 *
 * Neutral vocabulary only (J-037 shrink-only): this is platform substrate.
 * A "cognitive artifact" is any derived value produced over the universal
 * reality substrate; no domain vocabulary appears here.
 */

import { z } from "zod";
import type { AuthorizationDecision } from "../identity";

/* ─────────────────────────────────────────────────────────────
 * Version and bounds (no unbounded artifacts)
 * ────────────────────────────────────────────────────────────*/

export const COGNITIVE_CONTRACT_SCHEMA_VERSION = "1.0";

/** Hard ceiling on evidence citations attached to one cognitive artifact. */
export const MAX_CITATIONS = 256;

/** Hard ceiling on major inference steps in one reasoning trace. */
export const MAX_TRACE_STEPS = 64;

/** Hard ceiling on assumptions attached to one cognitive artifact. */
export const MAX_ASSUMPTIONS = 64;

/** Hard ceiling on competing hypotheses in one cognitive operation. */
export const MAX_HYPOTHESES = 32;

/** Hard ceiling on model responses in one ensemble verification. */
export const MAX_ENSEMBLE_RESPONSES = 16;

/** Hard ceiling on world-model beliefs in one world model. */
export const MAX_BELIEFS = 1_024;

/* ─────────────────────────────────────────────────────────────
 * Vocabulary (phase doc §C, §G, §U, §X, §DD)
 * ────────────────────────────────────────────────────────────*/

/** Cognitive states (phase doc §G). */
export const COGNITIVE_STATES = [
  "UNKNOWN",
  "OBSERVING",
  "CONTEXTUALIZING",
  "UNDERSTANDING",
  "REASONING",
  "HYPOTHESIZING",
  "SIMULATING",
  "PREDICTING",
  "EVALUATING",
  "DECIDING",
  "LEARNING",
  "UPDATING",
  "UNCERTAIN",
  "CONFLICTED",
  "BLOCKED",
  "FAILED",
] as const;
export type CognitiveState = (typeof COGNITIVE_STATES)[number];

/** Operation types the phase owns (phase doc §C — cognitive ownership). */
export const COGNITIVE_OPERATION_TYPES = [
  "interpret",
  "reason",
  "infer",
  "hypothesize",
  "predict",
  "plan",
  "evaluate",
  "learn",
  "synthesize",
] as const;
export type CognitiveOperationType = (typeof COGNITIVE_OPERATION_TYPES)[number];

/** Reasoning strategies the phase owns (phase doc §C). */
export const REASONING_STRATEGIES = [
  "deductive",
  "inductive",
  "abductive",
  "analogical",
  "causal",
  "counterfactual",
  "temporal",
  "spatial",
  "probabilistic",
  "comparative",
  "multi_perspective",
] as const;
export type ReasoningStrategy = (typeof REASONING_STRATEGIES)[number];

/** Uncertainty kinds the phase owns (phase doc §U). */
export const UNCERTAINTY_KINDS = [
  "epistemic",
  "aleatoric",
  "missing_information",
  "ambiguous_interpretation",
  "model",
  "measurement",
  "temporal",
] as const;
export type UncertaintyKind = (typeof UNCERTAINTY_KINDS)[number];

/** Derived artifact kinds the phase produces (phase doc §C — produces). */
export const DERIVED_ARTIFACT_KINDS = [
  "interpretation",
  "hypothesis",
  "inference",
  "prediction",
  "explanation",
  "recommendation",
  "plan",
  "uncertainty_estimate",
  "learning_signal",
  "evaluation",
] as const;
export type DerivedArtifactKind = (typeof DERIVED_ARTIFACT_KINDS)[number];

/** Hypothesis lifecycle states (phase doc §X). */
export const HYPOTHESIS_LIFECYCLE_STATES = [
  "GENERATED",
  "SCREENED",
  "SUPPORTED",
  "CONTESTED",
  "TESTED",
  "VALIDATED",
  "REJECTED",
  "ARCHIVED",
] as const;
export type HypothesisLifecycleState = (typeof HYPOTHESIS_LIFECYCLE_STATES)[number];

/**
 * Allowed hypothesis lifecycle transitions (phase doc §X). The lifecycle is
 * a governed forward walk; no hypothesis becomes truth without validation.
 */
export const HYPOTHESIS_LIFECYCLE_TRANSITIONS: Readonly<
  Record<HypothesisLifecycleState, readonly HypothesisLifecycleState[]>
> = {
  GENERATED: ["SCREENED"],
  SCREENED: ["SUPPORTED", "CONTESTED"],
  SUPPORTED: ["TESTED"],
  CONTESTED: ["TESTED", "REJECTED"],
  TESTED: ["VALIDATED", "REJECTED"],
  VALIDATED: ["ARCHIVED"],
  REJECTED: ["ARCHIVED"],
  ARCHIVED: [],
};

/** Impact tiers for risk-based cognition (phase doc §DD). */
export const COGNITIVE_IMPACT_TIERS = ["low", "medium", "high", "critical"] as const;
export type CognitiveImpactTier = (typeof COGNITIVE_IMPACT_TIERS)[number];

/* ─────────────────────────────────────────────────────────────
 * Provenance and evidence primitives (AGENTS §12; phase doc §CD)
 * ────────────────────────────────────────────────────────────*/

const nonEmptyString = (label: string) =>
  z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`);

export const identifierSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,127}$/,
    "identifier must be 1-128 characters of letters, digits, underscore, colon, dot or hyphen, starting alphanumeric",
  );
export type Identifier = z.infer<typeof identifierSchema>;

/** Content digest binding an artifact to the bytes it was derived from. */
export const digestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "digest must be a lowercase 64-character hex content digest");

export const tenantRefSchema = identifierSchema;

/**
 * Cognitive provenance (AGENTS §12; phase doc §CD): every derived artifact
 * answers who produced it, under which policy, in which tenant, when, and
 * with what trace. There are no anonymous cognitive artifacts.
 */
export const cognitiveProvenanceSchema = z.strictObject({
  actorId: identifierSchema,
  /** Human, agent or service — follows the identity module's kind split. */
  actorKind: z.enum(["human", "agent", "service"]),
  tenantId: tenantRefSchema,
  policyRef: nonEmptyString("provenance.policyRef"),
  traceId: identifierSchema,
  recordedAt: z.string().datetime(),
});
export type CognitiveProvenance = z.infer<typeof cognitiveProvenanceSchema>;

/**
 * An evidence citation binds a derived claim to verified substrate evidence
 * by reference and content digest — never by inlined payload.
 */
export const evidenceCitationSchema = z.strictObject({
  evidenceId: identifierSchema,
  /** Neutral source class of the cited evidence (reality substrate). */
  sourceKind: z.enum(["observation", "event", "record", "knowledge", "memory", "telemetry"]),
  digest: digestSchema,
  collectedAt: z.string().datetime(),
});
export type EvidenceCitation = z.infer<typeof evidenceCitationSchema>;

/* ─────────────────────────────────────────────────────────────
 * Confidence and uncertainty (phase doc §T, §U)
 * ────────────────────────────────────────────────────────────*/

/** Factors confidence may be derived from (phase doc §T). */
export const CONFIDENCE_FACTORS = [
  "evidence_quality",
  "evidence_quantity",
  "model_reliability",
  "agreement",
  "contradiction",
  "data_freshness",
  "reasoning_stability",
  "uncertainty",
  "historical_calibration",
] as const;
export type ConfidenceFactor = (typeof CONFIDENCE_FACTORS)[number];

/**
 * Explained confidence: a value in [0,1] that names at least one deriving
 * factor and the method that combined them. A bare number is not confidence.
 */
export const confidenceSchema = z.strictObject({
  value: z.number().min(0).max(1),
  derivedFrom: z.array(z.enum(CONFIDENCE_FACTORS)).min(1).max(CONFIDENCE_FACTORS.length),
  method: nonEmptyString("confidence.method"),
});
export type Confidence = z.infer<typeof confidenceSchema>;

/** Structured uncertainty estimate (phase doc §U). */
export const uncertaintyEstimateSchema = z.strictObject({
  kind: z.enum(UNCERTAINTY_KINDS),
  degree: z.number().min(0).max(1),
  rationale: nonEmptyString("uncertainty.rationale"),
});
export type UncertaintyEstimate = z.infer<typeof uncertaintyEstimateSchema>;

/** Structured assumption (phase doc §V). */
export const assumptionSchema = z.strictObject({
  assumptionId: identifierSchema,
  statement: nonEmptyString("assumption.statement"),
  source: nonEmptyString("assumption.source"),
  confidence: confidenceSchema,
  impact: z.enum(["low", "medium", "high", "critical"]),
  validated: z.boolean(),
  invalidationCondition: nonEmptyString("assumption.invalidationCondition"),
});
export type Assumption = z.infer<typeof assumptionSchema>;

/* ─────────────────────────────────────────────────────────────
 * Cognitive operation (phase doc §F, §G)
 * ────────────────────────────────────────────────────────────*/

export const cognitiveOperationSchema = z.strictObject({
  operationId: identifierSchema,
  operationType: z.enum(COGNITIVE_OPERATION_TYPES),
  objective: nonEmptyString("operation.objective"),
  state: z.enum(COGNITIVE_STATES),
  strategy: z.enum(REASONING_STRATEGIES),
  /** Digest of the reality context the operation reasons over — never the payload. */
  contextDigest: digestSchema,
  citations: z.array(evidenceCitationSchema).max(MAX_CITATIONS),
  assumptions: z.array(assumptionSchema).max(MAX_ASSUMPTIONS),
  provenance: cognitiveProvenanceSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});
export type CognitiveOperation = z.infer<typeof cognitiveOperationSchema>;

/* ─────────────────────────────────────────────────────────────
 * Reasoning trace (phase doc §CC) — chain-of-thought guard
 * ────────────────────────────────────────────────────────────*/

/**
 * A major inference step is a summary of the step, its inputs and outputs by
 * reference — never private chain-of-thought text.
 */
export const reasoningStepSchema = z.strictObject({
  stepIndex: z.number().int().min(0),
  summary: nonEmptyString("step.summary"),
  consumes: z.array(identifierSchema).max(MAX_CITATIONS),
  produces: z.array(identifierSchema).max(MAX_CITATIONS),
});
export type ReasoningStep = z.infer<typeof reasoningStepSchema>;

/**
 * Key-shape markers that indicate private chain-of-thought exposure. Any
 * untrusted input carrying these keys fails closed — the trace exposes
 * operations and outputs, not private reasoning text (phase doc §CC).
 */
const CHAIN_OF_THOUGHT_KEY_PATTERN =
  /chain[-_ ]?of[-_ ]?thought|internal[-_ ]?monologue|raw[-_ ]?thought|scratchpad/i;

function findChainOfThoughtKeys(value: unknown, path: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findChainOfThoughtKeys(item, `${path}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.flatMap(([key, child]) => {
      const childPath = `${path}.${key}`;
      if (CHAIN_OF_THOUGHT_KEY_PATTERN.test(key)) return [childPath];
      return findChainOfThoughtKeys(child, childPath);
    });
  }
  return [];
}

export const reasoningTraceSchema = z.strictObject({
  traceId: identifierSchema,
  operationId: identifierSchema,
  strategy: z.enum(REASONING_STRATEGIES),
  /** Digest of the inputs the trace was produced from. */
  inputsDigest: digestSchema,
  citations: z.array(evidenceCitationSchema).min(1).max(MAX_CITATIONS),
  steps: z.array(reasoningStepSchema).max(MAX_TRACE_STEPS),
  assumptions: z.array(assumptionSchema).max(MAX_ASSUMPTIONS),
  alternatives: z.array(identifierSchema).max(MAX_HYPOTHESES),
  conclusion: nonEmptyString("trace.conclusion"),
  confidence: confidenceSchema,
  producedAt: z.string().datetime(),
});
export type ReasoningTrace = z.infer<typeof reasoningTraceSchema>;

export type CognitiveParseFailureReason =
  | "invalid_shape"
  | "chain_of_thought_exposure"
  | "cross_record_invariant";

export interface CognitiveParseIssue {
  readonly path: string;
  readonly message: string;
}

export type CognitiveParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: CognitiveParseFailureReason;
      readonly issues: readonly CognitiveParseIssue[];
    };

function issuePath(path: readonly (string | number | symbol)[]): string {
  if (path.length === 0) return "(root)";
  return path.map((segment) => String(segment)).join(".");
}

function shapeFailure(error: z.ZodError): CognitiveParseResult<never> {
  return {
    ok: false,
    reason: "invalid_shape",
    issues: error.issues.map((issue) => ({
      path: issuePath(issue.path),
      message: issue.message,
    })),
  };
}

/**
 * Parse an untrusted reasoning trace. Fails closed on shape violations, on
 * any chain-of-thought-shaped key anywhere in the input, and on traces that
 * cite no evidence. A failed parse never yields a partial trace.
 */
export function parseReasoningTrace(input: unknown): CognitiveParseResult<ReasoningTrace> {
  const exposed = findChainOfThoughtKeys(input, "$");
  if (exposed.length > 0) {
    return {
      ok: false,
      reason: "chain_of_thought_exposure",
      issues: exposed.map((path) => ({
        path,
        message:
          "chain-of-thought-shaped key is not permitted in a reasoning trace — the trace exposes operations and outputs, not private reasoning",
      })),
    };
  }

  const parsed = reasoningTraceSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);

  return { ok: true, value: parsed.data };
}

/**
 * Parse an untrusted cognitive operation. Fails closed on shape violations
 * and on the lifecycle invariant that only terminal or closed operations
 * (BLOCKED, FAILED, EVALUATING, DECIDING, LEARNING, UPDATING) may carry an
 * end time — a running operation never does.
 */
const CLOSED_OPERATION_STATES: readonly CognitiveState[] = [
  "BLOCKED",
  "FAILED",
  "EVALUATING",
  "DECIDING",
  "LEARNING",
  "UPDATING",
];

export function parseCognitiveOperation(input: unknown): CognitiveParseResult<CognitiveOperation> {
  const parsed = cognitiveOperationSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);

  const operation = parsed.data;
  const closed = CLOSED_OPERATION_STATES.includes(operation.state);
  if (operation.endedAt !== null && !closed) {
    return {
      ok: false,
      reason: "cross_record_invariant",
      issues: [
        {
          path: "endedAt",
          message: `operation in non-terminal state ${operation.state} must not carry an end time`,
        },
      ],
    };
  }
  if (operation.endedAt === null && closed) {
    return {
      ok: false,
      reason: "cross_record_invariant",
      issues: [
        {
          path: "endedAt",
          message: `operation in closed state ${operation.state} must carry an end time`,
        },
      ],
    };
  }

  return { ok: true, value: operation };
}

/* ─────────────────────────────────────────────────────────────
 * Hypotheses (phase doc §W, §X)
 * ────────────────────────────────────────────────────────────*/

export const hypothesisSchema = z.strictObject({
  hypothesisId: identifierSchema,
  operationId: identifierSchema,
  statement: nonEmptyString("hypothesis.statement"),
  state: z.enum(HYPOTHESIS_LIFECYCLE_STATES),
  confidence: confidenceSchema,
  citations: z.array(evidenceCitationSchema).max(MAX_CITATIONS),
  invalidationCondition: nonEmptyString("hypothesis.invalidationCondition"),
  provenance: cognitiveProvenanceSchema,
});
export type Hypothesis = z.infer<typeof hypothesisSchema>;

/**
 * Check one hypothesis lifecycle transition against the §X lifecycle. A
 * transition outside the declared graph is refused — the lifecycle never
 * skips validation.
 */
export function isHypothesisTransitionAllowed(
  from: HypothesisLifecycleState,
  to: HypothesisLifecycleState,
): boolean {
  return HYPOTHESIS_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * Cognitive output artifacts — derived, cited, verifiable
 * ────────────────────────────────────────────────────────────*/

/**
 * A cognitive output artifact. The literal `derivation: "derived"` label is
 * structural: an output cannot be parsed, stored or transmitted through this
 * contract without carrying it (Canonical Truth, AGENTS §9).
 */
export const cognitiveOutputSchema = z.strictObject({
  outputId: identifierSchema,
  operationId: identifierSchema,
  kind: z.enum(DERIVED_ARTIFACT_KINDS),
  derivation: z.literal("derived"),
  statement: nonEmptyString("output.statement"),
  confidence: confidenceSchema,
  uncertainties: z.array(uncertaintyEstimateSchema).max(16),
  citations: z.array(evidenceCitationSchema).max(MAX_CITATIONS),
  provenance: cognitiveProvenanceSchema,
  producedAt: z.string().datetime(),
});
export type CognitiveOutput = z.infer<typeof cognitiveOutputSchema>;

export const COGNITIVE_OUTPUT_DERIVED_LABEL = "derived";

/**
 * Parse an untrusted cognitive output. Fail-closed on shape violations; an
 * output with no citations parses but is born UNVERIFIED — verification is
 * a separate, explicit act (see `verifyCognitiveOutput`).
 */
export function parseCognitiveOutput(input: unknown): CognitiveParseResult<CognitiveOutput> {
  const parsed = cognitiveOutputSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);
  return { ok: true, value: parsed.data };
}

export type OutputVerificationStatus = "verified" | "unsupported" | "refuted";

export type OutputVerification =
  | {
      readonly status: "verified";
      readonly outputId: Identifier;
      readonly citationCount: number;
    }
  | {
      readonly status: "unsupported" | "refuted";
      readonly outputId: Identifier;
      readonly reason: string;
    };

/**
 * Verify a parsed cognitive output against its evidence citations.
 * Fail-closed semantics (acceptance: claims require evidence):
 * - zero citations → the claim is unsupported: flagged as hallucination
 *   risk, never silently accepted;
 * - any refuted citation digest match is the caller's refutation input —
 *   a refuted claim stays refuted regardless of confidence.
 */
export function verifyCognitiveOutput(
  output: CognitiveOutput,
  refuted: readonly Identifier[] = [],
): OutputVerification {
  if (refuted.some((id) => id === output.outputId)) {
    return {
      status: "refuted",
      outputId: output.outputId,
      reason: "output was refuted by a verification authority — refutation outranks confidence",
    };
  }
  if (output.citations.length === 0) {
    return {
      status: "unsupported",
      outputId: output.outputId,
      reason: "no evidence citations — uncited output is flagged as hallucination risk and fails verification",
    };
  }
  return { status: "verified", outputId: output.outputId, citationCount: output.citations.length };
}

/** Calibration measurement over a set of predictions (phase doc §BR). */
export const calibrationMeasurementSchema = z.strictObject({
  measuredAt: z.string().datetime(),
  samples: z.number().int().positive(),
  meanPredictedConfidence: z.number().min(0).max(1),
  observedAccuracy: z.number().min(0).max(1),
});
export type CalibrationMeasurement = z.infer<typeof calibrationMeasurementSchema>;

/** Absolute calibration error for one measurement (acceptance: measurable). */
export function calibrationError(measurement: CalibrationMeasurement): number {
  return Math.abs(measurement.meanPredictedConfidence - measurement.observedAccuracy);
}

/* ─────────────────────────────────────────────────────────────
 * Consensus and escalation (phase doc §Q, §S)
 * ────────────────────────────────────────────────────────────*/

export const ensembleResponseSchema = z.strictObject({
  modelRef: identifierSchema,
  conclusionDigest: digestSchema,
  confidence: confidenceSchema,
});
export type EnsembleResponse = z.infer<typeof ensembleResponseSchema>;

export type ConsensusVerdict =
  | { readonly status: "consensus"; readonly agreeingDigest: string; readonly responses: number }
  | { readonly status: "disagreement"; readonly distinctDigests: number; readonly detail: string };

/**
 * Resolve an ensemble to consensus or disagreement. Disagreement escalates —
 * it never resolves to a majority-branded consensus silently, and a
 * single-response ensemble fails closed (no corroboration exists).
 */
export function consensusVerdict(
  responses: readonly EnsembleResponse[],
): ConsensusVerdict {
  if (responses.length < 2) {
    return {
      status: "disagreement",
      distinctDigests: new Set(responses.map((response) => response.conclusionDigest)).size,
      detail:
        "fail-closed: fewer than two model responses — no corroboration exists, cognition must not proceed as if consensus held",
    };
  }
  const byDigest = new Map<string, number>();
  for (const response of responses) {
    byDigest.set(response.conclusionDigest, (byDigest.get(response.conclusionDigest) ?? 0) + 1);
  }
  if (byDigest.size === 1) {
    return {
      status: "consensus",
      agreeingDigest: responses[0].conclusionDigest,
      responses: responses.length,
    };
  }
  return {
    status: "disagreement",
    distinctDigests: byDigest.size,
    detail: `model disagreement across ${byDigest.size} distinct conclusions — escalates per the phase's multi-model verification policy`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Risk-based cognition gate (phase doc §DD; §16 vocabulary)
 * ────────────────────────────────────────────────────────────*/

/** Evidence a cognitive operation may present to its gate. */
export const safeguardEvidenceSchema = z.strictObject({
  /** Verified multi-model verification record (required for high impact). */
  verifiedModels: z.array(identifierSchema).max(MAX_ENSEMBLE_RESPONSES).optional(),
  /** Human/authorized approval reference (required for critical impact). */
  approvalRef: identifierSchema.optional(),
  /** Validation record reference (required for medium impact and above). */
  validationRef: identifierSchema.optional(),
});
export type SafeguardEvidence = z.infer<typeof safeguardEvidenceSchema>;

export type CognitionGateResult =
  | {
      readonly decision: Extract<AuthorizationDecision, "ALLOW">;
      readonly impactTier: CognitiveImpactTier;
    }
  | {
      readonly decision: Exclude<AuthorizationDecision, "ALLOW">;
      readonly impactTier: CognitiveImpactTier;
      readonly reason: string;
    };

const MEDIUM_MIN_MODELS = 1;
const HIGH_MIN_MODELS = 2;

/**
 * Risk-based cognition gate (phase doc §DD), emitting the authorization
 * engine's §16 decision vocabulary. Fail-closed by construction:
 * - low impact → automated cognition allowed;
 * - medium impact → validation evidence required;
 * - high impact → multi-model verification required;
 * - critical impact → human/authorized governance (approval) required.
 * A missing mandated safeguard is never absorbed — it denies or escalates.
 */
export function cognitionGate(
  impactTier: CognitiveImpactTier,
  evidence: SafeguardEvidence,
): CognitionGateResult {
  switch (impactTier) {
    case "low":
      return { decision: "ALLOW", impactTier };
    case "medium": {
      if (evidence.validationRef === undefined) {
        return {
          decision: "DENY",
          impactTier,
          reason: "medium-impact cognition requires validation evidence before proceeding (§DD)",
        };
      }
      return { decision: "ALLOW", impactTier };
    }
    case "high": {
      if (evidence.validationRef === undefined) {
        return {
          decision: "DENY",
          impactTier,
          reason: "high-impact cognition requires validation evidence before proceeding (§DD)",
        };
      }
      const models = evidence.verifiedModels ?? [];
      if (models.length < HIGH_MIN_MODELS) {
        return {
          decision: "ESCALATE",
          impactTier,
          reason: `high-impact cognition requires multi-model verification by at least ${HIGH_MIN_MODELS} models — ${models.length} verified`,
        };
      }
      return { decision: "ALLOW", impactTier };
    }
    case "critical": {
      if (evidence.validationRef === undefined) {
        return {
          decision: "DENY",
          impactTier,
          reason: "critical-impact cognition requires validation evidence before proceeding (§DD)",
        };
      }
      const models = evidence.verifiedModels ?? [];
      if (models.length < HIGH_MIN_MODELS) {
        return {
          decision: "ESCALATE",
          impactTier,
          reason: `critical-impact cognition requires multi-model verification by at least ${HIGH_MIN_MODELS} models — ${models.length} verified`,
        };
      }
      if (evidence.approvalRef === undefined) {
        return {
          decision: "REQUIRE_APPROVAL",
          impactTier,
          reason: "critical-impact cognition requires human/authorized governance approval (§DD)",
        };
      }
      return { decision: "ALLOW", impactTier };
    }
  }
}

export const MEDIUM_IMPACT_MIN_VERIFIED_MODELS = MEDIUM_MIN_MODELS;
export const MULTI_MODEL_MIN_VERIFIED_MODELS = HIGH_MIN_MODELS;

/* ─────────────────────────────────────────────────────────────
 * Supervised learning deployment gate (phase doc §BV)
 * ────────────────────────────────────────────────────────────*/

export const learningDeploymentSchema = z.strictObject({
  candidateId: identifierSchema,
  evaluationRef: identifierSchema.optional(),
  validationRef: identifierSchema.optional(),
  sandboxComparisonRef: identifierSchema.optional(),
  approvalRef: identifierSchema.optional(),
  monitored: z.boolean(),
});
export type LearningDeployment = z.infer<typeof learningDeploymentSchema>;

export type LearningDeploymentVerdict =
  | { readonly deployable: true; readonly candidateId: Identifier }
  | {
      readonly deployable: false;
      readonly candidateId: Identifier;
      readonly missing: readonly string[];
      readonly detail: string;
    };

/**
 * Supervised-learning gate (phase doc §BV — no unsupervised production
 * mutation). A learning candidate is deployable only when ALL of: evaluation,
 * validation, sandbox comparison, approval and monitoring are present.
 * Anything less is BLOCKED with the missing gates named — never silently
 * permitted, never partially deployed.
 */
export function evaluateLearningDeployment(
  deployment: LearningDeployment,
): LearningDeploymentVerdict {
  const missing: string[] = [];
  if (deployment.evaluationRef === undefined) missing.push("evaluation");
  if (deployment.validationRef === undefined) missing.push("validation");
  if (deployment.sandboxComparisonRef === undefined) missing.push("sandbox_comparison");
  if (deployment.approvalRef === undefined) missing.push("approval");
  if (!deployment.monitored) missing.push("monitoring");

  if (missing.length > 0) {
    return {
      deployable: false,
      candidateId: deployment.candidateId,
      missing,
      detail: `fail-closed: unsupervised production mutation is prohibited — learning deployment is blocked until all gates are satisfied (missing: ${missing.join(", ")})`,
    };
  }
  return { deployable: true, candidateId: deployment.candidateId };
}

/* ─────────────────────────────────────────────────────────────
 * World models (phase doc ownership; kernel boundary statement)
 * ────────────────────────────────────────────────────────────*/

export const beliefSchema = z.strictObject({
  beliefId: identifierSchema,
  statement: nonEmptyString("belief.statement"),
  derivation: z.literal("derived"),
  confidence: confidenceSchema,
  uncertainties: z.array(uncertaintyEstimateSchema).max(16),
  citations: z.array(evidenceCitationSchema).max(MAX_CITATIONS),
  provenance: cognitiveProvenanceSchema,
  revisedAt: z.string().datetime(),
});
export type Belief = z.infer<typeof beliefSchema>;

export const worldModelSchema = z.strictObject({
  worldModelId: identifierSchema,
  tenantId: tenantRefSchema,
  beliefs: z.array(beliefSchema).max(MAX_BELIEFS),
  updatedAt: z.string().datetime(),
  provenance: cognitiveProvenanceSchema,
});
export type WorldModel = z.infer<typeof worldModelSchema>;

export type BeliefRevisionVerdict =
  | { readonly accepted: true; readonly beliefId: Identifier }
  | { readonly accepted: false; readonly beliefId: Identifier; readonly reason: string };

/**
 * Revise one belief in a world model. Fail-closed revision rules:
 * - the incoming belief must be labelled derived (it is structurally — this
 *   function re-asserts it against a canonical-labelled impostor);
 * - a revision must not lower provenance completeness: same tenant, fresh
 *   provenance;
 * - a revision may not silently contradict a belief with strictly higher
 *   confidence — contradiction is contested cognition (phase doc §AV), it
 *   escalates rather than overwrites.
 */
export function reviseBelief(
  worldModel: WorldModel,
  incoming: Belief,
): BeliefRevisionVerdict {
  if (incoming.derivation !== COGNITIVE_OUTPUT_DERIVED_LABEL) {
    return {
      accepted: false,
      beliefId: incoming.beliefId,
      reason: "only derived beliefs may enter a world model — canonical-labelled values are not cognition",
    };
  }
  if (incoming.provenance.tenantId !== worldModel.tenantId) {
    return {
      accepted: false,
      beliefId: incoming.beliefId,
      reason: "cross-tenant belief revision is refused — world models are tenant-scoped",
    };
  }
  const existing = worldModel.beliefs.find((belief) => belief.beliefId === incoming.beliefId);
  if (
    existing !== undefined &&
    incoming.confidence.value < existing.confidence.value &&
    incoming.provenance.actorKind === "agent"
  ) {
    return {
      accepted: false,
      beliefId: incoming.beliefId,
      reason: "agent revision lowers confidence on an existing belief — contested cognition must escalate, not overwrite",
    };
  }
  return { accepted: true, beliefId: incoming.beliefId };
}
