/**
 * CoreGrid — phase 39 substrate surface: governance & alignment contracts
 * (H3 wave Squad G, mission G-059; Contract Architect, phase 39).
 *
 * WHAT: Zod-validated contracts for the alignment substrate — declared
 * expectations about governed behaviour, evidence-based conformance results,
 * drift records with actor attribution, and escalations that route findings
 * to human oversight. This module owns the STRUCTURE of that surface; it does
 * not own enforcement (phases 08/09/42) and never expresses an authorization
 * decision.
 *
 * Laws of this module:
 * - Advisory by construction (D7, ADR PLATFORM-007): alignment measures and
 *   escalates; it never enforces, grants, denies, or permits. Escalation
 *   records carry `authorizes: false` as a schema-level literal — the surface
 *   is structurally unable to express an authorization outcome.
 * - Human governance posture (AGENTS §7, §44): autonomous systems may not
 *   independently redefine architecture or remove security boundaries.
 *   Expectations of kind `constitutional_boundary` are immutable on this
 *   surface: they cannot be retired or relaxed, only evaluated and enforced
 *   upstream. Every other expectation change requires a validated human
 *   approval record — machine-authored approvals fail closed.
 * - Evidence-based (canonical truth, AGENTS §9): a conformance result is
 *   never assumed. `conformant` requires evidence; `nonconformant` requires a
 *   named gap; `unmeasurable` is a governance defect, never silently treated
 *   as satisfied.
 * - Fail-closed parsing: any invariant violation yields a typed failure with
 *   structured issues; a failed parse never yields a partial result.
 * - Fail-closed posture: unmeasurable outcomes and critical-severity drift
 *   surface as defects and escalations respectively — a policy can lower an
 *   escalation threshold, it can never exempt the most severe class.
 * - Bounded inputs: identifiers, statements, evidence sets and registries all
 *   carry hard ceilings. No unbounded structures.
 *
 * Neutral vocabulary only (J-037 shrink-only): an "expectation" is any
 * declared, checkable statement about governed behaviour; a "subject" is any
 * actor or process under evaluation. No domain vocabulary appears here.
 *
 * Pure contract module: no I/O, no persistence, no vendor imports, no
 * wall-clock reads, no secrets.
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Ceilings (no unbounded structures)
 * ────────────────────────────────────────────────────────────*/

/** Hard ceiling on statements of expectation or gap. */
export const STATEMENT_MAX_LENGTH = 2_000;

/** Hard ceiling on expectations in one parsed set. */
export const MAX_EXPECTATIONS_PER_SET = 512;

/** Hard ceiling on evidence items attached to one result or drift record. */
export const MAX_EVIDENCE_PER_RECORD = 64;

/** Hard ceiling on open escalations one policy may carry. */
export const MAX_OPEN_ESCALATIONS = 10_000;

/**
 * The phase-39 boundary, exported as a constant so downstream surfaces can
 * cite it rather than paraphrase it. Alignment is advisory; enforcement
 * authority lives with phases 08, 09 and 42 (D7, ADR PLATFORM-007).
 */
export const GOVERNANCE_ALIGNMENT_BOUNDARY =
  "alignment measures and escalates; it never enforces, grants, denies, or authorizes — enforcement authority remains with the phases that own it";

/**
 * The human-governance posture this surface encodes (AGENTS §7, §44):
 * autonomous intelligence contributes proposals and measurements; it never
 * independently redefines architecture or removes security boundaries.
 * Constitutional-boundary expectations are immutable here by construction.
 */
export const HUMAN_GOVERNANCE_POSTURE =
  "autonomous systems may not independently redefine architecture or remove security boundaries; constitutional-boundary expectations are immutable on this surface and all other expectation changes require a validated human approval record";

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
  /** Stable reference to the evaluated actor or process (not a secret). */
  subjectRef: nonEmptyBounded("subject.subjectRef", 256),
  subjectKind: subjectKindSchema,
});

export type Subject = z.infer<typeof subjectSchema>;

export const governanceProvenanceSchema = z.strictObject({
  /** Who declared the record (role or principal reference, not a secret). */
  declaredBy: nonEmptyBounded("provenance.declaredBy", 256),
  /** Under which authority the declaration was made (AGENTS §43). */
  authority: nonEmptyBounded("provenance.authority", 256),
  /** ISO-8601 timestamp of the declaration. */
  declaredAt: z.string().datetime(),
});

