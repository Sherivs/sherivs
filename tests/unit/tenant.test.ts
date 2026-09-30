/**
 * CoreGrid Phase 03 — Multi-Tenancy Platform unit tests.
 *
 * Covers:
 * - Tenant core domain model (H1, H2, F2, F5, F8)
 * - Tenant lifecycle engine (G3, K1, K3)
 * - Tenant isolation engine (G4, G6, J3–J8)
 * - Tenant quota & entitlement engine (H4, H5, O, P)
 * - Tenant topology engine (H8, R)
 */
import { describe, expect, it } from "vitest";
import {
  canTransitionTenant,
  tenantId,
  isTenantUsable,
  hasTenantBoundary,
  classificationRank,
  hierarchyGrantsAccess,
  type CoreGridTenant,
  type TenantContext,
  type TenantResource,
  type TenantTopologyEdge,
} from "@/lib/tenant-core";
import {
  transitionTenantLifecycle,
  isTenantActive,
  isTenantSuspended,
  isTenantTerminated,
  isTenantMigrating,
  advanceProvisioning,
  isProvisioningComplete,
  advanceMigration,
  isMigrationComplete,
  isMigrationReversible,
  type ProvisioningState,
  type MigrationState,
} from "@/lib/tenant-lifecycle";
import {
  resolveTenantContext,
  assertResourceInTenant,
  assertTenantUsable,
  authorizeCrossTenantAccess,
  tenantCacheKey,
  isEventTenantScoped,
  assertJobTenantContext,
  validateTenantHeader,
  isTenantEnumerationAttempt,
  type TenantAwareJob,
} from "@/lib/tenant-isolation";
import {
  evaluateEntitlement,
  isEntitlementActive,
  expireEntitlement,
  revokeEntitlement,
  checkQuota,
  consumeQuota,
  resetQuota,
  isBurstAvailable,
  consumeBurst,
  assertQuotaFairness,
  validateQuota,
  type BurstAllowance,
} from "@/lib/tenant-quota";
import {
  createTopologyEdge,
  getChildren,
  getParents,
  getPeers,
  canAccessTenant,
  hasCycle,
  validateTopology,
} from "@/lib/tenant-topology";

const NOW = "2026-08-21T12:00:00.000Z";

