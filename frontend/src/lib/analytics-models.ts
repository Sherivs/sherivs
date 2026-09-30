/**
 * CoreGrid — Analytics & Decision Intelligence model domain
 * (Phase 18, Sections AH, AI, AJ, AK, AL, AM, AN, AO, AP, AQ, AR, AS, AT,
 * AU, AV, AW, AX, AY, AZ, BA, FU, FV, FW).
 *
 * Implements `architecture/phase-18-analytics-intelligence.md`:
 * - Descriptive analytics (AH): counts, sums, averages, medians,
 *   percentiles, distributions, rates, ratios, growth, changes.
 * - Distribution analysis (AI): frequency distributions, histograms,
 *   quantiles, outliers, skew, variance, standard deviation.
 * - Correlation (AJ): Pearson, Spearman, rank relationships. Correlation
 *   must never automatically imply causation (AL).
 * - Anomaly detection (AM-AP): point, contextual, collective and trend
 *   anomalies; every anomaly includes score, threshold, evidence,
 *   confidence and timestamp; false-positive management tracks
 *   false positives/negatives and operator feedback.
 * - Forecasting (AQ-AT): enrollment, attendance, revenue, expenses,
 *   resource demand, capacity, academic and operational demand; short/
 *   medium/long horizons; every forecast includes point estimate,
 *   intervals, horizon, model reference, assumptions and quality;
 *   predictions are never represented as guaranteed future facts (AT).
 * - Forecast evaluation (AU): MAE, RMSE, MAPE, calibration, coverage,
 *   drift.
 * - Model ensembles (AV), selection (AW) and registry (AX): model ID,
 *   version, owner, training data, features, algorithm, evaluation,
 *   deployment state, limitations.
 * - Model lifecycle (AY), drift (AZ), retraining (BA): no model silently
 *   replaces a production model. Data drift (FU), schema drift (FV),
 *   metric drift (FW) are detectable.
 */

/* ─────────────────────────────────────────────────────────────
 * Descriptive analytics (AH, AI)
 * ────────────────────────────────────────────────────────────*/

export interface DescriptiveStats {
  count: number;
  sum: number | null;
  average: number | null;
  median: number | null;
  percentile25: number | null;
  percentile75: number | null;
  min: number | null;
  max: number | null;
  variance: number | null;
  standardDeviation: number | null;
  skew: number | null;
}

/**
 * Descriptive statistics (AH, AI): computed from a numeric sample. An
 * empty sample yields only the count — no fabricated statistics.
 */
