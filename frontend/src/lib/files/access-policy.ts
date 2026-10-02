/**
 * CoreGrid — file access policy (MISSION-V1-012 files, V5.3 Part 22).
 *
 * Pure access decision for the files service: principal + FileDescriptor ->
 * allow | deny. Deny by default. Owner is always allowed (within their own
 * tenant), explicit grants are honored only while unexpired, and cross-tenant
 * access is ALWAYS denied with an explicit reason — including for platform
 * super-admins (no control-plane bypass in V1; escalation is a separate
 * governed flow, Constitution §16).
 *
 * This module decides nothing about storage: RLS remains the boundary and the
 * storage adapter enforces the tenant path prefix independently.
 */
import type { FileDescriptor } from "./file-contract";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

export interface FileGrantRef {
  /** The fileId this grant refers to. */
  fileId: string;
  /** ISO timestamp after which the grant is dead. Null/undefined = no expiry. */
  expiresAt?: string | null;
}

export interface FilePrincipal {
  userId: string;
  tenantId: string;
  role: string;
  /** Explicit grants held by this principal. */
  grants: readonly FileGrantRef[];
  /**
   * Control-plane signal, accepted for future governance flows only. It never
   * widens file access in V1 (cross-tenant stays denied).
   */
  isPlatformSuper?: boolean;
}

export type FileAccessAllowReason = "owner" | "org_shared" | "explicit_grant";

export type FileAccessDenyCode =
  | "cross_tenant"
  | "private_no_owner"
  | "no_grant"
  | "grant_expired";

export type FileAccessDecision =
  | { decision: "allow"; reason: FileAccessAllowReason }
  | { decision: "deny"; code: FileAccessDenyCode; reason: string };

function isExpired(grant: FileGrantRef, now: Date): boolean {
  if (!grant.expiresAt) return false;
  const parsed = Date.parse(grant.expiresAt);
  if (Number.isNaN(parsed)) return true; // unparseable expiry fails closed
  return parsed <= now.getTime();
}

/**
 * Decide read access to a file. Order of evaluation: tenant boundary first,
 * then owner, then sharing model. Every non-allow path is an explicit deny.
 */
export function decideFileAccess(
  principal: FilePrincipal,
  descriptor: FileDescriptor,
  now: Date = new Date(timeAuthority.now().atMs),
): FileAccessDecision {
  if (principal.tenantId !== descriptor.tenantId) {
    return {
      decision: "deny",
      code: "cross_tenant",
      reason: `principal tenant "${principal.tenantId}" does not match file tenant "${descriptor.tenantId}"`,
    };
  }
  if (!principal.userId.trim()) {
    return { decision: "deny", code: "private_no_owner", reason: "principal has no user id" };
  }
  if (descriptor.ownerRef === principal.userId) {
    return { decision: "allow", reason: "owner" };
  }

  const { visibility } = descriptor.sharing;
  if (visibility === "org") {
    return { decision: "allow", reason: "org_shared" };
  }
  if (visibility === "explicit") {
    const grant = principal.grants.find(
      (candidate) => candidate.fileId === descriptor.fileId,
    );
    if (!grant) {
      return {
        decision: "deny",
        code: "no_grant",
        reason: `no grant ref for file "${descriptor.fileId}"`,
      };
    }
    if (isExpired(grant, now)) {
      return {
        decision: "deny",
        code: "grant_expired",
        reason: `grant for file "${descriptor.fileId}" expired at ${grant.expiresAt ?? "unknown"}`,
      };
    }
    return { decision: "allow", reason: "explicit_grant" };
  }

  return {
    decision: "deny",
    code: "private_no_owner",
    reason: "private files are readable by their owner only",
  };
}
