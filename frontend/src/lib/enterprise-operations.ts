/**
 * CoreGrid Enterprise Operations — capacity planning, forecasting, headroom,
 * autoscaling, cost governance, scale testing, chaos engineering, incident
 * management, alerting, runbooks, operational readiness, and performance
 * contracts.
 *
 * Implements `architecture/phase-31-enterprise-scale.md`:
 * - Capacity planning (CE) combining historical usage, growth trends,
 *   seasonality, planned launches, AI demand, data growth, geographic
 *   expansion; capacity forecasting (CF); headroom (CG).
 * - Autoscaling (CH): CPU, memory, request-rate, queue-depth, custom-metric;
 *   predictive autoscaling (CI); scale-to-zero (CJ) only for noncritical
 *   workloads; bounded scale limits (CK) to prevent runaway cost.
 * - Cost governance (CL), FinOps boundary (CM) — Phase 13 owns financial
 *   truth — cost allocation (CN), cost visibility (CO), resource efficiency
 *   (CP).
 * - Load (BZ), stress (CA), soak (CB), chaos (CC), disaster simulation (CD);
 *   production-like testing (GV); capacity certification (GW).
 * - Alerting (EX) prioritizing customer, business, security, reliability
 *   impact; incident management (EY) with explicit command (EZ).
 * - Runbooks (GF), automated runbooks (GG), operational readiness (GH/GI).
 * - Performance contract (LU): throughput, latency targets, maximum
 *   supported load, scaling strategy, failure behavior.
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type CapacityPlanId = string & { readonly __brand: "CapacityPlanId" };
export type AutoscalingPolicyId = string & { readonly __brand: "AutoscalingPolicyId" };
export type IncidentId = string & { readonly __brand: "IncidentId" };
export type ScaleTestId = string & { readonly __brand: "ScaleTestId" };

export function capacityPlanId(raw: string): CapacityPlanId {
  return raw as CapacityPlanId;
}
export function autoscalingPolicyId(raw: string): AutoscalingPolicyId {
  return raw as AutoscalingPolicyId;
}
export function incidentId(raw: string): IncidentId {
  return raw as IncidentId;
}
export function scaleTestId(raw: string): ScaleTestId {
  return raw as ScaleTestId;
}

/* ─────────────────────────────────────────────────────────────
 * Capacity planning + headroom (Sections CE, CF, CG)
 * ────────────────────────────────────────────────────────────*/

export interface CapacityPlan {
  id: CapacityPlanId;
  workload: string;
  historicalUsage: number;
  growthTrendPercent: number;
  seasonalityPeakPercent: number;
  aiDemandPercent: number;
  dataGrowthPercent: number;
  plannedLaunches: number;
  geographicExpansion: boolean;
  currentCapacity: number;
  headroomPercent: number;
}

export function createCapacityPlan(input: {
  id: CapacityPlanId;
  workload: string;
  historicalUsage: number;
  growthTrendPercent: number;
  seasonalityPeakPercent?: number;
  aiDemandPercent?: number;
  dataGrowthPercent?: number;
  plannedLaunches?: number;
  geographicExpansion?: boolean;
  currentCapacity: number;
  headroomPercent: number;
}): { ok: true; plan: CapacityPlan } | { ok: false; error: string } {
  if (!input.workload.trim())
    return { ok: false, error: "Capacity plan workload is required (Section CE)" };
  if (input.historicalUsage < 0)
    return { ok: false, error: "Historical usage must be non-negative (Section CE)" };
  if (input.currentCapacity <= 0)
    return { ok: false, error: "Current capacity must be positive (Section CE)" };
  if (input.headroomPercent < 0)
    return { ok: false, error: "Headroom percentage must be non-negative (Section CG)" };
  return {
    ok: true,
    plan: {
      id: input.id,
      workload: input.workload,
      historicalUsage: input.historicalUsage,
      growthTrendPercent: input.growthTrendPercent,
      seasonalityPeakPercent: input.seasonalityPeakPercent ?? 0,
      aiDemandPercent: input.aiDemandPercent ?? 0,
      dataGrowthPercent: input.dataGrowthPercent ?? 0,
      plannedLaunches: input.plannedLaunches ?? 0,
      geographicExpansion: input.geographicExpansion ?? false,
      currentCapacity: input.currentCapacity,
      headroomPercent: input.headroomPercent,
    },
  };
}

