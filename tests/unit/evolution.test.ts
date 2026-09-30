// ─── Phase 32 — Future Evolution ─────────────────────────────
import { describe, it, expect } from "vitest";
import {
  capabilityId,
  evolutionRecordId,
  isEvolutionPrinciple,
  createFutureCapability,
  canTransitionLifecycle,
  isGraduationState,
  resolveProposalPhase,
  isFutureEvolutionOwned,
  isChangeProtocolStep,
  isChangeProtocolOrdered,
  createCapabilityDiscovery,
} from "@/lib/evolution-core";
import {
  sandboxId,
  experimentId,
  rolloutId,
  createInnovationSandbox,
  isSandboxProductionIsolated,
  createExperiment,
  isExperimentExpired,
  isExperimentValid,
  isHighImpactExperimentGoverned,
  createAbTest,
  isAbTestGoverned,
  createProgressiveRollout,
  canAdvanceRolloutStage,
  createCanaryDeployment,
  addCanaryMonitor,
  isCanaryMonitored,
  createEvolutionFeatureFlag,
  isFlagControlled,
  createTenantExperimentCohort,
  isTenantExperimentIsolated,
  recordExperimentOutcome,
  isFailureControlled,
  isExperimentReusable,
  CANARY_MONITOR_DIMENSIONS,
} from "@/lib/evolution-experiments";
import {
  deprecationId,
  migrationId,
  compatibilityId,
  createDeprecationPlan,
  completeDeprecationStep,
  isDeprecationComplete,
  createSunsetAnalysis,
  verifySunsetArea,
  isSunsetVerified,
  createMigrationPlan,
  canExecuteMigration,
  createCompatibilityContract,
  verifyCompatibilitySurface,
  isCompatibilityMeasured,
  createSchemaEvolutionPlan,
  isSchemaEvolutionSafe,
  createApiEvolutionPlan,
  isBreakingChangeApproved,
  createProtocolEvolutionPlan,
  isProtocolEvolutionComplete,
  createModelMigrationPlan,
  addModelMigrationMeasurement,
  isModelMigrationEvidenceSufficient,
  createCryptoAgilityPlan,
  isCryptoAgile,
  createGenerationalMigrationPlan,
  completeGenerationStep,
  isGenerationalMigrationComplete,
  createGenerationContinuity,
  isGenerationContinuityPreserved,
  createVendorExitPlan,
  isVendorIndependenceSatisfied,
  DEPRECATION_STEPS,
  SUNSET_VERIFICATION_AREAS,
  COMPATIBILITY_SURFACES,
  MODEL_MIGRATION_DIMENSIONS,
  GENERATION_MIGRATION_STEPS,
  GENERATION_CONTINUITY_AREAS,
} from "@/lib/evolution-migration";
import {
  technologyAssessmentId,
  debtItemId,
  dependencyId,
  evolutionRiskId,
  adrId,
  createTechnologyRadarItem,
  createTechnologyAssessment,
  scoreTechnologyAssessment,
  isTechnologyRecommended,
  registerTechDebt,
  prioritizeTechDebt,
  createDependencyRecord,
  isDependencyHealthy,
  createEvolutionAdr,
  isAdrComplete,
  createEvolutionRiskItem,
  scoreEvolutionRisk,
  prioritizeEvolutionRisks,
  recordEvolutionMetric,
  createSyntheticDataPolicy,
  isSyntheticDataIsolated,
  createEvolutionMemoryEntry,
  isKnowledgePreserved,
  TECHNOLOGY_EVALUATION_CRITERIA,
  evolutionMemoryId,
} from "@/lib/evolution-intelligence";
import {
  reviewId,
  autonomyEvolutionId,
  agentEvolutionId,
  scorecardId,
  createEvolutionReview,
  isReviewApproved,
  createReversibilityContract,
  isReversibilitySatisfied,
  createAutonomyEvolutionContract,
  canIncreaseAutonomy,
  isAutonomyBounded,
  createAgentEvolutionContract,
  isAgentEvolutionComplete,
  createAgentMigrationPlan,
  isAgentMigrationSafe,
  createEvolutionAgentPermission,
  canAgentActIndependently,
  createCapabilityScorecard,
  scoreCapability,
  createGraduationValidation,
  isGraduationReady,
  createEthicalEvaluation,
  isEthicallyAcceptable,
  createEvolutionSecurityContract,
  isEvolutionSecuritySatisfied,
  createSupplyChainEvaluation,
  isSupplyChainSafe,
  createEvolutionIncidentResponse,
  completeIncidentStep,
  isIncidentResponseComplete,
  createEvolutionRecoveryContract,
  isRecoveryComplete,
  EVOLUTION_REVIEW_DIMENSIONS,
  REVERSIBILITY_MECHANISMS,
  SCORECARD_DIMENSIONS,
  ETHICAL_DIMENSIONS,
  SUPPLY_CHAIN_DIMENSIONS,
  GRADUATION_READINESS_ITEMS,
  EVOLUTION_SECURITY_CONTROLS,
  INCIDENT_RESPONSE_STEPS,
  RECOVERY_MECHANISMS,
} from "@/lib/evolution-governance";

