/**
 * CoreGrid — DB-backed substrate adapter for the event routing contract
 * (V1CAP-043 / J-021 / MISSION-R-63), persisting kernel/event-routing.ts
 * subscriptions, queues, cursors and outcomes into the tables authored by
 * database/supabase/migrations/20261002000007_coregrid_v1_event_routing.sql.
 *
 * Composition, not rewrite: the pure contract stays untouched — the adapter
 * persists the router's own declarations, gated deliveries and outcomes and
 * is the ONLY place vendor/DB calls appear (Constitution §24/§25).
 * Service-role access only: the tables are zero-policy deny-by-default (RLS
 * enabled, all anon/authenticated privileges revoked).
 *
 * Declaration immutability law (contract): a subscription declaration is
 * IMMUTABLE while it exists. The adapter re-declares identically (idempotent
 * no-op that lifts an overload suspension ONLY on explicit identical
 * re-subscription) and refuses any different declaration for a live id with a
 * structured `declaration_conflict` error — a scope change is a retire plus a
 * NEW subscription identity, never an in-place rewrite.
 *
 * Failure semantics (J-045): all I/O runs through AdapterFailurePolicy.run
 * (bounded timeout, retry caps, breaker, degraded mode events, trust ledger);
 * mapping/validation are local operations and run through containSync.
 * Writes are never transport-retried (maxAttempts: 1); the outcome audit is
 * append-only and deliberately FK-free (it survives unsubscribe). Purity: no
 * wall-clock sampling — audit instants are supplied. No credentials, no
 * secret values, no sensitive payload logging (Constitution §29).
 */
import { createHash } from "node:crypto";
import { createAdapterFailurePolicy, type AdapterCallResult, type AdapterFailurePolicy, type AdapterMode } from "./failure-policy";
import { canonicalJson, eventDedupDigest, type KernelEventRecord } from "../kernel/event-semantics";
import type { EventDelivery } from "../kernel/event-security";
import type {
  EventBackpressureRecord,
  EventRouteOutcome,
  EventRoutingResult,
  EventSubscription,
  EventSubscriptionStatus,
} from "../kernel/event-routing";

/* ─────────────────────────────────────────────────────────────
 * Injected service-role client (minimal surface; no credentials here)
 * ────────────────────────────────────────────────────────────*/

export interface EventRoutingDbClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[]; rowCount?: number | null }>;
}

export const EVENT_ROUTE_SUBSCRIPTION_TABLE = "cg_event_route_subscription";
export const EVENT_ROUTE_QUEUE_TABLE = "cg_event_route_queue";
export const EVENT_ROUTE_CURSOR_TABLE = "cg_event_route_cursor";
export const EVENT_ROUTE_OUTCOME_TABLE = "cg_event_route_outcome";

/**
 * Declared failure-semantics policy for the event-routing substrate (J-045).
 * Callers may inject their own instance via EventRoutingStoreConfig.
 */
export const EVENT_ROUTING_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "cg-substrate-event-routing",
  timeoutMs: 5_000,
  maxAttempts: 2,
  backoffBaseMs: 100,
  backoffCapMs: 1_000,
  degradedAfterFailures: 3,
  degradedWindowMs: 30_000,
  breakerFailureThreshold: 5,
  breakerResetMs: 15_000,
});

/* ─────────────────────────────────────────────────────────────
 * Mapping helpers (strict, fail-closed, no `any`)
 * ────────────────────────────────────────────────────────────*/

export type EventRoutingStoreErrorCode =
  | "invalid_input"
  | "declaration_conflict"
  | "timeout"
  | "provider_error"
  | "breaker_open";

export type EventRoutingStoreResult<T> =
  | { ok: true; value: T; attempts: number; durationMs: number; mode: AdapterMode }
  | {
      ok: false;
      code: EventRoutingStoreErrorCode;
      reason: string;
      attempts: number;
      durationMs: number;
      mode: AdapterMode;
    };

