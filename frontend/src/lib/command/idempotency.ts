/**
 * CoreGrid — platform-wide command idempotency contract (J-030 / V1CAP-054).
 *
 * G-063: mandatory idempotency keys on consequential commands are "the
 * difference between a demo and a production platform." The foundation loop
 * implements idempotent replay for itself (verified); this module generalizes
 * that semantics into a cross-module contract every consequential command
 * must consume, so exactly-once effects hold under retry.
 *
 * Law of this module:
 * - Consequential commands require an idempotency key at registration;
 *   a definition without one is rejected, never registered.
 * - A replay (same key + same payload) returns the RECORDED outcome with no
 *   new external effect. The executor is not invoked again.
 * - A key collision (same key + DIFFERENT payload) is rejected explicitly.
 *   It is never silently re-executed under the old key.
 * - Idempotency records have a bounded TTL. An expired record no longer
 *   replays its outcome (fail-safe: the caller re-executes fresh rather
 *   than trusting a stale outcome forever).
 * - The in-memory store implements the same interface the future
 *   DB-backed store will implement. The durable migration is authored with
 *   the substrate apply; this module performs no persistence and no I/O.
 *
 * This module is pure: time is supplied by the caller, nothing runs
 * implicitly, and nothing is persisted.
 */

import { createHash } from "node:crypto";

/* ─────────────────────────────────────────────────────────────
 * JSON payload vocabulary
 * ────────────────────────────────────────────────────────────*/

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/* ─────────────────────────────────────────────────────────────
 * Key derivation (scope + actor + intent + payload digest)
 * ────────────────────────────────────────────────────────────*/

/**
 * Deterministic, order-independent serialization of a JSON payload.
 * Object keys are sorted recursively so structurally identical payloads
 * produce identical digests regardless of construction order. Array order
 * is preserved (it is semantic).
 */
