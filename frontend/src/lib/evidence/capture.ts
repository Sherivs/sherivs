/**
 * CoreGrid — Evidence-class capture discipline (J-034 / V1CAP-059 / MISSION-R-90).
 *
 * The canonical evidence capture API. Every captured evidence record carries an
 * explicit evidence CLASS, and the class carries the epistemic weight:
 *
 * - `direct_observation` — captured directly from reality by a non-AI producer.
 *   The ONLY class that can support canonical-truth claims (Constitution §9:
 *   Reality vs Intelligence).
 * - `generated` | `simulated` | `predicted` | `derived` | `attested` —
 *   QUARANTINE classes. They may inform Intelligence, proposals and decision
 *   support, but they can never silently become direct observation (E-017;
 *   G-040 temporal succession is not causation; G-041 simulation results never
 *   become observed reality).
 *
 * Invariants (fail-closed, enforced at the capture API):
 * - No anonymous evidence: a record without a declared class is rejected. The
 *   class field is deliberately OPTIONAL in the input type — the gate is a
 *   runtime contract (the "no class" case must be exercisable and rejectable,
 *   not hidden behind the type system).
 * - No class laundering: a record claiming `direct_observation` while its
 *   provenance carries AI-generation markers (generatedByAi flag, or AI /
 *   inference / simulation / prediction vocabulary in the producer, reference
 *   or capture identities) is REJECTED, not downgraded. Quarantine classes may
 *   freely carry AI provenance — that is their purpose.
 * - Promotion is an explicit, recorded validation act: a quarantine-class
 *   record becomes `direct_observation` only through `promoteEvidence`, which
 *   requires a validator identity, a declared validation method and a
 *   validation instant, refuses AI validators (Constitution §21: AI output is
 *   untrusted and never validates itself), and is itself evidence-bearing —
 *   the append-only result retains the original quarantined record, the
 *   validation-act evidence record, and the promoted record. Both (all three)
 *   records persist; nothing is mutated in place.
 * - Append-only: capture, promotion and supersession are pure builders. No
 *   function mutates an existing evidence record; superseded evidence is
 *   retained verbatim alongside its successor.
 * - Tenant isolation: provenance origin tenant must match the record tenant
 *   (kernel envelope law); supersession and promotion never cross tenants.
 *
 * Lifecycle (J-033 / V1CAP-058 / MISSION-R-91 — additive over capture):
 * - Sufficiency: a record may carry a DECLARED sufficiency assessment
 *   (sufficient / insufficient / provisional, with assessor, instant and
 *   rationale). Sufficiency is also EVALUATABLE: `evaluateSufficiency` scores
 *   a record against an explicit requirement (confidence floor, canonical
 *   class, freshness) and never returns `sufficient` for revoked or stale
 *   evidence.
 * - Confidence: bounded to [0,1] by the kernel `isConfidence` law; a declared
 *   confidence must cite its provenance (`confidence_basis`) to be usable —
 *   `requireProvenanceCitedConfidence` and the sufficiency evaluator enforce
 *   the citation (Constitution §12: where did this number come from?).
 * - Revocation: an AUTHORIZED revoker revokes with an explicit authority
 *   reference, a reason and a substantiating evidence ref. Revocation is
 *   append-only — the original record is retained verbatim, the act is itself
 *   evidence, and a revocation-mirror record carries the act. REVOKED evidence
 *   is never canonical-truth eligible: the consumption gate rejects claims
 *   citing revoked evidence, and claims that were previously supported by
 *   now-revoked evidence are FLAGGED for re-verification — never silently
 *   left supported (E-018 invariants 12–13).
 * - Staleness: a record may declare a validity window (`validFrom` /
 *   `validUntil`); evidence past its window is STALE — surfaced by
 *   `evidenceFreshness` / `auditClaimSupport`, never silently served.
 * - Retention: every record carries its retention policy id (ADR-005's
 *   machine-readable policy requirement). Capture WITHOUT a retention policy
 *   id is a capture-time failure; an injected policy registry gates the id
 *   the same way the object-type registry gates object types.
 *
 * Envelope compatibility: every captured record is stamped through the
 * canonical CoreObject envelope (`kernel/reality.ts` — V1CAP-002), so the
 * no-anonymous-object, explicit-causation-root and provenance laws of the
 * kernel apply to evidence by construction. The live object-type registry gate
 * (MISSION-R-11) is injected via the `knownObjectTypes` parameter, exactly as
 * in the kernel write paths.
 *
 * Boundary: pure contract, no persistence, no wall-clock sampling (time is
 * always a supplied parameter), no state.
 */

import {
  isConfidence,
  isEnvelopeRef,
  isPayloadObject,
  stampKernelDraft,
  type KernelObjectEnvelopeInput,
  type KernelProvenance,
  type KernelObjectStatus,
} from "../kernel/reality";

/* ─────────────────────────────────────────────────────────────
 * Evidence-class vocabulary (J-034)
 * ────────────────────────────────────────────────────────────*/

export type EvidenceClass =
  "direct_observation" | "generated" | "simulated" | "predicted" | "derived" | "attested";

export const EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  "direct_observation",
  "generated",
  "simulated",
  "predicted",
  "derived",
  "attested",
] as const;

/** The canonical kernel object type every evidence record is stamped as. */
export const EVIDENCE_OBJECT_TYPE = "core.evidence";

export function isEvidenceClass(value: unknown): value is EvidenceClass {
  return (EVIDENCE_CLASSES as readonly unknown[]).includes(value);
}

/**
 * Quarantine classes: everything that is NOT direct observation. Quarantine
 * evidence informs Intelligence and proposals only; it can never support a
 * canonical-truth claim without an explicit, recorded promotion act.
 */
export function isQuarantineEvidenceClass(evidenceClass: EvidenceClass): boolean {
  return evidenceClass !== "direct_observation";
}

/* ─────────────────────────────────────────────────────────────
 * Lifecycle vocabulary (J-033 / V1CAP-058)
 * ────────────────────────────────────────────────────────────*/

export type SufficiencyVerdict = "sufficient" | "insufficient" | "provisional";

export const SUFFICIENCY_VERDICTS: readonly SufficiencyVerdict[] = [
  "sufficient",
  "insufficient",
  "provisional",
] as const;

export function isSufficiencyVerdict(value: unknown): value is SufficiencyVerdict {
  return (SUFFICIENCY_VERDICTS as readonly unknown[]).includes(value);
}

/**
 * ADR-005 machine-readable retention policy requirement: every evidence
 * record must bind a retention policy id at capture time. This is the V1
 * default policy id a caller may declare when no schedule-specific policy
 * applies yet (ADR-005: "no new personal-data-bearing record family may ship
 * without declaring at least a default policy").
 */
export const DEFAULT_EVIDENCE_RETENTION_POLICY_ID = "retention:evidence:default-v1";

/** Recorded sufficiency assessment carried on the evidence record. */
export interface SufficiencyAssessment {
  readonly verdict: SufficiencyVerdict;
  readonly assessedBy: string;
  readonly assessedAt: string;
  readonly rationale: string | null;
}

export interface SufficiencyAssessmentInput {
  verdict: SufficiencyVerdict;
  /** Assessor identity (1–160 characters). */
  assessedBy: string;
  /** Assessment instant (ISO-8601, supplied). */
  assessedAt: string;
  rationale?: string | null;
}

