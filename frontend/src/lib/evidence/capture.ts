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
  | "tenant_mismatch";

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
    canonical_truth_eligible: input.evidenceClass === "direct_observation",
    lineage: freezeShallow([...lineage]),
    supersedes,
    promotion: promotion === null ? null : freezeShallow({ ...promotion }),
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
): CapturedEvidence {
  return buildEvidence(input, input.lineage ?? [], null, null, null, knownObjectTypes);
}

/* ─────────────────────────────────────────────────────────────
 * Canonical-truth gate (Constitution §9)
 * ────────────────────────────────────────────────────────────*/

/** Only direct_observation evidence supports canonical-truth claims. */
export function supportsCanonicalTruth(record: CapturedEvidence): boolean {
  return record.canonical_truth_eligible && record.evidence_class === "direct_observation";
}

/** Fail-closed canonical-truth gate for consumers of evidence. */
export function requireCanonicalTruthSupport(record: CapturedEvidence): void {
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
): PromotionResult {
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
 * record's id in its lineage. Cross-tenant successors are rejected.
 */
export function supersedeEvidence(
  record: CapturedEvidence,
  successorInput: EvidenceCaptureInput,
  knownObjectTypes?: readonly string[],
): SupersedeResult {
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
  );
  return { retained: record, successor };
}
