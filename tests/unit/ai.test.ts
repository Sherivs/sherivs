// ─── Phase 26 — AI Intelligence Layer ─────────────────────────
import { describe, it, expect } from "vitest";
import {
  createAiRequest,
  aiContextGrantsPermissions,
  isTenantBoundarySatisfied,
  registerModel,
  routeModel,
  selectModelFallback,
  escalateModelCascade,
  evaluateModelHealth,
  aiRequestId,
  aiModelId,
} from "@/lib/ai-core";
import {
  registerPrompt,
  composePrompt,
  classifyContextTrust,
  isTrustedSystemSource,
  isSourceRetrievable,
  filterRetrievalByAuthorization,
  isResponseGrounded,
  buildEvidencePacket,
  detectKnowledgeConflict,
  isKnowledgeSourceFresh,
  evaluateTemporalClaim,
  fitsContextBudget,
  prioritizeContext,
  detectContextCollision,
  compressContext,
  aiPromptId,
  aiEvidenceId,
  aiRetrievalResultId,
} from "@/lib/ai-context";
import {
  createReasoningTrace,
  buildExplanation,
  estimateUncertainty,
  calibrationError,
  verifyClaim,
  detectHallucination,
  evaluateConsensus,
  multiModelVerify,
  reasoningTraceId,
  claimId,
  explanationId,
} from "@/lib/ai-reasoning";
import {
  classifyAiRisk,
  evaluateHighRiskGate,
  createAiDecisionRecord,
  shouldEscalate,
  consumeAiBudget,
  consumeAiQuota,
  priorityWeight,
  canReuseCachedResult,
  recordCircuitFailure,
  isCircuitOpen,
  resolvePolicyPrecedence,
  hasConsent,
  allowsUnsupervisedSelfModification,
  isLearningDeploymentPermitted,
  evaluateAiOutput,
  isModelPromotable,
  canAdvanceReleaseStage,
  canaryWithinLimit,
  disableAiCapability,
  isAiCapabilityEnabled,
  sanitizeAiTelemetry,
  aiDecisionId,
  aiEvaluationId,
  aiBudgetId,
  type CircuitBreakerState,
} from "@/lib/ai-governance";
import {
  registerAiCapability,
  registerAiSkill,
  validateStructuredOutput,
  moderateGeneratedContent,
  applyAgeAwareProtection,
  recordDocumentExtraction,
  isExtractionConfident,
  isLanguageSupported,
  requiresTranslationReview,
  createAiPipeline,
  isPipelineDagValid,
  isAgentModelRequestSatisfiable,
  aiCapabilityId,
  aiSkillId,
  aiPipelineId,
} from "@/lib/ai-services";
import type { TenantId } from "@/lib/tenant-core";
import type { AiModelDefinition, AiModelId } from "@/lib/ai-core";
import type { AiPipelineStage } from "@/lib/ai-services";

const TENANT = "tenant-a" as TenantId;
const OTHER = "tenant-b" as TenantId;

function makeModel(overrides: Partial<AiModelDefinition> = {}): AiModelDefinition {
  return {
    id: aiModelId("model-1"),
    provider: "test",
    name: "Test Model",
    version: "1.0",
    capabilities: ["generation"],
    contextWindowTokens: 8000,
    modalities: ["text"],
    costRank: 50,
    latencyRank: 50,
    reliability: 0.95,
    retainsInputs: false,
    trainsOnInputs: false,
    dataPolicyRef: "policy-1",
    jurisdiction: "US",
    deploymentLocation: "centralized_cloud",
    supplyChainVerified: true,
    approvedForProduction: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ai-core — Request Model & Boundaries (7, 9, 10, 11)", () => {
  it("creates AI request with explicit tenant/purpose/permissions", () => {
    const r = createAiRequest({
      id: aiRequestId("req-1"),
      tenantId: TENANT,
      requesterRef: "id-1",
      roleRef: "teacher",
      permissions: ["student.read"],
      domain: "education",
      purpose: "Summarize class progress",
      outputType: "text",
    });
    expect(r.correlationId).toBeTruthy();
    expect(r.riskLevel).toBe("low");
  });
  it("rejects request without tenant", () => {
    expect(() =>
      createAiRequest({
        id: aiRequestId("req-2"),
        tenantId: "" as TenantId,
        requesterRef: "id-1",
        roleRef: "teacher",
        permissions: ["x"],
        domain: "e",
        purpose: "p",
        outputType: "text",
      }),
    ).toThrow();
  });
  it("rejects request without purpose", () => {
    expect(() =>
      createAiRequest({
        id: aiRequestId("req-3"),
        tenantId: TENANT,
        requesterRef: "id-1",
        roleRef: "teacher",
        permissions: ["x"],
        domain: "e",
        purpose: "",
        outputType: "text",
      }),
    ).toThrow();
  });
  it("rejects request without permissions", () => {
    expect(() =>
      createAiRequest({
        id: aiRequestId("req-4"),
        tenantId: TENANT,
        requesterRef: "id-1",
        roleRef: "teacher",
        permissions: [],
        domain: "e",
        purpose: "p",
        outputType: "text",
      }),
    ).toThrow();
  });
  it("context never grants permissions", () => {
    expect(aiContextGrantsPermissions()).toBe(false);
  });
  it("enforces tenant boundary", () => {
    const r = createAiRequest({
      id: aiRequestId("req-5"),
      tenantId: TENANT,
      requesterRef: "id-1",
      roleRef: "teacher",
      permissions: ["x"],
      domain: "e",
      purpose: "p",
      outputType: "text",
    });
    expect(isTenantBoundarySatisfied(r, TENANT)).toBe(true);
    expect(isTenantBoundarySatisfied(r, OTHER)).toBe(false);
  });
});

