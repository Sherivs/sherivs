/**
 * CoreGrid Phase 02 — Identity Platform unit tests.
 *
 * Covers:
 * - Identity lifecycle state machine (G5)
 * - Authorization engine (J4–J8)
 * - Relationship engine (F7 + G10)
 * - Credential metadata engine (H9 + J3)
 */
import { describe, expect, it } from "vitest";
// The Scholar runtime registers its relationship types (parent_of, teaches…)
// and roles; importing the adapter is the registration path that makes the
// legacy vocabulary resolvable through the neutral registries.
import "@/lib/domain-config/scholar-authorization";
import { domainRole } from "@/lib/rbac/domain-contribution";
import {
  canTransitionIdentity,
  canTransitionCredential,
  canTransitionAgent,
  domainPermissionResource,
  identityId,
  isIdentityUsable,
  isAgentGoverned,
  permissionKey,
  verificationRank,
} from "@/lib/identity";
import {
  authorize,
  makeAuthorizationRequest,
  permission,
  redact,
  hasRelationship,
  evaluatePolicySet,
  type PolicySet,
} from "@/lib/authorization";
import {
  transitionIdentityLifecycle,
  isIdentityActive,
  isIdentitySuspended,
  isIdentityDeleted,
} from "@/lib/identity-lifecycle";
import {
  createRelationship,
  revokeRelationship,
  isRelationshipActive,
  relationshipsOfType,
  isTenantSafe,
} from "@/lib/identity-relationships";
import {
  createCredential,
  transitionCredentialStatus,
  isCredentialActive,
  validateCredentialAgainstPolicy,
  type CredentialPolicy,
} from "@/lib/identity-credentials";

const NOW = "2026-08-21T12:00:00.000Z";

function makeIdentity(overrides: Partial<Parameters<typeof makeAuthorizationRequest>[0]> = {}) {
  return {
    id: identityId("00000000-0000-0000-0000-000000000001"),
    kind: "human" as const,
    lifecycle: "active" as const,
    tenantId: "tenant-1",
    ...overrides,
  };
}

describe("Identity lifecycle state machine (G5)", () => {
  it("allows valid transitions", () => {
    expect(canTransitionIdentity("proposed", "review")).toBe(true);
    expect(canTransitionIdentity("review", "provisioned")).toBe(true);
    expect(canTransitionIdentity("provisioned", "active")).toBe(true);
    expect(canTransitionIdentity("active", "suspended")).toBe(true);
    expect(canTransitionIdentity("suspended", "active")).toBe(true);
    expect(canTransitionIdentity("active", "deleted")).toBe(true);
    expect(canTransitionIdentity("deleted", "archived")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canTransitionIdentity("active", "proposed")).toBe(false);
    expect(canTransitionIdentity("deleted", "active")).toBe(false);
    expect(canTransitionIdentity("archived", "active")).toBe(false);
    expect(canTransitionIdentity("proposed", "active")).toBe(false);
  });

  it("performs a valid lifecycle transition with attribution", () => {
    const identity = {
      id: identityId("00000000-0000-0000-0000-000000000001"),
      kind: "human" as const,
      lifecycle: "active" as const,
      verification: "institutional" as const,
      canonicalIdentifier: "user-1",
      tenantId: "tenant-1",
      displayName: "Test User",
      verifiedEmail: "test@example.com",
      createdAt: NOW,
      updatedAt: NOW,
    };

    const result = transitionIdentityLifecycle(
      {
        identity,
        from: "active",
        to: "suspended",
        actorId: identityId("00000000-0000-0000-0000-000000000002"),
        reason: "Security review",
        policyRef: "POL-001",
      },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.lifecycle).toBe("suspended");
      expect(result.event.type).toBe("identity.suspended");
      expect(result.event.actorId).toBe(identityId("00000000-0000-0000-0000-000000000002"));
      expect(result.event.metadata.reason).toBe("Security review");
    }
  });

  it("rejects invalid lifecycle transition", () => {
    const identity = {
      id: identityId("00000000-0000-0000-0000-000000000001"),
      kind: "human" as const,
      lifecycle: "active" as const,
      verification: "institutional" as const,
      canonicalIdentifier: "user-1",
      tenantId: "tenant-1",
      displayName: "Test User",
      verifiedEmail: "test@example.com",
      createdAt: NOW,
      updatedAt: NOW,
    };

    const result = transitionIdentityLifecycle(
      {
        identity,
        from: "active",
        to: "proposed",
        actorId: identityId("00000000-0000-0000-0000-000000000002"),
        reason: "Invalid",
        policyRef: null,
      },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid lifecycle transition");
    }
  });

  it("requires a reason for deletion", () => {
    const identity = {
      id: identityId("00000000-0000-0000-0000-000000000001"),
      kind: "human" as const,
      lifecycle: "active" as const,
      verification: "institutional" as const,
      canonicalIdentifier: "user-1",
      tenantId: "tenant-1",
      displayName: "Test User",
      verifiedEmail: "test@example.com",
      createdAt: NOW,
      updatedAt: NOW,
    };

    const result = transitionIdentityLifecycle(
      {
        identity,
        from: "active",
        to: "deleted",
        actorId: identityId("00000000-0000-0000-0000-000000000002"),
        reason: "  ",
        policyRef: null,
      },
      NOW,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Deletion requires a reason");
    }
  });

  it("identity usability helpers", () => {
    expect(isIdentityUsable({ lifecycle: "active" })).toBe(true);
    expect(isIdentityUsable({ lifecycle: "provisioned" })).toBe(true);
    expect(isIdentityUsable({ lifecycle: "suspended" })).toBe(false);
    expect(isIdentityActive({ lifecycle: "active" })).toBe(true);
    expect(isIdentitySuspended({ lifecycle: "suspended" })).toBe(true);
    expect(isIdentityDeleted({ lifecycle: "deleted" })).toBe(true);
    expect(isIdentityDeleted({ lifecycle: "archived" })).toBe(true);
  });
});

