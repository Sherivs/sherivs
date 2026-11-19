/**
 * SV1-LITE generic outbox (ADR-109).
 *
 * One outbox on the existing tenant-scoped IndexedDB store (`indexeddb-store.ts`):
 * rows live in the same scope-indexed object store as the legacy attendance/score
 * mutations, so every scope wipe (sign-out, organization or role switch) removes
 * them too. No second store, no new dependency.
 *
 * Contract:
 *  - `enqueue(kind, payload, idempotencyKey)` stores one row per idempotency key
 *    per context. A second enqueue with the same key returns the existing row and
 *    never creates a second send (sent rows stay as payload-free tombstones for
 *    the retention window, so a late duplicate is still recognised).
 *  - Every row is tagged with the user id, organization id and role that created
 *    it. A drain only sends rows whose tag equals the outbox's own context AND the
 *    currently active context; anything else is refused and left untouched.
 *  - Ordered drain: rows go out in enqueue order. States are
 *    queued -> sending -> sent, or failed. A transient error (sender throws)
 *    re-queues the row with exponential backoff and stops the drain so order is
 *    kept; after `maxAttempts` the row becomes failed ("retries_exhausted").
 *    A connectivity error stops the drain without spending an attempt.
 *  - Conflict rule: server wins. A rejected row becomes failed with the server's
 *    reason and keeps its payload, so the person sees which item failed and why.
 *    Nothing is ever dropped silently: rows leave the outbox only when sent, or
 *    when the person explicitly discards them (or a context wipe they confirmed).
 */
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import {
  createBrowserDatabase,
  isLegacyMutation,
  lastSyncRecordId,
  offlineScopeKey,
  type OfflineDatabase,
  type OfflineScope,
  type StoredOutboxRow,
} from "./indexeddb-store";
import { isNetworkError } from "./save-or-queue";

const timeAuthority = new TimeAuthority(new SystemClock());

export type OutboxState = "queued" | "sending" | "sent" | "failed";

/** The identity that created a row. Equality on all three fields is required to send it. */
export interface OutboxContext {
  userId: string;
  organizationId: string;
  role: string;
}

export interface OutboxRecord<T = unknown> {
  type: "outbox";
  /** Deterministic: derived from the scope and the idempotency key. */
  id: string;
  scopeKey: string;
  kind: string;
  idempotencyKey: string;
  /** Removed once sent (the tombstone keeps only what duplicate detection needs). */
  payload?: T;
  /** Short human description shown when the item needs attention. */
  label?: string;
  context: OutboxContext;
  sequence: number;
  state: OutboxState;
  attempts: number;
  queuedAt: string;
  queuedAtMs: number;
  updatedAtMs: number;
  nextAttemptAtMs: number;
  sentAtMs?: number;
  /** Why the row failed: the server's rejection reason, or a client reason code. */
  failure?: { reason: string; rejectedByServer: boolean };
}

export type OutboxSendResult = { outcome: "sent" } | { outcome: "rejected"; reason: string };

export type OutboxSender = (item: {
  kind: string;
  idempotencyKey: string;
  payload: unknown;
  context: OutboxContext;
}) => Promise<OutboxSendResult>;

export type OutboxStopReason =
  "offline" | "context_changed" | "transient_error" | "backoff" | "already_draining";

export interface OutboxDrainReport {
  sent: number;
  rejected: OutboxRecord[];
  /** Rows not sent because their tag does not match the active context. */
  refused: number;
  /** Rows still queued after the drain. */
  waiting: number;
  failed: number;
  stoppedBecause?: OutboxStopReason;
  error?: string;
}

export interface OutboxFailure {
  id: string;
  kind: string;
  label?: string;
  reason: string;
  rejectedByServer: boolean;
  /** A server rejection is final (server wins); other failures may be retried. */
  retryable: boolean;
}

export interface OutboxSummary {
  waiting: number;
  sending: number;
  failed: number;
  failures: OutboxFailure[];
  /** ISO time of the last successful delivery in this context, or null. */
  lastSyncAt: string | null;
}

