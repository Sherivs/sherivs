/**
 * CoreGrid — reliability contract for mandatory idempotency keys on
 * consequential commands (J-030; §36 payment precedent; §12 provenance).
 *
 * The payments replay guard (`payments/replay-guard.ts`) proves the pattern
 * for one axis (provider redelivery); the foundation loop proves it for
 * mission admission; `command/idempotency.ts` enforces the registration-time
 * law for derived keys. This module extracts the general contract for
 * CALLER-SUPPLIED idempotency keys (the `Idempotency-Key` header pattern):
 * the client names the attempt, the platform guarantees exactly-once effect.
 *
 * Law of this module:
 * - Key derivation binds a caller-supplied key to an operation class and a
 *   tenant. The module NEVER normalizes, mutates, or silently regenerates a
 *   caller key: a missing/blank key is a REJECTION, not a substitution.
 * - Replay semantics: a live record under the same key, same operation
 *   class, same tenant, same payload returns the RECORDED original outcome.
 *   The executor is never invoked again; the replay carries
 *   `externalEffect: "none"` regardless of what the original effect was.
 * - Scope rules: a caller key is unique per (operation class, tenant). The
 *   same key surfacing under a DIFFERENT tenant is a DENIAL (`cross_tenant`),
 *   never a hit and never a fresh execution — replayed outcomes do not cross
 *   tenant boundaries. The same key under a different operation class in the
 *   same tenant is likewise a denial (`cross_operation_class`). A different
 *   payload under the same key in the same scope is a denial
 *   (`payload_mismatch`), never a silent re-execution.
 * - Audit (§12): EVERY decision — execution, replay, denial, rejection —
 *   returns a provenance-bearing audit entry (who, when, where, what, why,
 *   external effect). No idempotency decision is silent.
 *
 * Pure contract module: time is caller-supplied, no I/O, no persistence.
 * The in-memory store is the reference implementation of the interface the
 * future durable substrate adapter must satisfy (a substrate table with a
 * scope-independent unique index on the caller-key digest and tenant-scoped
 * RLS is a follow-up; this module authors no migration).
 */

import { createHash } from "node:crypto";

/* ─────────────────────────────────────────────────────────────
 * Payload vocabulary (order-independent fingerprinting)
 * ────────────────────────────────────────────────────────────*/

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Deterministic serialization: object keys sorted recursively so
 * structurally identical payloads produce identical digests regardless of
 * construction order. Array order is preserved (it is semantic).
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
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** SHA-256 digest of the canonical payload form. */
export function payloadDigest(payload: JsonValue): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/* ─────────────────────────────────────────────────────────────
 * Key derivation: caller-supplied key + operation class binding
 * ────────────────────────────────────────────────────────────*/

export interface CallerKeyInput {
  /** Client-supplied idempotency key (e.g. the `Idempotency-Key` header). */
  callerKey: string;
  /** The named command class the key is bound to (e.g. "payment.capture"). */
  operationClass: string;
  /** Resolved tenant of the request (never client-asserted). */
  tenantId: string;
}

export type BindKeyResult =
  | { ok: true; key: string; callerKeyDigest: string }
  | {
      ok: false;
      reason: "caller_key_required" | "operation_class_required" | "tenant_required";
    };

/**
 * Bind a caller-supplied key to its operation class and tenant.
 *
 * The returned `key` is the scoped ledger key
 * `idem:<operationClass>:<tenantId>:<callerKeyDigest>`; the
 * `callerKeyDigest` (SHA-256 of the raw caller key) is the
 * scope-independent index used to detect the same caller key arriving
 * under a different scope. A blank caller key fails with
 * `caller_key_required` — it is never replaced by a generated key.
 * The raw caller key is never normalized: keys differing only in
 * surrounding whitespace are distinct keys by construction.
 */