describe("Authorization engine (J4–J8)", () => {
  it("ALLOWs a role grant", () => {
    const req = makeAuthorizationRequest(
      makeIdentity(),
      domainPermissionResource("student"),
      "read",
      "class-1",
    );
    const result = authorize(req, { role: domainRole("teacher") });
    expect(result.decision).toBe("ALLOW");
  });

  it("DENYs by default", () => {
    const req = makeAuthorizationRequest(makeIdentity(), "payments", "manage", "school-1");
    const result = authorize(req, { role: domainRole("teacher") });
    expect(result.decision).toBe("DENY");
  });

  it("DENYs suspended identities", () => {
    const req = makeAuthorizationRequest(
      makeIdentity({ lifecycle: "suspended" }),
      domainPermissionResource("student"),
      "read",
      "class-1",
    );
    const result = authorize(req, { role: domainRole("teacher") });
    expect(result.decision).toBe("DENY");
    expect(result.reason).toContain("not usable");
  });

  it("ALLOWs via extra permissions", () => {
    const req = makeAuthorizationRequest(makeIdentity(), "payments", "manage", "school-1");
    const result = authorize(req, {
      role: domainRole("teacher"),
      extraPermissions: [permission("payments", "manage", "school-1")],
    });
    expect(result.decision).toBe("ALLOW");
  });

  it("ALLOWs via ReBAC relationship", () => {
    const rel = {
      id: "rel-1",
      subjectId: identityId("00000000-0000-0000-0000-000000000001"),
      type: "owns" as const,
      targetId: "school-1",
      scope: null,
      createdAt: NOW,
      expiresAt: null,
      revokedAt: null,
      version: 1,
    };
    const req = makeAuthorizationRequest(
      makeIdentity(),
      domainPermissionResource("school"),
      "update",
      "school-1",
      [rel],
    );
    const result = authorize(req, { role: "read_only" });
    expect(result.decision).toBe("ALLOW");
  });

  it("ESCALATEs high-risk requests via ABAC", () => {
    const req = makeAuthorizationRequest(
      makeIdentity(),
      domainPermissionResource("student"),
      "read",
      "class-1",
    );
    const result = authorize(req, {
      role: domainRole("teacher"),
      abac: { risk: 0.9 },
    });
    expect(result.decision).toBe("ESCALATE");
  });

  it("DENYs destructive operations on untrusted devices", () => {
    const req = makeAuthorizationRequest(
      makeIdentity(),
      domainPermissionResource("student"),
      "delete",
      "class-1",
    );
    const result = authorize(req, {
      role: domainRole("teacher"),
      abac: { deviceTrust: 0.1 },
    });
    expect(result.decision).toBe("DENY");
  });

  it("evaluates PBAC policy set", () => {
    const policySet: PolicySet = {
      rules: [
        {
          id: "no-delete-weekends",
          applies: (req) => req.permission.action === "delete",
          decision: "REQUIRE_APPROVAL",
          reason: "Deletion requires approval",
        },
      ],
    };
    const req = makeAuthorizationRequest(
      makeIdentity(),
      domainPermissionResource("student"),
      "delete",
      "class-1",
    );
    const result = authorize(req, { role: domainRole("teacher"), policySet });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
  });

  it("redacts fields per REDACT decision", () => {
    const record = { id: "1", name: "Test", secret: "hidden" };
    const result = redact(record, ["id", "name"]);
    expect(result).toEqual({ id: "1", name: "Test" });
    expect("secret" in result).toBe(false);
  });

  it("hasRelationship checks active relationships", () => {
    const rel = {
      id: "rel-1",
      subjectId: identityId("00000000-0000-0000-0000-000000000001"),
      type: "parent_of" as const,
      targetId: "student-1",
      scope: null,
      createdAt: NOW,
      expiresAt: null,
      revokedAt: null,
      version: 1,
    };
    expect(hasRelationship([rel], "parent_of", "student-1")).toBe(true);
    expect(hasRelationship([rel], "parent_of", "student-2")).toBe(false);
  });

  it("permissionKey builds canonical keys", () => {
    expect(
      permissionKey({ resource: domainPermissionResource("student"), action: "read", scope: null }),
    ).toBe("student:read");
    expect(
      permissionKey({
        resource: domainPermissionResource("student"),
        action: "read",
        scope: "class-1",
      }),
    ).toBe("student:read:class-1");
  });
});

