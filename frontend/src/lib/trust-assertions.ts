/**
 * CoreGrid — Security & Trust Fabric assertions, evidence,
 * provenance, and revocation (Phase 09, Sections F.1, L, M, N, AA, AB).
 *
 * Implements `architecture/phase-09-security-trust-fabric.md`:
 * - Trust assertion contract (F.1): assertion ID, issuer, subject, trust
 *   type, trust level, evidence, issued timestamp, expiration, scope,
 *   tenant, policy, cryptographic signature, provenance.
 * - Assertion sources & requirements (L): issuer, subject, scope, timestamp,
 *   expiration, evidence, integrity protection.
 * - Trust evidence (M): source, freshness, reliability, integrity,
 *   provenance, confidence.
 * - Trust provenance (N): every important trust assertion must be traceable
 *   to its evidence.
 * - Trust revocation (AA): compromise, expired evidence, invalid cert,
 *   credential compromise, malicious behavior, policy violation,
 *   administrative action, failed attestation. Revocation states: temporary
 *   suspension, permanent revocation, quarantine, conditional restoration.
 * - Trust expiration (AB): expired trust must not silently remain valid.
 * - Invariants (BR): trust must have evidence and provenance; revocation
 *   must propagate; external trust stays explicitly scoped.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Trust assertions (F.1, L)
 * ────────────────────────────────────────────────────────────*/

export type TrustAssertionType =
  | "identity"
  | "credential"
  | "device"
  | "workload"
  | "agent"
  | "service"
  | "software"
  | "artifact"
  | "attestation"
  | "posture"
  | "federation";

export const TRUST_ASSERTION_TYPES: readonly TrustAssertionType[] = [
  "identity",
  "credential",
  "device",
  "workload",
  "agent",
  "service",
  "software",
  "artifact",
  "attestation",
  "posture",
  "federation",
] as const;

export interface TrustAssertion {
  id: string;
  issuer: string;
  subject: string;
  type: TrustAssertionType;
  trustLevel: "high" | "medium" | "low" | "none";
  evidence: string[];
  issuedAt: string;
  expiresAt: string | null;
  scope: string | null;
  tenantId: TenantId | null;
  /** Integrity protection: signature/digest reference (O.2). */
  integrityReference: string;
  provenanceRef: string | null;
  revokedAt: string | null;
}

export interface CreateTrustAssertionInput {
  issuer: string;
  subject: string;
  type: TrustAssertionType;
  trustLevel: TrustAssertion["trustLevel"];
  evidence: string[];
  scope: string | null;
  tenantId: TenantId | null;
  integrityReference: string;
  provenanceRef: string | null;
  issuedAt: string;
  expiresAt?: string | null;
}

export type CreateTrustAssertionResult =
  { ok: true; assertion: TrustAssertion } | { ok: false; error: string };

export function createTrustAssertion(input: CreateTrustAssertionInput): CreateTrustAssertionResult {
  if (input.issuer.trim() === "") {
    return { ok: false, error: "Assertion issuer is required (L.2)" };
  }
  if (input.subject.trim() === "") {
    return { ok: false, error: "Assertion subject is required (L.2)" };
  }
  if (input.evidence.length === 0) {
    return { ok: false, error: "Assertions require evidence (L.2, BR.2)" };
  }
  if (input.integrityReference.trim() === "") {
    return { ok: false, error: "Assertions require integrity protection (L.2)" };
  }
  return {
    ok: true,
    assertion: {
      id: `assertion-${input.issuer}-${input.subject}-${input.issuedAt}`,
      issuer: input.issuer,
      subject: input.subject,
      type: input.type,
      trustLevel: input.trustLevel,
      evidence: input.evidence,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt ?? null,
      scope: input.scope,
      tenantId: input.tenantId,
      integrityReference: input.integrityReference,
      provenanceRef: input.provenanceRef,
      revokedAt: null,
    },
  };
}

export type AssertionVerificationResult =
  { ok: true; reason: string } | { ok: false; reason: string };

/**
 * Verify an assertion is usable right now: not revoked, not expired, and
 * issued by an accepted issuer within scope. Integrity verification (real
 * signature check) is performed by the Cryptographic Trust Service (O) and
 * supplied via `integrityVerified`.
 */
export function verifyTrustAssertion(
  assertion: TrustAssertion,
  integrityVerified: boolean,
  acceptedIssuers: string[],
  scope: string | null,
  now: string,
): AssertionVerificationResult {
  if (!integrityVerified) {
    return { ok: false, reason: "Assertion integrity could not be verified (O.2)" };
  }
  if (assertion.revokedAt !== null) {
    return { ok: false, reason: "Assertion has been revoked (AA)" };
  }
  if (assertion.expiresAt !== null && Date.parse(now) >= Date.parse(assertion.expiresAt)) {
    return { ok: false, reason: "Assertion has expired (AB)" };
  }
  if (!acceptedIssuers.includes(assertion.issuer)) {
    return { ok: false, reason: "Assertion issuer is not accepted" };
  }
  if (scope !== null && assertion.scope !== null && assertion.scope !== scope) {
    return { ok: false, reason: "Assertion scope does not match the requested scope (BR.7)" };
  }
  return { ok: true, reason: "Assertion is valid" };
}

export function revokeTrustAssertion(assertion: TrustAssertion, now: string): TrustAssertion {
  return { ...assertion, revokedAt: now };
}

