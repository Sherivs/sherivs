/**
 * CoreGrid Enterprise Reliability — consistency, idempotency, distributed
 * transactions, service tiers, SLO/error budgets, latency budgets, RPO/RTO,
 * failure domains, cell architecture, and multi-region contracts.
 *
 * Implements `architecture/phase-31-enterprise-scale.md`:
 * - Consistency (AM): strong/eventual/session/causal; consistency boundaries
 *   (AN): no eventual consistency merely for performance when the operation
 *   requires authoritative consistency.
 * - Transaction scale (AO), concurrency control (AP), idempotency (AQ),
 *   distributed transactions (AR): sagas, compensating actions,
 *   transactional outbox, idempotent consumers.
 * - Retry strategy (BA), circuit breakers (BB), bulkheads (BC), timeouts
 *   (BD), deadlines (BE) — Phase 05 runtime-resilience provides the
 *   mechanisms; this module provides the enterprise contract layer.
 * - Failure domains (BF), fault isolation (BG), cell architecture (BH-BJ)
 *   where cells must never create inconsistent business truth, multi-region
 *   scale (BK), active-active (BL), active-passive (BM), tested regional
 *   failover (BN), cross-region replication (BO) with RPO (BP) and RTO (BQ).
 * - Service tiers (BR), SLA model (BS), SLO model (BT), error budgets (BU),
 *   availability (BV), latency tracking (BW) including tail latency (BX),
 *   performance budgets (BY).
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type SloId = string & { readonly __brand: "SloId" };
export type CellId = string & { readonly __brand: "CellId" };
export type FailureDomainId = string & { readonly __brand: "FailureDomainId" };

export function sloId(raw: string): SloId {
  return raw as SloId;
}
export function cellId(raw: string): CellId {
  return raw as CellId;
}
export function failureDomainId(raw: string): FailureDomainId {
  return raw as FailureDomainId;
}

/* ─────────────────────────────────────────────────────────────
 * Consistency (Sections AM, AN)
 * ────────────────────────────────────────────────────────────*/

export type ConsistencyModel = "strong" | "eventual" | "session" | "causal";

export const CONSISTENCY_MODELS: readonly ConsistencyModel[] = [
  "strong",
  "eventual",
  "session",
  "causal",
] as const;

export interface ConsistencyContract {
  operation: string;
  model: ConsistencyModel;
  /** Section AN: operations requiring authoritative consistency. */
  authoritative: boolean;
}

export function createConsistencyContract(input: {
  operation: string;
  model: ConsistencyModel;
  authoritative: boolean;
}): { ok: true; contract: ConsistencyContract } | { ok: false; error: string } {
  if (!input.operation.trim())
    return { ok: false, error: "Consistency operation is required (Section AM)" };
  if (!CONSISTENCY_MODELS.includes(input.model)) {
    return { ok: false, error: "Unknown consistency model (Section AM)" };
  }
  return {
    ok: true,
    contract: {
      operation: input.operation,
      model: input.model,
      authoritative: input.authoritative,
    },
  };
}