const techScores = (v: number): Record<string, number> =>
  Object.fromEntries(TECHNOLOGY_EVALUATION_CRITERIA.map((c) => [c, v]));
const scorecardScores = (v: number): Record<string, number> =>
  Object.fromEntries(SCORECARD_DIMENSIONS.map((c) => [c, v]));
const ethicalChecks = (v: boolean): Record<string, boolean> =>
  Object.fromEntries(ETHICAL_DIMENSIONS.map((c) => [c, v]));
const reviewVerdicts = (v: boolean): Record<string, boolean> =>
  Object.fromEntries(EVOLUTION_REVIEW_DIMENSIONS.map((c) => [c, v]));
const supplyChecks = (v: boolean): Record<string, boolean> =>
  Object.fromEntries(SUPPLY_CHAIN_DIMENSIONS.map((c) => [c, v]));
const readiness = (v: boolean): Record<string, boolean> =>
  Object.fromEntries(GRADUATION_READINESS_ITEMS.map((c) => [c, v]));

describe("evolution-core — Principles & capability registry (E, F)", () => {
  it("recognizes the ten core evolution principles", () => {
    expect(isEvolutionPrinciple("no_silent_mutation")).toBe(true);
    expect(isEvolutionPrinciple("experiment_before_graduation")).toBe(true);
    expect(isEvolutionPrinciple("magic")).toBe(false);
  });
  it("registers future capabilities with required metadata", () => {
    const capability = createFutureCapability({
      id: capabilityId("cap-1"),
      name: "Adaptive Scheduling",
      description: "AI-assisted timetables",
      originatingPhase: "12",
      owner: "sched-team",
    });
    expect(capability.ok).toBe(true);
    if (capability.ok) expect(capability.capability.lifecycleState).toBe("idea");
    expect(
      createFutureCapability({
        id: capabilityId("cap-2"),
        name: "X",
        description: "Y",
        originatingPhase: "12",
        owner: "",
      }).ok,
    ).toBe(false);
    expect(
      createFutureCapability({
        id: capabilityId("cap-3"),
        name: "X",
        description: "Y",
        originatingPhase: "12",
        owner: "t",
        maturityLevel: 9,
      }).ok,
    ).toBe(false);
  });
});

describe("evolution-core — Lifecycle & scope protection (G, DC)", () => {
  it("advances lifecycle one controlled state at a time", () => {
    expect(canTransitionLifecycle("idea", "candidate")).toBe(true);
    expect(canTransitionLifecycle("idea", "general_availability")).toBe(false);
    expect(canTransitionLifecycle("idea", "general_availability", true)).toBe(true);
    expect(isGraduationState("general_availability")).toBe(true);
    expect(isGraduationState("sandbox")).toBe(false);
  });
  it("routes proposals to their proper phase", () => {
    expect(resolveProposalPhase("identity")).toBe("02");
    expect(resolveProposalPhase("security")).toBe("08");
    expect(resolveProposalPhase("quantum_computing")).toBe("32");
    expect(isFutureEvolutionOwned("quantum_computing")).toBe(true);
    expect(isFutureEvolutionOwned("identity")).toBe(false);
  });
  it("validates the architectural change protocol order", () => {
    expect(isChangeProtocolStep("impact_analysis")).toBe(true);
    expect(isChangeProtocolStep("nope")).toBe(false);
    expect(isChangeProtocolOrdered(["idea", "classification", "impact_analysis"])).toBe(false);
  });
  it("accepts capability discovery from known sources", () => {
    expect(
      createCapabilityDiscovery({
        id: evolutionRecordId("d-1"),
        source: "teacher",
        request: "markbook export",
      }).ok,
    ).toBe(true);
    expect(
      createCapabilityDiscovery({
        id: evolutionRecordId("d-2"),
        source: "unknown" as never,
        request: "x",
      }).ok,
    ).toBe(false);
  });
});

