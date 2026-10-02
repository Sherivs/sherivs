/**
 * MISSION H2-17 / J-035 — verification independence enforcement
 * (AGENTS.md §7 AI sovereignty boundary, §21 AI output trust, §31 testing
 * standard).
 *
 * Proves, at unit level, that the assurance contract
 * `frontend/src/lib/assurance/verification-independence.ts`:
 *  1. DENIES self-verification — the performer of record can never issue a
 *     verdict on its own work (J-035 / E-050: no worker verifies its own
 *     output, AI or human);
 *  2. DENIES a verifier that does not hold the item's declared verifier
 *     capability AT EVALUATION TIME (revocation propagation — the fresh
 *     held set decides, nothing survives revocation);
 *  3. DENIES every attempt against a work item whose performer of record is
 *     unrecorded or ambiguous — independence cannot be evaluated against an
 *     unresolved performer (fail closed, never guessed);
 *  4. DENIES cross-tenant verifiers and malformed attempts/items;
 *  5. ACCEPTS a valid independent verdict and records full provenance —
 *     who verified what, under which policy, when, with which capability
 *     (Constitution §12 / §43);
 *  6. AUDITS every evaluation — allow AND deny — so denial is observable,
 *     never silent (§18).
 */

import { describe, expect, it } from "vitest";
import {
  evaluateVerification,
  holdsVerifierCapability,
  isSelfVerification,
  resolvePerformerOfRecord,
  type PerformerOfRecord,
  type VerificationAttempt,
  type VerifiableWorkItem,
} from "@/lib/assurance/verification-independence";

const NOW = "2026-10-02T12:00:00.000Z";
const TENANT = "tenant-alpha";
const POLICY = "policy:assurance/verification-independence/v1";
const VERIFIER_CAPABILITY = "verification:sign-off";

function item(overrides?: Partial<VerifiableWorkItem>): VerifiableWorkItem {
  return {
    itemId: "item:work-001",
    tenantScope: TENANT,
    performerOfRecord: { status: "recorded", identityRef: "identity:worker-7" },
    requiredVerifierCapability: VERIFIER_CAPABILITY,
    policyRef: POLICY,
    ...overrides,
  };
}

