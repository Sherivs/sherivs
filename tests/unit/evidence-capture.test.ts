/**
 * CoreGrid — Evidence-class capture discipline tests (J-034 / V1CAP-059 /
 * MISSION-R-90).
 *
 * Proves the capture-time invariants of `lib/evidence/capture.ts`:
 *  1. Class discipline — every registered class captures correctly; only
 *     direct_observation is canonical-truth eligible; the other five classes
 *     are quarantine-classed.
 *  2. Fail-closed capture — no anonymous evidence, no invented classes, no
 *     envelope violations.
 *  3. Laundering prevention — direct_observation claims carrying AI-generated
 *     provenance markers are rejected; the same provenance is accepted for
 *     quarantine classes.
 *  4. Promotion flow — quarantine evidence reaches direct_observation only via
 *     an explicit, recorded validation act (append-only; original + act
 *     retained); AI validators are rejected.
 *  5. No destructive update — superseded evidence is retained verbatim.
 *  6. Envelope compatibility — captured records conform to the canonical
 *     kernel row envelope.
 *  7. Cross-tenant isolation — capture, supersession and promotion never
 *     cross tenants.
 */

import { describe, expect, it } from "vitest";
import {
  AI_PROVENANCE_MARKERS,
  DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
  EVIDENCE_CLASSES,
  EVIDENCE_OBJECT_TYPE,
  EvidenceCaptureError,
  captureEvidence,
  isProvenanceCitedConfidence,
  isQuarantineEvidenceClass,
  provenanceCarriesAiMarkers,
  promoteEvidence,
  requireCanonicalTruthSupport,
  requireProvenanceCitedConfidence,
  supersedeEvidence,
  supportsCanonicalTruth,
  type CapturedEvidence,
  type EvidenceCaptureInput,
  type EvidenceClass,
  type ValidationActInput,
} from "@/lib/evidence/capture";
import type { KernelObjectEnvelopeInput } from "@/lib/kernel/reality";
import { KERNEL_ENVELOPE_COLUMNS, validateKernelRowEnvelope } from "@/lib/kernel/reality";

const NOW = "2026-10-01T12:00:00.000Z";
const TENANT_A = "tenant-alpha";
const TENANT_B = "tenant-beta";
const GATEWAY = "sensor-gateway-01";

function envelopeInput(overrides?: Partial<KernelObjectEnvelopeInput>): KernelObjectEnvelopeInput {
  return {
    objectType: EVIDENCE_OBJECT_TYPE,
    schemaVersion: "1.0",
    status: "active",
    createdBy: GATEWAY,
    updatedBy: GATEWAY,
    provenance: {
      source: "field-sensor",
      sourceRef: "sensor/door-3",
      recordedBy: GATEWAY,
      originTenantId: TENANT_A,
      generatedByAi: false,
      verified: true,
    },
    policyContext: { purpose: "attendance" },
    traceId: "trace-1",
    correlationId: "corr-1",
    declaredOrigin: "capture-boot",
    ...overrides,
  };
}

function captureInputFor(
  evidenceClass: EvidenceClass,
  overrides?: Partial<EvidenceCaptureInput>,
): EvidenceCaptureInput {
  return {
    evidenceId: "ev-001",
    evidenceType: "door_event",
    tenantId: TENANT_A,
    evidenceClass,
    claim: { event: "door_opened" },
    confidence: 0.98,
    confidenceBasis: "sensor-calibration:door-3",
    observedAt: NOW,
    capturedBy: GATEWAY,
    capturedAt: NOW,
    sourceRef: "sensor/door-3",
    lineage: [],
    retentionPolicyId: DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
    envelope: envelopeInput(),
    ...overrides,
  };
}

function aiEnvelopeOverrides(): Partial<KernelObjectEnvelopeInput> {
  return {
    provenance: {
      source: "ai-gateway:completion-1",
      sourceRef: "gateway/run/42",
      recordedBy: "ai-gateway",
      originTenantId: TENANT_A,
      generatedByAi: true,
      verified: false,
    },
  };
}

