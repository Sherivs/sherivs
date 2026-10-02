/**
 * MH-13 — Governed command centre operational surface contract (J-048).
 *
 * Validates the pure contracts in frontend/src/lib/command/
 * operational-surface.ts, the contract-first rebuild of the withdrawn L4
 * alerts/incidents surface:
 * - creation fails closed on missing identity/provenance fields;
 * - every acknowledgment/escalation/mitigation/resolution is an
 *   authorization decision with provenance, and denials are audited with
 *   the same discipline as allowances (Constitution §16, §27);
 * - tenant scoping: an identity outside the entity's tenant is refused;
 * - fail-closed resolution: only the declared resolve capability closes;
 * - terminal states are immutable;
 * - AI-proposed actions route through the approval vocabulary, can only be
 *   approved by a human other than the proposer holding action:approve, and
 *   can only execute after approval by the subject-matching capability —
 *   never auto-executed (§21).
 */

import { describe, expect, it } from "vitest";
import { tenantId, type TenantId } from "@/lib/tenant-core";
import {
  acknowledgeAlert,
  acknowledgeIncident,
  capabilityForAiAction,
  createGovernedAlert,
  createGovernedIncident,
  escalateAlert,
  escalateIncident,
  evaluateTransition,
  executeApprovedAiAction,
  hasProvenanceForEveryTransition,
  isAlertTransitionAllowed,
  isIncidentTransitionAllowed,
  mitigateIncident,
  recordAiProposal,
  resolveAiProposalApproval,
  resolveAlert,
  resolveIncident,
  type AiProposedAction,
  type GovernedAlert,
  type GovernedIncident,
  type OperationalIdentity,
} from "@/lib/command/operational-surface";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");

const AT = "2026-10-02T12:00:00.000Z";

function identity(
  id: string,
  tenant: TenantId = TENANT_A,
  capabilities: OperationalIdentity["capabilities"] = [],
  kind: OperationalIdentity["identityKind"] = "human",
): OperationalIdentity {
  return { identityId: id, identityKind: kind, tenantId: tenant, capabilities };
}

function alert(overrides: Partial<GovernedAlert> = {}): GovernedAlert {
  const created = createGovernedAlert({
    alertId: "alert-1",
    tenantId: TENANT_A,
    source: "infrastructure-monitor",
    sourceRef: "src://monitor/1",
    classification: "TENANT_INTERNAL",
    severity: "HIGH",
    summary: "Node saturation detected",
    createdAt: "2026-10-02T11:00:00.000Z",
    policyVersion: "op-policy-3",
  });
  if (!created.ok) throw new Error("fixture alert must be valid");
  return { ...created.alert, ...overrides };
}

function incident(overrides: Partial<GovernedIncident> = {}): GovernedIncident {
  const created = createGovernedIncident({
    incidentId: "incident-1",
    tenantId: TENANT_A,
    category: "infrastructure",
    classification: "SENSITIVE",
    severity: "CRITICAL",
    scope: ["node-cluster-1"],
    createdAt: "2026-10-02T11:00:00.000Z",
    policyVersion: "op-policy-3",
  });
  if (!created.ok) throw new Error("fixture incident must be valid");
  return { ...created.incident, ...overrides };
}

function aiProposal(overrides: Partial<AiProposedAction> = {}): AiProposedAction {
  const proposer = identity("agent-1", TENANT_A, [], "agent");
  const recorded = recordAiProposal(
    {
      proposalId: "prop-1",
      tenantId: TENANT_A,
      subjectType: "alert",
      subjectId: "alert-1",
      vocabulary: "acknowledge",
      rationale: "Repeated pattern matches known transient saturation",
      policyVersion: "op-policy-3",
    },
    proposer,
    { at: AT },
  );
  if (!recorded.ok) throw new Error("fixture proposal must be routable");
  return { ...recorded.proposal, ...overrides };
}

