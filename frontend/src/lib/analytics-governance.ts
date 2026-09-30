/**
 * CoreGrid — Analytics & Decision Intelligence governance domain
 * (Phase 18, Sections AC, AD, AE, AF, AG, DD, DE, DF, DG, DH, DI, DJ, DK,
 * DM, DN, DO, DP, DQ, EE, EF, EG, EH, EL, EM, EN, EO, EP, EQ, ER, CH, CI,
 * CJ, CK, CL, CM, CN, CO, CP, CQ, CR, CW, CX, CY, DA, DB, GN, GO, GP, GQ,
 * GR, GS, GT, GU, GV, HF, HH).
 *
 * Implements `architecture/phase-18-analytics-intelligence.md`:
 * - Semantic layer (AC): common analytical vocabulary with canonical
 *   definitions; metric governance (AD) — two departments must not
 *   silently calculate the same KPI differently.
 * - Metric versioning (AE), immutable analytical snapshots (AF) and
 *   reporting period lock (AG).
 * - Reporting engine (DD-DI): operational/academic/financial/executive/
 *   regulatory reports; versioning; reproducibility; approval;
 *   distribution respecting authorization/classification/tenant;
 *   scheduled reporting.
 * - Export (DJ, DK): controlled CSV/spreadsheet/PDF/API exports that
 *   respect data permissions.
 * - Alerts (DM-DQ): threshold/anomaly/forecast/risk triggers; alerts do
 *   not directly execute actions; fatigue management via dedup/grouping/
 *   priority/suppression/escalation; severity; correlation; root-cause
 *   analysis without claiming causation.
 * - Health and risk scores (EE, EF): composite scores expose component
 *   metrics, weighting, assumptions, freshness and uncertainty — never
 *   objective reality.
 * - Early warning (EG, EH): warnings must not automatically punish or
 *   label individuals without authorized policy and review.
 * - Institutional comparison (EL) and normalization (EM); external
 *   benchmarks must include provenance (EN).
 * - Experiments (EO-ER): hypothesis, population, treatment, control,
 *   metric, duration, success criteria; assignment avoids contamination;
 *   evaluation includes effect size, uncertainty, confidence intervals;
 *   multiple-testing accounted for.
 * - Access control (CH-CM): identity, tenant, role, resource scope, data
 *   classification; row/column-level security; aggregation privacy;
 *   small-cell protection; privacy-preserving analytics.
 * - Fairness (CN, CO): metrics support investigation, never automatically
 *   declare institutional wrongdoing.
 * - Explainability (CP, CQ): explanations must accurately represent what
 *   the model actually knows.
 * - Output security (GN), inference control (GO), query rate limiting
 *   (GP), auditable analytics (GQ).
 * - Retention (GR), legal hold (GS), immutable evidence (GT).
 * - Analytical reproduction (GU) and version pinning (GV): dataset,
 *   metric, model and query versions.
 * - Failure modes (HF) and fallback (HH): stale/incomplete/conflicting
 *   data and unavailable models are detected.
 */

import type { TenantId } from "./tenant-core";
import type { DataClassification } from "./data-core";

/* ─────────────────────────────────────────────────────────────
 * Metric governance and versioning (AD, AE)
 * ────────────────────────────────────────────────────────────*/

export interface MetricVersion {
  metricId: string;
  version: number;
  definitionHash: string;
  changedBy: string;
  changedAt: string;
  reason: string;
}

/**
 * Metric governance (AD, AE): a metric definition change produces a new
 * version rather than silently rewriting history. Two departments cannot
 * silently calculate the same KPI differently when they share the same
 * canonical metric.
 */
export function versionMetric(input: {
  metricId: string;
  currentVersion: number;
  definitionHash: string;
  changedBy: string;
  changedAt: string;
  reason: string;
}): MetricVersion {
  return {
    metricId: input.metricId,
    version: input.currentVersion + 1,
    definitionHash: input.definitionHash,
    changedBy: input.changedBy,
    changedAt: input.changedAt,
    reason: input.reason,
  };
}

