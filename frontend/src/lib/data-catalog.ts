/**
 * CoreGrid — Data Platform catalog, discovery, source registry,
 * and data contracts (Phase 14, Sections S, Y, Z, AA, AN, AO).
 *
 * Implements `architecture/phase-14-data-platform.md`:
 * - Data catalog (AN): authorized users and systems can discover datasets,
 *   schemas, owners, descriptions, freshness, quality, lineage, access
 *   requirements.
 * - Data discovery (AO): search by dataset name, field, owner, domain,
 *   sensitivity, tags, description.
 * - Source registry (S): every external data source has metadata describing
 *   source ID, provider, owner, URL/API, authentication method, schema,
 *   refresh frequency, reliability, license, jurisdiction, sensitivity,
 *   retention, last successful ingestion.
 * - Schema registry (Y) and schema evolution (Z): schemas are versioned;
 *   backward-compatible changes (additive fields, deprecated fields,
 *   migration windows) are supported; breaking changes require explicit
 *   architectural decisions.
 * - Data contracts (AA): producer, consumer, schema, semantics, freshness,
 *   quality requirements, ownership, retention, security classification,
 *   compatibility requirements.
 *
 * Boundaries: this module defines catalog/contract contracts; pipeline
 * execution and storage remain infrastructure concerns.
 */

import type { TenantId } from "./tenant-core";
import type { DataDomain, DataClassification } from "./data-core";

/* ─────────────────────────────────────────────────────────────
 * Data catalog (AN) and discovery (AO)
 * ────────────────────────────────────────────────────────────*/

export interface CatalogEntry {
  datasetName: string;
  tenantId: TenantId;
  domain: DataDomain;
  owner: string;
  description: string;
  sensitivity: DataClassification;
  schemaVersion: number;
  tags: string[];
  freshnessSeconds: number | null;
  qualityScore: number | null;
  accessRequirements: string[];
  registeredAt: string;
}

export interface RegisterCatalogEntryInput {
  datasetName: string;
  tenantId: TenantId;
  domain: DataDomain;
  owner: string;
  description: string;
  sensitivity: DataClassification;
  tags?: string[];
  freshnessSeconds?: number | null;
  qualityScore?: number | null;
  accessRequirements?: string[];
  now: string;
}

export type RegisterCatalogEntryResult =
  { ok: true; entry: CatalogEntry } | { ok: false; error: string };

export function registerCatalogEntry(input: RegisterCatalogEntryInput): RegisterCatalogEntryResult {
  if (input.datasetName.trim() === "") {
    return { ok: false, error: "Catalog entry requires a dataset name (AN)" };
  }
  if (input.owner.trim() === "") {
    return { ok: false, error: "Catalog entry requires an owner (AN)" };
  }
  return {
    ok: true,
    entry: {
      datasetName: input.datasetName,
      tenantId: input.tenantId,
      domain: input.domain,
      owner: input.owner,
      description: input.description,
      sensitivity: input.sensitivity,
      schemaVersion: 1,
      tags: input.tags ?? [],
      freshnessSeconds: input.freshnessSeconds ?? null,
      qualityScore: input.qualityScore ?? null,
      accessRequirements: input.accessRequirements ?? [],
      registeredAt: input.now,
    },
  };
}

export interface DiscoveryQuery {
  text?: string;
  domain?: DataDomain;
  sensitivity?: DataClassification;
  owner?: string;
  tags?: string[];
}

/**
 * Data discovery (AO): search catalog entries by name, owner, domain,
 * sensitivity, and tags. Results are always tenant-scoped.
 */