export function computeDescriptiveStats(values: number[]): DescriptiveStats {
  const count = values.length;
  if (count === 0) {
    return {
      count: 0,
      sum: null,
      average: null,
      median: null,
      percentile25: null,
      percentile75: null,
      min: null,
      max: null,
      variance: null,
      standardDeviation: null,
      skew: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const average = sum / count;
  const median = percentile(sorted, 0.5);
  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);
  const variance = values.reduce((acc, v) => acc + (v - average) ** 2, 0) / count;
  const stdDev = Math.sqrt(variance);
  let skew: number | null = null;
  if (stdDev > 0) {
    skew = Number(
      (values.reduce((acc, v) => acc + ((v - average) / stdDev) ** 3, 0) / count).toFixed(4),
    );
  }
  return {
    count,
    sum: Number(sum.toFixed(4)),
    average: Number(average.toFixed(4)),
    median: Number(median.toFixed(4)),
    percentile25: Number(p25.toFixed(4)),
    percentile75: Number(p75.toFixed(4)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    variance: Number(variance.toFixed(4)),
    standardDeviation: Number(stdDev.toFixed(4)),
    skew,
  };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

/* ─────────────────────────────────────────────────────────────
 * Correlation (AJ, AL)
 * ────────────────────────────────────────────────────────────*/

export type CorrelationMethod = "pearson" | "spearman";

export interface CorrelationResult {
  method: CorrelationMethod;
  coefficient: number;
  sampleSize: number;
  /** Correlation never automatically implies causation (AL). */
  causationClaimed: false;
}

/**
 * Pearson correlation (AJ). The result explicitly never claims causation
 * (AL).
 */
export function pearsonCorrelation(x: number[], y: number[]): CorrelationResult | null {
  if (x.length !== y.length || x.length < 2) {
    return null;
  }
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) {
    return null;
  }
  const coefficient = Number((numerator / denom).toFixed(4));
  return { method: "pearson", coefficient, sampleSize: n, causationClaimed: false };
}

/** Causality warning (AL): the system must explicitly distinguish
 * correlation from causation. */
export function causalityWarning(correlation: CorrelationResult): string {
  return `Correlation ${correlation.coefficient} does not imply causation (AL)`;
}

/* ─────────────────────────────────────────────────────────────
 * Anomaly detection (AM, AN, AO, AP)
 * ────────────────────────────────────────────────────────────*/

export type AnomalyKind = "point" | "contextual" | "collective" | "trend";

export const ANOMALY_KINDS: readonly AnomalyKind[] = [
  "point",
  "contextual",
  "collective",
  "trend",
] as const;

export interface Anomaly {
  anomalyId: string;
  metricId: string;
  kind: AnomalyKind;
  score: number;
  threshold: number;
  evidence: string;
  confidence: number;
  timestamp: string;
}

/**
 * Anomaly detection (AM, AO): a point anomaly is flagged when the value
 * deviates from the baseline beyond the threshold. Every anomaly carries
 * score, threshold, evidence, confidence and timestamp.
 */
export function detectPointAnomaly(input: {
  anomalyId: string;
  metricId: string;
  value: number;
  baselineMean: number;
  baselineStdDev: number;
  zThreshold: number;
  timestamp: string;
}): Anomaly | null {
  if (input.baselineStdDev === 0) {
    return input.value === input.baselineMean
      ? null
      : {
          anomalyId: input.anomalyId,
          metricId: input.metricId,
          kind: "point",
          score: 0,
          threshold: input.zThreshold,
          evidence: `value ${input.value} != baseline mean ${input.baselineMean} with zero variance`,
          confidence: 0.9,
          timestamp: input.timestamp,
        };
  }
  const zScore = (input.value - input.baselineMean) / input.baselineStdDev;
  const isAnomaly = Math.abs(zScore) > input.zThreshold;
  if (!isAnomaly) {
    return null;
  }
  const confidence = Math.min(0.99, Math.abs(zScore) / (input.zThreshold * 2));
  return {
    anomalyId: input.anomalyId,
    metricId: input.metricId,
    kind: "point",
    score: Number(Math.abs(zScore).toFixed(3)),
    threshold: input.zThreshold,
    evidence: `z=${zScore.toFixed(2)} vs threshold ${input.zThreshold}`,
    confidence: Number(confidence.toFixed(3)),
    timestamp: input.timestamp,
  };
}

export interface AnomalyFeedback {
  anomalyId: string;
  operatorFeedback: "true_positive" | "false_positive" | "unknown";
}

export interface AnomalyPerformance {
  falsePositives: number;
  falseNegatives: number;
  truePositives: number;
  precision: number | null;
}

/** False-positive management (AP): track false positives/negatives and
 * operator feedback to compute model performance. */
export function recordAnomalyFeedback(
  performance: AnomalyPerformance,
  feedback: AnomalyFeedback,
): AnomalyPerformance {
  const next = { ...performance };
  if (feedback.operatorFeedback === "false_positive") {
    next.falsePositives += 1;
  } else if (feedback.operatorFeedback === "true_positive") {
    next.truePositives += 1;
  }
  next.precision =
    next.truePositives + next.falsePositives === 0
      ? null
      : Number((next.truePositives / (next.truePositives + next.falsePositives)).toFixed(3));
  return next;
}

/* ─────────────────────────────────────────────────────────────
 * Forecasting (AQ, AR, AS, AT, AU)
 * ────────────────────────────────────────────────────────────*/

export type ForecastHorizon = "short_term" | "medium_term" | "long_term";

export const FORECAST_HORIZONS: readonly ForecastHorizon[] = [
  "short_term",
  "medium_term",
  "long_term",
] as const;

export interface Forecast {
  forecastId: string;
  metricId: string;
  horizon: ForecastHorizon;
  pointEstimate: number;
  lowerBound: number | null;
  upperBound: number | null;
  confidenceLevel: number | null;
  modelReference: string;
  assumptions: string[];
  timestamp: string;
  /** Predictions are never represented as guaranteed future facts (AT). */
  isGuaranteed: false;
}

export interface CreateForecastInput {
  forecastId: string;
  metricId: string;
  horizon: ForecastHorizon;
  pointEstimate: number;
  lowerBound?: number | null;
  upperBound?: number | null;
  confidenceLevel?: number | null;
  modelReference: string;
  assumptions: string[];
  timestamp: string;
}

export type CreateForecastResult = { ok: true; forecast: Forecast } | { ok: false; error: string };

/**
 * Forecast output (AS, AT): every forecast includes a point estimate,
 * interval bounds, horizon, model reference, assumptions and timestamp;
 * it is explicitly not guaranteed.
 */
export function createForecast(input: CreateForecastInput): CreateForecastResult {
  if (input.modelReference.trim() === "") {
    return { ok: false, error: "Forecast requires a model reference (AS)" };
  }
  if (
    input.lowerBound !== null &&
    input.lowerBound !== undefined &&
    input.upperBound !== null &&
    input.upperBound !== undefined &&
    input.lowerBound > input.upperBound
  ) {
    return { ok: false, error: "Forecast lower bound cannot exceed upper bound (AS)" };
  }
  return {
    ok: true,
    forecast: {
      forecastId: input.forecastId,
      metricId: input.metricId,
      horizon: input.horizon,
      pointEstimate: input.pointEstimate,
      lowerBound: input.lowerBound ?? null,
      upperBound: input.upperBound ?? null,
      confidenceLevel: input.confidenceLevel ?? null,
      modelReference: input.modelReference,
      assumptions: input.assumptions,
      timestamp: input.timestamp,
      isGuaranteed: false,
    },
  };
}

export interface ForecastEvaluation {
  forecastId: string;
  mae: number;
  rmse: number;
  mape: number | null;
  coverage: number | null;
}

/**
 * Forecast evaluation (AU): MAE, RMSE and MAPE. Coverage measures the
 * fraction of actuals that fell inside the forecast interval.
 */
export function evaluateForecast(input: {
  forecastId: string;
  actuals: number[];
  forecasts: number[];
  intervals: Array<{ lower: number | null; upper: number | null }>;
}): ForecastEvaluation {
  const n = input.actuals.length;
  const errors = input.actuals.map((a, i) => a - input.forecasts[i]);
  const mae = errors.reduce((acc, e) => acc + Math.abs(e), 0) / Math.max(1, n);
  const rmse = Math.sqrt(errors.reduce((acc, e) => acc + e * e, 0) / Math.max(1, n));
  let mapeSum = 0;
  let mapeValid = 0;
  for (let i = 0; i < n; i += 1) {
    if (input.actuals[i] !== 0) {
      mapeSum += Math.abs(errors[i] / input.actuals[i]);
      mapeValid += 1;
    }
  }
  let covered = 0;
  for (let i = 0; i < n; i += 1) {
    const interval = input.intervals[i];
    if (
      interval.lower !== null &&
      interval.upper !== null &&
      input.actuals[i] >= interval.lower &&
      input.actuals[i] <= interval.upper
    ) {
      covered += 1;
    }
  }
  return {
    forecastId: input.forecastId,
    mae: Number(mae.toFixed(3)),
    rmse: Number(rmse.toFixed(3)),
    mape: mapeValid === 0 ? null : Number((mapeSum / mapeValid).toFixed(4)),
    coverage: n === 0 ? null : Number((covered / n).toFixed(3)),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Model registry and lifecycle (AX, AY, AZ, BA)
 * ────────────────────────────────────────────────────────────*/

export type ModelDeploymentState =
  "development" | "validated" | "shadow" | "canary" | "production" | "retired";

export const MODEL_DEPLOYMENT_STATES: readonly ModelDeploymentState[] = [
  "development",
  "validated",
  "shadow",
  "canary",
  "production",
  "retired",
] as const;

export interface AnalyticalModel {
  modelId: string;
  version: number;
  owner: string;
  algorithm: string;
  trainingDataRef: string;
  features: string[];
  evaluationRef: string | null;
  deploymentState: ModelDeploymentState;
  limitations: string[];
  registeredAt: string;
}

export interface RegisterModelInput {
  modelId: string;
  version: number;
  owner: string;
  algorithm: string;
  trainingDataRef: string;
  features: string[];
  limitations: string[];
  registeredAt: string;
}

export type RegisterModelResult =
  { ok: true; model: AnalyticalModel } | { ok: false; error: string };

/**
 * Model registry (AX): every analytical model defines ID, version, owner,
 * training data, features, algorithm, evaluation, deployment state and
 * limitations.
 */
export function registerModel(input: RegisterModelInput): RegisterModelResult {
  if (input.owner.trim() === "") {
    return { ok: false, error: "Model requires an owner (AX)" };
  }
  if (input.algorithm.trim() === "") {
    return { ok: false, error: "Model requires an algorithm (AX)" };
  }
  if (input.trainingDataRef.trim() === "") {
    return { ok: false, error: "Model requires a training data reference (AX)" };
  }
  return {
    ok: true,
    model: {
      modelId: input.modelId,
      version: input.version,
      owner: input.owner,
      algorithm: input.algorithm,
      trainingDataRef: input.trainingDataRef,
      features: input.features,
      evaluationRef: null,
      deploymentState: "development",
      limitations: input.limitations,
      registeredAt: input.registeredAt,
    },
  };
}

export type DriftKind =
  | "data_drift"
  | "concept_drift"
  | "prediction_drift"
  | "schema_drift"
  | "metric_drift"
  | "semantic_drift";

export const DRIFT_KINDS: readonly DriftKind[] = [
  "data_drift",
  "concept_drift",
  "prediction_drift",
  "schema_drift",
  "metric_drift",
  "semantic_drift",
] as const;

export interface ModelDriftReport {
  modelId: string;
  kind: DriftKind;
  magnitude: number;
  threshold: number;
  detectedAt: string;
}

export function isModelDrifting(report: ModelDriftReport): boolean {
  return report.magnitude > report.threshold;
}

/**
 * Model retraining governance (BA): no model silently replaces a
 * production model. A candidate must pass validation and explicit
 * promotion before becoming production.
 */
export function promoteModelToProduction(
  model: AnalyticalModel,
  validated: boolean,
): { ok: true; model: AnalyticalModel } | { ok: false; error: string } {
  if (!validated) {
    return { ok: false, error: "Model cannot be promoted without validation (BA)" };
  }
  return { ok: true, model: { ...model, deploymentState: "production" } };
}
