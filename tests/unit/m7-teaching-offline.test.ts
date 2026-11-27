/**
 * M7 (ADR-149) offline acceptance at unit level (no browser E2E was run):
 * records are queued while offline, synced once when back online, and never duplicated.
 *  - CA scores: generic outbox (PR #449) + the M06 sender, against a fake server that behaves like
 *    `m06_enter_result_scores` (one grade row per learner/subject/term/year).
 *  - Attendance: the existing M05 queue, against a fake server that behaves like
 *    `offline_attendance_capture_sync_m05` (per-item and per-batch replay detection).
 */
import { describe, expect, it } from "vitest";
import {
  createOfflineStore,
  type OfflineDatabase,
  type StoredOutboxRow,
} from "@/lib/offline/indexeddb-store";
import { createOutbox, type OutboxContext } from "@/lib/offline/outbox";
import {
  createAttendanceQueue,
  type QueuedMark,
  type SyncResult,
} from "@/lib/offline/attendance-queue";
import {
  CA_SCORE_KIND,
  caIdempotencyKey,
  createCaScoreSender,
  type CaScorePayload,
} from "@/lib/scholar/teaching/gradebook";
import { changedMarks, markAll } from "@/lib/scholar/teaching/attendance-sheet";

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
  async writeMutation(row: StoredOutboxRow) {
    this.mutations.set(row.id, structuredClone(row));
  }
  async deleteMutation(id: string) {
    this.mutations.delete(id);
  }
  async deleteScope(scopeKey: string) {
    for (const [id, item] of this.mutations)
      if (item.scopeKey === scopeKey) this.mutations.delete(id);
  }
  async clear() {
    this.mutations.clear();
  }
}

const offlineError = () => Object.assign(new TypeError("Failed to fetch"), { name: "TypeError" });
const time = {
  now: () => ({ atMs: Date.parse("2026-11-18T09:00:00Z"), at: "2026-11-18T09:00:00.000Z" }),
};
const ctx: OutboxContext = { userId: "t1", organizationId: "org-a", role: "teacher" };
const scope = { subject: "Maths", term: "First", academic_year: "2026/2027" };

/** Behaves like m06_enter_result_scores for the cases that matter here. */
function fakeResultsServer() {
  const grades = new Map<string, CaScorePayload>();
  let online = false;
  let calls = 0;
  const locked = new Set<string>();
  return {
    grades,
    get calls() {
      return calls;
    },
    setOnline(v: boolean) {
      online = v;
    },
    lock(student: string) {
      locked.add(student);
    },
    enter: async ({ data }: { data: CaScorePayload }) => {
      if (!online) throw offlineError();
      calls += 1;
      if (locked.has(data.student_id))
        throw new Error("result is locked or belongs to another author; use audited amendment");
      grades.set(`${data.student_id}|${data.subject}|${data.term}|${data.academic_year}`, data);
      return { grade_id: `g-${data.student_id}` };
    },
  };
}

const payload = (student: string, test1: number | null): CaScorePayload => ({
  student_id: student,
  ...scope,
  ca_scores: { test1 },
  terminal_score: null,
});

