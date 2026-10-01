/**
 * CoreGrid — Phase 02 identity actor context (live server-function primitive).
 *
 * Bridges the authenticated session (supabase claims: `sub`, `email`) and the
 * `users` row (role, school_id, is_active) into one validated IdentityActor
 * that server functions can rely on. Pure and unit-testable; no DB access.
 *
 * Boundary: this module OWNS nothing — identity canonical state lives in
 * Phase 02 (`identity.ts` / DB). It only resolves and validates the actor
 * context used at runtime boundaries. Platform roles (super_admin, hq) are
 * tenant-independent; school roles require a school scope.
 *
 * Lifecycle enforcement (AGENTS §31 — expired/revoked access fails): the
 * source may carry the canonical Phase 02 lifecycle state and the session
 * status. When supplied, only usable lifecycle states (active/provisioned)
 * and active sessions resolve; suspended/deleted/archived/pre-activation
 * identities and expired/revoked/terminated sessions fail closed. Unknown
 * lifecycle values also fail closed. The resolved actor carries the
 * lifecycle state (null when the source did not supply it) so downstream
 * gates can re-verify instead of trusting a stale assertion.
 */

import type { AppRole } from "./roles";
import {
  IDENTITY_LIFECYCLE_STATES,
  isIdentityUsable,
  type IdentityLifecycleState,
  type SessionStatus,
} from "./identity";

export const PLATFORM_ROLES: readonly AppRole[] = ["super_admin", "hq"] as const;

export const SCHOOL_ROLES: readonly AppRole[] = [
  "admin",
  "principal",
  "teacher",
  "bursar",
  "parent",
  "student",
  "driver",
] as const;

export const ALL_APP_ROLES: readonly AppRole[] = [...PLATFORM_ROLES, ...SCHOOL_ROLES] as const;

/** Parse a stored role string into a known AppRole, or null when unknown. */
export function parseAppRole(raw: string | null | undefined): AppRole | null {
  if (!raw) return null;
  const value = raw.trim();
  return (ALL_APP_ROLES as readonly string[]).includes(value) ? (value as AppRole) : null;
}

export function isPlatformRole(role: AppRole): boolean {
  return (PLATFORM_ROLES as readonly AppRole[]).includes(role);
}

export interface IdentityActorSource {
  /** Authenticated user id (JWT `sub`). */
  userId: string;
  /** Email claim when present. */
  email?: string | null;
  /** Role stored on the users row. */
  role: string | null;
  /** School id from the users row (null for platform roles). */
  schoolId?: string | null;
  /** Row-active flag; inactive actors are never usable. */
  isActive: boolean;
  /**
   * Canonical Phase 02 lifecycle state. Optional (additive): when supplied,
   * only the usable states (`active`/`provisioned`) resolve and unknown
   * values fail closed.
   */
  lifecycle?: IdentityLifecycleState | null;
  /**
   * Canonical session status. Optional (additive): when supplied, only an
   * `active` session resolves — expired/revoked/terminated sessions deny.
   */
  sessionStatus?: SessionStatus | null;
}

export interface IdentityActor {
  userId: string;
  email: string | null;
  role: AppRole;
  schoolId: string | null;
  isPlatform: boolean;
  /**
   * Canonical lifecycle state carried for downstream gates. Null when the
   * source did not supply it — consumers must treat a null lifecycle as
   * lifecycle-unverified, never as verified-active.
   */
  lifecycle: IdentityLifecycleState | null;
}

export type ActorResolution = { ok: true; actor: IdentityActor } | { ok: false; reason: string };

const reasons = {
  missingUser: "Actor user id is required",
  inactive: "Identity is not active",
  lifecycleUnusable: "Identity lifecycle is not usable",
  sessionUnusable: "Session is not active",
  unknownRole: "Role is unknown or missing",
  schoolRequired: "School-scoped role requires a school id",
} as const;

export function resolveIdentityActor(source: IdentityActorSource): ActorResolution {
  if (!source.userId || source.userId.trim() === "") {
    return { ok: false, reason: reasons.missingUser };
  }
  if (!source.isActive) {
    return { ok: false, reason: reasons.inactive };
  }
  if (source.lifecycle != null) {
    // Fail closed on both non-usable and unknown lifecycle values.
    const known = (IDENTITY_LIFECYCLE_STATES as readonly string[]).includes(source.lifecycle);
    if (!known || !isIdentityUsable({ lifecycle: source.lifecycle })) {
      return { ok: false, reason: reasons.lifecycleUnusable };
    }
  }
  if (source.sessionStatus != null && source.sessionStatus !== "active") {
    return { ok: false, reason: reasons.sessionUnusable };
  }
  const role = parseAppRole(source.role);
  if (role === null) {
    return { ok: false, reason: reasons.unknownRole };
  }
  const schoolId = source.schoolId && source.schoolId.trim() !== "" ? source.schoolId : null;
  if (!isPlatformRole(role) && schoolId === null) {
    return { ok: false, reason: reasons.schoolRequired };
  }
  return {
    ok: true,
    actor: {
      userId: source.userId.trim(),
      email: source.email && source.email.trim() !== "" ? source.email : null,
      role,
      schoolId,
      isPlatform: isPlatformRole(role),
      lifecycle: source.lifecycle ?? null,
    },
  };
}

/** Resource scope of the actor for permission checks (school id or null). */
export function actorScope(actor: IdentityActor): string | null {
  return actor.schoolId;
}
