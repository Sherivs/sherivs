/**
 * CoreGrid human approval chains tests (J-032, MISSION H2-20;
 * Constitution §7, §12, §16, §21).
 *
 * Validates frontend/src/lib/governance/approval-chains.ts:
 * - the risk → mandated-depth vocabulary (single-approver / two-person /
 *   quorum);
 * - approver eligibility: capability + tenant scope + independence (NOT the
 *   proposer, never AI);
 * - approval record provenance (who approved what, under which policy,
 *   expiry — §12);
 * - the fail-closed executor gate: missing approval DENIED + audited,
 *   self-approval DENIED, expired approval DENIED, wrong-tenant approver
 *   DENIED, and a valid chain ALLOWED with the approval audit left behind.
 */

import { describe, expect, it } from "vitest";
import {
  APPROVAL_CHAINS_SCHEMA_VERSION,
  APPROVER_CAPABILITY,
  ApprovalChainError,
  approveHighRiskAction,
  approvalChainSatisfied,
  approvalProvenance,
  declareHighRiskAction,
  evaluateApprovalChain,
  evaluateApproverEligibility,
  gateHighRiskActionExecution,
  mandatedApprovalDepth,
  mandatedApproverCount,
  type ActionRiskClass,
  type ApproverIdentity,
  type ApprovalRecord,
  type HighRiskAction,
} from "@/lib/governance/approval-chains";
import { digestContent } from "@/lib/ai-gateway/reasoning-provenance";

/* ────────────── Fixtures ────────────── */

const PROPOSED_AT = "2026-10-01T09:00:00.000Z";
const APPROVED_AT = "2026-10-01T10:00:00.000Z";
const EXECUTE_AT = "2026-10-01T11:00:00.000Z";
const NEXT_DAY = "2026-10-02T11:00:00.000Z";

function makeAction(overrides: Partial<HighRiskAction> = {}): HighRiskAction {
  const base = declareHighRiskAction({
    actionId: "act-001",
    actionRef: "payments.payout.release",
    tenantId: "tenant-a",
    riskClass: "high-risk",
    proposerRef: "agent:coregrid-agent-7",
    policyId: "POL-HIGH-RISK-RELEASE",
    proposedAt: PROPOSED_AT,
    payload: { amountMinor: 500000, beneficiary: "vendor-12" },
  });
  return { ...base, ...overrides };
}

function eligibleApprover(approverRef: string, tenantId = "tenant-a"): ApproverIdentity {
  return {
    approverRef,
    identityKind: "human",
    tenantId,
    capabilities: [APPROVER_CAPABILITY],
  };
}

function twoPersonChain(action: HighRiskAction): ApprovalRecord[] {
  return [
    approveHighRiskAction(action, eligibleApprover("human:alice"), {
      approvalId: "ap-1",
      decidedAt: APPROVED_AT,
      expiresAt: NEXT_DAY,
      evidence: "Payout matches approved vendor invoice",
    }),
    approveHighRiskAction(action, eligibleApprover("human:bob"), {
      approvalId: "ap-2",
      decidedAt: APPROVED_AT,
      expiresAt: NEXT_DAY,
      evidence: "Second-line review of beneficiary and amount",
    }),
  ];
}

/* ────────────── Vocabulary ────────────── */

describe("risk classification vocabulary (mandated approval depth)", () => {
  it("mandates single-approver / two-person / quorum by risk class", () => {
    expect(mandatedApprovalDepth("standard")).toBe("single-approver");
    expect(mandatedApprovalDepth("high-risk")).toBe("two-person");
    expect(mandatedApprovalDepth("critical")).toBe("quorum");

    expect(mandatedApproverCount("standard")).toBe(1);
    expect(mandatedApproverCount("high-risk")).toBe(2);
    expect(mandatedApproverCount("critical")).toBe(3);
  });

  it("rejects an unknown risk class at action declaration (fail-closed)", () => {
    expect(() =>
      declareHighRiskAction({
        actionId: "act-x",
        actionRef: "x",
        tenantId: "tenant-a",
        riskClass: "unheard-of" as ActionRiskClass,
        proposerRef: "agent:coregrid-agent-7",
        policyId: "POL-X",
        proposedAt: PROPOSED_AT,
        payload: {},
      }),
    ).toThrowError(ApprovalChainError);
  });

  it("binds the action to a canonical content digest", () => {
    const action = makeAction();
    expect(action.actionDigest).toBe(
      digestContent({ amountMinor: 500000, beneficiary: "vendor-12" }),
    );
  });
});

