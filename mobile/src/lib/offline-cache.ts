/**
 * Sherivs Mobile — offline read cache (Track E).
 *
 * Last-good server responses are kept per signed-in user in AsyncStorage so results, attendance,
 * fees and timetables stay readable on a flaky connection. Cached data is ALWAYS labelled with
 * the time it was fetched; it is never presented as live, and it is wiped on sign-out.
 * Only non-secret, RLS-scoped read models are cached (no tokens — those stay in the secure store).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "sherivs.cache.v1:";
const MAX_BYTES = 256 * 1024; // per entry; larger payloads are simply not cached

export interface CacheEntry<T> {
  readonly savedAt: string;
  readonly data: T;
}

export function cacheKey(userId: string, name: string): string {
  return `${PREFIX}${userId}:${name}`;
}

export async function readCache<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as CacheEntry<T>) : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T, now: Date = new Date()): Promise<void> {
  const raw = JSON.stringify({ savedAt: now.toISOString(), data } satisfies CacheEntry<T>);
  if (raw.length > MAX_BYTES) return;
  try {
    await AsyncStorage.setItem(key, raw);
  } catch {
    /* storage full: caching is best-effort */
  }
}

/** Remove every cached entry (call on sign-out / account switch). */
export async function clearCache(): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}

export interface CachedQuery<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
  /** ISO time of the cached copy currently shown, or null when data is live. */
  readonly cachedAt: string | null;
  reload(): void;
}

/** Network-first; on failure fall back to the labelled last-good copy. */
export function useCachedQuery<T>(key: string | null, load: () => Promise<T>, deps: readonly unknown[]): CachedQuery<T> {
  const [state, setState] = useState<Omit<CachedQuery<T>, "reload">>({ data: null, error: null, loading: true, cachedAt: null });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let cancelled = false;
    if (!key) {
      setState({ data: null, error: null, loading: false, cachedAt: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    loadRef
      .current()
      .then(async (data) => {
        if (cancelled) return;
        setState({ data, error: null, loading: false, cachedAt: null });
        await writeCache(key, data);
      })
      .catch(async (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : "Could not reach Sherivs";
        const cached = await readCache<T>(key);
        if (cancelled) return;
        setState(cached ? { data: cached.data, error: message, loading: false, cachedAt: cached.savedAt } : { data: null, error: message, loading: false, cachedAt: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, ...deps]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
