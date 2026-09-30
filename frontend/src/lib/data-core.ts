/**
 * CoreGrid — Data Platform core domain model (Phase 14, Sections F,
 * G, H, I, AM, AP, AQ).
 *
 * Implements `architecture/phase-14-data-platform.md`:
 * - Data ownership model (F): every important domain declares authoritative
 *   source, owning phase, schema, identifier, lifecycle, sensitivity,
 *   retention, consumers, synchronization policy.
 * - System of record (G): each domain identifies its system of record; the
 *   Data Platform stores and transports these records but never becomes
 *   their owner (D).
 * - Data domains (H): identity, institutional, academic, workspace, agent,
 *   security, communication, scheduling, financial, hardware, digital twin,
 *   automation, analytics, government, marketplace, developer,
 *   globalization, enterprise.
 * - Data classification (I): PUBLIC, INTERNAL, CONFIDENTIAL, SENSITIVE,
 *   HIGHLY_SENSITIVE, REGULATED. Classification influences storage,
 *   encryption, access, export, retention, observability, replication,
 *   logging.
 * - Metadata platform (AM): dataset, schema, owner, sensitivity,
 *   description, freshness, quality, lineage, dependencies, retention,
 *   access policy.
 * - Data versioning (AP): schema version, dataset version, pipeline
 *   version, model version.
 * - Temporal data (AQ): never overwrite historical truth simply because the
 *   current value changed.
 *
 * Boundaries: Phase 14 is the data infrastructure layer, not the owner of
 * institutional business semantics (D). This module records metadata about
 * domain data; it never redefines what domain data means.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Data classification (I)
 * ────────────────────────────────────────────────────────────*/

export type DataClassification =
  "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "HIGHLY_SENSITIVE" | "REGULATED";

export const DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "SENSITIVE",
  "HIGHLY_SENSITIVE",
  "REGULATED",
] as const;