describe("evolution-experiments — Sandbox & experiments (J, AI, AJ)", () => {
  it("keeps the innovation sandbox isolated from production", () => {
    const sandbox = createInnovationSandbox({ id: sandboxId("sb-1"), name: "future-lab" });
    if (!sandbox.ok) throw new Error("expected ok");
    expect(isSandboxProductionIsolated(sandbox.sandbox)).toBe(true);
  });
  it("creates valid experiments with rollback and owner", () => {
    const experiment = createExperiment({
      id: experimentId("ex-1"),
      name: "new-markbook",
      hypothesis: "improves grades",
      baseline: "current",
      treatment: "new",
      successCriteria: "+5%",
      failureCriteria: "regression",
      measurementPlan: "weekly",
      samplePopulation: "10 classes",
      riskClassification: "low",
      rollbackPlan: "revert",
      owner: "team-a",
      expiryDate: "2027-01-01",
    });
    if (!experiment.ok) throw new Error("expected ok");
    expect(isExperimentValid(experiment.experiment)).toBe(true);
    expect(isExperimentExpired(experiment.experiment, "2028-01-01")).toBe(true);
    expect(
      createExperiment({
        id: experimentId("ex-2"),
        name: "x",
        hypothesis: "h",
        baseline: "b",
        treatment: "t",
        successCriteria: "s",
        failureCriteria: "f",
        measurementPlan: "m",
        samplePopulation: "p",
        riskClassification: "low",
        rollbackPlan: "",
        owner: "o",
        expiryDate: "2027-01-01",
      }).ok,
    ).toBe(false);
  });
  it("requires additional governance for high-impact experiments", () => {
    const critical = createExperiment({
      id: experimentId("ex-3"),
      name: "autopay",
      hypothesis: "h",
      baseline: "b",
      treatment: "t",
      successCriteria: "s",
      failureCriteria: "f",
      measurementPlan: "m",
      samplePopulation: "p",
      riskClassification: "critical",
      rollbackPlan: "revert",
      owner: "fin-team",
      expiryDate: "2027-01-01",
    });
    if (!critical.ok) throw new Error("expected ok");
    expect(isHighImpactExperimentGoverned(critical.experiment)).toBe(true);
  });
  it("governs A/B tests on high-impact decisions", () => {
    const test = createAbTest({
      id: experimentId("ab-1"),
      target: "workflow",
      variantA: "a",
      variantB: "b",
    });
    const high = createAbTest({
      id: experimentId("ab-2"),
      target: "ai_model",
      variantA: "a",
      variantB: "b",
      highImpact: true,
    });
    if (!test.ok || !high.ok) throw new Error("expected ok");
    expect(isAbTestGoverned(test.test)).toBe(true);
    expect(isAbTestGoverned(high.test)).toBe(false);
  });
});

describe("evolution-experiments — Rollout, canary, flags & tenant safety (AG, AH, AF, DI, CY, CZ)", () => {
  it("advances rollout evidence-driven through staged environments", () => {
    const rollout = createProgressiveRollout({
      id: rolloutId("ro-1"),
      capability: "adaptive-scheduling",
    });
    if (!rollout.ok) throw new Error("expected ok");
    expect(rollout.rollout.stage).toBe("sandbox");
    expect(canAdvanceRolloutStage("sandbox", "internal")).toBe(true);
    expect(canAdvanceRolloutStage("sandbox", "general_availability")).toBe(false);
  });
  it("monitors canary deployments across all dimensions", () => {
    let deployment = createCanaryDeployment({
      id: rolloutId("cn-1"),
      capability: "new-exam-engine",
      automaticRollback: true,
    });
    if (!deployment.ok) throw new Error("expected ok");
    for (const dimension of CANARY_MONITOR_DIMENSIONS) {
      deployment = addCanaryMonitor(deployment.deployment, dimension);
      if (!deployment.ok) throw new Error("expected ok");
    }
    expect(isCanaryMonitored(deployment.deployment)).toBe(true);
  });
  it("requires ownership and emergency disablement for flags", () => {
    expect(
      createEvolutionFeatureFlag({ id: "fl-1", feature: "x", scope: "tenant", owner: "" }).ok,
    ).toBe(false);
    const flag = createEvolutionFeatureFlag({
      id: "fl-2",
      feature: "x",
      scope: "cohort",
      owner: "team-a",
      emergencyDisablement: true,
    });
    if (!flag.ok) throw new Error("expected ok");
    expect(isFlagControlled(flag.flag)).toBe(true);
  });
  it("never lets experiments affect unrelated tenants", () => {
    const cohort = createTenantExperimentCohort({
      id: experimentId("tc-1"),
      experimentRef: "ex-1",
      tenants: ["tenant-a"],
      optIn: true,
      isolatedConfiguration: true,
      emergencyDisablement: true,
    });
    if (!cohort.ok) throw new Error("expected ok");
    expect(isTenantExperimentIsolated(cohort.cohort)).toBe(true);
  });
  it("controls failures and keeps experiments reusable", () => {
    const uncontrolled = recordExperimentOutcome({
      id: experimentId("oc-1"),
      experimentRef: "ex-1",
      result: "failure",
    });
    if (!uncontrolled.ok) throw new Error("expected ok");
    expect(isFailureControlled(uncontrolled.outcome)).toBe(false);
    const controlled = recordExperimentOutcome({
      id: experimentId("oc-2"),
      experimentRef: "ex-2",
      result: "failure",
      documented: true,
      analyzed: true,
      isolated: true,
      archived: true,
      engineeringKnowledge: true,
    });
    if (!controlled.ok) throw new Error("expected ok");
    expect(isFailureControlled(controlled.outcome)).toBe(true);
    expect(isExperimentReusable(controlled.outcome)).toBe(true);
  });
});

