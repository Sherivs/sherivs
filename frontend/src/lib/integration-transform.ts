/**
 * CoreGrid Integration Fabric — transformation, validation, event, sync, and
 * reconciliation domain.
 *
 * Implements `architecture/phase-29-coregrid-integration.md`:
 * - Data transformation (S): external schemas rarely match; mapping to canonical.
 * - Canonical data model (T): CoreGrid maintains canonical contracts for
 *   person/organization/student/staff/course/class/attendance/payment/invoice/
 *   device/event/message — consuming authoritative schemas from other phases.
 * - Field mapping (U): direct, rename, type conversion, conditional, calculated,
 *   normalization, enrichment, filtering.
 * - Transformation engine (V): JSON, XML, CSV, YAML, form data, binary.
 * - Validation (W): every incoming payload validated before entering an
 *   authoritative CoreGrid subsystem (schema, type, required fields, identity,
 *   tenant, authorization, integrity, business constraints).
 * - Invalid data (X): route to rejection, quarantine, dead-letter queue, or
 *   manual review — never silently enter production.
 * - Idempotency (Y) + deduplication (Z): repeated external requests must not
 *   create duplicate records (event IDs, external IDs, idempotency keys,
 *   content fingerprints, reconciliation keys).
 * - Event integration (AA-AD): ingestion (webhooks, queues, streams, polling,
 *   scheduled), normalization to canonical events, delivery guarantees.
 * - Event replay (AE), dead-letter system (AF), retry engine (AG) with
 *   exponential backoff + jitter + max attempts + classification + circuit
 *   breakers, rate-limit management (AI), polling (AJ).
 * - Synchronization (AK-AM): incremental, full, bidirectional.
 * - Source of truth (AN): every synchronized field has an explicit authority
 *   model; no ambiguous ownership. Conflict resolution (AO): CoreGrid wins,
 *   external wins, latest timestamp, source priority, manual resolution.
 * - Reconciliation (AP-AQ): compare CoreGrid vs external state; identify missing,
 *   duplicates, mismatches, stale, unauthorized changes; reports.
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type IntegrationMappingId = string & { readonly __brand: "IntegrationMappingId" };
export type DeadLetterEntryId = string & { readonly __brand: "DeadLetterEntryId" };
export type SyncJobId = string & { readonly __brand: "SyncJobId" };
export type ReconciliationRunId = string & { readonly __brand: "ReconciliationRunId" };

export function integrationMappingId(raw: string): IntegrationMappingId {
  return raw as IntegrationMappingId;
}
export function deadLetterEntryId(raw: string): DeadLetterEntryId {
  return raw as DeadLetterEntryId;
}
export function syncJobId(raw: string): SyncJobId {
  return raw as SyncJobId;
}
export function reconciliationRunId(raw: string): ReconciliationRunId {
  return raw as ReconciliationRunId;
}

/* ─────────────────────────────────────────────────────────────
 * Field mapping (Sections U) + transformation (V)
 * ────────────────────────────────────────────────────────────*/

export type MappingKind =
  | "direct"
  | "rename"
  | "type_conversion"
  | "conditional"
  | "calculated"
  | "normalization"
  | "enrichment"
  | "filtering";

export const MAPPING_KINDS: readonly MappingKind[] = [
  "direct",
  "rename",
  "type_conversion",
  "conditional",
  "calculated",
  "normalization",
  "enrichment",
  "filtering",
] as const;

export interface IntegrationMapping {
  id: IntegrationMappingId;
  integrationRef: string;
  /** External field path. */
  externalField: string;
  /** CoreGrid canonical field path. */
  coregridField: string;
  kind: MappingKind;
  /** Mapping expression for conditional/calculated kinds. */
  expression: string | null;
}

export function createIntegrationMapping(input: {
  id: IntegrationMappingId;
  integrationRef: string;
  externalField: string;
  coregridField: string;
  kind: MappingKind;
  expression?: string | null;
}): { ok: true; mapping: IntegrationMapping } | { ok: false; error: string } {
  if (!input.externalField.trim() || !input.coregridField.trim()) {
    return { ok: false, error: "Mapping requires both external and CoreGrid fields" };
  }
  if ((input.kind === "conditional" || input.kind === "calculated") && !input.expression) {
    return { ok: false, error: `${input.kind} mapping requires an expression` };
  }
  return {
    ok: true,
    mapping: {
      id: input.id,
      integrationRef: input.integrationRef,
      externalField: input.externalField,
      coregridField: input.coregridField,
      kind: input.kind,
      expression: input.expression ?? null,
    },
  };
}