export type GovernanceProvenance = z.infer<typeof governanceProvenanceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Alignment expectations
 * ────────────────────────────────────────────────────────────*/

/**
 * Expectation kinds. `constitutional_boundary` marks an expectation that
 * encodes a security or governance boundary (AGENTS §4 hierarchy, §7): such
 * expectations are immutable on this surface — they cannot be relaxed or
 * retired here, only evaluated.
 */
export const expectationKindSchema = z.enum([
  "invariant_hold",
  "boundary_respect",
  "policy_conformance",
  "constitutional_boundary",
]);

export type ExpectationKind = z.infer<typeof expectationKindSchema>;

export const alignmentExpectationSchema = z
  .strictObject({
    expectationId: identifierSchema,
    kind: expectationKindSchema,
    /** The declared, checkable statement. Bounded; no free-form sprawl. */
    statement: nonEmptyBounded("expectation.statement", STATEMENT_MAX_LENGTH),
    severity: severitySchema,
    /** How the expectation is checked. An unmeasurable expectation is a
     * governance defect, so the measurement method is mandatory. */
    measurableVia: nonEmptyBounded("expectation.measurableVia", 512),
    /** Monotonic version. Changes produce a new version; never silent edits. */
    version: z.number().int().positive().max(1_000_000),
    status: z.enum(["active", "retired"]),
    /** Required when status is `retired`; a retirement without a named reason
     * is rejected (fail-closed). */
    retiredReason: nonEmptyBounded("expectation.retiredReason", STATEMENT_MAX_LENGTH).optional(),
    provenance: governanceProvenanceSchema,
  })
  .superRefine((value, ctx) => {
    if (value.status === "retired" && (value.retiredReason === undefined || value.retiredReason.trim().length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["retiredReason"],
        message: "a retired expectation must carry a retiredReason — fail-closed: no silent retirements",
      });
    }
  });

export type AlignmentExpectation = z.infer<typeof alignmentExpectationSchema>;

/* ─────────────────────────────────────────────────────────────
 * Evidence and conformance results
 * ────────────────────────────────────────────────────────────*/

export const evidenceKindSchema = z.enum([
  "direct_observation",
  "record_reference",
  "attestation",
]);

export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const conformanceEvidenceSchema = z.strictObject({
  evidenceRef: identifierSchema,
  evidenceKind: evidenceKindSchema,
  capturedAt: z.string().datetime(),
  capturedBy: nonEmptyBounded("evidence.capturedBy", 256),
});

export type ConformanceEvidence = z.infer<typeof conformanceEvidenceSchema>;

export const unmeasurableReasonSchema = z.enum([
  "expectation_not_measurable",
  "evidence_insufficient",
]);

export type UnmeasurableReason = z.infer<typeof unmeasurableReasonSchema>;

export const conformanceResultSchema = z
  .strictObject({
    expectationId: identifierSchema,
    /** The exact expectation version evaluated — results never float. */
    expectationVersion: z.number().int().positive(),
    subject: subjectSchema,
    evaluatedAt: z.string().datetime(),
    outcome: z.enum(["conformant", "nonconformant", "unmeasurable"]),
    /** Required when outcome is `nonconformant`: the named gap between the
     * expectation and the observed behaviour. */
    gap: nonEmptyBounded("result.gap", STATEMENT_MAX_LENGTH).optional(),
    /** Required when outcome is `unmeasurable`. */
    unmeasurableReason: unmeasurableReasonSchema.optional(),
    /** Every outcome — including `conformant` — is evidence-backed. Nothing
     * is assumed satisfied. */
    evidence: z
      .array(conformanceEvidenceSchema)
      .min(1, "a conformance result requires at least one evidence item — nothing is assumed satisfied")
      .max(MAX_EVIDENCE_PER_RECORD),
  })
  .superRefine((value, ctx) => {
    if (value.outcome === "nonconformant" && (value.gap === undefined || value.gap.trim().length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["gap"],
        message: "a nonconformant result must name the gap — fail-closed: gaps are named, never silent",
      });
    }
    if (value.outcome === "unmeasurable" && value.unmeasurableReason === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["unmeasurableReason"],
        message: "an unmeasurable result must carry its reason — it is a governance defect, not a pass",
      });
    }
    if (value.outcome !== "unmeasurable" && value.unmeasurableReason !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["unmeasurableReason"],
        message: "unmeasurableReason is only valid when the outcome is unmeasurable",
      });
    }
  });

