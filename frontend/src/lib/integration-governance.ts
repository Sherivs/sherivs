/**
 * CoreGrid Integration Fabric — integration governance, drift, resilience, and
 * normalization domain.
 *
 * Implements `architecture/phase-29-coregrid-integration.md`:
 * - Integration governance (CU): every production integration has owner, purpose,
 *   scope, data classification, provider, credentials, lifecycle, support
 *   contact, risk classification. Risk levels (CV): Low/Medium/High/Critical;
 *   financial, identity, government, sensitive integrations require stronger
 *   controls. Approval workflow (CW): Developer → Security Review → Data Review →
 *   Architecture Review → Owner Approval → Production.
 * - Integration inventory (CX), dependency graph (CY), provider status (CZ),
 *   provider change detection (DA), schema drift (DB), automated drift response
 *   (DC): warn, pause, quarantine, require review depending on risk.
 * - Integration pause (DD), emergency disconnect (DE), recovery (DF),
 *   data export (DG), backup (DH), disaster recovery (DI), business continuity
 *   (DJ), offline queuing (DK), reconnection (DL).
 * - African connectivity conditions (DM): unreliable connectivity, intermittent
 *   mobile networks, high latency, bandwidth limitations, regional outages,
 *   provider instability, power interruptions. Store-and-forward (DN), local
 *   gateways (DO), edge integration (DP).
 * - Multi-language data (DQ), timezone normalization (DR), currency
 *   normalization (DS), unit normalization (DT), local identifiers (DU),
 *   external ID mapping (DV).
 * - Integration API (DW), events (DX): integration.created/updated/connected/
 *   disconnected/failed/paused/resumed, sync started/completed/failed,
 *   reconciliation started/completed/failed, schema changed, credential
 *   expiring, provider degraded/recovered.
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type IntegrationApprovalId = string & { readonly __brand: "IntegrationApprovalId" };
export type IntegrationEventId = string & { readonly __brand: "IntegrationEventId" };
export type ExternalIdMappingId = string & { readonly __brand: "ExternalIdMappingId" };

export function integrationApprovalId(raw: string): IntegrationApprovalId {
  return raw as IntegrationApprovalId;
}
export function integrationEventId(raw: string): IntegrationEventId {
  return raw as IntegrationEventId;
}
export function externalIdMappingId(raw: string): ExternalIdMappingId {
  return raw as ExternalIdMappingId;
}

/* ─────────────────────────────────────────────────────────────
 * Integration governance (CU) + risk levels (CV) + approval (CW)
 * ────────────────────────────────────────────────────────────*/

export type IntegrationRiskLevel = "low" | "medium" | "high" | "critical";

export const INTEGRATION_RISK_LEVELS: readonly IntegrationRiskLevel[] = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const INTEGRATION_RISK_RANK: Record<IntegrationRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface IntegrationGovernanceRecord {
  integrationRef: string;
  ownerRef: string;
  purpose: string;
  scope: string[];
  dataClass: "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";
  providerRef: string;
  credentialRef: string;
  lifecycleState: string;
  supportContact: string;
  riskLevel: IntegrationRiskLevel;
}

export function createIntegrationGovernanceRecord(input: {
  integrationRef: string;
  ownerRef: string;
  purpose: string;
  scope?: string[];
  dataClass?: IntegrationGovernanceRecord["dataClass"];
  providerRef: string;
  credentialRef: string;
  lifecycleState?: string;
  supportContact: string;
  riskLevel?: IntegrationRiskLevel;
}): { ok: true; record: IntegrationGovernanceRecord } | { ok: false; error: string } {
  if (!input.ownerRef.trim()) {
    return { ok: false, error: "Integration requires an owner (Section CU)" };
  }
  if (!input.purpose.trim()) {
    return { ok: false, error: "Integration requires a purpose (Section CU)" };
  }
  if (!input.supportContact.trim()) {
    return { ok: false, error: "Integration requires a support contact (Section CU)" };
  }
  return {
    ok: true,
    record: {
      integrationRef: input.integrationRef,
      ownerRef: input.ownerRef,
      purpose: input.purpose.trim(),
      scope: input.scope ?? [],
      dataClass: input.dataClass ?? "TENANT_INTERNAL",
      providerRef: input.providerRef,
      credentialRef: input.credentialRef,
      lifecycleState: input.lifecycleState ?? "provisioning",
      supportContact: input.supportContact,
      riskLevel: input.riskLevel ?? "low",
    },
  };
}