/** Recorded revocation act carried on the revocation-mirror record. */
export interface EvidenceRevocationAct {
  readonly revokedBy: string;
  /** Reference to the authority/policy grant that authorizes the revocation. */
  readonly authorization: string;
  readonly reason: string;
  /** Evidence id substantiating the revocation reason. */
  readonly reasonEvidenceRef: string;
  readonly revokedAt: string;
  readonly actEvidenceId: string;
  readonly revokedEvidenceId: string;
}

/**
 * Declared evidence validity window (bi-temporal VALID time, half-open:
 * valid_from inclusive, valid_until exclusive — kernel V1CAP-004 law).
 * Evidence past `validUntil` is stale: surfaced, never silently served.
 */
export interface EvidenceValidityWindow {
  readonly valid_from: string | null;
  readonly valid_until: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * AI-provenance marker vocabulary (class-laundering detection)
 * ────────────────────────────────────────────────────────────*/

/**
 * Deterministic, auditable substring markers of AI-generated provenance,
 * matched case-insensitively against the provenance producer, reference and
 * capture identities. Fail-closed posture: a producer whose name happens to
 * collide with a marker must rename, not launder.
 */
export const AI_PROVENANCE_MARKERS: readonly string[] = [
  "ai:",
  "ai-",
  "ai_",
  "gpt",
  "llm",
  "openai",
  "anthropic",
  "claude",
  "gemini",
  "mistral",
  "model-generated",
  "model_generated",
  "machine-generated",
  "machine_generated",
  "ai-generated",
  "ai_generated",
  "generated-by-ai",
  "generated_by_ai",
  "inferred",
  "inference",
  "simulated",
  "simulation",
  "predicted",
  "prediction",
  "synthesized",
  "synthesised",
] as const;

export interface AiProvenanceFields {
  readonly source: string;
  readonly sourceRef?: string | null;
  readonly recordedBy?: string | null;
  readonly capturedBy?: string | null;
  readonly generatedByAi?: boolean;
}

function containsAiMarker(value: string): boolean {
  const lowered = value.toLowerCase();
  return AI_PROVENANCE_MARKERS.some((marker) => lowered.includes(marker));
}

/**
 * True when the provenance carries an AI-generation marker: the explicit
 * generatedByAi flag, or an AI/inference/simulation/prediction marker in the
 * producing source, its reference, the recorded-by identity, or the captured-by
 * identity. Used to reject class laundering at capture time.
 */
export function provenanceCarriesAiMarkers(fields: AiProvenanceFields): boolean {
  if (fields.generatedByAi === true) return true;
  const surfaces = [fields.source, fields.sourceRef, fields.recordedBy, fields.capturedBy];
  return surfaces.some((surface) => typeof surface === "string" && containsAiMarker(surface));
}

/* ─────────────────────────────────────────────────────────────
 * Typed rejection
 * ────────────────────────────────────────────────────────────*/

export type EvidenceCaptureErrorCode =
  | "anonymous_evidence"
  | "unknown_evidence_class"
  | "invalid_evidence_field"
  | "class_laundering_rejected"
  | "not_canonical_truth_eligible"
  | "promotion_not_required"
  | "promotion_already_promoted"
  | "invalid_validation_act"
  | "ai_validator_rejected"
  | "tenant_mismatch"
  | "retention_policy_required"
  | "unregistered_retention_policy"
  | "confidence_basis_required"
  | "invalid_sufficiency_assessment"
  | "invalid_validity_window"
  | "revocation_not_authorized"
  | "invalid_revocation_act"
  | "evidence_already_revoked"
  | "evidence_revoked"
  | "evidence_stale";

export class EvidenceCaptureError extends Error {
  readonly code: EvidenceCaptureErrorCode;

  constructor(code: EvidenceCaptureErrorCode, message: string) {
    super(message);
    this.name = "EvidenceCaptureError";
    this.code = code;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Captured evidence record (append-only; envelope-compatible)
 * ────────────────────────────────────────────────────────────*/

/** Recorded validation act that promoted a quarantine record to direct observation. */
export interface EvidencePromotionAct {
  readonly validatorId: string;
  readonly method: string;
  readonly validatedAt: string;
  readonly promotedEvidenceId: string;
  readonly actEvidenceId: string;
  readonly note: string | null;
}

/**
 * An append-only captured evidence record. Immutable by construction (frozen)
 * and stamped with the canonical kernel envelope. Supersession and promotion
 * always produce NEW records; an existing record is never mutated.
 */
export interface CapturedEvidence {
  readonly object_type: string;
  readonly schema_version: string;
  readonly status: KernelObjectStatus;
  readonly evidence_id: string;
  readonly evidence_type: string;
  readonly evidence_class: EvidenceClass;
  /** Set only on promoted records: the quarantine class the record was promoted from. */
  readonly prior_class: EvidenceClass | null;
  readonly tenant_id: string;
  readonly claim: Record<string, unknown>;
  readonly confidence: number | null;
  readonly observed_at: string | null;
  readonly recorded_at: string;
  readonly captured_by: string;
  readonly captured_at: string;
  readonly source_ref: string | null;
  /** True only for direct_observation records — the canonical-truth gate. */
  readonly canonical_truth_eligible: boolean;
  readonly lineage: readonly string[];
  /** Set only on supersession successors: the evidence id this record supersedes. */
  readonly supersedes: string | null;
  /** Set only on promoted records: the recorded validation act. */
  readonly promotion: EvidencePromotionAct | null;
  /** Retention policy binding (ADR-005): every record carries its policy id. */
  readonly retention_policy_id: string;
  /** Provenance citation for the declared confidence (required when confidence is declared). */
  readonly confidence_basis: string | null;
  /** Declared sufficiency assessment, when the capture declared one. */
  readonly sufficiency: SufficiencyAssessment | null;
  /** Declared validity window (half-open); nulls mean unbounded validity. */
  readonly valid_from: string | null;
  readonly valid_until: string | null;
  /** Set only on revocation-mirror records: the recorded revocation act. */
  readonly revocation: EvidenceRevocationAct | null;
  /** Set only on revocation-mirror records: the evidence id this record revokes. */
  readonly revokes: string | null;
  readonly provenance: KernelProvenance;
  readonly policy_context: Record<string, unknown>;
  readonly trace_id: string;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly parent_event_id: string | null;
  readonly declared_origin: string | null;
  readonly created_by: string;
  readonly updated_by: string;
}

/* ─────────────────────────────────────────────────────────────
 * Validation method vocabulary (recorded promotion acts)
 * ────────────────────────────────────────────────────────────*/

export type ValidationMethod =
  "human_review" | "instrument_recheck" | "cross_source_reconciliation" | "operator_ruling";

export const VALIDATION_METHODS: readonly ValidationMethod[] = [
  "human_review",
  "instrument_recheck",
  "cross_source_reconciliation",
  "operator_ruling",
] as const;

export function isValidationMethod(value: unknown): value is ValidationMethod {
  return (VALIDATION_METHODS as readonly unknown[]).includes(value);
}

/* ─────────────────────────────────────────────────────────────
 * Capture input
 * ────────────────────────────────────────────────────────────*/

export interface EvidenceCaptureInput {
  /** Stable evidence identity (1–160 characters); lineage anchors reference this. */
  evidenceId: string;
  /** Evidence vocabulary name (1–128 characters), e.g. "door_event". */
  evidenceType: string;
  tenantId: string;
  /**
   * REQUIRED at runtime: a record without a class is anonymous evidence and is
   * rejected (J-034). Deliberately optional in the type so the fail-closed
   * gate is exercisable and cannot be bypassed by type-system defaults.
   */
  evidenceClass?: EvidenceClass;
  /** The claim content this evidence carries; opaque JSON object. */
  claim?: Record<string, unknown>;
  confidence?: number | null;
  /**
   * Provenance citation for the declared confidence (1–500 characters).
   * A confidence declared WITHOUT a basis is capturable but never usable:
   * `requireProvenanceCitedConfidence` and the sufficiency evaluator reject
   * it (Constitution §12 — every number answers "where did this come from?").
   */
  confidenceBasis?: string | null;
  /** Declared sufficiency assessment for the claim this evidence supports. */
  sufficiency?: SufficiencyAssessmentInput | null;
  /**
   * Declared validity window start (ISO-8601). With `validUntil` (exclusive)
   * it forms the half-open window; evidence past the window is stale.
   */
  validFrom?: string | null;
  validUntil?: string | null;
  /**
   * REQUIRED at runtime: the retention policy id this record is bound to
   * (ADR-005 machine-readable policy requirement). A record without a
   * retention policy is a capture-time failure. Deliberately optional in the
   * type so the fail-closed gate is exercisable and cannot be bypassed by
   * type-system defaults. Use DEFAULT_EVIDENCE_RETENTION_POLICY_ID when no
   * schedule-specific policy applies.
   */
  retentionPolicyId?: string;
  observedAt?: string | null;
  /** Capture identity; must equal the envelope created_by (identity consistency). */
  capturedBy: string;
  /** Capture instant (ISO-8601, supplied — purity, never wall-clock sampled). */
  capturedAt: string;
  /** Evidence source reference; must agree with the envelope provenance sourceRef. */
  sourceRef?: string | null;
  /** Prior evidence ids this record derives from / was carried from (1–160 each). */
  lineage?: readonly string[];
  /** Canonical CoreObject envelope; object_type must be EVIDENCE_OBJECT_TYPE. */
  envelope: KernelObjectEnvelopeInput;
}

/* ─────────────────────────────────────────────────────────────
 * Capture options (injected registry gates)
 * ────────────────────────────────────────────────────────────*/

export interface EvidenceCaptureOptions {
  /**
   * Injected retention policy registry (ADR-005 machine-readable schedule
   * gate): when supplied, the bound retention policy id must be registered —
   * an unregistered policy id is rejected, mirroring the object-type
   * registry gate. An EMPTY list rejects every policy id (fail-closed
   * bootstrap posture).
   */
  readonly knownRetentionPolicies?: readonly string[];
}

/* ─────────────────────────────────────────────────────────────
 * Internal builders (pure)
 * ────────────────────────────────────────────────────────────*/

function isoTimestamp(
  value: unknown,
  field: string,
  code: EvidenceCaptureErrorCode = "invalid_evidence_field",
): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new EvidenceCaptureError(code, `evidence ${field} must be a valid ISO-8601 timestamp`);
  }
  return value;
}

function freezeShallow<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    return Object.freeze(value);
  }
  return value;
}

