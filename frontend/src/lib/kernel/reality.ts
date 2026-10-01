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
 *
 * Bi-temporal law (V1CAP-004, MISSION-R-13 / J-003): the BITEMPORAL
 * section additively distinguishes VALID time (when the fact was true in
 * reality) from RECORD time (when the system learned it), with explicit
 * unknown-validity representation, append-only supersession pointers, and
 * pure as-of-VALID-time / as-of-RECORD-time reconstruction functions.
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
 * Bi-temporal law (V1CAP-004 / J-003 / MISSION-R-13)
 *
 * Every kernel record distinguishes VALID time (when the fact was true in
 * reality) from RECORD time (when the system learned it):
 *   valid_from / valid_until — the validity interval in reality
 *     (half-open: valid_from inclusive, valid_until exclusive)
 *   recorded_at              — record time (substrate-owned on every cg_*
 *                              table; NEVER backdated)
 *
 * Explicit unknown validity: a fact whose valid time is unknown is
 * representable and flagged (valid_time_known = false, no validity
 * interval) — it is NEVER silently assumed to be "now" or any interval.
 *
 * Corrections are append-only supersession with a pointer (`supersedes`);
 * there are no destructive updates. Superseding records retire the records
 * they correct ONLY over their valid-time overlap, so as-of reconstruction
 * rebuilds a true history under late-arriving, out-of-order and corrected
 * data. The additive columns are authored (nullable, Phase A) by migration
 * 20261002000003_coregrid_v1_kernel_bitemporal.sql; `recorded_at` and the
 * substrate `valid_from`/`valid_to` on cg_entity/cg_relationship are
 * substrate-owned and are NOT re-authored there.
 * ────────────────────────────────────────────────────────────*/

/**
 * Additive bi-temporal columns THIS contract authors on the kernel tables,
 * mechanically mirrored by the bi-temporal migration (20261002000003):
 * cg_event and cg_observation receive all four; cg_entity already carries
 * the substrate `valid_from`/`valid_to` pair and receives only
 * `valid_time_known` + `supersedes`.
 */
export const KERNEL_BITEMPORAL_COLUMNS = [
  "valid_from",
  "valid_until",
  "valid_time_known",
  "supersedes",
] as const;

export type KernelBiTemporalColumn = (typeof KERNEL_BITEMPORAL_COLUMNS)[number];

export interface KernelBiTemporalInput {
  /** When the fact became true in reality (valid-time interval start). */
  validFrom?: string;
  /**
   * When the fact stopped being true (half-open interval end). Absent means
   * the fact was open-endedly true from valid_from.
   */
  validUntil?: string;
  /**
   * Explicit validity knowledge flag. `false` declares the fact's valid time
   * UNKNOWN (flagged, never assumed "now"); `true` requires `validFrom`.
   * Omitting the flag requires `validFrom` — a record never silently gains a
   * validity interval.
   */
  validTimeKnown?: boolean;
  /** Append-only correction pointer: the record this record supersedes. */
  supersedes?: string | null;
}

/** Insert-ready bi-temporal columns (canonical names; cg_event/cg_observation). */
export interface KernelBiTemporalColumns {
  valid_from: string | null;
  valid_until: string | null;
  valid_time_known: boolean;
  supersedes: string | null;
}

/** Mirrors the substrate timestamptz grammar (ISO-8601 date, parseable). */
export function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
    trimmed,
  ) && Number.isFinite(Date.parse(trimmed));
}

function timestampOf(value: string | null | undefined, field: string): string | null {
  if (value == null || value === "") return null;
  if (!isTimestamp(value)) {
    throw new Error(`bi-temporal ${field} must be an ISO-8601 timestamp`);
  }
  return value.trim();
}

function epochOf(value: string | null | undefined, field: string): number | null {
  const timestamp = timestampOf(value, field);
  return timestamp == null ? null : Date.parse(timestamp);
}

/**
 * Fail-closed bi-temporal column builder — the write-path twin of the
 * migration's CHECKs. Rejects: unknown-validity records that claim an
 * interval, known-validity records without one, inverted or empty intervals,
 * and malformed timestamps. A fact's valid time is always EXPLICIT: a
 * `validFrom` or a declared `validTimeKnown: false` (unknown) is mandatory.
 */
