/**
 * CoreGrid — Institutional Command Centre alert domain model
 * (Phase 19, Sections Y, Z, AA, AB, AC, AD, AE, AF, AG, AH, AI, AJ, AK).
 *
 * Implements `architecture/phase-19-command-centre.md`:
 * - Alert centre (Y): centralized alert presentation; alerts may
 *   originate from analytics, security, infrastructure, hardware,
 *   academic, financial, automation and communication systems.
 * - Alert ownership (Z): Phase 19 owns the command presentation and
 *   coordination state of alerts; the originating subsystem remains
 *   responsible for underlying alert semantics.
 * - Prioritization (AA): severity, impact, urgency, confidence, scope,
 *   affected population, business importance.
 * - Severity (AB) and status (AC); acknowledgement (AD) records actor,
 *   timestamp, alert, acknowledgement state.
 * - Escalation (AE): depends on severity, time, owner, policy, scope.
 * - Correlation (AF): related alerts are grouped where appropriate.
 * - Flood control (AG) and fatigue (AH): deduplication, grouping,
 *   suppression, rate limiting, prioritization — reduce repetitive
 *   low-value alerts.
 * - Command queue (AI): attention queue of urgent alerts, pending
 *   decisions, unresolved incidents, approvals, investigations,
 *   escalations and operational tasks.
 * - Priority engine (AJ) and governance (AK): priority must remain
 *   explainable.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Alert model (Y, Z, AB, AC)
 * ────────────────────────────────────────────────────────────*/