function makeTenant(overrides: Partial<CoreGridTenant> = {}): CoreGridTenant {
  return {
    id: tenantId("tenant-1"),
    type: "school",
    name: "Test School",
    status: "ACTIVE",
    parentTenantId: null,
    region: "africa-west",
    environment: "production",
    ownerIdentityId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeContext(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: tenantId("tenant-1"),
    actorId: "user-1",
    requestId: "req-1",
    region: "africa-west",
    environment: "production",
    source: "verified",
    ...overrides,
  };
}

describe("Tenant core domain model (H1, H2, F2, F5, F8)", () => {
  it("allows valid lifecycle transitions", () => {
    expect(canTransitionTenant("PROVISIONING", "ACTIVE")).toBe(true);
    expect(canTransitionTenant("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionTenant("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransitionTenant("ACTIVE", "MIGRATING")).toBe(true);
    expect(canTransitionTenant("ACTIVE", "ARCHIVED")).toBe(true);
    expect(canTransitionTenant("ARCHIVED", "TERMINATING")).toBe(true);
    expect(canTransitionTenant("TERMINATING", "TERMINATED")).toBe(true);
  });

  it("rejects invalid lifecycle transitions", () => {
    expect(canTransitionTenant("TERMINATED", "ACTIVE")).toBe(false);
    expect(canTransitionTenant("ACTIVE", "PROVISIONING")).toBe(false);
    expect(canTransitionTenant("PROVISIONING", "TERMINATED")).toBe(false);
  });

  it("tenant usability helpers", () => {
    expect(isTenantUsable({ status: "ACTIVE" })).toBe(true);
    expect(isTenantUsable({ status: "RESTRICTED" })).toBe(true);
    expect(isTenantUsable({ status: "SUSPENDED" })).toBe(false);
    expect(isTenantUsable({ status: "TERMINATED" })).toBe(false);
  });

  it("every tenant-owned resource has a determinable tenant boundary", () => {
    expect(hasTenantBoundary({ tenantId: tenantId("tenant-1") })).toBe(true);
    expect(hasTenantBoundary({ tenantId: tenantId("") })).toBe(false);
  });

  it("ranks data classifications", () => {
    expect(classificationRank("PUBLIC")).toBe(0);
    expect(classificationRank("TENANT_INTERNAL")).toBe(1);
    expect(classificationRank("CONFIDENTIAL")).toBe(2);
    expect(classificationRank("SENSITIVE")).toBe(3);
    expect(classificationRank("RESTRICTED")).toBe(4);
  });

  it("hierarchy does not grant unrestricted access", () => {
    const edge: TenantTopologyEdge = {
      fromTenantId: tenantId("parent"),
      toTenantId: tenantId("child"),
      relation: "parent",
      authorized: false,
      createdAt: NOW,
    };
    expect(hierarchyGrantsAccess(edge)).toBe(false);
  });
});

describe("Tenant lifecycle engine (G3, K1, K3)", () => {
  it("performs a valid lifecycle transition with attribution", () => {
    const result = transitionTenantLifecycle(
      {
        tenant: makeTenant(),
        from: "ACTIVE",
        to: "SUSPENDED",
        actorId: "admin-1",
        reason: "Security review",
        policyRef: "POL-001",
      },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tenant.status).toBe("SUSPENDED");
      expect(result.event.type).toBe("TenantSuspended");
      expect(result.event.actorId).toBe("admin-1");
      expect(result.event.metadata.reason).toBe("Security review");
    }
  });

  it("rejects invalid lifecycle transition", () => {
    const result = transitionTenantLifecycle(
      {
        tenant: makeTenant(),
        from: "ACTIVE",
        to: "PROVISIONING",
        actorId: "admin-1",
        reason: "Invalid",
        policyRef: null,
      },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid tenant lifecycle transition");
    }
  });

  it("requires a reason for termination", () => {
    const result = transitionTenantLifecycle(
      {
        tenant: makeTenant(),
        from: "ACTIVE",
        to: "TERMINATING",
        actorId: "admin-1",
        reason: "  ",
        policyRef: null,
      },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Tenant termination requires a reason");
    }
  });

  it("lifecycle helpers", () => {
    expect(isTenantActive({ status: "ACTIVE" })).toBe(true);
    expect(isTenantSuspended({ status: "SUSPENDED" })).toBe(true);
    expect(isTenantTerminated({ status: "TERMINATED" })).toBe(true);
    expect(isTenantMigrating({ status: "MIGRATING" })).toBe(true);
  });

  it("provisioning pipeline advances through stages", () => {
    const state: ProvisioningState = {
      tenantId: tenantId("tenant-1"),
      stage: "request",
      completedStages: [],
      startedAt: NOW,
      updatedAt: NOW,
    };

    const advanced = advanceProvisioning(state, NOW);
    expect(advanced.stage).toBe("validation");
    expect(advanced.completedStages).toContain("request");
    expect(isProvisioningComplete(advanced)).toBe(false);
  });

  it("provisioning completes at activation", () => {
    const state: ProvisioningState = {
      tenantId: tenantId("tenant-1"),
      stage: "activation",
      completedStages: [
        "request",
        "validation",
        "approval",
        "registration",
        "infrastructure",
        "configuration",
        "security_initialization",
        "validation_final",
      ],
      startedAt: NOW,
      updatedAt: NOW,
    };
    expect(isProvisioningComplete(state)).toBe(true);
  });

  it("migration is reversible until commit point", () => {
    const state: MigrationState = {
      migrationId: "mig-1",
      tenantId: tenantId("tenant-1"),
      source: "region-a",
      destination: "region-b",
      stage: "COPYING",
      rollbackCriteria: ["data integrity verified"],
      startedAt: NOW,
      updatedAt: NOW,
    };

    expect(isMigrationReversible(state)).toBe(true);
    expect(isMigrationComplete(state)).toBe(false);

    const completed = advanceMigration(state, NOW);
    expect(completed.stage).toBe("VERIFYING");
  });

  it("migration is not reversible after completion", () => {
    const state: MigrationState = {
      migrationId: "mig-1",
      tenantId: tenantId("tenant-1"),
      source: "region-a",
      destination: "region-b",
      stage: "COMPLETED",
      rollbackCriteria: [],
      startedAt: NOW,
      updatedAt: NOW,
    };
    expect(isMigrationReversible(state)).toBe(false);
    expect(isMigrationComplete(state)).toBe(true);
  });
});

describe("Tenant isolation engine (G4, G6, J3–J8)", () => {
  it("resolves tenant context from verified tenant IDs", () => {
    const result = resolveTenantContext(
      "tenant-1",
      "user-1",
      [tenantId("tenant-1"), tenantId("tenant-2")],
      "req-1",
      "africa-west",
      "production",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.tenantId).toBe(tenantId("tenant-1"));
      expect(result.context.source).toBe("verified");
    }
  });

  it("rejects unverified tenant context (Invariant 02)", () => {
    const result = resolveTenantContext("tenant-3", "user-1", [tenantId("tenant-1")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not authorized");
    }
  });

  it("resolves platform scope when no tenant supplied", () => {
    const result = resolveTenantContext(null, "user-1", []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.tenantId).toBeNull();
      expect(result.context.source).toBe("platform");
    }
  });

  it("asserts resource is within tenant boundary", () => {
    const resource: TenantResource = {
      resourceId: "res-1",
      tenantId: tenantId("tenant-1"),
      resourceType: "student",
      createdAt: NOW,
      updatedAt: NOW,
    };
    const result = assertResourceInTenant(resource, makeContext());
    expect(result.ok).toBe(true);
  });

  it("rejects cross-tenant resource access", () => {
    const resource: TenantResource = {
      resourceId: "res-1",
      tenantId: tenantId("tenant-2"),
      resourceType: "student",
      createdAt: NOW,
      updatedAt: NOW,
    };
    const result = assertResourceInTenant(resource, makeContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not");
    }
  });

  it("asserts tenant is usable", () => {
    expect(assertTenantUsable({ status: "ACTIVE" }).ok).toBe(true);
    expect(assertTenantUsable({ status: "SUSPENDED" }).ok).toBe(false);
  });

  it("authorizes explicit cross-tenant access", () => {
    const result = authorizeCrossTenantAccess(
      {
        actorId: "user-1",
        sourceTenantId: tenantId("tenant-1"),
        targetTenantId: tenantId("tenant-2"),
        purpose: "Shared student records",
        authorizationRef: "CONTRACT-001",
        expiresAt: null,
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scope.kind).toBe("cross_tenant_scope");
    }
  });

  it("rejects cross-tenant access without authorization reference", () => {
    const result = authorizeCrossTenantAccess(
      {
        actorId: "user-1",
        sourceTenantId: tenantId("tenant-1"),
        targetTenantId: tenantId("tenant-2"),
        purpose: "Shared records",
        authorizationRef: "  ",
        expiresAt: null,
      },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects expired cross-tenant access", () => {
    const result = authorizeCrossTenantAccess(
      {
        actorId: "user-1",
        sourceTenantId: tenantId("tenant-1"),
        targetTenantId: tenantId("tenant-2"),
        purpose: "Shared records",
        authorizationRef: "CONTRACT-001",
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("builds tenant-scoped cache keys", () => {
    expect(tenantCacheKey(tenantId("tenant-1"), "students")).toBe("tenant:tenant-1:students");
    expect(tenantCacheKey(null, "config")).toBe("platform:config");
  });

  it("verifies event tenant scoping", () => {
    const context = makeContext();
    expect(isEventTenantScoped(tenantId("tenant-1"), context)).toBe(true);
    expect(isEventTenantScoped(tenantId("tenant-2"), context)).toBe(false);
    expect(isEventTenantScoped(null, context)).toBe(true);
  });

  it("asserts job retains tenant context", () => {
    const job: TenantAwareJob = {
      jobId: "job-1",
      tenantId: tenantId("tenant-1"),
      actorId: "user-1",
      operation: "process_attendance",
      payload: {},
      createdAt: NOW,
    };
    expect(assertJobTenantContext(job, tenantId("tenant-1")).ok).toBe(true);
    expect(assertJobTenantContext(job, tenantId("tenant-2")).ok).toBe(false);
  });

  it("validates tenant headers against authorized set", () => {
    expect(validateTenantHeader("tenant-1", [tenantId("tenant-1")]).valid).toBe(true);
    expect(validateTenantHeader("tenant-2", [tenantId("tenant-1")]).valid).toBe(false);
    expect(validateTenantHeader(null, []).valid).toBe(true);
  });

  it("detects tenant enumeration attempts", () => {
    expect(isTenantEnumerationAttempt("tenant-1", [tenantId("tenant-1")])).toBe(false);
    expect(isTenantEnumerationAttempt("tenant-2", [tenantId("tenant-1")])).toBe(true);
  });
});

describe("Tenant quota & entitlement engine (H4, H5, O, P)", () => {
  it("grants entitlement with policy and contract", () => {
    const result = evaluateEntitlement(
      {
        tenantId: tenantId("tenant-1"),
        capability: "AI",
        policyRef: "POL-AI-001",
        contractRef: "CONTRACT-001",
      },
      NOW,
    );
    expect(result.decision).toBe("GRANTED");
    if (result.decision === "GRANTED") {
      expect(result.entitlement.status).toBe("enabled");
      expect(isEntitlementActive(result.entitlement, NOW)).toBe(true);
    }
  });

  it("denies entitlement without policy reference", () => {
    const result = evaluateEntitlement(
      {
        tenantId: tenantId("tenant-1"),
        capability: "AI",
        policyRef: "  ",
        contractRef: "CONTRACT-001",
      },
      NOW,
    );
    expect(result.decision).toBe("DENIED");
  });

  it("expires entitlement", () => {
    const granted = evaluateEntitlement(
      {
        tenantId: tenantId("tenant-1"),
        capability: "Analytics",
        policyRef: "POL-AN-001",
        contractRef: "CONTRACT-001",
      },
      NOW,
    );
    expect(granted.decision).toBe("GRANTED");
    if (granted.decision === "GRANTED") {
      const expired = expireEntitlement(granted.entitlement, NOW);
      expect(expired.status).toBe("expired");
      expect(isEntitlementActive(expired, NOW)).toBe(false);
    }
  });

  it("revokes entitlement with audit event", () => {
    const granted = evaluateEntitlement(
      {
        tenantId: tenantId("tenant-1"),
        capability: "Automation",
        policyRef: "POL-AU-001",
        contractRef: "CONTRACT-001",
      },
      NOW,
    );
    expect(granted.decision).toBe("GRANTED");
    if (granted.decision === "GRANTED") {
      const { entitlement, auditEvent } = revokeEntitlement(
        granted.entitlement,
        "admin-1",
        "Contract expired",
        NOW,
      );
      expect(entitlement.status).toBe("disabled");
      expect(auditEvent.type).toBe("EntitlementRevoked");
      expect(auditEvent.actorId).toBe("admin-1");
    }
  });

  it("checks quota within limits", () => {
    const quota = {
      tenantId: tenantId("tenant-1"),
      resource: "api_requests" as const,
      limit: 1000,
      currentUsage: 100,
      period: "daily" as const,
      softThreshold: 0.8,
    };
    const result = checkQuota(quota, 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("within_limit");
    }
  });

  it("warns at soft quota limit", () => {
    const quota = {
      tenantId: tenantId("tenant-1"),
      resource: "api_requests" as const,
      limit: 1000,
      currentUsage: 790,
      period: "daily" as const,
      softThreshold: 0.8,
    };
    const result = checkQuota(quota, 20);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("soft_limit_reached");
    }
  });

  it("blocks at hard quota limit", () => {
    const quota = {
      tenantId: tenantId("tenant-1"),
      resource: "api_requests" as const,
      limit: 1000,
      currentUsage: 995,
      period: "daily" as const,
      softThreshold: 0.8,
    };
    const result = checkQuota(quota, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("hard_limit_reached");
    }
  });

  it("consumes quota", () => {
    const quota = {
      tenantId: tenantId("tenant-1"),
      resource: "storage" as const,
      limit: 100,
      currentUsage: 50,
      period: "monthly" as const,
      softThreshold: 0.8,
    };
    const result = consumeQuota(quota, 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quota.currentUsage).toBe(60);
    }
  });

  it("rejects quota consumption beyond limit", () => {
    const quota = {
      tenantId: tenantId("tenant-1"),
      resource: "storage" as const,
      limit: 100,
      currentUsage: 95,
      period: "monthly" as const,
      softThreshold: 0.8,
    };
    const result = consumeQuota(quota, 10);
    expect(result.ok).toBe(false);
  });

  it("resets quota", () => {
    const quota = {
      tenantId: tenantId("tenant-1"),
      resource: "api_requests" as const,
      limit: 1000,
      currentUsage: 900,
      period: "daily" as const,
      softThreshold: 0.8,
    };
    expect(resetQuota(quota).currentUsage).toBe(0);
  });

  it("checks burst availability", () => {
    const burst: BurstAllowance = {
      tenantId: tenantId("tenant-1"),
      resource: "compute",
      burstLimit: 100,
      burstUsed: 50,
      expiresAt: "2027-01-01T00:00:00.000Z",
    };
    expect(isBurstAvailable(burst, NOW)).toBe(true);
    expect(consumeBurst(burst, 10).ok).toBe(true);
  });

  it("rejects burst consumption beyond limit", () => {
    const burst: BurstAllowance = {
      tenantId: tenantId("tenant-1"),
      resource: "compute",
      burstLimit: 100,
      burstUsed: 95,
      expiresAt: "2027-01-01T00:00:00.000Z",
    };
    expect(consumeBurst(burst, 10).ok).toBe(false);
  });

  it("rejects expired burst", () => {
    const burst: BurstAllowance = {
      tenantId: tenantId("tenant-1"),
      resource: "compute",
      burstLimit: 100,
      burstUsed: 0,
      expiresAt: "2020-01-01T00:00:00.000Z",
    };
    expect(isBurstAvailable(burst, NOW)).toBe(false);
  });

  it("asserts quota fairness", () => {
    const quotas = [
      {
        tenantId: tenantId("tenant-1"),
        resource: "compute" as const,
        limit: 100,
        currentUsage: 90,
        period: "monthly" as const,
        softThreshold: 0.8,
      },
      {
        tenantId: tenantId("tenant-1"),
        resource: "storage" as const,
        limit: 100,
        currentUsage: 10,
        period: "monthly" as const,
        softThreshold: 0.8,
      },
    ];
    const result = assertQuotaFairness(quotas, 0.5);
    expect(result.fair).toBe(false);
    expect(result.violatingResources).toContain("compute");
  });

  it("validates quota", () => {
    const valid = {
      tenantId: tenantId("tenant-1"),
      resource: "compute" as const,
      limit: 100,
      currentUsage: 10,
      period: "monthly" as const,
      softThreshold: 0.8,
    };
    expect(validateQuota(valid).valid).toBe(true);

    const invalid = {
      tenantId: tenantId("tenant-1"),
      resource: "compute" as const,
      limit: -1,
      currentUsage: 10,
      period: "monthly" as const,
      softThreshold: 1.5,
    };
    expect(validateQuota(invalid).valid).toBe(false);
  });
});

describe("Tenant topology engine (H8, R)", () => {
  it("creates a topology edge", () => {
    const result = createTopologyEdge(
      {
        fromTenantId: tenantId("parent"),
        toTenantId: tenantId("child"),
        relation: "parent",
        authorized: true,
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.edge.relation).toBe("parent");
      expect(result.edge.authorized).toBe(true);
    }
  });

  it("rejects self-loops", () => {
    const result = createTopologyEdge(
      {
        fromTenantId: tenantId("tenant-1"),
        toTenantId: tenantId("tenant-1"),
        relation: "peer",
        authorized: true,
      },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("requires authorization for parent/child edges", () => {
    const result = createTopologyEdge(
      {
        fromTenantId: tenantId("parent"),
        toTenantId: tenantId("child"),
        relation: "parent",
        authorized: false,
      },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("queries children, parents, and peers", () => {
    const parent = tenantId("parent");
    const child1 = tenantId("child-1");
    const child2 = tenantId("child-2");
    const peer = tenantId("peer");

    const edges: TenantTopologyEdge[] = [
      {
        fromTenantId: parent,
        toTenantId: child1,
        relation: "child",
        authorized: true,
        createdAt: NOW,
      },
      {
        fromTenantId: parent,
        toTenantId: child2,
        relation: "child",
        authorized: true,
        createdAt: NOW,
      },
      {
        fromTenantId: parent,
        toTenantId: peer,
        relation: "peer",
        authorized: true,
        createdAt: NOW,
      },
    ];

    expect(getChildren(edges, parent)).toEqual([child1, child2]);
    expect(getParents(edges, child1)).toEqual([parent]);
    expect(getPeers(edges, parent)).toEqual([peer]);
  });

  it("enforces explicit authorization for cross-tenant access", () => {
    const parent = tenantId("parent");
    const child = tenantId("child");

    const authorized: TenantTopologyEdge[] = [
      {
        fromTenantId: parent,
        toTenantId: child,
        relation: "child",
        authorized: true,
        createdAt: NOW,
      },
    ];
    const unauthorized: TenantTopologyEdge[] = [
      {
        fromTenantId: parent,
        toTenantId: child,
        relation: "child",
        authorized: false,
        createdAt: NOW,
      },
    ];

    expect(canAccessTenant(authorized, parent, child)).toBe(true);
    expect(canAccessTenant(unauthorized, parent, child)).toBe(false);
    expect(canAccessTenant([], parent, parent)).toBe(true);
  });

  it("detects cycles in topology", () => {
    const a = tenantId("a");
    const b = tenantId("b");
    const c = tenantId("c");

    const cyclic: TenantTopologyEdge[] = [
      { fromTenantId: a, toTenantId: b, relation: "child", authorized: true, createdAt: NOW },
      { fromTenantId: b, toTenantId: c, relation: "child", authorized: true, createdAt: NOW },
      { fromTenantId: c, toTenantId: a, relation: "child", authorized: true, createdAt: NOW },
    ];

    expect(hasCycle(cyclic, a)).toBe(true);
  });

  it("validates topology", () => {
    const a = tenantId("a");
    const b = tenantId("b");

    const valid: TenantTopologyEdge[] = [
      { fromTenantId: a, toTenantId: b, relation: "child", authorized: true, createdAt: NOW },
    ];
    expect(validateTopology(valid, [a, b]).valid).toBe(true);

    const invalid: TenantTopologyEdge[] = [
      {
        fromTenantId: a,
        toTenantId: tenantId("unknown"),
        relation: "child",
        authorized: true,
        createdAt: NOW,
      },
    ];
    expect(validateTopology(invalid, [a, b]).valid).toBe(false);
  });
});
