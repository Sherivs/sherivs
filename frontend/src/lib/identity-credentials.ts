/**
 * CoreGrid Identity Credential Metadata Engine.
 *
 * Implements `architecture/phase-02-identity.md` H9 + J3:
 * - Credential metadata only; raw secrets live outside ordinary tables.
 * - Tokens must have expiration, scope, audience, issuer, revocation strategy.
 * - Credential status transitions are policy-controlled.
 * - Secrets must never be logged.
 */

import type { CredentialKind, CredentialMetadata, CredentialStatus, IdentityId } from "./identity";
import { canTransitionCredential } from "./identity";

/* ─────────────────────────────────────────────────────────────
 * Credential creation
 * ────────────────────────────────────────────────────────────*/

export interface CreateCredentialInput {
  identityId: IdentityId;
  kind: CredentialKind;
  /** Optional expiry (RFC 3339). */
  expiresAt?: string | null;
  /** Hash algorithm + fingerprint — never the secret itself. */
  fingerprint: string;
}

export type CreateCredentialResult =
  { ok: true; credential: CredentialMetadata } | { ok: false; error: string };

export function createCredential(
  input: CreateCredentialInput,
  now: string = new Date().toISOString(),
): CreateCredentialResult {
  if (!input.fingerprint.trim()) {
    return { ok: false, error: "Credential fingerprint is required" };
  }

  if (input.expiresAt && input.expiresAt <= now) {
    return { ok: false, error: "Credential expiry must be in the future" };
  }

  const credential: CredentialMetadata = {
    id: crypto.randomUUID(),
    identityId: input.identityId,
    kind: input.kind,
    status: "pending",
    issuedAt: now,
    expiresAt: input.expiresAt ?? null,
    lastUsedAt: null,
    fingerprint: input.fingerprint,
  };

  return { ok: true, credential };
}

/* ─────────────────────────────────────────────────────────────
 * Credential status transitions
 * ────────────────────────────────────────────────────────────*/

export type CredentialTransitionResult =
  { ok: true; credential: CredentialMetadata } | { ok: false; error: string };

export function transitionCredentialStatus(
  credential: CredentialMetadata,
  to: CredentialStatus,
  now: string = new Date().toISOString(),
): CredentialTransitionResult {
  if (!canTransitionCredential(credential.status, to)) {
    return {
      ok: false,
      error: `Invalid credential status transition: ${credential.status} -> ${to}`,
    };
  }

  return {
    ok: true,
    credential: { ...credential, status: to },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Credential lifecycle helpers
 * ────────────────────────────────────────────────────────────*/

export function isCredentialActive(
  credential: CredentialMetadata,
  now: string = new Date().toISOString(),
): boolean {
  if (credential.status !== "active") return false;
  if (credential.expiresAt !== null && credential.expiresAt <= now) return false;
  return true;
}

export function isCredentialExpired(
  credential: CredentialMetadata,
  now: string = new Date().toISOString(),
): boolean {
  return credential.expiresAt !== null && credential.expiresAt <= now;
}

export function markCredentialUsed(
  credential: CredentialMetadata,
  now: string = new Date().toISOString(),
): CredentialMetadata {
  return { ...credential, lastUsedAt: now };
}

/* ─────────────────────────────────────────────────────────────
 * Credential policy
 * ────────────────────────────────────────────────────────────*/

export interface CredentialPolicy {
  /** Maximum credential lifetime in seconds. */
  maxLifetimeSeconds: number;
  /** Require rotation after this many seconds. */
  rotationPeriodSeconds: number;
  /** Allowed kinds for this identity kind. */
  allowedKinds: CredentialKind[];
}

export function validateCredentialAgainstPolicy(
  credential: CredentialMetadata,
  policy: CredentialPolicy,
  now: string = new Date().toISOString(),
): { valid: boolean; reason: string } {
  if (!policy.allowedKinds.includes(credential.kind)) {
    return {
      valid: false,
      reason: `Credential kind '${credential.kind}' is not allowed by policy`,
    };
  }

  if (credential.expiresAt === null) {
    return {
      valid: false,
      reason: "Credential must have an expiry",
    };
  }

  const lifetimeMs =
    new Date(credential.expiresAt).getTime() - new Date(credential.issuedAt).getTime();
  if (lifetimeMs > policy.maxLifetimeSeconds * 1000) {
    return {
      valid: false,
      reason: `Credential lifetime exceeds policy maximum of ${policy.maxLifetimeSeconds}s`,
    };
  }

  return { valid: true, reason: "Credential complies with policy" };
}
