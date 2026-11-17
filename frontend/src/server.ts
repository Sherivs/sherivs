import "./lib/error-capture";
import { captureServerError, withServerSentry } from "./lib/observability/sentry.server";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { logBoundaryFailure, type LogEmitOptions } from "./lib/observability/boundary-log";
import { scrubString } from "./lib/observability/scrub";
import { logStructured } from "./lib/observability/structured-log";
import {
  createTraceContext,
  traceLogEntry,
  type TraceContext,
} from "./lib/observability/trace-context";
import { withSecurityHeaders } from "./lib/security/security-headers";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

export type ServeFetchDeps = {
  loadEntry?: () => Promise<ServerEntry>;
  log?: LogEmitOptions;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

const ERROR_PAGE_HEADERS = { "content-type": "text/html; charset=utf-8" };

function errorPage(): Response {
  return new Response(renderErrorPage(), { status: 500, headers: ERROR_PAGE_HEADERS });
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
// The response body is not logged: it can carry tokens or student/parent data.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  trace: TraceContext,
  log: LogEmitOptions,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const captured = consumeLastCapturedError();
  logBoundaryFailure(
    {
      msg: "server-ssr-swallowed",
      component: "server",
      error: captured ?? new Error("h3 swallowed SSR error"),
      trace,
    },
    log,
  );
  return errorPage();
}

export async function serveFetch(
  request: Request,
  env: unknown,
  ctx: unknown,
  deps: ServeFetchDeps = {},
): Promise<Response> {
  const startedAt = Date.now();
  // Pathname only — query strings can carry tokens and must never be logged.
  const path = scrubString(new URL(request.url).pathname);
  const trace = createTraceContext();
  const log = deps.log ?? {};
  try {
    const handler = await (deps.loadEntry ?? getServerEntry)();
    const response = await handler.fetch(request, env, ctx);
    const normalized = await normalizeCatastrophicSsrResponse(response, trace, log);
    logStructured(
      traceLogEntry(trace, {
        msg: "server-fetch",
        level: normalized.status >= 500 ? "error" : "info",
        component: "server",
        fields: {
          duration_ms: Date.now() - startedAt,
          method: request.method,
          path,
          status: normalized.status,
        },
      }),
      log,
    );
    return withSecurityHeaders(normalized);
  } catch (error) {
    logBoundaryFailure(
      {
        msg: "server-fetch-unhandled",
        component: "server",
        error,
        trace,
        fields: {
          duration_ms: Date.now() - startedAt,
          method: request.method,
          path,
        },
      },
      log,
    );
    captureServerError(error);
    return withSecurityHeaders(errorPage());
  }
}

export default withServerSentry({
  async fetch(request: Request, env: unknown, ctx: unknown) {
    return serveFetch(request, env, ctx);
  },
});
