/**
 * CoreGrid AI output trust pipeline tests (J-035 / V1CAP-030/032,
 * MISSION-R-34; Constitution §21).
 *
 * Validates frontend/src/lib/ai-gateway/output-trust-pipeline.ts:
 * - the full happy-path chain proposed → validated → policy-checked →
 *   approval → executed → audited with a receipt binding output digest +
 *   snapshot id + approval set;
 * - stage-failure rejections at every stage (fail-closed, stage recorded);
 * - no-bypass: missing stage, missing approver, AI approver, self-approval,
 *   expired approval voids the chain, revocation voids the chain;
 * - approval append-only (frozen records, ordered single occupancy);
 * - criticality tier chain-depth enforcement;
 * - the intelligence-snapshot ref validation interlock (J-015).
 */

import { describe, expect, it } from "vitest";
import type { AuthorizationDecision } from "@/lib/identity";
import {
  buildIntelligenceSnapshot,
  digestContent,
  type IntelligenceSnapshotInput,
} from "@/lib/ai-gateway/reasoning-provenance";
import {
  CRITICALITY_CHAIN_DEPTHS,
  TrustPipelineError,
  chainRejections,
  executeProposal,
  openTrustPipeline,
  recordApproval,
  recordPipelineAudit,
  recordPolicyDecision,
  recordProposalValidation,
  requiredApprovalDepth,
  revokeApproval,
  trustChainSatisfied,
  type TrustApprovalRequirement,
  type TrustPipeline,
} from "@/lib/ai-gateway/output-trust-pipeline";

const NOW = "2026-10-02T00:00:00.000Z";
const LATER = "2026-10-03T00:00:00.000Z";

const OUTPUT = { plan: ["step-1", "step-2"], confidence: 0.9 };

function makeSnapshot(overrides: Partial<IntelligenceSnapshotInput> = {}) {
  return buildIntelligenceSnapshot({
    tenantRef: "tenant-a",
    actorRef: "agent-orchestrator",
    agentRef: "agent-orchestrator",
    missionRef: "mission-1",
    purpose: "schedule optimization proposal",
    model: { id: "core-model-1", providerClass: "llm" },
    contextVersion: { traceId: "trace-1", assembledContent: "assembled context" },
    routing: {
      routedViaRegistry: true,
      rationale: [
        { stage: "registry_route_resolved", model: "core-model-1", detail: "primary route healthy" },
      ],
    },
    usage: { tokensIn: 120, tokensOut: 40, estimatedCostUsd: 0.02 },
    output: OUTPUT,
    recordedAt: NOW,
    ...overrides,
  });
}

function requirements(...approverRefs: string[]): readonly TrustApprovalRequirement[] {
  return approverRefs.map((approverRef, position) => ({ position, approverRef }));
}

function openProposed(snapshot = makeSnapshot()): TrustPipeline {
  return openTrustPipeline({
    pipelineId: "pipe-1",
    tier: "medium",
    snapshot,
    approvalRequirements: requirements("human-principal"),
    openedAt: NOW,
  });
}

function openValidated(): TrustPipeline {
  return recordProposalValidation(openProposed(), {
    at: NOW,
    schemaOk: true,
    detail: "schema v1 conformance checked",
    rawOutput: OUTPUT,
  });
}

function openPolicyChecked(decision: AuthorizationDecision = "ALLOW"): TrustPipeline {
  return recordPolicyDecision(openValidated(), {
    at: NOW,
    decision: { decision, reason: `engine decision ${decision}` },
  });
}

function openFullyApproved(): TrustPipeline {
  const pipeline = openPolicyChecked();
  return recordApproval(pipeline, {
    approvalId: "appr-1",
    position: 0,
    approver: { kind: "human", humanRef: "human-principal", roleRef: "principal" },
    decidedAt: NOW,
    expiresAt: null,
    evidence: "reviewed plan against school timetable constraints",
  });
}

function expectTrustError(
  run: () => unknown,
  code: TrustPipelineError["code"],
  stage: TrustPipelineError["stage"],
): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TrustPipelineError);
  const trustError = caught as TrustPipelineError;
  expect(trustError.code).toBe(code);
  expect(trustError.stage).toBe(stage);
}

/* ─────────────────────────────────────────────────────────────
 * Happy path
 * ────────────────────────────────────────────────────────────*/

