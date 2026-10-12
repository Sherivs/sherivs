/**
 * Sherivs Mobile — offline/reconnection controller (Phase 22 §M/§N/§AF).
 *
 * Pure state machine: connectivity probing, exponential-backoff retry
 * scheduling, and subscription notification. The transport probe is
 * injected (the app passes a Supabase health request; tests pass stubs) so
 * this module stays vendor-free and unit-testable in node.
 *
 * Honesty law: the controller reports connectivity ONLY. It carries no
 * cache and fabricates no content — an offline session shows explicit
 * offline/error states, never stale data presented as current (§9:
 * intelligence/derived state never overwrites or imitates canonical truth).
 */
export type ConnectivityState = "online" | "offline" | "reconnecting";

export interface ConnectivitySnapshot {
  readonly state: ConnectivityState;
  /** Milliseconds until the next automatic probe while not online. */
  readonly nextProbeInMs: number | null;
  readonly attempt: number;
}

export interface ConnectivityOptions {
  /** Return true when the backend is reachable. */
  readonly probe: () => Promise<boolean>;
  /** Base retry delay; doubles per failed attempt, capped at maxBackoffMs. */
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
  /** Injectable timer scheduling (defaults to setTimeout). */
  readonly schedule?: (fn: () => void, delayMs: number) => () => void;
}

export interface ConnectivityController {
  readonly get: () => ConnectivitySnapshot;
  start(): void;
  stop(): void;
  /** Force an immediate probe (manual retry). */
  retry(): void;
  subscribe(listener: (snapshot: ConnectivitySnapshot) => void): () => void;
}

export const DEFAULT_BASE_BACKOFF_MS = 1_000;
export const DEFAULT_MAX_BACKOFF_MS = 60_000;

export function createConnectivityController(options: ConnectivityOptions): ConnectivityController {
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const now = options.now ?? (() => Date.now());
  const schedule =
    options.schedule ??
    ((fn: () => void, delayMs: number) => {
      const timer = setTimeout(fn, delayMs);
      return () => clearTimeout(timer);
    });

  let snapshot: ConnectivitySnapshot = { state: "reconnecting", nextProbeInMs: null, attempt: 0 };
  let running = false;
  let cancelTimer: (() => void) | null = null;
  const listeners = new Set<(snapshot: ConnectivitySnapshot) => void>();

  function backoffDelay(attempt: number): number {
    return Math.min(baseBackoffMs * 2 ** Math.max(0, attempt - 1), maxBackoffMs);
  }

  function set(next: ConnectivitySnapshot): void {
    const changed =
      next.state !== snapshot.state ||
      next.attempt !== snapshot.attempt ||
      next.nextProbeInMs !== snapshot.nextProbeInMs;
    snapshot = next;
    if (changed) {
      for (const listener of listeners) listener(snapshot);
    }
  }

  function scheduleNextProbe(attempt: number): void {
    if (!running) return;
    const delay = Math.min(baseBackoffMs * 2 ** Math.max(0, attempt - 1), maxBackoffMs);
    set({ state: "reconnecting", nextProbeInMs: delay, attempt });
    cancelTimer = schedule(() => {
      void probe();
    }, delay);
  }

  async function probe(): Promise<void> {
    if (!running) return;
    if (cancelTimer) {
      cancelTimer();
      cancelTimer = null;
    }
    let reachable: boolean;
    try {
      reachable = await options.probe();
    } catch {
      reachable = false;
    }
    if (!running) return;
    if (reachable) {
      set({ state: "online", nextProbeInMs: null, attempt: 0 });
      return;
    }
    scheduleNextProbe(snapshot.state === "reconnecting" ? snapshot.attempt + 1 : 1);
  }

  return {
    get: () => snapshot,
    start: () => {
      if (running) return;
      running = true;
      void probe();
    },
    stop: () => {
      running = false;
      if (cancelTimer) {
        cancelTimer();
        cancelTimer = null;
      }
    },
    retry: () => {
      if (!running) return;
      void probe();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Transport probe for the app layer: a bounded-time Supabase auth health
 * request. Health endpoints are unauthenticated; this probe reports
 * reachability only and carries no tenant data (§19 minimization).
 */
export function createSupabaseHealthProbe(
  supabaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): () => Promise<boolean> {
  return async () => {
    try {
      const response = await fetchImpl(`${supabaseUrl}/auth/v1/health`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      return response.ok;
    } catch {
      return false;
    }
  };
}