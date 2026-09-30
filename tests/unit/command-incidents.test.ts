/**
 * CoreGrid Scholar — Phase 19 Institutional Command Centre unit tests
 * (command-incidents).
 *
 * Validates:
 * - Incident lifecycle (AM), command (AN), notes (AQ) and evidence (AP).
 * - Decision centre (AU-AY): decision cards with options; approvals and
 *   expiration.
 * - Action centre (BA, BC, BD): execution requests pass through Phase 17;
 *   UNKNOWN is never success.
 * - Situations (CF, CG, CH): coordination abstraction combining refs.
 * - Four-eyes control (CV) and segregation of duties (CW).
 * - Emergency mode (CX, CY): justified, policy-gated, enhanced audit.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createIncident,
  isIncidentTransitionAllowed,
  assignIncidentCommander,
  addIncidentResponder,
  addIncidentNote,
  addIncidentEvidence,
  createPostmortem,
  createCommandDecision,
  decideCommandDecision,
  isCommandDecisionExpired,
  isCommandActionSuccess,
  isCommandActionStateUnknown,
  createSituation,
  addToSituation,
  createCommandAnnotation,
  createOperatorHandoff,
  isEscalationMatrixPolicyCurrent,
  evaluateCommandApproval,
  activateEmergencyMode,
  deactivateEmergencyMode,
  type CommandAction,
  type CommandApproval,
} from "@/lib/command-incidents";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

function action(overrides: Partial<CommandAction> = {}): CommandAction {
  return {
    actionId: "act-1",
    tenantId: TENANT_A,
    requestedBy: "ops-1",
    approvedBy: null,
    state: "AWAITING_AUTHORIZATION",
    idempotencyKey: "idem-1",
    executionStateRef: null,
    ...overrides,
  };
}

describe("Incident lifecycle (AM, AN, AQ, AP)", () => {
  it("creates a DETECTED incident and walks legal transitions", () => {
    const result = createIncident({
      incidentId: "inc-1",
      tenantId: TENANT_A,
      kind: "infrastructure_failure",
      severity: "high",
      scope: ["campus-a"],
      detectedAt: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.incident.state).toBe("DETECTED");
      expect(isIncidentTransitionAllowed("DETECTED", "ASSESSED")).toBe(true);
      expect(isIncidentTransitionAllowed("DETECTED", "CLOSED")).toBe(true);
      expect(isIncidentTransitionAllowed("CLOSED", "RESPONDING")).toBe(false);
    }
  });

  it("rejects an incident without a scope (AL)", () => {
    expect(
      createIncident({
        incidentId: "inc-1",
        tenantId: TENANT_A,
        kind: "security_incident",
        severity: "high",
        scope: [],
        detectedAt: NOW,
      }).ok,
    ).toBe(false);
  });

  it("assigns commanders, responders, notes and evidence", () => {
    const result = createIncident({
      incidentId: "inc-1",
      tenantId: TENANT_A,
      kind: "security_incident",
      severity: "critical",
      scope: ["campus-a"],
      detectedAt: NOW,
    });
    if (!result.ok) throw new Error("fixture failed");
    let incident = assignIncidentCommander(result.incident, "c-1");
    incident = addIncidentResponder(incident, "r-1");
    incident = addIncidentNote(incident, "note-1", "r-1", NOW, "contained to building A");
    incident = addIncidentEvidence(incident, "ev-1", "audit", "audit-99");
    expect(incident.commander).toBe("c-1");
    expect(incident.responders).toContain("r-1");
    expect(incident.notes).toHaveLength(1);
    expect(incident.evidence[0].source).toBe("audit");
  });

  it("creates a postmortem with root cause and lessons", () => {
    const postmortem = createPostmortem({
      incidentId: "inc-1",
      timeline: ["detected", "resolved"],
      rootCause: "power failure",
      contributingFactors: ["aging UPS"],
      impact: "2h outage",
      recovery: "switched to generator",
      lessons: ["test UPS"],
      correctiveActions: ["replace UPS"],
    });
    expect(postmortem.rootCause).toBe("power failure");
  });
});

describe("Decision centre (AU, AV, AW, AY)", () => {
  it("creates a decision card with options and owner", () => {
    const result = createCommandDecision({
      decisionId: "d-1",
      tenantId: TENANT_A,
      question: "Extend term?",
      context: "disruption",
      evidenceRefs: ["attendance-report"],
      options: ["extend", "do-not-extend"],
      risks: ["calendar conflict"],
      recommendation: "extend",
      uncertainty: "depends on recovery",
      deadline: "2026-02-01T00:00:00Z",
      owner: "principal",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.state).toBe("PENDING");
    }
  });

  it("rejects a decision with fewer than two options", () => {
    expect(
      createCommandDecision({
        decisionId: "d-1",
        tenantId: TENANT_A,
        question: "q",
        context: "",
        evidenceRefs: [],
        options: ["only"],
        risks: [],
        owner: "o",
      }).ok,
    ).toBe(false);
  });

  it("approves and expires decisions", () => {
    const result = createCommandDecision({
      decisionId: "d-1",
      tenantId: TENANT_A,
      question: "q",
      context: "",
      evidenceRefs: [],
      options: ["a", "b"],
      risks: [],
      owner: "o",
      deadline: "2026-02-01T00:00:00Z",
    });
    if (!result.ok) throw new Error("fixture failed");
    const approved = decideCommandDecision(result.decision, "APPROVED", "principal", NOW);
    expect(approved.state).toBe("APPROVED");
    expect(isCommandDecisionExpired(approved, "2026-03-01T00:00:00Z")).toBe(true);
  });
});

describe("Action centre and execution control (BA, BC, BD)", () => {
  it("never displays UNKNOWN as success (EL)", () => {
    expect(isCommandActionSuccess(action({ state: "SUCCEEDED" }))).toBe(true);
    expect(isCommandActionSuccess(action({ state: "UNKNOWN" }))).toBe(false);
    expect(isCommandActionStateUnknown(action({ state: "UNKNOWN" }))).toBe(true);
  });
});

describe("Situations and annotations (CF, CG, CH, CI, CJ)", () => {
  it("combines alerts, incidents and decisions into a coordination object", () => {
    const situation = createSituation("sit-1", TENANT_A, "HIGH", {
      alertIds: ["al-1"],
      incidentIds: ["inc-1"],
    });
    const extended = addToSituation(situation, "decisionIds", "d-1");
    expect(extended.alertIds).toContain("al-1");
    expect(extended.decisionIds).toContain("d-1");
    expect(addToSituation(extended, "decisionIds", "d-1").decisionIds).toHaveLength(1);
  });

  it("records annotation provenance", () => {
    const annotation = createCommandAnnotation({
      author: "ops-1",
      at: NOW,
      target: "inc-1",
      content: "check generator",
      version: 1,
    });
    expect(annotation.author).toBe("ops-1");
    expect(annotation.version).toBe(1);
  });
});

describe("Approvals, four-eyes and segregation (CU, CV, CW)", () => {
  it("requires distinct approvers (four-eyes)", () => {
    const approval: CommandApproval = {
      approvalId: "ap-1",
      actionId: "act-1",
      requestedBy: "ops-1",
      requiredApprovers: 2,
      approvals: [{ approver: "mgr-1", decision: "approve", at: NOW }],
    };
    const result = evaluateCommandApproval({ approval, segregationOfDuties: false });
    expect(result.approved).toBe(false);
    const twoEyes: CommandApproval = {
      ...approval,
      approvals: [
        { approver: "mgr-1", decision: "approve", at: NOW },
        { approver: "dir-1", decision: "approve", at: NOW },
      ],
    };
    expect(
      evaluateCommandApproval({ approval: twoEyes, segregationOfDuties: false }).approved,
    ).toBe(true);
  });

  it("enforces segregation of duties — proposer cannot approve (CW)", () => {
    const approval: CommandApproval = {
      approvalId: "ap-1",
      actionId: "act-1",
      requestedBy: "ops-1",
      requiredApprovers: 1,
      approvals: [{ approver: "ops-1", decision: "approve", at: NOW }],
    };
    expect(evaluateCommandApproval({ approval, segregationOfDuties: true }).approved).toBe(false);
  });
});

describe("Emergency mode (CX, CY)", () => {
  it("requires justification and policy permission", () => {
    expect(
      activateEmergencyMode({
        activatedBy: "ops-1",
        at: NOW,
        scope: "campus-a",
        justification: "",
        policyAllows: true,
      }).ok,
    ).toBe(false);
    expect(
      activateEmergencyMode({
        activatedBy: "ops-1",
        at: NOW,
        scope: "campus-a",
        justification: "fire drill",
        policyAllows: false,
      }).ok,
    ).toBe(false);
    const result = activateEmergencyMode({
      activatedBy: "ops-1",
      at: NOW,
      scope: "campus-a",
      justification: "fire drill",
      policyAllows: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.active).toBe(true);
      expect(deactivateEmergencyMode(result.state).active).toBe(false);
    }
  });
});

describe("Handoff and escalation matrix (CQ, CR, CS, CT)", () => {
  it("records operator handoff", () => {
    const handoff = createOperatorHandoff({
      previousOwner: "ops-1",
      newOwner: "ops-2",
      at: NOW,
      reason: "shift change",
      scopeRef: "inc-1",
    });
    expect(handoff.previousOwner).toBe("ops-1");
    expect(handoff.newOwner).toBe("ops-2");
  });

  it("requires current escalation policy versions (CT)", () => {
    expect(
      isEscalationMatrixPolicyCurrent(
        {
          matrixId: "m1",
          severity: "high",
          domain: "security",
          targetRole: "sec-lead",
          afterMinutes: 30,
          policyVersion: 2,
        },
        2,
      ),
    ).toBe(true);
    expect(
      isEscalationMatrixPolicyCurrent(
        {
          matrixId: "m1",
          severity: "high",
          domain: "security",
          targetRole: "sec-lead",
          afterMinutes: 30,
          policyVersion: 1,
        },
        2,
      ),
    ).toBe(false);
  });
});
