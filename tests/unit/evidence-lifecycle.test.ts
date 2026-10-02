/**
 * CoreGrid — Evidence lifecycle tests (J-033 / V1CAP-058 / MISSION-R-91).
 *
 * Proves the lifecycle contract of `lib/evidence/capture.ts` additively over
 * the wave-2 capture suites:
 *  1. Revocation flow — an AUTHORIZED revoker revokes with reason + evidence
 *     ref; missing authorization or an AI revoker is rejected; revocation is
 *     append-only (original + act + mirror retained, nothing deleted); double
 *     revocation is rejected; revoked evidence can never be promoted or
 *     superseded.
 *  2. Consumption gate — REVOKED evidence cannot silently support active
 *     claims: the gate rejects claims citing revoked evidence, and claims
 *     previously supported by now-revoked evidence are FLAGGED for
 *     re-verification, never silently left (E-018 invariants 12–13).
 *  3. Staleness — evidence past its validity window is stale: surfaced via
 *     freshness/verdicts, never silently served.
 *  4. Sufficiency — declared per capture, evaluatable against explicit
 *     requirements; a declared assessment can never rescue revoked, stale or
 *     under-confident evidence.
 *  5. Confidence — bounded scale, provenance-cited; an uncited declared
 *     confidence is unusable.
 *  6. Retention — every record carries its retention policy id (ADR-005);
 *     missing policy is a capture-time failure; the binding survives every
 *     lifecycle transition.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
  EVIDENCE_OBJECT_TYPE,
  EvidenceCaptureError,
  auditClaimSupport,
  captureEvidence,
  evidenceFreshness,
  evaluateSufficiency,
  isEvidenceRevoked,
  isEvidenceStale,
  isProvenanceCitedConfidence,
  promoteEvidence,
  requireCanonicalTruthSupport,
  requireProvenanceCitedConfidence,
  requireServableEvidence,
  resolveRevokedEvidenceIds,
  revokeEvidence,
  supersedeEvidence,
  type CapturedEvidence,
  type EvidenceCaptureInput,
  type RevocationActInput,
} from "@/lib/evidence/capture";
import { validateKernelRowEnvelope } from "@/lib/kernel/reality";

const NOW = "2026-10-01T12:00:00.000Z";
const LATER = "2026-10-01T15:00:00.000Z";
const NEXT_DAY = "2026-10-02T12:00:00.000Z";
const TENANT_A = "tenant-alpha";
const GATEWAY = "sensor-gateway-01";
const REVOKER = "registrar-office-01";
const AUTHORIZATION = "policy:trust-fabric:revocation-authority";

function captureInput(overrides?: Partial<EvidenceCaptureInput>): EvidenceCaptureInput {
  return {
    evidenceId: "ev-100",
    evidenceType: "attendance_event",
    tenantId: TENANT_A,
    evidenceClass: "direct_observation",
    claim: { event: "student_checked_in" },
    confidence: 0.97,
    confidenceBasis: "sensor-calibration:reader-2",
    observedAt: NOW,
    capturedBy: GATEWAY,
    capturedAt: NOW,
    sourceRef: "reader/2",
    lineage: [],
    retentionPolicyId: DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
    envelope: {
      objectType: EVIDENCE_OBJECT_TYPE,
      schemaVersion: "1.0",
      status: "active",
      createdBy: GATEWAY,
      updatedBy: GATEWAY,
      provenance: {
        source: "field-sensor",
        sourceRef: "reader/2",
        recordedBy: GATEWAY,
        originTenantId: TENANT_A,
        generatedByAi: false,
        verified: true,
      },
      policyContext: { purpose: "attendance" },
      traceId: "trace-lc-1",
      correlationId: "corr-lc-1",
      declaredOrigin: "capture-boot",
    },
    ...overrides,
  };
}

function revocationAct(overrides?: Partial<RevocationActInput>): RevocationActInput {
  return {
    revokedBy: REVOKER,
    authorization: AUTHORIZATION,
    reason: "sensor reader 2 was found miscalibrated; the observation is retracted",
    reasonEvidenceRef: "ev-calibration-incident-42",
    revokedAt: LATER,
    ...overrides,
  };
}

/** Revoked record sets used by the claim-audit suites. */
function revokedSet(): {
  original: CapturedEvidence;
  revocationAct: CapturedEvidence;
  revoked: CapturedEvidence;
} {
  const original = captureEvidence(captureInput());
  const result = revokeEvidence(original, revocationAct());
  return {
    original: result.retained,
    revocationAct: result.revocationAct,
    revoked: result.revoked,
  };
}