function buildEvidence(
  input: EvidenceCaptureInput,
  lineage: readonly string[],
  supersedes: string | null,
  priorClass: EvidenceClass | null,
  promotion: EvidencePromotionAct | null,
  knownObjectTypes?: readonly string[],
  options: EvidenceCaptureOptions = {},
  revocation: EvidenceRevocationAct | null = null,
  revokes: string | null = null,
): CapturedEvidence {
  if (!isEnvelopeRef(input.evidenceId, 160)) {
    throw new EvidenceCaptureError(
      "invalid_evidence_field",
      "evidence_id must be 1–160 characters",
    );
  }
  if (!isEnvelopeRef(input.evidenceType, 128)) {
    throw new EvidenceCaptureError(
      "invalid_evidence_field",
      "evidence_type must be 1–128 characters",
    );
  }
  if (!isEnvelopeRef(input.tenantId, 128)) {
    throw new EvidenceCaptureError("invalid_evidence_field", "tenant_id must be 1–128 characters");
  }

  // Fail-closed class gate (J-034): no anonymous evidence, no invented classes.
  if (input.evidenceClass == null) {
    throw new EvidenceCaptureError(
      "anonymous_evidence",
      "evidence capture requires an explicit evidence_class — a record without a class is anonymous evidence and is rejected",
    );
  }
  if (!isEvidenceClass(input.evidenceClass)) {
    throw new EvidenceCaptureError(
      "unknown_evidence_class",
      `evidence_class "${String(input.evidenceClass)}" is not a registered evidence class`,
    );
  }

  const claim = input.claim ?? {};
  if (!isPayloadObject(claim)) {
    throw new EvidenceCaptureError("invalid_evidence_field", "claim must be a JSON object");
  }
  if (input.confidence != null && !isConfidence(input.confidence)) {
    throw new EvidenceCaptureError(
      "invalid_evidence_field",
      "confidence must be a finite number between 0 and 1",
    );
  }
  // Confidence provenance citation (Constitution §12): the basis, when
  // declared, must be a bounded reference. Usability of an UNCITED
  // confidence is refused at consumption (requireProvenanceCitedConfidence),
  // not at capture — a record may declare a number it cannot yet cite, but
  // no consumer may rely on it.
  const confidenceBasis = input.confidenceBasis?.trim() || null;
  if (confidenceBasis !== null && !isEnvelopeRef(confidenceBasis, 500)) {
    throw new EvidenceCaptureError(
      "invalid_evidence_field",
      "confidence_basis must be 1–500 characters when present",
    );
  }

  // Declared sufficiency assessment (J-033): fail-closed vocabulary and
  // field validation when a capture declares one.
  let sufficiency: SufficiencyAssessment | null = null;
  if (input.sufficiency != null) {
    const declared = input.sufficiency;
    if (!isSufficiencyVerdict(declared.verdict)) {
      throw new EvidenceCaptureError(
        "invalid_sufficiency_assessment",
        `sufficiency verdict "${String(declared.verdict)}" is not a registered sufficiency verdict`,
      );
    }
    if (!isEnvelopeRef(declared.assessedBy, 160)) {
      throw new EvidenceCaptureError(
        "invalid_sufficiency_assessment",
        "sufficiency assessment requires an assessor identity (1–160 characters)",
      );
    }
    const assessedAt = isoTimestamp(declared.assessedAt, "sufficiency_assessed_at", "invalid_sufficiency_assessment");
    const rationale = declared.rationale ?? null;
    if (rationale !== null && (typeof rationale !== "string" || rationale.trim().length > 1000)) {
      throw new EvidenceCaptureError(
        "invalid_sufficiency_assessment",
        "sufficiency rationale must be at most 1000 characters",
      );
    }
    sufficiency = {
      verdict: declared.verdict,
      assessedBy: declared.assessedBy.trim(),
      assessedAt,
      rationale: rationale === null ? null : rationale.trim(),
    };
  }

  // Declared validity window (staleness detection): half-open, strictly
  // ordered, ISO-8601. Stale evidence is surfaced by the lifecycle API, never
  // silently served.
  const validFrom = input.validFrom?.trim() || null;
  const validUntil = input.validUntil?.trim() || null;
  if (validFrom !== null) isoTimestamp(validFrom, "valid_from", "invalid_validity_window");
  if (validUntil !== null) isoTimestamp(validUntil, "valid_until", "invalid_validity_window");
  if (validFrom !== null && validUntil !== null && Date.parse(validUntil) <= Date.parse(validFrom)) {
    throw new EvidenceCaptureError(
      "invalid_validity_window",
      "evidence validity window must be strictly ordered: valid_until must be after valid_from",
    );
  }

  // Retention policy binding (ADR-005): a record without a retention policy
  // id is a capture-time failure — the missing-policy case must remain
  // exercisable at runtime, so the field is optional in the input type only.
  if (input.retentionPolicyId == null) {
    throw new EvidenceCaptureError(
      "retention_policy_required",
      "evidence capture requires a retention_policy_id binding (ADR-005 machine-readable retention policy requirement) — a record without a retention policy is a capture-time failure",
    );
  }
  const retentionPolicyId = input.retentionPolicyId.trim();
  if (!isEnvelopeRef(retentionPolicyId, 160)) {
    throw new EvidenceCaptureError(
      "invalid_evidence_field",
      "retention_policy_id must be 1–160 characters",
    );
  }
  if (
    options.knownRetentionPolicies != null &&
    !options.knownRetentionPolicies.includes(retentionPolicyId)
  ) {
    throw new EvidenceCaptureError(
      "unregistered_retention_policy",
      `retention policy "${retentionPolicyId}" is not registered — bind a registered retention policy id`,
    );
  }

  const observedAt = input.observedAt ?? null;
  if (observedAt !== null) isoTimestamp(observedAt, "observed_at");

  if (!isEnvelopeRef(input.capturedBy, 160)) {
    throw new EvidenceCaptureError(
      "invalid_evidence_field",
      "captured_by must be 1–160 characters",
    );
  }
  const capturedAt = isoTimestamp(input.capturedAt, "captured_at");

  if (input.envelope.objectType !== EVIDENCE_OBJECT_TYPE) {
    throw new EvidenceCaptureError(
      "invalid_evidence_field",
      `evidence envelope object_type must be "${EVIDENCE_OBJECT_TYPE}", received "${input.envelope.objectType}"`,
    );
  }
  if (input.capturedBy.trim() !== input.envelope.createdBy.trim()) {
    throw new EvidenceCaptureError(
      "invalid_evidence_field",
      `captured_by "${input.capturedBy}" must equal the envelope created_by "${input.envelope.createdBy}"`,
    );
  }

  const envelopeSourceRef = input.envelope.provenance.sourceRef?.trim() || null;
  const inputSourceRef = input.sourceRef?.trim() || null;
  if (
    inputSourceRef !== null &&
    envelopeSourceRef !== null &&
    inputSourceRef !== envelopeSourceRef
  ) {
    throw new EvidenceCaptureError(
      "invalid_evidence_field",
      `source_ref "${inputSourceRef}" conflicts with the envelope provenance sourceRef "${envelopeSourceRef}"`,
    );
  }
  const sourceRef = inputSourceRef ?? envelopeSourceRef;

  for (const entry of lineage) {
    if (!isEnvelopeRef(entry, 160)) {
      throw new EvidenceCaptureError(
        "invalid_evidence_field",
        "lineage entries must be 1–160 characters",
      );
    }
  }

  // Envelope stamping: canonical CoreObject envelope laws apply to evidence —
  // no anonymous object, explicit causation root, provenance tenant match.
  const stamped = stampKernelDraft(
    {
      evidence_id: input.evidenceId.trim(),
      evidence_type: input.evidenceType.trim(),
      evidence_class: input.evidenceClass,
      tenant_id: input.tenantId.trim(),
      claim,
      confidence: input.confidence ?? null,
      observed_at: observedAt,
      recorded_at: capturedAt,
    },
    input.envelope,
    knownObjectTypes,
  );

  // Class-laundering gate (J-034): direct_observation must never rest on
  // AI-generated provenance. Quarantine classes are unaffected by design.
  if (
    input.evidenceClass === "direct_observation" &&
    provenanceCarriesAiMarkers({
      source: stamped.provenance.source,
      sourceRef: stamped.provenance.sourceRef,
      recordedBy: stamped.provenance.recordedBy,
      capturedBy: input.capturedBy.trim(),
      generatedByAi: stamped.provenance.generatedByAi,
    })
  ) {
    throw new EvidenceCaptureError(
      "class_laundering_rejected",
      "direct_observation evidence with AI-generated provenance markers is rejected: quarantine-class evidence cannot be captured as direct observation",
    );
  }

  return freezeShallow({
    ...stamped,
    evidence_class: input.evidenceClass,
    prior_class: priorClass,
    // A REVOKED record is never canonical-truth eligible, regardless of
    // class: revoked evidence cannot silently support active claims (E-018).
    canonical_truth_eligible: input.evidenceClass === "direct_observation" && revocation === null,
    lineage: freezeShallow([...lineage]),
    supersedes,
    promotion: promotion === null ? null : freezeShallow({ ...promotion }),
    retention_policy_id: retentionPolicyId,
    confidence_basis: confidenceBasis,
    sufficiency: sufficiency === null ? null : freezeShallow({ ...sufficiency }),
    valid_from: validFrom,
    valid_until: validUntil,
    revocation: revocation === null ? null : freezeShallow({ ...revocation }),
    revokes,
    captured_by: input.capturedBy.trim(),
    captured_at: capturedAt,
    source_ref: sourceRef,
    provenance: freezeShallow({ ...stamped.provenance }),
    claim: freezeShallow({ ...claim }),
    policy_context: freezeShallow({ ...input.envelope.policyContext }),
  });
}

