/**
 * CoreGrid — per-event security contract (V1CAP-044 / J-022 / MISSION-R-81).
 *
 * G-044 states event security per-event in the corpus, but no stream carries
 * or enforces it. Events are the currency of Evidence; an event without
 * provenance/authenticity cannot support Verification (E-017). This module is
 * the policy/enforcement half of the kernel envelope (J-001) at the event
 * plane: the security contract EVERY event carries, and the consumption gate
 * that enforces it before any subscriber receives anything.
 *
 * Law of this module (Constitution §16–§21, AGENTS §35):
 * - AUTHENTICITY: every event carries its issuer identity and the issuance
 *   coordinates minted by the single time authority (composed with
 *   `event-semantics` issuance provenance — never redefined), plus a
 *   tamper-evident digest CHAIN per tenant: each event's security digest
 *   binds the event's content+cause digest (`eventDedupDigest`) and the full
 *   contract to the previous event's digest in the tenant's total order.
 *   Tampering with any payload byte or any contract field breaks the digest;
 *   tampering with history breaks the chain linkage.
 * - AUTHORIZATION: every event declares its visibility scope and the
 *   authority under which it was emitted (the audit answer to UNDER WHICH
 *   POLICY — Constitution §43), digest-protected so it cannot be rewritten
 *   in flight. The consumption gate evaluates (subscriber identity, tenant,
 *   declared scope, event sensitivity, event visibility scope) per
 *   subscriber and delivers ONLY authorized views. Decisions use the
 *   ALLOW | DENY | REDACT subset of the five-valued authorization
 *   vocabulary (`lib/authorization.ts`); ESCALATE / REQUIRE_APPROVAL have no
 *   per-event delivery meaning — a subscription either receives a view, a
 *   minimized view, or nothing.
 * - PRIVACY: every event carries its sensitivity per the context-assembly
 *   vocabulary (J-011) and its subject references. When a subscriber's
 *   declared sensitivity ceiling is below the event's classification, the
 *   gate REDACTS: declared privacy fields and subject refs are WITHHELD
 *   (marked, never silently deleted — the original event is untouched in the
 *   store) and a redaction record is produced, so minimization is auditable
 *   after the fact (Constitution §19). An event that declares no redactable
 *   fields cannot be safely minimized and is DENIED, never downgraded.
 * - PROVENANCE: every event carries the evidence class of its source — the
 *   reality kernel's truth hierarchy (`ObservationKind`, phase-01 §56),
 *   reused, not redefined. A generated event (inferred / predicted /
 *   simulated / reported) can NEVER claim direct-observation visibility:
 *   inference must never launder itself into canonical observation
 *   (Constitution §9 canonical truth).
 * - FAIL-CLOSED (AGENTS §35 "never broadcast unauthorized events"): an event
 *   without its security contract is UNDELIVERABLE — denied to EVERY
 *   subscriber, never delivered with default or assumed security fields.
 *   There is no broadcast primitive in this module; every delivery is
 *   per-subscriber evaluated and every denial is a first-class auditable
 *   record (nothing silently dropped).
 * - PURITY: no I/O, no persistence, no wall-clock sampling. Audit instants
 *   are supplied by the caller. Persistence arrives with the substrate;
 *   this layer is an authored contract, explicitly incomplete there.
 */

import { createHash } from "node:crypto";
import {
  UnauthoritativeTimeError,
  canonicalJson,
  compareEventOrder,
  eventDedupDigest,
  hasIssuanceProvenance,
  type KernelEventRecord,
} from "./event-semantics";
import { isObservationKind, type ObservationKind } from "./reality";
import { isAuthorityTimestampShape, type IssuedTimestamp } from "./time-authority";

/* ─────────────────────────────────────────────────────────────
 * Privacy classification vocabulary (mirrors lib/context-assembly)
 * ────────────────────────────────────────────────────────────*/

/**
 * Event data sensitivity. Mirrors `ContextSensitivity` from
 * `lib/context-assembly.ts` (J-011 vocabulary) value-for-value — the two
 * vocabularies are pinned together mechanically in
 * `tests/unit/kernel-event-security.test.ts` so this contract can never
 * drift from the scope/sensitivity language the platform already speaks.
 */
export type EventSensitivity = "public" | "internal" | "restricted";

export const EVENT_SENSITIVITIES: readonly EventSensitivity[] = [
  "public",
  "internal",
  "restricted",
] as const;

