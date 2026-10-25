import { describe, expect, it } from "vitest";
import { createAttendanceQueue, type KV, type QueuedMark } from "@/lib/offline/attendance-queue";

const mem = (): KV & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};
const T = () => new Date("2026-10-24T08:00:00Z");
let n = 0; const ids = () => `i${++n}`;

describe("SHERIVS-A07 offline attendance queue", () => {
  it("keeps the last mark per student and day, and survives a reload", () => {
    const s = mem();
    const q = createAttendanceQueue({ storage: s, userId: "u1", newId: ids, now: T, sync: async () => ({ applied: 0, conflicts: [] }) });
    q.mark("s1", "2026-10-24", "absent"); q.mark("s1", "2026-10-24", "present"); q.mark("s2", "2026-10-24", "late");
    const again = createAttendanceQueue({ storage: s, userId: "u1", now: T, sync: async () => ({ applied: 0, conflicts: [] }) });
    expect(again.pending().map((x) => `${x.student_id}:${x.status}`)).toEqual(["s1:present", "s2:late"]);
  });

  it("flushes, sends device time, and empties the queue on success", async () => {
    const s = mem(); const seen: { items: QueuedMark[]; now: string }[] = [];
    const q = createAttendanceQueue({ storage: s, userId: "u1", newId: ids, now: () => new Date("2026-10-24T08:00:00Z"),
      sync: async (_b, items, now) => { seen.push({ items, now }); return { applied: items.length, conflicts: [] }; } });
    q.mark("s1", "2026-10-24", "present"); q.mark("s2", "2026-10-24", "absent");
    const r = await q.flush();
    expect(r).toMatchObject({ sent: 2, applied: 2, remaining: 0 });
    expect(seen[0].now).toBe("2026-10-24T08:00:00.000Z");
    expect(seen[0].items.every((x) => x.id && x.captured_at)).toBe(true);
    expect(q.pending()).toHaveLength(0);
  });

  it("keeps everything queued when the network fails, and retries with the same item ids", async () => {
    const s = mem(); let fail = true; const sent: string[][] = [];
    const q = createAttendanceQueue({ storage: s, userId: "u1", newId: ids, now: T,
      sync: async (_b, items) => { sent.push(items.map((x) => x.id)); if (fail) throw new Error("offline"); return { applied: 0, duplicates: items.length, conflicts: [] }; } });
    q.mark("s1", "2026-10-24", "present");
    const r1 = await q.flush(); expect(r1.error).toBe("offline"); expect(q.pending()).toHaveLength(1);
    fail = false; const r2 = await q.flush();
    expect(sent[0]).toEqual(sent[1]); expect(r2).toMatchObject({ duplicates: 1, remaining: 0 });
  });

  it("drops conflicts from the queue (they are in the server's conflict queue) and reports them", async () => {
    const q = createAttendanceQueue({ storage: mem(), userId: "u1", newId: ids, now: T,
      sync: async (_b, items) => ({ applied: 0, conflicts: items.map((x) => ({ id: x.id, why: "server_has_other_mark" })) }) });
    q.mark("s1", "2026-10-24", "absent");
    const r = await q.flush();
    expect(r.conflicts[0].why).toBe("server_has_other_mark"); expect(r.remaining).toBe(0);
  });

  it("shares one flush between concurrent callers and sends in batches of at most 500", async () => {
    let calls = 0; const sizes: number[] = [];
    const q = createAttendanceQueue({ storage: mem(), userId: "u1", newId: ids, now: T,
      sync: async (_b, items) => { calls++; sizes.push(items.length); return { applied: items.length, conflicts: [] }; } });
    for (let i = 0; i < 1200; i++) q.mark(`s${i}`, "2026-10-24", "present");
    const [a, b] = await Promise.all([q.flush(), q.flush()]);
    expect(a).toBe(b); expect(sizes).toEqual([500, 500, 200]); expect(calls).toBe(3);
  });

  it("separates users on a shared device and flushes when back online", async () => {
    const s = mem(); let flushed = 0;
    const q1 = createAttendanceQueue({ storage: s, userId: "u1", newId: ids, now: T, sync: async (_b, i) => { flushed += i.length; return { applied: i.length, conflicts: [] }; } });
    const q2 = createAttendanceQueue({ storage: s, userId: "u2", newId: ids, now: T, sync: async () => ({ applied: 0, conflicts: [] }) });
    q1.mark("s1", "2026-10-24", "present");
    expect(q2.pending()).toHaveLength(0);
    const handlers: Record<string, () => void> = {};
    const off = q1.autoFlush({ addEventListener: (t, f) => { handlers[t] = f; }, removeEventListener: (t) => { delete handlers[t]; } });
    handlers.online(); await new Promise((r) => setTimeout(r, 0));
    expect(flushed).toBe(1); off(); expect(handlers.online).toBeUndefined();
  });
});
