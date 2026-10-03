/**
 * CoreGrid — H3-072 phase-34 cognitive-architecture ADVERSARIAL VERIFICATION
 * suite (mission G-072, Verifier role, Squad G; H3-WAVE-CAMPAIGN.md).
 *
 * Target: frontend/src/lib/cognitive-architecture/contracts.ts (landed by
 * H3-054). Imported READ-ONLY — this mission never modifies the module. The
 * architect's own suite (tests/unit/h3-054-cognitive-architecture.test.ts)
 * proves the happy paths; this suite DEEPENS, never duplicates: every test
 * here is an attack attempting to defeat a stated law of the module.
 *
 * Attack classes covered (mission G-072):
 *   1. schema forgery            — forged digests, identifiers, vocabularies,
 *                                  datetimes, labels, types, unknown keys;
 *   2. provenance bypass         — anonymous artifacts, blank/illegal
 *                                  provenance fields, self-signed extras;
 *   3. chain-of-thought key
 *      smuggling at depth        — marker keys nested in objects, arrays,
 *                                  arrays-of-arrays, deep chains, case and
 *                                  separator variants;
 *   4. gate bypass               — missing mandated safeguards must DENY /
 *                                  ESCALATE / REQUIRE_APPROVAL, never allow;
 *   5. tenant-boundary bypass
 *      in belief revision        — cross-tenant and identity-spoofing
 *                                  revisions against a tenant-scoped model;
 *   6. hallucination-label bypass— label forgery, uncited claims, refutation
 *                                  outranking;
 *   7. cardinality/oversize      — every declared ceiling probed at the
 *                                  boundary and one past it.
 *
 * Verdict discipline: every contained attack must fail with a TYPED denial
 * (an exported discriminated-union failure reason or a schema-level typed
 * issue set) — never a throw, never a partial artifact. An attack that
 * SUCCEEDS is recorded as a precise FINDING in the registry below and in
 * progress/h3-wave/H3-072.report.md; per mission law the module is not fixed
 * here. Finding-tests assert the OBSERVED behavior honestly and are labelled
 * FINDING so they cannot be mistaken for an endorsement.
 *
 * Pure offline: no network, no database, no secrets, no wall-clock reads.
 */
import { describe, expect, it } from "vitest";
import {
  COGNITIVE_STATES,
  MAX_ASSUMPTIONS,
  MAX_BELIEFS,
  MAX_CITATIONS,
  MAX_ENSEMBLE_RESPONSES,
  MAX_HYPOTHESES,
  MAX_TRACE_STEPS,
  cognitiveOperationSchema,
  cognitiveOutputSchema,
  cognitiveProvenanceSchema,
  confidenceSchema,
  ensembleResponseSchema,
  evidenceCitationSchema,
  hypothesisSchema,
  parseCognitiveOperation,
  parseCognitiveOutput,
  parseReasoningTrace,
  reviseBelief,
  safeguardEvidenceSchema,
  uncertaintyEstimateSchema,
  verifyCognitiveOutput,
  worldModelSchema,
  cognitionGate,
  type Belief,
  type CognitiveImpactTier,
  type CognitiveOperation,
  type CognitiveOutput,
  type CognitiveProvenance,
  type Confidence,
  type EvidenceCitation,
  type WorldModel,
} from "../../frontend/src/lib/cognitive-architecture/contracts";

/* ─────────────────────────────────────────────────────────────
 * Fixtures (valid, schema-conformant baselines)
 * ────────────────────────────────────────────────────────────*/

const RECORDED_AT = "2026-10-03T00:00:00.000Z";
const DIGEST = "a".repeat(64);
const DIGEST_ALT = "b".repeat(64);

function confidence(overrides: Partial<Confidence> = {}): Confidence {
  return {
    value: 0.72,
    derivedFrom: ["evidence_quality", "agreement"],
    method: "weighted factor aggregation under policy:cognition-v1",
    ...overrides,
  };
}

function provenance(overrides: Partial<CognitiveProvenance> = {}): CognitiveProvenance {
  return {
    actorId: "agent:cognition-worker-1",
    actorKind: "agent",
    tenantId: "tenant_a",
    policyRef: "policy:cognition-v1",
    traceId: "trace:op-1",
    recordedAt: RECORDED_AT,
    ...overrides,
  };
}