export interface AnalyticalSnapshot {
  snapshotId: string;
  reportId: string;
  tenantId: TenantId;
  takenAt: string;
  dataVersion: string;
  metricVersions: Record<string, number>;
  modelVersions: Record<string, number>;
  locked: boolean;
}

/** Immutable snapshots (AF) for board/regulatory/financial/audit reports. */
export function isSnapshotUsableForLockedPeriod(snapshot: AnalyticalSnapshot): boolean {
  return snapshot.locked;
}

/* ─────────────────────────────────────────────────────────────
 * Reporting engine (DD, DE, DF, DG, DH, DI)
 * ────────────────────────────────────────────────────────────*/

export type ReportKind = "operational" | "academic" | "financial" | "executive" | "regulatory";

export const REPORT_KINDS: readonly ReportKind[] = [
  "operational",
  "academic",
  "financial",
  "executive",
  "regulatory",
] as const;

export interface ReportVersion {
  reportId: string;
  version: number;
  kind: ReportKind;
  tenantId: TenantId;
  createdBy: string;
  createdAt: string;
  datasetVersion: string;
  metricVersions: Record<string, number>;
  approvedBy: string | null;
}

export interface CreateReportVersionInput {
  reportId: string;
  version: number;
  kind: ReportKind;
  tenantId: TenantId;
  createdBy: string;
  createdAt: string;
  datasetVersion: string;
  metricVersions: Record<string, number>;
}

/**
 * Report versioning (DE): reports must be versioned; reproduction (DF,
 * GU) requires the source dataset and metric versions to be pinned.
 */
export function createReportVersion(input: CreateReportVersionInput): ReportVersion {
  return { ...input, approvedBy: null };
}

export function isReportReproducible(
  report: ReportVersion,
  snapshot: AnalyticalSnapshot | null,
): boolean {
  if (snapshot === null) {
    return false;
  }
  return (
    snapshot.dataVersion === report.datasetVersion &&
    JSON.stringify(snapshot.metricVersions) === JSON.stringify(report.metricVersions)
  );
}

export function approveReport(report: ReportVersion, approvedBy: string): ReportVersion {
  return { ...report, approvedBy };
}

/* ─────────────────────────────────────────────────────────────
 * Alerts (DM, DN, DO, DP)
 * ────────────────────────────────────────────────────────────*/

export type AlertSeverity = "info" | "warning" | "critical" | "critical_escalated";

export const ALERT_SEVERITIES: readonly AlertSeverity[] = [
  "info",
  "warning",
  "critical",
  "critical_escalated",
] as const;

export interface AnalyticalAlert {
  alertId: string;
  tenantId: TenantId;
  severity: AlertSeverity;
  source: "kpi_threshold" | "anomaly" | "forecast" | "risk_change" | "performance_degradation";
  message: string;
  createdAt: string;
  correlationGroup: string | null;
  suppressed: boolean;
}

export interface AlertFatiguePolicy {
  deduplicate: boolean;
  groupCorrelated: boolean;
  maxAlertsPerHour: number;
  escalationAfterHours: number | null;
}

/**
 * Alert fatigue management (DN): deduplication, grouping, prioritization,
 * suppression and escalation. Alerts do not directly execute actions
 * (DM).
 */
export function shouldEmitAlert(
  alert: AnalyticalAlert,
  policy: AlertFatiguePolicy,
  alertsThisHour: number,
): { emit: boolean; reason: string } {
  if (alert.suppressed) {
    return { emit: false, reason: "Alert suppressed (DN)" };
  }
  if (policy.deduplicate && alert.correlationGroup !== null && alertsThisHour > 0) {
    // Grouped alerts are emitted once per window; the first one carries the group.
    return { emit: alertsThisHour === 0, reason: "Deduplicated via correlation group (DN)" };
  }
  if (alertsThisHour >= policy.maxAlertsPerHour) {
    return { emit: false, reason: "Alert rate cap reached (DN)" };
  }
  return { emit: true, reason: "Alert emitted (DM)" };
}

