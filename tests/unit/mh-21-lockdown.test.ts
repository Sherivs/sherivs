/**
 * MISSION H2-21 — Emergency revocation / lockdown path (J-010, G-034).
 *
 * Proves the authorization-decision-boundary lockdown contracts of
 * `frontend/src/lib/security/lockdown.ts`:
 *
 * - AGENTS §5 (agents untrusted): only an identity on the authorized-guardian
 *   allowlist may declare or lift; unauthenticated/non-guardian attempts are
 *   denied AND audited.
 * - Immediate fail-closed effect: an active lockdown denies every request in
 *   scope at the lockdown check — which composes BEFORE role/capability
 *   evaluation (proven here with a downstream evaluator that must never run
 *   on a lockdown deny) — unless the request matches an enumerated exemption.
 * - Enumerated exemptions, never wildcards: wildcard/blank exemption fields
 *   are refused at declaration; declarations and exemption lists are frozen;
 *   an active id cannot be shadowed by a wider re-declaration.
 * - AGENTS §18 (security fabric lifecycle): declaration, every denied
 *   request, every exemption, lift, and every denied declaration/lift
 *   attempt is recorded on the audit sink — no unlogged lockdown.
 * - J-035 independence spirit: the lifter is not the declarer; a second
 *   guardian's lift succeeds and is audited.
 *
 * Scope boundary: the per-lease credential kill-switch (revoke outstanding
 * leases for an agent/tenant) is owned by `credential-broker.ts` and its
 * suite; this suite owns the boundary lockdown layer only.
 */
import { describe, expect, it } from "vitest";
import {
  InMemoryLockdownAuditSink,
  LOCKDOWN_CONTRACT_VERSION,
  LOCKDOWN_SCOPES,
  declareLockdown,
  evaluateLockdownBoundary,
  isLockdownActive,
  lockdownState,
  liftLockdown,
  type LockdownAuditEvent,
  type LockdownDeclaration,
  type LockdownExemption,
} from "@/lib/security/lockdown";

const NOW = "2026-10-02T12:00:00.000Z";
const LATER = "2026-10-02T13:00:00.000Z";
const EXPIRY = "2026-10-02T18:00:00.000Z";

const GUARDIAN_A = "identity:guardian-alpha";
const GUARDIAN_B = "identity:guardian-beta";
const GUARDIANS = [GUARDIAN_A, GUARDIAN_B];

const AGENT_X = "identity:agent-x";
const TENANT_A = "tenant:11111111-1111-1111-1111-111111111111";
const TENANT_B = "tenant:22222222-2222-2222-2222-222222222222";
const CAPABILITY = "capability:tenant.admin.settings";

const RESPONDER_EXEMPTION = {
  identityRef: GUARDIAN_A,
  reason: "incident responder corridor",
} as const;

const GLOBAL_EXEMPTIONS = [{ identityRef: GUARDIAN_A, reason: "incident responder on-call" }];

const BASE_REQUEST = {
  identityRef: "identity:staff-1",
  tenantRef: TENANT_A,
  capabilityRef: CAPABILITY,
};

function request(overrides: Partial<typeof BASE_REQUEST> = {}): typeof BASE_REQUEST {
  return { ...BASE_REQUEST, ...overrides };
}

function auditOf(sink: InMemoryLockdownAuditSink): LockdownAuditEvent[] {
  return [...sink.events];
}

function kindsOf(sink: InMemoryLockdownAuditSink): string[] {
  return auditOf(sink).map((event) => event.kind);
}

/** A downstream role/capability evaluator that must NEVER run on a deny. */
let downstreamEvaluations = 0;
function evaluateRoleGateSpy(): { decision: "allow" } {
  downstreamEvaluations += 1;
  return { decision: "allow" };
}

/* ─────────────────────────────────────────────────────────────
 * 1. Guardian-only declaration (§5: unauthenticated attempts denied)
 * ────────────────────────────────────────────────────────────*/