/* ────────────── Eligibility ────────────── */

describe("approver eligibility (capability + tenant scope + independence)", () => {
  it("accepts an eligible human approver", () => {
    const action = makeAction();
    expect(evaluateApproverEligibility(action, eligibleApprover("human:alice")).eligible).toBe(
      true,
    );
  });

  it("denies an AI identity as approver (§7)", () => {
    const action = makeAction();
    const result = evaluateApproverEligibility(action, {
      approverRef: "agent:coregrid-agent-8",
      identityKind: "ai",
      tenantId: "tenant-a",
      capabilities: [APPROVER_CAPABILITY],
    });
    expect(result.eligible).toBe(false);
    expect(result.rejections.some((r) => r.code === "approver_not_human")).toBe(true);
  });

  it("denies an approver without the required capability", () => {
    const action = makeAction();
    const result = evaluateApproverEligibility(action, {
      approverRef: "human:carol",
      identityKind: "human",
      tenantId: "tenant-a",
      capabilities: ["something:else"],
    });
    expect(result.eligible).toBe(false);
    expect(result.rejections.some((r) => r.code === "capability_missing")).toBe(true);
  });

  it("denies an approver whose tenant scope differs from the action's tenant", () => {
    const action = makeAction();
    const result = evaluateApproverEligibility(action, eligibleApprover("human:dave", "tenant-b"));
    expect(result.eligible).toBe(false);
    expect(result.rejections.some((r) => r.code === "tenant_scope_mismatch")).toBe(true);
  });

  it("denies the proposer approving their own action (independence)", () => {
    const action = makeAction();
    const result = evaluateApproverEligibility(
      action,
      eligibleApprover("agent:coregrid-agent-7"),
    );
    expect(result.eligible).toBe(false);
    expect(result.rejections.some((r) => r.code === "self_approval_rejected")).toBe(true);
  });
});

/* ────────────── Provenance ────────────── */

describe("approval record provenance (§12)", () => {
  it("records who approved what, under which policy, and expiry", () => {
    const action = makeAction();
    const record = approveHighRiskAction(action, eligibleApprover("human:alice"), {
      approvalId: "ap-1",
      decidedAt: APPROVED_AT,
      expiresAt: NEXT_DAY,
      evidence: "Approved per release checklist",
    });
    const provenance = approvalProvenance(record);
    expect(provenance.approvedBy).toBe("human:alice");
    expect(provenance.approvedWhat.actionId).toBe("act-001");
    expect(provenance.approvedWhat.actionDigest).toBe(action.actionDigest);
    expect(provenance.underPolicy).toBe("POL-HIGH-RISK-RELEASE");
    expect(provenance.decidedAt).toBe(APPROVED_AT);
    expect(provenance.expiresAt).toBe(NEXT_DAY);
    expect(record.approverCapabilities).toContain(APPROVER_CAPABILITY);
    expect(record.approverTenantId).toBe("tenant-a");
  });

  it("requires non-empty evidence and a future expiry at record time", () => {
    const action = makeAction();
    const approver = eligibleApprover("human:alice");
    expect(() =>
      approveHighRiskAction(action, approver, {
        approvalId: "ap-e1",
        decidedAt: APPROVED_AT,
        expiresAt: null,
        evidence: "  ",
      }),
    ).toThrowError(ApprovalChainError);
    expect(() =>
      approveHighRiskAction(action, approver, {
        approvalId: "ap-e2",
        decidedAt: APPROVED_AT,
        expiresAt: APPROVED_AT,
        evidence: "expiry not in the future of decision",
      }),
    ).toThrowError(ApprovalChainError);
  });
});

