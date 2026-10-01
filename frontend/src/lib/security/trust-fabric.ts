/**
 * CoreGrid — Trust-Fabric wiring into security decisions (J-008 / V1CAP-022 /
 * COND-007), implementing ADR-002 Option A: the phase-08 security engine
 * consumes phase-09 trust assertions, with three binding constraints:
 *
 * 1. Fail-closed: trust evidence that cannot be resolved, is stale (past its
 *    validity window), or carries no elevation means NO trust elevation — the
 *    engine must treat unknown trust as zero-trust, never
 *    benefit-of-the-doubt (AGENTS §17 deny-by-default).
 * 2. Decision citation: every decision record cites the trust-evidence set it
 *    was derived from (assertion IDs + state-machine version) so the decision
 *    is reconstructible (AGENTS §16) and provenance-carrying (AGENTS §12).
 * 3. Revocation-flips-decision: a revoked assertion flips any granting
 *    decision that consumed it (AGENTS §31: revoked access fails).
 *
 * Evidence -> Decision grounding (completeness loop): assertions are DERIVED
 * from recorded phase-09 trust evidence (`TrustEvidence`), never asserted —
 * every trust vector dimension must cite an evidence record in the derived
 * set, and the assertion's validity window is bounded by that evidence's
 * freshness. Stale evidence cannot produce an assertion at all.
 *
 * Integration seam (documented, no forced refactor): the phase-08 engine
 * adopts this contract at one point — evaluate the pre-trust decision, call
 * `consumeTrustEvidence`, then record the returned citation on the decision
 * via `createSecurityDecision`'s optional `trustEvidence` field
 * (`frontend/src/lib/security-core.ts`). The function is pure: no I/O, no
 * clocks beyond the caller-supplied `now`, so an operator rejection of ADR-002
 * can be reversed by removing the single call site without scrapping this
 * module.
 */

import type { TenantId } from "../tenant-core";
import {
  TRUST_SCORE_FACTORS,
  type TrustScoreFactor,
} from "../trust-core";
import {
  isTrustEvidenceFresh,
  type TrustAssertionType,
  type TrustEvidence,
} from "../trust-assertions";
import {
  isGrantingDecision,
  type SecurityDecisionState,
  type TrustEvidenceCitation,
  type TrustEvidenceOutcome,
} from "../security-core";

/**
 * Version of the trust-fabric state machine semantics under which assertions
 * are derived and consumed. Recorded on every decision citation (ADR-002
 * constraint 2: decision records cite the trust-evidence set).
 */
export const TRUST_FABRIC_STATE_MACHINE_VERSION = "trust-fabric-v1";

/* ─────────────────────────────────────────────────────────────
 * Trust vector — bounded dimensions per what the codebase models
 * (phase 09 trust scoring, Section K: TRUST_SCORE_FACTORS)
 * ────────────────────────────────────────────────────────────*/

/**
 * One dimension of a subject's trust vector. The dimension space is bounded
 * by the phase-09 `TrustScoreFactor` union (identity_assurance,
 * credential_strength, device_assurance, software_integrity,
 * workload_integrity, historical_behavior, attestation, provenance,
 * certificate_validity, security_posture, recent_incidents) — no unbounded
 * or free-form trust dimensions exist in this contract.
 */
export interface TrustVectorDimension {
  factor: TrustScoreFactor;
  /** Evidence-weighted dimension strength, 0-100 (phase 09 K scale). */
  score: number;
  /** Provenance: the recorded evidence record supporting this dimension (N.3). */
  evidenceRef: string;
}

export type TrustVector = readonly TrustVectorDimension[];

export type TrustLevel = "high" | "medium" | "low" | "none";

/* ─────────────────────────────────────────────────────────────
 * Trust assertion derived from recorded evidence
 * ────────────────────────────────────────────────────────────*/

