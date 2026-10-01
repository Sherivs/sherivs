/**
 * CoreGrid — Phase 33 Universal Reality Kernel: typed reality contracts.
 *
 * Typed contracts for the kernel substrate tables (cg_entity, cg_relationship,
 * cg_event, cg_observation) authored in the kernel substrate migration
 * (20260903000000_coregrid_universal_kernel_substrate.sql).
 *
 * The DATABASE is the source of truth for constraints (CHECK clauses, indexes,
 * RLS). These contracts mirror that truth so application code never invents
 * values the database would reject. `kernel-reality.test.ts` pins both sides
 * together mechanically.
 *
 * Boundary: this module performs NO persistence and owns NO state. Server
 * functions will write through service-role adapters once the substrate
 * migration is applied. Until then this layer is an authored contract,
 * explicitly incomplete at the persistence level.
 *
 * Canonical CoreObject envelope (V1CAP-002, MISSION-R-10): the persistent
 * object envelope and its fail-closed validation live in the ENVELOPE section
 * below. Every conformant persistent kernel object is stamped through
 * `stampKernelDraft`; anonymous persistent objects are rejected by
 * `validateKernelRowEnvelope`. The object-type registry gate (MISSION-R-11)
 * is injected via the `knownObjectTypes` parameter without an API change.
 */

import {
  KernelObjectTypeRejectedError,
  canonicalKernelObjectTypes,
} from "./object-type-registry";

/* ─────────────────────────────────────────────────────────────
 * Enumerated domains (must match the SQL CHECK clauses exactly)
 * ────────────────────────────────────────────────────────────*/

export type DataClassification =
  "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED" | "HIGHLY_RESTRICTED";

export const DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "SENSITIVE",
  "RESTRICTED",
  "HIGHLY_RESTRICTED",
] as const;

export type ObservationKind = "observed" | "reported" | "inferred" | "predicted" | "simulated";

/** Truth-hierarchy kinds are never collapsed (phase-01 §56 / kernel). */
export const OBSERVATION_KINDS: readonly ObservationKind[] = [
  "observed",
  "reported",
  "inferred",
  "predicted",
  "simulated",
] as const;

export type EventDeliveryState = "pending" | "published" | "failed" | "acknowledged" | "dead";

