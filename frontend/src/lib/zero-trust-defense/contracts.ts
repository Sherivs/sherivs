/**
 * CoreGrid — phase 42 substrate surface: zero trust & adversarial defense
 * contracts (H3 wave Squad G, mission G-062; Contract Architect, phase 42).
 *
 * WHAT: Zod-validated contracts for the adversarial-defense substrate —
 * classification of untrusted inputs and subjects, restrictive defense
 * verdicts on those classifications, and escalation paths that route defense
 * findings to human oversight. This module owns the STRUCTURE of that
 * surface; it does not own authorization decisions (phase 08) or trust
 * evidence (phase 09), and it never expresses an authorization grant.
 *
 * Laws of this module:
 * - Untrusted by default (AGENTS §5, phase-42 §1/§4): every subject and every
 *   input is untrusted until classified by evidence on THIS evaluation. No
 *   trust state persists across evaluations; a subject classifying its own
 *   input is rejected outright.
 * - Recommendation-only by construction (D7, ADR PLATFORM-007; kernel
 *   contract phase-42): defense classifies, verifies and recommends; it never
 *   grants, revokes or overrides access. The §16 decision vocabulary is
 *   encoded in full as a platform reference, but the verdict schema is the
 *   vocabulary minus `allow` — the surface is structurally unable to express
 *   an authorization grant, and every verdict record carries
 *   `recommendsOnly: true` as a schema-level literal.
 * - Fail-closed defaults: an unclassifiable input is `indeterminate`, and
 *   `indeterminate` never passes silently — it escalates. A verdict of
 *   `escalate` must name its escalation route. Critical-severity findings
 *   escalate unconditionally: a policy may lower an escalation threshold, it
 *   can never exempt the most severe class.
 * - Evidence-based (canonical truth, AGENTS §9): a classification above
 *   `benign` requires at least one named signal; every verdict is
 *   evidence-backed. Nothing hostile is assumed benign by silence.
 * - Fail-closed parsing: any invariant violation — shape, bounds, duplicate
 *   identifiers, dangling cross-references — yields a typed failure with
 *   structured issues; a failed parse never yields a partial surface.
 * - Bounded inputs: statements, signal sets, evidence sets and batches all
 *   carry hard ceilings. No unbounded structures.
 *
 * Neutral vocabulary only (J-037 shrink-only): an "input" is any datum or
 * request entering the platform; a "subject" is any actor or process acting
 * on it; a "signal" is any observed indicator; a "verdict" is a recommended
 * restrictive handling posture. No domain vocabulary appears here.
 *
 * Pure contract module: no I/O, no persistence, no vendor imports, no
 * wall-clock reads, no secrets. Never records or transmits secret values.
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Ceilings (no unbounded structures)
 * ────────────────────────────────────────────────────────────*/

/** Hard ceiling on rationale or statement text. */
export const STATEMENT_MAX_LENGTH = 2_000;

/** Hard ceiling on signal details attached to one classification. */
export const SIGNAL_DETAIL_MAX_LENGTH = 512;

/** Hard ceiling on signals in one classification. */
export const MAX_SIGNALS_PER_CLASSIFICATION = 32;

/** Hard ceiling on evidence items attached to one verdict. */
export const MAX_EVIDENCE_PER_VERDICT = 64;

/** Hard ceiling on classifications in one parsed surface batch. */
export const MAX_CLASSIFICATIONS_PER_BATCH = 512;

/** Hard ceiling on verdicts in one parsed surface batch. */
export const MAX_VERDICTS_PER_BATCH = 512;

/** Hard ceiling on escalations in one parsed surface batch. */
export const MAX_ESCALATIONS_PER_BATCH = 512;

/**
 * The phase-42 boundary, exported as a constant so downstream surfaces can
 * cite it rather than paraphrase it. Defense is recommendation-only;
 * enforcement and authorization authority remains with the phases that own
 * it (D7, ADR PLATFORM-007).
 */
export const ZERO_TRUST_DEFENSE_BOUNDARY =
  "defense classifies, verifies and recommends; it never grants, revokes or overrides access, and it never weakens a control to make an exercise pass — enforcement and authorization authority remains with the phases that own it";