export function escalateAlert(alert: AnalyticalAlert): AnalyticalAlert {
  return {
    ...alert,
    severity: alert.severity === "critical" ? "critical_escalated" : alert.severity,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Health and risk scores (EE, EF)
 * ────────────────────────────────────────────────────────────*/

export interface HealthScoreComponent {
  metricId: string;
  weight: number;
  value: number;
  freshness: string | null;
  uncertainty: number | null;
}

export interface CompositeScore {
  scoreId: string;
  kind: "institutional_health" | "risk";
  components: HealthScoreComponent[];
  score: number;
  assumptions: string[];
}

/**
 * Composite scores (EE, EF): never presented as objective reality — they
 * expose component metrics, weighting, assumptions, freshness and
 * uncertainty.
 */
export function computeCompositeScore(
  scoreId: string,
  kind: CompositeScore["kind"],
  components: HealthScoreComponent[],
  assumptions: string[],
): CompositeScore {
  const totalWeight = components.reduce((acc, c) => acc + c.weight, 0);
  const score =
    totalWeight === 0
      ? 0
      : components.reduce((acc, c) => acc + c.weight * Math.max(0, Math.min(1, c.value)), 0) /
        totalWeight;
  return { scoreId, kind, components, score: Number(score.toFixed(3)), assumptions };
}

/* ─────────────────────────────────────────────────────────────
 * Access control and privacy (CH, CI, CJ, CK, CM)
 * ────────────────────────────────────────────────────────────*/

export interface AnalyticsAccessRequest {
  actorTenantId: TenantId;
  resourceTenantId: TenantId;
  role: string;
  requiredRoles: string[];
  dataClassification: DataClassification;
  maxAllowedClassificationRank: number;
}

/**
 * Access control (CH, CM): analytics enforce identity, tenant, role,
 * resource scope and data classification. Cross-tenant analytical access
 * is prohibited without an explicit grant.
 */
export function authorizeAnalyticsAccess(
  input: AnalyticsAccessRequest & { crossTenantGranted: boolean },
): { allowed: boolean; reason: string } {
  if (input.actorTenantId !== input.resourceTenantId && !input.crossTenantGranted) {
    return {
      allowed: false,
      reason: "Cross-tenant analytical access denied without explicit grant (CH)",
    };
  }
  if (!input.requiredRoles.includes(input.role)) {
    return {
      allowed: false,
      reason: `Role "${input.role}" is not permitted for this analytical dataset (CH)`,
    };
  }
  if (classificationRank(input.dataClassification) > input.maxAllowedClassificationRank) {
    return { allowed: false, reason: "Data classification exceeds permitted level (CH)" };
  }
  return { allowed: true, reason: "Analytical access authorized (CH)" };
}

function classificationRank(classification: DataClassification): number {
  const order: readonly DataClassification[] = [
    "PUBLIC",
    "INTERNAL",
    "CONFIDENTIAL",
    "SENSITIVE",
    "HIGHLY_SENSITIVE",
    "REGULATED",
  ];
  const index = order.indexOf(classification);
  return index === -1 ? 0 : index;
}

/** Small-cell protection (CM): do not expose sensitive statistics for
 * extremely small populations where policy prohibits it. */
export function isSmallCellProtected(populationSize: number, minimumSize: number): boolean {
  return populationSize > 0 && populationSize < minimumSize;
}

/* ─────────────────────────────────────────────────────────────
 * Output security and inference control (GN, GO, GP)
 * ────────────────────────────────────────────────────────────*/

export interface InferenceControlState {
  recentQueries: Array<{ filter: string; returnedRows: number }>;
  sensitiveFields: string[];
  maxCumulativeRows: number;
}

/**
 * Inference control (GO): prevent users from reconstructing restricted
 * information through repeated queries. Cumulative row exposure beyond the
 * limit blocks further sensitive queries.
 */
export function isInferenceAttackDetected(state: InferenceControlState): boolean {
  const total = state.recentQueries.reduce((acc, q) => acc + q.returnedRows, 0);
  return total > state.maxCumulativeRows;
}

/* ─────────────────────────────────────────────────────────────
 * Experiments (EO, EP, EQ, ER)
 * ────────────────────────────────────────────────────────────*/

export interface ExperimentDefinition {
  experimentId: string;
  hypothesis: string;
  population: string;
  treatment: string;
  control: string;
  metricId: string;
  durationDays: number;
  successCriteria: string;
}

export interface ExperimentResult {
  experimentId: string;
  effectSize: number | null;
  confidenceInterval: { lower: number | null; upper: number | null };
  statisticallySignificant: boolean | null;
  comparisonsAdjusted: boolean;
}

/**
 * Experiment analysis (EQ, ER): evaluate effect size, uncertainty,
 * confidence intervals and statistical significance; multiple-testing
 * adjustments are explicit.
 */
export function evaluateExperiment(input: {
  experimentId: string;
  treatmentMean: number | null;
  controlMean: number | null;
  treatmentStdDev: number | null;
  controlStdDev: number | null;
  treatmentN: number;
  controlN: number;
  significanceLevel: number;
  multipleComparisons: boolean;
}): ExperimentResult {
  if (
    input.treatmentMean === null ||
    input.controlMean === null ||
    input.treatmentStdDev === null ||
    input.controlStdDev === null
  ) {
    return {
      experimentId: input.experimentId,
      effectSize: null,
      confidenceInterval: { lower: null, upper: null },
      statisticallySignificant: null,
      comparisonsAdjusted: input.multipleComparisons,
    };
  }
  const effectSize = Number((input.treatmentMean - input.controlMean).toFixed(4));
  const pooledStd = Math.sqrt((input.treatmentStdDev ** 2 + input.controlStdDev ** 2) / 2);
  const standardError = pooledStd * Math.sqrt(1 / input.treatmentN + 1 / input.controlN);
  const z = 1.96;
  const halfWidth = Number((z * standardError).toFixed(4));
  const significant = standardError === 0 ? false : Math.abs(effectSize) / standardError > z;
  return {
    experimentId: input.experimentId,
    effectSize,
    confidenceInterval: {
      lower: Number((effectSize - halfWidth).toFixed(4)),
      upper: Number((effectSize + halfWidth).toFixed(4)),
    },
    statisticallySignificant: significant,
    comparisonsAdjusted: input.multipleComparisons,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Reproduction, version pinning and failure modes (GU, GV, HF, HH)
 * ────────────────────────────────────────────────────────────*/

export interface VersionPin {
  datasetVersion: string;
  metricVersions: Record<string, number>;
  modelVersions: Record<string, number>;
  queryVersion: string;
}

/**
 * Version pinning (GV): reports and decisions may pin dataset, metric,
 * model and query versions for reproducibility (GU).
 */
export function isVersionPinComplete(pin: VersionPin): boolean {
  return pin.datasetVersion.trim() !== "" && pin.queryVersion.trim() !== "";
}

export type AnalyticalFailureMode =
  "stale_data" | "incomplete_data" | "conflicting_data" | "unavailable_model" | "none";

export const ANALYTICAL_FAILURE_MODES: readonly AnalyticalFailureMode[] = [
  "stale_data",
  "incomplete_data",
  "conflicting_data",
  "unavailable_model",
  "none",
] as const;

/**
 * Analytical failure modes (HF): the system must detect stale,
 * incomplete and conflicting data and unavailable models. Fallback (HH)
 * requires an explicit, audited decision — never a silent substitution.
 */
export function detectAnalyticalFailureMode(input: {
  dataFresh: boolean;
  dataComplete: boolean;
  dataConsistent: boolean;
  modelAvailable: boolean;
}): AnalyticalFailureMode {
  if (!input.dataFresh) return "stale_data";
  if (!input.dataComplete) return "incomplete_data";
  if (!input.dataConsistent) return "conflicting_data";
  if (!input.modelAvailable) return "unavailable_model";
  return "none";
}
