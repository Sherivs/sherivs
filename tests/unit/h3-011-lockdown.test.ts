/**
 * MISSION H3-011 — Emergency revocation / kill-switch semantics depth
 * (J-010) on `frontend/src/lib/security/lockdown.ts`.
 *
 * Extends the H2-21 boundary suite with the emergency-path depth:
 *
 * - KILL-SWITCH REVOCATION (`revokeLockdown`): the fast off-switch ANY
 *   authorized guardian — including the declarer — may throw on a false alarm
 *   or a mis-scoped lockdown (AGENTS §18: enforcement and re-evaluation must
 *   never wedge an incident closed). The locked-out agent can NEVER revoke,
 *   even when guardian-listed (§5). Revocation only STOPS a deny; it never
 *   grants. Audited on both outcomes; terminal; pure (new frozen object).
 * - BOUNDED RENEWAL (`renewLockdown`): the emergency window can be extended
 *   only by a guardian OTHER than the declarer (no self-extension), only
 *   strictly forward, only under a mandatory expiry ceiling and a mandatory
 *   renewal cap, only with a reason — audited on both outcomes.
 * - Lifecycle depth: the `revoked` state; a revoked declaration is terminal
 *   (no revoke/lift/renew revival) and stops denying immediately.
 * - Coverage depth (`activeApplicableLockdowns`): the full deny-wins
 *   blast-radius view, including exemptions that would clear.
 * - Zod contract depth: strict fail-closed parse of declarations, requests
 *   and the full 10-kind audit-event vocabulary as they cross a trust
 *   boundary (unknown kinds and unknown keys refused).
 *
 * Scope boundary: the per-lease credential kill-switch remains owned by
 * `credential-broker.ts`; this suite owns the boundary lockdown layer only.
 */
import { describe, expect, it } from "vitest";
import {
  InMemoryLockdownAuditSink,
  LOCKDOWN_STATES,
  activeApplicableLockdowns,
  declareLockdown,
  evaluateLockdownBoundary,
  isLockdownActive,
  lockdownState,
  parseLockdownAuditEvent,
  parseLockdownDeclaration,
  parseLockdownRequest,
  renewLockdown,
  revokeLockdown,
  liftLockdown,
  type LockdownAuditEvent,
  type LockdownDeclaration,
} from "@/lib/security/lockdown";

const NOW = "2026-10-02T12:00:00.000Z";
const LATER = "2026-10-02T13:00:00.000Z";
const EXPIRY = "2026-10-02T18:00:00.000Z";
const RENEWED = "2026-10-02T20:00:00.000Z";
const RENEW_CEILING = "2026-10-02T23:00:00.000Z";

const GUARDIAN_A = "identity:guardian-alpha";
const GUARDIAN_B = "identity:guardian-beta";
const GUARDIANS = [GUARDIAN_A, GUARDIAN_B];

const AGENT_X = "identity:agent-x";
const TENANT_A = "tenant:11111111-1111-1111-1111-111111111111";
const TENANT_B = "tenant:22222222-2222-2222-2222-222222222222";
const CAPABILITY = "capability:tenant.admin.settings";

const BASE_REQUEST = {
  identityRef: "identity:staff-1",
  tenantRef: TENANT_A,
  capabilityRef: CAPABILITY,
};

function request(
  overrides: Partial<{ identityRef: string; tenantRef: string; capabilityRef: string }> = {},
): { identityRef: string; tenantRef: string; capabilityRef: string } {
  return { ...BASE_REQUEST, ...overrides };
}

function kindsOf(sink: InMemoryLockdownAuditSink): string[] {
  return [...sink.events].map((event) => event.kind);
}

function declareGlobal(sink: InMemoryLockdownAuditSink, declaredBy = GUARDIAN_A): LockdownDeclaration {
  const declared = declareLockdown(
    {
      id: "ld-h311-global",
      guardianRef: declaredBy,
      scope: "global",
      reason: "active platform intrusion",
      expiresAt: EXPIRY,
      authorizedGuardians: GUARDIANS,
      now: NOW,
    },
    sink,
  );
  if (!declared.ok) throw new Error(declared.error);
  return declared.lockdown;
}