/**
 * The zero-trust posture this surface encodes (AGENTS §5; phase-42 §4, §298):
 * no entity receives permanent trust. Classification and verdicts are
 * re-evaluated on every observation; no trust state persists across
 * evaluations.
 */
export const UNTRUSTED_BY_DEFAULT_POSTURE =
  "every subject and every input is untrusted by default; trust is never permanent and every classification is re-evaluated from evidence on each observation";

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

/**
 * The platform decision vocabulary (AGENTS §16), encoded in full as a
 * reference so consumers cite it rather than re-spell it. The DEFENSE
 * verdict schema below is this vocabulary minus `allow` — see
 * `defenseVerdictSchema`.
 */
export const DECISION_VOCABULARY = [
  "allow",
  "deny",
  "redact",
  "escalate",
  "require_approval",
] as const;

export const decisionVocabularySchema = z.enum(DECISION_VOCABULARY);

export type DecisionVocabulary = z.infer<typeof decisionVocabularySchema>;

/**
 * Restrictive defense verdicts: the §16 decision vocabulary minus `allow`.
 * Structural proof that the defense surface can never emit an authorization
 * grant — ALLOW remains with the authorization owner (phase 08, D7).
 */
export const defenseVerdictSchema = z.enum(["deny", "redact", "escalate", "require_approval"]);

export type DefenseVerdict = z.infer<typeof defenseVerdictSchema>;

/** Where an evaluated input or subject comes from. Every origin is
 * untrusted; the origin only informs classification, never grants passage. */
export const inputOriginSchema = z.enum([
  "unverified_client",
  "autonomous_agent",
  "machine_pipeline",
  "human_session",
]);

export type InputOrigin = z.infer<typeof inputOriginSchema>;

export const subjectKindSchema = z.enum([
  "autonomous_agent",
  "automated_process",
  "external_origin",
  "human_initiated",
]);

export type SubjectKind = z.infer<typeof subjectKindSchema>;

export const subjectSchema = z.strictObject({
  /** Stable reference to the evaluated actor or process (not a secret). */
  subjectRef: nonEmptyBounded("subject.subjectRef", 256),
  subjectKind: subjectKindSchema,
});

export type Subject = z.infer<typeof subjectSchema>;

export const defenseProvenanceSchema = z.strictObject({
  /** Who asserted the record (role or principal reference, not a secret). */
  assertedBy: nonEmptyBounded("provenance.assertedBy", 256),
  /** Under which authority the assertion was made (AGENTS §43). */
  authority: nonEmptyBounded("provenance.authority", 256),
  /** ISO-8601 timestamp of the assertion. */
  assertedAt: z.string().datetime(),
});

export type DefenseProvenance = z.infer<typeof defenseProvenanceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Untrusted input classification
 * ────────────────────────────────────────────────────────────*/

export const signalSchema = z.strictObject({
  signalKind: identifierSchema,
  severity: severitySchema,
  detail: nonEmptyBounded("signal.detail", SIGNAL_DETAIL_MAX_LENGTH),
});

export type Signal = z.infer<typeof signalSchema>;

/**
 * Classification outcomes. `indeterminate` is the fail-closed class: an
 * input that cannot be classified from evidence is indeterminate and NEVER
 * passes silently — it escalates.
 */
export const classificationOutcomeSchema = z.enum([
  "benign",
  "suspect",
  "hostile",
  "indeterminate",
]);

export type ClassificationOutcome = z.infer<typeof classificationOutcomeSchema>;

export const indeterminateReasonSchema = z.enum([
  "signals_conflicting",
  "signals_insufficient",
]);

export type IndeterminateReason = z.infer<typeof indeterminateReasonSchema>;

