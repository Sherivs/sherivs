/**
 * CoreGrid — Security Engine session security controls (Phase 08,
 * Section L).
 *
 * Implements `architecture/phase-08-security-engine.md`:
 * - Session controls (L.2): expiration, idle timeout, refresh-token rotation,
 *   revocation, concurrent-session controls, suspicious-session detection,
 *   device binding, step-up authentication triggers.
 * - Session revocation must propagate quickly (L.3).
 *
 * Boundary: Phase 02 (`identity.ts`) owns the canonical `IdentitySession`
 * record and its lifecycle transitions. This module adds the *security*
 * evaluation layer on top: idle timeout, concurrency limits, step-up
 * triggers, and device-binding checks that decide whether a session in an
 * otherwise-valid Phase 02 state should still be trusted right now.
 */

import type { IdentitySession } from "./identity";

/* ─────────────────────────────────────────────────────────────
 * Idle timeout & expiration evaluation
 * ────────────────────────────────────────────────────────────*/

export interface SessionSecurityPolicy {
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
  maxConcurrentSessions: number;
  requireDeviceBinding: boolean;
}

export type SessionSecurityEvaluation =
  { ok: true } | { ok: false; reason: string; requiresStepUp: boolean };

export function evaluateSessionSecurity(
  session: IdentitySession,
  policy: SessionSecurityPolicy,
  lastActivityAt: string,
  now: string,
): SessionSecurityEvaluation {
  if (session.status !== "active") {
    return {
      ok: false,
      reason: `Session status '${session.status}' is not usable`,
      requiresStepUp: true,
    };
  }
  if (session.expiresAt !== null && Date.parse(now) >= Date.parse(session.expiresAt)) {
    return { ok: false, reason: "Session has expired", requiresStepUp: true };
  }
  const idleMs = Date.parse(now) - Date.parse(lastActivityAt);
  if (idleMs >= policy.idleTimeoutMs) {
    return { ok: false, reason: "Session exceeded idle timeout", requiresStepUp: true };
  }
  const absoluteMs = Date.parse(now) - Date.parse(session.createdAt);
  if (absoluteMs >= policy.absoluteTimeoutMs) {
    return { ok: false, reason: "Session exceeded absolute lifetime", requiresStepUp: true };
  }
  if (policy.requireDeviceBinding && session.deviceFingerprint === null) {
    return { ok: false, reason: "Device binding is required but missing", requiresStepUp: true };
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Concurrent session limits
 * ────────────────────────────────────────────────────────────*/

export interface ConcurrentSessionResult {
  allowed: boolean;
  reason: string | null;
  sessionsToRevoke: IdentitySession[];
}

/**
 * Evaluate whether a new session may be created given the actor's existing
 * active sessions and a concurrency policy. When the limit is exceeded, the
 * oldest active sessions are marked for revocation rather than silently
 * blocking the new (typically more legitimate, freshly authenticated)
 * session — but the caller decides the actual eviction policy.
 */
export function evaluateConcurrentSessions(
  activeSessions: IdentitySession[],
  maxConcurrentSessions: number,
): ConcurrentSessionResult {
  if (maxConcurrentSessions <= 0) {
    return {
      allowed: false,
      reason: "Concurrent session policy misconfigured",
      sessionsToRevoke: [],
    };
  }
  if (activeSessions.length < maxConcurrentSessions) {
    return { allowed: true, reason: null, sessionsToRevoke: [] };
  }
  const sorted = [...activeSessions].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  const excess = sorted.length - maxConcurrentSessions + 1;
  return {
    allowed: true,
    reason: "Concurrent session limit reached; oldest sessions will be revoked",
    sessionsToRevoke: sorted.slice(0, excess),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Session revocation (Section L.3)
 * ────────────────────────────────────────────────────────────*/

export interface RevokeSessionResult {
  session: IdentitySession;
  revokedAt: string;
}

export function revokeSession(
  session: IdentitySession,
  reason: string,
  now: string,
): RevokeSessionResult {
  return {
    session: {
      ...session,
      status: "revoked",
      revokeReason: reason,
    },
    revokedAt: now,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Step-up authentication triggers
 * ────────────────────────────────────────────────────────────*/

export type StepUpTrigger =
  | "idle_timeout"
  | "new_device"
  | "elevated_risk"
  | "sensitive_operation"
  | "concurrent_session_conflict";

export function requiresStepUp(triggers: StepUpTrigger[]): boolean {
  return triggers.length > 0;
}
