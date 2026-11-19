/**
 * OBS-DD-02 — sherivs-cron traces and logs to Datadog EU over OTLP/HTTP JSON.
 *
 * Off by default. Export happens only when all of these hold:
 * - OBSERVABILITY_DATADOG_ENABLED is exactly "true";
 * - the DD_API_KEY Worker secret is non-empty;
 * - DD_SITE is unset or exactly "datadoghq.eu" (data residency: never another region).
 *
 * The endpoint is fixed to Datadog's EU agentless OTLP intake; it cannot be overridden.
 * Workers Free cannot use Cloudflare's built-in OTLP destinations (Workers Paid only), so the
 * Worker sends one traces request and one logs request per invocation that called a route.
 *
 * Privacy: only the fixed route name and path, HTTP status, duration, response byte count and
 * trigger are exported. Response bodies, request headers and credentials are never exported or
 * logged, and the API key is only ever placed in the dd-api-key request header.
 * Export failures are swallowed and never block or fail a scheduled route.
 */

export const DATADOG_SWITCH = "OBSERVABILITY_DATADOG_ENABLED";
export const DATADOG_EU_SITE = "datadoghq.eu";
export const DATADOG_EU_OTLP_BASE = `https://otlp.${DATADOG_EU_SITE}`;
export const SERVICE_NAME = "sherivs-cron";
export const EXPORT_TIMEOUT_MS = 5_000;

const SCOPE = { name: "sherivs-cron", version: "1" };

/** Returns the export config, or null when telemetry is off or misconfigured (fail closed). */
export function telemetryConfig(env) {
  if ((env?.[DATADOG_SWITCH] ?? "") !== "true") return null;
  const apiKey = typeof env.DD_API_KEY === "string" ? env.DD_API_KEY.trim() : "";
  if (!apiKey) return null;
  if ((env.DD_SITE ?? DATADOG_EU_SITE) !== DATADOG_EU_SITE) return null;
  const environment = (env.DEPLOYMENT_ENVIRONMENT ?? "").trim() || "unknown";
  const version = (env.CF_VERSION_METADATA?.id ?? "").trim() || "unknown";
  const config = {
    tracesUrl: `${DATADOG_EU_OTLP_BASE}/v1/traces`,
    logsUrl: `${DATADOG_EU_OTLP_BASE}/v1/logs`,
    resource: {
      "service.name": SERVICE_NAME,
      "service.version": version,
      "deployment.environment": environment,
      "deployment.environment.name": environment,
      "cloud.provider": "cloudflare",
      "cloud.platform": "cloudflare.workers",
    },
  };
  // Non-enumerable so JSON.stringify / console never print the key.
  Object.defineProperty(config, "headers", {
    value: Object.freeze({ "content-type": "application/json", "dd-api-key": apiKey }),
    enumerable: false,
  });
  return Object.freeze(config);
}

function hex(bytes) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nanos(ms) {
  return (BigInt(Math.round(ms)) * 1_000_000n).toString();
}

function attribute(key, value) {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  return { key, value: { stringValue: String(value) } };
}

function attributes(record) {
  return Object.entries(record).map(([key, value]) => attribute(key, value));
}

/** Collects one span and one log record per route call within a single invocation. */
export function createRecorder(env, trigger) {
  const config = telemetryConfig(env);
  const traceId = config ? hex(16) : "";
  const records = [];

  return {
    enabled: Boolean(config),
    record(result) {
      if (!config) return;
      records.push({ ...result, spanId: hex(8) });
    },
    payloads() {
      if (!config || records.length === 0) return null;
      const resource = { attributes: attributes(config.resource) };
      const spans = records.map((r) => {
        const failed = r.status < 200 || r.status >= 400;
        return {
          traceId,
          spanId: r.spanId,
          name: `cron ${r.route}`,
          kind: 3,
          startTimeUnixNano: nanos(r.startedAt),
          endTimeUnixNano: nanos(r.startedAt + r.ms),
          attributes: attributes({
            "cron.route": r.route,
            "cron.trigger": trigger,
            "cron.outcome": failed ? "failure" : "success",
            "http.request.method": "GET",
            "url.path": r.path,
            "http.response.status_code": r.status,
            "http.response.body.size": r.bytes,
            "resource.name": r.route,
          }),
          status: failed
            ? { code: 2, message: r.status === 0 ? "no_response" : "http_error" }
            : { code: 1 },
        };
      });
      const logRecords = records.map((r) => {
        const failed = r.status < 200 || r.status >= 400;
        return {
          timeUnixNano: nanos(r.startedAt + r.ms),
          severityNumber: failed ? 17 : 9,
          severityText: failed ? "ERROR" : "INFO",
          body: {
            stringValue: `cron route=${r.route} http=${r.status} ms=${r.ms} bytes=${r.bytes}`,
          },
          traceId,
          spanId: r.spanId,
          attributes: attributes({
            "cron.route": r.route,
            "cron.trigger": trigger,
            "cron.outcome": failed ? "failure" : "success",
            "http.response.status_code": r.status,
            duration_ms: r.ms,
          }),
        };
      });
      return {
        traces: { resourceSpans: [{ resource, scopeSpans: [{ scope: SCOPE, spans }] }] },
        logs: { resourceLogs: [{ resource, scopeLogs: [{ scope: SCOPE, logRecords }] }] },
      };
    },
    /** Sends at most two requests. Never throws; logs only the outcome status codes. */
    async flush(fetchImpl = fetch) {
      const payload = this.payloads();
      if (!config || !payload) return;
      const send = async (url, body) => {
        try {
          const response = await fetchImpl(url, {
            method: "POST",
            headers: config.headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
          });
          return response.status;
        } catch {
          return 0;
        }
      };
      const [traces, logs] = await Promise.all([
        send(config.tracesUrl, payload.traces),
        send(config.logsUrl, payload.logs),
      ]);
      if (traces !== 200 || logs !== 200) {
        console.log(`telemetry export traces=${traces} logs=${logs}`);
      }
    },
  };
}