describe("Relationship engine (F7 + G10)", () => {
  it("creates a relationship", () => {
    const result = createRelationship(
      {
        subjectId: identityId("00000000-0000-0000-0000-000000000001"),
        type: "parent_of",
        targetId: "student-1",
        tenantId: "tenant-1",
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relationship.type).toBe("parent_of");
      expect(result.relationship.version).toBe(1);
    }
  });

  it("rejects unknown relationship types", () => {
    const result = createRelationship(
      {
        subjectId: identityId("00000000-0000-0000-0000-000000000001"),
        type: "unknown" as never,
        targetId: "student-1",
        tenantId: "tenant-1",
      },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects past expiry", () => {
    const result = createRelationship(
      {
        subjectId: identityId("00000000-0000-0000-0000-000000000001"),
        type: "parent_of",
        targetId: "student-1",
        tenantId: "tenant-1",
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("revokes a relationship", () => {
    const created = createRelationship(
      {
        subjectId: identityId("00000000-0000-0000-0000-000000000001"),
        type: "parent_of",
        targetId: "student-1",
        tenantId: "tenant-1",
      },
      NOW,
    );
    expect(created.ok).toBe(true);
    if (created.ok) {
      const revoked = revokeRelationship(created.relationship, NOW);
      expect(revoked.revokedAt).toBe(NOW);
      expect(revoked.version).toBe(2);
      expect(isRelationshipActive(revoked, NOW)).toBe(false);
    }
  });

  it("filters by type", () => {
    const rel1 = createRelationship(
      {
        subjectId: identityId("00000000-0000-0000-0000-000000000001"),
        type: "parent_of",
        targetId: "s1",
        tenantId: "t1",
      },
      NOW,
    );
    const rel2 = createRelationship(
      {
        subjectId: identityId("00000000-0000-0000-0000-000000000001"),
        type: "teaches",
        targetId: "c1",
        tenantId: "t1",
      },
      NOW,
    );
    if (rel1.ok && rel2.ok) {
      const result = relationshipsOfType([rel1.relationship, rel2.relationship], "parent_of", NOW);
      expect(result).toHaveLength(1);
      expect(result[0].targetId).toBe("s1");
    }
  });

  it("enforces tenant isolation", () => {
    const rel = {
      id: "rel-1",
      subjectId: identityId("00000000-0000-0000-0000-000000000001"),
      type: "parent_of" as const,
      targetId: "student-1",
      scope: null,
      createdAt: NOW,
      expiresAt: null,
      revokedAt: null,
      version: 1,
    };
    expect(isTenantSafe(rel, "tenant-1", "tenant-1")).toBe(true);
    expect(isTenantSafe(rel, "tenant-1", "tenant-2")).toBe(false);
  });
});

describe("Credential metadata engine (H9 + J3)", () => {
  it("creates a credential with metadata only", () => {
    const result = createCredential(
      {
        identityId: identityId("00000000-0000-0000-0000-000000000001"),
        kind: "api_key",
        expiresAt: "2027-01-01T00:00:00.000Z",
        fingerprint: "sha256:abc123",
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credential.status).toBe("pending");
      expect(result.credential.fingerprint).toBe("sha256:abc123");
      expect("secret" in result.credential).toBe(false);
    }
  });

  it("rejects missing fingerprint", () => {
    const result = createCredential(
      {
        identityId: identityId("00000000-0000-0000-0000-000000000001"),
        kind: "api_key",
        fingerprint: "  ",
      },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("transitions credential status", () => {
    const created = createCredential(
      {
        identityId: identityId("00000000-0000-0000-0000-000000000001"),
        kind: "api_key",
        expiresAt: "2027-01-01T00:00:00.000Z",
        fingerprint: "sha256:abc123",
      },
      NOW,
    );
    expect(created.ok).toBe(true);
    if (created.ok) {
      const active = transitionCredentialStatus(created.credential, "active", NOW);
      expect(active.ok).toBe(true);
      if (active.ok) {
        expect(isCredentialActive(active.credential, NOW)).toBe(true);
      }
      const revoked = transitionCredentialStatus(created.credential, "revoked", NOW);
      expect(revoked.ok).toBe(true);
    }
  });

  it("rejects invalid credential transitions", () => {
    const created = createCredential(
      {
        identityId: identityId("00000000-0000-0000-0000-000000000001"),
        kind: "api_key",
        expiresAt: "2027-01-01T00:00:00.000Z",
        fingerprint: "sha256:abc123",
      },
      NOW,
    );
    expect(created.ok).toBe(true);
    if (created.ok) {
      const result = transitionCredentialStatus(created.credential, "expired", NOW);
      expect(result.ok).toBe(false);
    }
  });

  it("validates credential against policy", () => {
    const policy: CredentialPolicy = {
      maxLifetimeSeconds: 3600,
      rotationPeriodSeconds: 1800,
      allowedKinds: ["api_key", "token"],
    };
    const created = createCredential(
      {
        identityId: identityId("00000000-0000-0000-0000-000000000001"),
        kind: "api_key",
        expiresAt: "2026-08-21T13:00:00.000Z", // 1 hour lifetime
        fingerprint: "sha256:abc123",
      },
      NOW,
    );
    expect(created.ok).toBe(true);
    if (created.ok) {
      const result = validateCredentialAgainstPolicy(created.credential, policy, NOW);
      expect(result.valid).toBe(true);
    }
  });

  it("rejects credentials exceeding policy lifetime", () => {
    const policy: CredentialPolicy = {
      maxLifetimeSeconds: 3600,
      rotationPeriodSeconds: 1800,
      allowedKinds: ["api_key", "token"],
    };
    const created = createCredential(
      {
        identityId: identityId("00000000-0000-0000-0000-000000000001"),
        kind: "api_key",
        expiresAt: "2026-08-22T00:00:00.000Z", // 12 hours lifetime
        fingerprint: "sha256:abc123",
      },
      NOW,
    );
    expect(created.ok).toBe(true);
    if (created.ok) {
      const result = validateCredentialAgainstPolicy(created.credential, policy, NOW);
      expect(result.valid).toBe(false);
    }
  });
});

describe("Agent governance (Invariant 03 + 12)", () => {
  it("isAgentGoverned requires deployed/monitored + permissions", () => {
    expect(
      isAgentGoverned({
        lifecycle: "deployed",
        permissions: [
          { resource: domainPermissionResource("student"), action: "read", scope: null },
        ],
      }),
    ).toBe(true);
    expect(
      isAgentGoverned({
        lifecycle: "proposed",
        permissions: [
          { resource: domainPermissionResource("student"), action: "read", scope: null },
        ],
      }),
    ).toBe(false);
    expect(isAgentGoverned({ lifecycle: "deployed", permissions: [] })).toBe(false);
  });

  it("agent lifecycle transitions are policy-controlled", () => {
    expect(canTransitionAgent("proposed", "review")).toBe(true);
    expect(canTransitionAgent("review", "approved")).toBe(true);
    expect(canTransitionAgent("approved", "deployed")).toBe(true);
    expect(canTransitionAgent("deployed", "monitored")).toBe(true);
    expect(canTransitionAgent("monitored", "suspended")).toBe(true);
    expect(canTransitionAgent("suspended", "reviewed")).toBe(true);
    expect(canTransitionAgent("reviewed", "retired")).toBe(true);
    expect(canTransitionAgent("retired", "deployed")).toBe(false);
    expect(canTransitionAgent("proposed", "deployed")).toBe(false);
  });
});

describe("Verification levels (G6)", () => {
  it("ranks verification levels", () => {
    expect(verificationRank("unverified")).toBe(0);
    expect(verificationRank("self_asserted")).toBe(1);
    expect(verificationRank("institutional")).toBe(2);
    expect(verificationRank("government")).toBe(3);
    expect(verificationRank("biometric")).toBe(4);
  });
});
