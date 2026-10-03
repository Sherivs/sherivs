/**
 * CoreGrid — phase 38 Evolution Engine substrate contracts
 * (H3 wave Squad G, mission G-058; Contract Architect).
 *
 * WHAT: a Zod-validated, fail-closed contract surface for the phase-38
 * substrate — evolution programs that compose platform capabilities owned
 * elsewhere, transformation proposals classified by permission impact, the
 * governed gate chain every proposal must traverse, staged migrations that
 * are reversible and invariant-verified, and the independence rule that the
 * proposer of a change can never ratify it.
 *
 * Laws of this module (each is test-enforced):
 * - No second engine (ADR PLATFORM-004): phase 38 owns no kernel capability
 *   of its own. Every program must compose a capability owned by another
 *   phase, and every program id lives inside this phase's kernel contract
 *   namespace. There is no schema path to register a new capability.
 * - Self-improvement is not permission expansion (AGENTS §8): a proposal
 *   that widens access or touches a security boundary is classified as such
 *   and can only escalate to governed review — never execute autonomously.
 *   There is no scope in which widening access is autonomous.
 * - Governed gate chain (AGENTS §21): proposal output is untrusted; a
 *   critical transformation moves through proposal → validation →
 *   policy check → approval → execution → audit, in that order, each step
 *   recorded with an actor. A blocked gate terminates the chain; later
 *   gates cannot be passed past a block or out of order.
 * - Independence: an evolution actor cannot approve its own proposal (the
 *   phase-38 kernel boundary statement), and approvals are only valid from
 *   external governance authorities.
 * - Staged and reversible: every migration stage carries a rollback plan
 *   and declares the invariants that must hold after it. A stage is
 *   complete only when every declared invariant is verified as held —
 *   missing, not-run, unknown, or violated invariants fail the stage.
 * - Canonical truth separation (AGENTS §9): programs own program, stage
 *   and verification records; impact estimates and recommendations are
 *   derived intelligence and never parsed as authority here.
 * - Fail-closed parsing: any shape or cross-record violation yields a typed
 *   failure with structured issues. A failed parse never yields a partial
 *   program or registry.
 *
 * Composed with platform primitives read-only: the phase-38 kernel contract
 * is imported for namespace binding and cross-checked, never modified.
 * Pure contract module: no I/O, no persistence, no vendor imports, no
 * wall-clock reads, no secrets. Neutral vocabulary only (J-037).
 */

import { z } from "zod";
import { PHASE_38_EVOLUTION_ENGINE } from "../kernel/phase-contracts/phase-38-evolution-engine";

/* ─────────────────────────────────────────────────────────────
 * Kernel binding (read-only composition, no second engine)
 * ────────────────────────────────────────────────────────────*/

/**
 * The kernel contract namespace every evolution program id must live in.
 * Programs outside this namespace are not phase-38 programs and are refused.
 */
export const EVOLUTION_PROGRAM_ID_PREFIX = "evolution38.";

const PROGRAM_ID_PATTERN = /^evolution38\.[a-z][a-z0-9_]{0,63}$/;

/**
 * Capabilities phase 38 may compose, exactly those the phase-38 kernel
 * contract declares as consumed. The engine creates capabilities for no one.
 */
export const COMPOSABLE_CAPABILITIES = [
  "evolution-lifecycle",
  "governance-alignment",
  "universal-reality-ontology",
] as const;

export type ComposableCapability = (typeof COMPOSABLE_CAPABILITIES)[number];

export const composableCapabilitySchema = z.enum(COMPOSABLE_CAPABILITIES);

/* ─────────────────────────────────────────────────────────────
 * Bounds (no unbounded evolution)
 * ────────────────────────────────────────────────────────────*/

/** Maximum migration stages in one program. */
export const MAX_STAGES_PER_PROGRAM = 64;

/** Maximum programs in one registry. */
export const MAX_PROGRAMS_PER_REGISTRY = 256;

/** Maximum declared invariants on one stage. */
export const MAX_INVARIANTS_PER_STAGE = 32;

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

const INVARIANT_ID_PATTERN = /^inv_[a-z][a-z0-9_]{0,63}$/;

