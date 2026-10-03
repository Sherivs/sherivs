/**
 * CoreGrid — phase 47 substrate surface: autonomous engineering
 * self-improvement contracts (H3 wave Squad G, mission G-067; Contract
 * Architect, phase 47).
 *
 * WHAT: Zod-validated contracts for the governed improvement loop — observed
 * engineering signals, improvement proposals with named change and rollback
 * plans, verification runs over the verification chain, staging records that
 * hand changes to the human release path, and human-only ratification
 * records. This module owns the STRUCTURE of that surface; it does not
 * execute the loop, touch repositories, or deploy anything.
 *
 * Laws of this module:
 * - Self-improvement is not permission expansion (AGENTS §8), encoded
 *   structurally: a proposal that touches any protected change class
 *   (`security_boundary`, `authorization_model`, `identity_system`,
 *   `data_access`, `production_behavior`) cannot exist on this surface
 *   without a review requirement whose `humanApprovalRequired` is the schema
 *   literal `true` and which names at least one required review kind. The
 *   schema is unable to express a protected-class change as auto-approvable.
 * - No self-ratification (AGENTS §7, §21): ratification is human-only — the
 *   ratifier kind is the schema literal `"human"`, so machine ratification
 *   cannot even be parsed; and the ratifier may never be the proposal's
 *   author, enforced by the typed ratification decision.
 * - The engine proposes and stages; it never ratifies, deploys, or widens its
 *   own permissions: staging records carry `deploys: z.literal(false)` and
 *   `ratifies: z.literal(false)`, and the proposal status vocabulary contains
 *   no approved or ratified state — approval outcomes are not expressible on
 *   the proposal surface at all.
 * - Evidence-based (canonical truth, AGENTS §9): every proposal cites at
 *   least one observed signal and every signal carries evidence; nothing is
 *   proposed from nothing.
 * - Same verification chain as any human change: staging without a passing
 *   verification run fails closed via the typed staging gate — a missing,
 *   mismatched, or non-passing run is a defect, never a pass.
 * - Fail-closed parsing: any invariant violation yields a typed failure with
 *   structured issues; a failed parse never yields a partial result.
 * - Bounded inputs: statements, evidence sets, surface lists and batches all
 *   carry hard ceilings. No unbounded structures.
 *
 * Neutral vocabulary only (J-037 shrink-only): a "signal" is any observed
 * indication that the engineering ecosystem has a defect, drift, limitation
 * or regression; a "proposal" is a named, evidenced, reversible change; a
 * "surface" is any part of the system a change could affect. No domain
 * vocabulary appears here.
 *
 * Pure contract module: no I/O, no persistence, no vendor imports, no
 * wall-clock reads, no secrets.
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Ceilings (no unbounded structures)
 * ────────────────────────────────────────────────────────────*/

/** Hard ceiling on statements of signal, change or rollback. */
export const STATEMENT_MAX_LENGTH = 2_000;

/** Hard ceiling on evidence items attached to one signal or proposal. */
export const MAX_EVIDENCE_PER_RECORD = 64;

/** Hard ceiling on signals one proposal may cite. */
export const MAX_SIGNAL_REFS_PER_PROPOSAL = 64;

/** Hard ceiling on protected surfaces one proposal may declare. */
export const MAX_AFFECTED_SURFACES = 16;

/** Hard ceiling on gates in one verification run. */
export const MAX_GATES_PER_RUN = 64;

/** Hard ceiling on proposals in one parsed batch. */
export const MAX_PROPOSALS_PER_SET = 512;

/**
 * The phase-47 boundary, exported as a constant so downstream surfaces can
 * cite it rather than paraphrase it. The engine proposes and stages; the
 * release path and approval authority stay human-owned (phase contract:
 * `requiresApprovalFor` proposal-ratification / deployment /
 * permission-change / verification-gate-modification).
 */
export const SELF_IMPROVEMENT_BOUNDARY =
  "the improvement engine proposes and stages; it never ratifies, deploys, or expands its own permissions — ratification, deployment and authority changes remain human-owned";

/**
 * The self-improvement law this surface encodes (AGENTS §8), exported as a
 * constant: improving the system and expanding its own permissions are
 * different acts, and the protected change classes always require human
 * review and validation.
 */
