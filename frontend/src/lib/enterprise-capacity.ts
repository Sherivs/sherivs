/**
 * CoreGrid Enterprise Capacity — quotas, quota hierarchy, rate limiting,
 * backpressure, queue architecture, and event stream contracts.
 *
 * Implements `architecture/phase-31-enterprise-scale.md`:
 * - Resource governance (P) and quotas (Q) for API calls, storage, compute,
 *   AI inference, workflow execution, messaging, data ingestion,
 *   integrations, devices, and files.
 * - Quota hierarchy (R): Global → Region → Tenant → Institution → Campus →
 *   User/Service; parent limits apply to children.
 * - Quota safety (S): enforcement must never silently corrupt authoritative
 *   operations; critical workloads may hold protected capacity.
 * - Rate limiting (T): user/tenant/API/integration/service level limits.
 * - Adaptive rate limiting (U): limits adapt to traffic, system health,
 *   tenant tier, resource availability, and abuse signals.
 * - Backpressure (V): producer → queue → controlled consumption instead of
 *   uncontrolled overload.
 * - Queue architecture (W): partitioning, retries, dead-letter handling,
 *   ordering where required, visibility timeout, replay, monitoring.
 * - Event scale (X), event partitioning (Y), explicit event ordering (Z) —
 *   no global ordering where local ordering is sufficient — controlled event
 *   replay (AA), governed event retention (AB).
 *
 * Phase 05 runtime-resilience remains the enforcement mechanism; this module
 * provides the enterprise quota/backpressure/event contract layer consumed by
 * reference (AGENTS.md 65).
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type QuotaId = string & { readonly __brand: "QuotaId" };
export type QueueId = string & { readonly __brand: "QueueId" };
export type EventStreamId = string & { readonly __brand: "EventStreamId" };

export function quotaId(raw: string): QuotaId {
  return raw as QuotaId;
}
export function queueId(raw: string): QueueId {
  return raw as QueueId;
}
export function eventStreamId(raw: string): EventStreamId {
  return raw as EventStreamId;
}

/* ─────────────────────────────────────────────────────────────
 * Quotas (Sections Q, R, S)
 * ────────────────────────────────────────────────────────────*/

export type QuotaResource =
  | "api_calls"
  | "storage"
  | "compute"
  | "ai_inference"
  | "workflow_execution"
  | "messaging"
  | "data_ingestion"
  | "integrations"
  | "devices"
  | "files";

export const QUOTA_RESOURCES: readonly QuotaResource[] = [
  "api_calls",
  "storage",
  "compute",
  "ai_inference",
  "workflow_execution",
  "messaging",
  "data_ingestion",
  "integrations",
  "devices",
  "files",
] as const;

export type QuotaScope =
  "global" | "region" | "tenant" | "institution" | "campus" | "user" | "service";

export const QUOTA_HIERARCHY: readonly QuotaScope[] = [
  "global",
  "region",
  "tenant",
  "institution",
  "campus",
  "user",
  "service",
] as const;

export const QUOTA_RANK: Record<QuotaScope, number> = {
  global: 0,
  region: 1,
  tenant: 2,
  institution: 3,
  campus: 4,
  user: 5,
  service: 6,
};

export interface Quota {
  id: QuotaId;
  resource: QuotaResource;
  scope: QuotaScope;
  scopeRef?: string;
  limit: number;
  /** Section S: protected capacity for critical workloads, never exceeding the limit. */
  protectedCapacity?: number;
}

export function createQuota(input: {
  id: QuotaId;
  resource: QuotaResource;
  scope: QuotaScope;
  scopeRef?: string;
  limit: number;
  protectedCapacity?: number;
}): { ok: true; quota: Quota } | { ok: false; error: string } {
  if (!Number.isFinite(input.limit) || input.limit <= 0) {
    return { ok: false, error: "Quota limit must be a positive number (Section Q)" };
  }
  if (input.protectedCapacity !== undefined && input.protectedCapacity > input.limit) {
    return { ok: false, error: "Protected capacity must not exceed the quota limit (Section S)" };
  }
  return {
    ok: true,
    quota: {
      id: input.id,
      resource: input.resource,
      scope: input.scope,
      scopeRef: input.scopeRef,
      limit: input.limit,
      protectedCapacity: input.protectedCapacity,
    },
  };
}

export function buildQuotaHierarchy(
  quotas: readonly Quota[],
  resource: QuotaResource,
): { ok: true; chain: Quota[] } | { ok: false; error: string } {
  const scoped = quotas.filter((q) => q.resource === resource);
  if (scoped.length === 0)
    return { ok: false, error: "No quotas defined for resource (Section R)" };
  const seen = new Set<QuotaScope>();
  for (const quota of scoped) {
    if (seen.has(quota.scope)) {
      return { ok: false, error: `Duplicate quota scope "${quota.scope}" (Section R)` };
    }
    seen.add(quota.scope);
  }
  return { ok: true, chain: [...scoped].sort((a, b) => QUOTA_RANK[a.scope] - QUOTA_RANK[b.scope]) };
}

