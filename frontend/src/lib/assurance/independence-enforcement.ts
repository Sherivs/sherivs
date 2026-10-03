/**
 * CoreGrid — verification-independence enforcement (J-035, mission B-021;
 * Constitution §7, §12, §15, §16, §18, §21).
 *
 * J-035: "a worker (AI or human) cannot verify its own output in the loop."
 * The assurance layer already owns the verdict-issuance contract
 * (`./verification-independence`). This module owns the INDEPENDENCE
 * enforcement layer beneath it: before any verification is attempted, the
 * proposed verifier must be provably independent of the performer of record.
 * Independence is proven from identity and from relationship evidence, never
 * assumed.
 *
 * The typed check enforces three independence surfaces, each fail closed:
 *
 *  1. Identity: the verifier must not be the performer of record (E-050;
 *     binds AI and human workers equally — classification is provenance,
 *     not an authority axis).
 *  2. Relationships: no ACTIVE binding relationship (authority or
 *     delegation) may connect the verifier and the performer in either
 *     direction, evaluated on the identity model's relationship vocabulary
 *     (`../identity` RELATIONSHIP_TYPES) at the caller-supplied instant.
 *     Authority grants ("owns", "manages") and delegation grants
 *     ("agent_for", "delegated_to") are binding; every other KNOWN
 *     relationship type is non-binding.
 *  3. Unknown relationships (fail closed): the independence determination
 *     can only rest on resolvable evidence. Therefore
 *       - a relationship record of UNKNOWN type,
 *       - a relationship record whose lifecycle status (revocation /
 *         expiry) cannot be parsed,
 *       - a malformed relationship record,
 *       - an evidence set the caller cannot certify as COMPLETE,
 *     all BLOCK the verification. "We could not resolve the relationship
 *     evidence" is never upgraded to "they are independent". Note the
 *     deliberate asymmetry with the grant path in `../authorization`: there,
 *     an unparseable expiry kills a GRANT (deny access); here, an
 *     unparseable status on a binding-candidate record kills the ALLOW,
 *     because independence requires PROOF that the binding is dead, not the
 *     absence of proof that it is alive.
 *
 * Composition: the performer-of-record model, its fail-closed resolution,
 * the self-verification identity check and the verifier classification
 * vocabulary are imported read-only from the sibling assurance module
 * `./verification-independence`; the relationship vocabulary is imported
 * read-only from `../identity`. This module owns none of those sources — it
 * resolves and evaluates against what they record. The tenant boundary is
 * NOT re-decided here (§15/§16 ownership: `../authorization` and the verdict
 * contract); tenant scope is carried for provenance only.
 *
 * Boundary: pure data + pure functions. No persistence, no I/O, no vendor
 * imports, no implicit clock — the caller supplies the evaluation instant
 * and the evidence set. Every determination — confirmed AND denied —
 * produces an audit record (§18: Observe -> Evaluate -> Decision -> Audit),
 * so denial is observable, never silent.
 */

import { z } from "zod";
import { RELATIONSHIP_TYPES } from "../identity";
import {
  VERIFIER_CLASSIFICATIONS,
  isSelfVerification,
  resolvePerformerOfRecord,
  type PerformerOfRecord,
  type VerifierClassification,
} from "./verification-independence";

/* ─────────────────────────────────────────────────────────────
 * Vocabularies
 * ────────────────────────────────────────────────────────────*/

export const INDEPENDENCE_SCHEMA_VERSION = "1.0";

/**
 * The outcome of an independence determination. "independent" is the only
 * outcome that permits a verification attempt to proceed; "dependent" names
 * a proven dependence (self-identity or an active binding relationship);
 * "blocked" names unresolvable evidence (fail closed).
 */
export const INDEPENDENCE_OUTCOMES = ["independent", "dependent", "blocked"] as const;
export type IndependenceOutcome = (typeof INDEPENDENCE_OUTCOMES)[number];

/**
 * The closed set of denial reasons. Every non-confirming path names its
 * reason (never a silent pass).
 */