/**
 * A trust assertion derived from recorded evidence. Carries: subject
 * identity, bounded trust vector, validity window, and provenance refs to
 * the evidence records it was derived from. `validUntil` is always bounded —
 * an assertion with an unbounded validity window is refused at derivation
 * time (fail-closed: trust must expire where appropriate, phase 09 BR.6).
 */
export interface TrustAssertionView {
  id: string;
  issuer: string;
  subjectId: string;
  type: TrustAssertionType;
  tenantId: TenantId | null;
  scope: string | null;
  vector: TrustVector;
  trustLevel: TrustLevel;
  validFrom: string;
  validUntil: string;
  /** Provenance refs to the recorded evidence records (phase 09 M / N.3). */
  evidenceRefs: readonly string[];
  revokedAt: string | null;
  derivedAt: string;
  stateMachineVersion: string;
}

export interface DeriveTrustAssertionInput {
  id: string;
  issuer: string;
  subjectId: string;
  type: TrustAssertionType;
  tenantId?: TenantId | null;
  scope?: string | null;
  /** Recorded evidence records the assertion is derived from (never absent). */
  evidence: readonly TrustEvidence[];
  /** Evidence-weighted trust vector; every dimension must cite `evidence`. */
  vector: TrustVector;
  trustLevel: TrustLevel;
  /** Optional explicit cap; the window is intersected with evidence freshness. */
  expiresAt?: string | null;
  now: string;
}

export type DeriveTrustAssertionResult =
  | { ok: true; assertion: TrustAssertionView }
  | { ok: false; error: string };

function isFiniteInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Derive a trust assertion from recorded evidence (Evidence -> Decision
 * grounding). Fails closed when: evidence is absent, any evidence record is
 * stale at `now` (past its freshness bound), the resulting validity window is
 * unbounded, the trust vector is empty, a vector dimension falls outside the
 * bounded factor space or score range, or a dimension cites evidence that is
 * not part of the derivation set.
 */
export function deriveTrustAssertion(input: DeriveTrustAssertionInput): DeriveTrustAssertionResult {
  const nowMs = Date.parse(input.now);
  if (Number.isNaN(nowMs)) {
    return { ok: false, error: "Derivation time is not a valid timestamp" };
  }
  if (input.id.trim() === "") {
    return { ok: false, error: "Assertion id is required" };
  }
  if (input.issuer.trim() === "") {
    return { ok: false, error: "Assertion issuer is required (phase 09 L.2)" };
  }
  if (input.subjectId.trim() === "") {
    return { ok: false, error: "Assertion subject is required (phase 09 L.2)" };
  }
  if (input.evidence.length === 0) {
    return {
      ok: false,
      error: "Assertions are derived from evidence; none was provided (phase 09 BR.2)",
    };
  }

  const evidenceIds = new Set(input.evidence.map((e) => e.id));
  for (const record of input.evidence) {
    if (!isTrustEvidenceFresh(record, input.now)) {
      return {
        ok: false,
        error: `Evidence ${record.id} is stale at derivation time; no assertion may be derived (fail-closed)`,
      };
    }
  }

  if (input.vector.length === 0) {
    return {
      ok: false,
      error: "Trust vector requires at least one bounded dimension",
    };
  }
  for (const dimension of input.vector) {
    if (!TRUST_SCORE_FACTORS.includes(dimension.factor)) {
      return {
        ok: false,
        error: `Trust vector dimension '${dimension.factor}' is outside the bounded factor space (phase 09 K)`,
      };
    }
    if (!isFiniteInRange(dimension.score, 0, 100)) {
      return {
        ok: false,
        error: `Trust vector dimension '${dimension.factor}' score must be 0-100`,
      };
    }
    if (dimension.evidenceRef.trim() === "" || !evidenceIds.has(dimension.evidenceRef)) {
      return {
        ok: false,
        error: `Trust vector dimension '${dimension.factor}' must cite evidence in the derivation set (N.3)`,
      };
    }
  }

  const capturedMs = input.evidence.map((e) => Date.parse(e.capturedAt));
  if (capturedMs.some((ms) => Number.isNaN(ms))) {
    return { ok: false, error: "Evidence record carries an invalid capture timestamp" };
  }
  const validFromMs = Math.max(...capturedMs);

  // The validity window must be bounded (fail-closed): the earliest evidence
  // freshness bound, optionally intersected with an explicit expiry cap.
  const bounds: number[] = [];
  for (const record of input.evidence) {
    if (record.freshnessMs !== null) {
      bounds.push(Date.parse(record.capturedAt) + record.freshnessMs);
    }
  }
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    const explicitMs = Date.parse(input.expiresAt);
    if (Number.isNaN(explicitMs)) {
      return { ok: false, error: "Explicit expiry is not a valid timestamp" };
    }
    bounds.push(explicitMs);
  }
  if (bounds.length === 0) {
    return {
      ok: false,
      error:
        "Validity window is unbounded: evidence carries no freshness bound and no explicit expiry was given (fail-closed, BR.6)",
    };
  }
  const validUntilMs = Math.min(...bounds);
  if (validUntilMs <= validFromMs) {
    return {
      ok: false,
      error: "Derived validity window is empty: evidence is stale or the expiry precedes capture",
    };
  }

  return {
    ok: true,
    assertion: {
      id: input.id,
      issuer: input.issuer,
      subjectId: input.subjectId,
      type: input.type,
      tenantId: input.tenantId ?? null,
      scope: input.scope ?? null,
      vector: input.vector,
      trustLevel: input.trustLevel,
      validFrom: new Date(validFromMs).toISOString(),
      validUntil: new Date(validUntilMs).toISOString(),
      evidenceRefs: input.evidence.map((e) => e.id),
      revokedAt: null,
      derivedAt: input.now,
      stateMachineVersion: TRUST_FABRIC_STATE_MACHINE_VERSION,
    },
  };
}