function citation(overrides: Partial<EvidenceCitation> = {}): EvidenceCitation {
  return {
    evidenceId: "evidence:obs-1",
    sourceKind: "observation",
    digest: DIGEST,
    collectedAt: RECORDED_AT,
    ...overrides,
  };
}

function belief(overrides: Partial<Belief> = {}): Belief {
  return {
    beliefId: "belief:1",
    statement: "the observed pattern holds under current conditions",
    derivation: "derived",
    confidence: confidence(),
    uncertainties: [],
    citations: [citation()],
    provenance: provenance(),
    revisedAt: RECORDED_AT,
    ...overrides,
  };
}

function worldModel(beliefs: Belief[] = [belief()]): WorldModel {
  return {
    worldModelId: "world:1",
    tenantId: "tenant_a",
    beliefs,
    updatedAt: RECORDED_AT,
    provenance: provenance(),
  };
}

function validOutput(overrides: Partial<CognitiveOutput> = {}): CognitiveOutput {
  return {
    outputId: "out:1",
    operationId: "op:1",
    kind: "prediction",
    derivation: "derived",
    statement: "signal likely recurs within the observed interval",
    confidence: confidence(),
    uncertainties: [{ kind: "aleatoric", degree: 0.2, rationale: "limited observation window" }],
    citations: [citation()],
    provenance: provenance(),
    producedAt: RECORDED_AT,
    ...overrides,
  };
}

function validOperation(overrides: Partial<CognitiveOperation> = {}): CognitiveOperation {
  return {
    operationId: "op:1",
    operationType: "reason",
    objective: "evaluate competing explanations for observed signal",
    state: "REASONING",
    strategy: "abductive",
    contextDigest: DIGEST,
    citations: [citation()],
    assumptions: [],
    provenance: provenance(),
    startedAt: RECORDED_AT,
    endedAt: null,
    ...overrides,
  };
}

/** Untrusted-input shape for traces: attacker-controlled JSON-ish object. */
type AttackObject = Record<string, unknown>;

function traceInput(overrides: AttackObject = {}): AttackObject {
  return {
    traceId: "trace:t-1",
    operationId: "op:1",
    strategy: "abductive",
    inputsDigest: DIGEST,
    citations: [citation()],
    steps: [
      {
        stepIndex: 0,
        summary: "ranked candidate explanations by evidence fit",
        consumes: ["evidence:obs-1"],
        produces: ["hyp:h1"],
      },
    ],
    assumptions: [],
    alternatives: ["hyp:h2"],
    conclusion: "the supported explanation is hypothesis h1",
    confidence: confidence(),
    producedAt: RECORDED_AT,
    ...overrides,
  };
}

/** Forged runtime value that a typed caller could never construct. */
function forged<T>(value: unknown): T {
  return value as T;
}

/* ─────────────────────────────────────────────────────────────
 * FINDINGS registry — attacks that SUCCEEDED against the module
 * (recorded precisely; module is READ-ONLY for this mission)
 * ────────────────────────────────────────────────────────────*/

interface VerificationFinding {
  readonly id: string;
  readonly attackClass: string;
  readonly severity: "low" | "medium" | "high";
  readonly title: string;
  readonly observed: string;
}

