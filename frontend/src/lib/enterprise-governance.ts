/**
 * CoreGrid Enterprise Governance — provisioning, rollout, kill switches,
 * policy/configuration versioning, service catalog, readiness levels,
 * bottleneck governance, scale limits, mass-event protection, recovery
 * ordering, and autonomy contracts.
 *
 * Implements `architecture/phase-31-enterprise-scale.md`:
 * - Enterprise provisioning (EE), mass provisioning (EF), provisioning
 *   workflow (EG) Requested → Validated → Planned → Allocated → Provisioned →
 *   Configured → Verified → Activated, structured deprovisioning (EH).
 * - Rollout strategies (EJ), canary releases (EK), blue-green (EL),
 *   progressive delivery (EM) Internal → Canary → Small Customer Group →
 *   Regional → Enterprise → Global, feature flags (EN), kill switches (EO),
 *   rollback (EP), forward-compatible rollback (EQ).
 * - Enterprise policy scale (FT), policy distribution (FU), policy
 *   versioning (FV), policy rollout (FW) immediate/scheduled/staged/canary,
 *   policy rollback (FX).
 * - Enterprise configuration (FY), configuration distribution (FZ),
 *   configuration consistency (GA), configuration drift detection (GB).
 * - Enterprise resource inventory (GC), service catalog (GD) with owner,
 *   purpose, dependencies, SLO, data classification, scaling and recovery
 *   models; service ownership (GE).
 * - Enterprise readiness levels (LW) Level 0–5 and service certification
 *   (LX), scale debt (MC), bottleneck register (MD) and prioritization (ME).
 * - Scale limits (QE), limit monitoring (QF), scale change record (PV).
 * - Mass-event protection (RJ–RN), event storm protection (RR/RT), recovery
 *   priorities (RV) and recovery dependency graph (RW).
 * - Agent autonomy levels (SL), autonomous scale actions (SM), human
 *   approval (SN), engineering contracts (SE–SI) with data owned/not owned.
 *
 * Phase 05 runtime-feature-flags remains the feature-flag mechanism; this
 * module provides the enterprise rollout/versioning contract layer consumed
 * by reference (AGENTS.md 65).
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type ProvisioningRequestId = string & { readonly __brand: "ProvisioningRequestId" };
export type RolloutId = string & { readonly __brand: "RolloutId" };
export type PolicyVersionId = string & { readonly __brand: "PolicyVersionId" };
export type ConfigVersionId = string & { readonly __brand: "ConfigVersionId" };
export type BottleneckId = string & { readonly __brand: "BottleneckId" };
export type ScaleChangeRecordId = string & { readonly __brand: "ScaleChangeRecordId" };
export type ScaleLimitId = string & { readonly __brand: "ScaleLimitId" };

export function provisioningRequestId(raw: string): ProvisioningRequestId {
  return raw as ProvisioningRequestId;
}
export function rolloutId(raw: string): RolloutId {
  return raw as RolloutId;
}
export function policyVersionId(raw: string): PolicyVersionId {
  return raw as PolicyVersionId;
}
export function configVersionId(raw: string): ConfigVersionId {
  return raw as ConfigVersionId;
}
export function bottleneckId(raw: string): BottleneckId {
  return raw as BottleneckId;
}
export function scaleChangeRecordId(raw: string): ScaleChangeRecordId {
  return raw as ScaleChangeRecordId;
}
export function scaleLimitId(raw: string): ScaleLimitId {
  return raw as ScaleLimitId;
}

/* ─────────────────────────────────────────────────────────────
 * Provisioning (Sections EE, EF, EG, EH)
 * ────────────────────────────────────────────────────────────*/

export type ProvisioningStage =
  | "requested"
  | "validated"
  | "planned"
  | "allocated"
  | "provisioned"
  | "configured"
  | "verified"
  | "activated";

export const PROVISIONING_STAGES: readonly ProvisioningStage[] = [
  "requested",
  "validated",
  "planned",
  "allocated",
  "provisioned",
  "configured",
  "verified",
  "activated",
] as const;

export interface ProvisioningRequest {
  id: ProvisioningRequestId;
  entityType: "institution" | "campus" | "user" | "device" | "workspace" | "policy" | "service";
  stage: ProvisioningStage;
}

