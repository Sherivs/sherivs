// ─── Phase 31 — Enterprise Scale ─────────────────────────────
import { describe, it, expect } from "vitest";
import {
  workloadId,
  serviceId,
  computePoolId,
  createWorkload,
  createComputePool,
  assignWorkloadToPool,
  isWorkloadIsolationSatisfied,
  createScaleDimension,
  isDimensionAtRisk,
  createScalingStrategy,
  createStateContract,
  createServiceBoundary,
} from "@/lib/enterprise-core";
import {
  quotaId,
  queueId,
  eventStreamId,
  createQuota,
  buildQuotaHierarchy,
  resolveEffectiveQuota,
  isQuotaExceeded,
  consumeQuota,
  createRateLimitPolicy,
  isWithinRateLimit,
  adaptRateLimit,
  createBackpressureQueue,
  isBackpressureEngaged,
  enqueue,
  createQueueArchitecture,
  isQueueArchitectureComplete,
  createEventStream,
  isOrderingAppropriate,
  canReplayEventStream,
  isRetentionGoverned,
} from "@/lib/enterprise-capacity";
import {
  sloId,
  cellId,
  failureDomainId,
  createConsistencyContract,
  isConsistencyAppropriate,
  isIdempotencySatisfied,
  createDistributedTransactionContract,
  createServiceTier,
  createSlo,
  computeErrorBudgetMinutes,
  isErrorBudgetExhausted,
  createLatencyBudget,
  isLatencyBudgetMet,
  createRecoveryObjective,
  isRecoveryObjectiveMet,
  createReplicationContract,
  isReplicationContractComplete,
  createFailureDomain,
  isFailureIsolated,
  createCell,
  isCellBoundaryValid,
  canContainBlastRadius,
  createMultiRegionArchitecture,
  isRegionalFailoverTested,
  createResilienceContract,
  isResilienceContractComplete,
} from "@/lib/enterprise-reliability";
import {
  capacityPlanId,
  autoscalingPolicyId,
  incidentId,
  scaleTestId,
  createCapacityPlan,
  projectPeakDemand,
  isHeadroomSufficient,
  forecastCapacity,
  createAutoscalingPolicy,
  isAutoscaleBounded,
  isScaleToZeroPermitted,
  createScaleTest,
  isProductionLikeTest,
  isCapacityCertified,
  createChaosExperiment,
  createIncident,
  canAdvanceIncident,
  createIncidentCommand,
  createAlert,
  resolveAlertSeverity,
  createRunbook,
  isRunbookAutomatable,
  createOperationalReadiness,
  isOperationallyReady,
  createCostAllocation,
  detectAbnormalCostGrowth,
  createCostCircuitBreaker,
  createPerformanceContract,
} from "@/lib/enterprise-operations";
import {
  provisioningRequestId,
  rolloutId,
  policyVersionId,
  configVersionId,
  bottleneckId,
  scaleChangeRecordId,
  scaleLimitId,
  createProvisioningRequest,
  canAdvanceProvisioning,
  isDeprovisioningStructured,
  createRolloutPlan,
  canAdvanceRollout,
  isProgressiveDelivery,
  createKillSwitch,
  isKillSwitchControlled,
  isRollbackStrategyDefined,
  isRollbackForwardCompatible,
  createPolicyVersion,
  canRolloutPolicy,
  isPolicyRollbackPossible,
  createConfigDistribution,
  isConfigVersionKnown,
  detectConfigDrift,
  createServiceCatalogEntry,
  isServiceOwned,
  declareServiceReadinessLevel,
  isEnterpriseReady,
  registerBottleneck,
  prioritizeBottlenecks,
  createScaleLimit,
  isLimitMonitored,
  createScaleChangeRecord,
  createMassEventControl,
  isMassEventControlled,
  createEventStormProtection,
  canAbsorbSurge,
  createRecoveryPriority,
  isRecoveryOrderValid,
  createAutonomyContract,
  canActAutonomously,
  isAutonomousScaleActionPermitted,
  createEngineeringContract,
  isDataOwnershipRespected,
  READINESS_LABELS,
} from "@/lib/enterprise-governance";