describe("happy path: full chain to audited", () => {
  it("walks every stage in order and emits a binding receipt", () => {
    const proposed = openProposed();
    expect(proposed.stage).toBe("proposed");
    expect(proposed.proposingIdentityRef).toBe("agent-orchestrator");

    const validated = recordProposalValidation(proposed, {
      at: NOW,
      schemaOk: true,
      detail: "schema v1 conformance checked",
      rawOutput: OUTPUT,
    });
    expect(validated.stage).toBe("validated");

    const policyChecked = recordPolicyDecision(validated, {
      at: NOW,
      decision: { decision: "ALLOW", reason: "granted by role" },
    });
    expect(policyChecked.stage).toBe("approval");
    expect(policyChecked.policyDecision?.decision).toBe("ALLOW");

    const approved = recordApproval(policyChecked, {
      approvalId: "appr-1",
      position: 0,
      approver: { kind: "human", humanRef: "human-principal", roleRef: "principal" },
      decidedAt: NOW,
      expiresAt: null,
      evidence: "reviewed plan against timetable constraints",
    });
    expect(approved.approvals).toHaveLength(1);

    const { pipeline: executed, receipt } = executeProposal(approved, {
      at: LATER,
      executorRef: "human-operator-1",
    });
    expect(executed.stage).toBe("executed");
    expect(executed.receipt).toEqual(receipt);

    const audited = recordPipelineAudit(executed, {
      at: LATER,
      auditRef: "audit-1",
      detail: "execution recorded in the audit log",
    });
    expect(audited.stage).toBe("audited");

    const kinds = audited.trail.map((event) => event.kind);
    expect(kinds).toEqual([
      "proposed",
      "validated",
      "policy_checked",
      "approval_recorded",
      "executed",
      "audited",
    ]);
  });

  it("binds the receipt to output digest + snapshot id + approval set", () => {
    const { receipt } = executeProposal(openFullyApproved(), {
      at: LATER,
      executorRef: "human-operator-1",
    });
    const snapshot = makeSnapshot();
    const approvalSetDigest = digestContent(openFullyApproved().approvals);
    expect(receipt.outputDigest).toBe(snapshot.outputDigest);
    expect(receipt.snapshotId).toBe(snapshot.snapshotId);
    expect(receipt.approvalSetDigest).toBe(approvalSetDigest);
    expect(receipt.approvedBy).toEqual([
      { position: 0, approvalId: "appr-1", approverRef: "human-principal" },
    ]);
    expect(receipt.receiptId).toBe(
      digestContent({
        pipelineId: "pipe-1",
        outputDigest: snapshot.outputDigest,
        snapshotId: snapshot.snapshotId,
        approvalSetDigest,
      }),
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * Stage-failure rejections (each stage)
 * ────────────────────────────────────────────────────────────*/

describe("stage-failure rejections", () => {
  it("rejects validation when not proposed", () => {
    const validated = openValidated();
    expectTrustError(
      () =>
        recordProposalValidation(validated, {
          at: NOW,
          schemaOk: true,
          detail: "duplicate validation",
        }),
      "invalid_stage",
      "validated",
    );
  });

  it("rejects schema validation failure with the validated stage recorded", () => {
    expectTrustError(
      () =>
        recordProposalValidation(openProposed(), {
          at: NOW,
          schemaOk: false,
          detail: "missing required field plan",
        }),
      "validation_failed",
      "validated",
    );
  });

  it("rejects raw output that does not match the snapshot digest", () => {
    expectTrustError(
      () =>
        recordProposalValidation(openProposed(), {
          at: NOW,
          schemaOk: true,
          detail: "digest check",
          rawOutput: { plan: ["tampered"] },
        }),
      "output_digest_mismatch",
      "validated",
    );
  });

  it("rejects a policy check before validation", () => {
    expectTrustError(
      () =>
        recordPolicyDecision(openProposed(), {
          at: NOW,
          decision: { decision: "ALLOW", reason: "premature" },
        }),
      "invalid_stage",
      "policy_checked",
    );
  });

  it("rejects DENY, REDACT and ESCALATE decisions as non-executable", () => {
    for (const decision of ["DENY", "REDACT", "ESCALATE"] as const) {
      expectTrustError(
        () =>
          recordPolicyDecision(openValidated(), {
            at: NOW,
            decision: { decision, reason: `${decision} by policy` },
          }),
        "policy_not_executable",
        "policy_checked",
      );
    }
  });

  it("rejects approvals before the policy check", () => {
    expectTrustError(
      () =>
        recordApproval(openValidated(), {
          approvalId: "appr-early",
          position: 0,
          approver: { kind: "human", humanRef: "human-principal", roleRef: "principal" },
          decidedAt: NOW,
          expiresAt: null,
          evidence: "premature approval",
        }),
      "invalid_stage",
      "approval",
    );
  });

  it("rejects execution before any later stage", () => {
    expectTrustError(
      () => executeProposal(openProposed(), { at: NOW, executorRef: "human-operator-1" }),
      "invalid_stage",
      "executed",
    );
    expectTrustError(
      () => executeProposal(openValidated(), { at: NOW, executorRef: "human-operator-1" }),
      "invalid_stage",
      "executed",
    );
  });

  it("rejects double execution and audits before execution", () => {
    const { pipeline: executed } = executeProposal(openFullyApproved(), {
      at: LATER,
      executorRef: "human-operator-1",
    });
    expectTrustError(
      () => executeProposal(executed, { at: LATER, executorRef: "human-operator-1" }),
      "invalid_stage",
      "executed",
    );
    expectTrustError(
      () =>
        recordPipelineAudit(openFullyApproved(), {
          at: NOW,
          auditRef: "audit-early",
          detail: "not executed yet",
        }),
      "invalid_stage",
      "audited",
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * No bypass
 * ────────────────────────────────────────────────────────────*/

describe("no bypass path", () => {
  it("honors REQUIRE_APPROVAL — never downgraded to allow, never executable unapproved", () => {
    const pipeline = recordPolicyDecision(openValidated(), {
      at: NOW,
      decision: { decision: "REQUIRE_APPROVAL", reason: "high-impact proposal" },
    });
    expect(pipeline.policyDecision?.decision).toBe("REQUIRE_APPROVAL");
    expect(pipeline.stage).toBe("approval");
    expectTrustError(
      () => executeProposal(pipeline, { at: LATER, executorRef: "human-operator-1" }),
      "chain_incomplete",
      "executed",
    );
  });

  it("cannot execute with a missing approver (chain incomplete)", () => {
    const pipeline = openPolicyChecked();
    expectTrustError(
      () => executeProposal(pipeline, { at: LATER, executorRef: "human-operator-1" }),
      "chain_incomplete",
      "executed",
    );
    expect(chainRejections(pipeline, LATER)).toEqual([
      'position 0 has no approval from "human-principal"',
    ]);
    expect(trustChainSatisfied(pipeline, LATER)).toBe(false);
  });

  it("rejects an AI approver", () => {
    expectTrustError(
      () =>
        recordApproval(openPolicyChecked(), {
          approvalId: "appr-ai",
          position: 0,
          approver: { kind: "ai", agentRef: "agent-orchestrator" },
          decidedAt: NOW,
          expiresAt: null,
          evidence: "the proposing agent approves itself",
        }),
      "ai_approver_rejected",
      "approval",
    );
  });

  it("rejects self-approval by the proposing AI identity", () => {
    expectTrustError(
      () =>
        recordApproval(openPolicyChecked(), {
          approvalId: "appr-self",
          position: 0,
          approver: { kind: "human", humanRef: "agent-orchestrator", roleRef: "ai_engineer" },
          decidedAt: NOW,
          expiresAt: null,
          evidence: "impersonating a human",
        }),
      "self_approval_rejected",
      "approval",
    );
  });

  it("rejects an approver that does not match the identity-bound requirement", () => {
    expectTrustError(
      () =>
        recordApproval(openPolicyChecked(), {
          approvalId: "appr-other",
          position: 0,
          approver: { kind: "human", humanRef: "human-other", roleRef: "principal" },
          decidedAt: NOW,
          expiresAt: null,
          evidence: "wrong human",
        }),
      "approver_identity_mismatch",
      "approval",
    );
  });

  it("rejects an approval without evidence", () => {
    expectTrustError(
      () =>
        recordApproval(openPolicyChecked(), {
          approvalId: "appr-no-evidence",
          position: 0,
          approver: { kind: "human", humanRef: "human-principal", roleRef: "principal" },
          decidedAt: NOW,
          expiresAt: null,
          evidence: "   ",
        }),
      "approval_evidence_required",
      "approval",
    );
  });

  it("an expired approval voids the chain at execution time", () => {
    const approved = recordApproval(openPolicyChecked(), {
      approvalId: "appr-expiring",
      position: 0,
      approver: { kind: "human", humanRef: "human-principal", roleRef: "principal" },
      decidedAt: NOW,
      expiresAt: "2026-10-02T12:00:00.000Z",
      evidence: "approved, but the mandate lapses",
    });
    expect(trustChainSatisfied(approved, NOW)).toBe(true);
    expectTrustError(
      () => executeProposal(approved, { at: "2026-10-02T12:00:01.000Z", executorRef: "human-operator-1" }),
      "chain_incomplete",
      "executed",
    );
  });

  it("a revoked approval voids the chain", () => {
    const approved = recordApproval(openPolicyChecked(), {
      approvalId: "appr-revocable",
      position: 0,
      approver: { kind: "human", humanRef: "human-principal", roleRef: "principal" },
      decidedAt: NOW,
      expiresAt: null,
      evidence: "approved",
    });
    expect(trustChainSatisfied(approved, LATER)).toBe(true);

    const revoked = revokeApproval(approved, {
      approvalId: "appr-revocable",
      revokedAt: NOW,
      revokedBy: "human-compliance",
      reason: "approver mandate withdrawn",
    });
    expect(revoked.revocations).toHaveLength(1);
    expect(revoked.approvals).toHaveLength(1);
    expectTrustError(
      () => executeProposal(revoked, { at: LATER, executorRef: "human-operator-1" }),
      "chain_incomplete",
      "executed",
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * Receipt binding + append-only
 * ────────────────────────────────────────────────────────────*/

describe("receipt binding", () => {
  it("changes content-address when the approval set changes", () => {
    const snapshot = makeSnapshot();
    const buildChain = (approverRef: string, approvalId: string): TrustPipeline => {
      const opened = openTrustPipeline({
        pipelineId: "pipe-a",
        tier: "medium",
        snapshot,
        approvalRequirements: requirements(approverRef),
        openedAt: NOW,
      });
      const validated = recordProposalValidation(opened, {
        at: NOW,
        schemaOk: true,
        detail: "schema v1 conformance checked",
        rawOutput: OUTPUT,
      });
      const policyChecked = recordPolicyDecision(validated, {
        at: NOW,
        decision: { decision: "ALLOW", reason: "granted" },
      });
      return recordApproval(policyChecked, {
        approvalId,
        position: 0,
        approver: { kind: "human", humanRef: approverRef, roleRef: "principal" },
        decidedAt: NOW,
        expiresAt: null,
        evidence: "ok",
      });
    };

    const chainA = executeProposal(buildChain("human-principal", "appr-a"), {
      at: LATER,
      executorRef: "human-operator-1",
    }).receipt;
    const chainB = executeProposal(buildChain("human-vice-principal", "appr-b"), {
      at: LATER,
      executorRef: "human-operator-1",
    }).receipt;

    expect(chainA.approvalSetDigest).not.toBe(chainB.approvalSetDigest);
    expect(chainA.receiptId).not.toBe(chainB.receiptId);
  });
});

describe("approval append-only", () => {
  it("freezes the pipeline, approvals and trail", () => {
    const approved = openFullyApproved();
    expect(Object.isFrozen(approved)).toBe(true);
    expect(Object.isFrozen(approved.approvals)).toBe(true);
    expect(Object.isFrozen(approved.trail)).toBe(true);
    expect(Object.isFrozen(approved.approvals[0])).toBe(true);
  });

  it("rejects a second approval for an occupied position", () => {
    expectTrustError(
      () =>
        recordApproval(openFullyApproved(), {
          approvalId: "appr-duplicate",
          position: 0,
          approver: { kind: "human", humanRef: "human-principal", roleRef: "principal" },
          decidedAt: NOW,
          expiresAt: null,
          evidence: "duplicate",
        }),
      "position_out_of_order",
      "approval",
    );
  });

  it("rejects a duplicated approvalId and a double revocation", () => {
    const approved = openFullyApproved();
    expectTrustError(
      () =>
        recordApproval(approved, {
          approvalId: "appr-1",
          position: 0,
          approver: { kind: "human", humanRef: "human-principal", roleRef: "principal" },
          decidedAt: NOW,
          expiresAt: null,
          evidence: "same id",
        }),
      "append_only_violation",
      "approval",
    );
    const revoked = revokeApproval(approved, {
      approvalId: "appr-1",
      revokedAt: NOW,
      revokedBy: "human-compliance",
      reason: "withdrawn",
    });
    expectTrustError(
      () =>
        revokeApproval(revoked, {
          approvalId: "appr-1",
          revokedAt: NOW,
          revokedBy: "human-compliance",
          reason: "again",
        }),
      "append_only_violation",
      "approval",
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * Criticality depth + REQUIRE_APPROVAL honoring
 * ────────────────────────────────────────────────────────────*/

describe("criticality depth enforcement", () => {
  it("declares monotonically non-decreasing chain depths", () => {
    expect(CRITICALITY_CHAIN_DEPTHS.low).toBe(1);
    expect(CRITICALITY_CHAIN_DEPTHS.medium).toBe(1);
    expect(CRITICALITY_CHAIN_DEPTHS.high).toBe(2);
    expect(CRITICALITY_CHAIN_DEPTHS.critical).toBe(3);
    expect(requiredApprovalDepth("critical")).toBe(3);
  });

  it("rejects a pipeline shallower than its tier depth at open", () => {
    expectTrustError(
      () =>
        openTrustPipeline({
          pipelineId: "pipe-shallow",
          tier: "critical",
          snapshot: makeSnapshot(),
          approvalRequirements: requirements("human-a", "human-b"),
          openedAt: NOW,
        }),
      "criticality_depth_unmet",
      "proposed",
    );
  });

  it("critical tier cannot execute until every required approval is present", () => {
    const snapshot = makeSnapshot();
    let pipeline = openTrustPipeline({
      pipelineId: "pipe-critical",
      tier: "critical",
      snapshot,
      approvalRequirements: requirements("human-a", "human-b", "human-c"),
      openedAt: NOW,
    });
    pipeline = recordProposalValidation(pipeline, {
      at: NOW,
      schemaOk: true,
      detail: "validated",
      rawOutput: OUTPUT,
    });
    pipeline = recordPolicyDecision(pipeline, {
      at: NOW,
      decision: { decision: "REQUIRE_APPROVAL", reason: "critical tier proposal" },
    });

    const approve = (position: number, humanRef: string, approvalId: string): TrustPipeline =>
      recordApproval(pipeline, {
        approvalId,
        position,
        approver: { kind: "human", humanRef, roleRef: "principal" },
        decidedAt: NOW,
        expiresAt: null,
        evidence: `position ${position} reviewed`,
      });

    pipeline = approve(0, "human-a", "appr-a");
    expectTrustError(
      () => executeProposal(pipeline, { at: LATER, executorRef: "human-operator-1" }),
      "chain_incomplete",
      "executed",
    );

    pipeline = approve(1, "human-b", "appr-b");
    expectTrustError(
      () => executeProposal(pipeline, { at: LATER, executorRef: "human-operator-1" }),
      "chain_incomplete",
      "executed",
    );

    pipeline = approve(2, "human-c", "appr-c");
    const { receipt } = executeProposal(pipeline, { at: LATER, executorRef: "human-operator-1" });
    expect(receipt.approvedBy).toHaveLength(3);
    expect(trustChainSatisfied(pipeline, LATER)).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Snapshot-ref validation interlock (J-015)
 * ────────────────────────────────────────────────────────────*/

describe("snapshot-ref validation interlock", () => {
  it("rejects a pipeline opened without a valid intelligence snapshot", () => {
    expectTrustError(
      () =>
        openTrustPipeline({
          pipelineId: "pipe-no-snapshot",
          tier: "low",
          snapshot: null,
          approvalRequirements: requirements("human-a"),
          openedAt: NOW,
        }),
      "invalid_snapshot_ref",
      "proposed",
    );
  });

  it("rejects a tampered snapshot ref (dropped provenance)", () => {
    const snapshot = makeSnapshot();
    const tampered = { ...snapshot, generatedByAi: false } as unknown;
    expectTrustError(
      () =>
        openTrustPipeline({
          pipelineId: "pipe-tampered",
          tier: "low",
          snapshot: tampered,
          approvalRequirements: requirements("human-a"),
          openedAt: NOW,
        }),
      "invalid_snapshot_ref",
      "proposed",
    );
  });

  it("accepts a genuine snapshot and keeps it immutable on the pipeline", () => {
    const pipeline = openProposed();
    expect(pipeline.snapshot.evidenceClass).toBe("generated");
    expect(pipeline.snapshot.generatedByAi).toBe(true);
    expect(Object.isFrozen(pipeline.snapshot)).toBe(true);
  });
});