export const OUTBOX_STATUS_EVENT = "sherivs:outbox-status";
export const OUTBOX_DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_BACKOFF_MS = 2_000;
const DEFAULT_MAX_BACKOFF_MS = 5 * 60_000;
const DEFAULT_SENT_RETENTION_MS = 7 * 24 * 60 * 60_000;

export function outboxScope(context: OutboxContext): OfflineScope {
  return { tenantId: context.organizationId, userId: context.userId, role: context.role };
}

export function sameContext(a: OutboxContext | null | undefined, b: OutboxContext): boolean {
  return !!a && a.userId === b.userId && a.organizationId === b.organizationId && a.role === b.role;
}

export function isOutboxRecord(row: StoredOutboxRow): row is OutboxRecord {
  return !isLegacyMutation(row);
}

/** Exponential backoff after `attempts` failed tries: base * 2^(attempts-1), capped. */
export function outboxBackoffMs(
  attempts: number,
  baseMs = DEFAULT_BASE_BACKOFF_MS,
  maxMs = DEFAULT_MAX_BACKOFF_MS,
): number {
  if (attempts <= 0) return 0;
  return Math.min(maxMs, baseMs * 2 ** (attempts - 1));
}

function byOrder(a: OutboxRecord, b: OutboxRecord): number {
  return a.sequence - b.sequence || a.queuedAtMs - b.queuedAtMs || (a.id < b.id ? -1 : 1);
}

export interface OutboxOptions {
  context: OutboxContext;
  database?: OfflineDatabase;
  /** Defaults to the kernel time authority. */
  time?: { now(): { at: string; atMs: number } };
  /**
   * The context that is active right now (from the signed-in session). Checked
   * before every send; a drain stops as soon as it differs from `context`.
   */
  activeContext?: () => OutboxContext | null;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  sentRetentionMs?: number;
  /** Cross-tab mutual exclusion; defaults to the Web Locks API when the browser has it. */
  lock?: <R>(name: string, run: () => Promise<R>) => Promise<R>;
}

function defaultLock(): (<R>(name: string, run: () => Promise<R>) => Promise<R>) | undefined {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  if (!locks || typeof locks.request !== "function") return undefined;
  return <R>(name: string, run: () => Promise<R>) => locks.request(name, () => run()) as Promise<R>;
}

