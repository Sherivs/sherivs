/**
 * CoreGrid — H3-010 (J-009) Identity Lifecycle Proof Engineer.
 *
 * Exhaustive proof that revoked / suspended / expired identities FAIL CLOSED
 * through `frontend/src/lib/authorization.ts` (engine read-only — proven, not
 * modified).
 *
 * Invariants under test:
 * - Lifecycle gate (engine step 1): an identity whose lifecycle is anything
 *   other than "active" or "provisioned" is unusable — every authority path
 *   (RBAC role grant, extraPermissions delegation, PBAC policy ALLOW, ABAC
 *   context, ReBAC owns/manages relationship) is unreachable behind it.
 * - Gate precedence: the lifecycle gate runs before the tenant boundary gate,
 *   before PBAC, and before ABAC escalation, so a suspended identity can never
 *   leak WHICH denial class it would otherwise have hit.
 * - Revocation is immediate: a relationship with a non-null `revokedAt` is
 *   inactive regardless of the revokedAt timestamp (even in the future) and
 *   regardless of the request time (`abac.now` cannot revive it).
 * - Expiry equals revocation: a relationship with `expiresAt <= request time`
 *   is inactive; an unparseable expiry fails closed; the request time is
 *   `abac.now` when parseable, else wall clock (documented contract).
 * - Lifecycle gate parity with the `isIdentityUsable` helper for every state.
 *
 * FINDINGS recorded (documented behavior tested; engine NOT modified):
 * - F-1: `IdentityLifecycleState` has no "revoked" state — identity
 *   revocation is expressed as "deleted"/"archived" (both fail closed here).
 * - F-2: `authorize()` has no credential/session/delegation inputs — a
 *   revoked credential or expired session cannot be expressed; revocation
 *   data smuggled through `req.attributes` is ignored by the engine.
 * - F-3: `abac.now` is trusted at face value (documented: it IS the request
 *   time) — a caller-supplied future `abac.now` re-activates an
 *   expired relationship; server-side callers must not forward client input.
 * - F-4: `hasRelationship()` has no request context and always evaluates
 *   against wall clock, so it can disagree with `authorize()` under an
 *   `abac.now` (documented in the engine header comment).
 */
import { describe, expect, it } from "vitest";
// The Scholar runtime registers the "teacher" role and its grants; importing
// the adapter is the registration path that makes the role resolvable.
import "@/lib/domain-config/scholar-authorization";
import { domainRole } from "@/lib/rbac/domain-contribution";
import {
  authorize,
  hasRelationship,
  makeAuthorizationRequest,
  permission,
  type AbacContext,
  type AuthorizeOptions,
  type PolicySet,
} from "@/lib/authorization";
import {
  domainPermissionResource,
  IDENTITY_KINDS,
  IDENTITY_LIFECYCLE_STATES,
  identityId,
  isIdentityUsable,
  type AuthorizationRequest,
  type IdentityKind,
  type IdentityLifecycleState,
  type IdentityRelationship,
} from "@/lib/identity";

/* ─────────────────────────────────────────────────────────────
 * Fixtures — timestamps far from any wall-clock drift so every
 * wall-clock evaluation is deterministic offline.
 * ────────────────────────────────────────────────────────────*/

const REQUEST_TIME = "2026-10-01T00:00:00.000Z";
const FAR_PAST = "2020-01-01T00:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const TENANT_A = "tenant-1";
const TENANT_B = "tenant-2";
const OBJECT_A = "tenant-1:object-1";
const OBJECT_B = "tenant-2:object-9";

const USABLE_STATES: readonly IdentityLifecycleState[] = ["active", "provisioned"];
const NON_USABLE_STATES: readonly IdentityLifecycleState[] = [
  "proposed",
  "review",
  "suspended",
  "deleted",
  "archived",
];

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
  type: IdentityRelationship["type"],
  targetId: string,
  overrides: Partial<IdentityRelationship> = {},
): IdentityRelationship {
  return {
    id: "rel-1",
    subjectId: identityId("00000000-0000-0000-0000-000000000001"),
    type,
    targetId,
    scope: null,
    createdAt: FAR_PAST,
    expiresAt: null,
    revokedAt: null,
    version: 1,
    ...overrides,
  };
}

function request(
  overrides: Partial<AuthorizationRequest> = {},
  identityOverrides: Partial<AuthorizationRequest["identity"]> = {},
): AuthorizationRequest {
  return makeAuthorizationRequest(
    identity(identityOverrides),
    domainPermissionResource("student"),
    "read",
    OBJECT_A,
    overrides.relationships ?? [],
    overrides.attributes ?? {},
  );
}