const FINDINGS: readonly VerificationFinding[] = [
  {
    id: "F-072-01",
    attackClass: "gate bypass",
    severity: "medium",
    title: "cognitionGate is non-total: a forged impact tier yields no typed denial",
    observed:
      "cognitionGate switch covers only the four declared tiers. A runtime-forged tier (any string outside the enum — e.g. \"LOW\", \"critical \") matches no case and the function returns undefined instead of a typed non-ALLOW decision. The gate is the §16 policy boundary and untrusted JSON crosses it; a non-total gate fails by crash-or-absorption rather than by typed denial.",
  },
  {
    id: "F-072-02",
    attackClass: "gate bypass",
    severity: "medium",
    title: "duplicate verifiedModels entries satisfy the multi-model minimum",
    observed:
      "cognitionGate counts verifiedModels by array length (models.length < HIGH_MIN_MODELS) without deduplicating modelRefs. One model listed twice satisfies the ≥2-model requirement at high impact (and, with an approvalRef, at critical impact), so single-model cognition can present itself as multi-model verification.",
  },
  {
    id: "F-072-03",
    attackClass: "hallucination-label bypass",
    severity: "medium",
    title: "reviseBelief admits zero-citation beliefs into world models",
    observed:
      "beliefSchema accepts citations: [] and reviseBelief never consults verification: a belief with no evidence citations — the exact hallucination-risk signal verifyCognitiveOutput flags as 'unsupported' for outputs — is accepted into a tenant's world model and becomes premises for later revision.",
  },
  {
    id: "F-072-04",
    attackClass: "tenant/actor boundary in belief revision",
    severity: "medium",
    title: "confidence-downgrade escalation is enforced only against actorKind 'agent' and is bypassed by claiming a different kind",
    observed:
      "reviseBelief refuses an agent-authored confidence downgrade (contested cognition must escalate) but applies that check only when incoming.provenance.actorKind === 'agent'. The same downgrade authored under actorKind 'service' is accepted. Provenance is caller-supplied and the contract verifies nothing about the claim, so the escalation invariant reduces to an unverified string on the revision itself.",
  },
  {
    id: "F-072-05",
    attackClass: "cardinality/oversize",
    severity: "low",
    title: "free-text fields are unbounded despite the module's no-unbounded-artifacts law",
    observed:
      "identifier and digest fields are tightly bounded, but every nonEmptyString free-text field (operation.objective, output.statement/belief.statement, confidence.method, uncertainty.rationale, trace.conclusion, step.summary, provenance.policyRef, assumption fields) accepts arbitrarily large payloads. A megabyte-scale 'summary' parses cleanly, contradicting the bounds section's stated law and enabling unbounded-artifact construction through otherwise governed surfaces.",
  },
];