describe("alert contract — creation fails closed", () => {
  it("rejects creation without a summary, source ref, or policy version", () => {
    expect(
      createGovernedAlert({
        alertId: "alert-2",
        tenantId: TENANT_A,
        source: "monitor",
        sourceRef: "",
        classification: "TENANT_INTERNAL",
        severity: "LOW",
        summary: "x",
        createdAt: AT,
        policyVersion: "op-policy-3",
      }),
    ).toEqual({ ok: false, reason: "invalid_input" });
    expect(
      createGovernedAlert({
        alertId: "alert-3",
        tenantId: TENANT_A,
        source: "monitor",
        sourceRef: "src://1",
        classification: "TENANT_INTERNAL",
        severity: "LOW",
        summary: "x",
        createdAt: AT,
        policyVersion: "",
      }),
    ).toEqual({ ok: false, reason: "invalid_input" });
  });

  it("creates an OPEN alert carrying classification, severity, tenant and policy provenance", () => {
    const a = alert();
    expect(a.state).toBe("OPEN");
    expect(a.tenantId).toBe(TENANT_A);
    expect(a.classification).toBe("TENANT_INTERNAL");
    expect(a.severity).toBe("HIGH");
    expect(a.policyVersion).toBe("op-policy-3");
    expect(a.history).toHaveLength(0);
  });
});