/** Comparison rank order for sensitivity ceilings (public < internal < restricted). */
const SENSITIVITY_RANK: Record<EventSensitivity, 0 | 1 | 2> = {
  public: 0,
  internal: 1,
  restricted: 2,
};

export function isEventSensitivity(value: unknown): value is EventSensitivity {
  return (EVENT_SENSITIVITIES as readonly unknown[]).includes(value);
}

/* ─────────────────────────────────────────────────────────────
 * Visibility scope vocabulary (closed)
 * ────────────────────────────────────────────────────────────*/

/**
 * The audience an event declares itself visible to. `direct-observation` is
 * the most privileged scope and is RESERVED for events whose evidence class
 * is `observed` — a generated event can never claim it (see
 * `EventEvidenceClass`). Subscribers receive an event only when its declared
 * visibility scope is within the subscriber's declared scope set.
 */
export type EventVisibilityScope = "public" | "tenant" | "restricted" | "direct-observation";

export const EVENT_VISIBILITY_SCOPES: readonly EventVisibilityScope[] = [
  "public",
  "tenant",
  "restricted",
  "direct-observation",
] as const;

export function isEventVisibilityScope(value: unknown): value is EventVisibilityScope {
  return (EVENT_VISIBILITY_SCOPES as readonly unknown[]).includes(value);
}

/* ─────────────────────────────────────────────────────────────
 * Evidence class (composition over the reality truth hierarchy)
 * ────────────────────────────────────────────────────────────*/

/**
 * The evidence class of an event's source. Reuses the reality kernel's
 * truth-hierarchy vocabulary (`kernel/reality.ts` `ObservationKind`, never
 * collapsed — phase-01 §56). Only `observed` events may claim
 * `direct-observation` visibility.
 */
export type EventEvidenceClass = ObservationKind;

/** Canonical delivery marker for withheld privacy content (withheld, NOT deleted). */
export const EVENT_FIELD_WITHHELD = "[withheld]";

/* ─────────────────────────────────────────────────────────────
 * The security contract
 * ────────────────────────────────────────────────────────────*/

export interface EventAuthenticity {
  /** Issuer identity of the emitting principal (WHO — Constitution §43). */
  readonly issuerId: string;
  /** Time-authority issuance coordinates backing the event's instant. */
  readonly issuance: IssuedTimestamp;
  /**
   * Tamper-evident digest: SHA-256 over the event's content+cause digest
   * (`eventDedupDigest`) plus every contract section plus the previous
   * tenant-chain digest.
   */
  readonly digest: string;
  /** The previous digest in the tenant's hash chain (null at a chain anchor). */
  readonly previousDigest: string | null;
}

export interface EventAuthorization {
  /** The declared audience of the event (gated per subscriber). */
  readonly visibility: EventVisibilityScope;
  /** The authority under which the event was emitted (audit: UNDER WHICH POLICY). */
  readonly emissionAuthority: string;
}

export interface EventPrivacyClassification {
  /** Sensitivity per the context-assembly vocabulary (J-011). */
  readonly sensitivity: EventSensitivity;
  /** Subject entity references carried by the event (redaction candidates). */
  readonly subjectRefs: readonly string[];
  /**
   * Payload fields that carry sensitive content and may be WITHHELD for a
   * subscriber whose ceiling is below the event's sensitivity. Empty means
   * the event cannot be safely minimized (such an event is denied, never
   * downgraded, for an under-cleared subscriber).
   */
  readonly redactableFields: readonly string[];
}

export interface EventProvenance {
  /** Evidence class of the event's source (truth hierarchy — never collapsed). */
  readonly evidenceClass: EventEvidenceClass;
  /** Provenance source of the event (Constitution §12: where did this come from). */
  readonly source: string;
}

/** The security contract every event must carry to be deliverable at all. */
export interface EventSecurityContract {
  readonly authenticity: EventAuthenticity;
  readonly authorization: EventAuthorization;
  readonly privacy: EventPrivacyClassification;
  readonly provenance: EventProvenance;
}

/** An event bound to its security contract (the emission-side product). */
export interface SecuredEvent {
  readonly event: KernelEventRecord;
  readonly security: EventSecurityContract;
}

/**
 * Consumption-time input: the event plus whatever security contract it
 * actually carries. A candidate whose contract is absent is NOT an error at
 * the gate — it is UNDELIVERABLE, and the gate records the denial for every
 * subscriber (fail-closed, never defaulted).
 */