export function biTemporalColumns(input: KernelBiTemporalInput): KernelBiTemporalColumns {
  const validFrom = timestampOf(input.validFrom, "valid_from");
  const validUntil = timestampOf(input.validUntil, "valid_until");
  if (input.validTimeKnown === false) {
    if (validFrom != null || validUntil != null) {
      throw new Error(
        "bi-temporal validity flagged unknown must not claim a valid_from/valid_until interval",
      );
    }
  } else if (validFrom == null) {
    throw new Error(
      "bi-temporal valid time must be explicit: provide validFrom, or declare validTimeKnown: false for unknown validity (never silently assumed)",
    );
  }
  if (validFrom != null && validUntil != null && !(Date.parse(validUntil) > Date.parse(validFrom))) {
    throw new Error("bi-temporal valid_until must be strictly after valid_from");
  }
  if (input.supersedes != null && !isEnvelopeRef(input.supersedes, 160)) {
    throw new Error("bi-temporal supersedes must be 1–160 characters when present");
  }
  return {
    valid_from: validFrom,
    valid_until: validUntil,
    valid_time_known: input.validTimeKnown !== false,
    supersedes: input.supersedes?.trim() || null,
  };
}

/**
 * Read shape for any cg_* record participating in bi-temporal queries.
 * `valid_to` (substrate name on cg_entity/cg_relationship) is accepted and
 * normalized to `valid_until` by the as-of functions.
 */
export interface BiTemporalRecord {
  id: string;
  tenant_id: string | null;
  valid_from: string | null;
  valid_until?: string | null;
  valid_to?: string | null;
  valid_time_known?: boolean | null;
  recorded_at: string | null;
  supersedes?: string | null;
}

export type ValidityKnowledge = "known" | "unknown";

/**
 * Normalized validity view of a record. A record with no validity interval
 * is UNKNOWN-validity — flagged, never silently assumed "now".
 */
export function biTemporalValidity(record: BiTemporalRecord): {
  validFrom: string | null;
  validUntil: string | null;
  validity: ValidityKnowledge;
} {
  const validFrom = timestampOf(record.valid_from ?? null, "valid_from");
  const validUntil = timestampOf(record.valid_until ?? record.valid_to ?? null, "valid_until");
  return {
    validFrom,
    validUntil,
    validity: validFrom != null && record.valid_time_known !== false ? "known" : "unknown",
  };
}

/**
 * True when the record reached the system long after the fact was valid
 * (record_time >> valid_time by more than `toleranceMs`, default 0).
 * Unknown-validity records are never late-arriving (they have no valid time).
 */
export function isLateArrival(record: BiTemporalRecord, toleranceMs = 0): boolean {
  const validFrom = epochOf(record.valid_from ?? null, "valid_from");
  const recordedAt = epochOf(record.recorded_at ?? null, "recorded_at");
  if (validFrom == null || recordedAt == null || record.valid_time_known === false) return false;
  return recordedAt - validFrom > toleranceMs;
}

/**
 * Chain-integrity pass over a record set's append-only supersession graph.
 * Fails closed on: self-supersession, a `supersedes` pointer that dangles
 * outside the set, a cross-tenant pointer (a record may only correct its own
 * tenant's records), and cycles. Returns the live/superseded partition
 * (a record superseded by ANY record in the set is retired overall — for
 * instant-aware retirement over valid-time overlaps use `asOfValidTime`).
 */
export function resolveSupersession<T extends BiTemporalRecord>(
  records: readonly T[],
): { live: T[]; superseded: T[] } {
  const byId = new Map<string, T>();
  for (const record of records) {
    if (!isEnvelopeRef(record.id, 160)) {
      throw new Error("bi-temporal record requires a non-empty id");
    }
    if (byId.has(record.id)) {
      throw new Error(`bi-temporal record set contains duplicate id "${record.id}"`);
    }
    byId.set(record.id, record);
  }
  for (const record of records) {
    const target = record.supersedes == null ? null : byId.get(record.supersedes) ?? null;
    if (record.supersedes != null && target == null) {
      throw new Error(
        `bi-temporal record "${record.id}" supersedes "${record.supersedes}" outside the record set`,
      );
    }
    if (target != null) {
      if (target.id === record.id) {
        throw new Error(`bi-temporal record "${record.id}" supersedes itself`);
      }
      if ((record.tenant_id ?? null) !== (target.tenant_id ?? null)) {
        throw new Error(
          `bi-temporal supersession is cross-tenant: record "${record.id}" (tenant "${record.tenant_id ?? "null"}") supersedes "${target.id}" (tenant "${target.tenant_id ?? "null"}")`,
        );
      }
    }
  }
  for (const start of records) {
    const visited = new Set<string>();
    let cursor: T | undefined = start;
    while (cursor?.supersedes != null) {
      if (visited.has(cursor.id)) {
        throw new Error(`bi-temporal supersession cycle detected at record "${cursor.id}"`);
      }
      visited.add(cursor.id);
      cursor = byId.get(cursor.supersedes);
    }
  }
  const supersededIds = new Set(records.map((r) => r.supersedes).filter((id): id is string => id != null));
  const live: T[] = [];
  const superseded: T[] = [];
  for (const record of records) {
    (supersededIds.has(record.id) ? superseded : live).push(record);
  }
  return { live, superseded };
}