export function bindCallerKey(input: CallerKeyInput): BindKeyResult {
  if (input.callerKey.trim() === "") return { ok: false, reason: "caller_key_required" };
  if (input.operationClass.trim() === "") return { ok: false, reason: "operation_class_required" };
  if (input.tenantId.trim() === "") return { ok: false, reason: "tenant_required" };

  const callerKeyDigest = createHash("sha256").update(input.callerKey, "utf8").digest("hex");
  return {
    ok: true,
    key: `idem:${input.operationClass}:${input.tenantId}:${callerKeyDigest}`,
    callerKeyDigest,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Records and store interface (shaped for the durable adapter)
 * ────────────────────────────────────────────────────────────*/

export type ExternalEffect = "applied" | "none";

export interface CommandOutcome {
  status: "succeeded" | "failed";
  reason: string | null;
  /** Reference to the persisted response of the original execution. */
  responseRef: string;
}

export interface IdempotencyRecord {
  /** Scoped ledger key (operation class + tenant + caller-key digest). */
  key: string;
  /** Scope-independent index: the SHA-256 digest of the raw caller key. */
  callerKeyDigest: string;
  operationClass: string;
  tenantId: string;
  actorId: string;
  payloadDigest: string;
  outcome: CommandOutcome;
  recordedAt: string;
}

/**
 * The contract the durable substrate adapter must satisfy. Records are
 * indexed by caller-key digest (scope-INDEPENDENT) so cross-scope arrivals
 * of the same caller key are observable and deniable, not invisible. The
 * substrate table is a follow-up; implementations must be atomic per
 * caller-key digest.
 */
export interface IdempotencyStore {
  /** Returns the live record for the caller-key digest, or null. */
  get(callerKeyDigest: string): IdempotencyRecord | null;
  /** Persists a record. */
  put(record: IdempotencyRecord): void;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  get(callerKeyDigest: string): IdempotencyRecord | null {
    return this.records.get(callerKeyDigest) ?? null;
  }

  put(record: IdempotencyRecord): void {
    this.records.set(record.callerKeyDigest, record);
  }
}

/* ─────────────────────────────────────────────────────────────
 * Audit (§12 provenance) — every decision is observable
 * ────────────────────────────────────────────────────────────*/

export type IdempotencyDecisionKind = "executed" | "replayed" | "denied" | "rejected";

export interface IdempotencyAuditEntry {
  /** Caller-supplied decision time (ISO-8601). */
  at: string;
  decision: IdempotencyDecisionKind;
  /** Who: authenticated actor ("" only when rejected before binding). */
  actorId: string;
  /** Where: tenant scope ("" only when rejected before binding). */
  tenantId: string;
  /** What: the bound operation class ("" only when rejected before binding). */
  operationClass: string;
  /** The scoped ledger key ("" only when rejected before binding). */
  key: string;
  /** Why: stable machine reason for the decision. */
  reason: string;
  externalEffect: ExternalEffect;
}

/** Append-only audit trail: returns a NEW array; never mutates the input. */
export function appendAudit(
  trail: readonly IdempotencyAuditEntry[],
  entry: IdempotencyAuditEntry,
): readonly IdempotencyAuditEntry[] {
  return [...trail, entry];
}

/* ─────────────────────────────────────────────────────────────
 * Exactly-once execution under retry
 * ────────────────────────────────────────────────────────────*/

export interface ConsequentialCommand {
  /** Client-supplied idempotency key. Never generated here. */
  callerKey: string;
  operationClass: string;
  tenantId: string;
  actorId: string;
  payload: JsonValue;
}

export type IdempotencyDecision =
  | { kind: "executed"; record: IdempotencyRecord; result: CommandOutcome & { externalEffect: ExternalEffect }; audit: IdempotencyAuditEntry }
  /** Recorded original outcome replayed verbatim; no new effect. */
  | { kind: "replayed"; record: IdempotencyRecord; result: CommandOutcome & { externalEffect: ExternalEffect }; audit: IdempotencyAuditEntry }
  | {
      kind: "denied";
      reason: "cross_tenant" | "cross_operation_class" | "payload_mismatch";
      key: string;
      audit: IdempotencyAuditEntry;
    }
  | { kind: "rejected"; reason: "invalid_command"; audit: IdempotencyAuditEntry };

/**
 * Execute a consequential command under exactly-once semantics.
 *
 * - First sighting of the caller key: run the executor, record the outcome
 *   bound to (operation class, tenant, payload digest). Effect: applied.
 * - Same key, same scope, same payload: replay the recorded outcome.
 *   The executor is NOT invoked. Effect: none.
 * - Same key, different tenant: DENIED (`cross_tenant`). The executor is
 *   NOT invoked, the recorded outcome is NOT disclosed, and the denial
 *   carries no record — replayed outcomes do not cross tenant boundaries.
 * - Same key, different operation class (same tenant): DENIED
 *   (`cross_operation_class`).
 * - Same key, same scope, different payload: DENIED (`payload_mismatch`).
 * - Blank key / blank class / tenant / actor: REJECTED (`invalid_command`);
 *   a missing caller key is never silently regenerated.
 */
export function executeIdempotent(
  store: IdempotencyStore,
  command: ConsequentialCommand,
  now: string,
  executor: () => CommandOutcome,
): IdempotencyDecision {
  const bound = bindCallerKey(command);
  if (
    !bound.ok ||
    command.actorId.trim() === ""
  ) {
    return {
      kind: "rejected",
      reason: "invalid_command",
      audit: {
        at: now,
        decision: "rejected",
        actorId: command.actorId,
        tenantId: bound.ok ? command.tenantId : "",
        operationClass: bound.ok ? command.operationClass : "",
        key: "",
        reason: bound.ok ? "actor_required" : bound.reason,
        externalEffect: "none",
      },
    };
  }

  const { key, callerKeyDigest } = bound;
  const digest = payloadDigest(command.payload);
  const existing = store.get(callerKeyDigest);

  if (existing !== null) {
    if (existing.tenantId !== command.tenantId) {
      return {
        kind: "denied",
        reason: "cross_tenant",
        key,
        audit: {
          at: now,
          decision: "denied",
          actorId: command.actorId,
          tenantId: command.tenantId,
          operationClass: command.operationClass,
          key,
          reason: "cross_tenant",
          externalEffect: "none",
        },
      };
    }
    if (existing.operationClass !== command.operationClass) {
      return {
        kind: "denied",
        reason: "cross_operation_class",
        key,
        audit: {
          at: now,
          decision: "denied",
          actorId: command.actorId,
          tenantId: command.tenantId,
          operationClass: command.operationClass,
          key,
          reason: "cross_operation_class",
          externalEffect: "none",
        },
      };
    }
    if (existing.payloadDigest !== digest) {
      return {
        kind: "denied",
        reason: "payload_mismatch",
        key,
        audit: {
          at: now,
          decision: "denied",
          actorId: command.actorId,
          tenantId: command.tenantId,
          operationClass: command.operationClass,
          key,
          reason: "payload_mismatch",
          externalEffect: "none",
        },
      };
    }
    // Replay: the recorded original outcome is authoritative.
    return {
      kind: "replayed",
      record: existing,
      result: { ...existing.outcome, externalEffect: "none" },
      audit: {
        at: now,
        decision: "replayed",
        actorId: command.actorId,
        tenantId: command.tenantId,
        operationClass: command.operationClass,
        key,
        reason: "recorded_outcome_replayed",
        externalEffect: "none",
      },
    };
  }

  const outcome = executor();
  const record: IdempotencyRecord = {
    key,
    callerKeyDigest,
    operationClass: command.operationClass,
    tenantId: command.tenantId,
    actorId: command.actorId,
    payloadDigest: digest,
    outcome,
    recordedAt: now,
  };
  store.put(record);
  return {
    kind: "executed",
    record,
    result: { ...outcome, externalEffect: "applied" },
    audit: {
      at: now,
      decision: "executed",
      actorId: command.actorId,
      tenantId: command.tenantId,
      operationClass: command.operationClass,
      key,
      reason: "first_execution",
      externalEffect: "applied",
    },
  };
}