export const INDEPENDENCE_DENY_REASONS = [
  "invalid_input",
  "verifier_identity_unrecorded",
  "performer_of_record_unrecorded",
  "performer_of_record_ambiguous",
  "self_verification_denied",
  "binding_relationship_denied",
  "invalid_relationship_evidence",
  "unknown_relationship_type",
  "unknown_relationship_status",
  "relationship_evidence_incomplete",
] as const;
export type IndependenceDenyReason = (typeof INDEPENDENCE_DENY_REASONS)[number];

/**
 * Relationship types that BIND two parties for independence purposes:
 * authority (an ReBAC grant path between the parties, per
 * `../authorization`) and delegation (a worker/principal link). A known,
 * non-binding relationship (e.g. shared membership) does not defeat
 * independence.
 */
export const BINDING_RELATIONSHIP_TYPES = [
  "owns",
  "manages",
  "agent_for",
  "delegated_to",
] as const;
export type BindingRelationshipType = (typeof BINDING_RELATIONSHIP_TYPES)[number];

/** Caller certification of the relationship evidence set. */
export const EVIDENCE_COMPLETENESS = ["complete", "partial"] as const;
export type EvidenceCompleteness = (typeof EVIDENCE_COMPLETENESS)[number];

/* ─────────────────────────────────────────────────────────────
 * Contracts (Zod-validated, fail closed)
 * ────────────────────────────────────────────────────────────*/

const nonEmptyString = z
  .string()
  .max(300)
  .refine((value) => value.trim().length > 0, "must be a non-blank string");

/** An RFC 3339-style parseable instant (evaluation instants only). */
const evaluationInstant = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value.trim())), "must be a parseable timestamp");

const performerOfRecordSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), identityRef: z.string() }),
  z.object({ status: z.literal("unrecorded") }),
  z.object({ status: z.literal("ambiguous"), candidates: z.array(z.string()) }),
]) satisfies z.ZodType<PerformerOfRecord>;

/**
 * Relationship evidence, modeled on the identity platform's
 * `IdentityRelationship` record. Lifecycle instants are plain strings at
 * the schema edge: an unparseable revocation or expiry is not generic
 * invalid input, it is an UNKNOWN relationship status and fails closed with
 * its own named reason at evaluation time.
 */
export const relationshipEvidenceSchema = z.object({
  relationshipId: nonEmptyString,
  subjectId: nonEmptyString,
  type: z.string(),
  targetId: nonEmptyString,
  scope: z.string().max(300).nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  version: z.number().int().min(0),
});
export type RelationshipEvidence = z.infer<typeof relationshipEvidenceSchema>;

export const verifierRefSchema = z.object({
  // Blank verifier references are NOT generic invalid input: they are a
  // named fail-closed reason at evaluation time (verifier_identity_unrecorded).
  identityRef: z.string().max(300),
  classification: z.enum(VERIFIER_CLASSIFICATIONS),
});

export const independenceCheckInputSchema = z.object({
  itemId: nonEmptyString,
  /** Provenance only; the tenant gate is owned by `../authorization`. */
  tenantScope: nonEmptyString,
  policyRef: nonEmptyString,
  verifier: verifierRefSchema,
  performerOfRecord: performerOfRecordSchema,
  relationshipEvidence: z.array(relationshipEvidenceSchema),
  /**
   * The caller's certification that `relationshipEvidence` is the COMPLETE
   * relationship set for the parties in scope. "partial" can never prove
   * independence (§16 fail closed).
   */
  evidenceCompleteness: z.enum(EVIDENCE_COMPLETENESS),
  /** Evaluation instant — supplied by the caller; no implicit clock. */
  evaluatedAt: evaluationInstant,
});
export type IndependenceCheckInput = z.infer<typeof independenceCheckInputSchema>;

/* ─────────────────────────────────────────────────────────────
 * Determination and audit (Constitution §12 / §18)
 * ────────────────────────────────────────────────────────────*/

export type IndependenceDetermination =
  | { ok: true; outcome: "independent"; audit: IndependenceAuditRecord }
  | {
      ok: false;
      outcome: Exclude<IndependenceOutcome, "independent">;
      denyReason: IndependenceDenyReason;
      detail: string;
      audit: IndependenceAuditRecord;
    };

