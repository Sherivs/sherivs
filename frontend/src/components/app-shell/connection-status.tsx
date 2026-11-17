import { useEffect, useState } from "react";
import { CloudOff, Gauge, RefreshCw, Wifi } from "lucide-react";
import {
  contextFromScope,
  formatLastSync,
  readSyncSummary,
  retryWaitingAndFailed,
  takeDiscardedNotice,
  type SyncSummary,
} from "@/lib/offline/context-exit";
import { createOutbox, OUTBOX_STATUS_EVENT } from "@/lib/offline/outbox";
import { useDataSaver, useOfflineScope } from "./offline-controls";

export const WORKSPACE_SYNC_STATUS_EVENT = "sherivs:sync-status";

export interface WorkspaceSyncStatus {
  pendingItems: number;
  conflictItems?: number;
  syncing: boolean;
}

interface ConnectionState {
  online: boolean;
  syncing: boolean;
  /** Legacy attendance/score queue counts (from storage and the queue's own events). */
  pendingItems: number | null;
  conflictItems: number;
}

/** Outbox counts, failures with reasons, and the last successful sync. */
type OutboxView = Pick<SyncSummary, "outboxWaiting" | "outboxFailed" | "failures" | "lastSyncAt">;

const EMPTY_OUTBOX: OutboxView = {
  outboxWaiting: 0,
  outboxFailed: 0,
  failures: [],
  lastSyncAt: null,
};

function initialConnectionState(): ConnectionState {
  return {
    online: true,
    syncing: false,
    pendingItems: null,
    conflictItems: 0,
  };
}

