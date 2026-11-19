/**
 * OBS-DD-01 — Datadog (EU) over vendor-neutral OpenTelemetry: pure config.
 *
 * No SDK imports, no I/O. The runtime lives in datadog-otel.server.ts and
 * loads the OpenTelemetry SDK only when this module returns a config.
 *
 * Fail-closed rules:
 * - OBSERVABILITY_DATADOG_ENABLED must be exactly "true". Unset → off.
 * - DD_API_KEY must be non-empty. Missing → off.
 * - Data residency (NDPA 2023 / GDPR): DD_SITE must be "datadoghq.eu"
 *   (the default), and an OTEL_EXPORTER_OTLP_ENDPOINT override must be an
 *   https URL on a *.datadoghq.eu host. Anything else → off, never a
 *   silent export to another region.
 *
 * Privacy: span attributes are an allowlist. Values are re-screened with
 * the shared scrubber (emails, phones, tokens, env assignments), and keys
 * that look sensitive are dropped. Route paths are templated so ids and
 * free-text segments never reach Datadog.
 *
 * Never logs or returns the API key in an enumerable field.
 */
import { explicitAppEnv } from "./vendor-telemetry";
import { normaliseSha } from "./build-version";
import {
  DATADOG_METRICS_SWITCH_ENV,
  DATADOG_SWITCH_ENV,
  datadogSwitchOn,
  defaultOffSwitch,
} from "./vendor-switches";
import { isSensitiveKey, scrubString } from "./scrub";

export const DATADOG_EU_SITE = "datadoghq.eu" as const;
/** Datadog's agentless OTLP intake for the EU1 site (http/protobuf). */
export const DATADOG_EU_OTLP_BASE = `https://otlp.${DATADOG_EU_SITE}` as const;
export const DEFAULT_SERVICE_NAME = "sherivs-web" as const;
export const DEFAULT_TRACES_SAMPLE_RATE = 0.1;
export const TRACES_SAMPLE_RATE_ENV = "OBSERVABILITY_DATADOG_TRACES_SAMPLE_RATE" as const;

export type DatadogOtelEnv = Record<string, string | undefined>;

declare const __SHERIVS_BUILD_SHA__: string | undefined;

function builtSha(): string {
  return typeof __SHERIVS_BUILD_SHA__ === "string" ? normaliseSha(__SHERIVS_BUILD_SHA__) : "";
}

/** service.version: runtime VERCEL_GIT_COMMIT_SHA, else the build-time SHA, else "unknown". */
export function serviceVersion(env: DatadogOtelEnv, buildSha: string = builtSha()): string {
  return (env.VERCEL_GIT_COMMIT_SHA ?? "").trim() || buildSha || "unknown";
}

export interface DatadogOtelConfig {
  readonly tracesUrl: string;
  readonly metricsUrl: string;
  readonly metricsEnabled: boolean;
  readonly sampleRate: number;
  readonly resourceAttributes: Readonly<Record<string, string>>;
  /** Non-enumerable: carries dd-api-key, so JSON.stringify / console never print it. */
  readonly headers: Readonly<Record<string, string>>;
}

function eu(host: string): boolean {
  return host === DATADOG_EU_SITE || host.endsWith(`.${DATADOG_EU_SITE}`);
}