export const inputClassificationSchema = z
  .strictObject({
    classificationId: identifierSchema,
    /** Reference to the evaluated input (record reference, not a secret). */
    inputRef: nonEmptyBounded("classification.inputRef", 256),
    origin: inputOriginSchema,
    subject: subjectSchema,
    outcome: classificationOutcomeSchema,
    /** Required (>= 1) when the outcome is not `benign`: nothing above benign
     * is asserted from silence. */
    signals: z.array(signalSchema).max(MAX_SIGNALS_PER_CLASSIFICATION),
    /** Required when outcome is `indeterminate`. */
    indeterminateReason: indeterminateReasonSchema.optional(),
    /** Who produced the classification. Must never be the evaluated subject
     * itself for non-human subjects (self-classification is rejected). */
    classifiedBy: nonEmptyBounded("classification.classifiedBy", 256),
    classifiedAt: z.string().datetime(),
    provenance: defenseProvenanceSchema,
  })
  .superRefine((value, ctx) => {
    if (value.outcome !== "benign" && value.signals.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["signals"],
        message:
          "a classification above benign requires at least one signal — fail-closed: nothing is asserted from silence",
      });
    }
    if (value.outcome === "indeterminate" && value.indeterminateReason === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["indeterminateReason"],
        message:
          "an indeterminate classification must carry its reason — it is a defense defect, never a silent pass",
      });
    }
    if (value.outcome !== "indeterminate" && value.indeterminateReason !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["indeterminateReason"],
        message: "indeterminateReason is only valid when the outcome is indeterminate",
      });
    }
    if (
      value.subject.subjectKind !== "human_initiated" &&
      value.classifiedBy === value.subject.subjectRef
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["classifiedBy"],
        message:
          "a non-human subject cannot classify its own input — fail-closed: self-classification is rejected (untrusted by default, AGENTS §5)",
      });
    }
  });

export type InputClassification = z.infer<typeof inputClassificationSchema>;

/* ─────────────────────────────────────────────────────────────
 * Defense verdicts (recommendation-only by construction)
 * ────────────────────────────────────────────────────────────*/

export const verdictEvidenceSchema = z.strictObject({
  evidenceRef: identifierSchema,
  capturedAt: z.string().datetime(),
  capturedBy: nonEmptyBounded("evidence.capturedBy", 256),
});

export type VerdictEvidence = z.infer<typeof verdictEvidenceSchema>;

export const defenseVerdictRecordSchema = z
  .strictObject({
    verdictId: identifierSchema,
    /** The classification this verdict is issued against. */
    classificationId: identifierSchema,
    subject: subjectSchema,
    verdict: defenseVerdictSchema,
    severity: severitySchema,
    rationale: nonEmptyBounded("verdict.rationale", STATEMENT_MAX_LENGTH),
    /** Evidence backing the verdict — verdicts are never assumed. */
    evidence: z
      .array(verdictEvidenceSchema)
      .min(1, "a defense verdict requires at least one evidence item — verdicts are never assumed")
      .max(MAX_EVIDENCE_PER_VERDICT),
    /** Required when verdict is `escalate`: an escalation without a named
     * route is rejected (fail-closed). */
    escalationRouteRef: nonEmptyBounded("verdict.escalationRouteRef", 256).optional(),
    issuedAt: z.string().datetime(),
    issuedBy: nonEmptyBounded("verdict.issuedBy", 256),
    /**
     * Literal `true`, enforced by the schema: a verdict can never claim
     * enforcement or authorization authority (D7; ZERO_TRUST_DEFENSE_BOUNDARY).
     */
    recommendsOnly: z.literal(true),
  })
  .superRefine((value, ctx) => {
    if (value.verdict === "escalate" && value.escalationRouteRef === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["escalationRouteRef"],
        message: "an escalate verdict must name its escalation route — fail-closed: no routeless escalations",
      });
    }
  });

export type DefenseVerdictRecord = z.infer<typeof defenseVerdictRecordSchema>;

/* ─────────────────────────────────────────────────────────────
 * Escalation paths (human oversight; machine closure does not exist)
 * ────────────────────────────────────────────────────────────*/

/** The floor for escalation thresholds: `info` findings alone never
 * escalate, and no policy may exempt `critical` (fail-closed ceiling). */
export const escalationThresholdSchema = z.enum(["notice", "warning", "critical"]);

export type EscalationThreshold = z.infer<typeof escalationThresholdSchema>;