export const SELF_IMPROVEMENT_LAW =
  "self-improvement is not permission expansion — a change touching security, authorization, identity, data access or production behavior requires review and validation before it may proceed";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const identifierSchema = z
  .string()
  .regex(
    IDENTIFIER_PATTERN,
    "identifier must be a lowercase snake_case identifier (letters, digits, underscore; starts with a letter; at most 64 characters)",
  );

export type Identifier = z.infer<typeof identifierSchema>;

function nonEmptyBounded(label: string, maxLength: number) {
  return z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`)
    .max(
      maxLength,
      `${label} exceeds the bounded maximum of ${maxLength} characters`,
    );
}

export const severitySchema = z.enum(["info", "notice", "warning", "critical"]);

export type Severity = z.infer<typeof severitySchema>;

/** Total order over severities; `critical` is the most severe class. */
export const SEVERITY_ORDER: Readonly<Record<Severity, number>> = {
  info: 0,
  notice: 1,
  warning: 2,
  critical: 3,
};

/** True when `candidate` is at least as severe as `minimum`. */
export function severityAtLeast(candidate: Severity, minimum: Severity): boolean {
  return SEVERITY_ORDER[candidate] >= SEVERITY_ORDER[minimum];
}

export const subjectKindSchema = z.enum([
  "autonomous_agent",
  "automated_process",
  "human_initiated",
]);

export type SubjectKind = z.infer<typeof subjectKindSchema>;

export const subjectSchema = z.strictObject({
  /** Stable reference to the acting principal (not a secret). */
  subjectRef: nonEmptyBounded("subject.subjectRef", 256),
  subjectKind: subjectKindSchema,
});

export type Subject = z.infer<typeof subjectSchema>;

export const provenanceSchema = z.strictObject({
  /** Who produced the record (role or principal reference, not a secret). */
  declaredBy: nonEmptyBounded("provenance.declaredBy", 256),
  /** Under which authority the record was produced (AGENTS §43). */
  authority: nonEmptyBounded("provenance.authority", 256),
  /** ISO-8601 timestamp of the production instant. */
  declaredAt: z.string().datetime(),
});

export type Provenance = z.infer<typeof provenanceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Protected change classes (AGENTS §8, encoded structurally)
 * ────────────────────────────────────────────────────────────*/

/**
 * The protected change classes of the self-improvement law (AGENTS §8). A
 * proposal declaring ANY of these surfaces cannot be expressed without a
 * review requirement (see `reviewRequirementSchema`) — the schema makes an
 * unreviewed protected-class change unrepresentable.
 */
export const protectedSurfaceKindSchema = z.enum([
  "security_boundary",
  "authorization_model",
  "identity_system",
  "data_access",
  "production_behavior",
]);

export type ProtectedSurfaceKind = z.infer<typeof protectedSurfaceKindSchema>;

/**
 * Review kinds a protected-class proposal must name. The mapping from
 * protected surface to review kind is fixed by `REVIEW_KIND_BY_SURFACE` so
 * classification cannot drift per call site.
 */
export const reviewKindSchema = z.enum([
  "security_review",
  "architecture_review",
  "policy_review",
  "data_review",
]);

export type ReviewKind = z.infer<typeof reviewKindSchema>;

/**
 * Which review kind each protected surface requires. One surface may demand
 * more than one kind (e.g. identity systems are security-relevant), so the
 * value is a list; the union is what a proposal must declare.
 */
export const REVIEW_KIND_BY_SURFACE: Readonly<
  Record<ProtectedSurfaceKind, readonly ReviewKind[]>
> = {
  security_boundary: ["security_review"],
  authorization_model: ["security_review", "policy_review"],
  identity_system: ["security_review"],
  data_access: ["data_review", "security_review"],
  production_behavior: ["policy_review", "architecture_review"],
};

/**
 * Review requirement for protected-class proposals. `humanApprovalRequired`
 * is the schema literal `true`: this surface cannot express a protected-class
 * change that skips human approval.
 */
export const reviewRequirementSchema = z.strictObject({
  humanApprovalRequired: z.literal(true),
  requiredReviewKinds: z
    .array(reviewKindSchema)
    .min(1, "a protected-class change must name at least one required review kind")
    .max(MAX_AFFECTED_SURFACES),
  reviewRationale: nonEmptyBounded("review.reviewRationale", STATEMENT_MAX_LENGTH),
});

export type ReviewRequirement = z.infer<typeof reviewRequirementSchema>;

/* ─────────────────────────────────────────────────────────────
 * Observed engineering signals (the loop's evidence input)
 * ────────────────────────────────────────────────────────────*/

export const signalKindSchema = z.enum([
  "defect_observed",
  "drift_detected",
  "limitation_found",
  "regression_detected",
]);

export type SignalKind = z.infer<typeof signalKindSchema>;

export const evidenceKindSchema = z.enum([
  "direct_observation",
  "record_reference",
  "attestation",
]);

export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const evidenceSchema = z.strictObject({
  evidenceRef: identifierSchema,
  evidenceKind: evidenceKindSchema,
  capturedAt: z.string().datetime(),
  capturedBy: nonEmptyBounded("evidence.capturedBy", 256),
});

export type Evidence = z.infer<typeof evidenceSchema>;

export const improvementSignalSchema = z
  .strictObject({
    signalId: identifierSchema,
    signalKind: signalKindSchema,
    severity: severitySchema,
    /** What was observed, bounded. Bland assertions are not evidence. */
    statement: nonEmptyBounded("signal.statement", STATEMENT_MAX_LENGTH),
    /** Every signal is evidence-backed — nothing is observed from nothing. */
    evidence: z
      .array(evidenceSchema)
      .min(1, "an observed signal requires at least one evidence item — nothing is assumed observed")
      .max(MAX_EVIDENCE_PER_RECORD),
    observedBy: subjectSchema,
    observedAt: z.string().datetime(),
    provenance: provenanceSchema,
  })
  .superRefine((value, ctx) => {
    if (value.signalKind === "regression_detected" && value.severity === "info") {
      ctx.addIssue({
        code: "custom",
        path: ["severity"],
        message:
          "a detected regression may not carry severity info — regressions are at least notices, fail-closed",
      });
    }
  });

export type ImprovementSignal = z.infer<typeof improvementSignalSchema>;

/* ─────────────────────────────────────────────────────────────
 * Improvement proposals (machine-authored, human-reviewable)
 * ────────────────────────────────────────────────────────────*/

/**
 * Proposal status vocabulary. Deliberately EXCLUDES any approved, ratified,
 * deployed or rejected state: approval outcomes are not expressible on the
 * proposal surface — they live in the human ratification record only
 * (SELF_IMPROVEMENT_BOUNDARY).
 */
export const proposalStatusSchema = z.enum(["draft", "submitted"]);

export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const improvementProposalSchema = z
  .strictObject({
    proposalId: identifierSchema,
    /** What is wrong, bounded. */
    statement: nonEmptyBounded("proposal.statement", STATEMENT_MAX_LENGTH),
    /** Signals the proposal is grounded in — no proposal without evidence. */
    signalRefs: z
      .array(identifierSchema)
      .min(1, "a proposal must cite at least one observed signal — nothing is proposed from nothing")
      .max(MAX_SIGNAL_REFS_PER_PROPOSAL),
    /** The named change being proposed. */
    proposedChange: nonEmptyBounded("proposal.proposedChange", STATEMENT_MAX_LENGTH),
    /** The named rollback. Every improvement is evidenced and reversible. */
    rollbackPlan: nonEmptyBounded("proposal.rollbackPlan", STATEMENT_MAX_LENGTH),
    /** Protected change classes the change touches (AGENTS §8). */
    affectedSurfaces: z
      .array(protectedSurfaceKindSchema)
      .max(MAX_AFFECTED_SURFACES),
    /** Required when `affectedSurfaces` is non-empty; forbidden otherwise. */
    review: reviewRequirementSchema.optional(),
    /** The machine author of the proposal — never a human on this surface. */
    author: subjectSchema,
    authoredAt: z.string().datetime(),
    status: proposalStatusSchema,
    provenance: provenanceSchema,
  })
  .superRefine((value, ctx) => {
    const touchesProtected = value.affectedSurfaces.length > 0;
    if (touchesProtected && value.review === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["review"],
        message: `${SELF_IMPROVEMENT_LAW} — a proposal touching a protected change class must carry a review requirement; an unreviewed protected-class change is not representable on this surface`,
      });
    }
    if (!touchesProtected && value.review !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["review"],
        message:
          "review is only valid when the proposal declares affected surfaces — routine changes route through the verification chain, not this block",
      });
    }
    if (value.author.subjectKind === "human_initiated") {
      ctx.addIssue({
        code: "custom",
        path: ["author"],
        message:
          "proposals on this surface are machine-authored; human-authored changes follow the ordinary engineering flow",
      });
    }
  });

export type ImprovementProposal = z.infer<typeof improvementProposalSchema>;

/* ─────────────────────────────────────────────────────────────
 * Verification runs (the same chain any human change passes)
 * ────────────────────────────────────────────────────────────*/

export const gateKindSchema = z.enum([
  "boundary_respect",
  "regression",
  "policy_conformance",
  "test_chain",
  "evidence_integrity",
]);

export type GateKind = z.infer<typeof gateKindSchema>;

export const gateOutcomeSchema = z.enum(["passed", "failed", "not_run"]);

export type GateOutcome = z.infer<typeof gateOutcomeSchema>;

export const verificationGateSchema = z.strictObject({
  gateId: identifierSchema,
  gateKind: gateKindSchema,
  outcome: gateOutcomeSchema,
  /** Reference to the recorded gate result — outcomes are never asserted bare. */
  resultRef: identifierSchema,
});

export type VerificationGate = z.infer<typeof verificationGateSchema>;

export const verificationRunOutcomeSchema = z.enum(["passed", "failed"]);

export type VerificationRunOutcome = z.infer<typeof verificationRunOutcomeSchema>;

export const verificationRunSchema = z
  .strictObject({
    runId: identifierSchema,
    proposalId: identifierSchema,
    gates: z
      .array(verificationGateSchema)
      .min(1, "a verification run requires at least one gate — nothing is verified by default")
      .max(MAX_GATES_PER_RUN),
    outcome: verificationRunOutcomeSchema,
    ranBy: subjectSchema,
    ranAt: z.string().datetime(),
    provenance: provenanceSchema,
  })
  .superRefine((value, ctx) => {
    const failedOrSkipped = value.gates.filter(
      (gate) => gate.outcome !== "passed",
    );
    if (value.outcome === "passed" && failedOrSkipped.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["outcome"],
        message:
          "a run outcome of passed requires every gate to have passed — fail-closed: failed or not-run gates can never sum to a pass",
      });
    }
    if (value.outcome === "failed" && failedOrSkipped.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["outcome"],
        message:
          "a run outcome of failed requires at least one failed or not-run gate — outcomes must follow the gate evidence",
      });
    }
  });

export type VerificationRun = z.infer<typeof verificationRunSchema>;

/* ─────────────────────────────────────────────────────────────
 * Staging records (hand-off to the human release path)
 * ────────────────────────────────────────────────────────────*/

export const stagingStatusSchema = z.enum([
  "staged",
  "superseded",
  "withdrawn_by_human",
]);

export type StagingStatus = z.infer<typeof stagingStatusSchema>;

export const stagingRecordSchema = z
  .strictObject({
    stagingId: identifierSchema,
    proposalId: identifierSchema,
    /** Staging requires a verification run — an unverified change cannot be staged. */
    verificationRunId: identifierSchema,
    stagedBy: subjectSchema,
    stagedAt: z.string().datetime(),
    status: stagingStatusSchema,
    /**
     * Superseded staging must name the staging record that replaced it.
     */
    supersededByStagingId: identifierSchema.optional(),
    /** Human withdrawal evidence. Machine withdrawal does not exist here. */
    withdrawnByHuman: z
      .strictObject({
        humanRef: nonEmptyBounded("staging.withdrawnByHuman.humanRef", 256),
        decidedAt: z.string().datetime(),
        note: nonEmptyBounded("staging.withdrawnByHuman.note", STATEMENT_MAX_LENGTH),
      })
      .optional(),
    /**
     * Literal `false`, enforced by the schema: a staging record never
     * deploys. Deployment authority stays with the human release path.
     */
    deploys: z.literal(false),
    /**
     * Literal `false`, enforced by the schema: a staging record never
     * ratifies. Ratification is a separate, human-only record.
     */
    ratifies: z.literal(false),
  })
  .superRefine((value, ctx) => {
    if (value.status === "superseded" && value.supersededByStagingId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["supersededByStagingId"],
        message: "a superseded staging record must name its replacement — no silent supersession",
      });
    }
    if (value.status === "withdrawn_by_human" && value.withdrawnByHuman === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["withdrawnByHuman"],
        message: "human withdrawal requires a withdrawal record — no machine withdrawal",
      });
    }
    if (value.status !== "withdrawn_by_human" && value.withdrawnByHuman !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["withdrawnByHuman"],
        message: "withdrawnByHuman is only valid when the status is withdrawn_by_human",
      });
    }
  });

export type StagingRecord = z.infer<typeof stagingRecordSchema>;

/* ─────────────────────────────────────────────────────────────
 * Human ratification (the only approval record on this surface)
 * ────────────────────────────────────────────────────────────*/

export const ratificationSchema = z.strictObject({
  proposalId: identifierSchema,
  /** Stable reference to the ratifying human (not a secret). */
  ratifierRef: nonEmptyBounded("ratification.ratifierRef", 256),
  /**
   * Literal `"human"`, enforced by the schema: machine ratification cannot
   * be parsed on this surface (AGENTS §7 — AI systems may not approve their
   * own changes).
   */
  ratifierKind: z.literal("human"),
  ratifierAuthority: nonEmptyBounded("ratification.ratifierAuthority", 256),
  decidedAt: z.string().datetime(),
  decision: z.enum(["approved", "rejected"]),
  note: nonEmptyBounded("ratification.note", STATEMENT_MAX_LENGTH),
});

export type Ratification = z.infer<typeof ratificationSchema>;

export type RatificationRejectionReason =
  /** The input is not a well-formed human ratification record. */
  | "ratification_invalid"
  /** The ratifier is the proposal's own author — no self-approval (AGENTS §21). */
  | "self_approval_forbidden";

export type RatificationDecision =
  | {
      readonly ok: true;
      readonly proposalId: Identifier;
      readonly decision: "approved" | "rejected";
      readonly detail: string;
    }
  | {
      readonly ok: false;
      readonly proposalId: Identifier | null;
      readonly reason: RatificationRejectionReason;
      readonly detail: string;
    };

/**
 * Validate a ratification attempt against a machine-authored proposal.
 *
 * Fail-closed by design:
 * - the ratification input is parsed here, so a malformed or machine-shaped
 *   record is rejected rather than trusted (`ratifierKind` is the literal
 *   `"human"` — an agent ratifying its own work is unrepresentable);
 * - the ratifier may never be the proposal's author — an agent cannot
 *   approve its own output even with a well-formed record (AGENTS §21);
 * - `ok: true` means the record is well-formed and independent; it is NOT an
 *   authorization to deploy — execution remains outside this surface
 *   (SELF_IMPROVEMENT_BOUNDARY).
 */
export function decideRatification(
  proposal: ImprovementProposal,
  ratification: unknown,
): RatificationDecision {
  const parsed = ratificationSchema.safeParse(ratification);
  if (!parsed.success) {
    return {
      ok: false,
      proposalId: null,
      reason: "ratification_invalid",
      detail:
        "ratification requires a well-formed HUMAN ratification record (ratifierRef, ratifierKind literally \"human\", ratifierAuthority, decidedAt, decision, note) — machine-shaped or malformed records fail closed (AGENTS §7, §8)",
    };
  }

  const record = parsed.data;
  if (record.proposalId !== proposal.proposalId) {
    return {
      ok: false,
      proposalId: record.proposalId,
      reason: "ratification_invalid",
      detail: `ratification names proposal "${record.proposalId}" but was evaluated against "${proposal.proposalId}" — a ratification record binds exactly one proposal`,
    };
  }

  if (record.ratifierRef === proposal.author.subjectRef) {
    return {
      ok: false,
      proposalId: proposal.proposalId,
      reason: "self_approval_forbidden",
      detail:
        "the ratifier may never be the proposal's own author — an agent cannot approve its own work (AGENTS §21: worker cannot verify own output)",
    };
  }

  return {
    ok: true,
    proposalId: proposal.proposalId,
    decision: record.decision,
    detail:
      record.decision === "approved"
        ? `ratification "${record.ratifierRef}" approved proposal "${proposal.proposalId}" — this record ratifies only; deployment stays on the human release path (${SELF_IMPROVEMENT_BOUNDARY})`
        : `ratification "${record.ratifierRef}" rejected proposal "${proposal.proposalId}" — the proposal returns to the loop as a rejected proposal, never silently absorbed`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Review classification (protected classes always need human review)
 * ────────────────────────────────────────────────────────────*/

export type ChangeReviewClassification =
  | {
      readonly classification: "protected_change";
      readonly humanApprovalRequired: true;
      readonly requiredReviewKinds: readonly ReviewKind[];
      readonly detail: string;
    }
  | {
      readonly classification: "routine_change";
      readonly humanApprovalRequired: false;
      readonly requiredReviewKinds: readonly ReviewKind[];
      readonly detail: string;
    };

/**
 * Classify the review posture of a change from the protected surfaces it
 * declares. Any protected surface (AGENTS §8) yields `protected_change` with
 * the union of the required review kinds and human approval mandatory;
 * absence of protected surfaces yields `routine_change`, which still routes
 * through the same verification chain before staging.
 */
export function classifyChangeReview(
  affectedSurfaces: readonly ProtectedSurfaceKind[],
): ChangeReviewClassification {
  const required = new Set<ReviewKind>();
  for (const surface of affectedSurfaces) {
    for (const kind of REVIEW_KIND_BY_SURFACE[surface]) {
      required.add(kind);
    }
  }

  if (required.size > 0) {
    return {
      classification: "protected_change",
      humanApprovalRequired: true,
      requiredReviewKinds: [...required],
      detail: `${SELF_IMPROVEMENT_LAW} — surfaces [${affectedSurfaces.join(", ")}] require review kinds [${[...required].join(", ")}] and human approval before the change may proceed`,
    };
  }

  return {
    classification: "routine_change",
    humanApprovalRequired: false,
    requiredReviewKinds: [],
    detail:
      "no protected change class declared — the change still passes the same verification chain before staging; absence of review kinds never shortens the chain",
  };
}

/* ─────────────────────────────────────────────────────────────
 * Staging gate (no staging without a passing verification run)
 * ────────────────────────────────────────────────────────────*/

export type StagingGateRejectionReason =
  /** No verification run exists for the staging record's run reference. */
  | "verification_run_missing"
  /** The referenced run belongs to a different proposal. */
  | "verification_run_mismatch"
  /** The referenced run exists but did not pass. */
  | "verification_not_passed";

export type StagingGateDecision =
  | { readonly ok: true; readonly stagingId: Identifier; readonly detail: string }
  | {
      readonly ok: false;
      readonly stagingId: Identifier;
      readonly reason: StagingGateRejectionReason;
      readonly detail: string;
    };

/**
 * Gate a staging record against the verification runs. Fail-closed: staging
 * is accepted only when the referenced run exists, belongs to the same
 * proposal, and passed with evidence — a missing, mismatched or non-passing
 * run blocks staging. This is the structural form of "every staged change
 * passes the same verification chain a human change would".
 */
export function gateStaging(
  staging: StagingRecord,
  runs: readonly VerificationRun[],
): StagingGateDecision {
  const run = runs.find((candidate) => candidate.runId === staging.verificationRunId);
  if (run === undefined) {
    return {
      ok: false,
      stagingId: staging.stagingId,
      reason: "verification_run_missing",
      detail: `staging "${staging.stagingId}" references run "${staging.verificationRunId}" which does not exist — staging without a verification run fails closed`,
    };
  }
  if (run.proposalId !== staging.proposalId) {
    return {
      ok: false,
      stagingId: staging.stagingId,
      reason: "verification_run_mismatch",
      detail: `run "${run.runId}" verified proposal "${run.proposalId}" but staging "${staging.stagingId}" carries proposal "${staging.proposalId}" — a run binds exactly one proposal`,
    };
  }
  if (run.outcome !== "passed") {
    return {
      ok: false,
      stagingId: staging.stagingId,
      reason: "verification_not_passed",
      detail: `run "${run.runId}" outcome is "${run.outcome}" — staging requires a passing run; failures surface, never absorb`,
    };
  }
  return {
    ok: true,
    stagingId: staging.stagingId,
    detail: `staging "${staging.stagingId}" is verified by passing run "${run.runId}" — the record may proceed to the human release path; it still deploys and ratifies nothing itself`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Parsing (fail-closed: no partial proposal sets)
 * ────────────────────────────────────────────────────────────*/

export type ProposalSetParseFailureReason =
  /** The input does not match the schema at all. */
  | "invalid_shape"
  /** A cross-record invariant failed (duplicate proposal ids). */
  | "cross_record_invariant";

export interface ProposalSetIssue {
  readonly path: string;
  readonly message: string;
}

export type ProposalSetParseResult =
  | { readonly ok: true; readonly proposals: readonly ImprovementProposal[] }
  | {
      readonly ok: false;
      readonly reason: ProposalSetParseFailureReason;
      readonly issues: readonly ProposalSetIssue[];
    };

function issuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path.map((segment) => String(segment)).join(".");
}

/**
 * Parse an untrusted input into a set of improvement proposals. Any
 * violation — shape, bounds, duplicates, missing review requirements,
 * machine-shaped authors — yields `ok: false` with structured issues; a
 * failed parse never yields a partial set.
 */
export function parseImprovementProposals(input: unknown): ProposalSetParseResult {
  const listSchema = z
    .array(improvementProposalSchema)
    .max(MAX_PROPOSALS_PER_SET);
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_shape",
      issues: parsed.error.issues.map((issue) => ({
        path: issuePath(issue.path),
        message: issue.message,
      })),
    };
  }

  const issues: ProposalSetIssue[] = [];
  const seen = new Set<Identifier>();
  for (const proposal of parsed.data) {
    if (seen.has(proposal.proposalId)) {
      issues.push({
        path: `[proposalId=${proposal.proposalId}]`,
        message: `duplicate proposal id "${proposal.proposalId}" — one id carries exactly one proposal`,
      });
    } else {
      seen.add(proposal.proposalId);
    }
  }

  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }

  return { ok: true, proposals: parsed.data };
}

/* ─────────────────────────────────────────────────────────────
 * Loop summary (unverified staging is a defect, never a pass)
 * ────────────────────────────────────────────────────────────*/

export interface LoopSummary {
  readonly totalProposals: number;
  readonly protectedChangeProposals: number;
  readonly routineChangeProposals: number;
  readonly submittedProposals: number;
  readonly draftProposals: number;
  readonly totalRuns: number;
  readonly passedRuns: number;
  readonly failedRuns: number;
  /** Staging records that pass the verification gate. */
  readonly verifiedStagingIds: readonly Identifier[];
  /** Staging records that fail the verification gate, with reasons. */
  readonly blockedStaging: readonly { readonly stagingId: Identifier; readonly reason: StagingGateRejectionReason }[];
  /** True only when every staging record passes the gate. */
  readonly ok: boolean;
  readonly detail: string | null;
}

/**
 * Summarize a slice of the improvement loop: proposals by protected-class
 * and status posture, verification runs, and staging records gated against
 * the runs. `ok` is true only when EVERY staging record passes the
 * verification gate — unverified staging is a defect, never silently passed.
 */
export function summarizeLoop(
  proposals: readonly ImprovementProposal[],
  runs: readonly VerificationRun[],
  staging: readonly StagingRecord[],
): LoopSummary {
  let protectedChangeProposals = 0;
  let submittedProposals = 0;
  for (const proposal of proposals) {
    if (proposal.affectedSurfaces.length > 0) protectedChangeProposals += 1;
    if (proposal.status === "submitted") submittedProposals += 1;
  }

  let passedRuns = 0;
  let failedRuns = 0;
  for (const run of runs) {
    if (run.outcome === "passed") passedRuns += 1;
    else failedRuns += 1;
  }

  const verifiedStagingIds: Identifier[] = [];
  const blockedStaging: { stagingId: Identifier; reason: StagingGateRejectionReason }[] = [];
  for (const record of staging) {
    const decision = gateStaging(record, runs);
    if (decision.ok) verifiedStagingIds.push(decision.stagingId);
    else blockedStaging.push({ stagingId: decision.stagingId, reason: decision.reason });
  }

  const ok = blockedStaging.length === 0;
  const detail = ok
    ? null
    : `loop not clean: ${blockedStaging.length} of ${staging.length} staging records fail the verification gate (${blockedStaging
        .map((entry) => `${entry.stagingId}:${entry.reason}`)
        .join(", ") || "none"}) — fail-closed: unverified staging is a defect, never a pass`;

  return {
    totalProposals: proposals.length,
    protectedChangeProposals,
    routineChangeProposals: proposals.length - protectedChangeProposals,
    submittedProposals,
    draftProposals: proposals.length - submittedProposals,
    totalRuns: runs.length,
    passedRuns,
    failedRuns,
    verifiedStagingIds,
    blockedStaging,
    ok,
    detail,
  };
}