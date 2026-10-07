/**
 * CoreGrid — platform API-key substrate (V1, PLATFORM-019).
 *
 * CoreGrid's own Supabase-style key model: different keys with DIFFERENT
 * functions, so a leaked credential is bounded to what that key class can
 * do. Two key classes in V1:
 *
 *   cg_publishable_…  — client-safe identifier. Binds a client to one
 *     organization; carries NO inherent authority (RLS still governs every
 *     row it can see). Safe in browser bundles by design (analogous to
 *     Supabase's sb_publishable_).
 *   cg_secret_…       — server-side privileged key scoped to one
 *     organization and an explicit scope vector. SERVER ONLY, never bundled
 *     (analogous to Supabase's sb_secret_).
 *
 * Storage law (§30): the platform NEVER stores a key. It stores
 *   keyHash      — sha256 hex of the full key (lookup + verification),
 *   keyPreview   — prefix + first 4 chars of the material (safe display),
 *   fingerprint  — first 12 hex of the sha256 (stable public id).
 * The full plaintext key is returned EXACTLY ONCE at issuance, by the
 * service module, and never logged (§29).
 *
 * Fail-closed laws:
 * - Verification checks: shape → hash → status → expiry → scopes. Any
 *   failure is a typed deny with a reason; a malformed key never throws.
 * - Status transitions: active → revoked only (revocation is terminal);
 *   rotation is re-issuance, never an un-revoke (§28 audit integrity).
 * - A revoked or expired key denies EVEN IF its scopes would otherwise
 *   match — time and revocation always win (§16 risk controls).
 *
 * Storage lives in `cg_api_key` (zero-policy, service-role only — see the
 * migration) and is consumed through `apikey-service.server.ts`.
 *
 * PURE module: no I/O, no network, no environment reads. The only ambient
 * capability used is randomness for generation (injectable for tests).
 */

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Key classes
 * ────────────────────────────────────────────────────────────*/

export const COREGRID_API_KEY_TYPES = ["publishable", "secret"] as const;
export type CoreGridApiKeyType = (typeof COREGRID_API_KEY_TYPES)[number];

/** Prefixes — the visible, unforgeable first segment of every key. */
export const COREGRID_API_KEY_PREFIXES: Readonly<Record<CoreGridApiKeyType, string>> = {
  publishable: "cg_publishable_",
  secret: "cg_secret_",
};

/**
 * V1 scope vocabulary. Every scope a key can carry MUST be in this list —
 * an unknown scope fails validation (no invented authority).
 */
export const COREGRID_KEY_SCOPES = [
  "org:identify",
  "org:read",
  "org:write",
  "missions:read",
  "missions:write",
  "communications:send",
  "webhooks:verify",
] as const;
export type CoreGridKeyScope = (typeof COREGRID_KEY_SCOPES)[number];

/** Inherent scopes per key class — the ceiling a key can never exceed. */
export const INHERENT_KEY_SCOPES: Readonly<Record<CoreGridApiKeyType, readonly CoreGridKeyScope[]>> = {
  publishable: ["org:identify"],
  secret: COREGRID_KEY_SCOPES,
};

/* ─────────────────────────────────────────────────────────────
 * Material format
 * ────────────────────────────────────────────────────────────*/

/** 32 bytes of entropy, base64url (43 chars, no padding, no +/). */
export const KEY_MATERIAL_LENGTH = 43;
const MATERIAL_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const SHA256_HEX_SHAPE = /^[0-9a-f]{64}$/;
const FINGERPRINT_SHAPE = /^[0-9a-f]{12}$/;

export function isWellFormedApiKey(key: string): boolean {
  if (typeof key !== "string") return false;
  const parsed = parseCoreGridApiKey(key);
  return parsed !== null;
}

export interface ParsedCoreGridApiKey {
  type: CoreGridApiKeyType;
  material: string;
}

/** Split a full key into its class + material; null when malformed. */
export function parseCoreGridApiKey(key: string): ParsedCoreGridApiKey | null {
  if (typeof key !== "string") return null;
  for (const type of COREGRID_API_KEY_TYPES) {
    const prefix = COREGRID_API_KEY_PREFIXES[type];
    if (key.startsWith(prefix)) {
      const material = key.slice(prefix.length);
      if (MATERIAL_SHAPE.test(material)) {
        return { type, material };
      }
      return null;
    }
  }
  return null;
}

