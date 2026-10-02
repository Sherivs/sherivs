/**
 * CoreGrid — H2-11 multi-tenant actor tenancy resolution tests (pure, offline).
 *
 * Proves the V1 contract in frontend/src/lib/tenancy/tenant-resolution.ts:
 *   - no active-tenant declaration            -> deny
 *   - declaration without membership proof    -> deny
 *   - valid declaration + proof               -> resolved single tenant
 *   - multi-membership never collapses silently
 *
 * The contract is fail-closed by construction: every denial is a typed,
 * observable outcome; nothing defaults, nothing picks implicitly
 * (AGENTS §13, §15, §16; NEUTRAL_TENANT_PRIMITIVES.md §8 risk 4).
 */
import { describe, expect, it } from "vitest";
import {
  assertResolvedTenant,
  declareActiveTenant,
  distinctTenantIds,
  isMultiTenantActor,
  proofsForTenant,
  resolveActiveTenant,
  type ActorMembershipSet,
  type MembershipProofRef,
  type TenantRef,
} from "@/lib/tenancy/tenant-resolution";

const TENANT_A = "tenant-alpha" as TenantRef;
const TENANT_B = "tenant-beta" as TenantRef;
const TENANT_C = "tenant-gamma" as TenantRef;

const PROOF_A1 = "proof:org-membership:a1" as MembershipProofRef;
const PROOF_B1 = "proof:role-assignment:b1" as MembershipProofRef;

const SINGLE_TENANT_SET: ActorMembershipSet = {
  actorId: "actor-1",
  proofs: [{ proofRef: PROOF_A1, tenantId: TENANT_A, bindingKind: "org_membership" }],
};

const MULTI_TENANT_SET: ActorMembershipSet = {
  actorId: "actor-1",
  proofs: [
    { proofRef: PROOF_A1, tenantId: TENANT_A, bindingKind: "org_membership" },
    { proofRef: PROOF_B1, tenantId: TENANT_B, bindingKind: "role_assignment" },
  ],
};

const UNBOUND_SET: ActorMembershipSet = { actorId: "actor-2", proofs: [] };
const UNAUTHENTICATED_SET: ActorMembershipSet = { actorId: null, proofs: [] };

describe("H2-11 — no active-tenant declaration = deny", () => {
  it("denies a null declaration", () => {
    const resolution = resolveActiveTenant(null, MULTI_TENANT_SET);
    expect(resolution.outcome).toBe("denied");
    if (resolution.outcome === "denied") {
      expect(resolution.reason).toBe("NO_ACTIVE_TENANT_DECLARATION");
    }
  });

  it("denies an undefined declaration (request carried no tenant context)", () => {
    const resolution = resolveActiveTenant(undefined, SINGLE_TENANT_SET);
    expect(resolution.outcome).toBe("denied");
    if (resolution.outcome === "denied") {
      expect(resolution.reason).toBe("NO_ACTIVE_TENANT_DECLARATION");
    }
  });

  it("denies even when the actor holds exactly one tenant — no implicit first-tenant pick", () => {
    const resolution = resolveActiveTenant(null, SINGLE_TENANT_SET);
    expect(resolution.outcome).toBe("denied");
  });

  it("denies an unbound actor that declares nothing", () => {
    const resolution = resolveActiveTenant(null, UNBOUND_SET);
    expect(resolution.outcome).toBe("denied");
    if (resolution.outcome === "denied") {
      expect(resolution.reason).toBe("NO_ACTIVE_TENANT_DECLARATION");
    }
  });
});

describe("H2-11 — declaration without membership proof = deny", () => {
  it("denies a declaration that carries no proof reference at all", () => {
    const malformed = declareActiveTenant(
      TENANT_A,
      undefined as unknown as MembershipProofRef,
    );
    const resolution = resolveActiveTenant(malformed, SINGLE_TENANT_SET);
    expect(resolution.outcome).toBe("denied");
    if (resolution.outcome === "denied") {
      expect(resolution.reason).toBe("NO_MEMBERSHIP_PROOF");
    }
  });

  it("denies a declaration whose proof is not in the actor's membership set", () => {
    const forged = declareActiveTenant(TENANT_A, "proof:forged" as MembershipProofRef);
    const resolution = resolveActiveTenant(forged, SINGLE_TENANT_SET);
    expect(resolution.outcome).toBe("denied");
    if (resolution.outcome === "denied") {
      expect(resolution.reason).toBe("PROOF_UNKNOWN");
    }
  });

  it("denies a declaration for a tenant the actor has no binding in", () => {
    const outsider = declareActiveTenant(TENANT_C, "proof:unbound" as MembershipProofRef);
    const resolution = resolveActiveTenant(outsider, MULTI_TENANT_SET);
    expect(resolution.outcome).toBe("denied");
    if (resolution.outcome === "denied") {
      expect(resolution.reason).toBe("PROOF_UNKNOWN");
    }
  });

  it("denies an unauthenticated actor (empty membership set) even with a well-formed declaration", () => {
    const declaration = declareActiveTenant(TENANT_A, PROOF_A1);
    const resolution = resolveActiveTenant(declaration, UNAUTHENTICATED_SET);
    expect(resolution.outcome).toBe("denied");
    if (resolution.outcome === "denied") {
      expect(resolution.reason).toBe("PROOF_UNKNOWN");
    }
  });

  it("never defaults a denied declaration to any tenant the actor belongs to", () => {
    const forged = declareActiveTenant(TENANT_B, "proof:forged" as MembershipProofRef);
    const resolution = resolveActiveTenant(forged, MULTI_TENANT_SET);
    if (resolution.outcome === "denied") {
      // The denial must not leak or fall back to a proven tenant.
      expect(JSON.stringify(resolution)).not.toContain(TENANT_A);
    } else {
      throw new Error("fail-closed violated: unproven declaration resolved");
    }
  });
});

