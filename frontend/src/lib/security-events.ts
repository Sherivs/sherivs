/**
 * CoreGrid — Security Engine events, alerts, incidents, evidence
 * (Phase 08, Sections S, W, X, Y).
 *
 * Implements `architecture/phase-08-security-engine.md`:
 * - Security Event Contract (F.3): event ID, type, actor, tenant, resource,
 *   action, timestamp, source, severity, evidence, correlation/trace IDs,
 *   policy version.
 * - Event integrity (S.2): security events must be tamper-resistant.
 * - Security Alerts (W): severity INFO..CRITICAL; alert requirements (W.2).
 * - Security Incident Engine (X): lifecycle detected -> ... -> reviewed;
 *   every incident has an owner, severity, evidence, timeline, resolution.
 * - Security Evidence (Y): timestamped, traceable, tamper-resistant,
 *   access-controlled.
 * - Architectural Invariant (Section AT.7): security events cannot be
 *   silently deleted.
 */

import type { TenantId } from "./tenant-core";
import type { CorrelationId, TraceId } from "./runtime-core";

/* ─────────────────────────────────────────────────────────────
 * Security events (Section F.3, S)
 * ────────────────────────────────────────────────────────────*/

export type SecurityEventType =
  | "login_failure"
  | "permission_failure"
  | "suspicious_session"
  | "policy_violation"
  | "privilege_change"
  | "credential_event"
  | "agent_anomaly"
  | "tool_violation"
  | "data_export_event"
  | "security_incident";

export const SECURITY_EVENT_TYPES: readonly SecurityEventType[] = [
  "login_failure",
  "permission_failure",
  "suspicious_session",
  "policy_violation",
  "privilege_change",
  "credential_event",
  "agent_anomaly",
  "tool_violation",
  "data_export_event",
  "security_incident",
] as const;

export type SecuritySeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const SECURITY_SEVERITIES: readonly SecuritySeverity[] = [
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  actorId: string;
  tenantId: TenantId | null;
  resource: string;
  action: string;
  timestamp: string;
  source: string;
  severity: SecuritySeverity;
  evidence: string[];
  correlationId: CorrelationId;
  traceId: TraceId;
  policyVersion: string | null;
  /** Immutability guard: once created, an event is never deleted (Section AT.7). */
  deleted: false;
}

export interface CreateSecurityEventInput {
  type: SecurityEventType;
  actorId: string;
  tenantId: TenantId | null;
  resource: string;
  action: string;
  source: string;
  severity: SecuritySeverity;
  evidence: string[];
  correlationId: CorrelationId;
  traceId: TraceId;
  policyVersion?: string | null;
  now: string;
}

export function createSecurityEvent(input: CreateSecurityEventInput): SecurityEvent {
  return {
    id: `sec-evt-${input.now}-${Math.random().toString(36).slice(2, 10)}`,
    type: input.type,
    actorId: input.actorId,
    tenantId: input.tenantId,
    resource: input.resource,
    action: input.action,
    timestamp: input.now,
    source: input.source,
    severity: input.severity,
    evidence: input.evidence,
    correlationId: input.correlationId,
    traceId: input.traceId,
    policyVersion: input.policyVersion ?? null,
    deleted: false,
  };
}

/**
 * Security events cannot be silently deleted (Section AT.7). This function
 * exists so callers cannot accidentally construct a "deleted" event; the
 * only path to removing a security event from a live view is soft
 * suppression, never hard deletion, and that is a Phase 09/audit-governance
 * decision outside this module's scope.
 */
export function assertSecurityEventImmutable(event: SecurityEvent): void {
  if (event.deleted) {
    throw new Error("Security events cannot be marked deleted (Section AT.7)");
  }
}

/* ─────────────────────────────────────────────────────────────
 * Security alerts (Section W)
 * ────────────────────────────────────────────────────────────*/

export type AlertStatus = "open" | "acknowledged" | "suppressed" | "resolved" | "false_positive";

