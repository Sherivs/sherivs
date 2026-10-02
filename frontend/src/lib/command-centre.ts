/**
 * CoreGrid — command centre operational projection (V1CAP-089 / J-048 /
 * MISSION-R-110), closing the completeness loop's Outcome -> Observation tail
 * for human operators (phase 19 is the sole registered owner of that node).
 *
 * The withdrawn L4 experience (STREAM F phase 19): the surface was a provisioning
 * console because it owned state. This module is the correction — a PROJECTION
 * CONTRACT, pure and testable, over declared records the centre never creates:
 *
 * - OPEN ALERTS, projected from declared alert records
 *   (`command-alerts.ts` CommandAlert): severity, tenant, subject refs,
 *   first/last observed. The centre never raises an alert; the originating
 *   subsystem stays responsible for underlying alert semantics (phase 19 Z).
 * - INCIDENTS, grouping alerts under declared incident records
 *   (`command-incidents.ts` Incident) with their lifecycle state. Grouping is
 *   the DECLARED correlation link (alert.correlationGroup === incidentId, the
 *   AF rule) — the projection never invents a correlation. An alert that
 *   references an unknown incident is a DEFECT, surfaced, never dropped.
 * - DECISION RECORDS: human decisions over incidents — decided-by, rationale,
 *   evidence refs — carried as SEPARATE APPEND-ONLY records. The centre never
 *   mutates canonical truth: a decision is an appended record, and an
 *   appended record is never modified or retracted (there is no update
 *   operation on any decision record, only append).
 * - OBSERVATION CLOSURE (E-018): an incident's resolution closes the loop —
 *   the OUTCOME is recorded (lifecycle RESOLVED/CLOSED with a resolved-at
 *   instant), the OBSERVATION is recorded (a human decision record re-enters
 *   the loop citing the incident), and the closure is EVIDENCE-BEARING (the
 *   closure carries at least one evidence ref). A loop that re-enters the
 *   projection sees closed loops as closed — projection is pure, so the same
 *   substrate always re-projects the same closure state.
 *
 * Laws of this module:
 * - TENANT SCOPING IS TOTAL: every projection is scoped to one tenant
 *   (Constitution §13). A record with NO tenant scope is a DEFECT (a
 *   projection without tenant scope is a defect), excluded and surfaced. A
 *   record of ANOTHER tenant is excluded and only counted — never projected,
 *   its references never leaked. A cursor scoped to another tenant is a
 *   programming error and fails CLOSED with a typed error.
 * - READ-ONLY OVER THE SUBSTRATES: the centre projects; it never mutates
 *   canonical truth. Inputs are never modified, every returned structure is
 *   frozen, and the only write-shaped operation this contract offers is the
 *   append of a decision record — which appends and never rewrites.
 * - OBSERVATION CURSOR DELTAS: operators returning to the console are shown
 *   what changed since their declared observation cursor — new alerts, alerts
 *   updated since, new incidents, incidents closed since, new decisions —
 *   without re-reading the operator's whole history.
 * - SEVERITY / LIFECYCLE ORDER: severity ordering reuses the alert
 *   vocabulary's own rank order (never a local redefinition); incident
 *   lifecycle openness derives from the incident state machine's own states
 *   (RESOLVED/CLOSED are the closed states; everything before is open).
 * - QUOTA EVIDENCE IS SURFACED, NOT OWNED: when a cost roll-up and quota are
 *   supplied, the tenant's quota evaluation is surfaced for display (AGENTS
 *   §20) through the metering contract's own evaluation — never recomputed,
 *   never a local reimplementation, and never surfaced for another tenant.
 * - PURITY: no I/O, no persistence, no wall-clock sampling. Audit instants
 *   are supplied by the caller. Binding to live substrates arrives with the
 *   surface wiring; this layer is the authored contract.
 *
 * Boundary: the centre is DISPLAY-ONLY (AGENTS §34 — the frontend is not
 * security). Authorization, tenant resolution and record intake are all
 * resolved server-side before anything reaches this projection.
 */

import type {
  CommandAlert,
  CommandAlertSeverity,
  CommandAlertSource,
  CommandAlertStatus,
} from "./command-alerts";
import { COMMAND_ALERT_SEVERITIES } from "./command-alerts";
import type { Incident, IncidentKind, IncidentState } from "./command-incidents";
import { INCIDENT_STATES } from "./command-incidents";
import {
  evaluateTenantQuota,
  type CostRollUp,
  type QuotaEvaluation,
  type TenantQuota,
} from "./metering/cost-attribution";