describe("evidence capture: class discipline (J-034)", () => {
  it("registers exactly the six canonical evidence classes", () => {
    expect(EVIDENCE_CLASSES).toEqual([
      "direct_observation",
      "generated",
      "simulated",
      "predicted",
      "derived",
      "attested",
    ]);
  });

  it("captures every class correctly with the right canonical-truth eligibility", () => {
    for (const evidenceClass of EVIDENCE_CLASSES) {
      const record = captureEvidence(captureInputFor(evidenceClass));
      expect(record.evidence_class).toBe(evidenceClass);
      expect(record.evidence_id).toBe("ev-001");
      expect(record.canonical_truth_eligible).toBe(evidenceClass === "direct_observation");
      expect(record.prior_class).toBeNull();
      expect(record.supersedes).toBeNull();
      expect(record.promotion).toBeNull();
      expect(Object.isFrozen(record)).toBe(true);
      expect(supportsCanonicalTruth(record)).toBe(evidenceClass === "direct_observation");
      expect(isQuarantineEvidenceClass(evidenceClass)).toBe(evidenceClass !== "direct_observation");
    }
  });

  it("is direct_observation the ONLY canonical-truth class", () => {
    const direct = captureEvidence(captureInputFor("direct_observation"));
    expect(() => requireCanonicalTruthSupport(direct)).not.toThrow();

    for (const quarantineClass of EVIDENCE_CLASSES.filter(isQuarantineEvidenceClass)) {
      const record = captureEvidence(captureInputFor(quarantineClass));
      expect(() => requireCanonicalTruthSupport(record)).toThrow(EvidenceCaptureError);
      try {
        requireCanonicalTruthSupport(record);
        expect.unreachable("quarantine evidence must never pass the canonical-truth gate");
      } catch (error) {
        expect((error as EvidenceCaptureError).code).toBe("not_canonical_truth_eligible");
      }
    }
  });
});