export function createProvisioningRequest(input: {
  id: ProvisioningRequestId;
  entityType: ProvisioningRequest["entityType"];
}): { ok: true; request: ProvisioningRequest } | { ok: false; error: string } {
  if (!input.id) return { ok: false, error: "Provisioning request id is required (Section EG)" };
  return { ok: true, request: { id: input.id, entityType: input.entityType, stage: "requested" } };
}

export function canAdvanceProvisioning(
  current: ProvisioningStage,
  next: ProvisioningStage,
): boolean {
  const from = PROVISIONING_STAGES.indexOf(current);
  const to = PROVISIONING_STAGES.indexOf(next);
  return from >= 0 && to === from + 1;
}

export function isDeprovisioningStructured(input: {
  hasWorkflow: boolean;
  hasAudit: boolean;
  resumable: boolean;
}): boolean {
  return input.hasWorkflow && input.hasAudit && input.resumable;
}

/* ─────────────────────────────────────────────────────────────
 * Rollout + kill switches + rollback (Sections EJ, EK, EL, EM, EO, EP, EQ)
 * ────────────────────────────────────────────────────────────*/

export type RolloutStage =
  "internal" | "canary" | "small_customer_group" | "regional" | "enterprise" | "global";

export const ROLLOUT_STAGES: readonly RolloutStage[] = [
  "internal",
  "canary",
  "small_customer_group",
  "regional",
  "enterprise",
  "global",
] as const;

export interface RolloutPlan {
  id: RolloutId;
  feature: string;
  stage: RolloutStage;
  /** Section EK: canary releases reach a small percentage of workloads first. */
  canaryPercent: number;
}

export function createRolloutPlan(input: {
  id: RolloutId;
  feature: string;
  canaryPercent?: number;
}): { ok: true; plan: RolloutPlan } | { ok: false; error: string } {
  if (!input.feature.trim())
    return { ok: false, error: "Rollout feature is required (Section EM)" };
  const canaryPercent = input.canaryPercent ?? 5;
  if (canaryPercent <= 0 || canaryPercent > 10) {
    return { ok: false, error: "Canary percentage must be small (0 < p <= 10) (Section EK)" };
  }
  return {
    ok: true,
    plan: { id: input.id, feature: input.feature, stage: "internal", canaryPercent },
  };
}

export function canAdvanceRollout(current: RolloutStage, next: RolloutStage): boolean {
  const from = ROLLOUT_STAGES.indexOf(current);
  const to = ROLLOUT_STAGES.indexOf(next);
  return from >= 0 && to === from + 1;
}

export function isProgressiveDelivery(plan: RolloutPlan): boolean {
  return plan.stage === "internal" || plan.stage === "canary";
}

export interface KillSwitch {
  id: string;
  capability: string;
  controlled: boolean;
  auditable: boolean;
}

// Section EO: high-risk capabilities require controlled kill switches.
export function createKillSwitch(input: {
  id: string;
  capability: string;
  controlled?: boolean;
  auditable?: boolean;
}): { ok: true; killSwitch: KillSwitch } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Kill switch capability is required (Section EO)" };
  if (input.controlled === false || input.auditable === false) {
    return { ok: false, error: "Kill switches must be controlled and auditable (Section EO)" };
  }
  return {
    ok: true,
    killSwitch: { id: input.id, capability: input.capability, controlled: true, auditable: true },
  };
}

export function isKillSwitchControlled(killSwitch: KillSwitch): boolean {
  return killSwitch.controlled && killSwitch.auditable;
}

// Section EP: every major deployment must have a rollback strategy.
export function isRollbackStrategyDefined(input: {
  deployment: string;
  rollbackStrategy: string;
}): boolean {
  return Boolean(input.deployment.trim()) && input.rollbackStrategy.trim().length > 0;
}

// Section EQ: database changes must be designed for forward-compatible rollback.
export function isRollbackForwardCompatible(input: {
  databaseChanges: string[];
  forwardCompatible: boolean;
}): boolean {
  if (input.databaseChanges.length === 0) return true;
  return input.forwardCompatible;
}

/* ─────────────────────────────────────────────────────────────
 * Policy versioning + rollout (Sections FT, FU, FV, FW, FX)
 * ────────────────────────────────────────────────────────────*/

export type PolicyRolloutMode = "immediate" | "scheduled" | "staged" | "canary";

