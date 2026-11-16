import { renderErrorPage } from "./lib/error-page";
import { logBoundaryFailure, type LogEmitOptions } from "./lib/observability/boundary-log";

/**
 * Start request-middleware failure. HTTP errors with statusCode propagate.
 * Everything else is a scrubbed structured log plus the generic error page.
 * The raw error object is not written to the console.
 */
export function handleStartMiddlewareError(error: unknown, options?: LogEmitOptions): Response {
  if (error != null && typeof error === "object" && "statusCode" in error) {
    throw error;
  }
  logBoundaryFailure({ msg: "start-middleware-error", component: "start", error }, options);
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
