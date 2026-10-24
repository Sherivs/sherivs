/** Offline-first queue for the PWA (SHERIVS-022). Items persist in localStorage and flush when online.
 *  Each flush uses a stable batch id, so a retry after a dropped connection is a server-side replay, never a duplicate. */
import { rpc } from "./rpc";

type Batch<T> = { id: string; kind: string; items: T[]; createdAt: string };
const KEY = "sherivs.offline.queue.v1";

function load<T>(): Batch<T>[] {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Batch<T>[]; } catch { return []; }
}
function save<T>(b: Batch<T>[]) { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(b)); }

export function enqueue<T>(kind: string, items: T[]): string {
  const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  save([...load<T>(), { id, kind, items, createdAt: new Date().toISOString() }]);
  return id;
}
export function pending(): number { return load().length; }

const HANDLERS: Record<string, (id: string, items: unknown[]) => Promise<unknown>> = {
  attendance: (id, items) => rpc("offline_attendance_sync", { p_batch: id, p_items: items }),
};

export async function flush(): Promise<{ sent: number; conflicts: unknown[] }> {
  const queue = load<unknown>(); const left: Batch<unknown>[] = []; let sent = 0; const conflicts: unknown[] = [];
  for (const b of queue) {
    const h = HANDLERS[b.kind];
    if (!h) { left.push(b); continue; }
    try { const r = (await h(b.id, b.items)) as { conflicts?: unknown[] }; sent++; conflicts.push(...(r?.conflicts ?? [])); }
    catch { left.push(b); }   // network or server error: keep for the next attempt
  }
  save(left);
  return { sent, conflicts };
}
export function autoFlush(onDone?: (r: { sent: number; conflicts: unknown[] }) => void) {
  if (typeof window === "undefined") return () => {};
  const go = () => { if (navigator.onLine && pending()) void flush().then((r) => onDone?.(r)); };
  window.addEventListener("online", go); go();
  return () => window.removeEventListener("online", go);
}

/** CBT answers: cached per attempt with a monotonic sequence and the capture time (server enforces deadline + grace). */
export function cbtCache(attempt: string) {
  const k = `sherivs.cbt.${attempt}`;
  const read = () => { try { return JSON.parse(localStorage.getItem(k) ?? '{"seq":0,"answers":{},"capturedAt":null}') as { seq: number; answers: Record<string, number>; capturedAt: string | null }; } catch { return { seq: 0, answers: {}, capturedAt: null }; } };
  return {
    read,
    answer(q: string, opt: number) { const s = read(); s.answers[q] = opt; s.seq += 1; s.capturedAt = new Date().toISOString(); localStorage.setItem(k, JSON.stringify(s)); return s; },
    async sync() { const s = read(); return rpc("cbt_sync", { p_attempt: attempt, p_answers: s.answers, p_seq: s.seq, p_captured_at: s.capturedAt ?? new Date().toISOString() }); },
    async submit() { const s = read(); const r = await rpc("cbt_submit", { p_attempt: attempt, p_answers: s.answers, p_seq: s.seq + 1, p_captured_at: s.capturedAt ?? new Date().toISOString() }); localStorage.removeItem(k); return r; },
  };
}