export const EVENT_DELIVERY_STATES: readonly EventDeliveryState[] = [
  "pending",
  "published",
  "failed",
  "acknowledged",
  "dead",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Guards
 * ────────────────────────────────────────────────────────────*/

export function isDataClassification(value: unknown): value is DataClassification {
  return (DATA_CLASSIFICATIONS as readonly unknown[]).includes(value);
}

export function isObservationKind(value: unknown): value is ObservationKind {
  return (OBSERVATION_KINDS as readonly unknown[]).includes(value);
}

export function isEventDeliveryState(value: unknown): value is EventDeliveryState {
  return (EVENT_DELIVERY_STATES as readonly unknown[]).includes(value);
}

export function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Mirrors CHECK (length(entity_type) BETWEEN 1 AND 128). */
export function isEntityType(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 128;
}

/** Mirrors CHECK (length(relation_type) BETWEEN 1 AND 128). */
export function isRelationType(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 128;
}

/** Mirrors CHECK (jsonb_typeof(payload) = 'object'). */
export function isPayloadObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Mirrors CHECK (source_entity_id <> target_entity_id). */
export function areDistinctEntityIds(sourceId: string, targetId: string): boolean {
  return sourceId !== targetId;
}

/* ─────────────────────────────────────────────────────────────
 * Canonical CoreObject envelope (V1CAP-002 / J-001 / G-001 / G-010)
 *
 * Every persistent kernel object carries the envelope: object_type,
 * schema_version, tenant_id, status, created_by/updated_by, provenance,
 * policy_context, trace_id, correlation_id and an explicit causation root
 * (causation_id, parent_event_id, or a declared origin). "No anonymous
 * persistent object exists inside CoreGrid."
 *
 * Fail-closed contract: validation REJECTS any object missing envelope
 * fields. The object-type registry gate (MISSION-R-11) is injected through
 * the `knownObjectTypes` parameter — the kernel WRITE PATHS (draft builders)
 * inject the live registry snapshot via
 * `canonicalKernelObjectTypes()` from `kernel/object-type-registry.ts`, so an
 * unknown object_type is rejected with a typed
 * `KernelObjectTypeRejectedError` at the write API. Direct callers may still
 * supply an explicit allowlist (an EMPTY one rejects every object type —
 * fail-closed bootstrap posture); omitting the parameter defers the gate.
 * ────────────────────────────────────────────────────────────*/

export type KernelObjectStatus = "draft" | "active" | "suspended" | "archived" | "deleted";

/** Neutral lifecycle vocabulary mirrored by the envelope migration CHECK. */
export const KERNEL_OBJECT_STATUSES: readonly KernelObjectStatus[] = [
  "draft",
  "active",
  "suspended",
  "archived",
  "deleted",
] as const;

/** Envelope schema version of THIS contract (the schema dimension of V1CAP-002). */
export const ENVELOPE_SCHEMA_VERSION = "1.0";

/**
 * Persistent envelope column names, mechanically mirroring the envelope
 * migration (20261002000000_coregrid_v1_kernel_envelope.sql). `id` and
 * `tenant_id` already exist on every cg_* substrate table.
 */
export const KERNEL_ENVELOPE_COLUMNS = [
  "object_type",
  "schema_version",
  "status",
  "created_by",
  "updated_by",
  "provenance",
  "policy_context",
  "trace_id",
  "correlation_id",
  "causation_id",
  "parent_event_id",
  "declared_origin",
] as const;

export type KernelEnvelopeColumn = (typeof KERNEL_ENVELOPE_COLUMNS)[number];

/** Data provenance (Constitution §12): where information came from and its trust classification. */
export interface KernelProvenanceInput {
  source: string;
  sourceRef?: string | null;
  recordedBy?: string | null;
  /** Declared tenant that produced this information; must match the object tenant. */
  originTenantId?: string | null;
  generatedByAi?: boolean;
  verified?: boolean;
}

export interface KernelProvenance {
  source: string;
  sourceRef: string | null;
  recordedBy: string | null;
  originTenantId: string | null;
  generatedByAi: boolean;
  verified: boolean;
}

export interface KernelObjectEnvelopeInput {
  objectType: string;
  schemaVersion: string;
  status: KernelObjectStatus;
  createdBy: string;
  updatedBy: string;
  provenance: KernelProvenanceInput;
  policyContext: Record<string, unknown>;
  traceId: string;
  correlationId: string;
  causationId?: string | null;
  parentEventId?: string | null;
  /** Explicit causation-chain root when the object originates a chain. */
  declaredOrigin?: string | null;
}

export interface KernelObjectEnvelope {
  object_type: string;
  schema_version: string;
  status: KernelObjectStatus;
  created_by: string;
  updated_by: string;
  provenance: KernelProvenance;
  policy_context: Record<string, unknown>;
  trace_id: string;
  correlation_id: string;
  causation_id: string | null;
  parent_event_id: string | null;
  declared_origin: string | null;
}

/** Mirrors the envelope migration CHECK (length between 1 and the bound). */
export function isEnvelopeRef(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= maxLength;
}

/** Envelope schema_version is MAJOR.MINOR (machine-comparable, no pre-release). */
export function isSchemaVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+$/.test(value);
}

function provenanceOf(input: KernelProvenanceInput): KernelProvenance {
  if (!isEnvelopeRef(input.source, 200)) {
    throw new Error("envelope provenance.source must be 1–200 characters");
  }
  if (input.recordedBy != null && !isEnvelopeRef(input.recordedBy, 160)) {
    throw new Error("envelope provenance.recordedBy must be 1–160 characters when present");
  }
  if (input.sourceRef != null && !isEnvelopeRef(input.sourceRef, 500)) {
    throw new Error("envelope provenance.sourceRef must be 1–500 characters when present");
  }
  return {
    source: input.source.trim(),
    sourceRef: input.sourceRef?.trim() || null,
    recordedBy: input.recordedBy?.trim() || null,
    originTenantId: input.originTenantId?.trim() || null,
    generatedByAi: input.generatedByAi === true,
    verified: input.verified === true,
  };
}

function refOf(value: string | null | undefined, field: string, maxLength: number): string {
  if (!isEnvelopeRef(value, maxLength)) {
    throw new Error(`envelope ${field} must be 1–${maxLength} characters`);
  }
  return (value as string).trim();
}

/**
 * Fail-closed envelope validation. Throws when any required field is missing
 * or malformed, when the causation chain root is not explicit (no causation_id,
 * parent_event_id, or declared origin), when provenance declares a DIFFERENT
 * tenant than the object's tenant scope, or — when `knownObjectTypes` is
 * supplied — when object_type is not registered (MISSION-R-11 gate).
 */