describe("evolution-migration — Deprecation & sunset (AB, AC)", () => {
  it("completes deprecation through all ten steps", () => {
    let plan = createDeprecationPlan({ id: deprecationId("dp-1"), capability: "legacy-sms" });
    if (!plan.ok) throw new Error("expected ok");
    for (const step of DEPRECATION_STEPS) {
      plan = completeDeprecationStep(plan.plan, step);
      if (!plan.ok) throw new Error("expected ok");
    }
    expect(isDeprecationComplete(plan.plan)).toBe(true);
    expect(completeDeprecationStep(plan.plan, "bogus").ok).toBe(false);
  });
  it("verifies all sunset areas before removal", () => {
    let analysis = createSunsetAnalysis({ id: deprecationId("sn-1"), capability: "legacy-sms" });
    if (!analysis.ok) throw new Error("expected ok");
    for (const area of SUNSET_VERIFICATION_AREAS) {
      analysis = verifySunsetArea(analysis.analysis, area);
      if (!analysis.ok) throw new Error("expected ok");
    }
    expect(isSunsetVerified(analysis.analysis)).toBe(true);
  });
});

describe("evolution-migration — Migration & compatibility (AD, AE)", () => {
  it("executes migrations only with dry run, rollback, validation, audit", () => {
    const plan = createMigrationPlan({
      id: migrationId("mg-1"),
      capability: "attendance-v2",
      dryRun: true,
      incremental: true,
      rollbackAvailable: true,
      validationAvailable: true,
      auditTrailAvailable: true,
    });
    if (!plan.ok) throw new Error("expected ok");
    expect(canExecuteMigration(plan.plan)).toBe(true);
    const partial = createMigrationPlan({
      id: migrationId("mg-2"),
      capability: "attendance-v2",
      dryRun: true,
    });
    if (!partial.ok) throw new Error("expected ok");
    expect(canExecuteMigration(partial.plan)).toBe(false);
  });
  it("measures compatibility across all surfaces", () => {
    let contract = createCompatibilityContract({
      id: compatibilityId("cb-1"),
      capability: "exam-api-v2",
    });
    if (!contract.ok) throw new Error("expected ok");
    for (const surface of COMPATIBILITY_SURFACES) {
      contract = verifyCompatibilitySurface(contract.contract, surface);
      if (!contract.ok) throw new Error("expected ok");
    }
    expect(isCompatibilityMeasured(contract.contract)).toBe(true);
  });
});

