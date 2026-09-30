/**
 * CoreGrid Scholar — Phase 08 Security Engine unit tests (security-session).
 *
 * Validates:
 * - Session security evaluation: expiration, idle timeout, absolute
 *   timeout, device binding (Section L.2).
 * - Concurrent session limits (Section L.2).
 * - Session revocation (Section L.3).
 * - Step-up authentication triggers.
 */

import { describe, expect, it } from "vitest";
import { identityId, type IdentitySession } from "@/lib/identity";
import {
  evaluateSessionSecurity,
  evaluateConcurrentSessions,
  revokeSession,
  requiresStepUp,
  type SessionSecurityPolicy,
} from "@/lib/security-session";

const NOW = "2026-01-01T01:00:00Z";

function baseSession(overrides: Partial<IdentitySession> = {}): IdentitySession {
  return {
    id: "session-1",
    identityId: identityId("identity-1"),
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: null,
    revokeReason: null,
    deviceFingerprint: "device-abc",
    ...overrides,
  };
}

const LENIENT_POLICY: SessionSecurityPolicy = {
  idleTimeoutMs: 30 * 60 * 1000,
  absoluteTimeoutMs: 24 * 60 * 60 * 1000,
  maxConcurrentSessions: 3,
  requireDeviceBinding: false,
};

describe("evaluateSessionSecurity (Section L.2)", () => {
  it("rejects a non-active session", () => {
    const session = baseSession({ status: "revoked" });
    const result = evaluateSessionSecurity(session, LENIENT_POLICY, NOW, NOW);
    expect(result.ok).toBe(false);
  });

  it("rejects an expired session", () => {
    const session = baseSession({ expiresAt: "2026-01-01T00:30:00Z" });
    const result = evaluateSessionSecurity(session, LENIENT_POLICY, NOW, "2026-01-01T00:45:00Z");
    expect(result.ok).toBe(false);
  });

  it("rejects a session exceeding idle timeout", () => {
    const session = baseSession();
    const policy: SessionSecurityPolicy = { ...LENIENT_POLICY, idleTimeoutMs: 5 * 60 * 1000 };
    const result = evaluateSessionSecurity(
      session,
      policy,
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:10:00Z",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.requiresStepUp).toBe(true);
  });

  it("rejects a session exceeding absolute lifetime", () => {
    const session = baseSession({ createdAt: "2025-12-01T00:00:00Z" });
    const policy: SessionSecurityPolicy = { ...LENIENT_POLICY, absoluteTimeoutMs: 60 * 60 * 1000 };
    const result = evaluateSessionSecurity(session, policy, NOW, NOW);
    expect(result.ok).toBe(false);
  });

  it("rejects when device binding is required but missing", () => {
    const session = baseSession({ deviceFingerprint: null });
    const policy: SessionSecurityPolicy = { ...LENIENT_POLICY, requireDeviceBinding: true };
    const result = evaluateSessionSecurity(session, policy, NOW, NOW);
    expect(result.ok).toBe(false);
  });

  it("allows a fresh, active, bound session", () => {
    const session = baseSession();
    const result = evaluateSessionSecurity(session, LENIENT_POLICY, NOW, NOW);
    expect(result.ok).toBe(true);
  });
});

describe("evaluateConcurrentSessions (Section L.2)", () => {
  it("allows when under the concurrency limit", () => {
    const sessions = [baseSession({ id: "s1" })];
    const result = evaluateConcurrentSessions(sessions, 3);
    expect(result.allowed).toBe(true);
    expect(result.sessionsToRevoke).toHaveLength(0);
  });

  it("flags the oldest sessions for revocation when at the limit", () => {
    const sessions = [
      baseSession({ id: "s1", createdAt: "2025-12-01T00:00:00Z" }),
      baseSession({ id: "s2", createdAt: "2025-12-02T00:00:00Z" }),
      baseSession({ id: "s3", createdAt: "2025-12-03T00:00:00Z" }),
    ];
    const result = evaluateConcurrentSessions(sessions, 3);
    expect(result.sessionsToRevoke.map((s) => s.id)).toEqual(["s1"]);
  });

  it("rejects a misconfigured policy (limit <= 0)", () => {
    const result = evaluateConcurrentSessions([], 0);
    expect(result.allowed).toBe(false);
  });
});

describe("revokeSession (Section L.3)", () => {
  it("marks the session revoked with a reason", () => {
    const session = baseSession();
    const result = revokeSession(session, "Suspicious activity detected", NOW);
    expect(result.session.status).toBe("revoked");
    expect(result.session.revokeReason).toBe("Suspicious activity detected");
    expect(result.revokedAt).toBe(NOW);
  });
});

describe("requiresStepUp", () => {
  it("returns false with no triggers", () => {
    expect(requiresStepUp([])).toBe(false);
  });

  it("returns true with at least one trigger", () => {
    expect(requiresStepUp(["elevated_risk"])).toBe(true);
  });
});