export type ConformanceResult = z.infer<typeof conformanceResultSchema>;

/* ─────────────────────────────────────────────────────────────
 * Drift records
 * ────────────────────────────────────────────────────────────*/

export const alignmentDriftRecordSchema = z
  .strictObject({
    driftId: identifierSchema,
    expectationId: identifierSchema,
    expectationVersion: z.number().int().positive(),
    /** Actor attribution: drift is always attributed (AGENTS §21). */
    actor: subjectSchema,
    severity: severitySchema,
    firstObservedAt: z.string().datetime(),
    lastObservedAt: z.string().datetime(),
    /** References to the conformance results that evidenced this drift. */
    resultRefs: z
      .array(identifierSchema)
      .min(1, "a drift record requires at least one conformance result reference")
      .max(MAX_EVIDENCE_PER_RECORD),
    evidence: z
      .array(conformanceEvidenceSchema)
      .min(1, "a drift record requires at least one evidence item")
      .max(MAX_EVIDENCE_PER_RECORD),
  })
  .superRefine((value, ctx) => {
    if (value.lastObservedAt < value.firstObservedAt) {
      ctx.addIssue({
        code: "custom",
        path: ["lastObservedAt"],
        message: "lastObservedAt must not precede firstObservedAt",
      });
    }
  });

export type AlignmentDriftRecord = z.infer<typeof alignmentDriftRecordSchema>;

/* ─────────────────────────────────────────────────────────────
 * Escalation policy and records (advisory-only by construction)
 * ────────────────────────────────────────────────────────────*/

/** The floor for auto-escalation thresholds: `info` findings alone never
 * escalate, and no policy may exempt `critical` (fail-closed ceiling). */
export const escalationThresholdSchema = z.enum(["notice", "warning", "critical"]);

export type EscalationThreshold = z.infer<typeof escalationThresholdSchema>;

export const escalationPolicySchema = z.strictObject({
  policyId: identifierSchema,
  /** Drift at or above this severity must be escalated. */
  minEscalationSeverity: escalationThresholdSchema,
  /** The human oversight role drift is routed to (role reference). */
  oversightRole: nonEmptyBounded("policy.oversightRole", 256),
  /** Bound on simultaneously open escalations under this policy. */
  maxOpenEscalations: z.number().int().positive().max(MAX_OPEN_ESCALATIONS),
  /**
   * Literal `true`, enforced by the schema: a policy can never claim
   * enforcement or authorization authority. Alignment is advisory (D7).
   */
  advisoryOnly: z.literal(true),
});

export type EscalationPolicy = z.infer<typeof escalationPolicySchema>;

/**
 * Escalation record. `authorizes: z.literal(false)` is structural proof that
 * an escalation can never be consumed as an authorization decision — the
 * surface cannot even express one. Closure is human-only (`closedByHuman`).
 */
export const escalationRecordSchema = z
  .strictObject({
    escalationId: identifierSchema,
    driftId: identifierSchema,
    expectationId: identifierSchema,
    /** Role reference the finding was routed to. */
    routedTo: nonEmptyBounded("escalation.routedTo", 256),
    routedAt: z.string().datetime(),
    status: z.enum(["open", "acknowledged", "closed_by_human"]),
    acknowledgedAt: z.string().datetime().optional(),
    /** Human closure evidence. Machine closure does not exist here. */
    closedByHuman: z
      .strictObject({
        humanRef: nonEmptyBounded("escalation.closedByHuman.humanRef", 256),
        decidedAt: z.string().datetime(),
        note: nonEmptyBounded("escalation.closedByHuman.note", STATEMENT_MAX_LENGTH),
      })
      .optional(),
    /**
     * Literal `false`, enforced by the schema: this record never authorizes
     * anything (view-only governance boundary).
     */
    authorizes: z.literal(false),
  })
  .superRefine((value, ctx) => {
    if (value.status === "closed_by_human" && value.closedByHuman === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["closedByHuman"],
        message: "closing an escalation requires a human closure record — fail-closed: no machine closure",
      });
    }
    if (value.status !== "closed_by_human" && value.closedByHuman !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["closedByHuman"],
        message: "closedByHuman is only valid when the status is closed_by_human",
      });
    }
    if (value.status === "acknowledged" && value.acknowledgedAt === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["acknowledgedAt"],
        message: "an acknowledged escalation must carry acknowledgedAt",
      });
    }
  });