/* ─────────────────────────────────────────────────────────────
 * captureEvidence — the canonical fail-closed capture API
 * ────────────────────────────────────────────────────────────*/

/**
 * Capture one evidence record. Rejects: missing/unknown class (no anonymous
 * evidence), direct_observation claims carrying AI provenance markers (class
 * laundering), envelope violations (no causation root, cross-tenant provenance,
 * unregistered object type when the registry gate is injected), and any
 * malformed field. The result is a frozen, append-only record.
 */
export function captureEvidence(
  input: EvidenceCaptureInput,
  knownObjectTypes?: readonly string[],
  options: EvidenceCaptureOptions = {},
): CapturedEvidence {
  return buildEvidence(
    input,
    input.lineage ?? [],
    null,
    null,
    null,
    knownObjectTypes,
    options,
  );
}

/* ─────────────────────────────────────────────────────────────
 * Canonical-truth gate (Constitution §9)
 * ────────────────────────────────────────────────────────────*/

/** Only active (never revoked) direct_observation evidence supports canonical-truth claims. */
export function supportsCanonicalTruth(record: CapturedEvidence): boolean {
  return record.canonical_truth_eligible && record.evidence_class === "direct_observation";
}

/** Fail-closed canonical-truth gate for consumers of evidence. */
export function requireCanonicalTruthSupport(record: CapturedEvidence): void {
  // Consumption gate over revoked evidence (E-018 invariant 12): REVOKED
  // evidence cannot silently support active claims — the gate rejects it
  // with an explicit revocation code, never the generic quarantine code.
  if (record.revocation != null || record.revokes != null) {
    throw new EvidenceCaptureError(
      "evidence_revoked",
      `evidence "${record.evidence_id}" is REVOKED and cannot support any claim — re-verification of dependent claims is required`,
    );
  }
  if (!supportsCanonicalTruth(record)) {
    throw new EvidenceCaptureError(
      "not_canonical_truth_eligible",
      `evidence "${record.evidence_id}" of class "${record.evidence_class}" is quarantine-classed and cannot support a canonical-truth claim; only direct_observation evidence can`,
    );
  }
}

/* ─────────────────────────────────────────────────────────────
 * Promotion — the explicit, recorded validation act (J-034)
 * ────────────────────────────────────────────────────────────*/

export interface ValidationActInput {
  /** Validator identity (1–160 characters). AI validators are rejected. */
  validatorId: string;
  /** Declared validation method from the recorded vocabulary. */
  method: ValidationMethod;
  /** Validation instant (ISO-8601, supplied); must not precede the capture instant. */
  validatedAt: string;
  note?: string | null;
}

