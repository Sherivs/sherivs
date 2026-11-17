/**
 * SV1-LITE shell controls (ADR-109): the Data Saver hook and wrapper, and the
 * guard that runs before sign-out or an organization/role switch.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/contexts/app-context";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { OfflineScope } from "@/lib/offline/indexeddb-store";
import {
  DATA_SAVER_EVENT,
  dataSaverKey,
  readDataSaver,
  writeDataSaver,
} from "@/lib/offline/data-saver";

function localStore(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The active offline scope of the signed-in member, or null. */
export function useOfflineScope(): OfflineScope | null {
  const app = useApp();
  const userId = app.profile?.id;
  const tenantId = app.profile?.school_id;
  const role = app.profile?.role;
  return userId && tenantId && role ? { tenantId, userId, role } : null;
}

/** Data Saver on/off for the current person; every caller updates immediately on change. */
export function useDataSaver(): [boolean, (next: boolean) => void] {
  const scope = useOfflineScope();
  const key = scope ? dataSaverKey(scope) : null;
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(readDataSaver(key, localStore()));
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: unknown; on?: unknown }>).detail;
      if (detail && detail.key === key && typeof detail.on === "boolean") setOn(detail.on);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) setOn(event.newValue === "1");
    };
    window.addEventListener(DATA_SAVER_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DATA_SAVER_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);

  const update = useCallback(
    (next: boolean) => {
      setOn(next);
      writeDataSaver(key, next, localStore());
    },
    [key],
  );
  return [on, update];
}

/**
 * Wrap an image or chart: with Data Saver on, nothing inside is rendered (so
 * nothing is downloaded) until the person taps the placeholder.
 */
export function DataSaverGate({
  kind,
  label,
  children,
  className,
}: {
  kind: "image" | "chart";
  /** What will load, for the button text and screen readers, e.g. "profile photo". */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [dataSaver] = useDataSaver();
  const [revealed, setRevealed] = useState(false);
  if (!dataSaver || revealed) return <>{children}</>;
  return (
    <button
      type="button"
      className={`app-shell-data-saver-gate${className ? ` ${className}` : ""}`}
      onClick={() => setRevealed(true)}
      data-testid="data-saver-gate"
      aria-label={`Data Saver is on. Load ${label}`}
    >
      {kind === "chart" ? "Show chart" : "Show photo"}
    </button>
  );
}

type ExitIntent = "sign-out" | "switch";

interface PendingExit {
  intent: ExitIntent;
  scope: OfflineScope;
  count: number;
  proceed: () => Promise<void>;
}

/**
 * Before leaving a context: if unsent items exist, ask "send now" or "discard";
 * otherwise continue at once. Returns `guard(intent, proceed)` and the dialog.
 */
export function useContextExitGuard() {
  const scope = useOfflineScope();
  const [pending, setPending] = useState<PendingExit | null>(null);
  const [busy, setBusy] = useState<"send" | "discard" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const guard = useCallback(
    async (intent: ExitIntent, proceed: () => Promise<void>) => {
      if (!scope) return proceed();
      let count = 0;
      try {
        const { countUnsent } = await import("@/lib/offline/context-exit");
        count = (await countUnsent(scope)).total;
      } catch {
        count = 0; // Storage unavailable: there is nothing readable to carry over.
      }
      if (count === 0) return proceed();
      setMessage(null);
      setPending({ intent, scope, count, proceed });
    },
    [scope],
  );

  async function sendNow() {
    if (!pending) return;
    setBusy("send");
    setMessage(null);
    try {
      const { sendBeforeExit } = await import("@/lib/offline/context-exit");
      const left = await sendBeforeExit(pending.scope);
      if (left.total === 0) {
        const { proceed } = pending;
        setPending(null);
        await proceed();
        return;
      }
      setPending({ ...pending, count: left.total });
      setMessage(
        `${left.total} ${left.total === 1 ? "item" : "items"} could not be sent. Discard ${left.total === 1 ? "it" : "them"} to continue, or stay and try again later.`,
      );
    } catch {
      setMessage("Sending failed. Discard the items to continue, or stay and try again later.");
    } finally {
      setBusy(null);
    }
  }

  async function discardAndContinue() {
    if (!pending) return;
    setBusy("discard");
    try {
      const { wipeContext } = await import("@/lib/offline/context-exit");
      await wipeContext(pending.scope);
    } catch {
      /* The sign-out and switch paths wipe again; storage may be unavailable. */
    }
    const { proceed } = pending;
    setPending(null);
    setBusy(null);
    await proceed();
  }

  const action = pending?.intent === "switch" ? "switch" : "sign out";
  const items = pending ? `${pending.count} ${pending.count === 1 ? "item" : "items"}` : "";
  const dialog = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !busy) setPending(null);
      }}
    >
      <AlertDialogContent data-testid="context-exit-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{items} not sent yet</AlertDialogTitle>
          <AlertDialogDescription>
            Work saved on this device for your current role has not reached Sherivs. Before you{" "}
            {action}, send it now or discard it. It cannot be kept for later, because it must not be
            sent under a different account or role.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {message ? (
          <p role="alert" className="text-sm" data-testid="context-exit-message">
            {message}
          </p>
        ) : null}
        {!online ? (
          <p className="text-sm" data-testid="context-exit-offline">
            You are offline, so sending is not possible right now.
          </p>
        ) : null}
        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy !== null}
            onClick={() => setPending(null)}
          >
            Stay here
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={busy !== null}
            onClick={() => void discardAndContinue()}
            data-testid="context-exit-discard"
          >
            {busy === "discard" ? "Discarding…" : `Discard ${items} and ${action}`}
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={busy !== null || !online}
            onClick={() => void sendNow()}
            data-testid="context-exit-send"
          >
            {busy === "send" ? "Sending…" : "Send now"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { guard, dialog };
}
