/**
 * CoreGrid — state reconciliation & contradiction engine over cg_observation
 * (V1CAP-005 / J-004 / MISSION-R-14), composed over the bi-temporal law of
 * kernel/reality.ts and the dedup/ordering vocabulary of
 * kernel/event-semantics.ts.
 *
 * E-029 (REALITY.md §53-55) and G-094 demand that conflicting observations
 * are reconciled by EXPLICIT rules while unknown remains unknown. This module
 * IS that contract. Law of this module:
 *
 * - APPEND-ONLY RESOLUTION: reconciliation never mutates, deletes or
 *   overwrites a conflicting record. Every verdict references its inputs by
 *   id, retires superseded records through the bi-temporal `supersedes`
 *   pointer, collapses duplicate deliveries behind a representative, and
 *   retains every losing candidate in the verdict's residual uncertainty.
 *   Running reconciliation twice over the same inputs yields the same
 *   verdicts — resolution is a derived record, never a destructive act.
 *
 * - DECLARED RULES ONLY: conflicts are decided by an explicit, declared rule
 *   cascade — evidence-class rank, then source-reliability tier, then recency
 *   within validity, then record-time knowledge. The precedence is itself
 *   declared (and overridable only by a full permutation — a partial
 *   precedence silently drops rules and is rejected). The verdict records
 *   which rule decided. NO rule runs that was not declared; NO value is
 *   picked that no rule decided.
 *
 * - EVIDENCE-CLASS RANKS (J-034 vocabulary, mirrored from evidence/capture.ts
 *   because kernel modules import only kernel-internal modules):
 *   direct_observation outranks EVERY quarantine class — generated, attested,
 *   derived, predicted, simulated. A quarantine-class record can never
 *   out-rank a direct observation by recency or reliability; that is the
 *   class-laundering guard applied at reconciliation time.
 *
 * - UNKNOWN PRESERVATION (G-094): an unknown value stays UNKNOWN through
 *   every path. Absence of observations is an explicit UNKNOWN verdict —
 *   never interpolated, never assumed, never fabricated from missingness. An
 *   unknown-validity record is flagged and never silently assumed to cover
 *   any instant. An unresolved contradiction surfaces as UNRESOLVED — it is
 *   never silently picked, not even deterministically.
 *
 * - BI-TEMPORAL FIDELITY (V1CAP-004): the valid-time coordinate of an
 *   observation is its `valid_from` when stamped, else its `observed_at`;
 *   validity is KNOWN only when that coordinate exists and
 *   valid_time_known !== false. With `at`, known-validity candidates must
 *   cover the instant and a supersession retires a record only where the
 *   superseding record covers the instant — a correction never rewrites
 *   history outside its own validity. With `recordedAsOf`, corrections
 *   recorded after the cutoff are invisible (the knowledge-state view).
 *
 * - TENANT ISOLATION: reconciliation is per-tenant by construction — a
 *   tenant scope is mandatory, out-of-scope records (including null-tenant
 *   rows) are never inputs, and a `supersedes` pointer that crosses the
 *   tenant boundary fails closed through the kernel supersession law.
 *
 * - VERDICTS ARE EVIDENCE-BEARING: a verdict carries its inputs, the rule
 *   applied, the outcome, a resolution trace and residual uncertainty, and
 *   can be stamped into the kernel through the canonical CoreObject envelope
 *   (`verdictDraft`) and captured as evidence (`verdictEvidenceClaim`).
 *
 * Boundary: pure module — no persistence, no I/O, no wall-clock sampling
 * (every instant is a supplied parameter), no state.
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "./event-semantics";
import {
  biTemporalColumns,
  isConfidence,
  isEnvelopeRef,
  isObservationKind,
  isTimestamp,
  resolveSupersession,
  stampKernelDraft,
  type KernelBiTemporalColumns,
  type KernelObjectEnvelopeInput,
  type ObservationKind,
} from "./reality";

/* ─────────────────────────────────────────────────────────────
 * Typed rejection
 * ────────────────────────────────────────────────────────────*/

export type ReconciliationErrorCode =
  | "invalid_observation_field"
  | "invalid_reconciliation_options"
  | "invalid_rule_declaration"
  | "invalid_verdict_envelope";

export class ReconciliationError extends Error {
  readonly code: ReconciliationErrorCode;