export interface PolicyVersion {
  id: PolicyVersionId;
  policy: string;
  version: number;
  rolloutMode: PolicyRolloutMode;
  reversible: boolean;
}

export function createPolicyVersion(input: {
  id: PolicyVersionId;
  policy: string;
  version: number;
  rolloutMode: PolicyRolloutMode;
  reversible: boolean;
}): { ok: true; version: PolicyVersion } | { ok: false; error: string } {
  if (!input.policy.trim()) return { ok: false, error: "Policy name is required (Section FV)" };
  if (!Number.isInteger(input.version) || input.version < 1) {
    return { ok: false, error: "Policy version must be a positive integer (Section FV)" };
  }
  // Section FX: policy changes must be reversible where semantically possible.
  if (!input.reversible) {
    return { ok: false, error: "Enterprise policies must be reversible (Section FX)" };
  }
  return {
    ok: true,
    version: {
      id: input.id,
      policy: input.policy,
      version: input.version,
      rolloutMode: input.rolloutMode,
      reversible: true,
    },
  };
}

export function canRolloutPolicy(version: PolicyVersion): boolean {
  return version.version >= 1;
}

export function isPolicyRollbackPossible(version: PolicyVersion): boolean {
  return version.reversible;
}

/* ─────────────────────────────────────────────────────────────
 * Configuration distribution + drift (Sections FY, FZ, GA, GB)
 * ────────────────────────────────────────────────────────────*/

export interface ConfigDistribution {
  id: ConfigVersionId;
  configKey: string;
  version: number;
}

export function createConfigDistribution(input: {
  id: ConfigVersionId;
  configKey: string;
  version: number;
}): { ok: true; distribution: ConfigDistribution } | { ok: false; error: string } {
  if (!input.configKey.trim())
    return { ok: false, error: "Configuration key is required (Section FZ)" };
  if (!Number.isInteger(input.version) || input.version < 1) {
    return { ok: false, error: "Configuration version must be a positive integer (Section FZ)" };
  }
  return {
    ok: true,
    distribution: { id: input.id, configKey: input.configKey, version: input.version },
  };
}

// Section GA: services must know which configuration version they are using.
export function isConfigVersionKnown(
  configs: readonly ConfigDistribution[],
  configKey: string,
  version: number,
): boolean {
  const match = configs.find((c) => c.configKey === configKey);
  return match !== undefined && match.version === version;
}

// Section GB: detect configuration drift automatically.
export function detectConfigDrift(
  expected: readonly { configKey: string; version: number }[],
  actual: readonly { configKey: string; version: number }[],
): string[] {
  const drift: string[] = [];
  for (const item of expected) {
    const found = actual.find((a) => a.configKey === item.configKey);
    if (!found || found.version !== item.version) drift.push(item.configKey);
  }
  return drift;
}

/* ─────────────────────────────────────────────────────────────
 * Service catalog + ownership (Sections GC, GD, GE)
 * ────────────────────────────────────────────────────────────*/

export interface ServiceCatalogEntry {
  id: string;
  service: string;
  owner: string;
  purpose: string;
  dependencies: string[];
  sloRef: string;
  dataClassification: string;
  scalingModel: string;
  recoveryModel: string;
}

export function createServiceCatalogEntry(input: {
  id: string;
  service: string;
  owner: string;
  purpose: string;
  dependencies?: string[];
  sloRef: string;
  dataClassification: string;
  scalingModel: string;
  recoveryModel: string;
}): { ok: true; entry: ServiceCatalogEntry } | { ok: false; error: string } {
  if (!input.service.trim())
    return { ok: false, error: "Catalog service is required (Section GD)" };
  if (!input.owner.trim())
    return { ok: false, error: "Catalog service owner is required (Section GE)" };
  if (!input.purpose.trim())
    return { ok: false, error: "Catalog service purpose is required (Section GD)" };
  if (!input.dataClassification.trim())
    return { ok: false, error: "Catalog data classification is required (Section GD)" };
  if (!input.scalingModel.trim())
    return { ok: false, error: "Catalog scaling model is required (Section GD)" };
  if (!input.recoveryModel.trim())
    return { ok: false, error: "Catalog recovery model is required (Section GD)" };
  return {
    ok: true,
    entry: {
      id: input.id,
      service: input.service,
      owner: input.owner,
      purpose: input.purpose,
      dependencies: input.dependencies ?? [],
      sloRef: input.sloRef,
      dataClassification: input.dataClassification,
      scalingModel: input.scalingModel,
      recoveryModel: input.recoveryModel,
    },
  };
}