export type CommandAlertSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const COMMAND_ALERT_SEVERITIES: readonly CommandAlertSeverity[] = [
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export type CommandAlertStatus = "OPEN" | "ACKNOWLEDGED" | "ESCALATED" | "RESOLVED" | "SUPPRESSED";

export const COMMAND_ALERT_STATUSES: readonly CommandAlertStatus[] = [
  "OPEN",
  "ACKNOWLEDGED",
  "ESCALATED",
  "RESOLVED",
  "SUPPRESSED",
] as const;

export type CommandAlertSource =
  | "analytics"
  | "security"
  | "infrastructure"
  | "hardware"
  | "academic"
  | "financial"
  | "automation"
  | "communication";

export const COMMAND_ALERT_SOURCES: readonly CommandAlertSource[] = [
  "analytics",
  "security",
  "infrastructure",
  "hardware",
  "academic",
  "financial",
  "automation",
  "communication",
] as const;

export interface CommandAlert {
  alertId: string;
  tenantId: TenantId;
  source: CommandAlertSource;
  sourceAlertId: string;
  severity: CommandAlertSeverity;
  status: CommandAlertStatus;
  summary: string;
  impactedScope: string[];
  createdAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  correlationGroup: string | null;
  priority: number;
}

export interface CreateCommandAlertInput {
  alertId: string;
  tenantId: TenantId;
  source: CommandAlertSource;
  sourceAlertId: string;
  severity: CommandAlertSeverity;
  summary: string;
  impactedScope: string[];
  createdAt: string;
}

export type CreateCommandAlertResult =
  { ok: true; alert: CommandAlert } | { ok: false; error: string };

/**
 * Alert creation (Y, Z): Phase 19 coordinates the presentation of alerts;
 * the source alert ID preserves provenance back to the originating
 * subsystem.
 */
export function createCommandAlert(input: CreateCommandAlertInput): CreateCommandAlertResult {
  if (input.alertId.trim() === "" || input.summary.trim() === "") {
    return { ok: false, error: "Alert requires an ID and summary (Y)" };
  }
  if (input.sourceAlertId.trim() === "") {
    return { ok: false, error: "Alert must preserve its source alert ID (Z)" };
  }
  return {
    ok: true,
    alert: {
      alertId: input.alertId,
      tenantId: input.tenantId,
      source: input.source,
      sourceAlertId: input.sourceAlertId,
      severity: input.severity,
      status: "OPEN",
      summary: input.summary,
      impactedScope: input.impactedScope,
      createdAt: input.createdAt,
      acknowledgedBy: null,
      acknowledgedAt: null,
      correlationGroup: null,
      priority: 0,
    },
  };
}

/** Acknowledgement (AD): records actor, timestamp and acknowledgement
 * state. */
export function acknowledgeAlert(alert: CommandAlert, actor: string, at: string): CommandAlert {
  return { ...alert, status: "ACKNOWLEDGED", acknowledgedBy: actor, acknowledgedAt: at };
}

/* ─────────────────────────────────────────────────────────────
 * Priority engine (AA, AJ, AK)
 * ────────────────────────────────────────────────────────────*/

export interface PriorityFactors {
  severity: CommandAlertSeverity;
  impact: number;
  urgency: number;
  confidence: number;
  affectedPopulation: number;
  businessImportance: number;
}

/**
 * Priority engine (AJ): priority is computed from severity, impact,
 * urgency, confidence, affected population and business importance.
 * Priority remains explainable because it is the weighted mean of the
 * stated factors (AK).
 */
export function computeAlertPriority(factors: PriorityFactors): number {
  const severityRank =
    COMMAND_ALERT_SEVERITIES.indexOf(factors.severity) / (COMMAND_ALERT_SEVERITIES.length - 1);
  const components = [
    severityRank,
    Math.max(0, Math.min(1, factors.impact)),
    Math.max(0, Math.min(1, factors.urgency)),
    Math.max(0, Math.min(1, factors.confidence)),
    Math.min(1, factors.affectedPopulation / 1000),
    Math.max(0, Math.min(1, factors.businessImportance)),
  ];
  return Number((components.reduce((a, b) => a + b, 0) / components.length).toFixed(3));
}

export function isAlertHighPriority(priority: number, highPriorityThreshold: number): boolean {
  return priority >= highPriorityThreshold;
}

/* ─────────────────────────────────────────────────────────────
 * Escalation (AE) and correlation (AF)
 * ────────────────────────────────────────────────────────────*/

export interface EscalationPolicy {
  afterMinutes: number;
  escalateAtSeverity: CommandAlertSeverity;
  escalateTo: string;
}

/**
 * Escalation (AE): may depend on severity, time, owner, policy and scope.
 * An alert that stays unacknowledged past the policy window escalates.
 */
export function shouldEscalateAlert(
  alert: CommandAlert,
  policy: EscalationPolicy,
  now: string,
): { escalate: boolean; target: string; reason: string } {
  const severityRank = COMMAND_ALERT_SEVERITIES.indexOf(alert.severity);
  const escalateRank = COMMAND_ALERT_SEVERITIES.indexOf(policy.escalateAtSeverity);
  if (severityRank < escalateRank) {
    return { escalate: false, target: policy.escalateTo, reason: "Below escalation severity (AE)" };
  }
  if (alert.status === "RESOLVED" || alert.status === "SUPPRESSED") {
    return {
      escalate: false,
      target: policy.escalateTo,
      reason: "Alert already resolved or suppressed (AE)",
    };
  }
  if (alert.status === "ACKNOWLEDGED") {
    return { escalate: false, target: policy.escalateTo, reason: "Alert acknowledged (AE)" };
  }
  if (Date.parse(now) - Date.parse(alert.createdAt) < policy.afterMinutes * 60_000) {
    return { escalate: false, target: policy.escalateTo, reason: "Within escalation window (AE)" };
  }
  return {
    escalate: true,
    target: policy.escalateTo,
    reason: "Unacknowledged beyond escalation window (AE)",
  };
}

/** Correlation (AF): related alerts are grouped by correlation key. */
export function correlateAlerts(alerts: CommandAlert[], correlationKey: string): CommandAlert[] {
  return alerts.map((a) =>
    a.correlationGroup === null ? { ...a, correlationGroup: correlationKey } : a,
  );
}

/* ─────────────────────────────────────────────────────────────
 * Flood control and fatigue (AG, AH)
 * ────────────────────────────────────────────────────────────*/

export interface FloodControlPolicy {
  deduplicateBySource: boolean;
  maxAlertsPerSourceWindow: number;
  windowMs: number;
}

/**
 * Flood control (AG) and fatigue reduction (AH): deduplication, grouping,
 * suppression and rate limiting reduce repetitive low-value alerts.
 */
export function isAlertFlooded(input: {
  alert: CommandAlert;
  policy: FloodControlPolicy;
  recentSourceAlerts: number;
}): { suppressed: boolean; reason: string } {
  if (
    input.policy.deduplicateBySource &&
    input.recentSourceAlerts >= input.policy.maxAlertsPerSourceWindow
  ) {
    return { suppressed: true, reason: "Source alert rate exceeded — deduplicated (AG)" };
  }
  return { suppressed: false, reason: "Alert within flood-control limits (AG)" };
}

/* ─────────────────────────────────────────────────────────────
 * Command queue (AI)
 * ────────────────────────────────────────────────────────────*/

export type QueueItemKind =
  | "urgent_alert"
  | "pending_decision"
  | "unresolved_incident"
  | "approval"
  | "investigation"
  | "escalation"
  | "operational_task";

export const QUEUE_ITEM_KINDS: readonly QueueItemKind[] = [
  "urgent_alert",
  "pending_decision",
  "unresolved_incident",
  "approval",
  "investigation",
  "escalation",
  "operational_task",
] as const;

export interface CommandQueueItem {
  queueItemId: string;
  tenantId: TenantId;
  kind: QueueItemKind;
  referenceId: string;
  priority: number;
  createdAt: string;
  assignedTo: string | null;
}

/** Attention queue ordering (AI): highest priority first, oldest first on
 * ties. */
export function orderAttentionQueue(items: CommandQueueItem[]): CommandQueueItem[] {
  return [...items].sort((a, b) =>
    b.priority - a.priority !== 0 ? b.priority - a.priority : a.createdAt < b.createdAt ? -1 : 1,
  );
}