export function discoverDatasets(
  entries: CatalogEntry[],
  query: DiscoveryQuery,
  tenantId: TenantId,
): CatalogEntry[] {
  const text = (query.text ?? "").toLowerCase();
  const tagSet = new Set(query.tags ?? []);
  return entries.filter((e) => {
    if (e.tenantId !== tenantId) return false;
    if (query.domain !== undefined && e.domain !== query.domain) return false;
    if (query.sensitivity !== undefined && e.sensitivity !== query.sensitivity) return false;
    if (query.owner !== undefined && e.owner !== query.owner) return false;
    if (tagSet.size > 0 && !e.tags.some((t) => tagSet.has(t))) return false;
    if (text !== "") {
      const haystack = `${e.datasetName} ${e.description} ${e.owner}`.toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
}

/* ─────────────────────────────────────────────────────────────
 * Source registry (S)
 * ────────────────────────────────────────────────────────────*/

export interface DataSourceRecord {
  sourceId: string;
  tenantId: TenantId;
  provider: string;
  owner: string;
  urlOrApi: string;
  authenticationMethod: string;
  schemaName: string;
  refreshFrequencySeconds: number;
  reliability: number;
  license: string;
  jurisdiction: string;
  sensitivity: DataClassification;
  retentionDays: number | null;
  lastSuccessfulIngestion: string | null;
}

export interface RegisterDataSourceInput {
  sourceId: string;
  tenantId: TenantId;
  provider: string;
  owner: string;
  urlOrApi: string;
  authenticationMethod: string;
  schemaName: string;
  refreshFrequencySeconds: number;
  reliability: number;
  license: string;
  jurisdiction: string;
  sensitivity: DataClassification;
  retentionDays?: number | null;
}

export type RegisterDataSourceResult =
  { ok: true; source: DataSourceRecord } | { ok: false; error: string };

export function registerDataSource(input: RegisterDataSourceInput): RegisterDataSourceResult {
  if (input.sourceId.trim() === "") {
    return { ok: false, error: "Data source requires an id (S)" };
  }
  if (input.provider.trim() === "") {
    return { ok: false, error: "Data source requires a provider (S)" };
  }
  if (input.reliability < 0 || input.reliability > 1) {
    return { ok: false, error: "Source reliability must be between 0 and 1 (S)" };
  }
  return {
    ok: true,
    source: {
      sourceId: input.sourceId,
      tenantId: input.tenantId,
      provider: input.provider,
      owner: input.owner,
      urlOrApi: input.urlOrApi,
      authenticationMethod: input.authenticationMethod,
      schemaName: input.schemaName,
      refreshFrequencySeconds: input.refreshFrequencySeconds,
      reliability: input.reliability,
      license: input.license,
      jurisdiction: input.jurisdiction,
      sensitivity: input.sensitivity,
      retentionDays: input.retentionDays ?? null,
      lastSuccessfulIngestion: null,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Schema registry (Y) and schema evolution (Z)
 * ────────────────────────────────────────────────────────────*/

export type SchemaCompatibility = "compatible" | "breaking";

export interface SchemaVersionRecord {
  schemaName: string;
  tenantId: TenantId;
  version: number;
  fields: string[];
  compatibility: SchemaCompatibility;
  createdAt: string;
}

export interface RegisterSchemaVersionInput {
  schemaName: string;
  tenantId: TenantId;
  version: number;
  fields: string[];
  /** Whether this version is backward-compatible with the previous one (Z). */
  backwardCompatible: boolean;
  now: string;
}

export type RegisterSchemaVersionResult =
  { ok: true; schema: SchemaVersionRecord } | { ok: false; error: string };

/** Schema registry (Y): schemas are versioned; breaking changes are flagged
 * so they require explicit architectural decisions (Z). */
export function registerSchemaVersion(
  input: RegisterSchemaVersionInput,
): RegisterSchemaVersionResult {
  if (input.fields.length === 0) {
    return { ok: false, error: "Schema version requires fields (Y)" };
  }
  return {
    ok: true,
    schema: {
      schemaName: input.schemaName,
      tenantId: input.tenantId,
      version: input.version,
      fields: input.fields,
      compatibility: input.backwardCompatible ? "compatible" : "breaking",
      createdAt: input.now,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Data contracts (AA)
 * ────────────────────────────────────────────────────────────*/

export interface DataContract {
  id: string;
  tenantId: TenantId;
  producer: string;
  consumer: string;
  schemaName: string;
  semantics: string;
  freshnessSeconds: number | null;
  qualityRequirements: string[];
  owner: string;
  retentionDays: number | null;
  securityClassification: DataClassification;
  compatibilityRequirements: string[];
}

export interface CreateDataContractInput {
  tenantId: TenantId;
  producer: string;
  consumer: string;
  schemaName: string;
  semantics: string;
  freshnessSeconds?: number | null;
  qualityRequirements: string[];
  owner: string;
  retentionDays?: number | null;
  securityClassification: DataClassification;
  compatibilityRequirements?: string[];
}

export type CreateDataContractResult =
  { ok: true; contract: DataContract } | { ok: false; error: string };

export function createDataContract(input: CreateDataContractInput): CreateDataContractResult {
  if (input.producer.trim() === "" || input.consumer.trim() === "") {
    return { ok: false, error: "Data contract requires a producer and consumer (AA)" };
  }
  if (input.schemaName.trim() === "") {
    return { ok: false, error: "Data contract requires a schema (AA)" };
  }
  return {
    ok: true,
    contract: {
      id: `contract-${input.tenantId}-${input.producer}-${input.consumer}-${input.schemaName}`,
      tenantId: input.tenantId,
      producer: input.producer,
      consumer: input.consumer,
      schemaName: input.schemaName,
      semantics: input.semantics,
      freshnessSeconds: input.freshnessSeconds ?? null,
      qualityRequirements: input.qualityRequirements,
      owner: input.owner,
      retentionDays: input.retentionDays ?? null,
      securityClassification: input.securityClassification,
      compatibilityRequirements: input.compatibilityRequirements ?? [],
    },
  };
}

/**
 * Contract enforcement (AB): pipelines should validate contracts before
 * publishing data. This checks that the actual freshness and quality meet
 * the contract requirements.
 */
export function validateContractCompliance(
  contract: DataContract,
  actualFreshnessSeconds: number | null,
  qualitySatisfied: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (contract.freshnessSeconds !== null && actualFreshnessSeconds !== null) {
    if (actualFreshnessSeconds > contract.freshnessSeconds) {
      return { ok: false, reason: "Data freshness exceeds contract requirement (AB)" };
    }
  }
  if (!qualitySatisfied) {
    return { ok: false, reason: "Data quality does not meet contract requirements (AB)" };
  }
  return { ok: true };
}