describe("CA entry offline via the generic outbox", () => {
  it("queues while offline, syncs once when online, and never sends a duplicate", async () => {
    const server = fakeResultsServer();
    const sender = createCaScoreSender(server.enter);
    const outbox = createOutbox({ context: ctx, database: new MemoryDatabase(), time });

    // Offline: two learners saved; a double tap re-enqueues the same keys.
    for (const s of ["s1", "s2"])
      await outbox.enqueue(CA_SCORE_KIND, payload(s, 7), caIdempotencyKey(scope, s, "save-1"));
    const again = await outbox.enqueue(
      CA_SCORE_KIND,
      payload("s1", 7),
      caIdempotencyKey(scope, "s1", "save-1"),
    );
    expect(again.duplicate).toBe(true);
    expect((await outbox.summary()).waiting).toBe(2);

    // A drain while still offline sends nothing and spends no attempt.
    const offline = await outbox.drain({ [CA_SCORE_KIND]: sender });
    expect(offline.stoppedBecause).toBe("offline");
    expect(offline.sent).toBe(0);
    expect((await outbox.list()).every((r) => r.state === "queued" && r.attempts === 0)).toBe(true);

    // Back online: each row is delivered exactly once.
    server.setOnline(true);
    const first = await outbox.drain({ [CA_SCORE_KIND]: sender });
    expect(first.sent).toBe(2);
    expect(server.calls).toBe(2);
    expect(server.grades.size).toBe(2);

    // A second drain, and a late re-enqueue of an already-sent key, send nothing more.
    await outbox.drain({ [CA_SCORE_KIND]: sender });
    const late = await outbox.enqueue(
      CA_SCORE_KIND,
      payload("s1", 7),
      caIdempotencyKey(scope, "s1", "save-1"),
    );
    expect(late.duplicate).toBe(true);
    await outbox.drain({ [CA_SCORE_KIND]: sender });
    expect(server.calls).toBe(2);
    expect((await outbox.summary()).waiting).toBe(0);
  });

  it("concurrent drains in one tab share one delivery", async () => {
    const server = fakeResultsServer();
    server.setOnline(true);
    const sender = createCaScoreSender(server.enter);
    const outbox = createOutbox({ context: ctx, database: new MemoryDatabase(), time });
    await outbox.enqueue(CA_SCORE_KIND, payload("s1", 5), caIdempotencyKey(scope, "s1", "save-9"));
    await Promise.all([
      outbox.drain({ [CA_SCORE_KIND]: sender }),
      outbox.drain({ [CA_SCORE_KIND]: sender }),
    ]);
    expect(server.calls).toBe(1);
  });

  it("sends later edits in order, so the server keeps the latest value (A -> B -> A)", async () => {
    const server = fakeResultsServer();
    server.setOnline(true);
    const sender = createCaScoreSender(server.enter);
    const outbox = createOutbox({ context: ctx, database: new MemoryDatabase(), time });
    for (const [i, v] of [
      [1, 5],
      [2, 9],
      [3, 5],
    ] as const)
      await outbox.enqueue(
        CA_SCORE_KIND,
        payload("s1", v),
        caIdempotencyKey(scope, "s1", `save-${i}`),
      );
    await outbox.drain({ [CA_SCORE_KIND]: sender });
    expect(server.calls).toBe(3);
    expect(server.grades.size).toBe(1);
    expect([...server.grades.values()][0]!.ca_scores.test1).toBe(5);
  });

  it("a server refusal is final and visible with the server's reason (server wins)", async () => {
    const server = fakeResultsServer();
    server.setOnline(true);
    server.lock("s1");
    const outbox = createOutbox({ context: ctx, database: new MemoryDatabase(), time });
    await outbox.enqueue(CA_SCORE_KIND, payload("s1", 5), caIdempotencyKey(scope, "s1", "save-1"), {
      label: "Ada · Maths",
    });
    const report = await outbox.drain({ [CA_SCORE_KIND]: createCaScoreSender(server.enter) });
    expect(report.rejected).toHaveLength(1);
    const summary = await outbox.summary();
    expect(summary.failures).toEqual([
      expect.objectContaining({ label: "Ada · Maths", rejectedByServer: true, retryable: false }),
    ]);
    expect(summary.failures[0]!.reason).toMatch(/locked/);
    expect(await outbox.retry(summary.failures[0]!.id)).toBe(false);
  });

  it("refuses to send rows queued under another role (context tagging)", async () => {
    const server = fakeResultsServer();
    server.setOnline(true);
    const database = new MemoryDatabase();
    const outbox = createOutbox({ context: ctx, database, time });
    await outbox.enqueue(CA_SCORE_KIND, payload("s1", 5), caIdempotencyKey(scope, "s1", "save-1"));
    const switched = createOutbox({
      context: ctx,
      database,
      time,
      activeContext: () => ({ ...ctx, role: "admin" }),
    });
    const report = await switched.drain({ [CA_SCORE_KIND]: createCaScoreSender(server.enter) });
    expect(report.stoppedBecause).toBe("context_changed");
    expect(server.calls).toBe(0);
  });
});

