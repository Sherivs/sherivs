/**
 * CoreGrid — V1-006 neutrality + domain-contribution proof suite.
 *
 * Proves the three structural claims of the V1-006 refactor:
 *
 * (a) NEUTRALITY — the platform authorization core (`lib/authorization.ts`,
 *     `lib/identity.ts`, `lib/rbac/**`) carries zero education-domain
 *     vocabulary. The token scan mirrors the strict-token rules of
 *     `scripts/verify-domain-neutrality.mjs` so a regression here fails this
 *     suite even where the repository guard's baseline ratchet would not.
 *
 * (b) SCHOLAR CONTRIBUTION — the education runtime contributes its roles,
 *     relationship types and gate bindings purely through registration
 *     (`domain-config/scholar-authorization.ts`); the core neither imports it
 *     nor knows its vocabulary, yet registered roles resolve through the
 *     combined authorization engine exactly like core roles, inside the
 *     tenant boundary.
 *
 * (c) DOMAIN-AGNOSTIC CORE — a hypothetical second domain ("catering")
 *     registers and resolves with no changes to the core, and the registry
 *     fails closed on shadowing, collisions, and duplicate registration.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import "@/lib/domain-config/scholar-authorization";
import {
  SCHOLAR_AUTHORIZATION_CONTRIBUTION,
  SCHOLAR_RUNTIME_GATE_CONTRIBUTION,
} from "@/lib/domain-config/scholar-authorization";
import {
  domainRole,
  registerDomainAuthorization,
  registeredDomainIds,
  registeredDomainRoles,
  resolveDomainRoleGrants,
  resolveRoleGrants,
  isRegisteredDomainRole,
  type DomainAuthorizationContribution,
} from "@/lib/rbac/domain-contribution";
import { NEUTRAL_CORE_ROLES, NEUTRAL_ROLE_PERMISSIONS } from "@/lib/rbac/neutral-roles";
import { isUniversalRole } from "@/lib/universal-roles";
import {
  registerRuntimeRoleGate,
  registeredRoleGateRuntimes,
  resolveGateKindBinding,
  resolveStaffRoleSet,
} from "@/lib/rbac/role-gate";
import {
  authorize,
  COREGRID_ROLES,
  makeAuthorizationRequest,
  permission,
} from "@/lib/authorization";
import {
  CORE_PERMISSION_RESOURCES,
  CORE_RELATIONSHIP_TYPES,
  domainPermissionResource,
  identityId,
  registerDomainRelationshipTypes,
  RELATIONSHIP_TYPES,
} from "@/lib/identity";

/* ─────────────────────────────────────────────────────────────
 * (a) Neutrality scan — mirrors scripts/verify-domain-neutrality.mjs
 * ────────────────────────────────────────────────────────────*/

/** Strict education tokens (word-boundary, case-insensitive) from the guard. */
const EDUCATION_TOKENS: readonly string[] = [
  "scholar",
  "student",
  "teacher",
  "school",
  "classroom",
  "curriculum",
  "exam",
  "examination",
  "grade",
  "grading",
  "attendance",
  "fee",
  "fees",
  "tuition",
  "timetable",
  "admission",
  "lesson",
  "homework",
  "library",
  "hostel",
  "bursar",
  "principal",
  "guardian",
  "enrollment",
  "enrolment",
  "academic",
  "discipline",
  "payroll",
  "textbook",
  "vibeora",
];

/** Tokens the guard only treats as hits inside quoted strings. */
const EDUCATION_LITERAL_TOKENS: readonly string[] = ["parent", "staff", "driver", "bus"];

const NEUTRAL_CORE_FILES: readonly string[] = [
  "frontend/src/lib/authorization.ts",
  "frontend/src/lib/identity.ts",
  "frontend/src/lib/rbac/neutral-roles.ts",
  "frontend/src/lib/rbac/domain-contribution.ts",
  "frontend/src/lib/rbac/role-gate.ts",
];

