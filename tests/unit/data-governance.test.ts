/**
 * CoreGrid Scholar — Phase 14 Data Platform unit tests (data-governance).
 *
 * Validates:
 * - Data lineage: nodes, edges, and tenant-scoped source-to-target tracing
 *   (AK, AL).
 * - Conflict resolution policies (AW).
 * - Query governance (BA).
 * - Masking and pseudonymization (BG, BH).
 * - Retention and archival (BK, BN).
 * - Data residency and transfer governance (BU).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createLineageNode,
  createLineageEdge,
  traceLineage,
  createConflictResolutionPolicy,
  evaluateQueryGovernance,
  maskValue,
  pseudonymize,
  createRetentionPolicy,
  isSubjectToRetention,
  createResidencyRequirement,
  isTransferGoverned,
  type PseudonymizationRegistry,
} from "@/lib/data-governance";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");

describe("Data lineage (AK, AL)", () => {
  it("traces source-to-target lineage within the tenant", () => {
    const nodes = [
      { id: "src-1", tenantId: TENANT_A, type: "source" as const, name: "SIS" },
      { id: "pipe-1", tenantId: TENANT_A, type: "pipeline" as const, name: "ingest" },
      { id: "ds-1", tenantId: TENANT_A, type: "dataset" as const, name: "students" },
      { id: "other-1", tenantId: TENANT_B, type: "dataset" as const, name: "other" },
    ];
    const edges = [
      {
        id: "e1",
        tenantId: TENANT_A,
        fromNodeId: "src-1",
        toNodeId: "pipe-1",
        pipelineVersion: "v1",
      },
      {
        id: "e2",
        tenantId: TENANT_A,
        fromNodeId: "pipe-1",
        toNodeId: "ds-1",
        pipelineVersion: "v1",
      },
      {
        id: "e3",
        tenantId: TENANT_B,
        fromNodeId: "src-1",
        toNodeId: "other-1",
        pipelineVersion: null,
      },
    ];
    const { traced, terminal } = traceLineage("src-1", nodes, edges, TENANT_A);
    expect(traced).toEqual(["src-1", "pipe-1", "ds-1"]);
    expect(terminal).toEqual(["ds-1"]);
  });

  it("rejects self-referencing lineage edges", () => {
    const result = createLineageEdge({
      id: "e1",
      tenantId: TENANT_A,
      fromNodeId: "a",
      toNodeId: "a",
    });
    expect(result.ok).toBe(false);
  });
});

describe("Conflict resolution (AW)", () => {
  it("requires an authoritative source for source-of-truth precedence", () => {
    const result = createConflictResolutionPolicy({
      tenantId: TENANT_A,
      datasetName: "d",
      strategy: "source_of_truth_precedence",
      authoritativeSource: "",
    });
    expect(result.ok).toBe(false);
  });

  it("human review always requires human review", () => {
    const result = createConflictResolutionPolicy({
      tenantId: TENANT_A,
      datasetName: "d",
      strategy: "human_review",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policy.requiresHumanReview).toBe(true);
    }
  });
});

describe("Query governance (BA)", () => {
  const policy = {
    tenantId: TENANT_A,
    maxResultRows: 10_000,
    requireTenantFilter: true,
    maxSensitivityExposure: "CONFIDENTIAL" as const,
  };

  it("blocks a query without a tenant filter", () => {
    expect(
      evaluateQueryGovernance({
        policy,
        estimatedRows: 100,
        hasTenantFilter: false,
        exposure: "INTERNAL",
      }).ok,
    ).toBe(false);
  });

  it("blocks unbounded queries", () => {
    expect(
      evaluateQueryGovernance({
        policy,
        estimatedRows: 1_000_000,
        hasTenantFilter: true,
        exposure: "INTERNAL",
      }).ok,
    ).toBe(false);
  });

  it("blocks exposure above the allowed sensitivity", () => {
    expect(
      evaluateQueryGovernance({
        policy,
        estimatedRows: 100,
        hasTenantFilter: true,
        exposure: "SENSITIVE",
      }).ok,
    ).toBe(false);
  });

  it("allows a governed query", () => {
    expect(
      evaluateQueryGovernance({
        policy,
        estimatedRows: 100,
        hasTenantFilter: true,
        exposure: "CONFIDENTIAL",
      }).ok,
    ).toBe(true);
  });
});

describe("Masking and pseudonymization (BG, BH)", () => {
  it("masks sensitive values keeping only visible edges", () => {
    expect(maskValue("07012345678", 3, 2)).toBe("070******78");
  });

  it("fully masks short values", () => {
    expect(maskValue("ab", 1, 1)).toBe("**");
  });

  it("pseudonymizes identity into a stable analytical identifier", () => {
    const registry: PseudonymizationRegistry = { identifiers: new Map() };
    const p1 = pseudonymize("student-1", registry);
    const p2 = pseudonymize("student-1", registry);
    expect(p1).toBe(p2);
    expect(p1).toMatch(/^pseudo-/);
  });
});

describe("Retention and archival (BK, BN)", () => {
  it("creates a retention policy and honours legal holds", () => {
    const result = createRetentionPolicy({
      datasetName: "d",
      tenantId: TENANT_A,
      retentionDays: 365,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isSubjectToRetention(result.policy, 400, false)).toBe(false); // past retention
      expect(isSubjectToRetention(result.policy, 400, true)).toBe(true); // legal hold active
    }
  });

  it("rejects a non-positive retention period", () => {
    const result = createRetentionPolicy({
      datasetName: "d",
      tenantId: TENANT_A,
      retentionDays: 0,
    });
    expect(result.ok).toBe(false);
  });
});

describe("Data residency (BU)", () => {
  it("governs transfers outside the allowed jurisdictions", () => {
    const result = createResidencyRequirement({
      datasetName: "d",
      tenantId: TENANT_A,
      allowedJurisdictions: ["NG"],
    });
    if (!result.ok) throw new Error("fixture failed");
    expect(isTransferGoverned(result.requirement, "NG")).toBe(false);
    expect(isTransferGoverned(result.requirement, "US")).toBe(true);
  });

  it("governs all transfers when cross-border transfer is prohibited", () => {
    const result = createResidencyRequirement({
      datasetName: "d",
      tenantId: TENANT_A,
      allowedJurisdictions: ["NG"],
      prohibitCrossBorderTransfer: true,
    });
    if (!result.ok) throw new Error("fixture failed");
    expect(isTransferGoverned(result.requirement, "NG")).toBe(true);
  });
});