export function isServiceOwned(entry: ServiceCatalogEntry): boolean {
  return entry.owner.trim().length > 0;
}

/* ─────────────────────────────────────────────────────────────
 * Readiness levels (Sections LW, LX, LY)
 * ────────────────────────────────────────────────────────────*/

export type ReadinessLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const READINESS_LABELS: Record<ReadinessLevel, string> = {
  0: "prototype",
  1: "development",
  2: "production",
  3: "scalable_production",
  4: "enterprise_ready",
  5: "global_critical",
};

export interface ServiceReadiness {
  service: string;
  level: ReadinessLevel;
}

export function declareServiceReadinessLevel(input: {
  service: string;
  level: ReadinessLevel;
}): { ok: true; readiness: ServiceReadiness } | { ok: false; error: string } {
  if (!input.service.trim())
    return { ok: false, error: "Readiness service is required (Section LX)" };
  if (input.level < 0 || input.level > 5 || !Number.isInteger(input.level)) {
    return { ok: false, error: "Readiness level must be an integer between 0 and 5 (Section LW)" };
  }
  return { ok: true, readiness: { service: input.service, level: input.level } };
}

// A service is not labeled enterprise-ready without evidence (Section LY).
export function isEnterpriseReady(readiness: ServiceReadiness): boolean {
  return readiness.level >= 4;
}

/* ─────────────────────────────────────────────────────────────
 * Bottleneck register (Sections MC, MD, ME)
 * ────────────────────────────────────────────────────────────*/

export interface Bottleneck {
  id: BottleneckId;
  system: string;
  description: string;
  customerImpact: number;
  growthRate: number;
  failureRisk: number;
  cost: number;
  strategicImportance: number;
}

export function registerBottleneck(input: {
  id: BottleneckId;
  system: string;
  description: string;
  customerImpact: number;
  growthRate: number;
  failureRisk: number;
  cost: number;
  strategicImportance: number;
}): { ok: true; bottleneck: Bottleneck } | { ok: false; error: string } {
  if (!input.system.trim() || !input.description.trim()) {
    return { ok: false, error: "Bottleneck requires a system and description (Section MD)" };
  }
  const scores = [
    input.customerImpact,
    input.growthRate,
    input.failureRisk,
    input.cost,
    input.strategicImportance,
  ];
  if (scores.some((s) => !Number.isFinite(s) || s < 0 || s > 10)) {
    return { ok: false, error: "Bottleneck scores must be between 0 and 10 (Section MD)" };
  }
  return { ok: true, bottleneck: { ...input } };
}

// Section ME: prioritize by customer impact, growth rate, failure risk, cost,
// and strategic importance.
export function prioritizeBottlenecks(
  bottlenecks: readonly Bottleneck[],
): { id: BottleneckId; system: string; score: number }[] {
  return bottlenecks
    .map((b) => ({
      id: b.id,
      system: b.system,
      score: b.customerImpact + b.growthRate + b.failureRisk + b.cost + b.strategicImportance,
    }))
    .sort((a, b) => b.score - a.score);
}

/* ─────────────────────────────────────────────────────────────
 * Scale limits + change record (Sections QE, QF, PV)
 * ────────────────────────────────────────────────────────────*/

export interface ScaleLimit {
  id: ScaleLimitId;
  dimension: string;
  limit: number;
  monitored: boolean;
}

export function createScaleLimit(input: {
  id: ScaleLimitId;
  dimension: string;
  limit: number;
  monitored?: boolean;
}): { ok: true; limit: ScaleLimit } | { ok: false; error: string } {
  if (!input.dimension.trim())
    return { ok: false, error: "Scale limit dimension is required (Section QE)" };
  if (!Number.isFinite(input.limit) || input.limit <= 0) {
    return { ok: false, error: "Scale limit must be a positive number (Section QE)" };
  }
  return {
    ok: true,
    limit: {
      id: input.id,
      dimension: input.dimension,
      limit: input.limit,
      monitored: input.monitored ?? false,
    },
  };
}

export function isLimitMonitored(limit: ScaleLimit): boolean {
  return limit.monitored;
}

