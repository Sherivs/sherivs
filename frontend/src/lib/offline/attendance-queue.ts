/**
 * Attendance outbox (SHERIVS-A07): tenant-scoped IndexedDB persistence,
 * stable per-item ids and server-enforced duplicate/conflict handling.
 */
import { createOfflineStore, type OfflineScope, type OfflineStore } from "./indexeddb-store";

export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type QueuedMark = {
  id: string;
  student_id: string;
  date: string;
  status: AttendanceStatus;
  captured_at: string;
};
export type SyncResult = {
  applied: number;
  duplicates?: number;
  conflicts: { id?: string; why: string }[];
  replay?: boolean;
  skew_seconds?: number;
};
export type Sync = (batch: string, items: QueuedMark[], clientNow: string) => Promise<SyncResult>;

const MAX_BATCH = 500;

function toMark(item: { id: string; payload: unknown }): QueuedMark {
  return { id: item.id, ...(item.payload as Omit<QueuedMark, "id">) };
}

export function createAttendanceQueue(opts: {
  scope: OfflineScope;
  store?: OfflineStore;
  sync: Sync;
  /** Injected clock (time-source discipline: lib code never samples the wall clock). */
  now: () => Date;
  newId?: () => string;
}) {
  const now = opts.now;
  const store =
    opts.store ??
    createOfflineStore(opts.scope, {
      now: opts.now,
      newId: opts.newId,
    });
  let flushing: Promise<FlushReport> | null = null;

  async function mark(
    student_id: string,
    date: string,
    status: AttendanceStatus,
  ): Promise<QueuedMark> {
    const entityId = `${student_id}:${date}`;
    const previous = await store.pending("attendance");
    for (const item of previous) {
      if (item.entityId === entityId) await store.discard(item.id);
    }
    const mutation = await store.enqueue("attendance", entityId, {
      student_id,
      date,
      status,
      captured_at: now().toISOString(),
    });
    return toMark(mutation);
  }

  type FlushReport = {
    sent: number;
    applied: number;
    duplicates: number;
    conflicts: { id?: string; why: string }[];
    remaining: number;
    error?: string;
  };

  async function flushOnce(): Promise<FlushReport> {
    const report: FlushReport = { sent: 0, applied: 0, duplicates: 0, conflicts: [], remaining: 0 };
    await store.setSyncing(true);
    try {
      for (;;) {
        const items = (await store.pending("attendance")).slice(0, MAX_BATCH);
        if (!items.length) break;
        const marks = items.map(toMark);
        const batch = `b-${marks[0]!.id}-${marks.length}`;
        let result: SyncResult;
        try {
          result = await opts.sync(batch, marks, now().toISOString());
        } catch (error) {
          report.error = error instanceof Error ? error.message : "Attendance sync failed";
          break;
        }

        report.sent += marks.length;
        report.applied += result.applied;
        report.duplicates += result.duplicates ?? 0;
        report.conflicts.push(...result.conflicts);
        const conflictsById = new Map(
          result.conflicts
            .filter((conflict) => conflict.id)
            .map((conflict) => [conflict.id!, conflict.why]),
        );
        for (const item of items) {
          const conflict = conflictsById.get(item.id);
          if (conflict) await store.markConflict(item.id, conflict);
          else await store.discard(item.id);
        }
      }
    } finally {
      await store.setSyncing(false);
    }
    report.remaining = (await store.pending("attendance")).length;
    return report;
  }

  /** Flush; concurrent calls share one in-flight flush. */
  function flush(): Promise<FlushReport> {
    if (!flushing)
      flushing = flushOnce().finally(() => {
        flushing = null;
      });
    return flushing;
  }

  /** Flush whenever the browser comes back online. Returns an unsubscribe function. */
  function autoFlush(target: {
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  }) {
    const on = () => {
      void flush();
    };
    target.addEventListener("online", on);
    return () => target.removeEventListener("online", on);
  }

  return {
    mark,
    flush,
    autoFlush,
    pending: async () => (await store.pending("attendance")).map(toMark),
    conflicts: async () =>
      (await store.list("attendance"))
        .filter((item) => item.state === "conflict")
        .map((item) => ({ ...toMark(item), why: item.conflict ?? "manual_review_required" })),
  };
}