/* ────────────── The fail-closed executor gate ────────────── */

describe("fail-closed executor gate (J-032 Decision → Action closure)", () => {
  it("DENIES + audits an action with a missing approval", () => {
    const action = makeAction();
    const approvals = twoPersonChain(action).slice(0, 1);

    const result = gateHighRiskActionExecution(action, approvals, EXECUTE_AT);
    expect(result.decision).toBe("DENIED");
    expect(result.audit.decision).toBe("DENIED");
    expect(
      result.audit.reasons.some((reason) => reason.startsWith("chain_depth_unmet")),
    ).toBe(true);
    // The denial itself is audited.
    expect(result.audit.actionId).toBe("act-001");
    expect(result.audit.auditId).toMatch(/^sha256:/);
  });

  it("DENIES + audits a completely unapproved action", () => {
    const action = makeAction();
    const result = gateHighRiskActionExecution(action, [], EXECUTE_AT);
    expect(result.decision).toBe("DENIED");
    expect(
      result.audit.reasons.some((reason) => reason.startsWith("chain_depth_unmet")),
    ).toBe(true);
  });

  it("DENIES self-approval at record time and at the gate", () => {
    const action = makeAction();
    // Record time: the proposing AI identity cannot approve.
    expect(() =>
      approveHighRiskAction(action, eligibleApprover("agent:coregrid-agent-7"), {
        approvalId: "ap-self",
        decidedAt: APPROVED_AT,
        expiresAt: null,
        evidence: "self-approval attempt",
      }),
    ).toThrowError(ApprovalChainError);

    // Gate time: a forged proposer approval record cannot satisfy the chain.
    const forged: ApprovalRecord = {
      approvalId: "ap-forged",
      actionId: action.actionId,
      actionDigest: action.actionDigest,
      approverRef: "agent:coregrid-agent-7",
      identityKind: "human",
      approverTenantId: action.tenantId,
      approverCapabilities: [APPROVER_CAPABILITY],
      policyId: action.policyId,
      decidedAt: APPROVED_AT,
      expiresAt: null,
      evidence: "forged",
    };
    const extra = twoPersonChain(action)[0];
    const result = gateHighRiskActionExecution(action, [forged, extra], EXECUTE_AT);
    expect(result.decision).toBe("DENIED");
    expect(result.audit.reasons.some((reason) => reason.startsWith("self_approval_rejected"))).toBe(
      true,
    );
  });

  it("DENIES + audits an expired approval, evaluated at execution time", () => {
    const action = makeAction();
    const approvals = twoPersonChain(action);

    // Before expiry the chain holds...
    expect(approvalChainSatisfied(action, approvals, EXECUTE_AT)).toBe(true);
    // ...after expiry it voids, without any new information.
    const result = gateHighRiskActionExecution(action, approvals, NEXT_DAY);
    expect(result.decision).toBe("DENIED");
    expect(result.audit.reasons.some((reason) => reason.startsWith("approval_expired"))).toBe(
      true,
    );
  });

  it("DENIES + audits a wrong-tenant approver even inside a forged record", () => {
    const action = makeAction();
    const wrongTenant: ApprovalRecord = {
      ...approveHighRiskAction(action, eligibleApprover("human:alice"), {
        approvalId: "ap-wt",
        decidedAt: APPROVED_AT,
        expiresAt: NEXT_DAY,
        evidence: "approved",
      }),
      approverTenantId: "tenant-b",
    };
    const second = twoPersonChain(action)[1];
    const result = gateHighRiskActionExecution(action, [wrongTenant, second], EXECUTE_AT);
    expect(result.decision).toBe("DENIED");
    expect(
      result.audit.reasons.some((reason) => reason.startsWith("tenant_scope_mismatch")),
    ).toBe(true);
  });

  it("DENIES when the action content changed since approval (digest mismatch)", () => {
    const action = makeAction();
    const approvals = twoPersonChain(action);
    const tampered = { ...action, actionDigest: "sha256:deadbeef" };
    const result = gateHighRiskActionExecution(tampered, approvals, EXECUTE_AT);
    expect(result.decision).toBe("DENIED");
    expect(result.audit.reasons.some((reason) => reason.startsWith("digest_mismatch"))).toBe(
      true,
    );
  });

  it("denies duplicate approvals from the same approver (independence)", () => {
    const action = makeAction();
    const first = approveHighRiskAction(action, eligibleApprover("human:alice"), {
      approvalId: "ap-1",
      decidedAt: APPROVED_AT,
      expiresAt: NEXT_DAY,
      evidence: "approved once",
    });
    const again = approveHighRiskAction(action, eligibleApprover("human:alice"), {
      approvalId: "ap-1-again",
      decidedAt: APPROVED_AT,
      expiresAt: NEXT_DAY,
      evidence: "same approver twice",
    });
    const result = gateHighRiskActionExecution(action, [first, again], EXECUTE_AT);
    expect(result.decision).toBe("DENIED");
    expect(result.audit.reasons.some((reason) => reason.startsWith("duplicate_approver"))).toBe(
      true,
    );
  });

  it("ALLOWS a valid independent unexpired chain and leaves the approval audit", () => {
    const action = makeAction();
    const approvals = twoPersonChain(action);
    expect(approvalChainSatisfied(action, approvals, EXECUTE_AT)).toBe(true);

    const result = gateHighRiskActionExecution(action, approvals, EXECUTE_AT);
    expect(result.decision).toBe("ALLOWED");
    expect(result.audit.decision).toBe("ALLOWED");
    // The audit binds the full approval provenance: who, what, which policy.
    expect(result.audit.approvalRefs).toEqual(["ap-1", "ap-2"]);
    expect(result.audit.approverRefs).toEqual(["human:alice", "human:bob"]);
    expect(result.audit.policyId).toBe("POL-HIGH-RISK-RELEASE");
    expect(result.audit.actionDigest).toBe(action.actionDigest);
    expect(result.audit.tenantId).toBe("tenant-a");
    expect(result.audit.riskClass).toBe("high-risk");
    expect(result.audit.mandatedDepth).toBe("two-person");
    expect(result.audit.reasons).toEqual([]);
  });

  it("requires quorum depth for a critical action and audits the allow", () => {
    const action = makeAction({ riskClass: "critical", actionId: "act-critical" });

    // A two-person chain is not enough for quorum.
    const shallow = twoPersonChain(action);
    expect(gateHighRiskActionExecution(action, shallow, EXECUTE_AT).decision).toBe("DENIED");

    const quorum = [
      ...shallow,
      approveHighRiskAction(action, eligibleApprover("human:carol"), {
        approvalId: "ap-3",
        decidedAt: APPROVED_AT,
        expiresAt: null,
        evidence: "Third approver for quorum",
      }),
    ];
    const result = gateHighRiskActionExecution(action, quorum, EXECUTE_AT);
    expect(result.decision).toBe("ALLOWED");
    expect(result.audit.mandatedDepth).toBe("quorum");
    expect(result.audit.approverRefs).toEqual([
      "human:alice",
      "human:bob",
      "human:carol",
    ]);
  });

  it("is deterministic and pure: same inputs, same audit id, no wall-clock", () => {
    const action = makeAction();
    const approvals = twoPersonChain(action);
    const a = gateHighRiskActionExecution(action, approvals, EXECUTE_AT);
    const b = gateHighRiskActionExecution(action, approvals, EXECUTE_AT);
    expect(a.audit.auditId).toBe(b.audit.auditId);
    expect(a).toEqual(b);
    expect(Object.isFrozen(a.audit)).toBe(true);
  });

  it("exposes the schema version constant", () => {
    expect(APPROVAL_CHAINS_SCHEMA_VERSION).toBe("1.0");
  });
});
