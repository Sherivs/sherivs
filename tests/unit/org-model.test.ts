/**
 * CoreGrid — universal organization model tests (MISSION-V1-006).
 * Fail-closed behavior, tree integrity, membership rules, scope derivation,
 * and the mandatory tenant-isolation case (Constitution §31).
 */
import { describe, expect, it } from "vitest";
import {
  addMembership,
  createOrgUnit,
  declareTenantRole,
  deactivateMembership,
  emptyOrgModelState,
  orgMembershipRef,
  orgUnitRef,
  principalRef,
  reparentOrgUnit,
  resolveOrgScope,
  roleRef,
  type OrgModelState,
} from "../../frontend/src/lib/org-model";
import { tenantId } from "../../frontend/src/lib/tenant-core";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");

function baseState(): OrgModelState {
  return emptyOrgModelState(
    new Map([
      [TENANT_A, [roleRef("org_admin"), roleRef("member")]],
      [TENANT_B, [roleRef("org_admin")]],
    ]),
  );
}

function rootA(state: OrgModelState): OrgModelState {
  const result = createOrgUnit(state, {
    id: orgUnitRef("org-a"),
    tenantRef: TENANT_A,
    kind: "organization",
    parentRef: null,
    profile: { name: "Tenant A Organization" },
  });
  if (result.outcome !== "ok") throw new Error(result.reason);
  return result.value;
}

function childOf(
  state: OrgModelState,
  id: string,
  parentRef: string,
  tenantRef = TENANT_A,
): OrgModelState {
  const result = createOrgUnit(state, {
    id: orgUnitRef(id),
    tenantRef,
    kind: "department",
    parentRef: orgUnitRef(parentRef),
    profile: { name: `Unit ${id}` },
  });
  if (result.outcome !== "ok") throw new Error(result.reason);
  return result.value;
}

describe("createOrgUnit (tree rules, fail-closed)", () => {
  it("creates a single root and a child beneath it", () => {
    const state = childOf(rootA(baseState()), "dept-ops", "org-a");
    expect(state.units.size).toBe(2);
    expect(state.units.get(orgUnitRef("dept-ops"))?.parentRef).toBe(orgUnitRef("org-a"));
  });

  it("rejects a second root for the same tenant (single root per tenant)", () => {
    const state = rootA(baseState());
    const result = createOrgUnit(state, {
      id: orgUnitRef("org-a-2"),
      tenantRef: TENANT_A,
      kind: "organization",
      parentRef: null,
      profile: { name: "Second root" },
    });
    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") expect(result.code).toBe("root_already_exists");
  });

  it("allows roots for different tenants (per-tenant root rule)", () => {
    const state = rootA(baseState());
    const result = createOrgUnit(state, {
      id: orgUnitRef("org-b"),
      tenantRef: TENANT_B,
      kind: "organization",
      parentRef: null,
      profile: { name: "Tenant B Organization" },
    });
    expect(result.outcome).toBe("ok");
  });

  it("rejects a non-organization root", () => {
    const result = createOrgUnit(baseState(), {
      id: orgUnitRef("team-root"),
      tenantRef: TENANT_A,
      kind: "team",
      parentRef: null,
      profile: { name: "Team root" },
    });
    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") expect(result.code).toBe("root_kind_required");
  });

  it("rejects an unknown parent", () => {
    const result = createOrgUnit(baseState(), {
      id: orgUnitRef("dept-orphan"),
      tenantRef: TENANT_A,
      kind: "department",
      parentRef: orgUnitRef("does-not-exist"),
      profile: { name: "Orphan" },
    });
    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") expect(result.code).toBe("unknown_parent");
  });

  it("rejects a cross-tenant parent", () => {
    const state = rootA(baseState());
    const result = createOrgUnit(state, {
      id: orgUnitRef("dept-smuggled"),
      tenantRef: TENANT_B,
      kind: "department",
      parentRef: orgUnitRef("org-a"),
      profile: { name: "Cross-tenant child" },
    });
    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") expect(result.code).toBe("cross_tenant_parent");
  });

  it("rejects a self-parent cycle", () => {
    const result = createOrgUnit(baseState(), {
      id: orgUnitRef("self-parent"),
      tenantRef: TENANT_A,
      kind: "organization",
      parentRef: orgUnitRef("self-parent"),
      profile: { name: "Self parent" },
    });
    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") expect(result.code).toBe("self_parent_cycle");
  });

  it("rejects reparenting that would create a cycle in the tree", () => {
    const state = childOf(childOf(rootA(baseState()), "dept-a", "org-a"), "dept-b", "dept-a");
    const result = reparentOrgUnit(state, {
      id: orgUnitRef("dept-a"),
      newParentRef: orgUnitRef("dept-b"),
    });
    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") expect(result.code).toBe("cycle");
  });

  it("rejects malformed inputs (empty refs, unknown kind, bad profile vocabulary)", () => {
    // Deliberately invalid shapes — the cast only satisfies the compiler; the
    // runtime validator must still fail closed on every element.
    const bad: unknown[] = [
      {
        id: orgUnitRef(""),
        tenantRef: TENANT_A,
        kind: "organization" as const,
        parentRef: null,
        profile: { name: "x" },
      },
      {
        id: orgUnitRef("bad kind"),
        tenantRef: TENANT_A,
        kind: "university" as const,
        parentRef: null,
        profile: { name: "x" },
      },
      {
        id: orgUnitRef("bad-profile"),
        tenantRef: TENANT_A,
        kind: "organization" as const,
        parentRef: null,
        // Deliberately invalid key — must fail closed, not be stored.
        profile: { no_such_key: "x" },
      },
      {
        id: orgUnitRef("no-name"),
        tenantRef: TENANT_A,
        kind: "organization" as const,
        parentRef: null,
        profile: {},
      },
    ];
    for (const input of bad) {
      const result = createOrgUnit(
        baseState(),
        input as Parameters<typeof createOrgUnit>[1],
      );
      expect(result.outcome).toBe("deny");
      if (result.outcome === "deny") expect(result.code).toBe("malformed_input");
    }
  });
});

