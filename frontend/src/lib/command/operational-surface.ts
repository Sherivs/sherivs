/**
 * CoreGrid — governed command centre operational surface contract
 * (J-048: rebuild of the withdrawn L4 alerts/incidents operational surface).
 *
 * The L4 surface was withdrawn because the existing command modules coordinate
 * presentation but leave the operating rules implicit: acknowledgement mutates
 * without an authorization decision, resolution has no declared capability,
 * and AI output has no governed path into the operating state machine.
 * This module contracts that surface BEFORE any persistence or UI owns it.
 *
 * Law of this module (Constitution §16, §21, §27):
 * - Every operational entity (alert, incident) carries classification,
 *   severity, tenant scope, a policy version and an immutable history.
 * - Every state transition is an authorization decision: Identity + Tenant +
 *   Capability + Resource + Transition = ALLOW | DENY. Denials are audited
 *   with the same provenance discipline as allowances — a refused action
 *   leaves a record, never silence.
 * - Provenance on every transition: actor identity, actor kind, actor tenant,
 *   the capability set presented at decision time, caller-supplied time,
 *   reason and the policy version in force. History is append-only.
 * - Fail-closed resolution: an alert or incident can only be closed by an
 *   identity holding the declared resolve capability. Missing capability,
 *   missing tenant scope or an unknown transition closes nothing.
 * - AI-proposed actions (§21) are untrusted by default: a proposal is routed
 *   through the approval vocabulary (REQUIRE_APPROVAL) at creation, can only
 *   be resolved by a HUMAN identity holding action:approve (agents can never
 *   approve, the proposer can never approve itself), and can only execute
 *   after approval, by an identity holding the subject-matching capability.
 *   There is no path from PROPOSED to EXECUTED. AI never auto-executes.
 *
 * Persistence stays out: this is a pure state machine + contracts. Time is
 * supplied by the caller, nothing runs implicitly, nothing is persisted.
 * The durability adapter mission will implement the store behind these
 * contracts without changing them.
 */

import type { DataClassification, TenantId } from "../tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Severity vocabulary
 * ────────────────────────────────────────────────────────────*/

