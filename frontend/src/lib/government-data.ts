import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

// ─── CoreGrid Phase 20 — Government Education Cloud ──────────────────
// government-data.ts — Reporting, data sharing, classification,
//                      interoperability, API gateway, residency
// ──────────────────────────────────────────────────────────────────────

export type ReportId = string & { __brand: "ReportId" };
export type DataSharingAgreementId = string & { __brand: "DataSharingAgreementId" };

// ─── X–Z. Government Reporting ───────────────────────────────────────
export type ReportFrequency = "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "on_demand";

export interface GovernmentReportDefinition {
  readonly id: ReportId;
  readonly name: string;
  readonly jurisdiction: string;
  readonly frequency: ReportFrequency;
  readonly schema: Record<string, string>;
  readonly regulatory: boolean;
  readonly version: number;
  readonly availableFrom: string;
  readonly availableTo: string | null;
}

// ─── AA–AB. Report Versioning & Provenance ───────────────────────────
export interface ReportProvenance {
  readonly reportId: ReportId;
  readonly generatedAt: string;
  readonly dataAsOf: string;
  readonly sourceSystems: string[];
  readonly methodology: string | null;
  readonly qualityScore: number | null;
}

// ─── AE–AF. Data Classification & Sharing ─────────────────────────────
export type GovernmentDataClassification =
  "public" | "internal" | "confidential" | "sensitive" | "restricted" | "regulated";
export interface GovernmentDataSharingAgreement {
  readonly id: DataSharingAgreementId;
  readonly sourceOrganisation: string;
  readonly targetOrganisation: string;
  readonly classification: GovernmentDataClassification;
  readonly purpose: string;
  readonly fields: string[];
  readonly expiresAt: string | null;
  readonly status: "active" | "expired" | "revoked" | "pending";
}

// ─── AI–AL. De-identification / Privacy ──────────────────────────────
export interface DeIdentificationRule {
  readonly field: string;
  readonly method: "anonymize" | "pseudonymize" | "aggregate" | "suppress";
  readonly parameters: Record<string, string | number>;
}

export interface SmallCellRule {
  readonly threshold: number;
  readonly action: "suppress" | "flag" | "aggregate";
  readonly appliesTo: string[];
}

// ─── AM–AO. Government Data Catalog ──────────────────────────────────
export interface DataCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly jurisdiction: string;
  readonly ownerOrganisation: string;
  readonly classification: GovernmentDataClassification;
  readonly description: string;
  readonly schema: Record<string, string>;
  readonly stewards: string[];
}

// ─── AR–AY. Government Interoperability ──────────────────────────────
export interface ExternalSystemRegistry {
  readonly id: string;
  readonly name: string;
  readonly systemType: string;
  readonly jurisdiction: string;
  readonly apiEndpoint: string | null;
  readonly integrationType: "api" | "message" | "batch" | "file_exchange";
  readonly status: "active" | "degraded" | "failed" | "unknown";
  readonly authMethod: "oauth" | "apikey" | "certificate" | "none";
}

export interface GovernmentIntegrationContract {
  readonly id: string;
  readonly sourceSystem: string;
  readonly targetSystem: string;
  readonly dataFields: string[];
  readonly frequency: ReportFrequency;
  readonly sla: string | null;
  readonly status: "active" | "deprecated" | "pending";
}

// ─── CE–CH. Data Residency & Sovereign Cloud ────────────────────────
export interface DataLocationPolicy {
  readonly jurisdiction: string;
  readonly allowedRegions: string[];
  readonly prohibitedRegions: string[];
  readonly sovereignOnly: boolean;
  readonly airGapped: boolean;
}

export interface SovereignCloudProfile {
  readonly jurisdiction: string;
  readonly provider: string;
  readonly region: string;
  readonly dataResidency: boolean;
  readonly operationalIndependence: boolean;
  readonly status: "operational" | "degraded" | "failed";
}

// ─── DO–DQ. Open Data ────────────────────────────────────────────────
export interface OpenDataPipeline {
  readonly id: string;
  readonly datasetId: string;
  readonly schedule: ReportFrequency;
  readonly transformation: string | null;
  readonly publicationEndpoint: string | null;
  readonly status: "active" | "paused" | "failed";
}

