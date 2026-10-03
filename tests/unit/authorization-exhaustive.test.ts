/**
 * CoreGrid — exhaustive decision-matrix suite for the combined authorization
 * engine (MISSION-R-80 / V1CAP-016).
 *
 * Covers `frontend/src/lib/authorization.ts`: the combined
 * Identity + Tenant + Role + Relationship + Resource + Action + Policy +
 * Context + Risk decision formula producing
 * ALLOW | DENY | REDACT | ESCALATE | REQUIRE_APPROVAL.
 *
 * Invariants under test:
 * - Invariant 02: no decision relies solely on a username or role (default DENY).
 * - Invariant 12: no autonomous agent may silently escalate its own authority.
 * - Deny-by-default: any input combination the engine does not explicitly
 *   allow yields a non-ALLOW decision (property-tested with a seeded fuzzer).
 *
 * Defects DEFECT-1 (expired relationships authorize), DEFECT-2 (no tenant
 * boundary) and DEFECT-3 (`isAgent` dead code) have been RESOLVED in the
 * engine; the previously-exposing tests are flipped to correctness
 * assertions and the fuzz oracle models the new invariants. See
 * `authorization-exhaustive.DEFECTS.md`.
 */
import { describe, expect, it } from "vitest";
// The Scholar runtime contributes its roles/relationship types/gate bindings
// through registration; importing the adapter is the registration path.
import "@/lib/domain-config/scholar-authorization";
import { registeredDomainIds, registeredDomainRoles } from "@/lib/rbac/domain-contribution";
import {
  authorize,
  COREGRID_ROLES,
  evaluateAbac,
  evaluatePolicySet,
  hasRelationship,
  makeAuthorizationRequest,
  permission,
  redact,
  type AbacContext,
  type AuthorizeOptions,
  type CoreGridRole,
  type PolicyRule,
  type PolicySet,
} from "@/lib/authorization";
import {
  domainPermissionResource,
  IDENTITY_LIFECYCLE_STATES,
  RELATIONSHIP_TYPES,
  identityId,
  type AuthorizationDecision,
  type AuthorizationRequest,
  type IdentityLifecycleState,
  type IdentityRelationship,
  type PermissionAction,
  type PermissionResource,
  type RelationshipType,
} from "@/lib/identity";

const NOW = "2026-10-01T00:00:00.000Z";
const TENANT_A = "tenant-1";
const TENANT_B = "tenant-2";
const OBJECT_A = "tenant-1:object-1";
const OBJECT_B = "tenant-2:object-9";

const DECISIONS: readonly AuthorizationDecision[] = [
  "ALLOW",
  "DENY",
  "REDACT",
  "ESCALATE",
  "REQUIRE_APPROVAL",
];

/* ─────────────────────────────────────────────────────────────
 * Builders
 * ────────────────────────────────────────────────────────────*/

function identity(
  overrides: Partial<AuthorizationRequest["identity"]> = {},
): AuthorizationRequest["identity"] {
  return {
    id: identityId("00000000-0000-0000-0000-000000000001"),
    kind: "human",
    lifecycle: "active",
    tenantId: TENANT_A,
    ...overrides,
  };
}

function rel(
  type: RelationshipType,
  targetId: string,
  overrides: Partial<IdentityRelationship> = {},
): IdentityRelationship {
  return {
    id: "rel-1",
    subjectId: identityId("00000000-0000-0000-0000-000000000001"),
    type,
    targetId,
    scope: null,
    createdAt: NOW,
    expiresAt: null,
    revokedAt: null,
    version: 1,
    ...overrides,
  };
}

function req(
  resource: PermissionResource | string,
  action: PermissionAction | string,
  scope: string | null,
  relationships: IdentityRelationship[] = [],
  reqOverrides: Partial<AuthorizationRequest> = {},
): AuthorizationRequest {
  return makeAuthorizationRequest(
    identity(reqOverrides.identity),
    resource as PermissionResource,
    action as PermissionAction,
    scope,
    relationships,
    reqOverrides.attributes ?? {},
  );
}

/**
 * Options builder. The role may be any registered role name — a neutral core
 * role or a domain-contributed one (registered by the adapter import above) —
 * so the decision matrix exercises both vocabularies through the same engine.
 */
function opts(
  overrides: Omit<Partial<AuthorizeOptions>, "role"> & { role?: string } = {},
): AuthorizeOptions {
  return { role: "read_only", ...overrides } as AuthorizeOptions;
}

/** Cast an arbitrary string into an engine role/resource/action for fail-closed probes. */
function unsafe<T>(value: string): T {
  return value as T;
}

/* ─────────────────────────────────────────────────────────────
 * Role → grant mirror table (RBAC layer): neutral core roles are
 * transcribed from `rbac/neutral-roles.ts`; the Scholar runtime roles are
 * transcribed from the domain contribution registered by the adapter import
 * (the engine resolves both through the same registry).
 * ────────────────────────────────────────────────────────────*/