export interface ScaleChangeRecord {
  id: ScaleChangeRecordId;
  change: string;
  approvedBy: string;
  recordedAt: string;
}

export function createScaleChangeRecord(input: {
  id: ScaleChangeRecordId;
  change: string;
  approvedBy: string;
  recordedAt: string;
}): { ok: true; record: ScaleChangeRecord } | { ok: false; error: string } {
  if (!input.change.trim() || !input.approvedBy.trim()) {
    return { ok: false, error: "Scale change record requires a change and approver (Section PV)" };
  }
  return {
    ok: true,
    record: {
      id: input.id,
      change: input.change,
      approvedBy: input.approvedBy,
      recordedAt: input.recordedAt,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Mass-event protection (Sections RJ-RN, RR, RT)
 * ────────────────────────────────────────────────────────────*/

export type MassEventType =
  "login" | "notification" | "examination" | "payment" | "device_sync" | "data_ingestion";

export interface MassEventControl {
  id: string;
  eventType: MassEventType;
  threshold: number;
  controlled: boolean;
  protectedCritical: boolean;
}

export function createMassEventControl(input: {
  id: string;
  eventType: MassEventType;
  threshold: number;
  controlled?: boolean;
  protectedCritical?: boolean;
}): { ok: true; control: MassEventControl } | { ok: false; error: string } {
  if (!Number.isFinite(input.threshold) || input.threshold <= 0) {
    return { ok: false, error: "Mass-event threshold must be positive (Section RJ)" };
  }
  return {
    ok: true,
    control: {
      id: input.id,
      eventType: input.eventType,
      threshold: input.threshold,
      controlled: input.controlled ?? false,
      protectedCritical: input.protectedCritical ?? false,
    },
  };
}

export function isMassEventControlled(control: MassEventControl, volume: number): boolean {
  return control.controlled && volume <= control.threshold;
}

export interface EventStormProtection {
  id: string;
  sink: string;
  absorbsSurge: boolean;
  protectsCritical: boolean;
  alertsOnStorm: boolean;
}

export function createEventStormProtection(input: {
  id: string;
  sink: string;
  absorbsSurge?: boolean;
  protectsCritical?: boolean;
  alertsOnStorm?: boolean;
}): { ok: true; protection: EventStormProtection } | { ok: false; error: string } {
  if (!input.sink.trim()) return { ok: false, error: "Event storm sink is required (Section RR)" };
  return {
    ok: true,
    protection: {
      id: input.id,
      sink: input.sink,
      absorbsSurge: input.absorbsSurge ?? false,
      protectsCritical: input.protectsCritical ?? false,
      alertsOnStorm: input.alertsOnStorm ?? false,
    },
  };
}

export function canAbsorbSurge(protection: EventStormProtection): boolean {
  return protection.absorbsSurge && protection.protectsCritical && protection.alertsOnStorm;
}

/* ─────────────────────────────────────────────────────────────
 * Recovery priorities (Sections RV, RW)
 * ────────────────────────────────────────────────────────────*/

export interface RecoveryPriority {
  workload: string;
  priority: number;
  dependencyRefs: string[];
}

export function createRecoveryPriority(input: {
  workload: string;
  priority: number;
  dependencyRefs?: string[];
}): { ok: true; priority: RecoveryPriority } | { ok: false; error: string } {
  if (!input.workload.trim())
    return { ok: false, error: "Recovery workload is required (Section RV)" };
  if (!Number.isInteger(input.priority) || input.priority < 1) {
    return { ok: false, error: "Recovery priority must be a positive integer (Section RV)" };
  }
  return {
    ok: true,
    priority: {
      workload: input.workload,
      priority: input.priority,
      dependencyRefs: input.dependencyRefs ?? [],
    },
  };
}

// Section RW: dependencies must be recovered no later than their dependents.
export function isRecoveryOrderValid(priorities: readonly RecoveryPriority[]): boolean {
  const byWorkload = new Map(priorities.map((p) => [p.workload, p.priority]));
  for (const priority of priorities) {
    for (const dependency of priority.dependencyRefs) {
      const depPriority = byWorkload.get(dependency);
      if (depPriority === undefined) return false;
      if (depPriority > priority.priority) return false;
    }
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Autonomy contracts (Sections SL, SM, SN)
 * ────────────────────────────────────────────────────────────*/

export type AutonomyLevel = "manual" | "supervised" | "limited_autonomous" | "autonomous";

export const AUTONOMY_ORDER: readonly AutonomyLevel[] = [
  "manual",
  "supervised",
  "limited_autonomous",
  "autonomous",
] as const;

export interface AutonomyContract {
  id: string;
  scope: string;
  level: AutonomyLevel;
  boundedActions: boolean;
  observableOutcomes: boolean;
  rollbackAvailable: boolean;
  authorizationRequired: boolean;
  failureLimits: boolean;
  humanApprovalRequiredForHighRisk: boolean;
}

export function createAutonomyContract(input: {
  id: string;
  scope: string;
  level: AutonomyLevel;
  boundedActions?: boolean;
  observableOutcomes?: boolean;
  rollbackAvailable?: boolean;
  authorizationRequired?: boolean;
  failureLimits?: boolean;
  humanApprovalRequiredForHighRisk?: boolean;
}): { ok: true; contract: AutonomyContract } | { ok: false; error: string } {
  if (!input.scope.trim()) return { ok: false, error: "Autonomy scope is required (Section SL)" };
  if (!AUTONOMY_ORDER.includes(input.level))
    return { ok: false, error: "Unknown autonomy level (Section SL)" };
  // Section JV safety: no automated control loop operates without bounded
  // actions, observable outcomes, rollback, authorization, and failure limits.
  if (input.level !== "manual") {
    if (
      input.boundedActions === false ||
      input.observableOutcomes === false ||
      input.rollbackAvailable === false ||
      input.authorizationRequired === false ||
      input.failureLimits === false
    ) {
      return {
        ok: false,
        error:
          "Autonomous control loops require bounded actions, observable outcomes, rollback, authorization, and failure limits (Section JV)",
      };
    }
  }
  return {
    ok: true,
    contract: {
      id: input.id,
      scope: input.scope,
      level: input.level,
      boundedActions: input.boundedActions ?? false,
      observableOutcomes: input.observableOutcomes ?? false,
      rollbackAvailable: input.rollbackAvailable ?? false,
      authorizationRequired: input.authorizationRequired ?? false,
      failureLimits: input.failureLimits ?? false,
      humanApprovalRequiredForHighRisk: input.humanApprovalRequiredForHighRisk ?? true,
    },
  };
}

export function canActAutonomously(contract: AutonomyContract): boolean {
  return (
    AUTONOMY_ORDER.indexOf(contract.level) >= AUTONOMY_ORDER.indexOf("limited_autonomous") &&
    contract.boundedActions &&
    contract.observableOutcomes &&
    contract.rollbackAvailable &&
    contract.authorizationRequired &&
    contract.failureLimits
  );
}

// Sections SM + SN: high-risk scale actions require human approval.
export function isAutonomousScaleActionPermitted(
  contract: AutonomyContract,
  highRisk: boolean,
): boolean {
  if (!canActAutonomously(contract)) return false;
  if (highRisk && contract.humanApprovalRequiredForHighRisk) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Engineering contracts (Sections SE, SF, SG, SH, SI)
 * ────────────────────────────────────────────────────────────*/

export interface EngineeringContract {
  service: string;
  apiSurface: string[];
  events: string[];
  dataOwned: string[];
  dataNotOwned: string[];
}

export function createEngineeringContract(input: {
  service: string;
  apiSurface: string[];
  events: string[];
  dataOwned: string[];
  dataNotOwned: string[];
}): { ok: true; contract: EngineeringContract } | { ok: false; error: string } {
  if (!input.service.trim())
    return { ok: false, error: "Engineering contract service is required (Section SE)" };
  const overlap = input.dataOwned.filter((item) => input.dataNotOwned.includes(item));
  if (overlap.length > 0) {
    return {
      ok: false,
      error: `Data cannot be both owned and not owned: ${overlap.join(", ")} (Section SI)`,
    };
  }
  return {
    ok: true,
    contract: {
      service: input.service,
      apiSurface: input.apiSurface,
      events: input.events,
      dataOwned: input.dataOwned,
      dataNotOwned: input.dataNotOwned,
    },
  };
}

// Section SI: a service must never access data it does not own.
export function isDataOwnershipRespected(
  contract: EngineeringContract,
  accessedData: string[],
): boolean {
  return accessedData.every((item) => !contract.dataNotOwned.includes(item));
}