// Section AN: authoritative business operations must never be downgraded to
// eventual consistency merely for performance.
export function isConsistencyAppropriate(contract: ConsistencyContract): boolean {
  if (contract.authoritative && contract.model === "eventual") return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Idempotency + distributed transactions (Sections AQ, AR)
 * ────────────────────────────────────────────────────────────*/

export function isIdempotencySatisfied(input: {
  duplicateDeliveryPossible: boolean;
  idempotencyKeyPresent: boolean;
  deduplicationEnabled: boolean;
}): boolean {
  if (!input.duplicateDeliveryPossible) return true;
  return input.idempotencyKeyPresent && input.deduplicationEnabled;
}

export type DistributedTransactionPattern =
  "saga" | "compensating_action" | "transactional_outbox" | "idempotent_consumer";

export interface DistributedTransactionContract {
  operation: string;
  pattern: DistributedTransactionPattern;
  /** Section AR: unnecessary distributed transactions are avoided. */
  avoidsGlobalTx: boolean;
}

export function createDistributedTransactionContract(input: {
  operation: string;
  pattern: DistributedTransactionPattern;
  avoidsGlobalTx?: boolean;
}): { ok: true; contract: DistributedTransactionContract } | { ok: false; error: string } {
  if (!input.operation.trim()) {
    return { ok: false, error: "Distributed transaction operation is required (Section AR)" };
  }
  if (input.avoidsGlobalTx === false) {
    return {
      ok: false,
      error: "Unnecessary distributed transactions must be avoided (Section AR)",
    };
  }
  return {
    ok: true,
    contract: { operation: input.operation, pattern: input.pattern, avoidsGlobalTx: true },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Service tiers (Section BR)
 * ────────────────────────────────────────────────────────────*/

export type ServiceTier = 0 | 1 | 2 | 3 | 4;

export const SERVICE_TIER_LABELS: Record<ServiceTier, string> = {
  0: "critical",
  1: "mission_critical",
  2: "important",
  3: "standard",
  4: "best_effort",
};

export function createServiceTier(input: {
  service: string;
  tier: ServiceTier;
  availabilityTargetPercent: number;
  rtoMinutes: number;
  rpoMinutes: number;
}):
  | {
      ok: true;
      tier: {
        service: string;
        tier: ServiceTier;
        label: string;
        availabilityTargetPercent: number;
        rtoMinutes: number;
        rpoMinutes: number;
      };
    }
  | { ok: false; error: string } {
  if (!input.service.trim()) return { ok: false, error: "Service is required (Section BR)" };
  if (input.availabilityTargetPercent <= 0 || input.availabilityTargetPercent > 100) {
    return {
      ok: false,
      error: "Service tier availability must be a valid percentage (Section BR)",
    };
  }
  if (input.rtoMinutes < 0 || input.rpoMinutes < 0) {
    return { ok: false, error: "RTO/RPO must be non-negative (Section BR)" };
  }
  return {
    ok: true,
    tier: {
      service: input.service,
      tier: input.tier,
      label: SERVICE_TIER_LABELS[input.tier],
      availabilityTargetPercent: input.availabilityTargetPercent,
      rtoMinutes: input.rtoMinutes,
      rpoMinutes: input.rpoMinutes,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * SLO + error budgets + latency (Sections BT, BU, BW, BX)
 * ────────────────────────────────────────────────────────────*/

export interface Slo {
  id: SloId;
  service: string;
  availabilityTargetPercent: number;
  latencyTargetMs: number;
  windowDays: number;
}

export function createSlo(input: {
  id: SloId;
  service: string;
  availabilityTargetPercent: number;
  latencyTargetMs: number;
  windowDays?: number;
}): { ok: true; slo: Slo } | { ok: false; error: string } {
  if (
    !Number.isFinite(input.availabilityTargetPercent) ||
    input.availabilityTargetPercent <= 0 ||
    input.availabilityTargetPercent > 100
  ) {
    return {
      ok: false,
      error: "SLO availability must be a percentage between 0 and 100 (Section BT)",
    };
  }
  if (!Number.isFinite(input.latencyTargetMs) || input.latencyTargetMs <= 0) {
    return { ok: false, error: "SLO latency target must be positive (Section BT)" };
  }
  return {
    ok: true,
    slo: {
      id: input.id,
      service: input.service,
      availabilityTargetPercent: input.availabilityTargetPercent,
      latencyTargetMs: input.latencyTargetMs,
      windowDays: input.windowDays ?? 30,
    },
  };
}

// Section BU: error budget = allowable downtime minutes over the window.
export function computeErrorBudgetMinutes(slo: Slo, measuredAvailabilityPercent: number): number {
  const windowMinutes = slo.windowDays * 24 * 60;
  return Math.round(
    ((slo.availabilityTargetPercent - measuredAvailabilityPercent) / 100) * windowMinutes,
  );
}

export function isErrorBudgetExhausted(slo: Slo, measuredAvailabilityPercent: number): boolean {
  return computeErrorBudgetMinutes(slo, measuredAvailabilityPercent) <= 0;
}

export type LatencyBucket = "p50" | "p90" | "p95" | "p99" | "p99_9";

export const LATENCY_BUCKETS: readonly LatencyBucket[] = [
  "p50",
  "p90",
  "p95",
  "p99",
  "p99_9",
] as const;

export interface LatencyBudget {
  service: string;
  targets: Record<LatencyBucket, number>;
}

export function createLatencyBudget(input: {
  service: string;
  targets: Record<LatencyBucket, number>;
}): { ok: true; budget: LatencyBudget } | { ok: false; error: string } {
  if (!input.service.trim())
    return { ok: false, error: "Latency budget service is required (Section BW)" };
  for (const bucket of LATENCY_BUCKETS) {
    const target = input.targets[bucket];
    if (!Number.isFinite(target) || target <= 0) {
      return { ok: false, error: `Latency target for "${bucket}" must be positive (Section BW)` };
    }
  }
  return { ok: true, budget: { service: input.service, targets: input.targets } };
}

// Section BX: tail latency is managed explicitly — every bucket must meet its
// target, including p99.9.
export function isLatencyBudgetMet(
  budget: LatencyBudget,
  measured: Record<LatencyBucket, number>,
): boolean {
  return LATENCY_BUCKETS.every((bucket) => measured[bucket] <= budget.targets[bucket]);
}

/* ─────────────────────────────────────────────────────────────
 * RPO/RTO + replication (Sections BP, BQ, BO)
 * ────────────────────────────────────────────────────────────*/

export interface RecoveryObjective {
  workload: string;
  rpoMinutes: number;
  rtoMinutes: number;
}

export function createRecoveryObjective(input: {
  workload: string;
  rpoMinutes: number;
  rtoMinutes: number;
}): { ok: true; objective: RecoveryObjective } | { ok: false; error: string } {
  if (!input.workload.trim())
    return { ok: false, error: "Recovery objective workload is required (Section BP)" };
  if (input.rpoMinutes < 0 || input.rtoMinutes < 0) {
    return { ok: false, error: "RPO and RTO must be non-negative (Section BQ)" };
  }
  return {
    ok: true,
    objective: {
      workload: input.workload,
      rpoMinutes: input.rpoMinutes,
      rtoMinutes: input.rtoMinutes,
    },
  };
}

export function isRecoveryObjectiveMet(
  objective: RecoveryObjective,
  measuredRpoMinutes: number,
  measuredRtoMinutes: number,
): boolean {
  return measuredRpoMinutes <= objective.rpoMinutes && measuredRtoMinutes <= objective.rtoMinutes;
}

export interface ReplicationContract {
  workload: string;
  rpoMinutes: number;
  rtoMinutes: number;
  consistency: ConsistencyModel;
  bandwidthProvisioned: boolean;
  costBounded: boolean;
}

export function createReplicationContract(input: {
  workload: string;
  rpoMinutes: number;
  rtoMinutes: number;
  consistency: ConsistencyModel;
  bandwidthProvisioned?: boolean;
  costBounded?: boolean;
}): { ok: true; contract: ReplicationContract } | { ok: false; error: string } {
  if (!input.workload.trim())
    return { ok: false, error: "Replication workload is required (Section BO)" };
  if (input.rpoMinutes < 0 || input.rtoMinutes < 0) {
    return { ok: false, error: "Replication RPO/RTO must be non-negative (Section BO)" };
  }
  return {
    ok: true,
    contract: {
      workload: input.workload,
      rpoMinutes: input.rpoMinutes,
      rtoMinutes: input.rtoMinutes,
      consistency: input.consistency,
      bandwidthProvisioned: input.bandwidthProvisioned ?? false,
      costBounded: input.costBounded ?? false,
    },
  };
}

export function isReplicationContractComplete(contract: ReplicationContract): boolean {
  return contract.bandwidthProvisioned && contract.costBounded;
}

/* ─────────────────────────────────────────────────────────────
 * Failure domains (Sections BF, BG)
 * ────────────────────────────────────────────────────────────*/

export type FailureDomainLevel =
  "process" | "host" | "rack" | "cluster" | "zone" | "region" | "provider";

export const FAILURE_DOMAIN_ORDER: readonly FailureDomainLevel[] = [
  "process",
  "host",
  "rack",
  "cluster",
  "zone",
  "region",
  "provider",
] as const;

export interface FailureDomain {
  id: FailureDomainId;
  level: FailureDomainLevel;
  scope: string;
}

export function createFailureDomain(input: {
  id: FailureDomainId;
  level: FailureDomainLevel;
  scope: string;
}): { ok: true; domain: FailureDomain } | { ok: false; error: string } {
  if (!input.scope.trim())
    return { ok: false, error: "Failure domain scope is required (Section BF)" };
  if (!FAILURE_DOMAIN_ORDER.includes(input.level)) {
    return { ok: false, error: "Unknown failure domain level (Section BF)" };
  }
  return { ok: true, domain: { id: input.id, level: input.level, scope: input.scope } };
}

// Section BG: a failure in one domain must not automatically become
// platform-wide failure.
export function isFailureIsolated(failure: FailureDomain, platformScope: string): boolean {
  return failure.scope !== platformScope;
}

/* ─────────────────────────────────────────────────────────────
 * Cells (Sections BH, BI, BJ)
 * ────────────────────────────────────────────────────────────*/

export interface Cell {
  id: CellId;
  name: string;
  workloadBound: boolean;
  businessTruthConsistent: boolean;
}

export function createCell(input: {
  id: CellId;
  name: string;
  workloadBound?: boolean;
  businessTruthConsistent?: boolean;
}): { ok: true; cell: Cell } | { ok: false; error: string } {
  if (!input.name.trim()) return { ok: false, error: "Cell name is required (Section BH)" };
  if (input.businessTruthConsistent === false) {
    return { ok: false, error: "Cells must not create inconsistent business truth (Section BJ)" };
  }
  return {
    ok: true,
    cell: {
      id: input.id,
      name: input.name,
      workloadBound: input.workloadBound ?? false,
      businessTruthConsistent: true,
    },
  };
}

export function isCellBoundaryValid(cell: Cell): boolean {
  return cell.businessTruthConsistent;
}

// Section BI: cells reduce blast radius, noisy-neighbor effects, and regional
// failure impact.
export function canContainBlastRadius(cell: Cell, blastRadiusScope: string): boolean {
  return cell.workloadBound && blastRadiusScope === "cell";
}

/* ─────────────────────────────────────────────────────────────
 * Multi-region architecture (Sections BK, BL, BM, BN)
 * ────────────────────────────────────────────────────────────*/

export type RegionMode = "active_active" | "active_passive";

export interface MultiRegionArchitecture {
  service: string;
  mode: RegionMode;
  regions: string[];
  failoverTested: boolean;
}

export function createMultiRegionArchitecture(input: {
  service: string;
  mode: RegionMode;
  regions: string[];
  failoverTested?: boolean;
}): { ok: true; architecture: MultiRegionArchitecture } | { ok: false; error: string } {
  if (!input.service.trim())
    return { ok: false, error: "Multi-region service is required (Section BK)" };
  if (input.regions.length === 0) {
    return {
      ok: false,
      error: "Multi-region architecture requires at least one region (Section BK)",
    };
  }
  if (input.mode === "active_active" && input.regions.length < 2) {
    return { ok: false, error: "Active-active requires at least two regions (Section BL)" };
  }
  return {
    ok: true,
    architecture: {
      service: input.service,
      mode: input.mode,
      regions: input.regions,
      failoverTested: input.failoverTested ?? false,
    },
  };
}

// Section BN: failover must be tested, not merely documented.
export function isRegionalFailoverTested(architecture: MultiRegionArchitecture): boolean {
  return architecture.failoverTested;
}

/* ─────────────────────────────────────────────────────────────
 * Resilience contract (Sections BB, BC, BD, BE)
 * Phase 05 runtime-resilience provides the mechanisms; this is the
 * enterprise contract layer that requires every distributed call to declare
 * them (AGENTS.md 65).
 * ────────────────────────────────────────────────────────────*/

export interface ResilienceContract {
  service: string;
  circuitBreaker: boolean;
  bulkhead: boolean;
  timeouts: boolean;
  deadlinePropagation: boolean;
  timeoutMs: number;
}

export function createResilienceContract(input: {
  service: string;
  circuitBreaker?: boolean;
  bulkhead?: boolean;
  timeouts?: boolean;
  deadlinePropagation?: boolean;
  timeoutMs: number;
}): { ok: true; contract: ResilienceContract } | { ok: false; error: string } {
  if (!input.service.trim())
    return { ok: false, error: "Resilience contract service is required (Section BB)" };
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    return { ok: false, error: "Every distributed call requires an explicit timeout (Section BD)" };
  }
  if (input.circuitBreaker === false || input.bulkhead === false || input.timeouts === false) {
    return {
      ok: false,
      error:
        "Enterprise services require circuit breakers, bulkheads, and timeouts (Sections BB, BC, BD)",
    };
  }
  return {
    ok: true,
    contract: {
      service: input.service,
      circuitBreaker: true,
      bulkhead: true,
      timeouts: true,
      deadlinePropagation: input.deadlinePropagation ?? false,
      timeoutMs: input.timeoutMs,
    },
  };
}

export function isResilienceContractComplete(contract: ResilienceContract): boolean {
  return (
    contract.circuitBreaker && contract.bulkhead && contract.timeouts && contract.timeoutMs > 0
  );
}