export function projectPeakDemand(plan: CapacityPlan): number {
  const growthFactor = 1 + plan.growthTrendPercent / 100;
  const seasonalityFactor = 1 + plan.seasonalityPeakPercent / 100;
  const aiFactor = 1 + plan.aiDemandPercent / 100;
  const dataFactor = 1 + plan.dataGrowthPercent / 100;
  const launchDemand = plan.plannedLaunches * (plan.geographicExpansion ? 1.5 : 1);
  return (
    plan.historicalUsage * growthFactor * seasonalityFactor * aiFactor * dataFactor + launchDemand
  );
}

// Section CG: critical systems must maintain sufficient capacity headroom.
export function isHeadroomSufficient(plan: CapacityPlan, projectedDemand: number): boolean {
  if (projectedDemand >= plan.currentCapacity) return false;
  const headroom = ((plan.currentCapacity - projectedDemand) / plan.currentCapacity) * 100;
  return headroom >= plan.headroomPercent;
}

export function forecastCapacity(plan: CapacityPlan): {
  ok: true;
  projectedDemand: number;
  requiredCapacity: number;
  sufficient: boolean;
} {
  const projectedDemand = projectPeakDemand(plan);
  const requiredCapacity = projectedDemand / (1 - plan.headroomPercent / 100);
  return {
    ok: true,
    projectedDemand,
    requiredCapacity,
    sufficient: plan.currentCapacity >= requiredCapacity,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Autoscaling (Sections CH, CI, CJ, CK)
 * ────────────────────────────────────────────────────────────*/

export type AutoscaleMetric = "cpu" | "memory" | "request_rate" | "queue_depth" | "custom";

export interface AutoscalingPolicy {
  id: AutoscalingPolicyId;
  service: string;
  metrics: AutoscaleMetric[];
  minInstances: number;
  maxInstances: number;
  scaleToZeroAllowed: boolean;
  tier: number;
  budgetLimitMonthly: number;
}

export function createAutoscalingPolicy(input: {
  id: AutoscalingPolicyId;
  service: string;
  metrics: AutoscaleMetric[];
  minInstances: number;
  maxInstances: number;
  scaleToZeroAllowed?: boolean;
  tier: number;
  budgetLimitMonthly: number;
}): { ok: true; policy: AutoscalingPolicy } | { ok: false; error: string } {
  if (!input.service.trim())
    return { ok: false, error: "Autoscaling service is required (Section CH)" };
  if (input.metrics.length === 0)
    return { ok: false, error: "At least one autoscaling metric is required (Section CH)" };
  if (
    input.minInstances <= 0 ||
    input.maxInstances <= 0 ||
    input.minInstances > input.maxInstances
  ) {
    return { ok: false, error: "Autoscaling bounds must satisfy 0 < min <= max (Section CK)" };
  }
  if (input.budgetLimitMonthly <= 0) {
    return { ok: false, error: "Autoscaling budget limit is required (Section CK)" };
  }
  // Section CJ: scale-to-zero is only suitable for noncritical workloads.
  if (input.scaleToZeroAllowed === true && input.tier < 3) {
    return {
      ok: false,
      error: "Scale-to-zero is only permitted for noncritical workloads (Section CJ)",
    };
  }
  return {
    ok: true,
    policy: {
      id: input.id,
      service: input.service,
      metrics: input.metrics,
      minInstances: input.minInstances,
      maxInstances: input.maxInstances,
      scaleToZeroAllowed: input.scaleToZeroAllowed ?? false,
      tier: input.tier,
      budgetLimitMonthly: input.budgetLimitMonthly,
    },
  };
}

// Section CK: autoscaling must have upper limits to prevent runaway cost.
export function isAutoscaleBounded(policy: AutoscalingPolicy): boolean {
  return policy.maxInstances > 0 && policy.budgetLimitMonthly > 0;
}

export function isScaleToZeroPermitted(policy: AutoscalingPolicy): boolean {
  return policy.scaleToZeroAllowed && policy.tier >= 3;
}

/* ─────────────────────────────────────────────────────────────
 * Scale testing (Sections BZ, CA, CB, CC, GV, GW)
 * ────────────────────────────────────────────────────────────*/

export type ScaleTestType = "load" | "stress" | "soak" | "chaos";

export interface ScaleTest {
  id: ScaleTestId;
  type: ScaleTestType;
  target: string;
  productionLike: boolean;
  peakLoad: number;
  passed: boolean;
}

export function createScaleTest(input: {
  id: ScaleTestId;
  type: ScaleTestType;
  target: string;
  peakLoad: number;
  passed?: boolean;
  productionLike?: boolean;
}): { ok: true; test: ScaleTest } | { ok: false; error: string } {
  if (!input.target.trim())
    return { ok: false, error: "Scale test target is required (Section BZ)" };
  if (!["load", "stress", "soak", "chaos"].includes(input.type)) {
    return { ok: false, error: "Unknown scale test type (Section BZ)" };
  }
  if (input.peakLoad < 0)
    return { ok: false, error: "Scale test peak load must be non-negative (Section BZ)" };
  return {
    ok: true,
    test: {
      id: input.id,
      type: input.type,
      target: input.target,
      productionLike: input.productionLike ?? false,
      peakLoad: input.peakLoad,
      passed: input.passed ?? false,
    },
  };
}

// Section GV: load testing must simulate realistic enterprise traffic.
export function isProductionLikeTest(test: ScaleTest): boolean {
  return test.productionLike;
}

// Section GW: capacity certification requires evidence, not claims.
export function isCapacityCertified(test: ScaleTest, requiredLoad: number): boolean {
  return test.passed && test.peakLoad >= requiredLoad;
}

export interface ChaosExperiment {
  id: string;
  target: string;
  failureType: "service" | "zone" | "region" | "dependency" | "network" | "storage";
  controlled: boolean;
}

// Section CC: chaos engineering must be a controlled failure experiment.
export function createChaosExperiment(input: {
  id: string;
  target: string;
  failureType: ChaosExperiment["failureType"];
  controlled?: boolean;
}): { ok: true; experiment: ChaosExperiment } | { ok: false; error: string } {
  if (!input.target.trim())
    return { ok: false, error: "Chaos experiment target is required (Section CC)" };
  if (input.controlled === false) {
    return { ok: false, error: "Chaos experiments must be controlled (Section CC)" };
  }
  return {
    ok: true,
    experiment: {
      id: input.id,
      target: input.target,
      failureType: input.failureType,
      controlled: true,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Incidents + command (Sections EY, EZ)
 * ────────────────────────────────────────────────────────────*/

export type IncidentStage =
  "detected" | "triaged" | "assigned" | "mitigated" | "recovered" | "reviewed" | "improved";

export const INCIDENT_STAGES: readonly IncidentStage[] = [
  "detected",
  "triaged",
  "assigned",
  "mitigated",
  "recovered",
  "reviewed",
  "improved",
] as const;

export interface Incident {
  id: IncidentId;
  title: string;
  stage: IncidentStage;
}

export function createIncident(input: {
  id: IncidentId;
  title: string;
}): { ok: true; incident: Incident } | { ok: false; error: string } {
  if (!input.title.trim()) return { ok: false, error: "Incident title is required (Section EY)" };
  return { ok: true, incident: { id: input.id, title: input.title, stage: "detected" } };
}

export function canAdvanceIncident(current: IncidentStage, next: IncidentStage): boolean {
  const from = INCIDENT_STAGES.indexOf(current);
  const to = INCIDENT_STAGES.indexOf(next);
  return from >= 0 && to === from + 1;
}

// Section EZ: large incidents require explicit command structures.
export function createIncidentCommand(input: {
  incidentRef: IncidentId;
  commander: string;
}):
  | { ok: true; command: { incidentRef: IncidentId; commander: string } }
  | { ok: false; error: string } {
  if (!input.commander.trim())
    return { ok: false, error: "Incident commander is required (Section EZ)" };
  return { ok: true, command: { incidentRef: input.incidentRef, commander: input.commander } };
}

/* ─────────────────────────────────────────────────────────────
 * Alerting (Section EX)
 * ────────────────────────────────────────────────────────────*/

export type AlertImpact = "customer" | "business" | "security" | "reliability";

export interface Alert {
  id: string;
  title: string;
  impacts: AlertImpact[];
}

export function createAlert(input: {
  id: string;
  title: string;
  impacts: AlertImpact[];
}): { ok: true; alert: Alert } | { ok: false; error: string } {
  if (!input.title.trim()) return { ok: false, error: "Alert title is required (Section EX)" };
  if (input.impacts.length === 0) {
    return { ok: false, error: "Alert must declare at least one impact (Section EX)" };
  }
  return { ok: true, alert: { id: input.id, title: input.title, impacts: input.impacts } };
}

// Section EX: alerts prioritize customer, business, security, reliability.
export function resolveAlertSeverity(
  impacts: AlertImpact[],
): "critical" | "high" | "medium" | "low" {
  if (impacts.includes("security")) return "critical";
  if (impacts.includes("customer")) return "critical";
  if (impacts.includes("business")) return "high";
  if (impacts.includes("reliability")) return "medium";
  return "low";
}

/* ─────────────────────────────────────────────────────────────
 * Runbooks + operational readiness (Sections GF, GG, GH, GI)
 * ────────────────────────────────────────────────────────────*/

export interface Runbook {
  id: string;
  target: string;
  steps: string[];
  automatable: boolean;
}

export function createRunbook(input: {
  id: string;
  target: string;
  steps: string[];
  automatable?: boolean;
}): { ok: true; runbook: Runbook } | { ok: false; error: string } {
  if (!input.target.trim()) return { ok: false, error: "Runbook target is required (Section GF)" };
  if (input.steps.length === 0)
    return { ok: false, error: "Runbook requires at least one step (Section GF)" };
  return {
    ok: true,
    runbook: {
      id: input.id,
      target: input.target,
      steps: input.steps,
      automatable: input.automatable ?? false,
    },
  };
}

// Section GG: safe operational procedures should be automatable.
export function isRunbookAutomatable(runbook: Runbook): boolean {
  return runbook.automatable;
}

export const READINESS_CHECKLIST_ITEMS: readonly string[] = [
  "scalability",
  "reliability",
  "observability",
  "security",
  "recovery",
  "documentation",
  "support",
  "cost",
] as const;

export interface OperationalReadiness {
  service: string;
  checks: Record<string, boolean>;
}

export function createOperationalReadiness(input: {
  service: string;
  checks: Record<string, boolean>;
}): { ok: true; readiness: OperationalReadiness } | { ok: false; error: string } {
  if (!input.service.trim())
    return { ok: false, error: "Readiness service is required (Section GH)" };
  for (const item of READINESS_CHECKLIST_ITEMS) {
    if (input.checks[item] === undefined) {
      return { ok: false, error: `Readiness checklist item "${item}" is missing (Section GI)` };
    }
  }
  return { ok: true, readiness: { service: input.service, checks: input.checks } };
}

// Section GH: a service must pass readiness gates before enterprise deployment.
export function isOperationallyReady(readiness: OperationalReadiness): boolean {
  return READINESS_CHECKLIST_ITEMS.every((item) => readiness.checks[item] === true);
}

/* ─────────────────────────────────────────────────────────────
 * Cost governance (Sections CL, CM, CN, CP, HW, HX)
 * ────────────────────────────────────────────────────────────*/

export type CostAllocationDimension =
  "tenant" | "institution" | "service" | "region" | "workload" | "ai";

export interface CostAllocation {
  service: string;
  amount: number;
  dimension: CostAllocationDimension;
  dimensionRef: string;
}

export function createCostAllocation(input: {
  service: string;
  amount: number;
  dimension: CostAllocationDimension;
  dimensionRef: string;
}): { ok: true; allocation: CostAllocation } | { ok: false; error: string } {
  if (!input.service.trim())
    return { ok: false, error: "Cost allocation service is required (Section CN)" };
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    return { ok: false, error: "Cost allocation amount must be non-negative (Section CN)" };
  }
  return {
    ok: true,
    allocation: {
      service: input.service,
      amount: input.amount,
      dimension: input.dimension,
      dimensionRef: input.dimensionRef,
    },
  };
}

// Section HW: detect abnormal cost growth.
export function detectAbnormalCostGrowth(
  history: { period: string; amount: number }[],
  thresholdPercent: number,
): { ok: true; abnormal: boolean; growthPercent: number } | { ok: false; error: string } {
  if (history.length < 2)
    return { ok: false, error: "Cost history requires at least two periods (Section HW)" };
  if (thresholdPercent < 0)
    return { ok: false, error: "Cost threshold must be non-negative (Section HW)" };
  const sorted = [...history].sort((a, b) => a.period.localeCompare(b.period));
  const previous = sorted[sorted.length - 2].amount;
  const latest = sorted[sorted.length - 1].amount;
  if (previous === 0) return { ok: true, abnormal: latest > 0, growthPercent: 100 };
  const growthPercent = ((latest - previous) / previous) * 100;
  return { ok: true, abnormal: growthPercent > thresholdPercent, growthPercent };
}

export interface CostCircuitBreaker {
  id: string;
  thresholdPercent: number;
  actions: ("alert" | "throttle" | "require_approval" | "reduce_workload")[];
  neverDisablesAuthoritative: boolean;
}

// Section HX: cost thresholds may trigger alerts/throttling/approval/workload
// reduction without silently disabling authoritative business processes.
export function createCostCircuitBreaker(input: {
  id: string;
  thresholdPercent: number;
  actions: CostCircuitBreaker["actions"];
  neverDisablesAuthoritative?: boolean;
}): { ok: true; breaker: CostCircuitBreaker } | { ok: false; error: string } {
  if (!Number.isFinite(input.thresholdPercent) || input.thresholdPercent <= 0) {
    return { ok: false, error: "Cost circuit breaker threshold must be positive (Section HX)" };
  }
  if (input.actions.length === 0) {
    return { ok: false, error: "Cost circuit breaker requires at least one action (Section HX)" };
  }
  if (input.neverDisablesAuthoritative === false) {
    return {
      ok: false,
      error:
        "Cost controls must never silently disable authoritative business processes (Section HX)",
    };
  }
  return {
    ok: true,
    breaker: {
      id: input.id,
      thresholdPercent: input.thresholdPercent,
      actions: input.actions,
      neverDisablesAuthoritative: true,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Performance contract (Section LU)
 * ────────────────────────────────────────────────────────────*/

export interface PerformanceContract {
  service: string;
  expectedThroughputRps: number;
  latencyTargetMs: number;
  maxSupportedLoad: number;
  scalingStrategy: string;
  failureBehavior: string;
}

export function createPerformanceContract(input: {
  service: string;
  expectedThroughputRps: number;
  latencyTargetMs: number;
  maxSupportedLoad: number;
  scalingStrategy: string;
  failureBehavior: string;
}): { ok: true; contract: PerformanceContract } | { ok: false; error: string } {
  if (!input.service.trim())
    return { ok: false, error: "Performance contract service is required (Section LU)" };
  if (
    input.expectedThroughputRps <= 0 ||
    input.latencyTargetMs <= 0 ||
    input.maxSupportedLoad <= 0
  ) {
    return {
      ok: false,
      error: "Performance contract requires positive throughput, latency, and load (Section LU)",
    };
  }
  if (!input.scalingStrategy.trim() || !input.failureBehavior.trim()) {
    return {
      ok: false,
      error: "Performance contract requires a scaling strategy and failure behavior (Section LU)",
    };
  }
  return { ok: true, contract: { ...input } };
}