const ROLE_GRANTS: Record<string, readonly (readonly [string, PermissionAction])[]> = {
  coregrid_owner: [
    ["tenant", "manage"],
    ["identity", "manage"],
    ["settings", "manage"],
    ["audit_log", "read"],
  ],
  platform_admin: [
    ["tenant", "manage"],
    ["identity", "manage"],
    ["settings", "manage"],
  ],
  engineer: [
    ["settings", "read"],
    ["audit_log", "read"],
  ],
  senior_engineer: [
    ["settings", "manage"],
    ["audit_log", "read"],
  ],
  support_engineer: [
    ["user", "read"],
    ["identity", "read"],
  ],
  security_engineer: [
    ["identity", "read"],
    ["audit_log", "read"],
    ["session", "read"],
  ],
  sre: [
    ["settings", "read"],
    ["audit_log", "read"],
  ],
  data_engineer: [["analytics", "read"]],
  ai_engineer: [["ai_agent", "manage"]],
  ai_operator: [
    ["ai_agent", "read"],
    ["ai_agent", "execute"],
  ],
  product: [["analytics", "read"]],
  finance: [
    ["payments", "read"],
    ["billing", "read"],
  ],
  compliance: [
    ["audit_log", "read"],
    ["identity", "read"],
  ],
  auditor: [["audit_log", "read"]],
  support: [["user", "read"]],
  read_only: [],
  org_owner: [
    ["tenant", "manage"],
    ["identity", "manage"],
    ["settings", "manage"],
    ["audit_log", "read"],
  ],
  org_admin: [
    ["tenant", "update"],
    ["user", "manage"],
    ["settings", "update"],
    ["identity", "read"],
  ],
  // Baseline tenant participant: authority flows only through explicit
  // delegation (extraPermissions) or an owns/manages relationship.
  member: [],
  // Scholar runtime roles (registered by the domain adapter import above).
  school_super_admin: [
    ["school", "manage"],
    ["user", "manage"],
    ["identity", "manage"],
    ["settings", "manage"],
  ],
  school_admin: [
    ["school", "update"],
    ["user", "manage"],
    ["settings", "update"],
  ],
  campus_admin: [
    ["campus", "manage"],
    ["user", "manage"],
  ],
  principal: [
    ["school", "read"],
    ["teacher", "read"],
    ["student", "read"],
    ["attendance", "read"],
    ["grades", "read"],
  ],
  teacher: [
    ["class", "read"],
    ["student", "read"],
    ["attendance", "update"],
    ["grades", "update"],
  ],
  bursar: [
    ["fees", "manage"],
    ["payments", "manage"],
  ],
  parent: [["student", "read"]],
  student: [["student", "read"]],
  driver: [["student", "read"]],
};

/* ─────────────────────────────────────────────────────────────
 * Independent ALLOW-oracle used by the property/fuzz tests.
 * Mirrors the documented evaluation order (identity gate → tenant gate →
 * PBAC → ABAC → RBAC → ReBAC → default DENY) without reusing engine code.
 * The oracle models every engine invariant, including the resolved ones:
 * - Tenant boundary: a scope carrying a foreign tenant can never ALLOW.
 * - Relationship expiry: an expired relationship is inactive, identical
 *   to a revoked one.
 * - Invariant 12: an agent (`isAgent`) holds no role-derived authority.
 * ────────────────────────────────────────────────────────────*/

function oracleAllows(request: AuthorizationRequest, options: AuthorizeOptions): boolean {
  // Tenant boundary gate (mirrors engine step 2).
  const scope = request.permission.scope;
  const separatorIndex = scope === null ? -1 : scope.indexOf(":");
  const scopeTenant =
    scope === null || separatorIndex === -1 ? null : scope.slice(0, separatorIndex);
  if (
    request.identity.tenantId !== null &&
    scopeTenant !== null &&
    scopeTenant !== request.identity.tenantId
  ) {
    return false;
  }

  if (request.identity.lifecycle !== "active" && request.identity.lifecycle !== "provisioned") {
    return false;
  }

  if (options.policySet) {
    const matching = options.policySet.rules.find((rule) => rule.applies(request));
    if (matching) return matching.decision === "ALLOW";
  }

  const abac = options.abac;
  if (abac) {
    if (abac.risk !== undefined && abac.risk > 0.8) return false;
    if (
      abac.deviceTrust !== undefined &&
      abac.deviceTrust < 0.3 &&
      (request.permission.action === "delete" || request.permission.action === "manage")
    ) {
      return false;
    }
  }

  // Invariant 12: an agent holds no role-derived authority.
  const roleGrants = options.isAgent === true ? [] : (ROLE_GRANTS[options.role] ?? []);
  const rbacMatch = roleGrants.some(
    ([resource, action]) =>
      resource === request.permission.resource && action === request.permission.action,
  );
  if (rbacMatch) return true;

  for (const extra of options.extraPermissions ?? []) {
    if (
      extra.resource === request.permission.resource &&
      extra.action === request.permission.action &&
      (extra.scope === null || extra.scope === request.permission.scope)
    ) {
      return true;
    }
  }

  const nowMs = Date.now();
  const rebacMatch = request.relationships.some((r) => {
    if (r.revokedAt !== null) return false;
    if (r.expiresAt !== null) {
      const expiryMs = Date.parse(r.expiresAt);
      if (Number.isNaN(expiryMs) || expiryMs <= nowMs) return false;
    }
    return r.targetId === request.permission.scope && (r.type === "owns" || r.type === "manages");
  });
  return rebacMatch;
}

/* ─────────────────────────────────────────────────────────────
 * 1. Decision matrix — every modeled (role, resource, action) class
 * ────────────────────────────────────────────────────────────*/