export function validateKernelObjectEnvelope(
  input: KernelObjectEnvelopeInput,
  knownObjectTypes?: readonly string[],
): KernelObjectEnvelope {
  if (!isEntityType(input.objectType)) {
    throw new Error("envelope object_type must be 1–128 characters");
  }
  if (!isSchemaVersion(input.schemaVersion)) {
    throw new Error("envelope schema_version must match MAJOR.MINOR (e.g. 1.0)");
  }
  if (!(KERNEL_OBJECT_STATUSES as readonly unknown[]).includes(input.status)) {
    throw new Error("envelope status is not a registered kernel object status");
  }
  if (!isEnvelopeRef(input.createdBy, 160)) {
    throw new Error("envelope created_by must be 1–160 characters");
  }
  if (!isEnvelopeRef(input.updatedBy, 160)) {
    throw new Error("envelope updated_by must be 1–160 characters");
  }
  if (!isPayloadObject(input.policyContext)) {
    throw new Error("envelope policy_context must be a JSON object");
  }
  const traceId = refOf(input.traceId, "trace_id", 200);
  const correlationId = refOf(input.correlationId, "correlation_id", 200);
  const causationId = input.causationId?.trim() || null;
  const parentEventId = input.parentEventId?.trim() || null;
  const declaredOrigin = input.declaredOrigin?.trim() || null;
  if (causationId && !isEnvelopeRef(causationId, 200)) {
    throw new Error("envelope causation_id must be 1–200 characters when present");
  }
  if (parentEventId && !isEnvelopeRef(parentEventId, 200)) {
    throw new Error("envelope parent_event_id must be 1–200 characters when present");
  }
  if (declaredOrigin && !isEnvelopeRef(declaredOrigin, 200)) {
    throw new Error("envelope declared_origin must be 1–200 characters when present");
  }
  // Causation chain root must be explicit (G-010): a chain either continues
  // from a cause or declares its origin. Silent unrooted objects are rejected.
  if (!causationId && !parentEventId && !declaredOrigin) {
    throw new Error(
      "envelope causation chain root must be explicit: causation_id, parent_event_id or declared_origin is required",
    );
  }
  if (!isPayloadObject(input.provenance)) {
    throw new Error("envelope provenance must be a provenance object with a source");
  }
  const provenance = provenanceOf(input.provenance);

  if (knownObjectTypes && !knownObjectTypes.includes(input.objectType.trim())) {
    throw new KernelObjectTypeRejectedError(input.objectType.trim());
  }

  return {
    object_type: input.objectType.trim(),
    schema_version: input.schemaVersion,
    status: input.status,
    created_by: input.createdBy.trim(),
    updated_by: input.updatedBy.trim(),
    provenance,
    policy_context: input.policyContext,
    trace_id: traceId,
    correlation_id: correlationId,
    causation_id: causationId,
    parent_event_id: parentEventId,
    declared_origin: declaredOrigin,
  };
}

/** Validated, insert-ready envelope columns for a cg_* persistent object. */
export function envelopeColumns(
  input: KernelObjectEnvelopeInput,
  knownObjectTypes?: readonly string[],
): KernelObjectEnvelope {
  return validateKernelObjectEnvelope(input, knownObjectTypes);
}

/**
 * Single fail-closed chokepoint for persistent kernel objects: validates the
 * envelope, requires the draft to carry a tenant scope, and merges the
 * envelope columns into the insert-ready row. Drafts without a tenant scope
 * are anonymous at the tenancy boundary and are rejected.
 */
export function stampKernelDraft<T extends { tenant_id?: string | null }>(
  draft: T,
  envelope: KernelObjectEnvelopeInput,
  knownObjectTypes?: readonly string[],
): T & KernelObjectEnvelope {
  if (!isEnvelopeRef(draft.tenant_id, 128)) {
    throw new Error("kernel envelope requires a tenant_id on the persistent object");
  }
  if (envelope.provenance.originTenantId != null) {
    const originTenant = envelope.provenance.originTenantId.trim();
    if (originTenant && originTenant !== (draft.tenant_id as string).trim()) {
      throw new Error(
        `kernel envelope provenance is cross-tenant: origin "${originTenant}" does not match object tenant "${(draft.tenant_id as string).trim()}"`,
      );
    }
  }
  return { ...draft, ...envelopeColumns(envelope, knownObjectTypes) };
}

/**
 * Fail-closed conformance check over a PERSISTENT kernel row (the anonymous
 * object gate, J-001): every envelope field must be present and well-formed,
 * including id and tenant_id, and the causation chain root must be explicit.
 */
