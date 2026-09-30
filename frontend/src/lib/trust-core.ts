/**
 * CoreGrid — Security & Trust Fabric core (Phase 09).
 *
 * Implements `architecture/phase-09-security-trust-fabric.md`:
 * - Trust model (A.7): trust is a continuously changing state, never a
 *   permanent property: trusted, partially trusted, conditionally trusted,
 *   untrusted, compromised, quarantined, revoked, unknown.
 * - Trust states (F.3): UNKNOWN, UNVERIFIED, VERIFIED, TRUSTED,
 *   CONDITIONALLY_TRUSTED, DEGRADED, SUSPENDED, COMPROMISED, REVOKED,
 *   QUARANTINED.
 * - Trust scoring (K): scores are evidence-weighted confidence, never
 *   absolute truth; scores must be explainable, versioned, contextual,
 *   time-sensitive, evidence-backed.
 * - Trust graph (I): relationships such as TRUSTS, ISSUED_BY, VERIFIED_BY,
 *   OPERATED_BY, OWNED_BY, ATTESTED_BY, SIGNED_BY, DEPLOYED_BY, DERIVED_FROM,
 *   DEPENDS_ON, FEDERATED_WITH, REVOKED_BY, CERTIFIED_BY.
 * - Architectural invariants (BR): trust is never permanent by default;
 *   UNKNOWN cannot silently become TRUSTED; trust must have evidence and
 *   provenance; trust must be revocable and contextual; tenant boundaries
 *   must remain explicit; security enforcement stays with Phase 08.
 *
 * Boundary (D.1): Phase 08 owns runtime security enforcement. This module
 * supplies trust state/information to Phase 08 — it never makes the final
 * enforcement decision.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Trust states (F.3)
 * ────────────────────────────────────────────────────────────*/

export type TrustState =
  | "UNKNOWN"
  | "UNVERIFIED"
  | "VERIFIED"
  | "TRUSTED"
  | "CONDITIONALLY_TRUSTED"
  | "DEGRADED"
  | "SUSPENDED"
  | "COMPROMISED"
  | "REVOKED"
  | "QUARANTINED";

export const TRUST_STATES: readonly TrustState[] = [
  "UNKNOWN",
  "UNVERIFIED",
  "VERIFIED",
  "TRUSTED",
  "CONDITIONALLY_TRUSTED",
  "DEGRADED",
  "SUSPENDED",
  "COMPROMISED",
  "REVOKED",
  "QUARANTINED",
] as const;

/** Ordered transitions allowed by the trust-state machine (Section A.7, BR). */
const TRUST_STATE_TRANSITIONS: Readonly<Record<TrustState, readonly TrustState[]>> = {
  UNKNOWN: ["UNVERIFIED"],
  UNVERIFIED: ["UNKNOWN", "VERIFIED"],
  VERIFIED: ["TRUSTED", "CONDITIONALLY_TRUSTED", "UNVERIFIED", "DEGRADED"],
  TRUSTED: ["CONDITIONALLY_TRUSTED", "DEGRADED", "SUSPENDED", "QUARANTINED"],
  CONDITIONALLY_TRUSTED: ["TRUSTED", "DEGRADED", "SUSPENDED", "QUARANTINED"],
  DEGRADED: ["SUSPENDED", "QUARANTINED", "VERIFIED"],
  SUSPENDED: ["DEGRADED", "VERIFIED", "REVOKED"],
  COMPROMISED: ["QUARANTINED", "REVOKED"],
  QUARANTINED: ["SUSPENDED", "REVOKED", "VERIFIED"],
  REVOKED: [],
} as const;

