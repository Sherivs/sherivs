/**
 * OBS-DD-01 — Datadog (EU) over OpenTelemetry for the server (Vercel function).
 *
 * OFF by default. With OBSERVABILITY_DATADOG_ENABLED unset (or anything but
 * the exact string "true") this module:
 *   - imports no OpenTelemetry SDK or exporter code,
 *   - registers no tracer/meter provider and no exporter,
 *   - makes no network call,
 *   - and hands server.ts a shared no-op, so request handling is unchanged.
 *
 * ON: a private TracerProvider (and, if OBSERVABILITY_DATADOG_METRICS_ENABLED
 * is "true", a MeterProvider with delta temporality) exports OTLP
 * http/protobuf to Datadog's EU intake. The providers are NOT registered as
 * OpenTelemetry globals, so they cannot collide with Sentry's own OTel setup
 * on staging. One SERVER span per request, attributes from an allowlist only,
 * scrubbed again in the exporter (defence in depth). No logs are exported.
 *
 * Never reads, logs or returns DD_API_KEY outside the exporter headers.
 */
import type { Attributes, Span, Tracer, Histogram } from "@opentelemetry/api";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import {
  readDatadogOtelConfig,
  routeTemplate,
  safeHttpMethod,
  scrubSpanAttributes,
  scrubSpanName,
  staticSegmentsFromRouteTree,
  type DatadogOtelConfig,
  type DatadogOtelEnv,
} from "./datadog-otel-config";

/* ─────────────────────────────────────────────────────────────
 * Public surface used by server.ts
 * ────────────────────────────────────────────────────────────*/

export interface RequestTelemetry {
  /** Record the final status. `error` contributes only its type name, never its message. */
  end(status: number, error?: unknown): void;
}

