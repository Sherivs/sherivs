/**
 * CoreGrid — durable DB-backed idempotency store (H3-028 / L-T-012).
 *
 * The durable variant of the platform command idempotency contract
 * (J-030 / V1CAP-054): `frontend/src/lib/command/idempotency.ts` defines the
 * `IdempotencyStore` contract and an in-process reference implementation
 * whose exactly-once guarantee dies with the process. This module implements
 * the same contract against the `cg_idempotency_record` substrate authored by
 * database/supabase/migrations/20261003000017_coregrid_v1_idempotency_
 * substrate.sql, so a retry after a process restart replays the RECORDED
 * outcome instead of re-executing.
 *
 * Contract parity (same law as the in-memory reference, lifted to the async
 * persistence boundary — the record shape is reused verbatim):
 * - `get(key, now)` returns the live record, or null when absent OR expired
 *   (fail-safe: an expired record is indistinguishable from absence).
 * - `put(record)` is ATOMIC PER KEY: `INSERT ... ON CONFLICT
 *   (tenant_id, idempotency_key)`. The first record for a live key wins; a
 *   concurrent duplicate is a no-op — never an overwrite (the durable
 *   exactly-once arbiter is the database constraint, not application code).
 *   An EXPIRED existing row may be replaced atomically, because an expired
 *   record is already untrusted (== absent) by the contract's own fail-safe
 *   law; the substrate's UPDATE policy authorizes exactly that case and
 *   nothing else — a LIVE record can never be rewritten.
 * - `prune(now)` deletes expired records for the tenant and returns the
 *   count (TTL hygiene; the trust boundary is the expires_at filter in
 *   `get`, never the prune schedule).
 *
 * Failure semantics: I/O and mapping failures are thrown as
 * `IdempotencyStoreDbError` — an error is NEVER conflated with "absent".
 * Silently degrading a DB failure into a fresh execution would break
 * exactly-once (fail-closed, not fail-open).
 *
 * Composition, not rewrite: this module performs no derivation and no
 * decision logic — key derivation, replay/collision decisions and exactly-
 * once execution belong to the contract module (`executeIdempotent`), which
 * consumes this store's records read-only. The client is injected as a
 * minimal query surface (no credentials here); tenant scoping is applied to
 * every statement in addition to the substrate's FORCE RLS — application
 * scoping and RLS are independent layers (Constitution §17), and a client
 * can never address another tenant's records through this store.
 */

import type {
  ExternalEffect,
  IdempotencyEnvelope,
  IdempotencyOutcome,
  IdempotencyRecord,
} from "./idempotency";

/* ─────────────────────────────────────────────────────────────
 * Injected client (minimal surface; no credentials here)
 * ────────────────────────────────────────────────────────────*/

export interface IdempotencyDbClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[]; rowCount?: number | null }>;
}

export const IDEMPOTENCY_RECORD_TABLE = "cg_idempotency_record";

/* ─────────────────────────────────────────────────────────────
 * Errors (fail-closed: never conflated with "absent")
 * ────────────────────────────────────────────────────────────*/

export type IdempotencyStoreDbErrorCode = "invalid_input" | "mapping_failed" | "provider_error";

export class IdempotencyStoreDbError extends Error {
  readonly code: IdempotencyStoreDbErrorCode;
  readonly operation: "get" | "put" | "prune";