/** Key class from prefix alone (storage rows carry the type explicitly). */
export function keyTypeFromPrefix(prefix: string): CoreGridApiKeyType | null {
  for (const type of COREGRID_API_KEY_TYPES) {
    if (COREGRID_API_KEY_PREFIXES[type] === prefix) return type;
  }
  return null;
}

export interface GeneratedCoreGridApiKey {
  /** The FULL plaintext key — returned once, never stored, never logged. */
  readonly key: string;
  readonly type: CoreGridApiKeyType;
  readonly material: string;
  /** sha256 hex of the full key — the ONLY lookup form the platform stores. */
  readonly keyHash: string;
  /** prefix + first 4 material chars — safe display. */
  readonly keyPreview: string;
  /** first 12 hex of the sha256 — stable public identifier. */
  readonly fingerprint: string;
}

export type RandomBytesFn = (length: number) => Uint8Array;

function defaultRandomBytes(length: number): Uint8Array {
  return randomBytes(length);
}

function base64UrlOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Generate a fresh key of the given class. `randomImpl` is injectable so
 * tests can pin determinism; production uses node:crypto randomBytes.
 */
export function generateCoreGridApiKey(
  type: CoreGridApiKeyType,
  randomImpl: RandomBytesFn = defaultRandomBytes,
): GeneratedCoreGridApiKey {
  const material = base64UrlOf(randomImpl(32));
  if (!MATERIAL_SHAPE.test(material)) {
    throw new Error("api-key generation produced a malformed material — refusing (fail closed)");
  }
  const key = `${COREGRID_API_KEY_PREFIXES[type]}${material}`;
  const keyHash = hashCoreGridApiKey(key);
  return {
    key,
    type,
    material,
    keyHash,
    keyPreview: `${COREGRID_API_KEY_PREFIXES[type]}${material.slice(0, 4)}`,
    fingerprint: fingerprintOfHash(keyHash),
  };
}

/** sha256 hex of the FULL key — the only lookup form the platform stores. */
export function hashCoreGridApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Stable public identifier derived from a stored hash. */
export function fingerprintOfHash(keyHash: string): string {
  if (!SHA256_HEX_SHAPE.test(keyHash)) {
    throw new Error("api-key hash must be sha256 hex — refusing to fingerprint (fail closed)");
  }
  return keyHash.slice(0, 12);
}

/* ─────────────────────────────────────────────────────────────
 * Stored record shape (zero-policy table cg_api_key; service-role only)
 * ────────────────────────────────────────────────────────────*/

export const COREGRID_API_KEY_STATUSES = ["active", "revoked"] as const;
export type CoreGridApiKeyStatus = (typeof COREGRID_API_KEY_STATUSES)[number];

export const CoreGridApiKeyRecordSchema = z.strictObject({
  apiKeyRef: z.string().trim().min(1).max(160),
  tenantId: z.string().trim().min(1).max(128),
  type: z.enum(COREGRID_API_KEY_TYPES),
  /** sha256 hex of the full key — never the key itself (§30). */
  keyHash: z.string().regex(SHA256_HEX_SHAPE),
  keyPreview: z.string().min(1).max(32),
  fingerprint: z.string().regex(FINGERPRINT_SHAPE),
  scopes: z.array(z.enum(COREGRID_KEY_SCOPES)).min(1),
  status: z.enum(COREGRID_API_KEY_STATUSES),
  createdBy: z.string().trim().min(1).max(160),
  createdAt: z.string(),
  /** null = no expiry. */
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedBy: z.string().nullable(),
  revokeReason: z.string().nullable(),
  note: z.string().nullable(),
});

export type CoreGridApiKeyRecord = z.infer<typeof CoreGridApiKeyRecordSchema>;

