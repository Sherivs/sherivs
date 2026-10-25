/**
 * Teacher attendance save path (SHERIVS-A07b): save online when possible, otherwise queue for offline sync.
 * Only connectivity failures fall back to the queue; a server refusal (validation, permission) is shown
 * to the teacher and never silently queued, so nothing is "saved offline" that the server will reject anyway.
 */
export function isNetworkError(e: unknown): boolean {
  if (!e) return false;
  const name = (e as { name?: string }).name ?? "";
  const msg = String((e as { message?: string }).message ?? e).toLowerCase();
  return (name === "TypeError" && /fetch|network|load failed/.test(msg))
    || /failed to fetch|networkerror|network request failed|load failed|err_internet_disconnected|offline/.test(msg);
}

export type SaveOutcome = { mode: "saved" } | { mode: "queued"; queued: number };

export async function saveOrQueue<M>(opts: {
  online: boolean;
  marks: M[];
  save: (marks: M[]) => Promise<unknown>;
  queue: (marks: M[]) => void;
}): Promise<SaveOutcome> {
  if (!opts.marks.length) throw new Error("Mark at least one student first");
  if (!opts.online) { opts.queue(opts.marks); return { mode: "queued", queued: opts.marks.length }; }
  try { await opts.save(opts.marks); return { mode: "saved" }; }
  catch (e) {
    if (isNetworkError(e)) { opts.queue(opts.marks); return { mode: "queued", queued: opts.marks.length }; }
    throw e;
  }
}

/** Small read-through cache so the class list and roster still show after an offline reload. */
export function cached<T>(storage: Pick<Storage, "getItem" | "setItem"> | undefined, key: string) {
  const k = `sherivs.offline.cache.${key}`;
  return {
    get(): T | undefined { try { const v = storage?.getItem(k); return v ? (JSON.parse(v) as T) : undefined; } catch { return undefined; } },
    set(v: T) { try { storage?.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked: cache is best-effort */ } },
  };
}