/** Ordinal ranking so stricter classifications can be compared. */
export function classificationRank(c: DataClassification): number {
  switch (c) {
    case "PUBLIC":
      return 0;
    case "INTERNAL":
      return 1;
    case "CONFIDENTIAL":
      return 2;
    case "SENSITIVE":
      return 3;
    case "HIGHLY_SENSITIVE":
      return 4;
    case "REGULATED":
      return 5;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Data domains (H)
 * ────────────────────────────────────────────────────────────*/

export type DataDomain =
  | "identity"
  | "institutional"
  | "academic"
  | "workspace"
  | "agent"
  | "security"
  | "communication"
  | "scheduling"
  | "financial"
  | "hardware"
  | "digital_twin"
  | "automation"
  | "analytics"
  | "government"
  | "marketplace"
  | "developer"
  | "globalization"
  | "enterprise";

export const DATA_DOMAINS: readonly DataDomain[] = [
  "identity",
  "institutional",
  "academic",
  "workspace",
  "agent",
  "security",
  "communication",
  "scheduling",
  "financial",
  "hardware",
  "digital_twin",
  "automation",
  "analytics",
  "government",
  "marketplace",
  "developer",
  "globalization",
  "enterprise",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Data ownership model (F)
 * ────────────────────────────────────────────────────────────*/

export interface DataOwnershipDeclaration {
  domain: DataDomain;
  /** Owning phase (e.g. "phase-02-identity"). */
  owningPhase: string;
  authoritativeSource: string;
  schemaName: string;
  lifecycle: string;
  sensitivity: DataClassification;
  retentionDays: number | null;
  consumers: string[];
  synchronizationPolicy: string;
  tenantId: TenantId;
}

export interface DeclareDataOwnershipInput {
  domain: DataDomain;
  owningPhase: string;
  authoritativeSource: string;
  schemaName: string;
  lifecycle: string;
  sensitivity: DataClassification;
  retentionDays?: number | null;
  consumers: string[];
  synchronizationPolicy: string;
  tenantId: TenantId;
}

export type DeclareDataOwnershipResult =
  { ok: true; declaration: DataOwnershipDeclaration } | { ok: false; error: string };

/** Every important domain must declare its data ownership (F). */
export function declareDataOwnership(input: DeclareDataOwnershipInput): DeclareDataOwnershipResult {
  if (input.owningPhase.trim() === "") {
    return { ok: false, error: "Data ownership requires an owning phase (F)" };
  }
  if (input.authoritativeSource.trim() === "") {
    return { ok: false, error: "Data ownership requires an authoritative source (F)" };
  }
  if (input.schemaName.trim() === "") {
    return { ok: false, error: "Data ownership requires a schema (F)" };
  }
  return {
    ok: true,
    declaration: {
      domain: input.domain,
      owningPhase: input.owningPhase,
      authoritativeSource: input.authoritativeSource,
      schemaName: input.schemaName,
      lifecycle: input.lifecycle,
      sensitivity: input.sensitivity,
      retentionDays: input.retentionDays ?? null,
      consumers: input.consumers,
      synchronizationPolicy: input.synchronizationPolicy,
      tenantId: input.tenantId,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Dataset and schema metadata (AM)
 * ────────────────────────────────────────────────────────────*/

export interface DatasetMetadata {
  name: string;
  tenantId: TenantId;
  domain: DataDomain;
  owner: string;
  description: string;
  sensitivity: DataClassification;
  schemaVersion: number;
  datasetVersion: number;
  freshnessSeconds: number | null;
  qualityScore: number | null;
  retentionDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterDatasetInput {
  name: string;
  tenantId: TenantId;
  domain: DataDomain;
  owner: string;
  description: string;
  sensitivity: DataClassification;
  freshnessSeconds?: number | null;
  retentionDays?: number | null;
  now: string;
}

export type RegisterDatasetResult =
  { ok: true; dataset: DatasetMetadata } | { ok: false; error: string };

export function registerDataset(input: RegisterDatasetInput): RegisterDatasetResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Dataset name is required (AM)" };
  }
  if (input.owner.trim() === "") {
    return { ok: false, error: "Dataset owner is required (AM)" };
  }
  return {
    ok: true,
    dataset: {
      name: input.name,
      tenantId: input.tenantId,
      domain: input.domain,
      owner: input.owner,
      description: input.description,
      sensitivity: input.sensitivity,
      schemaVersion: 1,
      datasetVersion: 1,
      freshnessSeconds: input.freshnessSeconds ?? null,
      qualityScore: null,
      retentionDays: input.retentionDays ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Data versioning (AP) and temporal data (AQ)
 * ────────────────────────────────────────────────────────────*/

export interface DatasetVersionRecord {
  datasetName: string;
  tenantId: TenantId;
  datasetVersion: number;
  schemaVersion: number;
  createdAt: string;
  reason: string;
}

export interface CreateDatasetVersionInput {
  datasetName: string;
  tenantId: TenantId;
  datasetVersion: number;
  schemaVersion: number;
  reason: string;
  now: string;
}

export type CreateDatasetVersionResult =
  { ok: true; version: DatasetVersionRecord } | { ok: false; error: string };

/** Data versioning (AP): important datasets support versions. */
export function createDatasetVersion(input: CreateDatasetVersionInput): CreateDatasetVersionResult {
  if (input.datasetVersion < 1 || input.schemaVersion < 1) {
    return { ok: false, error: "Dataset and schema versions must be >= 1 (AP)" };
  }
  if (input.reason.trim() === "") {
    return { ok: false, error: "Dataset version requires a reason" };
  }
  return {
    ok: true,
    version: {
      datasetName: input.datasetName,
      tenantId: input.tenantId,
      datasetVersion: input.datasetVersion,
      schemaVersion: input.schemaVersion,
      createdAt: input.now,
      reason: input.reason,
    },
  };
}

export interface TemporalRecord {
  /** Natural business key. */
  entityId: string;
  tenantId: TenantId;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Full historical snapshot — never overwritten by the current value (AQ). */
  state: Record<string, string | number | boolean | null>;
}

export interface CreateTemporalRecordInput {
  entityId: string;
  tenantId: TenantId;
  effectiveFrom: string;
  state: Record<string, string | number | boolean | null>;
  now: string;
}

export type CreateTemporalRecordResult =
  { ok: true; record: TemporalRecord } | { ok: false; error: string };

/** Temporal data (AQ): historical truth is preserved as versioned records;
 * current-value changes never overwrite earlier records. */
export function createTemporalRecord(input: CreateTemporalRecordInput): CreateTemporalRecordResult {
  if (input.entityId.trim() === "") {
    return { ok: false, error: "Temporal record requires an entity id (AQ)" };
  }
  return {
    ok: true,
    record: {
      entityId: input.entityId,
      tenantId: input.tenantId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      state: input.state,
    },
  };
}

/** Close a temporal record when the value changes (Type 2 style, AQ/AR). */
export function closeTemporalRecord(record: TemporalRecord, effectiveTo: string): TemporalRecord {
  return { ...record, effectiveTo };
}

export function isTemporalRecordActiveAt(record: TemporalRecord, at: string): boolean {
  if (Date.parse(at) < Date.parse(record.effectiveFrom)) return false;
  return record.effectiveTo === null || Date.parse(at) <= Date.parse(record.effectiveTo);
}
