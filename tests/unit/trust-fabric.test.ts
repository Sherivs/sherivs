/**
 * CoreGrid — Trust-fabric wiring suite (J-008 / V1CAP-022 / COND-007,
 * MISSION-R-83, ADR-002 Option A).
 *
 * Validates `frontend/src/lib/security/trust-fabric.ts` and its additive seam
 * into the phase-08 decision record (`frontend/src/lib/security-core.ts`):
 * - Assertion derivation from recorded evidence (Evidence -> Decision
 *   grounding): provenance refs, bounded trust vector, validity window.
 * - Staleness fail-closed: past-validity evidence yields no assertion and
 *   flips a granting decision to DENY (ADR-002 constraint 1).
 * - Revocation-flips-decision: a revoked assertion flips any decision that
 *   consumed it (ADR-002 constraint 3, AGENTS §31).
 * - Decision-record citation completeness: every consumption result cites
 *   the trust-evidence set (assertion IDs + state-machine version), and the
 *   phase-08 decision record carries it (ADR-002 constraint 2).
 * - Zero-trust on unavailable evidence: unknown trust never elevates
 *   (AGENTS §17 deny-by-default).
 */

import { describe, expect, it } from "vitest";
import { correlationId } from "@/lib/runtime-core";
import { tenantId } from "@/lib/tenant-core";
import {
  createSecurityDecision,
  NON_GRANTING_DECISION_STATES,
  type SecurityDecisionContext,
} from "@/lib/security-core";
import { createTrustEvidence, type TrustEvidence } from "@/lib/trust-assertions";
import {
  TRUST_FABRIC_STATE_MACHINE_VERSION,
  consumeTrustEvidence,
  deriveTrustAssertion,
  isTrustAssertionUsable,
  revokeTrustAssertionView,
  trustAssertionUnusableReason,
  type DeriveTrustAssertionInput,
  type TrustVector,
} from "@/lib/security/trust-fabric";

const NOW = "2026-06-01T00:00:00Z";
const TENANT_A = tenantId("tenant-a");

function evidenceRecord(
  id: string,
  overrides: Partial<TrustEvidence> = {},
): TrustEvidence {
  const result = createTrustEvidence({
    id,
    source: "phase-09-evidence-store",
    capturedAt: "2026-05-31T00:00:00Z",
    freshnessMs: 7 * 24 * 60 * 60 * 1000,
    reliability: 0.9,
    integrityRef: "sha256:evidence-integrity",
    provenanceRef: "prov:evidence-capture",
    confidence: 0.85,
    ...overrides,
  });
  if (!result.ok) throw new Error(`fixture evidence invalid: ${result.error}`);
  return result.evidence;
}

const USABLE_EVIDENCE: readonly TrustEvidence[] = [evidenceRecord("ev-1")];

const HIGH_VECTOR: TrustVector = [
  { factor: "identity_assurance", score: 90, evidenceRef: "ev-1" },
  { factor: "attestation", score: 80, evidenceRef: "ev-1" },
];

function deriveInput(overrides: Partial<DeriveTrustAssertionInput> = {}): DeriveTrustAssertionInput {
  return {
    id: "assertion-1",
    issuer: "issuer-coregrid",
    subjectId: "agent-1",
    type: "agent",
    tenantId: TENANT_A,
    scope: null,
    evidence: USABLE_EVIDENCE,
    vector: HIGH_VECTOR,
    trustLevel: "high",
    now: NOW,
    ...overrides,
  };
}

function deriveOk(overrides: Partial<DeriveTrustAssertionInput> = {}) {
  const result = deriveTrustAssertion(deriveInput(overrides));
  if (!result.ok) throw new Error(`fixture assertion invalid: ${result.error}`);
  return result.assertion;
}