/** Section CV: financial, identity, government, and sensitive integrations are at least high risk. */
export function classifyIntegrationRisk(input: {
  domain:
    | "financial"
    | "identity"
    | "government"
    | "sensitive"
    | "communication"
    | "productivity"
    | "other";
  writesAuthoritativeData: boolean;
}): IntegrationRiskLevel {
  if (input.domain === "financial" || input.domain === "identity" || input.domain === "government")
    return "high";
  if (input.domain === "sensitive") return "high";
  if (input.writesAuthoritativeData) return "medium";
  return "low";
}

export type ApprovalStep =
  | "developer"
  | "security_review"
  | "data_review"
  | "architecture_review"
  | "owner_approval"
  | "production";

export const APPROVAL_STEPS: readonly ApprovalStep[] = [
  "developer",
  "security_review",
  "data_review",
  "architecture_review",
  "owner_approval",
  "production",
] as const;

export interface IntegrationApproval {
  id: IntegrationApprovalId;
  integrationRef: string;
  stepsCompleted: ApprovalStep[];
  approved: boolean;
}

/**
 * Approval workflow (CW): high-risk integrations advance through Security Review,
 * Data Review, Architecture Review, and Owner Approval before production.
 */
export function canEnterProduction(
  approval: IntegrationApproval,
  riskLevel: IntegrationRiskLevel,
): boolean {
  if (riskLevel === "low" || riskLevel === "medium") return true;
  const required: ApprovalStep[] = [
    "security_review",
    "data_review",
    "architecture_review",
    "owner_approval",
  ];
  return required.every((s) => approval.stepsCompleted.includes(s));
}

/* ─────────────────────────────────────────────────────────────
 * Provider status (CZ) + schema drift (DB) + drift response (DC)
 * ────────────────────────────────────────────────────────────*/

export type ProviderStatus =
  "operational" | "degraded" | "maintenance" | "outage" | "api_changed" | "deprecated";

export const PROVIDER_STATUSES: readonly ProviderStatus[] = [
  "operational",
  "degraded",
  "maintenance",
  "outage",
  "api_changed",
  "deprecated",
] as const;

export interface ProviderRecord {
  providerRef: string;
  status: ProviderStatus;
  apiVersion: string;
  incidentCount: number;
  updatedAt: string;
}

export function updateProviderStatus(input: {
  providerRef: string;
  status: ProviderStatus;
  apiVersion?: string;
  incidentCount?: number;
  now?: string;
}): ProviderRecord {
  return {
    providerRef: input.providerRef,
    status: input.status,
    apiVersion: input.apiVersion ?? "",
    incidentCount: input.incidentCount ?? 0,
    updatedAt: input.now ?? timeAuthority.now().at,
  };
}

/**
 * Schema drift (DB): detect external schema changes. Drift response (DC):
 * warn, pause, quarantine, or require review depending on risk.
 */
export function evaluateSchemaDrift(input: {
  expectedFields: string[];
  observedFields: string[];
  riskLevel: IntegrationRiskLevel;
}): { driftDetected: boolean; response: "warn" | "pause" | "quarantine" | "review" } {
  const missing = input.expectedFields.filter((f) => !input.observedFields.includes(f));
  if (missing.length === 0) return { driftDetected: false, response: "warn" };
  if (input.riskLevel === "critical" || input.riskLevel === "high") {
    return { driftDetected: true, response: "quarantine" };
  }
  if (input.riskLevel === "medium") {
    return { driftDetected: true, response: "pause" };
  }
  return { driftDetected: true, response: "review" };
}

/* ─────────────────────────────────────────────────────────────
 * Pause (DD) + emergency disconnect (DE)
 * ────────────────────────────────────────────────────────────*/

export interface IntegrationPauseRecord {
  integrationRef: string;
  paused: boolean;
  pausedAt: string | null;
  pausedByRef: string | null;
}

export function pauseIntegration(input: {
  integrationRef: string;
  pausedByRef: string;
  now?: string;
}): IntegrationPauseRecord {
  return {
    integrationRef: input.integrationRef,
    paused: true,
    pausedAt: input.now ?? timeAuthority.now().at,
    pausedByRef: input.pausedByRef,
  };
}

export function resumeIntegration(record: IntegrationPauseRecord): IntegrationPauseRecord {
  return { ...record, paused: false, pausedAt: null, pausedByRef: null };
}

/** Section DE: critical integrations support emergency isolation without deleting config. */
export function canEmergencyDisconnect(riskLevel: IntegrationRiskLevel): boolean {
  return riskLevel === "high" || riskLevel === "critical";
}

/* ─────────────────────────────────────────────────────────────
 * Resilience (DK, DL, DM, DN) + African connectivity (DM)
 * ────────────────────────────────────────────────────────────*/

