/**
 * CoreGrid Integration Fabric — integration operations, observability, and
 * data-governance domain.
 *
 * Implements `architecture/phase-29-coregrid-integration.md`:
 * - Connector health (CF): authentication, latency, throughput, error rates,
 *   synchronization, provider status. Integration dashboard (CG): active,
 *   failed, degraded integrations, pending sync, reconciliation failures.
 * - Integration logging (CH): every significant operation includes correlation
 *   ID, tenant, connector, operation, timestamp, result, error classification —
 *   sensitive payloads protected. Distributed tracing (CI): CoreGrid Request →
 *   Integration → External API → Response → CoreGrid. Metrics (CJ): success/
 *   failure rate, latency, throughput, retries, dead letters, sync lag.
 *   Alerting (CK): authentication failures, error spikes, sync drift, provider
 *   outage, certificate expiry, rate-limit exhaustion.
 * - Certificate management (CL): expiry, rotation, revocation, trust chain.
 * - Integration security (CM): least privilege, secret isolation, encryption,
 *   tenant isolation, network isolation, auditability, input/output validation.
 * - Data classification (CN), data loss prevention (CO), PII protection (CP),
 *   data minimization (CQ), consent (CR), data residency (CS).
 * - Audit (CT): integration creation, credential changes, mapping changes,
 *   synchronization, failures, approvals, deletion.
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type IntegrationLogId = string & { readonly __brand: "IntegrationLogId" };
export type IntegrationAlertId = string & { readonly __brand: "IntegrationAlertId" };
export type CertificateRecordId = string & { readonly __brand: "CertificateRecordId" };
export type IntegrationAuditEventId = string & { readonly __brand: "IntegrationAuditEventId" };

export function integrationLogId(raw: string): IntegrationLogId {
  return raw as IntegrationLogId;
}
export function integrationAlertId(raw: string): IntegrationAlertId {
  return raw as IntegrationAlertId;
}
export function certificateRecordId(raw: string): CertificateRecordId {
  return raw as CertificateRecordId;
}
export function integrationAuditEventId(raw: string): IntegrationAuditEventId {
  return raw as IntegrationAuditEventId;
}

/* ─────────────────────────────────────────────────────────────
 * Connector health (CF) + dashboard (CG)
 * ────────────────────────────────────────────────────────────*/

export interface ConnectorHealth {
  connectorRef: string;
  authenticationHealthy: boolean;
  latencyMs: number;
  throughputPerMinute: number;
  errorRate: number;
  syncHealthy: boolean;
  providerStatus: "operational" | "degraded" | "outage" | "unknown";
  healthy: boolean;
}

export function evaluateConnectorHealth(input: {
  connectorRef: string;
  authenticationHealthy?: boolean;
  latencyMs?: number;
  throughputPerMinute?: number;
  errorRate?: number;
  syncHealthy?: boolean;
  providerStatus?: ConnectorHealth["providerStatus"];
  maxLatencyMs?: number;
  maxErrorRate?: number;
}): ConnectorHealth {
  const maxLatencyMs = input.maxLatencyMs ?? 5000;
  const maxErrorRate = input.maxErrorRate ?? 0.05;
  const healthy =
    (input.authenticationHealthy ?? true) &&
    (input.latencyMs ?? 0) <= maxLatencyMs &&
    (input.errorRate ?? 0) <= maxErrorRate &&
    (input.syncHealthy ?? true) &&
    (input.providerStatus ?? "operational") !== "outage";
  return {
    connectorRef: input.connectorRef,
    authenticationHealthy: input.authenticationHealthy ?? true,
    latencyMs: input.latencyMs ?? 0,
    throughputPerMinute: input.throughputPerMinute ?? 0,
    errorRate: input.errorRate ?? 0,
    syncHealthy: input.syncHealthy ?? true,
    providerStatus: input.providerStatus ?? "unknown",
    healthy,
  };
}

export interface IntegrationDashboardSnapshot {
  activeIntegrations: number;
  failedIntegrations: number;
  degradedIntegrations: number;
  pendingSynchronizations: number;
  reconciliationFailures: number;
}

