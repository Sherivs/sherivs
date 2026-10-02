/**
 * CoreGrid Identity Relationship Engine.
 *
 * Implements `architecture/phase-02-identity.md` F7 + G10:
 * - Relationships are first-class objects.
 * - Relationships are revocable and time-bounded.
 * - ReBAC uses relationships for authorization.
 * - No cross-tenant relationship leakage.
 */

import type { IdentityId, IdentityRelationship, RelationshipType } from "./identity";
import { RELATIONSHIP_TYPES } from "./identity";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Relationship creation
 * ────────────────────────────────────────────────────────────*/

export interface CreateRelationshipInput {
  subjectId: IdentityId;
  type: RelationshipType;
  targetId: string;
  scope?: string | null;
  expiresAt?: string | null;
  /** Tenant context for isolation checks. */
  tenantId: string | null;
}

export type CreateRelationshipResult =
  { ok: true; relationship: IdentityRelationship } | { ok: false; error: string };

export function createRelationship(
  input: CreateRelationshipInput,
  now: string = timeAuthority.now().at,
): CreateRelationshipResult {
  // Validate relationship type.
  if (!RELATIONSHIP_TYPES.includes(input.type)) {
    return { ok: false, error: `Unknown relationship type: ${input.type}` };
  }

  // Validate expiry is in the future.
  if (input.expiresAt && input.expiresAt <= now) {
    return { ok: false, error: "Relationship expiry must be in the future" };
  }

  const relationship: IdentityRelationship = {
    id: crypto.randomUUID(),
    subjectId: input.subjectId,
    type: input.type,
    targetId: input.targetId,
    scope: input.scope ?? null,
    createdAt: now,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
    version: 1,
  };

  return { ok: true, relationship };
}

/* ─────────────────────────────────────────────────────────────
 * Relationship revocation
 * ────────────────────────────────────────────────────────────*/

export function revokeRelationship(
  relationship: IdentityRelationship,
  now: string = timeAuthority.now().at,
): IdentityRelationship {
  return {
    ...relationship,
    revokedAt: now,
    version: relationship.version + 1,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Relationship queries
 * ────────────────────────────────────────────────────────────*/

export function isRelationshipActive(
  relationship: IdentityRelationship,
  now: string = timeAuthority.now().at,
): boolean {
  if (relationship.revokedAt !== null) return false;
  if (relationship.expiresAt !== null && relationship.expiresAt <= now) return false;
  return true;
}

export function activeRelationships(
  relationships: IdentityRelationship[],
  now: string = timeAuthority.now().at,
): IdentityRelationship[] {
  return relationships.filter((r) => isRelationshipActive(r, now));
}

export function relationshipsOfType(
  relationships: IdentityRelationship[],
  type: RelationshipType,
  now: string = timeAuthority.now().at,
): IdentityRelationship[] {
  return activeRelationships(relationships, now).filter((r) => r.type === type);
}

export function relationshipsForSubject(
  relationships: IdentityRelationship[],
  subjectId: IdentityId,
  now: string = timeAuthority.now().at,
): IdentityRelationship[] {
  return activeRelationships(relationships, now).filter((r) => r.subjectId === subjectId);
}

export function relationshipsForTarget(
  relationships: IdentityRelationship[],
  targetId: string,
  now: string = timeAuthority.now().at,
): IdentityRelationship[] {
  return activeRelationships(relationships, now).filter((r) => r.targetId === targetId);
}

/* ─────────────────────────────────────────────────────────────
 * Tenant isolation guard
 * ────────────────────────────────────────────────────────────*/

/**
 * Verify that a relationship does not cross tenant boundaries.
 * Relationships must stay within the same tenant unless explicitly
 * authorized by CoreGrid policy (per AGENTS.md §29).
 */
export function isTenantSafe(
  relationship: IdentityRelationship,
  subjectTenantId: string | null,
  targetTenantId: string | null,
): boolean {
  if (subjectTenantId === null || targetTenantId === null) return true;
  return subjectTenantId === targetTenantId;
}
