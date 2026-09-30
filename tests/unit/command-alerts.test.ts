/**
 * CoreGrid Scholar — Phase 19 Institutional Command Centre unit tests
 * (command-alerts).
 *
 * Validates:
 * - Alert creation (Y, Z): source alert ID provenance preserved.
 * - Acknowledgement (AD), severity (AB) and status (AC).
 * - Priority engine (AJ, AK): explainable priority from stated factors.
 * - Escalation (AE): unacknowledged high-severity alerts escalate.
 * - Correlation (AF), flood control (AG) and fatigue reduction (AH).
 * - Command queue ordering (AI).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createCommandAlert,
  acknowledgeAlert,
  computeAlertPriority,
  isAlertHighPriority,
  shouldEscalateAlert,
  correlateAlerts,
  isAlertFlooded,
  orderAttentionQueue,
  type CommandAlert,
  type CommandQueueItem,
} from "@/lib/command-alerts";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

function alert(overrides: Partial<CommandAlert> = {}): CommandAlert {
  return {
    alertId: "al-1",
    tenantId: TENANT_A,
    source: "analytics",
    sourceAlertId: "src-al-1",
    severity: "HIGH",
    status: "OPEN",
    summary: "attendance drop",
    impactedScope: ["dept-science"],
    createdAt: "2026-01-01T00:00:00Z",
    acknowledgedBy: null,
    acknowledgedAt: null,
    correlationGroup: null,
    priority: 0,
    ...overrides,
  };
}

describe("Alert creation and ownership (Y, Z)", () => {
  it("creates an OPEN alert preserving the source alert ID", () => {
    const result = createCommandAlert({
      alertId: "al-1",
      tenantId: TENANT_A,
      source: "security",
      sourceAlertId: "sec-99",
      severity: "CRITICAL",
      summary: "access anomaly",
      impactedScope: ["campus-a"],
      createdAt: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alert.status).toBe("OPEN");
      expect(result.alert.sourceAlertId).toBe("sec-99");
    }
  });

  it("rejects an alert without source provenance (Z)", () => {
    expect(
      createCommandAlert({
        alertId: "al-1",
        tenantId: TENANT_A,
        source: "security",
        sourceAlertId: "",
        severity: "HIGH",
        summary: "x",
        impactedScope: [],
        createdAt: NOW,
      }).ok,
    ).toBe(false);
  });
});

describe("Acknowledgement and status (AD, AC)", () => {
  it("records actor, timestamp and acknowledgement state", () => {
    const acknowledged = acknowledgeAlert(alert(), "ops-1", NOW);
    expect(acknowledged.status).toBe("ACKNOWLEDGED");
    expect(acknowledged.acknowledgedBy).toBe("ops-1");
  });
});

describe("Priority engine (AJ, AK)", () => {
  it("computes explainable priority from stated factors", () => {
    const priority = computeAlertPriority({
      severity: "CRITICAL",
      impact: 1,
      urgency: 1,
      confidence: 0.9,
      affectedPopulation: 800,
      businessImportance: 1,
    });
    expect(priority).toBeGreaterThan(0.8);
    const low = computeAlertPriority({
      severity: "INFO",
      impact: 0.1,
      urgency: 0.1,
      confidence: 0.9,
      affectedPopulation: 5,
      businessImportance: 0.1,
    });
    expect(low).toBeLessThan(0.4);
  });

  it("flags high priority above the threshold", () => {
    expect(isAlertHighPriority(0.9, 0.7)).toBe(true);
    expect(isAlertHighPriority(0.5, 0.7)).toBe(false);
  });
});

describe("Escalation (AE)", () => {
  it("escalates unacknowledged high-severity alerts past the window", () => {
    const policy = {
      afterMinutes: 15,
      escalateAtSeverity: "HIGH" as const,
      escalateTo: "security-team",
    };
    const result = shouldEscalateAlert(alert({ createdAt: "2025-12-31T23:00:00Z" }), policy, NOW);
    expect(result.escalate).toBe(true);
    expect(result.target).toBe("security-team");
  });

  it("does not escalate acknowledged or low-severity alerts", () => {
    const policy = {
      afterMinutes: 15,
      escalateAtSeverity: "HIGH" as const,
      escalateTo: "security-team",
    };
    expect(
      shouldEscalateAlert(
        alert({ status: "ACKNOWLEDGED", createdAt: "2025-12-31T23:00:00Z" }),
        policy,
        NOW,
      ).escalate,
    ).toBe(false);
    expect(
      shouldEscalateAlert(
        alert({ severity: "LOW", createdAt: "2025-12-31T23:00:00Z" }),
        policy,
        NOW,
      ).escalate,
    ).toBe(false);
  });
});

describe("Correlation and flood control (AF, AG, AH)", () => {
  it("groups related alerts by correlation key (AF)", () => {
    const grouped = correlateAlerts(
      [alert(), alert({ alertId: "al-2", sourceAlertId: "src-2" })],
      "incident-7",
    );
    expect(grouped.every((a) => a.correlationGroup === "incident-7")).toBe(true);
  });

  it("deduplicates source floods (AG, AH)", () => {
    const policy = { deduplicateBySource: true, maxAlertsPerSourceWindow: 3, windowMs: 60_000 };
    expect(isAlertFlooded({ alert: alert(), policy, recentSourceAlerts: 2 }).suppressed).toBe(
      false,
    );
    expect(isAlertFlooded({ alert: alert(), policy, recentSourceAlerts: 3 }).suppressed).toBe(true);
  });
});

describe("Command queue (AI)", () => {
  it("orders the attention queue by priority then age", () => {
    const items: CommandQueueItem[] = [
      {
        queueItemId: "q1",
        tenantId: TENANT_A,
        kind: "urgent_alert",
        referenceId: "al-1",
        priority: 0.9,
        createdAt: "2026-01-01T00:01:00Z",
        assignedTo: null,
      },
      {
        queueItemId: "q2",
        tenantId: TENANT_A,
        kind: "pending_decision",
        referenceId: "d-1",
        priority: 0.5,
        createdAt: "2026-01-01T00:00:00Z",
        assignedTo: null,
      },
      {
        queueItemId: "q3",
        tenantId: TENANT_A,
        kind: "escalation",
        referenceId: "e-1",
        priority: 0.9,
        createdAt: "2026-01-01T00:00:00Z",
        assignedTo: null,
      },
    ];
    const ordered = orderAttentionQueue(items);
    expect(ordered[0].queueItemId).toBe("q3");
    expect(ordered[1].queueItemId).toBe("q1");
    expect(ordered[2].queueItemId).toBe("q2");
  });
});
