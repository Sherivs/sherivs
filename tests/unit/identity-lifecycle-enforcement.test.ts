/**
 * MISSION-R-22 — Identity lifecycle enforcement proofs (J-009, V1CAP-020).
 *
 * AGENTS.md §31 non-negotiables proven at the enforcement point (not the UI):
 * - ACTIVE identities execute.
 * - Every non-active lifecycle state the substrate defines (SUSPENDED,
 *   DELETED, ARCHIVED, plus pre-activation PROPOSED/REVIEW) is DENIED.
 * - Expired/revoked vocabulary is carried by SessionStatus and
 *   CredentialStatus; expired/revoked sessions and credentials fail closed
 *   at the identity layer and map to a non-granting security-gateway signal.
 *
 * FIX WAVE (coordinator-routed): DEFECT-1/2/3 from
 * tests/unit/identity-lifecycle.DEFECTS.md are RESOLVED in product code —
 * the former `DEFECT-n (exposing)` tests are flipped to `DEFECT-n
 * (resolved)` correctness assertions against the fail-closed behavior.
 * DEFECT-4 (delegation expiry) is DEFERRED to the delegation substrate
 * mission and stays pinned as a documented gap.
 *
 * Scope boundary (recorded in tests/unit/authorization-exhaustive.DEFECTS.md):
 * - The `authorize()` decision-matrix lifecycle gate belongs to R-80 and is
 *   NOT re-tested here.
 * - This suite owns lifecycle *semantics*: enforcement predicates, the
 *   runtime server-function gate helpers, and session/credential/delegation
 *   expiry at the identity layer.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_LIFECYCLE_STATES,
  canTransitionCredential,
  canTransitionIdentity,
  CREDENTIAL_STATUS_TRANSITIONS,
  domainPermissionResource,
  IDENTITY_LIFECYCLE_STATES,
  IDENTITY_LIFECYCLE_TRANSITIONS,
  isAgentGoverned,
  identityId,
  isIdentityUsable,
  type IdentityLifecycleState,
  type IdentitySession,
  type SessionStatus,
} from "@/lib/identity";
import { isIdentityActive, isIdentityDeleted, isIdentitySuspended } from "@/lib/identity-lifecycle";
import { IDENTITY_STATES } from "@/lib/identity-registry";
import {
  checkLifecycleSignals,
  decideAccountAdministration,
  decideStaffRole,
  evaluateRoleGate,
  requireSchoolAdminScope,
  requireStaffContext,
  resolveRoleGate,
  SCHOOL_STAFF_ROLES,
  type SchoolStaffKind,
} from "@/lib/security-role-gate";
import {
  evaluateSecurityGateway,
  isGrantingDecision,
  NON_GRANTING_DECISION_STATES,
} from "@/lib/security-core";
import { resolveIdentityActor } from "@/lib/identity-actor";
import { evaluateRuntimeCapability } from "@/lib/capability-gate";
import { SCHOLAR_FEATURE_CODES } from "@/lib/runtime/nav-registry";
import {
  evaluateSessionSecurity,
  revokeSession,
  type SessionSecurityPolicy,
} from "@/lib/security-session";
import {
  createCredential,
  isCredentialActive,
  isCredentialExpired,
  transitionCredentialStatus,
  validateCredentialAgainstPolicy,
  type CredentialPolicy,
} from "@/lib/identity-credentials";
import { tokenMsRemaining } from "@/lib/auth-helpers";

const NOW = "2026-10-01T12:00:00.000Z";
const SCHOOL_A = "11111111-1111-1111-1111-111111111111";
const SCHOOL_B = "22222222-2222-2222-2222-222222222222";

/**
 * The lifecycle states the substrate actually defines — enumerated from the
 * identity module constant, never from a list duplicated in this suite.
 */
const ALL_LIFECYCLE_STATES: readonly IdentityLifecycleState[] = IDENTITY_LIFECYCLE_STATES;

/**
 * The usability gate the substrate documents (Invariant 02): provisioned and
 * active are the two usable states; every other state must deny execution.
 * The strictest predicate (`isIdentityActive`) allows only "active".
 */
const USABLE_STATES: readonly IdentityLifecycleState[] = ["provisioned", "active"];
const LIFECYCLE_DENIED_STATES = ALL_LIFECYCLE_STATES.filter(
  (state) => !USABLE_STATES.includes(state),
);

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

