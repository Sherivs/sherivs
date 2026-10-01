/**
 * CoreGrid — SLO/SLI set contract tests (V1CAP-077, MISSION-R-102 T2).
 * Catalogue shape, pure evaluation (met/violated boundaries, insufficient
 * data, foreign/invalid sample accounting), and error-budget burn arithmetic.
 */
import { describe, expect, it } from "vitest";
import {
  SLI_CATALOGUE,
  SLI_IDS,
  SLO_CATALOGUE,
  computeErrorBudget,
  evaluateSlo,
  isBadSample,
  percentile95,
  sliDefinition,
  sloDefinition,
  slisForStage,
  stageSliCoverage,
  type SliId,
  type SliSample,
} from "../../frontend/src/lib/reliability/slo";
import { LOOP_STAGES } from "../../frontend/src/lib/reliability/failure-architecture";

const T0 = "2026-10-01T09:00:00.000Z";

function sample(sli: SliId, value: number, overrides: Partial<SliSample> = {}): SliSample {
  return { sli, value, at: T0, tenantId: "tenant-a", ref: `log:${sli}:${value}`, ...overrides };
}

describe("SLI/SLO catalogue", () => {
  it("defines exactly the five loop-stage SLIs", () => {
    expect(SLI_IDS).toEqual([
      "mission_admission_latency",
      "evidence_capture_success_rate",
      "verification_pass_rate",
      "memory_retrieval_authorization_rate",
      "command_idempotency_collision_rate",
    ]);
    expect(SLI_CATALOGUE).toHaveLength(5);
    expect(SLO_CATALOGUE).toHaveLength(5);
  });

  it("binds every SLI to a governed loop stage with a declared measurement hook", () => {
    for (const def of SLI_CATALOGUE) {
      expect(LOOP_STAGES).toContain(def.stage);
      expect(def.measurement.trim().length).toBeGreaterThan(0);
      expect(def.description.trim().length).toBeGreaterThan(0);
      expect(def.minSamples).toBeGreaterThan(0);
    }
  });

  it("pairs every SLI with an SLO carrying a finite threshold and budget", () => {
    for (const slo of SLO_CATALOGUE) {
      expect(() => sliDefinition(slo.sli)).not.toThrow();
      expect(Number.isFinite(slo.threshold)).toBe(true);
      expect(slo.errorBudgetFraction).toBeGreaterThanOrEqual(0);
      expect(slo.errorBudgetFraction).toBeLessThanOrEqual(1);
      expect(slo.objective.trim().length).toBeGreaterThan(0);
    }
  });

  it("marks the security-relevant SLIs zero-tolerance", () => {
    expect(sloDefinition("memory_retrieval_authorization_rate").errorBudgetFraction).toBe(0);
    expect(sloDefinition("command_idempotency_collision_rate").errorBudgetFraction).toBe(0);
  });

  it("maps admission latency to the mission stage and collision rate to the action stage", () => {
    expect(sliDefinition("mission_admission_latency").stage).toBe("mission");
    expect(sliDefinition("mission_admission_latency").kind).toBe("latency");
    expect(sliDefinition("mission_admission_latency").aggregation).toBe("p95");
    expect(sliDefinition("command_idempotency_collision_rate").stage).toBe("action");
    expect(sliDefinition("evidence_capture_success_rate").stage).toBe("evidence");
    expect(sliDefinition("verification_pass_rate").stage).toBe("verification");
    expect(sliDefinition("memory_retrieval_authorization_rate").stage).toBe("memory");
  });

  it("exposes explicit stage coverage — gaps are named, never silent", () => {
    const coverage = stageSliCoverage(LOOP_STAGES);
    expect(coverage).toHaveLength(LOOP_STAGES.length);
    const covered = coverage.filter((entry) => entry.covered);
    expect(covered.map((entry) => entry.stage).sort()).toEqual(
      ["action", "evidence", "memory", "mission", "verification"].sort(),
    );
    for (const entry of coverage) {
      expect(entry.slis).toEqual(slisForStage(entry.stage).map((def) => def.id));
    }
    expect(coverage.find((entry) => entry.stage === "observation")?.covered).toBe(false);
  });

  it("rejects unknown SLI lookups", () => {
    expect(() => sliDefinition("nope" as SliId)).toThrow(TypeError);
    expect(() => sloDefinition("nope" as SliId)).toThrow(TypeError);
  });
});