/** Revoke an assertion. Revocation must propagate to dependent decisions (BR.11). */
export function revokeTrustAssertionView(
  assertion: TrustAssertionView,
  now: string,
): TrustAssertionView {
  return { ...assertion, revokedAt: now };
}

/**
 * Why an assertion is not usable right now, or null when it is usable:
 * unrevoked, within its validity window (stale past validity fails closed),
 * and carrying parseable timestamps. Unparseable dates fail closed.
 */
export function trustAssertionUnusableReason(
  assertion: TrustAssertionView,
  now: string,
): string | null {
  if (assertion.revokedAt !== null) {
    return `Assertion ${assertion.id} has been revoked (phase 09 AA)`;
  }
  const nowMs = Date.parse(now);
  const fromMs = Date.parse(assertion.validFrom);
  const untilMs = Date.parse(assertion.validUntil);
  if (Number.isNaN(nowMs) || Number.isNaN(fromMs) || Number.isNaN(untilMs)) {
    return `Assertion ${assertion.id} carries an unparseable validity window (fail-closed)`;
  }
  if (nowMs < fromMs) {
    return `Assertion ${assertion.id} is not yet valid`;
  }
  if (nowMs >= untilMs) {
    return `Assertion ${assertion.id} is stale: validity window has passed (fail-closed)`;
  }
  return null;
}

export function isTrustAssertionUsable(assertion: TrustAssertionView, now: string): boolean {
  return trustAssertionUnusableReason(assertion, now) === null;
}

/* ─────────────────────────────────────────────────────────────
 * Consumption seam — the pure contract the phase-08 engine adopts
 * ────────────────────────────────────────────────────────────*/

export interface ConsumeTrustEvidenceInput {
  /** The pre-trust decision produced by the security/authorization engine. */
  decision: SecurityDecisionState;
  /**
   * The resolved trust-evidence set for the subject. `null` means trust
   * evidence could not be resolved at all (unavailable) — the fail-closed
   * condition. An empty array means the subject holds no assertions
   * (unknown trust = zero-trust).
   */
  assertions: readonly TrustAssertionView[] | null;
  /** Decision time (RFC 3339); supplied by the caller for purity. */
  now: string;
}