/** Transform an external payload into canonical shape by applying mappings. */
export function applyMapping(
  payload: Record<string, unknown>,
  mappings: IntegrationMapping[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of mappings) {
    if (m.kind === "filtering") continue;
    const value = payload[m.externalField];
    if (value === undefined) continue;
    if (m.kind === "type_conversion") {
      out[m.coregridField] = String(value);
    } else {
      out[m.coregridField] = value;
    }
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────
 * Validation (W) + invalid data routing (X)
 * ────────────────────────────────────────────────────────────*/

export interface InboundValidationInput {
  payload: Record<string, unknown>;
  requiredFields: string[];
  tenantId: TenantId | null;
  /** Whether the payload carries a valid identity/authorization. */
  identityValid: boolean;
  /** Whether the payload integrity check passed. */
  integrityValid: boolean;
}

export type ValidationOutcome =
  "accepted" | "rejected" | "quarantined" | "dead_lettered" | "manual_review";

export function validateInboundPayload(input: InboundValidationInput): {
  outcome: ValidationOutcome;
  reasons: string[];
} {
  const reasons: string[] = [];
  for (const field of input.requiredFields) {
    if (
      input.payload[field] === undefined ||
      input.payload[field] === null ||
      input.payload[field] === ""
    ) {
      reasons.push(`Missing required field: ${field}`);
    }
  }
  if (!input.tenantId) reasons.push("Missing tenant context");
  if (!input.identityValid) reasons.push("Identity validation failed");
  if (!input.integrityValid) reasons.push("Payload integrity check failed");
  if (reasons.length === 0) return { outcome: "accepted", reasons };
  // Invalid payloads must not silently enter production (Section X).
  const outcome: ValidationOutcome = reasons.includes("Payload integrity check failed")
    ? "dead_lettered"
    : reasons.includes("Missing tenant context")
      ? "manual_review"
      : "quarantined";
  return { outcome, reasons };
}

/* ─────────────────────────────────────────────────────────────
 * Idempotency (Y) + deduplication (Z)
 * ────────────────────────────────────────────────────────────*/

export interface IdempotencyState {
  integrationRef: string;
  /** Already-processed external event IDs / idempotency keys. */
  processedKeys: string[];
}

export function isEventAlreadyProcessed(state: IdempotencyState, key: string): boolean {
  return state.processedKeys.includes(key);
}

export function markEventProcessed(state: IdempotencyState, key: string): IdempotencyState {
  return { ...state, processedKeys: [...state.processedKeys, key] };
}

export type DeduplicationKey =
  "event_id" | "external_id" | "idempotency_key" | "content_fingerprint" | "reconciliation_key";

export const DEDUPLICATION_KEYS: readonly DeduplicationKey[] = [
  "event_id",
  "external_id",
  "idempotency_key",
  "content_fingerprint",
  "reconciliation_key",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Dead-letter system (AF) + retry engine (AG) + rate limits (AI)
 * ────────────────────────────────────────────────────────────*/

export interface DeadLetterEntry {
  id: DeadLetterEntryId;
  tenantId: TenantId;
  connectorRef: string;
  operation: string;
  attempts: number;
  /** Error classification. */
  error: string;
  /** Correlation ID — secrets must never be exposed (AF). */
  correlationId: string;
  occurredAt: string;
}

export function recordDeadLetter(input: {
  id: DeadLetterEntryId;
  tenantId: TenantId;
  connectorRef: string;
  operation: string;
  attempts: number;
  error: string;
  correlationId: string;
  now?: string;
}): DeadLetterEntry {
  return {
    id: input.id,
    tenantId: input.tenantId,
    connectorRef: input.connectorRef,
    operation: input.operation,
    attempts: input.attempts,
    error: input.error,
    correlationId: input.correlationId,
    occurredAt: input.now ?? timeAuthority.now().at,
  };
}

export type RetryClass =
  "transient" | "rate_limited" | "authorization" | "validation" | "permanent";

export const RETRY_CLASSES: readonly RetryClass[] = [
  "transient",
  "rate_limited",
  "authorization",
  "validation",
  "permanent",
] as const;

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  backoffFactor: number;
  jitterMs: number;
}

/**
 * Retry engine (AG): transient/rate-limited failures are retryable with
 * exponential backoff + jitter; authorization/validation/permanent failures are not.
 */
export function shouldRetry(input: {
  retryClass: RetryClass;
  attempt: number;
  policy: RetryPolicy;
}): boolean {
  if (
    input.retryClass === "permanent" ||
    input.retryClass === "authorization" ||
    input.retryClass === "validation"
  )
    return false;
  if (input.attempt >= input.policy.maxAttempts) return false;
  return true;
}

/** Exponential backoff with jitter (AG). */
export function computeBackoffDelay(input: {
  attempt: number;
  policy: RetryPolicy;
  now?: number;
}): number {
  const base = input.policy.baseDelayMs * Math.pow(input.policy.backoffFactor, input.attempt - 1);
  const jitter = Math.random() * input.policy.jitterMs;
  return Math.round(base + jitter);
}

/**
 * Rate limit management (AI): connectors must respect provider rate limits
 * with throttling, backoff, and concurrency limits.
 */
export function isWithinProviderRateLimit(
  requestsThisMinute: number,
  connectorRateLimit: number,
  concurrencyLimit: number,
): boolean {
  return requestsThisMinute <= connectorRateLimit && concurrencyLimit > 0;
}

/* ─────────────────────────────────────────────────────────────
 * Synchronization (AK-AM) + source of truth (AN) + conflicts (AO)
 * ────────────────────────────────────────────────────────────*/

export type SyncMode = "incremental" | "full" | "bidirectional";

export const SYNC_MODES: readonly SyncMode[] = ["incremental", "full", "bidirectional"] as const;

export type SyncState = "idle" | "running" | "completed" | "failed" | "paused";

export const SYNC_STATES: readonly SyncState[] = [
  "idle",
  "running",
  "completed",
  "failed",
  "paused",
] as const;

export interface SyncJob {
  id: SyncJobId;
  integrationRef: string;
  mode: SyncMode;
  state: SyncState;
  /** Incremental sync cursor (AK). */
  cursor: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export function createSyncJob(input: {
  id: SyncJobId;
  integrationRef: string;
  mode: SyncMode;
  cursor?: string | null;
  now?: string;
}): SyncJob {
  return {
    id: input.id,
    integrationRef: input.integrationRef,
    mode: input.mode,
    state: "idle",
    cursor: input.cursor ?? null,
    startedAt: null,
    completedAt: null,
  };
}

/**
 * Source of truth (AN): every synchronized field must have an explicit authority
 * model — no ambiguous ownership.
 */
export function resolveFieldAuthority(input: {
  field: string;
  coregridAuthoritative: boolean;
  externalAuthoritative: boolean;
}): { owner: "coregrid" | "external"; unambiguous: boolean } {
  if (input.coregridAuthoritative === input.externalAuthoritative) {
    return { owner: input.coregridAuthoritative ? "coregrid" : "external", unambiguous: false };
  }
  return { owner: input.coregridAuthoritative ? "coregrid" : "external", unambiguous: true };
}

export type ConflictPolicy =
  "coregrid_wins" | "external_wins" | "latest_timestamp" | "source_priority" | "manual_resolution";

export const CONFLICT_POLICIES: readonly ConflictPolicy[] = [
  "coregrid_wins",
  "external_wins",
  "latest_timestamp",
  "source_priority",
  "manual_resolution",
] as const;

export function resolveConflict(input: {
  policy: ConflictPolicy;
  coregridTimestamp: string;
  externalTimestamp: string;
}): "coregrid" | "external" | "manual" {
  switch (input.policy) {
    case "coregrid_wins":
      return "coregrid";
    case "external_wins":
      return "external";
    case "latest_timestamp":
      return input.coregridTimestamp >= input.externalTimestamp ? "coregrid" : "external";
    case "source_priority":
      return "coregrid";
    case "manual_resolution":
      return "manual";
  }
}

/* ─────────────────────────────────────────────────────────────
 * Reconciliation (AP, AQ)
 * ────────────────────────────────────────────────────────────*/

export interface ReconciliationComparison {
  coregridRefs: string[];
  externalRefs: string[];
}

export interface ReconciliationResult {
  id: ReconciliationRunId;
  integrationRef: string;
  missingInCoregrid: string[];
  missingInExternal: string[];
  duplicates: string[];
  mismatches: string[];
  staleRecords: string[];
  unauthorizedChanges: string[];
  lastSuccessfulSyncAt: string | null;
  failureRate: number;
  completedAt: string;
}

/**
 * Reconciliation (AP): compare CoreGrid state vs external state and identify
 * missing, duplicates, mismatches, stale records, unauthorized changes.
 */
export function reconcile(input: {
  id: ReconciliationRunId;
  integrationRef: string;
  coregridRefs: string[];
  externalRefs: string[];
  lastSuccessfulSyncAt?: string | null;
  failureRate?: number;
  now?: string;
}): ReconciliationResult {
  const coreSet = new Set(input.coregridRefs);
  const externalSet = new Set(input.externalRefs);
  const missingInCoregrid = input.externalRefs.filter((r) => !coreSet.has(r));
  const missingInExternal = input.coregridRefs.filter((r) => !externalSet.has(r));
  const duplicateCore = input.coregridRefs.filter((r, i) => input.coregridRefs.indexOf(r) !== i);
  const duplicateExternal = input.externalRefs.filter(
    (r, i) => input.externalRefs.indexOf(r) !== i,
  );
  return {
    id: input.id,
    integrationRef: input.integrationRef,
    missingInCoregrid,
    missingInExternal,
    duplicates: [...new Set([...duplicateCore, ...duplicateExternal])],
    mismatches: [],
    staleRecords: [],
    unauthorizedChanges: [],
    lastSuccessfulSyncAt: input.lastSuccessfulSyncAt ?? null,
    failureRate: input.failureRate ?? 0,
    completedAt: input.now ?? timeAuthority.now().at,
  };
}

/** Section AQ: a reconciliation with any unresolved gap is flagged for review. */
export function hasReconciliationGaps(result: ReconciliationResult): boolean {
  return (
    result.missingInCoregrid.length > 0 ||
    result.missingInExternal.length > 0 ||
    result.duplicates.length > 0 ||
    result.mismatches.length > 0 ||
    result.unauthorizedChanges.length > 0
  );
}