/* ─────────────────────────────────────────────────────────────
 * Trust evidence (M)
 * ────────────────────────────────────────────────────────────*/

export interface TrustEvidence {
  id: string;
  source: string;
  capturedAt: string;
  /** How fresh must this evidence be to count (M.2). */
  freshnessMs: number | null;
  /** Reliability rating 0-1 (M.2). */
  reliability: number;
  /** Integrity verification reference (M.2). */
  integrityRef: string;
  provenanceRef: string;
  /** Confidence 0-1 (M.2). */
  confidence: number;
}

export interface CreateTrustEvidenceInput {
  id: string;
  source: string;
  capturedAt: string;
  freshnessMs?: number | null;
  reliability: number;
  integrityRef: string;
  provenanceRef: string;
  confidence: number;
}

export type CreateTrustEvidenceResult =
  { ok: true; evidence: TrustEvidence } | { ok: false; error: string };

export function createTrustEvidence(input: CreateTrustEvidenceInput): CreateTrustEvidenceResult {
  if (input.reliability < 0 || input.reliability > 1) {
    return { ok: false, error: "Evidence reliability must be between 0 and 1 (M.2)" };
  }
  if (input.confidence < 0 || input.confidence > 1) {
    return { ok: false, error: "Evidence confidence must be between 0 and 1 (M.2)" };
  }
  return {
    ok: true,
    evidence: {
      id: input.id,
      source: input.source,
      capturedAt: input.capturedAt,
      freshnessMs: input.freshnessMs ?? null,
      reliability: input.reliability,
      integrityRef: input.integrityRef,
      provenanceRef: input.provenanceRef,
      confidence: input.confidence,
    },
  };
}

export function isTrustEvidenceFresh(evidence: TrustEvidence, now: string): boolean {
  return (
    evidence.freshnessMs === null ||
    Date.parse(now) - Date.parse(evidence.capturedAt) <= evidence.freshnessMs
  );
}

/* ─────────────────────────────────────────────────────────────
 * Trust provenance (N)
 * ────────────────────────────────────────────────────────────*/

export interface ProvenanceLink {
  kind:
    "trust_decision" | "trust_assertion" | "issuer" | "evidence" | "verification_method" | "source";
  id: string;
  detail: string;
  at: string;
}

/**
 * Build a provenance chain for a trust decision (Section N.2):
 * Trust Decision -> Trust Assertion -> Issuer -> Evidence -> Verification
 * Method -> Source. Every important trust assertion must be traceable to its
 * evidence (N.3).
 */
export function buildProvenanceChain(
  links: ProvenanceLink[],
): { ok: true; chain: ProvenanceLink[] } | { ok: false; error: string } {
  if (links.length === 0) {
    return { ok: false, error: "Provenance chain cannot be empty (N.3)" };
  }
  if (links[0].kind !== "trust_decision") {
    return { ok: false, error: "Provenance chain must start with a trust decision" };
  }
  const hasEvidence = links.some((l) => l.kind === "evidence");
  if (!hasEvidence) {
    return { ok: false, error: "Provenance chain must reference evidence (N.3)" };
  }
  return { ok: true, chain: links };
}

/* ─────────────────────────────────────────────────────────────
 * Trust revocation (AA)
 * ────────────────────────────────────────────────────────────*/

export type TrustRevocationReason =
  | "compromise"
  | "expired_evidence"
  | "invalid_certificate"
  | "credential_compromise"
  | "malicious_behavior"
  | "policy_violation"
  | "administrative_action"
  | "failed_attestation";

export const TRUST_REVOCATION_REASONS: readonly TrustRevocationReason[] = [
  "compromise",
  "expired_evidence",
  "invalid_certificate",
  "credential_compromise",
  "malicious_behavior",
  "policy_violation",
  "administrative_action",
  "failed_attestation",
] as const;

export type TrustRevocationKind =
  "temporary_suspension" | "permanent_revocation" | "quarantine" | "conditional_restoration";

export interface TrustRevocationRecord {
  id: string;
  subjectId: string;
  reason: TrustRevocationReason;
  kind: TrustRevocationKind;
  revokedBy: string;
  revokedAt: string;
  /** Required for conditional_restoration (AA.2). */
  restorationCondition: string | null;
}

export interface CreateTrustRevocationInput {
  subjectId: string;
  reason: TrustRevocationReason;
  kind: TrustRevocationKind;
  revokedBy: string;
  now: string;
  restorationCondition?: string | null;
}

export type CreateTrustRevocationResult =
  { ok: true; revocation: TrustRevocationRecord } | { ok: false; error: string };

export function createTrustRevocation(
  input: CreateTrustRevocationInput,
): CreateTrustRevocationResult {
  if (input.subjectId.trim() === "") {
    return { ok: false, error: "Revocation requires a subject" };
  }
  if (input.revokedBy.trim() === "") {
    return { ok: false, error: "Revocation requires an attributable actor (BR.14)" };
  }
  if (
    input.kind === "conditional_restoration" &&
    (input.restorationCondition ?? "").trim() === ""
  ) {
    return { ok: false, error: "Conditional restoration requires a condition (AA.2)" };
  }
  return {
    ok: true,
    revocation: {
      id: `revoke-${input.subjectId}-${input.now}`,
      subjectId: input.subjectId,
      reason: input.reason,
      kind: input.kind,
      revokedBy: input.revokedBy,
      revokedAt: input.now,
      restorationCondition: input.restorationCondition ?? null,
    },
  };
}
