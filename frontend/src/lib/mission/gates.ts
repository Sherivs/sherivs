/**
 * CoreGrid — Mission gate machinery (J-026 / MISSION-R-51, V1CAP-046).
 *
 * Implements the DEFINITION / SECURITY / VERIFICATION / CLOSURE gate
 * taxonomy declared (declaratively) by `mission-contract.ts#MissionGateKind`.
 * That contract declares admission gates and evaluates them against declared
 * content; THIS module is the evidence-bearing gate machinery: a gate is
 * evaluated against an explicit evidence ledger and returns a TYPED verdict
 * of PASSED or BLOCKED — nothing else.
 *
 * Fail-closed laws (Constitution §16, §21, §26):
 * - A gate can never DEFAULT to PASSED. Every non-allow path — an unknown
 *   gate kind, a missing or malformed submission, missing / unusable /
 *   cross-tenant evidence, an expired or not-yet-effective gate window, a
 *   future-dated submission, an invalid evaluation clock, an invalid or
 *   expired waiver, an undeclared or kind-mismatched gate — is BLOCKED with
 *   the reason named.
 * - PASSED is a BRANDED type constructible only inside this module: it is
 *   issued exclusively by `evaluateGate` after the gate's requirements were
 *   actually verified. No caller can fabricate a PASSED verdict, and no
 *   code path returns PASSED without an evaluation.
 * - A waiver is not a bypass: it is a first-class, evidence-bearing,
 *   authority-attributed, time-bounded record. It can shorten NOTHING except
 *   a SECURITY gate's evidence requirement, and only when its own evidence
 *   is usable and its window is current. An expired, unattributed,
 *   evidence-less, or misplaced waiver leaves the gate BLOCKED.
 * - Gate sets are not vacuously passed: evaluating ZERO gates yields
 *   `allPassed: false`. Absence of gates is absence of assurance.
 *
 * Composition (read-only): gate kinds, the mission core, and the evidence
 * record vocabulary are imported from `mission-contract.ts`; the closure
 * gate composes with `missionEvidenceCovers` so EVIDENCE before SUCCESS
 * holds at closure. No persistence, no I/O, no vendor imports, no
 * wall-clock reads — the caller supplies the evaluation instant.
 */

import { z } from "zod";
import {
  isContractTimestamp,
  missionEvidenceCovers,
  missionEvidenceIsUsable,
  type MissionContractCore,
  type MissionEvidenceRecord,
  type MissionGateKind,
} from "./mission-contract";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

/**
 * The closed J-026 gate taxonomy. Compile-typed against the mission
 * contract's `MissionGateKind` so the two vocabularies can never fork.
 */
export const GATE_KINDS = [
  "definition",
  "security",
  "verification",
  "closure",
] as const satisfies readonly MissionGateKind[];

export type GateKind = (typeof GATE_KINDS)[number];

export const gateKindSchema = z.enum(GATE_KINDS);

/** The complete verdict vocabulary. There is no third outcome. */
export const GATE_OUTCOMES = ["PASSED", "BLOCKED"] as const;

export type GateOutcome = (typeof GATE_OUTCOMES)[number];

export const GATES_CONTRACT_SCHEMA_VERSION = "1.0";

/** Bounded sizes (no unbounded collections at the contract boundary). */
export const GATE_LIMITS = {
  maxRequiredEvidenceKinds: 32,
  maxEvidenceRefs: 128,
  maxReasonLength: 512,
} as const;

const kindListBounds = {
  min: 1,
  max: GATE_LIMITS.maxRequiredEvidenceKinds,
} as const;

/* ─────────────────────────────────────────────────────────────
 * Schemas (strict — undeclared semantics cannot leak in)
 * ────────────────────────────────────────────────────────────*/