describe("SLO evaluation (pure, met/violated boundaries)", () => {
  it("reports met at the inclusive threshold boundary (p95 exactly at 2000ms)", () => {
    // 20 samples, p95 nearest-rank = 19th smallest; 18 fast + 2 at the bound.
    const full = Array.from({ length: 20 }, (_, i) => sample("mission_admission_latency", i < 18 ? 1_000 : 2_000));
    const atBoundary = evaluateSlo("mission_admission_latency", full);
    expect(atBoundary.status).toBe("met");
    expect(atBoundary.observed).toBe(2_000);
    expect(atBoundary.reason).toMatch(/<=/);
  });

  it("reports violated above the threshold", () => {
    const samples = Array.from({ length: 20 }, (_, i) =>
      sample("mission_admission_latency", i < 18 ? 1_000 : 2_500),
    );
    const evaluation = evaluateSlo("mission_admission_latency", samples);
    expect(evaluation.status).toBe("violated");
    expect(evaluation.observed).toBe(2_500);
    expect(evaluation.reason).toMatch(/breached/);
  });

  it("evaluates success-rate SLIs as met when the mean clears the threshold", () => {
    const samples = [
      ...Array.from({ length: 49 }, () => sample("verification_pass_rate", 1)),
      sample("verification_pass_rate", 0),
    ];
    const evaluation = evaluateSlo("verification_pass_rate", samples);
    expect(evaluation.sampleCount).toBe(50);
    expect(evaluation.observed).toBeCloseTo(0.98);
    expect(evaluation.status).toBe("met");
  });

  it("evaluates success-rate SLIs as violated below the threshold", () => {
    const samples = [
      ...Array.from({ length: 48 }, () => sample("evidence_capture_success_rate", 1)),
      ...Array.from({ length: 2 }, () => sample("evidence_capture_success_rate", 0)),
    ];
    const evaluation = evaluateSlo("evidence_capture_success_rate", samples);
    expect(evaluation.observed).toBeCloseTo(0.96);
    expect(evaluation.status).toBe("violated");
  });

  it("reports insufficient_data below minSamples and never claims met", () => {
    const evaluation = evaluateSlo("evidence_capture_success_rate", [
      sample("evidence_capture_success_rate", 1),
      sample("evidence_capture_success_rate", 1),
    ]);
    expect(evaluation.status).toBe("insufficient_data");
    expect(evaluation.observed).toBeNull();
    expect(evaluation.reason).toMatch(/insufficient_data/);
  });

  it("excludes foreign-SLI and invalid samples with explicit counts", () => {
    const samples = [
      ...Array.from({ length: 50 }, () => sample("evidence_capture_success_rate", 1)),
      sample("verification_pass_rate", 1),
      sample("evidence_capture_success_rate", Number.NaN),
      sample("evidence_capture_success_rate", 7),
    ];
    const evaluation = evaluateSlo("evidence_capture_success_rate", samples);
    expect(evaluation.sampleCount).toBe(50);
    expect(evaluation.foreignCount).toBe(1);
    expect(evaluation.invalidCount).toBe(2);
    expect(evaluation.status).toBe("met");
    expect(evidenceInvalidCount(evaluation.evidence)).toBe(2);
  });

  it("carries per-sample evidence with provenance refs", () => {
    const evaluation = evaluateSlo("evidence_capture_success_rate", [
      ...Array.from({ length: 49 }, (_, i) => sample("evidence_capture_success_rate", 1, { ref: `ev-${i}` })),
      sample("evidence_capture_success_rate", 0, { ref: "ev-bad" }),
    ]);
    expect(evaluation.evidence.some((entry) => entry.ref === "ev-bad" && entry.value === 0)).toBe(true);
    expect(evaluation.evidence.every((entry) => entry.at === T0)).toBe(true);
  });

  it("treats boundary-zero collision rate as met and any collision as violated", () => {
    const clean = Array.from({ length: 50 }, () => sample("command_idempotency_collision_rate", 0));
    expect(evaluateSlo("command_idempotency_collision_rate", clean).status).toBe("met");
    const collided = [...clean.slice(0, 49), sample("command_idempotency_collision_rate", 1)];
    expect(evaluateSlo("command_idempotency_collision_rate", collided).status).toBe("violated");
  });

  it("is pure: the same samples evaluate identically twice", () => {
    const samples = Array.from({ length: 20 }, (_, i) => sample("mission_admission_latency", 100 * (i + 1)));
    const first = evaluateSlo("mission_admission_latency", samples);
    const second = evaluateSlo("mission_admission_latency", samples);
    expect(second).toEqual(first);
    // The input is not mutated (p95 sorts a copy).
    expect(samples.map((s) => s.value)).toEqual(Array.from({ length: 20 }, (_, i) => 100 * (i + 1)));
  });
});

