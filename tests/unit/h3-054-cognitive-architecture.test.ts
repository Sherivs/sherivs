/**
 * CoreGrid — H3-054 phase-34 cognitive-architecture contract tests
 * (mission G-054). Zod validation of the cognitive substrate surface:
 * derived labelling, explained confidence, evidence-cited verification and
 * hallucination flagging, chain-of-thought guarding, hypothesis lifecycle,
 * consensus escalation, the risk-based cognition gate, supervised learning
 * deployment and world-model belief revision.
 * Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  COGNITIVE_STATES,
  HYPOTHESIS_LIFECYCLE_STATES,
  MAX_CITATIONS,
  MAX_TRACE_STEPS,
  cognitionGate,
  calibrationError,
  calibrationMeasurementSchema,
  cognitiveOperationSchema,
  cognitiveOutputSchema,
  confidenceSchema,
  consensusVerdict,
  evaluateLearningDeployment,
  isHypothesisTransitionAllowed,
  parseCognitiveOperation,
  parseCognitiveOutput,
  parseReasoningTrace,
  reviseBelief,
  verifyCognitiveOutput,
  type Belief,
  type CognitiveOperation,
  type CognitiveOutput,
  type Confidence,
  type ReasoningTrace,
} from "../../frontend/src/lib/cognitive-architecture/contracts";

const RECORDED_AT = "2026-10-03T00:00:00.000Z";
const DIGEST = "a".repeat(64);

const PROVENANCE = {
  actorId: "agent:cognition-worker-1",
  actorKind: "agent" as const,
  tenantId: "tenant_a",
  policyRef: "policy:cognition-v1",
  traceId: "trace:op-1",
  recordedAt: RECORDED_AT,
};

const CITATION = {
  evidenceId: "evidence:obs-1",
  sourceKind: "observation" as const,
  digest: DIGEST,
  collectedAt: RECORDED_AT,
};

const CONFIDENCE: Confidence = {
  value: 0.72,
  derivedFrom: ["evidence_quality", "agreement"],
  method: "weighted factor aggregation under policy:cognition-v1",
};

function operation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operationId: "op:1",
    operationType: "reason",
    objective: "evaluate competing explanations for observed signal",
    state: "REASONING",
    strategy: "abductive",
    contextDigest: DIGEST,
    citations: [CITATION],
    assumptions: [],
    provenance: PROVENANCE,
    startedAt: RECORDED_AT,
    endedAt: null,
    ...overrides,
  };
}

function trace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    traceId: "trace:t-1",
    operationId: "op:1",
    strategy: "abductive",
    inputsDigest: DIGEST,
    citations: [CITATION],
    steps: [{ stepIndex: 0, summary: "ranked candidate explanations by evidence fit", consumes: ["evidence:obs-1"], produces: ["hyp:h1"] }],
    assumptions: [],
    alternatives: ["hyp:h2"],
    conclusion: "the supported explanation is hypothesis h1",
    confidence: CONFIDENCE,
    producedAt: RECORDED_AT,
    ...overrides,
  };
}

function output(overrides: Record<string, unknown> = {}): CognitiveOutput {
  return {
    outputId: "out:1",
    operationId: "op:1",
    kind: "prediction",
    derivation: "derived",
    statement: "signal likely recurs within the observed interval",
    confidence: CONFIDENCE,
    uncertainties: [{ kind: "aleatoric", degree: 0.2, rationale: "limited observation window" }],
    citations: [CITATION],
    provenance: PROVENANCE,
    producedAt: RECORDED_AT,
    ...overrides,
  } as CognitiveOutput;
}

function belief(overrides: Partial<Belief> = {}): Belief {
  return {
    beliefId: "belief:1",
    statement: "the observed pattern holds under current conditions",
    derivation: "derived",
    confidence: CONFIDENCE,
    uncertainties: [],
    citations: [CITATION],
    provenance: PROVENANCE,
    revisedAt: RECORDED_AT,
    ...overrides,
  };
}

describe("explained confidence (phase doc §T)", () => {
  it("accepts confidence that names its deriving factors and method", () => {
    const parsed = confidenceSchema.safeParse(CONFIDENCE);
    expect(parsed.success).toBe(true);
  });

  it("rejects an unexplained confidence number", () => {
    expect(confidenceSchema.safeParse({ value: 0.9, derivedFrom: [], method: "x" }).success).toBe(false);
    expect(confidenceSchema.safeParse({ value: 0.9, derivedFrom: ["agreement"], method: "" }).success).toBe(false);
    expect(confidenceSchema.safeParse({ value: 0.9 }).success).toBe(false);
  });

  it("bounds confidence to [0,1]", () => {
    expect(confidenceSchema.safeParse({ ...CONFIDENCE, value: -0.1 }).success).toBe(false);
    expect(confidenceSchema.safeParse({ ...CONFIDENCE, value: 1.01 }).success).toBe(false);
    expect(confidenceSchema.safeParse({ ...CONFIDENCE, value: 0 }).success).toBe(true);
    expect(confidenceSchema.safeParse({ ...CONFIDENCE, value: 1 }).success).toBe(true);
  });
});

describe("cognitive operation schema (phase doc §F, §G)", () => {
  it("accepts a complete provenance-bearing operation", () => {
    const parsed = cognitiveOperationSchema.safeParse(operation());
    expect(parsed.success).toBe(true);
  });

  it("rejects anonymous operations — provenance is mandatory (AGENTS §12)", () => {
    const anonymous = operation();
    delete anonymous.provenance;
    expect(cognitiveOperationSchema.safeParse(anonymous).success).toBe(false);
  });

  it("rejects unknown keys — strict surface", () => {
    expect(cognitiveOperationSchema.safeParse(operation({ sneak_field: 1 })).success).toBe(false);
  });

  it("rejects values outside the declared vocabularies", () => {
    expect(cognitiveOperationSchema.safeParse(operation({ state: "DAYDREAMING" })).success).toBe(false);
    expect(cognitiveOperationSchema.safeParse(operation({ strategy: "vibes" })).success).toBe(false);
    expect(cognitiveOperationSchema.safeParse(operation({ operationType: "ransack" })).success).toBe(false);
    expect(COGNITIVE_STATES).toContain("BLOCKED");
  });

  it("enforces the lifecycle invariant: closed states carry an end time, running states do not", () => {
    expect(parseCognitiveOperation(operation({ state: "BLOCKED", endedAt: null })).ok).toBe(false);
    expect(parseCognitiveOperation(operation({ state: "REASONING", endedAt: RECORDED_AT })).ok).toBe(false);
    expect(parseCognitiveOperation(operation({ state: "BLOCKED", endedAt: RECORDED_AT })).ok).toBe(true);
    expect(parseCognitiveOperation(operation({ state: "DECIDING", endedAt: RECORDED_AT })).ok).toBe(true);
    expect(parseCognitiveOperation(operation()).ok).toBe(true);
  });
});

describe("reasoning trace and chain-of-thought guard (phase doc §CC)", () => {
  it("accepts a cited trace exposing only major inference steps", () => {
    const parsed = parseReasoningTrace(trace());
    expect(parsed.ok).toBe(true);
  });

  it("fails closed on a trace with no evidence citations", () => {
    const parsed = parseReasoningTrace(trace({ citations: [] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });

  it("fails closed with a typed reason when chain-of-thought keys appear anywhere in the input", () => {
    for (const key of ["chainOfThought", "chain_of_thought", "scratchpad", "internal_monologue", "rawThought"]) {
      const parsed = parseReasoningTrace(trace({ steps: [{ stepIndex: 0, summary: "s", consumes: [], produces: [], [key]: "private reasoning text" }] }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("chain_of_thought_exposure");
    }
  });

  it("detects chain-of-thought keys nested at any depth", () => {
    const parsed = parseReasoningTrace(
      trace({ assumptions: [{ nested: { "chain of thought": "raw text" } }] }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("chain_of_thought_exposure");
  });

  it("bounds trace steps to the declared ceiling", () => {
    const steps = Array.from({ length: MAX_TRACE_STEPS + 1 }, (_, stepIndex) => ({
      stepIndex,
      summary: "step",
      consumes: [],
      produces: [],
    }));
    expect(parseReasoningTrace(trace({ steps })).ok).toBe(false);
  });
});

describe("derived labelling and verification (AGENTS §9; phase doc §CD)", () => {
  it("structurally requires the derived label on every output", () => {
    const unlabelled = output() as unknown as Record<string, unknown>;
    delete unlabelled.derivation;
    expect(cognitiveOutputSchema.safeParse(unlabelled).success).toBe(false);
    expect(cognitiveOutputSchema.safeParse({ ...unlabelled, derivation: "canonical" }).success).toBe(false);
  });

  it("flags uncited outputs as unsupported hallucination risk — never silently accepted", () => {
    const uncited = output({ citations: [] });
    const verdict = verifyCognitiveOutput(uncited);
    expect(verdict.status).toBe("unsupported");
    if (verdict.status === "unsupported") {
      expect(verdict.reason).toMatch(/hallucination/i);
    }
  });

  it("verifies cited outputs and reports the citation count", () => {
    const verdict = verifyCognitiveOutput(output({ citations: [CITATION, CITATION] }));
    expect(verdict.status).toBe("verified");
    if (verdict.status === "verified") expect(verdict.citationCount).toBe(2);
  });

  it("refutation outranks confidence — a refuted output stays refuted", () => {
    const verdict = verifyCognitiveOutput(output(), ["out:1"]);
    expect(verdict.status).toBe("refuted");
  });

  it("parses outputs fail-closed: no partial artifact from invalid input", () => {
    const bad = output() as unknown as Record<string, unknown>;
    bad.statement = "";
    const parsed = parseCognitiveOutput(bad);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.length).toBeGreaterThan(0);
  });
});

describe("hypothesis lifecycle (phase doc §X)", () => {
  it("permits only declared forward transitions", () => {
    expect(isHypothesisTransitionAllowed("GENERATED", "SCREENED")).toBe(true);
    expect(isHypothesisTransitionAllowed("SCREENED", "SUPPORTED")).toBe(true);
    expect(isHypothesisTransitionAllowed("SCREENED", "CONTESTED")).toBe(true);
    expect(isHypothesisTransitionAllowed("TESTED", "VALIDATED")).toBe(true);
    expect(isHypothesisTransitionAllowed("TESTED", "REJECTED")).toBe(true);
    expect(isHypothesisTransitionAllowed("VALIDATED", "ARCHIVED")).toBe(true);
  });

  it("refuses lifecycle skips — no hypothesis becomes truth without validation", () => {
    expect(isHypothesisTransitionAllowed("GENERATED", "VALIDATED")).toBe(false);
    expect(isHypothesisTransitionAllowed("GENERATED", "REJECTED")).toBe(false);
    expect(isHypothesisTransitionAllowed("CONTESTED", "VALIDATED")).toBe(false);
    expect(isHypothesisTransitionAllowed("ARCHIVED", "SUPPORTED")).toBe(false);
    expect(isHypothesisTransitionAllowed("VALIDATED", "VALIDATED")).toBe(false);
  });

  it("declares the full §X lifecycle state set", () => {
    expect(HYPOTHESIS_LIFECYCLE_STATES).toEqual([
      "GENERATED",
      "SCREENED",
      "SUPPORTED",
      "CONTESTED",
      "TESTED",
      "VALIDATED",
      "REJECTED",
      "ARCHIVED",
    ]);
  });
});

describe("consensus and escalation (phase doc §Q, §S)", () => {
  const response = (digest: string, modelRef: string) => ({
    modelRef,
    conclusionDigest: digest,
    confidence: CONFIDENCE,
  });

  it("resolves full agreement to consensus", () => {
    const verdict = consensusVerdict([response(DIGEST, "model:a"), response(DIGEST, "model:b")]);
    expect(verdict.status).toBe("consensus");
  });

  it("escalates disagreement — it never resolves to silent majority consensus", () => {
    const verdict = consensusVerdict([
      response(DIGEST, "model:a"),
      response(DIGEST, "model:b"),
      response("b".repeat(64), "model:c"),
    ]);
    expect(verdict.status).toBe("disagreement");
  });

  it("fails closed on a single response — no corroboration exists", () => {
    const verdict = consensusVerdict([response(DIGEST, "model:a")]);
    expect(verdict.status).toBe("disagreement");
    if (verdict.status === "disagreement") expect(verdict.detail).toMatch(/fail-closed/i);
  });

  it("fails closed on an empty ensemble", () => {
    expect(consensusVerdict([]).status).toBe("disagreement");
  });
});

describe("risk-based cognition gate (phase doc §DD; §16 vocabulary)", () => {
  it("allows low-impact cognition through automated processing", () => {
    expect(cognitionGate("low", {}).decision).toBe("ALLOW");
  });

  it("denies medium-impact cognition without validation evidence", () => {
    const denied = cognitionGate("medium", {});
    expect(denied.decision).toBe("DENY");
    const allowed = cognitionGate("medium", { validationRef: "validation:v1" });
    expect(allowed.decision).toBe("ALLOW");
  });

  it("requires multi-model verification for high-impact cognition", () => {
    const one = cognitionGate("high", { validationRef: "validation:v1", verifiedModels: ["model:a"] });
    expect(one.decision).toBe("ESCALATE");
    const two = cognitionGate("high", {
      validationRef: "validation:v1",
      verifiedModels: ["model:a", "model:b"],
    });
    expect(two.decision).toBe("ALLOW");
    const none = cognitionGate("high", {});
    expect(none.decision).toBe("DENY");
  });

  it("requires human/authorized approval for critical-impact cognition", () => {
    const verifiedOnly = cognitionGate("critical", {
      validationRef: "validation:v1",
      verifiedModels: ["model:a", "model:b"],
    });
    expect(verifiedOnly.decision).toBe("REQUIRE_APPROVAL");
    const approved = cognitionGate("critical", {
      validationRef: "validation:v1",
      verifiedModels: ["model:a", "model:b"],
      approvalRef: "approval:ap1",
    });
    expect(approved.decision).toBe("ALLOW");
  });

  it("never allows critical cognition on model authority alone", () => {
    const modelsOnly = cognitionGate("critical", {
      verifiedModels: ["model:a", "model:b", "model:c"],
    });
    expect(modelsOnly.decision === "ALLOW").toBe(false);
  });
});

describe("supervised learning deployment (phase doc §BV)", () => {
  const candidate = {
    candidateId: "learn:c1",
    evaluationRef: "eval:e1",
    validationRef: "validation:v1",
    sandboxComparisonRef: "sandbox:s1",
    approvalRef: "approval:ap1",
    monitored: true,
  };

  it("deploys only when every gate is satisfied", () => {
    const verdict = evaluateLearningDeployment(candidate);
    expect(verdict.deployable).toBe(true);
  });

  it("blocks deployment with missing gates named — never silently permitted", () => {
    const blocked = evaluateLearningDeployment({ ...candidate, approvalRef: undefined, monitored: false });
    expect(blocked.deployable).toBe(false);
    if (!blocked.deployable) {
      expect(blocked.missing).toEqual(["approval", "monitoring"]);
      expect(blocked.detail).toMatch(/fail-closed/i);
    }
    const unevaluated = evaluateLearningDeployment({ ...candidate, evaluationRef: undefined });
    expect(unevaluated.deployable).toBe(false);
  });

  it("blocks a bare candidate — unsupervised production mutation is prohibited", () => {
    const verdict = evaluateLearningDeployment({ candidateId: "learn:c2", monitored: false });
    expect(verdict.deployable).toBe(false);
    if (!verdict.deployable) expect(verdict.missing).toHaveLength(5);
  });
});

describe("calibration (phase doc §BR)", () => {
  it("measures calibration error as the absolute confidence gap", () => {
    const measurement = {
      measuredAt: RECORDED_AT,
      samples: 100,
      meanPredictedConfidence: 0.8,
      observedAccuracy: 0.65,
    };
    expect(calibrationMeasurementSchema.safeParse(measurement).success).toBe(true);
    expect(calibrationError(measurement)).toBeCloseTo(0.15);
  });

  it("bounds measurements and rejects non-positive sample counts", () => {
    expect(
      calibrationMeasurementSchema.safeParse({
        measuredAt: RECORDED_AT,
        samples: 0,
        meanPredictedConfidence: 0.8,
        observedAccuracy: 0.65,
      }).success,
    ).toBe(false);
    expect(
      calibrationMeasurementSchema.safeParse({
        measuredAt: RECORDED_AT,
        samples: 1,
        meanPredictedConfidence: 1.2,
        observedAccuracy: 0.65,
      }).success,
    ).toBe(false);
  });
});

describe("world-model belief revision (kernel boundary; phase doc §AV)", () => {
  const worldModel = {
    worldModelId: "world:1",
    tenantId: "tenant_a",
    beliefs: [belief()],
    updatedAt: RECORDED_AT,
    provenance: PROVENANCE,
  };

  it("accepts a same-tenant derived revision", () => {
    const verdict = reviseBelief(worldModel, belief({ confidence: { ...CONFIDENCE, value: 0.9 } }));
    expect(verdict.accepted).toBe(true);
  });

  it("refuses cross-tenant belief revision — world models are tenant-scoped", () => {
    const foreign = belief({
      provenance: { ...PROVENANCE, tenantId: "tenant_b" },
    });
    const verdict = reviseBelief(worldModel, foreign);
    expect(verdict.accepted).toBe(false);
    if (!verdict.accepted) expect(verdict.reason).toMatch(/tenant/i);
  });

  it("refuses a canonical-labelled impostor — only derived values are cognition", () => {
    const impostor = belief({ derivation: "canonical" as unknown as Belief["derivation"] });
    const verdict = reviseBelief(worldModel, impostor);
    expect(verdict.accepted).toBe(false);
  });

  it("refuses agent revisions that lower confidence — contested cognition escalates, not overwrites", () => {
    const downgrade = belief({ confidence: { ...CONFIDENCE, value: 0.1 } });
    const verdict = reviseBelief(worldModel, downgrade);
    expect(verdict.accepted).toBe(false);
    if (!verdict.accepted) expect(verdict.reason).toMatch(/contested|escalate/i);
  });

  it("accepts a human correction that lowers confidence (human oversight, phase doc §DE)", () => {
    const correction = belief({
      confidence: { ...CONFIDENCE, value: 0.1 },
      provenance: { ...PROVENANCE, actorKind: "human" as const, actorId: "human:overseer-1" },
    });
    const verdict = reviseBelief(worldModel, correction);
    expect(verdict.accepted).toBe(true);
  });
});