/** Structured failure with full call observability (AdapterCallError parity). */
function fail<T>(
  code: EventRoutingStoreErrorCode,
  reason: string,
  attempts: number,
  durationMs: number,
  mode: AdapterMode,
): EventRoutingStoreResult<T> {
  return { ok: false, code, reason, attempts, durationMs, mode };
}

class MappingError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(row: Record<string, unknown>, key: string, max: number): string {
  const raw = row[key];
  if (typeof raw !== "string") throw new MappingError(`${key} must be a string`);
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    throw new MappingError(`${key} must be 1-${max} characters`);
  }
  return trimmed;
}

function optionalString(row: Record<string, unknown>, key: string, max: number): string | null {
  const raw = row[key];
  if (raw == null) return null;
  if (typeof raw !== "string") throw new MappingError(`${key} must be a string or null`);
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) throw new MappingError(`${key} must be at most ${max} characters`);
  return trimmed;
}

function timestampString(value: unknown, key: string): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new MappingError(`${key} is an invalid instant`);
    return value.toISOString();
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new MappingError(`${key} must be a parsable instant`);
  }
  return value;
}

function stringArray(value: unknown, key: string): readonly string[] {
  const parsed = typeof value === "string" ? safeParse(value, key) : value;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new MappingError(`${key} must be an array of strings`);
  }
  return Object.freeze([...(parsed as string[])]);
}

function safeParse(value: string, key: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new MappingError(`${key} is not valid JSON`);
  }
}

function requireVocab(row: Record<string, unknown>, key: string, vocab: readonly string[]): string {
  const value = requireString(row, key, 64);
  if (!vocab.includes(value)) throw new MappingError(`${key} "${value}" is not in the declared vocabulary`);
  return value;
}

/** Mirror of the private `eventIdOf` convention in event-semantics. */
export function routeEventRefOf(event: KernelEventRecord): string {
  return event.id?.trim() || `digest:${eventDedupDigest(event).slice(0, 16)}`;
}

/** Deterministic outcome id (append-only audit; survives unsubscribe). */
function outcomeId(outcome: EventRouteOutcome): string {
  return `eout:${createHash("sha256").update(canonicalJson(outcome)).digest("hex").slice(0, 32)}`;
}

/* ─────────────────────────────────────────────────────────────
 * Declaration <-> row mapping (immutable declaration columns)
 * ────────────────────────────────────────────────────────────*/

/** The canonical declaration fingerprint: identical text, identical identity. */
export function declarationFingerprint(declaration: EventSubscription): string {
  return canonicalJson({
    subscriptionId: declaration.subscriptionId,
    subscriberId: declaration.subscriberId,
    tenantId: declaration.tenantId,
    eventTypes: [...declaration.eventTypes],
    visibilityScopes: [...declaration.visibilityScopes],
    maxSensitivity: declaration.maxSensitivity,
    delivery: {
      ordering: declaration.delivery.ordering,
      dedup: declaration.delivery.dedup,
      maxUndelivered: declaration.delivery.maxUndelivered,
    },
  });
}

export interface SubscriptionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly subscriber_id: string;
  readonly event_types: string;
  readonly visibility_scopes: string;
  readonly max_sensitivity: string;
  readonly ordering: string;
  readonly dedup: string;
  readonly max_undelivered: number;
  readonly status: string;
  readonly declared_at: string;
}

export function subscriptionToRow(declaration: EventSubscription, declaredAt: string): SubscriptionRow {
  if (Number.isNaN(Date.parse(declaredAt))) {
    throw new MappingError("declaredAt must be a valid ISO-8601 audit instant");
  }
  return {
    id: declaration.subscriptionId,
    tenant_id: declaration.tenantId,
    subscriber_id: declaration.subscriberId,
    event_types: JSON.stringify(declaration.eventTypes),
    visibility_scopes: JSON.stringify(declaration.visibilityScopes),
    max_sensitivity: declaration.maxSensitivity,
    ordering: declaration.delivery.ordering,
    dedup: declaration.delivery.dedup,
    max_undelivered: declaration.delivery.maxUndelivered,
    status: "active",
    declared_at: declaredAt,
  };
}

