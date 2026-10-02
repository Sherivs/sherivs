/**
 * CoreGrid — state reconciliation & contradiction engine suite
 * (V1CAP-005 / J-004 / MISSION-R-14).
 *
 * Proves, at unit level, that:
 *  1. conflicting observations resolve per DECLARED rule only — evidence-class
 *     rank, source reliability, recency within validity, record-time
 *     knowledge — and every verdict records which rule decided;
 *  2. resolution is append-only: inputs are never mutated, losing candidates
 *     are retained verbatim, superseded records survive behind their pointer,
 *     duplicate deliveries collapse without destroying either delivery;
 *  3. UNKNOWN is preserved through every path (G-094): missing stays missing,
 *     an explicit UNKNOWN verdict is never interpolated into a value, and no
 *     rule invents a value from absence;
 *  4. contradictions that no declared rule can decide surface explicitly as
 *     UNRESOLVED_CONTRADICTION — never silently picked;
 *  5. reconciliation is tenant-isolated: out-of-scope records are never
 *     inputs and cross-tenant corrections fail closed;
 *  6. the engine composes with the kernel bi-temporal law (validity
 *     coordinates, record-time cutoff, overlap-aware supersession) and with
 *     the canonical CoreObject envelope (verdicts are stampable and
 *     evidence-bearing).
 */

import { describe, expect, it } from "vitest";
import {
  EVIDENCE_CLASS_RANK,
  RECONCILIATION_EVIDENCE_CLASSES,
  RECONCILIATION_RULE_PRECEDENCE,
  RECONCILIATION_RULES,
  RECONCILIATION_VERDICT_OBJECT_TYPE,
  RELIABILITY_RANK,
  SOURCE_RELIABILITY_TIERS,
  ReconciliationError,
  factFromObservationDraft,
  isUnknownObservationValue,
  knownValue,
  reconcileObservations,
  sameObservationValue,
  unknownValue,
  verdictDraft,
  verdictEvidenceClaim,
  type ObservationValue,
  type ReconcileOptions,
  type ReconciliationObservation,
  type ReconciliationVerdict,
} from "@/lib/kernel/reconciliation";
import { observationDraft, validateKernelRowEnvelope, type KernelObjectEnvelopeInput } from "@/lib/kernel/reality";
import { captureEvidence, supportsCanonicalTruth } from "@/lib/evidence/capture";

const T1 = "tenant-1";
const T2 = "tenant-2";
const RECORDED_AT = "2026-10-02T12:00:00.000Z";

let nextFactId = 0;

function fact(overrides: Partial<ReconciliationObservation> & { id?: string }): ReconciliationObservation {
  nextFactId += 1;
  return {
    id: overrides.id ?? `obs-${nextFactId}`,
    tenant_id: T1,
    subject_entity_id: "entity-1",
    attribute: "status",
    value: knownValue("on"),
    kind: "observed",
    evidence_class: "direct_observation",
    reliability: "reliable",
    confidence: 0.9,
    observed_at: "2026-10-02T10:00:00.000Z",
    recorded_at: "2026-10-02T10:05:00.000Z",
    valid_from: null,
    valid_until: null,
    valid_time_known: null,
    supersedes: null,
    observer_identity: null,
    source_ref: null,
    ...overrides,
  };
}

function opts(overrides: Partial<ReconcileOptions> = {}): ReconcileOptions {
  return {
    tenantId: T1,
    recordedAt: RECORDED_AT,
    ...overrides,
  };
}

function verdictFor(
  observations: readonly ReconciliationObservation[],
  options: ReconcileOptions,
  subject = "entity-1",
  attribute = "status",
): ReconciliationVerdict {
  const result = reconcileObservations(observations, options);
  const verdict = result.verdicts.find(
    (v) => v.subject_entity_id === subject && v.attribute === attribute,
  );
  expect(verdict).toBeDefined();
  return verdict as ReconciliationVerdict;
}

function baseEnvelope(overrides: Partial<KernelObjectEnvelopeInput> = {}): KernelObjectEnvelopeInput {
  return {
    objectType: RECONCILIATION_VERDICT_OBJECT_TYPE,
    schemaVersion: "1.0",
    status: "active",
    createdBy: "identity:engineer-1",
    updatedBy: "identity:engineer-1",
    provenance: { source: "kernel:reconciliation", originTenantId: T1 },
    policyContext: { policy: "core.data.internal" },
    traceId: "trace-1",
    correlationId: "corr-1",
    declaredOrigin: "kernel:reconciliation:bootstrap",
    ...overrides,
  };
}

