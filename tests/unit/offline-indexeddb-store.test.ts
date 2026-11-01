import { describe, expect, it } from "vitest";
import {
  clearLegacyOfflineStorage,
  createOfflineStore,
  offlineScopeKey,
  type OfflineDatabase,
  type OfflineMutation,
} from "@/lib/offline/indexeddb-store";

class MemoryDatabase implements OfflineDatabase {
  readonly records = new Map<string, { scopeKey: string; value: unknown }>();
  readonly mutations = new Map<string, OfflineMutation>();

  async readRecord<T>(id: string) {
    return this.records.get(id) as { scopeKey: string; value: T } | undefined;
  }
  async writeRecord<T>(id: string, scopeKey: string, value: T) {
    this.records.set(id, { scopeKey, value });
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
    for (const [id, record] of this.records) if (record.scopeKey === scopeKey) this.records.delete(id);
    for (const [id, item] of this.mutations) if (item.scopeKey === scopeKey) this.mutations.delete(id);
  }
  async clear() {
    this.records.clear();
    this.mutations.clear();
  }
}

const scope = { tenantId: "school-a", userId: "teacher-a", role: "teacher" };
const otherScope = { tenantId: "school-b", userId: "teacher-a", role: "teacher" };

function store(database: MemoryDatabase, forScope = scope) {
  let nextId = 0;
  return createOfflineStore(forScope, {
    database,
    now: () => new Date("2026-11-01T10:00:00Z"),
    newId: () => `op-${++nextId}`,
  });
}

describe("tenant-scoped offline IndexedDB store", () => {
  it("requires a complete tenant, user, and role scope", () => {
    expect(offlineScopeKey(scope)).not.toBe(offlineScopeKey(otherScope));
    expect(() => offlineScopeKey({ ...scope, tenantId: "" })).toThrow(/tenant, user, and role/);
  });

  it("keeps cached reads isolated by tenant and falls back only on network errors", async () => {
    const database = new MemoryDatabase();
    const tenantA = store(database);
    const tenantB = store(database, otherScope);
    await tenantA.write("timetable", "current", [{ id: "slot-a" }]);

    await expect(tenantB.read("timetable", "current")).resolves.toBeUndefined();
    await expect(
      tenantA.readThrough("timetable", "current", async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).resolves.toEqual({ data: [{ id: "slot-a" }], source: "offline" });
    await expect(
      tenantA.readThrough("results", "term-1", async () => {
        throw new Error("not authorized");
      }),
    ).rejects.toThrow("not authorized");
  });

  it("retries mutations with the same idempotency id and retains manual conflicts", async () => {
    const offline = store(new MemoryDatabase());
    const attendance = await offline.enqueue("attendance", "student-1:2026-11-01", { status: "present" });
    let fail = true;
    const sent: string[] = [];
    const send = async (item: OfflineMutation) => {
      sent.push(item.id);
      if (fail) throw new TypeError("Failed to fetch");
      return { outcome: "conflict" as const, reason: "server_has_other_mark" };
    };

    await expect(offline.sync(send)).resolves.toMatchObject({ applied: 0, remaining: 1 });
    fail = false;
    await expect(offline.sync(send)).resolves.toMatchObject({
      applied: 0,
      conflicts: [{ id: attendance.id, state: "conflict", conflict: "server_has_other_mark" }],
      remaining: 0,
    });
    await offline.sync(send);
    expect(sent).toEqual([attendance.id, attendance.id]);
  });

  it("clears only the requested scope", async () => {
    const database = new MemoryDatabase();
    const tenantA = store(database);
    const tenantB = store(database, otherScope);
    await tenantA.write("messages", "inbox", [{ id: "message-a" }]);
    await tenantA.enqueue("score", "assessment-1", { score: 82 });
    await tenantB.write("messages", "inbox", [{ id: "message-b" }]);
    await tenantA.clear();

    await expect(tenantA.read("messages", "inbox")).resolves.toBeUndefined();
    await expect(tenantA.pending()).resolves.toHaveLength(0);
    await expect(tenantB.read("messages", "inbox")).resolves.toEqual([{ id: "message-b" }]);
  });

  it("removes legacy offline payloads without clearing unrelated preferences", () => {
    const values = new Map([
      ["sherivs.offline.queue.v1", "queue"],
      ["sherivs.cbt.attempt-1", "answers"],
      ["theme", "dark"],
    ]);
    const storage = {
      get length() {
        return values.size;
      },
      key(index: number) {
        return [...values.keys()][index] ?? null;
      },
      removeItem(key: string) {
        values.delete(key);
      },
    };

    clearLegacyOfflineStorage(storage);
    expect([...values.keys()]).toEqual(["theme"]);
  });
});