export interface SecurityAlert {
  id: string;
  eventId: string;
  severity: SecuritySeverity;
  confidence: number;
  evidence: string[];
  affectedActorId: string;
  affectedTenantId: TenantId | null;
  affectedResource: string;
  recommendedResponse: string;
  status: AlertStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSecurityAlertInput {
  event: SecurityEvent;
  confidence: number;
  recommendedResponse: string;
  now: string;
}

export type CreateSecurityAlertResult =
  { ok: true; alert: SecurityAlert } | { ok: false; error: string };

export function createSecurityAlert(input: CreateSecurityAlertInput): CreateSecurityAlertResult {
  if (input.confidence < 0 || input.confidence > 1) {
    return { ok: false, error: "Alert confidence must be between 0 and 1 (Section U.3)" };
  }
  return {
    ok: true,
    alert: {
      id: `alert-${input.event.id}`,
      eventId: input.event.id,
      severity: input.event.severity,
      confidence: input.confidence,
      evidence: input.event.evidence,
      affectedActorId: input.event.actorId,
      affectedTenantId: input.event.tenantId,
      affectedResource: input.event.resource,
      recommendedResponse: input.recommendedResponse,
      status: "open",
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

const ALERT_TRANSITIONS: Readonly<Record<AlertStatus, readonly AlertStatus[]>> = {
  open: ["acknowledged", "suppressed", "false_positive"],
  acknowledged: ["resolved", "suppressed", "false_positive"],
  suppressed: ["open"],
  resolved: [],
  false_positive: [],
};

export function transitionSecurityAlert(
  alert: SecurityAlert,
  to: AlertStatus,
  now: string,
): { ok: true; alert: SecurityAlert } | { ok: false; error: string } {
  if (!ALERT_TRANSITIONS[alert.status].includes(to)) {
    return { ok: false, error: `Alert transition ${alert.status} -> ${to} is not allowed` };
  }
  return { ok: true, alert: { ...alert, status: to, updatedAt: now } };
}

/* ─────────────────────────────────────────────────────────────
 * Security incidents (Section X)
 * ────────────────────────────────────────────────────────────*/

export type IncidentState =
  | "detected"
  | "triaged"
  | "investigating"
  | "contained"
  | "remediating"
  | "recovered"
  | "closed"
  | "reviewed";

export const INCIDENT_STATES: readonly IncidentState[] = [
  "detected",
  "triaged",
  "investigating",
  "contained",
  "remediating",
  "recovered",
  "closed",
  "reviewed",
] as const;

const INCIDENT_TRANSITIONS: Readonly<Record<IncidentState, readonly IncidentState[]>> = {
  detected: ["triaged"],
  triaged: ["investigating"],
  investigating: ["contained"],
  contained: ["remediating"],
  remediating: ["recovered"],
  recovered: ["closed"],
  closed: ["reviewed"],
  reviewed: [],
};

export function isIncidentTransitionAllowed(from: IncidentState, to: IncidentState): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

export interface SecurityIncident {
  id: string;
  ownerId: string;
  severity: SecuritySeverity;
  state: IncidentState;
  evidenceRefs: string[];
  timeline: { at: string; note: string }[];
  actions: string[];
  resolution: string | null;
  postmortem: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSecurityIncidentInput {
  ownerId: string;
  severity: SecuritySeverity;
  evidenceRefs: string[];
  now: string;
}

export type CreateSecurityIncidentResult =
  { ok: true; incident: SecurityIncident } | { ok: false; error: string };

export function createSecurityIncident(
  input: CreateSecurityIncidentInput,
): CreateSecurityIncidentResult {
  if (input.ownerId.trim() === "") {
    return { ok: false, error: "Incident owner is required (Section X.2)" };
  }
  return {
    ok: true,
    incident: {
      id: `incident-${input.now}-${Math.random().toString(36).slice(2, 10)}`,
      ownerId: input.ownerId,
      severity: input.severity,
      state: "detected",
      evidenceRefs: input.evidenceRefs,
      timeline: [{ at: input.now, note: "Incident detected" }],
      actions: [],
      resolution: null,
      postmortem: null,
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

export function transitionSecurityIncident(
  incident: SecurityIncident,
  to: IncidentState,
  note: string,
  now: string,
): { ok: true; incident: SecurityIncident } | { ok: false; error: string } {
  if (!isIncidentTransitionAllowed(incident.state, to)) {
    return { ok: false, error: `Incident transition ${incident.state} -> ${to} is not allowed` };
  }
  if (to === "closed" && incident.resolution === null) {
    return { ok: false, error: "Incident requires a resolution before closing (Section X.2)" };
  }
  return {
    ok: true,
    incident: {
      ...incident,
      state: to,
      updatedAt: now,
      timeline: [...incident.timeline, { at: now, note }],
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Security evidence (Section Y)
 * ────────────────────────────────────────────────────────────*/

export interface SecurityEvidenceRecord {
  id: string;
  referenceType:
    | "security_event"
    | "authorization_decision"
    | "policy_version"
    | "actor_context"
    | "system_state"
    | "investigation_action";
  referenceId: string;
  capturedAt: string;
  accessControlled: true;
}

export function createSecurityEvidenceRecord(
  referenceType: SecurityEvidenceRecord["referenceType"],
  referenceId: string,
  now: string,
): SecurityEvidenceRecord {
  return {
    id: `evidence-${referenceType}-${referenceId}-${now}`,
    referenceType,
    referenceId,
    capturedAt: now,
    accessControlled: true,
  };
}