/**
 * Immutable audit record produced by EVERY determination, confirm and deny
 * (§18 — denial is observable, never silent). `performerOfRecordRef` is
 * null when the performer of record is unrecorded or ambiguous;
 * `evaluatedAt` is null when the supplied instant is not parseable.
 */
export interface IndependenceAuditRecord {
  readonly auditId: string;
  readonly eventKind: "independence_confirmed" | "independence_denied";
  readonly itemId: string;
  readonly tenantScope: string;
  readonly policyRef: string;
  readonly verifierIdentityRef: string;
  readonly verifierClassification: VerifierClassification;
  readonly performerOfRecordRef: string | null;
  readonly selfVerificationAttempt: boolean;
  readonly bindingRelationshipIds: readonly string[];
  readonly relationshipEvidenceCount: number;
  readonly evidenceCompleteness: EvidenceCompleteness;
  readonly evaluatedAt: string | null;
  readonly denyReason: IndependenceDenyReason | null;
}

/* ─────────────────────────────────────────────────────────────
 * Helpers (pure, fail closed)
 * ────────────────────────────────────────────────────────────*/

/**
 * Classify a relationship type against the identity model's closed
 * vocabulary: "binding" types connect the parties with authority or
 * delegation, "non_binding" types are known to the identity model but do
 * not defeat independence, "unknown" types cannot be classified and fail
 * closed.
 */
export type RelationshipBindingClass = "binding" | "non_binding" | "unknown";

export function classifyRelationshipType(type: string): RelationshipBindingClass {
  const normalized = type.trim();
  if ((BINDING_RELATIONSHIP_TYPES as readonly string[]).includes(normalized)) {
    return "binding";
  }
  if ((RELATIONSHIP_TYPES as readonly string[]).includes(normalized)) {
    return "non_binding";
  }
  return "unknown";
}

/**
 * Lifecycle status of a relationship at an evaluation instant (ms).
 * "unknown" is reserved for lifecycle instants that cannot be parsed —
 * the caller decides what unknown means (this module: fail closed on
 * binding-candidate records).
 *
 * A revoked relationship is inactive regardless of expiry. An unparseable
 * revocation instant is UNKNOWN, not inactive: revocation that cannot be
 * read cannot be proven.
 */
export type RelationshipStatusAt = "active" | "inactive" | "unknown";

export function relationshipStatusAt(
  record: RelationshipEvidence,
  evaluatedAtMs: number,
): RelationshipStatusAt {
  if (record.revokedAt !== null) {
    return Number.isFinite(Date.parse(record.revokedAt.trim())) ? "inactive" : "unknown";
  }
  if (record.expiresAt !== null) {
    const expiryMs = Date.parse(record.expiresAt.trim());
    if (!Number.isFinite(expiryMs)) return "unknown";
    return expiryMs <= evaluatedAtMs ? "inactive" : "active";
  }
  return "active";
}

/**
 * Scan the evidence for relationships binding two parties in EITHER
 * direction. Only resolvable records can produce findings: the scan names
 * the records it could not resolve so the caller can fail closed.
 */
export type RelationshipBindingFinding =
  | { readonly relationshipId: string; readonly finding: "no_binding" }
  | {
      readonly relationshipId: string;
      readonly finding: "binding";
      readonly relationshipType: BindingRelationshipType;
    }
  | {
      readonly relationshipId: string;
      readonly finding: "unresolvable";
      readonly denyReason:
        | "invalid_relationship_evidence"
        | "unknown_relationship_type"
        | "unknown_relationship_status";
      readonly detail: string;
    };

