/**
 * CoreGrid Scholar — Phase 18 Analytics & Decision Intelligence unit tests
 * (analytics-governance).
 *
 * Validates:
 * - Metric governance and versioning (AD, AE): changes produce versions,
 *   never silent rewrites.
 * - Report versioning and reproducibility (DE, DF, GU): pinned dataset
 *   and metric versions required.
 * - Alerts (DM, DN): alerts never directly execute actions; fatigue
 *   management; escalation.
 * - Composite scores (EE, EF): decomposable, never objective reality.
 * - Access control and small-cell protection (CH, CM).
 * - Inference control (GO) and version pinning (GV).
 * - Experiments (EQ, ER): effect size, confidence intervals, multiple
 *   comparisons.
 * - Analytical failure modes (HF): detected, fallback never silent.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  versionMetric,
  isSnapshotUsableForLockedPeriod,
  createReportVersion,
  isReportReproducible,
  approveReport,
  shouldEmitAlert,
  escalateAlert,
  computeCompositeScore,
  authorizeAnalyticsAccess,
  isSmallCellProtected,
  isInferenceAttackDetected,
  isVersionPinComplete,
  evaluateExperiment,
  detectAnalyticalFailureMode,
  type AnalyticalAlert,
  type AnalyticalSnapshot,
  type AlertFatiguePolicy,
  type ReportVersion,
} from "@/lib/analytics-governance";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");

function alert(overrides: Partial<AnalyticalAlert> = {}): AnalyticalAlert {
  return {
    alertId: "al-1",
    tenantId: TENANT_A,
    severity: "warning",
    source: "kpi_threshold",
    message: "attendance below threshold",
    createdAt: "2026-01-01T00:00:00Z",
    correlationGroup: null,
    suppressed: false,
    ...overrides,
  };
}

describe("Metric governance and versioning (AD, AE)", () => {
  it("versions a metric definition change instead of rewriting", () => {
    const version = versionMetric({
      metricId: "attendance-rate",
      currentVersion: 2,
      definitionHash: "hash-v3",
      changedBy: "analytics-team",
      changedAt: "2026-01-01T00:00:00Z",
      reason: "include distance learners",
    });
    expect(version.version).toBe(3);
  });
});

describe("Reporting (DD, DE, DF, DG)", () => {
  it("creates a versioned report", () => {
    const report = createReportVersion({
      reportId: "rep-1",
      version: 1,
      kind: "financial",
      tenantId: TENANT_A,
      createdBy: "analyst-1",
      createdAt: "2026-01-01T00:00:00Z",
      datasetVersion: "ds-1",
      metricVersions: { revenue: 2 },
    });
    expect(report.version).toBe(1);
    expect(report.approvedBy).toBeNull();
  });

  it("requires a matching snapshot for reproducibility (DF, GU)", () => {
    const report = createReportVersion({
      reportId: "rep-1",
      version: 1,
      kind: "regulatory",
      tenantId: TENANT_A,
      createdBy: "a",
      createdAt: "2026-01-01T00:00:00Z",
      datasetVersion: "ds-1",
      metricVersions: { revenue: 2 },
    });
    const snapshot: AnalyticalSnapshot = {
      snapshotId: "snap-1",
      reportId: "rep-1",
      tenantId: TENANT_A,
      takenAt: "2026-01-01T00:00:00Z",
      dataVersion: "ds-1",
      metricVersions: { revenue: 2 },
      modelVersions: {},
      locked: true,
    };
    expect(isReportReproducible(report, snapshot)).toBe(true);
    expect(isReportReproducible(report, null)).toBe(false);
    expect(isReportReproducible(report, { ...snapshot, dataVersion: "ds-2" })).toBe(false);
  });

  it("approves reports and locks snapshots", () => {
    const report: ReportVersion = createReportVersion({
      reportId: "rep-1",
      version: 1,
      kind: "executive",
      tenantId: TENANT_A,
      createdBy: "a",
      createdAt: "2026-01-01T00:00:00Z",
      datasetVersion: "ds-1",
      metricVersions: {},
    });
    expect(approveReport(report, "finance-dir").approvedBy).toBe("finance-dir");
    expect(
      isSnapshotUsableForLockedPeriod({
        snapshotId: "s",
        reportId: "r",
        tenantId: TENANT_A,
        takenAt: "2026-01-01T00:00:00Z",
        dataVersion: "ds-1",
        metricVersions: {},
        modelVersions: {},
        locked: true,
      }),
    ).toBe(true);
  });
});

describe("Alerts (DM, DN)", () => {
  it("emits alerts that never directly execute actions — contract only", () => {
    const policy: AlertFatiguePolicy = {
      deduplicate: true,
      groupCorrelated: false,
      maxAlertsPerHour: 5,
      escalationAfterHours: null,
    };
    expect(shouldEmitAlert(alert(), policy, 0).emit).toBe(true);
  });

  it("suppresses alerts and caps the rate (DN)", () => {
    const policy: AlertFatiguePolicy = {
      deduplicate: true,
      groupCorrelated: true,
      maxAlertsPerHour: 2,
      escalationAfterHours: null,
    };
    expect(shouldEmitAlert(alert({ suppressed: true }), policy, 0).emit).toBe(false);
    expect(shouldEmitAlert(alert(), policy, 2).emit).toBe(false);
  });

  it("deduplicates correlated alerts (DN)", () => {
    const policy: AlertFatiguePolicy = {
      deduplicate: true,
      groupCorrelated: true,
      maxAlertsPerHour: 10,
      escalationAfterHours: null,
    };
    const correlated = alert({ correlationGroup: "incident-1" });
    expect(shouldEmitAlert(correlated, policy, 0).emit).toBe(true);
    expect(shouldEmitAlert(correlated, policy, 1).emit).toBe(false);
  });

  it("escalates critical alerts (DO)", () => {
    expect(escalateAlert(alert({ severity: "critical" })).severity).toBe("critical_escalated");
    expect(escalateAlert(alert({ severity: "info" })).severity).toBe("info");
  });
});

describe("Composite scores (EE, EF)", () => {
  it("computes a decomposable weighted score", () => {
    const score = computeCompositeScore(
      "health-1",
      "institutional_health",
      [
        {
          metricId: "attendance",
          weight: 1,
          value: 0.9,
          freshness: "2026-01-01T00:00:00Z",
          uncertainty: 0.05,
        },
        {
          metricId: "retention",
          weight: 2,
          value: 0.7,
          freshness: "2026-01-01T00:00:00Z",
          uncertainty: 0.1,
        },
      ],
      ["weights are advisory"],
    );
    expect(score.score).toBeCloseTo(0.7667, 2);
    expect(score.components).toHaveLength(2);
    expect(score.assumptions).toHaveLength(1);
  });
});

describe("Access control and privacy (CH, CM)", () => {
  it("enforces tenant, role and classification", () => {
    expect(
      authorizeAnalyticsAccess({
        actorTenantId: TENANT_A,
        resourceTenantId: TENANT_A,
        role: "analyst",
        requiredRoles: ["analyst", "admin"],
        dataClassification: "INTERNAL",
        maxAllowedClassificationRank: 3,
        crossTenantGranted: false,
      }).allowed,
    ).toBe(true);
    expect(
      authorizeAnalyticsAccess({
        actorTenantId: TENANT_A,
        resourceTenantId: TENANT_B,
        role: "analyst",
        requiredRoles: ["analyst"],
        dataClassification: "INTERNAL",
        maxAllowedClassificationRank: 3,
        crossTenantGranted: false,
      }).allowed,
    ).toBe(false);
    expect(
      authorizeAnalyticsAccess({
        actorTenantId: TENANT_A,
        resourceTenantId: TENANT_A,
        role: "guest",
        requiredRoles: ["analyst"],
        dataClassification: "INTERNAL",
        maxAllowedClassificationRank: 3,
        crossTenantGranted: false,
      }).allowed,
    ).toBe(false);
    expect(
      authorizeAnalyticsAccess({
        actorTenantId: TENANT_A,
        resourceTenantId: TENANT_A,
        role: "analyst",
        requiredRoles: ["analyst"],
        dataClassification: "REGULATED",
        maxAllowedClassificationRank: 3,
        crossTenantGranted: false,
      }).allowed,
    ).toBe(false);
  });

  it("protects small cells (CM)", () => {
    expect(isSmallCellProtected(3, 5)).toBe(true);
    expect(isSmallCellProtected(0, 5)).toBe(false);
    expect(isSmallCellProtected(10, 5)).toBe(false);
  });
});

describe("Inference control and version pinning (GO, GV)", () => {
  it("detects inference attacks from cumulative row exposure (GO)", () => {
    expect(
      isInferenceAttackDetected({
        recentQueries: [
          { filter: "x", returnedRows: 40 },
          { filter: "y", returnedRows: 40 },
        ],
        sensitiveFields: ["salary"],
        maxCumulativeRows: 50,
      }),
    ).toBe(true);
    expect(
      isInferenceAttackDetected({
        recentQueries: [{ filter: "x", returnedRows: 10 }],
        sensitiveFields: ["salary"],
        maxCumulativeRows: 50,
      }),
    ).toBe(false);
  });

  it("requires complete version pins for reproducibility (GV)", () => {
    expect(
      isVersionPinComplete({
        datasetVersion: "ds-1",
        metricVersions: {},
        modelVersions: {},
        queryVersion: "q-1",
      }),
    ).toBe(true);
    expect(
      isVersionPinComplete({
        datasetVersion: "",
        metricVersions: {},
        modelVersions: {},
        queryVersion: "q-1",
      }),
    ).toBe(false);
  });
});

describe("Experiments (EQ, ER)", () => {
  it("evaluates effect size with confidence intervals", () => {
    const result = evaluateExperiment({
      experimentId: "exp-1",
      treatmentMean: 85,
      controlMean: 80,
      treatmentStdDev: 10,
      controlStdDev: 10,
      treatmentN: 100,
      controlN: 100,
      significanceLevel: 0.05,
      multipleComparisons: false,
    });
    expect(result.effectSize).toBe(5);
    expect(result.statisticallySignificant).toBe(true);
  });

  it("reports missing group statistics explicitly and marks multiple comparisons", () => {
    const result = evaluateExperiment({
      experimentId: "exp-2",
      treatmentMean: null,
      controlMean: 80,
      treatmentStdDev: null,
      controlStdDev: 10,
      treatmentN: 100,
      controlN: 100,
      significanceLevel: 0.05,
      multipleComparisons: true,
    });
    expect(result.effectSize).toBeNull();
    expect(result.comparisonsAdjusted).toBe(true);
  });
});

describe("Analytical failure modes (HF)", () => {
  it("detects stale, incomplete, conflicting data and unavailable models", () => {
    expect(
      detectAnalyticalFailureMode({
        dataFresh: false,
        dataComplete: true,
        dataConsistent: true,
        modelAvailable: true,
      }),
    ).toBe("stale_data");
    expect(
      detectAnalyticalFailureMode({
        dataFresh: true,
        dataComplete: false,
        dataConsistent: true,
        modelAvailable: true,
      }),
    ).toBe("incomplete_data");
    expect(
      detectAnalyticalFailureMode({
        dataFresh: true,
        dataComplete: true,
        dataConsistent: false,
        modelAvailable: true,
      }),
    ).toBe("conflicting_data");
    expect(
      detectAnalyticalFailureMode({
        dataFresh: true,
        dataComplete: true,
        dataConsistent: true,
        modelAvailable: false,
      }),
    ).toBe("unavailable_model");
    expect(
      detectAnalyticalFailureMode({
        dataFresh: true,
        dataComplete: true,
        dataConsistent: true,
        modelAvailable: true,
      }),
    ).toBe("none");
  });
});