describe("evolution-migration — Schema, API, protocol & model evolution (P, Q, R, M)", () => {
  it("keeps schema evolution additive or backward-compatible", () => {
    const additive = createSchemaEvolutionPlan({
      id: migrationId("sc-1"),
      schema: "student",
      additiveOnly: true,
    });
    if (!additive.ok) throw new Error("expected ok");
    expect(isSchemaEvolutionSafe(additive.plan)).toBe(true);
    const breaking = createSchemaEvolutionPlan({
      id: migrationId("sc-2"),
      schema: "student",
      additiveOnly: false,
      backwardCompatibleReaders: false,
      fieldDeprecationDefined: false,
    });
    if (!breaking.ok) throw new Error("expected ok");
    expect(isSchemaEvolutionSafe(breaking.plan)).toBe(false);
  });
  it("requires architectural approval for breaking API changes", () => {
    const breaking = createApiEvolutionPlan({
      id: compatibilityId("api-1"),
      api: "payments/v1",
      breakingChange: true,
      architecturalApproval: false,
      migrationGuide: true,
      contractTests: true,
    });
    if (!breaking.ok) throw new Error("expected ok");
    expect(isBreakingChangeApproved(breaking.plan)).toBe(false);
    const approved = createApiEvolutionPlan({
      id: compatibilityId("api-2"),
      api: "payments/v1",
      breakingChange: true,
      architecturalApproval: true,
      migrationGuide: true,
      contractTests: true,
    });
    if (!approved.ok) throw new Error("expected ok");
    expect(isBreakingChangeApproved(approved.plan)).toBe(true);
  });
  it("requires complete protocol evolution controls", () => {
    const plan = createProtocolEvolutionPlan({
      id: compatibilityId("pr-1"),
      protocol: "webhook",
      versionNegotiation: true,
      capabilityDiscovery: true,
      gracefulFallback: true,
      compatibilityLayers: true,
      protocolAdapters: true,
      deprecationWindow: true,
    });
    if (!plan.ok) throw new Error("expected ok");
    expect(isProtocolEvolutionComplete(plan.plan)).toBe(true);
  });
  it("requires measurable evidence for model migration", () => {
    let plan = createModelMigrationPlan({
      id: migrationId("md-1"),
      fromModel: "m1",
      toModel: "m2",
    });
    if (!plan.ok) throw new Error("expected ok");
    for (const dimension of MODEL_MIGRATION_DIMENSIONS) {
      plan = addModelMigrationMeasurement(plan.plan, dimension);
      if (!plan.ok) throw new Error("expected ok");
    }
    expect(isModelMigrationEvidenceSufficient(plan.plan)).toBe(true);
  });
});

describe("evolution-migration — Crypto, generation & vendor exit (AA, AN, BB, BC)", () => {
  it("requires full cryptographic agility", () => {
    const plan = createCryptoAgilityPlan({
      id: compatibilityId("cr-1"),
      algorithmAgility: true,
      keyRotation: true,
      certificateMigration: true,
      postQuantumReadiness: true,
      cryptographicInventory: true,
      cryptographicDeprecation: true,
      secureMigration: true,
    });
    if (!plan.ok) throw new Error("expected ok");
    expect(isCryptoAgile(plan.plan)).toBe(true);
  });
  it("completes generational migration through all fourteen steps", () => {
    let plan = createGenerationalMigrationPlan({
      id: migrationId("gn-1"),
      fromGeneration: "v2",
      toGeneration: "v3",
    });
    if (!plan.ok) throw new Error("expected ok");
    for (const step of GENERATION_MIGRATION_STEPS) {
      plan = completeGenerationStep(plan.plan, step);
      if (!plan.ok) throw new Error("expected ok");
    }
    expect(isGenerationalMigrationComplete(plan.plan)).toBe(true);
  });
  it("preserves continuity across generations", () => {
    const continuity = createGenerationContinuity({
      id: migrationId("gc-1"),
      preserved: [...GENERATION_CONTINUITY_AREAS],
    });
    if (!continuity.ok) throw new Error("expected ok");
    expect(isGenerationContinuityPreserved(continuity.continuity)).toBe(true);
    const partial = createGenerationContinuity({
      id: migrationId("gc-2"),
      preserved: ["identity_continuity"],
    });
    if (!partial.ok) throw new Error("expected ok");
    expect(isGenerationContinuityPreserved(partial.continuity)).toBe(false);
  });
  it("satisfies vendor independence for critical dependencies", () => {
    const plan = createVendorExitPlan({
      id: compatibilityId("ve-1"),
      dependency: "payment-provider",
      abstractionLayer: true,
      alternativeProviders: true,
      migrationPaths: true,
      exportMechanisms: true,
      contractDocumentation: true,
    });
    if (!plan.ok) throw new Error("expected ok");
    expect(isVendorIndependenceSatisfied(plan.plan)).toBe(true);
  });
});

describe("evolution-intelligence — Technology radar & evaluation (H, I, DW)", () => {
  it("registers radar items and evaluates technologies", () => {
    const radar = createTechnologyRadarItem({
      id: technologyAssessmentId("tr-1"),
      technology: "edge-inference",
      domain: "ai",
      stage: "assess",
    });
    expect(radar.ok).toBe(true);
    const assessment = createTechnologyAssessment({
      id: technologyAssessmentId("ta-1"),
      technology: "edge-inference",
      scores: techScores(0.9),
    });
    if (!assessment.ok) throw new Error("expected ok");
    expect(scoreTechnologyAssessment(assessment.assessment)).toBeCloseTo(0.9);
    expect(isTechnologyRecommended(assessment.assessment, 0.8)).toBe(true);
  });
  it("rejects incomplete technology assessments", () => {
    expect(
      createTechnologyAssessment({
        id: technologyAssessmentId("ta-2"),
        technology: "x",
        scores: { strategic_relevance: 0.5 } as never,
      }).ok,
    ).toBe(false);
  });
});