export function createOutbox(options: OutboxOptions) {
  const context = { ...options.context };
  const scopeKey = offlineScopeKey(outboxScope(context));
  const database = options.database ?? createBrowserDatabase();
  const time = options.time ?? timeAuthority;
  const maxAttempts = options.maxAttempts ?? OUTBOX_DEFAULT_MAX_ATTEMPTS;
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const sentRetentionMs = options.sentRetentionMs ?? DEFAULT_SENT_RETENTION_MS;
  const activeContext = options.activeContext ?? (() => context);
  const crossTabLock = options.lock ?? defaultLock();
  const rowId = (idempotencyKey: string) => `outbox\u001f${scopeKey}\u001f${idempotencyKey}`;

  // In-tab serialisation of every read-modify-write.
  let chain: Promise<unknown> = Promise.resolve();
  function serial<R>(run: () => Promise<R>): Promise<R> {
    const next = chain.then(run, run);
    chain = next.catch(() => undefined);
    return next;
  }

  async function rows(): Promise<OutboxRecord[]> {
    const all = await database.readMutations(scopeKey);
    return all.filter(isOutboxRecord).sort(byOrder);
  }

  async function write(row: OutboxRecord) {
    await database.writeMutation(row);
  }

  function publish() {
    if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
    window.dispatchEvent(new CustomEvent(OUTBOX_STATUS_EVENT));
  }

  async function enqueue<T>(
    kind: string,
    payload: T,
    idempotencyKey: string,
    extra: { label?: string } = {},
  ): Promise<{ item: OutboxRecord<T>; duplicate: boolean }> {
    if (!kind.trim()) throw new Error("Outbox item requires a kind");
    if (!idempotencyKey.trim()) throw new Error("Outbox item requires an idempotency key");
    if (!sameContext(activeContext(), context)) {
      throw new Error("Outbox context is no longer active");
    }
    const result = await serial(async () => {
      const existing = await rows();
      const id = rowId(idempotencyKey);
      const found = existing.find((row) => row.id === id);
      if (found) return { item: found as OutboxRecord<T>, duplicate: true };
      const at = time.now();
      const item: OutboxRecord<T> = {
        type: "outbox",
        id,
        scopeKey,
        kind,
        idempotencyKey,
        payload,
        ...(extra.label ? { label: extra.label } : {}),
        context: { ...context },
        sequence: existing.reduce((max, row) => Math.max(max, row.sequence), 0) + 1,
        state: "queued",
        attempts: 0,
        queuedAt: at.at,
        queuedAtMs: at.atMs,
        updatedAtMs: at.atMs,
        nextAttemptAtMs: at.atMs,
      };
      await write(item as OutboxRecord);
      return { item, duplicate: false };
    });
    if (!result.duplicate) publish();
    return result;
  }

  async function drainLocked(senders: Record<string, OutboxSender>): Promise<OutboxDrainReport> {
    const report: OutboxDrainReport = { sent: 0, rejected: [], refused: 0, waiting: 0, failed: 0 };
    const start = time.now().atMs;

    // Housekeeping: prune old tombstones; a row left in "sending" was interrupted
    // (page closed mid-request). It is surfaced as failed for an explicit retry,
    // never re-sent automatically.
    for (const row of await rows()) {
      if (row.state === "sent" && (row.sentAtMs ?? row.updatedAtMs) + sentRetentionMs < start) {
        await database.deleteMutation(row.id);
      } else if (row.state === "sending") {
        await write({
          ...row,
          state: "failed",
          updatedAtMs: start,
          failure: { reason: "interrupted_send", rejectedByServer: false },
        });
      }
    }

    for (const row of await rows()) {
      if (row.state !== "queued") continue;
      const sender = senders[row.kind];
      if (!sender) continue;
      if (row.scopeKey !== scopeKey || !sameContext(row.context, context)) {
        report.refused += 1;
        continue;
      }
      if (!sameContext(activeContext(), context)) {
        report.stoppedBecause = "context_changed";
        break;
      }
      const at = time.now();
      if (row.nextAttemptAtMs > at.atMs) {
        report.stoppedBecause = "backoff";
        break;
      }
      // Re-read: another drain in this tab may have moved the row on.
      const current = (await rows()).find((item) => item.id === row.id);
      if (!current || current.state !== "queued") continue;
      await write({ ...current, state: "sending", updatedAtMs: at.atMs });

      let result: OutboxSendResult;
      try {
        result = await sender({
          kind: current.kind,
          idempotencyKey: current.idempotencyKey,
          payload: current.payload,
          context: { ...current.context },
        });
      } catch (error) {
        const after = time.now().atMs;
        const message = error instanceof Error ? error.message : "Outbox send failed";
        if (isNetworkError(error)) {
          await write({ ...current, state: "queued", updatedAtMs: after });
          report.stoppedBecause = "offline";
        } else {
          const attempts = current.attempts + 1;
          if (attempts >= maxAttempts) {
            await write({
              ...current,
              state: "failed",
              attempts,
              updatedAtMs: after,
              failure: { reason: `retries_exhausted: ${message}`, rejectedByServer: false },
            });
            report.stoppedBecause = "transient_error";
          } else {
            await write({
              ...current,
              state: "queued",
              attempts,
              updatedAtMs: after,
              nextAttemptAtMs: after + outboxBackoffMs(attempts, baseBackoffMs, maxBackoffMs),
            });
            report.stoppedBecause = "transient_error";
          }
        }
        report.error = message;
        break;
      }

      const after = time.now().atMs;
      if (result.outcome === "rejected") {
        const failed: OutboxRecord = {
          ...current,
          state: "failed",
          attempts: current.attempts + 1,
          updatedAtMs: after,
          failure: { reason: result.reason || "rejected", rejectedByServer: true },
        };
        await write(failed);
        report.rejected.push(failed);
      } else {
        const { payload: _sentPayload, ...tombstone } = current;
        void _sentPayload;
        await write({
          ...tombstone,
          state: "sent",
          attempts: current.attempts + 1,
          updatedAtMs: after,
          sentAtMs: after,
        });
        report.sent += 1;
      }
    }

    if (report.sent > 0) {
      const at = time.now().at;
      await database.writeRecord(lastSyncRecordId(scopeKey), scopeKey, { at }, at);
    }
    const final = await rows();
    report.waiting = final.filter((row) => row.state === "queued").length;
    report.failed = final.filter((row) => row.state === "failed").length;
    return report;
  }

  let draining: Promise<OutboxDrainReport> | null = null;
  /** Send queued rows in order. Concurrent calls in one tab share one drain. */
  function drain(senders: Record<string, OutboxSender>): Promise<OutboxDrainReport> {
    if (!draining) {
      const run = () => serial(() => drainLocked(senders));
      draining = (crossTabLock ? crossTabLock(`sherivs-outbox:${scopeKey}`, run) : run()).finally(
        () => {
          draining = null;
          publish();
        },
      );
    }
    return draining;
  }

  async function summary(): Promise<OutboxSummary> {
    const all = await rows();
    const marker = await database.readRecord<{ at?: string }>(lastSyncRecordId(scopeKey));
    const lastSyncAt =
      marker?.scopeKey === scopeKey && typeof marker.value?.at === "string"
        ? marker.value.at
        : null;
    return {
      waiting: all.filter((row) => row.state === "queued").length,
      sending: all.filter((row) => row.state === "sending").length,
      failed: all.filter((row) => row.state === "failed").length,
      failures: all
        .filter((row) => row.state === "failed")
        .map((row) => ({
          id: row.id,
          kind: row.kind,
          ...(row.label ? { label: row.label } : {}),
          reason: row.failure?.reason ?? "unknown",
          rejectedByServer: row.failure?.rejectedByServer ?? false,
          retryable: !(row.failure?.rejectedByServer ?? false),
        })),
      lastSyncAt,
    };
  }

  /** Put a retryable failed row back in the queue (fresh attempt budget). */
  async function retry(id: string): Promise<boolean> {
    const changed = await serial(async () => {
      const row = (await rows()).find((item) => item.id === id);
      if (!row || row.state !== "failed" || row.failure?.rejectedByServer) return false;
      const at = time.now().atMs;
      const { failure: _failure, ...rest } = row;
      void _failure;
      await write({ ...rest, state: "queued", attempts: 0, updatedAtMs: at, nextAttemptAtMs: at });
      return true;
    });
    if (changed) publish();
    return changed;
  }

  /** Explicit removal by the person (the only way an unsent row leaves the outbox). */
  async function discard(id: string): Promise<boolean> {
    const removed = await serial(async () => {
      const row = (await rows()).find((item) => item.id === id);
      if (!row || row.state === "sending") return false;
      await database.deleteMutation(row.id);
      return true;
    });
    if (removed) publish();
    return removed;
  }

  return {
    context: { ...context },
    scopeKey,
    enqueue,
    drain,
    list: rows,
    summary,
    retry,
    discard,
  };
}

export type Outbox = ReturnType<typeof createOutbox>;

/* Sender registry: feature modules register how to deliver their kind. */
const registeredSenders = new Map<string, OutboxSender>();

export function registerOutboxSender(kind: string, sender: OutboxSender): () => void {
  registeredSenders.set(kind, sender);
  return () => {
    if (registeredSenders.get(kind) === sender) registeredSenders.delete(kind);
  };
}

export function outboxSenders(): Record<string, OutboxSender> {
  return Object.fromEntries(registeredSenders);
}