export function isSyncStatus(detail: unknown): detail is WorkspaceSyncStatus {
  if (typeof detail !== "object" || detail === null) return false;
  const status = detail as WorkspaceSyncStatus;
  return (
    typeof status.pendingItems === "number" &&
    Number.isInteger(status.pendingItems) &&
    status.pendingItems >= 0 &&
    (status.conflictItems === undefined ||
      (Number.isInteger(status.conflictItems) && status.conflictItems >= 0)) &&
    typeof status.syncing === "boolean"
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function outboxView(summary: SyncSummary): OutboxView {
  return {
    outboxWaiting: summary.outboxWaiting,
    outboxFailed: summary.outboxFailed,
    failures: summary.failures,
    lastSyncAt: summary.lastSyncAt,
  };
}

export function ConnectionStatus() {
  const scope = useOfflineScope();
  const [state, setState] = useState<ConnectionState>(initialConnectionState);
  const [outbox, setOutbox] = useState<OutboxView>(EMPTY_OUTBOX);
  const [dataSaver, setDataSaver] = useDataSaver();
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [discardedNotice, setDiscardedNotice] = useState(0);
  const [, setClockTick] = useState(0);
  const tenantId = scope?.tenantId;
  const userId = scope?.userId;
  const role = scope?.role;

  useEffect(() => {
    if (!userId || !tenantId || !role) {
      setState((current) => ({ ...current, pendingItems: null, conflictItems: 0 }));
      setOutbox(EMPTY_OUTBOX);
      setDiscardedNotice(0);
      return;
    }
    let active = true;
    const current = { tenantId, userId, role };
    setDiscardedNotice(takeDiscardedNotice(userId));
    const refreshOutbox = () =>
      readSyncSummary(current).then(
        (summary) => {
          if (active) setOutbox(outboxView(summary));
          return summary;
        },
        () => {
          if (active) setOutbox(EMPTY_OUTBOX);
          return null;
        },
      );
    void refreshOutbox().then((summary) => {
      if (!active) return;
      setState((previous) => ({
        ...previous,
        pendingItems: summary ? summary.legacyPending : null,
        conflictItems: summary ? summary.legacyConflicts : 0,
      }));
    });
    const onOutbox = () => void refreshOutbox();
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (isSyncStatus(detail) && !detail.syncing) void refreshOutbox();
    };
    window.addEventListener(OUTBOX_STATUS_EVENT, onOutbox);
    window.addEventListener(WORKSPACE_SYNC_STATUS_EVENT, onSync);
    // Re-render once a minute so "Last sync" rolls over to a date after midnight.
    const tick = window.setInterval(() => setClockTick((value) => value + 1), 60_000);
    return () => {
      active = false;
      window.removeEventListener(OUTBOX_STATUS_EVENT, onOutbox);
      window.removeEventListener(WORKSPACE_SYNC_STATUS_EVENT, onSync);
      window.clearInterval(tick);
    };
  }, [role, tenantId, userId]);

  useEffect(() => {
    document.documentElement.dataset.dataSaver = dataSaver ? "true" : "false";
    if (!dataSaver) return;

    const root = document.querySelector(".app-shell") ?? document.body;
    const reduceMedia = (container: ParentNode) => {
      if (container instanceof HTMLImageElement) {
        container.loading = "lazy";
        container.decoding = "async";
        container.fetchPriority = "low";
      }
      if (container instanceof HTMLVideoElement) {
        if (container.autoplay) {
          container.pause();
          container.autoplay = false;
        }
        container.preload = "none";
      }
      container.querySelectorAll("img").forEach((image) => {
        image.loading = "lazy";
        image.decoding = "async";
        image.fetchPriority = "low";
      });
      container.querySelectorAll("video").forEach((video) => {
        if (video.autoplay) {
          video.pause();
          video.autoplay = false;
        }
        video.preload = "none";
      });
    };
    reduceMedia(root);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLVideoElement) {
          reduceMedia(record.target);
        }
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) reduceMedia(node);
        });
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["autoplay"],
    });
    return () => {
      observer.disconnect();
      document.documentElement.dataset.dataSaver = "false";
    };
  }, [dataSaver]);

  useEffect(() => {
    const updateOnline = () => setState((current) => ({ ...current, online: navigator.onLine }));
    const updateSync = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isSyncStatus(detail)) return;
      setState((current) => ({
        ...current,
        syncing: detail.syncing,
        pendingItems: detail.pendingItems,
        conflictItems: detail.conflictItems ?? 0,
      }));
    };

    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    window.addEventListener(WORKSPACE_SYNC_STATUS_EVENT, updateSync);
    updateOnline();
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener(WORKSPACE_SYNC_STATUS_EVENT, updateSync);
    };
  }, []);

  const busy = state.syncing || retrying;
  const label = !state.online ? "Offline" : busy ? "Syncing" : "Online";
  const Icon = !state.online ? CloudOff : busy ? RefreshCw : Wifi;
  const waiting = state.pendingItems === null ? null : state.pendingItems + outbox.outboxWaiting;
  const needsReview = state.conflictItems + outbox.outboxFailed;
  const canRetry =
    state.online &&
    !busy &&
    ((waiting ?? 0) > 0 || outbox.failures.some((failure) => failure.retryable));

  async function retry() {
    if (!scope) return;
    setRetrying(true);
    setRetryMessage(null);
    try {
      const summary = await retryWaitingAndFailed(scope);
      setOutbox(outboxView(summary));
      setState((current) => ({
        ...current,
        pendingItems: summary.legacyPending,
        conflictItems: summary.legacyConflicts,
      }));
      setRetryMessage(
        summary.waiting === 0 && summary.needsAttention === 0
          ? "Everything has been sent."
          : `${plural(summary.waiting, "item", "items")} still waiting, ${summary.needsAttention} need review.`,
      );
    } catch {
      setRetryMessage("Sending failed. Your items are still saved on this device.");
    } finally {
      setRetrying(false);
    }
  }

  async function removeFailed(id: string) {
    if (!scope) return;
    await createOutbox({ context: contextFromScope(scope) }).discard(id);
  }

  return (
    <>
      <span
        className={`app-shell-connection${state.online ? "" : " is-offline"}${busy ? " is-syncing" : ""}`}
        role="status"
        aria-live="polite"
        data-testid="workspace-connection-status"
      >
        <Icon size={15} aria-hidden="true" />
        <span>{label}</span>
        <span className="app-shell-connection-pending">
          {waiting === null ? "Pending count unavailable" : `${waiting} pending`}
          {needsReview > 0 ? ` · ${needsReview} need review` : ""}
        </span>
        <span className="app-shell-connection-last-sync" data-testid="workspace-last-sync">
          {formatLastSync(outbox.lastSyncAt)}
        </span>
        {retryMessage ? <span className="app-shell-sr-only">{retryMessage}</span> : null}
        {discardedNotice > 0 ? (
          <span className="app-shell-connection-notice" data-testid="workspace-discarded-notice">
            {plural(discardedNotice, "unsent item was", "unsent items were")} removed from this
            device when you were signed out or your access changed.
          </span>
        ) : null}
      </span>
      {discardedNotice > 0 ? (
        <button
          type="button"
          className="app-shell-connection-action"
          onClick={() => setDiscardedNotice(0)}
        >
          Dismiss
        </button>
      ) : null}
      {canRetry ? (
        <button
          type="button"
          className="app-shell-connection-action"
          onClick={() => void retry()}
          data-testid="workspace-sync-retry"
        >
          <RefreshCw size={15} aria-hidden="true" />
          <span>Retry sending</span>
        </button>
      ) : null}
      {outbox.failures.length > 0 ? (
        <details className="app-shell-connection-failures" data-testid="workspace-sync-failures">
          <summary className="app-shell-connection-action">
            {plural(outbox.failures.length, "item needs", "items need")} review
          </summary>
          <ul>
            {outbox.failures.map((failure) => (
              <li key={failure.id}>
                <strong>{failure.label}</strong>
                <span>
                  {failure.retryable ? "Not sent: " : "Refused by the server: "}
                  {failure.reason}
                </span>
                {failure.id.startsWith("outbox\u001f") ? (
                  <button
                    type="button"
                    className="app-shell-connection-action"
                    onClick={() => void removeFailed(failure.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <button
        type="button"
        className={`app-shell-data-saver${dataSaver ? " is-active" : ""}`}
        aria-label={`Data Saver ${dataSaver ? "on" : "off"}`}
        aria-pressed={dataSaver}
        onClick={() => setDataSaver(!dataSaver)}
        data-testid="data-saver-toggle"
      >
        <Gauge size={15} aria-hidden="true" />
        <span>Data Saver</span>
      </button>
    </>
  );
}
