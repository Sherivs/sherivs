/**
 * CoreGrid Evolution Experiments — innovation sandbox, controlled
 * experiments, A/B testing, progressive rollout, canary deployment, feature
 * flags, and tenant-safe experimentation.
 *
 * Implements `architecture/phase-32-future-evolution.md`:
 * - Innovation sandbox (J): isolated experimentation environments for
 *   experimental APIs, agents, models, interfaces, workflows, devices, data
 *   pipelines, synthetic data, simulated institutions, synthetic users, and
 *   simulated infrastructure — sandbox activity must never modify production
 *   state.
 * - Experimentation framework (AI): hypothesis, baseline, treatment, success
 *   and failure criteria, measurement plan, sample population, risk
 *   classification, rollback plan, owner, expiry date.
 * - A/B testing (AJ): interfaces, workflows, AI models, recommendation
 *   strategies, learning experiences, operational processes; high-impact
 *   experiments require additional governance.
 * - Progressive rollout (AG): Sandbox → Internal → Pilot → Limited
 *   Production → Expanded Production → General Availability, evidence-driven.
 * - Canary deployment (AH): monitors error rates, latency, resource
 *   consumption, user behavior, security events, AI quality, workflow
 *   failures, and data anomalies with automatic rollback where appropriate.
 * - Feature flags (AF): tenant/role/geography/device/cohort/percentage/
 *   capability gates/emergency disablement with ownership and lifecycle
 *   metadata.
 * - Tenant isolation during experimentation (DI): tenant cohorts, opt-in,
 *   opt-out, isolated configuration, segmentation, emergency disablement —
 *   experiments never accidentally affect unrelated tenants.
 * - Failure management (CY): failure is acceptable, uncontrolled failure is
 *   not; failed experiments are documented, analyzed, isolated, archived, and
 *   converted into engineering knowledge; experiment reuse (CZ).
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type SandboxId = string & { readonly __brand: "SandboxId" };
export type ExperimentId = string & { readonly __brand: "ExperimentId" };
export type RolloutId = string & { readonly __brand: "RolloutId" };

export function sandboxId(raw: string): SandboxId {
  return raw as SandboxId;
}
export function experimentId(raw: string): ExperimentId {
  return raw as ExperimentId;
}
export function rolloutId(raw: string): RolloutId {
  return raw as RolloutId;
}

/* ─────────────────────────────────────────────────────────────
 * Innovation sandbox (Section J)
 * ────────────────────────────────────────────────────────────*/

export interface InnovationSandbox {
  id: SandboxId;
  name: string;
  productionIsolated: boolean;
  syntheticDataAllowed: boolean;
}

export function createInnovationSandbox(input: {
  id: SandboxId;
  name: string;
  syntheticDataAllowed?: boolean;
}): { ok: true; sandbox: InnovationSandbox } | { ok: false; error: string } {
  if (!input.name.trim()) return { ok: false, error: "Sandbox name is required (Section J)" };
  return {
    ok: true,
    sandbox: {
      id: input.id,
      name: input.name,
      productionIsolated: true,
      syntheticDataAllowed: input.syntheticDataAllowed ?? false,
    },
  };
}

// Section J: sandbox activity must not modify production state.
export function isSandboxProductionIsolated(sandbox: InnovationSandbox): boolean {
  return sandbox.productionIsolated;
}

/* ─────────────────────────────────────────────────────────────
 * Experimentation framework (Section AI)
 * ────────────────────────────────────────────────────────────*/

export interface Experiment {
  id: ExperimentId;
  name: string;
  hypothesis: string;
  baseline: string;
  treatment: string;
  successCriteria: string;
  failureCriteria: string;
  measurementPlan: string;
  samplePopulation: string;
  riskClassification: "low" | "medium" | "high" | "critical";
  rollbackPlan: string;
  owner: string;
  expiryDate: string;
}

export function createExperiment(input: {
  id: ExperimentId;
  name: string;
  hypothesis: string;
  baseline: string;
  treatment: string;
  successCriteria: string;
  failureCriteria: string;
  measurementPlan: string;
  samplePopulation: string;
  riskClassification: Experiment["riskClassification"];
  rollbackPlan: string;
  owner: string;
  expiryDate: string;
}): { ok: true; experiment: Experiment } | { ok: false; error: string } {
  if (!input.name.trim() || !input.hypothesis.trim()) {
    return { ok: false, error: "Experiment requires a name and hypothesis (Section AI)" };
  }
  if (!input.rollbackPlan.trim() || !input.owner.trim()) {
    return { ok: false, error: "Experiment requires a rollback plan and owner (Section AI)" };
  }
  if (!input.expiryDate)
    return { ok: false, error: "Experiment requires an expiry date (Section AI)" };
  return { ok: true, experiment: { ...input } };
}

