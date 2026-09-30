/**
 * CoreGrid Scholar — Phase 18 Analytics & Decision Intelligence unit tests
 * (analytics-models).
 *
 * Validates:
 * - Descriptive analytics (AH, AI): stats on samples; empty sample yields
 *   no fabricated statistics.
 * - Correlation (AJ, AL): never implies causation.
 * - Anomaly detection (AM, AO, AP): z-score point anomalies with score/
 *   threshold/evidence/confidence; false-positive tracking.
 * - Forecasting (AQ-AT): forecast contract with bounds/assumptions and
 *   explicit isGuaranteed=false (AT); evaluation MAE/RMSE/MAPE/coverage.
 * - Model registry (AX) and retraining governance (BA): no silent
 *   promotion; drift detection.
 */

import { describe, expect, it } from "vitest";
import {
  computeDescriptiveStats,
  pearsonCorrelation,
  causalityWarning,
  detectPointAnomaly,
  recordAnomalyFeedback,
  createForecast,
  evaluateForecast,
  registerModel,
  isModelDrifting,
  promoteModelToProduction,
  type AnomalyPerformance,
} from "@/lib/analytics-models";

describe("Descriptive analytics (AH, AI)", () => {
  it("computes statistics for a sample", () => {
    const stats = computeDescriptiveStats([1, 2, 3, 4, 5]);
    expect(stats.count).toBe(5);
    expect(stats.average).toBe(3);
    expect(stats.median).toBe(3);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
    expect(stats.standardDeviation).toBeCloseTo(1.4142, 2);
  });

  it("never fabricates statistics for an empty sample", () => {
    const stats = computeDescriptiveStats([]);
    expect(stats.count).toBe(0);
    expect(stats.average).toBeNull();
    expect(stats.median).toBeNull();
  });
});

describe("Correlation (AJ, AL)", () => {
  it("computes a perfect positive Pearson correlation", () => {
    const result = pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8]);
    expect(result?.coefficient).toBe(1);
  });

  it("explicitly never claims causation (AL)", () => {
    const result = pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8]);
    expect(result?.causationClaimed).toBe(false);
    expect(causalityWarning(result!)).toContain("does not imply causation");
  });

  it("returns null for mismatched lengths", () => {
    expect(pearsonCorrelation([1, 2], [1, 2, 3])).toBeNull();
  });
});

describe("Anomaly detection (AM, AO, AP)", () => {
  it("flags a point anomaly beyond the z threshold with evidence", () => {
    const anomaly = detectPointAnomaly({
      anomalyId: "a1",
      metricId: "attendance",
      value: 10,
      baselineMean: 5,
      baselineStdDev: 1,
      zThreshold: 3,
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(anomaly).not.toBeNull();
    if (anomaly) {
      expect(anomaly.kind).toBe("point");
      expect(anomaly.threshold).toBe(3);
      expect(anomaly.evidence).toContain("z=");
      expect(anomaly.confidence).toBeGreaterThan(0);
    }
  });

  it("does not flag normal variation", () => {
    const anomaly = detectPointAnomaly({
      anomalyId: "a2",
      metricId: "attendance",
      value: 5.2,
      baselineMean: 5,
      baselineStdDev: 1,
      zThreshold: 3,
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(anomaly).toBeNull();
  });

  it("tracks false positives and computes precision (AP)", () => {
    let perf: AnomalyPerformance = {
      falsePositives: 0,
      falseNegatives: 0,
      truePositives: 0,
      precision: null,
    };
    perf = recordAnomalyFeedback(perf, { anomalyId: "a1", operatorFeedback: "true_positive" });
    perf = recordAnomalyFeedback(perf, { anomalyId: "a2", operatorFeedback: "false_positive" });
    expect(perf.truePositives).toBe(1);
    expect(perf.falsePositives).toBe(1);
    expect(perf.precision).toBe(0.5);
  });
});

describe("Forecasting (AQ, AS, AT)", () => {
  it("creates a forecast with bounds, assumptions and explicit non-guarantee", () => {
    const result = createForecast({
      forecastId: "f1",
      metricId: "enrollment",
      horizon: "medium_term",
      pointEstimate: 1050,
      lowerBound: 1000,
      upperBound: 1100,
      confidenceLevel: 0.9,
      modelReference: "enrollment-model-v3",
      assumptions: ["retention stable"],
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.forecast.isGuaranteed).toBe(false);
      expect(result.forecast.lowerBound).toBe(1000);
    }
  });

  it("rejects a forecast with inverted bounds or missing model reference", () => {
    expect(
      createForecast({
        forecastId: "f1",
        metricId: "m",
        horizon: "short_term",
        pointEstimate: 100,
        lowerBound: 110,
        upperBound: 90,
        modelReference: "m1",
        assumptions: [],
        timestamp: "2026-01-01T00:00:00Z",
      }).ok,
    ).toBe(false);
    expect(
      createForecast({
        forecastId: "f1",
        metricId: "m",
        horizon: "short_term",
        pointEstimate: 100,
        modelReference: "",
        assumptions: [],
        timestamp: "2026-01-01T00:00:00Z",
      }).ok,
    ).toBe(false);
  });

  it("evaluates forecasts with MAE, RMSE, MAPE and coverage (AU)", () => {
    const evaluation = evaluateForecast({
      forecastId: "f1",
      actuals: [102, 98, 105],
      forecasts: [100, 100, 100],
      intervals: [
        { lower: 95, upper: 105 },
        { lower: 95, upper: 105 },
        { lower: 95, upper: 105 },
      ],
    });
    expect(evaluation.mae).toBeCloseTo(3, 1);
    expect(evaluation.coverage).toBe(1);
  });
});

describe("Model registry and governance (AX, AZ, BA)", () => {
  it("registers a model with full metadata", () => {
    const result = registerModel({
      modelId: "m1",
      version: 1,
      owner: "analytics-team",
      algorithm: "linear-regression",
      trainingDataRef: "dataset-2025",
      features: ["attendance", "engagement"],
      limitations: ["requires complete data"],
      registeredAt: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model.deploymentState).toBe("development");
    }
  });

  it("rejects a model without an owner or algorithm", () => {
    expect(
      registerModel({
        modelId: "m1",
        version: 1,
        owner: "",
        algorithm: "x",
        trainingDataRef: "d",
        features: [],
        limitations: [],
        registeredAt: "2026-01-01T00:00:00Z",
      }).ok,
    ).toBe(false);
  });

  it("detects model drift beyond the threshold (AZ)", () => {
    expect(
      isModelDrifting({
        modelId: "m1",
        kind: "data_drift",
        magnitude: 0.8,
        threshold: 0.5,
        detectedAt: "2026-01-01T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      isModelDrifting({
        modelId: "m1",
        kind: "data_drift",
        magnitude: 0.2,
        threshold: 0.5,
        detectedAt: "2026-01-01T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("never promotes an unvalidated model (BA)", () => {
    const result = registerModel({
      modelId: "m1",
      version: 1,
      owner: "o",
      algorithm: "x",
      trainingDataRef: "d",
      features: [],
      limitations: [],
      registeredAt: "2026-01-01T00:00:00Z",
    });
    if (!result.ok) throw new Error("fixture failed");
    expect(promoteModelToProduction(result.model, false).ok).toBe(false);
    const promoted = promoteModelToProduction(result.model, true);
    expect(promoted.ok).toBe(true);
    if (promoted.ok) {
      expect(promoted.model.deploymentState).toBe("production");
    }
  });
});