describe("ai-core — Model Registry & Routing (13, 14, 15, 16, 17, 18, 19)", () => {
  it("registers model", () => {
    const r = registerModel({
      id: aiModelId("m1"),
      provider: "core",
      name: "Tiny",
      version: "1.0",
      capabilities: ["generation"],
      contextWindowTokens: 4000,
      supplyChainVerified: true,
    });
    expect(r.ok).toBe(true);
  });
  it("rejects model without version", () => {
    expect(
      registerModel({
        id: aiModelId("m2"),
        provider: "core",
        name: "X",
        version: "",
        capabilities: ["generation"],
        contextWindowTokens: 4000,
      }).ok,
    ).toBe(false);
  });
  it("rejects model without capabilities", () => {
    expect(
      registerModel({
        id: aiModelId("m3"),
        provider: "core",
        name: "X",
        version: "1",
        capabilities: [],
        contextWindowTokens: 4000,
      }).ok,
    ).toBe(false);
  });
  it("routes to lowest latency model", () => {
    const fast = makeModel({ id: aiModelId("fast"), latencyRank: 10, costRank: 80 });
    const cheap = makeModel({ id: aiModelId("cheap"), latencyRank: 60, costRank: 10 });
    const chosen = routeModel({ task: "generation" }, [cheap, fast]);
    expect(chosen?.id).toBe("fast");
  });
  it("high-risk routing requires production-approved verified models", () => {
    const unapproved = makeModel({ id: aiModelId("u1"), approvedForProduction: false });
    expect(routeModel({ task: "generation", riskLevel: "high" }, [unapproved])).toBeNull();
    const approved = makeModel({
      id: aiModelId("a1"),
      approvedForProduction: true,
      supplyChainVerified: true,
    });
    expect(routeModel({ task: "generation", riskLevel: "high" }, [approved])).not.toBeNull();
  });
  it("selects approved fallback", () => {
    const a = makeModel({ id: aiModelId("a"), latencyRank: 10 });
    const b = makeModel({ id: aiModelId("b"), latencyRank: 20 });
    expect(selectModelFallback(a.id, [a, b])?.id).toBe("b");
  });
  it("escalates cascade on evaluation failure", () => {
    const small = makeModel({ id: aiModelId("s"), contextWindowTokens: 4000 });
    const large = makeModel({ id: aiModelId("l"), contextWindowTokens: 16000 });
    expect(escalateModelCascade(small, [small, large], true)?.id).toBe("l");
    expect(escalateModelCascade(small, [small, large], false)?.id).toBe("s");
  });
  it("evaluates model health", () => {
    const good = evaluateModelHealth({
      modelId: aiModelId("h"),
      availability: 0.99,
      errorRate: 0.01,
      p95LatencyMs: 800,
      hallucinationRate: 0.02,
      safetyIncidentCount: 0,
    });
    expect(good.healthy).toBe(true);
    const bad = evaluateModelHealth({
      modelId: aiModelId("h"),
      availability: 0.99,
      errorRate: 0.2,
      p95LatencyMs: 800,
      hallucinationRate: 0.02,
      safetyIncidentCount: 0,
    });
    expect(bad.healthy).toBe(false);
  });
});

