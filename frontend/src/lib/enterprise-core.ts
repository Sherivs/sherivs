/**
 * CoreGrid Enterprise Scale — scale model, workload architecture, compute
 * pools, priority classes, resource governance, and state/service boundary
 * contracts.
 *
 * Implements `architecture/phase-31-enterprise-scale.md`:
 * - Enterprise scale definition (A): simultaneous growth across tenants,
 *   institutions, campuses, buildings, users, roles, devices, agents,
 *   workflows, messages, transactions, files, events, telemetry, digital
 *   twins, knowledge, analytics, integrations, AI inference, automation,
 *   financial activity, geographic distribution, and organizational
 *   complexity.
 * - Enterprise scale model (E) and scale dimensions (F): tenant, institution,
 *   geographic, user, device, data, event, workflow, AI, integration,
 *   financial, communication, digital-twin, observability, operational.
 * - Scale architecture (G): stateless compute + partitioned state +
 *   distributed storage + asynchronous processing + event-driven
 *   architecture + horizontal scaling + regional distribution.
 * - Horizontal (H) vs vertical (I) scaling: vertical must never become the
 *   only scaling strategy.
 * - State management (J): ownership, partitioning, replication, consistency,
 *   recovery, and migration must be explicit.
 * - Service boundaries (K): scaling never justifies uncontrolled coupling.
 * - Compute scaling (L), compute pools (M), workload isolation (N) — no
 *   expensive workload may starve critical interactive workloads — priority
 *   classes (O), resource governance (P).
 *
 * Phase 31 consumes the Phase 05 runtime-* primitives (jobs, resilience,
 * observability, feature flags) and Phase 21 cloud-governance by reference;
 * it never duplicates them (AGENTS.md 65).
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type WorkloadId = string & { readonly __brand: "WorkloadId" };
export type ServiceId = string & { readonly __brand: "ServiceId" };
export type ComputePoolId = string & { readonly __brand: "ComputePoolId" };

export function workloadId(raw: string): WorkloadId {
  return raw as WorkloadId;
}
export function serviceId(raw: string): ServiceId {
  return raw as ServiceId;
}
export function computePoolId(raw: string): ComputePoolId {
  return raw as ComputePoolId;
}

/* ─────────────────────────────────────────────────────────────
 * Workload model + priority classes (Sections L, M, N, O)
 * ────────────────────────────────────────────────────────────*/

export type WorkloadType =
  | "interactive"
  | "background"
  | "ai"
  | "analytics"
  | "integration"
  | "media"
  | "simulation"
  | "automation";

export const WORKLOAD_TYPES: readonly WorkloadType[] = [
  "interactive",
  "background",
  "ai",
  "analytics",
  "integration",
  "media",
  "simulation",
  "automation",
] as const;

export type PriorityClass = "critical" | "high" | "normal" | "background" | "best_effort";

export const PRIORITY_CLASSES: readonly PriorityClass[] = [
  "critical",
  "high",
  "normal",
  "background",
  "best_effort",
] as const;

export const PRIORITY_RANK: Record<PriorityClass, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  background: 3,
  best_effort: 4,
};

export interface Workload {
  id: WorkloadId;
  name: string;
  type: WorkloadType;
  priorityClass: PriorityClass;
}

export function createWorkload(input: {
  id: WorkloadId;
  name: string;
  type: WorkloadType;
  priorityClass: PriorityClass;
}): { ok: true; workload: Workload } | { ok: false; error: string } {
  if (!input.id) return { ok: false, error: "Workload id is required (Section L)" };
  if (!input.name.trim()) return { ok: false, error: "Workload name is required (Section L)" };
  if (!WORKLOAD_TYPES.includes(input.type)) {
    return { ok: false, error: "Unknown workload type (Section L)" };
  }
  return {
    ok: true,
    workload: {
      id: input.id,
      name: input.name,
      type: input.type,
      priorityClass: input.priorityClass,
    },
  };
}

export interface ComputePool {
  id: ComputePoolId;
  name: string;
  accepts: WorkloadType[];
}

export function createComputePool(input: {
  id: ComputePoolId;
  name: string;
  accepts: WorkloadType[];
}): { ok: true; pool: ComputePool } | { ok: false; error: string } {
  if (!input.name.trim()) return { ok: false, error: "Compute pool name is required (Section M)" };
  if (input.accepts.length === 0) {
    return { ok: false, error: "Compute pool must accept at least one workload type (Section M)" };
  }
  return { ok: true, pool: { id: input.id, name: input.name, accepts: input.accepts } };
}

export function assignWorkloadToPool(
  workload: Workload,
  pool: ComputePool,
):
  | { ok: true; assignment: { workloadRef: WorkloadId; poolRef: ComputePoolId } }
  | { ok: false; error: string } {
  if (!pool.accepts.includes(workload.type)) {
    return {
      ok: false,
      error: `Pool does not accept workload type "${workload.type}" (Section M)`,
    };
  }
  return { ok: true, assignment: { workloadRef: workload.id, poolRef: pool.id } };
}

// Workload types that can consume disproportionate resources (Section N).
export const EXPENSIVE_WORKLOAD_TYPES: readonly WorkloadType[] = [
  "ai",
  "analytics",
  "media",
  "simulation",
  "integration",
] as const;