describe("Decision matrix: RBAC allow/deny per role class", () => {
  it("declares the full role index (neutral core + registered domain roles)", () => {
    // The neutral core index is closed: 19 domain-neutral roles, zero domain
    // vocabulary. Domain roles exist only through registration.
    expect(COREGRID_ROLES).toHaveLength(19);
    expect(new Set(COREGRID_ROLES).size).toBe(COREGRID_ROLES.length);
    // The Scholar runtime contributes its 9 roles through registration; they
    // resolve through the same engine but never enter the core index.
    expect(registeredDomainRoles()).toHaveLength(9);
    expect(registeredDomainIds()).toEqual(["scholar"]);
  });

  for (const role of [...COREGRID_ROLES, ...registeredDomainRoles()]) {
    describe(`role ${role}`, () => {
      const grants = ROLE_GRANTS[role];

      it("ALLOWs a granted resource:action (with an allow case for every modeled class)", () => {
        if (grants.length === 0) {
          // read_only holds no role grants — ALLOW must come from an explicit grant.
          const viaExtra = authorize(
            req("analytics", "read", OBJECT_A),
            opts({ role, extraPermissions: [permission("analytics", "read", OBJECT_A)] }),
          );
          expect(viaExtra.decision).toBe("ALLOW");
          expect(viaExtra.reason).toBe("Granted by role or explicit permission");
          return;
        }
        const [resource, action] = grants[0];
        const result = authorize(req(resource, action, OBJECT_A), opts({ role }));
        expect(result.decision).toBe("ALLOW");
        expect(result.reason).toBe("Granted by role or explicit permission");
      });

      it("DENYs an ungranted resource:action (deny case for every modeled class)", () => {
        // Pick a probe this role genuinely lacks so every role gets a true
        // deny case (bursar does hold payments:manage).
        const probes: readonly (readonly [string, PermissionAction])[] = [
          ["payments", "manage"],
          ["school", "delete"],
          ["student", "delete"],
        ];
        const probe = probes.find(
          ([resource, action]) => !grants.some(([r, a]) => r === resource && a === action),
        );
        expect(probe, `role ${role} unexpectedly holds every probe`).toBeDefined();
        const result = authorize(req(probe![0], probe![1], OBJECT_A), opts({ role }));
        expect(result.decision).toBe("DENY");
        expect(result.reason).toBe("No matching grant or policy");
      });
    });
  }

  it("scope-null role grants are tenant-bounded: same-tenant scopes ALLOW, foreign-tenant scopes DENY", () => {
    // The teacher grant is stored with scope: null, so within the identity's
    // own tenant it matches any requested scope. Since DEFECT-2 was resolved,
    // the engine's tenant gate stops the same grant at a foreign tenant.
    const ownTenant = authorize(req("student", "read", OBJECT_A), opts({ role: "teacher" }));
    const otherTenant = authorize(req("student", "read", OBJECT_B), opts({ role: "teacher" }));
    expect(ownTenant.decision).toBe("ALLOW");
    expect(otherTenant.decision).toBe("DENY");
    expect(otherTenant.reason).toContain("Tenant boundary");
  });
});