function coreSource(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("(a) Neutrality: the platform authorization core is domain-free", () => {
  it("carries zero education tokens in every neutral core file", () => {
    for (const file of NEUTRAL_CORE_FILES) {
      const source = coreSource(file);
      for (const token of EDUCATION_TOKENS) {
        const hit = new RegExp(`\\b${token}\\b`, "i").test(source);
        expect(hit, `${file} contains education token "${token}"`).toBe(false);
      }
    }
  });

  it("carries zero quoted guard-literal tokens and zero structural identifiers", () => {
    for (const file of NEUTRAL_CORE_FILES) {
      const source = coreSource(file);
      for (const token of EDUCATION_LITERAL_TOKENS) {
        expect(
          source.includes(`"${token}"`),
          `${file} quotes the guard-literal token "${token}"`,
        ).toBe(false);
      }
      expect(
        /schoolId|school_id/.test(source),
        `${file} carries a structural school identifier`,
      ).toBe(false);
    }
  });

  it("exports exactly the neutral core role index (closed set)", () => {
    expect([...COREGRID_ROLES]).toEqual([...NEUTRAL_CORE_ROLES]);
    expect(new Set(COREGRID_ROLES).size).toBe(COREGRID_ROLES.length);
    for (const role of COREGRID_ROLES) {
      expect(role, `role ${role} must be a neutral kebab identifier`).toMatch(/^[a-z][a-z0-9_]*$/);
      for (const token of EDUCATION_TOKENS) {
        expect(
          new RegExp(`\\b${token}\\b`, "i").test(role),
          `role ${role} is education-coded`,
        ).toBe(false);
      }
    }
  });

  it("the neutral permission-resource vocabulary is closed and domain resources stay outside it", () => {
    for (const resource of CORE_PERMISSION_RESOURCES) {
      for (const token of EDUCATION_TOKENS) {
        expect(
          new RegExp(`\\b${token}\\b`, "i").test(resource),
          `core resource ${resource} is education-coded`,
        ).toBe(false);
      }
    }
    // A domain resource never leaks into the core vocabulary even after a
    // domain registers it — the brand lives at the domain boundary only.
    expect(CORE_PERMISSION_RESOURCES).not.toContain("student" as never);
    expect(CORE_PERMISSION_RESOURCES).not.toContain("school" as never);
    expect([...CORE_RELATIONSHIP_TYPES]).not.toContain("parent_of");
  });
});

/* ─────────────────────────────────────────────────────────────
 * (b) Scholar contribution — registration is the only path in
 * ────────────────────────────────────────────────────────────*/

const TEACHER_GRANTS = [
  { resource: domainPermissionResource("class"), action: "read", scope: null },
  { resource: domainPermissionResource("student"), action: "read", scope: null },
  { resource: domainPermissionResource("attendance"), action: "update", scope: null },
  { resource: domainPermissionResource("grades"), action: "update", scope: null },
] as const;

function scholarIdentity(tenantId: string | null) {
  return {
    id: identityId("00000000-0000-0000-0000-000000000001"),
    kind: "human" as const,
    lifecycle: "active" as const,
    tenantId,
  };
}

describe("(b) Scholar adapter: domain roles resolve through the neutral engine", () => {
  it("registers the Scholar domain and its nine roles", () => {
    expect(registeredDomainIds()).toContain("scholar");
    // Other suites in this file may register additional domains (the
    // second-domain fixture); assert Scholar's own contribution exactly.
    expect(registeredDomainRoles()).toEqual(
      expect.arrayContaining([
        "school_super_admin",
        "school_admin",
        "campus_admin",
        "principal",
        "teacher",
        "bursar",
        "parent",
        "student",
        "driver",
      ]),
    );
    expect(isRegisteredDomainRole("floor_manager")).toBe(false);
  });

  it("registered Scholar grants resolve exactly like core grants", () => {
    expect(resolveDomainRoleGrants("teacher")).toEqual([...TEACHER_GRANTS]);
    expect(resolveRoleGrants("teacher")).toEqual([...TEACHER_GRANTS]);
    // Core roles resolve from the neutral table in the same lookup path.
    expect(resolveRoleGrants("org_owner")).toEqual(NEUTRAL_ROLE_PERMISSIONS.org_owner);
    // Unknown roles resolve to no grants — the engine then fails closed.
    expect(resolveRoleGrants("unknown_role")).toEqual([]);
  });

  it("authorize honors a registered domain role inside the tenant boundary", () => {
    const ownTenant = authorize(
      makeAuthorizationRequest(
        scholarIdentity("tenant-1"),
        domainPermissionResource("student"),
        "read",
        "tenant-1:object-1",
      ),
      { role: domainRole("teacher") },
    );
    expect(ownTenant.decision).toBe("ALLOW");
    expect(ownTenant.reason).toBe("Granted by role or explicit permission");

    const foreignTenant = authorize(
      makeAuthorizationRequest(
        scholarIdentity("tenant-1"),
        domainPermissionResource("student"),
        "read",
        "tenant-2:object-9",
      ),
      { role: domainRole("teacher") },
    );
    expect(foreignTenant.decision).toBe("DENY");
    expect(foreignTenant.reason).toContain("Tenant boundary");
  });

  it("Scholar relationship types register into the live identity vocabulary", () => {
    expect(registeredDomainIds()).toContain("scholar");
    for (const contributed of ["enrolled_in", "parent_of", "teaches", "guardian_of"]) {
      expect(RELATIONSHIP_TYPES).toContain(contributed);
    }
    // Only registration extends the vocabulary; the core set itself is closed.
    expect(CORE_RELATIONSHIP_TYPES).toHaveLength(8);
    const domainTypes = RELATIONSHIP_TYPES.filter(
      (t) => !(CORE_RELATIONSHIP_TYPES as readonly string[]).includes(t),
    );
    expect(domainTypes).toEqual(
      expect.arrayContaining(["enrolled_in", "parent_of", "teaches", "guardian_of"]),
    );
  });

  it("gate bindings contributed by the runtime resolve registry-first with legacy parity", () => {
    expect(resolveGateKindBinding("school_admin")).toEqual({
      kind: "school_admin",
      requiresScope: true,
      rpc: { role: "is_school_admin", scope: "get_my_school_id" },
      roleRequiredReason: "Forbidden: school admin role required",
      tenantUnresolvedReason: "No school in scope",
    });
    expect(resolveGateKindBinding("platform_super_admin")).toEqual({
      kind: "platform_super_admin",
      requiresScope: false,
      rpc: { role: "is_super_admin" },
      roleRequiredReason: "Forbidden: platform super admin role required",
      tenantUnresolvedReason: "No school in scope",
    });
    expect(resolveStaffRoleSet("teaching_staff")).toEqual(["admin", "principal", "teacher"]);
    expect(resolveStaffRoleSet("finance_staff")).toEqual(["admin", "principal", "bursar"]);
    expect(resolveStaffRoleSet("unregistered_kind")).toBeNull();
    expect(registeredRoleGateRuntimes()).toContain("runtime_001");
  });
});

describe("(b) Registration fails closed", () => {
  it("rejects duplicate domain registration (idempotence is rejection, not overwrite)", () => {
    const result = registerDomainAuthorization(SCHOLAR_AUTHORIZATION_CONTRIBUTION);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("already registered");
    }
    // The failed re-registration is atomic: the Scholar grants are unchanged.
    expect(resolveDomainRoleGrants("teacher")).toEqual([...TEACHER_GRANTS]);
  });

  it("rejects a domain role shadowing a neutral core role", () => {
    const result = registerDomainAuthorization({
      domainId: "usurper",
      roles: [
        {
          domainRole: "org_owner",
          neutralRoles: ["OWNER"],
          permissions: [permission("tenant", "manage", null)],
          description: "Attempts to shadow the neutral core hierarchy.",
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("shadows a neutral core role");
    }
  });

  it("rejects a domain role posing as a neutral universal role (RULING-4)", () => {
    // Universal-role names are uppercase and domain role names are lowercase
    // by the name pattern — the pattern rejects the impersonation first, and
    // the registry additionally refuses any universal-role name that ever
    // passed it (isUniversalRole defense-in-depth).
    expect(isUniversalRole("ADMINISTRATOR")).toBe(true);
    const result = registerDomainAuthorization({
      domainId: "usurper",
      roles: [
        {
          domainRole: "ADMINISTRATOR",
          neutralRoles: ["ADMINISTRATOR"],
          permissions: [permission("tenant", "update", null)],
          description: "Attempts to pose as the neutral semantic itself.",
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("not a valid domain role name");
    }
    expect(isRegisteredDomainRole("ADMINISTRATOR")).toBe(false);
    expect(isRegisteredDomainRole("administrator")).toBe(false);
  });

  it("rejects malformed domain ids and empty role sets", () => {
    const badId = registerDomainAuthorization({
      domainId: "Bad-Domain",
      roles: [
        {
          domainRole: "worker_bee",
          neutralRoles: ["WORKER"],
          permissions: [permission("tenant", "read", null)],
          description: "Valid role under an invalid domain id.",
        },
      ],
    });
    expect(badId.ok).toBe(false);

    const badRoles = registerDomainAuthorization({
      domainId: "empty_domain",
      roles: [],
    });
    expect(badRoles.ok).toBe(false);
  });

  it("rejects duplicate runtime gate registration", () => {
    const result = registerRuntimeRoleGate(SCHOLAR_RUNTIME_GATE_CONTRIBUTION);
    expect(result.ok).toBe(false);
  });

  it("rejects domain relationship types shadowing core types", () => {
    const result = registerDomainRelationshipTypes(["owns"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("shadows a core relationship type");
    }
    // The registry is unchanged after the rejection.
    const domainTypes = RELATIONSHIP_TYPES.filter(
      (t) => !(CORE_RELATIONSHIP_TYPES as readonly string[]).includes(t),
    );
    expect(domainTypes).not.toContain("owns");
    expect(domainTypes.length).toBe(RELATIONSHIP_TYPES.length - CORE_RELATIONSHIP_TYPES.length);
  });
});

/* ─────────────────────────────────────────────────────────────
 * (c) A second domain registers without any core change
 * ────────────────────────────────────────────────────────────*/

const CATERING_CONTRIBUTION: DomainAuthorizationContribution = {
  domainId: "catering",
  roles: [
    {
      domainRole: "sous_chef",
      neutralRoles: ["WORKER"],
      permissions: [{ resource: domainPermissionResource("menu"), action: "read", scope: null }],
      description: "Executes assigned kitchen production tasks.",
    },
    {
      domainRole: "head_caterer",
      neutralRoles: ["MANAGER"],
      permissions: [{ resource: domainPermissionResource("menu"), action: "manage", scope: null }],
      description: "Directs the catering operation and its menu surface.",
    },
  ],
  relationshipTypes: ["catered_for"],
};

beforeAll(() => {
  const result = registerDomainAuthorization(CATERING_CONTRIBUTION);
  expect(result.ok, `catering registration: ${result.ok ? "ok" : result.errors.join("; ")}`).toBe(
    true,
  );
});

describe("(c) Domain-agnostic core: a second domain registers and resolves", () => {
  it("registers alongside Scholar with the core index unchanged", () => {
    // The core index is closed: a new domain NEVER extends it.
    expect(COREGRID_ROLES).toHaveLength(19);
    expect([...registeredDomainIds()].sort()).toEqual(["catering", "scholar"]);
    expect(isRegisteredDomainRole("sous_chef")).toBe(true);
  });

  it("the second domain's roles and relationship types resolve through the shared engine", () => {
    expect(resolveDomainRoleGrants("sous_chef")).toEqual([
      { resource: domainPermissionResource("menu"), action: "read", scope: null },
    ]);
    const result = authorize(
      makeAuthorizationRequest(
        scholarIdentity("tenant-1"),
        domainPermissionResource("menu"),
        "read",
        "tenant-1:kitchen-1",
      ),
      { role: domainRole("sous_chef") },
    );
    expect(result.decision).toBe("ALLOW");
    expect(RELATIONSHIP_TYPES).toContain("catered_for");
    expect(CORE_RELATIONSHIP_TYPES).toHaveLength(8);
  });

  it("a bare role name keeps exactly one meaning platform-wide (cross-domain collision rejected)", () => {
    const result = registerDomainAuthorization({
      domainId: "food_trucks",
      roles: [
        {
          domainRole: "sous_chef",
          neutralRoles: ["WORKER"],
          permissions: [
            { resource: domainPermissionResource("menu"), action: "update", scope: null },
          ],
          description: "Collides with the catering domain's bare role name.",
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("already registered");
    }
    // The failed registration left the original grants untouched (atomic).
    expect(resolveDomainRoleGrants("sous_chef")).toEqual([
      { resource: domainPermissionResource("menu"), action: "read", scope: null },
    ]);
  });
});