// Section R: parent limits apply to children — resolve the most specific
// quota at or above the requested scope.
export function resolveEffectiveQuota(
  quotas: readonly Quota[],
  resource: QuotaResource,
  atScope: QuotaScope,
):
  | { ok: true; limit: number; protectedCapacity: number; sourceScope: QuotaScope }
  | { ok: false; error: string } {
  const applicable = quotas
    .filter((q) => q.resource === resource && QUOTA_RANK[q.scope] <= QUOTA_RANK[atScope])
    .sort((a, b) => QUOTA_RANK[b.scope] - QUOTA_RANK[a.scope]);
  const top = applicable[0];
  if (!top)
    return { ok: false, error: `No quota for resource at or above "${atScope}" (Section R)` };
  return {
    ok: true,
    limit: top.limit,
    protectedCapacity: top.protectedCapacity ?? 0,
    sourceScope: top.scope,
  };
}

export function isQuotaExceeded(quota: Quota, usage: number): boolean {
  return usage > quota.limit;
}

// Section S: enforcement never silently corrupts authoritative operations —
// protected capacity keeps critical workloads running, others are denied.
export function consumeQuota(
  quota: Quota,
  usage: number,
  requestAmount = 1,
  critical = false,
): { ok: true; remaining: number } | { ok: false; error: string } {
  const effectiveLimit =
    critical && quota.protectedCapacity !== undefined ? quota.protectedCapacity : quota.limit;
  if (usage + requestAmount > effectiveLimit) {
    return {
      ok: false,
      error: critical ? "Protected quota capacity exhausted" : "Quota exceeded (Section S)",
    };
  }
  return { ok: true, remaining: effectiveLimit - (usage + requestAmount) };
}

/* ─────────────────────────────────────────────────────────────
 * Rate limiting + adaptive limits (Sections T, U)
 * ────────────────────────────────────────────────────────────*/

export type RateLimitScope = "user" | "tenant" | "api" | "integration" | "service";

export interface RateLimitPolicy {
  id: string;
  scope: RateLimitScope;
  limitPerMinute: number;
  adaptive: boolean;
}

export function createRateLimitPolicy(input: {
  id: string;
  scope: RateLimitScope;
  limitPerMinute: number;
  adaptive?: boolean;
}): { ok: true; policy: RateLimitPolicy } | { ok: false; error: string } {
  if (!Number.isFinite(input.limitPerMinute) || input.limitPerMinute <= 0) {
    return { ok: false, error: "Rate limit must be a positive number (Section T)" };
  }
  return {
    ok: true,
    policy: {
      id: input.id,
      scope: input.scope,
      limitPerMinute: input.limitPerMinute,
      adaptive: input.adaptive ?? false,
    },
  };
}

export function isWithinRateLimit(policy: RateLimitPolicy, count: number): boolean {
  return count <= policy.limitPerMinute;
}

export type AdaptiveFactor =
  "traffic" | "system_health" | "tenant_tier" | "resource_availability" | "abuse_signal";

export const ADAPTIVE_FACTORS: readonly AdaptiveFactor[] = [
  "traffic",
  "system_health",
  "tenant_tier",
  "resource_availability",
  "abuse_signal",
] as const;

