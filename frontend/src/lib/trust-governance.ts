/**
 * CoreGrid — Security & Trust Fabric governance: key trust,
 * certificate trust, federation, delegation, anchors, policies, and
 * zero-trust evaluation (Phase 09, Sections P, Q, AC, AD, AG, AH, AI, AE,
 * AK, AL).
 *
 * Implements `architecture/phase-09-security-trust-fabric.md`:
 * - Key Trust Registry (P): metadata for public/signing/encryption/service/
 *   agent/device keys. The registry must never expose private keys.
 * - Certificate Trust (Q): registration, validation, expiration tracking,
 *   chain verification, revocation status, ownership, rotation.
 * - Trust Federation (AC): every federation relationship defines parties,
 *   trust scope, accepted assertions, verification methods, expiration,
 *   revocation, responsibilities, audit requirements. External trust must
 *   never automatically become unrestricted internal trust (AC.3, AD).
 * - Trust Delegation (AG): delegator, delegate, authority, scope,
 *   expiration, restrictions, revocation; chains must be traceable.
 * - Trust Anchors (AI): require elevated administrative controls.
 * - Trust Policy Registry (AE): accepted issuers, acceptable evidence,
 *   trust lifetimes, verification requirements, minimum assurance; policies
 *   must be versioned.
 * - Zero-Trust Architecture (AK): verify explicitly, assume breach, least
 *   privilege, continuously evaluate trust, minimize implicit relationships.
 * - Phase 08 Integration (AL): the fabric exposes trust.get_state,
 *   trust.get_score, trust.verify_assertion, trust.verify_provenance,
 *   trust.check_attestation, trust.check_revocation. Phase 08 remains
 *   responsible for the enforcement decision.
 */

import type { TenantId } from "./tenant-core";
import type { TrustState } from "./trust-core";

/* ─────────────────────────────────────────────────────────────
 * Key trust (P) — metadata only; private keys never enter
 * ────────────────────────────────────────────────────────────*/

export type KeyTrustKind = "public" | "signing" | "encryption" | "service" | "agent" | "device";

export interface KeyTrustRecord {
  keyId: string;
  kind: KeyTrustKind;
  /** Fingerprint of the public key (never the private key material). */
  fingerprint: string;
  subjectId: string;
  status: "active" | "rotating" | "revoked" | "expired";
  expiresAt: string | null;
  createdAt: string;
}

export interface RegisterKeyTrustInput {
  keyId: string;
  kind: KeyTrustKind;
  fingerprint: string;
  subjectId: string;
  expiresAt?: string | null;
  now: string;
}

export type RegisterKeyTrustResult =
  { ok: true; record: KeyTrustRecord } | { ok: false; error: string };

export function registerKeyTrust(input: RegisterKeyTrustInput): RegisterKeyTrustResult {
  if (input.fingerprint.trim() === "") {
    return { ok: false, error: "Key fingerprint is required (P)" };
  }
  return {
    ok: true,
    record: {
      keyId: input.keyId,
      kind: input.kind,
      fingerprint: input.fingerprint,
      subjectId: input.subjectId,
      status: "active",
      expiresAt: input.expiresAt ?? null,
      createdAt: input.now,
    },
  };
}

export function isKeyTrustUsable(record: KeyTrustRecord, now: string): boolean {
  if (record.status !== "active" && record.status !== "rotating") return false;
  return record.expiresAt === null || Date.parse(now) < Date.parse(record.expiresAt);
}

/* ─────────────────────────────────────────────────────────────
 * Certificate trust (Q)
 * ────────────────────────────────────────────────────────────*/

export interface CertificateTrustRecord {
  certificateId: string;
  subjectId: string;
  issuerId: string;
  status: "valid" | "expired" | "revoked" | "pending";
  chainVerified: boolean;
  expiresAt: string;
  createdAt: string;
}

export interface RegisterCertificateTrustInput {
  certificateId: string;
  subjectId: string;
  issuerId: string;
  chainVerified: boolean;
  expiresAt: string;
  now: string;
}

export type RegisterCertificateTrustResult =
  { ok: true; record: CertificateTrustRecord } | { ok: false; error: string };

export function registerCertificateTrust(
  input: RegisterCertificateTrustInput,
): RegisterCertificateTrustResult {
  if (input.expiresAt <= input.now) {
    return { ok: false, error: "Certificate must not already be expired (Q)" };
  }
  return {
    ok: true,
    record: {
      certificateId: input.certificateId,
      subjectId: input.subjectId,
      issuerId: input.issuerId,
      status: "valid",
      chainVerified: input.chainVerified,
      expiresAt: input.expiresAt,
      createdAt: input.now,
    },
  };
}

