/**
 * Who may write an authentication audit row, and which identity that row
 * may name. Client-supplied user ids are never an identity.
 */

export const SESSION_BOUND_AUDIT_EVENTS = ["login_succeeded", "password_reset_completed"] as const;
export const ANONYMOUS_AUDIT_EVENTS = ["password_reset_requested", "login_failed"] as const;

export const AUDIT_INGEST_EVENTS = [
  ...ANONYMOUS_AUDIT_EVENTS,
  ...SESSION_BOUND_AUDIT_EVENTS,
] as const;

export type AuditIngestEvent = (typeof AUDIT_INGEST_EVENTS)[number];

export type VerifiedAuditUser = { userId: string; email: string | null };
export type DirectoryAuditUser = { userId: string; schoolId: string | null };

export function isAuditIngestEvent(value: string): value is AuditIngestEvent {
  return (AUDIT_INGEST_EVENTS as readonly string[]).includes(value);
}

export function auditEventRequiresSession(event: string): boolean {
  return (SESSION_BOUND_AUDIT_EVENTS as readonly string[]).includes(event);
}

/**
 * Returns the actor to store, or null when a session-bound event has no
 * verified caller. Anonymous events never inherit a directory user id from
 * a login-failure claim: that claim is the caller's word, not an observation.
 */
export function bindAuditActor(input: {
  event: AuditIngestEvent;
  verified: VerifiedAuditUser | null;
  claimedEmail: string | null;
  directory: DirectoryAuditUser | null;
}): { userId: string | null; schoolId: string | null; email: string | null } | null {
  if (auditEventRequiresSession(input.event)) {
    if (!input.verified) return null;
    const sameUser = input.directory?.userId === input.verified.userId;
    return {
      userId: input.verified.userId,
      schoolId: sameUser ? (input.directory?.schoolId ?? null) : null,
      email: input.verified.email,
    };
  }
  if (input.event === "password_reset_requested") {
    return {
      userId: input.directory?.userId ?? null,
      schoolId: input.directory?.schoolId ?? null,
      email: input.claimedEmail,
    };
  }
  return { userId: null, schoolId: null, email: input.claimedEmail };
}
