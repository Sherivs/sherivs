import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createOfflineStore,
  offlineScopeKey,
  type OfflineDatabase,
  type StoredOutboxRow,
} from "@/lib/offline/indexeddb-store";
import {
  createOutbox,
  outboxBackoffMs,
  type OutboxContext,
  type OutboxSender,
} from "@/lib/offline/outbox";
import {
  addDiscardedNotice,
  clearAppShellCaches,
  countUnsent,
  formatLastSync,
  noteUnsentBeforeWipe,
  readSyncSummary,
  sendBeforeExit,
  takeDiscardedNotice,
  wipeContext,
} from "@/lib/offline/context-exit";
import { dataSaverKey, readDataSaver, writeDataSaver } from "@/lib/offline/data-saver";

/** Fake IndexedDB: the same in-memory OfflineDatabase shape the existing offline tests use. */
class MemoryDatabase implements OfflineDatabase {
  readonly records = new Map<string, { scopeKey: string; value: unknown; cachedAt: string }>();
  readonly mutations = new Map<string, StoredOutboxRow>();
  async readRecord<T>(id: string) {
    return this.records.get(id) as { scopeKey: string; value: T; cachedAt: string } | undefined;
  }
  async writeRecord<T>(id: string, scopeKey: string, value: T, cachedAt: string) {
    this.records.set(id, { scopeKey, value, cachedAt });
  }
  async readMutations(scopeKey: string) {
    return [...this.mutations.values()].filter((item) => item.scopeKey === scopeKey);
  }
  async readAllMutations() {
    return [...this.mutations.values()];
  }
  async writeMutation(row: StoredOutboxRow) {
    this.mutations.set(row.id, structuredClone(row));
  }
  async deleteMutation(id: string) {
    this.mutations.delete(id);
  }
  async deleteScope(scopeKey: string) {
    for (const [id, record] of this.records)
      if (record.scopeKey === scopeKey) this.records.delete(id);
    for (const [id, item] of this.mutations)
      if (item.scopeKey === scopeKey) this.mutations.delete(id);
  }
  async clear() {
    this.records.clear();
    this.mutations.clear();
  }
}

function clock(startMs = Date.parse("2026-11-17T09:00:00Z")) {
  let ms = startMs;
  return {
    now: () => ({ atMs: ms, at: new Date(ms).toISOString() }),
    advance: (by: number) => {
      ms += by;
    },
  };
}

const ctxA: OutboxContext = { userId: "u-1", organizationId: "org-a", role: "member" };
const ctxB: OutboxContext = { userId: "u-1", organizationId: "org-a", role: "admin" };
const scopeOf = (c: OutboxContext) => ({
  tenantId: c.organizationId,
  userId: c.userId,
  role: c.role,
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  };
}

