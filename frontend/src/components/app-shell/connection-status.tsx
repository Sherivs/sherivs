import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";

export const WORKSPACE_SYNC_STATUS_EVENT = "sherivs:sync-status";

export interface WorkspaceSyncStatus {
  pendingItems: number;
  syncing: boolean;
}

interface ConnectionState {
  online: boolean;
  syncing: boolean;
  pendingItems: number | null;
}

function initialConnectionState(): ConnectionState {
  return {
    online: true,
    syncing: false,
    pendingItems: null,
  };
}

export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>(initialConnectionState);

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
        typeof (detail as WorkspaceSyncStatus).syncing !== "boolean"
      ) {
        return;
      }
      const status = detail as WorkspaceSyncStatus;
      setState((current) => ({
        ...current,
        syncing: status.syncing,
        pendingItems: status.pendingItems,
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

  return (
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
      </span>
    </span>
  );
}