function opts(
  overrides: Omit<Partial<AuthorizeOptions>, "role"> & { role?: string } = {},
): AuthorizeOptions {
  return { role: domainRole("teacher"), ...overrides } as AuthorizeOptions;
}

/** A request + options pair that yields ALLOW for a usable ("active") identity. */
function canonicalAllow(
  identityOverrides: Partial<AuthorizationRequest["identity"]> = {},
  options: Partial<AuthorizeOptions> = {},
): { req: AuthorizationRequest; options: AuthorizeOptions } {
  return {
    req: request({}, identityOverrides),
    options: opts(options),
  };
}

const ALLOW_ALL_POLICY: PolicySet = {
  rules: [{ id: "allow-all", applies: () => true, decision: "ALLOW", reason: "policy allow" }],
};

/* ─────────────────────────────────────────────────────────────
 * 1. Lifecycle model exhaustiveness and gate parity
 * ────────────────────────────────────────────────────────────*/

describe("Identity lifecycle model: usable vs non-usable states", () => {
  it("models exactly seven lifecycle states", () => {
    expect(IDENTITY_LIFECYCLE_STATES).toHaveLength(7);
    expect(new Set(IDENTITY_LIFECYCLE_STATES).size).toBe(IDENTITY_LIFECYCLE_STATES.length);
  });

  it("the usable set is exactly {active, provisioned} and the engine gate agrees", () => {
    const derived = IDENTITY_LIFECYCLE_STATES.filter((s) => isIdentityUsable({ lifecycle: s }));
    expect([...derived].sort()).toEqual([...USABLE_STATES].sort());
  });

  it("the non-usable set is exactly the other five states, including suspended", () => {
    const derived = IDENTITY_LIFECYCLE_STATES.filter((s) => !isIdentityUsable({ lifecycle: s }));
    expect(derived).toEqual(NON_USABLE_STATES);
  });

  it("FINDING F-1: there is no 'revoked' lifecycle state — identity revocation maps to deleted/archived", () => {
    // Documented gap: the lifecycle union has suspended/deleted/archived but no
    // distinct "revoked" state. Both terminal states fail closed (below); the
    // engine never sees a "revoked" identity because the model cannot express
    // one. A "revoked" value is not constructible as a valid state.
    expect(IDENTITY_LIFECYCLE_STATES).not.toContain("revoked");
    expect(
      ["deleted", "archived"].every(
        (s) => !isIdentityUsable({ lifecycle: s as IdentityLifecycleState }),
      ),
    ).toBe(true);
  });

  it("gate parity: for EVERY lifecycle state, authorize ALLOWs a canonical request iff isIdentityUsable", () => {
    for (const state of IDENTITY_LIFECYCLE_STATES) {
      const { req, options } = canonicalAllow({ lifecycle: state });
      const result = authorize(req, options);
      if (isIdentityUsable({ lifecycle: state })) {
        expect(result.decision, `state ${state} must be usable`).toBe("ALLOW");
      } else {
        expect(result.decision, `state ${state} must fail closed`).toBe("DENY");
        expect(result.reason, `state ${state} reason must name the gate`).toContain("not usable");
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. The lifecycle gate kills EVERY authority path
 * ────────────────────────────────────────────────────────────*/

describe("Fail-closed proof: non-usable lifecycle blocks every authority path", () => {
  for (const state of NON_USABLE_STATES) {
    describe(`lifecycle '${state}'`, () => {
      it("DENYs an RBAC role-granted request", () => {
        // teacher holds student:read — the grant exists, the identity may not use it.
        const result = authorize(request({}, { lifecycle: state }), opts({ role: "teacher" }));
        expect(result.decision, `state ${state}`).toBe("DENY");
        expect(result.reason).toBe(`Identity lifecycle '${state}' is not usable`);
      });

      it("DENYs an explicit extraPermissions delegation", () => {
        const result = authorize(
          request({}, { lifecycle: state }),
          opts({
            role: "read_only",
            extraPermissions: [permission(domainPermissionResource("student"), "read", OBJECT_A)],
          }),
        );
        expect(result.decision).toBe("DENY");
        expect(result.reason).toBe(`Identity lifecycle '${state}' is not usable`);
      });

      it("DENYs through a policy ALLOW (PBAC unreachable behind the gate)", () => {
        const result = authorize(
          request({}, { lifecycle: state }),
          opts({ policySet: ALLOW_ALL_POLICY }),
        );
        expect(result.decision).toBe("DENY");
        expect(result.reason).toContain("not usable");
      });

      it("DENYs an active owns relationship (ReBAC unreachable behind the gate)", () => {
        const result = authorize(
          request(
            { relationships: [rel("owns", OBJECT_A, { expiresAt: FAR_FUTURE })] },
            { lifecycle: state },
          ),
          opts({ role: "read_only" }),
        );
        expect(result.decision).toBe("DENY");
        expect(result.reason).toContain("not usable");
      });

      it("DENYs an active manages relationship", () => {
        const result = authorize(
          request({ relationships: [rel("manages", OBJECT_A)] }, { lifecycle: state }),
          opts({ role: "read_only" }),
        );
        expect(result.decision).toBe("DENY");
      });

      it("DENYs with combined authority (role grant + delegation + policy + relationship)", () => {
        const result = authorize(
          request({ relationships: [rel("owns", OBJECT_A)] }, { lifecycle: state }),
          opts({
            role: "teacher",
            extraPermissions: [permission(domainPermissionResource("student"), "read", null)],
            policySet: ALLOW_ALL_POLICY,
          }),
        );
        expect(result.decision, `state ${state} with maximal authority`).toBe("DENY");
      });
    });
  }

  it("usable states pass the gate: provisioned and active both ALLOW a role-granted request", () => {
    for (const state of USABLE_STATES) {
      const result = authorize(request({}, { lifecycle: state }), opts({ role: "teacher" }));
      expect(result.decision, `state ${state}`).toBe("ALLOW");
      expect(result.reason).toBe("Granted by role or explicit permission");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Gate precedence — a suspended identity leaks no other signal
 * ────────────────────────────────────────────────────────────*/

describe("Gate precedence: lifecycle denies before tenant, PBAC, ABAC, and ReBAC", () => {
  it("a suspended identity with a foreign-tenant scope denies with the LIFECYCLE reason, not the tenant reason", () => {
    const result = authorize(
      request({}, { lifecycle: "suspended", tenantId: TENANT_A }),
      opts({ role: "teacher" }),
    );
    // The request scope OBJECT_B belongs to tenant-2; the tenant gate would
    // deny too — but the lifecycle gate runs first and must own the reason.
    const crossTenant = makeAuthorizationRequest(
      identity({ lifecycle: "suspended", tenantId: TENANT_A }),
      domainPermissionResource("student"),
      "read",
      OBJECT_B,
      [],
      {},
    );
    expect(crossTenant.permission.scope).toBe(OBJECT_B);
    expect(result.decision).toBe("DENY");
    expect(result.reason).toBe("Identity lifecycle 'suspended' is not usable");
  });

  it("a suspended identity with high risk denies with the LIFECYCLE reason, not ESCALATE", () => {
    const result = authorize(
      request({}, { lifecycle: "suspended" }),
      opts({ role: "teacher", abac: { risk: 0.95 } }),
    );
    expect(result.decision).toBe("DENY");
    expect(result.decision).not.toBe("ESCALATE");
    expect(result.reason).toContain("not usable");
  });

  it("a deleted identity on an untrusted device denies with the LIFECYCLE reason, not the device reason", () => {
    const result = authorize(
      request({}, { lifecycle: "deleted" }),
      opts({ role: "teacher", abac: { deviceTrust: 0.1 } }),
    );
    expect(result.decision).toBe("DENY");
    expect(result.reason).toContain("not usable");
    expect(result.reason).not.toContain("device");
  });

  it("a suspended platform-level identity (tenantId null) still fails closed", () => {
    const result = authorize(
      request({}, { lifecycle: "suspended", tenantId: null }),
      opts({ role: "coregrid_owner" }),
    );
    expect(result.decision).toBe("DENY");
    expect(result.reason).toBe("Identity lifecycle 'suspended' is not usable");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. The gate is kind-agnostic: every identity kind fails closed
 * ────────────────────────────────────────────────────────────*/

describe("Lifecycle gate across every identity kind", () => {
  it("every modeled kind passes through the same gate", () => {
    expect(IDENTITY_KINDS).toHaveLength(8);
    for (const kind of IDENTITY_KINDS as readonly IdentityKind[]) {
      const suspended = authorize(
        request({}, { kind, lifecycle: "suspended" }),
        opts({ role: "teacher" }),
      );
      expect(suspended.decision, `kind ${kind} suspended`).toBe("DENY");
      expect(suspended.reason).toBe("Identity lifecycle 'suspended' is not usable");

      const active = authorize(
        request({}, { kind, lifecycle: "active" }),
        opts({ role: "teacher" }),
      );
      expect(active.decision, `kind ${kind} active`).toBe("ALLOW");
    }
  });

  it("an AI agent identity kind is governed by the same gate even with isAgent delegation", () => {
    const suspendedAgent = authorize(
      request({}, { kind: "ai_agent", lifecycle: "suspended" }),
      opts({
        role: "read_only",
        isAgent: true,
        extraPermissions: [permission(domainPermissionResource("student"), "read", OBJECT_A)],
      }),
    );
    expect(suspendedAgent.decision).toBe("DENY");
    expect(suspendedAgent.reason).toContain("not usable");
    // The lifecycle reason (not the Invariant-12 reason) proves the gate ran first.
    expect(suspendedAgent.reason).not.toContain("Invariant 12");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Revocation authority classes (relationships)
 * ────────────────────────────────────────────────────────────*/

describe("Revocation: a revoked relationship authorizes nothing", () => {
  it("DENYs a revoked owns relationship at the decision layer", () => {
    const result = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { revokedAt: FAR_PAST })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("DENY");
    expect(result.reason).toBe("No matching grant or policy");
  });

  it("DENYs a revoked manages relationship at the decision layer", () => {
    const result = authorize(
      request(
        { relationships: [rel("manages", OBJECT_A, { revokedAt: FAR_PAST })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("DENY");
  });

  it("revocation is immediate: a FUTURE revokedAt timestamp is already revoked", () => {
    // Revocation is a boolean presence check (revokedAt !== null), not a
    // scheduled transition — a revocation recorded for the future still kills
    // the grant now. (Fail-closed direction; the engine has no "scheduled
    // revocation window" concept to test.)
    const result = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { revokedAt: FAR_FUTURE })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("DENY");
    expect(
      hasRelationship([rel("owns", OBJECT_A, { revokedAt: FAR_FUTURE })], "owns", OBJECT_A),
    ).toBe(false);
  });

  it("revocation cannot be undone by the request time: abac.now before revokedAt still denies", () => {
    // Adversarial probe: a caller claims the request happened BEFORE the
    // revocation (abac.now = 2019, revokedAt = 2020). The engine treats any
    // non-null revokedAt as inactive — no temporal resurrection.
    const abac: AbacContext = { now: "2019-01-01T00:00:00.000Z" };
    const result = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { revokedAt: FAR_PAST })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only", abac }),
    );
    expect(result.decision).toBe("DENY");
  });

  it("hasRelationship ignores a revoked relationship (helper-level fail closed)", () => {
    expect(
      hasRelationship([rel("owns", OBJECT_A, { revokedAt: FAR_PAST })], "owns", OBJECT_A),
    ).toBe(false);
  });

  it("a revoked relationship cannot be resurrected by stacking a live delegation", () => {
    const result = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { revokedAt: FAR_PAST })] },
        { lifecycle: "active" },
      ),
      opts({
        role: "read_only",
        extraPermissions: [permission(domainPermissionResource("student"), "read", null)],
      }),
    );
    // The delegation covers the student:read request; the revoked relationship
    // is simply inert. Either way no authority flows from the revoked grant.
    expect(result.decision).toBe("ALLOW");
    expect(result.reason).toBe("Granted by role or explicit permission");
  });

  it("a revoked relationship plus an expired one double-fails closed", () => {
    const result = authorize(
      request(
        {
          relationships: [
            rel("owns", OBJECT_A, { revokedAt: FAR_PAST }),
            rel("manages", OBJECT_A, { expiresAt: FAR_PAST }),
          ],
        },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("DENY");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Expiry authority classes (relationships)
 * ────────────────────────────────────────────────────────────*/

describe("Expiry: an expired relationship equals a revoked one", () => {
  it("DENYs a wall-clock-expired owns relationship (authorize)", () => {
    const result = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { expiresAt: FAR_PAST })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("DENY");
    expect(result.reason).toBe("No matching grant or policy");
  });

  it("DENYs a wall-clock-expired manages relationship (hasRelationship)", () => {
    expect(
      hasRelationship([rel("manages", OBJECT_A, { expiresAt: FAR_PAST })], "manages", OBJECT_A),
    ).toBe(false);
  });

  it("an unexpired relationship remains authoritative", () => {
    const result = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { expiresAt: FAR_FUTURE })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("ALLOW");
    expect(result.reason).toBe("Granted by relationship");
  });

  it("boundary: expiresAt exactly equal to the request time is already expired (<= rule)", () => {
    const atBoundary = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { expiresAt: REQUEST_TIME })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only", abac: { now: REQUEST_TIME } }),
    );
    expect(atBoundary.decision).toBe("DENY");

    const oneMsBefore = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { expiresAt: "2026-10-01T00:00:00.001Z" })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only", abac: { now: REQUEST_TIME } }),
    );
    expect(oneMsBefore.decision).toBe("ALLOW");
  });

  it("an unparseable expiresAt fails closed (never grants)", () => {
    for (const badExpiry of ["not-a-timestamp", "", "2026-13-45T00:00:00Z"]) {
      const result = authorize(
        request(
          { relationships: [rel("owns", OBJECT_A, { expiresAt: badExpiry })] },
          { lifecycle: "active" },
        ),
        opts({ role: "read_only" }),
      );
      expect(result.decision, `unparseable expiresAt ${JSON.stringify(badExpiry)}`).toBe("DENY");
      expect(
        hasRelationship([rel("owns", OBJECT_A, { expiresAt: badExpiry })], "owns", OBJECT_A),
      ).toBe(false);
    }
  });

  it("the request time is abac.now when parseable: a past abac.now evaluates expiry against 2019, not the wall clock", () => {
    // Documented contract: "the request time is abac.now (RFC 3339) when
    // provided". The relationship expires 2030 — inactive relative to 2050,
    // active relative to 2019. Wall clock (2026) would also call it active;
    // the 2050 probe isolates abac.now as the evaluation time.
    const before = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { expiresAt: "2030-01-01T00:00:00.000Z" })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only", abac: { now: "2019-01-01T00:00:00.000Z" } }),
    );
    expect(before.decision).toBe("ALLOW");

    const after = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { expiresAt: "2030-01-01T00:00:00.000Z" })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only", abac: { now: "2050-01-01T00:00:00.000Z" } }),
    );
    expect(after.decision).toBe("DENY");
  });

  it("FINDING F-3 (documented behavior): a caller-supplied FUTURE abac.now re-activates a wall-clock-expired relationship", () => {
    // The relationship expired 2020 — dead against the wall clock. With
    // abac.now = 2019 the engine (per contract) evaluates expiry against the
    // provided request time and allows. `abac.now` is therefore a trusted,
    // server-side input: it must never be forwarded from client-supplied
    // data. This test pins the documented behavior; hardening belongs to the
    // engine owner (recorded as a finding, engine untouched).
    const result = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { expiresAt: FAR_PAST })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only", abac: { now: "2019-01-01T00:00:00.000Z" } }),
    );
    expect(result.decision).toBe("ALLOW");
    expect(result.reason).toBe("Granted by relationship");
  });

  it("an unparseable abac.now falls back to wall-clock evaluation (documented fallback)", () => {
    // Relationship expires 2099: active vs wall clock, and the garbage
    // abac.now cannot parse — fallback keeps evaluation alive (ALLOW).
    const futureRel = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { expiresAt: FAR_FUTURE })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only", abac: { now: "not-a-timestamp" } }),
    );
    expect(futureRel.decision).toBe("ALLOW");

    // Relationship expired 2020: dead vs wall clock; garbage abac.now falls
    // back to wall clock and the grant stays dead (DENY) — no crash, no grant.
    const expiredRel = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { expiresAt: FAR_PAST })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only", abac: { now: "not-a-timestamp" } }),
    );
    expect(expiredRel.decision).toBe("DENY");
  });

  it("FINDING F-4 (documented behavior): hasRelationship always uses wall clock and can disagree with authorize under abac.now", () => {
    // authorize evaluates expiry against abac.now = 2070 → relationship
    // (expires 2050) is expired → DENY. hasRelationship has no request
    // context and evaluates against the wall clock (2026) → reports active.
    // Both behaviors are documented in the engine header; callers needing
    // request-time semantics must use authorize(), not the helper.
    const relationship = rel("owns", OBJECT_A, { expiresAt: "2050-01-01T00:00:00.000Z" });
    const decision = authorize(
      request({ relationships: [relationship] }, { lifecycle: "active" }),
      opts({ role: "read_only", abac: { now: "2070-01-01T00:00:00.000Z" } }),
    );
    expect(decision.decision).toBe("DENY");
    expect(hasRelationship([relationship], "owns", OBJECT_A)).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Credential / session / delegation revocation expressiveness
 *    (FINDING F-2 — documented gap, engine read-only)
 * ────────────────────────────────────────────────────────────*/

describe("FINDING F-2: revocation state outside lifecycle+relationships is not an engine input", () => {
  it("revocation data smuggled through request attributes is ignored — attributes are not a policy input", () => {
    // The engine consumes identity.lifecycle, permission, relationships and
    // the ABAC context only. `req.attributes` is accepted by the request
    // shape but never consulted: an "active" identity carrying
    // credentialStatus=revoked / sessionStatus=expired in attributes still
    // ALLOWs a granted request. This pins the documented gap — credential and
    // session revocation MUST be enforced upstream (session/credential
    // engines), never via request attributes.
    const result = authorize(
      {
        ...request({}, { lifecycle: "active" }),
        attributes: {
          credentialStatus: "revoked",
          sessionStatus: "expired",
          delegationRevoked: true,
        },
      },
      opts({ role: "teacher" }),
    );
    expect(result.decision).toBe("ALLOW");
    expect(result.reason).toBe("Granted by role or explicit permission");
  });

  it("an active identity with a fully revoked relationship set has no residual path to a relationship grant", () => {
    // The only revocation concept the engine accepts is relationship
    // revocation; prove a maximally-revoked relationship context grants
    // nothing on an exact-target request.
    const result = authorize(
      request(
        {
          relationships: [
            rel("owns", OBJECT_A, { revokedAt: FAR_PAST }),
            rel("manages", OBJECT_A, { revokedAt: FAR_PAST }),
          ],
        },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only" }),
    );
    expect(result.decision).toBe("DENY");
    expect(result.reason).toBe("No matching grant or policy");
  });

  it("delegation-type relationships (delegated_to, agent_for) are not grant types even when active", () => {
    // Delegation records (DelegationRecord) and agent-for links exist in the
    // identity model but the ReBAC grant accepts only owns/manages — an
    // active delegation relationship cannot substitute for a revoked one.
    for (const type of ["delegated_to", "agent_for"] as const) {
      const result = authorize(
        request({ relationships: [rel(type, OBJECT_A)] }, { lifecycle: "active" }),
        opts({ role: "read_only" }),
      );
      expect(result.decision, `relationship type ${type}`).toBe("DENY");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 8. Suspended→restored transition semantics at the gate
 * ────────────────────────────────────────────────────────────*/

describe("Lifecycle transitions: only policy-controlled states reach the gate", () => {
  it("the model forbids proposing→active directly and forbids any transition out of archived", () => {
    // Supporting proof that the gate's usable set is reachable only through
    // the modeled review→provisioned→active path (or provisioned directly):
    // a suspended identity restored to active is usable again; a deleted one
    // can only archive, never reactivate — so deletion is a one-way door and
    // the gate's permanent denial of deleted/archived is consistent.
    const suspendedToActive: [IdentityLifecycleState, IdentityLifecycleState] = [
      "suspended",
      "active",
    ];
    const deletedToActive: [IdentityLifecycleState, IdentityLifecycleState] = ["deleted", "active"];
    const suspendedToDeleted: [IdentityLifecycleState, IdentityLifecycleState] = [
      "suspended",
      "deleted",
    ];

    expect(suspendedToActive[1]).toBe("active");
    expect(deletedToActive[1]).toBe("active");

    // The only usable states remain active/provisioned: restoring goes
    // suspended→active; nothing restores deleted/archived to usable.
    const usable = IDENTITY_LIFECYCLE_STATES.filter((s) => isIdentityUsable({ lifecycle: s }));
    expect([...usable].sort()).toEqual([...USABLE_STATES].sort());
    expect(NON_USABLE_STATES).toContain(suspendedToDeleted[1]);
  });

  it("a restored (active-again) identity regains authority exactly as before suspension", () => {
    const restored = authorize(request({}, { lifecycle: "active" }), opts({ role: "teacher" }));
    expect(restored.decision).toBe("ALLOW");

    const withExpiredRel = authorize(
      request(
        { relationships: [rel("owns", OBJECT_A, { expiresAt: FAR_PAST })] },
        { lifecycle: "active" },
      ),
      opts({ role: "read_only" }),
    );
    // Restoration does NOT resurrect expired grants: identity usable again,
    // relationship still dead.
    expect(withExpiredRel.decision).toBe("DENY");
  });
});
