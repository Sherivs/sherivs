/**
 * CoreGrid — Core Application Runtime core context.
 *
 * Implements `architecture/phase-05-core-application-runtime.md`:
 * - Request context: every application request has a structured context (Section I).
 * - Correlation: operations support correlation across API calls, jobs, events,
 *   integrations, database operations, logs, traces (Section J).
 * - Causation: operations preserve causation information (Section K).
 * - Tenant context is mandatory for tenant-scoped operations (Sections DA, FV).
 * - Identity context is explicit (Section FX).
 * - Timezone/locale/region context (Sections EZ, FA, EV).
 * - No bypass of tenancy (Section FV).
 * - No bypass of security (Section FW).
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type RequestId = string & { readonly __brand: "RequestId" };
export type CorrelationId = string & { readonly __brand: "CorrelationId" };
export type TraceId = string & { readonly __brand: "TraceId" };
export type OperationId = string & { readonly __brand: "OperationId" };

export function requestId(raw: string): RequestId {
  return raw as RequestId;
}

export function correlationId(raw: string): CorrelationId {
  return raw as CorrelationId;
}

export function traceId(raw: string): TraceId {
  return raw as TraceId;
}

export function operationId(raw: string): OperationId {
  return raw as OperationId;
}

/* ─────────────────────────────────────────────────────────────
 * Execution context (Section I, FX)
 * ────────────────────────────────────────────────────────────*/

export type ExecutionSource =
  "api" | "webhook" | "event" | "job" | "scheduler" | "agent" | "internal" | "integration";

export const EXECUTION_SOURCES: readonly ExecutionSource[] = [
  "api",
  "webhook",
  "event",
  "job",
  "scheduler",
  "agent",
  "internal",
  "integration",
] as const;