// Section U: adaptive limits respond to traffic, system health, tenant tier,
// resource availability, and abuse signals without ever reaching zero.
export function adaptRateLimit(
  policy: RateLimitPolicy,
  factors: { factor: AdaptiveFactor; severity: number }[],
): { ok: true; effectiveLimitPerMinute: number } | { ok: false; error: string } {
  if (!policy.adaptive) {
    return { ok: true, effectiveLimitPerMinute: policy.limitPerMinute };
  }
  for (const factor of factors) {
    if (!ADAPTIVE_FACTORS.includes(factor.factor)) {
      return { ok: false, error: "Unknown adaptive factor (Section U)" };
    }
    if (!Number.isFinite(factor.severity) || factor.severity < 0 || factor.severity > 1) {
      return { ok: false, error: "Adaptive factor severity must be between 0 and 1 (Section U)" };
    }
  }
  const multiplier = factors.reduce((acc, factor) => acc * (1 - factor.severity * 0.5), 1);
  return {
    ok: true,
    effectiveLimitPerMinute: Math.max(1, Math.floor(policy.limitPerMinute * multiplier)),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Backpressure + queues (Sections V, W)
 * ────────────────────────────────────────────────────────────*/

export interface BackpressureQueue {
  id: QueueId;
  producer: string;
  consumer: string;
  maxDepth: number;
  currentDepth: number;
}

export function createBackpressureQueue(input: {
  id: QueueId;
  producer: string;
  consumer: string;
  maxDepth: number;
}): { ok: true; queue: BackpressureQueue } | { ok: false; error: string } {
  if (!input.producer.trim() || !input.consumer.trim()) {
    return { ok: false, error: "Backpressure queue requires a producer and consumer (Section V)" };
  }
  if (!Number.isInteger(input.maxDepth) || input.maxDepth <= 0) {
    return { ok: false, error: "Backpressure queue depth must be a positive integer (Section V)" };
  }
  return {
    ok: true,
    queue: {
      id: input.id,
      producer: input.producer,
      consumer: input.consumer,
      maxDepth: input.maxDepth,
      currentDepth: 0,
    },
  };
}

// Section V: explicit backpressure — controlled consumption over overload.
export function isBackpressureEngaged(queue: BackpressureQueue): boolean {
  return queue.currentDepth >= queue.maxDepth;
}

export function enqueue(
  queue: BackpressureQueue,
  depth: number,
): { ok: true; queue: BackpressureQueue } | { ok: false; error: string } {
  if (depth > queue.maxDepth) {
    return { ok: false, error: "Backpressure engaged — producer must pause (Section V)" };
  }
  return { ok: true, queue: { ...queue, currentDepth: depth } };
}

export interface QueueArchitecture {
  id: string;
  partitionable: boolean;
  retries: boolean;
  deadLetter: boolean;
  ordering: "none" | "key_ordered" | "global";
  visibilityTimeoutMs: number;
  replay: boolean;
  monitoring: boolean;
}

export function createQueueArchitecture(input: {
  id: string;
  partitionable: boolean;
  retries: boolean;
  deadLetter: boolean;
  ordering: QueueArchitecture["ordering"];
  visibilityTimeoutMs: number;
  replay?: boolean;
  monitoring?: boolean;
}): { ok: true; architecture: QueueArchitecture } | { ok: false; error: string } {
  if (!Number.isInteger(input.visibilityTimeoutMs) || input.visibilityTimeoutMs <= 0) {
    return { ok: false, error: "Queue visibility timeout must be positive (Section W)" };
  }
  return {
    ok: true,
    architecture: {
      id: input.id,
      partitionable: input.partitionable,
      retries: input.retries,
      deadLetter: input.deadLetter,
      ordering: input.ordering,
      visibilityTimeoutMs: input.visibilityTimeoutMs,
      replay: input.replay ?? false,
      monitoring: input.monitoring ?? false,
    },
  };
}

export function isQueueArchitectureComplete(architecture: QueueArchitecture): boolean {
  return (
    architecture.partitionable &&
    architecture.retries &&
    architecture.deadLetter &&
    architecture.visibilityTimeoutMs > 0 &&
    architecture.monitoring
  );
}

/* ─────────────────────────────────────────────────────────────
 * Event streams (Sections X, Y, Z, AA, AB)
 * ────────────────────────────────────────────────────────────*/

export type EventPartitionKey = "tenant" | "institution" | "region" | "entity" | "event_type";

export interface EventStream {
  id: EventStreamId;
  name: string;
  partitionBy: EventPartitionKey;
  ordering: "global" | "local";
  globalOrderingJustification?: string;
  retentionGoverned: boolean;
  replayEnabled: boolean;
}

export function createEventStream(input: {
  id: EventStreamId;
  name: string;
  partitionBy: EventPartitionKey;
  ordering: "global" | "local";
  globalOrderingJustification?: string;
  retentionGoverned?: boolean;
  replayEnabled?: boolean;
}): { ok: true; stream: EventStream } | { ok: false; error: string } {
  if (!input.name.trim()) return { ok: false, error: "Event stream name is required (Section X)" };
  if (!["tenant", "institution", "region", "entity", "event_type"].includes(input.partitionBy)) {
    return { ok: false, error: "Unknown event partition key (Section Y)" };
  }
  if (input.ordering === "global" && !input.globalOrderingJustification) {
    return { ok: false, error: "Global ordering requires an explicit justification (Section Z)" };
  }
  return {
    ok: true,
    stream: {
      id: input.id,
      name: input.name,
      partitionBy: input.partitionBy,
      ordering: input.ordering,
      globalOrderingJustification: input.globalOrderingJustification,
      retentionGoverned: input.retentionGoverned ?? false,
      replayEnabled: input.replayEnabled ?? false,
    },
  };
}

// Section Z: do not impose global ordering where local ordering is sufficient.
export function isOrderingAppropriate(stream: EventStream): boolean {
  if (stream.ordering === "global") return Boolean(stream.globalOrderingJustification);
  return true;
}

// Sections AA + AB: controlled replay requires governed retention.
export function canReplayEventStream(stream: EventStream): boolean {
  return stream.replayEnabled && stream.retentionGoverned;
}

export function isRetentionGoverned(stream: EventStream): boolean {
  return stream.retentionGoverned;
}