export function isExperimentExpired(experiment: Experiment, now: string): boolean {
  return experiment.expiryDate <= now;
}

export function isExperimentValid(experiment: Experiment): boolean {
  return Boolean(
    experiment.hypothesis.trim() &&
    experiment.baseline.trim() &&
    experiment.treatment.trim() &&
    experiment.successCriteria.trim() &&
    experiment.failureCriteria.trim() &&
    experiment.measurementPlan.trim() &&
    experiment.samplePopulation.trim() &&
    experiment.rollbackPlan.trim() &&
    experiment.owner.trim(),
  );
}

// Section AJ: experiments involving high-impact decisions require additional
// governance.
export function isHighImpactExperimentGoverned(experiment: Experiment): boolean {
  if (experiment.riskClassification === "critical" || experiment.riskClassification === "high") {
    return experiment.owner.trim().length > 0 && experiment.rollbackPlan.trim().length > 0;
  }
  return true;
}

export type ExperimentComparisonTarget =
  | "interface"
  | "workflow"
  | "ai_model"
  | "recommendation_strategy"
  | "learning_experience"
  | "operational_process";

export interface AbTest {
  id: ExperimentId;
  target: ExperimentComparisonTarget;
  variantA: string;
  variantB: string;
  highImpact: boolean;
}

export function createAbTest(input: {
  id: ExperimentId;
  target: ExperimentComparisonTarget;
  variantA: string;
  variantB: string;
  highImpact?: boolean;
}): { ok: true; test: AbTest } | { ok: false; error: string } {
  if (!input.variantA.trim() || !input.variantB.trim()) {
    return { ok: false, error: "A/B test requires two variants (Section AJ)" };
  }
  return {
    ok: true,
    test: {
      id: input.id,
      target: input.target,
      variantA: input.variantA,
      variantB: input.variantB,
      highImpact: input.highImpact ?? false,
    },
  };
}

export function isAbTestGoverned(test: AbTest): boolean {
  return test.highImpact ? false : true;
}

/* ─────────────────────────────────────────────────────────────
 * Progressive rollout + canary (Sections AG, AH)
 * ────────────────────────────────────────────────────────────*/

export type RolloutStage =
  | "sandbox"
  | "internal"
  | "pilot"
  | "limited_production"
  | "expanded_production"
  | "general_availability";

export const ROLLOUT_STAGES: readonly RolloutStage[] = [
  "sandbox",
  "internal",
  "pilot",
  "limited_production",
  "expanded_production",
  "general_availability",
] as const;

export interface ProgressiveRollout {
  id: RolloutId;
  capability: string;
  stage: RolloutStage;
}

export function createProgressiveRollout(input: {
  id: RolloutId;
  capability: string;
}): { ok: true; rollout: ProgressiveRollout } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Rollout capability is required (Section AG)" };
  return { ok: true, rollout: { id: input.id, capability: input.capability, stage: "sandbox" } };
}

export function canAdvanceRolloutStage(current: RolloutStage, next: RolloutStage): boolean {
  const from = ROLLOUT_STAGES.indexOf(current);
  const to = ROLLOUT_STAGES.indexOf(next);
  return from >= 0 && to === from + 1;
}

export const CANARY_MONITOR_DIMENSIONS: readonly string[] = [
  "error_rates",
  "latency",
  "resource_consumption",
  "user_behavior",
  "security_events",
  "ai_quality",
  "workflow_failures",
  "data_anomalies",
] as const;

export interface CanaryDeployment {
  id: RolloutId;
  capability: string;
  monitored: string[];
  automaticRollback: boolean;
}

export function createCanaryDeployment(input: {
  id: RolloutId;
  capability: string;
  automaticRollback?: boolean;
}): { ok: true; deployment: CanaryDeployment } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Canary capability is required (Section AH)" };
  return {
    ok: true,
    deployment: {
      id: input.id,
      capability: input.capability,
      monitored: [],
      automaticRollback: input.automaticRollback ?? false,
    },
  };
}

export function addCanaryMonitor(
  deployment: CanaryDeployment,
  dimension: string,
): { ok: true; deployment: CanaryDeployment } | { ok: false; error: string } {
  if (!CANARY_MONITOR_DIMENSIONS.includes(dimension)) {
    return { ok: false, error: `Unknown canary monitor dimension "${dimension}" (Section AH)` };
  }
  return {
    ok: true,
    deployment: { ...deployment, monitored: [...new Set([...deployment.monitored, dimension])] },
  };
}

export function isCanaryMonitored(deployment: CanaryDeployment): boolean {
  return CANARY_MONITOR_DIMENSIONS.every((dimension) => deployment.monitored.includes(dimension));
}

/* ─────────────────────────────────────────────────────────────
 * Feature flags (Section AF)
 * ────────────────────────────────────────────────────────────*/

