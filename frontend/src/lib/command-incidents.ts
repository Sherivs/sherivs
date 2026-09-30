/**
 * CoreGrid — Institutional Command Centre incident and decision
 * domain model
 * (Phase 19, Sections AL, AM, AN, AO, AP, AQ, AR, AS, AT, AU, AV, AW, AX,
 * AY, AZ, BA, BB, BC, BD, BE, BF, BG, CF, CG, CH, CI, CJ, CK, CL, CM, CN,
 * CO, CP, CQ, CR, CS, CT, CU, CV, CW, CX, CY).
 *
 * Implements `architecture/phase-19-command-centre.md`:
 * - Incident centre (AL): infrastructure failure, security incident,
 *   academic/payment/scheduling/communication disruption, hardware/
 *   automation failure, operational emergency.
 * - Incident lifecycle (AM), command (AN: commander/responders/
 *   stakeholders/severity/scope/timeline/actions/decisions/evidence),
 *   timeline (AO), evidence (AP — evidence remains owned by originating
 *   systems), notes (AQ), collaboration (AR), escalation (AS) and
 *   postmortem (AT).
 * - Decision centre (AU-AY): decision cards show question, context,
 *   evidence, options, risks, recommendation, uncertainty, deadline,
 *   owner; approvals record decision/actor/timestamp/evidence version/
 *   selected option/comments; the Command Centre coordinates but does not
 *   redefine Phase 18 analytical evidence (AX).
 * - Action centre (BA-BE): approved actions awaiting authorization/
 *   execution/confirmation/review; automation supervision; execution
 *   requests pass through Phase 17 (BC); kill-switch visibility is
 *   presentation only (BD).
 * - Command workflows (BF, BG): Phase 19 coordinates, Phase 17 executes.
 * - Situation objects (CF, CG, CH): a situation combines alerts,
 *   incidents, metrics, events, decisions, resources and people; it is a
 *   coordination abstraction, never a new source of truth; situation
 *   severity coexists with source severities.
 * - Annotations (CI, CJ): author, timestamp, target, content, version.
 * - Timelines (CK, CL) and calendar (CM); notifications (CN) requested
 *   and coordinated — delivery remains Phase 10 (CO).
 * - Presence (CP) and operator handoff (CQ, CR): previous/new owner,
 *   time, reason.
 * - Escalation matrix (CS, CT): policies externally governed and
 *   versioned.
 * - Approvals (CU): four-eyes control (CV) and segregation of duties
 *   (CW): the proposer cannot be the approver where policy prohibits.
 * - Emergency mode (CX) and audit (CY): increased visibility without
 *   bypassing security policy unless governed; enhanced audit.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Incident model (AL, AM, AN, AQ, AT)
 * ────────────────────────────────────────────────────────────*/

export type IncidentKind =
  | "infrastructure_failure"
  | "security_incident"
  | "academic_disruption"
  | "payment_disruption"
  | "scheduling_conflict"
  | "communication_outage"
  | "hardware_failure"
  | "automation_failure"
  | "operational_emergency";

export const INCIDENT_KINDS: readonly IncidentKind[] = [
  "infrastructure_failure",
  "security_incident",
  "academic_disruption",
  "payment_disruption",
  "scheduling_conflict",
  "communication_outage",
  "hardware_failure",
  "automation_failure",
  "operational_emergency",
] as const;

export type IncidentState =
  "DETECTED" | "ASSESSED" | "RESPONDING" | "MITIGATED" | "RESOLVED" | "CLOSED";

export const INCIDENT_STATES: readonly IncidentState[] = [
  "DETECTED",
  "ASSESSED",
  "RESPONDING",
  "MITIGATED",
  "RESOLVED",
  "CLOSED",
] as const;

