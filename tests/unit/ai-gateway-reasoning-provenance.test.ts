/**
 * CoreGrid — intelligence snapshot contract tests (J-015, V1CAP-029,
 * MISSION-R-33; Constitution §9/§12/§21).
 *
 * Proves the reasoning-provenance contract: snapshot completeness (model,
 * context version, routing/policy decision, usage, output digest all
 * present), immutability (deep-frozen), digest determinism (canonical JSON),
 * the generated/derived evidence-class markers flowing into Evidence capture
 * (J-034) correctly, and the fail-closed downstream gate — a value missing
 * any snapshot field is rejected, so unattributed output is structurally
 * impossible past this contract. Pure contract tests; gateway wiring is
 * covered in ai-gateway.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  INTELLIGENCE_EVIDENCE_CLASS,
  INTELLIGENCE_SNAPSHOT_SCHEMA_VERSION,
  ReasoningProvenanceError,
  buildIntelligenceSnapshot,
  canonicalJson,
  digestContent,
  validateIntelligenceSnapshot,
  type IntelligenceSnapshotInput,
  type RoutingRationaleStep,
} from "../../frontend/src/lib/ai-gateway/reasoning-provenance";
import {
  DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
  EVIDENCE_OBJECT_TYPE,
  captureEvidence,
  isQuarantineEvidenceClass,
  provenanceCarriesAiMarkers,
  supportsCanonicalTruth,
} from "../../frontend/src/lib/evidence/capture";

const RECORDED_AT = "2026-10-02T00:00:00.000Z";

function rationale(): RoutingRationaleStep[] {
  return [
    {
      stage: "registry_route_resolved",
      model: "coregrid/flash",
      detail: 'Model registry resolved purpose "summarization" to candidates [coregrid/flash]',
    },
    {
      stage: "provider_success",
      model: "coregrid/flash",
      detail: "Attempt succeeded; output is attributed to this model through the governed path",
    },
  ];
}

function snapshotInput(
  overrides: Partial<IntelligenceSnapshotInput> = {},
): IntelligenceSnapshotInput {
  return {
    tenantRef: "tenant-a",
    actorRef: "user-1",
    agentRef: "agent-9",
    missionRef: "mission-42",
    purpose: "summarization",
    model: { id: "coregrid/flash", providerClass: "small-fast" },
    contextVersion: {
      traceId: "ctx-trace-0beec7b5",
      assembledContent: "assembled governed context payload",
    },
    routing: { routedViaRegistry: true, rationale: rationale() },
    usage: { tokensIn: 100, tokensOut: 40, estimatedCostUsd: 0.00018 },
    output: { summary: "the answer", confidence: 0.82 },
    recordedAt: RECORDED_AT,
    ...overrides,
  };
}

function expectProvenanceError(fn: () => unknown, code: string, field: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ReasoningProvenanceError);
    const provenanceError = err as ReasoningProvenanceError;
    expect(provenanceError.code).toBe(code);
    expect(provenanceError.field).toBe(field);
    return;
  }
  throw new Error(`expected ReasoningProvenanceError ${code} (${field}), but the call succeeded`);
}

describe("snapshot completeness (WHO / WHAT / WHERE / WHY / UNDER WHICH POLICY)", () => {
  it("records model, context version, routing decision, usage and digest on every snapshot", () => {
    const snapshot = buildIntelligenceSnapshot(snapshotInput());
    expect(snapshot.schemaVersion).toBe(INTELLIGENCE_SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.snapshotId.length).toBeGreaterThan(0);
    expect(snapshot.model).toEqual({ id: "coregrid/flash", providerClass: "small-fast" });
    expect(snapshot.contextVersion).toEqual({
      traceId: "ctx-trace-0beec7b5",
      contentDigest: digestContent("assembled governed context payload"),
    });
    expect(snapshot.routing.routedViaRegistry).toBe(true);
    expect(snapshot.routing.rationale).toEqual(rationale());
    expect(snapshot.attribution).toEqual({
      tenantRef: "tenant-a",
      actorRef: "user-1",
      agentRef: "agent-9",
      missionRef: "mission-42",
      purpose: "summarization",
    });
    expect(snapshot.usage).toEqual({ tokensIn: 100, tokensOut: 40, estimatedCostUsd: 0.00018 });
    expect(snapshot.outputDigest).toBe(
      digestContent({ summary: "the answer", confidence: 0.82 }),
    );
    expect(snapshot.recordedAt).toBe(RECORDED_AT);
  });

  it("is serializable: JSON round-trip preserves the snapshot exactly", () => {
    const snapshot = buildIntelligenceSnapshot(snapshotInput());
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("is envelope-bearing: kernel provenance fields name the AI origin, unverified", () => {
    const snapshot = buildIntelligenceSnapshot(snapshotInput());
    expect(snapshot.provenance).toEqual({
      source: "ai-gateway:model-generated",
      sourceRef: null,
      recordedBy: "agent-9",
      originTenantId: "tenant-a",
      generatedByAi: true,
      verified: false,
    });
  });

  it("passes the downstream fail-closed gate unchanged", () => {
    const snapshot = buildIntelligenceSnapshot(snapshotInput());
    expect(validateIntelligenceSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it("records an explicitly absent context version when none was declared", () => {
    const snapshot = buildIntelligenceSnapshot(snapshotInput({ contextVersion: null }));
    expect(snapshot.contextVersion).toEqual({ traceId: null, contentDigest: null });
    expect(() => validateIntelligenceSnapshot(snapshot)).not.toThrow();
  });
});

describe("immutability", () => {
  it("deep-freezes the snapshot: no field, nested object or rationale step mutates", () => {
    const snapshot = buildIntelligenceSnapshot(snapshotInput());
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.model)).toBe(true);
    expect(Object.isFrozen(snapshot.contextVersion)).toBe(true);
    expect(Object.isFrozen(snapshot.routing)).toBe(true);
    expect(Object.isFrozen(snapshot.routing.rationale)).toBe(true);
    expect(Object.isFrozen(snapshot.routing.rationale[0])).toBe(true);
    expect(Object.isFrozen(snapshot.attribution)).toBe(true);
    expect(Object.isFrozen(snapshot.usage)).toBe(true);
    expect(Object.isFrozen(snapshot.provenance)).toBe(true);
    expect(() => {
      (snapshot as { outputDigest: string }).outputDigest = "sha256:tampered";
    }).toThrow();
    expect(() => {
      (snapshot.model as { id: string }).id = "coregrid/deep";
    }).toThrow();
    expect(snapshot.outputDigest).not.toBe("sha256:tampered");
    expect(snapshot.model.id).toBe("coregrid/flash");
  });
});

describe("digest determinism", () => {
  it("produces identical output and snapshot digests for identical inputs", () => {
    const first = buildIntelligenceSnapshot(snapshotInput());
    const second = buildIntelligenceSnapshot(snapshotInput());
    expect(first.outputDigest).toBe(second.outputDigest);
    expect(first.snapshotId).toBe(second.snapshotId);
    expect(first.contextVersion.contentDigest).toBe(second.contextVersion.contentDigest);
  });

  it("digests independently of object key order (canonical JSON)", () => {
    expect(canonicalJson({ a: 1, b: [2, { c: 3 }] })).toBe(canonicalJson({ b: [2, { c: 3 }], a: 1 }));
    expect(digestContent({ a: 1, b: 2 })).toBe(digestContent({ b: 2, a: 1 }));
  });

  it("digests differently when the output, context or rationale changes", () => {
    const base = buildIntelligenceSnapshot(snapshotInput());
    const differentOutput = buildIntelligenceSnapshot(
      snapshotInput({ output: { summary: "a different answer" } }),
    );
    expect(differentOutput.outputDigest).not.toBe(base.outputDigest);
    // The snapshot body changed, so the snapshot id changes even when the
    // output digest alone would not.
    expect(differentOutput.snapshotId).not.toBe(base.snapshotId);

    const differentContext = buildIntelligenceSnapshot(
      snapshotInput({
        contextVersion: { traceId: "ctx-trace-0beec7b5", assembledContent: "changed context" },
      }),
    );
    expect(differentContext.contextVersion.contentDigest).not.toBe(base.contextVersion.contentDigest);

    const differentRouting = buildIntelligenceSnapshot(
      snapshotInput({
        routing: {
          routedViaRegistry: true,
          rationale: [
            {
              stage: "registry_route_resolved",
              model: "coregrid/deep",
              detail: "Routed to the fallback candidate",
            },
          ],
        },
      }),
    );
    expect(differentRouting.snapshotId).not.toBe(base.snapshotId);
    expect(differentRouting.outputDigest).toBe(base.outputDigest);
  });
});

describe("fail-closed construction (no partial snapshot can exist)", () => {
  it("rejects missing or malformed model attribution", () => {
    expectProvenanceError(
      () => buildIntelligenceSnapshot(snapshotInput({ model: undefined as never })),
      "missing_provenance_field",
      "model",
    );
    expectProvenanceError(
      () => buildIntelligenceSnapshot(snapshotInput({ model: { id: "  ", providerClass: null } })),
      "missing_provenance_field",
      "model.id",
    );
  });

  it("rejects missing usage attribution and non-finite usage counts", () => {
    expectProvenanceError(
      () => buildIntelligenceSnapshot(snapshotInput({ usage: undefined as never })),
      "missing_provenance_field",
      "usage",
    );
    expectProvenanceError(
      () =>
        buildIntelligenceSnapshot(
          snapshotInput({ usage: { tokensIn: Number.NaN, tokensOut: 1, estimatedCostUsd: null } }),
        ),
      "invalid_provenance_field",
      "usage.tokensIn",
    );
    expectProvenanceError(
      () =>
        buildIntelligenceSnapshot(
          snapshotInput({ usage: { tokensIn: 1, tokensOut: -1, estimatedCostUsd: null } }),
        ),
      "invalid_provenance_field",
      "usage.tokensOut",
    );
  });

  it("rejects an empty routing rationale chain — every output names the policy that produced it", () => {
    expectProvenanceError(
      () =>
        buildIntelligenceSnapshot(
          snapshotInput({ routing: { routedViaRegistry: true, rationale: [] } }),
        ),
      "missing_provenance_field",
      "routing.rationale",
    );
  });

  it("rejects malformed rationale steps", () => {
    expectProvenanceError(
      () =>
        buildIntelligenceSnapshot(
          snapshotInput({
            routing: {
              routedViaRegistry: true,
              rationale: [{ stage: "  ", model: null, detail: "d" } as unknown as RoutingRationaleStep],
            },
          }),
        ),
      "invalid_provenance_field",
      "routing.rationale[0].stage",
    );
  });

  it("rejects missing attribution fields and invalid instants", () => {
    expectProvenanceError(
      () => buildIntelligenceSnapshot(snapshotInput({ tenantRef: "" })),
      "missing_provenance_field",
      "tenantRef",
    );
    expectProvenanceError(
      () => buildIntelligenceSnapshot(snapshotInput({ purpose: "  " })),
      "missing_provenance_field",
      "purpose",
    );
    expectProvenanceError(
      () => buildIntelligenceSnapshot(snapshotInput({ recordedAt: "not-a-timestamp" })),
      "invalid_provenance_field",
      "recordedAt",
    );
  });
});

describe("unattributed output impossible (downstream fail-closed gate)", () => {
  it("rejects values missing any snapshot field", () => {
    const complete = validateIntelligenceSnapshot(buildIntelligenceSnapshot(snapshotInput()));
    const strip = (field: keyof IntelligenceSnapshotInput | string) => {
      const clone = { ...(complete as unknown as Record<string, unknown>) };
      delete clone[field];
      return clone;
    };
    for (const field of [
      "snapshotId",
      "schemaVersion",
      "evidenceClass",
      "generatedByAi",
      "model",
      "contextVersion",
      "routing",
      "attribution",
      "usage",
      "outputDigest",
      "provenance",
      "recordedAt",
    ]) {
      expectProvenanceError(
        () => validateIntelligenceSnapshot(strip(field)),
        "missing_provenance_field",
        field,
      );
    }
    expectProvenanceError(() => validateIntelligenceSnapshot(null), "missing_provenance_field", "snapshot");
    expectProvenanceError(() => validateIntelligenceSnapshot("output"), "missing_provenance_field", "snapshot");
  });

  it("rejects a snapshot whose AI markers were stripped (generatedByAi false or evidence class laundered)", () => {
    const complete = buildIntelligenceSnapshot(snapshotInput());
    expectProvenanceError(
      () =>
        validateIntelligenceSnapshot({
          ...(complete as unknown as Record<string, unknown>),
          generatedByAi: false,
        }),
      "missing_provenance_field",
      "generatedByAi",
    );
    expectProvenanceError(
      () =>
        validateIntelligenceSnapshot({
          ...(complete as unknown as Record<string, unknown>),
          evidenceClass: "direct_observation",
        }),
      "missing_provenance_field",
      "evidenceClass",
    );
    expectProvenanceError(
      () =>
        validateIntelligenceSnapshot({
          ...(complete as unknown as Record<string, unknown>),
          routing: { routedViaRegistry: true, rationale: [] },
        }),
      "missing_provenance_field",
      "routing",
    );
  });
});

describe("marker flow into evidence classification (J-034)", () => {
  it("carries the generated evidence-class marker and AI provenance markers", () => {
    const snapshot = buildIntelligenceSnapshot(snapshotInput());
    expect(snapshot.evidenceClass).toBe(INTELLIGENCE_EVIDENCE_CLASS);
    expect(snapshot.evidenceClass).toBe("generated");
    expect(snapshot.generatedByAi).toBe(true);
    expect(
      provenanceCarriesAiMarkers({
        source: snapshot.provenance.source,
        sourceRef: snapshot.snapshotId,
        recordedBy: snapshot.provenance.recordedBy,
        capturedBy: "evidence-bridge",
        generatedByAi: snapshot.provenance.generatedByAi,
      }),
    ).toBe(true);
  });

  it("captures AI output as quarantine-class generated evidence referencing the snapshot", () => {
    const snapshot = buildIntelligenceSnapshot(snapshotInput());
    const captured = captureEvidence({
      evidenceId: `ai-output-${snapshot.snapshotId.slice(0, 24)}`,
      evidenceType: "model_output",
      tenantId: "tenant-a",
      evidenceClass: "generated",
      claim: {
        intelligence_snapshot_id: snapshot.snapshotId,
        output_digest: snapshot.outputDigest,
        context_trace_id: snapshot.contextVersion.traceId,
      },
      confidence: null,
      observedAt: snapshot.recordedAt,
      capturedBy: "evidence-bridge",
      capturedAt: snapshot.recordedAt,
      sourceRef: snapshot.snapshotId,
      retentionPolicyId: DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
      envelope: {
        objectType: EVIDENCE_OBJECT_TYPE,
        schemaVersion: "1.0",
        status: "active",
        createdBy: "evidence-bridge",
        updatedBy: "evidence-bridge",
        provenance: {
          source: snapshot.provenance.source,
          sourceRef: snapshot.snapshotId,
          recordedBy: snapshot.provenance.recordedBy,
          originTenantId: "tenant-a",
          generatedByAi: true,
          verified: false,
        },
        policyContext: { purpose: snapshot.attribution.purpose },
        traceId: snapshot.contextVersion.traceId ?? "untraced",
        correlationId: snapshot.snapshotId,
        causationId: snapshot.snapshotId,
      },
    });
    expect(captured.evidence_class).toBe("generated");
    expect(isQuarantineEvidenceClass(captured.evidence_class)).toBe(true);
    expect(supportsCanonicalTruth(captured)).toBe(false);
    expect(captured.canonical_truth_eligible).toBe(false);
  });

  it("rejects the same output captured as direct_observation (class laundering, E-017)", () => {
    const snapshot = buildIntelligenceSnapshot(snapshotInput());
    expect(() =>
      captureEvidence({
        evidenceId: "laundered-output",
        evidenceType: "model_output",
        tenantId: "tenant-a",
        evidenceClass: "direct_observation",
        capturedBy: "evidence-bridge",
        capturedAt: snapshot.recordedAt,
        retentionPolicyId: DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
        envelope: {
          objectType: EVIDENCE_OBJECT_TYPE,
          schemaVersion: "1.0",
          status: "active",
          createdBy: "evidence-bridge",
          updatedBy: "evidence-bridge",
          provenance: {
            source: snapshot.provenance.source,
            sourceRef: snapshot.snapshotId,
            recordedBy: snapshot.provenance.recordedBy,
            originTenantId: "tenant-a",
            generatedByAi: true,
            verified: false,
          },
          policyContext: {},
          traceId: snapshot.contextVersion.traceId ?? "untraced",
          correlationId: snapshot.snapshotId,
          causationId: snapshot.snapshotId,
        },
      }),
    ).toThrow(/class laundering|AI-generated provenance markers/i);
  });
});