describe("H2-11 — valid declaration + proof = resolved single tenant", () => {
  it("resolves the declared tenant with the exact referenced proof", () => {
    const declaration = declareActiveTenant(TENANT_A, PROOF_A1);
    const resolution = resolveActiveTenant(declaration, MULTI_TENANT_SET);
    expect(resolution.outcome).toBe("resolved");
    if (resolution.outcome === "resolved") {
      expect(resolution.tenantId).toBe(TENANT_A);
      expect(resolution.proof.proofRef).toBe(PROOF_A1);
      expect(resolution.proof.bindingKind).toBe("org_membership");
    }
  });

  it("resolves the other tenant equally well — no tenant is privileged", () => {
    const declaration = declareActiveTenant(TENANT_B, PROOF_B1);
    const resolution = resolveActiveTenant(declaration, MULTI_TENANT_SET);
    expect(resolution.outcome).toBe("resolved");
    if (resolution.outcome === "resolved") {
      expect(resolution.tenantId).toBe(TENANT_B);
    }
  });

  it("assertResolvedTenant returns the tenant id for a resolved request", () => {
    const declaration = declareActiveTenant(TENANT_A, PROOF_A1);
    expect(assertResolvedTenant(resolveActiveTenant(declaration, MULTI_TENANT_SET))).toBe(TENANT_A);
  });

  it("assertResolvedTenant throws an observable typed denial for a denied request", () => {
    expect(() => assertResolvedTenant(resolveActiveTenant(null, MULTI_TENANT_SET))).toThrow(
      /NO_ACTIVE_TENANT_DECLARATION/,
    );
  });
});

describe("H2-11 — multi-membership never collapses silently", () => {
  it("keeps every distinct tenant visible in the membership set", () => {
    expect(distinctTenantIds(MULTI_TENANT_SET)).toEqual([TENANT_A, TENANT_B]);
    expect(isMultiTenantActor(MULTI_TENANT_SET)).toBe(true);
  });

  it("reports a single-tenant actor as not multi-tenant", () => {
    expect(isMultiTenantActor(SINGLE_TENANT_SET)).toBe(false);
    expect(distinctTenantIds(SINGLE_TENANT_SET)).toEqual([TENANT_A]);
  });

  it("resolving tenant A for a multi-tenant actor never returns tenant B", () => {
    const declaration = declareActiveTenant(TENANT_A, PROOF_A1);
    const resolution = resolveActiveTenant(declaration, MULTI_TENANT_SET);
    if (resolution.outcome === "resolved") {
      expect(resolution.tenantId).toBe(TENANT_A);
      expect(resolution.tenantId).not.toBe(TENANT_B);
    } else {
      throw new Error("valid multi-tenant declaration must resolve, not deny");
    }
  });

  it("rejects a declaration whose tenant does not match its proof (TENANT_MISMATCH)", () => {
    const mismatched = declareActiveTenant(TENANT_B, PROOF_A1);
    const resolution = resolveActiveTenant(mismatched, MULTI_TENANT_SET);
    expect(resolution.outcome).toBe("denied");
    if (resolution.outcome === "denied") {
      expect(resolution.reason).toBe("TENANT_MISMATCH");
    }
  });

  it("denies AMBIGUOUS_MEMBERSHIP_PROOF when multiple bindings match one declaration", () => {
    const duplicateSet: ActorMembershipSet = {
      actorId: "actor-1",
      proofs: [
        { proofRef: PROOF_A1, tenantId: TENANT_A, bindingKind: "org_membership" },
        { proofRef: PROOF_A1, tenantId: TENANT_A, bindingKind: "role_assignment" },
      ],
    };
    const declaration = declareActiveTenant(TENANT_A, PROOF_A1);
    const resolution = resolveActiveTenant(declaration, duplicateSet);
    expect(resolution.outcome).toBe("denied");
    if (resolution.outcome === "denied") {
      expect(resolution.reason).toBe("AMBIGUOUS_MEMBERSHIP_PROOF");
    }
  });

  it("scope-narrows a tenant switcher view without collapsing the set", () => {
    expect(proofsForTenant(MULTI_TENANT_SET, TENANT_A).map((p) => p.proofRef)).toEqual([PROOF_A1]);
    expect(proofsForTenant(MULTI_TENANT_SET, TENANT_B).map((p) => p.proofRef)).toEqual([PROOF_B1]);
    expect(proofsForTenant(MULTI_TENANT_SET, TENANT_C)).toEqual([]);
  });
});
