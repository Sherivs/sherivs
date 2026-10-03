/**
 * CoreGrid — H3-058 evolution-engine contract tests (mission G-058).
 * Phase-38 substrate surface: no-second-engine binding (ADR PLATFORM-004),
 * AGENTS §8 self-improvement law (improvement ≠ permission expansion), the
 * AGENTS §21 governed gate chain, proposer/approver independence, staged
 * reversibility, and fail-closed invariant verification.
 * Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import { PHASE_38_EVOLUTION_ENGINE } from "../../frontend/src/lib/kernel/phase-contracts/phase-38-evolution-engine";
import {
  APPROVAL_AUTHORITIES,
  COMPOSABLE_CAPABILITIES,
  EVOLUTION_GATE_ORDER,
  EVOLUTION_PROGRAM_ID_PREFIX,
  MAX_INVARIANTS_PER_STAGE,
  MAX_STAGES_PER_PROGRAM,
  NO_SECOND_ENGINE_DETAIL,
  SELF_IMPROVEMENT_LAW,
  SELF_RATIFICATION_DETAIL,
  advanceGateChain,
  approvalEvidenceSchema,
  classifyProposalAutonomy,
  evaluateProgramCompletion,
  evaluateStageCompletion,
  invariantIdSchema,
  invariantVerificationSchema,
  parseEvolutionProgram,
  parseEvolutionProgramRegistry,
  ratifyProposal,
  transformationProposalSchema,
  type ChangeScope,
  type EvolutionGate,
  type EvolutionGateRun,
  type PermissionScopeImpact,
} from "../../frontend/src/lib/evolution-engine/contracts";

const NOW = "2026-10-03T00:00:00.000Z";

const PROVENANCE = {
  declaredBy: "agent:evolution-proposer",
  authority: "phase-38 kernel contract / H3 wave mission G-058",
  declaredAt: NOW,
};

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proposalId: "prop-001",
    title: "stage a substrate improvement",
    changeScope: "construction_surface",
    permissionScopeImpact: "no_access_change",
    impactEstimate: "derived estimate — intelligence, not authority",
    provenance: PROVENANCE,
    ...overrides,
  };
}

function stage(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stageIndex: index,
    summary: `stage ${index}`,
    rollbackPlan: `undo stage ${index} via the recorded reverse steps`,
    invariants: ["inv_schema_compatible"],
    ...overrides,
  };
}

function program(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    programId: "evolution38.staged_improvement",
    composedCapability: "evolution-lifecycle",
    proposal: proposal(),
    stages: [stage(0), stage(1)],
    provenance: PROVENANCE,
    ...overrides,
  };
}

function gateRun(
  gate: EvolutionGate,
  overrides: { outcome?: "passed" | "blocked"; actor?: string } = {},
): EvolutionGateRun {
  return { gate, outcome: "passed", actor: "gate-runner", at: NOW, ...overrides };
}

const FULL_GATE_CHAIN = EVOLUTION_GATE_ORDER.map((gate) => gateRun(gate));

describe("kernel binding (no second engine — ADR PLATFORM-004)", () => {
  it("binds to the phase-38 kernel contract read-only", () => {
    expect(PHASE_38_EVOLUTION_ENGINE.id).toBe("38");
    expect(PHASE_38_EVOLUTION_ENGINE.capabilities.owns).toEqual([]);
  });

  it("derives the composable capabilities from the kernel contract's declared consumption", () => {
    expect([...COMPOSABLE_CAPABILITIES]).toEqual([...PHASE_38_EVOLUTION_ENGINE.capabilities.consumes]);
  });

  it("keeps every program id inside the kernel contract namespace", () => {
    expect(EVOLUTION_PROGRAM_ID_PREFIX).toBe("evolution38.");
    expect(PHASE_38_EVOLUTION_ENGINE.contracts.provides.every((ref) => ref.id.startsWith("evolution38:"))).toBe(true);
  });

  it("carries the no-second-engine law as an explicit refusal, not a limitation", () => {
    expect(NO_SECOND_ENGINE_DETAIL).toContain("owns no kernel capability");
    expect(NO_SECOND_ENGINE_DETAIL).toContain("never register a new capability");
  });

  it("cross-checks approval-required operations against the kernel autonomy profile", () => {
    const kernelRequired = PHASE_38_EVOLUTION_ENGINE.asi.autonomy.requiresApprovalFor;
    for (const operation of ["program-activation", "migration-execution", "invariant-exception", "rollback-execution"]) {
      expect(kernelRequired).toContain(operation);
    }
  });
});

describe("transformation proposal schema", () => {
  it("accepts a complete proposal with scope, impact and provenance", () => {
    const parsed = transformationProposalSchema.safeParse(proposal());
    expect(parsed.success).toBe(true);
  });

  it("rejects anonymous proposals — provenance is mandatory (AGENTS §12)", () => {
    const anonymous = proposal();
    delete anonymous.provenance;
    expect(transformationProposalSchema.safeParse(anonymous).success).toBe(false);
  });

  it("rejects malformed timestamps and blank fields", () => {
    expect(
      transformationProposalSchema.safeParse(
        proposal({ provenance: { ...PROVENANCE, declaredAt: "yesterday" } }),
      ).success,
    ).toBe(false);
    expect(transformationProposalSchema.safeParse(proposal({ title: "   " })).success).toBe(false);
  });

  it("rejects unknown keys so undeclared semantics cannot leak in", () => {
    expect(transformationProposalSchema.safeParse(proposal({ selfRatifiable: true })).success).toBe(false);
    expect(transformationProposalSchema.safeParse(proposal({ ownsCapability: "my-thing" })).success).toBe(false);
  });
});

describe("permission classification (AGENTS §8 — improvement is not permission expansion)", () => {
  const cases: readonly (readonly [ChangeScope, PermissionScopeImpact])[] = [
    ["read_only_analysis", "no_access_change"],
    ["derived_artifact", "no_access_change"],
    ["construction_surface", "no_access_change"],
    ["construction_surface", "access_widening"],
    ["security_boundary", "no_access_change"],
    ["security_boundary", "access_widening"],
  ];

  it("never returns ALLOW for access widening or boundary-touching work", () => {
    for (const [changeScope, permissionScopeImpact] of cases) {
      const decision = classifyProposalAutonomy({ changeScope, permissionScopeImpact });
      if (permissionScopeImpact === "access_widening" || changeScope === "security_boundary") {
        expect(decision.status).toBe("ESCALATE");
      } else {
        expect(decision.status).not.toBe("ESCALATE");
      }
    }
  });

  it("escalates a security-boundary proposal even when it claims no access change (fail-closed)", () => {
    const decision = classifyProposalAutonomy({
      changeScope: "security_boundary",
      permissionScopeImpact: "no_access_change",
    });
    expect(decision.status).toBe("ESCALATE");
    if (decision.status === "ESCALATE") {
      expect(decision.reason).toBe("security_boundary_scope");
    }
  });

  it("escalates access widening in every scope", () => {
    for (const changeScope of ["read_only_analysis", "derived_artifact", "construction_surface"] as const) {
      const decision = classifyProposalAutonomy({ changeScope, permissionScopeImpact: "access_widening" });
      expect(decision.status).toBe("ESCALATE");
      if (decision.status === "ESCALATE") {
        expect(decision.reason).toBe("access_widening");
      }
    }
  });

  it("allows only read-only or derived work that provably changes no access", () => {
    for (const changeScope of ["read_only_analysis", "derived_artifact"] as const) {
      const decision = classifyProposalAutonomy({ changeScope, permissionScopeImpact: "no_access_change" });
      expect(decision.status).toBe("ALLOW");
      expect(decision.detail).toContain("grants nothing");
    }
  });

  it("requires approval for construction-surface work without access change", () => {
    const decision = classifyProposalAutonomy({
      changeScope: "construction_surface",
      permissionScopeImpact: "no_access_change",
    });
    expect(decision.status).toBe("REQUIRE_APPROVAL");
  });

  it("encodes the §8 law verbatim for audit", () => {
    expect(SELF_IMPROVEMENT_LAW).toContain("improvement is not permission expansion");
    expect(SELF_IMPROVEMENT_LAW).toContain("makes access-widening autonomous");
  });
});

describe("evolution program parsing (fail-closed, no partial programs)", () => {
  it("parses a valid program", () => {
    const result = parseEvolutionProgram(program());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.program.stages).toHaveLength(2);
      expect(result.program.composedCapability).toBe("evolution-lifecycle");
    }
  });

  it("rejects non-object and malformed inputs with structured issues", () => {
    for (const bad of [null, undefined, 42, "program", [], [program()]]) {
      const result = parseEvolutionProgram(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("invalid_shape");
        expect(result.issues.length).toBeGreaterThan(0);
        expect(typeof result.issues[0].path).toBe("string");
      }
    }
  });

  it("refuses program ids outside the phase-38 namespace", () => {
    for (const id of ["evolution37.thing", "Evolution38.thing", "evolution38.", "program", "evolution38.has space"]) {
      const result = parseEvolutionProgram(program({ programId: id }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((i) => i.message).join(" ")).toContain("namespace");
      }
    }
  });

  it("refuses capabilities phase 38 does not own or consume", () => {
    const result = parseEvolutionProgram(program({ composedCapability: "my-new-capability" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_shape");
    }
  });

  it("refuses stages without a rollback plan or declared invariants", () => {
    expect(parseEvolutionProgram(program({ stages: [stage(0, { rollbackPlan: "   " })] })).ok).toBe(false);
    expect(parseEvolutionProgram(program({ stages: [stage(0, { invariants: [] })] })).ok).toBe(false);
    expect(parseEvolutionProgram(program({ stages: [stage(0, { invariants: ["schema"] })] })).ok).toBe(false);
  });

  it("refuses stages above the bounded invariants ceiling", () => {
    const many = Array.from({ length: MAX_INVARIANTS_PER_STAGE + 1 }, (_, i) => `inv_invariant_${i}`);
    const result = parseEvolutionProgram(program({ stages: [stage(0, { invariants: many })] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_shape");
    }
  });

  it("refuses stage sequences that are not sequential from 0 without gaps or repeats", () => {
    const gapped = parseEvolutionProgram(program({ stages: [stage(0), stage(2)] }));
    expect(gapped.ok).toBe(false);
    if (!gapped.ok) expect(gapped.reason).toBe("cross_record_invariant");

    const duplicated = parseEvolutionProgram(program({ stages: [stage(0), stage(0)] }));
    expect(duplicated.ok).toBe(false);

    const reordered = parseEvolutionProgram(program({ stages: [stage(1), stage(0)] }));
    expect(reordered.ok).toBe(false);

    const unindexed = parseEvolutionProgram(program({ stages: [stage(7)] }));
    expect(unindexed.ok).toBe(false);
  });

  it("refuses programs above the bounded stage count", () => {
    const many = Array.from({ length: MAX_STAGES_PER_PROGRAM + 1 }, (_, i) => stage(i));
    const result = parseEvolutionProgram(program({ stages: many }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_shape");
    }
  });

  it("accepts a proposal-only program with no stages", () => {
    const result = parseEvolutionProgram(program({ stages: [] }));
    expect(result.ok).toBe(true);
  });
});

describe("registry parsing (fail-closed, no partial registries)", () => {
  it("parses a valid registry and rejects duplicate program identities", () => {
    const ok = parseEvolutionProgramRegistry({ programs: [program()] });
    expect(ok.ok).toBe(true);

    const duplicate = parseEvolutionProgramRegistry({
      programs: [program(), program({ proposal: proposal({ proposalId: "prop-002" }) })],
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.reason).toBe("cross_record_invariant");
      expect(duplicate.issues[0].message).toContain("duplicate");
    }
  });

  it("rejects registries above the bounded program count", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      program({ programId: `evolution38.program_${i}`, proposal: proposal({ proposalId: `prop-${i}` }) }),
    );
    const result = parseEvolutionProgramRegistry({ programs: many });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_shape");
    }
  });
});

describe("governed gate chain (AGENTS §21 — AI output is untrusted)", () => {
  it("walks the canonical order proposal → validation → policy check → approval → execution → audit", () => {
    expect([...EVOLUTION_GATE_ORDER]).toEqual([
      "proposal",
      "validation",
      "policy_check",
      "approval",
      "execution",
      "audit",
    ]);
  });

  it("starts every program at its first gate — an empty evidence set is open, never complete", () => {
    const progression = advanceGateChain([]);
    expect(progression.status).toBe("in_progress");
    if (progression.status === "in_progress") {
      expect(progression.next).toBe("proposal");
      expect(progression.passedSoFar).toEqual([]);
    }
  });

  it("names the next required gate from passed runs", () => {
    const progression = advanceGateChain(FULL_GATE_CHAIN.slice(0, 4));
    expect(progression.status).toBe("in_progress");
    if (progression.status === "in_progress") {
      expect(progression.next).toBe("execution");
    }
  });

  it("blocks out-of-order gates — later gates cannot be recorded past a gap", () => {
    const progression = advanceGateChain([gateRun("proposal"), gateRun("execution")]);
    expect(progression.status).toBe("blocked");
    if (progression.status === "blocked") {
      expect(progression.at).toBe("execution");
      expect(progression.reason).toContain("invalid gate sequence");
    }
  });

  it("terminates the chain at a blocked gate", () => {
    const progression = advanceGateChain([
      gateRun("proposal"),
      gateRun("validation", { outcome: "blocked", actor: "policy-engine" }),
      gateRun("policy_check"),
    ]);
    expect(progression.status).toBe("blocked");
    if (progression.status === "blocked") {
      expect(progression.at).toBe("validation");
      expect(progression.reason).toContain("terminates");
    }
  });

  it("completes only after every gate, audit last", () => {
    const progression = advanceGateChain(FULL_GATE_CHAIN);
    expect(progression.status).toBe("complete");
  });

  it("execution is unreachable without a prior approval gate", () => {
    const throughPolicy = advanceGateChain(FULL_GATE_CHAIN.slice(0, 3));
    expect(throughProposalNext(throughPolicy)).toBe("approval");
  });
});

function throughProposalNext(progression: ReturnType<typeof advanceGateChain>): string {
  if (progression.status === "in_progress") return progression.next;
  return `unexpected:${progression.status}`;
}

describe("independence (no self-ratification)", () => {
  const parsed = transformationProposalSchema.parse(proposal());

  it("closes an approval gate for an external approver", () => {
    const result = ratifyProposal(parsed, {
      approver: "human:governance-lead",
      authority: "human_governance",
      decidedAt: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses the proposer ratifying their own proposal", () => {
    const result = ratifyProposal(parsed, {
      approver: "agent:evolution-proposer",
      authority: "human_governance",
      decidedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("self_ratification");
      expect(result.detail).toBe(SELF_RATIFICATION_DETAIL);
      expect(SELF_RATIFICATION_DETAIL).toContain("authority to approve its own proposals");
    }
  });

  it("admits no proposing authority in the approval-authority vocabulary", () => {
    expect([...APPROVAL_AUTHORITIES]).toEqual(["human_governance", "phase_owner_review", "control_plane"]);
    for (const authority of ["proposing_agent", "self", "the_engine"]) {
      expect(
        approvalEvidenceSchema.safeParse({ approver: "human:x", authority, decidedAt: NOW }).success,
      ).toBe(false);
    }
  });

  it("refuses blank approvers and unknown keys (strict shape)", () => {
    expect(approvalEvidenceSchema.safeParse({ approver: "", authority: "human_governance", decidedAt: NOW }).success).toBe(false);
    expect(
      approvalEvidenceSchema.safeParse({ approver: "human:x", authority: "human_governance", decidedAt: NOW, extra: 1 }).success,
    ).toBe(false);
  });
});

describe("invariant verification (staged and reversible)", () => {
  const parsed = parseEvolutionProgram(program());
  const prog = parsed.ok ? parsed.program : null;
  if (prog === null) throw new Error("fixture program must parse");

  it("completes a stage only when every declared invariant is verified held", () => {
    const state = evaluateStageCompletion(prog, 0, [
      { stageIndex: 0, invariant: "inv_schema_compatible", outcome: "held", verifiedAt: NOW },
    ]);
    expect(state.complete).toBe(true);
    expect(state.detail).toContain("verified");
  });

  it("keeps a stage open when invariants are never verified", () => {
    const state = evaluateStageCompletion(prog, 0, []);
    expect(state.complete).toBe(false);
    expect(state.missing).toEqual(["inv_schema_compatible"]);
    expect(state.detail).toContain("fail-closed");
  });

  it("keeps a stage open for not-run and violated outcomes, naming each invariant", () => {
    for (const outcome of ["not_run", "violated"] as const) {
      const state = evaluateStageCompletion(prog, 0, [
        { stageIndex: 0, invariant: "inv_schema_compatible", outcome, verifiedAt: NOW },
      ]);
      expect(state.complete).toBe(false);
      if (outcome === "violated") expect(state.violated).toEqual(["inv_schema_compatible"]);
      else expect(state.notRun).toEqual(["inv_schema_compatible"]);
    }
  });

  it("refuses verifications naming no declared invariant (unknown ids fail closed)", () => {
    const state = evaluateStageCompletion(prog, 0, [
      { stageIndex: 0, invariant: "inv_undeclared_thing", outcome: "held", verifiedAt: NOW },
    ]);
    expect(state.complete).toBe(false);
    expect(state.unknown).toEqual(["inv_undeclared_thing"]);
  });

  it("fails closed for a stage index the program does not declare", () => {
    const state = evaluateStageCompletion(prog, 9, []);
    expect(state.complete).toBe(false);
    expect(state.detail).toContain("declares no stage");
  });

  it("rejects malformed verification records and malformed invariant ids", () => {
    expect(invariantVerificationSchema.safeParse({ stageIndex: 0, invariant: "inv_x", outcome: "held" }).success).toBe(false);
    expect(invariantVerificationSchema.safeParse({ stageIndex: -1, invariant: "inv_x", outcome: "held", verifiedAt: NOW }).success).toBe(false);
    expect(invariantIdSchema.safeParse("inv_x").success).toBe(true);
    expect(invariantIdSchema.safeParse("schema_compatible").success).toBe(false);
    expect(invariantIdSchema.safeParse("inv_").success).toBe(false);
  });
});

describe("program completion (gates AND stages must both hold)", () => {
  const parsed = parseEvolutionProgram(program());
  const prog = parsed.ok ? parsed.program : null;
  if (prog === null) throw new Error("fixture program must parse");

  const allStagesHeld = prog.stages.flatMap((s) =>
    s.invariants.map((inv) => ({ stageIndex: s.stageIndex, invariant: inv, outcome: "held" as const, verifiedAt: NOW })),
  );

  it("is never complete by default — empty evidence leaves it open at its first gate", () => {
    const state = evaluateProgramCompletion(prog, [], []);
    expect(state.complete).toBe(false);
    expect(state.gates.status).toBe("in_progress");
    expect(state.detail).toContain("fail-closed");
  });

  it("stays incomplete while any gate or any stage is unverified", () => {
    const partialGates = evaluateProgramCompletion(prog, FULL_GATE_CHAIN.slice(0, 4), allStagesHeld);
    expect(partialGates.complete).toBe(false);
    expect(partialGates.gates.status).toBe("in_progress");

    const allGates = evaluateProgramCompletion(prog, FULL_GATE_CHAIN, [
      { stageIndex: 0, invariant: "inv_schema_compatible", outcome: "held", verifiedAt: NOW },
    ]);
    expect(allGates.complete).toBe(false);
    expect(allGates.openStages).toEqual([1]);
  });

  it("completes only with the full gate chain and every stage invariant-verified", () => {
    const state = evaluateProgramCompletion(prog, FULL_GATE_CHAIN, allStagesHeld);
    expect(state.complete).toBe(true);
    expect(state.stagesComplete).toBe(true);
    expect(state.openStages).toEqual([]);
    expect(state.detail).toContain("complete");
  });

  it("refuses orphan verifications naming a stage the program does not declare", () => {
    const orphaned = [...allStagesHeld, { stageIndex: 9, invariant: "inv_schema_compatible", outcome: "held" as const, verifiedAt: NOW }];
    const state = evaluateProgramCompletion(prog, FULL_GATE_CHAIN, orphaned);
    expect(state.complete).toBe(false);
    expect(state.orphanVerifications).toEqual([9]);
    expect(state.detail).toContain("orphan verification");
  });
});