function attempt(overrides?: Partial<VerificationAttempt>): VerificationAttempt {
  return {
    attemptId: "attempt:v-001",
    verifier: {
      identityRef: "identity:operator-2",
      tenantScope: TENANT,
      heldCapabilities: [VERIFIER_CAPABILITY],
      classification: "human",
    },
    verdict: "verified",
    reason: "independent criteria and evidence",
    verifiedAt: NOW,
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Denial matrix (fail closed) — every denial is named and audited
 * ────────────────────────────────────────────────────────────*/

describe("denial matrix (fail closed, J-035)", () => {
  it("denies self-verification — the performer cannot verify its own work", () => {
    const selfAttempt = attempt({
      verifier: { ...attempt().verifier, identityRef: "identity:worker-7", classification: "ai" },
    });
    const baseline = evaluateVerification(item(), attempt());
    const selfResult = evaluateVerification(item(), selfAttempt);
    expect(baseline.ok).toBe(true); // sanity: the independent baseline is allowed
    expect(selfResult.ok).toBe(false);
    if (!selfResult.ok) {
      expect(selfResult.denyReason).toBe("self_verification_denied");
      expect(selfResult.audit.eventKind).toBe("verdict_denied");
      expect(selfResult.audit.selfVerificationAttempt).toBe(true);
      expect(selfResult.audit.denyReason).toBe("self_verification_denied");
    }
  });

  it("denies self-verification for BOTH ai and human performers (identity, not kind)", () => {
    for (const classification of ["ai", "human"] as const) {
      const selfResult = evaluateVerification(
        item({ performerOfRecord: { status: "recorded", identityRef: "identity:verifier-1" } }),
        attempt({
          verifier: {
            identityRef: "identity:verifier-1",
            tenantScope: TENANT,
            heldCapabilities: [VERIFIER_CAPABILITY],
            classification,
          },
        }),
      );
      expect(selfResult.ok).toBe(false);
      if (!selfResult.ok) {
        expect(selfResult.denyReason).toBe("self_verification_denied");
        expect(selfResult.audit.verifierClassification).toBe(classification);
      }
    }
  });

  it("denies a verifier whose required capability was revoked before evaluation", () => {
    // The verifier HELD the capability when the work was performed; the fresh
    // held set at evaluation time no longer contains it (revocation).
    const revoked = attempt({
      verifier: { ...attempt().verifier, heldCapabilities: ["some:other-capability"] },
    });
    const result = evaluateVerification(item(), revoked);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denyReason).toBe("required_verifier_capability_not_held");
      expect(result.audit.eventKind).toBe("verdict_denied");
      expect(result.audit.requiredVerifierCapability).toBe(VERIFIER_CAPABILITY);
      expect(result.audit.selfVerificationAttempt).toBe(false);
    }
  });

  it("denies a verifier with an EMPTY held capability set (deny by default)", () => {
    const result = evaluateVerification(
      item(),
      attempt({ verifier: { ...attempt().verifier, heldCapabilities: [] } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denyReason).toBe("required_verifier_capability_not_held");
    }
  });

  it("denies an attempt against a work item with NO performer of record", () => {
    const result = evaluateVerification(
      item({ performerOfRecord: { status: "unrecorded" } }),
      attempt(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denyReason).toBe("performer_of_record_unrecorded");
      expect(result.audit.performerOfRecordRef).toBeNull();
    }
  });

  it("denies an attempt against a work item with an AMBIGUOUS performer of record", () => {
    const result = evaluateVerification(
      item({
        performerOfRecord: {
          status: "ambiguous",
          candidates: ["identity:worker-7", "identity:worker-8"],
        },
      }),
      attempt(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denyReason).toBe("performer_of_record_ambiguous");
      expect(result.audit.performerOfRecordRef).toBeNull();
    }
  });

  it("downgrades a blank 'recorded' performer ref to unrecorded (never guessed)", () => {
    const result = evaluateVerification(
      item({ performerOfRecord: { status: "recorded", identityRef: "   " } }),
      attempt(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denyReason).toBe("performer_of_record_unrecorded");
    }
  });

  it("denies a cross-tenant verifier (multi-tenancy law §13)", () => {
    const result = evaluateVerification(
      item(),
      attempt({ verifier: { ...attempt().verifier, tenantScope: "tenant-beta" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denyReason).toBe("cross_tenant_verifier_denied");
      expect(result.audit.tenantScope).toBe(TENANT);
    }
  });

  it("denies a malformed attempt (blank ids, unknown verdict, unparseable instant)", () => {
    const malformed: VerificationAttempt[] = [
      attempt({ attemptId: "  " }),
      attempt({ verifier: { ...attempt().verifier, identityRef: "" } }),
      attempt({ verdict: " rubber-stamped" as unknown as VerificationAttempt["verdict"] }),
      attempt({ reason: "" }),
      attempt({ verifiedAt: "not-a-time" }),
    ];
    for (const bad of malformed) {
      const result = evaluateVerification(item(), bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.denyReason).toBe("invalid_attempt");
        expect(result.audit.eventKind).toBe("verdict_denied");
        expect(result.audit.denyReason).toBe("invalid_attempt");
      }
    }
  });

  it("denies a malformed work item (blank item id, policy or capability declaration)", () => {
    const malformed: VerifiableWorkItem[] = [
      item({ itemId: "" }),
      item({ policyRef: " " }),
      item({ requiredVerifierCapability: "" }),
    ];
    for (const bad of malformed) {
      const result = evaluateVerification(bad, attempt());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.denyReason).toBe("invalid_item");
      }
    }
  });

  it("still audits a denial of a fully malformed attempt (observable, never silent)", () => {
    const result = evaluateVerification(item(), attempt({ verifiedAt: "nope" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.audit.eventKind).toBe("verdict_denied");
      expect(result.audit.attemptId).toBe("attempt:v-001");
      expect(result.audit.itemId).toBe("item:work-001");
      expect(result.audit.decidedAt).toBeNull();
      expect(result.audit.auditId).toBe("audit:attempt:v-001");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Valid independent verdicts — accepted and audited
 * ────────────────────────────────────────────────────────────*/

describe("valid independent verdict (accepted and audited)", () => {
  it("accepts an independent, capability-holding, same-tenant verifier", () => {
    const result = evaluateVerification(item(), attempt());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verdict.verifiedBy).toBe("identity:operator-2");
      expect(result.verdict.subjectItemId).toBe("item:work-001");
      expect(result.verdict.subjectPerformerRef).toBe("identity:worker-7");
      expect(result.verdict.verdict).toBe("verified");
      expect(result.verdict.policyRef).toBe(POLICY);
      expect(result.verdict.requiredVerifierCapability).toBe(VERIFIER_CAPABILITY);
      expect(result.verdict.verifiedAt).toBe(NOW);
      expect(result.audit.eventKind).toBe("verdict_issued");
      expect(result.audit.denyReason).toBeNull();
      expect(result.audit.selfVerificationAttempt).toBe(false);
      expect(result.audit.auditId).toBe("audit:attempt:v-001");
      expect(result.audit.performerOfRecordRef).toBe("identity:worker-7");
    }
  });

  it("accepts an INDEPENDENT REJECTION — a reviewer may reject another worker's work", () => {
    const result = evaluateVerification(item(), attempt({ verdict: "rejected" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verdict.verdict).toBe("rejected");
      expect(result.audit.attemptedVerdict).toBe("rejected");
    }
  });

  it("records AI-or-human provenance for the verifier (Constitution §12)", () => {
    const human = evaluateVerification(
      item(),
      attempt({ verifier: { ...attempt().verifier, classification: "human" } }),
    );
    const ai = evaluateVerification(
      item({ performerOfRecord: { status: "recorded", identityRef: "identity:human-worker" } }),
      attempt({
        verifier: {
          ...attempt().verifier,
          identityRef: "identity:ai-verifier",
          classification: "ai",
        },
      }),
    );
    const unclassified = evaluateVerification(
      item(),
      attempt({ verifier: { ...attempt().verifier, classification: undefined } }),
    );
    expect(human.ok && human.verdict.verifiedByClassification).toBe("human");
    expect(ai.ok && ai.verdict.verifiedByClassification).toBe("ai");
    expect(unclassified.ok && unclassified.verdict.verifiedByClassification).toBe("unclassified");
  });

  it("records provenance for an AI worker verified by a human (§12/§43 golden questions)", () => {
    const result = evaluateVerification(
      item({ performerOfRecord: { status: "recorded", identityRef: "identity:ai-worker-1" } }),
      attempt(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // WHO verified WHAT, under WHICH POLICY, WHEN — and it was not self.
      expect(result.verdict.verifiedBy).toBe("identity:operator-2");
      expect(result.verdict.subjectPerformerRef).toBe("identity:ai-worker-1");
      expect(result.verdict.policyRef).toBe(POLICY);
      expect(result.verdict.verifiedAt).toBe(NOW);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Helper semantics (pure primitives behind the contract)
 * ────────────────────────────────────────────────────────────*/

describe("helper semantics", () => {
  it("resolves performer-of-record states fail-closed", () => {
    expect(resolvePerformerOfRecord({ status: "recorded", identityRef: " identity:x " })).toEqual({
      status: "recorded",
      identityRef: "identity:x",
    });
    expect(resolvePerformerOfRecord({ status: "recorded", identityRef: "" })).toEqual({
      status: "unrecorded",
    });
    expect(
      resolvePerformerOfRecord({ status: "ambiguous", candidates: [" a ", "a", " b"] }),
    ).toEqual({ status: "ambiguous", candidates: ["a", "b"] });
    expect(resolvePerformerOfRecord({ status: "ambiguous", candidates: ["a"] })).toEqual({
      status: "recorded",
      identityRef: "a",
    });
    expect(resolvePerformerOfRecord({ status: "ambiguous", candidates: [] })).toEqual({
      status: "unrecorded",
    });
  });

  it("detects self-verification over trimmed refs", () => {
    expect(isSelfVerification("identity:a", "identity:a")).toBe(true);
    expect(isSelfVerification("identity:a ", " identity:a")).toBe(true);
    expect(isSelfVerification("identity:a", "identity:b")).toBe(false);
  });

  it("checks held capabilities against a trimmed, deduplicated set", () => {
    expect(
      holdsVerifierCapability(
        { identityRef: "v", tenantScope: TENANT, heldCapabilities: [" c1 ", "c1", "c2"] },
        "c2",
      ),
    ).toBe(true);
    expect(
      holdsVerifierCapability(
        { identityRef: "v", tenantScope: TENANT, heldCapabilities: ["c1"] },
        "c2",
      ),
    ).toBe(false);
  });
});
