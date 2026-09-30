/**
 * CoreGrid Scholar — Phase 16 Digital Twin Platform unit tests
 * (twin-graph).
 *
 * Validates:
 * - Relationship model (M, O): explicit relationship types.
 * - Graph consistency (P): self-relationships, duplicates, prohibited
 *   cycles, dangling references, unauthorized cross-tenant relationships.
 * - Graph traversal (O, BJ): outgoing/incoming traversal, dependency
 *   queries.
 * - Spatial model (Q, R, S): hierarchy validation, coordinate-system
 *   metadata preservation.
 * - Cross-tenant governance (CQ).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  addRelationship,
  wouldCreateCycle,
  traverseGraph,
  findDependencies,
  isDanglingReference,
  isSpatialHierarchyValid,
  createSpatialPosition,
  type TwinRelationship,
} from "@/lib/twin-graph";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");
const NOW = "2026-01-01T00:00:00Z";

function rel(overrides: Partial<TwinRelationship> = {}): TwinRelationship {
  return {
    relationshipId: "rel-1",
    sourceTwinId: "twin-campus",
    targetTwinId: "twin-building",
    type: "contains",
    tenantId: TENANT_A,
    sourceTenantId: TENANT_A,
    targetTenantId: TENANT_A,
    createdAt: NOW,
    metadata: {},
    ...overrides,
  };
}

describe("Relationships (M, O)", () => {
  it("adds an explicit relationship between twins", () => {
    const result = addRelationship([], {
      sourceTwinId: "twin-campus",
      targetTwinId: "twin-building",
      type: "contains",
      tenantId: TENANT_A,
      createdAt: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relationship.type).toBe("contains");
      expect(result.relationship.tenantId).toBe(TENANT_A);
    }
  });

  it("rejects a twin relating to itself (P)", () => {
    const result = addRelationship([], {
      sourceTwinId: "twin-a",
      targetTwinId: "twin-a",
      type: "contains",
      tenantId: TENANT_A,
      createdAt: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate relationships (P)", () => {
    const first = addRelationship([], {
      sourceTwinId: "twin-a",
      targetTwinId: "twin-b",
      type: "located_in",
      tenantId: TENANT_A,
      createdAt: NOW,
    });
    if (!first.ok) throw new Error("fixture failed");
    const duplicate = addRelationship([first.relationship], {
      sourceTwinId: "twin-a",
      targetTwinId: "twin-b",
      type: "located_in",
      tenantId: TENANT_A,
      createdAt: NOW,
    });
    expect(duplicate.ok).toBe(false);
  });
});

describe("Cycle prevention (P)", () => {
  it("rejects a contains relationship that would create a cycle", () => {
    // twin-campus contains twin-building contains twin-room; adding
    // twin-room contains twin-campus would cycle.
    const existing = [
      rel({
        relationshipId: "r1",
        sourceTwinId: "twin-campus",
        targetTwinId: "twin-building",
        type: "contains",
      }),
      rel({
        relationshipId: "r2",
        sourceTwinId: "twin-building",
        targetTwinId: "twin-room",
        type: "contains",
      }),
    ];
    expect(
      wouldCreateCycle(
        existing,
        { sourceTwinId: "twin-room", targetTwinId: "twin-campus" },
        "contains",
      ),
    ).toBe(true);
    const result = addRelationship(existing, {
      sourceTwinId: "twin-room",
      targetTwinId: "twin-campus",
      type: "contains",
      tenantId: TENANT_A,
      createdAt: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("allows a non-cyclic contains relationship", () => {
    const existing = [
      rel({
        relationshipId: "r1",
        sourceTwinId: "twin-campus",
        targetTwinId: "twin-building",
        type: "contains",
      }),
    ];
    const result = addRelationship(existing, {
      sourceTwinId: "twin-campus",
      targetTwinId: "twin-room",
      type: "contains",
      tenantId: TENANT_A,
      createdAt: NOW,
    });
    expect(result.ok).toBe(true);
  });
});

describe("Graph traversal and queries (O, BJ)", () => {
  function chain(): TwinRelationship[] {
    return [
      rel({
        relationshipId: "r1",
        sourceTwinId: "campus",
        targetTwinId: "building",
        type: "contains",
      }),
      rel({
        relationshipId: "r2",
        sourceTwinId: "building",
        targetTwinId: "room",
        type: "contains",
      }),
      rel({ relationshipId: "r3", sourceTwinId: "room", targetTwinId: "device", type: "contains" }),
    ];
  }

  it("traverses the containment graph", () => {
    const reached = traverseGraph(chain(), "campus", ["contains"]);
    expect(reached).toEqual(["building", "room", "device"]);
  });

  it("traverses in reverse using incoming direction", () => {
    const reached = traverseGraph(chain(), "device", ["contains"], "incoming");
    expect(reached).toEqual(["room", "building", "campus"]);
  });

  it("finds dependency relationships of a twin", () => {
    const deps = [
      rel({
        relationshipId: "d1",
        sourceTwinId: "twin-a",
        targetTwinId: "twin-b",
        type: "depends_on",
      }),
    ];
    const found = findDependencies(deps, "twin-a");
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe("depends_on");
  });

  it("detects dangling references against the known twin set", () => {
    const r = rel({ sourceTwinId: "twin-a", targetTwinId: "twin-missing" });
    expect(isDanglingReference(r, new Set(["twin-a", "twin-b"]))).toBe(true);
    expect(isDanglingReference(r, new Set(["twin-a", "twin-b", "twin-missing"]))).toBe(false);
  });
});

describe("Cross-tenant relationships (CQ)", () => {
  it("rejects a cross-tenant relationship without explicit governance", () => {
    const result = addRelationship([], {
      sourceTwinId: "twin-a",
      targetTwinId: "twin-x",
      type: "connected_to",
      tenantId: TENANT_A,
      createdAt: NOW,
      metadata: { targetTenant: String(TENANT_B) },
      crossTenantAuthorized: false,
    });
    expect(result.ok).toBe(false);
  });

  it("allows a cross-tenant relationship with explicit governance", () => {
    const result = addRelationship([], {
      sourceTwinId: "twin-a",
      targetTwinId: "twin-x",
      type: "connected_to",
      tenantId: TENANT_A,
      createdAt: NOW,
      metadata: { targetTenant: String(TENANT_B) },
      crossTenantAuthorized: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relationship.targetTenantId).toBe(TENANT_B);
    }
  });
});

describe("Spatial model (Q, R, S)", () => {
  it("accepts a full spatial hierarchy", () => {
    const location = {
      country: "NG",
      region: "Lagos",
      city: "Lagos",
      campus: "Main",
      building: "A",
      floor: "1",
      room: "101",
      zone: "East",
      asset: null,
      position: null,
    };
    expect(isSpatialHierarchyValid(location)).toBe(true);
  });

  it("rejects a room without its building ancestors", () => {
    const location = {
      country: "NG",
      region: null,
      city: null,
      campus: null,
      building: null,
      floor: null,
      room: "101",
      zone: null,
      asset: null,
      position: null,
    };
    expect(isSpatialHierarchyValid(location)).toBe(false);
  });

  it("preserves coordinate-system metadata (R)", () => {
    const position = createSpatialPosition("lat_long", [6.5244, 3.3792], { datum: "WGS84" });
    expect(position.coordinateSystem).toBe("lat_long");
    expect(position.metadata.datum).toBe("WGS84");
  });
});
