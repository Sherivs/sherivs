/** Browser Sentry init. No-op without VITE_SENTRY_DSN. */
import { sentryOptions } from "./sentry-config";

let started = false;
let startPromise: Promise<void> | null = null;

export function initClientSentry(router: unknown): boolean {
  if (started || typeof window === "undefined") return started;
  const opts = sentryOptions({
    dsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
  });
  if (!opts) return false;
  if (!startPromise) {
    startPromise = import("@sentry/tanstackstart-react")
      .then((Sentry) => {
        Sentry.init({
          ...opts,
          integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router as never)],
        } as never);
        started = true;
      })
      .catch(() => undefined);
  }
  return started;
}

export function captureClientError(error: unknown): void {
  if (!startPromise) return;
  void startPromise
    .then(() =>
      started
        ? import("@sentry/tanstackstart-react").then(({ captureException }) =>
            captureException(error),
          )
        : undefined,
    )
    .catch(() => undefined);
}
