/**
 * CoreGrid Scholar — Phase 09 Security & Trust Fabric unit tests
 * (trust-core).
 *
 * Validates:
 * - Trust state machine transitions and invariants (A.7, BR).
 * - UNKNOWN cannot silently become TRUSTED (BR.10).
 * - Revocation/compromise states require evidence (BR.2).
 * - Trust scoring is evidence-weighted and explainable (K).
 * - Trust relationship creation/expiry/revocation (I, BR.11).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createTrustSubject,
  transitionTrustState,
  isTrustTransitionAllowed,
  evaluateTrustScore,
  recommendedTrustStateForScore,
  createTrustRelationship,
  revokeTrustRelationship,
  isTrustRelationshipActive,
  isUsableTrustState,
  type TrustSubject,
} from "@/lib/trust-core";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

function makeSubject(overrides: Partial<TrustSubject> = {}): TrustSubject {
  const created = createTrustSubject({
    id: "subject-1",
    type: "device",
    tenantId: TENANT_A,
    now: NOW,
  });
  if (!created.ok) throw new Error("fixture failed");
  return { ...created.subject, ...overrides };
}

describe("createTrustSubject", () => {
  it("creates a subject in the UNKNOWN state (BR.1)", () => {
    const result = createTrustSubject({ id: "s1", type: "device", tenantId: TENANT_A, now: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subject.state).toBe("UNKNOWN");
    }
  });

  it("rejects an empty id", () => {
    const result = createTrustSubject({ id: "", type: "device", tenantId: TENANT_A, now: NOW });
    expect(result.ok).toBe(false);
  });
});

describe("Trust state machine (A.7, BR)", () => {
  it("allows UNKNOWN -> UNVERIFIED", () => {
    expect(isTrustTransitionAllowed("UNKNOWN", "UNVERIFIED")).toBe(true);
  });

  it("rejects REVOKED -> anything (terminal)", () => {
    expect(isTrustTransitionAllowed("REVOKED", "UNVERIFIED")).toBe(false);
  });

  it("blocks UNKNOWN -> TRUSTED directly (BR.10)", () => {
    const subject = makeSubject({ state: "UNKNOWN" });
    const result = transitionTrustState(subject, "TRUSTED", "evt-1", "actor-1", NOW);
    expect(result.ok).toBe(false);
  });

  it("allows UNKNOWN -> UNVERIFIED with evidence", () => {
    const subject = makeSubject({ state: "UNKNOWN" });
    const result = transitionTrustState(subject, "UNVERIFIED", "evt-1", "actor-1", NOW);
    expect(result.ok).toBe(true);
  });

  it("requires evidence for REVOKED (BR.2)", () => {
    const subject = makeSubject({ state: "VERIFIED" });
    const result = transitionTrustState(subject, "REVOKED", "", "actor-1", NOW);
    expect(result.ok).toBe(false);
  });

  it("revokes via DEGRADED -> SUSPENDED -> REVOKED with evidence recorded", () => {
    // Revocation is a progressive state chain:
    // VERIFIED -> DEGRADED -> SUSPENDED -> REVOKED.
    const subject = makeSubject({ state: "VERIFIED" });
    const degraded = transitionTrustState(subject, "DEGRADED", "evt-anomaly", "actor-1", NOW);
    if (!degraded.ok) throw new Error("fixture failed");
    const suspended = transitionTrustState(
      degraded.subject,
      "SUSPENDED",
      "evt-compromise",
      "actor-1",
      NOW,
    );
    if (!suspended.ok) throw new Error("fixture failed");
    const revoked = transitionTrustState(
      suspended.subject,
      "REVOKED",
      "evt-compromise",
      "actor-1",
      NOW,
    );
    expect(revoked.ok).toBe(true);
    if (revoked.ok) {
      expect(revoked.subject.state).toBe("REVOKED");
      expect(revoked.subject.evidenceRefs).toContain("evt-compromise");
    }
  });

  it("supports degradation to quarantine (A.7)", () => {
    const subject = makeSubject({ state: "TRUSTED" });
    const result = transitionTrustState(subject, "QUARANTINED", "evt-anomaly", "actor-1", NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.subject.state).toBe("QUARANTINED");
  });
});

describe("evaluateTrustScore (K)", () => {
  it("computes a weighted average with factor breakdown", () => {
    const result = evaluateTrustScore({
      factors: [
        { factor: "identity_assurance", score: 90, weight: 2, evidenceRef: "evt-id" },
        { factor: "credential_strength", score: 50, weight: 2, evidenceRef: "evt-cred" },
      ],
      confidence: 0.9,
      context: "login",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.score.score).toBe(70); // (90*2 + 50*2)/4
      expect(result.score.factorScores.identity_assurance).toBe(90);
      expect(result.score.evidenceRefs).toContain("evt-id");
    }
  });

  it("rejects an empty factor set", () => {
    const result = evaluateTrustScore({ factors: [], confidence: 0.9, context: "x", now: NOW });
    expect(result.ok).toBe(false);
  });

  it("rejects out-of-range confidence", () => {
    const result = evaluateTrustScore({
      factors: [{ factor: "attestation", score: 50, weight: 1, evidenceRef: "evt" }],
      confidence: 2,
      context: "x",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

describe("recommendedTrustStateForScore (K.3)", () => {
  it("maps scores to recommended states", () => {
    expect(recommendedTrustStateForScore(90)).toBe("TRUSTED");
    expect(recommendedTrustStateForScore(65)).toBe("CONDITIONALLY_TRUSTED");
    expect(recommendedTrustStateForScore(45)).toBe("VERIFIED");
    expect(recommendedTrustStateForScore(25)).toBe("DEGRADED");
    expect(recommendedTrustStateForScore(5)).toBe("UNVERIFIED");
  });
});

describe("Trust relationships (I, BR.2, BR.11)", () => {
  it("creates an active relationship requiring evidence", () => {
    const result = createTrustRelationship({
      type: "TRUSTS",
      subjectId: "institution-1",
      targetId: "user-1",
      tenantId: TENANT_A,
      evidenceRef: "evt-verified",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isTrustRelationshipActive(result.relationship, NOW)).toBe(true);
    }
  });

  it("rejects a self-referencing relationship", () => {
    const result = createTrustRelationship({
      type: "TRUSTS",
      subjectId: "user-1",
      targetId: "user-1",
      tenantId: TENANT_A,
      evidenceRef: "evt",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a relationship without evidence (BR.2)", () => {
    const result = createTrustRelationship({
      type: "TRUSTS",
      subjectId: "institution-1",
      targetId: "user-1",
      tenantId: TENANT_A,
      evidenceRef: "",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("treats an expired relationship as inactive (AB)", () => {
    const result = createTrustRelationship({
      type: "TRUSTS",
      subjectId: "institution-1",
      targetId: "user-1",
      tenantId: TENANT_A,
      evidenceRef: "evt",
      expiresAt: "2025-12-31T00:00:00Z",
      now: NOW,
    });
    if (!result.ok) throw new Error("fixture failed");
    expect(isTrustRelationshipActive(result.relationship, NOW)).toBe(false);
  });

  it("revokes a relationship and records revocation (BR.11)", () => {
    const created = createTrustRelationship({
      type: "TRUSTS",
      subjectId: "institution-1",
      targetId: "user-1",
      tenantId: TENANT_A,
      evidenceRef: "evt",
      now: NOW,
    });
    if (!created.ok) throw new Error("fixture failed");
    const revoked = revokeTrustRelationship(created.relationship, NOW);
    expect(revoked.revokedAt).toBe(NOW);
    expect(isTrustRelationshipActive(revoked, NOW)).toBe(false);
  });
});

describe("isUsableTrustState", () => {
  it("treats positive trust states as usable signals", () => {
    expect(isUsableTrustState("TRUSTED")).toBe(true);
    expect(isUsableTrustState("CONDITIONALLY_TRUSTED")).toBe(true);
    expect(isUsableTrustState("REVOKED")).toBe(false);
    expect(isUsableTrustState("UNKNOWN")).toBe(false);
  });
});