export const evolutionProgramIdSchema = z
  .string()
  .regex(
    PROGRAM_ID_PATTERN,
    `programId must live in the phase-38 kernel contract namespace (${EVOLUTION_PROGRAM_ID_PREFIX}<name>) — there is no second evolution engine`,
  );

export type EvolutionProgramId = z.infer<typeof evolutionProgramIdSchema>;

export const invariantIdSchema = z
  .string()
  .regex(
    INVARIANT_ID_PATTERN,
    "invariant must be a snake_case identifier prefixed with inv_ (letters, digits, underscore; at most 64 characters)",
  );

export type InvariantId = z.infer<typeof invariantIdSchema>;

function nonEmptyString(label: string) {
  return z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`);
}

export const evolutionProvenanceSchema = z.strictObject({
  /** Who put the proposal/program forward (principal reference, not a secret). */
  declaredBy: nonEmptyString("provenance.declaredBy"),
  /** Under which authority it was put forward (AGENTS §43). */
  authority: nonEmptyString("provenance.authority"),
  /** ISO-8601 timestamp of the declaration. */
  declaredAt: z.string().datetime(),
});

export type EvolutionProvenance = z.infer<typeof evolutionProvenanceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Permission classification (AGENTS §8 — self-improvement is not
 * permission expansion)
 * ────────────────────────────────────────────────────────────*/

/** What a transformation touches, from least to most sensitive. */
export const CHANGE_SCOPES = [
  "read_only_analysis",
  "derived_artifact",
  "construction_surface",
  "security_boundary",
] as const;

export type ChangeScope = (typeof CHANGE_SCOPES)[number];

export const changeScopeSchema = z.enum(CHANGE_SCOPES);

/** Whether the transformation changes who can access what. */
export const PERMISSION_SCOPE_IMPACTS = ["no_access_change", "access_widening"] as const;

export type PermissionScopeImpact = (typeof PERMISSION_SCOPE_IMPACTS)[number];

export const permissionScopeImpactSchema = z.enum(PERMISSION_SCOPE_IMPACTS);

export const SELF_IMPROVEMENT_LAW =
  "AGENTS §8: AI improvement is not permission expansion — a proposal that touches a security boundary or widens access is classified as such and may only escalate to governed review; no change scope, no authority, and no prompt makes access-widening autonomous";

export const NO_SECOND_ENGINE_DETAIL =
  "ADR PLATFORM-004: phase 38 owns no kernel capability of its own — an evolution program composes a capability owned by another phase and can never register a new capability";

/** The only autonomy decisions this contract can express. */
export type EvolutionAutonomyDecision =
  | {
      readonly status: "ALLOW";
      readonly changeScope: ChangeScope;
      readonly permissionScopeImpact: PermissionScopeImpact;
      readonly detail: string;
    }
  | {
      readonly status: "REQUIRE_APPROVAL";
      readonly changeScope: ChangeScope;
      readonly permissionScopeImpact: PermissionScopeImpact;
      readonly detail: string;
    }
  | {
      readonly status: "ESCALATE";
      readonly changeScope: ChangeScope;
      readonly permissionScopeImpact: PermissionScopeImpact;
      readonly reason:
        | "security_boundary_scope"
        | "access_widening"
        | "security_boundary_and_access_widening";
      readonly detail: string;
    };

/**
 * Classify the autonomy of a transformation proposal. Fail-closed by
 * construction: `security_boundary` escalates even when the proposal claims
 * no access change, and `access_widening` escalates in every scope. The
 * ALLOW verdict exists only for read-only or derived work that provably
 * changes no access.
 */
export function classifyProposalAutonomy(input: {
  readonly changeScope: ChangeScope;
  readonly permissionScopeImpact: PermissionScopeImpact;
}): EvolutionAutonomyDecision {
  const { changeScope, permissionScopeImpact } = input;
  const security = changeScope === "security_boundary";
  const widening = permissionScopeImpact === "access_widening";

  if (security && widening) {
    return {
      status: "ESCALATE",
      changeScope,
      permissionScopeImpact,
      reason: "security_boundary_and_access_widening",
      detail: `${SELF_IMPROVEMENT_LAW}. Escalated: the proposal is both boundary-touching and access-widening, so it is ratifiable only through governed review, never executed autonomously.`,
    };
  }
  if (security) {
    return {
      status: "ESCALATE",
      changeScope,
      permissionScopeImpact,
      reason: "security_boundary_scope",
      detail: `${SELF_IMPROVEMENT_LAW}. Escalated: the proposal touches a security boundary, so even a claimed no-access-change is treated as governed and cannot execute autonomously.`,
    };
  }
  if (widening) {
    return {
      status: "ESCALATE",
      changeScope,
      permissionScopeImpact,
      reason: "access_widening",
      detail: `${SELF_IMPROVEMENT_LAW}. Escalated: the proposal widens access, and access-widening is never an autonomous improvement.`,
    };
  }
  if (changeScope === "construction_surface") {
    return {
      status: "REQUIRE_APPROVAL",
      changeScope,
      permissionScopeImpact,
      detail:
        "construction on platform surfaces requires the full governed gate chain, including human approval before execution",
    };
  }
  return {
    status: "ALLOW",
    changeScope,
    permissionScopeImpact,
    detail:
      "read-only or derived work with no access change may proceed autonomously; it is still recorded and audited, and it grants nothing",
  };
}

/* ─────────────────────────────────────────────────────────────
 * Gate chain (AGENTS §21 — AI output is untrusted)
 * ────────────────────────────────────────────────────────────*/

/** The governed gate chain, in canonical order. */
export const EVOLUTION_GATE_ORDER = [
  "proposal",
  "validation",
  "policy_check",
  "approval",
  "execution",
  "audit",
] as const;

export type EvolutionGate = (typeof EVOLUTION_GATE_ORDER)[number];

export const evolutionGateSchema = z.enum(EVOLUTION_GATE_ORDER);

export const evolutionGateRunSchema = z.strictObject({
  gate: evolutionGateSchema,
  /** A gate either passes or blocks; there is no silent skip. */
  outcome: z.enum(["passed", "blocked"]),
  /** Who or what ran the gate (principal reference, not a secret). */
  actor: nonEmptyString("gate actor"),
  /** ISO-8601 timestamp of the gate run. */
  at: z.string().datetime(),
});

export type EvolutionGateRun = z.infer<typeof evolutionGateRunSchema>;

export type GateProgression =
  | {
      readonly status: "in_progress";
      readonly next: EvolutionGate;
      readonly passedSoFar: readonly EvolutionGate[];
    }
  | {
      readonly status: "blocked";
      readonly at: EvolutionGate;
      readonly reason: string;
    }
  | {
      readonly status: "complete";
    };

/**
 * Advance the gate chain from recorded runs. Fail-closed: runs out of
 * canonical order, duplicate gate runs, or a blocked gate stop the chain —
 * the progression never lets a later gate be considered while an earlier
 * one is unresolved.
 */
export function advanceGateChain(runs: readonly EvolutionGateRun[]): GateProgression {
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    const expected = EVOLUTION_GATE_ORDER[i];
    if (run.gate !== expected) {
      return {
        status: "blocked",
        at: run.gate,
        reason: `invalid gate sequence: expected gate "${expected}" at position ${i} but recorded "${run.gate}" — gates pass in canonical order or not at all`,
      };
    }
    if (run.outcome === "blocked") {
      return {
        status: "blocked",
        at: run.gate,
        reason: `gate "${run.gate}" was blocked by "${run.actor}" — the chain terminates; later gates cannot be recorded past a block`,
      };
    }
  }
  if (runs.length === EVOLUTION_GATE_ORDER.length) {
    return { status: "complete" };
  }
  return {
    status: "in_progress",
    next: EVOLUTION_GATE_ORDER[runs.length],
    passedSoFar: runs.map((run) => run.gate),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Proposals, stages, programs
 * ────────────────────────────────────────────────────────────*/

export const transformationProposalSchema = z.strictObject({
  proposalId: nonEmptyString("proposalId"),
  title: nonEmptyString("title"),
  changeScope: changeScopeSchema,
  permissionScopeImpact: permissionScopeImpactSchema,
  /** What the transformation estimates, as derived intelligence (not authority). */
  impactEstimate: nonEmptyString("impactEstimate").optional(),
  provenance: evolutionProvenanceSchema,
});

export type TransformationProposal = z.infer<typeof transformationProposalSchema>;

export const migrationStageSchema = z.strictObject({
  stageIndex: z.number().int().nonnegative(),
  summary: nonEmptyString("stage summary"),
  /**
   * Reversible before irreversible: a stage without a rollback plan is not
   * a stage. The plan names how the stage is undone.
   */
  rollbackPlan: nonEmptyString("rollbackPlan"),
  /** Invariants that must hold after the stage executes. */
  invariants: z
    .array(invariantIdSchema)
    .min(1, "a stage must declare at least one invariant to verify")
    .max(
      MAX_INVARIANTS_PER_STAGE,
      `stage exceeds the bounded maximum of ${MAX_INVARIANTS_PER_STAGE} invariants`,
    ),
});

export type MigrationStage = z.infer<typeof migrationStageSchema>;

export const evolutionProgramSchema = z.strictObject({
  programId: evolutionProgramIdSchema,
  /** The platform capability this program composes — never one it creates. */
  composedCapability: composableCapabilitySchema,
  proposal: transformationProposalSchema,
  stages: z
    .array(migrationStageSchema)
    .max(
      MAX_STAGES_PER_PROGRAM,
      `program exceeds the bounded maximum of ${MAX_STAGES_PER_PROGRAM} stages`,
    ),
  provenance: evolutionProvenanceSchema,
});

export type EvolutionProgram = z.infer<typeof evolutionProgramSchema>;

export const evolutionProgramRegistrySchema = z.strictObject({
  programs: z
    .array(evolutionProgramSchema)
    .max(
      MAX_PROGRAMS_PER_REGISTRY,
      `registry exceeds the bounded maximum of ${MAX_PROGRAMS_PER_REGISTRY} programs`,
    ),
});

export type EvolutionProgramRegistry = z.infer<typeof evolutionProgramRegistrySchema>;

/* ─────────────────────────────────────────────────────────────
 * Parsing (fail-closed: no partial programs or registries)
 * ────────────────────────────────────────────────────────────*/

export type EvolutionParseFailureReason =
  /** The input does not match the schema at all. */
  | "invalid_shape"
  /** A cross-record invariant failed (stage order, duplicates). */
  | "cross_record_invariant";

export interface EvolutionIssue {
  readonly path: string;
  readonly message: string;
}

export type EvolutionProgramParseResult =
  | { readonly ok: true; readonly program: EvolutionProgram }
  | {
      readonly ok: false;
      readonly reason: EvolutionParseFailureReason;
      readonly issues: readonly EvolutionIssue[];
    };

export type EvolutionRegistryParseResult =
  | { readonly ok: true; readonly registry: EvolutionProgramRegistry }
  | {
      readonly ok: false;
      readonly reason: EvolutionParseFailureReason;
      readonly issues: readonly EvolutionIssue[];
    };

function issuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path.map((segment) => String(segment)).join(".");
}

function issuesFromZod(error: z.ZodError): readonly EvolutionIssue[] {
  return error.issues.map((issue) => ({
    path: issuePath(issue.path),
    message: issue.message,
  }));
}

/**
 * Parse one untrusted evolution program. Any violation — shape, bounds,
 * stage ordering, capability ownership — yields `ok: false` with structured
 * issues; a failed parse never yields a partial program.
 */
export function parseEvolutionProgram(input: unknown): EvolutionProgramParseResult {
  const parsed = evolutionProgramSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_shape", issues: issuesFromZod(parsed.error) };
  }

  const program = parsed.data;
  const issues: EvolutionIssue[] = [];

  const seenStage = new Set<number>();
  program.stages.forEach((stage, position) => {
    if (seenStage.has(stage.stageIndex) || stage.stageIndex !== position) {
      issues.push({
        path: `stages[stageIndex=${stage.stageIndex}]`,
        message: `stage at position ${position} declares index ${stage.stageIndex} — stages are sequential from 0 without gaps, repeats, or reordering`,
      });
      return;
    }
    seenStage.add(stage.stageIndex);
  });

  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }

  return { ok: true, program };
}

/**
 * Parse an untrusted registry of evolution programs. Duplicate program ids
 * are refused — one program, one binding.
 */
export function parseEvolutionProgramRegistry(input: unknown): EvolutionRegistryParseResult {
  const parsed = evolutionProgramRegistrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_shape", issues: issuesFromZod(parsed.error) };
  }

  const registry = parsed.data;
  const issues: EvolutionIssue[] = [];

  const seen = new Set<EvolutionProgramId>();
  for (const program of registry.programs) {
    if (seen.has(program.programId)) {
      issues.push({
        path: `programs[programId=${program.programId}]`,
        message: `duplicate program "${program.programId}" — one program identity carries exactly one definition`,
      });
    } else {
      seen.add(program.programId);
    }
  }

  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }

  return { ok: true, registry };
}

/* ─────────────────────────────────────────────────────────────
 * Approval and independence (no self-ratification)
 * ────────────────────────────────────────────────────────────*/

/**
 * Authorities that may close an approval gate. Every entry is external to
 * the engine: the proposing actor is deliberately absent, so there is no
 * vocabulary in which a proposal ratifies itself.
 */
export const APPROVAL_AUTHORITIES = [
  "human_governance",
  "phase_owner_review",
  "control_plane",
] as const;

export type ApprovalAuthority = (typeof APPROVAL_AUTHORITIES)[number];

export const approvalEvidenceSchema = z.strictObject({
  approver: nonEmptyString("approval.approver"),
  authority: z.enum(APPROVAL_AUTHORITIES),
  decidedAt: z.string().datetime(),
});

export type ApprovalEvidence = z.infer<typeof approvalEvidenceSchema>;

export type RatificationResult =
  | {
      readonly ok: true;
      readonly proposalId: string;
      readonly approver: string;
    }
  | {
      readonly ok: false;
      readonly proposalId: string;
      readonly reason: "self_ratification" | "external_authority_required";
      readonly detail: string;
    };

export const SELF_RATIFICATION_DETAIL =
  "the phase-38 kernel boundary statement denies the engine authority to approve its own proposals — the actor recorded in the proposal provenance can never close its approval gate";

/**
 * Close an approval gate over a proposal. Fails closed on self-ratification
 * (proposer and approver are the same principal) and refuses to invent an
 * approver: the evidence must already carry an external authority.
 */
export function ratifyProposal(
  proposal: TransformationProposal,
  approval: ApprovalEvidence,
): RatificationResult {
  if (approval.approver === proposal.provenance.declaredBy) {
    return {
      ok: false,
      proposalId: proposal.proposalId,
      reason: "self_ratification",
      detail: SELF_RATIFICATION_DETAIL,
    };
  }
  return { ok: true, proposalId: proposal.proposalId, approver: approval.approver };
}

/* ─────────────────────────────────────────────────────────────
 * Invariant verification (a stage is held, or it is not done)
 * ────────────────────────────────────────────────────────────*/

export const invariantVerificationSchema = z.strictObject({
  stageIndex: z.number().int().nonnegative(),
  invariant: invariantIdSchema,
  outcome: z.enum(["held", "violated", "not_run"]),
  verifiedAt: z.string().datetime(),
});

export type InvariantVerification = z.infer<typeof invariantVerificationSchema>;

export interface StageCompletionState {
  readonly stageIndex: number;
  /** True only when every declared invariant is verified as held. */
  readonly complete: boolean;
  readonly held: readonly InvariantId[];
  readonly violated: readonly InvariantId[];
  readonly notRun: readonly InvariantId[];
  readonly missing: readonly InvariantId[];
  /** Verifications that name no invariant the stage declared — refused. */
  readonly unknown: readonly InvariantId[];
  readonly detail: string;
}

/**
 * Evaluate one stage against its verification records. Fail-closed: the
 * stage is complete only when every declared invariant is verified held;
 * missing, not-run, unknown, or violated invariants each name themselves
 * and keep the stage open.
 */
export function evaluateStageCompletion(
  program: EvolutionProgram,
  stageIndex: number,
  verifications: readonly InvariantVerification[],
): StageCompletionState {
  const stage = program.stages.find((candidate) => candidate.stageIndex === stageIndex) ?? null;
  if (stage === null) {
    return {
      stageIndex,
      complete: false,
      held: [],
      violated: [],
      notRun: [],
      missing: [],
      unknown: [],
      detail: `fail-closed: program "${program.programId}" declares no stage at index ${stageIndex}, so nothing about that stage can be verified`,
    };
  }

  const declared = new Set<InvariantId>(stage.invariants);
  const held: InvariantId[] = [];
  const violated: InvariantId[] = [];
  const notRun: InvariantId[] = [];
  const unknown: InvariantId[] = [];

  for (const verification of verifications) {
    if (verification.stageIndex !== stageIndex) continue;
    if (!declared.has(verification.invariant)) {
      unknown.push(verification.invariant);
      continue;
    }
    if (verification.outcome === "held") held.push(verification.invariant);
    else if (verification.outcome === "violated") violated.push(verification.invariant);
    else notRun.push(verification.invariant);
  }

  const missing = stage.invariants.filter(
    (invariant) =>
      !held.includes(invariant) && !violated.includes(invariant) && !notRun.includes(invariant),
  );

  const complete =
    violated.length === 0 && notRun.length === 0 && missing.length === 0 && unknown.length === 0;

  const detail = complete
    ? `stage ${stageIndex} of "${program.programId}" is verified: all ${stage.invariants.length} declared invariants held`
    : `fail-closed: stage ${stageIndex} of "${program.programId}" is not verified — ${violated.length} violated, ${notRun.length} not run, ${missing.length} never verified, ${unknown.length} unknown verification(s) recorded`;

  return { stageIndex, complete, held, violated, notRun, missing, unknown, detail };
}

/* ─────────────────────────────────────────────────────────────
 * Program completion (gates and stages must both hold)
 * ────────────────────────────────────────────────────────────*/

export interface ProgramCompletionState {
  readonly programId: EvolutionProgramId;
  readonly gates: GateProgression;
  readonly stagesComplete: boolean;
  readonly openStages: readonly number[];
  /** Verifications naming a stage the program does not declare — refused. */
  readonly orphanVerifications: readonly number[];
  readonly complete: boolean;
  readonly detail: string;
}

/**
 * Fail-closed program completion: every gate passed in canonical order AND
 * every stage invariant-verified, with no orphan verification records. A
 * program is never complete by default — an empty evidence set leaves it
 * open at its first gate.
 */
export function evaluateProgramCompletion(
  program: EvolutionProgram,
  gateRuns: readonly EvolutionGateRun[],
  verifications: readonly InvariantVerification[],
): ProgramCompletionState {
  const gates = advanceGateChain(gateRuns);
  const declaredStageIndexes = new Set(program.stages.map((stage) => stage.stageIndex));
  const orphanVerifications = [
    ...new Set(
      verifications
        .filter((verification) => !declaredStageIndexes.has(verification.stageIndex))
        .map((verification) => verification.stageIndex),
    ),
  ];
  const openStages = program.stages
    .map((stage) => stage.stageIndex)
    .filter((stageIndex) => !evaluateStageCompletion(program, stageIndex, verifications).complete);
  const stagesComplete = openStages.length === 0 && orphanVerifications.length === 0;
  const complete = gates.status === "complete" && stagesComplete;

  const detail = complete
    ? `program "${program.programId}" is complete: gate chain closed and every stage invariant-verified`
    : `fail-closed: program "${program.programId}" is not complete — gate chain is ${
        gates.status === "complete"
          ? "closed"
          : gates.status === "in_progress"
            ? `open at "${gates.next}"`
            : `blocked at "${gates.at}"`
      }, ${openStages.length} stage(s) unverified (${openStages.join(", ") || "none"})${
        orphanVerifications.length
          ? `, ${orphanVerifications.length} orphan verification(s) for undeclared stage(s) ${orphanVerifications.join(", ")}`
          : ""
      }`;

  return {
    programId: program.programId,
    gates,
    stagesComplete,
    openStages,
    orphanVerifications,
    complete,
    detail,
  };
}