export type OperationalSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const OPERATIONAL_SEVERITIES: readonly OperationalSeverity[] = [
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export function severityRank(severity: OperationalSeverity): number {
  return OPERATIONAL_SEVERITIES.indexOf(severity);
}

/* ─────────────────────────────────────────────────────────────
 * Identity and declared capabilities
 * ────────────────────────────────────────────────────────────*/

/**
 * Declared capabilities on the operational surface. Possession of a
 * capability is decided by the authorization layer, never by the client;
 * this contract only ever evaluates the set presented to it.
 */
export type OperationalCapability =
  | "alert:acknowledge"
  | "alert:escalate"
  | "alert:resolve"
  | "incident:acknowledge"
  | "incident:escalate"
  | "incident:mitigate"
  | "incident:resolve"
  | "action:approve";

export const OPERATIONAL_CAPABILITIES: readonly OperationalCapability[] = [
  "alert:acknowledge",
  "alert:escalate",
  "alert:resolve",
  "incident:acknowledge",
  "incident:escalate",
  "incident:mitigate",
  "incident:resolve",
  "action:approve",
] as const;

export type OperationalIdentityKind = "human" | "agent";

export interface OperationalIdentity {
  identityId: string;
  identityKind: OperationalIdentityKind;
  tenantId: TenantId;
  capabilities: readonly OperationalCapability[];
}

export function holdsCapability(
  identity: OperationalIdentity,
  capability: OperationalCapability,
): boolean {
  return identity.capabilities.includes(capability);
}

/* ─────────────────────────────────────────────────────────────
 * Provenance and audit events
 * ────────────────────────────────────────────────────────────*/

export type OperationalSubjectType = "alert" | "incident" | "ai_action";

/** §16 decision vocabulary, restricted to what this surface can decide. */
export type OperationalAuditDecision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export type OperationalDenialReason =
  | "invalid_input"
  | "tenant_mismatch"
  | "invalid_transition"
  | "capability_missing"
  | "agent_identity_cannot_approve"
  | "proposer_cannot_approve";

export interface TransitionProvenance {
  actorId: string;
  actorKind: OperationalIdentityKind;
  actorTenantId: TenantId;
  /** The capability set the actor presented at decision time. */
  presentedCapabilities: readonly OperationalCapability[];
  /** Caller-supplied time — this module owns no clock. */
  at: string;
  reason: string | null;
  /** Version of the operating policy in force for this decision. */
  policyVersion: string;
}

export interface OperationalAuditEvent {
  eventId: string;
  subjectType: OperationalSubjectType;
  subjectId: string;
  tenantId: TenantId;
  /** Named verb, e.g. "transition:ACKNOWLEDGED" or "ai:execute". */
  action: string;
  decision: OperationalAuditDecision;
  /** Denial reason on DENY; free-form note otherwise. */
  reason: string | null;
  provenance: TransitionProvenance;
}

/**
 * True when every recorded event carries complete provenance. The durability
 * adapter and conformance checks consume this invariant; the state machine
 * maintains it by construction.
 */
export function hasProvenanceForEveryTransition(entity: {
  history: readonly OperationalAuditEvent[];
}): boolean {
  return entity.history.every(
    (event) =>
      event.provenance.actorId.trim().length > 0 &&
      event.provenance.at.trim().length > 0 &&
      event.provenance.policyVersion.trim().length > 0,
  );
}

/* ─────────────────────────────────────────────────────────────
 * Shared transition engine (pure, tenant-scoped, fail-closed)
 * ────────────────────────────────────────────────────────────*/

export interface TransitionEdge<S extends string> {
  to: S;
  capability: OperationalCapability;
}

export type TransitionTable<S extends string> = Readonly<Record<S, readonly TransitionEdge<S>[]>>;

export interface TransitionableEntity<S extends string> {
  tenantId: TenantId;
  state: S;
  policyVersion: string;
  history: readonly OperationalAuditEvent[];
}

export interface OperationalDecision<S extends string> {
  decision: "ALLOW" | "DENY";
  to: S;
  /** Capability the ALLOWED transition requires; null when denied earlier. */
  requiredCapability: OperationalCapability | null;
  reason: OperationalDenialReason | null;
}

/** Evaluate a transition against a table without evaluating the actor. */
export function evaluateTransition<S extends string>(
  table: TransitionTable<S>,
  from: S,
  to: S,
): OperationalDecision<S> {
  const edges = table[from];
  const edge = edges.find((candidate) => candidate.to === to);
  if (edge === undefined) {
    return { decision: "DENY", to, requiredCapability: null, reason: "invalid_transition" };
  }
  return { decision: "ALLOW", to, requiredCapability: edge.capability, reason: null };
}

interface TransitionAllow<S extends string> {
  ok: true;
  /** New state on ALLOW. */
  state: S;
  audit: OperationalAuditEvent;
}

interface TransitionDeny<S extends string> {
  ok: false;
  reason: OperationalDenialReason;
  /** Denial leaves the state unchanged. */
  state: S;
  audit: OperationalAuditEvent;
}

type TransitionOutcome<S extends string> = TransitionAllow<S> | TransitionDeny<S>;

function auditEventId(
  subjectType: OperationalSubjectType,
  subjectId: string,
  historyLength: number,
): string {
  return `evt-${subjectType}-${subjectId}-${historyLength + 1}`;
}

/**
 * The single gate every operational transition passes. Order of evaluation is
 * the fail-closed order: input validity, tenant scope, transition validity,
 * capability. Every outcome — allowed or denied — produces one audit event
 * carrying full provenance; the caller appends it to the entity history.
 */
function applyTransition<S extends string>(
  entity: TransitionableEntity<S>,
  subjectType: OperationalSubjectType,
  subjectId: string,
  table: TransitionTable<S>,
  to: S,
  action: string,
  identity: OperationalIdentity,
  ctx: { at: string; reason?: string | null },
): TransitionOutcome<S> {
  const audit = (decision: OperationalAuditDecision, reason: string | null): OperationalAuditEvent => ({
    eventId: auditEventId(subjectType, subjectId, entity.history.length),
    subjectType,
    subjectId,
    tenantId: entity.tenantId,
    action,
    decision,
    reason,
    provenance: {
      actorId: identity.identityId,
      actorKind: identity.identityKind,
      actorTenantId: identity.tenantId,
      presentedCapabilities: [...identity.capabilities],
      at: ctx.at,
      reason: ctx.reason ?? null,
      policyVersion: entity.policyVersion,
    },
  });

  if (identity.identityId.trim() === "" || ctx.at.trim() === "") {
    return {
      ok: false,
      reason: "invalid_input",
      state: entity.state,
      audit: audit("DENY", "invalid_input"),
    };
  }
  if (identity.tenantId !== entity.tenantId) {
    return {
      ok: false,
      reason: "tenant_mismatch",
      state: entity.state,
      audit: audit("DENY", "tenant_mismatch"),
    };
  }
  const decision = evaluateTransition(table, entity.state, to);
  if (decision.decision === "DENY") {
    return {
      ok: false,
      reason: "invalid_transition",
      state: entity.state,
      audit: audit("DENY", "invalid_transition"),
    };
  }
  if (!holdsCapability(identity, decision.requiredCapability as OperationalCapability)) {
    return {
      ok: false,
      reason: "capability_missing",
      state: entity.state,
      audit: audit("DENY", "capability_missing"),
    };
  }
  return { ok: true, state: to, audit: audit("ALLOW", null) };
}

/* ─────────────────────────────────────────────────────────────
 * Governed alert contract
 * ────────────────────────────────────────────────────────────*/

export type AlertOperationalState = "OPEN" | "ACKNOWLEDGED" | "ESCALATED" | "CLOSED";

export const ALERT_OPERATIONAL_STATES: readonly AlertOperationalState[] = [
  "OPEN",
  "ACKNOWLEDGED",
  "ESCALATED",
  "CLOSED",
] as const;

export const ALERT_TRANSITIONS: TransitionTable<AlertOperationalState> = {
  OPEN: [
    { to: "ACKNOWLEDGED", capability: "alert:acknowledge" },
    { to: "ESCALATED", capability: "alert:escalate" },
    { to: "CLOSED", capability: "alert:resolve" },
  ],
  ACKNOWLEDGED: [
    { to: "ESCALATED", capability: "alert:escalate" },
    { to: "CLOSED", capability: "alert:resolve" },
  ],
  ESCALATED: [
    { to: "ACKNOWLEDGED", capability: "alert:acknowledge" },
    { to: "CLOSED", capability: "alert:resolve" },
  ],
  CLOSED: [],
};

export function isAlertTransitionAllowed(
  from: AlertOperationalState,
  to: AlertOperationalState,
): boolean {
  return evaluateTransition(ALERT_TRANSITIONS, from, to).decision === "ALLOW";
}

export interface GovernedAlert {
  alertId: string;
  tenantId: TenantId;
  /** Coordinating subsystem that surfaced the alert (provenance of origin). */
  source: string;
  /** Reference back to the originating subsystem's own alert record. */
  sourceRef: string;
  classification: DataClassification;
  severity: OperationalSeverity;
  state: AlertOperationalState;
  summary: string;
  createdAt: string;
  policyVersion: string;
  history: readonly OperationalAuditEvent[];
}

export interface CreateGovernedAlertInput {
  alertId: string;
  tenantId: TenantId;
  source: string;
  sourceRef: string;
  classification: DataClassification;
  severity: OperationalSeverity;
  summary: string;
  createdAt: string;
  policyVersion: string;
}

export type CreateGovernedAlertResult =
  | { ok: true; alert: GovernedAlert }
  | { ok: false; reason: "invalid_input" };

export function createGovernedAlert(input: CreateGovernedAlertInput): CreateGovernedAlertResult {
  const valid =
    input.alertId.trim() !== "" &&
    input.source.trim() !== "" &&
    input.sourceRef.trim() !== "" &&
    input.summary.trim() !== "" &&
    input.createdAt.trim() !== "" &&
    input.policyVersion.trim() !== "";
  if (!valid) {
    return { ok: false, reason: "invalid_input" };
  }
  return {
    ok: true,
    alert: {
      alertId: input.alertId,
      tenantId: input.tenantId,
      source: input.source,
      sourceRef: input.sourceRef,
      classification: input.classification,
      severity: input.severity,
      state: "OPEN",
      summary: input.summary,
      createdAt: input.createdAt,
      policyVersion: input.policyVersion,
      history: [],
    },
  };
}

export type AlertTransitionResult =
  | { ok: true; alert: GovernedAlert; audit: OperationalAuditEvent }
  | {
      ok: false;
      alert: GovernedAlert;
      audit: OperationalAuditEvent;
      reason: OperationalDenialReason;
    };

function alertTransition(
  alert: GovernedAlert,
  to: AlertOperationalState,
  identity: OperationalIdentity,
  ctx: { at: string; reason?: string | null },
): AlertTransitionResult {
  const outcome = applyTransition(
    alert,
    "alert",
    alert.alertId,
    ALERT_TRANSITIONS,
    to,
    `transition:${to}`,
    identity,
    ctx,
  );
  const next: GovernedAlert = { ...alert, state: outcome.state, history: [...alert.history, outcome.audit] };
  return outcome.ok
    ? { ok: true, alert: next, audit: outcome.audit }
    : { ok: false, alert: next, audit: outcome.audit, reason: outcome.reason };
}

/** Acknowledge requires the declared acknowledge capability (fail-closed). */
export function acknowledgeAlert(
  alert: GovernedAlert,
  identity: OperationalIdentity,
  ctx: { at: string; reason?: string | null },
): AlertTransitionResult {
  return alertTransition(alert, "ACKNOWLEDGED", identity, ctx);
}

/** Escalate requires the declared escalate capability (fail-closed). */
export function escalateAlert(
  alert: GovernedAlert,
  identity: OperationalIdentity,
  ctx: { at: string; reason?: string | null },
): AlertTransitionResult {
  return alertTransition(alert, "ESCALATED", identity, ctx);
}

/**
 * Fail-closed resolution (§27): an alert can only be closed by an identity
 * holding `alert:resolve`. Every other path — including other capabilities on
 * the same entity — is refused and audited.
 */
export function resolveAlert(
  alert: GovernedAlert,
  identity: OperationalIdentity,
  ctx: { at: string; reason?: string | null },
): AlertTransitionResult {
  return alertTransition(alert, "CLOSED", identity, ctx);
}

/* ─────────────────────────────────────────────────────────────
 * Governed incident contract
 * ────────────────────────────────────────────────────────────*/

export type IncidentOperationalState =
  | "OPEN" | "ACKNOWLEDGED" | "ESCALATED" | "MITIGATED" | "CLOSED";

export const INCIDENT_OPERATIONAL_STATES: readonly IncidentOperationalState[] = [
  "OPEN",
  "ACKNOWLEDGED",
  "ESCALATED",
  "MITIGATED",
  "CLOSED",
] as const;

export type IncidentCategory =
  | "operational"
  | "security"
  | "infrastructure"
  | "communication"
  | "data_integrity";

export const INCIDENT_CATEGORIES: readonly IncidentCategory[] = [
  "operational",
  "security",
  "infrastructure",
  "communication",
  "data_integrity",
] as const;

export const INCIDENT_TRANSITIONS: TransitionTable<IncidentOperationalState> = {
  OPEN: [
    { to: "ACKNOWLEDGED", capability: "incident:acknowledge" },
    { to: "ESCALATED", capability: "incident:escalate" },
    { to: "CLOSED", capability: "incident:resolve" },
  ],
  ACKNOWLEDGED: [
    { to: "ESCALATED", capability: "incident:escalate" },
    { to: "MITIGATED", capability: "incident:mitigate" },
    { to: "CLOSED", capability: "incident:resolve" },
  ],
  ESCALATED: [
    { to: "ACKNOWLEDGED", capability: "incident:acknowledge" },
    { to: "MITIGATED", capability: "incident:mitigate" },
    { to: "CLOSED", capability: "incident:resolve" },
  ],
  MITIGATED: [{ to: "CLOSED", capability: "incident:resolve" }],
  CLOSED: [],
};

export function isIncidentTransitionAllowed(
  from: IncidentOperationalState,
  to: IncidentOperationalState,
): boolean {
  return evaluateTransition(INCIDENT_TRANSITIONS, from, to).decision === "ALLOW";
}

export interface GovernedIncident {
  incidentId: string;
  tenantId: TenantId;
  category: IncidentCategory;
  classification: DataClassification;
  severity: OperationalSeverity;
  state: IncidentOperationalState;
  scope: readonly string[];
  createdAt: string;
  policyVersion: string;
  history: readonly OperationalAuditEvent[];
}

export interface CreateGovernedIncidentInput {
  incidentId: string;
  tenantId: TenantId;
  category: IncidentCategory;
  classification: DataClassification;
  severity: OperationalSeverity;
  scope: readonly string[];
  createdAt: string;
  policyVersion: string;
}

export type CreateGovernedIncidentResult =
  | { ok: true; incident: GovernedIncident }
  | { ok: false; reason: "invalid_input" };

export function createGovernedIncident(
  input: CreateGovernedIncidentInput,
): CreateGovernedIncidentResult {
  const valid =
    input.incidentId.trim() !== "" &&
    input.createdAt.trim() !== "" &&
    input.policyVersion.trim() !== "" &&
    input.scope.length > 0 &&
    input.scope.every((ref) => ref.trim() !== "");
  if (!valid) {
    return { ok: false, reason: "invalid_input" };
  }
  return {
    ok: true,
    incident: {
      incidentId: input.incidentId,
      tenantId: input.tenantId,
      category: input.category,
      classification: input.classification,
      severity: input.severity,
      state: "OPEN",
      scope: [...input.scope],
      createdAt: input.createdAt,
      policyVersion: input.policyVersion,
      history: [],
    },
  };
}

export type IncidentTransitionResult =
  | { ok: true; incident: GovernedIncident; audit: OperationalAuditEvent }
  | {
      ok: false;
      incident: GovernedIncident;
      audit: OperationalAuditEvent;
      reason: OperationalDenialReason;
    };

function incidentTransition(
  incident: GovernedIncident,
  to: IncidentOperationalState,
  identity: OperationalIdentity,
  ctx: { at: string; reason?: string | null },
): IncidentTransitionResult {
  const outcome = applyTransition(
    incident,
    "incident",
    incident.incidentId,
    INCIDENT_TRANSITIONS,
    to,
    `transition:${to}`,
    identity,
    ctx,
  );
  const next: GovernedIncident = {
    ...incident,
    state: outcome.state,
    history: [...incident.history, outcome.audit],
  };
  return outcome.ok
    ? { ok: true, incident: next, audit: outcome.audit }
    : { ok: false, incident: next, audit: outcome.audit, reason: outcome.reason };
}

export function acknowledgeIncident(
  incident: GovernedIncident,
  identity: OperationalIdentity,
  ctx: { at: string; reason?: string | null },
): IncidentTransitionResult {
  return incidentTransition(incident, "ACKNOWLEDGED", identity, ctx);
}

export function escalateIncident(
  incident: GovernedIncident,
  identity: OperationalIdentity,
  ctx: { at: string; reason?: string | null },
): IncidentTransitionResult {
  return incidentTransition(incident, "ESCALATED", identity, ctx);
}

export function mitigateIncident(
  incident: GovernedIncident,
  identity: OperationalIdentity,
  ctx: { at: string; reason?: string | null },
): IncidentTransitionResult {
  return incidentTransition(incident, "MITIGATED", identity, ctx);
}

/** Fail-closed resolution: requires the declared `incident:resolve` capability. */
export function resolveIncident(
  incident: GovernedIncident,
  identity: OperationalIdentity,
  ctx: { at: string; reason?: string | null },
): IncidentTransitionResult {
  return incidentTransition(incident, "CLOSED", identity, ctx);
}

/* ─────────────────────────────────────────────────────────────
 * AI-proposed actions — the §21 approval vocabulary
 * ────────────────────────────────────────────────────────────*/

/**
 * AI output is untrusted by default (§21). A proposal enters the surface in
 * PROPOSED state and is immediately routed to REQUIRE_APPROVAL. Only a human
 * identity holding action:approve can resolve the approval, the proposer can
 * never approve itself, and only an APPROVED proposal can execute — by an
 * identity holding the capability the underlying transition would require.
 * There is deliberately no path from PROPOSED (or REQUIRE_APPROVAL) to
 * EXECUTED: AI-proposed actions never auto-execute.
 */

export type AiActionSubjectType = "alert" | "incident";

export type AiActionVocabulary = "acknowledge" | "escalate" | "mitigate" | "resolve";

export type AiActionState =
  | "PROPOSED"
  | "REQUIRE_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTED"
  | "CANCELLED";

export interface AiProposedAction {
  proposalId: string;
  tenantId: TenantId;
  subjectType: AiActionSubjectType;
  subjectId: string;
  vocabulary: AiActionVocabulary;
  rationale: string;
  proposedBy: string;
  proposedAt: string;
  state: AiActionState;
  resolvedBy: string | null;
  resolvedAt: string | null;
  executedBy: string | null;
  executedAt: string | null;
  policyVersion: string;
  history: readonly OperationalAuditEvent[];
}

/**
 * The capability an AI-proposed action would exercise on its subject. Null
 * when the vocabulary verb does not exist for the subject type — a proposal
 * referencing a non-existent transition can never route or execute.
 */
export function capabilityForAiAction(
  subjectType: AiActionSubjectType,
  vocabulary: AiActionVocabulary,
): OperationalCapability | null {
  if (subjectType === "alert" && vocabulary === "mitigate") {
    return null;
  }
  return `${subjectType}:${vocabulary}` as OperationalCapability;
}

export interface RecordAiProposalInput {
  proposalId: string;
  tenantId: TenantId;
  subjectType: AiActionSubjectType;
  subjectId: string;
  vocabulary: AiActionVocabulary;
  rationale: string;
  policyVersion: string;
}

export type RecordAiProposalResult =
  | { ok: true; proposal: AiProposedAction }
  | { ok: false; reason: "invalid_input" | "unroutable_vocabulary" | "tenant_mismatch" };

/**
 * Record an AI-proposed action and route it through the approval vocabulary
 * in the same step: a proposal exists only as REQUIRE_APPROVAL. The routing
 * event is recorded with decision REQUIRE_APPROVAL — the §16 vocabulary entry
 * that means "a human decides next". A proposal claiming a tenant its
 * proposer does not belong to is refused (fail-closed tenant scoping).
 */
export function recordAiProposal(
  input: RecordAiProposalInput,
  proposer: OperationalIdentity,
  ctx: { at: string },
): RecordAiProposalResult {
  const valid =
    input.proposalId.trim() !== "" &&
    input.subjectId.trim() !== "" &&
    input.rationale.trim() !== "" &&
    input.policyVersion.trim() !== "" &&
    proposer.identityId.trim() !== "" &&
    ctx.at.trim() !== "";
  const capability = capabilityForAiAction(input.subjectType, input.vocabulary);
  if (!valid || capability === null) {
    return { ok: false, reason: capability === null ? "unroutable_vocabulary" : "invalid_input" };
  }
  if (proposer.tenantId !== input.tenantId) {
    return { ok: false, reason: "tenant_mismatch" };
  }
  const audit: OperationalAuditEvent = {
    eventId: auditEventId("ai_action", input.proposalId, 0),
    subjectType: "ai_action",
    subjectId: input.proposalId,
    tenantId: input.tenantId,
    action: "ai:route-for-approval",
    decision: "REQUIRE_APPROVAL",
    reason: null,
    provenance: {
      actorId: proposer.identityId,
      actorKind: proposer.identityKind,
      actorTenantId: proposer.tenantId,
      presentedCapabilities: [...proposer.capabilities],
      at: ctx.at,
      reason: "AI proposal routed to approval — never auto-executed (§21)",
      policyVersion: input.policyVersion,
    },
  };
  return {
    ok: true,
    proposal: {
      proposalId: input.proposalId,
      tenantId: input.tenantId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      vocabulary: input.vocabulary,
      rationale: input.rationale,
      proposedBy: proposer.identityId,
      proposedAt: ctx.at,
      state: "REQUIRE_APPROVAL",
      resolvedBy: null,
      resolvedAt: null,
      executedBy: null,
      executedAt: null,
      policyVersion: input.policyVersion,
      history: [audit],
    },
  };
}

export type ResolveAiApprovalResult =
  | { ok: true; proposal: AiProposedAction; audit: OperationalAuditEvent }
  | {
      ok: false;
      proposal: AiProposedAction;
      audit: OperationalAuditEvent;
      reason: OperationalDenialReason;
    };

/**
 * Resolve an AI proposal's approval. Fail-closed order: input validity,
 * tenant scope, state (must be REQUIRE_APPROVAL — a PROPOSED proposal cannot
 * be approved around the routing step), human identity (agents can never
 * approve — §7/§21), proposer segregation, approve capability. Denials are
 * audited and leave the proposal state unchanged.
 */
export function resolveAiProposalApproval(
  proposal: AiProposedAction,
  approver: OperationalIdentity,
  outcome: "approve" | "reject",
  ctx: { at: string; reason?: string | null },
): ResolveAiApprovalResult {
  const buildAudit = (): OperationalAuditEvent => ({
    eventId: auditEventId("ai_action", proposal.proposalId, proposal.history.length),
    subjectType: "ai_action",
    subjectId: proposal.proposalId,
    tenantId: proposal.tenantId,
    action: "ai:resolve-approval",
    decision: "DENY",
    reason: null,
    provenance: {
      actorId: approver.identityId,
      actorKind: approver.identityKind,
      actorTenantId: approver.tenantId,
      presentedCapabilities: [...approver.capabilities],
      at: ctx.at,
      reason: ctx.reason ?? null,
      policyVersion: proposal.policyVersion,
    },
  });

  const deny = (reason: OperationalDenialReason): ResolveAiApprovalResult => {
    const audit = buildAudit();
    return {
      ok: false,
      proposal: { ...proposal, history: [...proposal.history, audit] },
      audit,
      reason,
    };
  };

  if (approver.identityId.trim() === "" || ctx.at.trim() === "") {
    return deny("invalid_input");
  }
  if (approver.tenantId !== proposal.tenantId) {
    return deny("tenant_mismatch");
  }
  if (proposal.state !== "REQUIRE_APPROVAL") {
    return deny("invalid_transition");
  }
  if (approver.identityKind !== "human") {
    return deny("agent_identity_cannot_approve");
  }
  if (approver.identityId === proposal.proposedBy) {
    return deny("proposer_cannot_approve");
  }
  if (!holdsCapability(approver, "action:approve")) {
    return deny("capability_missing");
  }

  const audit: OperationalAuditEvent = { ...buildAudit(), decision: "ALLOW", reason: null };
  const nextState: AiActionState = outcome === "approve" ? "APPROVED" : "REJECTED";
  const approved: AiProposedAction = {
    ...proposal,
    state: nextState,
    resolvedBy: approver.identityId,
    resolvedAt: ctx.at,
    history: [...proposal.history, audit],
  };
  return { ok: true, proposal: approved, audit };
}

export type ExecuteAiActionResult =
  | { ok: true; proposal: AiProposedAction; audit: OperationalAuditEvent }
  | {
      ok: false;
      proposal: AiProposedAction;
      audit: OperationalAuditEvent;
      reason: OperationalDenialReason;
    };

/**
 * Execute an approved AI-proposed action. Only an APPROVED proposal can
 * execute, and only by an identity holding the capability the underlying
 * subject transition requires. This is the execution half of the §21
 * pipeline (Proposal → Approval → Execution → Audit); the caller performs
 * the subject transition through the state machine above and records the
 * resulting audit trail.
 */
export function executeApprovedAiAction(
  proposal: AiProposedAction,
  actor: OperationalIdentity,
  ctx: { at: string; reason?: string | null },
): ExecuteAiActionResult {
  const buildAudit = (): OperationalAuditEvent => ({
    eventId: auditEventId("ai_action", proposal.proposalId, proposal.history.length),
    subjectType: "ai_action",
    subjectId: proposal.proposalId,
    tenantId: proposal.tenantId,
    action: "ai:execute",
    decision: "DENY",
    reason: null,
    provenance: {
      actorId: actor.identityId,
      actorKind: actor.identityKind,
      actorTenantId: actor.tenantId,
      presentedCapabilities: [...actor.capabilities],
      at: ctx.at,
      reason: ctx.reason ?? null,
      policyVersion: proposal.policyVersion,
    },
  });

  const deny = (reason: OperationalDenialReason): ExecuteAiActionResult => {
    const audit = buildAudit();
    return {
      ok: false,
      proposal: { ...proposal, history: [...proposal.history, audit] },
      audit,
      reason,
    };
  };

  if (actor.identityId.trim() === "" || ctx.at.trim() === "") {
    return deny("invalid_input");
  }
  if (actor.tenantId !== proposal.tenantId) {
    return deny("tenant_mismatch");
  }
  if (proposal.state !== "APPROVED") {
    return deny("invalid_transition");
  }
  const capability = capabilityForAiAction(proposal.subjectType, proposal.vocabulary);
  if (capability === null || !holdsCapability(actor, capability)) {
    return deny("capability_missing");
  }

  const audit: OperationalAuditEvent = { ...buildAudit(), decision: "ALLOW", reason: null };
  const executed: AiProposedAction = {
    ...proposal,
    state: "EXECUTED",
    executedBy: actor.identityId,
    executedAt: ctx.at,
    history: [...proposal.history, audit],
  };
  return { ok: true, proposal: executed, audit };
}