export type EscalationRecord = z.infer<typeof escalationRecordSchema>;

/* ─────────────────────────────────────────────────────────────
 * Human approval for expectation changes (AGENTS §7, §8, §44)
 * ────────────────────────────────────────────────────────────*/

export const humanApprovalSchema = z.strictObject({
  approvedBy: nonEmptyBounded("approval.approvedBy", 256),
  authority: nonEmptyBounded("approval.authority", 256),
  decidedAt: z.string().datetime(),
});

export type HumanApproval = z.infer<typeof humanApprovalSchema>;

export type RelaxationRejectionReason =
  /** Constitutional boundaries are immutable on this surface (AGENTS §7, §44). */
  | "constitutional_boundary_immutable"
  /** The approval record is missing or fails validation. */
  | "human_approval_required"
  | "human_approval_invalid";

export type RelaxationDecision =
  | { readonly ok: true; readonly expectationId: Identifier }
  | {
      readonly ok: false;
      readonly expectationId: Identifier;
      readonly reason: RelaxationRejectionReason;
      readonly detail: string;
    };

/**
 * Decide whether an expectation may be relaxed or retired.
 *
 * Fail-closed by design:
 * - `constitutional_boundary` expectations are refused unconditionally — no
 *   approval, human or otherwise, unlocks them on this surface; removing a
 *   security boundary is outside this module's authority entirely (AGENTS §7).
 * - Every other expectation requires a VALID human approval record; the
 *   approval input is parsed here, so a malformed or machine-shaped approval
 *   is rejected rather than trusted.
 */
export function decideRelaxation(
  expectation: AlignmentExpectation,
  approval: unknown,
): RelaxationDecision {
  if (expectation.kind === "constitutional_boundary") {
    return {
      ok: false,
      expectationId: expectation.expectationId,
      reason: "constitutional_boundary_immutable",
      detail: HUMAN_GOVERNANCE_POSTURE,
    };
  }

  const parsed = humanApprovalSchema.safeParse(approval);
  if (!parsed.success) {
    return {
      ok: false,
      expectationId: expectation.expectationId,
      reason: "human_approval_invalid",
      detail:
        "relaxation requires a valid human approval record (approvedBy, authority, decidedAt) — machine-authored or malformed approvals fail closed (AGENTS §8: AI improvement is not AI permission expansion)",
    };
  }

  return { ok: true, expectationId: expectation.expectationId };
}

/* ─────────────────────────────────────────────────────────────
 * Parsing (fail-closed: no partial expectation sets)
 * ────────────────────────────────────────────────────────────*/

export type ExpectationSetParseFailureReason =
  /** The input does not match the schema at all. */
  | "invalid_shape"
  /** A cross-record invariant failed (duplicate expectation ids). */
  | "cross_record_invariant";

export interface ExpectationSetIssue {
  readonly path: string;
  readonly message: string;
}

export type ExpectationSetParseResult =
  | { readonly ok: true; readonly expectations: readonly AlignmentExpectation[] }
  | {
      readonly ok: false;
      readonly reason: ExpectationSetParseFailureReason;
      readonly issues: readonly ExpectationSetIssue[];
    };

function issuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path.map((segment) => String(segment)).join(".");
}

/**
 * Parse an untrusted input into a set of alignment expectations. Any
 * violation — shape, bounds, duplicates, silent retirement — yields
 * `ok: false` with structured issues; a failed parse never yields a partial
 * set.
 */