export interface AsOfOptions {
  /**
   * Record-time knowledge cutoff: only records recorded at or before this
   * instant are considered, so late corrections never retroactively rewrite
   * an as-of view of the past.
   */
  recordedAsOf?: string;
  /**
   * Tenant scope (defense-in-depth for in-memory reconstruction over
   * service-role record sets): records outside the scope — including
   * scope-less rows with a null tenant — are excluded entirely.
   */
  tenantId?: string;
}

/** Result of an as-of-VALID-time reconstruction (the state of reality at T). */
export interface AsOfValidTimeView<T> {
  at: string;
  /** Records true in reality at `at`, oldest record-time first. */
  applicable: T[];
  /** Considered records whose valid time is unknown — flagged, never assumed. */
  unknownValidity: T[];
  /** Considered records retired at `at` by a superseding record's overlap. */
  supersededAtAsOf: T[];
}

/** Result of an as-of-RECORD-time reconstruction (what the system knew at T). */
export interface AsOfRecordTimeView<T> {
  at: string;
  /** Records already recorded at or before `at`, oldest first. */
  known: T[];
  /** Records that did not exist in the system at `at`, oldest first. */
  notYetKnown: T[];
}

function chronological<T extends BiTemporalRecord>(records: readonly T[]): T[] {
  return [...records].sort((a, b) => {
    const byRecorded =
      (epochOf(a.recorded_at ?? null, "recorded_at") ?? Number.NEGATIVE_INFINITY) -
      (epochOf(b.recorded_at ?? null, "recorded_at") ?? Number.NEGATIVE_INFINITY);
    return byRecorded !== 0 ? byRecorded : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function consideredRecords<T extends BiTemporalRecord>(
  records: readonly T[],
  options: AsOfOptions,
): T[] {
  const cutoff = epochOf(options.recordedAsOf, "recordedAsOf");
  return records.filter((record) => {
    if (options.tenantId != null && (record.tenant_id ?? null) !== options.tenantId) return false;
    const recordedAt = epochOf(record.recorded_at ?? null, "recorded_at");
    if (recordedAt == null) {
      throw new Error(
        `bi-temporal record "${record.id}" has no recorded_at — record time is mandatory for bi-temporal ordering`,
      );
    }
    if (cutoff != null && recordedAt > cutoff) return false;
    // A record may legitimately be recorded BEFORE its valid time (a
    // future-dated fact the system learned in advance). Record-time integrity
    // — never backdated, never rewritten — is enforced by the record-time
    // immutability triggers and the write path, not by ordering here.
    return true;
  });
}

function coversAt(record: BiTemporalRecord, atMs: number): boolean {
  const validFrom = epochOf(record.valid_from ?? null, "valid_from");
  const validUntil = epochOf(record.valid_until ?? record.valid_to ?? null, "valid_until");
  if (validFrom == null) return false;
  return validFrom <= atMs && (validUntil == null || atMs < validUntil);
}

/**
 * As-of-VALID-time reconstruction: the state of reality at instant `at`,
 * given the record history. Pure and deterministic under late-arriving and
 * out-of-order input. Supersession retires a corrected record ONLY where the
 * superseding record's validity overlaps it, so a correction that changes a
 * fact from a later instant leaves the earlier history intact. With
 * `recordedAsOf`, corrections recorded after the cutoff are invisible — the
 * view is exactly what reality looked like from that knowledge state.
 */
export function asOfValidTime<T extends BiTemporalRecord>(
  records: readonly T[],
  at: string,
  options: AsOfOptions = {},
): AsOfValidTimeView<T> {
  const atMs = epochOf(at, "at");
  if (atMs == null) throw new Error("bi-temporal as-of instant must be an ISO-8601 timestamp");
  const considered = consideredRecords(records, options);
  resolveSupersession(considered);
  const supersederBySuperseded = new Map<string, T>();
  for (const record of considered) {
    if (record.supersedes != null) supersederBySuperseded.set(record.supersedes, record);
  }
  const applicable: T[] = [];
  const unknownValidity: T[] = [];
  const supersededAtAsOf: T[] = [];
  for (const record of chronological(considered)) {
    const { validity } = biTemporalValidity(record);
    if (validity === "unknown") {
      unknownValidity.push(record);
      continue;
    }
    const superseder = supersederBySuperseded.get(record.id);
    if (coversAt(record, atMs)) {
      if (superseder != null && coversAt(superseder, atMs)) {
        supersededAtAsOf.push(record);
        continue;
      }
      applicable.push(record);
      continue;
    }
    if (superseder != null && coversAt(superseder, atMs)) supersededAtAsOf.push(record);
  }
  return { at: at.trim(), applicable, unknownValidity, supersededAtAsOf };
}

/**
 * As-of-RECORD-time reconstruction: the record timeline as the system knew it
 * at instant `at`. Records recorded after `at` (late arrivals, corrections)
 * are returned under `notYetKnown` — they never leak into the past view.
 */
export function asOfRecordTime<T extends BiTemporalRecord>(
  records: readonly T[],
  at: string,
): AsOfRecordTimeView<T> {
  const atMs = epochOf(at, "at");
  if (atMs == null) throw new Error("bi-temporal as-of instant must be an ISO-8601 timestamp");
  const known: T[] = [];
  const notYetKnown: T[] = [];
  for (const record of chronological(records)) {
    const recordedAt = epochOf(record.recorded_at ?? null, "recorded_at");
    if (recordedAt == null) {
      throw new Error(
        `bi-temporal record "${record.id}" has no recorded_at — record time is mandatory for bi-temporal ordering`,
      );
    }
    (recordedAt <= atMs ? known : notYetKnown).push(record);
  }
  return { at: at.trim(), known, notYetKnown };
}

/**
 * Merges validated bi-temporal columns into any insert-ready kernel draft
 * (the bi-temporal twin of `stampKernelDraft`). Fails closed through
 * `biTemporalColumns`.
 */
export function withBiTemporalColumns<T extends Record<string, unknown>>(
  draft: T,
  input: KernelBiTemporalInput,
): T & KernelBiTemporalColumns {
  return { ...draft, ...biTemporalColumns(input) };
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
  /**
   * Bi-temporal stamp (V1CAP-004): when present it is the authoritative
   * validity declaration and is mapped onto the substrate valid_from/valid_to
   * pair. Must not be combined with the legacy validFrom/validTo inputs.
   */
  biTemporal?: KernelBiTemporalInput;
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
  if (
    input.biTemporal != null &&
    (input.validFrom != null || input.validTo != null)
  ) {
    throw new Error(
      "entity validity must be declared once: use biTemporal or the legacy validFrom/validTo inputs, never both",
    );
  }
  const draft: {
    entity_type: string;
    tenant_id: string | null;
    state: string | null;
    classification: DataClassification;
    attributes: Record<string, unknown>;
    source_type: string | null;
    source_ref: string | null;
    observed_at: string | null;
    recorded_at: string;
    valid_from: string | null;
    valid_to: string | null;
    confidence: number | null;
    valid_time_known?: boolean;
    supersedes?: string | null;
  } = {
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
  if (input.biTemporal != null) {
    // The substrate names the interval end valid_to; the canonical bi-temporal
    // contract (and cg_event/cg_observation) name it valid_until.
    const biTemporal = biTemporalColumns(input.biTemporal);
    draft.valid_from = biTemporal.valid_from;
    draft.valid_to = biTemporal.valid_until;
    draft.valid_time_known = biTemporal.valid_time_known;
    draft.supersedes = biTemporal.supersedes;
  }
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
  /** Bi-temporal stamp (V1CAP-004): explicit valid time vs record time. */
  biTemporal?: KernelBiTemporalInput;
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
  const draft: {
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    actor_identity: string | null;
    tenant_id: string | null;
    occurred_at: string;
    recorded_at: string;
    correlation_id: string | null;
    idempotency_key: string | null;
    payload: Record<string, unknown>;
    payload_version: number;
    state: "pending";
    attempts: number;
    valid_from?: string | null;
    valid_until?: string | null;
    valid_time_known?: boolean;
    supersedes?: string | null;
  } = {
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
  if (input.biTemporal != null) {
    Object.assign(draft, biTemporalColumns(input.biTemporal));
  }
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
  /** Bi-temporal stamp (V1CAP-004): explicit valid time vs record time. */
  biTemporal?: KernelBiTemporalInput;
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
  const draft: {
    subject_entity_id: string;
    kind: ObservationKind;
    statement: Record<string, unknown>;
    observer_identity: string | null;
    tenant_id: string | null;
    source_type: string | null;
    source_ref: string | null;
    confidence: number | null;
    evidence_entity_ids: never[];
    observed_at: string | null;
    recorded_at: string;
    valid_from?: string | null;
    valid_until?: string | null;
    valid_time_known?: boolean;
    supersedes?: string | null;
  } = {
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
  if (input.biTemporal != null) {
    Object.assign(draft, biTemporalColumns(input.biTemporal));
  }
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