// Section N: no expensive workload may share a pool with critical/high
// priority interactive workloads and starve them.
export function isWorkloadIsolationSatisfied(
  assignments: readonly { workload: Workload; pool: ComputePool }[],
): boolean {
  for (const assignment of assignments) {
    if (!EXPENSIVE_WORKLOAD_TYPES.includes(assignment.workload.type)) continue;
    const interactiveInSamePool = assignments.find(
      (other) =>
        other.pool.id === assignment.pool.id &&
        other.workload.type === "interactive" &&
        PRIORITY_RANK[other.workload.priorityClass] <= PRIORITY_RANK.high,
    );
    if (interactiveInSamePool) return false;
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Scale dimensions (Sections E, F)
 * ────────────────────────────────────────────────────────────*/

export type ScaleDimensionName =
  | "tenant"
  | "institution"
  | "geographic"
  | "user"
  | "device"
  | "data"
  | "event"
  | "workflow"
  | "ai"
  | "integration"
  | "financial"
  | "communication"
  | "digital_twin"
  | "observability"
  | "operational";

export const SCALE_DIMENSIONS: readonly ScaleDimensionName[] = [
  "tenant",
  "institution",
  "geographic",
  "user",
  "device",
  "data",
  "event",
  "workflow",
  "ai",
  "integration",
  "financial",
  "communication",
  "digital_twin",
  "observability",
  "operational",
] as const;

export interface ScaleDimension {
  name: ScaleDimensionName;
  current: number;
  projected: number;
  capacity: number;
  unit: string;
}

export function createScaleDimension(input: {
  name: ScaleDimensionName;
  current: number;
  projected: number;
  capacity: number;
  unit: string;
}): { ok: true; dimension: ScaleDimension } | { ok: false; error: string } {
  if (!SCALE_DIMENSIONS.includes(input.name)) {
    return { ok: false, error: "Unknown scale dimension (Section F)" };
  }
  if (input.current < 0 || input.projected < 0 || input.capacity <= 0) {
    return {
      ok: false,
      error: "Scale dimension values must be non-negative with positive capacity (Section F)",
    };
  }
  return {
    ok: true,
    dimension: {
      name: input.name,
      current: input.current,
      projected: input.projected,
      capacity: input.capacity,
      unit: input.unit,
    },
  };
}

export function isDimensionAtRisk(dimension: ScaleDimension): boolean {
  return dimension.projected > dimension.capacity;
}

/* ─────────────────────────────────────────────────────────────
 * Scaling strategy (Sections G, H, I)
 * ────────────────────────────────────────────────────────────*/

export interface ScalingStrategy {
  service: string;
  horizontal: boolean;
  vertical: boolean;
  verticalOnlyJustification?: string;
}

export function createScalingStrategy(input: {
  service: string;
  horizontal: boolean;
  vertical: boolean;
  verticalOnlyJustification?: string;
}): { ok: true; strategy: ScalingStrategy } | { ok: false; error: string } {
  if (!input.service.trim())
    return { ok: false, error: "Scaling strategy service is required (Section G)" };
  if (!input.horizontal && !input.vertical) {
    return {
      ok: false,
      error: "A scaling strategy must include at least one direction (Section H)",
    };
  }
  // Section I: vertical scaling must never become the only strategy.
  if (!input.horizontal && !input.verticalOnlyJustification) {
    return {
      ok: false,
      error: "Vertical-only scaling requires an explicit justification (Section I)",
    };
  }
  return {
    ok: true,
    strategy: {
      service: input.service,
      horizontal: input.horizontal,
      vertical: input.vertical,
      verticalOnlyJustification: input.verticalOnlyJustification,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * State management (Section J)
 * ────────────────────────────────────────────────────────────*/

export interface StateContract {
  statefulSystem: string;
  ownership: string;
  partitioning: string;
  replication: string;
  consistency: string;
  recovery: string;
  migration: string;
}

export function createStateContract(input: {
  statefulSystem: string;
  ownership: string;
  partitioning: string;
  replication: string;
  consistency: string;
  recovery: string;
  migration: string;
}): { ok: true; contract: StateContract } | { ok: false; error: string } {
  const required: [string, string][] = [
    ["ownership", input.ownership],
    ["partitioning", input.partitioning],
    ["replication", input.replication],
    ["consistency", input.consistency],
    ["recovery", input.recovery],
    ["migration", input.migration],
  ];
  for (const [field, value] of required) {
    if (!value.trim()) {
      return { ok: false, error: `State contract "${field}" must be explicit (Section J)` };
    }
  }
  return { ok: true, contract: { ...input } };
}

/* ─────────────────────────────────────────────────────────────
 * Service boundaries (Section K)
 * ────────────────────────────────────────────────────────────*/

export interface ServiceBoundary {
  service: string;
  owner: string;
  upstreamDependencies: string[];
  downstreamConsumers: string[];
}

export function createServiceBoundary(input: {
  service: string;
  owner: string;
  upstreamDependencies?: string[];
  downstreamConsumers?: string[];
}): { ok: true; boundary: ServiceBoundary } | { ok: false; error: string } {
  if (!input.service.trim()) return { ok: false, error: "Service is required (Section K)" };
  if (!input.owner.trim()) return { ok: false, error: "Service owner is required (Section K)" };
  return {
    ok: true,
    boundary: {
      service: input.service,
      owner: input.owner,
      upstreamDependencies: input.upstreamDependencies ?? [],
      downstreamConsumers: input.downstreamConsumers ?? [],
    },
  };
}