const INCIDENT_TRANSITIONS: Readonly<Record<IncidentState, readonly IncidentState[]>> = {
  DETECTED: ["ASSESSED", "RESOLVED", "CLOSED"],
  ASSESSED: ["RESPONDING", "RESOLVED", "CLOSED"],
  RESPONDING: ["MITIGATED", "RESOLVED"],
  MITIGATED: ["RESOLVED", "RESPONDING"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export function isIncidentTransitionAllowed(from: IncidentState, to: IncidentState): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

export interface Incident {
  incidentId: string;
  tenantId: TenantId;
  kind: IncidentKind;
  state: IncidentState;
  severity: string;
  commander: string | null;
  responders: string[];
  scope: string[];
  detectedAt: string;
  resolvedAt: string | null;
  notes: Array<{ noteId: string; author: string; at: string; content: string }>;
  evidence: Array<{ evidenceId: string; source: string; reference: string }>;
}

export interface CreateIncidentInput {
  incidentId: string;
  tenantId: TenantId;
  kind: IncidentKind;
  severity: string;
  scope: string[];
  detectedAt: string;
}

export type CreateIncidentResult = { ok: true; incident: Incident } | { ok: false; error: string };

export function createIncident(input: CreateIncidentInput): CreateIncidentResult {
  if (input.incidentId.trim() === "") {
    return { ok: false, error: "Incident requires an ID (AL)" };
  }
  if (input.scope.length === 0) {
    return { ok: false, error: "Incident requires a scope (AL)" };
  }
  return {
    ok: true,
    incident: {
      incidentId: input.incidentId,
      tenantId: input.tenantId,
      kind: input.kind,
      state: "DETECTED",
      severity: input.severity,
      commander: null,
      responders: [],
      scope: input.scope,
      detectedAt: input.detectedAt,
      resolvedAt: null,
      notes: [],
      evidence: [],
    },
  };
}

export function assignIncidentCommander(incident: Incident, commander: string): Incident {
  return { ...incident, commander };
}

export function addIncidentResponder(incident: Incident, responder: string): Incident {
  return incident.responders.includes(responder)
    ? incident
    : { ...incident, responders: [...incident.responders, responder] };
}

export function addIncidentNote(
  incident: Incident,
  noteId: string,
  author: string,
  at: string,
  content: string,
): Incident {
  return { ...incident, notes: [...incident.notes, { noteId, author, at, content }] };
}

export function addIncidentEvidence(
  incident: Incident,
  evidenceId: string,
  source: string,
  reference: string,
): Incident {
  return { ...incident, evidence: [...incident.evidence, { evidenceId, source, reference }] };
}

export interface IncidentPostmortem {
  incidentId: string;
  timeline: string[];
  rootCause: string | null;
  contributingFactors: string[];
  impact: string;
  recovery: string;
  lessons: string[];
  correctiveActions: string[];
}

export function createPostmortem(
  input: Omit<IncidentPostmortem, "rootCause"> & { rootCause?: string | null },
): IncidentPostmortem {
  return { ...input, rootCause: input.rootCause ?? null };
}

/* ─────────────────────────────────────────────────────────────
 * Decision centre (AU, AV, AW, AX, AY)
 * ────────────────────────────────────────────────────────────*/

export type CommandDecisionState =
  "PENDING" | "APPROVED" | "REJECTED" | "DEFERRED" | "ESCALATED" | "EXPIRED";

export const COMMAND_DECISION_STATES: readonly CommandDecisionState[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "DEFERRED",
  "ESCALATED",
  "EXPIRED",
] as const;

export interface CommandDecision {
  decisionId: string;
  tenantId: TenantId;
  question: string;
  context: string;
  evidenceRefs: string[];
  options: string[];
  risks: string[];
  recommendation: string | null;
  uncertainty: string | null;
  deadline: string | null;
  owner: string;
  state: CommandDecisionState;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface CreateCommandDecisionInput {
  decisionId: string;
  tenantId: TenantId;
  question: string;
  context: string;
  evidenceRefs: string[];
  options: string[];
  risks: string[];
  recommendation?: string | null;
  uncertainty?: string | null;
  deadline?: string | null;
  owner: string;
}

export type CreateCommandDecisionResult =
  { ok: true; decision: CommandDecision } | { ok: false; error: string };

/**
 * Decision card (AV): a decision shows question, context, evidence,
 * options, risks, recommendation, uncertainty, deadline and owner. The
 * Command Centre coordinates decisions but does not redefine Phase 18
 * analytical evidence (AX).
 */
export function createCommandDecision(
  input: CreateCommandDecisionInput,
): CreateCommandDecisionResult {
  if (input.question.trim() === "" || input.owner.trim() === "") {
    return { ok: false, error: "Decision requires a question and owner (AV)" };
  }
  if (input.options.length < 2) {
    return { ok: false, error: "Decision requires at least two options (AV)" };
  }
  return {
    ok: true,
    decision: {
      decisionId: input.decisionId,
      tenantId: input.tenantId,
      question: input.question,
      context: input.context,
      evidenceRefs: input.evidenceRefs,
      options: input.options,
      risks: input.risks,
      recommendation: input.recommendation ?? null,
      uncertainty: input.uncertainty ?? null,
      deadline: input.deadline ?? null,
      owner: input.owner,
      state: "PENDING",
      decidedBy: null,
      decidedAt: null,
    },
  };
}

export function decideCommandDecision(
  decision: CommandDecision,
  outcome: CommandDecisionState,
  actor: string,
  at: string,
): CommandDecision {
  return { ...decision, state: outcome, decidedBy: actor, decidedAt: at };
}

export function isCommandDecisionExpired(decision: CommandDecision, now: string): boolean {
  return decision.deadline !== null && now > decision.deadline;
}

/* ─────────────────────────────────────────────────────────────
 * Action centre and automation supervision (BA, BB, BC, BD)
 * ────────────────────────────────────────────────────────────*/

export type CommandActionState =
  | "AWAITING_AUTHORIZATION"
  | "AWAITING_EXECUTION"
  | "EXECUTING"
  | "SUCCEEDED"
  | "FAILED"
  | "UNKNOWN"
  | "REJECTED"
  | "CANCELLED";

export const COMMAND_ACTION_STATES: readonly CommandActionState[] = [
  "AWAITING_AUTHORIZATION",
  "AWAITING_EXECUTION",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
  "REJECTED",
  "CANCELLED",
] as const;

export interface CommandAction {
  actionId: string;
  tenantId: TenantId;
  requestedBy: string;
  approvedBy: string | null;
  state: CommandActionState;
  idempotencyKey: string;
  executionStateRef: string | null;
}

/**
 * Action contract (EI, EJ, EL): every action request carries an
 * idempotency key; UNKNOWN execution state is never displayed as success.
 */
export function isCommandActionSuccess(action: CommandAction): boolean {
  return action.state === "SUCCEEDED";
}

export function isCommandActionStateUnknown(action: CommandAction): boolean {
  return action.state === "UNKNOWN";
}

/* ─────────────────────────────────────────────────────────────
 * Situations (CF, CG, CH) and annotations (CI, CJ)
 * ────────────────────────────────────────────────────────────*/

export type SituationSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const SITUATION_SEVERITIES: readonly SituationSeverity[] = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export type SituationState = "OPEN" | "COORDINATING" | "MONITORING" | "CLOSED";

export const SITUATION_STATES: readonly SituationState[] = [
  "OPEN",
  "COORDINATING",
  "MONITORING",
  "CLOSED",
] as const;

export interface Situation {
  situationId: string;
  tenantId: TenantId;
  state: SituationState;
  severity: SituationSeverity;
  alertIds: string[];
  incidentIds: string[];
  decisionIds: string[];
  metricRefs: string[];
  resourceIds: string[];
  personIds: string[];
}

export function createSituation(
  situationId: string,
  tenantId: TenantId,
  severity: SituationSeverity,
  refs: Partial<Omit<Situation, "situationId" | "tenantId" | "state" | "severity">> = {},
): Situation {
  return {
    situationId,
    tenantId,
    state: "OPEN",
    severity,
    alertIds: refs.alertIds ?? [],
    incidentIds: refs.incidentIds ?? [],
    decisionIds: refs.decisionIds ?? [],
    metricRefs: refs.metricRefs ?? [],
    resourceIds: refs.resourceIds ?? [],
    personIds: refs.personIds ?? [],
  };
}

export function addToSituation(
  situation: Situation,
  field: "alertIds" | "incidentIds" | "decisionIds",
  id: string,
): Situation {
  return {
    ...situation,
    [field]: situation[field].includes(id) ? situation[field] : [...situation[field], id],
  };
}

export interface CommandAnnotation {
  annotationId: string;
  author: string;
  at: string;
  target: string;
  content: string;
  version: number;
}

export function createCommandAnnotation(
  input: Omit<CommandAnnotation, "annotationId">,
): CommandAnnotation {
  return {
    ...input,
    annotationId: `ann-${input.target}-${input.at}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Presence and operator handoff (CP, CQ, CR)
 * ────────────────────────────────────────────────────────────*/

export interface OperatorHandoff {
  handoffId: string;
  previousOwner: string;
  newOwner: string;
  at: string;
  reason: string;
  scopeRef: string;
}

export function createOperatorHandoff(input: Omit<OperatorHandoff, "handoffId">): OperatorHandoff {
  return {
    ...input,
    handoffId: `handoff-${input.scopeRef}-${input.at}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Escalation matrix (CS, CT)
 * ────────────────────────────────────────────────────────────*/

export interface EscalationMatrixEntry {
  matrixId: string;
  severity: string;
  domain: string;
  targetRole: string;
  afterMinutes: number;
  policyVersion: number;
}

/** Escalation policies must be externally governed and versioned (CT). */
export function isEscalationMatrixPolicyCurrent(
  entry: EscalationMatrixEntry,
  currentVersion: number,
): boolean {
  return entry.policyVersion === currentVersion;
}

/* ─────────────────────────────────────────────────────────────
 * Approvals, four-eyes and segregation of duties (CU, CV, CW)
 * ────────────────────────────────────────────────────────────*/

export type ApprovalDecision =
  "approve" | "reject" | "defer" | "request_more_evidence" | "escalate";

export interface CommandApproval {
  approvalId: string;
  actionId: string;
  requestedBy: string;
  requiredApprovers: number;
  approvals: Array<{ approver: string; decision: ApprovalDecision; at: string }>;
}

/**
 * Four-eyes control (CV) and segregation of duties (CW): sensitive
 * actions require a minimum number of distinct approvers, and the
 * proposer cannot approve where policy prohibits.
 */
export function evaluateCommandApproval(input: {
  approval: CommandApproval;
  segregationOfDuties: boolean;
}): { approved: boolean; reason: string } {
  const distinct = new Set(input.approval.approvals.map((a) => a.approver));
  if (input.approval.approvals.some((a) => a.decision !== "approve")) {
    return { approved: false, reason: "Not all approvers approved (CU)" };
  }
  if (
    input.segregationOfDuties &&
    input.approval.approvals.some((a) => a.approver === input.approval.requestedBy)
  ) {
    return { approved: false, reason: "Proposer cannot approve — segregation of duties (CW)" };
  }
  if (distinct.size < input.approval.requiredApprovers) {
    return {
      approved: false,
      reason: `Requires ${input.approval.requiredApprovers} distinct approvers (CV)`,
    };
  }
  return { approved: true, reason: "Approval requirements satisfied (CV, CW)" };
}

/* ─────────────────────────────────────────────────────────────
 * Emergency mode (CX, CY)
 * ────────────────────────────────────────────────────────────*/

export interface EmergencyModeState {
  active: boolean;
  activatedBy: string | null;
  activatedAt: string | null;
  scope: string | null;
  justified: boolean;
}

/**
 * Emergency mode (CX, CY): increases visibility and highlights response
 * paths without bypassing security policies unless an explicitly governed
 * emergency policy permits it; every emergency action receives enhanced
 * audit treatment.
 */
export function activateEmergencyMode(input: {
  activatedBy: string;
  at: string;
  scope: string;
  justification: string;
  policyAllows: boolean;
}): { ok: true; state: EmergencyModeState } | { ok: false; error: string } {
  if (input.justification.trim() === "") {
    return { ok: false, error: "Emergency mode requires a justification (CX)" };
  }
  if (!input.policyAllows) {
    return { ok: false, error: "Emergency mode not permitted by current policy (CX)" };
  }
  return {
    ok: true,
    state: {
      active: true,
      activatedBy: input.activatedBy,
      activatedAt: input.at,
      scope: input.scope,
      justified: true,
    },
  };
}

export function deactivateEmergencyMode(state: EmergencyModeState): EmergencyModeState {
  return { ...state, active: false };
}