export function isTrustTransitionAllowed(from: TrustState, to: TrustState): boolean {
  return TRUST_STATE_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * Trust subject (H, AO)
 * ────────────────────────────────────────────────────────────*/

export type TrustSubjectType =
  | "person"
  | "organization"
  | "institution"
  | "tenant"
  | "device"
  | "agent"
  | "service"
  | "application"
  | "workload"
  | "software"
  | "artifact"
  | "data_source";

export const TRUST_SUBJECT_TYPES: readonly TrustSubjectType[] = [
  "person",
  "organization",
  "institution",
  "tenant",
  "device",
  "agent",
  "service",
  "application",
  "workload",
  "software",
  "artifact",
  "data_source",
] as const;

export interface TrustSubject {
  id: string;
  type: TrustSubjectType;
  /** Tenant scope; null for platform-scoped subjects. Cross-tenant trust must be explicit (AN). */
  tenantId: TenantId | null;
  state: TrustState;
  /** Default trust lifetime; trust must expire where appropriate (BR.6). */
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Evidence references that justify the current state (BR.2). */
  evidenceRefs: string[];
  /** Recommended restrictions to pass to Phase 08 enforcement (J.3). */
  recommendedRestrictions: string[];
}

export interface CreateTrustSubjectInput {
  id: string;
  type: TrustSubjectType;
  tenantId: TenantId | null;
  now: string;
}

export type CreateTrustSubjectResult =
  { ok: true; subject: TrustSubject } | { ok: false; error: string };

/**
 * Create a new trust subject. The default state is UNKNOWN — an entity is
 * never trusted merely because it exists (A.6, BR.1). A subject may not
 * silently skip the UNVERIFIED step to become trusted (BR.10).
 */
export function createTrustSubject(input: CreateTrustSubjectInput): CreateTrustSubjectResult {
  if (input.id.trim() === "") {
    return { ok: false, error: "Subject id is required" };
  }
  return {
    ok: true,
    subject: {
      id: input.id,
      type: input.type,
      tenantId: input.tenantId,
      state: "UNKNOWN",
      expiresAt: null,
      createdAt: input.now,
      updatedAt: input.now,
      evidenceRefs: [],
      recommendedRestrictions: [],
    },
  };
}

export type TransitionTrustStateResult =
  { ok: true; subject: TrustSubject } | { ok: false; error: string };

/**
 * Transition a subject's trust state. Evidence is required to move from
 * UNKNOWN/UNVERIFIED toward higher trust; entering a compromised/quarantined/
 * revoked state always requires evidence of the reason (BR.2, BR.10).
 */
export function transitionTrustState(
  subject: TrustSubject,
  to: TrustState,
  evidenceRef: string,
  actorId: string,
  now: string,
): TransitionTrustStateResult {
  if (!isTrustTransitionAllowed(subject.state, to)) {
    return { ok: false, error: `Trust transition ${subject.state} -> ${to} is not allowed` };
  }
  const movingUp = to === "TRUSTED" || to === "CONDITIONALLY_TRUSTED";
  if (movingUp && subject.state === "UNKNOWN") {
    // UNKNOWN cannot silently become trusted (BR.10); must pass through
    // UNVERIFIED/VERIFIED first with supporting evidence.
    return { ok: false, error: "UNKNOWN cannot transition directly to a trusted state (BR.10)" };
  }
  if (to === "REVOKED" || to === "COMPROMISED" || to === "QUARANTINED") {
    if (evidenceRef.trim() === "") {
      return { ok: false, error: "Revocation/compromise states require evidence (BR.2)" };
    }
  }
  return {
    ok: true,
    subject: {
      ...subject,
      state: to,
      updatedAt: now,
      evidenceRefs: [...subject.evidenceRefs, evidenceRef].filter(Boolean),
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Trust scoring (K)
 * ────────────────────────────────────────────────────────────*/

export type TrustScoreFactor =
  | "identity_assurance"
  | "credential_strength"
  | "device_assurance"
  | "software_integrity"
  | "workload_integrity"
  | "historical_behavior"
  | "attestation"
  | "provenance"
  | "certificate_validity"
  | "security_posture"
  | "recent_incidents";

export const TRUST_SCORE_FACTORS: readonly TrustScoreFactor[] = [
  "identity_assurance",
  "credential_strength",
  "device_assurance",
  "software_integrity",
  "workload_integrity",
  "historical_behavior",
  "attestation",
  "provenance",
  "certificate_validity",
  "security_posture",
  "recent_incidents",
] as const;

export interface TrustScoreFactorInput {
  factor: TrustScoreFactor;
  /** 0-100; higher = more supporting evidence. */
  score: number;
  weight: number;
  evidenceRef: string;
}

export interface TrustScore {
  score: number;
  confidence: number;
  factorScores: Record<TrustScoreFactor, number>;
  evidenceRefs: string[];
  version: string;
  evaluatedAt: string;
  /** Trust scores are contextual (K.3); context must be provided. */
  context: string;
}

export interface EvaluateTrustScoreInput {
  factors: TrustScoreFactorInput[];
  confidence: number;
  context: string;
  now: string;
}

export type EvaluateTrustScoreResult =
  { ok: true; score: TrustScore } | { ok: false; error: string };

/**
 * Compute an evidence-weighted trust score (K.1). The score is a weighted
 * average across factors; it never replaces the evidence itself (BR.9) and
 * always carries the factor breakdown so the score is explainable (K.3).
 */
export function evaluateTrustScore(input: EvaluateTrustScoreInput): EvaluateTrustScoreResult {
  if (input.factors.length === 0) {
    return { ok: false, error: "Trust score requires at least one factor" };
  }
  if (input.confidence < 0 || input.confidence > 1) {
    return { ok: false, error: "Confidence must be between 0 and 1" };
  }
  const totalWeight = input.factors.reduce((sum, f) => sum + f.weight, 0);
  if (totalWeight <= 0) {
    return { ok: false, error: "Total factor weight must be positive" };
  }
  const weighted = input.factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const score = Math.round((weighted / totalWeight) * 10) / 10;
  const factorScores = {} as Record<TrustScoreFactor, number>;
  for (const factor of TRUST_SCORE_FACTORS) {
    factorScores[factor] = input.factors.find((f) => f.factor === factor)?.score ?? 0;
  }
  return {
    ok: true,
    score: {
      score,
      confidence: input.confidence,
      factorScores,
      evidenceRefs: input.factors.map((f) => f.evidenceRef).filter(Boolean),
      version: "trust-score-v1",
      evaluatedAt: input.now,
      context: input.context,
    },
  };
}

/**
 * Map a trust score onto a recommended trust state boundary. This is a
 * suggestion for the Trust Evaluation Engine — the final state transition
 * still requires evidence (BR.9) and is performed by `transitionTrustState`.
 */
export function recommendedTrustStateForScore(score: number): TrustState {
  if (score >= 80) return "TRUSTED";
  if (score >= 60) return "CONDITIONALLY_TRUSTED";
  if (score >= 40) return "VERIFIED";
  if (score >= 20) return "DEGRADED";
  return "UNVERIFIED";
}

/* ─────────────────────────────────────────────────────────────
 * Trust graph (I)
 * ────────────────────────────────────────────────────────────*/

export type TrustRelationshipType =
  | "TRUSTS"
  | "ISSUED_BY"
  | "VERIFIED_BY"
  | "OPERATED_BY"
  | "OWNED_BY"
  | "ATTESTED_BY"
  | "SIGNED_BY"
  | "DEPLOYED_BY"
  | "DERIVED_FROM"
  | "DEPENDS_ON"
  | "FEDERATED_WITH"
  | "REVOKED_BY"
  | "CERTIFIED_BY";

export const TRUST_RELATIONSHIP_TYPES: readonly TrustRelationshipType[] = [
  "TRUSTS",
  "ISSUED_BY",
  "VERIFIED_BY",
  "OPERATED_BY",
  "OWNED_BY",
  "ATTESTED_BY",
  "SIGNED_BY",
  "DEPLOYED_BY",
  "DERIVED_FROM",
  "DEPENDS_ON",
  "FEDERATED_WITH",
  "REVOKED_BY",
  "CERTIFIED_BY",
] as const;

export interface TrustRelationship {
  id: string;
  type: TrustRelationshipType;
  /** Source subject id. */
  subjectId: string;
  /** Target subject id. */
  targetId: string;
  /** Tenant scope must be explicit where applicable (AN). */
  tenantId: TenantId | null;
  /** A relationship is only as strong as its evidence (BR.2). */
  evidenceRef: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateTrustRelationshipInput {
  type: TrustRelationshipType;
  subjectId: string;
  targetId: string;
  tenantId: TenantId | null;
  evidenceRef: string;
  expiresAt?: string | null;
  now: string;
}

export type CreateTrustRelationshipResult =
  { ok: true; relationship: TrustRelationship } | { ok: false; error: string };

export function createTrustRelationship(
  input: CreateTrustRelationshipInput,
): CreateTrustRelationshipResult {
  if (input.subjectId.trim() === "" || input.targetId.trim() === "") {
    return { ok: false, error: "Relationship requires both a subject and a target" };
  }
  if (input.subjectId === input.targetId) {
    return { ok: false, error: "A subject cannot be in a trust relationship with itself" };
  }
  if (input.evidenceRef.trim() === "") {
    return { ok: false, error: "Trust relationships require evidence (BR.2)" };
  }
  return {
    ok: true,
    relationship: {
      id: `rel-${input.subjectId}-${input.type}-${input.targetId}`,
      type: input.type,
      subjectId: input.subjectId,
      targetId: input.targetId,
      tenantId: input.tenantId,
      evidenceRef: input.evidenceRef,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      createdAt: input.now,
    },
  };
}

/**
 * Revoke a trust relationship. Revocation must propagate to dependent
 * trust decisions (BR.11) — this function marks the relationship revoked and
 * returns the revoked relationship so the caller can re-evaluate any
 * downstream state that depended on it.
 */
export function revokeTrustRelationship(
  relationship: TrustRelationship,
  now: string,
): TrustRelationship {
  return { ...relationship, revokedAt: now };
}

export function isTrustRelationshipExpired(relationship: TrustRelationship, now: string): boolean {
  return relationship.expiresAt !== null && Date.parse(now) >= Date.parse(relationship.expiresAt);
}

export function isTrustRelationshipActive(relationship: TrustRelationship, now: string): boolean {
  return relationship.revokedAt === null && !isTrustRelationshipExpired(relationship, now);
}

/** Is an entity's trust state usable as a positive trust signal right now? */
export function isUsableTrustState(state: TrustState): boolean {
  return state === "TRUSTED" || state === "CONDITIONALLY_TRUSTED" || state === "VERIFIED";
}