export const defenseEscalationPolicySchema = z.strictObject({
  policyId: identifierSchema,
  /** Findings at or above this severity must be escalated. */
  minEscalationSeverity: escalationThresholdSchema,
  /** The human oversight role findings are routed to (role reference). */
  oversightRole: nonEmptyBounded("policy.oversightRole", 256),
  /** Literal `true`: escalation closure is human-only on this surface. */
  requiresHumanClosure: z.literal(true),
  /**
   * Literal `true`, enforced by the schema: a policy can never claim
   * enforcement or authorization authority.
   */
  recommendsOnly: z.literal(true),
});

export type DefenseEscalationPolicy = z.infer<typeof defenseEscalationPolicySchema>;

/**
 * Escalation record. `authorizes: z.literal(false)` is structural proof that
 * an escalation can never be consumed as an authorization decision — the
 * surface cannot even express one. Closure is human-only (`closedByHuman`).
 */
export const defenseEscalationRecordSchema = z
  .strictObject({
    escalationId: identifierSchema,
    verdictId: identifierSchema,
    classificationId: identifierSchema,
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
     * anything — defense escalates to oversight, it never grants or denies
     * access itself (phase 42 boundary; AGENTS §16 decision vocabulary is
     * owned downstream by the authorization phase).
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

export type DefenseEscalationRecord = z.infer<typeof defenseEscalationRecordSchema>;

/* ─────────────────────────────────────────────────────────────
 * Defense action decision (recommendation-only; fail-closed defaults)
 * ────────────────────────────────────────────────────────────*/

export type DefenseActionDecision =
  | {
      readonly kind: "defense_verdict";
      readonly verdict: DefenseVerdict;
      readonly classificationId: Identifier;
      readonly rationale: string;
    }
  | {
      readonly kind: "defense_abstains";
      readonly classificationId: Identifier;
      readonly detail: string;
    };

/**
 * Decide the recommended defense action for a classification.
 *
 * Fail-closed by design:
 * - `hostile` → `deny` (recommended; enforcement belongs to phase 08).
 * - `suspect` → `redact` (minimize what leaves the boundary; AGENTS §19).
 * - `indeterminate` → `escalate` (the fail-closed default: an input that
 *   cannot be classified never passes silently).
 * - `benign` → defense abstains. Abstention is NOT an `allow`: the defense
 *   surface structurally cannot express one; the authorization owner decides
 *   passage (ZERO_TRUST_DEFENSE_BOUNDARY).
 */
export function recommendedDefenseAction(
  classification: InputClassification,
): DefenseActionDecision {
  switch (classification.outcome) {
    case "hostile":
      return {
        kind: "defense_verdict",
        verdict: "deny",
        classificationId: classification.classificationId,
        rationale: `input "${classification.inputRef}" classified hostile from ${classification.signals.length} signal(s) — recommend deny; enforcement authority remains with the authorization phase (ZERO_TRUST_DEFENSE_BOUNDARY)`,
      };
    case "suspect":
      return {
        kind: "defense_verdict",
        verdict: "redact",
        classificationId: classification.classificationId,
        rationale: `input "${classification.inputRef}" classified suspect — recommend redact/minimize before any downstream processing (AGENTS §19)`,
      };
    case "indeterminate":
      return {
        kind: "defense_verdict",
        verdict: "escalate",
        classificationId: classification.classificationId,
        rationale: `input "${classification.inputRef}" is indeterminate (${classification.indeterminateReason ?? "unspecified"}) — fail-closed: an unclassifiable input never passes silently`,
      };
    case "benign":
      return {
        kind: "defense_abstains",
        classificationId: classification.classificationId,
        detail: `input "${classification.inputRef}" classified benign from evidence — defense abstains; abstention is not an allow and the defense surface cannot express one (ZERO_TRUST_DEFENSE_BOUNDARY)`,
      };
  }
}

/* ─────────────────────────────────────────────────────────────
 * Escalation path decision (critical always escalates)
 * ────────────────────────────────────────────────────────────*/

export type EscalationPathDecision =
  | {
      readonly decision: "escalate";
      readonly verdictId: Identifier;
      readonly routedTo: string;
      readonly detail: string;
    }
  | {
      readonly decision: "monitor";
      readonly verdictId: Identifier;
      readonly detail: string;
    };

/**
 * Decide whether a defense verdict must be escalated to human oversight
 * under a policy.
 *
 * Fail-closed posture: findings at or above the policy threshold escalate,
 * AND `critical` findings escalate unconditionally — a policy can lower the
 * threshold but can never exempt the most severe class. The output is a
 * ROUTING decision to human oversight; it grants, denies and permits nothing.
 */
export function decideEscalationPath(
  policy: DefenseEscalationPolicy,
  verdict: DefenseVerdictRecord,
): EscalationPathDecision {
  const atOrAboveThreshold = severityAtLeast(verdict.severity, policy.minEscalationSeverity);
  if (atOrAboveThreshold || verdict.severity === "critical") {
    return {
      decision: "escalate",
      verdictId: verdict.verdictId,
      routedTo: policy.oversightRole,
      detail: `verdict "${verdict.verdictId}" (${verdict.verdict}) at severity "${verdict.severity}" must be routed to human oversight ("${policy.oversightRole}") — recommendation only: this routing authorizes nothing (ZERO_TRUST_DEFENSE_BOUNDARY)`,
    };
  }
  return {
    decision: "monitor",
    verdictId: verdict.verdictId,
    detail: `verdict "${verdict.verdictId}" (${verdict.verdict}) at severity "${verdict.severity}" is below the escalation threshold "${policy.minEscalationSeverity}" — recorded for monitoring, never absorbed silently`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Parsing (fail-closed: no partial defense surfaces)
 * ────────────────────────────────────────────────────────────*/

export type DefenseSurfaceParseFailureReason =
  /** The input does not match the schema at all. */
  | "invalid_shape"
  /** A cross-record invariant failed (duplicate ids or dangling references). */
  | "cross_record_invariant";

export interface DefenseSurfaceIssue {
  readonly path: string;
  readonly message: string;
}

export interface DefenseSurface {
  readonly classifications: readonly InputClassification[];
  readonly verdicts: readonly DefenseVerdictRecord[];
  readonly escalations: readonly DefenseEscalationRecord[];
}

export type DefenseSurfaceParseResult =
  | { readonly ok: true; readonly surface: DefenseSurface }
  | {
      readonly ok: false;
      readonly reason: DefenseSurfaceParseFailureReason;
      readonly issues: readonly DefenseSurfaceIssue[];
    };

function issuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path.map((segment) => String(segment)).join(".");
}

const defenseSurfaceInputSchema = z.strictObject({
  classifications: z.array(inputClassificationSchema).max(MAX_CLASSIFICATIONS_PER_BATCH),
  verdicts: z.array(defenseVerdictRecordSchema).max(MAX_VERDICTS_PER_BATCH),
  escalations: z.array(defenseEscalationRecordSchema).max(MAX_ESCALATIONS_PER_BATCH),
});

/**
 * Parse an untrusted input into a defense surface. Any violation — shape,
 * bounds, duplicate identifiers, verdicts referencing unknown
 * classifications, escalations referencing unknown verdicts or
 * classifications — yields `ok: false` with structured issues; a failed
 * parse never yields a partial surface.
 */
export function parseDefenseSurface(input: unknown): DefenseSurfaceParseResult {
  const parsed = defenseSurfaceInputSchema.safeParse(input);
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

  const { classifications, verdicts, escalations } = parsed.data;
  const issues: DefenseSurfaceIssue[] = [];

  function checkDuplicates<K extends "classificationId" | "verdictId" | "escalationId">(
    label: string,
    key: K,
    records: readonly { readonly [P in K]: Identifier }[],
  ): Set<Identifier> {
    const seen = new Set<Identifier>();
    for (const record of records) {
      const id = record[key];
      if (seen.has(id)) {
        issues.push({
          path: `[${key}=${id}]`,
          message: `duplicate ${label} id "${id}" — one id carries exactly one record`,
        });
      } else {
        seen.add(id);
      }
    }
    return seen;
  }

  const classificationIds = checkDuplicates("classification", "classificationId", classifications);
  const verdictIds = checkDuplicates("verdict", "verdictId", verdicts);
  checkDuplicates("escalation", "escalationId", escalations);

  for (const verdict of verdicts) {
    if (!classificationIds.has(verdict.classificationId)) {
      issues.push({
        path: `[verdictId=${verdict.verdictId}].classificationId`,
        message: `verdict "${verdict.verdictId}" references unknown classification "${verdict.classificationId}" — fail-closed: verdicts are only issued against parsed classifications`,
      });
    }
  }
  for (const escalation of escalations) {
    if (!verdictIds.has(escalation.verdictId)) {
      issues.push({
        path: `[escalationId=${escalation.escalationId}].verdictId`,
        message: `escalation "${escalation.escalationId}" references unknown verdict "${escalation.verdictId}" — fail-closed: escalations are only raised against parsed verdicts`,
      });
    }
    if (!classificationIds.has(escalation.classificationId)) {
      issues.push({
        path: `[escalationId=${escalation.escalationId}].classificationId`,
        message: `escalation "${escalation.escalationId}" references unknown classification "${escalation.classificationId}" — fail-closed: escalations must cite their classification`,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }

  return { ok: true, surface: { classifications, verdicts, escalations } };
}

/* ─────────────────────────────────────────────────────────────
 * Surface posture summary (unresolved threats are defects, never passes)
 * ────────────────────────────────────────────────────────────*/

export interface DefenseSurfaceSummary {
  readonly totalClassifications: number;
  readonly benign: number;
  readonly suspect: number;
  readonly hostile: number;
  readonly indeterminate: number;
  readonly verdictsIssued: number;
  readonly openEscalations: number;
  /** Classification ids above benign with no verdict issued against them. */
  readonly unresolvedClassificationIds: readonly Identifier[];
  /** True only when nothing hostile/indeterminate is unresolved and no
   * escalation is left open. */
  readonly ok: boolean;
  readonly detail: string | null;
}

/**
 * Summarize a defense surface. A classification above `benign` without a
 * verdict, and any open escalation, are DEFECTS: `ok` is true only when
 * every non-benign classification has been verdicted and every escalation is
 * human-closed or acknowledged — never when a threat was silently ignored.
 */
export function summarizeDefenseSurface(surface: DefenseSurface): DefenseSurfaceSummary {
  let benign = 0;
  let suspect = 0;
  let hostile = 0;
  const indeterminateIds: Identifier[] = [];
  const unresolvedClassificationIds: Identifier[] = [];

  const verdictedClassificationIds = new Set<Identifier>();
  for (const verdict of surface.verdicts) {
    verdictedClassificationIds.add(verdict.classificationId);
  }

  for (const classification of surface.classifications) {
    switch (classification.outcome) {
      case "benign":
        benign += 1;
        break;
      case "suspect":
        suspect += 1;
        break;
      case "hostile":
        hostile += 1;
        break;
      case "indeterminate":
        indeterminateIds.push(classification.classificationId);
        break;
    }
    if (classification.outcome !== "benign" && !verdictedClassificationIds.has(classification.classificationId)) {
      unresolvedClassificationIds.push(classification.classificationId);
    }
  }

  const openEscalations = surface.escalations.filter(
    (escalation) => escalation.status !== "closed_by_human",
  ).length;

  const totalClassifications = surface.classifications.length;
  const indeterminate = indeterminateIds.length;
  const ok =
    totalClassifications > 0 &&
    unresolvedClassificationIds.length === 0 &&
    openEscalations === 0;
  const detail = ok
    ? null
    : `defense surface incomplete: ${unresolvedClassificationIds.length} non-benign classification(s) without a verdict (of which ${indeterminate} indeterminate — a defense defect, never a pass) and ${openEscalations} escalation(s) not human-closed — fail-closed: threats are verdicted and escalations closed, never silently absorbed`;

  return {
    totalClassifications,
    benign,
    suspect,
    hostile,
    indeterminate,
    verdictsIssued: surface.verdicts.length,
    openEscalations,
    unresolvedClassificationIds,
    ok,
    detail,
  };
}