/** Returns the OTLP base URL (no trailing slash) or null when not an EU Datadog https host. */
export function datadogOtlpBase(env: DatadogOtelEnv): string | null {
  const site = env.DD_SITE ?? DATADOG_EU_SITE;
  if (site !== DATADOG_EU_SITE) return null;
  const override = (env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").trim();
  if (!override) return DATADOG_EU_OTLP_BASE;
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !eu(url.hostname)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export function parseSampleRate(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_TRACES_SAMPLE_RATE;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TRACES_SAMPLE_RATE;
  return Math.min(1, Math.max(0, n));
}

/** deployment.environment: explicit APP_ENV pair, else VERCEL_ENV, else "unknown". */
export function deploymentEnvironment(env: DatadogOtelEnv): string {
  const explicit = explicitAppEnv({ appEnv: env.APP_ENV, viteAppEnv: env.VITE_APP_ENV });
  return explicit || env.VERCEL_ENV || "unknown";
}

export function readDatadogOtelConfig(env: DatadogOtelEnv): DatadogOtelConfig | null {
  if (!datadogSwitchOn(env[DATADOG_SWITCH_ENV])) return null;
  const apiKey = (env.DD_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const base = datadogOtlpBase(env);
  if (!base) return null;
  const environment = deploymentEnvironment(env);
  const config = {
    tracesUrl: `${base}/v1/traces`,
    metricsUrl: `${base}/v1/metrics`,
    metricsEnabled: defaultOffSwitch(env[DATADOG_METRICS_SWITCH_ENV]),
    sampleRate: parseSampleRate(env[TRACES_SAMPLE_RATE_ENV]),
    resourceAttributes: Object.freeze({
      "service.name": (env.OTEL_SERVICE_NAME ?? "").trim() || DEFAULT_SERVICE_NAME,
      "service.version": serviceVersion(env),
      // Datadog reads both the stable and the older semantic-convention key.
      "deployment.environment.name": environment,
      "deployment.environment": environment,
    }),
  } as unknown as DatadogOtelConfig;
  Object.defineProperty(config, "headers", {
    enumerable: false,
    value: Object.freeze({
      "dd-api-key": apiKey,
      // Direct OTLP intake does not compute APM trace metrics unless asked.
      compute_stats: "true",
    }),
  });
  return Object.freeze(config);
}

/* ─────────────────────────────────────────────────────────────
 * PII-safe span shaping
 * ────────────────────────────────────────────────────────────*/

const HTTP_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "CONNECT",
  "TRACE",
]);

export function safeHttpMethod(method: string): string {
  const m = method.toUpperCase();
  return HTTP_METHODS.has(m) ? m : "_OTHER";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d+$/;
const LONG_TOKEN = /^[A-Za-z0-9_-]{20,}$/;
const SAFE_SEGMENT = /^[a-z0-9.][a-z0-9._-]{0,47}$/;

/** Static path segments from a TanStack route tree source (`path: '…'` / `fullPath: '…'`); `$params` excluded. */
export function staticSegmentsFromRouteTree(source: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const match of source.matchAll(/(?:fullPath|path|id): '([^']*)'/g)) {
    for (const seg of (match[1] ?? "").split("/")) {
      if (seg && !seg.startsWith("$") && !seg.startsWith("_") && SAFE_SEGMENT.test(seg))
        out.add(seg);
    }
  }
  return out;
}

/**
 * Low-cardinality, PII-free route template: query/hash dropped, ids,
 * numbers, long tokens and anything that is not a plain lowercase slug
 * become ":id". When `staticSegments` is given (the server passes the
 * segments of the generated route tree), every segment that is not a known
 * static route segment also becomes ":id", so a $slug or $param value can
 * never reach Datadog. "/students/7f0c…/report?token=x" → "/students/:id/report".
 */
export function routeTemplate(path: string, staticSegments?: ReadonlySet<string>): string {
  const pathname = (path.split(/[?#]/)[0] ?? "").trim() || "/";
  const segments = pathname.split("/").filter(Boolean).slice(0, 12);
  const mapped = segments.map((seg) => {
    let s = seg;
    try {
      s = decodeURIComponent(seg);
    } catch {
      return ":id";
    }
    if (UUID.test(s) || NUMERIC.test(s) || LONG_TOKEN.test(s)) return ":id";
    if (!SAFE_SEGMENT.test(s)) return ":id";
    if (scrubString(s) !== s) return ":id";
    if (staticSegments && !staticSegments.has(s)) return ":id";
    return s;
  });
  return `/${mapped.join("/")}`;
}

/** Span attributes Sherivs code may set. Everything else is dropped before export. */
export const ALLOWED_SPAN_ATTRIBUTE_KEYS = Object.freeze([
  "http.request.method",
  "http.route",
  "url.path",
  "http.response.status_code",
  "error.type",
  "sherivs.trace_id",
  "sherivs.component",
]);

const ALLOWED = new Set<string>(ALLOWED_SPAN_ATTRIBUTE_KEYS);

type AttrValue =
  string | number | boolean | Array<string | number | boolean | null | undefined> | undefined;

/** Allowlist + sensitive-key drop + value scrub. Never throws. */
export function scrubSpanAttributes(
  attrs: Record<string, AttrValue> | undefined,
  staticSegments?: ReadonlySet<string>,
): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  if (!attrs) return out;
  for (const [key, value] of Object.entries(attrs)) {
    if (!ALLOWED.has(key) || isSensitiveKey(key)) continue;
    if (typeof value === "string") {
      out[key] =
        key === "url.path" || key === "http.route"
          ? routeTemplate(value, staticSegments)
          : scrubString(value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
    // Arrays and other shapes are dropped: no allowlisted key needs them.
  }
  return out;
}

/** Span names are "METHOD /route/template" — re-templated in case a caller passed a raw path. */
export function scrubSpanName(name: string, staticSegments?: ReadonlySet<string>): string {
  const match = /^([A-Z_]{3,8}) (\/.*)$/.exec(name);
  if (match)
    return `${safeHttpMethod(match[1] ?? "")} ${routeTemplate(match[2] ?? "/", staticSegments)}`;
  return scrubString(name).slice(0, 128);
}