export interface DatadogOtelRuntime {
  startRequest(method: string, path: string, traceId: string): RequestTelemetry;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export const NOOP_REQUEST_TELEMETRY: RequestTelemetry = Object.freeze({ end() {} });

/* ─────────────────────────────────────────────────────────────
 * SDK seam (lazy-loaded; injectable for tests)
 * ────────────────────────────────────────────────────────────*/

export interface DatadogOtelSdk {
  api: typeof import("@opentelemetry/api");
  trace: typeof import("@opentelemetry/sdk-trace");
  resources: typeof import("@opentelemetry/resources");
  metrics: typeof import("@opentelemetry/sdk-metrics");
  createTraceExporter: (config: DatadogOtelConfig) => SpanExporter;
  createMetricExporter: (
    config: DatadogOtelConfig,
  ) => import("@opentelemetry/sdk-metrics").PushMetricExporter;
  staticSegments: ReadonlySet<string>;
}

const EXPORT_TIMEOUT_MS = 5_000;

/** Dynamic imports only: called solely when the flag and key are present. */
export async function loadDatadogOtelSdk(): Promise<DatadogOtelSdk> {
  const [api, trace, resources, metrics, traceProto, metricProto, routeTree] = await Promise.all([
    import("@opentelemetry/api"),
    import("@opentelemetry/sdk-trace"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/exporter-trace-otlp-proto"),
    import("@opentelemetry/exporter-metrics-otlp-proto"),
    import("../../routeTree.gen.ts?raw").catch(() => ({ default: "" })),
  ]);
  return {
    api,
    trace,
    resources,
    metrics,
    staticSegments: staticSegmentsFromRouteTree(String(routeTree.default ?? "")),
    createTraceExporter: (config) =>
      new traceProto.OTLPTraceExporter({
        url: config.tracesUrl,
        headers: { ...config.headers },
        timeoutMillis: EXPORT_TIMEOUT_MS,
      }),
    createMetricExporter: (config) =>
      new metricProto.OTLPMetricExporter({
        url: config.metricsUrl,
        headers: { ...config.headers },
        timeoutMillis: EXPORT_TIMEOUT_MS,
        // Datadog's OTLP metrics intake accepts delta temporality only.
        temporalityPreference: metrics.AggregationTemporality.DELTA,
      }),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Defence-in-depth exporter: re-scrubs every span before it leaves
 * ────────────────────────────────────────────────────────────*/

export function scrubReadableSpan(
  span: ReadableSpan,
  staticSegments?: ReadonlySet<string>,
): ReadableSpan {
  const attributes = scrubSpanAttributes(span.attributes as never, staticSegments) as Attributes;
  const name = scrubSpanName(span.name, staticSegments);
  // Events can carry exception messages; keep the event name only.
  const events = span.events.map((e) => ({ name: scrubSpanName(e.name), time: e.time }));
  const links = span.links.map((l) => ({ context: l.context }));
  // Status messages can echo error text: keep the code only.
  const status = { code: span.status.code };
  return new Proxy(span, {
    get(target, prop, receiver) {
      if (prop === "attributes") return attributes;
      if (prop === "name") return name;
      if (prop === "events") return events;
      if (prop === "links") return links;
      if (prop === "status") return status;
      return Reflect.get(target, prop, receiver);
    },
  });
}

export class ScrubbingSpanExporter implements SpanExporter {
  constructor(
    private readonly inner: SpanExporter,
    private readonly staticSegments?: ReadonlySet<string>,
  ) {}
  export(spans: ReadableSpan[], done: Parameters<SpanExporter["export"]>[1]): void {
    let scrubbed: ReadableSpan[];
    try {
      scrubbed = spans.map((s) => scrubReadableSpan(s, this.staticSegments));
    } catch {
      // Never export unscrubbed data: drop the batch instead.
      done({ code: 1 });
      return;
    }
    this.inner.export(scrubbed, done);
  }
  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
  forceFlush(): Promise<void> {
    return this.inner.forceFlush ? this.inner.forceFlush() : Promise.resolve();
  }
}

/* ─────────────────────────────────────────────────────────────
 * Runtime
 * ────────────────────────────────────────────────────────────*/

function errorType(error: unknown): string {
  if (error instanceof Error) {
    const n = error.name || error.constructor?.name || "Error";
    return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(n) ? n : "Error";
  }
  return "_OTHER";
}

export function createDatadogOtelRuntime(
  config: DatadogOtelConfig,
  sdk: DatadogOtelSdk,
): DatadogOtelRuntime {
  const resource = sdk.resources.resourceFromAttributes({ ...config.resourceAttributes });
  const traceExporter = new ScrubbingSpanExporter(
    sdk.createTraceExporter(config),
    sdk.staticSegments,
  );
  const tracerProvider = new sdk.trace.TracerProvider({
    resource,
    sampler: new sdk.trace.TraceIdRatioBasedSampler(config.sampleRate),
    spanProcessors: [
      new sdk.trace.BatchSpanProcessor({
        exporter: traceExporter,
        scheduledDelayMillis: 1_000,
        exportTimeoutMillis: EXPORT_TIMEOUT_MS,
        maxExportBatchSize: 256,
      }),
    ],
  });
  const tracer: Tracer = tracerProvider.getTracer("sherivs-server");

  let meterProvider: import("@opentelemetry/sdk-metrics").MeterProvider | null = null;
  let duration: Histogram | null = null;
  if (config.metricsEnabled) {
    meterProvider = new sdk.metrics.MeterProvider({
      resource,
      readers: [
        new sdk.metrics.PeriodicExportingMetricReader({
          exporter: sdk.createMetricExporter(config),
          exportIntervalMillis: 60_000,
          exportTimeoutMillis: EXPORT_TIMEOUT_MS,
        }),
      ],
    });
    duration = meterProvider
      .getMeter("sherivs-server")
      .createHistogram("http.server.request.duration", {
        unit: "s",
        description: "Server request duration (route template, method and status only).",
      });
  }

  const { SpanKind, SpanStatusCode } = sdk.api;

  return {
    startRequest(method, path, traceId) {
      const m = safeHttpMethod(method);
      const route = routeTemplate(path, sdk.staticSegments);
      const startedAt = performance.now();
      let span: Span;
      try {
        span = tracer.startSpan(`${m} ${route}`, {
          kind: SpanKind.SERVER,
          attributes: {
            "http.request.method": m,
            "http.route": route,
            "url.path": route,
            "sherivs.trace_id": traceId,
            "sherivs.component": "server",
          },
        });
      } catch {
        return NOOP_REQUEST_TELEMETRY;
      }
      let ended = false;
      return {
        end(status, error) {
          if (ended) return;
          ended = true;
          try {
            span.setAttribute("http.response.status_code", status);
            if (error !== undefined || status >= 500) {
              span.setAttribute(
                "error.type",
                error !== undefined ? errorType(error) : String(status),
              );
              span.setStatus({ code: SpanStatusCode.ERROR });
            }
            span.end();
            duration?.record((performance.now() - startedAt) / 1000, {
              "http.request.method": m,
              "http.route": route,
              "http.response.status_code": status,
            });
          } catch {
            /* telemetry must never break a request */
          }
        },
      };
    },
    async flush() {
      await Promise.allSettled([tracerProvider.forceFlush(), meterProvider?.forceFlush()]);
    },
    async shutdown() {
      await Promise.allSettled([tracerProvider.shutdown(), meterProvider?.shutdown()]);
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Process-wide activation (module load)
 * ────────────────────────────────────────────────────────────*/

let runtime: DatadogOtelRuntime | null = null;
let activation: Promise<boolean> | null = null;

/**
 * Starts the Datadog exporter when the flag, key and EU endpoint are valid.
 * Returns false synchronously — without calling `load` — when they are not.
 */
export function activateDatadogOtel(
  env: DatadogOtelEnv = process.env,
  load: () => Promise<DatadogOtelSdk> = loadDatadogOtelSdk,
): false | Promise<boolean> {
  const config = readDatadogOtelConfig(env);
  if (!config) return false;
  if (activation) return activation;
  activation = load()
    .then((sdk) => {
      runtime = createDatadogOtelRuntime(config, sdk);
      return true;
    })
    .catch(() => false);
  return activation;
}

export function datadogOtelRuntime(): DatadogOtelRuntime | null {
  return runtime;
}

/** Test seam: forget the process-wide runtime. */
export async function resetDatadogOtelForTests(): Promise<void> {
  const r = runtime;
  runtime = null;
  activation = null;
  await r?.shutdown();
}

export function startServerRequestTelemetry(
  method: string,
  path: string,
  traceId: string,
): RequestTelemetry {
  return runtime ? runtime.startRequest(method, path, traceId) : NOOP_REQUEST_TELEMETRY;
}

type WaitUntil = (promise: Promise<unknown>) => void;

function pickWaitUntil(request: Request, ctx: unknown): WaitUntil | null {
  const candidates: unknown[] = [
    (request as unknown as { waitUntil?: unknown }).waitUntil,
    (ctx as { waitUntil?: unknown } | null | undefined)?.waitUntil,
    (request as unknown as { runtime?: { vercel?: { context?: { waitUntil?: unknown } } } }).runtime
      ?.vercel?.context?.waitUntil,
    (
      globalThis as unknown as Record<
        symbol,
        { get?: () => { waitUntil?: unknown } | undefined } | undefined
      >
    )[Symbol.for("@vercel/request-context")]?.get?.()?.waitUntil,
  ];
  for (const c of candidates) if (typeof c === "function") return c as WaitUntil;
  return null;
}

/**
 * Flush after the response without delaying it (Vercel waitUntil). With no
 * runtime this returns immediately and touches nothing.
 */
export function flushServerTelemetry(request: Request, ctx: unknown): void {
  const r = runtime;
  if (!r) return;
  const p = r.flush().catch(() => undefined);
  try {
    pickWaitUntil(request, ctx)?.(p);
  } catch {
    /* ignore */
  }
}

/** Kick off activation at module load. Flag off → false, nothing imported. */
export const datadogOtelRequested = activateDatadogOtel() !== false;