describe("enterprise-core — Workloads, pools & isolation (L, M, N, O)", () => {
  it("creates workloads and rejects unknown types", () => {
    expect(
      createWorkload({
        id: workloadId("w1"),
        name: "Attendance",
        type: "interactive",
        priorityClass: "critical",
      }).ok,
    ).toBe(true);
    expect(
      createWorkload({
        id: workloadId("w2"),
        name: "X",
        type: "hologram" as never,
        priorityClass: "normal",
      }).ok,
    ).toBe(false);
  });
  it("assigns workloads only to accepting pools", () => {
    const pool = createComputePool({
      id: computePoolId("p1"),
      name: "interactive",
      accepts: ["interactive"],
    });
    const w = createWorkload({
      id: workloadId("w1"),
      name: "Portal",
      type: "interactive",
      priorityClass: "critical",
    });
    const media = createWorkload({
      id: workloadId("w2"),
      name: "Render",
      type: "media",
      priorityClass: "background",
    });
    if (!pool.ok || !w.ok || !media.ok) throw new Error("expected ok");
    expect(assignWorkloadToPool(w.workload, pool.pool).ok).toBe(true);
    expect(assignWorkloadToPool(media.workload, pool.pool).ok).toBe(false);
  });
  it("isolates expensive workloads from critical interactive workloads", () => {
    const shared = createComputePool({
      id: computePoolId("p1"),
      name: "shared",
      accepts: ["interactive", "ai"],
    });
    const aiPool = createComputePool({ id: computePoolId("p2"), name: "ai", accepts: ["ai"] });
    const interactive = createWorkload({
      id: workloadId("w1"),
      name: "Portal",
      type: "interactive",
      priorityClass: "critical",
    });
    const ai = createWorkload({
      id: workloadId("w2"),
      name: "Batch",
      type: "ai",
      priorityClass: "background",
    });
    if (!shared.ok || !aiPool.ok || !interactive.ok || !ai.ok) throw new Error("expected ok");
    expect(
      isWorkloadIsolationSatisfied([
        { workload: interactive.workload, pool: shared.pool },
        { workload: ai.workload, pool: shared.pool },
      ]),
    ).toBe(false);
    expect(
      isWorkloadIsolationSatisfied([
        { workload: interactive.workload, pool: shared.pool },
        { workload: ai.workload, pool: aiPool.pool },
      ]),
    ).toBe(true);
  });
});

describe("enterprise-core — Scale dimensions, strategy & boundaries (E, F, G, H, I, J, K)", () => {
  it("flags dimensions whose projected load exceeds capacity", () => {
    const dim = createScaleDimension({
      name: "user",
      current: 1000,
      projected: 5000,
      capacity: 4000,
      unit: "users",
    });
    if (!dim.ok) throw new Error("expected ok");
    expect(isDimensionAtRisk(dim.dimension)).toBe(true);
    const safe = createScaleDimension({
      name: "user",
      current: 1000,
      projected: 3000,
      capacity: 4000,
      unit: "users",
    });
    if (!safe.ok) throw new Error("expected ok");
    expect(isDimensionAtRisk(safe.dimension)).toBe(false);
  });
  it("rejects vertical-only scaling without justification", () => {
    expect(createScalingStrategy({ service: "s1", horizontal: false, vertical: true }).ok).toBe(
      false,
    );
    expect(
      createScalingStrategy({
        service: "s1",
        horizontal: false,
        vertical: true,
        verticalOnlyJustification: "legacy database",
      }).ok,
    ).toBe(true);
    expect(createScalingStrategy({ service: "s1", horizontal: true, vertical: true }).ok).toBe(
      true,
    );
  });
  it("requires all six state-management dimensions", () => {
    expect(
      createStateContract({
        statefulSystem: "s1",
        ownership: "team-a",
        partitioning: "tenant",
        replication: "3x",
        consistency: "strong",
        recovery: "rpo-5m",
        migration: "rolling",
      }).ok,
    ).toBe(true);
    expect(
      createStateContract({
        statefulSystem: "s1",
        ownership: "team-a",
        partitioning: "tenant",
        replication: "3x",
        consistency: "strong",
        recovery: "rpo-5m",
        migration: "",
      }).ok,
    ).toBe(false);
  });
  it("requires service ownership at the boundary", () => {
    expect(createServiceBoundary({ service: "s1", owner: "team-a" }).ok).toBe(true);
    expect(createServiceBoundary({ service: "s1", owner: "" }).ok).toBe(false);
  });
});

describe("enterprise-capacity — Quotas & hierarchy (P, Q, R, S)", () => {
  it("rejects protected capacity beyond the quota limit", () => {
    expect(
      createQuota({
        id: quotaId("q1"),
        resource: "api_calls",
        scope: "tenant",
        limit: 100,
        protectedCapacity: 150,
      }).ok,
    ).toBe(false);
    expect(
      createQuota({
        id: quotaId("q2"),
        resource: "api_calls",
        scope: "tenant",
        limit: 100,
        protectedCapacity: 20,
      }).ok,
    ).toBe(true);
  });
  it("builds a hierarchy with one quota per scope", () => {
    const global = createQuota({
      id: quotaId("q3"),
      resource: "storage",
      scope: "global",
      limit: 1000000,
    });
    const tenant = createQuota({
      id: quotaId("q4"),
      resource: "storage",
      scope: "tenant",
      limit: 10000,
    });
    if (!global.ok || !tenant.ok) throw new Error("expected ok");
    expect(buildQuotaHierarchy([global.quota, tenant.quota], "storage").ok).toBe(true);
    expect(
      buildQuotaHierarchy(
        [global.quota, tenant.quota, { ...tenant.quota, id: quotaId("q5") }],
        "storage",
      ).ok,
    ).toBe(false);
  });
  it("applies parent limits to child scopes", () => {
    const global = createQuota({
      id: quotaId("q6"),
      resource: "api_calls",
      scope: "global",
      limit: 1000,
    });
    const inst = createQuota({
      id: quotaId("q7"),
      resource: "api_calls",
      scope: "institution",
      limit: 500,
    });
    if (!global.ok || !inst.ok) throw new Error("expected ok");
    const resolved = resolveEffectiveQuota([global.quota, inst.quota], "api_calls", "campus");
    if (!resolved.ok) throw new Error("expected ok");
    expect(resolved.limit).toBe(500);
    expect(resolved.sourceScope).toBe("institution");
  });
  it("enforces quotas while preserving protected capacity", () => {
    const quota = createQuota({
      id: quotaId("q8"),
      resource: "compute",
      scope: "tenant",
      limit: 100,
      protectedCapacity: 20,
    });
    if (!quota.ok) throw new Error("expected ok");
    expect(consumeQuota(quota.quota, 95, 10, false).ok).toBe(false);
    expect(consumeQuota(quota.quota, 15, 5, true).ok).toBe(true);
    expect(isQuotaExceeded(quota.quota, 101)).toBe(true);
  });
});

