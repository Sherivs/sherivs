/**
 * CoreGrid Scholar — Phase 18 Analytics & Decision Intelligence unit tests
 * (analytics-core).
 *
 * Validates:
 * - Period comparison (L): missing previous value is never silently zero.
 * - Segmentation (N): demographic segmentation requires permission.
 * - Metric system (O): full contract required.
 * - KPI system (P, Q): UNKNOWN never becomes failure or success.
 * - Threshold engine (S) and baseline engine (T).
 * - Benchmarking (U): external benchmarks require provenance.
 * - Quality score (W), missing data (X) and imputation (Y).
 * - Analytical truth principle (E): outputs carry provenance/quality.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  comparePeriods,
  isSegmentationPermitted,
  createMetric,
  evaluateKpi,
  isThresholdBreached,
  canClaimImprovement,
  isExternalBenchmarkValid,
  analyticalQualityScore,
  reportMissingData,
  createImputationRecord,
  isAnalyticalOutputTruthSafe,
  type Cohort,
  type Baseline,
} from "@/lib/analytics-core";

const TENANT_A = tenantId("tenant-a");

function cohort(overrides: Partial<Cohort> = {}): Cohort {
  return {
    cohortId: "cohort-1",
    name: "2025 intake",
    definition: "admission_year",
    criteria: { year: 2025 },
    tenantId: TENANT_A,
    ...overrides,
  };
}

describe("Period comparison (L)", () => {
  it("computes absolute and percent change", () => {
    const result = comparePeriods({
      comparisonId: "c1",
      kind: "year_over_year",
      currentValue: 110,
      previousValue: 100,
    });
    expect(result.absoluteChange).toBe(10);
    expect(result.percentChange).toBe(10);
  });

  it("never treats a missing previous value as zero", () => {
    const result = comparePeriods({
      comparisonId: "c1",
      kind: "current_vs_previous",
      currentValue: 110,
      previousValue: null,
    });
    expect(result.previousValue).toBeNull();
    expect(result.absoluteChange).toBeNull();
    expect(result.percentChange).toBeNull();
  });
});

describe("Segmentation (N)", () => {
  it("permits non-demographic segmentation without special permission", () => {
    expect(
      isSegmentationPermitted({
        cohort: cohort(),
        requiresDemographicPermission: true,
        demographicPermissionGranted: false,
      }).ok,
    ).toBe(true);
  });

  it("requires explicit permission for demographic segmentation", () => {
    const demographic = cohort({ definition: "demographic_attributes" });
    expect(
      isSegmentationPermitted({
        cohort: demographic,
        requiresDemographicPermission: true,
        demographicPermissionGranted: false,
      }).ok,
    ).toBe(false);
    expect(
      isSegmentationPermitted({
        cohort: demographic,
        requiresDemographicPermission: true,
        demographicPermissionGranted: true,
      }).ok,
    ).toBe(true);
  });
});

describe("Metric system (O)", () => {
  it("creates a metric with the full contract", () => {
    const result = createMetric({
      metricId: "attendance-rate",
      name: "Attendance Rate",
      description: "Average attendance",
      owner: "academic-office",
      formula: "present / enrolled",
      source: "attendance-fact",
      dimensions: ["course", "student"],
      timeSemantics: "per-session",
      unit: "percent",
      aggregation: "rate",
      version: 1,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a metric without an owner or formula", () => {
    const noOwner = createMetric({
      metricId: "m1",
      name: "M",
      description: "",
      owner: "",
      formula: "x",
      source: "s",
      dimensions: [],
      timeSemantics: "t",
      unit: "u",
      aggregation: "count",
      version: 1,
    });
    expect(noOwner.ok).toBe(false);
    const noFormula = createMetric({
      metricId: "m1",
      name: "M",
      description: "",
      owner: "o",
      formula: "",
      source: "s",
      dimensions: [],
      timeSemantics: "t",
      unit: "u",
      aggregation: "count",
      version: 1,
    });
    expect(noFormula.ok).toBe(false);
  });
});

describe("KPI system (P, Q)", () => {
  it("marks an on-target KPI as ON_TRACK", () => {
    const kpi = evaluateKpi({
      kpiId: "k1",
      metricId: "attendance-rate",
      objective: "improve attendance",
      actual: 90,
      target: 85,
      threshold: 70,
      period: "term-1",
      owner: "o",
      higherIsBetter: true,
    });
    expect(kpi.status).toBe("ON_TRACK");
  });

  it("marks a threshold-breached KPI as OFF_TRACK", () => {
    const kpi = evaluateKpi({
      kpiId: "k1",
      metricId: "attendance-rate",
      objective: "improve attendance",
      actual: 60,
      target: 85,
      threshold: 70,
      period: "term-1",
      owner: "o",
      higherIsBetter: true,
    });
    expect(kpi.status).toBe("OFF_TRACK");
  });

  it("never converts UNKNOWN into failure or success (Q)", () => {
    const kpi = evaluateKpi({
      kpiId: "k1",
      metricId: "attendance-rate",
      objective: "improve attendance",
      actual: null,
      target: 85,
      threshold: 70,
      period: "term-1",
      owner: "o",
      higherIsBetter: true,
    });
    expect(kpi.status).toBe("UNKNOWN");
    expect(kpi.trend).toBe("unknown");
  });
});

describe("Threshold and baseline (S, T)", () => {
  it("breaches static thresholds by operator", () => {
    expect(
      isThresholdBreached({ thresholdId: "t1", type: "static", value: 90, operator: "gt" }, 95),
    ).toBe(true);
    expect(
      isThresholdBreached({ thresholdId: "t1", type: "static", value: 90, operator: "gt" }, 85),
    ).toBe(false);
  });

  it("requires a baseline before claiming improvement (T)", () => {
    expect(
      canClaimImprovement({ baseline: null, currentValue: 90, higherIsBetter: true }).improved,
    ).toBe(false);
    const baseline: Baseline = {
      baselineId: "b1",
      metricId: "attendance-rate",
      period: "term-0",
      value: 80,
      establishedAt: "2025-01-01T00:00:00Z",
    };
    expect(canClaimImprovement({ baseline, currentValue: 90, higherIsBetter: true }).improved).toBe(
      true,
    );
    expect(canClaimImprovement({ baseline, currentValue: 70, higherIsBetter: true }).improved).toBe(
      false,
    );
  });
});

describe("Benchmarking (U)", () => {
  it("requires provenance for external benchmarks", () => {
    expect(
      isExternalBenchmarkValid({
        benchmarkId: "b1",
        kind: "external",
        value: 90,
        provenance: null,
      }),
    ).toBe(false);
    expect(
      isExternalBenchmarkValid({
        benchmarkId: "b1",
        kind: "external",
        value: 90,
        provenance: "national-survey-2025",
      }),
    ).toBe(true);
    expect(
      isExternalBenchmarkValid({
        benchmarkId: "b2",
        kind: "historical",
        value: 90,
        provenance: null,
      }),
    ).toBe(true);
  });
});

describe("Quality, missing data, imputation (V, W, X, Y)", () => {
  it("computes a bounded quality score", () => {
    const score = analyticalQualityScore({
      completeness: 1,
      accuracy: 0.9,
      consistency: 0.8,
      timeliness: 0.7,
      uniqueness: 0.9,
      validity: 1,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("reports missing data explicitly — never silent zeros (X)", () => {
    const report = reportMissingData({ field: "attendance", missingCount: 3, totalCount: 10 });
    expect(report.missingRatio).toBe(0.3);
  });

  it("records imputation method, assumptions, observations and confidence (Y)", () => {
    const imp = createImputationRecord({
      field: "attendance",
      method: "mean",
      assumptions: ["missing at random"],
      affectedObservations: 3,
      confidence: 0.8,
    });
    expect(imp.method).toBe("mean");
    expect(imp.assumptions).toHaveLength(1);
  });
});

describe("Analytical truth principle (E)", () => {
  it("requires provenance and version on every analytical output", () => {
    expect(
      isAnalyticalOutputTruthSafe({
        outputId: "o1",
        tenantId: TENANT_A,
        computedAt: "2026-01-01T00:00:00Z",
        provenance: {
          source: "attendance-fact",
          timestamp: "2026-01-01T00:00:00Z",
          version: "1",
          transformation: null,
          model: null,
          analyst: null,
          query: null,
        },
        quality: {
          completeness: 1,
          accuracy: 1,
          consistency: 1,
          timeliness: 1,
          uniqueness: 1,
          validity: 1,
        },
        value: 90,
        missingData: [],
        imputations: [],
      }),
    ).toBe(true);
    expect(
      isAnalyticalOutputTruthSafe({
        outputId: "o1",
        tenantId: TENANT_A,
        computedAt: "2026-01-01T00:00:00Z",
        provenance: {
          source: "",
          timestamp: "",
          version: "",
          transformation: null,
          model: null,
          analyst: null,
          query: null,
        },
        quality: {
          completeness: 1,
          accuracy: 1,
          consistency: 1,
          timeliness: 1,
          uniqueness: 1,
          validity: 1,
        },
        value: 90,
        missingData: [],
        imputations: [],
      }),
    ).toBe(false);
  });
});
