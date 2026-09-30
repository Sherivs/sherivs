/**
 * CoreGrid Scholar — Phase 14 Data Platform unit tests (data-core).
 *
 * Validates:
 * - Data classification ranking (I).
 * - Data ownership declarations (F).
 * - Dataset registration metadata (AM).
 * - Data versioning (AP) and temporal data (AQ).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  classificationRank,
  declareDataOwnership,
  registerDataset,
  createDatasetVersion,
  createTemporalRecord,
  closeTemporalRecord,
  isTemporalRecordActiveAt,
} from "@/lib/data-core";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

describe("Data classification (I)", () => {
  it("ranks stricter classifications higher", () => {
    expect(classificationRank("PUBLIC")).toBeLessThan(classificationRank("INTERNAL"));
    expect(classificationRank("INTERNAL")).toBeLessThan(classificationRank("CONFIDENTIAL"));
    expect(classificationRank("CONFIDENTIAL")).toBeLessThan(classificationRank("SENSITIVE"));
    expect(classificationRank("SENSITIVE")).toBeLessThan(classificationRank("HIGHLY_SENSITIVE"));
    expect(classificationRank("HIGHLY_SENSITIVE")).toBeLessThan(classificationRank("REGULATED"));
  });
});

describe("Data ownership (F)", () => {
  it("declares ownership for a domain", () => {
    const result = declareDataOwnership({
      domain: "financial",
      owningPhase: "phase-13-financial-system",
      authoritativeSource: "financial-service",
      schemaName: "financial.invoices",
      lifecycle: "active",
      sensitivity: "SENSITIVE",
      consumers: ["phase-18-analytics"],
      synchronizationPolicy: "event-driven",
      tenantId: TENANT_A,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.declaration.sensitivity).toBe("SENSITIVE");
      expect(result.declaration.consumers).toContain("phase-18-analytics");
    }
  });

  it("rejects a declaration without an owning phase or source", () => {
    const result = declareDataOwnership({
      domain: "academic",
      owningPhase: "",
      authoritativeSource: "x",
      schemaName: "s",
      lifecycle: "active",
      sensitivity: "INTERNAL",
      consumers: [],
      synchronizationPolicy: "scheduled",
      tenantId: TENANT_A,
    });
    expect(result.ok).toBe(false);
  });
});

describe("Dataset registration (AM)", () => {
  it("registers a dataset with metadata", () => {
    const result = registerDataset({
      name: "academic.attendance",
      tenantId: TENANT_A,
      domain: "academic",
      owner: "phase-04",
      description: "Attendance records",
      sensitivity: "SENSITIVE",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dataset.schemaVersion).toBe(1);
      expect(result.dataset.datasetVersion).toBe(1);
      expect(result.dataset.qualityScore).toBeNull();
    }
  });

  it("rejects a dataset without a name or owner", () => {
    expect(
      registerDataset({
        name: "",
        tenantId: TENANT_A,
        domain: "academic",
        owner: "o",
        description: "",
        sensitivity: "INTERNAL",
        now: NOW,
      }).ok,
    ).toBe(false);
    expect(
      registerDataset({
        name: "d",
        tenantId: TENANT_A,
        domain: "academic",
        owner: "",
        description: "",
        sensitivity: "INTERNAL",
        now: NOW,
      }).ok,
    ).toBe(false);
  });
});

describe("Data versioning and temporal data (AP, AQ)", () => {
  it("creates a dataset version with a reason", () => {
    const result = createDatasetVersion({
      datasetName: "academic.attendance",
      tenantId: TENANT_A,
      datasetVersion: 2,
      schemaVersion: 1,
      reason: "Reprocessed term data",
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid version number", () => {
    const result = createDatasetVersion({
      datasetName: "d",
      tenantId: TENANT_A,
      datasetVersion: 0,
      schemaVersion: 1,
      reason: "x",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("preserves historical truth via temporal records (AQ)", () => {
    const created = createTemporalRecord({
      entityId: "student-1",
      tenantId: TENANT_A,
      effectiveFrom: "2025-09-01T00:00:00Z",
      state: { classId: "class-1" },
      now: NOW,
    });
    if (!created.ok) throw new Error("fixture failed");
    expect(isTemporalRecordActiveAt(created.record, "2025-10-01T00:00:00Z")).toBe(true);

    // Value change creates a new record; the old one is closed, never overwritten.
    const closed = closeTemporalRecord(created.record, "2025-12-31T00:00:00Z");
    expect(isTemporalRecordActiveAt(closed, "2026-01-15T00:00:00Z")).toBe(false);
  });
});