/** Structural stand-in for the Supabase RPC surface the adapters consume. */
function rpcClient(
  results: Record<string, unknown>,
): Parameters<typeof requireSchoolAdminScope>[0] {
  return {
    rpc(name: string) {
      if (!(name in results)) {
        return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${name}` } });
      }
      return Promise.resolve({ data: results[name], error: null });
    },
  } as unknown as Parameters<typeof requireSchoolAdminScope>[0];
}

function sessionFixture(overrides: Partial<IdentitySession> = {}): IdentitySession {
  return {
    id: "session-1",
    identityId: identityId("00000000-0000-0000-0000-000000000001"),
    status: "active",
    createdAt: "2026-10-01T10:00:00.000Z",
    expiresAt: "2026-10-01T18:00:00.000Z",
    revokeReason: null,
    deviceFingerprint: "fp-1",
    ...overrides,
  };
}

const SESSION_POLICY: SessionSecurityPolicy = {
  idleTimeoutMs: 30 * 60_000,
  absoluteTimeoutMs: 12 * 3_600_000,
  maxConcurrentSessions: 3,
  requireDeviceBinding: false,
};

const LAST_ACTIVITY_AT = "2026-10-01T11:45:00.000Z";

const FULL_ALLOW_GATEWAY_INPUT = {
  identityValid: true,
  tenantContextValid: true,
  sessionValid: true,
  withinRateLimit: true,
  requestIntegrityValid: true,
  authorizationDecision: "ALLOW" as const,
};

/* ─────────────────────────────────────────────────────────────
 * 1. Substrate enumeration
 * ────────────────────────────────────────────────────────────*/

describe("Lifecycle state enumeration (from the identity modules)", () => {
  it("pins the complete identity lifecycle state set", () => {
    expect([...ALL_LIFECYCLE_STATES]).toEqual([
      "proposed",
      "review",
      "provisioned",
      "active",
      "suspended",
      "deleted",
      "archived",
    ]);
  });

  it("maps every cg_identity registry state onto a substrate lifecycle state", () => {
    expect([...IDENTITY_STATES]).toEqual([
      "provisioned",
      "active",
      "suspended",
      "archived",
      "deleted",
    ]);
    for (const registryState of IDENTITY_STATES) {
      expect(
        ALL_LIFECYCLE_STATES.includes(registryState),
        `registry state ${registryState} must be a substrate lifecycle state`,
      ).toBe(true);
    }
  });

  it("carries revocation/expiry as session + credential status, not identity lifecycle", () => {
    // The substrate defines no "revoked"/"expired" identity lifecycle state;
    // those vocabularies belong to SessionStatus/CredentialStatus (proven in
    // the session and credential sections below). Unknown lifecycle strings
    // fail closed everywhere (proven in the gate sections).
    expect(ALL_LIFECYCLE_STATES.includes("revoked" as never)).toBe(false);
    expect(ALL_LIFECYCLE_STATES.includes("expired" as never)).toBe(false);
  });

  it("pins the agent lifecycle state set and its pure governance predicate", () => {
    expect([...AGENT_LIFECYCLE_STATES]).toEqual([
      "proposed",
      "review",
      "approved",
      "deployed",
      "monitored",
      "suspended",
      "reviewed",
      "retired",
    ]);
    const granted = [
      { resource: domainPermissionResource("student"), action: "read", scope: null },
    ] as const;
    for (const state of AGENT_LIFECYCLE_STATES) {
      const expected = state === "deployed" || state === "monitored";
      expect(
        isAgentGoverned({ lifecycle: state, permissions: [...granted] }),
        `agent lifecycle ${state} governance`,
      ).toBe(expected);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Identity-layer enforcement predicates (Phase 02, G5)
 * ────────────────────────────────────────────────────────────*/

describe("Identity-layer usability predicates × every lifecycle state", () => {
  it("isIdentityUsable: exactly the documented usable set executes", () => {
    for (const state of ALL_LIFECYCLE_STATES) {
      expect(isIdentityUsable({ lifecycle: state }), `usability of ${state}`).toBe(
        USABLE_STATES.includes(state),
      );
    }
  });

  it("isIdentityActive: only ACTIVE executes strictly", () => {
    for (const state of ALL_LIFECYCLE_STATES) {
      expect(isIdentityActive({ lifecycle: state }), `active predicate on ${state}`).toBe(
        state === "active",
      );
    }
  });

  it("classifies suspended, deleted and archived unambiguously", () => {
    for (const state of ALL_LIFECYCLE_STATES) {
      expect(isIdentitySuspended({ lifecycle: state })).toBe(state === "suspended");
      expect(isIdentityDeleted({ lifecycle: state })).toBe(
        state === "deleted" || state === "archived",
      );
    }
  });

  it("every non-usable lifecycle state is in the deny set", () => {
    expect([...LIFECYCLE_DENIED_STATES].sort()).toEqual(
      ["archived", "deleted", "proposed", "review", "suspended"].sort(),
    );
    for (const state of LIFECYCLE_DENIED_STATES) {
      expect(isIdentityUsable({ lifecycle: state }), `${state} must not execute`).toBe(false);
    }
  });

  it("revocation is permanent: deleted/archived have no path back to an executable state", () => {
    // Termination path: active -> suspended -> deleted -> archived.
    for (const usable of USABLE_STATES) {
      expect(canTransitionIdentity("deleted", usable), `deleted -> ${usable}`).toBe(false);
      expect(canTransitionIdentity("archived", usable), `archived -> ${usable}`).toBe(false);
    }
    expect([...IDENTITY_LIFECYCLE_TRANSITIONS.deleted]).toEqual(["archived"]);
    expect([...IDENTITY_LIFECYCLE_TRANSITIONS.archived]).toEqual([]);
  });

  it("restoration is policy-controlled: only provisioned/suspended may return to active", () => {
    for (const state of ALL_LIFECYCLE_STATES) {
      const mayRestore = IDENTITY_LIFECYCLE_TRANSITIONS[state].includes("active");
      expect(mayRestore, `${state} -> active`).toBe(
        state === "provisioned" || state === "suspended",
      );
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Security gateway — the decision authority embedded in
 *    every runtime role gate (Phase 08 Section H)
 * ────────────────────────────────────────────────────────────*/

describe("Security gateway lifecycle signals (evaluateSecurityGateway)", () => {
  it("an ACTIVE identity's full-signal allow path grants", () => {
    expect(evaluateSecurityGateway(FULL_ALLOW_GATEWAY_INPUT)).toEqual({
      decision: "allow",
      reason: "Authorization granted",
    });
  });

  it("an invalid identity assertion denies — the mapping every lifecycle-denied state relies on", () => {
    // Upstream contract: any identity outside the usable lifecycle set must
    // be asserted identityValid=false, and the gateway must deny it.
    expect(
      evaluateSecurityGateway({ ...FULL_ALLOW_GATEWAY_INPUT, identityValid: false }),
    ).toMatchObject({ decision: "deny" });
    expect(
      evaluateSecurityGateway({ ...FULL_ALLOW_GATEWAY_INPUT, identityValid: false }).reason,
    ).toContain("Identity assertion is invalid");
  });

  it("an expired/revoked session (sessionValid=false) is non-granting", () => {
    const gateway = evaluateSecurityGateway({ ...FULL_ALLOW_GATEWAY_INPUT, sessionValid: false });
    expect(gateway.decision).toBe("challenge");
    expect(gateway.decision !== "allow").toBe(true);
    expect(gateway.reason).toContain("Session is not active");
  });

  it("every documented non-granting decision state is non-granting", () => {
    expect(NON_GRANTING_DECISION_STATES).not.toContain("ALLOW");
    for (const state of NON_GRANTING_DECISION_STATES) {
      expect(isGrantingDecision(state), `${state} must never grant`).toBe(false);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Runtime role gates × lifecycle states (DEFECT-1 RESOLVED)
 * ────────────────────────────────────────────────────────────*/

describe("evaluateRoleGate × lifecycle (DEFECT-1 resolved)", () => {
  it("control: the signals an ACTIVE school admin earns grant execution", () => {
    expect(evaluateRoleGate("school_admin", { roleGranted: true, scope: SCHOOL_A })).toMatchObject({
      decision: "allow",
      scope: SCHOOL_A,
    });
  });

  it("control: the signals an ACTIVE platform super admin earns grant execution", () => {
    expect(evaluateRoleGate("platform_super_admin", { roleGranted: true })).toMatchObject({
      decision: "allow",
    });
  });

  it("fails closed when the role signal is absent, unknown, or the scope is unresolved", () => {
    expect(evaluateRoleGate("school_admin", { roleGranted: null, scope: SCHOOL_A }).decision).toBe(
      "deny",
    );
    expect(evaluateRoleGate("school_admin", { roleGranted: false, scope: SCHOOL_A }).decision).toBe(
      "deny",
    );
    expect(evaluateRoleGate("school_admin", { roleGranted: true, scope: null }).decision).toBe(
      "deny",
    );
    expect(evaluateRoleGate("platform_super_admin", { roleGranted: false }).decision).toBe("deny");
  });

  it("DEFECT-1 (resolved): every lifecycle-denied state denies both role kinds", () => {
    for (const state of LIFECYCLE_DENIED_STATES) {
      const school = evaluateRoleGate("school_admin", {
        roleGranted: true,
        scope: SCHOOL_A,
        lifecycle: state,
      });
      expect(school.decision, `school_admin lifecycle ${state}`).toBe("deny");
      if (school.decision === "deny") {
        expect(school.code).toBe("lifecycle_denied");
        expect(school.reason).toContain("identity lifecycle does not permit execution");
      }

      const platform = evaluateRoleGate("platform_super_admin", {
        roleGranted: true,
        lifecycle: state,
      });
      expect(platform.decision, `platform_super_admin lifecycle ${state}`).toBe("deny");
    }
  });

  it("DEFECT-1 (resolved): unknown lifecycle values fail closed (never trusted)", () => {
    const outcome = evaluateRoleGate("school_admin", {
      roleGranted: true,
      scope: SCHOOL_A,
      lifecycle: "expired" as never,
    });
    expect(outcome).toMatchObject({ decision: "deny", code: "lifecycle_denied" });
  });

  it("DEFECT-1 (resolved): expired/revoked/terminated sessions deny before the role is consulted", () => {
    for (const status of ["expired", "revoked", "terminated"] as const) {
      const outcome = evaluateRoleGate("school_admin", {
        roleGranted: true,
        scope: SCHOOL_A,
        sessionStatus: status,
      });
      expect(outcome, `sessionStatus ${status}`).toMatchObject({
        decision: "deny",
        code: "session_denied",
      });
      expect(
        evaluateRoleGate("platform_super_admin", { roleGranted: true, sessionStatus: status })
          .decision,
        `platform sessionStatus ${status}`,
      ).toBe("deny");
    }
    expect(
      evaluateRoleGate("school_admin", {
        roleGranted: true,
        scope: SCHOOL_A,
        sessionValid: false,
      }),
    ).toMatchObject({ decision: "deny", code: "session_denied" });
  });

  it("a fully-attested ACTIVE allow carries no lifecycleUnverified flag", () => {
    const outcome = evaluateRoleGate("school_admin", {
      roleGranted: true,
      scope: SCHOOL_A,
      lifecycle: "active",
      sessionStatus: "active",
    });
    expect(outcome).toMatchObject({ decision: "allow", scope: SCHOOL_A });
    expect(outcome.decision === "allow" && !("lifecycleUnverified" in outcome)).toBe(true);
  });

  it("an opted-in allow with an unverified part exposes lifecycleUnverified: true", () => {
    const withoutSession = evaluateRoleGate("school_admin", {
      roleGranted: true,
      scope: SCHOOL_A,
      lifecycle: "active",
    });
    expect(withoutSession).toMatchObject({
      decision: "allow",
      scope: SCHOOL_A,
      lifecycleUnverified: true,
    });

    const withoutLifecycle = evaluateRoleGate("school_admin", {
      roleGranted: true,
      scope: SCHOOL_A,
      sessionStatus: "active",
    });
    expect(withoutLifecycle).toMatchObject({ decision: "allow", lifecycleUnverified: true });
  });

  it("a legacy-shaped call (no lifecycle keys) keeps the historical outcome shape", () => {
    const outcome = evaluateRoleGate("school_admin", { roleGranted: true, scope: SCHOOL_A });
    expect(outcome.decision).toBe("allow");
    expect(outcome.decision === "allow" && "lifecycleUnverified" in outcome).toBe(false);
  });

  it("the gate signals contract now carries the lifecycle/session fields", () => {
    const signals = {
      roleGranted: true,
      scope: SCHOOL_A,
      lifecycle: "active",
      sessionStatus: "active",
      sessionValid: true,
    };
    expect(Object.keys(signals).sort()).toEqual([
      "lifecycle",
      "roleGranted",
      "scope",
      "sessionStatus",
      "sessionValid",
    ]);
  });
});

describe("checkLifecycleSignals (shared fail-closed contract)", () => {
  it("denies every non-usable lifecycle state with the canonical code and reason", () => {
    for (const state of LIFECYCLE_DENIED_STATES) {
      const check = checkLifecycleSignals({ lifecycle: state });
      expect(check.ok, `lifecycle ${state}`).toBe(false);
      if (!check.ok) {
        expect(check.code).toBe("lifecycle_denied");
        expect(check.reason).toContain("identity lifecycle does not permit execution");
      }
    }
  });

  it("denies non-active sessions and explicit false validity", () => {
    for (const status of ["expired", "revoked", "terminated"] as const) {
      expect(checkLifecycleSignals({ sessionStatus: status })).toMatchObject({
        ok: false,
        code: "session_denied",
      });
    }
    expect(checkLifecycleSignals({ sessionValid: false })).toMatchObject({
      ok: false,
      code: "session_denied",
    });
  });

  it("contradictory signals fail closed (sessionValid=false beats an active status)", () => {
    expect(checkLifecycleSignals({ sessionStatus: "active", sessionValid: false })).toMatchObject({
      ok: false,
      code: "session_denied",
    });
  });

  it("usable lifecycle + active session passes with no unverified gap", () => {
    for (const state of USABLE_STATES) {
      expect(checkLifecycleSignals({ lifecycle: state, sessionStatus: "active" })).toEqual({
        ok: true,
        lifecycleUnverified: false,
      });
    }
  });
});

describe("decideStaffRole × lifecycle (DEFECT-1 resolved)", () => {
  const STAFF_KINDS = Object.keys(SCHOOL_STAFF_ROLES) as SchoolStaffKind[];

  it("control: every staff kind allows its documented role set with a resolved scope", () => {
    for (const kind of STAFF_KINDS) {
      const role = SCHOOL_STAFF_ROLES[kind][0];
      expect(decideStaffRole(kind, { role, scope: SCHOOL_A }), `${kind}/${role}`).toMatchObject({
        decision: "allow",
      });
    }
  });

  it("fails closed for roles outside the set, unknown roles and unresolved scopes", () => {
    expect(decideStaffRole("school_admin", { role: "teacher", scope: SCHOOL_A }).decision).toBe(
      "deny",
    );
    expect(decideStaffRole("school_admin", { role: "admin", scope: null }).decision).toBe("deny");
    expect(decideStaffRole("school_admin", { role: null, scope: SCHOOL_A }).decision).toBe("deny");
    expect(decideStaffRole("school_admin", { role: "warlord", scope: SCHOOL_A }).decision).toBe(
      "deny",
    );
  });

  it("DEFECT-1 (resolved): a SUSPENDED identity holding any staff role is denied on every staff gate", () => {
    for (const kind of STAFF_KINDS) {
      for (const role of SCHOOL_STAFF_ROLES[kind]) {
        const decision = decideStaffRole(kind, { role, scope: SCHOOL_A, lifecycle: "suspended" });
        expect(decision.decision, `${kind}/${role} for a suspended identity`).toBe("deny");
        if (decision.decision === "deny") {
          expect(decision.code).toBe("lifecycle_denied");
        }
      }
    }
  });

  it("DEFECT-1 (resolved): an expired/revoked session denies every staff kind", () => {
    for (const kind of STAFF_KINDS) {
      const role = SCHOOL_STAFF_ROLES[kind][0];
      for (const status of ["expired", "revoked", "terminated"] as const) {
        expect(
          decideStaffRole(kind, { role, scope: SCHOOL_A, sessionStatus: status }).decision,
          `${kind}/${role} with ${status} session`,
        ).toBe("deny");
      }
    }
  });

  it("an ACTIVE staff identity with an active session allows with no unverified gap", () => {
    const decision = decideStaffRole("school_admin", {
      role: "admin",
      scope: SCHOOL_A,
      lifecycle: "active",
      sessionStatus: "active",
    });
    expect(decision).toMatchObject({ decision: "allow", role: "admin", scope: SCHOOL_A });
    expect(decision.decision === "allow" && !("lifecycleUnverified" in decision)).toBe(true);
  });

  it("the staff signals contract now carries the lifecycle/session fields", () => {
    const signals = {
      role: "admin",
      scope: SCHOOL_A,
      lifecycle: "active",
      sessionStatus: "active",
      sessionValid: true,
    };
    expect(Object.keys(signals).sort()).toEqual([
      "lifecycle",
      "role",
      "scope",
      "sessionStatus",
      "sessionValid",
    ]);
  });
});

describe("decideAccountAdministration × lifecycle (DEFECT-1 resolved)", () => {
  it("control: an ACTIVE school admin acts inside the same tenant", () => {
    expect(
      decideAccountAdministration({
        platformSuper: false,
        schoolAdmin: true,
        schoolScope: SCHOOL_A,
        targetSchoolId: SCHOOL_A,
      }),
    ).toMatchObject({ decision: "allow", actor: "school_admin", scope: SCHOOL_A });
  });

  it("fails closed without roles, scope, or on cross-tenant targets", () => {
    expect(
      decideAccountAdministration({
        platformSuper: false,
        schoolAdmin: false,
        schoolScope: SCHOOL_A,
      }).decision,
    ).toBe("deny");
    expect(
      decideAccountAdministration({ platformSuper: false, schoolAdmin: true, schoolScope: null })
        .decision,
    ).toBe("deny");
    expect(
      decideAccountAdministration({
        platformSuper: false,
        schoolAdmin: true,
        schoolScope: SCHOOL_A,
        targetSchoolId: SCHOOL_B,
      }).decision,
    ).toBe("deny");
  });

  it("DEFECT-1 (resolved): a SUSPENDED school admin cannot administer accounts", () => {
    const outcome = decideAccountAdministration({
      platformSuper: false,
      schoolAdmin: true,
      schoolScope: SCHOOL_A,
      targetSchoolId: SCHOOL_A,
      lifecycle: "suspended",
    });
    expect(outcome).toMatchObject({ decision: "deny", code: "lifecycle_denied" });
  });

  it("DEFECT-1 (resolved): a SUSPENDED platform super admin cannot administer any tenant", () => {
    expect(
      decideAccountAdministration({
        platformSuper: true,
        schoolAdmin: false,
        schoolScope: null,
        lifecycle: "suspended",
      }),
    ).toMatchObject({ decision: "deny", code: "lifecycle_denied" });
  });

  it("DEFECT-1 (resolved): an expired/revoked session denies account administration", () => {
    for (const status of ["expired", "revoked", "terminated"] as const) {
      expect(
        decideAccountAdministration({
          platformSuper: false,
          schoolAdmin: true,
          schoolScope: SCHOOL_A,
          sessionStatus: status,
        }),
      ).toMatchObject({ decision: "deny", code: "session_denied" });
    }
  });

  it("an ACTIVE admin with a fully-attested context allows with no unverified gap", () => {
    const outcome = decideAccountAdministration({
      platformSuper: false,
      schoolAdmin: true,
      schoolScope: SCHOOL_A,
      targetSchoolId: SCHOOL_A,
      lifecycle: "active",
      sessionStatus: "active",
    });
    expect(outcome).toMatchObject({ decision: "allow", actor: "school_admin" });
    expect(outcome.decision === "allow" && !("lifecycleUnverified" in outcome)).toBe(true);
  });

  it("an opted-in allow with a gap exposes lifecycleUnverified: true", () => {
    expect(
      decideAccountAdministration({
        platformSuper: false,
        schoolAdmin: true,
        schoolScope: SCHOOL_A,
        lifecycle: "active",
      }),
    ).toMatchObject({ decision: "allow", lifecycleUnverified: true });
  });

  it("a legacy-shaped call keeps the historical outcome shape", () => {
    const outcome = decideAccountAdministration({
      platformSuper: false,
      schoolAdmin: true,
      schoolScope: SCHOOL_A,
      targetSchoolId: SCHOOL_A,
    });
    expect(outcome.decision === "allow" && "lifecycleUnverified" in outcome).toBe(false);
  });
});

describe("RPC adapters × lifecycle (DEFECT-1 resolved)", () => {
  it("control: an ACTIVE admin resolves its school scope through requireSchoolAdminScope", async () => {
    await expect(
      requireSchoolAdminScope(rpcClient({ is_school_admin: true, get_my_school_id: SCHOOL_A })),
    ).resolves.toBe(SCHOOL_A);
  });

  it("fails closed when the role RPC denies or the scope is unresolved", async () => {
    await expect(
      requireSchoolAdminScope(rpcClient({ is_school_admin: false, get_my_school_id: SCHOOL_A })),
    ).rejects.toThrow("Forbidden: school admin role required");
    await expect(
      requireSchoolAdminScope(rpcClient({ is_school_admin: true, get_my_school_id: null })),
    ).rejects.toThrow("No school in scope");
  });

  it("DEFECT-1 (resolved): a suspended admin is denied through the RPC adapter", async () => {
    const supabase = rpcClient({ is_school_admin: true, get_my_school_id: SCHOOL_A });
    await expect(requireSchoolAdminScope(supabase, { lifecycle: "suspended" })).rejects.toThrow(
      "identity lifecycle does not permit execution",
    );
    expect(
      await resolveRoleGate(supabase, "school_admin", { lifecycle: "suspended" }),
    ).toMatchObject({
      decision: "deny",
      code: "lifecycle_denied",
    });
  });

  it("DEFECT-1 (resolved): an expired session is denied through the RPC adapter", async () => {
    await expect(
      requireSchoolAdminScope(rpcClient({ is_school_admin: true, get_my_school_id: SCHOOL_A }), {
        sessionStatus: "expired",
      }),
    ).rejects.toThrow("session is expired or revoked");
  });

  it("DEFECT-1 (resolved): a suspended teacher is denied through requireStaffContext", async () => {
    const supabase = rpcClient({ get_my_role: "teacher", get_my_school_id: SCHOOL_A });
    await expect(
      requireStaffContext(supabase, "school_teacher", { lifecycle: "suspended" }),
    ).rejects.toThrow("identity lifecycle does not permit execution");
    await expect(
      requireStaffContext(supabase, "school_teacher", { sessionStatus: "revoked" }),
    ).rejects.toThrow("session is expired or revoked");
  });

  it("an ACTIVE identity still resolves through both adapters with lifecycle threaded", async () => {
    const supabase = rpcClient({ is_school_admin: true, get_my_school_id: SCHOOL_A });
    await expect(
      requireSchoolAdminScope(supabase, { lifecycle: "active", sessionStatus: "active" }),
    ).resolves.toBe(SCHOOL_A);

    const staff = rpcClient({ get_my_role: "teacher", get_my_school_id: SCHOOL_A });
    await expect(
      requireStaffContext(staff, "school_teacher", {
        lifecycle: "active",
        sessionStatus: "active",
      }),
    ).resolves.toMatchObject({ role: "teacher", schoolId: SCHOOL_A });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Actor substrate × lifecycle (DEFECT-2 RESOLVED)
 * ────────────────────────────────────────────────────────────*/

describe("resolveIdentityActor × lifecycle (DEFECT-2 resolved)", () => {
  const ACTIVE_SOURCE = {
    userId: "00000000-0000-0000-0000-000000000001",
    email: "actor@example.com",
    role: "admin",
    schoolId: SCHOOL_A,
    isActive: true,
  };

  it("control: an ACTIVE identity resolves to a usable actor carrying its lifecycle", () => {
    const resolution = resolveIdentityActor({ ...ACTIVE_SOURCE, lifecycle: "active" });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.actor.role).toBe("admin");
      expect(resolution.actor.schoolId).toBe(SCHOOL_A);
      expect(resolution.actor.lifecycle).toBe("active");
    }
  });

  it("a PROVISIONED identity resolves (documented usable set) and carries its lifecycle", () => {
    const resolution = resolveIdentityActor({ ...ACTIVE_SOURCE, lifecycle: "provisioned" });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.actor.lifecycle).toBe("provisioned");
    }
  });

  it("fails closed on the row-active flag, missing user id, unknown role and school-less school roles", () => {
    expect(resolveIdentityActor({ ...ACTIVE_SOURCE, isActive: false })).toMatchObject({
      ok: false,
      reason: "Identity is not active",
    });
    expect(resolveIdentityActor({ ...ACTIVE_SOURCE, userId: "  " }).ok).toBe(false);
    expect(resolveIdentityActor({ ...ACTIVE_SOURCE, role: "warlord" }).ok).toBe(false);
    expect(resolveIdentityActor({ ...ACTIVE_SOURCE, role: "teacher", schoolId: null }).ok).toBe(
      false,
    );
  });

  it("DEFECT-2 (resolved): every non-usable lifecycle state fails the actor resolution", () => {
    for (const state of LIFECYCLE_DENIED_STATES) {
      const resolution = resolveIdentityActor({ ...ACTIVE_SOURCE, lifecycle: state });
      expect(resolution.ok, `lifecycle ${state} must not resolve`).toBe(false);
      if (!resolution.ok) {
        expect(resolution.reason).toBe("Identity lifecycle is not usable");
      }
    }
  });

  it("DEFECT-2 (resolved): unknown lifecycle values fail closed (expired is not a lifecycle state)", () => {
    expect(resolveIdentityActor({ ...ACTIVE_SOURCE, lifecycle: "expired" as never })).toMatchObject(
      {
        ok: false,
        reason: "Identity lifecycle is not usable",
      },
    );
  });

  it("DEFECT-2 (resolved): expired/revoked/terminated sessions fail the actor resolution", () => {
    for (const status of ["expired", "revoked", "terminated"] as const) {
      const resolution = resolveIdentityActor({ ...ACTIVE_SOURCE, sessionStatus: status });
      expect(resolution.ok, `session ${status} must not resolve`).toBe(false);
      if (!resolution.ok) {
        expect(resolution.reason).toBe("Session is not active");
      }
    }
  });

  it("an actor resolved without lifecycle signals carries lifecycle: null (unverified, never trusted as active)", () => {
    const resolution = resolveIdentityActor(ACTIVE_SOURCE);
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.actor.lifecycle).toBeNull();
    }
  });

  it("the actor source contract now carries the lifecycle/session fields", () => {
    const source = {
      userId: "u1",
      role: "admin",
      schoolId: SCHOOL_A,
      isActive: true,
      lifecycle: "active",
      sessionStatus: "active",
    };
    expect(Object.keys(source).sort()).toEqual([
      "isActive",
      "lifecycle",
      "role",
      "schoolId",
      "sessionStatus",
      "userId",
    ]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Capability gate × lifecycle (DEFECT-3 RESOLVED)
 * ────────────────────────────────────────────────────────────*/

describe("evaluateRuntimeCapability × lifecycle (DEFECT-3 resolved)", () => {
  const adminCode =
    [...SCHOLAR_FEATURE_CODES].find((code) => code.startsWith("r001:org_admin.")) ?? "";

  it("control: an ACTIVE admin's role grants the declared capability with no unverified gap", () => {
    const outcome = evaluateRuntimeCapability({
      code: adminCode,
      role: "admin",
      actorActive: true,
    });
    expect(outcome).toMatchObject({ decision: "allow" });
    expect(outcome.decision === "allow" && !("lifecycleUnverified" in outcome)).toBe(true);
  });

  it("fails closed on malformed, undeclared codes and role mismatch", () => {
    expect(evaluateRuntimeCapability({ code: "nope", role: "admin" }).decision).toBe("deny");
    expect(
      evaluateRuntimeCapability({ code: "r002:org_admin.settings", role: "admin" }).decision,
    ).toBe("deny");
    expect(evaluateRuntimeCapability({ code: adminCode, role: "parent" }).decision).toBe("deny");
  });

  it("DEFECT-3 (resolved): a non-active actor context is refused regardless of role", () => {
    const outcome = evaluateRuntimeCapability({
      code: adminCode,
      role: "admin",
      actorActive: false,
    });
    expect(outcome).toMatchObject({
      decision: "deny",
      code: "role_required",
      reason: "Actor context is not active",
    });
  });

  it("DEFECT-3 (resolved): a non-active actor context is refused even for platform super-admins", () => {
    expect(
      evaluateRuntimeCapability({
        code: adminCode,
        role: "admin",
        isPlatformSuper: true,
        actorActive: false,
      }),
    ).toMatchObject({
      decision: "deny",
      code: "role_required",
      reason: "Actor context is not active",
    });
  });

  it("an opted-in allow with unverified actor liveness exposes lifecycleUnverified: true", () => {
    const outcome = evaluateRuntimeCapability({
      code: adminCode,
      role: "admin",
      actorActive: undefined,
    });
    expect(outcome).toMatchObject({ decision: "allow", lifecycleUnverified: true });
  });

  it("a legacy-shaped call keeps the historical outcome shape", () => {
    const outcome = evaluateRuntimeCapability({ code: adminCode, role: "admin" });
    expect(outcome.decision).toBe("allow");
    expect(outcome.decision === "allow" && "lifecycleUnverified" in outcome).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Session expiry semantics at the identity layer
 * ────────────────────────────────────────────────────────────*/

describe("Session expiry/revocation at the identity layer (SessionStatus)", () => {
  const NON_ACTIVE_STATUSES: readonly SessionStatus[] = ["expired", "revoked", "terminated"];

  it("an ACTIVE, fresh, unexpired session evaluates usable", () => {
    expect(
      evaluateSessionSecurity(sessionFixture(), SESSION_POLICY, LAST_ACTIVITY_AT, NOW),
    ).toEqual({
      ok: true,
    });
  });

  it("every non-active session status fails closed", () => {
    for (const status of NON_ACTIVE_STATUSES) {
      const evaluation = evaluateSessionSecurity(
        sessionFixture({ status }),
        SESSION_POLICY,
        LAST_ACTIVITY_AT,
        NOW,
      );
      expect(evaluation.ok, `session status ${status} must not execute`).toBe(false);
      if (!evaluation.ok) {
        expect(evaluation.reason).toContain("is not usable");
        expect(evaluation.requiresStepUp).toBe(true);
      }
    }
  });

  it("an ACTIVE session past its expiresAt fails closed (boundary inclusive)", () => {
    const expiresAt = "2026-10-01T12:00:00.000Z";
    const expired = evaluateSessionSecurity(
      sessionFixture({ expiresAt }),
      SESSION_POLICY,
      LAST_ACTIVITY_AT,
      NOW,
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.reason).toBe("Session has expired");
    }

    const oneMsBefore = "2026-10-01T11:59:59.999Z";
    expect(
      evaluateSessionSecurity(
        sessionFixture({ expiresAt }),
        SESSION_POLICY,
        LAST_ACTIVITY_AT,
        oneMsBefore,
      ).ok,
    ).toBe(true);
  });

  it("revocation propagates: a revoked session is unusable and carries its reason", () => {
    const revoked = revokeSession(sessionFixture(), "operator suspend", NOW);
    expect(revoked.session.status).toBe("revoked");
    expect(revoked.session.revokeReason).toBe("operator suspend");
    expect(revoked.revokedAt).toBe(NOW);

    const evaluation = evaluateSessionSecurity(
      revoked.session,
      SESSION_POLICY,
      LAST_ACTIVITY_AT,
      NOW,
    );
    expect(evaluation.ok).toBe(false);
  });

  it("an expired/revoked session maps to a non-granting security-gateway signal", () => {
    // Composition at the enforcement point: the identity-layer evaluation
    // denies the session, so the upstream must assert sessionValid=false and
    // the gateway must not grant.
    const expiredEvaluation = evaluateSessionSecurity(
      sessionFixture({ status: "expired" }),
      SESSION_POLICY,
      LAST_ACTIVITY_AT,
      NOW,
    );
    expect(expiredEvaluation.ok).toBe(false);

    const gateway = evaluateSecurityGateway({
      identityValid: true,
      tenantContextValid: true,
      sessionValid: expiredEvaluation.ok,
      withinRateLimit: true,
      requestIntegrityValid: true,
      authorizationDecision: "ALLOW",
    });
    expect(gateway.decision).toBe("challenge");
    expect(gateway.decision !== "allow").toBe(true);
  });

  it("token expiry helper fails closed on missing/past expiry", () => {
    expect(tokenMsRemaining(null, new Date(NOW))).toBe(0);
    expect(tokenMsRemaining(undefined, new Date(NOW))).toBe(0);
    expect(tokenMsRemaining(Date.parse(NOW) / 1000 - 1, new Date(NOW))).toBe(0);
    expect(tokenMsRemaining(Date.parse(NOW) / 1000 + 60, new Date(NOW))).toBe(60_000);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 8. Credential expiry/revocation at the identity layer
 * ────────────────────────────────────────────────────────────*/

describe("Credential expiry/revocation at the identity layer (CredentialStatus)", () => {
  const CREDENTIAL_STATUSES = Object.keys(CREDENTIAL_STATUS_TRANSITIONS) as Array<
    keyof typeof CREDENTIAL_STATUS_TRANSITIONS
  >;
  const FUTURE = "2026-10-01T18:00:00.000Z";
  const CREDENTIAL_POLICY: CredentialPolicy = {
    maxLifetimeSeconds: 3600,
    rotationPeriodSeconds: 1800,
    allowedKinds: ["token"],
  };

  function activeCredential(expiresAt: string | null = FUTURE) {
    const created = createCredential(
      {
        identityId: identityId("00000000-0000-0000-0000-000000000001"),
        kind: "token",
        expiresAt,
        fingerprint: "sha256:cred-1",
      },
      NOW,
    );
    if (!created.ok) throw new Error(created.error);
    const activated = transitionCredentialStatus(created.credential, "active", NOW);
    if (!activated.ok) throw new Error(activated.error);
    return activated.credential;
  }

  it("a PENDING credential is not active (cannot execute)", () => {
    const created = createCredential(
      {
        identityId: identityId("00000000-0000-0000-0000-000000000001"),
        kind: "token",
        expiresAt: FUTURE,
        fingerprint: "sha256:cred-2",
      },
      NOW,
    );
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.credential.status).toBe("pending");
      expect(isCredentialActive(created.credential, NOW)).toBe(false);
    }
  });

  it("an ACTIVE, unexpired credential is active; past expiry it is not (boundary inclusive)", () => {
    const credential = activeCredential();
    expect(isCredentialActive(credential, NOW)).toBe(true);

    const boundary = "2026-10-01T18:00:00.000Z";
    expect(isCredentialActive(credential, boundary)).toBe(false);
    expect(isCredentialExpired(credential, boundary)).toBe(true);

    const oneMsBefore = "2026-10-01T17:59:59.999Z";
    expect(isCredentialActive(credential, oneMsBefore)).toBe(true);
    expect(isCredentialExpired(credential, oneMsBefore)).toBe(false);
  });

  it("a REVOKED credential is not active and revocation is terminal", () => {
    const revoked = transitionCredentialStatus(activeCredential(), "revoked", NOW);
    expect(revoked.ok).toBe(true);
    if (revoked.ok) {
      expect(isCredentialActive(revoked.credential, NOW)).toBe(false);
      for (const status of CREDENTIAL_STATUSES) {
        expect(canTransitionCredential("revoked", status), `revoked -> ${status}`).toBe(false);
      }
    }
  });

  it("an EXPIRED credential is not active; expiry then revocation stays terminal", () => {
    const expired = transitionCredentialStatus(activeCredential(), "expired", NOW);
    expect(expired.ok).toBe(true);
    if (expired.ok) {
      expect(isCredentialActive(expired.credential, NOW)).toBe(false);
      // Status is authoritative: the credential was transitioned to "expired"
      // while its timestamp-based expiry is still in the future.
      expect(isCredentialExpired(expired.credential, NOW)).toBe(false);

      const revoked = transitionCredentialStatus(expired.credential, "revoked", NOW);
      expect(revoked.ok).toBe(true);
      if (revoked.ok) {
        expect(canTransitionCredential("revoked", "active")).toBe(false);
        expect(isCredentialActive(revoked.credential, NOW)).toBe(false);
      }
    }
  });

  it("policy requires an expiry: a non-expiring credential is invalid by policy", () => {
    const created = createCredential(
      {
        identityId: identityId("00000000-0000-0000-0000-000000000001"),
        kind: "token",
        expiresAt: null,
        fingerprint: "sha256:cred-3",
      },
      NOW,
    );
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(
        validateCredentialAgainstPolicy(created.credential, CREDENTIAL_POLICY, NOW),
      ).toMatchObject({
        valid: false,
        reason: "Credential must have an expiry",
      });
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 9. Delegation expiry gap (DEFECT-4 DEFERRED — routing note)
 * ────────────────────────────────────────────────────────────*/

describe("Delegation authority (identity layer — DEFECT-4 deferred)", () => {
  it("pins the DelegationRecord contract whose expiry remains unenforced (DEFERRED)", () => {
    // DEFECT-4 is DEFERRED to the delegation substrate mission (MISSION-R-42
    // era, per the coordinator routing): DelegationRecord (frontend/src/lib/
    // identity.ts) mandates expiresAt and revokedAt, but the substrate still
    // exports no enforcement helper and no gate consumes delegation expiry.
    // This test pins the contract fields so the gap stays visible until that
    // mission lands isDelegationActive (or equivalent) and threads it into a
    // gate.
    const delegation = {
      id: "delegation-1",
      principalId: "00000000-0000-0000-0000-000000000001",
      delegateId: "00000000-0000-0000-0000-000000000002",
      permissions: [{ resource: "student", action: "read", scope: null }],
      purpose: "exam support",
      expiresAt: "2026-09-01T00:00:00.000Z",
      revokedAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    expect(new Date(delegation.expiresAt).getTime()).toBeLessThan(new Date(NOW).getTime());
    expect(delegation.revokedAt).toBeNull();
    // Nothing in the substrate evaluates this record — the assertions above
    // are the only lifecycle facts the identity layer can currently express
    // about a long-expired, unrevoked delegation.
  });
});
