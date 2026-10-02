/**
 * CoreGrid — Analytics & Decision Intelligence core domain model
 * (Phase 18, Sections E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U,
 * V, W, X, Y, Z, AA, AB).
 *
 * Implements `architecture/phase-18-analytics-intelligence.md`:
 * - Analytical truth principle (E): analytics must never silently modify
 *   canonical institutional truth; a derived metric is never the source
 *   of truth.
 * - Analytical lifecycle (F) and layers (G): descriptive, diagnostic,
 *   predictive, prescriptive, decision intelligence.
 * - Analytical data model (H): entities, events, measures, dimensions,
 *   time, relationships, cohorts, segments, hierarchies.
 * - Dimension model (I) and fact model (J): facts are consumed but never
 *   canonically owned by Phase 18.
 * - Time intelligence (K) and period comparison (L): current vs previous,
 *   year-over-year, semester/term/cohort/institution comparisons.
 * - Cohort engine (M) and segmentation (N) respecting privacy.
 * - Metric system (O): every metric defines ID, name, description, owner,
 *   formula, source, dimensions, time semantics, unit, aggregation,
 *   freshness, quality, version, lifecycle.
 * - KPI system (P, Q): objective, target, actual, variance, threshold,
 *   period, owner, status, trend, confidence; Unknown must not
 *   automatically become failure or success.
 * - Threshold engine (S): static, dynamic, percentile, statistical,
 *   policy thresholds.
 * - Baseline engine (T): establish baselines before claiming improvement.
 * - Benchmarking (U): historical, peer, institutional targets, external
 *   with provenance.
 * - Data quality (V, W): completeness, accuracy, consistency, timeliness,
 *   uniqueness, validity; outputs expose data-quality information.
 * - Missing data (X): represented explicitly; never silently replaced
 *   with zero. Imputation (Y) records method, assumptions, affected
 *   observations, confidence.
 * - Analytical lineage (Z) and provenance (AA): source, timestamp,
 *   version, transformation, model, analyst/system, query.
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Analytical layers (G)
 * ────────────────────────────────────────────────────────────*/

export type AnalyticsLayer =
  "descriptive" | "diagnostic" | "predictive" | "prescriptive" | "decision_intelligence";

