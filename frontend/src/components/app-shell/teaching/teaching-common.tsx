/**
 * M7 (ADR-118) shared bits for the teaching screens: connectivity, the offline notice, cached
 * reads through the tenant-scoped offline store, and the class picker. Kept small because every
 * teaching screen chunk imports it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import {
  createOfflineStore,
  type OfflineDomain,
  type OfflineScope,
} from "@/lib/offline/indexeddb-store";
import { useDataSaver, useOfflineScope } from "../offline-controls";
import type { ClassOption } from "@/lib/scholar/teaching/today";
import "./teaching.css";

export const teachingClock = new TimeAuthority(new SystemClock());

export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export interface CachedRead<T> {
  data: T | undefined;
  source: "network" | "offline" | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Read through the offline store: network first, the saved copy when the network fails. With
 * Data Saver on, a saved copy is shown first and the network is asked only when the person taps
 * "Refresh" (or when no saved copy exists).
 */
export function useCachedRead<T>(
  domain: OfflineDomain,
  key: string | null,
  load: () => Promise<T>,
): CachedRead<T> {
  const scope = useOfflineScope();
  const [dataSaver] = useDataSaver();
  const [state, setState] = useState<Omit<CachedRead<T>, "reload">>({
    data: undefined,
    source: null,
    error: null,
    loading: false,
  });
  const [nonce, setNonce] = useState(0);
  const store = useMemo(() => (scope ? safeStore(scope) : null), [scope]);

  useEffect(() => {
    if (!key) return;
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    void (async () => {
      try {
        if (dataSaver && nonce === 0 && store) {
          const saved = await store.read<T>(domain, key).catch(() => undefined);
          if (saved !== undefined) {
            if (active) setState({ data: saved, source: "offline", error: null, loading: false });
            return;
          }
        }
        const result = store
          ? await store.readThrough(domain, key, load)
          : { data: await load(), source: "network" as const };
        if (active)
          setState({ data: result.data, source: result.source, error: null, loading: false });
      } catch (cause) {
        if (active)
          setState((s) => ({
            ...s,
            loading: false,
            error: cause instanceof Error ? cause.message : "Could not load",
          }));
      }
    })();
    return () => {
      active = false;
    };
    // `load` is recreated each render by callers; `key` carries its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, key, store, nonce, dataSaver]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

function safeStore(scope: OfflineScope) {
  try {
    return createOfflineStore(scope, { now: () => new Date(teachingClock.now().atMs) });
  } catch {
    return null;
  }
}

export function OfflineNotice({
  online,
  source,
  waiting,
  onRefresh,
}: {
  online: boolean;
  source: "network" | "offline" | null;
  waiting?: number;
  onRefresh?: () => void;
}) {
  const [dataSaver] = useDataSaver();
  const showing = source === "offline";
  if (online && !showing && !waiting) return null;
  return (
    <div className="teaching-notice" role="status" data-testid="teaching-offline-notice">
      {!online ? <strong>You are offline.</strong> : null}{" "}
      {showing ? <span>Showing the copy saved on this device.</span> : null}{" "}
      {waiting ? (
        <span>
          {waiting} {waiting === 1 ? "item is" : "items are"} waiting to send; it sends by itself
          when you are back online.
        </span>
      ) : null}
      {dataSaver && showing && online && onRefresh ? (
        <button type="button" className="teaching-button" onClick={onRefresh}>
          Refresh (Data Saver is on)
        </button>
      ) : null}
    </div>
  );
}

export function ClassPicker({
  classes,
  value,
  onChange,
  id = "teaching-class",
}: {
  classes: readonly ClassOption[];
  value: string;
  onChange: (classId: string) => void;
  id?: string;
}) {
  return (
    <div className="teaching-field">
      <label htmlFor={id}>Class</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a class</option>
        {classes.map((c) => (
          <option key={c.class_id} value={c.class_id}>
            {c.class_name}
            {c.is_form_class ? " (form class)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export function newClientKey(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${teachingClock.now().atMs.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}

export function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