export function scanBindingRelationships(
  evidence: readonly RelationshipEvidence[],
  partyARef: string,
  partyBRef: string,
  evaluatedAtMs: number,
): readonly RelationshipBindingFinding[] {
  const a = partyARef.trim();
  const b = partyBRef.trim();
  const findings: RelationshipBindingFinding[] = [];
  for (const record of evidence) {
    const subject = record.subjectId.trim();
    const target = record.targetId.trim();
    const involvesBothParties =
      (subject === a && target === b) || (subject === b && target === a);
    if (!involvesBothParties) {
      findings.push({ relationshipId: record.relationshipId, finding: "no_binding" });
      continue;
    }
    const bindingClass = classifyRelationshipType(record.type);
    if (bindingClass === "unknown") {
      findings.push({
        relationshipId: record.relationshipId,
        finding: "unresolvable",
        denyReason: "unknown_relationship_type",
        detail: `relationship "${record.relationshipId}" carries an unknown type and cannot be classified`,
      });
      continue;
    }
    if (bindingClass === "non_binding") {
      findings.push({ relationshipId: record.relationshipId, finding: "no_binding" });
      continue;
    }
    const status = relationshipStatusAt(record, evaluatedAtMs);
    if (status === "unknown") {
      findings.push({
        relationshipId: record.relationshipId,
        finding: "unresolvable",
        denyReason: "unknown_relationship_status",
        detail: `relationship "${record.relationshipId}" has an unparseable lifecycle instant; its binding status cannot be proven`,
      });
      continue;
    }
    findings.push(
      status === "active"
        ? {
            relationshipId: record.relationshipId,
            finding: "binding",
            relationshipType: record.type.trim() as BindingRelationshipType,
          }
        : { relationshipId: record.relationshipId, finding: "no_binding" },
    );
  }
  return findings;
}

/**
 * Convenience gate for callers that branch on a boolean. The typed
 * determination (`enforceIndependence`) remains the enforcement point.
 */
export function independenceAllows(input: IndependenceCheckInput): boolean {
  return enforceIndependence(input).ok;
}

/* ─────────────────────────────────────────────────────────────
 * The contract: enforce verification independence (fail closed)
 * ────────────────────────────────────────────────────────────*/

/**
 * Determine whether a proposed verifier is provably independent of a work
 * item's performer of record. Denial order (each named):
 *
 *  1. invalid_input — malformed input (schema violation);
 *  2. verifier_identity_unrecorded — the verifier reference resolves to
 *     nothing (blank after normalization);
 *  3. performer_of_record_unrecorded — the performer cannot be resolved,
 *     so independence cannot even be evaluated;
 *  4. performer_of_record_ambiguous — the records disagree on the
 *     performer, so independence cannot be evaluated;
 *  5. self_verification_denied — the verifier IS the performer of record
 *     (J-035 / E-050: no worker verifies its own work);
 *  6. invalid_relationship_evidence — a relationship record is malformed
 *     (unparseable creation instant) and cannot be classified;
 *  7. unknown_relationship_type — a relationship record carries a type
 *     outside the identity model's closed vocabulary;
 *  8. binding_relationship_denied — an ACTIVE authority or delegation
 *     relationship connects the verifier and the performer in either
 *     direction at the evaluation instant;
 *  9. unknown_relationship_status — a binding-candidate relationship's
 *     lifecycle cannot be parsed, so its deadness cannot be proven;
 * 10. relationship_evidence_incomplete — the caller cannot certify the
 *     evidence set as complete, so independence cannot be proven.
 *
 * Every path — confirm AND deny — returns an audit record.
 */