export function parseAlignmentExpectations(input: unknown): ExpectationSetParseResult {
  const listSchema = z
    .array(alignmentExpectationSchema)
    .max(MAX_EXPECTATIONS_PER_SET);
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

  const issues: ExpectationSetIssue[] = [];
  const seen = new Set<Identifier>();
  for (const expectation of parsed.data) {
    if (seen.has(expectation.expectationId)) {
      issues.push({
        path: `[expectationId=${expectation.expectationId}]`,
        message: `duplicate expectation id "${expectation.expectationId}" — one id carries exactly one declared expectation`,
      });
    } else {
      seen.add(expectation.expectationId);
    }
  }

  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }

  return { ok: true, expectations: parsed.data };
}

/* ─────────────────────────────────────────────────────────────
 * Conformance summary (unmeasurable is a defect, never a pass)
 * ────────────────────────────────────────────────────────────*/

export interface ConformanceSummary {
  readonly total: number;
  readonly conformant: number;
  readonly nonconformant: number;
  readonly unmeasurable: number;
  /** Expectation ids with named gaps (nonconformant outcomes). */
  readonly gapExpectationIds: readonly Identifier[];
  /** Expectation ids with unmeasurable outcomes — governance defects. */
  readonly unmeasurableExpectationIds: readonly Identifier[];
  /** True only when there are zero defects and zero gaps. */
  readonly ok: boolean;
  readonly detail: string | null;
}

/**
 * Summarize conformance results over a fixed expectation set. Unmeasurable
 * outcomes are counted as DEFECTS: `ok` is true only when every expectation
 * is conformant with evidence, never when something could not be measured.
 */
export function summarizeConformance(
  results: readonly ConformanceResult[],
): ConformanceSummary {
  const gapExpectationIds: Identifier[] = [];
  const unmeasurableExpectationIds: Identifier[] = [];
  let conformant = 0;
  let nonconformant = 0;
  let unmeasurable = 0;

  for (const result of results) {
    if (result.outcome === "conformant") {
      conformant += 1;
    } else if (result.outcome === "nonconformant") {
      nonconformant += 1;
      gapExpectationIds.push(result.expectationId);
    } else {
      unmeasurable += 1;
      unmeasurableExpectationIds.push(result.expectationId);
    }
  }

  const total = results.length;
  const ok = total > 0 && nonconformant === 0 && unmeasurable === 0;
  const detail = ok
    ? null
    : `conformance incomplete: ${nonconformant} nonconformant (gaps named) and ${unmeasurable} unmeasurable (governance defects) of ${total} results — fail-closed: unmeasurable is never treated as satisfied`;

  return {
    total,
    conformant,
    nonconformant,
    unmeasurable,
    gapExpectationIds,
    unmeasurableExpectationIds,
    ok,
    detail,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Escalation decision (advisory routing; critical always escalates)
 * ────────────────────────────────────────────────────────────*/

export type EscalationDecision =
  | {
      readonly decision: "escalate";
      readonly driftId: Identifier;
      readonly routedTo: string;
      readonly detail: string;
    }
  | {
      readonly decision: "monitor";
      readonly driftId: Identifier;
      readonly detail: string;
    };

/**
 * Decide whether a drift record must be escalated under a policy.
 *
 * Fail-closed posture: drift at or above the policy threshold escalates, AND
 * `critical` drift escalates unconditionally — a policy can lower the
 * threshold but can never exempt the most severe class. The output is a
 * ROUTING decision to human oversight; it grants, denies and permits nothing.
 */
export function decideEscalation(
  policy: EscalationPolicy,
  drift: AlignmentDriftRecord,
): EscalationDecision {
  const atOrAboveThreshold = severityAtLeast(drift.severity, policy.minEscalationSeverity);
  if (atOrAboveThreshold || drift.severity === "critical") {
    return {
      decision: "escalate",
      driftId: drift.driftId,
      routedTo: policy.oversightRole,
      detail: `drift "${drift.driftId}" at severity "${drift.severity}" must be routed to human oversight ("${policy.oversightRole}") — advisory only: this routing authorizes nothing (GOVERNANCE_ALIGNMENT_BOUNDARY)`,
    };
  }
  return {
    decision: "monitor",
    driftId: drift.driftId,
    detail: `drift "${drift.driftId}" at severity "${drift.severity}" is below the escalation threshold "${policy.minEscalationSeverity}" — recorded for monitoring, never absorbed silently`,
  };
}