describe("Decision matrix: scope classes for explicit grants (ABAC-free RBAC scope matching)", () => {
  it("ALLOWs an extra permission whose scope matches the request scope", () => {
    const result = authorize(
      req("fees", "manage", OBJECT_A),
      opts({
        role: "teacher",
        extraPermissions: [permission(domainPermissionResource("fees"), "manage", OBJECT_A)],
      }),
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("DENYs an extra permission whose scope differs from the request scope", () => {
    const result = authorize(
      req("fees", "manage", OBJECT_B),
      opts({
        role: "teacher",
        extraPermissions: [permission(domainPermissionResource("fees"), "manage", OBJECT_A)],
      }),
    );
    expect(result.decision).toBe("DENY");
  });

  it("a scope-null extra permission matches any scope within the identity's tenant", () => {
    const result = authorize(
      req("fees", "manage", OBJECT_A),
      opts({
        role: "teacher",
        extraPermissions: [permission(domainPermissionResource("fees"), "manage", null)],
      }),
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("an extra permission on the right resource but wrong action is not a match", () => {
    const result = authorize(
      req("fees", "manage", OBJECT_A),
      opts({
        role: "teacher",
        extraPermissions: [permission(domainPermissionResource("fees"), "read", OBJECT_A)],
      }),
    );
    expect(result.decision).toBe("DENY");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. ReBAC decision classes
 * ────────────────────────────────────────────────────────────*/

describe("Decision matrix: ReBAC relationship classes", () => {
  it("ALLOWs an active owns relationship matching the request scope", () => {
    const result = authorize(
      req("school", "update", OBJECT_A, [rel("owns", OBJECT_A)]),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("ALLOW");
    expect(result.reason).toBe("Granted by relationship");
  });

  it("ALLOWs an active manages relationship matching the request scope", () => {
    const result = authorize(
      req("school", "delete", OBJECT_A, [rel("manages", OBJECT_A)]),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("DENYs a revoked owns relationship", () => {
    const result = authorize(
      req("school", "update", OBJECT_A, [rel("owns", OBJECT_A, { revokedAt: NOW })]),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("DENY");
  });

  it("DENYs owns/manages relationships targeting a different scope", () => {
    const result = authorize(
      req("school", "update", OBJECT_B, [rel("owns", OBJECT_A), rel("manages", OBJECT_A)]),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("DENY");
  });

  it("DENYs non-authorizing relationship types even on an exact target match", () => {
    const nonAuthorizing = RELATIONSHIP_TYPES.filter((t) => t !== "owns" && t !== "manages");
    expect(nonAuthorizing.length).toBe(RELATIONSHIP_TYPES.length - 2);
    for (const type of nonAuthorizing) {
      const result = authorize(
        req("school", "update", OBJECT_A, [rel(type, OBJECT_A)]),
        opts({ role: "read_only" }),
      );
      expect(result.decision, `relationship type ${type} must not authorize`).toBe("DENY");
    }
  });

  it("ReBAC grant ignores the requested action class — any action is authorized by owns", () => {
    // Documented breadth: the relationship grant checks only targetId/scope,
    // not the resource or action being requested.
    const result = authorize(
      req("payments", "manage", OBJECT_A, [rel("owns", OBJECT_A)]),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("ALLOW");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. PBAC decision classes (REDACT / REQUIRE_APPROVAL reachability)
 * ────────────────────────────────────────────────────────────*/

describe("Decision matrix: PBAC policy classes — all five decisions reachable", () => {
  const allMatcher: PolicyRule = {
    id: "match-all",
    applies: () => true,
    decision: "DENY",
    reason: "match-all",
  };

  it("REQUIRE_APPROVAL is reachable via a policy rule", () => {
    const policySet: PolicySet = {
      rules: [
        {
          id: "approve-deletes",
          applies: (r) => r.permission.action === "delete",
          decision: "REQUIRE_APPROVAL",
          reason: "Deletion requires approval",
        },
      ],
    };
    const result = authorize(
      req("student", "delete", OBJECT_A),
      opts({ role: "teacher", policySet }),
    );
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.reason).toBe("Deletion requires approval");
  });

  it("REDACT is reachable via a policy rule", () => {
    const policySet: PolicySet = {
      rules: [
        {
          id: "redact-phi",
          applies: (r) => r.permission.resource === "student" && r.permission.action === "read",
          decision: "REDACT",
          reason: "PHI redacted for this role",
        },
      ],
    };
    const result = authorize(
      req("student", "read", OBJECT_A),
      opts({ role: "support", policySet }),
    );
    expect(result.decision).toBe("REDACT");
    expect(result.reason).toBe("PHI redacted for this role");
  });

  it("a policy DENY wins over an RBAC grant (PBAC precedes RBAC)", () => {
    const policySet: PolicySet = {
      rules: [allMatcher],
    };
    const result = authorize(
      req("student", "read", OBJECT_A),
      opts({ role: "teacher", policySet }),
    );
    expect(result.decision).toBe("DENY");
    expect(result.reason).toBe("match-all");
  });

  it("a policy ALLOW authorizes a request no role grants", () => {
    const policySet: PolicySet = {
      rules: [
        {
          id: "break-glass-read",
          applies: (r) => r.permission.resource === "payments",
          decision: "ALLOW",
          reason: "Break-glass payments read",
        },
      ],
    };
    const result = authorize(
      req("payments", "read", OBJECT_A),
      opts({ role: "auditor", policySet }),
    );
    expect(result.decision).toBe("ALLOW");
    expect(result.reason).toBe("Break-glass payments read");
  });

  it("the first matching rule wins (ordering is part of the contract)", () => {
    const policySet: PolicySet = {
      rules: [
        {
          id: "first",
          applies: () => true,
          decision: "REQUIRE_APPROVAL",
          reason: "first rule",
        },
        {
          id: "second",
          applies: () => true,
          decision: "ALLOW",
          reason: "second rule",
        },
      ],
    };
    const result = evaluatePolicySet(policySet, req("student", "read", OBJECT_A));
    expect(result?.decision).toBe("REQUIRE_APPROVAL");
    expect(result?.reason).toBe("first rule");
  });

  it("a non-matching policy set falls through to RBAC and default deny", () => {
    const policySet: PolicySet = {
      rules: [
        {
          id: "payments-only",
          applies: (r) => r.permission.resource === "payments",
          decision: "DENY",
          reason: "payments hold",
        },
      ],
    };
    const granted = authorize(
      req("student", "read", OBJECT_A),
      opts({ role: "teacher", policySet }),
    );
    expect(granted.decision).toBe("ALLOW");

    const ungranted = authorize(
      req("grades", "delete", OBJECT_A),
      opts({ role: "read_only", policySet }),
    );
    expect(ungranted.decision).toBe("DENY");
    expect(ungranted.reason).toBe("No matching grant or policy");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. ABAC context classes (risk / device trust)
 * ────────────────────────────────────────────────────────────*/

describe("Decision matrix: ABAC context classes", () => {
  it("ESCALATEs when risk exceeds 0.8 — even for a role-granted action", () => {
    const result = authorize(
      req("student", "read", OBJECT_A),
      opts({ role: "teacher", abac: { risk: 0.9 } }),
    );
    expect(result.decision).toBe("ESCALATE");
    expect(result.reason).toContain("escalation");
  });

  it("does not escalate at the 0.8 boundary (strictly-greater rule)", () => {
    const result = authorize(
      req("student", "read", OBJECT_A),
      opts({ role: "teacher", abac: { risk: 0.8 } }),
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("ESCALATE precedes RBAC, so an ungranted high-risk action escalates instead of denying", () => {
    // Documented ordering (docstring steps 3 before 4): a caller probing an
    // ungranted action still learns the request was risk-flagged. Informational
    // observation only — ordering is intentional per the engine contract.
    const result = authorize(
      req("payments", "manage", OBJECT_A),
      opts({ role: "read_only", abac: { risk: 0.95 } }),
    );
    expect(result.decision).toBe("ESCALATE");
  });

  it("DENYs destructive actions on low-trust devices before RBAC is consulted", () => {
    for (const action of ["delete", "manage"] as const) {
      for (const role of COREGRID_ROLES) {
        const result = authorize(
          req("settings", action, OBJECT_A),
          opts({ role, abac: { deviceTrust: 0.29 } }),
        );
        expect(result.decision, `${role} + ${action} on untrusted device`).toBe("DENY");
        expect(result.reason).toContain("Untrusted device");
      }
    }
  });

  it("low device trust does not block non-destructive actions", () => {
    const result = authorize(
      req("student", "read", OBJECT_A),
      opts({ role: "teacher", abac: { deviceTrust: 0.1 } }),
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("device trust 0.3 is not 'low' (strictly-less rule)", () => {
    const result = authorize(
      req("settings", "manage", OBJECT_A),
      opts({ role: "senior_engineer", abac: { deviceTrust: 0.3 } }),
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("evaluateAbac returns null for a benign context (no forced decision)", () => {
    const request = req("student", "read", OBJECT_A);
    expect(evaluateAbac(request, {})).toBeNull();
    expect(evaluateAbac(request, { risk: 0.5, deviceTrust: 0.9 })).toBeNull();
  });

  it("ABAC alone never produces ALLOW (context can only veto or escalate)", () => {
    const request = req("student", "read", OBJECT_A);
    const contexts: AbacContext[] = [
      { risk: 0 },
      { risk: 1 },
      { deviceTrust: 0 },
      { deviceTrust: 1 },
      { risk: 0.9, deviceTrust: 0.1 },
    ];
    for (const ctx of contexts) {
      const result = evaluateAbac(request, ctx);
      if (result) expect(result.decision === "ALLOW").toBe(false);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Identity lifecycle gate (decision-matrix input class)
 * ────────────────────────────────────────────────────────────*/

describe("Decision matrix: identity lifecycle gate", () => {
  it("allows the two usable lifecycle states", () => {
    for (const state of ["active", "provisioned"] as const) {
      const result = authorize(
        req("student", "read", OBJECT_A, [], { identity: identity({ lifecycle: state }) }),
        opts({ role: "teacher" }),
      );
      expect(result.decision, `lifecycle ${state}`).toBe("ALLOW");
    }
  });

  it("denies every non-usable lifecycle state, even with a matching role grant", () => {
    const nonUsable = IDENTITY_LIFECYCLE_STATES.filter(
      (s) => s !== "active" && s !== "provisioned",
    );
    expect(nonUsable).toEqual(["proposed", "review", "suspended", "deleted", "archived"]);
    for (const state of nonUsable) {
      const result = authorize(
        req("student", "read", OBJECT_A, [], { identity: identity({ lifecycle: state }) }),
        opts({ role: "teacher" }),
      );
      expect(result.decision, `lifecycle ${state}`).toBe("DENY");
      expect(result.reason).toContain("not usable");
    }
  });

  it("the gate wins over policy ALLOW and ReBAC grants (first in the pipeline)", () => {
    const policySet: PolicySet = {
      rules: [{ id: "allow-all", applies: () => true, decision: "ALLOW", reason: "policy allow" }],
    };
    const viaPolicy = authorize(
      req("student", "read", OBJECT_A, [], { identity: identity({ lifecycle: "suspended" }) }),
      opts({ role: "teacher", policySet }),
    );
    expect(viaPolicy.decision).toBe("DENY");

    const viaRebac = authorize(
      req("school", "update", OBJECT_A, [rel("owns", OBJECT_A)], {
        identity: identity({ lifecycle: "deleted" }),
      }),
      opts({ role: "read_only" }),
    );
    expect(viaRebac.decision).toBe("DENY");
  });

  // MISSION-R-22 boundary: transition legality between lifecycle states,
  // credential status (expired/revoked), session expiry, and delegation
  // expiry are identity-LIFECYCLE semantics owned by the identity-lifecycle
  // suite. The decision matrix consumes `identity.lifecycle` as an input and
  // is verified here only at the gate level. Note that authorize() has no
  // credential/session/delegation inputs at all — such authority state cannot
  // even be expressed as an authorization request (see DEFECTS.md, boundary note).
});

/* ─────────────────────────────────────────────────────────────
 * 6. Deny-by-default on unknown / malformed inputs
 * ────────────────────────────────────────────────────────────*/

describe("Deny-by-default: unknown and malformed inputs fail closed", () => {
  it("DENYs an unknown role string (fail-closed lookup)", () => {
    const result = authorize(
      req("settings", "manage", OBJECT_A),
      opts({ role: unsafe<CoreGridRole>("root_superadmin") }),
    );
    expect(result.decision).toBe("DENY");
    expect(result.reason).toBe("No matching grant or policy");
  });

  it("DENYs an empty-string role", () => {
    const result = authorize(
      req("settings", "read", OBJECT_A),
      opts({ role: unsafe<CoreGridRole>("") }),
    );
    expect(result.decision).toBe("DENY");
  });

  it("DENYs unknown resource and action strings even for privileged roles", () => {
    for (const role of ["coregrid_owner", "platform_admin", "school_super_admin"] as const) {
      const unknownResource = authorize(
        req(unsafe<PermissionResource>("nuclear_silo"), "manage", OBJECT_A),
        opts({ role }),
      );
      expect(unknownResource.decision, `role ${role} / unknown resource`).toBe("DENY");

      const unknownAction = authorize(
        req("settings", unsafe<PermissionAction>("purge"), OBJECT_A),
        opts({ role }),
      );
      expect(unknownAction.decision, `role ${role} / unknown action`).toBe("DENY");
    }
  });

  it("DENYs empty-string resource and action strings", () => {
    const result = authorize(
      req(unsafe<PermissionResource>(""), unsafe<PermissionAction>(""), null),
      opts({ role: "coregrid_owner" }),
    );
    expect(result.decision).toBe("DENY");
  });

  it("DENYs malformed scope identifiers against scope-null grants' intent is undefined — scope-null matches, but malformed scope strings never create access on their own", () => {
    // A malformed scope string cannot match a scoped grant, and a grant is
    // still required — so malformed identifiers fail closed unless a
    // scope-null grant (an explicitly-allowed class) covers them.
    const malformedScopes = ["", "   ", "tenant-1:object-1:extra", "\0inject", "tenant-1:"];
    for (const scope of malformedScopes) {
      const withoutGrant = authorize(
        req("fees", "manage", scope),
        opts({
          role: "read_only",
          extraPermissions: [permission(domainPermissionResource("fees"), "manage", OBJECT_A)],
        }),
      );
      expect(withoutGrant.decision, `malformed scope ${JSON.stringify(scope)}`).toBe("DENY");
    }
  });

  it("DENYs with empty relationships and empty extra permissions", () => {
    const result = authorize(req("school", "manage", OBJECT_A, []), opts({ role: "read_only" }));
    expect(result.decision).toBe("DENY");
  });

  it("DENYs when the identity is missing tenant context and no grant matches — tenantId alone grants nothing", () => {
    const result = authorize(
      req("school", "manage", OBJECT_B, [], { identity: identity({ tenantId: null }) }),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("DENY");
  });

  it("every result carries a non-empty reason and a valid decision value", () => {
    const probe = authorize(
      req("student", "read", OBJECT_A),
      opts({ role: "teacher", abac: { risk: 0.9 } }),
    );
    expect(DECISIONS).toContain(probe.decision);
    expect(probe.reason.length).toBeGreaterThan(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Cross-tenant combinations
 * ────────────────────────────────────────────────────────────*/

describe("Cross-tenant combinations", () => {
  it("DENYs a scoped grant requested against a foreign scope", () => {
    const result = authorize(
      req("fees", "manage", OBJECT_B),
      opts({
        role: "read_only",
        extraPermissions: [permission(domainPermissionResource("fees"), "manage", OBJECT_A)],
      }),
    );
    expect(result.decision).toBe("DENY");
  });

  it("DEFECT-2 (resolved): null-scope grants never authorize foreign-tenant scopes", () => {
    // The engine's tenant gate (resolved DEFECT-2) compares identity.tenantId
    // with the tenant carried by the requested scope: a scope-null role grant
    // cannot cross the tenant boundary, so a parent of tenant-1 is denied
    // reading a student scoped to a tenant-2 object.
    const foreignParent = identity({ tenantId: TENANT_A });
    const result = authorize(
      req("student", "read", OBJECT_B, [], { identity: foreignParent }),
      opts({ role: "parent" }),
    );
    expect(result.decision).toBe("DENY");
    expect(result.reason).toContain("Tenant boundary");
  });

  it("DEFECT-2 (resolved): an owns relationship from the wrong tenant does not authorize even when the target string matches", () => {
    // The tenant gate runs before the ReBAC layer, so targetId string
    // equality can never smuggle a cross-tenant relationship grant through.
    const result = authorize(
      req("school", "manage", OBJECT_B, [rel("owns", OBJECT_B)]),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("DENY");
    expect(result.reason).toContain("Tenant boundary");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 8. Revocation / expiry authority classes
 * ────────────────────────────────────────────────────────────*/

describe("Revocation and expiry authority classes", () => {
  it("a revoked relationship fails closed at the decision layer", () => {
    const revoked = rel("owns", OBJECT_A, { revokedAt: "2026-09-01T00:00:00.000Z" });
    const result = authorize(
      req("school", "update", OBJECT_A, [revoked]),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("DENY");
  });

  it("hasRelationship ignores revoked relationships", () => {
    const revoked = rel("manages", OBJECT_A, { revokedAt: "2026-09-01T00:00:00.000Z" });
    expect(hasRelationship([revoked], "manages", OBJECT_A)).toBe(false);
  });

  it("an unexpired relationship remains usable", () => {
    const live = rel("owns", OBJECT_A, { expiresAt: "2099-01-01T00:00:00.000Z" });
    const result = authorize(
      req("school", "update", OBJECT_A, [live]),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("DEFECT-1 (resolved): an EXPIRED relationship no longer authorizes (expiry is identical to revocation)", () => {
    // expiresAt is in the past and revokedAt is null: since DEFECT-1 was
    // resolved, the ReBAC grant treats the relationship as inactive and the
    // request falls through to the deny path.
    const expired = rel("owns", OBJECT_A, { expiresAt: "2020-01-01T00:00:00.000Z" });
    const result = authorize(
      req("school", "update", OBJECT_A, [expired]),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("DENY");
  });

  it("DEFECT-1 (resolved): hasRelationship treats an expired relationship as inactive", () => {
    const expired = rel("manages", OBJECT_A, { expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(hasRelationship([expired], "manages", OBJECT_A)).toBe(false);
  });

  it("DEFECT-3 (resolved): AuthorizeOptions.isAgent is enforced — agents need explicit delegation (Invariant 12)", () => {
    // Since DEFECT-3 was resolved, `isAgent: true` activates the Invariant-12
    // enforcement at the single enforcement point: an agent never inherits
    // authority from role membership, so the same request that ALLOWs for a
    // human senior_engineer denies for the agent.
    const request = req("settings", "manage", OBJECT_A);
    const asHuman = authorize(request, opts({ role: "senior_engineer" }));
    const asAgent = authorize(request, opts({ role: "senior_engineer", isAgent: true }));
    expect(asHuman.decision).toBe("ALLOW");
    expect(asAgent.decision).toBe("DENY");
    expect(asAgent.reason).toContain("Invariant 12");
    expect(asAgent).not.toEqual(asHuman);

    // Explicit delegation through extraPermissions restores authority.
    const delegated = authorize(
      request,
      opts({
        role: "senior_engineer",
        isAgent: true,
        extraPermissions: [permission("settings", "manage", OBJECT_A)],
      }),
    );
    expect(delegated.decision).toBe("ALLOW");

    // An explicit relationship grant also delegates agent authority.
    const viaRelationship = authorize(
      req("school", "update", OBJECT_A, [rel("owns", OBJECT_A)]),
      opts({ role: "read_only", isAgent: true }),
    );
    expect(viaRelationship.decision).toBe("ALLOW");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 9. Property / fuzz tests (deny-by-default invariant, deterministic seed)
 * ────────────────────────────────────────────────────────────*/

describe("Property tests: no ALLOW outside explicitly-allowed classes (seeded fuzz)", () => {
  /** Deterministic PRNG (mulberry32) — identical stream on every run/CI node. */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const ROLES: readonly string[] = [
    ...COREGRID_ROLES,
    // Registered domain roles are fuzzed too: they must behave exactly like
    // core roles under the deny-by-default oracle.
    ...registeredDomainRoles(),
    unsafe<CoreGridRole>("root"),
    unsafe<CoreGridRole>(""),
    unsafe<CoreGridRole>("teacher "),
  ];
  const RESOURCES: readonly (PermissionResource | string)[] = [
    "school",
    "student",
    "payments",
    "settings",
    "audit_log",
    "ai_agent",
    unsafe<PermissionResource>("not_a_resource"),
    unsafe<PermissionResource>(""),
  ];
  const ACTIONS: readonly (PermissionAction | string)[] = [
    "read",
    "update",
    "manage",
    "delete",
    "execute",
    unsafe<PermissionAction>("purge"),
    unsafe<PermissionAction>(""),
  ];
  const SCOPES: readonly (string | null)[] = [
    null,
    OBJECT_A,
    OBJECT_B,
    "",
    "tenant-1:object-1:deep",
  ];
  const LIFECYCLES: readonly IdentityLifecycleState[] = [...IDENTITY_LIFECYCLE_STATES];
  const RISK = [undefined, 0, 0.5, 0.8, 0.9] as const;
  const DEVICE_TRUST = [undefined, 0.1, 0.3, 0.9] as const;

  function pick<T>(rand: () => number, items: readonly T[]): T {
    return items[Math.floor(rand() * items.length)];
  }

  it("fuzz invariant: every ALLOW is justified by an explicitly-allowed class (5000 cases, seed 80)", () => {
    const rand = mulberry32(80);
    let allowCount = 0;
    let denyCount = 0;

    for (let i = 0; i < 5000; i++) {
      const lifecycle = pick(rand, LIFECYCLES);
      const role = pick(rand, ROLES);
      const resource = pick(rand, RESOURCES);
      const action = pick(rand, ACTIONS);
      const scope = pick(rand, SCOPES);
      const risk = pick(rand, RISK);
      const deviceTrust = pick(rand, DEVICE_TRUST);

      const relationships: IdentityRelationship[] = [];
      if (rand() < 0.4) {
        const type = pick(rand, ["owns", "manages", "parent_of", "member_of"] as const);
        const target = pick(rand, [OBJECT_A, OBJECT_B] as const);
        const state = pick(rand, ["active", "revoked", "expired"] as const);
        relationships.push(
          rel(
            type,
            target,
            state === "revoked"
              ? { revokedAt: NOW }
              : state === "expired"
                ? { expiresAt: "2020-01-01T00:00:00.000Z" }
                : {},
          ),
        );
      }

      const usePolicy = rand() < 0.3;
      const policySet: PolicySet | undefined = usePolicy
        ? {
            rules: [
              {
                id: `fuzz-rule-${i}`,
                applies: (r) => r.permission.resource === resource,
                decision: pick(rand, [
                  "ALLOW",
                  "DENY",
                  "REDACT",
                  "ESCALATE",
                  "REQUIRE_APPROVAL",
                ] as const),
                reason: "fuzz policy",
              },
            ],
          }
        : undefined;

      const useExtra = rand() < 0.3;
      const options = opts({
        role,
        ...(useExtra
          ? {
              extraPermissions: [
                permission(
                  domainPermissionResource("fees"),
                  "manage",
                  pick(rand, [OBJECT_A, OBJECT_B, null] as const),
                ),
              ],
            }
          : {}),
        ...(policySet ? { policySet } : {}),
        ...(risk !== undefined || deviceTrust !== undefined ? { abac: { risk, deviceTrust } } : {}),
      });

      const tenantId = pick(rand, [TENANT_A, TENANT_B] as const);

      const request = req(resource, action, scope, relationships, {
        identity: identity({ lifecycle, tenantId }),
      });

      const result = authorize(request, options);

      // Universal postconditions, every case:
      expect(DECISIONS, `case ${i}: decision must be one of the five values`).toContain(
        result.decision,
      );
      expect(result.reason.length, `case ${i}: reason must be non-empty`).toBeGreaterThan(0);

      // New invariant under fuzz: an expired relationship or a cross-tenant
      // scope can never yield ALLOW (both modeled by the oracle below).
      if (result.decision === "ALLOW") {
        allowCount++;
        // The deny-by-default invariant: an ALLOW may only occur when the
        // independent oracle finds an explicitly-allowed class.
        expect(
          oracleAllows(request, options),
          `case ${i}: unexpected ALLOW outside explicitly-allowed classes ` +
            `(lifecycle=${lifecycle} role=${role} ${resource}:${action}@${String(scope)})`,
        ).toBe(true);
      } else {
        denyCount++;
        expect(
          ["DENY", "REDACT", "ESCALATE", "REQUIRE_APPROVAL"],
          `case ${i}: non-ALLOW decision outside the four deny-class values`,
        ).toContain(result.decision);
      }
    }

    // Sanity: the fuzzer must have exercised both branches meaningfully.
    expect(allowCount).toBeGreaterThan(60);
    expect(denyCount).toBeGreaterThan(1000);
  });

  it("fuzz invariant: no decision value outside the five-valued model across lifecycle × policy × risk", () => {
    const rand = mulberry32(8000);
    for (let i = 0; i < 500; i++) {
      const policySet: PolicySet = {
        rules: [
          {
            id: `p${i}`,
            applies: () => rand() < 0.5,
            decision: pick(
              rand,
              DECISIONS.filter((d) => d !== "ALLOW"),
            ),
            reason: "non-allow policy",
          },
        ],
      };
      const result = authorize(
        req("student", "read", OBJECT_A, [rel("owns", OBJECT_A)]),
        opts({
          role: "teacher",
          policySet,
          abac: { risk: pick(rand, [0, 0.9] as const) },
        }),
      );
      expect(DECISIONS).toContain(result.decision);
      if (result.decision === "ALLOW") {
        expect(oracleAllows).toBeDefined();
        const oracleOptions = opts({ role: "teacher", abac: { risk: 0 } });
        expect(
          oracleAllows(req("student", "read", OBJECT_A, [rel("owns", OBJECT_A)]), oracleOptions),
        ).toBe(true);
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 10. redact() helper (REDACT-decision enforcement surface)
 * ────────────────────────────────────────────────────────────*/

describe("redact(): field-level REDACT enforcement", () => {
  it("returns only the allowed fields", () => {
    const record = {
      id: "1",
      name: "Test",
      email: "t@example.com",
      guardianPhone: "0800-000-0000",
    };
    const out = redact(record, ["id", "name"]);
    expect(out).toEqual({ id: "1", name: "Test" });
    expect("guardianPhone" in out).toBe(false);
    expect("email" in out).toBe(false);
  });

  it("skips allowed-field names absent from the record", () => {
    const out = redact({ id: "1" }, ["id", "ghostField"]);
    expect(out).toEqual({ id: "1" });
  });

  it("an empty allow-list redacts everything", () => {
    const out = redact({ a: 1, b: 2 }, []);
    expect(out).toEqual({});
  });

  it("an allow-list including every field is a no-op passthrough of owned fields", () => {
    const record = { a: 1, b: 2 };
    expect(redact(record, ["a", "b"])).toEqual({ a: 1, b: 2 });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 11. Engine composition: the full formula in one pipeline
 * ────────────────────────────────────────────────────────────*/

describe("Combined decision formula: Identity+Tenant+Role+Relationship+Resource+Action+Policy+Context+Risk", () => {
  it("end-to-end ALLOW: usable identity + role grant + benign context", () => {
    const result = authorize(
      req("student", "read", OBJECT_A, [], { identity: identity({ tenantId: TENANT_A }) }),
      opts({ role: "teacher", abac: { risk: 0.2, deviceTrust: 0.9 } }),
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("end-to-end REQUIRE_APPROVAL: usable identity + policy gate ahead of role grant", () => {
    const policySet: PolicySet = {
      rules: [
        {
          id: "grades-update-gate",
          applies: (r) => r.permission.resource === "grades" && r.permission.action === "update",
          decision: "REQUIRE_APPROVAL",
          reason: "Grade changes need a second approver",
        },
      ],
    };
    const result = authorize(
      req("grades", "update", OBJECT_A),
      opts({ role: "teacher", policySet, abac: { risk: 0.2 } }),
    );
    expect(result.decision).toBe("REQUIRE_APPROVAL");
  });

  it("end-to-end REDACT ahead of ESCALATE: PBAC precedes ABAC", () => {
    const policySet: PolicySet = {
      rules: [
        {
          id: "redact-first",
          applies: () => true,
          decision: "REDACT",
          reason: "redaction policy",
        },
      ],
    };
    const result = authorize(
      req("student", "read", OBJECT_A),
      opts({ role: "teacher", policySet, abac: { risk: 0.95 } }),
    );
    expect(result.decision).toBe("REDACT");
  });

  it("end-to-end DENY: usable identity, no grant, no relationship, no policy", () => {
    const result = authorize(
      req("payments", "manage", OBJECT_B),
      opts({ role: "student", abac: { risk: 0.2, deviceTrust: 0.9 } }),
    );
    expect(result.decision).toBe("DENY");
  });

  it("end-to-end ESCALATE from context alone with an otherwise-clean grant", () => {
    const result = authorize(
      req("audit_log", "read", OBJECT_A),
      opts({ role: "auditor", abac: { risk: 0.99 } }),
    );
    expect(result.decision).toBe("ESCALATE");
  });
});
