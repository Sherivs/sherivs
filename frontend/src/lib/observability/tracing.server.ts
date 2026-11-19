/**
 * Server tracer wiring (mission M23, ADR-110).
 *
 * Reads the standard OpenTelemetry environment names, once:
 *   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT  full OTLP/HTTP traces URL (e.g. http://localhost:4318/v1/traces)
 *   OTEL_SERVICE_NAME                   optional service name (default sherivs-web)
 *   APP_ENV                             optional, becomes deployment.environment.name
 * With no endpoint (the default everywhere today) the tracer is the no-op tracer.
 *
 * Deliberately NOT read: OTEL_EXPORTER_OTLP_HEADERS or any API key. A vendor key belongs in the
 * collector or agent that receives the spans, never in this application (ADR-110).
 * The endpoint value is never logged.
 *
 * Not wired into any route yet: callers opt in with `serverTracer().withSpan(...)`.
 */
import { createTracer, type Tracer } from "./tracing";

export const OTLP_TRACES_ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT";
export const OTEL_SERVICE_NAME_ENV = "OTEL_SERVICE_NAME";

export type TracingEnv = Readonly<Record<string, string | undefined>>;

export function tracerFromEnv(env: TracingEnv): Tracer {
  return createTracer({
    endpoint: env[OTLP_TRACES_ENDPOINT_ENV],
    serviceName: env[OTEL_SERVICE_NAME_ENV],
    deploymentEnvironment: env.APP_ENV ?? null,
  });
}

let cached: Tracer | null = null;

/** The process-wide server tracer (no-op unless the endpoint variable is set). */
export function serverTracer(): Tracer {
  cached ??= tracerFromEnv(typeof process === "undefined" ? {} : process.env);
  return cached;
}