describe("enterprise-capacity — Rate limits, backpressure, queues, events (T, U, V, W, X-Z, AA, AB)", () => {
  it("enforces and adapts rate limits", () => {
    const policy = createRateLimitPolicy({
      id: "rl-1",
      scope: "tenant",
      limitPerMinute: 100,
      adaptive: true,
    });
    if (!policy.ok) throw new Error("expected ok");
    expect(isWithinRateLimit(policy.policy, 50)).toBe(true);
    expect(isWithinRateLimit(policy.policy, 150)).toBe(false);
    const adapted = adaptRateLimit(policy.policy, [{ factor: "traffic", severity: 1 }]);
    if (!adapted.ok) throw new Error("expected ok");
    expect(adapted.effectiveLimitPerMinute).toBe(50);
    expect(adaptRateLimit(policy.policy, [{ factor: "unknown" as never, severity: 1 }]).ok).toBe(
      false,
    );
  });
  it("never reduces adaptive limits to zero", () => {
    const policy = createRateLimitPolicy({
      id: "rl-2",
      scope: "api",
      limitPerMinute: 10,
      adaptive: true,
    });
    if (!policy.ok) throw new Error("expected ok");
    const adapted = adaptRateLimit(policy.policy, [
      { factor: "traffic", severity: 1 },
      { factor: "abuse_signal", severity: 1 },
      { factor: "system_health", severity: 1 },
      { factor: "resource_availability", severity: 1 },
      { factor: "tenant_tier", severity: 1 },
    ]);
    if (!adapted.ok) throw new Error("expected ok");
    expect(adapted.effectiveLimitPerMinute).toBe(1);
  });
  it("engages explicit backpressure instead of uncontrolled overload", () => {
    const queue = createBackpressureQueue({
      id: queueId("q1"),
      producer: "ingest",
      consumer: "worker",
      maxDepth: 100,
    });
    if (!queue.ok) throw new Error("expected ok");
    expect(isBackpressureEngaged(queue.queue)).toBe(false);
    const full = enqueue(queue.queue, 100);
    if (!full.ok) throw new Error("expected ok");
    expect(isBackpressureEngaged(full.queue)).toBe(true);
    expect(enqueue(queue.queue, 150).ok).toBe(false);
  });
  it("requires a complete queue architecture", () => {
    const arch = createQueueArchitecture({
      id: "qa-1",
      partitionable: true,
      retries: true,
      deadLetter: true,
      ordering: "key_ordered",
      visibilityTimeoutMs: 30000,
      replay: true,
      monitoring: true,
    });
    if (!arch.ok) throw new Error("expected ok");
    expect(isQueueArchitectureComplete(arch.architecture)).toBe(true);
    expect(
      createQueueArchitecture({
        id: "qa-2",
        partitionable: false,
        retries: false,
        deadLetter: false,
        ordering: "none",
        visibilityTimeoutMs: 0,
      }).ok,
    ).toBe(false);
  });
  it("does not impose global ordering where local ordering suffices", () => {
    expect(
      createEventStream({
        id: eventStreamId("e1"),
        name: "telemetry",
        partitionBy: "tenant",
        ordering: "global",
      }).ok,
    ).toBe(false);
    const local = createEventStream({
      id: eventStreamId("e2"),
      name: "telemetry",
      partitionBy: "tenant",
      ordering: "local",
    });
    const global = createEventStream({
      id: eventStreamId("e3"),
      name: "ledger",
      partitionBy: "entity",
      ordering: "global",
      globalOrderingJustification: "financial sequencing",
    });
    if (!local.ok || !global.ok) throw new Error("expected ok");
    expect(isOrderingAppropriate(local.stream)).toBe(true);
    expect(isOrderingAppropriate(global.stream)).toBe(true);
  });
  it("requires governed retention for controlled replay", () => {
    const stream = createEventStream({
      id: eventStreamId("e4"),
      name: "audit",
      partitionBy: "tenant",
      ordering: "local",
      retentionGoverned: true,
      replayEnabled: true,
    });
    if (!stream.ok) throw new Error("expected ok");
    expect(canReplayEventStream(stream.stream)).toBe(true);
    expect(isRetentionGoverned(stream.stream)).toBe(true);
  });
});