export function enforceIndependence(input: IndependenceCheckInput): IndependenceDetermination {
  /* 1. Input shape (fail closed). */
  const parsed = independenceCheckInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join(".") : "input";
    const message = issue ? issue.message : "schema validation failed";
    return deny(
      input,
      "invalid_input",
      `independence check input is malformed at "${where}": ${message}`,
    );
  }
  const value = parsed.data;
  const verifierRef = value.verifier.identityRef.trim();
  const evidenceCompleteness = value.evidenceCompleteness;
  const evaluatedAtMs = Date.parse(value.evaluatedAt.trim());
  const evaluatedAt = Number.isFinite(evaluatedAtMs) ? value.evaluatedAt.trim() : null;

  /* 2. Verifier identity must resolve. */
  if (verifierRef.length === 0) {
    return deny(
      value,
      "verifier_identity_unrecorded",
      "verifier identity reference resolves to nothing — independence cannot be evaluated",
    );
  }

  /* 3/4. Performer of record must resolve before independence is evaluable. */
  const performer: PerformerOfRecord = resolvePerformerOfRecord(value.performerOfRecord);
  if (performer.status === "unrecorded") {
    return deny(
      value,
      "performer_of_record_unrecorded",
      `work item "${value.itemId.trim()}" has no performer of record — independence cannot be evaluated`,
    );
  }
  if (performer.status === "ambiguous") {
    return deny(
      value,
      "performer_of_record_ambiguous",
      `work item "${value.itemId.trim()}" has an ambiguous performer of record (${performer.candidates.length} candidates) — independence cannot be evaluated`,
    );
  }
  const performerRef = performer.identityRef;

  /* 5. THE identity independence invariant (J-035 / E-050). */
  if (isSelfVerification(verifierRef, performerRef)) {
    return deny(
      value,
      "self_verification_denied",
      `verifier "${verifierRef}" is the performer of record for "${value.itemId.trim()}" — no worker verifies its own work`,
    );
  }

  /* 6. Evidence well-formedness (§12: provenance must be readable). */
  for (const record of value.relationshipEvidence) {
    if (!Number.isFinite(Date.parse(record.createdAt.trim()))) {
      return deny(
        value,
        "invalid_relationship_evidence",
        `relationship "${record.relationshipId}" has an unparseable creation instant and cannot be classified`,
      );
    }
  }

  /* 7. Relationship classification (fail closed on unknown types). */
  for (const record of value.relationshipEvidence) {
    if (classifyRelationshipType(record.type) === "unknown") {
      return deny(
        value,
        "unknown_relationship_type",
        `relationship "${record.relationshipId}" carries type "${record.type.trim()}" outside the identity model's closed vocabulary — the evidence cannot be classified`,
      );
    }
  }

  /* 8/9. Binding relationships between the parties, in either direction. */
  const findings = scanBindingRelationships(
    value.relationshipEvidence,
    verifierRef,
    performerRef,
    evaluatedAtMs,
  );
  const binding = findings.filter((f) => f.finding === "binding");
  if (binding.length > 0) {
    const bindingIds = binding.map((f) => f.relationshipId);
    return deny(
      value,
      "binding_relationship_denied",
      `verifier "${verifierRef}" is bound to performer "${performerRef}" by active relationship(s) ${bindingIds.join(", ")} — a bound party is not independent`,
      bindingIds,
    );
  }
  const unresolvable = findings.find((f) => f.finding === "unresolvable");
  if (unresolvable !== undefined && unresolvable.finding === "unresolvable") {
    return deny(value, unresolvable.denyReason, unresolvable.detail);
  }

  /* 10. Evidence completeness certification (§16 fail closed). */
  if (evidenceCompleteness === "partial") {
    return deny(
      value,
      "relationship_evidence_incomplete",
      "the caller cannot certify the relationship evidence set as complete — independence cannot be proven from partial evidence",
    );
  }

  /* Confirm: the verifier is provably independent (§12 provenance). */
  const audit = auditRecord(value, {
    eventKind: "independence_confirmed",
    denyReason: null,
    performerRef,
    bindingRelationshipIds: [],
  });
  return { ok: true, outcome: "independent", audit };
}

/**
 * Build the audit record for a DENIED determination. Works even when the
 * input is malformed: every field is read defensively, so a denial of a
 * malformed input is still observable (fail closed, never silent).
 */