  constructor(code: ReconciliationErrorCode, message: string) {
    super(message);
    this.name = "ReconciliationError";
    this.code = code;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Observation values — explicit known/UNKNOWN (G-094)
 * ────────────────────────────────────────────────────────────*/

/**
 * The reconciled value of an attribute. `known: false` is an EXPLICIT
 * UNKNOWN — a first-class truth state, never a placeholder and never
 * interpolated from absence.
 */
export interface ObservationValue {
  readonly known: boolean;
  /** The observed value when known; null when the value is UNKNOWN. */
  readonly value: unknown;
}

/** Declare a known value. `undefined` is not a JSON value and is rejected. */
export function knownValue(value: unknown): ObservationValue {
  if (value === undefined) {
    throw new ReconciliationError(
      "invalid_observation_field",
      "reconciliation known values must be JSON values — undefined is not a value",
    );
  }
  return { known: true, value };
}

/** Declare an explicit UNKNOWN value (G-094): missing stays missing. */
export function unknownValue(): ObservationValue {
  return { known: false, value: null };
}

export function isUnknownObservationValue(value: ObservationValue): boolean {
  return value.known !== true;
}

/**
 * Canonical value equality: structurally identical values are equal
 * regardless of key construction order (canonical JSON), and two explicit
 * UNKNOWNs are equal to each other.
 */
export function sameObservationValue(a: ObservationValue, b: ObservationValue): boolean {
  return canonicalJson({ known: a.known === true, value: a.known === true ? a.value : null }) ===
    canonicalJson({ known: b.known === true, value: b.known === true ? b.value : null });
}

/* ─────────────────────────────────────────────────────────────
 * Declared rule vocabulary
 * ────────────────────────────────────────────────────────────*/

export type ReconciliationRuleId =
  | "evidence_class_rank"
  | "source_reliability"
  | "recency_within_validity"
  | "record_time_knowledge";

export interface ReconciliationRule {
  readonly id: ReconciliationRuleId;
  readonly description: string;
}

/**
 * The declared rule cascade, in default precedence order. A caller may
 * override the order only with a FULL permutation of this set — a partial
 * precedence silently drops rules and is rejected (fail-closed).
 */
export const RECONCILIATION_RULE_PRECEDENCE: readonly ReconciliationRuleId[] = Object.freeze([
  "evidence_class_rank",
  "source_reliability",
  "recency_within_validity",
  "record_time_knowledge",
]);

export const RECONCILIATION_RULES: readonly ReconciliationRule[] = Object.freeze([
  {
    id: "evidence_class_rank",
    description:
      "evidence-class rank: direct_observation outranks every quarantine class " +
      "(attested, derived, generated, predicted, simulated) — J-034 at reconciliation time",
  },
  {
    id: "source_reliability",
    description: "declared source-reliability tier: authoritative > reliable > provisional > unverified",
  },
  {
    id: "recency_within_validity",
    description:
      "recency within validity: among candidates tied above, the latest known valid-time coordinate wins; " +
      "unknown-validity candidates rank below every known-validity candidate (never assumed to cover an instant)",
  },
  {
    id: "record_time_knowledge",
    description:
      "record-time knowledge: among candidates tied above, the latest recorded_at wins — later knowledge " +
      "reflects better information; an exact tie remains an UNRESOLVED contradiction",
  },
] as const);

/* ─────────────────────────────────────────────────────────────
 * Evidence-class vocabulary (mirrored from evidence/capture.ts —
 * kernel modules import only kernel-internal modules) and ranks
 * ────────────────────────────────────────────────────────────*/

export type ReconciliationEvidenceClass =
  | "direct_observation"
  | "generated"
  | "simulated"
  | "predicted"
  | "derived"
  | "attested";

export const RECONCILIATION_EVIDENCE_CLASSES: readonly ReconciliationEvidenceClass[] = [
  "direct_observation",
  "generated",
  "simulated",
  "predicted",
  "derived",
  "attested",
] as const;

/**
 * Declared evidence-class rank (higher outranks lower): direct_observation is
 * the ONLY canonical-truth class and outranks every quarantine class.
 * Among quarantine classes the declared order is attested (a recorded human
 * validation act) > derived > generated > predicted > simulated.
 */
export const EVIDENCE_CLASS_RANK: Readonly<Record<ReconciliationEvidenceClass, number>> = Object.freeze({
  direct_observation: 5,
  attested: 4,
  derived: 3,
  generated: 2,
  predicted: 1,
  simulated: 0,
});

/* ─────────────────────────────────────────────────────────────
 * Source-reliability tiers (declared, closed vocabulary)
 * ────────────────────────────────────────────────────────────*/

export type SourceReliabilityTier = "authoritative" | "reliable" | "provisional" | "unverified";

export const SOURCE_RELIABILITY_TIERS: readonly SourceReliabilityTier[] = [
  "authoritative",
  "reliable",
  "provisional",
  "unverified",
] as const;

export const RELIABILITY_RANK: Readonly<Record<SourceReliabilityTier, number>> = Object.freeze({
  authoritative: 3,
  reliable: 2,
  provisional: 1,
  unverified: 0,
});

/* ─────────────────────────────────────────────────────────────
 * Observation read shape (composition over kernel/reality.ts
 * observationDraft rows — substrate column names, no redefinition)
 * ────────────────────────────────────────────────────────────*/

export interface ReconciliationObservation {
  /** Persistent observation id (1–160 characters). */
  readonly id: string;
  readonly tenant_id: string | null;
  readonly subject_entity_id: string;
  /** The reconciled attribute coordinate (1–128 characters). */
  readonly attribute: string;
  readonly value: ObservationValue;
  readonly kind: ObservationKind;
  /** Declared evidence class (J-034 vocabulary, mirrored above). */
  readonly evidence_class: ReconciliationEvidenceClass;
  /** Declared source-reliability tier. */
  readonly reliability: SourceReliabilityTier;
  readonly confidence: number | null;
  /** Valid-time coordinate fallback when no bi-temporal stamp is present. */
  readonly observed_at: string | null;
  /** RECORD time — when the system learned it (mandatory). */
  readonly recorded_at: string;
  /** Bi-temporal validity interval start (V1CAP-004 column), passthrough. */
  readonly valid_from: string | null;
  /** Bi-temporal validity interval end (V1CAP-004 column), passthrough. */
  readonly valid_until: string | null;
  /** Bi-temporal validity knowledge flag (V1CAP-004 column), passthrough. */
  readonly valid_time_known: boolean | null;
  /** Append-only correction pointer (V1CAP-004 column), passthrough. */
  readonly supersedes: string | null;
  readonly observer_identity?: string | null;
  readonly source_ref?: string | null;
}

/** Structural shape of an `observationDraft(...)` row from kernel/reality.ts. */
export interface ObservationDraftShape {
  readonly subject_entity_id: string;
  readonly statement: Record<string, unknown>;
  readonly kind: ObservationKind;
  readonly tenant_id: string | null;
  readonly confidence: number | null;
  readonly observed_at: string | null;
  readonly recorded_at: string;
  readonly valid_from?: string | null;
  readonly valid_until?: string | null;
  readonly valid_time_known?: boolean;
  readonly supersedes?: string | null;
  readonly observer_identity?: string | null;
  readonly source_ref?: string | null;
}

export interface ObservationFactInput {
  /** Persistent observation id (drafts carry none until the database assigns one). */
  readonly id: string;
  /** Declared evidence class — not on the draft; declared by the caller. */
  readonly evidenceClass: ReconciliationEvidenceClass;
  /** Declared source-reliability tier — not on the draft; declared by the caller. */
  readonly reliability: SourceReliabilityTier;
  /** Attribute coordinate; defaults to `statement.attribute` (string). */
  readonly attribute?: string;
  /** Explicit value override; defaults to the declared statement convention. */
  readonly value?: ObservationValue;
}

/**
 * Compose a reconciliation fact from an `observationDraft(...)` row verbatim.
 * Statement convention: `statement.attribute` (when no attribute override),
 * and either `statement.value` (known) or `statement.value_unknown === true`
 * (explicit UNKNOWN). Fails closed when the statement declares neither.
 */
export function factFromObservationDraft(
  draft: ObservationDraftShape,
  meta: ObservationFactInput,
): ReconciliationObservation {
  const attribute = meta.attribute ?? (typeof draft.statement.attribute === "string" ? draft.statement.attribute : null);
  if (attribute == null) {
    throw new ReconciliationError(
      "invalid_observation_field",
      `observation draft "${meta.id}" declares no attribute: pass one or set statement.attribute`,
    );
  }
  const value =
    meta.value ??
    (draft.statement.value_unknown === true
      ? unknownValue()
      : "value" in draft.statement
        ? knownValue(draft.statement.value)
        : null);
  if (value == null) {
    throw new ReconciliationError(
      "invalid_observation_field",
      `observation draft "${meta.id}" declares no value: set statement.value or statement.value_unknown`,
    );
  }
  return {
    id: meta.id,
    tenant_id: draft.tenant_id,
    subject_entity_id: draft.subject_entity_id,
    attribute,
    value,
    kind: draft.kind,
    evidence_class: meta.evidenceClass,
    reliability: meta.reliability,
    confidence: draft.confidence,
    observed_at: draft.observed_at,
    recorded_at: draft.recorded_at,
    valid_from: draft.valid_from ?? null,
    valid_until: draft.valid_until ?? null,
    valid_time_known: draft.valid_time_known ?? null,
    supersedes: draft.supersedes ?? null,
    observer_identity: draft.observer_identity ?? null,
    source_ref: draft.source_ref ?? null,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Options
 * ────────────────────────────────────────────────────────────*/

export interface SubjectAttribute {
  readonly subjectEntityId: string;
  readonly attribute: string;
}

export interface ReconcileOptions {
  /** REQUIRED tenant scope — reconciliation never crosses tenants. */
  readonly tenantId: string;
  /** The reconciliation instant (record time of the verdicts) — supplied, never sampled. */
  readonly recordedAt: string;
  /** As-of-VALID-time instant: reconcile the state of reality at this instant. */
  readonly at?: string;
  /** Record-time knowledge cutoff: corrections recorded after this are invisible. */
  readonly recordedAsOf?: string;
  /**
   * Explicit partial-observability query: subject/attribute pairs that MUST
   * receive a verdict even when no observation exists — the verdict is
   * UNKNOWN (missing stays missing; absence is never silently skipped).
   */
  readonly requiredAttributes?: readonly SubjectAttribute[];
  /** Full-permutation override of the declared rule precedence. */
  readonly rulePrecedence?: readonly ReconciliationRuleId[];
  /** Explicitly disabled rules — declared; their conflicts may surface unresolved. */
  readonly disabledRules?: readonly ReconciliationRuleId[];
}

/* ─────────────────────────────────────────────────────────────
 * Verdict record (append-only, evidence-bearing)
 * ────────────────────────────────────────────────────────────*/

export type ReconciliationOutcome =
  | "CONVERGED"
  | "RESOLVED"
  | "UNKNOWN"
  | "UNRESOLVED_CONTRADICTION";

export interface ResolutionTraceEntry {
  readonly rule: ReconciliationRuleId;
  /** Candidate ids remaining after this rule narrowed the front. */
  readonly front_after: readonly string[];
}

export interface ResidualUncertainty {
  /** Losing candidates — retained verbatim, never destroyed. */
  readonly losing_candidate_ids: readonly string[];
  /** Candidates whose valid time is unknown — flagged, never assumed. */
  readonly unknown_validity_candidate_ids: readonly string[];
  /** Candidates not applicable at `at` (their validity does not cover it). */
  readonly not_applicable_ids: readonly string[];
  /** True when the resolved state itself is UNKNOWN. */
  readonly explicit_unknown: boolean;
  readonly winner_confidence: number | null;
  /** Candidates tying after every declared rule — surfaced, never picked. */
  readonly unresolved_candidate_ids: readonly string[];
}

/** The canonical kernel object type a stamped verdict draft carries. */
export const RECONCILIATION_VERDICT_OBJECT_TYPE = "core.reconciliation.verdict";

export interface ReconciliationVerdict {
  readonly object_type: typeof RECONCILIATION_VERDICT_OBJECT_TYPE;
  readonly verdict_id: string;
  readonly tenant_id: string;
  readonly subject_entity_id: string;
  readonly attribute: string;
  readonly outcome: ReconciliationOutcome;
  /** The declared rule that decided the conflict (null when none did). */
  readonly rule_applied: ReconciliationRuleId | null;
  /** Every rule that was enabled for this reconciliation, in applied order. */
  readonly applied_rules: readonly ReconciliationRuleId[];
  /** How the front narrowed, rule by rule (explainability). */
  readonly resolution_trace: readonly ResolutionTraceEntry[];
  /** The reconciled value; null ONLY for unresolved contradictions. */
  readonly value: ObservationValue | null;
  /** The single winning candidate, when one rule isolated exactly one. */
  readonly winner_id: string | null;
  /** Every candidate id that entered the reconciliation for this coordinate. */
  readonly inputs: readonly string[];
  /** Candidates retired by a supersession pointer (retained, never deleted). */
  readonly superseded: readonly string[];
  /** Duplicate deliveries collapsed behind a representative. */
  readonly duplicates: readonly string[];
  readonly residual_uncertainty: ResidualUncertainty;
  /** Verdict validity: the reconciled instant when `at` was given. */
  readonly valid_from: string | null;
  readonly valid_time_known: boolean;
  readonly recorded_at: string;
  readonly provenance: {
    readonly method: string;
    readonly rule_precedence: readonly ReconciliationRuleId[];
  };
}

/* ─────────────────────────────────────────────────────────────
 * Result
 * ────────────────────────────────────────────────────────────*/

export interface ReconciliationStats {
  readonly records_scoped: number;
  readonly records_considered: number;
  readonly duplicates_collapsed: number;
  readonly superseded_retired: number;
  readonly conflicts: number;
  readonly converged: number;
  readonly resolved: number;
  readonly unknown_outcomes: number;
  readonly unresolved: number;
}

export interface ReconciliationResult {
  readonly tenant_id: string;
  readonly at: string | null;
  readonly recorded_as_of: string | null;
  readonly recorded_at: string;
  readonly rule_precedence: readonly ReconciliationRuleId[];
  readonly verdicts: readonly ReconciliationVerdict[];
  readonly unresolved_verdicts: readonly ReconciliationVerdict[];
  readonly stats: ReconciliationStats;
}

/* ─────────────────────────────────────────────────────────────
 * Internal helpers
 * ────────────────────────────────────────────────────────────*/

function requireRef(
  value: unknown,
  field: string,
  maxLength: number,
  code: ReconciliationErrorCode = "invalid_observation_field",
): string {
  if (!isEnvelopeRef(value, maxLength)) {
    throw new ReconciliationError(code, `reconciliation ${field} must be 1–${maxLength} characters`);
  }
  return (value as string).trim();
}

function requireTimestamp(
  value: string | null | undefined,
  field: string,
  code: ReconciliationErrorCode = "invalid_observation_field",
): string | null {
  if (value == null || value === "") return null;
  if (!isTimestamp(value)) {
    throw new ReconciliationError(code, `reconciliation ${field} must be an ISO-8601 timestamp`);
  }
  return value;
}

function epochOf(value: string | null): number | null {
  return value == null ? null : Date.parse(value);
}

/** The valid-time coordinate of an observation (valid_from, else observed_at). */
function validCoordinateOf(observation: ReconciliationObservation): string | null {
  return observation.valid_from?.trim() || observation.observed_at;
}

function validityKnownOf(observation: ReconciliationObservation): boolean {
  if (observation.valid_time_known === false) return false;
  return validCoordinateOf(observation) != null;
}

/** Mirrors reality.ts coverage semantics over the observation's validity. */
function coversAt(observation: ReconciliationObservation, atMs: number): boolean {
  const from = epochOf(validCoordinateOf(observation));
  if (from == null) return false;
  const until = epochOf(observation.valid_until ?? null);
  return from <= atMs && (until == null || atMs < until);
}

function validateObservation(observation: ReconciliationObservation): void {
  requireRef(observation.id, "observation id", 160);
  requireRef(observation.subject_entity_id, "subject_entity_id", 160);
  requireRef(observation.attribute, "attribute", 128);
  if (observation.tenant_id != null) requireRef(observation.tenant_id, "tenant_id", 128);
  if (!isObservationKind(observation.kind)) {
    throw new ReconciliationError(
      "invalid_observation_field",
      `observation "${observation.id}" kind is not a registered observation kind`,
    );
  }
  if (!(RECONCILIATION_EVIDENCE_CLASSES as readonly unknown[]).includes(observation.evidence_class)) {
    throw new ReconciliationError(
      "invalid_observation_field",
      `observation "${observation.id}" evidence_class is not a registered evidence class`,
    );
  }
  if (!(SOURCE_RELIABILITY_TIERS as readonly unknown[]).includes(observation.reliability)) {
    throw new ReconciliationError(
      "invalid_observation_field",
      `observation "${observation.id}" reliability is not a registered source-reliability tier`,
    );
  }
  if (observation.confidence != null && !isConfidence(observation.confidence)) {
    throw new ReconciliationError(
      "invalid_observation_field",
      `observation "${observation.id}" confidence must be a finite number between 0 and 1`,
    );
  }
  if (requireTimestamp(observation.recorded_at, "recorded_at") == null) {
    throw new ReconciliationError(
      "invalid_observation_field",
      `observation "${observation.id}" requires recorded_at — record time is mandatory`,
    );
  }
  requireTimestamp(observation.observed_at, "observed_at");
  requireTimestamp(observation.valid_from, "valid_from");
  requireTimestamp(observation.valid_until, "valid_until");
  if (observation.value.known !== true && observation.value.known !== false) {
    throw new ReconciliationError(
      "invalid_observation_field",
      `observation "${observation.id}" value must declare known: true or known: false`,
    );
  }
  if (observation.value.known === false && observation.value.value !== null) {
    throw new ReconciliationError(
      "invalid_observation_field",
      `observation "${observation.id}" declares an UNKNOWN value but carries one — unknown values carry no value (G-094)`,
    );
  }
  // Mirrors the bi-temporal write-path CHECK: an unknown-validity record
  // never claims a validity interval.
  if (
    observation.valid_time_known === false &&
    (observation.valid_from != null || observation.valid_until != null)
  ) {
    throw new ReconciliationError(
      "invalid_observation_field",
      `observation "${observation.id}" validity flagged unknown must not claim a valid_from/valid_until interval`,
    );
  }
  if (observation.supersedes != null) {
    requireRef(observation.supersedes, "supersedes", 160);
  }
}

/** The content digest of an observation: identical content is one observation delivered twice. */
function observationDigest(observation: ReconciliationObservation): string {
  const content = {
    tenant_id: observation.tenant_id ?? null,
    subject_entity_id: observation.subject_entity_id,
    attribute: observation.attribute,
    value: { known: observation.value.known === true, value: observation.value.known === true ? observation.value.value : null },
    kind: observation.kind,
    evidence_class: observation.evidence_class,
    reliability: observation.reliability,
    confidence: observation.confidence,
    validity: {
      coordinate: validCoordinateOf(observation),
      known: validityKnownOf(observation),
      until: observation.valid_until ?? null,
    },
    observer_identity: observation.observer_identity ?? null,
    source_ref: observation.source_ref ?? null,
  };
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

function verdictId(tenantId: string, subjectId: string, attribute: string): string {
  return `recon:${createHash("sha256")
    .update(canonicalJson({ tenant_id: tenantId, subject_entity_id: subjectId, attribute }))
    .digest("hex")
    .slice(0, 24)}`;
}

/** The rule key of a candidate under one declared rule. */
function ruleKey(
  rule: ReconciliationRuleId,
  observation: ReconciliationObservation,
): number {
  switch (rule) {
    case "evidence_class_rank":
      return EVIDENCE_CLASS_RANK[observation.evidence_class];
    case "source_reliability":
      return RELIABILITY_RANK[observation.reliability];
    case "recency_within_validity":
      return validityKnownOf(observation)
        ? (epochOf(validCoordinateOf(observation)) ?? Number.NEGATIVE_INFINITY)
        : Number.NEGATIVE_INFINITY;
    case "record_time_knowledge":
      return epochOf(observation.recorded_at) ?? Number.NEGATIVE_INFINITY;
  }
}

interface GroupWork {
  readonly verdicts: ReconciliationVerdict[];
  duplicates: number;
  superseded: number;
}

/* ─────────────────────────────────────────────────────────────
 * reconcileObservations — the reconciliation entry point
 * ────────────────────────────────────────────────────────────*/

export function reconcileObservations(
  observations: readonly ReconciliationObservation[],
  options: ReconcileOptions,
): ReconciliationResult {
  const tenantId = requireRef(options.tenantId, "tenantId", 128, "invalid_reconciliation_options");
  const recordedAt = requireTimestamp(options.recordedAt, "recordedAt", "invalid_reconciliation_options");
  if (recordedAt == null) {
    throw new ReconciliationError(
      "invalid_reconciliation_options",
      "reconciliation requires recordedAt — the verdict record time is supplied, never sampled",
    );
  }
  const at = requireTimestamp(options.at, "at", "invalid_reconciliation_options");
  const recordedAsOf = requireTimestamp(options.recordedAsOf, "recordedAsOf", "invalid_reconciliation_options");

  const precedence = options.rulePrecedence ?? RECONCILIATION_RULE_PRECEDENCE;
  if (
    !Array.isArray(precedence) ||
    precedence.length !== RECONCILIATION_RULE_PRECEDENCE.length ||
    new Set(precedence).size !== precedence.length ||
    precedence.some((rule) => !(RECONCILIATION_RULE_PRECEDENCE as readonly unknown[]).includes(rule))
  ) {
    throw new ReconciliationError(
      "invalid_rule_declaration",
      "rulePrecedence must be a full permutation of the declared rule set — a partial precedence silently drops rules and is rejected",
    );
  }
  const disabled = new Set<ReconciliationRuleId>();
  if (options.disabledRules != null) {
    if (!Array.isArray(options.disabledRules)) {
      throw new ReconciliationError(
        "invalid_rule_declaration",
        "disabledRules must be an array of declared rule ids",
      );
    }
    for (const rule of options.disabledRules) {
      if (!(RECONCILIATION_RULE_PRECEDENCE as readonly unknown[]).includes(rule)) {
        throw new ReconciliationError(
          "invalid_rule_declaration",
          `disabled rule "${String(rule)}" is not a declared reconciliation rule`,
        );
      }
      disabled.add(rule);
    }
  }
  const effectivePrecedence = precedence.filter((rule) => !disabled.has(rule));

  const atMs = at == null ? null : Date.parse(at);
  const cutoffMs = recordedAsOf == null ? null : Date.parse(recordedAsOf);

  for (const entry of options.requiredAttributes ?? []) {
    requireRef(entry.subjectEntityId, "requiredAttributes subjectEntityId", 160, "invalid_reconciliation_options");
    requireRef(entry.attribute, "requiredAttributes attribute", 128, "invalid_reconciliation_options");
  }

  // Tenant scoping: out-of-scope records (including null-tenant rows) are
  // never inputs. Record-time cutoff: not-yet-known records are invisible.
  const scoped = observations.filter(
    (observation) => (observation.tenant_id ?? null) === tenantId,
  );
  const considered = scoped.filter((observation) => {
    const recordedMs = epochOf(observation.recorded_at);
    if (recordedMs == null) {
      throw new ReconciliationError(
        "invalid_observation_field",
        `observation "${observation.id}" has no parsable recorded_at — record time is mandatory`,
      );
    }
    return cutoffMs == null || recordedMs <= cutoffMs;
  });
  for (const observation of considered) validateObservation(observation);

  // Fail-closed supersession-graph validation (composition over the kernel
  // supersession law: dangling pointers, self-supersession, cycles and
  // cross-tenant pointers all throw here).
  resolveSupersession(considered);
  const supersederBySuperseded = new Map<string, ReconciliationObservation>();
  for (const observation of considered) {
    if (observation.supersedes != null) {
      supersederBySuperseded.set(observation.supersedes, observation);
    }
  }

  const groups = new Map<string, { subject: string; attribute: string; facts: ReconciliationObservation[] }>();
  for (const observation of considered) {
    const key = `${observation.subject_entity_id}\u0000${observation.attribute}`;
    const group = groups.get(key);
    if (group == null) {
      groups.set(key, {
        subject: observation.subject_entity_id,
        attribute: observation.attribute,
        facts: [observation],
      });
    } else {
      group.facts.push(observation);
    }
  }
  for (const entry of options.requiredAttributes ?? []) {
    const key = `${entry.subjectEntityId}\u0000${entry.attribute}`;
    if (!groups.has(key)) {
      groups.set(key, { subject: entry.subjectEntityId, attribute: entry.attribute, facts: [] });
    }
  }

  const work: GroupWork = { verdicts: [], duplicates: 0, superseded: 0 };
  for (const group of groups.values()) {
    const verdict = reconcileGroup(group, {
      tenantId,
      at,
      atMs,
      recordedAt,
      effectivePrecedence,
      supersederBySuperseded,
    });
    work.verdicts.push(verdict);
    work.duplicates += verdict.duplicates.length;
    work.superseded += verdict.superseded.length;
  }

  const verdicts = [...work.verdicts].sort((a, b) =>
    a.subject_entity_id === b.subject_entity_id
      ? a.attribute < b.attribute
        ? -1
        : a.attribute > b.attribute
          ? 1
          : 0
      : a.subject_entity_id < b.subject_entity_id
        ? -1
        : 1,
  );
  const unresolvedVerdicts = verdicts.filter((v) => v.outcome === "UNRESOLVED_CONTRADICTION");

  const stats: ReconciliationStats = {
    records_scoped: scoped.length,
    records_considered: considered.length,
    duplicates_collapsed: work.duplicates,
    superseded_retired: work.superseded,
    conflicts: verdicts.filter(
      (v) => v.outcome === "RESOLVED" || v.outcome === "UNRESOLVED_CONTRADICTION",
    ).length,
    converged: verdicts.filter((v) => v.outcome === "CONVERGED").length,
    resolved: verdicts.filter((v) => v.outcome === "RESOLVED").length,
    unknown_outcomes: verdicts.filter((v) => v.outcome === "UNKNOWN").length,
    unresolved: unresolvedVerdicts.length,
  };

  return Object.freeze({
    tenant_id: tenantId,
    at,
    recorded_as_of: recordedAsOf,
    recorded_at: recordedAt,
    rule_precedence: Object.freeze(effectivePrecedence),
    verdicts: Object.freeze(verdicts),
    unresolved_verdicts: Object.freeze(unresolvedVerdicts),
    stats: Object.freeze(stats),
  });
}

/* ─────────────────────────────────────────────────────────────
 * Per-group reconciliation (the declared rule cascade)
 * ────────────────────────────────────────────────────────────*/

function reconcileGroup(
  group: { subject: string; attribute: string; facts: readonly ReconciliationObservation[] },
  context: {
    tenantId: string;
    at: string | null;
    atMs: number | null;
    recordedAt: string;
    effectivePrecedence: readonly ReconciliationRuleId[];
    supersederBySuperseded: ReadonlyMap<string, ReconciliationObservation>;
  },
): ReconciliationVerdict {
  const { tenantId, at, atMs, recordedAt, effectivePrecedence, supersederBySuperseded } = context;
  const inputs = group.facts.map((fact) => fact.id).sort();

  const superseded: string[] = [];
  const notApplicable: string[] = [];
  const candidates: ReconciliationObservation[] = [];
  for (const fact of group.facts) {
    const superseder = supersederBySuperseded.get(fact.id) ?? null;
    if (atMs != null) {
      // Bi-temporal candidacy: a record is a candidate at `at` only when its
      // own validity covers the instant, and a supersession retires it only
      // where the superseding record covers the instant too.
      if (validityKnownOf(fact) && !coversAt(fact, atMs)) {
        notApplicable.push(fact.id);
        continue;
      }
      if (superseder != null && (validityKnownOf(superseder) ? coversAt(superseder, atMs) : true)) {
        superseded.push(fact.id);
        continue;
      }
    } else if (superseder != null) {
      superseded.push(fact.id);
      continue;
    }
    candidates.push(fact);
  }
  superseded.sort();
  notApplicable.sort();

  // Collapse duplicate deliveries behind the earliest-recorded representative.
  const byDigest = new Map<string, ReconciliationObservation>();
  const duplicates: string[] = [];
  const unique: ReconciliationObservation[] = [];
  for (const fact of [...candidates].sort((a, b) => {
    const aMs = epochOf(a.recorded_at) ?? Number.POSITIVE_INFINITY;
    const bMs = epochOf(b.recorded_at) ?? Number.POSITIVE_INFINITY;
    return aMs !== bMs ? aMs - bMs : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })) {
    const digest = observationDigest(fact);
    const existing = byDigest.get(digest);
    if (existing == null) {
      byDigest.set(digest, fact);
      unique.push(fact);
    } else {
      duplicates.push(fact.id);
    }
  }
  duplicates.sort();

  const distinctValues: ObservationValue[] = [];
  for (const candidate of unique) {
    if (!distinctValues.some((value) => sameObservationValue(value, candidate.value))) {
      distinctValues.push(candidate.value);
    }
  }
  const allUnknown = unique.length > 0 && unique.every((candidate) => isUnknownObservationValue(candidate.value));

  let outcome: ReconciliationOutcome;
  let ruleApplied: ReconciliationRuleId | null = null;
  let value: ObservationValue | null = null;
  let winnerId: string | null = null;
  let unresolvedIds: string[] = [];
  let losingIds: string[] = [];
  const trace: ResolutionTraceEntry[] = [];

  if (unique.length === 0 || allUnknown) {
    // Partial observability: nothing applicable, or every applicable
    // candidate explicitly declares UNKNOWN — the state IS unknown.
    outcome = "UNKNOWN";
    value = unknownValue();
  } else if (distinctValues.length === 1) {
    outcome = "CONVERGED";
    value = distinctValues[0];
    if (unique.length === 1) winnerId = unique[0].id;
  } else {
    // Conflict: run the declared rule cascade. The front narrows only when a
    // declared rule distinguishes candidates; an exact tie after every rule
    // surfaces as UNRESOLVED — never silently picked.
    let front = unique;
    for (const rule of effectivePrecedence) {
      const best = Math.max(...front.map((candidate) => ruleKey(rule, candidate)));
      const narrowed = front.filter((candidate) => ruleKey(rule, candidate) === best);
      if (narrowed.length < front.length) {
        front = narrowed;
        ruleApplied = rule;
        trace.push({ rule, front_after: front.map((candidate) => candidate.id).sort() });
      }
      if (front.length === 1) break;
    }
    if (front.length === 1) {
      outcome = "RESOLVED";
      value = front[0].value;
      winnerId = front[0].id;
    } else if (front.every((candidate) => sameObservationValue(candidate.value, front[0].value))) {
      outcome = "RESOLVED";
      value = front[0].value;
    } else {
      outcome = "UNRESOLVED_CONTRADICTION";
      ruleApplied = null;
      value = null;
      unresolvedIds = front.map((candidate) => candidate.id).sort();
    }
    // Losing candidates are those whose value was NOT chosen: everything the
    // declared rules eliminated from the front. They are retained verbatim.
    const frontIds = new Set(front.map((candidate) => candidate.id));
    losingIds = unique.filter((candidate) => !frontIds.has(candidate.id)).map((candidate) => candidate.id);
  }
  losingIds.sort();

  // Outcome normalization: the outcome is the reconciled TRUTH STATE. A
  // conflict decided for an explicit UNKNOWN reports UNKNOWN — the deciding
  // rule and winner stay recorded, and the unknown is never interpolated.
  if ((outcome === "RESOLVED" || outcome === "CONVERGED") && value != null && isUnknownObservationValue(value)) {
    outcome = "UNKNOWN";
  }

  const winner = winnerId == null ? null : unique.find((candidate) => candidate.id === winnerId) ?? null;

  return Object.freeze({
    object_type: RECONCILIATION_VERDICT_OBJECT_TYPE,
    verdict_id: verdictId(tenantId, group.subject, group.attribute),
    tenant_id: tenantId,
    subject_entity_id: group.subject,
    attribute: group.attribute,
    outcome,
    rule_applied: ruleApplied,
    applied_rules: Object.freeze([...effectivePrecedence]),
    resolution_trace: Object.freeze(trace.map((entry) => ({ ...entry, front_after: Object.freeze(entry.front_after) }))),
    value: value == null ? null : Object.freeze({ ...value }),
    winner_id: winnerId,
    inputs: Object.freeze(inputs),
    superseded: Object.freeze(superseded),
    duplicates: Object.freeze(duplicates),
    residual_uncertainty: Object.freeze({
      losing_candidate_ids: Object.freeze(losingIds),
      unknown_validity_candidate_ids: Object.freeze(
        unique.filter((candidate) => !validityKnownOf(candidate)).map((candidate) => candidate.id).sort(),
      ),
      not_applicable_ids: Object.freeze(notApplicable),
      explicit_unknown: outcome === "UNKNOWN" || (value != null && isUnknownObservationValue(value)),
      winner_confidence: winner == null ? null : winner.confidence,
      unresolved_candidate_ids: Object.freeze(unresolvedIds),
    }),
    valid_from: at,
    valid_time_known: at != null,
    recorded_at: recordedAt,
    provenance: Object.freeze({
      method: "kernel-reconciliation:v1",
      rule_precedence: Object.freeze([...effectivePrecedence]),
    }),
  });
}

/* ─────────────────────────────────────────────────────────────
 * Evidence-bearing verdict outputs (envelope + claim)
 * ────────────────────────────────────────────────────────────*/

/**
 * Stamp a verdict into the kernel: an insert-ready row carrying the canonical
 * CoreObject envelope (V1CAP-002) and the bi-temporal verdict validity. The
 * envelope object_type must be `core.reconciliation.verdict`; the registry
 * gate (MISSION-R-11) is injected via `knownObjectTypes`, exactly as in the
 * kernel write paths.
 */
export function verdictDraft(
  verdict: ReconciliationVerdict,
  envelope: KernelObjectEnvelopeInput,
  knownObjectTypes?: readonly string[],
): Record<string, unknown> {
  if (envelope.objectType !== RECONCILIATION_VERDICT_OBJECT_TYPE) {
    throw new ReconciliationError(
      "invalid_verdict_envelope",
      `verdict envelope object_type must be "${RECONCILIATION_VERDICT_OBJECT_TYPE}", received "${envelope.objectType}"`,
    );
  }
  const draft = {
    verdict_id: verdict.verdict_id,
    subject_entity_id: verdict.subject_entity_id,
    attribute: verdict.attribute,
    outcome: verdict.outcome,
    rule_applied: verdict.rule_applied,
    tenant_id: verdict.tenant_id,
    recorded_at: verdict.recorded_at,
  };
  const stamped = stampKernelDraft(draft, envelope, knownObjectTypes);
  return {
    ...stamped,
    ...biTemporalColumns({
      validFrom: verdict.valid_from ?? undefined,
      validTimeKnown: verdict.valid_time_known,
    }),
  };
}

/**
 * The evidence claim a verdict carries: pass it as the `claim` of an evidence
 * capture (evidence/capture.ts) — the verdict is itself evidence-bearing.
 */
export function verdictEvidenceClaim(verdict: ReconciliationVerdict): Record<string, unknown> {
  return {
    reconciliation_verdict: {
      verdict_id: verdict.verdict_id,
      tenant_id: verdict.tenant_id,
      subject_entity_id: verdict.subject_entity_id,
      attribute: verdict.attribute,
      outcome: verdict.outcome,
      rule_applied: verdict.rule_applied,
      applied_rules: [...verdict.applied_rules],
      value: verdict.value == null ? null : { known: verdict.value.known === true, value: verdict.value.known === true ? verdict.value.value : null },
      winner_id: verdict.winner_id,
      inputs: [...verdict.inputs],
      superseded: [...verdict.superseded],
      duplicates: [...verdict.duplicates],
      residual_uncertainty: {
        ...verdict.residual_uncertainty,
        losing_candidate_ids: [...verdict.residual_uncertainty.losing_candidate_ids],
        unknown_validity_candidate_ids: [...verdict.residual_uncertainty.unknown_validity_candidate_ids],
        not_applicable_ids: [...verdict.residual_uncertainty.not_applicable_ids],
        unresolved_candidate_ids: [...verdict.residual_uncertainty.unresolved_candidate_ids],
      },
      valid_from: verdict.valid_from,
      valid_time_known: verdict.valid_time_known,
      recorded_at: verdict.recorded_at,
      method: verdict.provenance.method,
    },
  };
}