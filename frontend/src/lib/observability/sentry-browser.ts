/** Browser Sentry init. No-op without VITE_SENTRY_DSN. */
import { sentryOptions } from "./sentry-config";

let started = false;
let startPromise: Promise<boolean> | null = null;

export function initClientSentry(router: unknown): Promise<boolean> {
  if (started || typeof window === "undefined") return Promise.resolve(started);
  const opts = sentryOptions({
    dsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
  });
  if (!opts) return Promise.resolve(false);
  if (!startPromise) {
    startPromise = import("@sentry/tanstackstart-react")
      .then((Sentry) => {
        Sentry.init({
          ...opts,
          integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router as never)],
        } as never);
        started = true;
        return true;
      })
      .catch(() => false);
  }
  return startPromise;
}

export function captureClientError(error: unknown): void {
  if (!started) return;
  void import("@sentry/tanstackstart-react")
    .then(({ captureException }) => captureException(error))
    .catch(() => undefined);
}