export type EvolutionFlagScope =
  "tenant" | "role" | "geography" | "device" | "cohort" | "percentage" | "capability_gate";

export interface EvolutionFeatureFlag {
  id: string;
  feature: string;
  scope: EvolutionFlagScope;
  owner: string;
  lifecycleState: string;
  emergencyDisablement: boolean;
}

export function createEvolutionFeatureFlag(input: {
  id: string;
  feature: string;
  scope: EvolutionFlagScope;
  owner: string;
  emergencyDisablement?: boolean;
}): { ok: true; flag: EvolutionFeatureFlag } | { ok: false; error: string } {
  if (!input.feature.trim())
    return { ok: false, error: "Feature flag feature is required (Section AF)" };
  if (!input.owner.trim())
    return { ok: false, error: "Feature flag requires ownership metadata (Section AF)" };
  return {
    ok: true,
    flag: {
      id: input.id,
      feature: input.feature,
      scope: input.scope,
      owner: input.owner,
      lifecycleState: "proposed",
      emergencyDisablement: input.emergencyDisablement ?? false,
    },
  };
}

// Section AF: feature flags must have ownership and lifecycle metadata and
// support emergency disablement.
export function isFlagControlled(flag: EvolutionFeatureFlag): boolean {
  return (
    flag.owner.trim().length > 0 &&
    flag.lifecycleState.trim().length > 0 &&
    flag.emergencyDisablement
  );
}

/* ─────────────────────────────────────────────────────────────
 * Tenant isolation during experimentation (Section DI)
 * ────────────────────────────────────────────────────────────*/

export interface TenantExperimentCohort {
  id: ExperimentId;
  experimentRef: string;
  tenants: string[];
  optIn: boolean;
  isolatedConfiguration: boolean;
  emergencyDisablement: boolean;
}

export function createTenantExperimentCohort(input: {
  id: ExperimentId;
  experimentRef: string;
  tenants: string[];
  optIn?: boolean;
  isolatedConfiguration?: boolean;
  emergencyDisablement?: boolean;
}): { ok: true; cohort: TenantExperimentCohort } | { ok: false; error: string } {
  if (!input.experimentRef.trim())
    return { ok: false, error: "Experiment reference is required (Section DI)" };
  if (input.tenants.length === 0)
    return { ok: false, error: "Experiment cohort requires at least one tenant (Section DI)" };
  return {
    ok: true,
    cohort: {
      id: input.id,
      experimentRef: input.experimentRef,
      tenants: input.tenants,
      optIn: input.optIn ?? false,
      isolatedConfiguration: input.isolatedConfiguration ?? false,
      emergencyDisablement: input.emergencyDisablement ?? false,
    },
  };
}

// Section DI: experimental capabilities must never accidentally affect
// unrelated tenants — tenants participate by opt-in only with isolation.
export function isTenantExperimentIsolated(cohort: TenantExperimentCohort): boolean {
  return cohort.optIn && cohort.isolatedConfiguration && cohort.emergencyDisablement;
}

/* ─────────────────────────────────────────────────────────────
 * Failure management + experiment reuse (Sections CY, CZ)
 * ────────────────────────────────────────────────────────────*/

export interface ExperimentOutcome {
  id: ExperimentId;
  experimentRef: string;
  result: "success" | "failure" | "inconclusive";
  documented: boolean;
  analyzed: boolean;
  isolated: boolean;
  archived: boolean;
  engineeringKnowledge: boolean;
}

export function recordExperimentOutcome(input: {
  id: ExperimentId;
  experimentRef: string;
  result: ExperimentOutcome["result"];
  documented?: boolean;
  analyzed?: boolean;
  isolated?: boolean;
  archived?: boolean;
  engineeringKnowledge?: boolean;
}): { ok: true; outcome: ExperimentOutcome } | { ok: false; error: string } {
  if (!input.experimentRef.trim())
    return { ok: false, error: "Experiment reference is required (Section CY)" };
  return {
    ok: true,
    outcome: {
      id: input.id,
      experimentRef: input.experimentRef,
      result: input.result,
      documented: input.documented ?? false,
      analyzed: input.analyzed ?? false,
      isolated: input.isolated ?? false,
      archived: input.archived ?? false,
      engineeringKnowledge: input.engineeringKnowledge ?? false,
    },
  };
}

// Section CY: failure is acceptable, uncontrolled failure is not.
export function isFailureControlled(outcome: ExperimentOutcome): boolean {
  if (outcome.result !== "failure") return true;
  return (
    outcome.documented &&
    outcome.analyzed &&
    outcome.isolated &&
    outcome.archived &&
    outcome.engineeringKnowledge
  );
}

// Section CZ: successful and failed experiments remain discoverable.
export function isExperimentReusable(outcome: ExperimentOutcome): boolean {
  return outcome.archived && outcome.engineeringKnowledge;
}