describe("enterprise-reliability — Consistency, idempotency & transactions (AM, AN, AQ, AR)", () => {
  it("keeps authoritative operations strongly consistent", () => {
    const contract = createConsistencyContract({
      operation: "transfer",
      model: "eventual",
      authoritative: true,
    });
    if (!contract.ok) throw new Error("expected ok");
    expect(isConsistencyAppropriate(contract.contract)).toBe(false);
    const ok = createConsistencyContract({
      operation: "feed",
      model: "eventual",
      authoritative: false,
    });
    if (!ok.ok) throw new Error("expected ok");
    expect(isConsistencyAppropriate(ok.contract)).toBe(true);
  });
  it("requires idempotency when duplicate delivery is possible", () => {
    expect(
      isIdempotencySatisfied({
        duplicateDeliveryPossible: true,
        idempotencyKeyPresent: false,
        deduplicationEnabled: true,
      }),
    ).toBe(false);
    expect(
      isIdempotencySatisfied({
        duplicateDeliveryPossible: true,
        idempotencyKeyPresent: true,
        deduplicationEnabled: true,
      }),
    ).toBe(true);
    expect(
      isIdempotencySatisfied({
        duplicateDeliveryPossible: false,
        idempotencyKeyPresent: false,
        deduplicationEnabled: false,
      }),
    ).toBe(true);
  });
  it("avoids unnecessary distributed transactions", () => {
    expect(
      createDistributedTransactionContract({
        operation: "onboard",
        pattern: "transactional_outbox",
        avoidsGlobalTx: false,
      }).ok,
    ).toBe(false);
    expect(createDistributedTransactionContract({ operation: "onboard", pattern: "saga" }).ok).toBe(
      true,
    );
  });
});

describe("enterprise-reliability — Tiers, SLO, error budgets & latency (BR, BT, BU, BW, BX)", () => {
  it("labels service tiers", () => {
    const tier = createServiceTier({
      service: "attendance",
      tier: 0,
      availabilityTargetPercent: 99.99,
      rtoMinutes: 5,
      rpoMinutes: 1,
    });
    if (!tier.ok) throw new Error("expected ok");
    expect(tier.tier.label).toBe("critical");
  });
  it("computes and exhausts error budgets", () => {
    const slo = createSlo({
      id: sloId("slo-1"),
      service: "portal",
      availabilityTargetPercent: 99.9,
      latencyTargetMs: 200,
      windowDays: 30,
    });
    if (!slo.ok) throw new Error("expected ok");
    expect(computeErrorBudgetMinutes(slo.slo, 99.8)).toBe(43);
    expect(isErrorBudgetExhausted(slo.slo, 99.5)).toBe(false);
    expect(isErrorBudgetExhausted(slo.slo, 99.95)).toBe(true);
  });
  it("manages tail latency across all buckets", () => {
    const budget = createLatencyBudget({
      service: "search",
      targets: { p50: 100, p90: 200, p95: 300, p99: 400, p99_9: 500 },
    });
    if (!budget.ok) throw new Error("expected ok");
    expect(
      isLatencyBudgetMet(budget.budget, { p50: 80, p90: 150, p95: 250, p99: 350, p99_9: 450 }),
    ).toBe(true);
    expect(
      isLatencyBudgetMet(budget.budget, { p50: 80, p90: 150, p95: 250, p99: 350, p99_9: 600 }),
    ).toBe(false);
    expect(createLatencyBudget({ service: "search", targets: { p50: 100 } as never }).ok).toBe(
      false,
    );
  });
});

describe("enterprise-reliability — RPO/RTO, replication, failure domains (BF, BG, BO, BP, BQ)", () => {
  it("checks recovery objectives", () => {
    const objective = createRecoveryObjective({
      workload: "ledger",
      rpoMinutes: 5,
      rtoMinutes: 30,
    });
    if (!objective.ok) throw new Error("expected ok");
    expect(isRecoveryObjectiveMet(objective.objective, 2, 15)).toBe(true);
    expect(isRecoveryObjectiveMet(objective.objective, 10, 15)).toBe(false);
  });
  it("requires complete replication contracts", () => {
    const contract = createReplicationContract({
      workload: "ledger",
      rpoMinutes: 5,
      rtoMinutes: 30,
      consistency: "strong",
      bandwidthProvisioned: true,
      costBounded: true,
    });
    if (!contract.ok) throw new Error("expected ok");
    expect(isReplicationContractComplete(contract.contract)).toBe(true);
  });
  it("isolates failure domains from the platform", () => {
    const zone = createFailureDomain({
      id: failureDomainId("fd-1"),
      level: "zone",
      scope: "zone-a",
    });
    if (!zone.ok) throw new Error("expected ok");
    expect(isFailureIsolated(zone.domain, "global")).toBe(true);
    expect(isFailureIsolated(zone.domain, "zone-a")).toBe(false);
  });
});