export interface PromotionResult {
  /** The original quarantine-class record, retained verbatim (append-only). */
  readonly retained: CapturedEvidence;
  /** The promoted direct_observation record (a NEW evidence record). */
  readonly promoted: CapturedEvidence;
  /** The validation act, itself evidence-bearing (class attested). */
  readonly validationAct: CapturedEvidence;
}

/**
 * Promote a quarantine-class evidence record to direct_observation through an
 * explicit, recorded validation act. Append-only: the original record is
 * returned untouched, the validation act is itself captured as evidence, and
 * the promoted record carries the recorded act, its prior class and lineage.
 * Fails closed on: promoting direct_observation (nothing to promote), double
 * promotion, malformed acts, temporal impossibility, and AI validators
 * (Constitution §21 — AI output is untrusted and never validates itself).
 */
export function promoteEvidence(
  record: CapturedEvidence,
  act: ValidationActInput,
  knownObjectTypes?: readonly string[],
  options: EvidenceCaptureOptions = {},
): PromotionResult {
  if (record.revocation != null || record.revokes != null) {
    throw new EvidenceCaptureError(
      "evidence_revoked",
      `evidence "${record.evidence_id}" is REVOKED and can never be promoted — revocation is terminal for the record's epistemic lifecycle`,
    );
  }
  if (record.prior_class !== null) {
    throw new EvidenceCaptureError(
      "promotion_already_promoted",
      `evidence "${record.evidence_id}" has already been promoted from "${record.prior_class}"; promotion is a one-time recorded act`,
    );
  }
  if (record.evidence_class === "direct_observation") {
    throw new EvidenceCaptureError(
      "promotion_not_required",
      `evidence "${record.evidence_id}" is already direct_observation; promotion applies only to quarantine-class evidence`,
    );
  }
  if (!isEnvelopeRef(act.validatorId, 160)) {
    throw new EvidenceCaptureError(
      "invalid_validation_act",
      "validation act requires a validator identity (1–160 characters)",
    );
  }
  if (!isValidationMethod(act.method)) {
    throw new EvidenceCaptureError(
      "invalid_validation_act",
      `validation method "${String(act.method)}" is not a registered validation method`,
    );
  }
  const validatedAt = isoTimestamp(act.validatedAt, "validated_at", "invalid_validation_act");
  if (Date.parse(validatedAt) < Date.parse(record.captured_at)) {
    throw new EvidenceCaptureError(
      "invalid_validation_act",
      "validation act instant precedes the capture instant — a validation cannot precede the evidence it validates",
    );
  }
  const note = act.note ?? null;
  if (note !== null && (typeof note !== "string" || note.trim().length > 500)) {
    throw new EvidenceCaptureError(
      "invalid_validation_act",
      "validation act note must be at most 500 characters",
    );
  }
  if (provenanceCarriesAiMarkers({ source: act.validatorId })) {
    throw new EvidenceCaptureError(
      "ai_validator_rejected",
      `validator "${act.validatorId}" carries AI provenance markers — AI output is untrusted (Constitution §21) and an AI validator can never validate evidence into canonical truth`,
    );
  }

  const promotedId = `${record.evidence_id}:promoted`;
  const actId = `${record.evidence_id}:validation-act`;
  if (!isEnvelopeRef(promotedId, 160) || !isEnvelopeRef(actId, 160)) {
    throw new EvidenceCaptureError(
      "invalid_validation_act",
      "derived promotion/act evidence ids exceed the 160-character envelope bound",
    );
  }
  const validatorId = act.validatorId.trim();

  const promotionAct: EvidencePromotionAct = {
    validatorId,
    method: act.method,
    validatedAt,
    promotedEvidenceId: promotedId,
    actEvidenceId: actId,
    note: note === null ? null : note.trim(),
  };

  const promoted = buildEvidence(
    {
      evidenceId: promotedId,
      evidenceType: record.evidence_type,
      tenantId: record.tenant_id,
      evidenceClass: "direct_observation",
      claim: { ...record.claim },
      confidence: record.confidence,
      confidenceBasis: record.confidence_basis,
      sufficiency: record.sufficiency,
      validFrom: record.valid_from,
      validUntil: record.valid_until,
      retentionPolicyId: record.retention_policy_id,
      observedAt: record.observed_at,
      capturedBy: validatorId,
      capturedAt: validatedAt,
      sourceRef: null,
      lineage: [record.evidence_id],
      envelope: {
        objectType: EVIDENCE_OBJECT_TYPE,
        schemaVersion: record.schema_version,
        status: record.status,
        createdBy: validatorId,
        updatedBy: validatorId,
        provenance: {
          source: `evidence-promotion:${act.method}`,
          sourceRef: null,
          recordedBy: validatorId,
          originTenantId: record.tenant_id,
          generatedByAi: false,
          verified: true,
        },
        policyContext: {
          ...record.policy_context,
          evidence_promotion: {
            promoted_from: record.evidence_id,
            prior_class: record.evidence_class,
            validator_id: validatorId,
            method: act.method,
            validated_at: validatedAt,
            act_evidence_id: actId,
          },
        },
        traceId: record.trace_id,
        correlationId: record.correlation_id,
        causationId: record.evidence_id,
      },
    },
    [record.evidence_id],
    null,
    record.evidence_class,
    promotionAct,
    knownObjectTypes,
    options,
  );

  const validationAct = buildEvidence(
    {
      evidenceId: actId,
      evidenceType: "validation_act",
      tenantId: record.tenant_id,
      evidenceClass: "attested",
      claim: {
        validation_act: {
          validator_id: validatorId,
          method: act.method,
          validated_at: validatedAt,
          target_evidence_id: record.evidence_id,
          promoted_evidence_id: promotedId,
          prior_class: record.evidence_class,
          note: promotionAct.note,
        },
      },
      confidence: null,
      retentionPolicyId: record.retention_policy_id,
      observedAt: validatedAt,
      capturedBy: validatorId,
      capturedAt: validatedAt,
      sourceRef: record.evidence_id,
      lineage: [record.evidence_id],
      envelope: {
        objectType: EVIDENCE_OBJECT_TYPE,
        schemaVersion: record.schema_version,
        status: record.status,
        createdBy: validatorId,
        updatedBy: validatorId,
        provenance: {
          source: `evidence-validation:${act.method}`,
          sourceRef: record.evidence_id,
          recordedBy: validatorId,
          originTenantId: record.tenant_id,
          generatedByAi: false,
          verified: true,
        },
        policyContext: {
          ...record.policy_context,
          evidence_validation: {
            target_evidence_id: record.evidence_id,
            promoted_evidence_id: promotedId,
            method: act.method,
          },
        },
        traceId: record.trace_id,
        correlationId: record.correlation_id,
        causationId: record.evidence_id,
      },
    },
    [record.evidence_id],
    null,
    null,
    null,
    knownObjectTypes,
    options,
  );

  return {
    retained: record,
    promoted,
    validationAct,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Supersession — no destructive update (append-only retention)
 * ────────────────────────────────────────────────────────────*/

export interface SupersedeResult {
  /** The superseded record, retained verbatim and never mutated. */
  readonly retained: CapturedEvidence;
  /** The successor record, lineage-linked to the retained record. */
  readonly successor: CapturedEvidence;
}

/**
 * Supersede one evidence record with a newly captured successor. The retained
 * record is returned untouched (append-only — superseded evidence is never
 * mutated or deleted); the successor carries `supersedes` and the retained
 * record's id in its lineage. Cross-tenant successors are rejected. REVOKED
 * evidence is terminal — it can never be superseded (that would resurrect
 * retracted content).
 */
export function supersedeEvidence(
  record: CapturedEvidence,
  successorInput: EvidenceCaptureInput,
  knownObjectTypes?: readonly string[],
  options: EvidenceCaptureOptions = {},
): SupersedeResult {
  if (record.revocation != null || record.revokes != null) {
    throw new EvidenceCaptureError(
      "evidence_revoked",
      `evidence "${record.evidence_id}" is REVOKED and cannot be superseded — revocation is terminal, not a correction`,
    );
  }
  if (successorInput.tenantId.trim() !== record.tenant_id) {
    throw new EvidenceCaptureError(
      "tenant_mismatch",
      `successor tenant "${successorInput.tenantId}" does not match retained record tenant "${record.tenant_id}" — supersession never crosses tenants`,
    );
  }
  if (successorInput.evidenceId.trim() === record.evidence_id) {
    throw new EvidenceCaptureError(
      "invalid_evidence_field",
      "successor evidence_id must differ from the retained record's evidence_id",
    );
  }
  const successor = buildEvidence(
    successorInput,
    [...(successorInput.lineage ?? []), record.evidence_id],
    record.evidence_id,
    null,
    null,
    knownObjectTypes,
    options,
  );
  return { retained: record, successor };
}

/* ─────────────────────────────────────────────────────────────
 * Staleness — validity windows (J-033 / V1CAP-058)
 * ────────────────────────────────────────────────────────────*/

export type EvidenceFreshness = "fresh" | "stale" | "not_yet_valid" | "unbounded";

/**
 * Freshness of one evidence record at instant `at` (supplied — purity).
 * A record with no declared validity window is UNBOUNDED, never stale by
 * window; a record past its `valid_until` is STALE; a record before its
 * `valid_from` is NOT_YET_VALID. Staleness is surfaced for the consumer to
 * act on — it is never silently ignored by the claim audit.
 */
export function evidenceFreshness(record: CapturedEvidence, at: string): EvidenceFreshness {
  const atMs = Date.parse(isoTimestamp(at, "as_of"));
  if (record.valid_from == null && record.valid_until == null) return "unbounded";
  if (record.valid_from != null && atMs < Date.parse(record.valid_from)) return "not_yet_valid";
  if (record.valid_until != null && atMs >= Date.parse(record.valid_until)) return "stale";
  return "fresh";
}

/** True when the record is past its declared validity window at `at`. */
export function isEvidenceStale(record: CapturedEvidence, at: string): boolean {
  return evidenceFreshness(record, at) === "stale";
}

/* ─────────────────────────────────────────────────────────────
 * Confidence provenance citation (Constitution §12)
 * ────────────────────────────────────────────────────────────*/

/**
 * True when the record's declared confidence cites its provenance. A record
 * with NO confidence declared trivially satisfies the law (nothing to cite);
 * a declared confidence without a basis never satisfies it.
 */
export function isProvenanceCitedConfidence(record: CapturedEvidence): boolean {
  return record.confidence == null || record.confidence_basis != null;
}

/**
 * Fail-closed consumption gate: a declared confidence must cite its
 * provenance. Bounded scale ([0,1]) is enforced at capture; the citation is
 * enforced here so no consumer can silently rely on an uncited number.
 */
export function requireProvenanceCitedConfidence(record: CapturedEvidence): void {
  if (!isProvenanceCitedConfidence(record)) {
    throw new EvidenceCaptureError(
      "confidence_basis_required",
      `evidence "${record.evidence_id}" declares confidence ${record.confidence} without a confidence_basis — a declared confidence must cite its provenance (Constitution §12)`,
    );
  }
}

/* ─────────────────────────────────────────────────────────────
 * Sufficiency evaluation (J-033 / V1CAP-058)
 * ────────────────────────────────────────────────────────────*/

export interface SufficiencyRequirement {
  /** Minimum bounded confidence the evidence must carry (0–1). */
  readonly minConfidence?: number;
  /** Require canonical-truth-eligible (active direct_observation) evidence. */
  readonly requireCanonicalTruth?: boolean;
  /** Evaluate freshness at this supplied instant (validity-window law). */
  readonly asOf?: string;
}

export interface SufficiencyEvaluation {
  readonly evidenceId: string;
  readonly verdict: SufficiencyVerdict;
  readonly reasons: readonly string[];
}

/**
 * Evaluate whether one evidence record SUFFICES for the claim it supports,
 * against an explicit requirement. Fail-closed: REVOKED or STALE evidence is
 * never sufficient regardless of any declared assessment; a confidence floor
 * requires the confidence to be declared AND provenance-cited; a declared
 * assessment of `insufficient`/`provisional` caps the verdict below
 * `sufficient`. Pure and deterministic.
 */
export function evaluateSufficiency(
  record: CapturedEvidence,
  requirement: SufficiencyRequirement = {},
): SufficiencyEvaluation {
  const reasons: string[] = [];
  let verdict: SufficiencyVerdict = "sufficient";

  if (record.revocation != null || record.revokes != null) {
    verdict = "insufficient";
    reasons.push("evidence is revoked and can never suffice");
  }

  if (requirement.asOf != null && isEvidenceStale(record, requirement.asOf)) {
    verdict = "insufficient";
    reasons.push(`evidence is stale as of ${requirement.asOf} (valid_until ${record.valid_until})`);
  }

  if (requirement.requireCanonicalTruth === true && !supportsCanonicalTruth(record)) {
    verdict = "insufficient";
    reasons.push(
      `requirement demands canonical-truth support but evidence class is "${record.evidence_class}"`,
    );
  }

  if (requirement.minConfidence != null) {
    const min = requirement.minConfidence;
    if (!isConfidence(min)) {
      throw new EvidenceCaptureError(
        "invalid_evidence_field",
        "minConfidence must be a finite number between 0 and 1",
      );
    }
    if (record.confidence == null) {
      verdict = "insufficient";
      reasons.push(`requirement demands confidence >= ${min} but no confidence is declared`);
    } else {
      if (!isProvenanceCitedConfidence(record)) {
        verdict = "insufficient";
        reasons.push("declared confidence carries no confidence_basis provenance citation");
      }
      if (record.confidence < min) {
        verdict = "insufficient";
        reasons.push(`declared confidence ${record.confidence} is below the required ${min}`);
      }
    }
  }

  // A declared assessment can only LOWER the verdict — it can never rescue
  // revoked, stale or under-confident evidence.
  if (verdict === "sufficient" && record.sufficiency != null) {
    verdict = record.sufficiency.verdict;
    if (record.sufficiency.verdict !== "sufficient") {
      reasons.push(
        `capture declared sufficiency "${record.sufficiency.verdict}" by "${record.sufficiency.assessedBy}"`,
      );
    }
  }

  return { evidenceId: record.evidence_id, verdict, reasons };
}

/* ─────────────────────────────────────────────────────────────
 * Revocation — authorized, append-only, cascading by flag (E-018)
 * ────────────────────────────────────────────────────────────*/

export interface RevocationActInput {
  /** Authorized revoker identity (1–160 characters). AI revokers are rejected. */
  revokedBy: string;
  /**
   * REQUIRED authorization reference (1–200 characters): the policy id or
   * authority grant under which the revocation proceeds. Revocation without
   * explicit authorization is rejected.
   */
  authorization: string;
  /** Revocation reason (1–1000 characters). */
  reason: string;
  /** Evidence id substantiating the revocation reason (1–160 characters). */
  reasonEvidenceRef: string;
  /** Revocation instant (ISO-8601, supplied); must not precede the capture instant. */
  revokedAt: string;
}

export interface RevocationResult {
  /** The original record, retained verbatim (append-only — nothing is deleted). */
  readonly retained: CapturedEvidence;
  /** The revocation act, itself evidence-bearing (class attested). */
  readonly revocationAct: CapturedEvidence;
  /** The revocation-mirror record carrying the act; never canonical-truth eligible. */
  readonly revoked: CapturedEvidence;
}

/**
 * Revoke one evidence record through an AUTHORIZED, recorded act. Append-only:
 * the original record is returned untouched and never deleted, the act is
 * itself captured as evidence, and a revocation-mirror record (pointing at
 * the original via `revokes`) carries the recorded act. The mirror is never
 * canonical-truth eligible, and the claim audit (`auditClaimSupport`) rejects
 * or flags any claim citing revoked evidence — prior claims supported by
 * now-revoked evidence are flagged for re-verification, never silently left.
 * Fails closed on: missing/malformed authorization, AI revokers, malformed
 * reasons or evidence refs, temporal impossibility, and double revocation.
 */
export function revokeEvidence(
  record: CapturedEvidence,
  act: RevocationActInput,
  knownObjectTypes?: readonly string[],
  options: EvidenceCaptureOptions = {},
): RevocationResult {
  if (record.revocation != null || record.revokes != null) {
    throw new EvidenceCaptureError(
      "evidence_already_revoked",
      `evidence "${record.evidence_id}" is already revoked — revocation is a one-time recorded act`,
    );
  }
  if (!isEnvelopeRef(act.revokedBy, 160)) {
    throw new EvidenceCaptureError(
      "invalid_revocation_act",
      "revocation act requires a revoker identity (1–160 characters)",
    );
  }
  if (provenanceCarriesAiMarkers({ source: act.revokedBy })) {
    throw new EvidenceCaptureError(
      "revocation_not_authorized",
      `revoker "${act.revokedBy}" carries AI provenance markers — AI output is untrusted (Constitution §21) and an AI identity can never authorize revocation of evidence`,
    );
  }
  // Authorization is mandatory: no anonymous revocation, no self-granted
  // authority — the act must cite the policy id or authority grant.
  const authorization = act.authorization?.trim() ?? null;
  if (authorization === null || !isEnvelopeRef(authorization, 200)) {
    throw new EvidenceCaptureError(
      "revocation_not_authorized",
      "revocation requires an explicit authorization reference (policy id or authority grant, 1–200 characters) — unauthorized revocation is rejected",
    );
  }
  const reason = act.reason?.trim() ?? "";
  if (reason.length < 1 || reason.length > 1000) {
    throw new EvidenceCaptureError(
      "invalid_revocation_act",
      "revocation requires a reason (1–1000 characters)",
    );
  }
  const reasonEvidenceRef = act.reasonEvidenceRef?.trim() ?? "";
  if (!isEnvelopeRef(reasonEvidenceRef, 160)) {
    throw new EvidenceCaptureError(
      "invalid_revocation_act",
      "revocation requires a substantiating evidence reference (1–160 characters)",
    );
  }
  const revokedAt = isoTimestamp(act.revokedAt, "revoked_at", "invalid_revocation_act");
  if (Date.parse(revokedAt) < Date.parse(record.captured_at)) {
    throw new EvidenceCaptureError(
      "invalid_revocation_act",
      "revocation instant precedes the capture instant — evidence cannot be revoked before it was captured",
    );
  }

  const revokedByIdentity = act.revokedBy.trim();
  const revokedId = `${record.evidence_id}:revoked`;
  const actId = `${record.evidence_id}:revocation-act`;
  if (!isEnvelopeRef(revokedId, 160) || !isEnvelopeRef(actId, 160)) {
    throw new EvidenceCaptureError(
      "invalid_revocation_act",
      "derived revocation/act evidence ids exceed the 160-character envelope bound",
    );
  }

  const revocationAct: EvidenceRevocationAct = {
    revokedBy: revokedByIdentity,
    authorization,
    reason,
    reasonEvidenceRef,
    revokedAt,
    actEvidenceId: actId,
    revokedEvidenceId: revokedId,
  };

  const revoked = buildEvidence(
    {
      evidenceId: revokedId,
      evidenceType: record.evidence_type,
      tenantId: record.tenant_id,
      evidenceClass: record.evidence_class,
      claim: { ...record.claim },
      confidence: record.confidence,
      confidenceBasis: record.confidence_basis,
      sufficiency: record.sufficiency,
      validFrom: record.valid_from,
      validUntil: record.valid_until,
      retentionPolicyId: record.retention_policy_id,
      observedAt: record.observed_at,
      capturedBy: revokedByIdentity,
      capturedAt: revokedAt,
      sourceRef: null,
      lineage: [record.evidence_id],
      envelope: {
        objectType: EVIDENCE_OBJECT_TYPE,
        schemaVersion: record.schema_version,
        status: record.status,
        createdBy: revokedByIdentity,
        updatedBy: revokedByIdentity,
        provenance: {
          source: "evidence-revocation",
          sourceRef: record.evidence_id,
          recordedBy: revokedByIdentity,
          originTenantId: record.tenant_id,
          generatedByAi: false,
          verified: true,
        },
        policyContext: {
          ...record.policy_context,
          evidence_revocation: {
            revoked_evidence_id: record.evidence_id,
            authorization,
            reason,
            reason_evidence_ref: reasonEvidenceRef,
            revoked_by: revokedByIdentity,
            revoked_at: revokedAt,
            act_evidence_id: actId,
          },
        },
        traceId: record.trace_id,
        correlationId: record.correlation_id,
        causationId: record.evidence_id,
      },
    },
    [record.evidence_id],
    null,
    null,
    null,
    knownObjectTypes,
    options,
    revocationAct,
    record.evidence_id,
  );

  const actRecord = buildEvidence(
    {
      evidenceId: actId,
      evidenceType: "revocation_act",
      tenantId: record.tenant_id,
      evidenceClass: "attested",
      claim: {
        revocation_act: {
          revoked_by: revokedByIdentity,
          authorization,
          reason,
          reason_evidence_ref: reasonEvidenceRef,
          revoked_at: revokedAt,
          target_evidence_id: record.evidence_id,
          revoked_evidence_id: revokedId,
        },
      },
      confidence: null,
      retentionPolicyId: record.retention_policy_id,
      observedAt: revokedAt,
      capturedBy: revokedByIdentity,
      capturedAt: revokedAt,
      sourceRef: record.evidence_id,
      lineage: [record.evidence_id],
      envelope: {
        objectType: EVIDENCE_OBJECT_TYPE,
        schemaVersion: record.schema_version,
        status: record.status,
        createdBy: revokedByIdentity,
        updatedBy: revokedByIdentity,
        provenance: {
          source: "evidence-revocation-act",
          sourceRef: record.evidence_id,
          recordedBy: revokedByIdentity,
          originTenantId: record.tenant_id,
          generatedByAi: false,
          verified: true,
        },
        policyContext: {
          ...record.policy_context,
          evidence_revocation: {
            target_evidence_id: record.evidence_id,
            authorization,
            act_evidence_id: actId,
          },
        },
        traceId: record.trace_id,
        correlationId: record.correlation_id,
        causationId: record.evidence_id,
      },
    },
    [record.evidence_id],
    null,
    null,
    null,
    knownObjectTypes,
    options,
  );

  return { retained: record, revocationAct: actRecord, revoked };
}

/**
 * The set of evidence ids that are revoked within a record set: ids pointed
 * at by a revocation-mirror's `revokes`, plus the ids of mirror records
 * themselves. Claims citing any of these are rejected or flagged by
 * `auditClaimSupport`.
 */
export function resolveRevokedEvidenceIds(records: readonly CapturedEvidence[]): Set<string> {
  const revoked = new Set<string>();
  for (const record of records) {
    if (record.revokes != null) revoked.add(record.revokes);
    if (record.revocation != null) revoked.add(record.evidence_id);
  }
  return revoked;
}

/** True when the record itself carries a recorded revocation act. */
export function isEvidenceRevoked(record: CapturedEvidence): boolean {
  return record.revocation != null;
}

/* ─────────────────────────────────────────────────────────────
 * Claim support audit — the consumption gate (E-018 invariants 12–13)
 * ────────────────────────────────────────────────────────────*/

export interface EvidenceClaimInput {
  /** Claim identity (1–160 characters). */
  claimId: string;
  /** The claim statement; opaque JSON object. */
  statement?: Record<string, unknown>;
  /** Evidence ids the claim rests on (1–160 characters each). */
  evidenceIds: readonly string[];
  /**
   * True when the claim is a CANONICAL-TRUTH claim (default): it may only
   * rest on active direct_observation evidence (Constitution §9).
   */
  canonical?: boolean;
  /**
   * True when this claim was PREVIOUSLY served as supported — with now-
   * revoked evidence it is FLAGGED for re-verification instead of merely
   * rejected, so once-true claims are never silently left true (E-018
   * invariant 13).
   */
  previouslySupported?: boolean;
}

export type ClaimSupportVerdict =
  | "supported"
  | "rejected_no_evidence"
  | "rejected_revoked_evidence"
  | "rejected_quarantine_only"
  | "flagged_re_verification_revoked"
  | "flagged_stale_evidence"
  | "flagged_insufficient_sufficiency";

export interface ClaimSupportAudit {
  readonly claimId: string;
  readonly verdict: ClaimSupportVerdict;
  /** Only a `supported` verdict is servable. Revoked/stale/insufficient never are. */
  readonly servable: boolean;
  /** True when the claim must be surfaced for re-verification, never silently left. */
  readonly flagged: boolean;
  readonly reasons: readonly string[];
}

const FLAGGED_VERDICTS: readonly ClaimSupportVerdict[] = [
  "flagged_re_verification_revoked",
  "flagged_stale_evidence",
  "flagged_insufficient_sufficiency",
];

/**
 * Audit one claim's support over an evidence record set (the consumption
 * gate). Fail-closed and deterministic:
 * - no evidence -> rejected;
 * - citing REVOKED evidence -> rejected (or, when the claim was previously
 *   supported, flagged for re-verification) — never servable;
 * - canonical claim with no active direct_observation support -> rejected;
 * - citing STALE evidence (past validity window at `asOf`) -> flagged, never
 *   silently served;
 * - citing evidence whose declared sufficiency is not `sufficient` ->
 *   flagged;
 * - otherwise supported.
 */
export function auditClaimSupport(
  claim: EvidenceClaimInput,
  records: readonly CapturedEvidence[],
  options: { asOf?: string } = {},
): ClaimSupportAudit {
  if (!isEnvelopeRef(claim.claimId, 160)) {
    throw new EvidenceCaptureError("invalid_evidence_field", "claim_id must be 1–160 characters");
  }
  if (claim.statement != null && !isPayloadObject(claim.statement)) {
    throw new EvidenceCaptureError(
      "invalid_evidence_field",
      "claim statement must be a JSON object",
    );
  }

  const reject = (verdict: ClaimSupportVerdict, reasons: readonly string[]): ClaimSupportAudit => ({
    claimId: claim.claimId,
    verdict,
    servable: false,
    flagged: FLAGGED_VERDICTS.includes(verdict),
    reasons,
  });

  const evidenceIds = claim.evidenceIds ?? [];
  if (evidenceIds.length === 0) {
    return reject("rejected_no_evidence", ["claim cites no evidence"]);
  }
  for (const id of evidenceIds) {
    if (!isEnvelopeRef(id, 160)) {
      throw new EvidenceCaptureError(
        "invalid_evidence_field",
        "cited evidence ids must be 1–160 characters",
      );
    }
  }

  const byId = new Map<string, CapturedEvidence>();
  for (const record of records) byId.set(record.evidence_id, record);
  const revokedIds = resolveRevokedEvidenceIds(records);

  const citedRevoked = evidenceIds.filter((id) => revokedIds.has(id));
  if (citedRevoked.length > 0) {
    if (claim.previouslySupported === true) {
      return reject("flagged_re_verification_revoked", [
        `claim was previously supported by now-REVOKED evidence: ${citedRevoked.join(", ")} — flagged for re-verification, never silently left`,
      ]);
    }
    return reject("rejected_revoked_evidence", [
      `claim cites REVOKED evidence: ${citedRevoked.join(", ")} — revoked evidence cannot support active claims`,
    ]);
  }

  const citedRecords: (CapturedEvidence | null)[] = evidenceIds.map((id) => byId.get(id) ?? null);
  const missing = evidenceIds.filter((_, index) => citedRecords[index] === null);
  if (missing.length > 0) {
    return reject("rejected_no_evidence", [
      `claim cites evidence absent from the record set: ${missing.join(", ")}`,
    ]);
  }

  if (claim.canonical !== false) {
    const hasCanonicalSupport = citedRecords.some(
      (record) => record !== null && supportsCanonicalTruth(record),
    );
    if (!hasCanonicalSupport) {
      return reject("rejected_quarantine_only", [
        "canonical-truth claim rests only on quarantine-class evidence — an explicit recorded promotion act is required first",
      ]);
    }
  }

  if (options.asOf != null) {
    const asOf = options.asOf;
    const stale = citedRecords.filter((record) => record !== null && isEvidenceStale(record, asOf));
    if (stale.length > 0) {
      return reject("flagged_stale_evidence", [
        `claim cites STALE evidence at ${asOf}: ${stale
          .map((record) => record?.evidence_id)
          .join(", ")} — surfaced for refresh, never silently served`,
      ]);
    }
  }

  const insufficient = citedRecords.filter(
    (record) =>
      record !== null && record.sufficiency != null && record.sufficiency.verdict !== "sufficient",
  );
  if (insufficient.length > 0) {
    return reject("flagged_insufficient_sufficiency", [
      `claim cites evidence whose declared sufficiency is not "sufficient": ${insufficient
        .map((record) => `${record?.evidence_id}(${record?.sufficiency?.verdict})`)
        .join(", ")}`,
    ]);
  }

  return {
    claimId: claim.claimId,
    verdict: "supported",
    servable: true,
    flagged: false,
    reasons: [],
  };
}

/**
 * Single fail-closed consumption gate for serving one evidence record:
 * REVOKED evidence is rejected with `evidence_revoked`; evidence past its
 * validity window (when `at` is supplied) is rejected with `evidence_stale` —
 * stale evidence is surfaced, not served.
 */
export function requireServableEvidence(record: CapturedEvidence, at?: string): void {
  if (record.revocation != null || record.revokes != null) {
    throw new EvidenceCaptureError(
      "evidence_revoked",
      `evidence "${record.evidence_id}" is REVOKED and cannot be served`,
    );
  }
  if (at != null && isEvidenceStale(record, at)) {
    throw new EvidenceCaptureError(
      "evidence_stale",
      `evidence "${record.evidence_id}" is STALE as of ${at} (valid_until ${record.valid_until}) — surfaced, not served`,
    );
  }
}
