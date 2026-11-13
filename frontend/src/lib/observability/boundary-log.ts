/**
 * Boundary error log (INFRA-01).
 *
 * Raw error objects can carry tokens, student records, or parent contact
 * data. Call sites emit one structured line: a scrubbed name/message (or a
 * scrubbed value), plus the pseudonymous trace correlation contract
 * (`trace_id`, `correlation_id`). Stacks and unscrubbed objects are not
 * written.
 */
import { scrubString, scrubValue } from "./scrub";
import { logStructured, type LogEmitOptions } from "./structured-log";
import { createTraceContext, traceLogEntry, type TraceContext } from "./trace-context";

export type { LogEmitOptions };

/** Name and message for Errors; scrubbed JSON for plain objects. Never a stack. */
export function boundaryErrorSummary(error: unknown): string {
  if (error instanceof Error) return scrubString(`${error.name}: ${error.message}`);
  if (typeof error === "string") return scrubString(error);
  if (error == null) return "unknown";
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }
  try {
    const json = JSON.stringify(scrubValue(error));
    return scrubString(json ?? "non-error");
  } catch {
    return "non-error";
  }
}

export function logBoundaryFailure(
  input: {
    msg: string;
    component: string;
    error: unknown;
    trace?: TraceContext;
    fields?: Record<string, unknown>;
  },
  options: LogEmitOptions = {},
): TraceContext {
  const trace = input.trace ?? createTraceContext();
  const fields: Record<string, unknown> = { err: boundaryErrorSummary(input.error) };
  if (input.fields) {
    for (const [key, value] of Object.entries(input.fields)) {
      if (key === "err" || key === "error") continue;
      fields[key] = scrubValue(value);
    }
  }
  logStructured(
    traceLogEntry(trace, {
      msg: scrubString(input.msg),
      level: "error",
      component: input.component,
      fields,
    }),
    options,
  );
  return trace;
}