export interface ExecutionContext {
  /** Unique request ID. */
  requestId: RequestId;
  /** Correlation ID spanning related operations. */
  correlationId: CorrelationId;
  /** Trace ID for distributed tracing. */
  traceId: TraceId;
  /** What triggered this execution. */
  source: ExecutionSource;
  /** Identity of the actor (Phase 02). */
  actorId: string | null;
  /** Tenant context (Phase 03). Mandatory for tenant-scoped operations. */
  tenantId: TenantId | null;
  /** Whether tenant context is required for this operation. */
  tenantRequired: boolean;
  /** Causation: the operation that triggered this one (Section K). */
  causation: {
    parentOperationId: OperationId | null;
    parentEventId: string | null;
    parentJobId: string | null;
  };
  /** Region context (Section EV). */
  region: string | null;
  /** Timezone (Section EZ). */
  timezone: string | null;
  /** Locale (Section FA). */
  locale: string | null;
  /** Environment. */
  environment: "production" | "staging" | "test" | "development";
  /** Whether this is a platform-scoped operation (Section DD). */
  isPlatformOperation: boolean;
  /** Whether this is a cross-tenant operation requiring elevated authority (Section DB). */
  isCrossTenantOperation: boolean;
  /** Purpose of the operation (privacy). */
  purpose: string | null;
  /** Data classification context. */
  dataClassification: "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";
  /** When the request was received. */
  receivedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Context validation (Sections DA, FV)
 * ────────────────────────────────────────────────────────────*/

export type ContextValidationResult =
  { ok: true; context: ExecutionContext } | { ok: false; error: string };

/**
 * Validate that an execution context satisfies CoreGrid invariants.
 * - Tenant context is mandatory for tenant-scoped operations (Section DA).
 * - Cross-tenant operations require explicit elevated authority (Section DB).
 * - Platform operations must not accidentally execute with ordinary tenant privileges (Section DD).
 */
export function validateExecutionContext(context: ExecutionContext): ContextValidationResult {
  // Tenant context is mandatory for tenant-scoped operations (Section DA, FV).
  if (context.tenantRequired && context.tenantId === null) {
    return {
      ok: false,
      error: "Tenant context is mandatory for tenant-scoped operations",
    };
  }

  // Cross-tenant operations require explicit elevated authority (Section DB).
  if (context.isCrossTenantOperation && !context.isPlatformOperation) {
    return {
      ok: false,
      error: "Cross-tenant operations require explicit elevated authority",
    };
  }

  // Platform operations must not accidentally execute with ordinary tenant privileges (Section DD).
  if (context.isPlatformOperation && context.tenantId !== null) {
    return {
      ok: false,
      error: "Platform operations must not carry ordinary tenant context",
    };
  }

  // Correlation ID is always required.
  if (context.correlationId.length === 0) {
    return { ok: false, error: "Correlation ID is required" };
  }

  // Request ID is always required.
  if (context.requestId.length === 0) {
    return { ok: false, error: "Request ID is required" };
  }

  return { ok: true, context };
}

/* ─────────────────────────────────────────────────────────────
 * Context factory
 * ────────────────────────────────────────────────────────────*/

export interface CreateExecutionContextInput {
  source: ExecutionSource;
  actorId: string | null;
  tenantId: TenantId | null;
  tenantRequired: boolean;
  region?: string | null;
  timezone?: string | null;
  locale?: string | null;
  environment?: "production" | "staging" | "test" | "development";
  isPlatformOperation?: boolean;
  isCrossTenantOperation?: boolean;
  purpose?: string | null;
  dataClassification?: "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";
  parentOperationId?: OperationId | null;
  parentEventId?: string | null;
  parentJobId?: string | null;
  now: string;
}

export function createExecutionContext(input: CreateExecutionContextInput): ExecutionContext {
  const requestIdValue = requestId(`req-${input.now}-${Math.random().toString(36).slice(2, 10)}`);
  const correlationIdValue = correlationId(
    `corr-${input.now}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const traceIdValue = traceId(`trace-${input.now}-${Math.random().toString(36).slice(2, 10)}`);

  return {
    requestId: requestIdValue,
    correlationId: correlationIdValue,
    traceId: traceIdValue,
    source: input.source,
    actorId: input.actorId,
    tenantId: input.tenantId,
    tenantRequired: input.tenantRequired,
    causation: {
      parentOperationId: input.parentOperationId ?? null,
      parentEventId: input.parentEventId ?? null,
      parentJobId: input.parentJobId ?? null,
    },
    region: input.region ?? null,
    timezone: input.timezone ?? null,
    locale: input.locale ?? null,
    environment: input.environment ?? "development",
    isPlatformOperation: input.isPlatformOperation ?? false,
    isCrossTenantOperation: input.isCrossTenantOperation ?? false,
    purpose: input.purpose ?? null,
    dataClassification: input.dataClassification ?? "TENANT_INTERNAL",
    receivedAt: input.now,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Operation tracking (Section CM)
 * ────────────────────────────────────────────────────────────*/

export type OperationStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "requires_approval"
  | "approved"
  | "rejected";

export const OPERATION_STATUSES: readonly OperationStatus[] = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "requires_approval",
  "approved",
  "rejected",
] as const;

export interface OperationRecord {
  id: OperationId;
  tenantId: TenantId | null;
  actorId: string | null;
  capability: string;
  command: string | null;
  status: OperationStatus;
  correlationId: CorrelationId;
  traceId: TraceId;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  /** Whether this operation requires human approval (Section CI). */
  requiresApproval: boolean;
  /** Approval state (Section CJ). */
  approvalState: "not_required" | "pending" | "approved" | "rejected" | null;
  /** Whether this operation was agent-initiated (Section CH). */
  isAgentInitiated: boolean;
  /** Whether this operation is idempotent (Section L4). */
  isIdempotent: boolean;
  /** Idempotency key. */
  idempotencyKey: string | null;
}

export interface CreateOperationInput {
  tenantId: TenantId | null;
  actorId: string | null;
  capability: string;
  command: string | null;
  correlationId: CorrelationId;
  traceId: TraceId;
  requiresApproval?: boolean;
  isAgentInitiated?: boolean;
  isIdempotent?: boolean;
  idempotencyKey?: string | null;
  now: string;
}

export function createOperationRecord(input: CreateOperationInput): OperationRecord {
  return {
    id: operationId(`op-${input.now}-${Math.random().toString(36).slice(2, 10)}`),
    tenantId: input.tenantId,
    actorId: input.actorId,
    capability: input.capability,
    command: input.command,
    status: "pending",
    correlationId: input.correlationId,
    traceId: input.traceId,
    startedAt: input.now,
    completedAt: null,
    error: null,
    requiresApproval: input.requiresApproval ?? false,
    approvalState: input.requiresApproval ? "pending" : "not_required",
    isAgentInitiated: input.isAgentInitiated ?? false,
    isIdempotent: input.isIdempotent ?? false,
    idempotencyKey: input.idempotencyKey ?? null,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Time context (Sections EY, EZ)
 * ────────────────────────────────────────────────────────────*/

export type TimeKind = "event_time" | "processing_time" | "scheduled_time" | "display_time";

export const TIME_KINDS: readonly TimeKind[] = [
  "event_time",
  "processing_time",
  "scheduled_time",
  "display_time",
] as const;

export interface TimeContext {
  /** Canonical UTC timestamp. */
  utcTimestamp: string;
  /** Timezone of the institution/user (Section EZ). */
  timezone: string;
  /** Locale (Section FA). */
  locale: string;
  /** Kind of time this represents (Section EY). */
  kind: TimeKind;
}

export function createTimeContext(
  utcTimestamp: string,
  timezone: string,
  locale: string,
  kind: TimeKind,
): TimeContext {
  return { utcTimestamp, timezone, locale, kind };
}