/** Storage-row validation: an untrusted read that fails this never verifies. */
export function validateCoreGridApiKeyRecord(record: unknown): CoreGridApiKeyRecord | null {
  const parsed = CoreGridApiKeyRecordSchema.safeParse(record);
  if (!parsed.success) return null;
  // Cross-field coherence: a revoked key must carry who/when provenance.
  const recordValue = parsed.data;
  if (recordValue.status === "revoked" && (recordValue.revokedAt === null || recordValue.revokedBy === null)) {
    return null;
  }
  if (recordValue.status === "active" && (recordValue.revokedAt !== null || recordValue.revokedBy !== null)) {
    return null;
  }
  if (recordValue.fingerprint !== fingerprintOfHash(recordValue.keyHash)) {
    return null;
  }
  return recordValue;
}

/* ─────────────────────────────────────────────────────────────
 * Verification (fail-closed decision, never a throw)
 * ────────────────────────────────────────────────────────────*/

export type CoreGridKeyDenyCode =
  | "malformed_key"
  | "unknown_key"
  | "revoked_key"
  | "expired_key"
  | "scope_not_granted"
  | "scope_outside_class_ceiling";

export type CoreGridKeyVerification =
  | {
      ok: true;
      apiKeyRef: string;
      tenantId: string;
      type: CoreGridApiKeyType;
      scopes: readonly CoreGridKeyScope[];
    }
  | {
      ok: false;
      code: CoreGridKeyDenyCode;
      /** Human-safe reason — NEVER carries key material or hashes. */
      reason: string;
    };

/**
 * Verify a presented key against a stored record (already tenant-fetched by
 * the service module) for the requested scopes.
 *
 * Laws: time and revocation always win over scopes; a publishable key can
 * never exercise a scope outside its inherent ceiling even if a corrupted
 * row claims otherwise (defence in depth); unknown scopes deny.
 */
export function verifyCoreGridApiKey(input: {
  presentedKey: string;
  /** The stored record for hash(presentedKey), or null when not found. */
  record: CoreGridApiKeyRecord | null;
  now: string;
  requestedScopes: readonly CoreGridKeyScope[];
}): CoreGridKeyVerification {
  const parsed = parseCoreGridApiKey(input.presentedKey);
  if (parsed === null) {
    return { ok: false, code: "malformed_key", reason: "presented key is malformed (wrong prefix or material shape)" };
  }
  if (input.record === null) {
    return { ok: false, code: "unknown_key", reason: "no active platform key matches the presented credential" };
  }
  if (input.record.type !== parsed.type) {
    return { ok: false, code: "unknown_key", reason: "no platform key of the presented class matches" };
  }
  const presentedHash = hashCoreGridApiKey(input.presentedKey);
  if (presentedHash !== input.record.keyHash) {
    return { ok: false, code: "unknown_key", reason: "no platform key matches the presented credential" };
  }
  if (input.record.status === "revoked") {
    return { ok: false, code: "revoked_key", reason: "platform key has been revoked (revocation is terminal)" };
  }
  const nowMs = Date.parse(input.now);
  if (Number.isNaN(nowMs)) {
    return { ok: false, code: "expired_key", reason: "verification clock is not a parseable instant (fail closed)" };
  }
  if (input.record.expiresAt !== null && Date.parse(input.record.expiresAt) <= nowMs) {
    return { ok: false, code: "expired_key", reason: "platform key has expired" };
  }
  const ceiling = INHERENT_KEY_SCOPES[input.record.type];
  for (const scope of input.requestedScopes) {
    if (!(COREGRID_KEY_SCOPES as readonly string[]).includes(scope)) {
      return { ok: false, code: "scope_not_granted", reason: `unknown scope ${scope}` };
    }
    if (!ceiling.includes(scope)) {
      return { ok: false, code: "scope_outside_class_ceiling", reason: `scope ${scope} is outside the ${input.record.type} key class ceiling` };
    }
    if (!input.record.scopes.includes(scope)) {
      return { ok: false, code: "scope_not_granted", reason: `scope ${scope} is not granted to this key` };
    }
  }
  return {
    ok: true,
    apiKeyRef: input.record.apiKeyRef,
    tenantId: input.record.tenantId,
    type: input.record.type,
    scopes: input.requestedScopes,
  };
}