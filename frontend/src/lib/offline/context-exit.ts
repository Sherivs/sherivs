/**
 * SV1-LITE wipe rule (ADR-109): leaving a context (sign-out, organization or
 * role switch) never carries local tenant data or queued items into the next
 * context.
 *
 *  - Before a person-initiated exit, unsent items of the current context are
 *    counted. If any exist, the person must choose: send them now, or discard
 *    them. "Keep waiting" is not offered across contexts, because an item
 *    queued under one context must never be sent under another.
 *  - After the choice (or when the exit is forced, for example an
 *    administrator changed the role), the whole scope is deleted: cached
 *    reads, legacy queue rows and outbox rows.
 *  - A forced wipe that removes unsent items records only a count, keyed to
 *    the person's user id, so the next time that same person opens the shell
 *    they are told; nothing is dropped silently, and no content survives.
 */
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import {
  createBrowserDatabase,
  isLegacyMutation,
  offlineScopeKey,
  type OfflineDatabase,
  type OfflineScope,
  type StoredOutboxRow,
} from "./indexeddb-store";
import {
  createOutbox,
  isOutboxRecord,
  outboxSenders,
  type OutboxContext,
  type OutboxSender,
} from "./outbox";

const timeAuthority = new TimeAuthority(new SystemClock());

export const APP_SHELL_CACHE_PREFIX = "sherivs-app-shell-";
export const DISCARDED_NOTICE_KEY = "sherivs.lite.discarded-unsent";

export interface UnsentSummary {
  /** Everything that has not reached the server: legacy pending + conflicts, outbox queued + sending + failed. */
  total: number;
  legacyPending: number;
  legacyConflicts: number;
  outboxWaiting: number;
  outboxFailed: number;
}

function isUnsent(row: StoredOutboxRow): boolean {
  if (isLegacyMutation(row)) return row.state === "pending" || row.state === "conflict";
  return row.state !== "sent";
}

export function summariseUnsent(rows: StoredOutboxRow[]): UnsentSummary {
  const summary: UnsentSummary = {
    total: 0,
    legacyPending: 0,
    legacyConflicts: 0,
    outboxWaiting: 0,
    outboxFailed: 0,
  };
  for (const row of rows) {
    if (isLegacyMutation(row)) {
      if (row.state === "pending") summary.legacyPending += 1;
      else if (row.state === "conflict") summary.legacyConflicts += 1;
    } else if (isOutboxRecord(row)) {
      if (row.state === "queued" || row.state === "sending") summary.outboxWaiting += 1;
      else if (row.state === "failed") summary.outboxFailed += 1;
    }
  }
  summary.total =
    summary.legacyPending + summary.legacyConflicts + summary.outboxWaiting + summary.outboxFailed;
  return summary;
}

export async function countUnsent(
  scope: OfflineScope,
  database: OfflineDatabase = createBrowserDatabase(),
): Promise<UnsentSummary> {
  return summariseUnsent(await database.readMutations(offlineScopeKey(scope)));
}

export function contextFromScope(scope: OfflineScope): OutboxContext {
  return { userId: scope.userId, organizationId: scope.tenantId, role: scope.role };
}

/**
 * "Send now": try to deliver everything unsent in this context while it is still
 * the active one. Returns what is still unsent afterwards (failures included), so
 * the caller can ask the person to discard the rest or stay.
 */
export async function sendBeforeExit(
  scope: OfflineScope,
  options: {
    database?: OfflineDatabase;
    senders?: Record<string, OutboxSender>;
    /** Delivers legacy queue rows (the attendance queue's own flush). */
    flushLegacy?: (scope: OfflineScope) => Promise<unknown>;
  } = {},
): Promise<UnsentSummary> {
  const database = options.database ?? createBrowserDatabase();
  const flushLegacy = options.flushLegacy ?? flushLegacyAttendance;
  const before = await countUnsent(scope, database);
  if (before.legacyPending > 0) {
    try {
      await flushLegacy(scope);
    } catch {
      /* What is left is counted below and shown to the person. */
    }
  }
  if (before.outboxWaiting > 0) {
    const outbox = createOutbox({ context: contextFromScope(scope), database });
    try {
      await outbox.drain(options.senders ?? outboxSenders());
    } catch {
      /* Counted below. */
    }
  }
  return countUnsent(scope, database);
}

async function flushLegacyAttendance(scope: OfflineScope): Promise<unknown> {
  const { createClassAttendanceQueue } = await import("./class-attendance-queue");
  return createClassAttendanceQueue({
    scope,
    now: () => new Date(timeAuthority.now().atMs),
  }).flush();
}

/** Delete every local row and cached read of one context. */
export async function wipeContext(
  scope: OfflineScope,
  database: OfflineDatabase = createBrowserDatabase(),
): Promise<void> {
  await database.deleteScope(offlineScopeKey(scope));
}

/**
 * Before a forced wipe: record how many unsent items each affected person is
 * about to lose (a count only). With no scope, every scope is counted.
 */
export async function noteUnsentBeforeWipe(
  scope?: OfflineScope,
  options: {
    database?: OfflineDatabase;
    storage?: Pick<Storage, "getItem" | "setItem">;
  } = {},
): Promise<number> {
  const database = options.database ?? createBrowserDatabase();
  let rows: StoredOutboxRow[];
  if (scope) rows = await database.readMutations(offlineScopeKey(scope));
  else if (database.readAllMutations) rows = await database.readAllMutations();
  else return 0;
  const perUser = new Map<string, number>();
  for (const row of rows) {
    if (!isUnsent(row)) continue;
    const userId = userIdOfScopeKey(row.scopeKey);
    if (userId) perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
  }
  let total = 0;
  for (const [userId, count] of perUser) {
    addDiscardedNotice(userId, count, options.storage);
    total += count;
  }
  return total;
}