describe("evolution-intelligence — Debt, dependencies, ADR, risk, metrics (AL, AM, BF, BG, AK)", () => {
  it("registers and prioritizes technical debt", () => {
    const a = registerTechDebt({
      id: debtItemId("dt-1"),
      system: "reporting",
      type: "architectural",
      description: "monolith",
      severity: 8,
      priority: 7,
    });
    const b = registerTechDebt({
      id: debtItemId("dt-2"),
      system: "search",
      type: "schema",
      description: "unsharded",
      severity: 5,
      priority: 4,
    });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    const ranked = prioritizeTechDebt([b.item, a.item]);
    expect(ranked[0].system).toBe("reporting");
    expect(
      registerTechDebt({
        id: debtItemId("dt-3"),
        system: "x",
        type: "code",
        description: "y",
        severity: 11,
        priority: 1,
      }).ok,
    ).toBe(false);
  });
  it("tracks dependency health", () => {
    const healthy = createDependencyRecord({
      id: dependencyId("dep-1"),
      name: "lib-a",
      kind: "library",
      endOfLife: false,
      criticalVulnerability: false,
      licensingApproved: true,
      maintained: true,
    });
    if (!healthy.ok) throw new Error("expected ok");
    expect(isDependencyHealthy(healthy.record)).toBe(true);
    const risky = createDependencyRecord({
      id: dependencyId("dep-2"),
      name: "lib-b",
      kind: "library",
      criticalVulnerability: true,
    });
    if (!risky.ok) throw new Error("expected ok");
    expect(isDependencyHealthy(risky.record)).toBe(false);
  });
  it("records complete evolution ADRs", () => {
    const adr = createEvolutionAdr({
      id: adrId("adr-1"),
      title: "Move to event sourcing",
      problem: "scale limits",
      context: "high write volume",
      alternatives: ["outbox", "cdc"],
      selectedSolution: "outbox",
      rejectedAlternatives: ["cdc"],
      consequences: "rebuild readers",
      affectedPhases: ["14"],
      migrationRequirements: "dual-write",
      rollbackStrategy: "revert",
    });
    if (!adr.ok) throw new Error("expected ok");
    expect(isAdrComplete(adr.adr)).toBe(true);
    expect(
      createEvolutionAdr({
        id: adrId("adr-2"),
        title: "x",
        problem: "p",
        context: "c",
        alternatives: [],
        selectedSolution: "",
        rejectedAlternatives: [],
        consequences: "z",
        affectedPhases: ["1"],
        migrationRequirements: "m",
        rollbackStrategy: "r",
      }).ok,
    ).toBe(false);
  });
  it("registers and prioritizes evolution risks", () => {
    const high = createEvolutionRiskItem({
      id: evolutionRiskId("rk-1"),
      category: "ai",
      description: "model drift",
      likelihood: 4,
      impact: 5,
    });
    const low = createEvolutionRiskItem({
      id: evolutionRiskId("rk-2"),
      category: "financial",
      description: "cost",
      likelihood: 2,
      impact: 2,
    });
    if (!high.ok || !low.ok) throw new Error("expected ok");
    expect(scoreEvolutionRisk(high.risk)).toBe(20);
    const ranked = prioritizeEvolutionRisks([low.risk, high.risk]);
    expect(ranked[0].id).toBe(high.risk.id);
    expect(
      createEvolutionRiskItem({
        id: evolutionRiskId("rk-3"),
        category: "security",
        description: "x",
        likelihood: 9,
        impact: 1,
      }).ok,
    ).toBe(false);
  });
  it("records only known evolution metrics", () => {
    expect(
      recordEvolutionMetric({
        id: "m-1",
        name: "innovation_velocity",
        value: 0.8,
        period: "2026-Q3",
      }).ok,
    ).toBe(true);
    expect(
      recordEvolutionMetric({ id: "m-2", name: "magic", value: 1, period: "2026-Q3" }).ok,
    ).toBe(false);
  });
});

describe("evolution-intelligence — Synthetic data & engineering memory (CB, CK, CL)", () => {
  it("keeps synthetic data isolated from institutional evidence", () => {
    const policy = createSyntheticDataPolicy({
      id: "sd-1",
      purpose: "agent evaluation",
      isolatedFromInstitutionalEvidence: true,
    });
    if (!policy.ok) throw new Error("expected ok");
    expect(isSyntheticDataIsolated(policy.policy)).toBe(true);
  });
  it("preserves engineering memory", () => {
    const entry = createEvolutionMemoryEntry({
      id: evolutionMemoryId("mem-1"),
      kind: "reversal",
      summary: "rollback of event sourcing",
    });
    if (!entry.ok) throw new Error("expected ok");
    expect(isKnowledgePreserved(entry.entry)).toBe(true);
    expect(
      createEvolutionMemoryEntry({
        id: evolutionMemoryId("mem-2"),
        kind: "bogus" as never,
        summary: "x",
      }).ok,
    ).toBe(false);
  });
});