  constructor(code: IdempotencyStoreDbErrorCode, operation: "get" | "put" | "prune", reason: string) {
    super(`idempotency-store.${operation}: ${reason}`);
    this.name = "IdempotencyStoreDbError";
    this.code = code;
    this.operation = operation;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Validation and row mapping (strict, fail-closed, no untyped escapes)
 * ────────────────────────────────────────────────────────────*/

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function nonEmptyString(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") {
    throw new IdempotencyStoreDbError("invalid_input", "put", `${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    throw new IdempotencyStoreDbError("invalid_input", "put", `${label} must be 1-${max} characters`);
  }
  return trimmed;
}

function requireIsoInstant(value: string, label: string, operation: "get" | "put" | "prune"): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new IdempotencyStoreDbError("invalid_input", operation, `${label} must be a valid ISO-8601 instant`);
  }
}

function requireVocab<T extends string>(value: unknown, vocab: readonly T[], label: string): T {
  if (typeof value !== "string" || !vocab.includes(value as T)) {
    throw new IdempotencyStoreDbError(
      "mapping_failed",
      "get",
      `${label} "${String(value)}" is not in the declared vocabulary`,
    );
  }
  return value as T;
}

export function validateRecord(record: IdempotencyRecord): void {
  nonEmptyString(record.key, "key", 512);
  nonEmptyString(record.envelope.scope, "envelope.scope", 128);
  nonEmptyString(record.envelope.actorId, "envelope.actorId", 160);
  nonEmptyString(record.envelope.intent, "envelope.intent", 128);
  nonEmptyString(record.responseRef, "responseRef", 512);
  if (typeof record.envelope.payloadDigest !== "string" || !DIGEST_PATTERN.test(record.envelope.payloadDigest)) {
    throw new IdempotencyStoreDbError("invalid_input", "put", "envelope.payloadDigest must be a lowercase sha-256 hex digest");
  }
  if (record.outcome.status !== "succeeded" && record.outcome.status !== "failed") {
    throw new IdempotencyStoreDbError("invalid_input", "put", "outcome.status must be 'succeeded' or 'failed'");
  }
  if (
    record.outcome.externalEffect !== "none" &&
    record.outcome.externalEffect !== "recorded_intent" &&
    record.outcome.externalEffect !== "compensation_required"
  ) {
    throw new IdempotencyStoreDbError("invalid_input", "put", "outcome.externalEffect is not in the declared vocabulary");
  }
  if (record.outcome.reason != null) {
    nonEmptyString(record.outcome.reason, "outcome.reason", 512);
  }
  requireIsoInstant(record.createdAt, "createdAt", "put");
  requireIsoInstant(record.expiresAt, "expiresAt", "put");
  if (Date.parse(record.expiresAt) <= Date.parse(record.createdAt)) {
    throw new IdempotencyStoreDbError("invalid_input", "put", "the TTL window must be positive (expiresAt > createdAt)");
  }
}

function requireColumn(row: Record<string, unknown>, column: string): string {
  const raw = row[column];
  if (typeof raw !== "string" || raw.length < 1) {
    throw new IdempotencyStoreDbError("mapping_failed", "get", `${column} must be a non-empty string`);
  }
  return raw;
}

function rowToRecord(row: Record<string, unknown>, key: string): IdempotencyRecord {
  const status = requireVocab(row["status"], ["succeeded", "failed"] as const, "status");
  const externalEffect = requireVocab(
    row["external_effect"],
    ["none", "recorded_intent", "compensation_required"] as const,
    "external_effect",
  );
  const reasonRaw = row["reason"];
  if (reasonRaw != null && typeof reasonRaw !== "string") {
    throw new IdempotencyStoreDbError("mapping_failed", "get", "reason must be a string or null");
  }
  const envelope: IdempotencyEnvelope = {
    scope: requireColumn(row, "scope"),
    actorId: requireColumn(row, "actor_id"),
    intent: requireColumn(row, "intent"),
    payloadDigest: requireColumn(row, "payload_digest"),
  };
  if (!DIGEST_PATTERN.test(envelope.payloadDigest)) {
    throw new IdempotencyStoreDbError("mapping_failed", "get", "payload_digest must be a lowercase sha-256 hex digest");
  }
  const outcome: IdempotencyOutcome = {
    status: status as IdempotencyOutcome["status"],
    reason: reasonRaw ?? null,
    externalEffect: externalEffect as ExternalEffect,
  };
  return {
    key,
    envelope,
    outcome,
    responseRef: requireColumn(row, "response_ref"),
    createdAt: requireColumn(row, "created_at"),
    expiresAt: requireColumn(row, "expires_at"),
  };
}

/* ─────────────────────────────────────────────────────────────
 * The durable store
 * ────────────────────────────────────────────────────────────*/

export interface DbIdempotencyStoreConfig {
  client: IdempotencyDbClient;
  /** Tenant scope for every statement (in addition to the substrate's FORCE RLS). */
  tenantId: string;
}

export class DbIdempotencyStore {
  private readonly client: IdempotencyDbClient;
  private readonly tenantId: string;

  constructor(config: DbIdempotencyStoreConfig) {
    const tenantId = config.tenantId.trim();
    if (tenantId.length < 1 || tenantId.length > 128) {
      throw new IdempotencyStoreDbError("invalid_input", "get", "tenantId must be 1-128 characters");
    }
    this.client = config.client;
    this.tenantId = tenantId;
  }

  /**
   * Returns the live record for the key, or null if absent or expired.
   * The read is pure: expired rows stay until prune removes them, but they
   * are already untrusted (== absent) by the contract's fail-safe law.
   */
  async get(key: string, now: string): Promise<IdempotencyRecord | null> {
    const trimmedKey = nonEmptyString(key, "key", 512);
    requireIsoInstant(now, "now", "get");
    try {
      const result = await this.client.query(
        `SELECT idempotency_key, scope, actor_id, intent, payload_digest, status, reason,
                external_effect, response_ref, created_at, expires_at
           FROM public.${IDEMPOTENCY_RECORD_TABLE}
          WHERE tenant_id = $1 AND idempotency_key = $2 AND expires_at > $3`,
        [this.tenantId, trimmedKey, now],
      );
      const first = result.rows[0];
      return first == null ? null : rowToRecord(first, trimmedKey);
    } catch (error) {
      if (error instanceof IdempotencyStoreDbError) throw error;
      throw new IdempotencyStoreDbError(
        "provider_error",
        "get",
        error instanceof Error ? error.message : "unknown provider failure",
      );
    }
  }

  /**
   * Persists a record, atomic per key. The first record for a LIVE key wins;
   * a concurrent duplicate is a no-op (never an overwrite). An existing row
   * that is already EXPIRED before the new record's window opens may be
   * replaced atomically — the substrate's UPDATE policy authorizes exactly
   * that case and nothing else, so a live recorded outcome can never be
   * rewritten through this path.
   */
  async put(record: IdempotencyRecord): Promise<void> {
    validateRecord(record);
    try {
      await this.client.query(
        `INSERT INTO public.${IDEMPOTENCY_RECORD_TABLE}
           (tenant_id, idempotency_key, scope, actor_id, intent, payload_digest,
            status, reason, external_effect, response_ref, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET
           scope = EXCLUDED.scope,
           actor_id = EXCLUDED.actor_id,
           intent = EXCLUDED.intent,
           payload_digest = EXCLUDED.payload_digest,
           status = EXCLUDED.status,
           reason = EXCLUDED.reason,
           external_effect = EXCLUDED.external_effect,
           response_ref = EXCLUDED.response_ref,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at
         WHERE public.${IDEMPOTENCY_RECORD_TABLE}.expires_at <= EXCLUDED.created_at`,
        [
          this.tenantId,
          record.key,
          record.envelope.scope,
          record.envelope.actorId,
          record.envelope.intent,
          record.envelope.payloadDigest,
          record.outcome.status,
          record.outcome.reason,
          record.outcome.externalEffect,
          record.responseRef,
          record.createdAt,
          record.expiresAt,
        ],
      );
    } catch (error) {
      if (error instanceof IdempotencyStoreDbError) throw error;
      throw new IdempotencyStoreDbError(
        "provider_error",
        "put",
        error instanceof Error ? error.message : "unknown provider failure",
      );
    }
  }

  /**
   * Removes expired records for the tenant; returns how many were removed.
   * Operational hygiene only — the trust boundary is the expires_at filter
   * in `get`, never the prune schedule.
   */
  async prune(now: string): Promise<number> {
    requireIsoInstant(now, "now", "prune");
    try {
      const result = await this.client.query(
        `DELETE FROM public.${IDEMPOTENCY_RECORD_TABLE}
          WHERE tenant_id = $1 AND expires_at <= $2`,
        [this.tenantId, now],
      );
      return result.rowCount ?? 0;
    } catch (error) {
      if (error instanceof IdempotencyStoreDbError) throw error;
      throw new IdempotencyStoreDbError(
        "provider_error",
        "prune",
        error instanceof Error ? error.message : "unknown provider failure",
      );
    }
  }
}