export function canonicalJson(payload: JsonValue): string {
  if (payload === null || typeof payload !== "object") {
    return JSON.stringify(payload);
  }
  if (Array.isArray(payload)) {
    return `[${payload.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${canonicalJson(value)}`).join(",")}}`;
}

/** SHA-256 digest of the canonical payload form. */
export function payloadDigest(payload: JsonValue): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export interface KeyDerivationInput {
  /** Command scope: the subsystem or aggregate the command acts on. */
  scope: string;
  /** Authenticated actor issuing the command (never client-asserted). */
  actorId: string;
  /** Intent: the named command verb (e.g. "enroll-student"). */
  intent: string;
  payload: JsonValue;
}

/**
 * Derive the idempotency key for a consequential command:
 * scope + actor + intent + payload digest. Two commands that differ in any
 * coordinate get different keys; a retry of the same command in the same
 * scope gets the same key.
 */
export function deriveIdempotencyKey(input: KeyDerivationInput): string {
  const digest = createHash("sha256")
    .update([input.scope, input.actorId, input.intent, payloadDigest(input.payload)].join("|"))
    .digest("hex");
  return `idem:${input.scope}:${input.intent}:${digest}`;
}

/* ─────────────────────────────────────────────────────────────
 * Record shape (key, outcome, response ref, envelope)
 * ────────────────────────────────────────────────────────────*/

export interface IdempotencyEnvelope {
  scope: string;
  actorId: string;
  intent: string;
  payloadDigest: string;
}

export type ExternalEffect = "none" | "recorded_intent" | "compensation_required";

export interface IdempotencyOutcome {
  status: "succeeded" | "failed";
  reason: string | null;
  externalEffect: ExternalEffect;
}

export interface IdempotencyRecord {
  key: string;
  envelope: IdempotencyEnvelope;
  outcome: IdempotencyOutcome;
  /** Reference to the persisted response/result of the original execution. */
  responseRef: string;
  createdAt: string;
  expiresAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Store interface (shaped for the future DB-backed store)
 * ────────────────────────────────────────────────────────────*/

/**
 * The contract the durable store must satisfy when the substrate migration
 * is applied. The in-memory implementation below is the V1 reference.
 */
export interface IdempotencyStore {
  /** Returns the live record for the key, or null if absent or expired. */
  get(key: string, now: string): IdempotencyRecord | null;
  /** Persists a record. Implementations must be atomic per key. */
  put(record: IdempotencyRecord): void;
  /** Removes expired records; returns how many were removed. */
  prune(now: string): number;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  get(key: string, now: string): IdempotencyRecord | null {
    const record = this.records.get(key);
    if (record === undefined) return null;
    if (record.expiresAt <= now) {
      this.records.delete(key);
      return null;
    }
    return record;
  }

  put(record: IdempotencyRecord): void {
    this.records.set(record.key, record);
  }

  prune(now: string): number {
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Command registration (non-idempotent commands rejected here)
 * ────────────────────────────────────────────────────────────*/

export interface ConsequentialCommandDefinition {
  /** Named command verb, e.g. "enroll-student". */
  intent: string;
  /** Subsystem or aggregate scope the command acts on. */
  scope: string;
  /** Whether the command has external, state-changing effects. */
  consequential: boolean;
  /**
   * Declared idempotency law. A consequential command MUST declare
   * idempotency key enforcement; anything else is rejected at registration.
   */
  idempotency: { required: true } | { required: false };
}

export type RegistrationResult =
  | { ok: true; definition: ConsequentialCommandDefinition }
  | { ok: false; reason: "idempotency_key_required" | "invalid_definition" };

/**
 * Register a command definition. Consequential commands without mandatory
 * idempotency keys are rejected here — the registration boundary is the
 * enforcement point, not the call site.
 */
export function registerConsequentialCommand(
  definition: ConsequentialCommandDefinition,
): RegistrationResult {
  if (!definition.intent.trim() || !definition.scope.trim()) {
    return { ok: false, reason: "invalid_definition" };
  }
  if (definition.consequential && !definition.idempotency.required) {
    return { ok: false, reason: "idempotency_key_required" };
  }
  return { ok: true, definition };
}

/* ─────────────────────────────────────────────────────────────
 * Exactly-once execution under retry
 * ────────────────────────────────────────────────────────────*/

export interface ConsequentialCommand {
  key: string;
  scope: string;
  actorId: string;
  intent: string;
  payload: JsonValue;
  /** Bounded retention for the idempotency record, in ms. */
  recordTtlMs: number;
}

export interface IdempotentExecutionResult {
  status: "succeeded" | "failed";
  reason: string | null;
  externalEffect: ExternalEffect;
  responseRef: string;
}

export type IdempotentExecution =
  | { kind: "executed"; record: IdempotencyRecord; result: IdempotentExecutionResult }
  /** Same key + same payload: the recorded outcome is replayed verbatim. */
  | { kind: "replayed"; record: IdempotencyRecord; result: IdempotentExecutionResult }
  /** Same key + different payload: rejected, never re-executed. */
  | {
      kind: "collision";
      key: string;
      recordedPayloadDigest: string;
      incomingPayloadDigest: string;
    }
  /** Malformed command (empty scope/actor/intent/key or non-positive TTL). */
  | { kind: "rejected"; reason: "invalid_command" };

function validate(command: ConsequentialCommand): boolean {
  return (
    command.key.trim().length > 0 &&
    command.scope.trim().length > 0 &&
    command.actorId.trim().length > 0 &&
    command.intent.trim().length > 0 &&
    Number.isFinite(command.recordTtlMs) &&
    command.recordTtlMs > 0
  );
}

function toResult(record: IdempotencyRecord): IdempotentExecutionResult {
  return {
    status: record.outcome.status,
    reason: record.outcome.reason,
    externalEffect: record.outcome.externalEffect,
    responseRef: record.responseRef,
  };
}

/**
 * Execute a consequential command under exactly-once semantics.
 *
 * - First sighting: run the executor, record key + payload digest + outcome.
 * - Retry (same key, same payload): replay the recorded outcome. The
 *   executor is NOT invoked; the replay carries `externalEffect: "none"`.
 * - Collision (same key, different payload): reject. Never re-execute.
 * - Expired record: the outcome is no longer trusted. An expired record is
 *   indistinguishable from absence by design (fail-safe): the key is freed
 *   and the command executes fresh with a new record.
 */
export function executeIdempotent(
  store: IdempotencyStore,
  command: ConsequentialCommand,
  now: string,
  executor: () => IdempotentExecutionResult,
): IdempotentExecution {
  if (!validate(command)) {
    return { kind: "rejected", reason: "invalid_command" };
  }

  const digest = payloadDigest(command.payload);
  const existing = store.get(command.key, now);
  if (existing !== null) {
    if (existing.envelope.payloadDigest !== digest) {
      return {
        kind: "collision",
        key: command.key,
        recordedPayloadDigest: existing.envelope.payloadDigest,
        incomingPayloadDigest: digest,
      };
    }
    // Replay: the recorded outcome is authoritative; no new effect.
    const replayed: IdempotentExecutionResult = {
      ...toResult(existing),
      externalEffect: "none",
    };
    return { kind: "replayed", record: existing, result: replayed };
  }

  const outcome = executor();
  const record: IdempotencyRecord = {
    key: command.key,
    envelope: {
      scope: command.scope,
      actorId: command.actorId,
      intent: command.intent,
      payloadDigest: digest,
    },
    outcome: {
      status: outcome.status,
      reason: outcome.reason,
      externalEffect: outcome.externalEffect,
    },
    responseRef: outcome.responseRef,
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + command.recordTtlMs).toISOString(),
  };
  store.put(record);
  return { kind: "executed", record, result: outcome };
}
