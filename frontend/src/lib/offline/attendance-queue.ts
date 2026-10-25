/**
 * Offline attendance queue (SHERIVS-A07).
 * Marks are stored locally with a stable item id, then flushed in batches to `offline_attendance_sync_v2`
 * when the device is online. The server skips item ids it has already seen, so a retry after a dropped
 * response never double-applies. Items the server answers for (applied, duplicate, conflict) leave the queue;
 * a network or clock error leaves everything queued for the next attempt.
 */
export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type QueuedMark = { id: string; student_id: string; date: string; status: AttendanceStatus; captured_at: string };
export type SyncResult = { applied: number; duplicates?: number; conflicts: { id?: string; why: string }[]; replay?: boolean; skew_seconds?: number };
export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
export type Sync = (batch: string, items: QueuedMark[], clientNow: string) => Promise<SyncResult>;

const KEY = "sherivs.offline.attendance.v2";
const MAX_BATCH = 500;

export function createAttendanceQueue(opts: { storage: KV; sync: Sync; /** Injected clock (time-source discipline: lib code never samples the wall clock). */ now: () => Date; newId?: () => string; userId: string }) {
  const now = opts.now;
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const key = `${KEY}:${opts.userId}`;
  let flushing: Promise<FlushReport> | null = null;

  const read = (): QueuedMark[] => {
    try { const v = JSON.parse(opts.storage.getItem(key) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  const write = (items: QueuedMark[]) => (items.length ? opts.storage.setItem(key, JSON.stringify(items)) : opts.storage.removeItem(key));

  /** Queue (or replace) today's mark for a student. The last mark for the same student+date wins locally. */
  function mark(student_id: string, date: string, status: AttendanceStatus): QueuedMark {
    const items = read().filter((x) => !(x.student_id === student_id && x.date === date));
    const m: QueuedMark = { id: newId(), student_id, date, status, captured_at: now().toISOString() };
    items.push(m); write(items); return m;
  }

  type FlushReport = { sent: number; applied: number; duplicates: number; conflicts: { id?: string; why: string }[]; remaining: number; error?: string };

  async function flushOnce(): Promise<FlushReport> {
    const rep: FlushReport = { sent: 0, applied: 0, duplicates: 0, conflicts: [], remaining: 0 };
    for (;;) {
      const items = read();
      if (!items.length) break;
      const chunk = items.slice(0, MAX_BATCH);
      const batch = `b-${chunk[0].id}-${chunk.length}`;
      let res: SyncResult;
      try { res = await opts.sync(batch, chunk, now().toISOString()); }
      catch (e) { rep.error = (e as Error).message; break; }
      rep.sent += chunk.length; rep.applied += res.applied; rep.duplicates += res.duplicates ?? 0; rep.conflicts.push(...res.conflicts);
      const done = new Set(chunk.map((x) => x.id));
      write(read().filter((x) => !done.has(x.id)));
    }
    rep.remaining = read().length;
    return rep;
  }

  /** Flush; concurrent calls share one in-flight flush. */
  function flush(): Promise<FlushReport> {
    if (!flushing) flushing = flushOnce().finally(() => { flushing = null; });
    return flushing;
  }

  /** Flush whenever the browser comes back online. Returns an unsubscribe function. */
  function autoFlush(target: { addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void }) {
    const on = () => { void flush(); };
    target.addEventListener("online", on);
    return () => target.removeEventListener("online", on);
  }

  return { mark, flush, autoFlush, pending: () => read() };
}