describe("evidence capture: fail-closed capture", () => {
  it("rejects a record without a class (no anonymous evidence)", () => {
    const anonymous = { ...captureInputFor("generated"), evidenceClass: undefined };
    try {
      captureEvidence(anonymous);
      expect.unreachable("anonymous evidence must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(EvidenceCaptureError);
      expect((error as EvidenceCaptureError).code).toBe("anonymous_evidence");
    }
  });

  it("rejects an unknown evidence class", () => {
    const invented = {
      ...captureInputFor("generated"),
      evidenceClass: "telepathic" as never,
    };
    expect(() => captureEvidence(invented)).toThrow(EvidenceCaptureError);
    try {
      captureEvidence(invented);
      expect.unreachable("unknown class must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("unknown_evidence_class");
    }
  });

  it("rejects an envelope without an explicit causation chain root", () => {
    const envelope = envelopeInput({
      declaredOrigin: null,
      causationId: null,
      parentEventId: null,
    });
    expect(() => captureEvidence(captureInputFor("generated", { envelope }))).toThrow(
      /causation chain root must be explicit/,
    );
  });

  it("rejects envelope provenance without a source", () => {
    const envelope = envelopeInput({
      provenance: {
        source: "",
        originTenantId: TENANT_A,
        generatedByAi: false,
        verified: false,
      },
    });
    expect(() => captureEvidence(captureInputFor("generated", { envelope }))).toThrow(
      /provenance\.source/,
    );
  });

  it("rejects a non-evidence envelope object_type", () => {
    const envelope = envelopeInput({ objectType: "core.observation" });
    try {
      captureEvidence(captureInputFor("generated", { envelope }));
      expect.unreachable("non-evidence object_type must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("invalid_evidence_field");
    }
  });

  it("rejects a captured_by that disagrees with the envelope created_by", () => {
    try {
      captureEvidence(captureInputFor("generated", { capturedBy: "someone-else" }));
      expect.unreachable("captured_by mismatch must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("invalid_evidence_field");
    }
  });

  it("rejects malformed claim, confidence and timestamps", () => {
    expect(() =>
      captureEvidence(
        captureInputFor("generated", { claim: [] as unknown as Record<string, unknown> }),
      ),
    ).toThrow(/claim must be a JSON object/);
    expect(() => captureEvidence(captureInputFor("generated", { confidence: 1.5 }))).toThrow(
      /confidence/,
    );
    expect(() =>
      captureEvidence(captureInputFor("generated", { capturedAt: "not-a-time" })),
    ).toThrow(/captured_at/);
    expect(() =>
      captureEvidence(captureInputFor("generated", { observedAt: "yesterday" })),
    ).toThrow(/observed_at/);
  });
});

describe("evidence capture: laundering prevention (J-034 / E-017)", () => {
  it("rejects direct_observation claiming AI-generated provenance", () => {
    try {
      captureEvidence(
        captureInputFor("direct_observation", {
          sourceRef: null,
          envelope: envelopeInput(aiEnvelopeOverrides()),
        }),
      );
      expect.unreachable("class laundering must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("class_laundering_rejected");
    }
  });

  it("rejects direct_observation with an AI marker in the producing source", () => {
    const envelope = envelopeInput({
      provenance: {
        source: "llm-output",
        sourceRef: null,
        recordedBy: GATEWAY,
        originTenantId: TENANT_A,
        generatedByAi: false,
        verified: true,
      },
    });
    expect(() =>
      captureEvidence(captureInputFor("direct_observation", { envelope, sourceRef: null })),
    ).toThrow(EvidenceCaptureError);
  });

  it("rejects direct_observation with an AI marker in the sourceRef", () => {
    const envelope = envelopeInput({
      provenance: {
        source: "field-sensor",
        sourceRef: "predicted-by-model-7",
        recordedBy: GATEWAY,
        originTenantId: TENANT_A,
        generatedByAi: false,
        verified: true,
      },
    });
    try {
      captureEvidence(captureInputFor("direct_observation", { envelope, sourceRef: null }));
      expect.unreachable("AI marker in sourceRef must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("class_laundering_rejected");
    }
  });

  it("rejects direct_observation captured by an AI identity", () => {
    const envelope = envelopeInput({
      createdBy: "agent:ai-worker-3",
      updatedBy: "agent:ai-worker-3",
    });
    try {
      captureEvidence(
        captureInputFor("direct_observation", { capturedBy: "agent:ai-worker-3", envelope }),
      );
      expect.unreachable("AI capture identity claiming direct observation must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("class_laundering_rejected");
    }
  });

  it("accepts the same AI provenance for quarantine classes (their purpose)", () => {
    const input = captureInputFor("generated", {
      sourceRef: null,
      envelope: envelopeInput(aiEnvelopeOverrides()),
    });
    const record = captureEvidence(input);
    expect(record.evidence_class).toBe("generated");
    expect(record.canonical_truth_eligible).toBe(false);
    expect(record.provenance.generatedByAi).toBe(true);
    expect(() => requireCanonicalTruthSupport(record)).toThrow(EvidenceCaptureError);
  });

  it("exposes a deterministic, auditable AI marker vocabulary", () => {
    expect(AI_PROVENANCE_MARKERS.length).toBeGreaterThan(0);
    expect(provenanceCarriesAiMarkers({ source: "field-sensor", generatedByAi: false })).toBe(
      false,
    );
    expect(provenanceCarriesAiMarkers({ source: "field-sensor", generatedByAi: true })).toBe(true);
    expect(provenanceCarriesAiMarkers({ source: "Simulated-Environment-2" })).toBe(true);
    expect(provenanceCarriesAiMarkers({ source: "inferred-from-ledger" })).toBe(true);
    expect(provenanceCarriesAiMarkers({ source: "field-sensor", sourceRef: "gpt-run-9" })).toBe(
      true,
    );
  });
});

describe("evidence promotion: explicit recorded validation act (J-034)", () => {
  it("promotes quarantine evidence through a recorded act, retaining everything", () => {
    const original = captureEvidence(captureInputFor("generated"));
    const before = structuredClone(original);

    const result = promoteEvidence(original, {
      validatorId: "human-verifier-01",
      method: "human_review",
      validatedAt: "2026-10-01T13:00:00.000Z",
      note: "confirmed against the physical door log",
    });

    // Retained: the original quarantine record, verbatim (append-only).
    expect(result.retained).toBe(original);
    expect(result.retained).toEqual(before);
    expect(result.retained.evidence_class).toBe("generated");

    // Promoted: a NEW direct_observation record carrying the recorded act.
    expect(result.promoted.evidence_class).toBe("direct_observation");
    expect(result.promoted.prior_class).toBe("generated");
    expect(result.promoted.canonical_truth_eligible).toBe(true);
    expect(result.promoted.evidence_id).toBe("ev-001:promoted");
    expect(result.promoted.tenant_id).toBe(TENANT_A);
    expect(result.promoted.lineage).toEqual(["ev-001"]);
    expect(result.promoted.provenance.source).toBe("evidence-promotion:human_review");
    expect(result.promoted.provenance.verified).toBe(true);
    expect(result.promoted.promotion).not.toBeNull();
    expect(result.promoted.promotion?.validatorId).toBe("human-verifier-01");
    expect(result.promoted.promotion?.method).toBe("human_review");
    expect(result.promoted.promotion?.validatedAt).toBe("2026-10-01T13:00:00.000Z");
    expect(result.promoted.promotion?.actEvidenceId).toBe("ev-001:validation-act");

    // The promotion is itself evidence-bearing: an attested validation-act record.
    expect(result.validationAct.evidence_class).toBe("attested");
    expect(result.validationAct.evidence_id).toBe("ev-001:validation-act");
    expect(result.validationAct.tenant_id).toBe(TENANT_A);
    expect(result.validationAct.lineage).toEqual(["ev-001"]);
    expect(result.validationAct.claim.validation_act).toMatchObject({
      validator_id: "human-verifier-01",
      method: "human_review",
      target_evidence_id: "ev-001",
      promoted_evidence_id: "ev-001:promoted",
    });

    // All three records retained and distinct.
    expect(result.promoted).not.toBe(result.validationAct);
    expect(() => requireCanonicalTruthSupport(result.promoted)).not.toThrow();
    expect(() => requireCanonicalTruthSupport(result.validationAct)).toThrow(EvidenceCaptureError);
  });

  it("refuses to promote direct_observation evidence (nothing to promote)", () => {
    const direct = captureEvidence(captureInputFor("direct_observation"));
    try {
      promoteEvidence(direct, {
        validatorId: "human-verifier-01",
        method: "human_review",
        validatedAt: NOW,
      });
      expect.unreachable("promotion of direct_observation must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("promotion_not_required");
    }
  });

  it("refuses double promotion (one-time recorded act)", () => {
    const original = captureEvidence(captureInputFor("predicted"));
    const first = promoteEvidence(original, {
      validatorId: "human-verifier-01",
      method: "instrument_recheck",
      validatedAt: "2026-10-01T13:00:00.000Z",
    });
    try {
      promoteEvidence(first.promoted, {
        validatorId: "human-verifier-01",
        method: "human_review",
        validatedAt: "2026-10-01T14:00:00.000Z",
      });
      expect.unreachable("double promotion must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("promotion_already_promoted");
    }
  });

  it("rejects malformed validation acts", () => {
    const original = captureEvidence(captureInputFor("derived"));
    const act: ValidationActInput = {
      validatorId: "human-verifier-01",
      method: "human_review",
      validatedAt: NOW,
    };

    expect(() => promoteEvidence(original, { ...act, validatorId: "   " })).toThrow(
      EvidenceCaptureError,
    );
    expect(() => promoteEvidence(original, { ...act, method: "vibes" as never })).toThrow(
      EvidenceCaptureError,
    );
    expect(() => promoteEvidence(original, { ...act, validatedAt: "soon" })).toThrow(
      EvidenceCaptureError,
    );
    try {
      promoteEvidence(original, { ...act, validatedAt: "2026-09-01T00:00:00.000Z" });
      expect.unreachable("act preceding capture must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("invalid_validation_act");
    }
  });

  it("rejects an AI validator (Constitution §21: AI never validates itself)", () => {
    const original = captureEvidence(captureInputFor("generated"));
    try {
      promoteEvidence(original, {
        validatorId: "ai-validator-01",
        method: "human_review",
        validatedAt: NOW,
      });
      expect.unreachable("AI validator must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("ai_validator_rejected");
    }
  });
});

describe("supersession: no destructive update", () => {
  it("retains the superseded record verbatim and lineage-links the successor", () => {
    const original = captureEvidence(captureInputFor("direct_observation"));
    const snapshot = structuredClone(original);

    const result = supersedeEvidence(
      original,
      captureInputFor("direct_observation", {
        evidenceId: "ev-002",
        claim: { event: "door_opened", corrected: true },
      }),
    );

    expect(result.retained).toBe(original);
    expect(result.retained).toEqual(snapshot);
    expect(Object.isFrozen(result.retained)).toBe(true);

    expect(result.successor.evidence_id).toBe("ev-002");
    expect(result.successor.supersedes).toBe("ev-001");
    expect(result.successor.lineage).toContain("ev-001");
    expect(result.successor.tenant_id).toBe(TENANT_A);
    expect(result.successor.evidence_class).toBe("direct_observation");
  });

  it("rejects a successor in another tenant", () => {
    const original = captureEvidence(captureInputFor("direct_observation"));
    try {
      supersedeEvidence(
        original,
        captureInputFor("direct_observation", { evidenceId: "ev-002", tenantId: TENANT_B }),
      );
      expect.unreachable("cross-tenant supersession must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("tenant_mismatch");
    }
  });

  it("rejects a successor reusing the retained record's id", () => {
    const original = captureEvidence(captureInputFor("direct_observation"));
    expect(() => supersedeEvidence(original, captureInputFor("direct_observation"))).toThrow(
      /must differ/,
    );
  });
});

describe("envelope compatibility (V1CAP-002)", () => {
  it("stamps every canonical envelope column onto the captured record", () => {
    const record = captureEvidence(captureInputFor("direct_observation"));
    for (const column of KERNEL_ENVELOPE_COLUMNS) {
      expect(record).toHaveProperty(column);
    }
    expect(record.object_type).toBe(EVIDENCE_OBJECT_TYPE);
    expect(record.schema_version).toBe("1.0");
    expect(record.provenance.originTenantId).toBe(TENANT_A);
    expect(record.causation_id ?? record.declared_origin).not.toBeNull();
  });

  it("passes the fail-closed persistent row envelope validation", () => {
    const record: CapturedEvidence = captureEvidence(captureInputFor("generated"));
    const row = { ...record, id: record.evidence_id };
    expect(() => validateKernelRowEnvelope(row, [EVIDENCE_OBJECT_TYPE])).not.toThrow();
  });

  it("honours the injected object-type registry gate (MISSION-R-11)", () => {
    expect(() =>
      captureEvidence(captureInputFor("generated"), ["core.entity", "core.event"]),
    ).toThrow(/is not registered/);
    expect(() =>
      captureEvidence(captureInputFor("generated"), [EVIDENCE_OBJECT_TYPE]),
    ).not.toThrow();
  });
});

describe("cross-tenant isolation", () => {
  it("rejects provenance whose origin tenant differs from the record tenant", () => {
    const envelope = envelopeInput({
      provenance: { ...envelopeInput().provenance, originTenantId: TENANT_B },
    });
    expect(() => captureEvidence(captureInputFor("generated", { envelope }))).toThrow(
      /cross-tenant/,
    );
  });

  it("keeps promotion within the original tenant", () => {
    const original = captureEvidence(captureInputFor("simulated"));
    const result = promoteEvidence(original, {
      validatorId: "human-verifier-01",
      method: "operator_ruling",
      validatedAt: "2026-10-01T13:00:00.000Z",
    });
    expect(result.promoted.tenant_id).toBe(TENANT_A);
    expect(result.validationAct.tenant_id).toBe(TENANT_A);
    expect(result.promoted.provenance.originTenantId).toBe(TENANT_A);
    expect(result.validationAct.provenance.originTenantId).toBe(TENANT_A);
  });

  it("keeps the validation act out of foreign tenants even for external validators", () => {
    const original = captureEvidence(captureInputFor("attested"));
    const result = promoteEvidence(original, {
      validatorId: "external-auditor-99",
      method: "cross_source_reconciliation",
      validatedAt: "2026-10-01T13:00:00.000Z",
    });
    expect(result.validationAct.tenant_id).toBe(TENANT_A);
    expect(result.promoted.tenant_id).toBe(TENANT_A);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Lifecycle capture-time gates (J-033 / V1CAP-058 / MISSION-R-91)
 * — additive over the wave-2 class-discipline suites above.
 * ────────────────────────────────────────────────────────────*/

describe("evidence lifecycle: retention policy binding (ADR-005)", () => {
  it("binds the declared retention policy id onto every captured record", () => {
    const record = captureEvidence(
      captureInputFor("direct_observation", { retentionPolicyId: "retention:evidence:edu-7y" }),
    );
    expect(record.retention_policy_id).toBe("retention:evidence:edu-7y");
  });

  it("rejects a record without a retention policy id (capture-time failure)", () => {
    const unpolicied = { ...captureInputFor("direct_observation"), retentionPolicyId: undefined };
    try {
      captureEvidence(unpolicied);
      expect.unreachable("evidence without a retention policy must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(EvidenceCaptureError);
      expect((error as EvidenceCaptureError).code).toBe("retention_policy_required");
    }
  });

  it("honours the injected retention policy registry gate (fail-closed)", () => {
    expect(() =>
      captureEvidence(captureInputFor("direct_observation"), undefined, {
        knownRetentionPolicies: [DEFAULT_EVIDENCE_RETENTION_POLICY_ID],
      }),
    ).not.toThrow();
    try {
      captureEvidence(
        captureInputFor("direct_observation", {
          retentionPolicyId: "retention:evidence:unknown",
        }),
        undefined,
        { knownRetentionPolicies: [DEFAULT_EVIDENCE_RETENTION_POLICY_ID] },
      );
      expect.unreachable("unregistered retention policy must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("unregistered_retention_policy");
    }
  });

  it("inherits the retention policy through promotion and the validation act", () => {
    const original = captureEvidence(
      captureInputFor("predicted", { retentionPolicyId: "retention:evidence:edu-7y" }),
    );
    const result = promoteEvidence(original, {
      validatorId: "human-verifier-01",
      method: "human_review",
      validatedAt: "2026-10-01T13:00:00.000Z",
    });
    expect(result.promoted.retention_policy_id).toBe("retention:evidence:edu-7y");
    expect(result.validationAct.retention_policy_id).toBe("retention:evidence:edu-7y");
  });
});

describe("evidence lifecycle: confidence provenance citation (Constitution §12)", () => {
  it("records the declared confidence basis verbatim", () => {
    const record = captureEvidence(captureInputFor("direct_observation"));
    expect(record.confidence).toBe(0.98);
    expect(record.confidence_basis).toBe("sensor-calibration:door-3");
    expect(isProvenanceCitedConfidence(record)).toBe(true);
    expect(() => requireProvenanceCitedConfidence(record)).not.toThrow();
  });

  it("never lets an uncited declared confidence pass the consumption gate", () => {
    const uncited = captureEvidence(
      captureInputFor("direct_observation", { confidenceBasis: null }),
    );
    expect(uncited.confidence).toBe(0.98);
    expect(uncited.confidence_basis).toBeNull();
    expect(isProvenanceCitedConfidence(uncited)).toBe(false);
    expect(() => requireProvenanceCitedConfidence(uncited)).toThrow(EvidenceCaptureError);
    try {
      requireProvenanceCitedConfidence(uncited);
      expect.unreachable("uncited confidence must never pass the gate");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("confidence_basis_required");
    }
  });

  it("keeps the bounded scale law (0–1) at capture", () => {
    expect(() => captureEvidence(captureInputFor("generated", { confidence: -0.1 }))).toThrow(
      /confidence/,
    );
    expect(() => captureEvidence(captureInputFor("generated", { confidence: 1.01 }))).toThrow(
      /confidence/,
    );
  });
});

describe("evidence lifecycle: declared sufficiency and validity window at capture", () => {
  it("captures a declared sufficiency assessment verbatim", () => {
    const record = captureEvidence(
      captureInputFor("direct_observation", {
        sufficiency: {
          verdict: "sufficient",
          assessedBy: "operator-07",
          assessedAt: NOW,
          rationale: "single direct observation of a door event suffices for the attendance claim",
        },
      }),
    );
    expect(record.sufficiency).toMatchObject({
      verdict: "sufficient",
      assessedBy: "operator-07",
      assessedAt: NOW,
    });
  });

  it("rejects malformed sufficiency assessments", () => {
    const base = captureInputFor("direct_observation");
    expect(() =>
      captureEvidence({
        ...base,
        sufficiency: { verdict: "vibes" as never, assessedBy: "operator-07", assessedAt: NOW },
      }),
    ).toThrow(EvidenceCaptureError);
    expect(() =>
      captureEvidence({
        ...base,
        sufficiency: { verdict: "sufficient", assessedBy: "   ", assessedAt: NOW },
      }),
    ).toThrow(EvidenceCaptureError);
    expect(() =>
      captureEvidence({
        ...base,
        sufficiency: { verdict: "sufficient", assessedBy: "operator-07", assessedAt: "soon" },
      }),
    ).toThrow(EvidenceCaptureError);
  });

  it("captures the declared validity window and rejects an inverted one", () => {
    const record = captureEvidence(
      captureInputFor("direct_observation", {
        validFrom: "2026-10-01T00:00:00.000Z",
        validUntil: "2026-10-02T00:00:00.000Z",
      }),
    );
    expect(record.valid_from).toBe("2026-10-01T00:00:00.000Z");
    expect(record.valid_until).toBe("2026-10-02T00:00:00.000Z");

    try {
      captureEvidence(
        captureInputFor("direct_observation", {
          validFrom: "2026-10-02T00:00:00.000Z",
          validUntil: "2026-10-01T00:00:00.000Z",
        }),
      );
      expect.unreachable("inverted validity window must be rejected");
    } catch (error) {
      expect((error as EvidenceCaptureError).code).toBe("invalid_validity_window");
    }
  });
});