function userIdOfScopeKey(scopeKey: string): string | null {
  try {
    const parsed: unknown = JSON.parse(scopeKey);
    return Array.isArray(parsed) && typeof parsed[1] === "string" ? parsed[1] : null;
  } catch {
    return null;
  }
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readNotices(storage: Pick<Storage, "getItem"> | undefined): Record<string, number> {
  try {
    const raw = storage?.getItem(DISCARDED_NOTICE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isInteger(value) && value > 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function addDiscardedNotice(
  userId: string,
  count: number,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = defaultStorage(),
): void {
  if (!userId || count <= 0 || !storage) return;
  const notices = readNotices(storage);
  notices[userId] = (notices[userId] ?? 0) + count;
  try {
    storage.setItem(DISCARDED_NOTICE_KEY, JSON.stringify(notices));
  } catch {
    /* Storage blocked: the wipe still happens. */
  }
}

/** Read and clear the notice for this person only. */
export function takeDiscardedNotice(
  userId: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined = defaultStorage(),
): number {
  if (!userId || !storage) return 0;
  const notices = readNotices(storage);
  const count = notices[userId] ?? 0;
  if (!count) return 0;
  delete notices[userId];
  try {
    if (Object.keys(notices).length) storage.setItem(DISCARDED_NOTICE_KEY, JSON.stringify(notices));
    else storage.removeItem(DISCARDED_NOTICE_KEY);
  } catch {
    /* Shown once per page load at worst. */
  }
  return count;
}

/** Remove the service worker's versioned app-shell caches (current and older versions). */
export async function clearAppShellCaches(
  cacheStorage: Pick<CacheStorage, "keys" | "delete"> | undefined = typeof caches === "undefined"
    ? undefined
    : caches,
): Promise<number> {
  if (!cacheStorage) return 0;
  let removed = 0;
  for (const key of await cacheStorage.keys()) {
    if (key.startsWith(APP_SHELL_CACHE_PREFIX) && (await cacheStorage.delete(key))) removed += 1;
  }
  return removed;
}

export interface SyncSummary extends UnsentSummary {
  /** Items waiting to be sent (legacy pending + outbox queued/sending). */
  waiting: number;
  /** Items that need the person: legacy conflicts + outbox failures. */
  needsAttention: number;
  failures: { id: string; label: string; reason: string; retryable: boolean }[];
  lastSyncAt: string | null;
}

/** One read for the connection indicator: counts, failures with reasons, last sync. */
export async function readSyncSummary(
  scope: OfflineScope,
  database: OfflineDatabase = createBrowserDatabase(),
): Promise<SyncSummary> {
  const rows = await database.readMutations(offlineScopeKey(scope));
  const unsent = summariseUnsent(rows);
  const outbox = await createOutbox({ context: contextFromScope(scope), database }).summary();
  const legacyFailures = rows.filter(isLegacyMutation).flatMap((row) =>
    row.state === "conflict"
      ? [
          {
            id: row.id,
            label: row.kind === "attendance" ? "Attendance mark" : "Score",
            reason: row.conflict ?? "manual_review_required",
            retryable: false,
          },
        ]
      : [],
  );
  return {
    ...unsent,
    waiting: unsent.legacyPending + unsent.outboxWaiting,
    needsAttention: unsent.legacyConflicts + unsent.outboxFailed,
    failures: [
      ...legacyFailures,
      ...outbox.failures.map((failure) => ({
        id: failure.id,
        label: failure.label ?? failure.kind,
        reason: failure.reason,
        retryable: failure.retryable,
      })),
    ],
    lastSyncAt: outbox.lastSyncAt,
  };
}

/** The indicator's Retry action: re-queue retryable failures and send what is waiting. */
export async function retryWaitingAndFailed(
  scope: OfflineScope,
  options: {
    database?: OfflineDatabase;
    senders?: Record<string, OutboxSender>;
    flushLegacy?: (scope: OfflineScope) => Promise<unknown>;
  } = {},
): Promise<SyncSummary> {
  const database = options.database ?? createBrowserDatabase();
  const outbox = createOutbox({ context: contextFromScope(scope), database });
  for (const failure of (await outbox.summary()).failures) {
    if (failure.retryable) await outbox.retry(failure.id);
  }
  await sendBeforeExit(scope, { ...options, database });
  return readSyncSummary(scope, database);
}

const LAGOS_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  hour: "2-digit",
  minute: "2-digit",
});
const LAGOS_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  day: "numeric",
  month: "short",
});

/** "Last sync 10:42" today, "Last sync 16 Nov, 10:42" otherwise, in Africa/Lagos time. */
export function formatLastSync(
  at: string | null,
  nowMs: number = timeAuthority.now().atMs,
): string {
  const atMs = at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(atMs)) return "Not synced yet";
  const day = LAGOS_DAY.format(atMs);
  const time = LAGOS_TIME.format(atMs);
  return day === LAGOS_DAY.format(nowMs) ? `Last sync ${time}` : `Last sync ${day}, ${time}`;
}