describe("reconciliation vocabulary — declared rules and ranks", () => {
  it("declares a complete, duplicate-free rule precedence", () => {
    expect(RECONCILIATION_RULE_PRECEDENCE).toEqual([
      "evidence_class_rank",
      "source_reliability",
      "recency_within_validity",
      "record_time_knowledge",
    ]);
    expect(RECONCILIATION_RULES.map((rule) => rule.id)).toEqual(RECONCILIATION_RULE_PRECEDENCE);
    expect(new Set(RECONCILIATION_RULE_PRECEDENCE).size).toBe(RECONCILIATION_RULE_PRECEDENCE.length);
  });

  it("ranks direct_observation above every quarantine evidence class", () => {
    expect(EVIDENCE_CLASS_RANK.direct_observation).toBeGreaterThan(EVIDENCE_CLASS_RANK.attested);
    expect(EVIDENCE_CLASS_RANK.attested).toBeGreaterThan(EVIDENCE_CLASS_RANK.derived);
    expect(EVIDENCE_CLASS_RANK.derived).toBeGreaterThan(EVIDENCE_CLASS_RANK.generated);
    expect(EVIDENCE_CLASS_RANK.generated).toBeGreaterThan(EVIDENCE_CLASS_RANK.predicted);
    expect(EVIDENCE_CLASS_RANK.predicted).toBeGreaterThan(EVIDENCE_CLASS_RANK.simulated);
    expect(RECONCILIATION_EVIDENCE_CLASSES).toContain("direct_observation");
  });

  it("ranks reliability tiers in declared order", () => {
    expect(RELIABILITY_RANK.authoritative).toBeGreaterThan(RELIABILITY_RANK.reliable);
    expect(RELIABILITY_RANK.reliable).toBeGreaterThan(RELIABILITY_RANK.provisional);
    expect(RELIABILITY_RANK.provisional).toBeGreaterThan(RELIABILITY_RANK.unverified);
    expect(SOURCE_RELIABILITY_TIERS.length).toBe(4);
  });

  it("compares values canonically: two UNKNOWNs are equal, key order is irrelevant", () => {
    expect(sameObservationValue(unknownValue(), unknownValue())).toBe(true);
    expect(sameObservationValue(knownValue({ a: 1, b: 2 }), knownValue({ b: 2, a: 1 }))).toBe(true);
    expect(sameObservationValue(knownValue("on"), knownValue("off"))).toBe(false);
    expect(sameObservationValue(knownValue("on"), unknownValue())).toBe(false);
    expect(isUnknownObservationValue(unknownValue())).toBe(true);
    expect(isUnknownObservationValue(knownValue("on"))).toBe(false);
  });
});