export function buildIntegrationDashboard(input: {
  activeIntegrations?: number;
  failedIntegrations?: number;
  degradedIntegrations?: number;
  pendingSynchronizations?: number;
  reconciliationFailures?: number;
}): IntegrationDashboardSnapshot {
  return {
    activeIntegrations: input.activeIntegrations ?? 0,
    failedIntegrations: input.failedIntegrations ?? 0,
    degradedIntegrations: input.degradedIntegrations ?? 0,
    pendingSynchronizations: input.pendingSynchronizations ?? 0,
    reconciliationFailures: input.reconciliationFailures ?? 0,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Integration logging (CH) + tracing (CI) + metrics (CJ) + alerting (CK)
 * ────────────────────────────────────────────────────────────*/

export interface IntegrationLog {
  id: IntegrationLogId;
  tenantId: TenantId;
  connectorRef: string;
  operation: string;
  correlationId: string;
  result: "success" | "failure";
  errorClass: string | null;
  /** Sensitive payloads are never logged (CH). */
  payloadSanitized: boolean;
  occurredAt: string;
}

export function recordIntegrationLog(input: {
  id: IntegrationLogId;
  tenantId: TenantId;
  connectorRef: string;
  operation: string;
  correlationId: string;
  result: IntegrationLog["result"];
  errorClass?: string | null;
  payloadSanitized?: boolean;
  now?: string;
}): IntegrationLog {
  return {
    id: input.id,
    tenantId: input.tenantId,
    connectorRef: input.connectorRef,
    operation: input.operation,
    correlationId: input.correlationId,
    result: input.result,
    errorClass: input.errorClass ?? null,
    payloadSanitized: input.payloadSanitized ?? true,
    occurredAt: input.now ?? timeAuthority.now().at,
  };
}

export interface TraceSpan {
  traceId: string;
  parentSpanId: string | null;
  spanId: string;
  operation: string;
  startedAt: string;
  completedAt: string | null;
}

export function createTraceSpan(input: {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  operation: string;
  now?: string;
}): TraceSpan {
  return {
    traceId: input.traceId,
    parentSpanId: input.parentSpanId ?? null,
    spanId: input.spanId,
    operation: input.operation,
    startedAt: input.now ?? timeAuthority.now().at,
    completedAt: null,
  };
}

export interface IntegrationMetrics {
  successRate: number;
  failureRate: number;
  latencyMs: number;
  throughputPerMinute: number;
  retries: number;
  deadLetters: number;
  syncLagMinutes: number;
}

export function computeIntegrationMetrics(input: {
  successCount?: number;
  failureCount?: number;
  latencyMs?: number;
  throughputPerMinute?: number;
  retries?: number;
  deadLetters?: number;
  syncLagMinutes?: number;
}): IntegrationMetrics {
  const success = input.successCount ?? 0;
  const failure = input.failureCount ?? 0;
  const total = success + failure;
  return {
    successRate: total === 0 ? 1 : success / total,
    failureRate: total === 0 ? 0 : failure / total,
    latencyMs: input.latencyMs ?? 0,
    throughputPerMinute: input.throughputPerMinute ?? 0,
    retries: input.retries ?? 0,
    deadLetters: input.deadLetters ?? 0,
    syncLagMinutes: input.syncLagMinutes ?? 0,
  };
}

export type IntegrationAlertKind =
  | "authentication_failure"
  | "error_spike"
  | "sync_drift"
  | "provider_outage"
  | "certificate_expiry"
  | "rate_limit_exhaustion";

export const INTEGRATION_ALERT_KINDS: readonly IntegrationAlertKind[] = [
  "authentication_failure",
  "error_spike",
  "sync_drift",
  "provider_outage",
  "certificate_expiry",
  "rate_limit_exhaustion",
] as const;

export interface IntegrationAlert {
  id: IntegrationAlertId;
  tenantId: TenantId | null;
  connectorRef: string;
  kind: IntegrationAlertKind;
  severity: "info" | "warning" | "critical";
  message: string;
  occurredAt: string;
}

export function raiseIntegrationAlert(input: {
  id: IntegrationAlertId;
  tenantId?: TenantId | null;
  connectorRef: string;
  kind: IntegrationAlertKind;
  severity?: IntegrationAlert["severity"];
  message: string;
  now?: string;
}): IntegrationAlert {
  const severity =
    input.severity ??
    (input.kind === "provider_outage" || input.kind === "certificate_expiry"
      ? "critical"
      : "warning");
  return {
    id: input.id,
    tenantId: input.tenantId ?? null,
    connectorRef: input.connectorRef,
    kind: input.kind,
    severity,
    message: input.message,
    occurredAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Certificate management (CL)
 * ────────────────────────────────────────────────────────────*/

export interface CertificateRecord {
  id: CertificateRecordId;
  tenantId: TenantId | null;
  connectorRef: string;
  subject: string;
  expiresAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
}

export function registerCertificate(input: {
  id: CertificateRecordId;
  tenantId?: TenantId | null;
  connectorRef: string;
  subject: string;
  expiresAt: string;
  now?: string;
}): CertificateRecord {
  return {
    id: input.id,
    tenantId: input.tenantId ?? null,
    connectorRef: input.connectorRef,
    subject: input.subject,
    expiresAt: input.expiresAt,
    rotatedAt: null,
    revokedAt: null,
  };
}

/** Section CL: a certificate is expiring within the warning window. */
export function isCertificateExpiringSoon(
  cert: CertificateRecord,
  now: string,
  warnWithinDays: number = 30,
): boolean {
  const days = (new Date(cert.expiresAt).getTime() - new Date(now).getTime()) / 86_400_000;
  return days <= warnWithinDays;
}

/* ─────────────────────────────────────────────────────────────
 * Integration security (CM) + data governance (CN-CS) + audit (CT)
 * ────────────────────────────────────────────────────────────*/

export interface IntegrationSecurityAssessment {
  leastPrivilege: boolean;
  secretIsolation: boolean;
  encryption: boolean;
  tenantIsolation: boolean;
  networkIsolation: boolean;
  auditable: boolean;
  inputValidation: boolean;
  outputValidation: boolean;
}

export function isIntegrationSecuritySatisfied(assessment: IntegrationSecurityAssessment): boolean {
  return Object.values(assessment).every(Boolean);
}

export type DataClass = "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";

/**
 * Data loss prevention (CO): sensitive/restricted data must not be transferred
 * to unauthorized external systems.
 */
export function isTransferPermitted(input: {
  dataClass: DataClass;
  destinationAuthorized: boolean;
  dataMinimized: boolean;
  consentPresent: boolean;
  residencySatisfied: boolean;
}): boolean {
  if (input.dataClass === "RESTRICTED") {
    return input.destinationAuthorized && input.consentPresent && input.residencySatisfied;
  }
  if (input.dataClass === "SENSITIVE") {
    return input.destinationAuthorized && input.dataMinimized;
  }
  return true;
}

export type IntegrationAuditEventType =
  | "integration_created"
  | "credential_changed"
  | "mapping_changed"
  | "synchronization"
  | "failure"
  | "approval"
  | "deletion";

export const INTEGRATION_AUDIT_EVENT_TYPES: readonly IntegrationAuditEventType[] = [
  "integration_created",
  "credential_changed",
  "mapping_changed",
  "synchronization",
  "failure",
  "approval",
  "deletion",
] as const;

export interface IntegrationAuditEvent {
  id: IntegrationAuditEventId;
  tenantId: TenantId;
  integrationRef: string;
  type: IntegrationAuditEventType;
  actorRef: string;
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export function recordIntegrationAuditEvent(input: {
  id: IntegrationAuditEventId;
  tenantId: TenantId;
  integrationRef: string;
  type: IntegrationAuditEventType;
  actorRef: string;
  metadata?: Record<string, string | number | boolean | null>;
  now?: string;
}): IntegrationAuditEvent {
  return {
    id: input.id,
    tenantId: input.tenantId,
    integrationRef: input.integrationRef,
    type: input.type,
    actorRef: input.actorRef,
    occurredAt: input.now ?? timeAuthority.now().at,
    metadata: input.metadata ?? {},
  };
}
