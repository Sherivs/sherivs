/**
 * CoreGrid — platform API-key service over `cg_api_key`
 * (PLATFORM-019, DECISIONS.md #210).
 *
 * SERVER module. The table is zero-policy (RLS enabled, zero policies,
 * anon/authenticated fully revoked — see the migration): this adapter runs
 * on the SERVICE-ROLE client and is the only reader/writer. Every row read
 * back is validated against the pure contract (untrusted reads fail closed).
 *
 * Laws (§30/§29/§28):
 * - The platform NEVER stores a key: issuance hashes the plaintext and the
 *   full key is returned EXACTLY ONCE to the caller — it never enters a
 *   log, a reason string, or any other result.
 * - Verification is a fail-closed typed decision (malformed → unknown →
 *   revoked → expired → scope), delegated to the pure contract; the tenant
 *   filter is applied on every lookup so a key can never authenticate into
 *   another organization (§13).
 * - Revocation is terminal and must carry who/when/why provenance; rotation
 *   is re-issuance (never an un-revoke).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COREGRID_KEY_SCOPES,
  generateCoreGridApiKey,
  hashCoreGridApiKey,
  INHERENT_KEY_SCOPES,
  validateCoreGridApiKeyRecord,
  verifyCoreGridApiKey,
  type CoreGridApiKeyRecord,
  type CoreGridApiKeyType,
  type CoreGridKeyScope,
  type CoreGridKeyVerification,
} from "./apikey-contract";

/** Service-role client shape (injected — never created at module scope). */
export type ApiKeyServiceClient = SupabaseClient;

export type ApiKeyServiceOutcome<T> =
  | { outcome: "ok"; value: T }
  | { outcome: "blocked"; code: "service_client_unavailable" | "row_rejected" | "store_error" | "invalid_request"; reason: string };

const DB_ROW_COLUMNS = "api_key_ref, tenant_id, type, key_hash, key_preview, fingerprint, scopes, status, created_by, created_at, expires_at, revoked_at, revoked_by, revoke_reason, note";

function rowToContract(row: Record<string, unknown>): CoreGridApiKeyRecord | null {
  return validateCoreGridApiKeyRecord({
    apiKeyRef: row.api_key_ref,
    tenantId: row.tenant_id,
    type: row.type,
    keyHash: row.key_hash,
    keyPreview: row.key_preview,
    fingerprint: row.fingerprint,
    scopes: row.scopes,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
    revokedBy: row.revoked_by ?? null,
    revokeReason: row.revoke_reason ?? null,
    note: row.note ?? null,
  });
}

export interface IssueCoreGridApiKeyInput {
  tenantId: string;
  type: CoreGridApiKeyType;
  /** Requested scope vector — must sit inside the key class's ceiling. */
  scopes: readonly CoreGridKeyScope[];
  createdBy: string;
  /** ISO instant of issuance (caller's TimeAuthority). */
  createdAt: string;
  /** ISO instant or null (no expiry). */
  expiresAt: string | null;
  note: string | null;
}

export interface IssuedCoreGridApiKey {
  /** The FULL plaintext key — returned EXACTLY ONCE, never stored/logged. */
  key: string;
  record: CoreGridApiKeyRecord;
}

/**
 * Issue a fresh platform key for one organization. Scope and class-ceiling
 * validation fail closed BEFORE any material is generated — a rejected
 * issuance produces no key at all.
 */
