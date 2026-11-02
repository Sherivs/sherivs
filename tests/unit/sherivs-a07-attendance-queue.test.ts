import { describe, expect, it } from "vitest";
import {
  createOfflineStore,
  type OfflineDatabase,
  type OfflineMutation,
} from "@/lib/offline/indexeddb-store";
import { createAttendanceQueue, type QueuedMark } from "@/lib/offline/attendance-queue";

class MemoryDatabase implements OfflineDatabase {
  readonly records = new Map<string, { scopeKey: string; value: unknown; cachedAt: string }>();
  readonly mutations = new Map<string, OfflineMutation>();

  async readRecord<T>(id: string) {
    return this.records.get(id) as { scopeKey: string; value: T; cachedAt: string } | undefined;
  }
  async writeRecord<T>(id: string, scopeKey: string, value: T, cachedAt: string) {
    this.records.set(id, { scopeKey, value, cachedAt });
  }
  async readMutations(scopeKey: string) {
    return [...this.mutations.values()].filter((item) => item.scopeKey === scopeKey);
  }
  async writeMutation(mutation: OfflineMutation) {
    this.mutations.set(mutation.id, mutation);
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

const scope = { tenantId: "school-a", userId: "u1", role: "teacher" };
const T = () => new Date("2026-10-24T08:00:00Z");
let n = 0;
const ids = () => `i${++n}`;

function queue(
  database: MemoryDatabase,
  sync: Parameters<typeof createAttendanceQueue>[0]["sync"] = async () => ({
    applied: 0,
    conflicts: [],
  }),
) {
  return createAttendanceQueue({
    scope,
    store: createOfflineStore(scope, { database, now: T, newId: ids }),
    now: T,
    sync,
  });
}

describe("SHERIVS-A07 tenant-scoped IndexedDB attendance outbox", () => {
  it("keeps the last mark per student and day across queue instances", async () => {
    const database = new MemoryDatabase();
    const first = queue(database);
    await first.mark("s1", "2026-10-24", "absent");
    await first.mark("s1", "2026-10-24", "present");
    await first.mark("s2", "2026-10-24", "late");

    const reloaded = queue(database);
    await expect(reloaded.pending()).resolves.toMatchObject([
      { student_id: "s1", status: "present" },
      { student_id: "s2", status: "late" },
    ]);
  });

  it("flushes batches, sends device time, and empties the queue on success", async () => {
    const seen: { items: QueuedMark[]; now: string }[] = [];
    const q = queue(new MemoryDatabase(), async (_batch, items, now) => {
      seen.push({ items, now });
      return { applied: items.length, conflicts: [] };
    });
    await q.mark("s1", "2026-10-24", "present");
    await q.mark("s2", "2026-10-24", "absent");

    const report = await q.flush();
    expect(report).toMatchObject({ sent: 2, applied: 2, remaining: 0 });
    expect(seen[0]?.now).toBe("2026-10-24T08:00:00.000Z");
    expect(seen[0]?.items.every((item) => item.id && item.captured_at)).toBe(true);
    await expect(q.pending()).resolves.toHaveLength(0);
  });

  it("keeps the same item ids after network failure and retries idempotently", async () => {
    const database = new MemoryDatabase();
    let fail = true;
    const sent: string[][] = [];
    const q = queue(database, async (_batch, items) => {
      sent.push(items.map((item) => item.id));
      if (fail) throw new Error("offline");
      return { applied: 0, duplicates: items.length, conflicts: [] };
    });
    await q.mark("s1", "2026-10-24", "present");

    expect((await q.flush()).error).toBe("offline");
    await expect(q.pending()).resolves.toHaveLength(1);
    fail = false;
    const report = await q.flush();
    expect(sent[0]).toEqual(sent[1]);
    expect(report).toMatchObject({ duplicates: 1, remaining: 0 });
  });

  it("retains a server conflict for manual review and does not retry it", async () => {
    const q = queue(new MemoryDatabase(), async (_batch, items) => ({
      applied: 0,
      conflicts: items.map((item) => ({ id: item.id, why: "server_has_other_mark" })),
    }));
    await q.mark("s1", "2026-10-24", "absent");
    const report = await q.flush();

    expect(report.conflicts[0]?.why).toBe("server_has_other_mark");
    await expect(q.pending()).resolves.toHaveLength(0);
    await expect(q.conflicts()).resolves.toMatchObject([
      { student_id: "s1", why: "server_has_other_mark" },
    ]);
  });

  it("shares concurrent flushes and sends at most 500 marks per batch", async () => {
    let calls = 0;
    const sizes: number[] = [];
    const q = queue(new MemoryDatabase(), async (_batch, items) => {
      calls += 1;
      sizes.push(items.length);
      return { applied: items.length, conflicts: [] };
    });
    for (let index = 0; index < 1200; index += 1) {
      await q.mark(`s${index}`, "2026-10-24", "present");
    }

    const [first, second] = await Promise.all([q.flush(), q.flush()]);
    expect(first).toBe(second);
    expect(sizes).toEqual([500, 500, 200]);
    expect(calls).toBe(3);
  });

  it("isolates pending items between tenant scopes", async () => {
    const database = new MemoryDatabase();
    const schoolA = queue(database);
    const schoolB = createAttendanceQueue({
      scope: { tenantId: "school-b", userId: "u1", role: "teacher" },
      store: createOfflineStore(
        { tenantId: "school-b", userId: "u1", role: "teacher" },
        { database, now: T, newId: ids },
      ),
      now: T,
      sync: async () => ({ applied: 0, conflicts: [] }),
    });
    await schoolA.mark("s1", "2026-10-24", "present");
    await expect(schoolB.pending()).resolves.toHaveLength(0);
    await expect(schoolA.pending()).resolves.toHaveLength(1);
  });
});