export interface PersistedSubscription {
  readonly subscriptionId: string;
  readonly subscriberId: string;
  readonly tenantId: string;
  readonly eventTypes: readonly string[];
  readonly visibilityScopes: readonly string[];
  readonly maxSensitivity: string;
  readonly delivery: { readonly ordering: string; readonly dedup: string; readonly maxUndelivered: number };
  readonly status: EventSubscriptionStatus;
  readonly declaredAt: string;
}

export function rowToSubscription(row: Record<string, unknown>): PersistedSubscription {
  if (!isRecord(row)) throw new MappingError("subscription row must be a JSON object");
  const maxUndeliveredRaw = row["max_undelivered"];
  if (typeof maxUndeliveredRaw !== "number" || !Number.isInteger(maxUndeliveredRaw) || maxUndeliveredRaw <= 0) {
    throw new MappingError("max_undelivered must be a positive integer — backpressure is always bounded");
  }
  return {
    subscriptionId: requireString(row, "id", 200),
    subscriberId: requireString(row, "subscriber_id", 200),
    tenantId: requireString(row, "tenant_id", 128),
    eventTypes: stringArray(row["event_types"], "event_types"),
    visibilityScopes: stringArray(row["visibility_scopes"], "visibility_scopes"),
    maxSensitivity: requireVocab(row, "max_sensitivity", ["public", "internal", "restricted"]),
    delivery: {
      ordering: requireVocab(row, "ordering", ["tenant-total-order"]),
      dedup: requireVocab(row, "dedup", ["collapse-duplicates"]),
      maxUndelivered: maxUndeliveredRaw,
    },
    status: requireVocab(row, "status", ["active", "suspended"]) as EventSubscriptionStatus,
    declaredAt: timestampString(row["declared_at"], "declared_at") ?? requireString(row, "declared_at", 64),
  };
}