function baseContext(overrides: Partial<SecurityDecisionContext> = {}): SecurityDecisionContext {
  return {
    requestId: "req-1",
    actorId: "agent-1",
    actorType: "ai_agent",
    tenantId: TENANT_A,
    resource: "student",
    action: "read",
    context: {},
    policyVersion: "v1",
    riskScore: 10,
    correlationId: correlationId("corr-1"),
    now: NOW,
    ttlSeconds: 60,
    ...overrides,
  };
}

describe("assertion derivation (Evidence -> Decision grounding)", () => {
  it("derives an assertion carrying subject identity, bounded vector, validity window, and evidence provenance", () => {
    const assertion = deriveOk();
    expect(assertion.subjectId).toBe("agent-1");
    expect(assertion.issuer).toBe("issuer-coregrid");
    expect(assertion.vector).toEqual(HIGH_VECTOR);
    // Validity window derived from evidence capture + freshness bound.
    expect(assertion.validFrom).toBe("2026-05-31T00:00:00.000Z");
    expect(assertion.validUntil).toBe("2026-06-07T00:00:00.000Z");
    expect(assertion.validUntil > assertion.validFrom).toBe(true);
    // Provenance refs cite exactly the recorded evidence records (N.3).
    expect(assertion.evidenceRefs).toEqual(["ev-1"]);
    expect(assertion.revokedAt).toBeNull();
    expect(assertion.stateMachineVersion).toBe(TRUST_FABRIC_STATE_MACHINE_VERSION);
  });

  it("refuses to derive an assertion without recorded evidence (BR.2)", () => {
    const result = deriveTrustAssertion(deriveInput({ evidence: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/evidence/i);
  });

  it("refuses derivation from stale evidence (fail-closed)", () => {
    const stale = [
      evidenceRecord("ev-stale", {
        capturedAt: "2026-05-01T00:00:00Z",
        freshnessMs: 60 * 60 * 1000,
      }),
    ];
    const result = deriveTrustAssertion(deriveInput({ evidence: stale }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/stale/i);
  });

  it("refuses an unbounded validity window (fail-closed, BR.6)", () => {
    const unbounded = [evidenceRecord("ev-open", { freshnessMs: null })];
    const result = deriveTrustAssertion(
      deriveInput({ evidence: unbounded, vector: [{ factor: "identity_assurance", score: 90, evidenceRef: "ev-open" }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unbounded/i);
  });

  it("intersects the evidence freshness bound with an explicit expiry cap", () => {
    const assertion = deriveOk({ expiresAt: "2026-06-03T00:00:00Z" });
    expect(assertion.validUntil).toBe("2026-06-03T00:00:00.000Z");
  });

  it("rejects a vector dimension citing evidence outside the derivation set (N.3)", () => {
    const result = deriveTrustAssertion(
      deriveInput({
        vector: [{ factor: "identity_assurance", score: 90, evidenceRef: "ev-elsewhere" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/derivation set/i);
  });

  it("rejects vector dimensions outside the bounded factor space or score range (phase 09 K)", () => {
    const badFactor = deriveTrustAssertion(
      deriveInput({
        // Runtime guard: data from storage may carry a factor outside the
        // compile-time union; it must be rejected, not trusted.
        vector: [{ factor: "made_up_factor" as never, score: 90, evidenceRef: "ev-1" }],
      }),
    );
    expect(badFactor.ok).toBe(false);

    const badScore = deriveTrustAssertion(
      deriveInput({
        vector: [{ factor: "identity_assurance", score: 150, evidenceRef: "ev-1" }],
      }),
    );
    expect(badScore.ok).toBe(false);
  });
});

describe("staleness fail-closed (ADR-002 constraint 1)", () => {
  it("treats an assertion inside its validity window as usable", () => {
    const assertion = deriveOk();
    expect(isTrustAssertionUsable(assertion, NOW)).toBe(true);
    expect(trustAssertionUnusableReason(assertion, NOW)).toBeNull();
  });

  it("flips a granting decision to DENY once the validity window has passed", () => {
    const assertion = deriveOk();
    const afterExpiry = "2026-06-08T00:00:00Z";
    expect(trustAssertionUnusableReason(assertion, afterExpiry)).toMatch(/stale/i);

    const consumed = consumeTrustEvidence({
      decision: "ALLOW",
      assertions: [assertion],
      now: afterExpiry,
    });
    expect(consumed.decision).toBe("DENY");
    expect(consumed.flipped).toBe(true);
    expect(consumed.outcome).toBe("stale");
    expect(consumed.citation.assertionIds).toEqual(["assertion-1"]);
    expect(consumed.citation.outcome).toBe("stale");
  });

  it("flips a granting decision when the assertion is not yet valid", () => {
    const assertion = deriveOk();
    const beforeValidity = "2026-05-30T00:00:00Z";
    const consumed = consumeTrustEvidence({
      decision: "ALLOW",
      assertions: [assertion],
      now: beforeValidity,
    });
    expect(consumed.decision).toBe("DENY");
    expect(consumed.outcome).toBe("stale");
  });

  it("flips closed when any assertion in the consumed set is stale, even alongside usable ones", () => {
    const usable = deriveOk({ id: "assertion-usable" });
    const stale = deriveOk({
      id: "assertion-stale",
      evidence: [evidenceRecord("ev-short", { capturedAt: "2026-05-31T23:00:00Z", freshnessMs: 60 * 60 * 1000 })],
      vector: [{ factor: "identity_assurance", score: 70, evidenceRef: "ev-short" }],
    });
    const consumed = consumeTrustEvidence({
      decision: "ALLOW",
      assertions: [usable, stale],
      now: "2026-06-02T00:00:00Z",
    });
    expect(consumed.decision).toBe("DENY");
    expect(consumed.outcome).toBe("stale");
    expect(consumed.citation.assertionIds).toEqual(["assertion-usable", "assertion-stale"]);
  });
});

describe("revocation-flips-decision (ADR-002 constraint 3)", () => {
  it("backs a granting decision while the assertion is valid", () => {
    const assertion = deriveOk();
    const consumed = consumeTrustEvidence({
      decision: "ALLOW",
      assertions: [assertion],
      now: NOW,
    });
    expect(consumed.decision).toBe("ALLOW");
    expect(consumed.flipped).toBe(false);
    expect(consumed.outcome).toBe("backed");
    expect(consumed.citation.assertionIds).toEqual(["assertion-1"]);
  });

  it("flips a previously-backed ALLOW to DENY when the assertion is revoked", () => {
    const assertion = deriveOk();
    const revokedAt = "2026-06-01T06:00:00Z";

    const before = consumeTrustEvidence({
      decision: "ALLOW",
      assertions: [assertion],
      now: "2026-06-01T00:00:00Z",
    });
    expect(before.decision).toBe("ALLOW");

    const revoked = revokeTrustAssertionView(assertion, revokedAt);
    expect(revoked.revokedAt).toBe(revokedAt);

    const after = consumeTrustEvidence({
      decision: "ALLOW",
      assertions: [revoked],
      now: "2026-06-01T07:00:00Z",
    });
    expect(after.decision).toBe("DENY");
    expect(after.flipped).toBe(true);
    expect(after.outcome).toBe("revoked");
    // The flipped decision still cites the revoked assertion it consumed.
    expect(after.citation.assertionIds).toEqual(["assertion-1"]);
    expect(after.citation.outcome).toBe("revoked");
  });

  it("flips a granting decision when revoked evidence is consumed alongside usable evidence", () => {
    const usable = deriveOk({ id: "assertion-usable" });
    const revoked = revokeTrustAssertionView(deriveOk({ id: "assertion-revoked" }), NOW);
    const consumed = consumeTrustEvidence({
      decision: "ALLOW",
      assertions: [usable, revoked],
      now: NOW,
    });
    expect(consumed.decision).toBe("DENY");
    expect(consumed.outcome).toBe("revoked");
  });

  it("never flips a non-granting decision — it consumes no trust elevation", () => {
    const assertion = deriveOk();
    for (const decision of NON_GRANTING_DECISION_STATES) {
      const consumed = consumeTrustEvidence({
        decision,
        assertions: [revokeTrustAssertionView(assertion, NOW)],
        now: NOW,
      });
      expect(consumed.decision).toBe(decision);
      expect(consumed.flipped).toBe(false);
      expect(consumed.outcome).toBe("not_applicable");
    }
  });
});

describe("decision-record citation completeness (ADR-002 constraint 2)", () => {
  it("cites exactly the consumed assertion IDs, state-machine version, and evaluation time", () => {
    const assertion = deriveOk();
    const consumed = consumeTrustEvidence({
      decision: "ALLOW",
      assertions: [assertion],
      now: NOW,
    });
    expect(consumed.citation).toEqual({
      assertionIds: ["assertion-1"],
      stateMachineVersion: TRUST_FABRIC_STATE_MACHINE_VERSION,
      evaluatedAt: NOW,
      outcome: "backed",
    });

    const decision = createSecurityDecision(
      baseContext({ trustEvidence: consumed.citation }),
      consumed.decision,
      consumed.reason,
    );
    expect(decision.trustEvidence).toBeDefined();
    expect(decision.trustEvidence?.assertionIds).toEqual(["assertion-1"]);
    expect(decision.trustEvidence?.stateMachineVersion).toBe(TRUST_FABRIC_STATE_MACHINE_VERSION);
    expect(decision.trustEvidence?.evaluatedAt).toBe(NOW);
    expect(decision.trustEvidence?.outcome).toBe("backed");
  });

  it("carries the fail-closed citation onto the flipped decision record", () => {
    const revoked = revokeTrustAssertionView(deriveOk(), NOW);
    const consumed = consumeTrustEvidence({ decision: "ALLOW", assertions: [revoked], now: NOW });
    const decision = createSecurityDecision(
      baseContext({ trustEvidence: consumed.citation }),
      consumed.decision,
      consumed.reason,
    );
    expect(decision.decision).toBe("DENY");
    expect(decision.trustEvidence?.outcome).toBe("revoked");
    expect(decision.trustEvidence?.assertionIds).toEqual(["assertion-1"]);
  });

  it("leaves decision records without trust evidence valid (additive seam)", () => {
    const decision = createSecurityDecision(baseContext(), "ALLOW", "granted");
    expect(decision.trustEvidence).toBeUndefined();
  });
});

describe("zero-trust on unavailable evidence (ADR-002 constraint 1)", () => {
  it("flips a granting decision when trust evidence cannot be resolved at all", () => {
    const consumed = consumeTrustEvidence({
      decision: "ALLOW",
      assertions: null,
      now: NOW,
    });
    expect(consumed.decision).toBe("DENY");
    expect(consumed.flipped).toBe(true);
    expect(consumed.outcome).toBe("unavailable");
    expect(consumed.citation.assertionIds).toEqual([]);
    expect(consumed.citation.stateMachineVersion).toBe(TRUST_FABRIC_STATE_MACHINE_VERSION);
  });

  it("treats a subject with no assertions as unknown trust = zero-trust", () => {
    const consumed = consumeTrustEvidence({
      decision: "ALLOW",
      assertions: [],
      now: NOW,
    });
    expect(consumed.decision).toBe("DENY");
    expect(consumed.outcome).toBe("unavailable");
  });

  it("never elevates on trust level 'none'", () => {
    const noneLevel = deriveOk({ trustLevel: "none" });
    const consumed = consumeTrustEvidence({
      decision: "ALLOW",
      assertions: [noneLevel],
      now: NOW,
    });
    expect(consumed.decision).toBe("DENY");
    expect(consumed.outcome).toBe("unavailable");
  });
});