export interface EventConsumptionCandidate {
  readonly event: KernelEventRecord;
  readonly security?: EventSecurityContract | null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Mirror of the private `eventIdOf` convention in event-semantics. */
function eventIdOf(event: KernelEventRecord): string {
  return event.id?.trim() || `digest:${eventDedupDigest(event).slice(0, 16)}`;
}

/** Mirrors `isEnvelopeRef` (1–bound characters, trimmed non-empty). */
function isEnvelopeRef(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= maxLength;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/* ─────────────────────────────────────────────────────────────
 * Typed rejection (emission-side fail-closed)
 * ────────────────────────────────────────────────────────────*/

/**
 * Emission-side rejection: the event cannot be secured at all. Consumption
 * never throws this — at the gate a bad contract is a DENY record, not an
 * exception, so denial stays observable per subscriber.
 */
export class EventSecurityContractError extends Error {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`event_security: ${field} — ${detail}`);
    this.name = "EventSecurityContractError";
    this.field = field;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Digest chain (tamper-evident, per tenant)
 * ────────────────────────────────────────────────────────────*/

type DigestableContract = Omit<EventAuthenticity, "digest"> & {
  authorization: EventAuthorization;
  privacy: EventPrivacyClassification;
  provenance: EventProvenance;
};

/**
 * The canonical digest input: the event's content+cause identity (composed
 * with the event-semantics dedup digest — content and causation are already
 * canonicalized there) plus the ENTIRE contract (issuer, issuance,
 * authorization, privacy, provenance) plus the previous tenant-chain digest.
 * Every tamper surface — payload bytes, issuer, visibility, sensitivity,
 * subject refs, evidence class — changes this input and breaks the digest.
 */
function securityDigestInput(event: KernelEventRecord, security: DigestableContract): unknown {
  return {
    content_digest: eventDedupDigest(event),
    authenticity: {
      issuer_id: security.issuerId,
      issuance: {
        at: security.issuance.at,
        at_ms: security.issuance.atMs,
        sequence: security.issuance.sequence,
        issuer: security.issuance.issuer,
      },
    },
    authorization: {
      visibility: security.authorization.visibility,
      emission_authority: security.authorization.emissionAuthority,
    },
    privacy: {
      sensitivity: security.privacy.sensitivity,
      subject_refs: security.privacy.subjectRefs,
      redactable_fields: security.privacy.redactableFields,
    },
    provenance: {
      evidence_class: security.provenance.evidenceClass,
      source: security.provenance.source,
    },
    previous_digest: security.previousDigest,
  };
}

export function eventSecurityDigest(
  event: KernelEventRecord,
  security: DigestableContract,
): string {
  return createHash("sha256").update(canonicalJson(securityDigestInput(event, security))).digest("hex");
}

/** Recompute-and-compare authenticity for one secured event. */
export function verifyEventDigest(candidate: EventConsumptionCandidate): boolean {
  const security = candidate.security;
  if (security == null) return false;
  if (!SHA256_HEX.test(security.authenticity.digest)) return false;
  const expected = eventSecurityDigest(candidate.event, {
    ...security.authenticity,
    authorization: security.authorization,
    privacy: security.privacy,
    provenance: security.provenance,
  });
  return expected === security.authenticity.digest;
}

/* ─────────────────────────────────────────────────────────────
 * Emission-side enforcement (secureEvent)
 * ────────────────────────────────────────────────────────────*/

export interface EventSecurityInput {
  readonly event: KernelEventRecord;
  readonly issuerId: string;
  readonly visibility: EventVisibilityScope;
  readonly emissionAuthority: string;
  readonly sensitivity: EventSensitivity;
  readonly subjectRefs?: readonly string[];
  readonly redactableFields?: readonly string[];
  readonly evidenceClass: EventEvidenceClass;
  readonly source: string;
  /** Previous digest in the tenant's chain; null/omitted at a chain anchor. */
  readonly previousDigest?: string | null;
}

/**
 * Bind the security contract onto an event at EMISSION. Fail-closed:
 * rejects an event without time-authority issuance provenance (composed
 * with `event-semantics`), a generated event claiming direct-observation
 * visibility, any vocabulary violation, or a malformed field — with a typed
 * `EventSecurityContractError` naming the offending field.
 */
export function secureEvent(input: EventSecurityInput): SecuredEvent {
  const { event } = input;
  const instant = event.occurred_at ?? event.recorded_at;
  if (!hasIssuanceProvenance(event) || instant == null || event.sequence == null || event.issuer == null) {
    throw new UnauthoritativeTimeError(eventIdOf(event));
  }
  const issuance: IssuedTimestamp = {
    at: instant,
    atMs: Date.parse(instant),
    sequence: event.sequence,
    issuer: event.issuer,
  };
  if (!isAuthorityTimestampShape(issuance)) {
    throw new EventSecurityContractError(
      "authenticity.issuance",
      "event issuance coordinates do not form a valid authority timestamp",
    );
  }
  if (!isEnvelopeRef(input.issuerId, 200)) {
    throw new EventSecurityContractError("authenticity.issuerId", "must be 1–200 characters");
  }
  if (!isEventVisibilityScope(input.visibility)) {
    throw new EventSecurityContractError(
      "authorization.visibility",
      `"${String(input.visibility)}" is not a registered visibility scope`,
    );
  }
  if (!isEnvelopeRef(input.emissionAuthority, 200)) {
    throw new EventSecurityContractError(
      "authorization.emissionAuthority",
      "must be 1–200 characters",
    );
  }
  if (!isEventSensitivity(input.sensitivity)) {
    throw new EventSecurityContractError(
      "privacy.sensitivity",
      `"${String(input.sensitivity)}" is not a registered sensitivity`,
    );
  }
  const subjectRefs = input.subjectRefs ?? [];
  if (!isStringArray(subjectRefs) || subjectRefs.some((ref) => !isEnvelopeRef(ref, 200))) {
    throw new EventSecurityContractError(
      "privacy.subjectRefs",
      "must be an array of 1–200 character references when present",
    );
  }
  const redactableFields = input.redactableFields ?? [];
  if (
    !isStringArray(redactableFields) ||
    redactableFields.some((field) => !isEnvelopeRef(field, 200))
  ) {
    throw new EventSecurityContractError(
      "privacy.redactableFields",
      "must be an array of 1–200 character payload field names when present",
    );
  }
  if (!isObservationKind(input.evidenceClass)) {
    throw new EventSecurityContractError(
      "provenance.evidenceClass",
      `"${String(input.evidenceClass)}" is not a registered evidence class`,
    );
  }
  if (!isEnvelopeRef(input.source, 200)) {
    throw new EventSecurityContractError("provenance.source", "must be 1–200 characters");
  }
  // PROVENANCE LAW: a generated event can never claim direct-observation
  // visibility. Only an event whose evidence class is `observed` may claim
  // the observation scope — inference never launders into canonical truth.
  if (input.visibility === "direct-observation" && input.evidenceClass !== "observed") {
    throw new EventSecurityContractError(
      "authorization.visibility",
      `a "${input.evidenceClass}" event can never claim direct-observation visibility`,
    );
  }
  const previousDigest = input.previousDigest ?? null;
  if (previousDigest !== null && !SHA256_HEX.test(previousDigest)) {
    throw new EventSecurityContractError(
      "authenticity.previousDigest",
      "must be a SHA-256 hex digest when present",
    );
  }
  const authenticityBase = {
    issuerId: input.issuerId.trim(),
    issuance,
    previousDigest,
  };
  const contract: EventSecurityContract = {
    authenticity: {
      ...authenticityBase,
      digest: eventSecurityDigest(event, {
        ...authenticityBase,
        authorization: { visibility: input.visibility, emissionAuthority: input.emissionAuthority.trim() },
        privacy: {
          sensitivity: input.sensitivity,
          subjectRefs: Object.freeze([...subjectRefs]),
          redactableFields: Object.freeze([...redactableFields]),
        },
        provenance: { evidenceClass: input.evidenceClass, source: input.source.trim() },
      }),
    },
    authorization: {
      visibility: input.visibility,
      emissionAuthority: input.emissionAuthority.trim(),
    },
    privacy: {
      sensitivity: input.sensitivity,
      subjectRefs: Object.freeze([...subjectRefs]),
      redactableFields: Object.freeze([...redactableFields]),
    },
    provenance: { evidenceClass: input.evidenceClass, source: input.source.trim() },
  };
  return Object.freeze({ event, security: Object.freeze(contract) });
}

/* ─────────────────────────────────────────────────────────────
 * Contract evaluation (consumption-side fail-closed checks)
 * ────────────────────────────────────────────────────────────*/

export type EventDenialReason =
  | "missing_security_contract"
  | "invalid_security_contract"
  | "unverifiable_issuance"
  | "tampered_digest"
  | "generated_event_claims_observation"
  | "tenant_mismatch"
  | "visibility_not_authorized"
  | "sensitivity_not_authorized";

export interface ContractEvaluation {
  readonly valid: boolean;
  readonly reason: EventDenialReason | null;
  readonly detail: string;
}

/**
 * Evaluate everything that is a property of the EVENT alone (independent of
 * any subscriber): contract presence, contract shape, vocabulary, the
 * direct-observation provenance law, and authenticity of the issuance
 * coordinates against the event itself. Digest recomputation is separate
 * (`verifyEventDigest`) so a tamper denial stays distinguishable from a
 * malformed-contract denial.
 */
export function evaluateEventSecurity(candidate: EventConsumptionCandidate): ContractEvaluation {
  const security = candidate.security;
  if (security == null || typeof security !== "object") {
    return {
      valid: false,
      reason: "missing_security_contract",
      detail:
        `event "${eventIdOf(candidate.event)}" carries no security contract — ` +
        "an event without its contract is undeliverable, never broadcast with defaults",
    };
  }
  const a = security.authenticity;
  const z = security.authorization;
  const p = security.privacy;
  const v = security.provenance;
  if (a == null || z == null || p == null || v == null) {
    return {
      valid: false,
      reason: "invalid_security_contract",
      detail: "security contract is missing one or more of authenticity/authorization/privacy/provenance",
    };
  }
  if (!isEnvelopeRef(a.issuerId, 200)) {
    return { valid: false, reason: "invalid_security_contract", detail: "authenticity.issuerId must be 1–200 characters" };
  }
  if (!isAuthorityTimestampShape(a.issuance)) {
    return {
      valid: false,
      reason: "invalid_security_contract",
      detail: "authenticity.issuance is not a valid authority timestamp (raw time is never accepted)",
    };
  }
  if (!SHA256_HEX.test(a.digest)) {
    return { valid: false, reason: "invalid_security_contract", detail: "authenticity.digest must be a SHA-256 hex digest" };
  }
  if (a.previousDigest !== null && !SHA256_HEX.test(a.previousDigest)) {
    return { valid: false, reason: "invalid_security_contract", detail: "authenticity.previousDigest must be null or a SHA-256 hex digest" };
  }
  if (!isEventVisibilityScope(z.visibility)) {
    return {
      valid: false,
      reason: "invalid_security_contract",
      detail: `authorization.visibility "${String(z.visibility)}" is not a registered visibility scope`,
    };
  }
  if (!isEnvelopeRef(z.emissionAuthority, 200)) {
    return {
      valid: false,
      reason: "invalid_security_contract",
      detail: "authorization.emissionAuthority must be 1–200 characters",
    };
  }
  if (!isEventSensitivity(p.sensitivity)) {
    return {
      valid: false,
      reason: "invalid_security_contract",
      detail: `privacy.sensitivity "${String(p.sensitivity)}" is not a registered sensitivity`,
    };
  }
  if (!isStringArray(p.subjectRefs) || p.subjectRefs.some((ref) => !isEnvelopeRef(ref, 200))) {
    return { valid: false, reason: "invalid_security_contract", detail: "privacy.subjectRefs must be an array of 1–200 character references" };
  }
  if (!isStringArray(p.redactableFields) || p.redactableFields.some((field) => !isEnvelopeRef(field, 200))) {
    return { valid: false, reason: "invalid_security_contract", detail: "privacy.redactableFields must be an array of 1–200 character field names" };
  }
  if (!isObservationKind(v.evidenceClass)) {
    return {
      valid: false,
      reason: "invalid_security_contract",
      detail: `provenance.evidenceClass "${String(v.evidenceClass)}" is not a registered evidence class`,
    };
  }
  if (!isEnvelopeRef(v.source, 200)) {
    return { valid: false, reason: "invalid_security_contract", detail: "provenance.source must be 1–200 characters" };
  }
  if (z.visibility === "direct-observation" && v.evidenceClass !== "observed") {
    return {
      valid: false,
      reason: "generated_event_claims_observation",
      detail:
        `a "${v.evidenceClass}" event claims direct-observation visibility — ` +
        "a generated event can never claim direct observation (canonical truth law)",
    };
  }
  const instant = candidate.event.occurred_at ?? candidate.event.recorded_at;
  let authentic = false;
  try {
    authentic =
      hasIssuanceProvenance(candidate.event) &&
      instant != null &&
      a.issuance.at === instant &&
      a.issuance.sequence === candidate.event.sequence &&
      a.issuance.issuer === candidate.event.issuer;
  } catch {
    authentic = false;
  }
  if (!authentic) {
    return {
      valid: false,
      reason: "unverifiable_issuance",
      detail:
        `event "${eventIdOf(candidate.event)}" issuance coordinates do not verify against the ` +
        "time-authority provenance on the event itself",
    };
  }
  return { valid: true, reason: null, detail: "" };
}

/* ─────────────────────────────────────────────────────────────
 * Tenant digest-chain verification
 * ────────────────────────────────────────────────────────────*/

export interface EventChainVerification {
  readonly tenantId: string | null;
  /** Number of chain links verified (events walked). */
  readonly length: number;
  readonly valid: boolean;
  readonly brokenAtEventId: string | null;
  readonly reason: EventDenialReason | null;
  readonly detail: string;
}

export interface EventChainOptions {
  /** Scope the walk to one tenant (defense-in-depth, like `orderEvents`). */
  readonly tenantId?: string;
}

/**
 * Walk the tenant's digest chain in the time-authority total order
 * (composed with `compareEventOrder` — never arrival order): recompute every
 * event digest and check that each event links to its predecessor's digest.
 * Detects content tampering (digest mismatch) AND history tampering
 * (linkage break). The first event of a scope may carry a non-null
 * previousDigest (an anchored head); every subsequent event must link.
 */
export function verifyEventDigestChain(
  candidates: readonly EventConsumptionCandidate[],
  options: EventChainOptions = {},
): EventChainVerification {
  const scoped = candidates.filter(
    (candidate) =>
      options.tenantId == null || (candidate.event.tenant_id ?? null) === options.tenantId,
  );
  const ordered = scoped.slice().sort((a, b) => compareEventOrder(a.event, b.event));
  let previous: SecuredEvent | null = null;
  for (const candidate of ordered) {
    const security = candidate.security;
    if (security == null) {
      return {
        tenantId: options.tenantId ?? null,
        length: ordered.length,
        valid: false,
        brokenAtEventId: eventIdOf(candidate.event),
        reason: "missing_security_contract",
        detail: `event "${eventIdOf(candidate.event)}" carries no security contract — the chain cannot be verified through it`,
      };
    }
    if (!verifyEventDigest(candidate)) {
      return {
        tenantId: options.tenantId ?? null,
        length: ordered.length,
        valid: false,
        brokenAtEventId: eventIdOf(candidate.event),
        reason: "tampered_digest",
        detail: `event "${eventIdOf(candidate.event)}" digest does not match its content and contract`,
      };
    }
    if (previous !== null && security.authenticity.previousDigest !== previous.security.authenticity.digest) {
      return {
        tenantId: options.tenantId ?? null,
        length: ordered.length,
        valid: false,
        brokenAtEventId: eventIdOf(candidate.event),
        reason: "tampered_digest",
        detail:
          `event "${eventIdOf(candidate.event)}" does not link to the digest of its predecessor ` +
          `"${eventIdOf(previous.event)}" in the tenant chain — history was rewritten`,
      };
    }
    previous = { event: candidate.event, security };
  }
  return {
    tenantId: options.tenantId ?? null,
    length: ordered.length,
    valid: true,
    brokenAtEventId: null,
    reason: null,
    detail: ordered.length === 0 ? "no events in scope" : `${ordered.length} event(s) verified in chain order`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * The consumption gate (per-subscriber delivery)
 * ────────────────────────────────────────────────────────────*/

/**
 * A subscriber of the event stream. Every field is resolved SERVER-SIDE
 * (Constitution §26: never trust client tenant IDs, roles or scope
 * declarations); the gate treats the record as read-only input and never
 * extends it.
 */
export interface EventSubscriber {
  /** Subscriber identity (audit: WHO received or was denied). */
  readonly subscriberId: string;
  readonly tenantId: string;
  /** Declared visibility scopes this subscriber is authorized to receive. */
  readonly visibilityScopes: readonly EventVisibilityScope[];
  /** Declared sensitivity ceiling (J-011 data-scope law). */
  readonly maxSensitivity: EventSensitivity;
}

/** ALLOW | DENY | REDACT — the delivery subset of the five-valued decisions. */
export type EventDeliveryDecision = "ALLOW" | "DENY" | "REDACT";

export interface EventDenialRecord {
  readonly eventId: string;
  readonly subscriberId: string;
  readonly tenantId: string | null;
  readonly reason: EventDenialReason;
  readonly detail: string;
  /** Audit instant supplied by the caller — never wall-clock sampled. */
  readonly recordedAt: string;
}

export interface EventRedactionRecord {
  readonly eventId: string;
  readonly subscriberId: string;
  readonly reason: "sensitivity_above_ceiling";
  /** Payload fields withheld from the delivered view. */
  readonly withheldFields: readonly string[];
  /** Subject references withheld from the delivered contract view. */
  readonly withheldSubjectRefs: readonly string[];
  readonly detail: string;
  readonly recordedAt: string;
}

/**
 * The per-subscriber delivery result. DENY delivers NOTHING (`event` and
 * `security` are null); REDACT delivers the minimized view plus its
 * redaction records; ALLOW delivers the full original.
 */
export interface EventDelivery {
  readonly decision: EventDeliveryDecision;
  readonly event: KernelEventRecord | null;
  readonly security: EventSecurityContract | null;
  readonly denial: EventDenialRecord | null;
  readonly redactions: readonly EventRedactionRecord[];
}

export interface EventDeliveryOptions {
  /** Audit instant (ISO-8601) — supplied, never sampled (purity law). */
  readonly now: string;
  /**
   * Recompute the tamper-evident digest before delivery. Default TRUE —
   * the production posture; a tampered event is undeliverable, not a
   * silent pass-through.
   */
  readonly verifyDigest?: boolean;
}

function assertSubscriber(subscriber: EventSubscriber): void {
  if (!isEnvelopeRef(subscriber.subscriberId, 200)) {
    throw new Error("event_security: subscriber.subscriberId must be 1–200 characters");
  }
  if (!isEnvelopeRef(subscriber.tenantId, 128)) {
    throw new Error("event_security: subscriber.tenantId must be 1–128 characters");
  }
  if (
    !Array.isArray(subscriber.visibilityScopes) ||
    subscriber.visibilityScopes.some((scope) => !isEventVisibilityScope(scope))
  ) {
    throw new Error("event_security: subscriber.visibilityScopes must all be registered visibility scopes");
  }
  if (!isEventSensitivity(subscriber.maxSensitivity)) {
    throw new Error(`event_security: subscriber.maxSensitivity "${String(subscriber.maxSensitivity)}" is not a registered sensitivity`);
  }
}

function denialRecord(
  event: KernelEventRecord,
  subscriber: EventSubscriber,
  reason: EventDenialReason,
  detail: string,
  recordedAt: string,
): EventDenialRecord {
  return Object.freeze({
    eventId: eventIdOf(event),
    subscriberId: subscriber.subscriberId,
    tenantId: subscriber.tenantId,
    reason,
    detail,
    recordedAt,
  });
}

/** The delivered redacted view: privacy fields marked withheld, originals untouched. */
function redactViews(
  candidate: EventConsumptionCandidate,
  subscriber: EventSubscriber,
  recordedAt: string,
): { event: KernelEventRecord; security: EventSecurityContract; record: EventRedactionRecord } {
  const security = candidate.security as EventSecurityContract;
  const payload = candidate.event.payload ?? {};
  const withheldFields = security.privacy.redactableFields.filter((field) => field in payload);
  const redactedPayload: Record<string, unknown> = { ...payload };
  for (const field of withheldFields) {
    redactedPayload[field] = EVENT_FIELD_WITHHELD;
  }
  const redactedEvent: KernelEventRecord = { ...candidate.event, payload: redactedPayload };
  const redactedSecurity: EventSecurityContract = {
    ...security,
    privacy: {
      ...security.privacy,
      subjectRefs: security.privacy.subjectRefs.map(() => EVENT_FIELD_WITHHELD),
    },
  };
  const record: EventRedactionRecord = Object.freeze({
    eventId: eventIdOf(candidate.event),
    subscriberId: subscriber.subscriberId,
    reason: "sensitivity_above_ceiling",
    withheldFields: Object.freeze([...withheldFields]),
    withheldSubjectRefs: Object.freeze([...security.privacy.subjectRefs]),
    detail:
      `event "${eventIdOf(candidate.event)}" sensitivity "${security.privacy.sensitivity}" exceeds ` +
      `subscriber ceiling "${subscriber.maxSensitivity}": ${withheldFields.length} payload field(s) and ` +
      `${security.privacy.subjectRefs.length} subject ref(s) withheld (withheld, not deleted — the original event is untouched)`,
    recordedAt,
  });
  return { event: redactedEvent, security: redactedSecurity, record };
}

/**
 * THE CONSUMPTION GATE. Before any subscriber receives an event, evaluate
 * (subscriber identity, tenant, declared scope, event sensitivity, event
 * visibility scope) and deliver only the authorized view. Fail-closed: an
 * event without its security contract (or with a tampered digest) is denied
 * to EVERY subscriber — an event without its contract is undeliverable,
 * never broadcast with defaults (AGENTS §35).
 */
export function deliverEvent(
  candidate: EventConsumptionCandidate,
  subscriber: EventSubscriber,
  options: EventDeliveryOptions,
): EventDelivery {
  assertSubscriber(subscriber);
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(nowMs)) {
    throw new Error("event_security: delivery audit instant must be a valid ISO-8601 timestamp");
  }
  const recordedAt = options.now;

  // 1. Contract presence (fail-closed — the first and unconditional gate).
  const evaluation = evaluateEventSecurity(candidate);
  if (!evaluation.valid) {
    return Object.freeze({
      decision: "DENY",
      event: null,
      security: null,
      denial: denialRecord(candidate.event, subscriber, evaluation.reason as EventDenialReason, evaluation.detail, recordedAt),
      redactions: Object.freeze([]),
    });
  }

  // 2. Authenticity: tamper-evident digest recompute.
  if (options.verifyDigest !== false && !verifyEventDigest(candidate)) {
    return Object.freeze({
      decision: "DENY",
      event: null,
      security: null,
      denial: denialRecord(
        candidate.event,
        subscriber,
        "tampered_digest",
        `event "${eventIdOf(candidate.event)}" digest does not match its content and contract — tamper-evident chain rejects delivery`,
        recordedAt,
      ),
      redactions: Object.freeze([]),
    });
  }

  const security = candidate.security as EventSecurityContract;

  // 3. Tenant boundary (Constitution §13): a tenant-less event is anonymous
  // at the tenancy boundary and is undeliverable to everyone.
  const eventTenant = candidate.event.tenant_id ?? null;
  if (eventTenant !== subscriber.tenantId) {
    return Object.freeze({
      decision: "DENY",
      event: null,
      security: null,
      denial: denialRecord(
        candidate.event,
        subscriber,
        "tenant_mismatch",
        `event tenant "${eventTenant ?? "null"}" does not match subscriber tenant "${subscriber.tenantId}"`,
        recordedAt,
      ),
      redactions: Object.freeze([]),
    });
  }

  // 4. Declared visibility scope.
  if (!subscriber.visibilityScopes.includes(security.authorization.visibility)) {
    return Object.freeze({
      decision: "DENY",
      event: null,
      security: null,
      denial: denialRecord(
        candidate.event,
        subscriber,
        "visibility_not_authorized",
        `event visibility "${security.authorization.visibility}" is not within subscriber "${subscriber.subscriberId}" declared scopes [${subscriber.visibilityScopes.join(", ")}]`,
        recordedAt,
      ),
      redactions: Object.freeze([]),
    });
  }

  // 5. Privacy: sensitivity ceiling. Above the ceiling, REDACT when the
  // contract declares redactable fields (withheld, not deleted); DENY when
  // the event cannot be safely minimized — never deliver a downgraded view
  // that pretends to be complete.
  if (SENSITIVITY_RANK[security.privacy.sensitivity] > SENSITIVITY_RANK[subscriber.maxSensitivity]) {
    if (security.privacy.redactableFields.length === 0) {
      return Object.freeze({
        decision: "DENY",
        event: null,
        security: null,
        denial: denialRecord(
          candidate.event,
          subscriber,
          "sensitivity_not_authorized",
          `event sensitivity "${security.privacy.sensitivity}" exceeds subscriber ceiling "${subscriber.maxSensitivity}" and the contract declares no redactable fields — the event cannot be safely minimized for this subscriber`,
          recordedAt,
        ),
        redactions: Object.freeze([]),
      });
    }
    const redacted = redactViews(candidate, subscriber, recordedAt);
    return Object.freeze({
      decision: "REDACT",
      event: redacted.event,
      security: redacted.security,
      denial: null,
      redactions: Object.freeze([redacted.record]),
    });
  }

  // 6. Authorized: deliver the full original.
  return Object.freeze({
    decision: "ALLOW",
    event: candidate.event,
    security,
    denial: null,
    redactions: Object.freeze([]),
  });
}

/**
 * Per-subscriber fanout of one event. There is NO broadcast: each subscriber
 * gets its own gated delivery, and every unauthorized subscriber yields a
 * DENY record rather than silence — realtime security is observable
 * (AGENTS §35, Constitution §29).
 */
export function deliverEventToSubscribers(
  candidate: EventConsumptionCandidate,
  subscribers: readonly EventSubscriber[],
  options: EventDeliveryOptions,
): readonly EventDelivery[] {
  return Object.freeze(subscribers.map((subscriber) => deliverEvent(candidate, subscriber, options)));
}