describe("addMembership (declared roles, duplicate rejection)", () => {
  it("adds an active membership under a declared role", () => {
    const state = rootA(baseState());
    const result = addMembership(state, {
      id: orgMembershipRef("m1"),
      orgUnitRef: orgUnitRef("org-a"),
      principalRef: principalRef("principal-1"),
      roleRef: roleRef("org_admin"),
    });
    expect(result.outcome).toBe("ok");
  });

  it("rejects a duplicate active membership in the same unit", () => {
    const state = rootA(baseState());
    const first = addMembership(state, {
      id: orgMembershipRef("m1"),
      orgUnitRef: orgUnitRef("org-a"),
      principalRef: principalRef("principal-1"),
      roleRef: roleRef("org_admin"),
    });
    if (first.outcome !== "ok") throw new Error(first.reason);
    const second = addMembership(first.value, {
      id: orgMembershipRef("m2"),
      orgUnitRef: orgUnitRef("org-a"),
      principalRef: principalRef("principal-1"),
      roleRef: roleRef("member"),
    });
    expect(second.outcome).toBe("deny");
    if (second.outcome === "deny") expect(second.code).toBe("duplicate_membership");
  });

  it("rejects a role that is not declared for the tenant", () => {
    const state = rootA(baseState());
    const result = addMembership(state, {
      id: orgMembershipRef("m1"),
      orgUnitRef: orgUnitRef("org-a"),
      principalRef: principalRef("principal-1"),
      roleRef: roleRef("undeclared_role"),
    });
    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") expect(result.code).toBe("role_not_declared");
  });

  it("rejects a role declared only in another tenant", () => {
    const state = rootA(baseState());
    const result = addMembership(state, {
      id: orgMembershipRef("m1"),
      orgUnitRef: orgUnitRef("org-a"),
      principalRef: principalRef("principal-1"),
      roleRef: roleRef("undeclared_role"),
    });
    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") expect(result.code).toBe("role_not_declared");
  });

  it("rejects membership in a non-active (draft) unit", () => {
    const state = rootA(baseState());
    const draft = createOrgUnit(state, {
      id: orgUnitRef("dept-draft"),
      tenantRef: TENANT_A,
      kind: "department",
      parentRef: orgUnitRef("org-a"),
      profile: { name: "Draft department" },
      lifecycleState: "draft",
    });
    if (draft.outcome !== "ok") throw new Error(draft.reason);
    const result = addMembership(draft.value, {
      id: orgMembershipRef("m1"),
      orgUnitRef: orgUnitRef("dept-draft"),
      principalRef: principalRef("principal-1"),
      roleRef: roleRef("member"),
    });
    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") expect(result.code).toBe("unit_not_active");
  });
});

