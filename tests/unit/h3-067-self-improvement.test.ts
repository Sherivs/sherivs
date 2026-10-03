/**
 * CoreGrid — H3-067 self-improvement contract tests (mission G-067).
 * Zod validation of phase-47 governed improvement-loop contracts: observed
 * engineering signals, evidenced proposals with named change and rollback,
 * the structural AGENTS §8 encoding (protected change classes always require
 * human review), verification runs over the chain, staging records that
 * deploy and ratify nothing, the no-self-approval ratification gate, and the
 * fail-closed staging gate. Pure offline: no network, no database, no
 * secrets.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_AFFECTED_SURFACES,
  MAX_EVIDENCE_PER_RECORD,
  MAX_PROPOSALS_PER_SET,
  MAX_SIGNAL_REFS_PER_PROPOSAL,
  REVIEW_KIND_BY_SURFACE,
  SELF_IMPROVEMENT_BOUNDARY,
  SELF_IMPROVEMENT_LAW,
  SEVERITY_ORDER,
  STATEMENT_MAX_LENGTH,
  classifyChangeReview,
  decideRatification,
  gateStaging,
  improvementProposalSchema,
  improvementSignalSchema,
  parseImprovementProposals,
  ratificationSchema,
  severityAtLeast,
  stagingRecordSchema,
  summarizeLoop,
  verificationRunSchema,
  type ImprovementProposal,
  type VerificationRun,
} from "../../frontend/src/lib/self-improvement/contracts";

const DECLARED_AT = "2026-10-03T00:00:00.000Z";
const OBSERVED_AT = "2026-10-03T01:00:00.000Z";
const RAN_AT = "2026-10-03T02:00:00.000Z";

const PROVENANCE = {
  declaredBy: "role:contract-architect",
  authority: "AGENTS.md §42 / H3 wave mission G-067",
  declaredAt: DECLARED_AT,
};

const AGENT_AUTHOR = {
  subjectRef: "agent:improvement-worker-3",
  subjectKind: "autonomous_agent",
};

function evidence(ref: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    evidenceRef: ref,
    evidenceKind: "record_reference",
    capturedAt: OBSERVED_AT,
    capturedBy: "role:engineering-observer",
    ...overrides,
  };
}

function signal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signalId: "sig_regression_in_gate",
    signalKind: "defect_observed",
    severity: "warning",
    statement: "the verification gate reported a failed gate while the run outcome claimed passed",
    evidence: [evidence("obs_001")],
    observedBy: AGENT_AUTHOR,
    observedAt: OBSERVED_AT,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function review(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    humanApprovalRequired: true,
    requiredReviewKinds: ["security_review"],
    reviewRationale: "the change touches a protected surface, so human approval is mandatory",
    ...overrides,
  };
}

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proposalId: "prop_tighten_gate_outcome",
    statement: "the verification gate can report a pass while a gate failed",
    signalRefs: ["sig_regression_in_gate"],
    proposedChange: "make the run outcome derivation require every gate to have passed",
    rollbackPlan: "restore the previous outcome derivation from the staging record",
    affectedSurfaces: [],
    author: AGENT_AUTHOR,
    authoredAt: DECLARED_AT,
    status: "submitted",
    provenance: PROVENANCE,
    ...overrides,
  };
}

function gate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gateId: "gate_test_chain",
    gateKind: "test_chain",
    outcome: "passed",
    resultRef: "res_gate_001",
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "run_001",
    proposalId: "prop_tighten_gate_outcome",
    gates: [gate()],
    outcome: "passed",
    ranBy: AGENT_AUTHOR,
    ranAt: RAN_AT,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function staging(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stagingId: "stage_001",
    proposalId: "prop_tighten_gate_outcome",
    verificationRunId: "run_001",
    stagedBy: AGENT_AUTHOR,
    stagedAt: RAN_AT,
    status: "staged",
    deploys: false,
    ratifies: false,
    ...overrides,
  };
}

function ratification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proposalId: "prop_tighten_gate_outcome",
    ratifierRef: "human:platform-steward",
    ratifierKind: "human",
    ratifierAuthority: "governance review board",
    decidedAt: RAN_AT,
    decision: "approved",
    note: "reviewed the evidence and the rollback plan",
    ...overrides,
  };
}

function typedProposal(overrides: Record<string, unknown> = {}): ImprovementProposal {
  const parsed = improvementProposalSchema.safeParse(proposal(overrides));
  if (!parsed.success) throw new Error("fixture proposal must parse");
  return parsed.data;
}

function typedRun(overrides: Record<string, unknown> = {}): VerificationRun {
  const parsed = verificationRunSchema.safeParse(run(overrides));
  if (!parsed.success) throw new Error("fixture run must parse");
  return parsed.data;
}

describe("self-improvement law constants", () => {
  it("encodes the AGENTS §8 law with all five protected change classes", () => {
    expect(SELF_IMPROVEMENT_LAW).toContain("security");
    expect(SELF_IMPROVEMENT_LAW).toContain("authorization");
    expect(SELF_IMPROVEMENT_LAW).toContain("identity");
    expect(SELF_IMPROVEMENT_LAW).toContain("data access");
    expect(SELF_IMPROVEMENT_LAW).toContain("production behavior");
    expect(SELF_IMPROVEMENT_LAW).toContain("review and validation");
  });

  it("encodes the propose-and-stage boundary: never ratify, deploy, or expand permissions", () => {
    expect(SELF_IMPROVEMENT_BOUNDARY).toContain("never ratifies");
    expect(SELF_IMPROVEMENT_BOUNDARY).toContain("deploys");
    expect(SELF_IMPROVEMENT_BOUNDARY).toContain("human-owned");
  });

  it("maps every protected surface to at least one review kind", () => {
    const surfaces = Object.keys(REVIEW_KIND_BY_SURFACE) as (keyof typeof REVIEW_KIND_BY_SURFACE)[];
    expect(surfaces).toHaveLength(5);
    for (const surface of surfaces) {
      expect(REVIEW_KIND_BY_SURFACE[surface].length).toBeGreaterThan(0);
    }
  });
});

describe("improvement signal schema", () => {
  it("parses an evidenced signal", () => {
    const parsed = improvementSignalSchema.safeParse(signal());
    expect(parsed.success).toBe(true);
  });

  it("rejects a signal without evidence — nothing is observed from nothing", () => {
    const parsed = improvementSignalSchema.safeParse(signal({ evidence: [] }));
    expect(parsed.success).toBe(false);
  });

  it("rejects a detected regression at severity info — regressions are at least notices", () => {
    const parsed = improvementSignalSchema.safeParse(
      signal({ signalKind: "regression_detected", severity: "info" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects unbounded evidence sets", () => {
    const tooMany = Array.from({ length: MAX_EVIDENCE_PER_RECORD + 1 }, (_, i) =>
      evidence(`obs_${String(i).padStart(3, "0")}`),
    );
    const parsed = improvementSignalSchema.safeParse(signal({ evidence: tooMany }));
    expect(parsed.success).toBe(false);
  });
});

describe("improvement proposal schema", () => {
  it("parses an evidenced, reversible routine proposal", () => {
    const parsed = improvementProposalSchema.safeParse(proposal());
    expect(parsed.success).toBe(true);
  });

  it("rejects a proposal without cited signals — nothing is proposed from nothing", () => {
    const parsed = improvementProposalSchema.safeParse(proposal({ signalRefs: [] }));
    expect(parsed.success).toBe(false);
  });

  it("rejects a proposal without a rollback plan — every improvement is reversible", () => {
    const parsed = improvementProposalSchema.safeParse(proposal({ rollbackPlan: undefined }));
    expect(parsed.success).toBe(false);
  });

  it("rejects a blank rollback plan", () => {
    const parsed = improvementProposalSchema.safeParse(proposal({ rollbackPlan: "   " }));
    expect(parsed.success).toBe(false);
  });

  it("rejects a human-authored proposal — this surface is machine-authored only", () => {
    const parsed = improvementProposalSchema.safeParse(
      proposal({ author: { subjectRef: "human:engineer", subjectKind: "human_initiated" } }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects unbounded statements", () => {
    const parsed = improvementProposalSchema.safeParse(
      proposal({ statement: "x".repeat(STATEMENT_MAX_LENGTH + 1) }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects unbounded signal references", () => {
    const tooMany = Array.from({ length: MAX_SIGNAL_REFS_PER_PROPOSAL + 1 }, (_, i) => `sig_${i}`);
    const parsed = improvementProposalSchema.safeParse(proposal({ signalRefs: tooMany }));
    expect(parsed.success).toBe(false);
  });

  it("cannot express an approved, ratified or deployed status — approval lives elsewhere", () => {
    for (const status of ["approved", "ratified", "deployed", "rejected"]) {
      const parsed = improvementProposalSchema.safeParse(proposal({ status }));
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects unknown fields (strict object posture)", () => {
    const parsed = improvementProposalSchema.safeParse(
      proposal({ autoApprove: true }),
    );
    expect(parsed.success).toBe(false);
  });
});

describe("AGENTS §8 structural encoding: protected changes always require review", () => {
  for (const surface of [
    "security_boundary",
    "authorization_model",
    "identity_system",
    "data_access",
    "production_behavior",
  ] as const) {
    it(`refuses a proposal touching "${surface}" without a review requirement`, () => {
      const parsed = improvementProposalSchema.safeParse(
        proposal({ affectedSurfaces: [surface] }),
      );
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const messages = parsed.error.issues.map((issue) => issue.message).join(" ");
        expect(messages).toContain("review requirement");
      }
    });
  }

  it("accepts a protected-class proposal only with a human-approval review requirement", () => {
    const parsed = improvementProposalSchema.safeParse(
      proposal({ affectedSurfaces: ["security_boundary"], review: review() }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.review?.humanApprovalRequired).toBe(true);
    }
  });

  it("refuses a review requirement claiming no human approval is needed (literal)", () => {
    const parsed = improvementProposalSchema.safeParse(
      proposal({
        affectedSurfaces: ["data_access"],
        review: review({ humanApprovalRequired: false }),
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("refuses a review requirement with no required review kinds", () => {
    const parsed = improvementProposalSchema.safeParse(
      proposal({
        affectedSurfaces: ["identity_system"],
        review: review({ requiredReviewKinds: [] }),
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("refuses a review requirement on a routine proposal (no affected surfaces)", () => {
    const parsed = improvementProposalSchema.safeParse(proposal({ review: review() }));
    expect(parsed.success).toBe(false);
  });

  it("refuses unbounded affected-surface declarations", () => {
    const surfaces = ["security_boundary"] as const;
    const tooMany = Array.from(
      { length: MAX_AFFECTED_SURFACES + 1 },
      () => surfaces[0],
    );
    const parsed = improvementProposalSchema.safeParse(
      proposal({
        affectedSurfaces: tooMany,
        review: review({ requiredReviewKinds: ["security_review"] }),
      }),
    );
    expect(parsed.success).toBe(false);
  });
});

describe("classifyChangeReview", () => {
  it("maps authorization-model changes to security and policy review", () => {
    const decision = classifyChangeReview(["authorization_model"]);
    expect(decision.classification).toBe("protected_change");
    expect(decision.humanApprovalRequired).toBe(true);
    expect(decision.requiredReviewKinds).toContain("security_review");
    expect(decision.requiredReviewKinds).toContain("policy_review");
  });

  it("unions review kinds across multiple protected surfaces", () => {
    const decision = classifyChangeReview(["data_access", "production_behavior"]);
    expect(decision.requiredReviewKinds).toContain("data_review");
    expect(decision.requiredReviewKinds).toContain("security_review");
    expect(decision.requiredReviewKinds).toContain("policy_review");
    expect(decision.requiredReviewKinds).toContain("architecture_review");
  });

  it("keeps routine changes on the verification chain, never exempt from it", () => {
    const decision = classifyChangeReview([]);
    expect(decision.classification).toBe("routine_change");
    expect(decision.humanApprovalRequired).toBe(false);
    expect(decision.detail).toContain("verification chain");
  });
});

describe("verification run schema", () => {
  it("parses a fully passed run", () => {
    const parsed = verificationRunSchema.safeParse(run());
    expect(parsed.success).toBe(true);
  });

  it("refuses a passed outcome while any gate failed or did not run — fail-closed", () => {
    const parsed = verificationRunSchema.safeParse(
      run({ gates: [gate(), gate({ gateId: "gate_boundary", outcome: "failed" })] }),
    );
    expect(parsed.success).toBe(false);
    const skipped = verificationRunSchema.safeParse(
      run({ gates: [gate(), gate({ gateId: "gate_boundary", outcome: "not_run" })] }),
    );
    expect(skipped.success).toBe(false);
  });

  it("refuses a failed outcome with no failing or skipped gate — outcomes follow evidence", () => {
    const parsed = verificationRunSchema.safeParse(run({ outcome: "failed" }));
    expect(parsed.success).toBe(false);
  });

  it("refuses a run without gates — nothing is verified by default", () => {
    const parsed = verificationRunSchema.safeParse(run({ gates: [] }));
    expect(parsed.success).toBe(false);
  });

  it("accepts a failed run backed by a failed gate", () => {
    const parsed = verificationRunSchema.safeParse(
      run({ outcome: "failed", gates: [gate({ outcome: "failed" })] }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("staging record schema", () => {
  it("parses a staged record that deploys and ratifies nothing", () => {
    const parsed = stagingRecordSchema.safeParse(staging());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.deploys).toBe(false);
      expect(parsed.data.ratifies).toBe(false);
    }
  });

  it("cannot express deployment or ratification intent (literal posture)", () => {
    expect(stagingRecordSchema.safeParse(staging({ deploys: true })).success).toBe(false);
    expect(stagingRecordSchema.safeParse(staging({ ratifies: true })).success).toBe(false);
  });

  it("requires a verification run reference — unverified changes cannot be staged", () => {
    const parsed = stagingRecordSchema.safeParse(staging({ verificationRunId: undefined }));
    expect(parsed.success).toBe(false);
  });

  it("requires a replacement reference on supersession", () => {
    const parsed = stagingRecordSchema.safeParse(staging({ status: "superseded" }));
    expect(parsed.success).toBe(false);
    const ok = stagingRecordSchema.safeParse(
      staging({ status: "superseded", supersededByStagingId: "stage_002" }),
    );
    expect(ok.success).toBe(true);
  });

  it("requires a human record for human withdrawal and forbids it otherwise", () => {
    const without = stagingRecordSchema.safeParse(staging({ status: "withdrawn_by_human" }));
    expect(without.success).toBe(false);
    const withRecord = stagingRecordSchema.safeParse(
      staging({
        status: "withdrawn_by_human",
        withdrawnByHuman: {
          humanRef: "human:platform-steward",
          decidedAt: RAN_AT,
          note: "change withdrawn pending ratification review",
        },
      }),
    );
    expect(withRecord.success).toBe(true);
    const stray = stagingRecordSchema.safeParse(
      staging({
        withdrawnByHuman: {
          humanRef: "human:platform-steward",
          decidedAt: RAN_AT,
          note: "stray withdrawal record on a staged item",
        },
      }),
    );
    expect(stray.success).toBe(false);
  });
});

describe("gateStaging — no staging without a passing, matching run", () => {
  it("accepts staging backed by a passing run for the same proposal", () => {
    const decision = gateStaging(stagingRecordSchema.parse(staging()), [typedRun()]);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.detail).toContain("deploy");
    }
  });

  it("blocks staging whose verification run does not exist", () => {
    const decision = gateStaging(stagingRecordSchema.parse(staging()), []);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("verification_run_missing");
  });

  it("blocks staging whose run verified a different proposal", () => {
    const otherRun = typedRun({ proposalId: "prop_other_change" });
    const decision = gateStaging(stagingRecordSchema.parse(staging()), [otherRun]);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("verification_run_mismatch");
  });

  it("blocks staging whose run did not pass — failures surface, never absorb", () => {
    const failedRun = typedRun({
      outcome: "failed",
      gates: [gate({ outcome: "failed" })],
    });
    const decision = gateStaging(stagingRecordSchema.parse(staging()), [failedRun]);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("verification_not_passed");
  });
});

describe("human ratification — no machine ratification, no self-approval", () => {
  it("parses a well-formed human ratification record", () => {
    expect(ratificationSchema.safeParse(ratification()).success).toBe(true);
  });

  it("cannot express a machine ratifier (ratifierKind is the literal human)", () => {
    expect(
      ratificationSchema.safeParse(ratification({ ratifierKind: "autonomous_agent" })).success,
    ).toBe(false);
  });

  it("rejects a malformed or machine-shaped ratification record (fail-closed)", () => {
    const proposal_ = typedProposal();
    const decision = decideRatification(proposal_, { ratifierRef: "agent:same-agent" });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("ratification_invalid");
  });

  it("rejects a ratification bound to a different proposal", () => {
    const proposal_ = typedProposal();
    const decision = decideRatification(
      proposal_,
      ratification({ proposalId: "prop_other_change" }),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("ratification_invalid");
  });

  it("forbids the proposal author from ratifying its own work", () => {
    const proposal_ = typedProposal();
    const decision = decideRatification(
      proposal_,
      ratification({ ratifierRef: AGENT_AUTHOR.subjectRef }),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("self_approval_forbidden");
  });

  it("accepts an independent human approval and states it ratifies nothing else", () => {
    const proposal_ = typedProposal();
    const decision = decideRatification(proposal_, ratification());
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.decision).toBe("approved");
      expect(decision.detail).toContain("deployment");
    }
  });

  it("accepts an independent human rejection — rejections surface, never absorb", () => {
    const proposal_ = typedProposal();
    const decision = decideRatification(
      proposal_,
      ratification({ decision: "rejected", note: "rollback plan insufficient" }),
    );
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.decision).toBe("rejected");
  });

  it("enforces ratification over a protected-class proposal too — approval stays human-only", () => {
    const protectedProposal = typedProposal({
      proposalId: "prop_widen_gate_scope",
      affectedSurfaces: ["authorization_model"],
      review: review({ requiredReviewKinds: ["security_review", "policy_review"] }),
    });
    const decision = decideRatification(
      protectedProposal,
      ratification({ proposalId: "prop_widen_gate_scope" }),
    );
    expect(decision.ok).toBe(true);
  });
});

describe("parseImprovementProposals — fail-closed batch parsing", () => {
  it("parses a valid batch", () => {
    const parsed = parseImprovementProposals([proposal(), proposal({ proposalId: "prop_second" })]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.proposals).toHaveLength(2);
  });

  it("parses an empty batch without inventing proposals", () => {
    const parsed = parseImprovementProposals([]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.proposals).toHaveLength(0);
  });

  it("rejects duplicate proposal ids — one id carries exactly one proposal", () => {
    const parsed = parseImprovementProposals([proposal(), proposal()]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("cross_record_invariant");
      expect(parsed.issues[0]?.message).toContain("duplicate");
    }
  });

  it("rejects malformed shape with structured issues and no partial set", () => {
    const parsed = parseImprovementProposals([proposal(), { proposalId: 7 }]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("invalid_shape");
      expect(parsed.issues.length).toBeGreaterThan(0);
    }
  });

  it("enforces the batch ceiling", () => {
    const tooMany = Array.from({ length: MAX_PROPOSALS_PER_SET + 1 }, (_, i) =>
      proposal({ proposalId: `prop_bulk_${i}` }),
    );
    const parsed = parseImprovementProposals(tooMany);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });
});

describe("summarizeLoop — unverified staging is a defect, never a pass", () => {
  it("reports a clean loop only when every staging record passes the gate", () => {
    const summary = summarizeLoop([typedProposal()], [typedRun()], [
      stagingRecordSchema.parse(staging()),
    ]);
    expect(summary.ok).toBe(true);
    expect(summary.verifiedStagingIds).toEqual(["stage_001"]);
    expect(summary.blockedStaging).toHaveLength(0);
    expect(summary.detail).toBeNull();
    expect(summary.submittedProposals).toBe(1);
  });

  it("counts protected-class proposals separately from routine ones", () => {
    const protectedProposal = typedProposal({
      proposalId: "prop_widen_gate_scope",
      affectedSurfaces: ["authorization_model"],
      review: review({ requiredReviewKinds: ["security_review", "policy_review"] }),
    });
    const summary = summarizeLoop([typedProposal(), protectedProposal], [], []);
    expect(summary.totalProposals).toBe(2);
    expect(summary.protectedChangeProposals).toBe(1);
    expect(summary.routineChangeProposals).toBe(1);
  });

  it("blocks the loop when staging lacks a passing run", () => {
    const summary = summarizeLoop([typedProposal()], [], [stagingRecordSchema.parse(staging())]);
    expect(summary.ok).toBe(false);
    expect(summary.blockedStaging[0]?.reason).toBe("verification_run_missing");
    expect(summary.detail).toContain("fail-closed");
  });

  it("tallies passed and failed runs without absorbing failures", () => {
    const failedRun = typedRun({
      runId: "run_002",
      outcome: "failed",
      gates: [gate({ outcome: "failed" })],
    });
    const summary = summarizeLoop([], [typedRun(), failedRun], []);
    expect(summary.passedRuns).toBe(1);
    expect(summary.failedRuns).toBe(1);
    expect(summary.ok).toBe(true);
  });
});

describe("severity ordering", () => {
  it("orders severities monotonically and evaluates thresholds", () => {
    expect(SEVERITY_ORDER.info).toBeLessThan(SEVERITY_ORDER.critical);
    expect(severityAtLeast("critical", "warning")).toBe(true);
    expect(severityAtLeast("notice", "warning")).toBe(false);
    expect(severityAtLeast("warning", "warning")).toBe(true);
  });
});