/* ─────────────────────────────────────────────────────────────
 * Observation cursor (the operator's declared frontier)
 * ────────────────────────────────────────────────────────────*/

/**
 * The instant an operator last observed the console. Deltas are projected
 * since this declared frontier — the cursor carries its own tenant scope so a
 * stale (or foreign-scoped) cursor can never mix tenants into a delta.
 */
export interface ObservationCursor {
  readonly tenantId: string;
  /** Inclusive ISO-8601 instant of the operator's last observation. */
  readonly sinceAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Decision records (append-only, separate from canonical truth)
 * ────────────────────────────────────────────────────────────*/

/**
 * A human decision over an incident — WHO decided (Constitution §43), the
 * rationale, the evidence the decision rests on, and the audit instant
 * (supplied, never wall-clock sampled). Decision records are APPEND-ONLY:
 * `appendIncidentDecision` is the only write this contract offers, it appends
 * a new record, and no operation of this module ever modifies or retracts an
 * appended record.
 */
export interface IncidentDecisionRecord {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly incidentId: string;
  readonly decidedBy: string;
  readonly rationale: string;
  readonly evidenceRefs: readonly string[];
  /** Audit instant supplied by the caller — never wall-clock sampled. */
  readonly decidedAt: string;
}

/** Typed rejection for a decision record that cannot be appended. */
export class CommandCentreAppendError extends Error {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`command_centre: ${field} — ${detail}`);
    this.name = "CommandCentreAppendError";
    this.field = field;
  }
}