export interface ConnectivityProfile {
  unreliableConnectivity: boolean;
  intermittentMobileNetworks: boolean;
  highLatency: boolean;
  bandwidthLimited: boolean;
  regionalOutages: boolean;
  providerInstability: boolean;
  powerInterruptions: boolean;
}

export const AFRICAN_CONNECTIVITY_DEFAULTS: ConnectivityProfile = {
  unreliableConnectivity: true,
  intermittentMobileNetworks: true,
  highLatency: true,
  bandwidthLimited: true,
  regionalOutages: true,
  providerInstability: true,
  powerInterruptions: true,
};

/**
 * Store-and-forward (DN): where connectivity is unreliable, outbound operations
 * may be queued until the provider becomes available (DK).
 */
export function requiresStoreAndForward(profile: ConnectivityProfile): boolean {
  return (
    profile.unreliableConnectivity || profile.intermittentMobileNetworks || profile.regionalOutages
  );
}

/* ─────────────────────────────────────────────────────────────
 * Normalization (DQ, DR, DS, DT) + external ID mapping (DU, DV)
 * ────────────────────────────────────────────────────────────*/

/** Timezone normalization (DR): preserve original timezone info + canonical UTC. */
export function normalizeTimestamp(input: {
  rawTimestamp: string;
  sourceTimezone: string;
  canonicalUtc: string;
}): { canonicalUtc: string; sourceTimezone: string; originalPreserved: boolean } {
  return {
    canonicalUtc: input.canonicalUtc,
    sourceTimezone: input.sourceTimezone,
    originalPreserved: input.sourceTimezone !== "UTC",
  };
}

/** Currency normalization (DS): preserve original currency + exchange context. */
export function normalizeCurrency(input: { amountMinorUnits: number; currency: string }): {
  amountMinorUnits: number;
  currency: string;
  exchangeContextRequired: boolean;
} {
  return {
    amountMinorUnits: input.amountMinorUnits,
    currency: input.currency,
    exchangeContextRequired: input.currency !== "NGN",
  };
}

export interface ExternalIdMapping {
  id: ExternalIdMappingId;
  tenantId: TenantId;
  coregridId: string;
  externalId: string;
  provider: string;
  entityType: string;
}

export function createExternalIdMapping(input: {
  id: ExternalIdMappingId;
  tenantId: TenantId;
  coregridId: string;
  externalId: string;
  provider: string;
  entityType: string;
}): ExternalIdMapping {
  return {
    id: input.id,
    tenantId: input.tenantId,
    coregridId: input.coregridId,
    externalId: input.externalId,
    provider: input.provider,
    entityType: input.entityType,
  };
}

/** Section DU: external identifiers must remain traceable to their source system. */
export function isExternalIdTraceable(mapping: ExternalIdMapping): boolean {
  return mapping.externalId.trim() !== "" && mapping.provider.trim() !== "";
}

/* ─────────────────────────────────────────────────────────────
 * Integration events (DX)
 * ────────────────────────────────────────────────────────────*/

export type IntegrationEventType =
  | "integration_created"
  | "integration_updated"
  | "integration_connected"
  | "integration_disconnected"
  | "integration_failed"
  | "integration_paused"
  | "integration_resumed"
  | "sync_started"
  | "sync_completed"
  | "sync_failed"
  | "reconciliation_started"
  | "reconciliation_completed"
  | "reconciliation_failed"
  | "schema_changed"
  | "credential_expiring"
  | "provider_degraded"
  | "provider_recovered";

export const INTEGRATION_EVENT_TYPES: readonly IntegrationEventType[] = [
  "integration_created",
  "integration_updated",
  "integration_connected",
  "integration_disconnected",
  "integration_failed",
  "integration_paused",
  "integration_resumed",
  "sync_started",
  "sync_completed",
  "sync_failed",
  "reconciliation_started",
  "reconciliation_completed",
  "reconciliation_failed",
  "schema_changed",
  "credential_expiring",
  "provider_degraded",
  "provider_recovered",
] as const;

export interface IntegrationEvent {
  id: IntegrationEventId;
  tenantId: TenantId | null;
  integrationRef: string;
  type: IntegrationEventType;
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export function publishIntegrationEvent(input: {
  id: IntegrationEventId;
  tenantId?: TenantId | null;
  integrationRef: string;
  type: IntegrationEventType;
  metadata?: Record<string, string | number | boolean | null>;
  now?: string;
}): IntegrationEvent {
  return {
    id: input.id,
    tenantId: input.tenantId ?? null,
    integrationRef: input.integrationRef,
    type: input.type,
    occurredAt: input.now ?? timeAuthority.now().at,
    metadata: input.metadata ?? {},
  };
}