describe("enterprise-reliability — Cells, multi-region & resilience contracts (BH-BN, BB-BE)", () => {
  it("keeps cell boundaries consistent with business truth", () => {
    expect(
      createCell({ id: cellId("c1"), name: "cell-a", businessTruthConsistent: false }).ok,
    ).toBe(false);
    const cell = createCell({ id: cellId("c2"), name: "cell-a", workloadBound: true });
    if (!cell.ok) throw new Error("expected ok");
    expect(isCellBoundaryValid(cell.cell)).toBe(true);
    expect(canContainBlastRadius(cell.cell, "cell")).toBe(true);
  });
  it("requires two regions for active-active", () => {
    expect(
      createMultiRegionArchitecture({ service: "portal", mode: "active_active", regions: ["west"] })
        .ok,
    ).toBe(false);
    const arch = createMultiRegionArchitecture({
      service: "portal",
      mode: "active_passive",
      regions: ["west", "east"],
    });
    if (!arch.ok) throw new Error("expected ok");
    expect(isRegionalFailoverTested(arch.architecture)).toBe(false);
  });
  it("requires circuit breakers, bulkheads, and timeouts", () => {
    expect(
      createResilienceContract({ service: "billing", bulkhead: false, timeoutMs: 1000 }).ok,
    ).toBe(false);
    const contract = createResilienceContract({
      service: "billing",
      timeoutMs: 1000,
      deadlinePropagation: true,
    });
    if (!contract.ok) throw new Error("expected ok");
    expect(isResilienceContractComplete(contract.contract)).toBe(true);
  });
});

describe("enterprise-operations — Capacity planning, forecasting & headroom (CE, CF, CG)", () => {
  it("projects peak demand from growth, seasonality, and AI demand", () => {
    const plan = createCapacityPlan({
      id: capacityPlanId("cap-1"),
      workload: "exam-portal",
      historicalUsage: 1000,
      growthTrendPercent: 10,
      seasonalityPeakPercent: 20,
      aiDemandPercent: 10,
      currentCapacity: 2000,
      headroomPercent: 20,
    });
    if (!plan.ok) throw new Error("expected ok");
    expect(projectPeakDemand(plan.plan)).toBeCloseTo(1452);
  });
  it("determines whether headroom is sufficient", () => {
    const plan = createCapacityPlan({
      id: capacityPlanId("cap-2"),
      workload: "portal",
      historicalUsage: 1000,
      growthTrendPercent: 0,
      currentCapacity: 1000,
      headroomPercent: 20,
    });
    if (!plan.ok) throw new Error("expected ok");
    expect(isHeadroomSufficient(plan.plan, 800)).toBe(true);
    expect(isHeadroomSufficient(plan.plan, 900)).toBe(false);
  });
  it("forecasts required capacity", () => {
    const plan = createCapacityPlan({
      id: capacityPlanId("cap-3"),
      workload: "portal",
      historicalUsage: 1000,
      growthTrendPercent: 0,
      currentCapacity: 1000,
      headroomPercent: 20,
    });
    if (!plan.ok) throw new Error("expected ok");
    const forecast = forecastCapacity(plan.plan);
    expect(forecast.projectedDemand).toBe(1000);
    expect(forecast.requiredCapacity).toBe(1250);
    expect(forecast.sufficient).toBe(false);
  });
});

describe("enterprise-operations — Autoscaling (CH, CI, CJ, CK)", () => {
  it("binds autoscaling with min/max and budget limits", () => {
    const policy = createAutoscalingPolicy({
      id: autoscalingPolicyId("as-1"),
      service: "worker",
      metrics: ["queue_depth"],
      minInstances: 2,
      maxInstances: 20,
      tier: 3,
      budgetLimitMonthly: 1000,
    });
    if (!policy.ok) throw new Error("expected ok");
    expect(isAutoscaleBounded(policy.policy)).toBe(true);
    expect(
      createAutoscalingPolicy({
        id: autoscalingPolicyId("as-2"),
        service: "worker",
        metrics: ["cpu"],
        minInstances: 20,
        maxInstances: 2,
        tier: 3,
        budgetLimitMonthly: 1000,
      }).ok,
    ).toBe(false);
  });
  it("permits scale-to-zero only for noncritical workloads", () => {
    expect(
      createAutoscalingPolicy({
        id: autoscalingPolicyId("as-3"),
        service: "worker",
        metrics: ["cpu"],
        minInstances: 1,
        maxInstances: 5,
        scaleToZeroAllowed: true,
        tier: 0,
        budgetLimitMonthly: 100,
      }).ok,
    ).toBe(false);
    const ok = createAutoscalingPolicy({
      id: autoscalingPolicyId("as-4"),
      service: "reports",
      metrics: ["cpu"],
      minInstances: 1,
      maxInstances: 5,
      scaleToZeroAllowed: true,
      tier: 4,
      budgetLimitMonthly: 100,
    });
    if (!ok.ok) throw new Error("expected ok");
    expect(isScaleToZeroPermitted(ok.policy)).toBe(true);
  });
});

describe("enterprise-operations — Scale testing & chaos (BZ-CB, CC, GV, GW)", () => {
  it("certifies capacity only with evidence", () => {
    const test = createScaleTest({
      id: scaleTestId("t-1"),
      type: "load",
      target: "portal",
      peakLoad: 5000,
      passed: true,
      productionLike: true,
    });
    if (!test.ok) throw new Error("expected ok");
    expect(isProductionLikeTest(test.test)).toBe(true);
    expect(isCapacityCertified(test.test, 4000)).toBe(true);
    expect(isCapacityCertified(test.test, 6000)).toBe(false);
  });
  it("requires chaos experiments to be controlled", () => {
    expect(
      createChaosExperiment({
        id: "ch-1",
        target: "portal",
        failureType: "zone",
        controlled: false,
      }).ok,
    ).toBe(false);
    expect(createChaosExperiment({ id: "ch-2", target: "portal", failureType: "region" }).ok).toBe(
      true,
    );
  });
});