function isNonBlankRef(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= maxLength;
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * Append a decision record to an append-only decision ledger. The ledger is a
 * plain array treated as immutable history: the returned ledger is a NEW
 * array ending in the appended record; the input array and every record in it
 * are never modified. Fail-closed on a duplicate decision id (history cannot
 * be rewritten under an existing identity), on a blank required field, on a
 * non-ISO audit instant, and on a record whose tenant or incident scope is
 * missing.
 */
export function appendIncidentDecision(
  ledger: readonly IncidentDecisionRecord[],
  record: IncidentDecisionRecord,
): readonly IncidentDecisionRecord[] {
  if (!isNonBlankRef(record.decisionId, 200)) {
    throw new CommandCentreAppendError("decisionId", "must be 1–200 characters");
  }
  if (!isNonBlankRef(record.tenantId, 128)) {
    throw new CommandCentreAppendError("tenantId", "must be 1–128 characters");
  }
  if (!isNonBlankRef(record.incidentId, 200)) {
    throw new CommandCentreAppendError("incidentId", "must be 1–200 characters");
  }
  if (!isNonBlankRef(record.decidedBy, 200)) {
    throw new CommandCentreAppendError("decidedBy", "must be 1–200 characters");
  }
  if (!isNonBlankRef(record.rationale, 2000)) {
    throw new CommandCentreAppendError("rationale", "must be 1–2000 characters");
  }
  if (!isIsoInstant(record.decidedAt)) {
    throw new CommandCentreAppendError("decidedAt", "must be a valid ISO-8601 timestamp");
  }
  if (
    !Array.isArray(record.evidenceRefs) ||
    record.evidenceRefs.some((ref) => !isNonBlankRef(ref, 200))
  ) {
    throw new CommandCentreAppendError("evidenceRefs", "must all be 1–200 character references");
  }
  if (ledger.some((existing) => existing.decisionId === record.decisionId)) {
    throw new CommandCentreAppendError(
      "decisionId",
      `"${record.decisionId}" already exists in the ledger — decision records are append-only; ` +
        "history is never rewritten under an existing identity",
    );
  }
  return Object.freeze([...ledger, Object.freeze({ ...record })]);
}

/* ─────────────────────────────────────────────────────────────
 * Projection defects (surfaced, never absorbed)
 * ────────────────────────────────────────────────────────────*/

export type CommandCentreDefectReason =
  | "missing_tenant_scope"
  | "unknown_incident_reference"
  | "unprojectable_record"
  | "quota_outside_tenant";

export interface CommandCentreDefect {
  readonly reason: CommandCentreDefectReason;
  /** The declared id (or caller-supplied label) of the defective record. */
  readonly ref: string;
  readonly detail: string;
}

/* ─────────────────────────────────────────────────────────────
 * Open-alert projection
 * ────────────────────────────────────────────────────────────*/

/**
 * An open alert as the operator sees it: what happened, how severe, who is
 * affected, when it was first observed and when the system last observed it.
 * Subject refs are the alert's declared impacted scope — the projection
 * renames nothing, it exposes the declared references verbatim.
 */
export interface OpenAlertProjection {
  readonly alertId: string;
  readonly tenantId: string;
  readonly source: CommandAlertSource;
  readonly severity: CommandAlertSeverity;
  readonly status: CommandAlertStatus;
  readonly summary: string;
  /** Declared subject references (the alert's impacted scope). */
  readonly subjectRefs: readonly string[];
  /** VALID time — when the alert was first observed (the record's createdAt). */
  readonly firstObservedAt: string;
  /** RECORD time — last observation of the alert (acknowledgement, else first). */
  readonly lastObservedAt: string;
  /** The declared incident this alert is correlated under, when declared. */
  readonly incidentId: string | null;
}

const OPEN_ALERT_STATUSES: readonly CommandAlertStatus[] = ["OPEN", "ACKNOWLEDGED", "ESCALATED"];

/** Severity rank reuses the alert vocabulary's own declared order — no local scale. */
function severityRank(severity: CommandAlertSeverity): number {
  return COMMAND_ALERT_SEVERITIES.indexOf(severity);
}

/* ─────────────────────────────────────────────────────────────
 * Incident projection
 * ────────────────────────────────────────────────────────────*/

/**
 * An incident with its declared alert grouping and lifecycle state. The
 * lifecycle state is the incident record's OWN state (the projection never
 * advances a lifecycle); `closed` marks the RESOLVED/CLOSED states of the
 * incident state machine, `open` everything before them.
 */
export interface IncidentProjection {
  readonly incidentId: string;
  readonly tenantId: string;
  readonly kind: IncidentKind;
  readonly lifecycleState: IncidentState;
  readonly open: boolean;
  readonly closed: boolean;
  readonly severity: string;
  /** Alerts grouped under this incident by the DECLARED correlation link. */
  readonly alertIds: readonly string[];
  /** Highest severity among the grouped open alerts, when any are grouped. */
  readonly highestAlertSeverity: CommandAlertSeverity | null;
  readonly evidenceRefs: readonly string[];
  readonly detectedAt: string;
  readonly resolvedAt: string | null;
  readonly decisionCount: number;
}

const CLOSED_INCIDENT_STATES: readonly IncidentState[] = ["RESOLVED", "CLOSED"];

/* ─────────────────────────────────────────────────────────────
 * Observation closure (E-018 — the loop closes and stays closed)
 * ────────────────────────────────────────────────────────────*/

/**
 * The observation-closure contract for one incident. The loop's Outcome ->
 * Observation tail closes when:
 * - the OUTCOME is recorded — the incident reached a closed lifecycle state
 *   with a resolved-at instant;
 * - the OBSERVATION is recorded — at least one human decision record re-enters
 *   the loop citing the incident (decided after the incident was detected);
 * - the closure is EVIDENCE-BEARING — at least one evidence reference is
 *   carried by the incident's evidence or the closing decisions.
 *
 * E-018 rule: a loop that re-enters the projection sees closed loops as
 * closed. Purity guarantees it — the closure is a deterministic function of
 * the declared substrate, never of arrival order or of projection count.
 */
export interface ObservationClosure {
  readonly incidentId: string;
  readonly tenantId: string;
  readonly outcomeRecorded: boolean;
  readonly observationRecorded: boolean;
  readonly evidenceBearing: boolean;
  /** True when the loop is closed: outcome + observation + evidence. */
  readonly closed: boolean;
  readonly closedAt: string | null;
  /** Every evidence reference the closure carries (incident + closing decisions). */
  readonly evidenceRefs: readonly string[];
}

function incidentEvidenceRefs(incident: Incident): string[] {
  return incident.evidence.map((entry) => entry.reference).filter((ref) => isNonBlankRef(ref, 500));
}

/* ─────────────────────────────────────────────────────────────
 * Delta projection (what changed since the observation cursor)
 * ────────────────────────────────────────────────────────────*/

export interface CommandCentreDelta {
  /** The cursor the delta was computed against (null = full first projection). */
  readonly cursor: ObservationCursor | null;
  readonly newAlertIds: readonly string[];
  /** Alerts already known at the cursor but observed again since. */
  readonly updatedAlertIds: readonly string[];
  readonly newIncidentIds: readonly string[];
  /** Incidents that reached a resolved-at instant after the cursor. */
  readonly incidentsClosedSince: readonly string[];
  readonly newDecisionIds: readonly string[];
}

const EMPTY_DELTA: CommandCentreDelta = {
  cursor: null,
  newAlertIds: Object.freeze([]),
  updatedAlertIds: Object.freeze([]),
  newIncidentIds: Object.freeze([]),
  incidentsClosedSince: Object.freeze([]),
  newDecisionIds: Object.freeze([]),
};

/* ─────────────────────────────────────────────────────────────
 * The projection
 * ────────────────────────────────────────────────────────────*/

export interface CommandCentreInput {
  /** THE tenant this projection is scoped to — resolved server-side. */
  readonly tenantId: string;
  readonly alerts: readonly CommandAlert[];
  readonly incidents: readonly Incident[];
  /** The append-only decision ledger, projected in ledger order. */
  readonly decisions?: readonly IncidentDecisionRecord[];
  /** The operator's declared observation cursor, when projecting a delta. */
  readonly cursor?: ObservationCursor | null;
  /** Optional quota evidence to surface (display-only, AGENTS §20). */
  readonly quotaEvidence?: { readonly rollUp: CostRollUp; readonly quota: TenantQuota } | null;
}

export interface CommandCentreProjection {
  readonly tenantId: string;
  readonly generatedFrom: "command-alerts + command-incidents + incident-decision-ledger";
  /** Open alerts, severity-descending then oldest-first. */
  readonly openAlerts: readonly OpenAlertProjection[];
  readonly incidents: readonly IncidentProjection[];
  /** Tenant-scoped decision records in ledger (append) order. */
  readonly decisions: readonly IncidentDecisionRecord[];
  readonly closures: readonly ObservationClosure[];
  readonly delta: CommandCentreDelta;
  /** Records that could not be projected cleanly — surfaced, never absorbed. */
  readonly defects: readonly CommandCentreDefect[];
  /** Foreign-tenant records excluded (count only — references never leaked). */
  readonly excludedForeignTenantCount: number;
  readonly quotaEvidence: QuotaEvaluation | null;
}

/**
 * Project the command centre's operational view for ONE tenant over the
 * declared alert, incident and decision substrates. Pure and read-only: the
 * inputs are never modified and every returned structure is frozen.
 *
 * Tenant scoping is total (a projection without tenant scope is a defect):
 * scope-less records are excluded as `missing_tenant_scope` defects, foreign
 * records are excluded and counted without leaking their references, and an
 * observation cursor scoped to another tenant fails closed.
 */
export function projectCommandCentre(input: CommandCentreInput): CommandCentreProjection {
  const tenantId = input.tenantId;
  if (!isNonBlankRef(tenantId, 128)) {
    throw new CommandCentreAppendError("tenantId", "the projection tenant scope must be 1–128 characters");
  }
  const decisions = input.decisions ?? [];
  const defects: CommandCentreDefect[] = [];

  // ── Tenant scope partition (Constitution §13) ──
  let excludedForeignTenantCount = 0;
  const inScopeAlerts: CommandAlert[] = [];
  for (const alert of input.alerts) {
    const alertTenant = typeof alert.tenantId === "string" ? alert.tenantId.trim() : "";
    if (alertTenant === "") {
      defects.push({
        reason: "missing_tenant_scope",
        ref: alert.alertId,
        detail: `alert "${alert.alertId}" declares no tenant scope — a projection without tenant scope is a defect; excluded`,
      });
      continue;
    }
    if (alertTenant !== tenantId) {
      excludedForeignTenantCount += 1;
      continue;
    }
    inScopeAlerts.push(alert);
  }

  const inScopeIncidents: Incident[] = [];
  for (const incident of input.incidents) {
    const incidentTenant = typeof incident.tenantId === "string" ? incident.tenantId.trim() : "";
    if (incidentTenant === "") {
      defects.push({
        reason: "missing_tenant_scope",
        ref: incident.incidentId,
        detail: `incident "${incident.incidentId}" declares no tenant scope — a projection without tenant scope is a defect; excluded`,
      });
      continue;
    }
    if (incidentTenant !== tenantId) {
      excludedForeignTenantCount += 1;
      continue;
    }
    inScopeIncidents.push(incident);
  }

  const inScopeDecisions: IncidentDecisionRecord[] = [];
  for (const decision of decisions) {
    const decisionTenant = typeof decision.tenantId === "string" ? decision.tenantId.trim() : "";
    if (decisionTenant === "") {
      defects.push({
        reason: "missing_tenant_scope",
        ref: decision.decisionId,
        detail: `decision "${decision.decisionId}" declares no tenant scope — a projection without tenant scope is a defect; excluded`,
      });
      continue;
    }
    if (decisionTenant !== tenantId) {
      excludedForeignTenantCount += 1;
      continue;
    }
    inScopeDecisions.push(decision);
  }

  // ── Open alerts ──
  const openAlerts: OpenAlertProjection[] = inScopeAlerts
    .filter((alert) => OPEN_ALERT_STATUSES.includes(alert.status))
    .map((alert) => ({
      alertId: alert.alertId,
      tenantId: alert.tenantId,
      source: alert.source,
      severity: alert.severity,
      status: alert.status,
      summary: alert.summary,
      subjectRefs: Object.freeze([...alert.impactedScope]),
      firstObservedAt: alert.createdAt,
      lastObservedAt: alert.acknowledgedAt ?? alert.createdAt,
      incidentId: alert.correlationGroup,
    }))
    .sort((a, b) => {
      const severityDelta = severityRank(b.severity) - severityRank(a.severity);
      if (severityDelta !== 0) return severityDelta;
      return a.firstObservedAt < b.firstObservedAt ? -1 : a.firstObservedAt > b.firstObservedAt ? 1 : 0;
    });

  // ── Declared alert → incident grouping ──
  const incidentIds = new Set(inScopeIncidents.map((incident) => incident.incidentId));
  const alertsByIncident = new Map<string, CommandAlert[]>();
  for (const alert of inScopeAlerts) {
    if (alert.correlationGroup == null || alert.correlationGroup.trim() === "") continue;
    if (!incidentIds.has(alert.correlationGroup)) {
      defects.push({
        reason: "unknown_incident_reference",
        ref: alert.alertId,
        detail: `alert "${alert.alertId}" correlates to incident "${alert.correlationGroup}" which is not a declared incident in scope — surfaced, never silently dropped`,
      });
      continue;
    }
    const grouped = alertsByIncident.get(alert.correlationGroup) ?? [];
    grouped.push(alert);
    alertsByIncident.set(alert.correlationGroup, grouped);
  }

  // ── Incidents + observation closures (E-018) ──
  const decisionsByIncident = new Map<string, IncidentDecisionRecord[]>();
  for (const decision of inScopeDecisions) {
    const grouped = decisionsByIncident.get(decision.incidentId) ?? [];
    grouped.push(decision);
    decisionsByIncident.set(decision.incidentId, grouped);
  }

  const incidents: IncidentProjection[] = [];
  const closures: ObservationClosure[] = [];
  for (const incident of inScopeIncidents) {
    const grouped = alertsByIncident.get(incident.incidentId) ?? [];
    const incidentDecisions = decisionsByIncident.get(incident.incidentId) ?? [];
    const highestAlertSeverity =
      grouped.length === 0
        ? null
        : grouped.reduce<CommandAlertSeverity>(
            (highest, alert) =>
              severityRank(alert.severity) > severityRank(highest) ? alert.severity : highest,
            grouped[0].severity,
          );
    const resolvedAt = incident.resolvedAt;
    const evidenceRefs = [
      ...incidentEvidenceRefs(incident),
      ...incidentDecisions.flatMap((decision) => decision.evidenceRefs),
    ];
    incidents.push({
      incidentId: incident.incidentId,
      tenantId: incident.tenantId,
      kind: incident.kind,
      lifecycleState: incident.state,
      open: !CLOSED_INCIDENT_STATES.includes(incident.state),
      closed: CLOSED_INCIDENT_STATES.includes(incident.state),
      severity: incident.severity,
      alertIds: Object.freeze(grouped.map((alert) => alert.alertId)),
      highestAlertSeverity,
      evidenceRefs: Object.freeze(incidentEvidenceRefs(incident)),
      detectedAt: incident.detectedAt,
      resolvedAt,
      decisionCount: incidentDecisions.length,
    });

    const outcomeRecorded =
      CLOSED_INCIDENT_STATES.includes(incident.state) && resolvedAt != null && isIsoInstant(resolvedAt);
    const observationRecorded = incidentDecisions.some(
      (decision) => Date.parse(decision.decidedAt) >= Date.parse(incident.detectedAt),
    );
    const evidenceBearing = evidenceRefs.length > 0;
    closures.push({
      incidentId: incident.incidentId,
      tenantId: incident.tenantId,
      outcomeRecorded,
      observationRecorded,
      evidenceBearing,
      closed: outcomeRecorded && observationRecorded && evidenceBearing,
      closedAt: outcomeRecorded && observationRecorded && evidenceBearing ? resolvedAt : null,
      evidenceRefs: Object.freeze(evidenceRefs),
    });
  }

  // ── Delta since the declared observation cursor ──
  let delta: CommandCentreDelta = EMPTY_DELTA;
  if (input.cursor != null) {
    const cursor = input.cursor;
    if (!isNonBlankRef(cursor.tenantId, 128) || cursor.tenantId.trim() !== tenantId) {
      throw new CommandCentreAppendError(
        "cursor.tenantId",
        `cursor is scoped to "${cursor.tenantId}" but the projection is scoped to "${tenantId}" — an observation cursor never crosses a tenant boundary (fail closed)`,
      );
    }
    if (!isIsoInstant(cursor.sinceAt)) {
      throw new CommandCentreAppendError("cursor.sinceAt", "must be a valid ISO-8601 timestamp");
    }
    const sinceMs = Date.parse(cursor.sinceAt);
    const inWindow = (instant: string | null): boolean =>
      instant != null && isIsoInstant(instant) && Date.parse(instant) > sinceMs;
    const newAlertIds = openAlerts
      .filter((alert) => inWindow(alert.firstObservedAt))
      .map((alert) => alert.alertId);
    const updatedAlertIds = openAlerts
      .filter((alert) => !newAlertIds.includes(alert.alertId) && inWindow(alert.lastObservedAt))
      .map((alert) => alert.alertId);
    const newIncidentIds = incidents
      .filter((incident) => inWindow(incident.detectedAt))
      .map((incident) => incident.incidentId);
    const incidentsClosedSince = incidents
      .filter((incident) => incident.closed && inWindow(incident.resolvedAt))
      .map((incident) => incident.incidentId);
    const newDecisionIds = inScopeDecisions
      .filter((decision) => inWindow(decision.decidedAt))
      .map((decision) => decision.decisionId);
    delta = {
      cursor,
      newAlertIds: Object.freeze(newAlertIds),
      updatedAlertIds: Object.freeze(updatedAlertIds),
      newIncidentIds: Object.freeze(newIncidentIds),
      incidentsClosedSince: Object.freeze(incidentsClosedSince),
      newDecisionIds: Object.freeze(newDecisionIds),
    };
  }

  // ── Quota evidence (surfaced, never owned) ──
  let quotaEvidence: QuotaEvaluation | null = null;
  if (input.quotaEvidence != null) {
    const { rollUp, quota } = input.quotaEvidence;
    if (quota.tenantRef.trim() !== tenantId) {
      defects.push({
        reason: "quota_outside_tenant",
        ref: quota.tenantRef,
        detail: `quota evidence for tenant "${quota.tenantRef}" cannot be surfaced in a projection scoped to "${tenantId}"`,
      });
    } else {
      quotaEvidence = evaluateTenantQuota(rollUp, quota);
    }
  }

  // ── Lifecycle order: decisions over unknown incidents are surfaced ──
  for (const decision of inScopeDecisions) {
    if (!incidentIds.has(decision.incidentId)) {
      defects.push({
        reason: "unknown_incident_reference",
        ref: decision.decisionId,
        detail: `decision "${decision.decisionId}" cites incident "${decision.incidentId}" which is not a declared incident in scope`,
      });
    }
  }

  return {
    tenantId,
    generatedFrom: "command-alerts + command-incidents + incident-decision-ledger",
    openAlerts: Object.freeze(openAlerts),
    incidents: Object.freeze(incidents),
    decisions: Object.freeze(inScopeDecisions),
    closures: Object.freeze(closures),
    delta,
    defects: Object.freeze(defects),
    excludedForeignTenantCount,
    quotaEvidence,
  };
}