describe("alert state machine — authorization-gated transitions", () => {
  it("allows acknowledge only with the declared capability and records provenance", () => {
    const operator = identity("human-1", TENANT_A, ["alert:acknowledge"]);
    const result = acknowledgeAlert(alert(), operator, { at: AT, reason: "Investigating" });
    if (!result.ok) throw new Error("expected allow");
    expect(result.ok).toBe(true);
    expect(result.alert.state).toBe("ACKNOWLEDGED");
    expect(result.audit.decision).toBe("ALLOW");
    expect(result.audit.action).toBe("transition:ACKNOWLEDGED");
    expect(result.audit.provenance.actorId).toBe("human-1");
    expect(result.audit.provenance.at).toBe(AT);
    expect(result.audit.provenance.policyVersion).toBe("op-policy-3");
    expect(result.audit.provenance.presentedCapabilities).toEqual(["alert:acknowledge"]);
    expect(result.alert.history).toHaveLength(1);
  });

  it("refuses and audits an unauthorized acknowledgment", () => {
    const bystander = identity("human-2", TENANT_A, []);
    const result = acknowledgeAlert(alert(), bystander, { at: AT });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("capability_missing");
    expect(result.alert.state).toBe("OPEN");
    expect(result.alert.history).toHaveLength(1);
    const denial = result.alert.history[0];
    expect(denial.decision).toBe("DENY");
    expect(denial.reason).toBe("capability_missing");
    expect(denial.provenance.actorId).toBe("human-2");
    expect(hasProvenanceForEveryTransition(result.alert)).toBe(true);
  });

  it("refuses and audits a cross-tenant acknowledgment — tenant A is not tenant B", () => {
    const outsider = identity("human-3", TENANT_B, ["alert:acknowledge"]);
    const result = acknowledgeAlert(alert(), outsider, { at: AT });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("tenant_mismatch");
    expect(result.alert.state).toBe("OPEN");
    expect(result.alert.history[0].decision).toBe("DENY");
    expect(result.alert.history[0].reason).toBe("tenant_mismatch");
  });

  it("requires alert:escalate to escalate, and allows the acknowledged path", () => {
    const operator = identity("human-1", TENANT_A, ["alert:acknowledge", "alert:escalate"]);
    const ack = acknowledgeAlert(alert(), operator, { at: AT });
    if (!ack.ok) throw new Error("expected allow");
    const esc = escalateAlert(ack.alert, operator, { at: AT, reason: "Not resolving on schedule" });
    if (!esc.ok) throw new Error("expected allow");
    expect(esc.alert.state).toBe("ESCALATED");
    expect(esc.audit.action).toBe("transition:ESCALATED");
  });

  it("refuses escalation by an identity holding only the acknowledge capability", () => {
    const operator = identity("human-4", TENANT_A, ["alert:acknowledge"]);
    const esc = escalateAlert(alert(), operator, { at: AT });
    expect(esc.ok).toBe(false);
    if (esc.ok) throw new Error("unreachable");
    expect(esc.reason).toBe("capability_missing");
    expect(esc.alert.state).toBe("OPEN");
  });

  it("fails closed on resolution: an identity without alert:resolve cannot close", () => {
    const operator = identity("human-5", TENANT_A, ["alert:acknowledge"]);
    const result = resolveAlert(alert(), operator, { at: AT, reason: "Looks fine to me" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("capability_missing");
    expect(result.alert.state).toBe("OPEN");
    expect(result.alert.history[0].decision).toBe("DENY");
  });

  it("closes only through the declared resolve capability, then the state is terminal", () => {
    const resolver = identity("human-6", TENANT_A, ["alert:resolve"]);
    const closed = resolveAlert(alert(), resolver, { at: AT, reason: "Verified clear" });
    if (!closed.ok) throw new Error("expected allow");
    expect(closed.alert.state).toBe("CLOSED");
    expect(closed.audit.decision).toBe("ALLOW");

    // Terminal: even the resolver cannot transition a closed alert.
    const reopen = acknowledgeAlert(closed.alert, resolver, { at: AT });
    expect(reopen.ok).toBe(false);
    if (reopen.ok) throw new Error("unreachable");
    expect(reopen.reason).toBe("invalid_transition");
    expect(reopen.alert.state).toBe("CLOSED");
    expect(reopen.alert.history).toHaveLength(2);
    expect(reopen.alert.history[1].decision).toBe("DENY");
  });

  it("refuses an agent identity that does not declare the capability, and allows one that does", () => {
    const agentNoCaps = identity("agent-9", TENANT_A, [], "agent");
    expect(acknowledgeAlert(alert(), agentNoCaps, { at: AT }).ok).toBe(false);

    const agentWithDeclaredCapability = identity("agent-10", TENANT_A, ["alert:acknowledge"], "agent");
    const result = acknowledgeAlert(alert(), agentWithDeclaredCapability, { at: AT });
    expect(result.ok).toBe(true);
  });
});

describe("alert transition table", () => {
  it("permits exactly the declared edges", () => {
    expect(isAlertTransitionAllowed("OPEN", "ACKNOWLEDGED")).toBe(true);
    expect(isAlertTransitionAllowed("OPEN", "ESCALATED")).toBe(true);
    expect(isAlertTransitionAllowed("OPEN", "CLOSED")).toBe(true);
    expect(isAlertTransitionAllowed("ACKNOWLEDGED", "ESCALATED")).toBe(true);
    expect(isAlertTransitionAllowed("ESCALATED", "ACKNOWLEDGED")).toBe(true);
    expect(isAlertTransitionAllowed("ACKNOWLEDGED", "OPEN")).toBe(false);
    expect(isAlertTransitionAllowed("CLOSED", "OPEN")).toBe(false);
  });

  it("names the required capability for each allowed edge", () => {
    expect(evaluateTransition(
      {
        OPEN: [{ to: "CLOSED", capability: "alert:resolve" }],
        CLOSED: [],
      },
      "OPEN",
      "CLOSED",
    )).toEqual({
      decision: "ALLOW",
      to: "CLOSED",
      requiredCapability: "alert:resolve",
      reason: null,
    });
    expect(evaluateTransition(
      {
        OPEN: [{ to: "CLOSED", capability: "alert:resolve" }],
        CLOSED: [],
      },
      "OPEN",
      "OPEN",
    ).decision).toBe("DENY");
  });
});

describe("incident state machine — full lifecycle under governance", () => {
  it("runs OPEN → ACKNOWLEDGED → ESCALATED → MITIGATED → CLOSED with provenance at every step", () => {
    const commander = identity(
      "human-7",
      TENANT_A,
      ["incident:acknowledge", "incident:escalate", "incident:mitigate", "incident:resolve"],
    );
    const ack = acknowledgeIncident(incident(), commander, { at: AT });
    if (!ack.ok) throw new Error("expected allow");
    const esc = escalateIncident(ack.incident, commander, { at: AT, reason: "Spreading" });
    if (!esc.ok) throw new Error("expected allow");
    const mit = mitigateIncident(esc.incident, commander, { at: AT, reason: "Contained" });
    if (!mit.ok) throw new Error("expected allow");
    const closed = resolveIncident(mit.incident, commander, { at: AT, reason: "Restored" });
    if (!closed.ok) throw new Error("expected allow");

    expect(closed.incident.state).toBe("CLOSED");
    expect(closed.incident.history).toHaveLength(4);
    expect(closed.incident.history.map((event) => event.decision)).toEqual([
      "ALLOW",
      "ALLOW",
      "ALLOW",
      "ALLOW",
    ]);
    expect(hasProvenanceForEveryTransition(closed.incident)).toBe(true);
    expect(closed.incident.history.every((e) => e.provenance.actorId === "human-7")).toBe(true);
  });

  it("permits exactly the declared incident edges", () => {
    expect(isIncidentTransitionAllowed("OPEN", "MITIGATED")).toBe(false);
    expect(isIncidentTransitionAllowed("OPEN", "CLOSED")).toBe(true);
    expect(isIncidentTransitionAllowed("MITIGATED", "CLOSED")).toBe(true);
    expect(isIncidentTransitionAllowed("MITIGATED", "ESCALATED")).toBe(false);
    expect(isIncidentTransitionAllowed("CLOSED", "ACKNOWLEDGED")).toBe(false);
  });

  it("fails closed on incident resolution without incident:resolve", () => {
    const mitigator = identity("human-8", TENANT_A, ["incident:mitigate"]);
    const result = resolveIncident(incident(), mitigator, { at: AT });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("capability_missing");
    expect(result.incident.state).toBe("OPEN");
    expect(result.incident.history[0].decision).toBe("DENY");
  });

  it("refuses and audits cross-tenant incident resolution", () => {
    const outsider = identity("human-9", TENANT_B, ["incident:resolve"]);
    const result = resolveIncident(incident(), outsider, { at: AT });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("tenant_mismatch");
  });

  it("rejects incident creation with an empty scope or policy version", () => {
    expect(
      createGovernedIncident({
        incidentId: "incident-2",
        tenantId: TENANT_A,
        category: "operational",
        classification: "TENANT_INTERNAL",
        severity: "LOW",
        scope: [],
        createdAt: AT,
        policyVersion: "op-policy-3",
      }),
    ).toEqual({ ok: false, reason: "invalid_input" });
  });
});

describe("AI-proposed actions — the §21 approval vocabulary", () => {
  it("routes every proposal to REQUIRE_APPROVAL at creation with an audit record", () => {
    const proposal = aiProposal();
    expect(proposal.state).toBe("REQUIRE_APPROVAL");
    expect(proposal.proposedBy).toBe("agent-1");
    expect(proposal.history).toHaveLength(1);
    expect(proposal.history[0].decision).toBe("REQUIRE_APPROVAL");
    expect(proposal.history[0].action).toBe("ai:route-for-approval");
    expect(hasProvenanceForEveryTransition(proposal)).toBe(true);
  });

  it("refuses a proposal whose vocabulary has no transition on its subject", () => {
    const proposer = identity("agent-1", TENANT_A, [], "agent");
    expect(
      recordAiProposal(
        {
          proposalId: "prop-2",
          tenantId: TENANT_A,
          subjectType: "alert",
          subjectId: "alert-1",
          vocabulary: "mitigate",
          rationale: "alerts have no mitigation edge",
          policyVersion: "op-policy-3",
        },
        proposer,
        { at: AT },
      ),
    ).toEqual({ ok: false, reason: "unroutable_vocabulary" });
  });

  it("maps proposal vocabulary to the subject-matching capability", () => {
    expect(capabilityForAiAction("alert", "acknowledge")).toBe("alert:acknowledge");
    expect(capabilityForAiAction("alert", "resolve")).toBe("alert:resolve");
    expect(capabilityForAiAction("incident", "mitigate")).toBe("incident:mitigate");
    expect(capabilityForAiAction("incident", "resolve")).toBe("incident:resolve");
  });

  it("never lets an agent approve — even one holding action:approve", () => {
    const agentApprover = identity("agent-2", TENANT_A, ["action:approve"], "agent");
    const result = resolveAiProposalApproval(aiProposal(), agentApprover, "approve", { at: AT });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("agent_identity_cannot_approve");
    expect(result.proposal.state).toBe("REQUIRE_APPROVAL");
    expect(result.proposal.history[1].decision).toBe("DENY");
  });

  it("enforces segregation of duties: the proposer cannot approve its own proposal", () => {
    const proposerAsHuman = identity("agent-1", TENANT_A, ["action:approve"], "human");
    const result = resolveAiProposalApproval(aiProposal(), proposerAsHuman, "approve", { at: AT });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("proposer_cannot_approve");
  });

  it("refuses a human approver without the action:approve capability", () => {
    const weakApprover = identity("human-11", TENANT_A, []);
    const result = resolveAiProposalApproval(aiProposal(), weakApprover, "approve", { at: AT });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("capability_missing");
  });

  it("refuses approval of an unrouted proposal — no path around the routing step", () => {
    const unrouted = aiProposal({ state: "PROPOSED" });
    const approver = identity("human-12", TENANT_A, ["action:approve"]);
    const result = resolveAiProposalApproval(unrouted, approver, "approve", { at: AT });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("invalid_transition");
  });

  it("refuses execution before approval — AI never auto-executes", () => {
    const pending = aiProposal();
    const operator = identity("human-13", TENANT_A, ["alert:acknowledge"]);
    const result = executeApprovedAiAction(pending, operator, { at: AT });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("invalid_transition");
    expect(result.proposal.state).toBe("REQUIRE_APPROVAL");
    expect(result.proposal.history[1].decision).toBe("DENY");
    expect(result.proposal.history[1].action).toBe("ai:execute");
  });

  it("executes an approved proposal only through the subject-matching capability, audited end to end", () => {
    const approver = identity("human-14", TENANT_A, ["action:approve"]);
    const approved = resolveAiProposalApproval(aiProposal(), approver, "approve", { at: AT });
    if (!approved.ok) throw new Error("expected allow");
    expect(approved.proposal.state).toBe("APPROVED");
    expect(approved.proposal.resolvedBy).toBe("human-14");

    const weakOperator = identity("human-15", TENANT_A, []);
    const denied = executeApprovedAiAction(approved.proposal, weakOperator, { at: AT });
    expect(denied.ok).toBe(false);
    if (denied.ok) throw new Error("unreachable");
    expect(denied.reason).toBe("capability_missing");
    expect(denied.proposal.state).toBe("APPROVED");
    // The denial is audited on the returned entity and stays in its history.
    expect(denied.proposal.history.map((event) => event.decision)).toEqual([
      "REQUIRE_APPROVAL",
      "ALLOW",
      "DENY",
    ]);

    const operator = identity("human-16", TENANT_A, ["alert:acknowledge"]);
    const executed = executeApprovedAiAction(denied.proposal, operator, { at: AT });
    if (!executed.ok) throw new Error("expected allow");
    expect(executed.proposal.state).toBe("EXECUTED");
    expect(executed.proposal.executedBy).toBe("human-16");
    expect(executed.audit.action).toBe("ai:execute");
    expect(executed.audit.decision).toBe("ALLOW");
    expect(executed.proposal.history.map((event) => event.decision)).toEqual([
      "REQUIRE_APPROVAL",
      "ALLOW",
      "DENY",
      "ALLOW",
    ]);
    expect(hasProvenanceForEveryTransition(executed.proposal)).toBe(true);
  });

  it("refuses cross-tenant approval and execution of proposals", () => {
    const outsiderApprover = identity("human-17", TENANT_B, ["action:approve"]);
    expect(resolveAiProposalApproval(aiProposal(), outsiderApprover, "approve", { at: AT }).ok).toBe(false);

    const outsiderOperator = identity("human-18", TENANT_B, ["alert:acknowledge"]);
    expect(executeApprovedAiAction(aiProposal(), outsiderOperator, { at: AT }).ok).toBe(false);
  });

  it("refuses a proposal whose proposer claims a different tenant", () => {
    const outsiderAgent = identity("agent-3", TENANT_B, [], "agent");
    expect(
      recordAiProposal(
        {
          proposalId: "prop-3",
          tenantId: TENANT_A,
          subjectType: "alert",
          subjectId: "alert-1",
          vocabulary: "acknowledge",
          rationale: "cross-tenant attempt",
          policyVersion: "op-policy-3",
        },
        outsiderAgent,
        { at: AT },
      ),
    ).toEqual({ ok: false, reason: "tenant_mismatch" });
  });
});
