import { useEffect, useState } from "react";
import { CloudOff, Gauge, RefreshCw, Wifi } from "lucide-react";
import { useApp } from "@/contexts/app-context";
import { createOfflineStore } from "@/lib/offline/indexeddb-store";

export const WORKSPACE_SYNC_STATUS_EVENT = "sherivs:sync-status";

export interface WorkspaceSyncStatus {
  pendingItems: number;
  conflictItems?: number;
  syncing: boolean;
}

interface ConnectionState {
  online: boolean;
  syncing: boolean;
  pendingItems: number | null;
  conflictItems: number;
}

function initialConnectionState(): ConnectionState {
  return {
    online: true,
    syncing: false,
    pendingItems: null,
    conflictItems: 0,
  };
}

export function ConnectionStatus() {
  const app = useApp();
  const [state, setState] = useState<ConnectionState>(initialConnectionState);
  const [dataSaver, setDataSaver] = useState(false);
  const userId = app.profile?.id;
  const tenantId = app.profile?.school_id;
  const role = app.profile?.role;
  const preferenceKey =
    userId && tenantId && role
      ? `sherivs.offline.data-saver:${encodeURIComponent(JSON.stringify([tenantId, userId, role]))}`
      : null;

  useEffect(() => {
    if (!userId || !tenantId || !role) {
      setState((current) => ({ ...current, pendingItems: null, conflictItems: 0 }));
      return;
    }
    let active = true;
    const store = createOfflineStore({ tenantId, userId, role });
    void store.list().then(
      (items) => {
        if (active) {
          setState((current) => ({
            ...current,
            pendingItems: items.filter((item) => item.state === "pending").length,
            conflictItems: items.filter((item) => item.state === "conflict").length,
          }));
        }
      },
      () => {
        if (active) setState((current) => ({ ...current, pendingItems: null, conflictItems: 0 }));
      },
    );
    return () => {
      active = false;
    };
  }, [role, tenantId, userId]);

  useEffect(() => {
    try {
      setDataSaver(preferenceKey ? window.localStorage.getItem(preferenceKey) === "1" : false);
    } catch {
      setDataSaver(false);
    }
  }, [preferenceKey]);

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
      if (
        typeof detail !== "object" ||
        detail === null ||
        typeof (detail as WorkspaceSyncStatus).pendingItems !== "number" ||
        !Number.isInteger((detail as WorkspaceSyncStatus).pendingItems) ||
        (detail as WorkspaceSyncStatus).pendingItems < 0 ||
        ((detail as WorkspaceSyncStatus).conflictItems !== undefined &&
          (!Number.isInteger((detail as WorkspaceSyncStatus).conflictItems) ||
            (detail as WorkspaceSyncStatus).conflictItems! < 0)) ||
        typeof (detail as WorkspaceSyncStatus).syncing !== "boolean"
      ) {
        return;
      }
      const status = detail as WorkspaceSyncStatus;
      setState((current) => ({
        ...current,
        syncing: status.syncing,
        pendingItems: status.pendingItems,
        conflictItems: status.conflictItems ?? 0,
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

  const label = !state.online ? "Offline" : state.syncing ? "Syncing" : "Online";
  const Icon = !state.online ? CloudOff : state.syncing ? RefreshCw : Wifi;
  function toggleDataSaver() {
    const next = !dataSaver;
    setDataSaver(next);
    try {
      if (preferenceKey) {
        if (next) window.localStorage.setItem(preferenceKey, "1");
        else window.localStorage.removeItem(preferenceKey);
      }
    } catch {
      /* Data Saver remains active for this app session if storage is blocked. */
    }
  }

  return (
    <>
      <span
        className={`app-shell-connection${state.online ? "" : " is-offline"}${state.syncing ? " is-syncing" : ""}`}
        role="status"
        aria-live="polite"
        data-testid="workspace-connection-status"
      >
        <Icon size={15} aria-hidden="true" />
        <span>{label}</span>
        <span className="app-shell-connection-pending">
          {state.pendingItems === null
            ? "Pending count unavailable"
            : `${state.pendingItems} pending`}
          {state.conflictItems > 0 ? ` · ${state.conflictItems} need review` : ""}
        </span>
      </span>
      <button
        type="button"
        className={`app-shell-data-saver${dataSaver ? " is-active" : ""}`}
        aria-label={`Data Saver ${dataSaver ? "on" : "off"}`}
        aria-pressed={dataSaver}
        onClick={toggleDataSaver}
        data-testid="data-saver-toggle"
      >
        <Gauge size={15} aria-hidden="true" />
        <span>Data Saver</span>
      </button>
    </>
  );
}