describe("enterprise-operations — Incidents, alerts & runbooks (EX, EY, EZ, GF, GG)", () => {
  it("advances incidents one stage at a time with command", () => {
    const incident = createIncident({ id: incidentId("inc-1"), title: "Exam portal degraded" });
    if (!incident.ok) throw new Error("expected ok");
    expect(incident.incident.stage).toBe("detected");
    expect(canAdvanceIncident("detected", "triaged")).toBe(true);
    expect(canAdvanceIncident("detected", "recovered")).toBe(false);
    expect(createIncidentCommand({ incidentRef: incidentId("inc-1"), commander: "cmd-1" }).ok).toBe(
      true,
    );
  });
  it("prioritizes alerts by impact", () => {
    expect(createAlert({ id: "al-1", title: "Breach", impacts: [] }).ok).toBe(false);
    expect(resolveAlertSeverity(["security"])).toBe("critical");
    expect(resolveAlertSeverity(["customer"])).toBe("critical");
    expect(resolveAlertSeverity(["business"])).toBe("high");
    expect(resolveAlertSeverity(["reliability"])).toBe("medium");
    expect(resolveAlertSeverity([])).toBe("low");
  });
  it("requires runbook steps and flags automatable runbooks", () => {
    expect(createRunbook({ id: "rb-1", target: "billing", steps: [] }).ok).toBe(false);
    const runbook = createRunbook({
      id: "rb-2",
      target: "billing",
      steps: ["drain", "restart"],
      automatable: true,
    });
    if (!runbook.ok) throw new Error("expected ok");
    expect(isRunbookAutomatable(runbook.runbook)).toBe(true);
  });
});

describe("enterprise-operations — Readiness, cost & performance contracts (GH, GI, CN, HW, HX, LU)", () => {
  it("passes operational readiness gates only when complete", () => {
    const allTrue = {
      scalability: true,
      reliability: true,
      observability: true,
      security: true,
      recovery: true,
      documentation: true,
      support: true,
      cost: true,
    };
    expect(createOperationalReadiness({ service: "billing", checks: allTrue }).ok).toBe(true);
    expect(
      createOperationalReadiness({
        service: "billing",
        checks: { ...allTrue, cost: undefined as never },
      }).ok,
    ).toBe(false);
    const ready = createOperationalReadiness({ service: "billing", checks: allTrue });
    if (!ready.ok) throw new Error("expected ok");
    expect(isOperationallyReady(ready.readiness)).toBe(true);
  });
  it("detects abnormal cost growth and binds cost circuit breakers", () => {
    const allocation = createCostAllocation({
      service: "ai",
      amount: 1000,
      dimension: "ai",
      dimensionRef: "tenant-a",
    });
    expect(allocation.ok).toBe(true);
    const growth = detectAbnormalCostGrowth(
      [
        { period: "2026-06", amount: 100 },
        { period: "2026-07", amount: 150 },
      ],
      20,
    );
    if (!growth.ok) throw new Error("expected ok");
    expect(growth.abnormal).toBe(true);
    expect(growth.growthPercent).toBe(50);
    expect(
      createCostCircuitBreaker({
        id: "cc-1",
        thresholdPercent: 50,
        actions: ["alert"],
        neverDisablesAuthoritative: false,
      }).ok,
    ).toBe(false);
  });
  it("requires a documented performance contract", () => {
    const contract = createPerformanceContract({
      service: "portal",
      expectedThroughputRps: 500,
      latencyTargetMs: 250,
      maxSupportedLoad: 5000,
      scalingStrategy: "horizontal",
      failureBehavior: "degrade",
    });
    expect(contract.ok).toBe(true);
    expect(
      createPerformanceContract({
        service: "portal",
        expectedThroughputRps: 0,
        latencyTargetMs: 250,
        maxSupportedLoad: 5000,
        scalingStrategy: "horizontal",
        failureBehavior: "degrade",
      }).ok,
    ).toBe(false);
  });
});

describe("enterprise-governance — Provisioning & deprovisioning (EE, EG, EH)", () => {
  it("advances provisioning one stage at a time", () => {
    const request = createProvisioningRequest({
      id: provisioningRequestId("pr-1"),
      entityType: "institution",
    });
    if (!request.ok) throw new Error("expected ok");
    expect(request.request.stage).toBe("requested");
    expect(canAdvanceProvisioning("requested", "validated")).toBe(true);
    expect(canAdvanceProvisioning("requested", "activated")).toBe(false);
  });
  it("requires structured deprovisioning", () => {
    expect(isDeprovisioningStructured({ hasWorkflow: true, hasAudit: true, resumable: true })).toBe(
      true,
    );
    expect(
      isDeprovisioningStructured({ hasWorkflow: true, hasAudit: false, resumable: true }),
    ).toBe(false);
  });
});