export function evaluateCertificateTrust(
  record: CertificateTrustRecord,
  now: string,
): { ok: true } | { ok: false; reason: string } {
  if (record.status === "revoked") return { ok: false, reason: "Certificate revoked (Q)" };
  if (Date.parse(now) >= Date.parse(record.expiresAt)) {
    return { ok: false, reason: "Certificate expired (Q)" };
  }
  if (!record.chainVerified) return { ok: false, reason: "Certificate chain not verified (Q)" };
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Trust federation (AC, AD)
 * ────────────────────────────────────────────────────────────*/

export interface FederationRelationship {
  id: string;
  parties: [string, string];
  trustScope: string;
  acceptedAssertionTypes: string[];
  verificationMethods: string[];
  expiresAt: string;
  revokedAt: string | null;
  auditRequired: boolean;
}

export interface CreateFederationInput {
  parties: [string, string];
  trustScope: string;
  acceptedAssertionTypes: string[];
  verificationMethods: string[];
  expiresAt: string;
  auditRequired: boolean;
  now: string;
}

export type CreateFederationResult =
  { ok: true; relationship: FederationRelationship } | { ok: false; error: string };

/**
 * Create a federation relationship. Every federation defines parties, trust
 * scope, accepted assertions, verification methods, expiration, revocation,
 * responsibilities, and audit requirements (AC.2).
 */
export function createFederation(input: CreateFederationInput): CreateFederationResult {
  if (input.parties[0] === input.parties[1]) {
    return { ok: false, error: "Federation must be between two distinct parties (AC.2)" };
  }
  if (input.trustScope.trim() === "") {
    return { ok: false, error: "Federation trust scope is required (AC.2)" };
  }
  if (input.acceptedAssertionTypes.length === 0) {
    return { ok: false, error: "Federation must define accepted assertions (AC.2)" };
  }
  if (input.expiresAt <= input.now) {
    return { ok: false, error: "Federation expiration must be in the future (AB)" };
  }
  return {
    ok: true,
    relationship: {
      id: `federation-${input.parties[0]}-${input.parties[1]}`,
      parties: input.parties,
      trustScope: input.trustScope,
      acceptedAssertionTypes: input.acceptedAssertionTypes,
      verificationMethods: input.verificationMethods,
      expiresAt: input.expiresAt,
      revokedAt: null,
      auditRequired: input.auditRequired,
    },
  };
}

export function isFederationActive(relationship: FederationRelationship, now: string): boolean {
  return relationship.revokedAt === null && Date.parse(now) < Date.parse(relationship.expiresAt);
}

/* ─────────────────────────────────────────────────────────────
 * Trust delegation (AG)
 * ────────────────────────────────────────────────────────────*/

export interface TrustDelegation {
  id: string;
  delegatorId: string;
  delegateId: string;
  authority: string;
  scope: string;
  expiresAt: string;
  restrictions: string[];
  revokedAt: string | null;
}

export interface CreateTrustDelegationInput {
  delegatorId: string;
  delegateId: string;
  authority: string;
  scope: string;
  expiresAt: string;
  restrictions: string[];
  now: string;
}

export type CreateTrustDelegationResult =
  { ok: true; delegation: TrustDelegation } | { ok: false; error: string };

export function createTrustDelegation(
  input: CreateTrustDelegationInput,
): CreateTrustDelegationResult {
  if (input.delegatorId === input.delegateId) {
    return { ok: false, error: "A delegator cannot delegate to itself (AG)" };
  }
  if (input.authority.trim() === "" || input.scope.trim() === "") {
    return { ok: false, error: "Delegation requires authority and scope (AG)" };
  }
  if (input.expiresAt <= input.now) {
    return { ok: false, error: "Delegation must expire in the future (AG)" };
  }
  return {
    ok: true,
    delegation: {
      id: `delegation-${input.delegatorId}-${input.delegateId}-${input.now}`,
      delegatorId: input.delegatorId,
      delegateId: input.delegateId,
      authority: input.authority,
      scope: input.scope,
      expiresAt: input.expiresAt,
      restrictions: input.restrictions,
      revokedAt: null,
    },
  };
}

export function isDelegationActive(delegation: TrustDelegation, now: string): boolean {
  return delegation.revokedAt === null && Date.parse(now) < Date.parse(delegation.expiresAt);
}

/* ─────────────────────────────────────────────────────────────
 * Trust anchors (AI)
 * ────────────────────────────────────────────────────────────*/

export type TrustAnchorKind =
  | "root_certificate"
  | "root_key"
  | "approved_issuer"
  | "approved_registry"
  | "approved_identity_provider"
  | "approved_signing_authority";

export interface TrustAnchor {
  id: string;
  kind: TrustAnchorKind;
  /** Anchors require elevated administrative controls (AI). */
  managedBy: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface RegisterTrustAnchorInput {
  id: string;
  kind: TrustAnchorKind;
  managedBy: string;
  now: string;
}

export type RegisterTrustAnchorResult =
  { ok: true; anchor: TrustAnchor } | { ok: false; error: string };

export function registerTrustAnchor(input: RegisterTrustAnchorInput): RegisterTrustAnchorResult {
  if (input.managedBy.trim() === "") {
    return { ok: false, error: "Trust anchor requires a managing administrator (AI)" };
  }
  return {
    ok: true,
    anchor: {
      id: input.id,
      kind: input.kind,
      managedBy: input.managedBy,
      createdAt: input.now,
      revokedAt: null,
    },
  };
}

export function revokeTrustAnchor(anchor: TrustAnchor, now: string): TrustAnchor {
  return { ...anchor, revokedAt: now };
}

/* ─────────────────────────────────────────────────────────────
 * Trust policy registry (AE)
 * ────────────────────────────────────────────────────────────*/

export interface TrustPolicyVersion {
  id: string;
  version: number;
  acceptedIssuers: string[];
  acceptableEvidenceKinds: string[];
  defaultTrustLifetimeMs: number;
  minimumAssurance: number;
  requireAttestation: boolean;
  effectiveAt: string;
}

export interface CreateTrustPolicyInput {
  id: string;
  version: number;
  acceptedIssuers: string[];
  acceptableEvidenceKinds: string[];
  defaultTrustLifetimeMs: number;
  minimumAssurance: number;
  requireAttestation: boolean;
  effectiveAt: string;
}

export type CreateTrustPolicyResult =
  { ok: true; policy: TrustPolicyVersion } | { ok: false; error: string };

export function createTrustPolicy(input: CreateTrustPolicyInput): CreateTrustPolicyResult {
  if (input.acceptedIssuers.length === 0) {
    return { ok: false, error: "Trust policy must accept at least one issuer (AE)" };
  }
  if (input.minimumAssurance < 0 || input.minimumAssurance > 1) {
    return { ok: false, error: "Minimum assurance must be between 0 and 1 (AE)" };
  }
  if (input.defaultTrustLifetimeMs <= 0) {
    return { ok: false, error: "Trust lifetime must be positive (AB)" };
  }
  return { ok: true, policy: { ...input } };
}

export interface EvaluateTrustPolicyInput {
  policy: TrustPolicyVersion;
  assurance: number;
  issuerAccepted: boolean;
  evidenceAccepted: boolean;
  attestationOk: boolean;
}

export type EvaluateTrustPolicyResult =
  { ok: true; reason: string } | { ok: false; reason: string };

export function evaluateTrustPolicy(input: EvaluateTrustPolicyInput): EvaluateTrustPolicyResult {
  if (!input.issuerAccepted) return { ok: false, reason: "Issuer is not accepted by policy (AE)" };
  if (!input.evidenceAccepted)
    return { ok: false, reason: "Evidence kind is not accepted by policy (AE)" };
  if (input.policy.requireAttestation && !input.attestationOk) {
    return { ok: false, reason: "Policy requires attestation (AE)" };
  }
  if (input.assurance < input.policy.minimumAssurance) {
    return { ok: false, reason: "Assurance is below policy minimum (AE)" };
  }
  return { ok: true, reason: "Trust policy satisfied" };
}

/* ─────────────────────────────────────────────────────────────
 * Zero-trust evaluation (AK) + Phase 08 integration contract (AL)
 * ────────────────────────────────────────────────────────────*/

export interface ZeroTrustEvaluationInput {
  identityVerified: boolean;
  deviceTrusted: boolean;
  sessionValid: boolean;
  /** Risk-action from Phase 08 risk evaluation (e.g. "allow", "rate_limit"). */
  riskAction: string;
}

export type ZeroTrustVerdict =
  | { verdict: "trusted"; reason: string }
  | { verdict: "challenge"; reason: string }
  | { verdict: "deny"; reason: string };

/**
 * Zero-trust evaluation (AK): verify explicitly, assume breach, least
 * privilege, continuously evaluate trust, minimize implicit relationships.
 * This function produces a trust verdict only — Phase 08 remains the
 * enforcement authority (AL, BR.16).
 */
export function evaluateZeroTrust(input: ZeroTrustEvaluationInput): ZeroTrustVerdict {
  if (!input.identityVerified || !input.sessionValid) {
    return { verdict: "deny", reason: "Identity/session not verified (AK: verify explicitly)" };
  }
  if (!input.deviceTrusted) {
    return { verdict: "challenge", reason: "Device not trusted (AK: continuous evaluation)" };
  }
  if (input.riskAction === "quarantine" || input.riskAction === "temporary_block") {
    return { verdict: "deny", reason: "Risk action blocks the operation (AK: assume breach)" };
  }
  if (input.riskAction !== "allow") {
    return { verdict: "challenge", reason: "Risk action requires additional verification" };
  }
  return { verdict: "trusted", reason: "Zero-trust evaluation passed" };
}

/** Phase 08 integration surface (AL): trust.get_state. */
export function trustStateToUsable(state: TrustState): boolean {
  return state === "TRUSTED" || state === "CONDITIONALLY_TRUSTED";
}