function deny(
  input: IndependenceCheckInput | undefined | null,
  denyReason: IndependenceDenyReason,
  detail: string,
  bindingRelationshipIds: readonly string[] = [],
): {
  ok: false;
  outcome: Exclude<IndependenceOutcome, "independent">;
  denyReason: IndependenceDenyReason;
  detail: string;
  audit: IndependenceAuditRecord;
} {
  const outcome: IndependenceOutcome =
    denyReason === "self_verification_denied" || denyReason === "binding_relationship_denied"
      ? "dependent"
      : "blocked";
  const performerCandidate: PerformerOfRecord | null =
    input && typeof input === "object" && input.performerOfRecord
      ? resolvePerformerOfRecord(input.performerOfRecord)
      : null;
  const performerRef =
    performerCandidate !== null && performerCandidate.status === "recorded"
      ? performerCandidate.identityRef
      : null;
  const verifierRef =
    input !== null &&
    input !== undefined &&
    typeof input.verifier?.identityRef === "string" &&
    input.verifier.identityRef.trim().length > 0
      ? input.verifier.identityRef.trim()
      : "";
  const selfVerificationAttempt =
    verifierRef.length > 0 &&
    performerRef !== null &&
    isSelfVerification(verifierRef, performerRef);
  const evaluatedAtRaw =
    input !== null && input !== undefined && typeof input.evaluatedAt === "string"
      ? input.evaluatedAt
      : null;
  const audit = auditRecord(
    input,
    {
      eventKind: "independence_denied",
      denyReason,
      performerRef,
      bindingRelationshipIds,
      selfVerificationAttempt,
    },
    {
      outcome: "denied",
      verifierRef: verifierRef.length > 0 ? verifierRef : "unattributed",
      evaluatedAt:
        evaluatedAtRaw !== null && Number.isFinite(Date.parse(evaluatedAtRaw.trim()))
          ? evaluatedAtRaw.trim()
          : null,
    },
  );
  return { ok: false, outcome, denyReason, detail, audit };
}

function auditRecord(
  input: IndependenceCheckInput | undefined | null,
  fields: {
    eventKind: "independence_confirmed" | "independence_denied";
    denyReason: IndependenceDenyReason | null;
    performerRef: string | null;
    bindingRelationshipIds: readonly string[];
    selfVerificationAttempt?: boolean;
  },
  overrides?: {
    outcome: "confirmed" | "denied";
    verifierRef: string;
    evaluatedAt: string | null;
  },
): IndependenceAuditRecord {
  const verifierClassification: VerifierClassification =
    input !== null &&
    input !== undefined &&
    typeof input.verifier?.classification === "string" &&
    (VERIFIER_CLASSIFICATIONS as readonly string[]).includes(input.verifier.classification)
      ? (input.verifier.classification as VerifierClassification)
      : "unclassified";
  const evaluatedAtResolved =
    overrides !== undefined
      ? overrides.evaluatedAt
      : input !== null &&
          input !== undefined &&
          typeof input.evaluatedAt === "string" &&
          Number.isFinite(Date.parse(input.evaluatedAt.trim()))
        ? input.evaluatedAt.trim()
        : null;
  const verifierRefResolved =
    overrides !== undefined
      ? overrides.verifierRef
      : input !== null &&
          input !== undefined &&
          typeof input.verifier?.identityRef === "string" &&
          input.verifier.identityRef.trim().length > 0
        ? input.verifier.identityRef.trim()
        : "unattributed";
  const itemId =
    input !== null && input !== undefined && typeof input.itemId === "string"
      ? input.itemId.trim() || "unattributed"
      : "unattributed";
  const tenantScope =
    input !== null && input !== undefined && typeof input.tenantScope === "string"
      ? input.tenantScope.trim() || "unattributed"
      : "unattributed";
  const policyRef =
    input !== null && input !== undefined && typeof input.policyRef === "string"
      ? input.policyRef.trim() || "unattributed"
      : "unattributed";
  const relationshipEvidenceCount =
    input !== null && input !== undefined && Array.isArray(input.relationshipEvidence)
      ? input.relationshipEvidence.length
      : 0;
  const evidenceCompleteness: EvidenceCompleteness =
    input !== null &&
    input !== undefined &&
    input.evidenceCompleteness !== undefined &&
    (EVIDENCE_COMPLETENESS as readonly string[]).includes(input.evidenceCompleteness)
      ? input.evidenceCompleteness
      : "partial";
  return {
    auditId: `audit:independence:${itemId}:${verifierRefResolved}`,
    eventKind: fields.eventKind,
    itemId,
    tenantScope,
    policyRef,
    verifierIdentityRef: verifierRefResolved,
    verifierClassification,
    performerOfRecordRef: fields.performerRef,
    selfVerificationAttempt: fields.selfVerificationAttempt ?? false,
    bindingRelationshipIds: fields.bindingRelationshipIds,
    relationshipEvidenceCount,
    evidenceCompleteness,
    evaluatedAt: evaluatedAtResolved,
    denyReason: fields.denyReason,
  };
}