export interface TrustConsumptionResult {
  /** The decision after trust consumption (possibly flipped). */
  decision: SecurityDecisionState;
  /** True when the input decision was flipped by trust evidence. */
  flipped: boolean;
  outcome: TrustEvidenceOutcome;
  reason: string;
  /** The decision-record citation (assertion IDs + state-machine version). */
  citation: TrustEvidenceCitation;
}

function buildCitation(
  assertions: readonly TrustAssertionView[] | null,
  outcome: TrustEvidenceOutcome,
  now: string,
): TrustEvidenceCitation {
  return {
    assertionIds: (assertions ?? []).map((a) => a.id),
    stateMachineVersion: TRUST_FABRIC_STATE_MACHINE_VERSION,
    evaluatedAt: now,
    outcome,
  };
}

/**
 * Consume the trust-evidence set for a security decision (ADR-002 Option A).
 *
 * Rules, in order:
 * 1. Only granting decisions can be flipped; non-granting decisions are
 *    recorded as `not_applicable` and pass through unchanged (a decision
 *    that does not grant cannot benefit from trust).
 * 2. Unavailable evidence (`assertions === null`): fail-closed — a granting
 *    decision flips to DENY; unknown trust is never benefit-of-the-doubt.
 * 3. Revocation: any revoked assertion in the consumed set flips a granting
 *    decision to DENY (revocation-flips-decision), even when other usable
 *    assertions are present — a decision that consumed revoked evidence is
 *    not evidence-derived.
 * 4. Staleness: any assertion past its validity window (or not yet valid, or
 *    carrying an unparseable window) fails the set closed — a granting
 *    decision flips to DENY.
 * 5. Elevation: the set must contain at least one usable assertion whose
 *    trust level is not "none"; trust level "none" is zero-trust and never
 *    elevates.
 * 6. Otherwise the decision is backed and stands, with the citation
 *    recording exactly the consumed assertion IDs.
 */
export function consumeTrustEvidence(input: ConsumeTrustEvidenceInput): TrustConsumptionResult {
  const { decision, assertions, now } = input;

  if (!isGrantingDecision(decision)) {
    return {
      decision,
      flipped: false,
      outcome: "not_applicable",
      reason: "Non-granting decision does not consume trust elevation",
      citation: buildCitation(assertions, "not_applicable", now),
    };
  }

  const denyWith = (
    outcome: TrustEvidenceOutcome,
    reason: string,
  ): TrustConsumptionResult => ({
    decision: "DENY",
    flipped: true,
    outcome,
    reason,
    citation: buildCitation(assertions, outcome, now),
  });

  if (assertions === null) {
    return denyWith(
      "unavailable",
      "Trust evidence could not be resolved: fail-closed, no trust elevation (ADR-002 constraint 1)",
    );
  }

  for (const assertion of assertions) {
    if (assertion.revokedAt !== null) {
      return denyWith(
        "revoked",
        `Trust assertion ${assertion.id} has been revoked; decision flipped (ADR-002 constraint 3)`,
      );
    }
  }

  for (const assertion of assertions) {
    const unusable = trustAssertionUnusableReason(assertion, now);
    if (unusable !== null) {
      return denyWith("stale", `${unusable}; decision flipped (ADR-002 constraint 1)`);
    }
  }

  if (!assertions.some((a) => a.trustLevel !== "none")) {
    return denyWith(
      "unavailable",
      "Trust evidence carries no elevation (zero-trust): no usable assertion above trust level 'none'",
    );
  }

  return {
    decision,
    flipped: false,
    outcome: "backed",
    reason: "Decision backed by usable trust evidence",
    citation: buildCitation(assertions, "backed", now),
  };
}