export function validateKernelRowEnvelope(
  row: Record<string, unknown>,
  knownObjectTypes?: readonly string[],
): void {
  if (!isEnvelopeRef(row.id, 160)) {
    throw new Error("persistent kernel object requires a non-empty id");
  }
  if (!isEnvelopeRef(row.tenant_id, 128)) {
    throw new Error("persistent kernel object requires a non-empty tenant_id");
  }
  const tenantId = (row.tenant_id as string).trim();
  const envelope = validateKernelObjectEnvelope(
    {
      objectType: row.object_type as string,
      schemaVersion: row.schema_version as string,
      status: row.status as KernelObjectStatus,
      createdBy: row.created_by as string,
      updatedBy: row.updated_by as string,
      provenance: {
        source: (row.provenance as KernelProvenanceInput | undefined)?.source ?? "",
        sourceRef: (row.provenance as KernelProvenanceInput | undefined)?.sourceRef ?? null,
        recordedBy: (row.provenance as KernelProvenanceInput | undefined)?.recordedBy ?? null,
        originTenantId: (row.provenance as KernelProvenanceInput | undefined)?.originTenantId ?? null,
        generatedByAi: (row.provenance as KernelProvenanceInput | undefined)?.generatedByAi === true,
        verified: (row.provenance as KernelProvenanceInput | undefined)?.verified === true,
      },
      policyContext: row.policy_context as Record<string, unknown>,
      traceId: row.trace_id as string,
      correlationId: row.correlation_id as string,
      causationId: (row.causation_id as string | null) ?? null,
      parentEventId: (row.parent_event_id as string | null) ?? null,
      declaredOrigin: (row.declared_origin as string | null) ?? null,
    },
    knownObjectTypes,
  );
  const originTenant = envelope.provenance.originTenantId;
  if (originTenant && originTenant !== tenantId) {
    throw new Error(
      `kernel envelope provenance is cross-tenant: origin "${originTenant}" does not match object tenant "${tenantId}"`,
    );
  }
}

/* ─────────────────────────────────────────────────────────────
 * Draft builders (insert-ready rows; database defaults still apply)
 * ────────────────────────────────────────────────────────────*/

export interface EntityDraftInput {
  entityType: string;
  tenantId?: string | null;
  state?: string | null;
  classification?: DataClassification;
  attributes?: Record<string, unknown>;
  sourceType?: string | null;
  sourceRef?: string | null;
  observedAt?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  confidence?: number | null;
  /** Canonical CoreObject envelope; when present the draft is stamped fail-closed. */
  envelope?: KernelObjectEnvelopeInput;
}

export function entityDraft(input: EntityDraftInput, now: string) {
  if (!isEntityType(input.entityType)) {
    throw new Error("entity_type must be 1–128 characters");
  }
  const classification = input.classification ?? "INTERNAL";
  if (!isDataClassification(classification)) {
    throw new Error("classification is not a registered data classification");
  }
  if (input.confidence != null && !isConfidence(input.confidence)) {
    throw new Error("confidence must be a finite number between 0 and 1");
  }
  if (input.attributes != null && !isPayloadObject(input.attributes)) {
    throw new Error("attributes must be a JSON object");
  }
  const draft = {
    entity_type: input.entityType.trim(),
    tenant_id: input.tenantId?.trim() || null,
    state: input.state?.trim() || null,
    classification,
    attributes: input.attributes ?? {},
    source_type: input.sourceType ?? null,
    source_ref: input.sourceRef ?? null,
    observed_at: input.observedAt ?? null,
    recorded_at: now,
    valid_from: input.validFrom ?? null,
    valid_to: input.validTo ?? null,
    confidence: input.confidence ?? null,
  };
  // MISSION-R-11: stamped writes are gated by the LIVE object-type registry —
  // an unregistered object_type is rejected at the kernel write API.
  return input.envelope
    ? stampKernelDraft(draft, input.envelope, canonicalKernelObjectTypes())
    : draft;
}

export interface EventDraftInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  actorIdentity?: string | null;
  tenantId?: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: string;
  /** Canonical CoreObject envelope; when present the draft is stamped fail-closed. */
  envelope?: KernelObjectEnvelopeInput;
}