describe("conflict resolution per declared rule", () => {
  it("resolves by recency within validity: the latest valid-time coordinate wins", () => {
    const earlier = fact({ id: "obs-early", value: knownValue("on"), observed_at: "2026-10-02T10:00:00.000Z" });
    const later = fact({ id: "obs-late", value: knownValue("off"), observed_at: "2026-10-02T11:00:00.000Z" });
    const verdict = verdictFor([earlier, later], opts({ at: "2026-10-02T12:00:00.000Z" }));
    expect(verdict.outcome).toBe("RESOLVED");
    expect(verdict.rule_applied).toBe("recency_within_validity");
    expect(verdict.winner_id).toBe("obs-late");
    expect(verdict.value).toEqual({ known: true, value: "off" });
    expect(verdict.residual_uncertainty.losing_candidate_ids).toEqual(["obs-early"]);
  });

  it("recency is recency within VALIDITY, not record time", () => {
    const newerValidOlderRecord = fact({
      id: "obs-valid-late",
      value: knownValue("corrected"),
      observed_at: "2026-10-02T11:00:00.000Z",
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    const olderValidNewerRecord = fact({
      id: "obs-valid-early",
      value: knownValue("stale"),
      observed_at: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T11:30:00.000Z",
    });
    const verdict = verdictFor([newerValidOlderRecord, olderValidNewerRecord], opts());
    expect(verdict.outcome).toBe("RESOLVED");
    expect(verdict.rule_applied).toBe("recency_within_validity");
    expect(verdict.winner_id).toBe("obs-valid-late");
    expect(verdict.value).toEqual({ known: true, value: "corrected" });
  });

  it("resolves by source reliability: a higher tier outranks recency", () => {
    const authoritative = fact({
      id: "obs-authority",
      value: knownValue("audited"),
      reliability: "authoritative",
      observed_at: "2026-10-02T10:00:00.000Z",
    });
    const reliable = fact({
      id: "obs-recent",
      value: knownValue("recent"),
      reliability: "reliable",
      observed_at: "2026-10-02T11:00:00.000Z",
    });
    const verdict = verdictFor([authoritative, reliable], opts());
    expect(verdict.outcome).toBe("RESOLVED");
    expect(verdict.rule_applied).toBe("source_reliability");
    expect(verdict.winner_id).toBe("obs-authority");
    expect(verdict.value).toEqual({ known: true, value: "audited" });
  });

  it("resolves by evidence class: direct_observation outranks newer, more reliable quarantine evidence", () => {
    const direct = fact({
      id: "obs-direct",
      value: knownValue("seen"),
      evidence_class: "direct_observation",
      reliability: "provisional",
      observed_at: "2026-10-02T10:00:00.000Z",
      confidence: 0.6,
    });
    const generated = fact({
      id: "obs-generated",
      value: knownValue("model-output"),
      evidence_class: "generated",
      reliability: "authoritative",
      observed_at: "2026-10-02T11:00:00.000Z",
      confidence: 0.99,
    });
    const verdict = verdictFor([direct, generated], opts());
    expect(verdict.outcome).toBe("RESOLVED");
    expect(verdict.rule_applied).toBe("evidence_class_rank");
    expect(verdict.winner_id).toBe("obs-direct");
    expect(verdict.value).toEqual({ known: true, value: "seen" });
    expect(verdict.residual_uncertainty.losing_candidate_ids).toEqual(["obs-generated"]);
  });

  it("ranks attested above generated among quarantine classes", () => {
    const attested = fact({
      id: "obs-attested",
      value: knownValue("validated"),
      evidence_class: "attested",
      reliability: "reliable",
      observed_at: "2026-10-02T10:00:00.000Z",
    });
    const generated = fact({
      id: "obs-generated-late",
      value: knownValue("generated"),
      evidence_class: "generated",
      reliability: "reliable",
      observed_at: "2026-10-02T11:00:00.000Z",
    });
    const verdict = verdictFor([attested, generated], opts());
    expect(verdict.outcome).toBe("RESOLVED");
    expect(verdict.rule_applied).toBe("evidence_class_rank");
    expect(verdict.winner_id).toBe("obs-attested");
  });

  it("falls through to record-time knowledge when class, reliability and validity tie", () => {
    const first = fact({
      id: "obs-first-known",
      value: knownValue("before"),
      valid_time_known: false,
      observed_at: null,
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    const second = fact({
      id: "obs-second-known",
      value: knownValue("after"),
      valid_time_known: false,
      observed_at: null,
      recorded_at: "2026-10-02T11:30:00.000Z",
    });
    const verdict = verdictFor([first, second], opts());
    expect(verdict.outcome).toBe("RESOLVED");
    expect(verdict.rule_applied).toBe("record_time_knowledge");
    expect(verdict.winner_id).toBe("obs-second-known");
    expect(verdict.residual_uncertainty.unknown_validity_candidate_ids).toEqual([
      "obs-first-known",
      "obs-second-known",
    ]);
  });

  it("excludes known-validity candidates whose validity does not cover the as-of instant", () => {
    const windowed = fact({
      id: "obs-window",
      value: knownValue("window"),
      observed_at: "2026-10-02T10:00:00.000Z",
      valid_until: "2026-10-02T11:00:00.000Z",
    });
    const openEnded = fact({
      id: "obs-open",
      value: knownValue("open"),
      observed_at: "2026-10-02T11:00:00.000Z",
    });
    const after = verdictFor([windowed, openEnded], opts({ at: "2026-10-02T12:00:00.000Z" }));
    expect(after.outcome).toBe("CONVERGED");
    expect(after.rule_applied).toBeNull();
    expect(after.value).toEqual({ known: true, value: "open" });
    expect(after.residual_uncertainty.not_applicable_ids).toEqual(["obs-window"]);

    const during = verdictFor([windowed, openEnded], opts({ at: "2026-10-02T10:30:00.000Z" }));
    expect(during.outcome).toBe("CONVERGED");
    expect(during.winner_id).toBe("obs-window");
    expect(during.residual_uncertainty.not_applicable_ids).toEqual(["obs-open"]);
  });

  it("retires a superseded record only where the superseding record covers the instant", () => {
    const original = fact({
      id: "obs-original",
      value: knownValue("on"),
      observed_at: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    const correction = fact({
      id: "obs-correction",
      value: knownValue("off"),
      observed_at: "2026-10-02T11:00:00.000Z",
      recorded_at: "2026-10-02T11:30:00.000Z",
      supersedes: "obs-original",
    });
    const before = verdictFor([original, correction], opts({ at: "2026-10-02T10:30:00.000Z" }));
    expect(before.outcome).toBe("CONVERGED");
    expect(before.value).toEqual({ known: true, value: "on" });
    expect(before.superseded).toEqual([]);
    expect(before.residual_uncertainty.not_applicable_ids).toEqual(["obs-correction"]);

    const after = verdictFor([original, correction], opts({ at: "2026-10-02T12:00:00.000Z" }));
    expect(after.outcome).toBe("CONVERGED");
    expect(after.value).toEqual({ known: true, value: "off" });
    expect(after.superseded).toEqual(["obs-original"]);
    expect(after.inputs).toEqual(["obs-correction", "obs-original"]);
  });
});

describe("append-only resolution — no destructive overwrite", () => {
  it("never mutates the input records", () => {
    const a = fact({ id: "obs-a", value: knownValue("on"), observed_at: "2026-10-02T10:00:00.000Z" });
    const b = fact({ id: "obs-b", value: knownValue("off"), observed_at: "2026-10-02T11:00:00.000Z" });
    const snapshot = JSON.parse(JSON.stringify([a, b]));
    reconcileObservations([a, b], opts());
    expect(JSON.parse(JSON.stringify([a, b]))).toEqual(snapshot);
  });

  it("retains losing candidates verbatim in inputs and residual uncertainty, and is deterministic on re-run", () => {
    const a = fact({ id: "obs-a", value: knownValue("on"), observed_at: "2026-10-02T10:00:00.000Z" });
    const b = fact({ id: "obs-b", value: knownValue("off"), observed_at: "2026-10-02T11:00:00.000Z" });
    const first = reconcileObservations([a, b], opts());
    const second = reconcileObservations([a, b], opts());
    expect(JSON.stringify(second.verdicts)).toEqual(JSON.stringify(first.verdicts));
    const verdict = first.verdicts[0];
    expect(verdict.inputs).toEqual(["obs-a", "obs-b"]);
    expect(verdict.winner_id).toBe("obs-b");
    expect(verdict.residual_uncertainty.losing_candidate_ids).toEqual(["obs-a"]);
  });

  it("collapses duplicate deliveries behind the earliest-recorded representative", () => {
    const original = fact({
      id: "obs-original",
      value: knownValue("on"),
      observer_identity: "identity:sensor-1",
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    const redelivery = fact({
      id: "obs-redelivery",
      value: knownValue("on"),
      observer_identity: "identity:sensor-1",
      recorded_at: "2026-10-02T11:45:00.000Z",
    });
    const result = reconcileObservations([original, redelivery], opts());
    expect(result.stats.duplicates_collapsed).toBe(1);
    const verdict = result.verdicts[0];
    expect(verdict.outcome).toBe("CONVERGED");
    expect(verdict.winner_id).toBe("obs-original");
    expect(verdict.duplicates).toEqual(["obs-redelivery"]);
    expect(verdict.inputs).toEqual(["obs-original", "obs-redelivery"]);
  });

  it("does not collapse same-content observations from independent observers", () => {
    const sensorA = fact({
      id: "obs-sensor-a",
      value: knownValue("on"),
      observer_identity: "identity:sensor-1",
    });
    const sensorB = fact({
      id: "obs-sensor-b",
      value: knownValue("on"),
      observer_identity: "identity:sensor-2",
    });
    const result = reconcileObservations([sensorA, sensorB], opts());
    expect(result.stats.duplicates_collapsed).toBe(0);
    expect(result.verdicts[0].outcome).toBe("CONVERGED");
  });

  it("retains superseded records behind the pointer (never deleted)", () => {
    const original = fact({ id: "obs-target", value: knownValue("on") });
    const correction = fact({
      id: "obs-corrected",
      value: knownValue("off"),
      recorded_at: "2026-10-02T11:30:00.000Z",
      supersedes: "obs-target",
    });
    const result = reconcileObservations([original, correction], opts());
    const verdict = result.verdicts[0];
    expect(verdict.superseded).toEqual(["obs-target"]);
    expect(verdict.inputs).toContain("obs-target");
    expect(result.stats.superseded_retired).toBe(1);
  });
});

describe("UNKNOWN preservation (G-094) — missing stays missing through every path", () => {
  it("an explicitly required but entirely unobserved attribute is an UNKNOWN verdict, never a value", () => {
    const result = reconcileObservations([fact({ subject_entity_id: "entity-1" })], opts({
      requiredAttributes: [
        { subjectEntityId: "entity-1", attribute: "status" },
        { subjectEntityId: "entity-1", attribute: "never_observed" },
        { subjectEntityId: "entity-missing", attribute: "anything" },
      ],
    }));
    const missing = result.verdicts.find((v) => v.attribute === "never_observed");
    expect(missing).toBeDefined();
    expect(missing?.outcome).toBe("UNKNOWN");
    expect(missing?.value).toEqual({ known: false, value: null });
    expect(missing?.inputs).toEqual([]);
    expect(missing?.rule_applied).toBeNull();
    expect(missing?.residual_uncertainty.explicit_unknown).toBe(true);
    const absentSubject = result.verdicts.find((v) => v.subject_entity_id === "entity-missing");
    expect(absentSubject?.outcome).toBe("UNKNOWN");
  });

  it("every applicable candidate declaring UNKNOWN converges to UNKNOWN — not a fabricated value", () => {
    const a = fact({ id: "obs-unknown-a", value: unknownValue(), observed_at: "2026-10-02T10:00:00.000Z" });
    const b = fact({ id: "obs-unknown-b", value: unknownValue(), observed_at: "2026-10-02T11:00:00.000Z" });
    const verdict = verdictFor([a, b], opts());
    expect(verdict.outcome).toBe("UNKNOWN");
    expect(verdict.value).toEqual({ known: false, value: null });
    expect(verdict.value && isUnknownObservationValue(verdict.value)).toBe(true);
    expect(verdict.residual_uncertainty.explicit_unknown).toBe(true);
  });

  it("a correction that declares the value unknown resolves to UNKNOWN — the unknown is preserved", () => {
    const a = fact({ id: "obs-known", value: knownValue("on"), observed_at: "2026-10-02T10:00:00.000Z" });
    const b = fact({
      id: "obs-unknown-correction",
      value: unknownValue(),
      observed_at: "2026-10-02T11:00:00.000Z",
    });
    const verdict = verdictFor([a, b], opts());
    expect(verdict.outcome).toBe("UNKNOWN");
    expect(verdict.rule_applied).toBe("recency_within_validity");
    expect(verdict.winner_id).toBe("obs-unknown-correction");
    expect(verdict.residual_uncertainty.explicit_unknown).toBe(true);
    expect(verdict.residual_uncertainty.losing_candidate_ids).toEqual(["obs-known"]);
  });

  it("all candidates not applicable at the instant yield UNKNOWN, not a guess", () => {
    const expired = fact({
      id: "obs-expired",
      value: knownValue("expired-truth"),
      observed_at: "2026-10-02T10:00:00.000Z",
      valid_until: "2026-10-02T11:00:00.000Z",
    });
    const verdict = verdictFor([expired], opts({ at: "2026-10-02T12:00:00.000Z" }));
    expect(verdict.outcome).toBe("UNKNOWN");
    expect(verdict.value).toEqual({ known: false, value: null });
    expect(verdict.residual_uncertainty.not_applicable_ids).toEqual(["obs-expired"]);
  });

  it("an UNKNOWN-valued winner is flagged, and unknown-validity candidates are never assumed covering", () => {
    const flagged = fact({
      id: "obs-unknown-validity",
      value: knownValue("truth-of-unknown-time"),
      valid_time_known: false,
      observed_at: null,
    });
    const verdict = verdictFor([flagged], opts());
    expect(verdict.outcome).toBe("CONVERGED");
    expect(verdict.residual_uncertainty.unknown_validity_candidate_ids).toEqual(["obs-unknown-validity"]);
    expect(verdict.value).toEqual({ known: true, value: "truth-of-unknown-time" });
  });

  it("rejects an UNKNOWN value that illegally carries a value", () => {
    const bad = fact({
      id: "obs-bad-unknown",
      value: { known: false, value: "smuggled" } as ObservationValue,
    });
    expect(() => reconcileObservations([bad], opts())).toThrow(ReconciliationError);
  });
});

describe("unresolved contradictions surface explicitly — never silently picked", () => {
  it("an exact tie after every declared rule is UNRESOLVED_CONTRADICTION with no value", () => {
    const a = fact({
      id: "obs-tie-a",
      value: knownValue("left"),
      observed_at: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    const b = fact({
      id: "obs-tie-b",
      value: knownValue("right"),
      observed_at: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    const result = reconcileObservations([a, b], opts());
    expect(result.stats.unresolved).toBe(1);
    expect(result.unresolved_verdicts.length).toBe(1);
    const verdict = result.unresolved_verdicts[0];
    expect(verdict.outcome).toBe("UNRESOLVED_CONTRADICTION");
    expect(verdict.value).toBeNull();
    expect(verdict.rule_applied).toBeNull();
    expect(verdict.winner_id).toBeNull();
    expect(verdict.residual_uncertainty.unresolved_candidate_ids).toEqual(["obs-tie-a", "obs-tie-b"]);
  });

  it("unresolved is deterministic under input permutation — arrival order never decides", () => {
    const a = fact({
      id: "obs-tie-a",
      value: knownValue("left"),
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    const b = fact({
      id: "obs-tie-b",
      value: knownValue("right"),
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    const forward = reconcileObservations([a, b], opts());
    const reversed = reconcileObservations([b, a], opts());
    expect(JSON.stringify(reversed.verdicts)).toEqual(JSON.stringify(forward.verdicts));
    expect(reversed.unresolved_verdicts[0].outcome).toBe("UNRESOLVED_CONTRADICTION");
  });

  it("disabling the deciding rule surfaces the contradiction instead of a silent pick", () => {
    const a = fact({
      id: "obs-rec-a",
      value: knownValue("before"),
      observed_at: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    const b = fact({
      id: "obs-rec-b",
      value: knownValue("after"),
      observed_at: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T11:30:00.000Z",
    });
    const decided = verdictFor([a, b], opts());
    expect(decided.rule_applied).toBe("record_time_knowledge");

    const disabled = verdictFor([a, b], opts({
      disabledRules: ["record_time_knowledge"],
    }));
    expect(disabled.outcome).toBe("UNRESOLVED_CONTRADICTION");
    expect(disabled.value).toBeNull();
    expect(disabled.applied_rules).not.toContain("record_time_knowledge");
    expect(disabled.applied_rules).toContain("evidence_class_rank");
  });

  it("rejects a partial rule precedence — declared rules are never silently dropped", () => {
    const a = fact({ id: "obs-x", value: knownValue("on") });
    expect(() =>
      reconcileObservations([a], opts({
        rulePrecedence: ["evidence_class_rank", "recency_within_validity"],
      })),
    ).toThrow(ReconciliationError);
    expect(() =>
      reconcileObservations([a], opts({ disabledRules: ["not-a-rule" as never] })),
    ).toThrow(ReconciliationError);
  });
});

describe("cross-tenant isolation", () => {
  it("out-of-scope records are never inputs: tenants reconcile independently", () => {
    const tenant1 = fact({
      id: "obs-t1",
      value: knownValue("tenant-1-truth"),
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    const tenant2 = fact({
      id: "obs-t2",
      tenant_id: T2,
      value: knownValue("tenant-2-truth"),
      recorded_at: "2026-10-02T11:30:00.000Z",
    });
    const forTenant1 = reconcileObservations([tenant1, tenant2], opts());
    expect(forTenant1.stats.records_scoped).toBe(1);
    expect(forTenant1.verdicts[0].inputs).toEqual(["obs-t1"]);
    expect(forTenant1.verdicts[0].value).toEqual({ known: true, value: "tenant-1-truth" });

    const forTenant2 = reconcileObservations([tenant1, tenant2], opts({ tenantId: T2 }));
    expect(forTenant2.stats.records_scoped).toBe(1);
    expect(forTenant2.verdicts[0].value).toEqual({ known: true, value: "tenant-2-truth" });
  });

  it("conflicting same-coordinate records from another tenant never leak into the verdict", () => {
    const tenant1 = fact({
      id: "obs-t1-conflict",
      value: knownValue("ours"),
      observed_at: "2026-10-02T10:00:00.000Z",
    });
    const tenant2Lookalike = fact({
      id: "obs-t2-lookalike",
      tenant_id: T2,
      value: knownValue("theirs"),
      observed_at: "2026-10-02T11:00:00.000Z",
    });
    const verdict = verdictFor([tenant1, tenant2Lookalike], opts());
    expect(verdict.outcome).toBe("CONVERGED");
    expect(verdict.value).toEqual({ known: true, value: "ours" });
    expect(verdict.inputs).toEqual(["obs-t1-conflict"]);
  });

  it("null-tenant records are excluded from every scoped reconciliation", () => {
    const scoped = fact({ id: "obs-scoped", value: knownValue("scoped") });
    const anonymous = fact({ id: "obs-anonymous", tenant_id: null, value: knownValue("anonymous") });
    const result = reconcileObservations([scoped, anonymous], opts());
    expect(result.stats.records_scoped).toBe(1);
    expect(result.verdicts[0].inputs).toEqual(["obs-scoped"]);
  });

  it("a cross-tenant correction pointer fails closed — tenants cannot correct each other", () => {
    const targetInT2 = fact({ id: "obs-t2-target", tenant_id: T2, value: knownValue("theirs") });
    const correctorInT1 = fact({
      id: "obs-t1-corrector",
      value: knownValue("ours"),
      supersedes: "obs-t2-target",
      recorded_at: "2026-10-02T11:30:00.000Z",
    });
    expect(() =>
      reconcileObservations([correctorInT1], opts()),
    ).toThrow(/outside the record set/);
    expect(() =>
      reconcileObservations([correctorInT1, targetInT2], opts()),
    ).toThrow(/outside the record set/);
  });
});

describe("bi-temporal and envelope compatibility", () => {
  it("consumes observationDraft rows verbatim through factFromObservationDraft", () => {
    const draft = observationDraft({
      subjectEntityId: "entity-1",
      kind: "observed",
      statement: { attribute: "status", value: "drafted-value" },
      observerIdentity: "identity:observer-1",
      tenantId: T1,
      confidence: 0.8,
      observedAt: "2026-10-02T10:00:00.000Z",
      biTemporal: { validFrom: "2026-10-02T10:00:00.000Z" },
    }, "2026-10-02T10:05:00.000Z");
    const composed = factFromObservationDraft(draft, {
      id: "obs-draft-1",
      evidenceClass: "direct_observation",
      reliability: "reliable",
    });
    expect(composed.subject_entity_id).toBe("entity-1");
    expect(composed.attribute).toBe("status");
    expect(composed.value).toEqual({ known: true, value: "drafted-value" });
    expect(composed.kind).toBe("observed");
    expect(composed.confidence).toBe(0.8);
    expect(composed.recorded_at).toBe("2026-10-02T10:05:00.000Z");
    expect(composed.valid_from).toBe("2026-10-02T10:00:00.000Z");
    expect(composed.valid_time_known).toBe(true);
    expect(composed.evidence_class).toBe("direct_observation");
    expect(composed.reliability).toBe("reliable");

    const verdict = verdictFor([composed], opts({ at: "2026-10-02T11:00:00.000Z" }));
    expect(verdict.outcome).toBe("CONVERGED");
    expect(verdict.value).toEqual({ known: true, value: "drafted-value" });
  });

  it("maps the declared statement convention: value_unknown is an explicit UNKNOWN", () => {
    const draft = observationDraft({
      subjectEntityId: "entity-1",
      kind: "reported",
      statement: { attribute: "status", value_unknown: true },
      tenantId: T1,
    }, "2026-10-02T10:05:00.000Z");
    const composed = factFromObservationDraft(draft, {
      id: "obs-draft-unknown",
      evidenceClass: "direct_observation",
      reliability: "provisional",
    });
    expect(composed.value).toEqual({ known: false, value: null });
    expect(composed.kind).toBe("reported");
  });

  it("fails closed when a draft declares neither value nor attribute", () => {
    const draft = observationDraft({
      subjectEntityId: "entity-1",
      kind: "observed",
      statement: {},
      tenantId: T1,
    }, "2026-10-02T10:05:00.000Z");
    expect(() =>
      factFromObservationDraft(draft, {
        id: "obs-draft-empty",
        evidenceClass: "direct_observation",
        reliability: "reliable",
      }),
    ).toThrow(ReconciliationError);
    expect(() =>
      factFromObservationDraft(draft, {
        id: "obs-draft-empty",
        evidenceClass: "direct_observation",
        reliability: "reliable",
        attribute: "status",
      }),
    ).toThrow(ReconciliationError);
  });

  it("the record-time cutoff hides late corrections: the knowledge-state view is bi-temporal", () => {
    const original = fact({
      id: "obs-original",
      value: knownValue("on"),
      observed_at: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    const lateCorrection = fact({
      id: "obs-late-correction",
      value: knownValue("off"),
      observed_at: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T11:30:00.000Z",
      supersedes: "obs-original",
    });
    const before = verdictFor([original, lateCorrection], opts({ recordedAsOf: "2026-10-02T11:00:00.000Z" }));
    expect(before.outcome).toBe("CONVERGED");
    expect(before.value).toEqual({ known: true, value: "on" });
    expect(before.superseded).toEqual([]);

    const after = verdictFor([original, lateCorrection], opts({ recordedAsOf: "2026-10-02T12:00:00.000Z" }));
    expect(after.value).toEqual({ known: true, value: "off" });
    expect(after.superseded).toEqual(["obs-original"]);
  });

  it("verdicts carry coherent bi-temporal stamps (validity known only with an as-of instant)", () => {
    const withAt = verdictFor([fact({ id: "obs-at", value: knownValue("on") })], opts({ at: "2026-10-02T12:00:00.000Z" }));
    expect(withAt.valid_from).toBe("2026-10-02T12:00:00.000Z");
    expect(withAt.valid_time_known).toBe(true);
    const withoutAt = verdictFor([fact({ id: "obs-no-at", value: knownValue("on") })], opts());
    expect(withoutAt.valid_from).toBeNull();
    expect(withoutAt.valid_time_known).toBe(false);
  });

  it("verdicts stamp through the canonical CoreObject envelope and pass the row gate", () => {
    const result = reconcileObservations(
      [fact({ id: "obs-stamp", value: knownValue("on"), observed_at: "2026-10-02T10:00:00.000Z" })],
      opts({ at: "2026-10-02T11:00:00.000Z" }),
    );
    const verdict = result.verdicts[0];
    const row = verdictDraft(verdict, baseEnvelope());
    expect(row.object_type).toBe(RECONCILIATION_VERDICT_OBJECT_TYPE);
    expect(row.verdict_id).toBe(verdict.verdict_id);
    expect(row.tenant_id).toBe(T1);
    expect(row.valid_from).toBe("2026-10-02T11:00:00.000Z");
    expect(row.valid_time_known).toBe(true);
    expect(row.trace_id).toBe("trace-1");
    expect(() =>
      validateKernelRowEnvelope({ ...row, id: "verdict-row-1" }, [RECONCILIATION_VERDICT_OBJECT_TYPE]),
    ).not.toThrow();
  });

  it("rejects a verdict envelope with the wrong object type", () => {
    const result = reconcileObservations([fact({ id: "obs-wrong-envelope", value: knownValue("on") })], opts());
    expect(() =>
      verdictDraft(result.verdicts[0], baseEnvelope({ objectType: "core.event" })),
    ).toThrow(ReconciliationError);
  });

  it("verdicts are evidence-bearing: the claim captures as evidence through the canonical capture API", () => {
    const result = reconcileObservations(
      [fact({ id: "obs-evidence", value: knownValue("on"), observed_at: "2026-10-02T10:00:00.000Z" })],
      opts({ at: "2026-10-02T11:00:00.000Z" }),
    );
    const claim = verdictEvidenceClaim(result.verdicts[0]);
    expect(claim.reconciliation_verdict).toMatchObject({
      verdict_id: result.verdicts[0].verdict_id,
      outcome: "CONVERGED",
      tenant_id: T1,
    });
    const captured = captureEvidence(
      {
        evidenceId: "evd-verdict-1",
        evidenceType: "reconciliation_verdict",
        tenantId: T1,
        evidenceClass: "attested",
        claim,
        capturedBy: "identity:auditor-1",
        capturedAt: RECORDED_AT,
        retentionPolicyId: "retention:core-evidence",
        envelope: {
          objectType: "core.evidence",
          schemaVersion: "1.0",
          status: "active",
          createdBy: "identity:auditor-1",
          updatedBy: "identity:auditor-1",
          provenance: { source: "reconciliation:audit", originTenantId: T1, verified: true },
          policyContext: { policy: "core.data.internal" },
          traceId: "trace-1",
          correlationId: "corr-1",
          declaredOrigin: "kernel:reconciliation:bootstrap",
        },
      },
      ["core.evidence"],
    );
    expect(captured.evidence_id).toBe("evd-verdict-1");
    expect(supportsCanonicalTruth(captured)).toBe(false);
  });
});