describe("evolution-governance — Review & reversibility (BE, DE)", () => {
  it("approves evolution reviews only when all dimensions pass", () => {
    const review = createEvolutionReview({
      id: reviewId("rv-1"),
      capability: "adaptive-scheduling",
      verdicts: reviewVerdicts(true),
    });
    if (!review.ok) throw new Error("expected ok");
    expect(isReviewApproved(review.review)).toBe(true);
    expect(
      createEvolutionReview({
        id: reviewId("rv-2"),
        capability: "x",
        verdicts: { business_value: true } as never,
      }).ok,
    ).toBe(false);
  });
  it("requires all five reversibility mechanisms for high-risk changes", () => {
    const lowRisk = createReversibilityContract({
      id: "rev-1",
      capability: "cosmetic",
      available: ["rollback"],
    });
    if (!lowRisk.ok) throw new Error("expected ok");
    expect(isReversibilitySatisfied(lowRisk.contract, false)).toBe(true);
    const highRisk = createReversibilityContract({
      id: "rev-2",
      capability: "schema-migration",
      available: [...REVERSIBILITY_MECHANISMS],
    });
    if (!highRisk.ok) throw new Error("expected ok");
    expect(isReversibilitySatisfied(highRisk.contract, true)).toBe(true);
    const partial = createReversibilityContract({
      id: "rev-3",
      capability: "schema-migration",
      available: ["rollback"],
    });
    if (!partial.ok) throw new Error("expected ok");
    expect(isReversibilitySatisfied(partial.contract, true)).toBe(false);
  });
});

describe("evolution-governance — Autonomy evolution (AS, AT)", () => {
  it("increases autonomy only with evidence and bounded boundaries", () => {
    expect(canIncreaseAutonomy("supervised", "controlled_autonomous", true)).toBe(true);
    expect(canIncreaseAutonomy("supervised", "controlled_autonomous", false)).toBe(false);
    expect(canIncreaseAutonomy("supervised", "highly_autonomous", true)).toBe(false);
    expect(
      createAutonomyEvolutionContract({
        id: autonomyEvolutionId("au-1"),
        capability: "autoscale",
        level: "controlled_autonomous",
        allowedActions: ["scale-up"],
        prohibitedActions: [],
        approvalRequired: false,
      }).ok,
    ).toBe(false);
    const contract = createAutonomyEvolutionContract({
      id: autonomyEvolutionId("au-2"),
      capability: "autoscale",
      level: "controlled_autonomous",
      allowedActions: ["scale-up"],
      prohibitedActions: ["scale-to-zero"],
      approvalRequired: true,
      spendingLimit: 1000,
      dataLimit: 500,
      tenantBounded: true,
      escalationDefined: true,
      emergencyShutdown: true,
    });
    if (!contract.ok) throw new Error("expected ok");
    expect(isAutonomyBounded(contract.contract)).toBe(true);
  });
});

describe("evolution-governance — Agent evolution & migration (AQ, AR)", () => {
  it("requires complete agent evolution contracts", () => {
    const contract = createAgentEvolutionContract({
      id: agentEvolutionId("ag-1"),
      agentRef: "tutor-agent",
      version: "2.0",
      identityDefined: true,
      permissionsDefined: true,
      capabilitiesDefined: true,
      memoryPolicyDefined: true,
      toolsDefined: true,
      evaluationDefined: true,
      auditHistory: true,
      ownerDefined: true,
    });
    if (!contract.ok) throw new Error("expected ok");
    expect(isAgentEvolutionComplete(contract.contract)).toBe(true);
  });
  it("migrates agents only when safe", () => {
    const plan = createAgentMigrationPlan({
      id: agentEvolutionId("ag-2"),
      fromVersion: "1.0",
      toVersion: "2.0",
      preserveMemory: true,
      preservePermissions: true,
      revalidateTools: true,
      reRunEvaluations: true,
      compareBehavior: true,
      validateOutputs: true,
      verifySafety: true,
    });
    if (!plan.ok) throw new Error("expected ok");
    expect(isAgentMigrationSafe(plan.plan)).toBe(true);
    const partial = createAgentMigrationPlan({
      id: agentEvolutionId("ag-3"),
      fromVersion: "1.0",
      toVersion: "2.0",
      preserveMemory: true,
      preservePermissions: true,
    });
    if (!partial.ok) throw new Error("expected ok");
    expect(isAgentMigrationSafe(partial.plan)).toBe(false);
  });
});