export function eventDraft(input: EventDraftInput, now: string) {
  if (!input.eventType || input.eventType.length > 200) {
    throw new Error("event_type must be 1–200 characters");
  }
  if (!input.aggregateType || input.aggregateType.length > 200) {
    throw new Error("aggregate_type must be 1–200 characters");
  }
  if (!input.aggregateId) {
    throw new Error("aggregate_id is required");
  }
  const payload = input.payload ?? {};
  if (!isPayloadObject(payload)) {
    throw new Error("payload must be a JSON object");
  }
  const draft = {
    event_type: input.eventType,
    aggregate_type: input.aggregateType,
    aggregate_id: input.aggregateId,
    actor_identity: input.actorIdentity ?? null,
    tenant_id: input.tenantId?.trim() || null,
    occurred_at: input.occurredAt ?? now,
    recorded_at: now,
    correlation_id: input.correlationId ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    payload,
    payload_version: 1,
    state: "pending",
    attempts: 0,
  };
  // MISSION-R-11: stamped writes are gated by the LIVE object-type registry —
  // an unregistered object_type is rejected at the kernel write API.
  return input.envelope
    ? stampKernelDraft(draft, input.envelope, canonicalKernelObjectTypes())
    : draft;
}

export interface ObservationDraftInput {
  subjectEntityId: string;
  kind: ObservationKind;
  statement?: Record<string, unknown>;
  observerIdentity?: string | null;
  tenantId?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  confidence?: number | null;
  observedAt?: string | null;
  /** Canonical CoreObject envelope; when present the draft is stamped fail-closed. */
  envelope?: KernelObjectEnvelopeInput;
}

export function observationDraft(input: ObservationDraftInput, now: string) {
  if (!input.subjectEntityId) {
    throw new Error("subject_entity_id is required");
  }
  if (!isObservationKind(input.kind)) {
    throw new Error("kind is not a registered observation kind");
  }
  const statement = input.statement ?? {};
  if (!isPayloadObject(statement)) {
    throw new Error("statement must be a JSON object");
  }
  if (input.confidence != null && !isConfidence(input.confidence)) {
    throw new Error("confidence must be a finite number between 0 and 1");
  }
  const draft = {
    subject_entity_id: input.subjectEntityId,
    kind: input.kind,
    statement,
    observer_identity: input.observerIdentity ?? null,
    tenant_id: input.tenantId?.trim() || null,
    source_type: input.sourceType ?? null,
    source_ref: input.sourceRef ?? null,
    confidence: input.confidence ?? null,
    evidence_entity_ids: [],
    observed_at: input.observedAt ?? null,
    recorded_at: now,
  };
  // MISSION-R-11: stamped writes are gated by the LIVE object-type registry —
  // an unregistered object_type is rejected at the kernel write API.
  return input.envelope
    ? stampKernelDraft(draft, input.envelope, canonicalKernelObjectTypes())
    : draft;
}

export interface RelationshipDraftInput {
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  tenantId?: string | null;
  attributes?: Record<string, unknown>;
  sourceRef?: string | null;
  observedAt?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  confidence?: number | null;
  /** Canonical CoreObject envelope; when present the draft is stamped fail-closed. */
  envelope?: KernelObjectEnvelopeInput;
}

/** Mirrors CHECK (source_entity_id <> target_entity_id) plus type/scope rules. */
export function relationshipDraft(input: RelationshipDraftInput, now: string) {
  if (!input.sourceEntityId || !input.targetEntityId) {
    throw new Error("source and target entity ids are required");
  }
  if (!areDistinctEntityIds(input.sourceEntityId, input.targetEntityId)) {
    throw new Error("source and target entity ids must differ");
  }
  if (!isRelationType(input.relationType)) {
    throw new Error("relation_type must be 1–128 characters");
  }
  if (input.confidence != null && !isConfidence(input.confidence)) {
    throw new Error("confidence must be a finite number between 0 and 1");
  }
  if (input.attributes != null && !isPayloadObject(input.attributes)) {
    throw new Error("attributes must be a JSON object");
  }
  const draft = {
    source_entity_id: input.sourceEntityId,
    target_entity_id: input.targetEntityId,
    relation_type: input.relationType.trim(),
    tenant_id: input.tenantId?.trim() || null,
    attributes: input.attributes ?? {},
    source_ref: input.sourceRef ?? null,
    observed_at: input.observedAt ?? null,
    recorded_at: now,
    valid_from: input.validFrom ?? null,
    valid_to: input.validTo ?? null,
    confidence: input.confidence ?? null,
  };
  // MISSION-R-11: stamped writes are gated by the LIVE object-type registry —
  // an unregistered object_type is rejected at the kernel write API.
  return input.envelope
    ? stampKernelDraft(draft, input.envelope, canonicalKernelObjectTypes())
    : draft;
}