describe("enterprise-governance — Rollouts, kill switches & rollback (EJ, EK, EM, EO, EP, EQ)", () => {
  it("advances progressive delivery with a small canary", () => {
    const plan = createRolloutPlan({ id: rolloutId("ro-1"), feature: "new-exam-engine" });
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.plan.canaryPercent).toBe(5);
    expect(isProgressiveDelivery(plan.plan)).toBe(true);
    expect(canAdvanceRollout("internal", "canary")).toBe(true);
    expect(canAdvanceRollout("internal", "global")).toBe(false);
    expect(createRolloutPlan({ id: rolloutId("ro-2"), feature: "x", canaryPercent: 50 }).ok).toBe(
      false,
    );
  });
  it("requires controlled kill switches", () => {
    expect(createKillSwitch({ id: "ks-1", capability: "autopay", auditable: false }).ok).toBe(
      false,
    );
    const killSwitch = createKillSwitch({ id: "ks-2", capability: "autopay" });
    if (!killSwitch.ok) throw new Error("expected ok");
    expect(isKillSwitchControlled(killSwitch.killSwitch)).toBe(true);
  });
  it("requires rollback strategies and forward-compatible database changes", () => {
    expect(isRollbackStrategyDefined({ deployment: "v2", rollbackStrategy: "revert-image" })).toBe(
      true,
    );
    expect(isRollbackStrategyDefined({ deployment: "v2", rollbackStrategy: "" })).toBe(false);
    expect(
      isRollbackForwardCompatible({ databaseChanges: ["add column"], forwardCompatible: false }),
    ).toBe(false);
    expect(isRollbackForwardCompatible({ databaseChanges: [], forwardCompatible: false })).toBe(
      true,
    );
  });
});

describe("enterprise-governance — Policy & configuration versioning (FV, FW, FX, FZ, GA, GB)", () => {
  it("versioned policies must be reversible", () => {
    expect(
      createPolicyVersion({
        id: policyVersionId("pv-1"),
        policy: "data-retention",
        version: 2,
        rolloutMode: "canary",
        reversible: false,
      }).ok,
    ).toBe(false);
    const version = createPolicyVersion({
      id: policyVersionId("pv-2"),
      policy: "data-retention",
      version: 2,
      rolloutMode: "staged",
      reversible: true,
    });
    if (!version.ok) throw new Error("expected ok");
    expect(canRolloutPolicy(version.version)).toBe(true);
    expect(isPolicyRollbackPossible(version.version)).toBe(true);
  });
  it("detects configuration drift", () => {
    const dist = createConfigDistribution({
      id: configVersionId("cd-1"),
      configKey: "feature.ratio",
      version: 3,
    });
    if (!dist.ok) throw new Error("expected ok");
    expect(isConfigVersionKnown([dist.distribution], "feature.ratio", 3)).toBe(true);
    expect(isConfigVersionKnown([dist.distribution], "feature.ratio", 2)).toBe(false);
    const drift = detectConfigDrift(
      [
        { configKey: "a", version: 2 },
        { configKey: "b", version: 1 },
      ],
      [{ configKey: "a", version: 1 }],
    );
    expect(drift).toEqual(["a", "b"]);
  });
});

describe("enterprise-governance — Service catalog, readiness & bottlenecks (GD, GE, LW, LX, MD, ME)", () => {
  it("registers owned services in the catalog", () => {
    const entry = createServiceCatalogEntry({
      id: "cat-1",
      service: "billing",
      owner: "fin-team",
      purpose: "invoicing",
      sloRef: "slo-1",
      dataClassification: "CONFIDENTIAL",
      scalingModel: "horizontal",
      recoveryModel: "rpo-5m",
    });
    if (!entry.ok) throw new Error("expected ok");
    expect(isServiceOwned(entry.entry)).toBe(true);
    expect(
      createServiceCatalogEntry({
        id: "cat-2",
        service: "billing",
        owner: "",
        purpose: "invoicing",
        sloRef: "slo-1",
        dataClassification: "CONFIDENTIAL",
        scalingModel: "horizontal",
        recoveryModel: "rpo-5m",
      }).ok,
    ).toBe(false);
  });
  it("labels readiness levels with evidence", () => {
    const level = declareServiceReadinessLevel({ service: "billing", level: 4 });
    if (!level.ok) throw new Error("expected ok");
    expect(READINESS_LABELS[level.readiness.level]).toBe("enterprise_ready");
    expect(isEnterpriseReady(level.readiness)).toBe(true);
    const lvl2 = declareServiceReadinessLevel({ service: "billing", level: 2 });
    if (!lvl2.ok) throw new Error("expected ok");
    expect(isEnterpriseReady(lvl2.readiness)).toBe(false);
  });
  it("registers and prioritizes bottlenecks", () => {
    const a = registerBottleneck({
      id: bottleneckId("bn-1"),
      system: "reporting",
      description: "single-threaded export",
      customerImpact: 8,
      growthRate: 7,
      failureRisk: 5,
      cost: 4,
      strategicImportance: 6,
    });
    const b = registerBottleneck({
      id: bottleneckId("bn-2"),
      system: "search",
      description: "unsharded index",
      customerImpact: 5,
      growthRate: 6,
      failureRisk: 9,
      cost: 3,
      strategicImportance: 4,
    });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    const ranked = prioritizeBottlenecks([b.bottleneck, a.bottleneck]);
    expect(ranked[0].system).toBe("reporting");
    expect(
      registerBottleneck({
        id: bottleneckId("bn-3"),
        system: "x",
        description: "y",
        customerImpact: 11,
        growthRate: 1,
        failureRisk: 1,
        cost: 1,
        strategicImportance: 1,
      }).ok,
    ).toBe(false);
  });
});