function declareAgentScope(
  sink: InMemoryLockdownAuditSink,
  guardianAllowlist: readonly string[] = GUARDIANS,
): LockdownDeclaration {
  const declared = declareLockdown(
    {
      id: "ld-h311-agent",
      guardianRef: GUARDIAN_A,
      scope: "agent",
      agentRef: AGENT_X,
      reason: "rogue worker containment",
      expiresAt: EXPIRY,
      authorizedGuardians: guardianAllowlist,
      now: NOW,
    },
    sink,
  );
  if (!declared.ok) throw new Error(declared.error);
  return declared.lockdown;
}

/* ─────────────────────────────────────────────────────────────
 * 1. Emergency kill-switch revocation
 * ────────────────────────────────────────────────────────────*/

describe("Emergency kill-switch revocation (revokeLockdown)", () => {
  it("the declarer can revoke their own lockdown — the fast off-switch — and it is audited", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declareGlobal(sink, GUARDIAN_A);
    expect(evaluateLockdownBoundary({ lockdowns: [lockdown], request: request(), now: LATER }, sink).decision).toBe("DENY");

    const revoked = revokeLockdown(
      {
        lockdown,
        guardianRef: GUARDIAN_A,
        reason: "false alarm — intrusion ruled out",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(revoked).toMatchObject({ ok: true });
    if (!revoked.ok) return;
    expect(revoked.lockdown).toMatchObject({
      id: "ld-h311-global",
      revokedAt: LATER,
      revokedBy: GUARDIAN_A,
      revokeReason: "false alarm — intrusion ruled out",
      // Revocation is NOT a lift: liftedAt stays null.
      liftedAt: null,
      liftedBy: null,
      liftReason: null,
    });
    expect(Object.isFrozen(revoked.lockdown)).toBe(true);
    expect(sink.events.at(-1)).toMatchObject({
      kind: "LOCKDOWN_REVOKED",
      at: LATER,
      lockdownId: "ld-h311-global",
      revokedBy: GUARDIAN_A,
      reason: "false alarm — intrusion ruled out",
    });

    // The deny stops immediately for everyone in scope.
    const outcome = evaluateLockdownBoundary(
      { lockdowns: [revoked.lockdown], request: request(), now: LATER },
      sink,
    );
    expect(outcome.decision).toBe("CLEAR");
    expect(outcome).toMatchObject({ exempted: false, exemptedByLockdownId: null });

    // The original declaration is never mutated in place (pure contract).
    expect(lockdown.revokedAt).toBeNull();
    expect(lockdownState(lockdown, LATER)).toBe("active");
    expect(
      evaluateLockdownBoundary({ lockdowns: [lockdown], request: request(), now: LATER }, sink)
        .decision,
    ).toBe("DENY");
  });

  it("a second guardian can revoke too; revocation only stops a deny", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declareGlobal(sink, GUARDIAN_A);
    const revoked = revokeLockdown(
      {
        lockdown,
        guardianRef: GUARDIAN_B,
        reason: "mis-scoped containment",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.lockdown.revokedBy).toBe(GUARDIAN_B);
    // CLEAR after revocation means "not denied by lockdown" — never an allow:
    // the ordinary authorization decision still runs downstream.
    const outcome = evaluateLockdownBoundary(
      { lockdowns: [revoked.lockdown], request: request(), now: LATER },
      sink,
    );
    expect(outcome).toMatchObject({ decision: "CLEAR", exempted: false });
  });

  it("the locked-out agent cannot revoke its own lockdown even when guardian-listed (§5)", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declareAgentScope(sink, [...GUARDIANS, AGENT_X]);
    const attempt = revokeLockdown(
      {
        lockdown,
        guardianRef: AGENT_X,
        reason: "the locked-out agent throws the off-switch",
        authorizedGuardians: [...GUARDIANS, AGENT_X],
        now: LATER,
      },
      sink,
    );
    expect(attempt).toMatchObject({ ok: false, error: "self_revoke_denied" });
    expect(sink.events.at(-1)).toMatchObject({
      kind: "LOCKDOWN_REVOKE_DENIED",
      guardianRef: AGENT_X,
      lockdownId: "ld-h311-agent",
      denyReason: "self_revoke_denied",
    });
    // Still denying.
    expect(
      evaluateLockdownBoundary(
        {
          lockdowns: [lockdown],
          request: request({ identityRef: AGENT_X, tenantRef: TENANT_B }),
          now: LATER,
        },
        sink,
      ).decision,
    ).toBe("DENY");
  });

  it("every malformed revocation fails closed with an audited denial", () => {
    const cases: Array<{
      lockdown: LockdownDeclaration;
      guardianRef: string;
      reason: string;
      now: string;
      error: string;
    }> = [];
    {
      const sink = new InMemoryLockdownAuditSink();
      const active = declareGlobal(sink, GUARDIAN_A);
      const expired = declareLockdown(
        {
          id: "ld-h311-expired",
          guardianRef: GUARDIAN_A,
          scope: "global",
          reason: "already decayed",
          expiresAt: "2026-10-02T12:30:00.000Z",
          authorizedGuardians: GUARDIANS,
          now: NOW,
        },
        sink,
      );
      if (expired.ok) {
        expect(lockdownState(expired.lockdown, LATER)).toBe("expired");
        cases.push(
          {
            lockdown: active,
            guardianRef: "identity:intruder",
            reason: "not a guardian",
            now: LATER,
            error: "guardian_not_authorized",
          },
          {
            lockdown: active,
            guardianRef: GUARDIAN_B,
            reason: "",
            now: LATER,
            error: "revoke_reason_required",
          },
          {
            lockdown: expired.lockdown,
            guardianRef: GUARDIAN_B,
            reason: "revoked after decay",
            now: LATER,
            error: "lockdown_not_active",
          },
        );
      }
    }
    for (const { lockdown, guardianRef, reason, now, error } of cases) {
      const sink = new InMemoryLockdownAuditSink();
      const attempt = revokeLockdown(
        { lockdown, guardianRef, reason, authorizedGuardians: GUARDIANS, now },
        sink,
      );
      expect(attempt).toMatchObject({ ok: false, error });
      expect(sink.events.at(-1)).toMatchObject({
        kind: "LOCKDOWN_REVOKE_DENIED",
        guardianRef,
        denyReason: error,
      });
    }
  });

  it("a revoked lockdown is terminal: no revival by revoke, lift or renewal", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declareGlobal(sink, GUARDIAN_A);
    const revoked = revokeLockdown(
      {
        lockdown,
        guardianRef: GUARDIAN_A,
        reason: "false alarm",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    const revokedLockdown = revoked.lockdown;

    expect(lockdownState(revokedLockdown, LATER)).toBe("revoked");
    expect(isLockdownActive(revokedLockdown, LATER)).toBe(false);

    const reRevoke = revokeLockdown(
      {
        lockdown: revokedLockdown,
        guardianRef: GUARDIAN_B,
        reason: "double off-switch",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(reRevoke).toMatchObject({ ok: false, error: "lockdown_not_active" });

    const lift = liftLockdown(
      {
        lockdown: revokedLockdown,
        guardianRef: GUARDIAN_B,
        reason: "lift a revoked lockdown",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(lift).toMatchObject({ ok: false, error: "lockdown_not_active" });

    const renew = renewLockdown(
      {
        lockdown: revokedLockdown,
        guardianRef: GUARDIAN_B,
        reason: "renew a revoked lockdown",
        authorizedGuardians: GUARDIANS,
        newExpiresAt: RENEWED,
        maxExpiresAt: RENEW_CEILING,
        maxRenewals: 2,
        now: LATER,
      },
      sink,
    );
    expect(renew).toMatchObject({ ok: false, error: "lockdown_not_active" });

    // Revocation survives the decay of the original window: still revoked at
    // any later instant, and never active again.
    expect(lockdownState(revokedLockdown, "2026-10-03T00:00:00.000Z")).toBe("revoked");
    expect(kindsOf(sink)).toEqual([
      "LOCKDOWN_DECLARED",
      "LOCKDOWN_REVOKED",
      "LOCKDOWN_REVOKE_DENIED",
      "LOCKDOWN_LIFT_DENIED",
      "LOCKDOWN_RENEW_DENIED",
    ]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Bounded renewal of the emergency window
 * ────────────────────────────────────────────────────────────*/

describe("Bounded emergency-window renewal (renewLockdown)", () => {
  it("a second guardian can extend the window under the ceiling and cap, audited", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declareGlobal(sink, GUARDIAN_A);

    const renewed = renewLockdown(
      {
        lockdown,
        guardianRef: GUARDIAN_B,
        reason: "intrusion still contained, investigation ongoing",
        authorizedGuardians: GUARDIANS,
        newExpiresAt: RENEWED,
        maxExpiresAt: RENEW_CEILING,
        maxRenewals: 2,
        now: LATER,
      },
      sink,
    );
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.lockdown).toMatchObject({
      id: "ld-h311-global",
      expiresAt: RENEWED,
      renewalCount: 1,
      lastRenewedAt: LATER,
      lastRenewedBy: GUARDIAN_B,
      lastRenewalReason: "intrusion still contained, investigation ongoing",
      // Renewal neither lifts nor revokes.
      liftedAt: null,
      revokedAt: null,
    });
    expect(Object.isFrozen(renewed.lockdown)).toBe(true);
    expect(sink.events.at(-1)).toMatchObject({
      kind: "LOCKDOWN_RENEWED",
      at: LATER,
      lockdownId: "ld-h311-global",
      renewedBy: GUARDIAN_B,
      newExpiresAt: RENEWED,
      renewalCount: 1,
    });

    // The deny CONTINUES under the renewed window (past the old expiry).
    const outcome = evaluateLockdownBoundary(
      {
        lockdowns: [renewed.lockdown],
        request: request(),
        now: "2026-10-02T19:00:00.000Z",
      },
      sink,
    );
    expect(outcome.decision).toBe("DENY");
    // The original declaration is untouched.
    expect(lockdown.expiresAt).toBe(EXPIRY);
  });

  it("the declarer cannot renew their own lockdown (no self-extension)", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declareGlobal(sink, GUARDIAN_A);
    const attempt = renewLockdown(
      {
        lockdown,
        guardianRef: GUARDIAN_A,
        reason: "declarer extends own emergency power",
        authorizedGuardians: GUARDIANS,
        newExpiresAt: RENEWED,
        maxExpiresAt: RENEW_CEILING,
        maxRenewals: 2,
        now: LATER,
      },
      sink,
    );
    expect(attempt).toMatchObject({ ok: false, error: "renewal_independence_denied" });
    expect(sink.events.at(-1)).toMatchObject({
      kind: "LOCKDOWN_RENEW_DENIED",
      guardianRef: GUARDIAN_A,
      denyReason: "renewal_independence_denied",
    });
    expect(lockdown.expiresAt).toBe(EXPIRY);
  });

  it("a targeted agent cannot renew its own lockdown even when guardian-listed", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declareAgentScope(sink, [...GUARDIANS, AGENT_X]);
    const attempt = renewLockdown(
      {
        lockdown,
        guardianRef: AGENT_X,
        reason: "the locked-out agent renews its containment",
        authorizedGuardians: [...GUARDIANS, AGENT_X],
        newExpiresAt: RENEWED,
        maxExpiresAt: RENEW_CEILING,
        maxRenewals: 2,
        now: LATER,
      },
      sink,
    );
    expect(attempt).toMatchObject({ ok: false, error: "self_renew_denied" });
    expect(sink.events.at(-1)).toMatchObject({ kind: "LOCKDOWN_RENEW_DENIED" });
  });

  it("every malformed renewal fails closed with an audited denial", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declareGlobal(sink, GUARDIAN_A);
    const base = {
      lockdown,
      guardianRef: GUARDIAN_B,
      authorizedGuardians: GUARDIANS,
      maxExpiresAt: RENEW_CEILING,
      maxRenewals: 1,
      now: LATER,
    };
    const cases: Array<{ input: typeof base & { reason: string; newExpiresAt: string; maxRenewals?: number }; error: string }> = [
      {
        input: { ...base, reason: "", newExpiresAt: RENEWED },
        error: "renewal_reason_required",
      },
      {
        input: { ...base, reason: "not parseable", newExpiresAt: "not-a-timestamp" },
        error: "renewal_expiry_invalid",
      },
      {
        input: { ...base, reason: "not an extension", newExpiresAt: EXPIRY },
        error: "renewal_expiry_invalid",
      },
      {
        input: { ...base, reason: "backwards", newExpiresAt: NOW },
        error: "renewal_expiry_invalid",
      },
      {
        input: { ...base, reason: "past the ceiling", newExpiresAt: "2026-10-02T23:30:00.000Z" },
        error: "renewal_expiry_exceeds_cap",
      },
      {
        input: { ...base, reason: "cap too low", newExpiresAt: RENEWED, maxRenewals: 0 },
        error: "renewal_cap_invalid",
      },
      {
        input: { ...base, reason: "non-integer cap", newExpiresAt: RENEWED, maxRenewals: 1.5 },
        error: "renewal_cap_invalid",
      },
    ];
    for (const { input, error } of cases) {
      const attempt = renewLockdown(input, sink);
      expect(attempt, error).toMatchObject({ ok: false, error });
      expect(sink.events.at(-1)).toMatchObject({
        kind: "LOCKDOWN_RENEW_DENIED",
        denyReason: error,
      });
    }
    expect(lockdown.expiresAt).toBe(EXPIRY);
  });

  it("the renewal cap is honored: the count is terminal and audited", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declareGlobal(sink, GUARDIAN_A);

    const first = renewLockdown(
      {
        lockdown,
        guardianRef: GUARDIAN_B,
        reason: "first renewal",
        authorizedGuardians: GUARDIANS,
        newExpiresAt: RENEWED,
        maxExpiresAt: RENEW_CEILING,
        maxRenewals: 1,
        now: LATER,
      },
      sink,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = renewLockdown(
      {
        lockdown: first.lockdown,
        guardianRef: GUARDIAN_B,
        reason: "second renewal past the cap",
        authorizedGuardians: GUARDIANS,
        newExpiresAt: "2026-10-02T22:00:00.000Z",
        maxExpiresAt: RENEW_CEILING,
        maxRenewals: 1,
        now: "2026-10-02T14:00:00.000Z",
      },
      sink,
    );
    expect(second).toMatchObject({ ok: false, error: "renewal_cap_reached" });
    expect(sink.events.at(-1)).toMatchObject({
      kind: "LOCKDOWN_RENEW_DENIED",
      denyReason: "renewal_cap_reached",
    });
    expect(first.lockdown.renewalCount).toBe(1);
    expect(first.lockdown.expiresAt).toBe(RENEWED);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Lifecycle depth: the revoked state
 * ────────────────────────────────────────────────────────────*/

describe("Lockdown lifecycle states include revocation", () => {
  it("the state vocabulary carries the revoked state", () => {
    expect(LOCKDOWN_STATES).toEqual(["active", "expired", "lifted", "revoked"]);
  });

  it("each terminal path observes exactly one state, and expiry never fires on a revoked declaration", () => {
    const sink = new InMemoryLockdownAuditSink();
    const active = declareGlobal(sink, GUARDIAN_A);
    expect(lockdownState(active, NOW)).toBe("active");

    const lifted = liftLockdown(
      {
        lockdown: active,
        guardianRef: GUARDIAN_B,
        reason: "incident cleared",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(lifted.ok).toBe(true);
    if (lifted.ok) expect(lockdownState(lifted.lockdown, LATER)).toBe("lifted");

    const revokedLockdown = declareGlobal(sink, GUARDIAN_A);
    const revoked = revokeLockdown(
      {
        lockdown: revokedLockdown,
        guardianRef: GUARDIAN_B,
        reason: "false alarm",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    // Long past the original expiry, the state stays revoked — the terminal
    // record wins over window decay.
    expect(lockdownState(revoked.lockdown, "2026-10-03T00:00:00.000Z")).toBe("revoked");
    expect(isLockdownActive(revoked.lockdown, "2026-10-03T00:00:00.000Z")).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Coverage depth: the deny-wins blast-radius view
 * ────────────────────────────────────────────────────────────*/

describe("activeApplicableLockdowns (deny-wins coverage view)", () => {
  it("returns every active covering declaration — including ones whose exemption would clear", () => {
    const sink = new InMemoryLockdownAuditSink();
    const global = declareLockdown(
      {
        id: "ld-cov-global",
        guardianRef: GUARDIAN_A,
        scope: "global",
        reason: "platform-wide containment",
        expiresAt: EXPIRY,
        // GUARDIAN_A is exempt from the global lockdown…
        exemptions: [{ identityRef: GUARDIAN_A, reason: "responder corridor" }],
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    const tenant = declareLockdown(
      {
        id: "ld-cov-tenant",
        guardianRef: GUARDIAN_B,
        scope: "tenant",
        tenantRef: TENANT_A,
        reason: "tenant compromise",
        expiresAt: EXPIRY,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    const otherTenant = declareLockdown(
      {
        id: "ld-cov-other",
        guardianRef: GUARDIAN_B,
        scope: "tenant",
        tenantRef: TENANT_B,
        reason: "another tenant, not this request",
        expiresAt: EXPIRY,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    expect(global.ok && tenant.ok && otherTenant.ok).toBe(true);
    if (!global.ok || !tenant.ok || !otherTenant.ok) return;

    // GUARDIAN_A's request in tenant A: covered by BOTH declarations — the
    // exemption on the global one would clear it, but the deny wins, so the
    // coverage view still lists the global lockdown.
    const coverage = activeApplicableLockdowns(
      [global.lockdown, tenant.lockdown, otherTenant.lockdown],
      request({ identityRef: GUARDIAN_A }),
      LATER,
    );
    expect(coverage.map((lockdown) => lockdown.id)).toEqual(["ld-cov-global", "ld-cov-tenant"]);

    // A request outside every tenant scope is still covered by the GLOBAL
    // declaration (global coverage is platform-wide by definition).
    expect(
      activeApplicableLockdowns(
        [global.lockdown, tenant.lockdown, otherTenant.lockdown],
        request({ tenantRef: "tenant:33333333-3333-3333-3333-333333333333" }),
        LATER,
      ).map((lockdown) => lockdown.id),
    ).toEqual(["ld-cov-global"]);

    // With only tenant-scoped declarations, a request in an untouched
    // tenant gets an empty coverage view.
    expect(
      activeApplicableLockdowns(
        [tenant.lockdown, otherTenant.lockdown],
        request({ tenantRef: "tenant:33333333-3333-3333-3333-333333333333" }),
        LATER,
      ),
    ).toEqual([]);
  });

  it("excludes declarations that are expired, lifted or revoked", () => {
    const sink = new InMemoryLockdownAuditSink();
    const expired = declareLockdown(
      {
        id: "ld-cov-expired",
        guardianRef: GUARDIAN_A,
        scope: "global",
        reason: "decayed window",
        expiresAt: "2026-10-02T12:30:00.000Z",
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    const liftedBase = declareGlobal(sink, GUARDIAN_A);
    const lifted = liftLockdown(
      {
        lockdown: liftedBase,
        guardianRef: GUARDIAN_B,
        reason: "incident cleared",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    const revokedBase = declareGlobal(sink, GUARDIAN_A);
    const revoked = revokeLockdown(
      {
        lockdown: revokedBase,
        guardianRef: GUARDIAN_B,
        reason: "false alarm",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(expired.ok && lifted.ok && revoked.ok).toBe(true);
    if (!expired.ok || !lifted.ok || !revoked.ok) return;

    const coverage = activeApplicableLockdowns(
      [expired.lockdown, lifted.lockdown, revoked.lockdown],
      request(),
      LATER,
    );
    expect(coverage).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Zod contract depth: fail-closed parse at trust boundaries
 * ────────────────────────────────────────────────────────────*/

describe("Zod contract layer (strict, fail-closed parse)", () => {
  it("parses a real declaration and a real request", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declareGlobal(sink, GUARDIAN_A);
    const parsed = parseLockdownDeclaration(lockdown);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.id).toBe("ld-h311-global");

    const parsedRequest = parseLockdownRequest(request());
    expect(parsedRequest.ok).toBe(true);
    if (parsedRequest.ok) expect(parsedRequest.value).toEqual(request());
  });

  it("refuses tampered declarations fail-closed", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declareGlobal(sink, GUARDIAN_A);
    const tampered: Array<Record<string, unknown>> = [
      // Unknown key injected (strict object refuses excess keys).
      { ...lockdown, exemptions: [...lockdown.exemptions], smuggled: true },
      // Scope outside the bounded vocabulary.
      { ...lockdown, scope: "universe" },
      // Exemption without the mandatory reason.
      { ...lockdown, exemptions: [{ identityRef: GUARDIAN_A }] },
      // Non-enumerated scope discriminator + negative renewal ledger.
      { ...lockdown, renewalCount: -1 },
    ];
    for (const candidate of tampered) {
      const parsed = parseLockdownDeclaration(candidate);
      expect(parsed.ok, JSON.stringify(Object.keys(candidate))).toBe(false);
      expect(parsed).toMatchObject({ ok: false, error: "lockdown_declaration_invalid" });
    }
  });

  it("parses every emitted audit event and refuses unknown kinds", () => {
    const sink = new InMemoryLockdownAuditSink();
    const lockdown = declareGlobal(sink, GUARDIAN_A);
    declareLockdown(
      {
        id: "ld-h311-denied",
        guardianRef: "identity:intruder",
        scope: "global",
        reason: "unauthorized declaration attempt",
        expiresAt: EXPIRY,
        authorizedGuardians: GUARDIANS,
        now: NOW,
      },
      sink,
    );
    evaluateLockdownBoundary({ lockdowns: [lockdown], request: request(), now: LATER }, sink);
    evaluateLockdownBoundary(
      { lockdowns: [], request: request(), now: LATER },
      sink,
    );
    const revoked = revokeLockdown(
      {
        lockdown,
        guardianRef: GUARDIAN_A,
        reason: "false alarm",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    // Revocation is pure: the denied paths below must operate on the NEW
    // terminal object, not the still-active original declaration.
    revokeLockdown(
      {
        lockdown: revoked.lockdown,
        guardianRef: GUARDIAN_A,
        reason: "re-revoke of a revoked lockdown",
        authorizedGuardians: GUARDIANS,
        now: LATER,
      },
      sink,
    );
    renewLockdown(
      {
        lockdown: revoked.lockdown,
        guardianRef: GUARDIAN_B,
        reason: "renew a revoked lockdown",
        authorizedGuardians: GUARDIANS,
        newExpiresAt: RENEWED,
        maxExpiresAt: RENEW_CEILING,
        maxRenewals: 1,
        now: LATER,
      },
      sink,
    );

    const kinds = kindsOf(sink);
    expect(kinds).toEqual([
      "LOCKDOWN_DECLARED",
      "LOCKDOWN_DECLARE_DENIED",
      "LOCKDOWN_REQUEST_DENIED",
      "LOCKDOWN_REVOKED",
      "LOCKDOWN_REVOKE_DENIED",
      "LOCKDOWN_RENEW_DENIED",
    ]);
    for (const event of sink.events as readonly LockdownAuditEvent[]) {
      const parsed = parseLockdownAuditEvent(event);
      expect(parsed.ok, event.kind).toBe(true);
      if (parsed.ok) expect(parsed.value.kind).toBe(event.kind);
    }

    const unknown = parseLockdownAuditEvent({ kind: "LOCKDOWN_ALLOW_ALL", at: LATER });
    expect(unknown).toMatchObject({ ok: false, error: "lockdown_audit_event_invalid" });
    const smuggled = parseLockdownAuditEvent({
      kind: "LOCKDOWN_REVOKED",
      at: LATER,
      lockdownId: "ld-h311-global",
      revokedBy: GUARDIAN_A,
      reason: "false alarm",
      escalationHint: "grant-everything",
    });
    expect(smuggled).toMatchObject({ ok: false, error: "lockdown_audit_event_invalid" });
  });
});