describe("evolution-governance — Agent permissions, scorecard & graduation (CN, CX, CW)", () => {
  it("binds evolution agents to non-invasive permissions", () => {
    expect(
      createEvolutionAgentPermission({
        id: "p-1",
        agentRef: "research-agent",
        modifyProductionArchitecture: true,
      }).ok,
    ).toBe(false);
    const permission = createEvolutionAgentPermission({ id: "p-2", agentRef: "research-agent" });
    if (!permission.ok) throw new Error("expected ok");
    expect(canAgentActIndependently(permission.permission)).toBe(true);
  });
  it("scores capabilities across all dimensions", () => {
    const scorecard = createCapabilityScorecard({
      id: scorecardId("sc-1"),
      capability: "adaptive-scheduling",
      scores: scorecardScores(0.9),
    });
    if (!scorecard.ok) throw new Error("expected ok");
    expect(scoreCapability(scorecard.scorecard)).toBeCloseTo(0.9);
  });
  it("graduates only with readiness and score", () => {
    const validation = createGraduationValidation({
      id: scorecardId("gv-1"),
      capability: "adaptive-scheduling",
      readiness: readiness(true),
    });
    const scorecard = createCapabilityScorecard({
      id: scorecardId("sc-2"),
      capability: "adaptive-scheduling",
      scores: scorecardScores(0.9),
    });
    if (!validation.ok || !scorecard.ok) throw new Error("expected ok");
    expect(isGraduationReady(validation.validation, scorecard.scorecard, 0.8)).toBe(true);
    const lowScore = createCapabilityScorecard({
      id: scorecardId("sc-3"),
      capability: "adaptive-scheduling",
      scores: scorecardScores(0.4),
    });
    if (!lowScore.ok) throw new Error("expected ok");
    expect(isGraduationReady(validation.validation, lowScore.scorecard, 0.8)).toBe(false);
  });
});

describe("evolution-governance — Ethics, security & supply chain (BI, CS, CT)", () => {
  it("accepts only ethically evaluated capabilities", () => {
    const evaluation = createEthicalEvaluation({
      id: reviewId("et-1"),
      capability: "adaptive-scheduling",
      assessments: ethicalChecks(true),
    });
    if (!evaluation.ok) throw new Error("expected ok");
    expect(isEthicallyAcceptable(evaluation.evaluation)).toBe(true);
  });
  it("requires all evolution security controls", () => {
    const contract = createEvolutionSecurityContract({
      id: "sec-1",
      capability: "adaptive-scheduling",
      controls: [...EVOLUTION_SECURITY_CONTROLS],
    });
    if (!contract.ok) throw new Error("expected ok");
    expect(isEvolutionSecuritySatisfied(contract.contract)).toBe(true);
    const partial = createEvolutionSecurityContract({
      id: "sec-2",
      capability: "x",
      controls: ["capability_signing"],
    });
    if (!partial.ok) throw new Error("expected ok");
    expect(isEvolutionSecuritySatisfied(partial.contract)).toBe(false);
  });
  it("verifies the supply chain for every dependency", () => {
    const evaluation = createSupplyChainEvaluation({
      id: "sc-1",
      dependency: "lib-a",
      checks: supplyChecks(true),
    });
    if (!evaluation.ok) throw new Error("expected ok");
    expect(isSupplyChainSafe(evaluation.evaluation)).toBe(true);
  });
});

describe("evolution-governance — Incident response & recovery (CG, CH)", () => {
  it("completes incident response through all steps", () => {
    let response = createEvolutionIncidentResponse({
      id: "ir-1",
      capability: "adaptive-scheduling",
    });
    if (!response.ok) throw new Error("expected ok");
    for (const step of INCIDENT_RESPONSE_STEPS) {
      response = completeIncidentStep(response.response, step);
      if (!response.ok) throw new Error("expected ok");
    }
    expect(isIncidentResponseComplete(response.response)).toBe(true);
  });
  it("requires full recovery mechanisms", () => {
    const contract = createEvolutionRecoveryContract({
      id: "rc-1",
      capability: "adaptive-scheduling",
      available: [...RECOVERY_MECHANISMS],
    });
    if (!contract.ok) throw new Error("expected ok");
    expect(isRecoveryComplete(contract.contract)).toBe(true);
    const partial = createEvolutionRecoveryContract({
      id: "rc-2",
      capability: "x",
      available: ["rollback"],
    });
    if (!partial.ok) throw new Error("expected ok");
    expect(isRecoveryComplete(partial.contract)).toBe(false);
  });
});