export interface PublicDataCatalogue {
  readonly id: string;
  readonly title: string;
  readonly jurisdiction: string;
  readonly datasets: string[];
  readonly lastUpdated: string | null;
  readonly language: string;
}
// ─── Functions ────────────────────────────────────────────────────────

export function createReportDefinition(params: {
  id: ReportId;
  name: string;
  jurisdiction: string;
  frequency: ReportFrequency;
  schema: Record<string, string>;
  regulatory?: boolean;
  availableTo?: string;
}): GovernmentReportDefinition {
  if (!params.id || !params.name) throw new Error("Report requires id and name");
  return {
    id: params.id,
    name: params.name,
    jurisdiction: params.jurisdiction,
    frequency: params.frequency,
    schema: params.schema,
    regulatory: params.regulatory ?? false,
    version: 1,
    availableFrom: timeAuthority.now().at,
    availableTo: params.availableTo ?? null,
  };
}

export function createDataSharingAgreement(params: {
  id: DataSharingAgreementId;
  sourceOrganisation: string;
  targetOrganisation: string;
  classification: GovernmentDataClassification;
  purpose: string;
  fields: string[];
  expiresAt?: string;
}): GovernmentDataSharingAgreement {
  if (!params.id || params.fields.length === 0) {
    throw new Error("Agreement requires id and at least one field");
  }
  if (!params.purpose) throw new Error("Data sharing requires a purpose (AH)");
  return {
    id: params.id,
    sourceOrganisation: params.sourceOrganisation,
    targetOrganisation: params.targetOrganisation,
    classification: params.classification,
    purpose: params.purpose,
    fields: params.fields,
    expiresAt: params.expiresAt ?? null,
    status: "pending" as const,
  };
}

export function approveAgreement(
  agreement: GovernmentDataSharingAgreement,
): GovernmentDataSharingAgreement {
  if (agreement.status !== "pending") {
    throw new Error("Only pending agreements can be approved");
  }
  return { ...agreement, status: "active" as const };
}

export function createCatalogEntry(params: {
  id: string;
  name: string;
  jurisdiction: string;
  ownerOrganisation: string;
  classification: GovernmentDataClassification;
  description: string;
  schema: Record<string, string>;
  stewards?: string[];
}): DataCatalogEntry {
  if (!params.id || !params.name) throw new Error("Catalog entry requires id and name");
  return {
    id: params.id,
    name: params.name,
    jurisdiction: params.jurisdiction,
    ownerOrganisation: params.ownerOrganisation,
    classification: params.classification,
    description: params.description,
    schema: params.schema,
    stewards: params.stewards ?? [],
  };
}

export function registerExternalSystem(params: {
  id: string;
  name: string;
  systemType: string;
  jurisdiction: string;
  apiEndpoint?: string;
  integrationType: ExternalSystemRegistry["integrationType"];
  authMethod: ExternalSystemRegistry["authMethod"];
}): ExternalSystemRegistry {
  if (!params.id || !params.name) throw new Error("System requires id and name");
  return {
    id: params.id,
    name: params.name,
    systemType: params.systemType,
    jurisdiction: params.jurisdiction,
    apiEndpoint: params.apiEndpoint ?? null,
    integrationType: params.integrationType,
    status: "active" as const,
    authMethod: params.authMethod,
  };
}

export function createLocationPolicy(params: {
  jurisdiction: string;
  allowedRegions: string[];
  prohibitedRegions?: string[];
  sovereignOnly?: boolean;
  airGapped?: boolean;
}): DataLocationPolicy {
  if (!params.jurisdiction) throw new Error("Location policy requires jurisdiction");
  return {
    jurisdiction: params.jurisdiction,
    allowedRegions: params.allowedRegions,
    prohibitedRegions: params.prohibitedRegions ?? [],
    sovereignOnly: params.sovereignOnly ?? false,
    airGapped: params.airGapped ?? false,
  };
}

export function computeDeIdentifiedValue(value: string, rule: DeIdentificationRule): string {
  switch (rule.method) {
    case "suppress":
      return "***";
    case "anonymize":
      return `anon_${value.length}`;
    case "pseudonymize":
      return `pseudo_${value.slice(0, 2)}***`;
    case "aggregate":
      return `[aggregated]`;
  }
}
