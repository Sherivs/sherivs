/**
 * Top-of-page progress bar. Animates whenever:
 *   - the router is transitioning to a new route
 *   - a route loader is pending
 *   - any TanStack Query is fetching or mutating
 *
 * Purely presentational; no external deps.
 */
import { useRouterState } from "@tanstack/react-router";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export const ROUTE_PROGRESS_EVENT = "uos:route-progress";

export function RouteProgressBar() {
  const routerStatus = useRouterState({ select: (s) => s.status });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const [manualBusy, setManualBusy] = useState(false);

  const busy = routerStatus === "pending" || isFetching > 0 || isMutating > 0 || manualBusy;

  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const start = () => setManualBusy(true);
    window.addEventListener(ROUTE_PROGRESS_EVENT, start);
    return () => window.removeEventListener(ROUTE_PROGRESS_EVENT, start);
  }, []);

  useEffect(() => {
    if (!manualBusy) return;
    const t = setTimeout(() => setManualBusy(false), 450);
    return () => clearTimeout(t);
  }, [pathname, manualBusy]);

  useEffect(() => {
    if (!manualBusy) return;
    const t = setTimeout(() => setManualBusy(false), 5000);
    return () => clearTimeout(t);
  }, [manualBusy]);

  useEffect(() => {
    let raf: number | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    if (busy) {
      setVisible(true);
      setProgress((p) => (p < 10 ? 10 : p));
      const tick = () => {
        setProgress((p) => {
          if (p >= 90) return p;
          // ease-out toward 90%
          return p + Math.max(0.5, (90 - p) * 0.04);
        });
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    } else if (visible) {
      setProgress(100);
      hideTimer = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 350);
    }

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [busy, visible]);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[3px] bg-transparent"
    >
      <div
        className="h-full bg-gradient-to-r from-primary via-primary to-primary/70 shadow-[0_0_10px_rgba(16,185,129,0.6)] transition-[width,opacity] duration-200 ease-out"
        style={{
          width: `${progress}%`,
          opacity: progress >= 100 ? 0 : 1,
        }}
      />
    </div>
  );
}