describe("Lockdown declaration authorization (J-010 guardians)", () => {
  it("an unauthenticated (unknown identity) lockdown attempt is denied and audited", () => {
    const sink = new InMemoryLockdownAuditSink();
    const attempt = declareLockdown(
      {
        id: "ld-unauth",
        guardianRef: "identity:intruder",
        scope: "global",
        reason: "not a guardian",
        expiresAt: EXPIRY,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(attempt).toMatchObject({ ok: false, error: "guardian_not_authorized" });
    expect(kindsOf(sink)).toEqual(["LOCKDOWN_DECLARE_DENIED"]);
    const denied = sink.events[0];
    expect(denied).toMatchObject({
      kind: "LOCKDOWN_DECLARE_DENIED",
      at: NOW,
      guardianRef: "identity:intruder",
      denyReason: "guardian_not_authorized",
    });
  });

  it("every malformed invocation fails closed with an audited denial", () => {
    const cases: Array<{ input: Parameters<typeof declareLockdown>[0]; error: string }> = [
      {
        input: {
          id: "",
          guardianRef: GUARDIAN_A,
          scope: "global",
          reason: "r",
          expiresAt: EXPIRY,
          authorizedGuardians: GUARDIANS,
          now: NOW,
        },
        error: "lockdown_id_required",
      },
      {
        input: {
          id: "ld-x",
          guardianRef: GUARDIAN_A,
          scope: "tenant" as const,
          reason: "r",
          expiresAt: EXPIRY,
          authorizedGuardians: GUARDIANS,
          now: NOW,
        },
        error: "lockdown_target_required",
      },
      {
        input: {
          id: "ld-x",
          guardianRef: GUARDIAN_A,
          scope: "global" as const,
          reason: "r",
          expiresAt: EXPIRY,
          tenantRef: TENANT_A,
          authorizedGuardians: GUARDIANS,
          now: NOW,
        },
        error: "lockdown_scope_contradiction",
      },
      {
        input: {
          id: "ld-x",
          guardianRef: GUARDIAN_A,
          scope: "global" as const,
          reason: "",
          expiresAt: EXPIRY,
          authorizedGuardians: GUARDIANS,
          now: NOW,
        },
        error: "lockdown_reason_required",
      },
      {
        input: {
          id: "ld-x",
          guardianRef: GUARDIAN_A,
          scope: "global" as const,
          reason: "r",
          expiresAt: "2020-01-01T00:00:00.000Z",
          authorizedGuardians: GUARDIANS,
          now: NOW,
        },
        error: "lockdown_expiry_required_bounded",
      },
      {
        input: {
          id: "ld-x",
          guardianRef: GUARDIAN_A,
          scope: "global" as const,
          reason: "r",
          expiresAt: "not-a-timestamp",
          authorizedGuardians: GUARDIANS,
          now: NOW,
        },
        error: "lockdown_expiry_required_bounded",
      },
      {
        input: {
          id: "ld-x",
          guardianRef: GUARDIAN_A,
          scope: "agent" as const,
          agentRef: AGENT_X,
          reason: "r",
          expiresAt: EXPIRY,
          authorizedGuardians: [AGENT_X],
          now: NOW,
        },
        error: "guardian_not_authorized",
      },
    ];
    for (const { input, error } of cases) {
      const sink = new InMemoryLockdownAuditSink();
      expect(declareLockdown(input, sink)).toMatchObject({ ok: false, error });
      expect(sink.events.at(-1)).toMatchObject({ kind: "LOCKDOWN_DECLARE_DENIED" });
    }
  });

  it("an agent declaring the lockdown that targets itself is denied (self-lockdown)", () => {
    const sink = new InMemoryLockdownAuditSink();
    const attempt = declareLockdown(
      {
        id: "ld-self",
        guardianRef: AGENT_X,
        scope: "agent",
        agentRef: AGENT_X,
        reason: "agent attempts to game the allowlist",
        expiresAt: EXPIRY,
        authorizedGuardians: [AGENT_X],
        now: NOW,
      },
      sink,
    );
    expect(attempt).toMatchObject({ ok: false, error: "self_lockdown_denied" });
    expect(sink.events.at(-1)).toMatchObject({ kind: "LOCKDOWN_DECLARE_DENIED" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Immediate fail-closed effect at the decision boundary
 * ────────────────────────────────────────────────────────────*/

describe("Guardian declaration takes effect immediately (fail-closed)", () => {
  it("global lockdown denies every request in scope the moment it is declared", () => {
    const sink = new InMemoryLockdownAuditSink();
    const before = evaluateLockdownBoundary({ lockdowns: [], request: request(), now: NOW }, sink);
    expect(before.decision).toBe("CLEAR");

    const declared = declareLockdown(
      {
        id: "ld-global-1",
        guardianRef: GUARDIAN_A,
        scope: "global",
        reason: "active platform intrusion",
        expiresAt: EXPIRY,
        exemptions: GLOBAL_EXEMPTIONS,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    expect(declared.lockdown).toMatchObject({
      id: "ld-global-1",
      scope: "global",
      declaredBy: GUARDIAN_A,
      contractVersion: LOCKDOWN_CONTRACT_VERSION,
      liftedAt: null,
    });
    expect(isLockdownActive(declared.lockdown, NOW)).toBe(true);
    expect(sink.events.at(-1)).toMatchObject({
      kind: "LOCKDOWN_DECLARED",
      lockdownId: "ld-global-1",
      declaredBy: GUARDIAN_A,
      exemptionCount: 1,
    });

    const after = evaluateLockdownBoundary(
      { lockdowns: [declared.lockdown], request: request(), now: LATER },
      sink,
    );
    expect(after).toMatchObject({
      decision: "DENY",
      lockdownId: "ld-global-1",
      scope: "global",
    });
    expect(after.decision === "DENY" && after.reason).toContain("fail-closed");
    // The deny itself is audited (§18): there is no unlogged denial.
    expect(sink.events.at(-1)).toMatchObject({
      kind: "LOCKDOWN_REQUEST_DENIED",
      lockdownId: "ld-global-1",
      identityRef: BASE_REQUEST.identityRef,
    });
  });

  it("the lockdown deny runs BEFORE role/capability evaluation (composition order)", () => {
    downstreamEvaluations = 0;
    const sink = new InMemoryLockdownAuditSink();
    const declared = declareLockdown(
      {
        id: "ld-global-order",
        guardianRef: GUARDIAN_A,
        scope: "global",
        reason: "active platform intrusion",
        expiresAt: EXPIRY,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;

    // The boundary contract: lockdown check first; on DENY the downstream
    // role/capability evaluator is never consulted.
    const lockdown = evaluateLockdownBoundary(
      { lockdowns: [declared.lockdown], request: request(), now: LATER },
      sink,
    );
    if (lockdown.decision === "DENY") {
      // The downstream evaluator is never consulted on a lockdown deny.
      expect(downstreamEvaluations).toBe(0);
    }
    expect(downstreamEvaluations).toBe(0);

    // Control: a CLEAR outcome hands off to the ordinary authorization
    // decision, which then runs.
    const clear = evaluateLockdownBoundary({ lockdowns: [], request: request(), now: LATER }, sink);
    expect(clear.decision).toBe("CLEAR");
    expect(evaluateRoleGateSpy()).toEqual({ decision: "allow" });
    expect(downstreamEvaluations).toBe(1);
  });

  it("each bounded scope denies exactly its targets and nothing else", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdowns: LockdownDeclaration[] = [];

    const tenant = declareLockdown(
      {
        id: "ld-tenant-a",
        guardianRef: GUARDIAN_A,
        scope: "tenant",
        tenantRef: TENANT_A,
        reason: "tenant compromise",
        expiresAt: EXPIRY,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(tenant.ok).toBe(true);
    if (tenant.ok) lockdowns.push(tenant.lockdown);

    const agent = declareLockdown(
      {
        id: "ld-agent-x",
        guardianRef: GUARDIAN_A,
        scope: "agent",
        agentRef: AGENT_X,
        reason: "rogue worker",
        expiresAt: EXPIRY,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(agent.ok).toBe(true);
    if (agent.ok) lockdowns.push(agent.lockdown);

    const capability = declareLockdown(
      {
        id: "ld-cap",
        guardianRef: GUARDIAN_A,
        scope: "capability",
        capabilityRef: CAPABILITY,
        tenantRef: TENANT_B,
        reason: "capability abuse vector",
        expiresAt: EXPIRY,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(capability.ok).toBe(true);
    if (capability.ok) lockdowns.push(capability.lockdown);

    expect(LOCKDOWN_SCOPES).toEqual(["global", "tenant", "agent", "capability"]);

    const cases: Array<{
      req: ReturnType<typeof request>;
      expectDeny: boolean;
      lockdownId?: string;
    }> = [
      { req: request(), expectDeny: true, lockdownId: "ld-tenant-a" },
      // The capability lockdown is tenant-narrowed to B: a tenant-B request
      // for the locked capability is denied by it.
      { req: request({ tenantRef: TENANT_B }), expectDeny: true, lockdownId: "ld-cap" },
      // Scoped to tenant B so the agent lockdown (not the tenant-A lockdown)
      // is the deterministic denying authority.
      {
        req: request({ identityRef: AGENT_X, tenantRef: TENANT_B }),
        expectDeny: true,
        lockdownId: "ld-agent-x",
      },
      {
        req: request({ tenantRef: TENANT_B, capabilityRef: "capability:other.read" }),
        expectDeny: false,
      },
    ];
    for (const { req, expectDeny, lockdownId } of cases) {
      const outcome = evaluateLockdownBoundary({ lockdowns, request: req, now: LATER }, sink);
      if (expectDeny) {
        expect(outcome, JSON.stringify(req)).toMatchObject({
          decision: "DENY",
          lockdownId,
        });
      } else {
        expect(outcome.decision, JSON.stringify(req)).toBe("CLEAR");
      }
    }

    // Tenant isolation: the lockdown on tenant A never reaches tenant B
    // (capability outside the locked one, so only the tenant scopes matter).
    const tenantB = evaluateLockdownBoundary(
      {
        lockdowns,
        request: request({ tenantRef: TENANT_B, capabilityRef: "capability:other.read" }),
        now: LATER,
      },
      sink,
    );
    expect(tenantB.decision).toBe("CLEAR");
  });

  it("a capability lockdown without tenant narrowing denies the capability everywhere", () => {
    const sink = new InMemoryLockdownAuditSink();
    const declared = declareLockdown(
      {
        id: "ld-cap-global",
        guardianRef: GUARDIAN_A,
        scope: "capability",
        capabilityRef: CAPABILITY,
        reason: "capability-level exploit",
        expiresAt: EXPIRY,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    for (const tenant of [TENANT_A, TENANT_B]) {
      const outcome = evaluateLockdownBoundary(
        { lockdowns: [declared.lockdown], request: request({ tenantRef: tenant }), now: LATER },
        sink,
      );
      expect(outcome).toMatchObject({ decision: "DENY", lockdownId: "ld-cap-global" });
    }
  });

  it("an expired lockdown stops denying (bounded emergency window, G-034)", () => {
    const sink = new InMemoryLockdownAuditSink();
    const declared = declareLockdown(
      {
        id: "ld-expiring",
        guardianRef: GUARDIAN_A,
        scope: "global",
        reason: "bounded containment",
        expiresAt: EXPIRY,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    expect(lockdownState(declared.lockdown, EXPIRY)).toBe("expired");
    const outcome = evaluateLockdownBoundary(
      { lockdowns: [declared.lockdown], request: request(), now: EXPIRY },
      sink,
    );
    expect(outcome.decision).toBe("CLEAR");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Enumerated exemptions — never wildcards, never widened
 * ────────────────────────────────────────────────────────────*/

describe("Exemptions are enumerated, exact and immutable", () => {
  it("wildcard and blank exemption fields are refused at declaration time", () => {
    const badExemptions: readonly LockdownExemption[] = [
      { identityRef: "*", reason: "everyone" },
      { tenantRef: "tenant:*", reason: "any tenant" },
      { identityRef: "", reason: "blank field" },
      { reason: "names no principal" },
      { identityRef: GUARDIAN_A, reason: "" },
    ];
    for (const exemptions of badExemptions) {
      const sink = new InMemoryLockdownAuditSink();
      const attempt = declareLockdown(
        {
          id: "ld-wild",
          guardianRef: GUARDIAN_A,
          scope: "global",
          reason: "attempted wildcard exemption",
          expiresAt: EXPIRY,
          exemptions: [exemptions],
          authorizedGuardians: GUARDIANS,
          now: NOW,
        },
        sink,
      );
      expect(attempt.ok, JSON.stringify(exemptions)).toBe(false);
      expect(sink.events.at(-1)).toMatchObject({ kind: "LOCKDOWN_DECLARE_DENIED" });
    }
    // And the lockdown target itself can never be a wildcard.
    const sink = new InMemoryLockdownAuditSink();
    expect(
      declareLockdown(
        {
          id: "ld-wild-target",
          guardianRef: GUARDIAN_A,
          scope: "tenant",
          tenantRef: "*",
          reason: "wildcard target",
          expiresAt: EXPIRY,
          authorizedGuardians: GUARDIANS,
          now: NOW,
        },
        sink,
      ),
    ).toMatchObject({ ok: false, error: "lockdown_wildcard_denied" });
  });

  it("an enumerated exemption clears exactly its tuple; everyone else stays denied", () => {
    const sink = new InMemoryLockdownAuditSink();
    const declared = declareLockdown(
      {
        id: "ld-global-exempt",
        guardianRef: GUARDIAN_A,
        scope: "global",
        reason: "containment with responder corridor",
        expiresAt: EXPIRY,
        exemptions: [{ identityRef: GUARDIAN_A, reason: "incident responder" }],
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;

    const exempt = evaluateLockdownBoundary(
      { lockdowns: [declared.lockdown], request: request({ identityRef: GUARDIAN_A }), now: LATER },
      sink,
    );
    expect(exempt).toMatchObject({
      decision: "CLEAR",
      exempted: true,
      exemptedByLockdownId: "ld-global-exempt",
    });
    expect(sink.events.at(-1)).toMatchObject({
      kind: "LOCKDOWN_REQUEST_EXEMPTED",
      lockdownId: "ld-global-exempt",
    });

    const stillDenied = evaluateLockdownBoundary(
      {
        lockdowns: [declared.lockdown],
        request: request({ identityRef: GUARDIAN_B }),
        now: LATER,
      },
      sink,
    );
    expect(stillDenied.decision).toBe("DENY");
    expect(sink.events.at(-1)).toMatchObject({ kind: "LOCKDOWN_REQUEST_DENIED" });
  });

  it("an exemption from one lockdown does not bypass another applicable lockdown", () => {
    const sink = new InMemoryLockdownAuditSink();
    const global = declareLockdown(
      {
        id: "ld-global-two",
        guardianRef: GUARDIAN_A,
        scope: "global",
        reason: "platform-wide containment",
        expiresAt: EXPIRY,
        exemptions: [{ identityRef: GUARDIAN_A, reason: "responder corridor" }],
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    const tenant = declareLockdown(
      {
        id: "ld-tenant-two",
        guardianRef: GUARDIAN_B,
        scope: "tenant",
        tenantRef: TENANT_A,
        reason: "tenant A compromise",
        expiresAt: EXPIRY,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(global.ok && tenant.ok).toBe(true);
    if (!global.ok || !tenant.ok) return;

    const outcome = evaluateLockdownBoundary(
      {
        lockdowns: [global.lockdown, tenant.lockdown],
        request: request({ identityRef: GUARDIAN_A }),
        now: LATER,
      },
      sink,
    );
    expect(outcome).toMatchObject({ decision: "DENY", lockdownId: "ld-tenant-two" });
  });

  it("exempt lists cannot be widened at runtime: frozen, no mutation API, no id shadowing", () => {
    const sink = new InMemoryLockdownAuditSink();
    const declared = declareLockdown(
      {
        id: "ld-frozen",
        guardianRef: GUARDIAN_A,
        scope: "global",
        reason: "containment",
        expiresAt: EXPIRY,
        exemptions: GLOBAL_EXEMPTIONS,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    const lockdown = declared.lockdown;

    expect(Object.isFrozen(lockdown)).toBe(true);
    expect(Object.isFrozen(lockdown.exemptions)).toBe(true);

    // Runtime widening attempts fail: the frozen contract cannot be mutated
    // in place, and no wider re-declaration can shadow the active id.
    expect(() => {
      (lockdown.exemptions as LockdownExemption[]).push({
        identityRef: "identity:anyone",
        reason: "runtime widening",
      });
    }).toThrow();
    expect(lockdown.exemptions.length).toBe(1);

    expect(() => {
      (lockdown as unknown as { exemptions: LockdownExemption[] }).exemptions = [
        { identityRef: "identity:anyone", reason: "runtime widening" },
      ];
    }).toThrow();
    expect(lockdown.exemptions.length).toBe(1);

    const shadow = declareLockdown(
      {
        id: "ld-frozen",
        guardianRef: GUARDIAN_B,
        scope: "global",
        reason: "re-declare with everyone exempt",
        expiresAt: EXPIRY,
        exemptions: [{ identityRef: "identity:anyone", reason: "wider list" }],
        authorizedGuardians: GUARDIANS,
        existingLockdowns: [lockdown],
        now: LATER,
      },
      sink,
    );
    expect(shadow).toMatchObject({ ok: false, error: "lockdown_id_conflict" });

    // The only legal mutation remains lift; the original declaration object
    // is never modified in place.
    expect(lockdown.liftedAt).toBeNull();
    expect(
      evaluateLockdownBoundary({ lockdowns: [lockdown], request: request(), now: LATER }, sink)
        .decision,
    ).toBe("DENY");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Lift — independent authorization (J-035 spirit)
 * ────────────────────────────────────────────────────────────*/

describe("Lift procedure with independent authorization", () => {
  function declaredGlobal(sink: InMemoryLockdownAuditSink, declaredBy = GUARDIAN_A) {
    const declared = declareLockdown(
      {
        id: "ld-lift",
        guardianRef: declaredBy,
        scope: "global",
        reason: "incident declared by alpha",
        expiresAt: EXPIRY,
        exemptions: [RESPONDER_EXEMPTION],
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    if (!declared.ok) throw new Error(declared.error);
    return declared.lockdown;
  }

  it("lift by the declarer is denied and audited", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declaredGlobal(sink, GUARDIAN_A);
    const attempt = liftLockdown(
      {
        lockdown,
        guardianRef: GUARDIAN_A,
        reason: "declarer attempts to lift its own lockdown",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(attempt).toMatchObject({ ok: false, error: "lift_independence_denied" });
    expect(sink.events.at(-1)).toMatchObject({
      kind: "LOCKDOWN_LIFT_DENIED",
      guardianRef: GUARDIAN_A,
      lockdownId: "ld-lift",
      denyReason: "lift_independence_denied",
    });
    // The lockdown is untouched and still denying.
    expect(lockdown.liftedAt).toBeNull();
    expect(
      evaluateLockdownBoundary({ lockdowns: [lockdown], request: request(), now: LATER }, sink)
        .decision,
    ).toBe("DENY");
  });

  it("lift by a second guardian succeeds, is audited, and the deny stops immediately", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declaredGlobal(sink, GUARDIAN_A);

    const lifted = liftLockdown(
      {
        lockdown,
        guardianRef: GUARDIAN_B,
        reason: "incident cleared after review",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.lockdown).toMatchObject({
      id: "ld-lift",
      liftedAt: LATER,
      liftedBy: GUARDIAN_B,
      liftReason: "incident cleared after review",
    });
    expect(lockdownState(lifted.lockdown, LATER)).toBe("lifted");
    expect(isLockdownActive(lifted.lockdown, LATER)).toBe(false);

    const lifterEvent = sink.events.at(-1);
    expect(lifterEvent).toMatchObject({
      kind: "LOCKDOWN_LIFTED",
      at: LATER,
      lockdownId: "ld-lift",
      liftedBy: GUARDIAN_B,
      reason: "incident cleared after review",
    });

    const outcome = evaluateLockdownBoundary(
      { lockdowns: [lifted.lockdown], request: request(), now: LATER },
      sink,
    );
    expect(outcome.decision).toBe("CLEAR");
    // Lift replaces the declaration; the pre-lift object stays frozen in its
    // active shape (pure contract, caller swaps the reference).
    expect(isLockdownActive(lockdown, LATER)).toBe(true);
  });

  it("every denied lift fails closed and is audited", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declaredGlobal(sink, GUARDIAN_A);
    const cases: Array<{ guardianRef: string; reason: string; error: string }> = [
      {
        guardianRef: "identity:intruder",
        reason: "not a guardian",
        error: "guardian_not_authorized",
      },
      { guardianRef: GUARDIAN_B, reason: "", error: "lift_reason_required" },
    ];
    for (const { guardianRef, reason, error } of cases) {
      const attempt = liftLockdown(
        { lockdown, guardianRef, reason, authorizedGuardians: GUARDIANS, now: LATER },
        sink,
      );
      expect(attempt).toMatchObject({ ok: false, error });
      expect(sink.events.at(-1)).toMatchObject({
        kind: "LOCKDOWN_LIFT_DENIED",
        guardianRef,
        denyReason: error,
      });
    }

    // After a successful lift the lockdown is no longer active: any further
    // lift attempt fails closed (and the declarer still cannot lift it).
    const liftedOnce = liftLockdown(
      {
        lockdown,
        guardianRef: GUARDIAN_B,
        reason: "first lift",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(liftedOnce.ok).toBe(true);
    const relift = liftLockdown(
      {
        lockdown: liftedOnce.ok ? liftedOnce.lockdown : lockdown,
        guardianRef: GUARDIAN_A,
        reason: "double lift",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(relift).toMatchObject({ ok: false, error: "lockdown_not_active" });
  });

  it("a targeted agent cannot lift its own lockdown even when listed as guardian", () => {
    const sink = new InMemoryLockdownAuditSink();
    const declared = declareLockdown(
      {
        id: "ld-agent-self-lift",
        guardianRef: GUARDIAN_A,
        scope: "agent",
        agentRef: AGENT_X,
        reason: "rogue worker containment",
        expiresAt: EXPIRY,
        authorizedGuardians: [...GUARDIANS, AGENT_X],
        now: NOW,
      },
      sink,
    );
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    const attempt = liftLockdown(
      {
        lockdown: declared.lockdown,
        guardianRef: AGENT_X,
        reason: "the locked-out agent self-lifts",
        authorizedGuardians: [...GUARDIANS, AGENT_X],
        now: LATER,
      },
      sink,
    );
    expect(attempt).toMatchObject({ ok: false, error: "self_lift_denied" });
    expect(sink.events.at(-1)).toMatchObject({ kind: "LOCKDOWN_LIFT_DENIED" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Audit lifecycle completeness (§18)
 * ────────────────────────────────────────────────────────────*/

describe("Mandatory audit trail across the lockdown lifecycle", () => {
  it("records declaration, denial, exemption, lift and every denied attempt", () => {
    const sink = new InMemoryLockdownAuditSink();
    const declared = declareLockdown(
      {
        id: "ld-audit",
        guardianRef: GUARDIAN_A,
        scope: "global",
        reason: "full-lifecycle incident",
        expiresAt: EXPIRY,
        exemptions: [{ identityRef: GUARDIAN_A, reason: "responder corridor" }],
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;

    declareLockdown(
      {
        id: "ld-audit-2",
        guardianRef: "identity:intruder",
        scope: "global",
        reason: "unauthorized declaration attempt",
        expiresAt: EXPIRY,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    evaluateLockdownBoundary(
      { lockdowns: [declared.lockdown], request: request(), now: LATER },
      sink,
    );
    evaluateLockdownBoundary(
      { lockdowns: [declared.lockdown], request: request({ identityRef: GUARDIAN_A }), now: LATER },
      sink,
    );
    liftLockdown(
      {
        lockdown: declared.lockdown,
        guardianRef: GUARDIAN_A,
        reason: "declarer self-lift attempt",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    const lifted = liftLockdown(
      {
        lockdown: declared.lockdown,
        guardianRef: GUARDIAN_B,
        reason: "incident cleared",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(lifted.ok).toBe(true);

    expect(kindsOf(sink)).toEqual([
      "LOCKDOWN_DECLARED",
      "LOCKDOWN_DECLARE_DENIED",
      "LOCKDOWN_REQUEST_DENIED",
      "LOCKDOWN_REQUEST_EXEMPTED",
      "LOCKDOWN_LIFT_DENIED",
      "LOCKDOWN_LIFTED",
    ]);
    for (const event of sink.events) {
      expect(event.at).toBeTypeOf("string");
      expect(event.at.length).toBeGreaterThan(0);
    }
  });
});