describe("SV1-LITE outbox", () => {
  it("enqueues tagged rows and never sends the same idempotency key twice", async () => {
    const database = new MemoryDatabase();
    const time = clock();
    const outbox = createOutbox({ context: ctxA, database, time });
    const first = await outbox.enqueue("note", { text: "a" }, "key-1");
    const again = await outbox.enqueue("note", { text: "changed" }, "key-1");
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(first.item.context).toEqual(ctxA);
    expect(first.item.state).toBe("queued");

    const sent: string[] = [];
    const sender: OutboxSender = async (item) => {
      sent.push(item.idempotencyKey);
      return { outcome: "sent" };
    };
    await expect(outbox.drain({ note: sender })).resolves.toMatchObject({ sent: 1, waiting: 0 });
    await outbox.enqueue("note", { text: "late duplicate" }, "key-1");
    await outbox.drain({ note: sender });
    expect(sent).toEqual(["key-1"]);
    const [row] = await outbox.list();
    expect(row).toMatchObject({ state: "sent" });
    expect(row).not.toHaveProperty("payload");
    expect((await outbox.summary()).lastSyncAt).toBe(time.now().at);
  });

  it("drains in order and stops on a transient error with bounded retries and backoff", async () => {
    const database = new MemoryDatabase();
    const time = clock();
    const outbox = createOutbox({ context: ctxA, database, time, maxAttempts: 3 });
    await outbox.enqueue("note", 1, "k1");
    await outbox.enqueue("note", 2, "k2");
    const order: unknown[] = [];
    let fail = true;
    const sender: OutboxSender = async (item) => {
      order.push(item.payload);
      if (fail && item.payload === 1) throw new Error("server 500");
      return { outcome: "sent" };
    };
    const r1 = await outbox.drain({ note: sender });
    expect(r1).toMatchObject({ sent: 0, waiting: 2, stoppedBecause: "transient_error" });
    expect(order).toEqual([1]);
    // Inside the backoff window nothing is sent.
    expect(await outbox.drain({ note: sender })).toMatchObject({ stoppedBecause: "backoff" });
    expect(order).toEqual([1]);
    time.advance(outboxBackoffMs(1));
    await outbox.drain({ note: sender });
    time.advance(outboxBackoffMs(2));
    const r3 = await outbox.drain({ note: sender });
    expect(r3).toMatchObject({ failed: 1, waiting: 1, sent: 0 });
    const summary = await outbox.summary();
    expect(summary.failures[0]).toMatchObject({ retryable: true });
    expect(summary.failures[0]!.reason).toMatch(/^retries_exhausted/);
    // k2 stayed behind k1 until k1 left the queue, then went.
    expect(order).toEqual([1, 1, 1]);
    fail = false;
    expect(await outbox.retry(summary.failures[0]!.id)).toBe(true);
    await outbox.drain({ note: sender });
    expect(order).toEqual([1, 1, 1, 1, 2]);
  });

  it("does not spend an attempt when the device is offline", async () => {
    const outbox = createOutbox({ context: ctxA, database: new MemoryDatabase(), time: clock() });
    await outbox.enqueue("note", 1, "k1");
    const report = await outbox.drain({
      note: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(report.stoppedBecause).toBe("offline");
    expect((await outbox.list())[0]).toMatchObject({ state: "queued", attempts: 0 });
  });

  it("conflict rule: server wins, the item stays visible with its reason, never silently dropped", async () => {
    const outbox = createOutbox({ context: ctxA, database: new MemoryDatabase(), time: clock() });
    await outbox.enqueue("score", { v: 1 }, "k1", { label: "Score for item 1" });
    await outbox.enqueue("score", { v: 2 }, "k2");
    const report = await outbox.drain({
      score: async (item) =>
        item.idempotencyKey === "k1"
          ? { outcome: "rejected", reason: "version_changed" }
          : { outcome: "sent" },
    });
    expect(report.sent).toBe(1);
    expect(report.rejected).toHaveLength(1);
    const summary = await outbox.summary();
    expect(summary.failures).toEqual([
      expect.objectContaining({
        label: "Score for item 1",
        reason: "version_changed",
        rejectedByServer: true,
        retryable: false,
      }),
    ]);
    const failedRow = (await outbox.list()).find((row) => row.idempotencyKey === "k1");
    expect(failedRow).toMatchObject({ state: "failed", payload: { v: 1 } });
    // A server rejection cannot be auto-retried; only an explicit discard removes it.
    expect(await outbox.retry(failedRow!.id)).toBe(false);
    await outbox.drain({ score: async () => ({ outcome: "sent" }) });
    expect((await outbox.list()).find((row) => row.id === failedRow!.id)?.state).toBe("failed");
    expect(await outbox.discard(failedRow!.id)).toBe(true);
    expect((await outbox.summary()).failed).toBe(0);
  });

  it("surfaces an interrupted send as a failure instead of re-sending it", async () => {
    const database = new MemoryDatabase();
    const outbox = createOutbox({ context: ctxA, database, time: clock() });
    const { item } = await outbox.enqueue("note", 1, "k1");
    await database.writeMutation({ ...item, state: "sending" });
    let calls = 0;
    await outbox.drain({ note: async () => (calls++, { outcome: "sent" }) });
    expect(calls).toBe(0);
    expect((await outbox.summary()).failures[0]).toMatchObject({ reason: "interrupted_send" });
  });
});

describe("SV1-LITE context isolation and wipe", () => {
  it("after a role switch, reads return nothing from the previous context", async () => {
    const database = new MemoryDatabase();
    const time = clock();
    const before = createOfflineStore(scopeOf(ctxA), {
      database,
      now: () => new Date(time.now().atMs),
    });
    await before.write("workspace", "manifest", { secret: "org-a member data" });
    await createOutbox({ context: ctxA, database, time }).enqueue("note", { x: 1 }, "k1");

    const after = createOfflineStore(scopeOf(ctxB), {
      database,
      now: () => new Date(time.now().atMs),
    });
    await expect(after.read("workspace", "manifest")).resolves.toBeUndefined();
    await expect(createOutbox({ context: ctxB, database, time }).list()).resolves.toEqual([]);
    await expect(after.list()).resolves.toEqual([]);

    await wipeContext(scopeOf(ctxA), database);
    expect(database.records.size).toBe(0);
    expect(database.mutations.size).toBe(0);
  });

  it("the drain refuses items tagged with another context", async () => {
    const database = new MemoryDatabase();
    const time = clock();
    const outboxA = createOutbox({ context: ctxA, database, time });
    const { item } = await outboxA.enqueue("note", 1, "k1");
    // A row stored under A's scope but tagged with B's context (tampered / corrupt).
    await database.writeMutation({
      ...item,
      id: `${item.id}-x`,
      idempotencyKey: "k2",
      context: ctxB,
    });
    let sent = 0;
    const sender: OutboxSender = async () => (sent++, { outcome: "sent" });
    const report = await outboxA.drain({ note: sender });
    expect(report.refused).toBe(1);
    expect(sent).toBe(1);

    // After the switch the active context is B: A's outbox sends nothing.
    await outboxA.enqueue("note", 3, "k3");
    const switched = createOutbox({ context: ctxA, database, time, activeContext: () => ctxB });
    const r2 = await switched.drain({ note: sender });
    expect(r2.stoppedBecause).toBe("context_changed");
    expect(sent).toBe(1);
    await expect(switched.enqueue("note", 4, "k4")).rejects.toThrow(/no longer active/);
    // B's own outbox cannot see or send A's rows.
    expect(
      await createOutbox({ context: ctxB, database, time }).drain({ note: sender }),
    ).toMatchObject({ sent: 0, waiting: 0 });
  });

  it("counts unsent items across legacy and outbox rows, sends before exit, and reports what is left", async () => {
    const database = new MemoryDatabase();
    const time = clock();
    const legacy = createOfflineStore(scopeOf(ctxA), {
      database,
      now: () => new Date(time.now().atMs),
    });
    await legacy.enqueue("attendance", "e1", { status: "present" });
    const outbox = createOutbox({ context: ctxA, database, time });
    await outbox.enqueue("note", 1, "k1");
    await outbox.enqueue("bad", 2, "k2");
    expect(await countUnsent(scopeOf(ctxA), database)).toMatchObject({
      total: 3,
      legacyPending: 1,
      outboxWaiting: 2,
    });
    let flushed = 0;
    const left = await sendBeforeExit(scopeOf(ctxA), {
      database,
      senders: {
        note: async () => ({ outcome: "sent" }),
        bad: async () => ({ outcome: "rejected", reason: "not_allowed" }),
      },
      flushLegacy: async () => {
        flushed += 1;
        for (const row of await legacy.pending()) await legacy.discard(row.id);
      },
    });
    expect(flushed).toBe(1);
    expect(left).toMatchObject({ total: 1, outboxFailed: 1 });
    const summary = await readSyncSummary(scopeOf(ctxA), database);
    expect(summary.failures).toEqual([expect.objectContaining({ reason: "not_allowed" })]);
    expect(summary.lastSyncAt).not.toBeNull();
  });

  it("a forced wipe leaves only a per-person count notice", async () => {
    const database = new MemoryDatabase();
    const storage = memoryStorage();
    await createOutbox({ context: ctxA, database, time: clock() }).enqueue("note", 1, "k1");
    await createOutbox({
      context: { userId: "u-2", organizationId: "org-b", role: "member" },
      database,
      time: clock(),
    }).enqueue("note", 1, "k1");
    expect(await noteUnsentBeforeWipe(undefined, { database, storage })).toBe(2);
    await database.clear();
    expect(takeDiscardedNotice("u-3", storage)).toBe(0);
    expect(takeDiscardedNotice("u-1", storage)).toBe(1);
    expect(takeDiscardedNotice("u-1", storage)).toBe(0);
    addDiscardedNotice("u-2", 2, storage);
    expect(takeDiscardedNotice("u-2", storage)).toBe(3);
    expect(storage.values.size).toBe(0);
  });

  it("clears every versioned app-shell cache and nothing else", async () => {
    const keys = new Set(["sherivs-app-shell-v1", "sherivs-app-shell-v0", "other-cache"]);
    const removed = await clearAppShellCaches({
      keys: async () => [...keys],
      delete: async (key: string) => keys.delete(key),
    });
    expect(removed).toBe(2);
    expect([...keys]).toEqual(["other-cache"]);
  });

  it("keeps the scope key compatible with the existing store", () => {
    expect(createOutbox({ context: ctxA, database: new MemoryDatabase() }).scopeKey).toBe(
      offlineScopeKey(scopeOf(ctxA)),
    );
  });
});

describe("SV1-LITE data saver and sync labels", () => {
  it("stores the preference per context and announces changes immediately", () => {
    const storage = memoryStorage();
    const key = dataSaverKey(scopeOf(ctxA));
    expect(key.startsWith("sherivs.offline.data-saver:")).toBe(true);
    const events: unknown[] = [];
    const target = {
      dispatchEvent: (event: Event) => (events.push((event as CustomEvent).detail), true),
    };
    writeDataSaver(key, true, storage, target);
    expect(readDataSaver(key, storage)).toBe(true);
    expect(readDataSaver(dataSaverKey(scopeOf(ctxB)), storage)).toBe(false);
    writeDataSaver(key, false, storage, target);
    expect(readDataSaver(key, storage)).toBe(false);
    expect(events).toEqual([
      { key, on: true },
      { key, on: false },
    ]);
  });

  it("formats the last sync in Africa/Lagos time", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    expect(formatLastSync(null, now)).toBe("Not synced yet");
    expect(formatLastSync("2026-11-17T09:42:00Z", now)).toBe("Last sync 10:42");
    expect(formatLastSync("2026-11-16T09:42:00Z", now)).toBe("Last sync 16 Nov, 10:42");
  });

  it("wires the guard into sign-out and switch, and the indicator is polite, labelled and 44px", () => {
    const shell = readFileSync("frontend/src/components/app-shell/app-shell.tsx", "utf8");
    const status = readFileSync("frontend/src/components/app-shell/connection-status.tsx", "utf8");
    const css = readFileSync("frontend/src/components/app-shell/app-shell.css", "utf8");
    const sw = readFileSync("public/sw.js", "utf8");
    expect(shell).toContain('exitGuard.guard("sign-out"');
    expect(shell).toContain('exitGuard.guard("switch"');
    expect(shell).toContain("await wipeContext(previous)");
    expect(status).toContain('aria-live="polite"');
    expect(status).toContain("Retry sending");
    expect(css).toMatch(/\.app-shell-connection-action,[\s\S]*?min-height: 2\.75rem/);
    expect(sw).toContain("key.startsWith(APP_SHELL_CACHE_PREFIX) && key !== APP_SHELL_CACHE");
  });
});