describe("FINDINGS registry integrity (G-072 verdict discipline)", () => {
  it("records every successful attack with a unique id and a precise observation", () => {
    const ids = FINDINGS.map((finding) => finding.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const finding of FINDINGS) {
      expect(finding.id).toMatch(/^F-072-\d{2}$/);
      expect(finding.title.length).toBeGreaterThan(0);
      expect(finding.observed.length).toBeGreaterThan(0);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 1. Schema-forgery attempts
 * ────────────────────────────────────────────────────────────*/

describe("attack 1: schema forgery", () => {
  it("rejects forged evidence digests (case, length, alphabet) with typed issues", () => {
    for (const forgedDigest of [
      "A".repeat(64),
      "a".repeat(63),
      "a".repeat(65),
      "g".repeat(64),
      `${DIGEST.slice(0, 63)}G`,
      "",
    ]) {
      const parsed = evidenceCitationSchema.safeParse(citation({ digest: forgedDigest }));
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects forged identifiers: leading punctuation, whitespace, injection characters, overlength", () => {
    for (const forgedId of [
      "-leading-dash",
      ".dot-leading",
      "has space",
      "tab\tinjected",
      "newline\ninjected",
      "semi;colon",
      "quote\"injected",
      "a".repeat(129),
      "",
    ]) {
      const parsed = evidenceCitationSchema.safeParse(citation({ evidenceId: forgedId }));
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects forged operation vocabularies through the parse boundary", () => {
    const parsed = parseCognitiveOperation(
      validOperation(
        forged<Partial<CognitiveOperation>>({
          state: forged<CognitiveOperation["state"]>("OMNISCIENT"),
          strategy: forged<CognitiveOperation["strategy"]>("vibes"),
          operationType: forged<CognitiveOperation["operationType"]>("ransack"),
        }),
      ),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("invalid_shape");
      expect(parsed.issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("rejects forged datetimes: non-dates, local times, non-UTC offsets", () => {
    for (const forgedAt of ["not-a-date", "2026-10-03", "2026-10-03T00:00:00", "2026-10-03T00:00:00+01:00", ""]) {
      const parsed = cognitiveProvenanceSchema.safeParse(provenance({ recordedAt: forgedAt }));
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects unknown-key forgery on every strict artifact surface", () => {
    const attack = (key: string, value: unknown) => ({ [key]: value });
    expect(
      cognitiveOperationSchema.safeParse({ ...validOperation(), ...attack("adminBypass", true) }).success,
    ).toBe(false);
    expect(
      cognitiveOutputSchema.safeParse({ ...validOutput(), ...attack("canonical", true) }).success,
    ).toBe(false);
    expect(worldModelSchema.safeParse({ ...worldModel(), ...attack("crossTenant", "*") }).success).toBe(false);
    const forgedHypothesis = {
      hypothesisId: "hyp:h1",
      operationId: "op:1",
      statement: "statement",
      state: "GENERATED" as const,
      confidence: confidence(),
      citations: [],
      invalidationCondition: "contradicted by a verified observation",
      provenance: provenance(),
      selfApproved: true,
    };
    expect(hypothesisSchema.safeParse(forgedHypothesis).success).toBe(false);
    expect(ensembleResponseSchema.safeParse({ ...attack("modelRef", "model:a") }).success).toBe(false);
  });

  it("rejects type forgery: scalars, arrays and nulls where structured objects are required", () => {
    expect(cognitiveProvenanceSchema.safeParse("I am definitely provenance").success).toBe(false);
    expect(cognitiveProvenanceSchema.safeParse(["agent:cognition-worker-1"]).success).toBe(false);
    expect(cognitiveProvenanceSchema.safeParse(null).success).toBe(false);
    expect(confidenceSchema.safeParse(0.72).success).toBe(false);
    expect(uncertaintyEstimateSchema.safeParse({ kind: "epistemic" }).success).toBe(false);
  });

  it("parse boundaries convert arbitrary attacker garbage into typed denials, never throws", () => {
    for (const garbage of [null, undefined, 42, "output:1", [], true]) {
      const outputAttack = parseCognitiveOutput(garbage);
      const operationAttack = parseCognitiveOperation(garbage);
      const traceAttack = parseReasoningTrace(garbage);
      expect(outputAttack.ok).toBe(false);
      expect(operationAttack.ok).toBe(false);
      expect(traceAttack.ok).toBe(false);
      if (!outputAttack.ok) expect(outputAttack.reason).toBe("invalid_shape");
      if (!operationAttack.ok) expect(operationAttack.reason).toBe("invalid_shape");
      if (!traceAttack.ok) expect(traceAttack.reason).toBe("invalid_shape");
    }
  });

  it("does not leak partial artifacts from a forged composite — a failed parse yields no value", () => {
    const parsed = parseCognitiveOutput({ ...validOutput(), provenance: undefined });
    expect(parsed.ok).toBe(false);
    // Type-level guarantee asserted at runtime shape: no `value` key on failure.
    if (!parsed.ok) expect("value" in parsed).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Provenance bypass attempts
 * ────────────────────────────────────────────────────────────*/

describe("attack 2: provenance bypass", () => {
  it("rejects anonymous operations — no provenance, no cognition", () => {
    const anonymous = { ...validOperation(), provenance: undefined };
    const parsed = parseCognitiveOperation(anonymous);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("invalid_shape");
      expect(parsed.issues.some((issue) => issue.path.includes("provenance"))).toBe(true);
    }
  });

  it("rejects blank or whitespace policy refs — 'under which policy' must be answered", () => {
    for (const policyRef of ["", "   ", "\t\n"]) {
      const parsed = cognitiveProvenanceSchema.safeParse(provenance({ policyRef }));
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects a forged trace identifier with control characters", () => {
    const parsed = cognitiveProvenanceSchema.safeParse(
      provenance({ traceId: "trace:op-1\nX-Injected: true" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects tenant forgery with whitespace or illegal characters", () => {
    for (const tenantId of [" tenant_a", "tenant_a ", "tenant a", "tenant_a; DROP", "tenant/*a*/"]) {
      expect(cognitiveProvenanceSchema.safeParse(provenance({ tenantId })).success).toBe(false);
    }
  });

  it("rejects self-signed provenance — an attacker-supplied extra field cannot smuggle authority", () => {
    const selfSigned = {
      ...provenance(),
      signature: "self-attested-by-requester",
    };
    expect(cognitiveProvenanceSchema.safeParse(selfSigned).success).toBe(false);

    const strippedActor = { ...provenance() } as AttackObject;
    delete strippedActor.actorId;
    expect(cognitiveProvenanceSchema.safeParse(strippedActor).success).toBe(false);
  });

  it("rejects provenance supplied as an opaque string (e.g. encoded JSON)", () => {
    expect(cognitiveProvenanceSchema.safeParse(JSON.stringify(provenance())).success).toBe(false);
  });

  it("rejects a forged actorKind outside the identity module's kind split", () => {
    const parsed = cognitiveProvenanceSchema.safeParse(
      provenance(forged<Partial<CognitiveProvenance>>({ actorKind: forged<"agent">("superuser") })),
    );
    expect(parsed.success).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Chain-of-thought key smuggling at nested depths
 * ────────────────────────────────────────────────────────────*/

describe("attack 3: chain-of-thought key smuggling at depth", () => {
  const MARKERS = [
    "chainOfThought",
    "chain_of_thought",
    "chain-of-thought",
    "chain of thought",
    "CHAIN_OF_THOUGHT",
    "internalMonologue",
    "internal_monologue",
    "rawThought",
    "raw_thought",
    "scratchpad",
    "SCRATCHPAD",
    "agent_scratchpad",
  ];

  it("fails closed with reason chain_of_thought_exposure for every marker key shape at the top level", () => {
    for (const key of MARKERS) {
      const parsed = parseReasoningTrace(traceInput({ [key]: "private reasoning text" }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("chain_of_thought_exposure");
    }
  });

  it("detects marker keys nested inside a reasoning step", () => {
    const parsed = parseReasoningTrace(
      traceInput({
        steps: [
          {
            stepIndex: 0,
            summary: "ranked candidates",
            consumes: [],
            produces: [],
            chainOfThought: "hidden deliberation",
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("chain_of_thought_exposure");
      expect(parsed.issues[0].path).toContain("steps[0]");
      expect(parsed.issues[0].path).toContain("chainOfThought");
    }
  });

  it("detects marker keys at multi-level object depth", () => {
    const parsed = parseReasoningTrace(
      traceInput({
        metadata: {
          level2: { level3: { level4: { raw_thought: "hidden" } } },
        },
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("chain_of_thought_exposure");
  });

  it("detects marker keys inside nested arrays and arrays-of-arrays", () => {
    const inArrayOfArrays = parseReasoningTrace(
      traceInput({
        attachments: [[{ "chain of thought": "hidden" }]],
      }),
    );
    expect(inArrayOfArrays.ok).toBe(false);
    if (!inArrayOfArrays.ok) expect(inArrayOfArrays.reason).toBe("chain_of_thought_exposure");

    const inCitations = parseReasoningTrace(
      traceInput({
        citations: [citation(), { ...citation(), evidenceId: "evidence:obs-2", scratchpad: "hidden" }],
      }),
    );
    expect(inCitations.ok).toBe(false);
    if (!inCitations.ok) expect(inCitations.reason).toBe("chain_of_thought_exposure");
  });

  it("reports every smuggled marker path, not only the first", () => {
    const parsed = parseReasoningTrace(
      traceInput({
        scratchpad: "a",
        steps: [{ stepIndex: 0, summary: "s", consumes: [], produces: [], internal_monologue: "b" }],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues.length).toBe(2);
      expect(parsed.issues.map((issue) => issue.path).join("|")).toContain("scratchpad");
      expect(parsed.issues.map((issue) => issue.path).join("|")).toContain("internal_monologue");
    }
  });

  it("CONTAINED: a double-separator variant the marker scan misses is still denied by the strict schema", () => {
    // "chain__of__thought" defeats the single-separator marker pattern, so it
    // is not reported as chain_of_thought_exposure. Containment still holds:
    // the strict artifact surfaces reject the unknown key with a typed denial.
    const parsed = parseReasoningTrace(
      traceInput({
        steps: [
          { stepIndex: 0, summary: "s", consumes: [], produces: [], chain__of__thought: "hidden" },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });

  it("CONTAINED: smuggling marker keys into outputs and operations is denied by their strict schemas", () => {
    const outputAttack = parseCognitiveOutput({
      ...validOutput(),
      reasoning_chain: "hidden", // not a declared marker, still unknown key
    });
    expect(outputAttack.ok).toBe(false);
    if (!outputAttack.ok) expect(outputAttack.reason).toBe("invalid_shape");

    const operationAttack = parseCognitiveOperation({
      ...validOperation(),
      scratchpad: "hidden",
    });
    expect(operationAttack.ok).toBe(false);
    if (!operationAttack.ok) expect(operationAttack.reason).toBe("invalid_shape");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Cognition-gate bypass attempts
 * ────────────────────────────────────────────────────────────*/

describe("attack 4: cognition-gate bypass (missing safeguards)", () => {
  it("DENIES medium impact when validation evidence is absent", () => {
    const denied = cognitionGate("medium", {});
    expect(denied.decision).toBe("DENY");
    if (denied.decision === "DENY") expect(denied.reason).toMatch(/validation/i);
  });

  it("DENIES high impact outright when validation evidence is absent — missing evidence cannot be absorbed", () => {
    const denied = cognitionGate("high", {});
    expect(denied.decision).toBe("DENY");
  });

  it("ESCALATES high impact with validation but no multi-model verification", () => {
    expect(cognitionGate("high", { validationRef: "validation:v1" }).decision).toBe("ESCALATE");
    const oneModel = cognitionGate("high", {
      validationRef: "validation:v1",
      verifiedModels: ["model:a"],
    });
    expect(oneModel.decision).toBe("ESCALATE");
    const emptyModels = cognitionGate("high", {
      validationRef: "validation:v1",
      verifiedModels: [],
    });
    expect(emptyModels.decision).toBe("ESCALATE");
  });

  it("REQUIRE_APPROVAL for critical impact even with validation and multi-model verification", () => {
    const result = cognitionGate("critical", {
      validationRef: "validation:v1",
      verifiedModels: ["model:a", "model:b"],
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
  });

  it("DENIES critical impact when every safeguard is missing — no partial-evidence allowance", () => {
    const denied = cognitionGate("critical", {});
    expect(denied.decision).toBe("DENY");
    expect(cognitionGate("critical", { verifiedModels: ["model:a", "model:b"] }).decision).toBe("DENY");
    expect(
      cognitionGate("critical", { validationRef: "validation:v1", approvalRef: "approval:ap1" }).decision,
    ).not.toBe("ALLOW");
  });

  it("model authority alone can never approve critical cognition", () => {
    const result = cognitionGate("critical", {
      validationRef: "validation:v1",
      verifiedModels: ["model:a", "model:b", "model:c", "model:d"],
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
  });

  it("FINDING F-072-01: a forged impact tier returns no decision at all (non-total gate)", () => {
    const forgedTier = forged<CognitiveImpactTier>("LOW");
    const result: unknown = cognitionGate(forgedTier, {});
    // Observed: the switch matches no case and falls through — no typed
    // non-ALLOW denial is emitted. Recorded as F-072-01; module not fixed here.
    expect(result).toBeUndefined();
  });

  it("FINDING F-072-02: duplicate modelRefs satisfy the multi-model minimum", () => {
    const result = cognitionGate("high", {
      validationRef: "validation:v1",
      verifiedModels: ["model:a", "model:a"],
    });
    // Observed: ALLOW from a single distinct model. Recorded as F-072-02.
    expect(result.decision).toBe("ALLOW");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Tenant-boundary bypass in belief revision
 * ────────────────────────────────────────────────────────────*/

describe("attack 5: tenant-boundary bypass in belief revision", () => {
  it("refuses a cross-tenant revision with a typed tenant reason", () => {
    const foreign = belief({
      provenance: provenance({ tenantId: "tenant_b" }),
      confidence: confidence({ value: 0.99 }),
    });
    const verdict = reviseBelief(worldModel(), foreign);
    expect(verdict.accepted).toBe(false);
    if (!verdict.accepted) expect(verdict.reason).toMatch(/tenant/i);
  });

  it("refuses a revision that only differs from the model tenant by case — exact-match, no normalization bypass", () => {
    const cased = belief({ provenance: provenance({ tenantId: "Tenant_A" }) });
    const verdict = reviseBelief(worldModel(), cased);
    expect(verdict.accepted).toBe(false);
  });

  it("refuses canonical-labelled impostors at the revision boundary (§9 re-assertion)", () => {
    const impostor = belief({ derivation: forged<Belief["derivation"]>("canonical") });
    const unlabelled = { ...belief() } as AttackObject;
    delete unlabelled.derivation;
    const unlabelledBelief = forged<Belief>(unlabelled);

    expect(reviseBelief(worldModel(), impostor).accepted).toBe(false);
    expect(reviseBelief(worldModel(), unlabelledBelief).accepted).toBe(false);
  });

  it("refuses an agent-authored confidence downgrade — contested cognition escalates", () => {
    const downgrade = belief({ confidence: confidence({ value: 0.01 }) });
    const verdict = reviseBelief(worldModel(), downgrade);
    expect(verdict.accepted).toBe(false);
    if (!verdict.accepted) expect(verdict.reason).toMatch(/contested|escalate/i);
  });

  it("FINDING F-072-04: the downgrade escalation is bypassed by claiming actorKind 'service'", () => {
    const spoofed = belief({
      confidence: confidence({ value: 0.01 }),
      provenance: provenance({ actorKind: "service", actorId: "svc:supposedly-neutral" }),
    });
    const verdict = reviseBelief(worldModel(), spoofed);
    // Observed: accepted — the escalation check fires only for 'agent'.
    // Recorded as F-072-04; module not fixed here.
    expect(verdict.accepted).toBe(true);
  });

  it("the 'human' oversight channel remains the only legitimate downgrade path (contrast with F-072-04)", () => {
    const humanCorrection = belief({
      confidence: confidence({ value: 0.01 }),
      provenance: provenance({ actorKind: "human", actorId: "human:overseer-1" }),
    });
    expect(reviseBelief(worldModel(), humanCorrection).accepted).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Hallucination-label bypass
 * ────────────────────────────────────────────────────────────*/

describe("attack 6: hallucination-label bypass", () => {
  it("flags an uncited output as unsupported with a typed hallucination reason", () => {
    const verdict = verifyCognitiveOutput(validOutput({ citations: [] }));
    expect(verdict.status).toBe("unsupported");
    if (verdict.status === "unsupported") expect(verdict.reason).toMatch(/hallucination/i);
  });

  it("refutation outranks maximal confidence — no confidence-based escape from 'refuted'", () => {
    const confident = validOutput({ confidence: confidence({ value: 1 }) });
    const verdict = verifyCognitiveOutput(confident, ["out:1"]);
    expect(verdict.status).toBe("refuted");
  });

  it("refuses label forgery variants on outputs and beliefs", () => {
    for (const forgedLabel of ["canonical", "verified", "ground_truth", "DERIVED", "derived "]) {
      expect(
        cognitiveOutputSchema.safeParse(forged<CognitiveOutput>({ ...validOutput(), derivation: forgedLabel }))
          .success,
      ).toBe(false);
      expect(
        worldModelSchema.safeParse(
          worldModel([forged<Belief>({ ...belief(), derivation: forgedLabel })]),
        ).success,
      ).toBe(false);
    }
    const unlabelled = validOutput() as AttackObject;
    delete unlabelled.derivation;
    expect(cognitiveOutputSchema.safeParse(unlabelled).success).toBe(false);
  });

  it("a parsed-but-unverified output cannot self-certify — verification is a separate typed act", () => {
    const parsed = parseCognitiveOutput(validOutput({ citations: [] }));
    expect(parsed.ok).toBe(true); // born UNVERIFIED by design
    if (parsed.ok) {
      const verdict = verifyCognitiveOutput(parsed.value);
      expect(verdict.status).toBe("unsupported");
    }
  });

  it("FINDING F-072-03: a zero-citation belief is admitted into a world model without verification", () => {
    const hallucinated = belief({ citations: [] });
    const verdict = reviseBelief(worldModel(), hallucinated);
    // Observed: accepted — no verification gate at the revision boundary.
    // Recorded as F-072-03; module not fixed here.
    expect(verdict.accepted).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Cardinality / oversize attacks
 * ────────────────────────────────────────────────────────────*/

describe("attack 7: cardinality and oversize attacks", () => {
  const many = <T>(item: (index: number) => T, count: number): T[] =>
    Array.from({ length: count }, (_, index) => item(index));

  it("citations: MAX_CITATIONS accepted, one past rejected", () => {
    const at = validOutput({ citations: many((i) => citation({ evidenceId: `evidence:c-${i}` }), MAX_CITATIONS) });
    expect(parseCognitiveOutput(at).ok).toBe(true);
    const over = validOutput({
      citations: many((i) => citation({ evidenceId: `evidence:c-${i}` }), MAX_CITATIONS + 1),
    });
    const parsed = parseCognitiveOutput(over);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.some((issue) => issue.path.includes("citations"))).toBe(true);
  });

  it("trace steps: MAX_TRACE_STEPS accepted, one past rejected with a typed issue", () => {
    const step = (i: number) => ({ stepIndex: i, summary: "step", consumes: [], produces: [] });
    expect(parseReasoningTrace(traceInput({ steps: many(step, MAX_TRACE_STEPS) })).ok).toBe(true);
    const over = parseReasoningTrace(traceInput({ steps: many(step, MAX_TRACE_STEPS + 1) }));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.issues.some((issue) => issue.path.includes("steps"))).toBe(true);
  });

  it("assumptions: MAX_ASSUMPTIONS accepted, one past rejected", () => {
    const assumption = (i: number) => ({
      assumptionId: `assumption:a-${i}`,
      statement: "assumption",
      source: "derived from evidence:obs-1",
      confidence: confidence(),
      impact: "low" as const,
      validated: false,
      invalidationCondition: "contradicted by a verified observation",
    });
    expect(
      parseCognitiveOperation(validOperation({ assumptions: many(assumption, MAX_ASSUMPTIONS) })).ok,
    ).toBe(true);
    expect(
      parseCognitiveOperation(validOperation({ assumptions: many(assumption, MAX_ASSUMPTIONS + 1) })).ok,
    ).toBe(false);
  });

  it("alternatives: MAX_HYPOTHESES accepted, one past rejected", () => {
    expect(
      parseReasoningTrace(traceInput({ alternatives: many((i) => `hyp:h-${i}`, MAX_HYPOTHESES) })).ok,
    ).toBe(true);
    expect(
      parseReasoningTrace(traceInput({ alternatives: many((i) => `hyp:h-${i}`, MAX_HYPOTHESES + 1) })).ok,
    ).toBe(false);
  });

  it("verified models: MAX_ENSEMBLE_RESPONSES accepted, one past rejected by the safeguard schema", () => {
    const models = (count: number) => many((i) => `model:m-${i}`, count);
    expect(
      safeguardEvidenceSchema.safeParse({ verifiedModels: models(MAX_ENSEMBLE_RESPONSES) }).success,
    ).toBe(true);
    expect(
      safeguardEvidenceSchema.safeParse({ verifiedModels: models(MAX_ENSEMBLE_RESPONSES + 1) }).success,
    ).toBe(false);
  });

  it("beliefs: MAX_BELIEFS accepted, one past rejected — no unbounded world model", () => {
    expect(
      worldModelSchema.safeParse(worldModel(many((i) => belief({ beliefId: `belief:b-${i}` }), MAX_BELIEFS)))
        .success,
    ).toBe(true);
    expect(
      worldModelSchema.safeParse(
        worldModel(many((i) => belief({ beliefId: `belief:b-${i}` }), MAX_BELIEFS + 1)),
      ).success,
    ).toBe(false);
  });

  it("uncertainties: 16 accepted, one past rejected", () => {
    const uncertainty = (i: number) => ({
      kind: "epistemic" as const,
      degree: 0.1,
      rationale: `uncertainty ${i}`,
    });
    expect(
      cognitiveOutputSchema.safeParse(validOutput({ uncertainties: many(uncertainty, 16) })).success,
    ).toBe(true);
    expect(
      cognitiveOutputSchema.safeParse(validOutput({ uncertainties: many(uncertainty, 17) })).success,
    ).toBe(false);
  });

  it("FINDING F-072-05: megabyte-scale free text parses cleanly — unbounded string fields", () => {
    const oversized = "A".repeat(1_000_000);
    const attackOutput = parseCognitiveOutput(
      validOutput({ statement: oversized, confidence: confidence({ method: oversized }) }),
    );
    // Observed: accepted — free-text fields carry no ceiling. Recorded as
    // F-072-05; module not fixed here.
    expect(attackOutput.ok).toBe(true);

    const attackOperation = parseCognitiveOperation(validOperation({ objective: oversized }));
    expect(attackOperation.ok).toBe(true);
  });

  it("contrast: identifier and digest fields stay bounded even as free text does not", () => {
    const oversizedId = `out:${"a".repeat(200)}`;
    const parsed = cognitiveOutputSchema.safeParse(validOutput({ outputId: oversizedId }));
    expect(parsed.success).toBe(false);
  });

  it("the declared cognitive state vocabulary is intact — no forged state broadens the operation surface", () => {
    expect(COGNITIVE_STATES).toHaveLength(16);
    expect(COGNITIVE_STATES).not.toContain("OMNISCIENT");
  });
});
