/** Server (Vercel function) Sentry init. Staging-only; fail closed otherwise. */
import * as Sentry from "@sentry/tanstackstart-react";
import { sentryOptions, type SentryEnv } from "./sentry-config";

export function readServerSentryEnv(env: NodeJS.ProcessEnv = process.env): SentryEnv {
  return {
    dsn: env.SENTRY_DSN,
    appEnv: env.APP_ENV,
    viteAppEnv: env.VITE_APP_ENV,
    vercelEnv: env.VERCEL_ENV,
    release: env.VERCEL_GIT_COMMIT_SHA,
  };
}

/** Calls `init` only when sentryOptions accepts the env. Production never initialises. */
export function activateServerSentry(
  env: NodeJS.ProcessEnv = process.env,
  init: (options: unknown) => void = (options) => {
    Sentry.init(options as never);
  },
): boolean {
  const options = sentryOptions(readServerSentryEnv(env));
  if (!options) return false;
  try {
    init(options);
    return true;
  } catch {
    return false;
  }
}

export const serverSentryEnabled = activateServerSentry();

type Entry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

/** Wrap the server entry with Sentry request tracing only when enabled. */
export function withServerSentry<T extends Entry>(entry: T): T {
  if (!serverSentryEnabled) return entry;
  const wrapped = Sentry.wrapFetchWithSentry({
    fetch: (request: Request, opts?: { env?: unknown; ctx?: unknown }) =>
      entry.fetch(request, opts?.env, opts?.ctx),
  });
  return {
    ...entry,
    fetch: (request: Request, env: unknown, ctx: unknown) => wrapped.fetch(request, { env, ctx }),
  };
}

export function captureServerError(error: unknown): void {
  if (!serverSentryEnabled) return;
  try {
    Sentry.captureException(error);
  } catch {
    /* ignore */
  }
}