describe("deactivateMembership (fail-closed transitions)", () => {
  function stateWithMembership(): OrgModelState {
    const state = rootA(baseState());
    const result = addMembership(state, {
      id: orgMembershipRef("m1"),
      orgUnitRef: orgUnitRef("org-a"),
      principalRef: principalRef("principal-1"),
      roleRef: roleRef("org_admin"),
    });
    if (result.outcome !== "ok") throw new Error(result.reason);
    return result.value;
  }

  it("suspends an active membership", () => {
    const result = deactivateMembership(stateWithMembership(), orgMembershipRef("m1"));
    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") {
      expect(result.value.memberships.get(orgMembershipRef("m1"))?.state).toBe("suspended");
    }
  });

  it("denies deactivating an unknown membership", () => {
    const result = deactivateMembership(stateWithMembership(), orgMembershipRef("nope"));
    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") expect(result.code).toBe("unknown_membership");
  });

  it("denies deactivating an already-deactivated membership", () => {
    const deactivated = deactivateMembership(stateWithMembership(), orgMembershipRef("m1"));
    if (deactivated.outcome !== "ok") throw new Error(deactivated.reason);
    const again = deactivateMembership(deactivated.value, orgMembershipRef("m1"));
    expect(again.outcome).toBe("deny");
    if (again.outcome === "deny") expect(again.code).toBe("invalid_transition");
  });
});

describe("resolveOrgScope (derived projection, never a permission grant)", () => {
  function stateWithScope(): OrgModelState {
    let state = childOf(rootA(baseState()), "dept-ops", "org-a");
    for (const [membershipId, unitId] of [
      ["m1", "org-a"],
      ["m2", "dept-ops"],
    ] as const) {
      const result = addMembership(state, {
        id: orgMembershipRef(membershipId),
        orgUnitRef: orgUnitRef(unitId),
        principalRef: principalRef("principal-1"),
        roleRef: roleRef("member"),
      });
      if (result.outcome !== "ok") throw new Error(result.reason);
      state = result.value;
    }
    return state;
  }

  it("returns exactly the active units of active memberships", () => {
    const scope = resolveOrgScope(stateWithScope(), principalRef("principal-1"));
    expect(scope.map((u) => u.id).sort()).toEqual([orgUnitRef("dept-ops"), orgUnitRef("org-a")]);
  });

  it("excludes units after the membership is deactivated (deactivate-then-revalidate)", () => {
    const state = stateWithScope();
    const deactivated = deactivateMembership(state, orgMembershipRef("m2"));
    if (deactivated.outcome !== "ok") throw new Error(deactivated.reason);
    const scope = resolveOrgScope(deactivated.value, principalRef("principal-1"));
    expect(scope.map((u) => u.id)).toEqual([orgUnitRef("org-a")]);
    // Revalidation must also allow re-adding the principal (no live duplicate).
    const readded = addMembership(deactivated.value, {
      id: orgMembershipRef("m3"),
      orgUnitRef: orgUnitRef("dept-ops"),
      principalRef: principalRef("principal-1"),
      roleRef: roleRef("member"),
    });
    expect(readded.outcome).toBe("ok");
  });

  it("returns an EMPTY scope for a malformed principal reference (fail closed)", () => {
    const scope = resolveOrgScope(stateWithScope(), principalRef(""));
    expect(scope).toEqual([]);
  });

  it("MANDATORY ISOLATION (§31): tenant A cannot see tenant B units", () => {
    let state = rootA(baseState());
    const rootB = createOrgUnit(state, {
      id: orgUnitRef("org-b"),
      tenantRef: TENANT_B,
      kind: "organization",
      parentRef: null,
      profile: { name: "Tenant B Organization" },
    });
    if (rootB.outcome !== "ok") throw new Error(rootB.reason);
    state = rootB.value;

    // The same principal-ref string is an active member in BOTH tenants.
    const membershipB = addMembership(state, {
      id: orgMembershipRef("mb"),
      orgUnitRef: orgUnitRef("org-b"),
      principalRef: principalRef("shared-principal"),
      roleRef: roleRef("org_admin"),
    });
    if (membershipB.outcome !== "ok") throw new Error(membershipB.reason);
    state = membershipB.value;

    const membershipA = addMembership(state, {
      id: orgMembershipRef("ma"),
      orgUnitRef: orgUnitRef("org-a"),
      principalRef: principalRef("shared-principal"),
      roleRef: roleRef("org_admin"),
    });
    if (membershipA.outcome !== "ok") throw new Error(membershipA.reason);
    state = membershipA.value;

    // Tenant-bounded projection never leaks the other tenant's units.
    const scopeA = resolveOrgScope(state, principalRef("shared-principal"), TENANT_A);
    expect(scopeA.map((u) => u.id)).toEqual([orgUnitRef("org-a")]);
    expect(scopeA.every((u) => u.tenantRef === TENANT_A)).toBe(true);

    const scopeB = resolveOrgScope(state, principalRef("shared-principal"), TENANT_B);
    expect(scopeB.map((u) => u.id)).toEqual([orgUnitRef("org-b")]);
    expect(scopeB.every((u) => u.tenantRef === TENANT_B)).toBe(true);

    // A principal with no membership in tenant B sees nothing there.
    const outsider = resolveOrgScope(state, principalRef("tenant-a-only"), TENANT_B);
    expect(outsider).toEqual([]);
  });
});
