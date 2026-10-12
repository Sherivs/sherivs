/**
 * Sherivs — offline status banner (Phase 22 platform wiring).
 *
 * First live consumer of the Phase 22/23 platform contracts: renders only
 * while the runtime is offline (or back-online for a moment), driven by the
 * SSR-safe `useClientPlatform` hook. Pure presentation — no state changes,
 * no authorization impact.
 */
import { WifiOff, Wifi } from "lucide-react";
import { useClientPlatform } from "@/lib/use-client-platform";

export function OfflineBanner() {
  const { isOffline } = useClientPlatform();
  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-center text-[11px] font-medium text-amber-700 dark:text-amber-300"
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
      You are offline — changes you make will sync when the connection returns.
      <Wifi className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
    </div>
  );
}