describe("error-budget burn", () => {
  it("computes allowed = floor(total × fraction) and the burn rate", () => {
    const samples = [
      ...Array.from({ length: 100 }, () => sample("mission_admission_latency", 1_000)),
      ...Array.from({ length: 3 }, () => sample("mission_admission_latency", 5_000)),
    ];
    const budget = computeErrorBudget("mission_admission_latency", samples);
    expect(budget.total).toBe(103);
    expect(budget.bad).toBe(3);
    expect(budget.allowed).toBe(Math.floor(103 * 0.05)); // 5
    expect(budget.remaining).toBe(2);
    expect(budget.burnRate).toBeCloseTo(3 / 5);
    expect(budget.exhausted).toBe(false);
    expect(budget.exhaustedReason).toBeNull();
  });

  it("exhausts when bad exceeds allowed", () => {
    const samples = [
      ...Array.from({ length: 100 }, () => sample("verification_pass_rate", 1)),
      ...Array.from({ length: 3 }, () => sample("verification_pass_rate", 0)),
    ];
    const budget = computeErrorBudget("verification_pass_rate", samples);
    expect(budget.allowed).toBe(2);
    expect(budget.bad).toBe(3);
    expect(budget.remaining).toBe(0);
    expect(budget.exhausted).toBe(true);
    expect(budget.exhaustedReason).toMatch(/review required, not silent degradation/);
  });

  it("exhausts a zero-tolerance budget on a single breach", () => {
    const samples = [
      ...Array.from({ length: 50 }, () => sample("memory_retrieval_authorization_rate", 1)),
      sample("memory_retrieval_authorization_rate", 0),
    ];
    const budget = computeErrorBudget("memory_retrieval_authorization_rate", samples);
    expect(budget.allowed).toBe(0);
    expect(budget.bad).toBe(1);
    expect(budget.burnRate).toBeNull();
    expect(budget.exhausted).toBe(true);
    expect(budget.exhaustedReason).toMatch(/zero-tolerance budget/);
  });

  it("stays unexhausted on a clean zero-tolerance window", () => {
    const samples = Array.from({ length: 50 }, () => sample("command_idempotency_collision_rate", 0));
    const budget = computeErrorBudget("command_idempotency_collision_rate", samples);
    expect(budget.bad).toBe(0);
    expect(budget.allowed).toBe(0);
    expect(budget.exhausted).toBe(false);
    expect(budget.burnRate).toBeNull();
  });

  it("counts invalid samples as bad (bad data burns budget, never counts as good)", () => {
    const samples = [
      ...Array.from({ length: 50 }, () => sample("evidence_capture_success_rate", 1)),
      sample("evidence_capture_success_rate", Number.NaN),
    ];
    const budget = computeErrorBudget("evidence_capture_success_rate", samples);
    expect(budget.total).toBe(51);
    expect(budget.bad).toBe(1);
    expect(budget.allowed).toBe(0); // floor(51 * 0.01) = 0
    expect(budget.exhausted).toBe(true);
  });

  it("ignores samples of other SLIs entirely", () => {
    const samples = [
      ...Array.from({ length: 100 }, () => sample("evidence_capture_success_rate", 1)),
      ...Array.from({ length: 10 }, () => sample("verification_pass_rate", 0)),
    ];
    const budget = computeErrorBudget("evidence_capture_success_rate", samples);
    expect(budget.total).toBe(100);
    expect(budget.bad).toBe(0);
  });

  it("applies the per-sample bound consistently with the SLI direction", () => {
    expect(isBadSample("mission_admission_latency", 2_000)).toBe(false);
    expect(isBadSample("mission_admission_latency", 2_001)).toBe(true);
    expect(isBadSample("evidence_capture_success_rate", 1)).toBe(false);
    expect(isBadSample("evidence_capture_success_rate", 0.5)).toBe(true);
    expect(isBadSample("command_idempotency_collision_rate", 0)).toBe(false);
    expect(isBadSample("command_idempotency_collision_rate", 1)).toBe(true);
  });
});

describe("p95 aggregation", () => {
  it("uses nearest-rank over the sorted window", () => {
    expect(percentile95([100])).toBe(100);
    expect(percentile95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(10);
    // 95 samples → ceil(0.95*95) = 91st rank (1-based) → 91.
    const values = Array.from({ length: 95 }, (_, i) => i + 1);
    expect(percentile95(values)).toBe(91);
  });

  it("refuses an empty window", () => {
    expect(() => percentile95([])).toThrow(TypeError);
  });
});

function evidenceInvalidCount(evidence: readonly { invalid: boolean }[]): number {
  return evidence.filter((entry) => entry.invalid).length;
}