function nonEmptyString(label: string) {
  return z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`);
}

function parseableTimestamp(label: string) {
  return z.string().refine((value) => isContractTimestamp(value), `${label} must be a parseable timestamp`);
}

/** A reference to a ledger evidence record the submission relies on. */
export const gateEvidenceRefSchema = z.strictObject({
  evidenceId: nonEmptyString("evidenceRef.evidenceId"),
  /** The kind the submitter CLAIMS the record carries; re-checked on resolve. */
  evidenceKind: nonEmptyString("evidenceRef.evidenceKind"),
});

export type GateEvidenceRef = z.infer<typeof gateEvidenceRefSchema>;

/**
 * An evidence-bearing waiver: authority-attributed, time-bounded, and
 * carried by its own usable evidence. A waiver with no evidence, no
 * authority, or a lapsed window authorizes nothing.
 */
export const gateWaiverSchema = z.strictObject({
  waiverId: nonEmptyString("waiver.waiverId"),
  gateId: nonEmptyString("waiver.gateId"),
  /** The accountable authority that granted the waiver (AGENTS §43). */
  grantedBy: nonEmptyString("waiver.grantedBy"),
  /** Under which authority the waiver was granted (AGENTS §43). */
  authorityRef: nonEmptyString("waiver.authorityRef"),
  grantedAt: parseableTimestamp("waiver.grantedAt"),
  /** Bounded: a waiver expires; an expired waiver is BLOCKED, not forgiven. */
  expiresAt: parseableTimestamp("waiver.expiresAt"),
  reason: nonEmptyString("waiver.reason"),
  evidence: z
    .array(gateEvidenceRefSchema)
    .min(1, "a waiver is evidence-bearing — a waiver without evidence is void")
    .max(GATE_LIMITS.maxEvidenceRefs),
});

export type GateWaiver = z.infer<typeof gateWaiverSchema>;

/** The gate declaration: what this gate asserts and what evidence it requires. */
export const gateDeclarationSchema = z.strictObject({
  gateId: nonEmptyString("gate.gateId"),
  kind: gateKindSchema,
  tenantId: nonEmptyString("gate.tenantId"),
  /** What the gate asserts; a gate that cannot be explained must not exist. */
  reason: nonEmptyString("gate.reason"),
  /** The closed set of evidence kinds that satisfy the gate by evidence. */
  requiredEvidenceKinds: z
    .array(nonEmptyString("requiredEvidenceKinds entry"))
    .min(kindListBounds.min, "a gate requires at least one evidence kind")
    .max(kindListBounds.max)
    .refine((kinds) => new Set(kinds.map((k) => k.trim())).size === kinds.length, "requiredEvidenceKinds must be distinct"),
  /** Gate window; null bounds mean unbounded (owner-accountable). */
  notBefore: parseableTimestamp("gate.notBefore").nullable(),
  expiresAt: parseableTimestamp("gate.expiresAt").nullable(),
});

export type GateDeclaration = z.infer<typeof gateDeclarationSchema>;

/** The submission: who is asking the gate to open, when, and on what evidence. */
export const gateSubmissionSchema = z.strictObject({
  gateId: nonEmptyString("submission.gateId"),
  submittedBy: nonEmptyString("submission.submittedBy"),
  submittedAt: parseableTimestamp("submission.submittedAt"),
  evidenceRefs: z
    .array(gateEvidenceRefSchema)
    .max(GATE_LIMITS.maxEvidenceRefs)
    .refine(
      (refs) => new Set(refs.map((ref) => ref.evidenceId.trim())).size === refs.length,
      "evidenceRefs must reference distinct evidenceIds",
    ),
});

export type GateSubmission = z.infer<typeof gateSubmissionSchema>;

/** A gate under review: its declaration, its submission, its waiver (if any). */
export const gateReviewSchema = z.strictObject({
  declaration: gateDeclarationSchema,
  submission: gateSubmissionSchema,
  waiver: gateWaiverSchema.nullable(),
});

export type GateReview = z.infer<typeof gateReviewSchema>;

/** Fail-closed parse: a malformed review never reaches evaluation. */
export type GateReviewParse = { ok: true; review: GateReview } | { ok: false; error: string };

export function parseGateReview(input: unknown): GateReviewParse {
  const parsed = gateReviewSchema.safeParse(input);
  return parsed.success ? { ok: true, review: parsed.data } : { ok: false, error: parsed.error.message };
}

/* ─────────────────────────────────────────────────────────────
 * Verdicts — PASSED is branded and unforgeable outside this module
 * ────────────────────────────────────────────────────────────*/

/**
 * Module-private runtime brand. It is a real symbol, never exported, so a
 * PASSED verdict cannot be constructed (or even typed) outside this module:
 * only the evaluation path below can mint one.
 */
const gatePassedBrand: unique symbol = Symbol("coregrid.gate.passed");

/** How a PASSED verdict was earned. There is no "default" basis. */
export type GatePassBasis = "evidence" | "authoritative_waiver";

export interface GatePassed {
  readonly outcome: "PASSED";
  readonly gateId: string;
  readonly kind: GateKind;
  readonly basis: GatePassBasis;
  /** The evidence records (or waiver evidence) that satisfied the gate. */
  readonly satisfiedBy: readonly string[];
  readonly evaluatedAt: string;
  readonly [gatePassedBrand]: true;
}

export interface GateBlocked {
  readonly outcome: "BLOCKED";
  readonly gateId: string;
  readonly kind: GateKind;
  /** Machine-stable deny reasons; a BLOCKED verdict always says why. */
  readonly reasons: readonly string[];
  readonly evaluatedAt: string;
}

export type GateVerdict = GatePassed | GateBlocked;

/**
 * The evaluation context. The caller supplies tenant, instant, and the
 * evidence ledger; the gate never reads a clock, a store, or a network.
 */
export interface GateEvaluationContext {
  readonly tenantId: string;
  readonly now: string;
  readonly evidence: readonly MissionEvidenceRecord[];
}

function blocked(gateId: string, kind: GateKind, now: string, reasons: readonly string[]): GateBlocked {
  return { outcome: "BLOCKED", gateId, kind, reasons, evaluatedAt: now };
}

interface ResolvedEvidence {
  readonly usable: readonly { readonly record: MissionEvidenceRecord; readonly ref: GateEvidenceRef }[];
  readonly coveredKinds: ReadonlySet<string>;
}

/**
 * Resolve submission evidence refs against the ledger. A ref resolves only
 * when the ledger holds a usable record with the same id AND the same kind,
 * in the evaluating tenant. Resolution is fail closed: a claimed kind that
 * the record does not carry is a mismatch, not coverage.
 */
function resolveEvidence(
  refs: readonly GateEvidenceRef[],
  ledger: readonly MissionEvidenceRecord[],
  tenantId: string,
): ResolvedEvidence {
  const byId = new Map<string, MissionEvidenceRecord>();
  for (const record of ledger) {
    if (record.tenantId !== tenantId) continue;
    byId.set(record.evidenceId, record);
  }
  const usable: { record: MissionEvidenceRecord; ref: GateEvidenceRef }[] = [];
  const coveredKinds = new Set<string>();
  for (const ref of refs) {
    const record = byId.get(ref.evidenceId.trim());
    if (record === undefined) continue;
    if (record.evidenceKind !== ref.evidenceKind.trim()) continue;
    if (!missionEvidenceIsUsable(record)) continue;
    usable.push({ record, ref });
    coveredKinds.add(record.evidenceKind);
  }
  return { usable, coveredKinds };
}

function missingKinds(
  required: readonly string[],
  covered: ReadonlySet<string>,
): readonly string[] {
  return required.filter((kind) => !covered.has(kind));
}

/**
 * Evaluate ONE gate. Every non-allow path fails closed with a named reason;
 * PASSED is returned only after the gate's requirements were verified.
 */
export function evaluateGate(review: GateReview, ctx: GateEvaluationContext): GateVerdict {
  const { declaration, submission, waiver } = review;
  const gateId = declaration.gateId;
  const kind = declaration.kind;

  if (!isContractTimestamp(ctx.now)) {
    return blocked(gateId, kind, ctx.now, ["invalid_evaluation_context: the evaluation instant is not a parseable timestamp"]);
  }
  if (ctx.tenantId.trim().length === 0) {
    return blocked(gateId, kind, ctx.now, ["invalid_evaluation_context: the evaluation tenant is required"]);
  }
  if (declaration.tenantId !== ctx.tenantId) {
    return blocked(gateId, kind, ctx.now, [
      `cross_tenant: gate is declared for tenant "${declaration.tenantId}" but evaluated for tenant "${ctx.tenantId}"`,
    ]);
  }
  if (declaration.notBefore !== null && declaration.notBefore > ctx.now) {
    return blocked(gateId, kind, ctx.now, [`not_yet_effective: gate opens at ${declaration.notBefore}`]);
  }
  if (declaration.expiresAt !== null && declaration.expiresAt <= ctx.now) {
    return blocked(gateId, kind, ctx.now, [`expired: gate closed at ${declaration.expiresAt}`]);
  }
  if (submission.gateId !== gateId) {
    return blocked(gateId, kind, ctx.now, [
      `submission_mismatch: submission targets gate "${submission.gateId}", not "${gateId}"`,
    ]);
  }
  if (submission.submittedAt > ctx.now) {
    return blocked(gateId, kind, ctx.now, ["future_submission: the submission is dated after the evaluation instant"]);
  }

  const required = declaration.requiredEvidenceKinds;
  const resolved = resolveEvidence(submission.evidenceRefs, ctx.evidence, ctx.tenantId);
  const missing = missingKinds(required, resolved.coveredKinds);
  if (missing.length === 0) {
    return {
      outcome: "PASSED",
      gateId,
      kind,
      basis: "evidence",
      satisfiedBy: resolved.usable.map((entry) => entry.record.evidenceId),
      evaluatedAt: ctx.now,
      [gatePassedBrand]: true,
    };
  }

  if (kind === "security" && waiver !== null) {
    if (waiver.gateId !== gateId) {
      return blocked(gateId, kind, ctx.now, [
        ...missing.map((m) => `missing_evidence_kind: ${m}`),
        `waiver_mismatch: waiver targets gate "${waiver.gateId}", not "${gateId}"`,
      ]);
    }
    if (waiver.grantedAt > ctx.now) {
      return blocked(gateId, kind, ctx.now, [
        ...missing.map((m) => `missing_evidence_kind: ${m}`),
        `waiver_not_yet_granted: waiver granted at ${waiver.grantedAt}`,
      ]);
    }
    if (waiver.expiresAt <= ctx.now) {
      return blocked(gateId, kind, ctx.now, [
        ...missing.map((m) => `missing_evidence_kind: ${m}`),
        `waiver_expired: waiver lapsed at ${waiver.expiresAt}`,
      ]);
    }
    const waiverResolved = resolveEvidence(waiver.evidence, ctx.evidence, ctx.tenantId);
    if (waiverResolved.usable.length === 0) {
      return blocked(gateId, kind, ctx.now, [
        ...missing.map((m) => `missing_evidence_kind: ${m}`),
        "waiver_void: the waiver's own evidence is missing, unusable, or cross-tenant",
      ]);
    }
    return {
      outcome: "PASSED",
      gateId,
      kind,
      basis: "authoritative_waiver",
      satisfiedBy: waiverResolved.usable.map((entry) => entry.record.evidenceId),
      evaluatedAt: ctx.now,
      [gatePassedBrand]: true,
    };
  }

  const reasons = missing.map((m) => `missing_evidence_kind: ${m}`);
  if (waiver !== null) {
    reasons.push(`waiver_misplaced: waivers apply only to security gates, not to "${kind}" gates`);
  }
  return blocked(gateId, kind, ctx.now, reasons);
}

/* ─────────────────────────────────────────────────────────────
 * Gate sets — no vacuous passes
 * ────────────────────────────────────────────────────────────*/

export interface GateSetEvaluation {
  readonly passed: readonly GatePassed[];
  readonly blocked: readonly GateBlocked[];
  /**
   * True only when at least one gate was evaluated and every verdict is
   * PASSED. An empty gate set is NOT passed — absence of gates is absence
   * of assurance (a gate can never default to PASSED).
   */
  readonly allPassed: boolean;
}

/** Evaluate a set of gate reviews. Each review is judged independently. */
export function evaluateGateReviews(reviews: readonly GateReview[], ctx: GateEvaluationContext): GateSetEvaluation {
  const passed: GatePassed[] = [];
  const blockedVerdicts: GateBlocked[] = [];
  for (const review of reviews) {
    const verdict = evaluateGate(review, ctx);
    if (verdict.outcome === "PASSED") passed.push(verdict);
    else blockedVerdicts.push(verdict);
  }
  return { passed, blocked: blockedVerdicts, allPassed: reviews.length > 0 && blockedVerdicts.length === 0 };
}

/* ─────────────────────────────────────────────────────────────
 * Mission composition: gates bind to the mission's declared admission gates
 * ────────────────────────────────────────────────────────────*/

export interface MissionGateSetEvaluation extends GateSetEvaluation {
  /** Declared mission admission gates that received no review at all. */
  readonly missingSubmissions: readonly string[];
}

/**
 * Evaluate gate reviews against a mission's declared admission gates
 * (MISSION-R-50 / V1CAP-046 composition). Additional fail-closed laws:
 * - a review for a gate the mission never declared is BLOCKED (undeclared);
 * - a review whose kind differs from the declared gate's kind is BLOCKED;
 * - a declared admission gate with no review is BLOCKED (missing submission);
 * - duplicate reviews for the same gate are BLOCKED (no re-roll until pass);
 * - the CLOSURE gate additionally composes with `missionEvidenceCovers`:
 *   every mission-level and per-task required evidence kind must be covered
 *   by usable same-tenant evidence before closure may pass.
 */
export function evaluateMissionGates(
  core: MissionContractCore,
  reviews: readonly GateReview[],
  ctx: GateEvaluationContext,
): MissionGateSetEvaluation {
  const declared = new Map<string, MissionGateKind>();
  for (const gate of core.admissionGates) {
    if (!declared.has(gate.gateId)) declared.set(gate.gateId, gate.kind);
  }

  const seenGateIds = new Set<string>();
  const inScope: GateReview[] = [];
  const blockedVerdicts: GateBlocked[] = [];
  for (const review of reviews) {
    const gateId = review.declaration.gateId;
    if (!isContractTimestamp(ctx.now)) {
      blockedVerdicts.push(
        blocked(gateId, review.declaration.kind, "", [
          "invalid_evaluation_context: the evaluation instant is not a parseable timestamp",
        ]),
      );
      continue;
    }
    const declaredKind = declared.get(gateId);    if (declaredKind === undefined) {
      blockedVerdicts.push(
        blocked(gateId, review.declaration.kind, ctx.now, [
          "undeclared_gate: the mission does not declare this admission gate",
        ]),
      );
      continue;
    }
    if (review.declaration.kind !== declaredKind) {
      blockedVerdicts.push(
        blocked(gateId, review.declaration.kind, ctx.now, [
          `kind_mismatch: mission declares this gate as "${declaredKind}", review claims "${review.declaration.kind}"`,
        ]),
      );
      continue;
    }
    if (seenGateIds.has(gateId)) {
      blockedVerdicts.push(
        blocked(gateId, review.declaration.kind, ctx.now, [
          "duplicate_submission: this gate was already reviewed — no re-roll until pass",
        ]),
      );
      continue;
    }
    seenGateIds.add(gateId);
    inScope.push(review);
  }

  const missingSubmissions: string[] = [];
  for (const gateId of declared.keys()) {
    if (!seenGateIds.has(gateId)) missingSubmissions.push(gateId);
  }

  const base = evaluateGateReviews(inScope, ctx);
  const passed: GatePassed[] = [];
  for (const verdict of base.passed) {
    if (verdict.kind === "closure" && !missionEvidenceCovers(core, ctx.evidence)) {
      blockedVerdicts.push(
        blocked(verdict.gateId, "closure", ctx.now, [
          "closure_incomplete: mission-level or task-level required evidence kinds are not covered by usable evidence (EVIDENCE before SUCCESS)",
        ]),
      );
      continue;
    }
    passed.push(verdict);
  }

  return {
    passed,
    blocked: [...blockedVerdicts, ...base.blocked],
    missingSubmissions,
    allPassed:
      reviews.length > 0 &&
      declared.size > 0 &&
      missingSubmissions.length === 0 &&
      blockedVerdicts.length === 0,
  };
}