describe("ai-context — Prompts & Trust (21, 22, 23, 24, 25)", () => {
  it("registers prompt as versioned artifact", () => {
    const r = registerPrompt({
      id: aiPromptId("p1"),
      ownerRef: "id-admin-1",
      name: "class-summary",
      purpose: "Summarize class progress",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prompt.version).toBe(1);
  });
  it("rejects prompt without owner", () => {
    expect(registerPrompt({ id: aiPromptId("p2"), ownerRef: "", name: "x", purpose: "y" }).ok).toBe(
      false,
    );
  });
  it("composes prompt with sections", () => {
    const p = composePrompt({
      systemInstructions: "Be safe",
      domainContext: "class",
      userRequest: "hi",
      policyConstraints: "no PII",
      retrievedEvidence: "evidence",
      toolDefinitions: "",
    });
    expect(p).toContain("SYSTEM:");
    expect(p).toContain("USER REQUEST:");
    expect(p).toContain("EVIDENCE:");
  });
  it("classifies context trust levels", () => {
    expect(classifyContextTrust("system_policy")).toBe("trusted");
    expect(classifyContextTrust("authorized_database_record")).toBe("trusted_data");
    expect(classifyContextTrust("user_input")).toBe("untrusted_instruction");
    expect(classifyContextTrust("external_document")).toBe("untrusted_content");
  });
  it("only trusted sources are system-safe", () => {
    expect(isTrustedSystemSource("trusted")).toBe(true);
    expect(isTrustedSystemSource("untrusted_content")).toBe(false);
  });
});

describe("ai-context — Retrieval & Grounding (26, 29, 30, 31, 32, 33, 34, 35)", () => {
  const src = {
    id: "src-1",
    tenantId: TENANT,
    kind: "record",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    effectiveDate: null,
    expiresAt: null,
    confidence: 0.9,
    authorizedDomains: ["education"],
  };
  it("source retrievable within authorized domain", () => {
    expect(isSourceRetrievable(src, TENANT, ["education"])).toBe(true);
    expect(isSourceRetrievable(src, OTHER, ["education"])).toBe(false);
    expect(isSourceRetrievable(src, TENANT, ["finance"])).toBe(false);
  });
  it("filters retrieval by authorization", () => {
    const results = [
      {
        id: aiRetrievalResultId("r1"),
        tenantId: TENANT,
        sourceRef: "src-1",
        documentRef: null,
        recordRef: null,
        timestamp: "2026-01-01",
        relevance: 0.9,
        method: "semantic" as const,
      },
    ];
    expect(filterRetrievalByAuthorization(results, [src], TENANT, ["education"])).toHaveLength(1);
    expect(filterRetrievalByAuthorization(results, [src], OTHER, ["education"])).toHaveLength(0);
  });
  it("response is grounded only with authorized confident source", () => {
    expect(isResponseGrounded(["src-1"], [src])).toBe(true);
    expect(isResponseGrounded([], [src])).toBe(false);
  });
  it("detects knowledge conflict across sources", () => {
    const e = [
      {
        sourceRef: "a",
        excerpt: "student attended class",
        timestamp: "2026-01-01",
        relevance: 0.9,
      },
      {
        sourceRef: "b",
        excerpt: "student did not attend class",
        timestamp: "2026-01-01",
        relevance: 0.9,
      },
    ];
    expect(detectKnowledgeConflict(e).hasConflict).toBe(true);
  });
  it("evaluates knowledge freshness", () => {
    const expired = { ...src, expiresAt: "2025-01-01T00:00:00.000Z" };
    expect(isKnowledgeSourceFresh(expired, "2026-01-01T00:00:00.000Z")).toBe(false);
    expect(isKnowledgeSourceFresh(src, "2026-01-01T00:00:00.000Z")).toBe(true);
  });
  it("evaluates temporal claims", () => {
    expect(
      evaluateTemporalClaim({
        claimAsOf: "2026-01-01T00:00:00.000Z",
        currentAsOf: "2026-01-02T00:00:00.000Z",
      }).stale,
    ).toBe(false);
    expect(
      evaluateTemporalClaim({
        claimAsOf: "2026-01-01T00:00:00.000Z",
        currentAsOf: "2026-01-10T00:00:00.000Z",
      }).stale,
    ).toBe(true);
  });
});

describe("ai-context — Context Management (77, 78, 79, 80)", () => {
  it("fits context budget", () => {
    expect(fitsContextBudget({ totalTokens: 1000, usedTokens: 800 }, 250)).toBe(false);
    expect(fitsContextBudget({ totalTokens: 1000, usedTokens: 800 }, 150)).toBe(true);
  });
  it("prioritizes context within budget", () => {
    const pieces = [
      {
        id: "1",
        content: "policy",
        tokens: 100,
        authority: 1,
        relevance: 0.5,
        freshness: 1,
        priority: "policy" as const,
      },
      {
        id: "2",
        content: "noise",
        tokens: 500,
        authority: 0,
        relevance: 0,
        freshness: 0,
        priority: "user_request" as const,
      },
    ];
    const selected = prioritizeContext(pieces, 200);
    expect(selected.some((p) => p.id === "1")).toBe(true);
  });
  it("detects context collision", () => {
    const pieces = [
      {
        id: "1",
        content: "payment received",
        tokens: 10,
        authority: 1,
        relevance: 1,
        freshness: 1,
        priority: "authority" as const,
      },
      {
        id: "2",
        content: "payment not received",
        tokens: 10,
        authority: 1,
        relevance: 1,
        freshness: 1,
        priority: "authority" as const,
      },
    ];
    expect(detectContextCollision(pieces)).toBe(true);
  });
  it("compresses context preserving provenance", () => {
    const pieces = [
      {
        id: "1",
        content: "a",
        tokens: 800,
        authority: 1,
        relevance: 1,
        freshness: 1,
        priority: "authority" as const,
      },
      {
        id: "2",
        content: "b",
        tokens: 100,
        authority: 0,
        relevance: 0,
        freshness: 0,
        priority: "authority" as const,
      },
    ];
    const c = compressContext(pieces);
    expect(c.compressed).toBe(true);
    expect(c.compressedPieces.length).toBe(1);
  });
});

describe("ai-reasoning — Trace, Explanation, Uncertainty (39, 41, 42, 43, 44)", () => {
  it("creates reasoning trace without chain-of-thought", () => {
    const t = createReasoningTrace({
      id: reasoningTraceId("t1"),
      level: "multi_step",
      operations: ["decomposition"],
      decision: "recommend",
      outputRef: "out-1",
      confidence: 0.9,
    });
    expect(t.level).toBe("multi_step");
    expect(t.outputRef).toBe("out-1");
  });
  it("builds useful explanation", () => {
    const e = buildExplanation({
      id: explanationId("e1"),
      evidenceUsed: ["src-1"],
      recommendationRationale: "Evidence supports it",
    });
    expect(e.evidenceUsed).toContain("src-1");
  });
  it("estimates uncertainty", () => {
    const u = estimateUncertainty({
      confidence: 0.9,
      evidenceQuality: 0.8,
      sourceReliability: 0.8,
    });
    expect(u.uncertainty).toBeCloseTo(1 - 0.9 * 0.8 * 0.8);
  });
  it("measures calibration error", () => {
    const err = calibrationError([
      { statedConfidence: 1, correct: true },
      { statedConfidence: 1, correct: false },
    ]);
    expect(err).toBe(0.5);
  });
});

describe("ai-reasoning — Claims, Hallucination, Consensus (45, 46, 48, 49)", () => {
  it("verifies supported claim", () => {
    const c = verifyClaim({
      id: claimId("c1"),
      statement: "Student attended",
      evidenceRefs: ["src-1"],
      method: "retrieval_verification",
      verificationScore: 0.9,
    });
    expect(c.verification.supported).toBe(true);
  });
  it("rejects unsupported claim", () => {
    const c = verifyClaim({
      id: claimId("c2"),
      statement: "X",
      evidenceRefs: ["src-1"],
      method: "domain_rules",
      verificationScore: 0.3,
    });
    expect(c.verification.supported).toBe(false);
  });
  it("detects hallucination for uncited output", () => {
    const claim = verifyClaim({
      id: claimId("c3"),
      statement: "Z",
      evidenceRefs: [],
      method: "structured_validation",
      verificationScore: 0.9,
    });
    expect(detectHallucination({ claim, retrievableEvidenceRefs: [] }).suspected).toBe(true);
  });
  it("passes grounded verified claim", () => {
    const claim = verifyClaim({
      id: claimId("c4"),
      statement: "A",
      evidenceRefs: ["src-1"],
      method: "retrieval_verification",
      verificationScore: 0.9,
    });
    expect(detectHallucination({ claim, retrievableEvidenceRefs: ["src-1"] }).suspected).toBe(
      false,
    );
  });
  it("consensus escalates on disagreement", () => {
    const r = evaluateConsensus([
      { modelId: aiModelId("m1"), supports: true, confidence: 0.9 },
      { modelId: aiModelId("m2"), supports: false, confidence: 0.9 },
    ]);
    expect(r.unanimous).toBe(false);
    expect(r.escalate).toBe(true);
  });
  it("multi-model verification requires majority", () => {
    expect(
      multiModelVerify(
        [
          { modelId: aiModelId("m1"), supports: true, confidence: 0.9 },
          { modelId: aiModelId("m2"), supports: true, confidence: 0.9 },
          { modelId: aiModelId("m3"), supports: false, confidence: 0.9 },
        ],
        "majority",
      ).passed,
    ).toBe(true);
    expect(
      multiModelVerify(
        [
          { modelId: aiModelId("m1"), supports: true, confidence: 0.9 },
          { modelId: aiModelId("m2"), supports: false, confidence: 0.9 },
        ],
        "unanimous",
      ).passed,
    ).toBe(false);
  });
});

describe("ai-governance — Risk, Gate, HITL, Escalation (93, 94, 95, 96, 97)", () => {
  it("classifies risk", () => {
    expect(
      classifyAiRisk({
        impact: "informational",
        autonomy: "advisory",
        dataClassification: "PUBLIC",
      }),
    ).toBe("low");
    expect(
      classifyAiRisk({
        impact: "financial",
        autonomy: "autonomous",
        dataClassification: "CONFIDENTIAL",
      }),
    ).toBe("high");
    expect(
      classifyAiRisk({
        impact: "operational",
        autonomy: "irreversible",
        dataClassification: "PUBLIC",
      }),
    ).toBe("critical");
  });
  it("high-risk gate blocks without verification or approval", () => {
    expect(
      evaluateHighRiskGate({ riskLevel: "high", humanApproval: false, multiModelVerified: false })
        .allowed,
    ).toBe(false);
    expect(
      evaluateHighRiskGate({ riskLevel: "high", humanApproval: false, multiModelVerified: true })
        .allowed,
    ).toBe(true);
    expect(
      evaluateHighRiskGate({ riskLevel: "critical", humanApproval: true, multiModelVerified: true })
        .allowed,
    ).toBe(true);
    expect(
      evaluateHighRiskGate({
        riskLevel: "critical",
        humanApproval: false,
        multiModelVerified: true,
      }).allowed,
    ).toBe(false);
  });
  it("creates decision record", () => {
    const r = createAiDecisionRecord({
      id: aiDecisionId("d1"),
      tenantId: TENANT,
      requestId: aiRequestId("r1"),
      contextRef: "ctx-1",
      modelId: aiModelId("m1"),
      resultRef: "out-1",
      confidence: 0.9,
      policyDecision: "allow",
    });
    expect(r.approvalState).toBe("not_required");
  });
  it("escalates on low confidence or high risk", () => {
    expect(
      shouldEscalate({
        riskLevel: "low",
        confidence: 0.3,
        evidenceConflict: false,
        authorizationAmbiguous: false,
        policyUnclear: false,
      }),
    ).toBe(true);
    expect(
      shouldEscalate({
        riskLevel: "high",
        confidence: 0.9,
        evidenceConflict: false,
        authorizationAmbiguous: false,
        policyUnclear: false,
      }),
    ).toBe(true);
    expect(
      shouldEscalate({
        riskLevel: "low",
        confidence: 0.9,
        evidenceConflict: false,
        authorizationAmbiguous: false,
        policyUnclear: false,
      }),
    ).toBe(false);
  });
});

describe("ai-governance — Budgets, Quotas, Priority, Caching (102-107)", () => {
  it("consumes budget within limits", () => {
    const b = {
      id: aiBudgetId("b1"),
      tenantId: TENANT,
      monthlyTokens: 1000,
      monthlyCostMinorUnits: 1000,
      usedTokens: 800,
      usedCostMinorUnits: 0,
      monthRef: "2026-08",
    };
    expect(consumeAiBudget(b, 100, 10).ok).toBe(true);
    expect(consumeAiBudget(b, 300, 10).ok).toBe(false);
  });
  it("consumes quota", () => {
    const q = {
      scope: "user" as const,
      scopeRef: "id-1",
      requestLimit: 2,
      requestsUsed: 2,
      windowRef: "w",
    };
    expect(consumeAiQuota(q).ok).toBe(false);
    expect(consumeAiQuota({ ...q, requestsUsed: 1 }).ok).toBe(true);
  });
  it("prioritizes queues", () => {
    expect(priorityWeight("critical")).toBeGreaterThan(priorityWeight("normal"));
  });
  it("cached result reusable only within tenant/freshness/classification", () => {
    const cached = {
      key: "k",
      tenantId: TENANT,
      resultRef: "r",
      dataClassification: "CONFIDENTIAL" as const,
      createdAt: "2026-01-01",
      expiresAt: null,
    };
    expect(canReuseCachedResult({ cached, requesterTenantId: TENANT, now: "2026-01-02" })).toBe(
      true,
    );
    expect(canReuseCachedResult({ cached, requesterTenantId: OTHER, now: "2026-01-02" })).toBe(
      false,
    );
  });
  it("opens circuit breaker on repeated failures", () => {
    let s: CircuitBreakerState = {
      key: "k",
      failureCount: 0,
      failureThreshold: 3,
      openedAt: null,
      halfOpenAllowed: false,
    };
    s = recordCircuitFailure(s);
    s = recordCircuitFailure(s);
    s = recordCircuitFailure(s);
    expect(isCircuitOpen(s)).toBe(true);
    expect(s.openedAt).not.toBeNull();
  });
});

describe("ai-governance — Policy, Consent, Learning, Release (141-149, 120-134)", () => {
  it("resolves policy precedence restrictively", () => {
    expect(
      resolvePolicyPrecedence({ permissionsByLevel: { platform: "allow", tenant: "deny" } })
        .decision,
    ).toBe("deny");
    expect(
      resolvePolicyPrecedence({ permissionsByLevel: { platform: "allow", tenant: "allow" } })
        .decision,
    ).toBe("allow");
  });
  it("checks consent", () => {
    expect(
      hasConsent({
        tenantId: TENANT,
        identityRef: "id-1",
        capability: "vision",
        consented: true,
        consentedAt: "2026-01-01",
      }),
    ).toBe(true);
  });
  it("no unsupervised self-modification", () => {
    expect(allowsUnsupervisedSelfModification()).toBe(false);
  });
  it("safe learning requires all gates", () => {
    expect(
      isLearningDeploymentPermitted({
        evaluated: true,
        validated: true,
        approved: true,
        controlledDeployment: true,
      }),
    ).toBe(true);
    expect(
      isLearningDeploymentPermitted({
        evaluated: true,
        validated: true,
        approved: false,
        controlledDeployment: true,
      }),
    ).toBe(false);
  });
  it("promotes only when all gates pass", () => {
    const good = evaluateAiOutput({
      id: aiEvaluationId("e1"),
      datasetRef: "ds-1",
      modelId: aiModelId("m1"),
      correctness: 0.9,
      relevance: 0.9,
      groundedness: 0.9,
      safety: 0.9,
      consistency: 0.9,
    });
    expect(isModelPromotable(good)).toBe(true);
    const bad = evaluateAiOutput({
      id: aiEvaluationId("e2"),
      datasetRef: "ds-1",
      modelId: aiModelId("m1"),
      correctness: 0.5,
      relevance: 0.9,
      groundedness: 0.9,
      safety: 0.9,
      consistency: 0.9,
    });
    expect(isModelPromotable(bad)).toBe(false);
  });
  it("advances release stages one at a time", () => {
    expect(canAdvanceReleaseStage("evaluation", "safety_review")).toBe(true);
    expect(canAdvanceReleaseStage("evaluation", "production")).toBe(false);
  });
  it("enforces canary limits", () => {
    expect(canaryWithinLimit(0.05, 0.1)).toBe(true);
    expect(canaryWithinLimit(0.2, 0.1)).toBe(false);
  });
  it("kill switch disables capability independently", () => {
    const sw = { capabilityKey: "vision", disabled: false, disabledAt: null, disabledByRef: null };
    expect(isAiCapabilityEnabled(sw)).toBe(true);
    expect(isAiCapabilityEnabled(disableAiCapability(sw, "id-admin-1"))).toBe(false);
  });
  it("sanitizes telemetry", () => {
    const clean = sanitizeAiTelemetry({
      requestId: "r1",
      email: "a@b.c",
      studentName: "x",
      latencyMs: 120,
    });
    expect(clean.email).toBeUndefined();
    expect(clean.studentName).toBeUndefined();
    expect(clean.latencyMs).toBe(120);
  });
});

describe("ai-services — Registry, Contract, Moderation (84-92)", () => {
  it("registers capability and skill", () => {
    const cap = registerAiCapability({
      id: aiCapabilityId("cap-1"),
      tenantId: TENANT,
      key: "class-summary",
      capability: "generation",
      modelIds: [aiModelId("m1")],
    });
    expect(cap.isEnabled).toBe(false);
    const skill = registerAiSkill({
      id: aiSkillId("sk-1"),
      key: "summarization",
      name: "Summarization",
    });
    expect(skill.isActive).toBe(true);
  });
  it("validates structured output", () => {
    expect(
      validateStructuredOutput({
        value: { name: "A", score: 85 },
        requiredFields: ["name", "score"],
        numericRanges: { score: [0, 100] },
      }).status,
    ).toBe("valid");
    expect(
      validateStructuredOutput({
        value: { name: "A", score: 150 },
        requiredFields: ["name", "score"],
        numericRanges: { score: [0, 100] },
      }).status,
    ).toBe("invalid");
    expect(validateStructuredOutput({ value: {}, requiredFields: ["name"] }).status).toBe(
      "invalid",
    );
  });
  it("moderates generated content", () => {
    expect(moderateGeneratedContent({ signals: ["harmful_content"] }).passed).toBe(false);
    expect(moderateGeneratedContent({ signals: ["privacy_leakage"] }).passed).toBe(true);
    expect(
      moderateGeneratedContent({ signals: ["inappropriate_content"], audienceIsMinor: true })
        .passed,
    ).toBe(false);
  });
  it("applies age-aware protection", () => {
    expect(applyAgeAwareProtection(15, ["inappropriate_content"])).toEqual([
      "inappropriate_content",
    ]);
    expect(applyAgeAwareProtection(25, ["inappropriate_content"])).toEqual([]);
  });
  it("records document extraction with confidence", () => {
    const good = recordDocumentExtraction({
      sourceRef: "doc-1",
      tenantId: TENANT,
      classification: "report",
      classificationConfidence: 0.9,
      fields: [{ key: "student", value: "A", confidence: 0.9 }],
    });
    expect(isExtractionConfident(good)).toBe(true);
    const bad = recordDocumentExtraction({
      sourceRef: "doc-2",
      tenantId: TENANT,
      classification: "report",
      classificationConfidence: 0.5,
      fields: [],
    });
    expect(isExtractionConfident(bad)).toBe(false);
  });
  it("supports African languages and translation review", () => {
    expect(isLanguageSupported("sw")).toBe(true);
    expect(isLanguageSupported("xx")).toBe(false);
    expect(requiresTranslationReview({ protectedTerms: ["WAEC"], detectedTerms: ["WAEC"] })).toBe(
      true,
    );
  });
});

describe("ai-services — Orchestration, Pipeline, Agent Interface (168-176)", () => {
  it("creates versioned pipeline", () => {
    const p = createAiPipeline({
      id: aiPipelineId("pipe-1"),
      name: "doc-intelligence",
      version: 2,
    });
    expect(p.version).toBe(2);
    expect(p.stages).toContain("verification");
  });
  it("validates DAG ordering", () => {
    const ordered: AiPipelineStage[] = [
      "input",
      "classification",
      "retrieval",
      "reasoning",
      "verification",
      "output",
    ];
    expect(isPipelineDagValid(ordered)).toBe(true);
    expect(isPipelineDagValid(["output", "input"])).toBe(false);
  });
  it("agent model request requires permission", () => {
    expect(
      isAgentModelRequestSatisfiable(
        { capability: "reasoning", riskLevel: "low" },
        [aiModelId("m1")],
        true,
      ),
    ).toBe(true);
    expect(
      isAgentModelRequestSatisfiable(
        { capability: "reasoning", riskLevel: "low" },
        [aiModelId("m1")],
        false,
      ),
    ).toBe(false);
  });
});