describe("revocation: authorized recorded act (append-only)", () => {
  it("revokes through an authorized act, retaining every record", () => {
    const original = captureEvidence(captureInput());
    const before = structuredClone(original);

    const result = revokeEvidence(original, revocationAct());

    // Original retained verbatim — revocation never deletes or mutates.
    expect(result.retained).toBe(original);
    expect(result.retained).toEqual(before);
    expect(Object.isFrozen(result.retained)).toBe(true);
    expect(isEvidenceRevoked(result.retained)).toBe(false);

    // Revocation-mirror record: carries the act, points at the original.
    expect(result.revoked.evidence_id).toBe("ev-100:revoked");
    expect(result.revoked.revokes).toBe("ev-100");
    expect(result.revoked.revocation).not.toBeNull();
    expect(result.revoked.revocation?.revokedBy).toBe(REVOKER);
    expect(result.revoked.revocation?.authorization).toBe(AUTHORIZATION);
    expect(result.revoked.revocation?.reasonEvidenceRef).toBe("ev-calibration-incident-42");
    expect(result.revoked.revocation?.actEvidenceId).toBe("ev-100:revocation-act");
    expect(result.revoked.lineage).toEqual(["ev-100"]);
    expect(result.revoked.tenant_id).toBe(TENANT_A);
    // A revoked record is NEVER canonical-truth eligible, even though its
    // class is direct_observation.
    expect(result.revoked.canonical_truth_eligible).toBe(false);
    expect(result.revoked.evidence_class).toBe("direct_observation");
    expect(() => requireCanonicalTruthSupport(result.revoked)).toThrow(EvidenceCaptureError);

    // The act is itself evidence-bearing (attested).
    expect(result.revocationAct.evidence_class).toBe("attested");
    expect(result.revocationAct.evidence_id).toBe("ev-100:revocation-act");
    expect(result.revocationAct.claim.revocation_act).toMatchObject({
      revoked_by: REVOKER,
      authorization: AUTHORIZATION,
      target_evidence_id: "ev-100",
      reason_evidence_ref: "ev-calibration-incident-42",
    });

    // Nothing was deleted: all three records persist and conform to the
    // kernel envelope.
    for (const record of [result.retained, result.revoked, result.revocationAct]) {
      const row = { ...record, id: record.evidence_id };
      expect(() => validateKernelRowEnvelope(row, [EVIDENCE_OBJECT_TYPE])).not.toThrow();
    }
  });

  it("requires explicit authorization — no anonymous or self-granted revocation", () => {
    const original = captureEvidence(captureInput());
    try {
      revokeEvidence(original, revocationAct({ authorization: "   " }));
      expect.unreachable("revocation without authorization must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("revocation_not_authorized");
    }
    try {
      revokeEvidence(original, revocationAct({ authorization: undefined as never }));
      expect.unreachable("revocation without an authorization field must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("revocation_not_authorized");
    }
  });

  it("rejects an AI revoker (Constitution §21: AI output is untrusted)", () => {
    const original = captureEvidence(captureInput());
    try {
      revokeEvidence(original, revocationAct({ revokedBy: "ai-agent:revoker-7" }));
      expect.unreachable("an AI revoker must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("revocation_not_authorized");
    }
  });

  it("rejects malformed acts: reason, evidence ref, temporal impossibility", () => {
    const original = captureEvidence(captureInput());
    expect(() => revokeEvidence(original, revocationAct({ reason: "" }))).toThrow(
      EvidenceCaptureError,
    );
    expect(() =>
      revokeEvidence(original, revocationAct({ reasonEvidenceRef: "" })),
    ).toThrow(EvidenceCaptureError);
    try {
      revokeEvidence(original, revocationAct({ revokedAt: "2026-09-30T00:00:00.000Z" }));
      expect.unreachable("revocation preceding capture must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("invalid_revocation_act");
    }
  });

  it("refuses double revocation (one-time recorded act)", () => {
    const { revoked } = revokedSet();
    try {
      revokeEvidence(revoked, revocationAct());
      expect.unreachable("double revocation must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("evidence_already_revoked");
    }
  });

  it("keeps revoked evidence terminal: never promotable, never supersessable", () => {
    const original = captureEvidence(captureInput({ evidenceClass: "predicted" }));
    const { revoked } = revokeEvidence(original, revocationAct());
    expect(() =>
      promoteEvidence(revoked, {
        validatorId: "human-verifier-01",
        method: "human_review",
        validatedAt: NEXT_DAY,
      }),
    ).toThrow(EvidenceCaptureError);
    try {
      supersedeEvidence(revoked, captureInput({ evidenceId: "ev-101" }));
      expect.unreachable("superseding revoked evidence must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("evidence_revoked");
    }
  });

  it("inherits the retention policy binding through the revocation records", () => {
    const original = captureEvidence(
      captureInput({ retentionPolicyId: "retention:evidence:edu-7y" }),
    );
    const result = revokeEvidence(original, revocationAct());
    expect(result.revoked.retention_policy_id).toBe("retention:evidence:edu-7y");
    expect(result.revocationAct.retention_policy_id).toBe("retention:evidence:edu-7y");
  });

  it("resolves the revoked-id set over a mixed record set", () => {
    const { original, revoked, revocationAct } = revokedSet();
    const live = captureEvidence(captureInput({ evidenceId: "ev-200" }));
    const revokedIds = resolveRevokedEvidenceIds([original, revoked, revocationAct, live]);
    expect(revokedIds.has("ev-100")).toBe(true);
    expect(revokedIds.has("ev-100:revoked")).toBe(true);
    expect(revokedIds.has("ev-200")).toBe(false);
  });
});

describe("consumption gate: revoked evidence cannot silently support active claims", () => {
  it("rejects a claim citing revoked evidence", () => {
    const { original, revoked, revocationAct } = revokedSet();
    const audit = auditClaimSupport(
      { claimId: "claim-1", evidenceIds: ["ev-100"] },
      [original, revoked, revocationAct],
    );
    expect(audit.verdict).toBe("rejected_revoked_evidence");
    expect(audit.servable).toBe(false);
    expect(audit.reasons[0]).toContain("REVOKED");
  });

  it("flags a previously supported claim for re-verification — never silently left", () => {
    const { original, revoked, revocationAct } = revokedSet();
    const audit = auditClaimSupport(
      { claimId: "claim-1", evidenceIds: ["ev-100"], previouslySupported: true },
      [original, revoked, revocationAct],
    );
    expect(audit.verdict).toBe("flagged_re_verification_revoked");
    expect(audit.flagged).toBe(true);
    expect(audit.servable).toBe(false);
    expect(audit.reasons[0]).toContain("re-verification");
  });

  it("keeps the single-record gate rejecting revoked evidence with the revocation code", () => {
    const { revoked } = revokedSet();
    try {
      requireCanonicalTruthSupport(revoked);
      expect.unreachable("revoked evidence must never pass the canonical-truth gate");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("evidence_revoked");
    }
    try {
      requireServableEvidence(revoked);
      expect.unreachable("revoked evidence must never be servable");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("evidence_revoked");
    }
  });

  it("keeps active claims servable while the revoked set coexists", () => {
    const { original, revoked, revocationAct } = revokedSet();
    const live = captureEvidence(captureInput({ evidenceId: "ev-200" }));
    const audit = auditClaimSupport(
      { claimId: "claim-2", evidenceIds: ["ev-200"] },
      [original, revoked, revocationAct, live],
    );
    expect(audit.verdict).toBe("supported");
    expect(audit.servable).toBe(true);
    expect(audit.flagged).toBe(false);
  });
});

describe("staleness: validity windows surfaced, not served", () => {
  function windowedEvidence(overrides?: Partial<EvidenceCaptureInput>): CapturedEvidence {
    return captureEvidence(
      captureInput({
        validFrom: "2026-10-01T00:00:00.000Z",
        validUntil: "2026-10-02T00:00:00.000Z",
        ...overrides,
      }),
    );
  }

  it("classifies freshness across the window", () => {
    const record = windowedEvidence();
    expect(evidenceFreshness(record, "2026-10-01T12:00:00.000Z")).toBe("fresh");
    expect(evidenceFreshness(record, "2026-10-01T00:00:00.000Z")).toBe("fresh");
    expect(evidenceFreshness(record, "2026-10-02T00:00:00.000Z")).toBe("stale");
    expect(evidenceFreshness(record, "2026-09-30T23:59:59.999Z")).toBe("not_yet_valid");
    expect(isEvidenceStale(record, NEXT_DAY)).toBe(true);
    expect(isEvidenceStale(record, NOW)).toBe(false);
  });

  it("treats an unwindowed record as unbounded, never stale by window", () => {
    const record = captureEvidence(captureInput());
    expect(evidenceFreshness(record, NEXT_DAY)).toBe("unbounded");
    expect(isEvidenceStale(record, NEXT_DAY)).toBe(false);
  });

  it("never serves stale evidence through the consumption gate", () => {
    const record = windowedEvidence();
    try {
      requireServableEvidence(record, NEXT_DAY);
      expect.unreachable("stale evidence must not be served");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("evidence_stale");
    }
    expect(() => requireServableEvidence(record, NOW)).not.toThrow();
  });

  it("flags (not serves) a claim citing stale evidence at the audit instant", () => {
    const record = windowedEvidence();
    const audit = auditClaimSupport(
      { claimId: "claim-3", evidenceIds: [record.evidence_id] },
      [record],
      { asOf: NEXT_DAY },
    );
    expect(audit.verdict).toBe("flagged_stale_evidence");
    expect(audit.flagged).toBe(true);
    expect(audit.servable).toBe(false);
    // The same set at a fresh instant is supported.
    const fresh = auditClaimSupport(
      { claimId: "claim-3", evidenceIds: [record.evidence_id] },
      [record],
      { asOf: NOW },
    );
    expect(fresh.verdict).toBe("supported");
    expect(fresh.servable).toBe(true);
  });

  it("propagates the validity window through promotion", () => {
    const quarantined = captureEvidence(
      captureInput({
        evidenceClass: "predicted",
        validFrom: "2026-10-01T00:00:00.000Z",
        validUntil: "2026-10-02T00:00:00.000Z",
      }),
    );
    const { promoted } = promoteEvidence(quarantined, {
      validatorId: "human-verifier-01",
      method: "human_review",
      validatedAt: NOW,
    });
    expect(promoted.valid_from).toBe("2026-10-01T00:00:00.000Z");
    expect(promoted.valid_until).toBe("2026-10-02T00:00:00.000Z");
    expect(isEvidenceStale(promoted, NEXT_DAY)).toBe(true);
  });
});

describe("sufficiency: declared per capture, evaluatable fail-closed", () => {
  it("evaluates sufficient against an explicit requirement", () => {
    const record = captureEvidence(captureInput());
    const evaluation = evaluateSufficiency(record, {
      minConfidence: 0.9,
      requireCanonicalTruth: true,
      asOf: NOW,
    });
    expect(evaluation.verdict).toBe("sufficient");
    expect(evaluation.reasons).toEqual([]);
  });

  it("never calls revoked evidence sufficient, regardless of declared assessment", () => {
    const original = captureEvidence(
      captureInput({
        sufficiency: { verdict: "sufficient", assessedBy: "operator-07", assessedAt: NOW },
      }),
    );
    const { revoked } = revokeEvidence(original, revocationAct());
    const evaluation = evaluateSufficiency(revoked, { minConfidence: 0.5, asOf: NOW });
    expect(evaluation.verdict).toBe("insufficient");
    expect(evaluation.reasons.some((reason) => reason.includes("revoked"))).toBe(true);
  });

  it("fails the confidence floor and demands provenance-cited confidence", () => {
    const low = captureEvidence(captureInput({ confidence: 0.4 }));
    expect(evaluateSufficiency(low, { minConfidence: 0.9 }).verdict).toBe("insufficient");

    const uncited = captureEvidence(captureInput({ confidenceBasis: null }));
    expect(isProvenanceCitedConfidence(uncited)).toBe(false);
    const evaluation = evaluateSufficiency(uncited, { minConfidence: 0.5 });
    expect(evaluation.verdict).toBe("insufficient");
    expect(evaluation.reasons.some((reason) => reason.includes("confidence_basis"))).toBe(true);
    expect(() => requireProvenanceCitedConfidence(uncited)).toThrow(EvidenceCaptureError);
  });

  it("demands canonical-truth support when the requirement says so", () => {
    const quarantined = captureEvidence(captureInput({ evidenceClass: "derived" }));
    const evaluation = evaluateSufficiency(quarantined, { requireCanonicalTruth: true });
    expect(evaluation.verdict).toBe("insufficient");
    // After promotion the requirement passes.
    const { promoted } = promoteEvidence(quarantined, {
      validatorId: "human-verifier-01",
      method: "human_review",
      validatedAt: NOW,
    });
    expect(evaluateSufficiency(promoted, { requireCanonicalTruth: true }).verdict).toBe(
      "sufficient",
    );
  });

  it("a declared assessment can lower but never raise the verdict", () => {
    const provisional = captureEvidence(
      captureInput({
        sufficiency: { verdict: "provisional", assessedBy: "operator-07", assessedAt: NOW },
      }),
    );
    expect(evaluateSufficiency(provisional).verdict).toBe("provisional");
    const declaredInsufficient = captureEvidence(
      captureInput({
        sufficiency: {
          verdict: "insufficient",
          assessedBy: "operator-07",
          assessedAt: NOW,
          rationale: "awaiting the second reader observation",
        },
      }),
    );
    expect(evaluateSufficiency(declaredInsufficient).verdict).toBe("insufficient");
  });

  it("fails closed against an out-of-range confidence floor", () => {
    const record = captureEvidence(captureInput());
    expect(() => evaluateSufficiency(record, { minConfidence: 1.5 })).toThrow(
      EvidenceCaptureError,
    );
  });
});

describe("claim audit: verdict partition (fail-closed)", () => {
  it("rejects a canonical claim resting only on quarantine evidence", () => {
    const derived = captureEvidence(captureInput({ evidenceId: "ev-300", evidenceClass: "derived" }));
    const audit = auditClaimSupport({ claimId: "claim-4", evidenceIds: ["ev-300"] }, [derived]);
    expect(audit.verdict).toBe("rejected_quarantine_only");
    expect(audit.servable).toBe(false);
  });

  it("rejects a claim citing no evidence or evidence absent from the set", () => {
    const record = captureEvidence(captureInput());
    const none = auditClaimSupport({ claimId: "claim-5", evidenceIds: [] }, [record]);
    expect(none.verdict).toBe("rejected_no_evidence");
    const dangling = auditClaimSupport({ claimId: "claim-6", evidenceIds: ["ev-missing"] }, [record]);
    expect(dangling.verdict).toBe("rejected_no_evidence");
  });

  it("flags a claim citing evidence declared insufficient", () => {
    const weak = captureEvidence(
      captureInput({
        evidenceId: "ev-301",
        sufficiency: { verdict: "insufficient", assessedBy: "operator-07", assessedAt: NOW },
      }),
    );
    const audit = auditClaimSupport({ claimId: "claim-7", evidenceIds: ["ev-301"] }, [weak]);
    expect(audit.verdict).toBe("flagged_insufficient_sufficiency");
    expect(audit.servable).toBe(false);
  });
});

describe("retention: ADR-005 machine-readable policy binding", () => {
  it("keeps missing retention policy a capture-time failure across the lifecycle entries", () => {
    const unpolicied = { ...captureInput(), retentionPolicyId: undefined };
    expect(() => captureEvidence(unpolicied)).toThrow(EvidenceCaptureError);
    expect(() => captureEvidence(unpolicied, undefined, { knownRetentionPolicies: [] })).toThrow(
      /retention_policy/,
    );
  });

  it("retains the append-only discipline: revocation deletes nothing", () => {
    const original = captureEvidence(captureInput());
    const result = revokeEvidence(original, revocationAct());
    const recordSet = [result.retained, result.revoked, result.revocationAct];
    expect(recordSet).toHaveLength(3);
    expect(recordSet.map((record) => record.evidence_id)).toEqual([
      "ev-100",
      "ev-100:revoked",
      "ev-100:revocation-act",
    ]);
    // The original claim content is intact verbatim.
    expect(result.retained.claim).toEqual({ event: "student_checked_in" });
    expect(result.retained.revocation).toBeNull();
    expect(result.retained.revokes).toBeNull();
  });
});