/** DB row -> the declaration the adapter would re-declare from persistence. */
export function rowToDeclaration(row: Record<string, unknown>): EventSubscription {
  const persisted = rowToSubscription(row);
  return {
    subscriptionId: persisted.subscriptionId,
    subscriberId: persisted.subscriberId,
    tenantId: persisted.tenantId,
    eventTypes: persisted.eventTypes,
    visibilityScopes: persisted.visibilityScopes as EventSubscription["visibilityScopes"],
    maxSensitivity: persisted.maxSensitivity as EventSubscription["maxSensitivity"],
    delivery: {
      ordering: "tenant-total-order",
      dedup: "collapse-duplicates",
      maxUndelivered: persisted.delivery.maxUndelivered,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Queue / cursor / outcome mapping
 * ────────────────────────────────────────────────────────────*/

export interface QueueEntryInput {
  readonly subscriptionId: string;
  readonly tenantId: string;
  readonly event: KernelEventRecord;
  /** The GATED delivery for this entry (ALLOW view or REDACT view). */
  readonly delivery: EventDelivery;
  /** Audit instant supplied by the caller — never wall-clock sampled. */
  readonly recordedAt: string;
}

export function queueEntryToRow(entry: QueueEntryInput): {
  subscription_id: string;
  tenant_id: string;
  event_digest: string;
  event_ref: string;
  delivery_decision: string;
  delivery: string;
  enqueued_at: string;
} {
  if (Number.isNaN(Date.parse(entry.recordedAt))) {
    throw new MappingError("recordedAt must be a valid ISO-8601 audit instant");
  }
  if (entry.delivery.decision === "DENY") {
    throw new MappingError("a DENY decision is never enqueued — denied events are audited as outcomes, not queued");
  }
  return {
    subscription_id: entry.subscriptionId,
    tenant_id: entry.tenantId,
    event_digest: eventDedupDigest(entry.event),
    event_ref: routeEventRefOf(entry.event),
    delivery_decision: entry.delivery.decision,
    delivery: JSON.stringify(entry.delivery),
    enqueued_at: entry.recordedAt,
  };
}

export interface CursorRow {
  readonly subscription_id: string;
  readonly tenant_id: string;
  readonly last_event_ref: string | null;
  readonly delivered_count: number;
  readonly updated_at: string;
}

export function cursorToRow(input: {
  subscriptionId: string;
  tenantId: string;
  lastEventRef: string | null;
  deliveredCount: number;
  updatedAt: string;
}): CursorRow {
  if (!Number.isInteger(input.deliveredCount) || input.deliveredCount < 0) {
    throw new MappingError("deliveredCount must be a non-negative integer");
  }
  if (Number.isNaN(Date.parse(input.updatedAt))) {
    throw new MappingError("updatedAt must be a valid ISO-8601 audit instant");
  }
  return {
    subscription_id: input.subscriptionId,
    tenant_id: input.tenantId,
    last_event_ref: input.lastEventRef?.trim() || null,
    delivered_count: input.deliveredCount,
    updated_at: input.updatedAt,
  };
}

export function rowToCursor(row: Record<string, unknown>): {
  subscriptionId: string;
  tenantId: string;
  lastEventRef: string | null;
  deliveredCount: number;
  updatedAt: string;
} {
  if (!isRecord(row)) throw new MappingError("cursor row must be a JSON object");
  const countRaw = row["delivered_count"];
  if (typeof countRaw !== "number" || !Number.isInteger(countRaw) || countRaw < 0) {
    throw new MappingError("delivered_count must be a non-negative integer");
  }
  return {
    subscriptionId: requireString(row, "subscription_id", 200),
    tenantId: requireString(row, "tenant_id", 128),
    lastEventRef: optionalString(row, "last_event_ref", 200),
    deliveredCount: countRaw,
    updatedAt: timestampString(row["updated_at"], "updated_at") ?? requireString(row, "updated_at", 64),
  };
}

/** Outcome -> append-only audit row (deterministic id, idempotent). */
export function outcomeToRow(outcome: EventRouteOutcome): {
  id: string;
  tenant_id: string | null;
  subscription_id: string;
  subscriber_id: string;
  event_ref: string;
  kind: string;
  denial_reason: string | null;
  delivery: string | null;
  backpressure: string | null;
  detail: string;
  recorded_at: string;
} {
  if (Number.isNaN(Date.parse(outcome.recordedAt))) {
    throw new MappingError("outcome recordedAt must be a valid ISO-8601 audit instant");
  }
  return {
    id: outcomeId(outcome),
    tenant_id: null,
    subscription_id: outcome.subscriptionId,
    subscriber_id: outcome.subscriberId,
    event_ref: outcome.eventId,
    kind: outcome.kind,
    denial_reason: outcome.denial?.reason ?? null,
    delivery: outcome.delivery == null ? null : JSON.stringify(outcome.delivery),
    backpressure: outcome.backpressure == null ? null : JSON.stringify(outcome.backpressure),
    detail: outcome.detail,
    recorded_at: outcome.recordedAt,
  };
}

/* ─────────────────────────────────────────────────────────────
 * The adapter
 * ────────────────────────────────────────────────────────────*/

export interface SubscriptionReceipt {
  readonly subscriptionId: string;
  readonly status: EventSubscriptionStatus;
  /** True when this act of subscription lifted an overload suspension. */
  readonly resumedFromSuspension: boolean;
}

export interface EventRoutingStoreConfig {
  client: EventRoutingDbClient;
  /** J-045: declared adapter failure policy; defaulted when omitted. */
  failurePolicy?: AdapterFailurePolicy;
}

export interface EventRoutingStore {
  /**
   * Declare (or explicitly re-declare) a subscription in the substrate.
   * Identical re-declaration is an idempotent no-op that lifts an overload
   * suspension; a different declaration for a live id is refused with
   * `declaration_conflict` (a scope change is a retire + a new identity).
   */
  saveSubscription(input: { readonly declaration: EventSubscription; readonly declaredAt: string }): Promise<EventRoutingStoreResult<SubscriptionReceipt>>;
  /** Load one persisted subscription declaration + status. */
  loadSubscription(subscriptionId: string, tenantId: string): Promise<EventRoutingStoreResult<PersistedSubscription | null>>;
  /** Append one gated queue entry. Idempotent per digest, never retried. */
  saveQueueEntry(entry: QueueEntryInput): Promise<EventRoutingStoreResult<{ eventDigest: string }>>;
  /** Mark a queue entry delivered (advances dedup history, never deletes). */
  markDelivered(input: { readonly subscriptionId: string; readonly tenantId: string; readonly eventDigest: string; readonly deliveredAt: string }): Promise<EventRoutingStoreResult<{ delivered: boolean }>>;
  /** Upsert the one-way delivery frontier. */
  saveCursor(input: { subscriptionId: string; tenantId: string; lastEventRef: string | null; deliveredCount: number; updatedAt: string }): Promise<EventRoutingStoreResult<CursorRow>>;
  /** Load the delivery frontier of one subscription. */
  loadCursor(subscriptionId: string, tenantId: string): Promise<EventRoutingStoreResult<{ subscriptionId: string; tenantId: string; lastEventRef: string | null; deliveredCount: number; updatedAt: string } | null>>;
  /** Append the routing outcomes of one routed event (append-only audit). */
  saveOutcomes(result: EventRoutingResult): Promise<EventRoutingStoreResult<{ outcomes: number }>>;
  /** Load the outcome audit trail for one subscription. */
  loadOutcomes(subscriptionId: string): Promise<EventRoutingStoreResult<readonly Record<string, unknown>[]>>;
  /** The declared failure policy (observability: snapshot, trust ledger). */
  readonly policy: AdapterFailurePolicy;
}

export function createEventRoutingStore(config: EventRoutingStoreConfig): EventRoutingStore {
  const policy = config.failurePolicy ?? EVENT_ROUTING_FAILURE_POLICY;
  const client = config.client;

  function containMapping<T>(operation: string, fn: () => T): EventRoutingStoreResult<T> {
    const contained = policy.containSync(operation, fn);
    if (contained.outcome === "ok") {
      return { ok: true, value: contained.value, attempts: contained.attempts, durationMs: contained.durationMs, mode: contained.mode };
    }
    return fail("invalid_input", contained.reason, contained.attempts, contained.durationMs, contained.mode);
  }

  function fromCall<T>(outcome: AdapterCallResult<T>): EventRoutingStoreResult<T> {
    if (outcome.outcome === "ok") {
      return { ok: true, value: outcome.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    }
    return fail(outcome.code, outcome.reason, outcome.attempts, outcome.durationMs, outcome.mode);
  }

  return {
    policy,

    async saveSubscription(input) {
      const fingerprint = declarationFingerprint(input.declaration);
      const prepared = containMapping("event_routing.map_declaration", () =>
        subscriptionToRow(input.declaration, input.declaredAt),
      );
      if (!prepared.ok) return prepared;
      const row = prepared.value;
      const existing = await policy.run({
        operation: "event_routing.load_existing_subscription",
        call: async () =>
          client.query(
            `SELECT * FROM public.${EVENT_ROUTE_SUBSCRIPTION_TABLE} WHERE id = $1 AND tenant_id = $2`,
            [input.declaration.subscriptionId, input.declaration.tenantId],
          ),
      });
      if (existing.outcome === "error") return fromCall(existing);
      const stored = existing.value.rows[0];
      if (stored == null) {
        const outcome = await policy.run({
          operation: "event_routing.save_subscription",
          maxAttempts: 1,
          call: async () => {
            await client.query(
              `INSERT INTO public.${EVENT_ROUTE_SUBSCRIPTION_TABLE}
                (id, tenant_id, subscriber_id, event_types, visibility_scopes, max_sensitivity,
                 ordering, dedup, max_undelivered, status, declared_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
               ON CONFLICT (id, tenant_id) DO NOTHING`,
              [
                row.id, row.tenant_id, row.subscriber_id, row.event_types, row.visibility_scopes,
                row.max_sensitivity, row.ordering, row.dedup, row.max_undelivered, row.status,
                row.declared_at,
              ],
            );
            return { subscriptionId: input.declaration.subscriptionId, status: "active" as const, resumedFromSuspension: false };
          },
        });
        return fromCall(outcome);
      }
      // Immutable declaration law (contract): the fingerprint comparison is a
      // LOCAL operation — a scope conflict is a contract refusal, never a
      // transport failure and never a breaker event.
      const compared = containMapping("event_routing.compare_declaration", () => {
        const storedFingerprint = declarationFingerprint(rowToDeclaration(stored));
        if (storedFingerprint !== fingerprint) return null;
        return requireVocab(stored, "status", ["active", "suspended"]);
      });
      if (!compared.ok) return compared;
      if (compared.value == null) {
        return fail(
          "declaration_conflict",
          `subscription "${input.declaration.subscriptionId}" — the declaration is immutable: retire this id and subscribe a new identity to change scope`,
          compared.attempts,
          compared.durationMs,
          compared.mode,
        );
      }
      if (compared.value === "suspended") {
        const outcome = await policy.run({
          operation: "event_routing.lift_suspension",
          maxAttempts: 1,
          call: async () => {
            await client.query(
              `UPDATE public.${EVENT_ROUTE_SUBSCRIPTION_TABLE} SET status = 'active'
               WHERE id = $1 AND tenant_id = $2 AND status = 'suspended'`,
              [input.declaration.subscriptionId, input.declaration.tenantId],
            );
            return { subscriptionId: input.declaration.subscriptionId, status: "active" as const, resumedFromSuspension: true };
          },
        });
        return fromCall(outcome);
      }
      return {
        ok: true,
        value: { subscriptionId: input.declaration.subscriptionId, status: "active" as const, resumedFromSuspension: false },
        attempts: compared.attempts,
        durationMs: compared.durationMs,
        mode: compared.mode,
      };
    },

    async loadSubscription(subscriptionId, tenantId) {
      if (subscriptionId.trim() === "" || tenantId.trim() === "") {
        return fail("invalid_input", "subscriptionId and tenantId are required", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "event_routing.load_subscription",
        call: async () =>
          client.query(
            `SELECT * FROM public.${EVENT_ROUTE_SUBSCRIPTION_TABLE} WHERE id = $1 AND tenant_id = $2`,
            [subscriptionId, tenantId],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const mapped = containMapping("event_routing.map_subscription_row", () => {
        const first = outcome.value.rows[0];
        return first == null ? null : rowToSubscription(first);
      });
      if (!mapped.ok) return mapped;
      return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },

    async saveQueueEntry(entry) {
      const mapped = containMapping("event_routing.map_queue_entry", () => queueEntryToRow(entry));
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const outcome = await policy.run({
        operation: "event_routing.save_queue_entry",
        maxAttempts: 1,
        call: async () => {
          await client.query(
            `INSERT INTO public.${EVENT_ROUTE_QUEUE_TABLE}
              (subscription_id, tenant_id, event_digest, event_ref, delivery_decision, delivery,
               state, enqueued_at)
             VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
             ON CONFLICT (subscription_id, event_digest) DO NOTHING`,
            [
              row.subscription_id, row.tenant_id, row.event_digest, row.event_ref,
              row.delivery_decision, row.delivery, row.enqueued_at,
            ],
          );
          return { eventDigest: row.event_digest };
        },
      });
      return fromCall(outcome);
    },

    async markDelivered(input) {
      if (Number.isNaN(Date.parse(input.deliveredAt))) {
        return fail("invalid_input", "deliveredAt must be a valid ISO-8601 audit instant", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "event_routing.mark_delivered",
        maxAttempts: 1,
        call: async () => {
          const updated = await client.query(
            `UPDATE public.${EVENT_ROUTE_QUEUE_TABLE}
             SET state = 'delivered', delivered_at = $3
             WHERE subscription_id = $1 AND tenant_id = $2 AND event_digest = $4 AND state = 'pending'`,
            [input.subscriptionId, input.tenantId, input.deliveredAt, input.eventDigest],
          );
          return { delivered: (updated.rowCount ?? 0) > 0 };
        },
      });
      return fromCall(outcome);
    },

    async saveCursor(input) {
      const mapped = containMapping("event_routing.map_cursor", () => cursorToRow(input));
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const outcome = await policy.run({
        operation: "event_routing.save_cursor",
        maxAttempts: 1,
        call: async () => {
          await client.query(
            `INSERT INTO public.${EVENT_ROUTE_CURSOR_TABLE}
              (subscription_id, tenant_id, last_event_ref, delivered_count, updated_at)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (subscription_id) DO UPDATE SET
               last_event_ref = EXCLUDED.last_event_ref,
               delivered_count = EXCLUDED.delivered_count,
               updated_at = EXCLUDED.updated_at`,
            [row.subscription_id, row.tenant_id, row.last_event_ref, row.delivered_count, row.updated_at],
          );
          return row;
        },
      });
      return fromCall(outcome);
    },

    async loadCursor(subscriptionId, tenantId) {
      if (subscriptionId.trim() === "" || tenantId.trim() === "") {
        return fail("invalid_input", "subscriptionId and tenantId are required", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "event_routing.load_cursor",
        call: async () =>
          client.query(
            `SELECT * FROM public.${EVENT_ROUTE_CURSOR_TABLE} WHERE subscription_id = $1 AND tenant_id = $2`,
            [subscriptionId, tenantId],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const mapped = containMapping("event_routing.map_cursor_row", () => {
        const first = outcome.value.rows[0];
        return first == null ? null : rowToCursor(first);
      });
      if (!mapped.ok) return mapped;
      return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },

    async saveOutcomes(result) {
      const mapped = containMapping("event_routing.map_outcomes", () =>
        result.outcomes.map((outcome) => outcomeToRow(outcome)),
      );
      if (!mapped.ok) return mapped;
      const rows = mapped.value;
      const outcome = await policy.run({
        operation: "event_routing.save_outcomes",
        maxAttempts: 1,
        call: async () => {
          for (const row of rows) {
            await client.query(
              `INSERT INTO public.${EVENT_ROUTE_OUTCOME_TABLE}
                (id, tenant_id, subscription_id, subscriber_id, event_ref, kind, denial_reason,
                 delivery, backpressure, detail, recorded_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
               ON CONFLICT (id) DO NOTHING`,
              [
                row.id, row.tenant_id, row.subscription_id, row.subscriber_id, row.event_ref,
                row.kind, row.denial_reason, row.delivery, row.backpressure, row.detail,
                row.recorded_at,
              ],
            );
          }
          return { outcomes: rows.length };
        },
      });
      return fromCall(outcome);
    },

    async loadOutcomes(subscriptionId) {
      if (subscriptionId.trim() === "") {
        return fail("invalid_input", "subscriptionId is required", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "event_routing.load_outcomes",
        call: async () =>
          client.query(
            `SELECT * FROM public.${EVENT_ROUTE_OUTCOME_TABLE} WHERE subscription_id = $1 ORDER BY recorded_at DESC`,
            [subscriptionId],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      return {
        ok: true,
        value: outcome.value.rows,
        attempts: outcome.attempts,
        durationMs: outcome.durationMs,
        mode: outcome.mode,
      };
    },
  };
}