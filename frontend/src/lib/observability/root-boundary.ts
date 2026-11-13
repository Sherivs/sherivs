import { logBoundaryFailure, type LogEmitOptions } from "./boundary-log";

/** Root error boundary log. Scrubbed summary plus pseudonymous trace ids. */
export function reportRootError(error: unknown, options?: LogEmitOptions): void {
  logBoundaryFailure({ msg: "root-error-boundary", component: "root", error }, options);
}
