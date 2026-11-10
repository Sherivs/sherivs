/** Browser Sentry init. Staging-only; fail closed without VITE_APP_ENV=staging. */
import { sentryOptions, type SentryEnv } from "./sentry-config";

let started = false;
let startPromise: Promise<void> | null = null;

export function readClientSentryEnv(): SentryEnv {
  return {
    dsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
    appEnv: import.meta.env.VITE_APP_ENV as string | undefined,
    viteAppEnv: import.meta.env.VITE_APP_ENV as string | undefined,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
  };
}

type ClientSdk = {
  init: (options: unknown) => void;
  tanstackRouterBrowserTracingIntegration: (router: unknown) => unknown;
};

/**
 * Returns false (and does not call the SDK) unless the env is explicit
 * staging with a DSN. `loadSdk` is injectable so tests can prove init
 * without a browser. The default loader runs only in the browser.
 */
export function initClientSentry(
  router: unknown,
  env: SentryEnv = readClientSentryEnv(),
  loadSdk?: () => Promise<ClientSdk>,
): boolean {
  if (started) return true;
  const options = sentryOptions(env);
  if (!options) return false;
  if (!loadSdk && typeof window === "undefined") return false;
  const load = loadSdk ?? (() => import("@sentry/tanstackstart-react") as Promise<ClientSdk>);
  if (!startPromise) {
    startPromise = load()
      .then((Sentry) => {
        Sentry.init({
          ...options,
          integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
        });
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
