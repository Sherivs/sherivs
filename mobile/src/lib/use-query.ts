/**
 * Sherivs Mobile — minimal query hook for screens.
 *
 * Server state is held separately from session/tenant state (Phase 22 §L).
 * Every screen renders the exact states the backend returned: loading,
 * data, an honest error (normalized kind), or empty. Nothing is cached or
 * fabricated when a load fails.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/errors";

export interface QueryState<T> {
  readonly data: T | null;
  readonly error: ApiError | null;
  readonly loading: boolean;
  reload(): void;
}

export function useQueryData<T>(load: () => Promise<T>, deps: readonly unknown[]): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError("unknown", cause instanceof Error ? cause.message : "unexpected error"),
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, error, loading, reload };
}