export async function issueCoreGridApiKey(
  client: ApiKeyServiceClient | null,
  input: IssueCoreGridApiKeyInput,
): Promise<ApiKeyServiceOutcome<IssuedCoreGridApiKey>> {
  if (!client) {
    return {
      outcome: "blocked",
      code: "service_client_unavailable",
      reason: "no service-role client — platform keys cannot be issued (fail closed)",
    };
  }
  if (input.scopes.length === 0) {
    return { outcome: "blocked", code: "invalid_request", reason: "issuance requires at least one scope (fail closed)" };
  }
  const ceiling = INHERENT_KEY_SCOPES[input.type];
  for (const scope of input.scopes) {
    if (!(COREGRID_KEY_SCOPES as readonly string[]).includes(scope)) {
      return { outcome: "blocked", code: "invalid_request", reason: `unknown scope ${scope} — no invented authority` };
    }
    if (!ceiling.includes(scope)) {
      return { outcome: "blocked", code: "invalid_request", reason: `scope ${scope} is outside the ${input.type} key class ceiling` };
    }
  }
  if (input.expiresAt !== null && (Number.isNaN(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.parse(input.createdAt))) {
    return { outcome: "blocked", code: "invalid_request", reason: "expiresAt must be a parseable instant after createdAt" };
  }

  const generated = generateCoreGridApiKey(input.type);
  const apiKeyRef = `cgkey-${generated.fingerprint}`;
  const { data, error } = await client
    .from("cg_api_key")
    .insert({
      api_key_ref: apiKeyRef,
      tenant_id: input.tenantId,
      type: input.type,
      key_hash: generated.keyHash,
      key_preview: generated.keyPreview,
      fingerprint: generated.fingerprint,
      scopes: [...input.scopes],
      status: "active",
      created_by: input.createdBy,
      created_at: input.createdAt,
      expires_at: input.expiresAt,
      note: input.note,
    })
    .select(DB_ROW_COLUMNS)
    .single();
  if (error !== null) {
    return { outcome: "blocked", code: "store_error", reason: `api-key insert failed: ${error.message}` };
  }
  const record = rowToContract(data as Record<string, unknown>);
  if (record === null) {
    return { outcome: "blocked", code: "row_rejected", reason: "stored api-key row failed contract validation after write (fail closed)" };
  }
  return { outcome: "ok", value: { key: generated.key, record } };
}

/**
 * Verify a presented key for one tenant and the requested scopes. The
 * tenant filter is part of the lookup: a key bound to another organization
 * is indistinguishable from an unknown key (§13). Presentation failures are
 * typed denies — never throws, never logs material.
 */
export async function verifyCoreGridApiKeyForTenant(
  client: ApiKeyServiceClient | null,
  input: {
    presentedKey: string;
    tenantId: string;
    requestedScopes: readonly CoreGridKeyScope[];
    /** ISO instant of the verification clock (caller's TimeAuthority). */
    now: string;
  },
): Promise<CoreGridKeyVerification> {
  if (!client) {
    return { ok: false, code: "unknown_key", reason: "verification plane unavailable — no key can authenticate right now (fail closed)" };
  }
  const keyHash = hashCoreGridApiKey(input.presentedKey);
  const { data, error } = await client
    .from("cg_api_key")
    .select(DB_ROW_COLUMNS)
    .eq("key_hash", keyHash)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (error !== null) {
    return { ok: false, code: "unknown_key", reason: "verification lookup failed (fail closed)" };
  }
  const record = data === null ? null : rowToContract(data as Record<string, unknown>);
  return verifyCoreGridApiKey({
    presentedKey: input.presentedKey,
    record,
    now: input.now,
    requestedScopes: input.requestedScopes,
  });
}

export interface RevokeCoreGridApiKeyInput {
  apiKeyRef: string;
  tenantId: string;
  revokedBy: string;
  /** ISO instant of revocation (caller's TimeAuthority). */
  revokedAt: string;
  revokeReason: string | null;
}

/**
 * Revoke a key. Terminal: revoking an already-revoked key is an explicit
 * typed denial (the first revocation provenance stands — §28 immutable
 * audit). The update predicate includes status='active' so a racing second
 * revocation cannot overwrite the first one's provenance.
 */
export async function revokeCoreGridApiKey(
  client: ApiKeyServiceClient | null,
  input: RevokeCoreGridApiKeyInput,
): Promise<ApiKeyServiceOutcome<{ apiKeyRef: string }>> {
  if (!client) {
    return {
      outcome: "blocked",
      code: "service_client_unavailable",
      reason: "no service-role client — platform keys cannot be revoked (fail closed)",
    };
  }
  const { error } = await client
    .from("cg_api_key")
    .update({
      status: "revoked",
      revoked_at: input.revokedAt,
      revoked_by: input.revokedBy,
      revoke_reason: input.revokeReason,
    })
    .eq("api_key_ref", input.apiKeyRef)
    .eq("tenant_id", input.tenantId)
    .eq("status", "active");
  if (error !== null) {
    return { outcome: "blocked", code: "store_error", reason: `revocation update failed: ${error.message}` };
  }
  // Confirm the transition actually landed (predicate may have matched zero rows).
  const { data, error: readError } = await client
    .from("cg_api_key")
    .select(DB_ROW_COLUMNS)
    .eq("api_key_ref", input.apiKeyRef)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (readError !== null || data === null) {
    return { outcome: "blocked", code: "store_error", reason: "revocation could not be confirmed against the store (fail closed)" };
  }
  const record = rowToContract(data as Record<string, unknown>);
  if (record === null || record.status !== "revoked") {
    return { outcome: "blocked", code: "row_rejected", reason: "key was not in the active state — revocation is terminal and the standing provenance stands" };
  }
  return { outcome: "ok", value: { apiKeyRef: record.apiKeyRef } };
}

export interface ApiKeyMetadata {
  apiKeyRef: string;
  type: CoreGridApiKeyType;
  keyPreview: string;
  fingerprint: string;
  scopes: readonly CoreGridKeyScope[];
  status: "active" | "revoked";
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  note: string | null;
}

/**
 * List one organization's keys as METADATA ONLY — the sha256 hash is
 * stripped here so no list surface can ever carry lookup material.
 */
export async function listOrgApiKeyMetadata(
  client: ApiKeyServiceClient | null,
  tenantId: string,
): Promise<ApiKeyServiceOutcome<ApiKeyMetadata[]>> {
  if (!client) {
    return {
      outcome: "blocked",
      code: "service_client_unavailable",
      reason: "no service-role client — platform keys are unreadable (fail closed)",
    };
  }
  const { data, error } = await client
    .from("cg_api_key")
    .select(DB_ROW_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error !== null) {
    return { outcome: "blocked", code: "store_error", reason: `api-key list failed: ${error.message}` };
  }
  const metadata: ApiKeyMetadata[] = [];
  for (const row of data ?? []) {
    const record = rowToContract(row as Record<string, unknown>);
    if (record === null) continue;
    metadata.push({
      apiKeyRef: record.apiKeyRef,
      type: record.type,
      keyPreview: record.keyPreview,
      fingerprint: record.fingerprint,
      scopes: record.scopes,
      status: record.status,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
      note: record.note,
    });
  }
  return { outcome: "ok", value: metadata };
}