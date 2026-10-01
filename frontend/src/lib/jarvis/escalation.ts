/**
 * CoreGrid — Jarvis V1 escalation ladder (V5.3 Part 15).
 *
 * A pure escalation ladder for incidents Jarvis may raise as the platform
 * observability interface. Severity maps deterministically onto a governance
 * tier: info notifies, warning requests human approval, critical pages the
 * operator AND mandatorily requires human approval. Records are immutable
 * evidence carriers: they demand evidence refs at open time and can never
 * auto-resolve — a critical record stays open until a non-null humanRef closes
 * it. Closing without a human ref fails closed.
 */

export type IncidentSeverity = "info" | "warning" | "critical";

const SEVERITIES: readonly IncidentSeverity[] = ["info", "warning", "critical"];

export interface JarvisIncident {
  incidentRef: string;
  tenantRef: string;
  severity: IncidentSeverity;
  summary: string;
  /** Evidence refs backing the incident — mandatory; empty evidence fails closed. */
  evidenceRefs: readonly string[];
  /** ISO-8601 timestamp of the observation. */
  at: string;
}

export type EscalationTier = "notify_only" | "request_human_approval" | "page_operator";

export interface EscalationRecord {
  incidentRef: string;
  tenantRef: string;
  tier: EscalationTier;
  severity: IncidentSeverity;
  summary: string;
  evidenceRefs: readonly string[];
  /** Mandatory for every tier at or above request_human_approval. */
  humanApprovalRequired: boolean;
  openedAt: string;
  /** Null until a human closes the record — records never auto-resolve. */
  closedByHumanRef: string | null;
}

export type EscalationDecision =
  | { decision: "escalate"; tier: EscalationTier; record: EscalationRecord }
  | {
      decision: "deny";
      code: "invalid_severity" | "evidence_required" | "invalid_incident";
      reason: string;
    };

/**
 * Raise an incident onto the escalation ladder. Fail closed on unknown
 * severities, malformed incidents, and empty evidence.
 */
export function escalateIncident(incident: JarvisIncident): EscalationDecision {
  if (
    typeof incident.incidentRef !== "string" ||
    incident.incidentRef.length === 0 ||
    typeof incident.tenantRef !== "string" ||
    incident.tenantRef.length === 0 ||
    typeof incident.summary !== "string" ||
    incident.summary.length === 0
  ) {
    return {
      decision: "deny",
      code: "invalid_incident",
      reason: "Incident requires non-empty incidentRef, tenantRef and summary",
    };
  }
  if (!SEVERITIES.includes(incident.severity)) {
    return {
      decision: "deny",
      code: "invalid_severity",
      reason: `Unknown severity "${String(incident.severity)}" — ladder fails closed`,
    };
  }
  if (incident.evidenceRefs.length === 0) {
    return {
      decision: "deny",
      code: "evidence_required",
      reason: "Escalation records must carry at least one evidence ref",
    };
  }
  const tier: EscalationTier =
    incident.severity === "critical"
      ? "page_operator"
      : incident.severity === "warning"
        ? "request_human_approval"
        : "notify_only";
  return {
    decision: "escalate",
    tier,
    record: {
      incidentRef: incident.incidentRef,
      tenantRef: incident.tenantRef,
      tier,
      severity: incident.severity,
      summary: incident.summary,
      evidenceRefs: [...incident.evidenceRefs],
      humanApprovalRequired: incident.severity !== "info",
      openedAt: incident.at,
      closedByHumanRef: null,
    },
  };
}

export type EscalationClosure =
  | { closed: true; record: EscalationRecord }
  | { closed: false; code: "human_required" | "already_closed"; reason: string };

/**
 * Close an escalation record. Only a non-null human ref may close a record —
 * automated callers (humanRef omitted or null) fail closed and the record,
 * critical or not, stays open.
 */
export function closeEscalationRecord(
  record: EscalationRecord,
  humanRef: string | null,
): EscalationClosure {
  if (record.closedByHumanRef !== null) {
    return {
      closed: false,
      code: "already_closed",
      reason: `Record already closed by "${record.closedByHumanRef}"`,
    };
  }
  if (typeof humanRef !== "string" || humanRef.length === 0) {
    return {
      closed: false,
      code: "human_required",
      reason: "Escalation records cannot auto-resolve — a non-null humanRef is required",
    };
  }
  return {
    closed: true,
    record: { ...record, closedByHumanRef: humanRef },
  };
}

export function isEscalationOpen(record: EscalationRecord): boolean {
  return record.closedByHumanRef === null;
}