/** Behaves like offline_attendance_capture_sync_m05: replay by batch id and by item id. */
function fakeAttendanceServer() {
  const marks = new Map<string, string>();
  const items = new Set<string>();
  const batches = new Map<string, SyncResult>();
  let online = false;
  let calls = 0;
  return {
    marks,
    get calls() {
      return calls;
    },
    setOnline(v: boolean) {
      online = v;
    },
    sync: async (batch: string, queued: QueuedMark[]): Promise<SyncResult> => {
      if (!online) throw offlineError();
      calls += 1;
      const prior = batches.get(batch);
      if (prior) return { ...prior, replay: true, applied: 0, duplicates: queued.length };
      let applied = 0;
      let duplicates = 0;
      for (const item of queued) {
        if (items.has(item.id)) {
          duplicates += 1;
          continue;
        }
        items.add(item.id);
        marks.set(
          `${item.class_id}|${item.student_id}|${item.date}|${item.period_key}`,
          item.status,
        );
        applied += 1;
      }
      const result = { applied, duplicates, conflicts: [] };
      batches.set(batch, result);
      return result;
    },
  };
}

describe("attendance offline via the existing M05 queue", () => {
  const roster = [
    { student_id: "s1", display_name: "Ada", admission_number: null },
    { student_id: "s2", display_name: "Bayo", admission_number: null },
    { student_id: "s3", display_name: "Chi", admission_number: null },
  ];
  const queueScope = { tenantId: "org-a", userId: "t1", role: "teacher" };
  const now = () => new Date("2026-11-18T08:05:00Z");

  it("queues the register offline, syncs it once, and never duplicates a mark", async () => {
    const server = fakeAttendanceServer();
    let id = 0;
    // The real M05 queue on the real offline store, over an in-memory database (no IndexedDB in node).
    const store = createOfflineStore(queueScope, {
      database: new MemoryDatabase(),
      now,
      newId: () => `item-${++id}`,
    });
    const q = createAttendanceQueue({ scope: queueScope, store, sync: server.sync, now });

    const sheet = { ...markAll(roster, "present"), s2: "absent" as const };
    for (const mark of changedMarks("c1", "2026-11-18", sheet, [])) await q.markForClass(mark);
    // Re-marking the same learner offline replaces the pending item; it does not add a second.
    await q.markForClass({
      class_id: "c1",
      student_id: "s2",
      date: "2026-11-18",
      status: "late",
      shift_id: null,
      period_key: "daily",
    });
    expect(await q.pending()).toHaveLength(3);

    const offline = await q.flush();
    expect(offline.error).toBeTruthy();
    expect(offline.remaining).toBe(3);
    expect(server.marks.size).toBe(0);

    server.setOnline(true);
    const sent = await q.flush();
    expect(sent).toMatchObject({ sent: 3, applied: 3, duplicates: 0, remaining: 0 });
    expect(server.marks.size).toBe(3);
    expect(server.marks.get("c1|s2|2026-11-18|daily")).toBe("late");

    // Nothing left to send; a second flush makes no server call.
    const callsAfter = server.calls;
    expect((await q.flush()).sent).toBe(0);
    expect(server.calls).toBe(callsAfter);
  });

  it("a resend of an already-applied batch is counted as duplicates, not new marks", async () => {
    const server = fakeAttendanceServer();
    server.setOnline(true);
    const marks: QueuedMark[] = [
      {
        id: "i-1",
        class_id: "c1",
        student_id: "s1",
        date: "2026-11-18",
        status: "present",
        captured_at: "2026-11-18T08:00:00Z",
        shift_id: null,
        period_key: "daily",
      },
    ];
    expect(await server.sync("b-i-1-1", marks)).toMatchObject({ applied: 1, duplicates: 0 });
    expect(await server.sync("b-i-1-1", marks)).toMatchObject({
      replay: true,
      applied: 0,
      duplicates: 1,
    });
    expect(await server.sync("b-other", marks)).toMatchObject({ applied: 0, duplicates: 1 });
    expect(server.marks.size).toBe(1);
  });
});