export const ANALYTICS_LAYERS: readonly AnalyticsLayer[] = [
  "descriptive",
  "diagnostic",
  "predictive",
  "prescriptive",
  "decision_intelligence",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Dimension and fact model (H, I, J)
 * ────────────────────────────────────────────────────────────*/

export type AnalyticsDimension =
  | "institution"
  | "campus"
  | "faculty"
  | "department"
  | "programme"
  | "course"
  | "class"
  | "student"
  | "staff"
  | "financial_period"
  | "academic_period"
  | "location"
  | "resource"
  | "device"
  | "time";

export const ANALYTICS_DIMENSIONS: readonly AnalyticsDimension[] = [
  "institution",
  "campus",
  "faculty",
  "department",
  "programme",
  "course",
  "class",
  "student",
  "staff",
  "financial_period",
  "academic_period",
  "location",
  "resource",
  "device",
  "time",
] as const;

export type AnalyticsFact =
  | "attendance"
  | "assessment"
  | "enrollment"
  | "payments"
  | "expenses"
  | "resource_usage"
  | "communication"
  | "scheduling"
  | "facility_usage"
  | "system_events"
  | "automation_executions"
  | "learning_activity";

export const ANALYTICS_FACTS: readonly AnalyticsFact[] = [
  "attendance",
  "assessment",
  "enrollment",
  "payments",
  "expenses",
  "resource_usage",
  "communication",
  "scheduling",
  "facility_usage",
  "system_events",
  "automation_executions",
  "learning_activity",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Time intelligence and period comparison (K, L)
 * ────────────────────────────────────────────────────────────*/

export type ComparisonPeriod =
  | "current_vs_previous"
  | "year_over_year"
  | "semester_over_semester"
  | "term_over_term"
  | "cohort_over_cohort"
  | "institution_over_institution";

export const COMPARISON_PERIODS: readonly ComparisonPeriod[] = [
  "current_vs_previous",
  "year_over_year",
  "semester_over_semester",
  "term_over_term",
  "cohort_over_cohort",
  "institution_over_institution",
] as const;

export interface PeriodComparison {
  comparisonId: string;
  kind: ComparisonPeriod;
  currentValue: number;
  previousValue: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
}

/**
 * Period comparison (L): current vs previous with absolute and percent
 * change. A missing previous value is never silently treated as zero.
 */
export function comparePeriods(input: {
  comparisonId: string;
  kind: ComparisonPeriod;
  currentValue: number;
  previousValue: number | null;
}): PeriodComparison {
  if (input.previousValue === null) {
    return {
      comparisonId: input.comparisonId,
      kind: input.kind,
      currentValue: input.currentValue,
      previousValue: null,
      absoluteChange: null,
      percentChange: null,
    };
  }
  const absoluteChange = Number((input.currentValue - input.previousValue).toFixed(4));
  const percentChange =
    input.previousValue === 0
      ? null
      : Number(((absoluteChange / input.previousValue) * 100).toFixed(2));
  return {
    comparisonId: input.comparisonId,
    kind: input.kind,
    currentValue: input.currentValue,
    previousValue: input.previousValue,
    absoluteChange,
    percentChange,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Cohort engine and segmentation (M, N)
 * ────────────────────────────────────────────────────────────*/

export type CohortDefinition =
  | "enrollment_period"
  | "admission_year"
  | "programme"
  | "demographic_attributes"
  | "academic_performance"
  | "engagement"
  | "location"
  | "institutional_segment";

export const COHORT_DEFINITIONS: readonly CohortDefinition[] = [
  "enrollment_period",
  "admission_year",
  "programme",
  "demographic_attributes",
  "academic_performance",
  "engagement",
  "location",
  "institutional_segment",
] as const;

export interface Cohort {
  cohortId: string;
  name: string;
  definition: CohortDefinition;
  criteria: Record<string, unknown>;
  tenantId: TenantId;
}

/**
 * Segmentation (N): analytical segmentation must respect privacy and
 * authorization — demographic segmentation requires explicit permission.
 */
export function isSegmentationPermitted(input: {
  cohort: Cohort;
  requiresDemographicPermission: boolean;
  demographicPermissionGranted: boolean;
}): { ok: boolean; reason: string } {
  if (
    input.cohort.definition === "demographic_attributes" &&
    input.requiresDemographicPermission &&
    !input.demographicPermissionGranted
  ) {
    return { ok: false, reason: "Demographic segmentation requires explicit permission (N)" };
  }
  return { ok: true, reason: "Segmentation permitted (N)" };
}

/* ─────────────────────────────────────────────────────────────
 * Metric system (O)
 * ────────────────────────────────────────────────────────────*/

export type AggregationMethod =
  "count" | "sum" | "average" | "median" | "percentile" | "rate" | "ratio" | "growth";

export const AGGREGATION_METHODS: readonly AggregationMethod[] = [
  "count",
  "sum",
  "average",
  "median",
  "percentile",
  "rate",
  "ratio",
  "growth",
] as const;

export interface MetricDefinition {
  metricId: string;
  name: string;
  description: string;
  owner: string;
  formula: string;
  source: string;
  dimensions: AnalyticsDimension[];
  timeSemantics: string;
  unit: string;
  aggregation: AggregationMethod;
  version: number;
  lifecycle: string;
}

export interface CreateMetricInput {
  metricId: string;
  name: string;
  description: string;
  owner: string;
  formula: string;
  source: string;
  dimensions: AnalyticsDimension[];
  timeSemantics: string;
  unit: string;
  aggregation: AggregationMethod;
  version: number;
}

export type CreateMetricResult =
  { ok: true; metric: MetricDefinition } | { ok: false; error: string };

/**
 * Metric system (O): every metric must define its full contract. A metric
 * without an owner or formula is not a metric.
 */
export function createMetric(input: CreateMetricInput): CreateMetricResult {
  if (input.metricId.trim() === "" || input.name.trim() === "") {
    return { ok: false, error: "Metric requires an ID and name (O)" };
  }
  if (input.owner.trim() === "") {
    return { ok: false, error: "Metric requires an owner (O)" };
  }
  if (input.formula.trim() === "") {
    return { ok: false, error: "Metric requires a formula (O)" };
  }
  if (input.aggregation === "percentile" && input.dimensions.length === 0) {
    return { ok: false, error: "Percentile metrics require dimensions (O)" };
  }
  return {
    ok: true,
    metric: {
      metricId: input.metricId,
      name: input.name,
      description: input.description,
      owner: input.owner,
      formula: input.formula,
      source: input.source,
      dimensions: input.dimensions,
      timeSemantics: input.timeSemantics,
      unit: input.unit,
      aggregation: input.aggregation,
      version: input.version,
      lifecycle: "active",
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * KPI system (P, Q, R)
 * ────────────────────────────────────────────────────────────*/

export type KpiState = "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "UNKNOWN";

export const KPI_STATES: readonly KpiState[] = [
  "ON_TRACK",
  "AT_RISK",
  "OFF_TRACK",
  "UNKNOWN",
] as const;

export interface KpiDefinition {
  kpiId: string;
  metricId: string;
  objective: string;
  target: number | null;
  actual: number | null;
  variance: number | null;
  threshold: number | null;
  period: string;
  owner: string;
  status: KpiState;
  trend: "up" | "down" | "flat" | "unknown";
  confidence: number | null;
}

export interface EvaluateKpiInput {
  kpiId: string;
  metricId: string;
  objective: string;
  actual: number | null;
  target: number | null;
  threshold: number | null;
  period: string;
  owner: string;
  higherIsBetter: boolean;
}

/**
 * KPI evaluation (P, Q): UNKNOWN must not automatically become failure or
 * success. When the actual is missing, the KPI state is UNKNOWN.
 */
export function evaluateKpi(input: EvaluateKpiInput): KpiDefinition {
  if (input.actual === null) {
    return {
      kpiId: input.kpiId,
      metricId: input.metricId,
      objective: input.objective,
      target: input.target,
      actual: null,
      variance: null,
      threshold: input.threshold,
      period: input.period,
      owner: input.owner,
      status: "UNKNOWN",
      trend: "unknown",
      confidence: null,
    };
  }
  const variance = input.target === null ? null : Number((input.actual - input.target).toFixed(4));
  const isOnTrack =
    input.target === null
      ? true
      : input.higherIsBetter
        ? input.actual >= input.target
        : input.actual <= input.target;
  const thresholdBreached =
    input.threshold !== null &&
    (input.higherIsBetter ? input.actual < input.threshold : input.actual > input.threshold);
  return {
    kpiId: input.kpiId,
    metricId: input.metricId,
    objective: input.objective,
    target: input.target,
    actual: input.actual,
    variance,
    threshold: input.threshold,
    period: input.period,
    owner: input.owner,
    status: isOnTrack ? "ON_TRACK" : thresholdBreached ? "OFF_TRACK" : "AT_RISK",
    trend: variance === null ? "unknown" : variance === 0 ? "flat" : variance > 0 ? "up" : "down",
    confidence: 1,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Threshold engine (S)
 * ────────────────────────────────────────────────────────────*/

export type ThresholdType = "static" | "dynamic" | "percentile" | "statistical" | "policy";

export const THRESHOLD_TYPES: readonly ThresholdType[] = [
  "static",
  "dynamic",
  "percentile",
  "statistical",
  "policy",
] as const;

export interface Threshold {
  thresholdId: string;
  type: ThresholdType;
  value: number;
  operator: "gt" | "gte" | "lt" | "lte";
}

export function isThresholdBreached(threshold: Threshold, value: number): boolean {
  switch (threshold.operator) {
    case "gt":
      return value > threshold.value;
    case "gte":
      return value >= threshold.value;
    case "lt":
      return value < threshold.value;
    case "lte":
      return value <= threshold.value;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Baseline and benchmarking (T, U)
 * ────────────────────────────────────────────────────────────*/

export interface Baseline {
  baselineId: string;
  metricId: string;
  period: string;
  value: number;
  establishedAt: string;
}

/**
 * Baseline engine (T): analytics must establish baselines before claiming
 * improvement. Improvement claims require a recorded baseline.
 */
export function canClaimImprovement(input: {
  baseline: Baseline | null;
  currentValue: number;
  higherIsBetter: boolean;
}): { improved: boolean; reason: string } {
  if (input.baseline === null) {
    return {
      improved: false,
      reason: "No baseline established — improvement cannot be claimed (T)",
    };
  }
  const improved = input.higherIsBetter
    ? input.currentValue > input.baseline.value
    : input.currentValue < input.baseline.value;
  return {
    improved,
    reason: improved ? "Improved versus baseline (T)" : "Not improved versus baseline (T)",
  };
}

export interface Benchmark {
  benchmarkId: string;
  kind: "historical" | "peer_group" | "institutional_target" | "external";
  value: number;
  provenance: string | null;
}

/** Benchmarking (U): external benchmarks must include provenance. */
export function isExternalBenchmarkValid(benchmark: Benchmark): boolean {
  return (
    benchmark.kind !== "external" ||
    (benchmark.provenance !== null && benchmark.provenance.trim() !== "")
  );
}

/* ─────────────────────────────────────────────────────────────
 * Data quality, missing data and imputation (V, W, X, Y)
 * ────────────────────────────────────────────────────────────*/

export interface AnalyticalQuality {
  completeness: number;
  accuracy: number;
  consistency: number;
  timeliness: number;
  uniqueness: number;
  validity: number;
}

/**
 * Quality score (W): analytical outputs must expose data-quality
 * information. The composite is the unweighted mean of the quality
 * dimensions (V) — decomposable and explainable.
 */
export function analyticalQualityScore(quality: AnalyticalQuality): number {
  const values = [
    quality.completeness,
    quality.accuracy,
    quality.consistency,
    quality.timeliness,
    quality.uniqueness,
    quality.validity,
  ].map((v) => Math.max(0, Math.min(1, v)));
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3));
}

export interface MissingDataReport {
  field: string;
  missingCount: number;
  totalCount: number;
  missingRatio: number;
}

/**
 * Missing data (X): missing values are represented explicitly and never
 * silently replaced with zero.
 */
export function reportMissingData(input: {
  field: string;
  missingCount: number;
  totalCount: number;
}): MissingDataReport {
  return {
    field: input.field,
    missingCount: input.missingCount,
    totalCount: input.totalCount,
    missingRatio:
      input.totalCount === 0 ? 0 : Number((input.missingCount / input.totalCount).toFixed(4)),
  };
}

export interface ImputationRecord {
  imputationId: string;
  field: string;
  method: string;
  assumptions: string[];
  affectedObservations: number;
  confidence: number;
}

/**
 * Imputation (Y): when imputation is used, record the method, assumptions,
 * affected observations and confidence.
 */
export function createImputationRecord(
  input: Omit<ImputationRecord, "imputationId">,
): ImputationRecord {
  return { ...input, imputationId: `imp-${input.field}-${timeAuthority.now().atMs}` };
}

/* ─────────────────────────────────────────────────────────────
 * Analytical lineage and provenance (Z, AA)
 * ────────────────────────────────────────────────────────────*/

export interface AnalyticalProvenance {
  source: string;
  timestamp: string;
  version: string;
  transformation: string | null;
  model: string | null;
  analyst: string | null;
  query: string | null;
}

export interface AnalyticalOutput {
  outputId: string;
  tenantId: TenantId;
  computedAt: string;
  provenance: AnalyticalProvenance;
  quality: AnalyticalQuality;
  value: number | null;
  missingData: MissingDataReport[];
  imputations: ImputationRecord[];
}

/**
 * Analytical truth principle (E): a derived analytical output is never
 * canonical truth. This contract forces every output to carry provenance,
 * quality and missing-data visibility.
 */
export function isAnalyticalOutputTruthSafe(output: AnalyticalOutput): boolean {
  return output.provenance.source.trim() !== "" && output.provenance.version.trim() !== "";
}
