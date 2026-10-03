/**
 * CoreGrid Mobile — connectivity context (Phase 22 §N offline experience).
 * Wraps the pure connectivity controller with the Supabase health probe
 * and exposes the snapshot plus a manual retry to screens. The banner is
 * honest by construction: no cached content is presented while offline.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createConnectivityController,
  createSupabaseHealthProbe,
  type ConnectivityController,
  type ConnectivitySnapshot,
} from "@/lib/offline/connectivity";
import { mobileEnv } from "@/lib/app-runtime";

export interface ConnectivityContextValue {
  readonly snapshot: ConnectivitySnapshot;
  retry(): void;
}

const ConnectivityContext = createContext<ConnectivityContextValue | null>(null);

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const controller = useMemo<ConnectivityController>(
    () =>
      createConnectivityController({
        probe: createSupabaseHealthProbe(mobileEnv.supabaseUrl),
      }),
    [],
  );

  const [snapshot, setSnapshot] = useState<ConnectivitySnapshot>(controller.get());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    controller.start();
    return () => {
      unsubscribe();
      controller.stop();
    };
  }, [controller]);

  const value = useMemo<ConnectivityContextValue>(
    () => ({ snapshot, retry: () => controller.retry() }),
    [snapshot, controller],
  );

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity(): ConnectivityContextValue {
  const value = useContext(ConnectivityContext);
  if (!value) throw new Error("useConnectivity must be used inside ConnectivityProvider");
  return value;
}