describe("enterprise-governance — Scale limits, change records & mass events (QE, QF, PV, RJ-RN, RR, RT)", () => {
  it("monitors scale limits and records governed changes", () => {
    const limit = createScaleLimit({
      id: scaleLimitId("sl-1"),
      dimension: "concurrent_users",
      limit: 100000,
      monitored: true,
    });
    if (!limit.ok) throw new Error("expected ok");
    expect(isLimitMonitored(limit.limit)).toBe(true);
    expect(
      createScaleChangeRecord({
        id: scaleChangeRecordId("cr-1"),
        change: "add region",
        approvedBy: "sre-lead",
        recordedAt: "2026-08-28T00:00:00Z",
      }).ok,
    ).toBe(true);
  });
  it("controls mass events within thresholds", () => {
    const login = createMassEventControl({
      id: "me-1",
      eventType: "login",
      threshold: 10000,
      controlled: true,
    });
    if (!login.ok) throw new Error("expected ok");
    expect(isMassEventControlled(login.control, 5000)).toBe(true);
    expect(isMassEventControlled(login.control, 15000)).toBe(false);
  });
  it("absorbs event storms without starving critical events", () => {
    const protection = createEventStormProtection({
      id: "es-1",
      sink: "dead-letter",
      absorbsSurge: true,
      protectsCritical: true,
      alertsOnStorm: true,
    });
    if (!protection.ok) throw new Error("expected ok");
    expect(canAbsorbSurge(protection.protection)).toBe(true);
  });
});

describe("enterprise-governance — Recovery ordering (RV, RW)", () => {
  it("recovers dependencies before dependents", () => {
    const db = createRecoveryPriority({ workload: "db", priority: 1 });
    const api = createRecoveryPriority({ workload: "api", priority: 2, dependencyRefs: ["db"] });
    const web = createRecoveryPriority({ workload: "web", priority: 3, dependencyRefs: ["api"] });
    if (!db.ok || !api.ok || !web.ok) throw new Error("expected ok");
    expect(isRecoveryOrderValid([db.priority, api.priority, web.priority])).toBe(true);
    // A workload cannot depend on something recovered later than itself.
    const bad = createRecoveryPriority({ workload: "web2", priority: 1, dependencyRefs: ["api"] });
    if (!bad.ok) throw new Error("expected ok");
    expect(isRecoveryOrderValid([db.priority, api.priority, bad.priority])).toBe(false);
    expect(
      isRecoveryOrderValid([
        db.priority,
        api.priority,
        { ...web.priority, dependencyRefs: ["missing"] },
      ]),
    ).toBe(false);
  });
});

describe("enterprise-governance — Autonomy & engineering contracts (SL, SM, SN, SE-SI)", () => {
  it("binds autonomous control loops with safety properties", () => {
    expect(
      createAutonomyContract({
        id: "au-1",
        scope: "autoscale",
        level: "autonomous",
        boundedActions: false,
      }).ok,
    ).toBe(false);
    const contract = createAutonomyContract({
      id: "au-2",
      scope: "autoscale",
      level: "limited_autonomous",
      boundedActions: true,
      observableOutcomes: true,
      rollbackAvailable: true,
      authorizationRequired: true,
      failureLimits: true,
    });
    if (!contract.ok) throw new Error("expected ok");
    expect(canActAutonomously(contract.contract)).toBe(true);
    expect(isAutonomousScaleActionPermitted(contract.contract, false)).toBe(true);
    expect(isAutonomousScaleActionPermitted(contract.contract, true)).toBe(false);
  });
  it("never accesses data a service does not own", () => {
    expect(
      createEngineeringContract({
        service: "hr",
        apiSurface: ["GET /employee"],
        events: ["employee.updated"],
        dataOwned: ["employee"],
        dataNotOwned: ["salary"],
      }).ok,
    ).toBe(true);
    const contract = createEngineeringContract({
      service: "hr",
      apiSurface: [],
      events: [],
      dataOwned: ["employee"],
      dataNotOwned: ["salary"],
    });
    if (!contract.ok) throw new Error("expected ok");
    expect(isDataOwnershipRespected(contract.contract, ["employee"])).toBe(true);
    expect(isDataOwnershipRespected(contract.contract, ["salary"])).toBe(false);
    expect(
      createEngineeringContract({
        service: "hr",
        apiSurface: [],
        events: [],
        dataOwned: ["salary"],
        dataNotOwned: ["salary"],
      }).ok,
    ).toBe(false);
  });
});
