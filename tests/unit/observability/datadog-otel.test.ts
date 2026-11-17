/**
 * OBS-DD-01 — Datadog over OpenTelemetry behind OBSERVABILITY_DATADOG_ENABLED.
 * Flag off: nothing loaded, nothing registered, request handling unchanged.
 * Flag on: an OTLP exporter to Datadog EU is registered and spans carry no PII.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import {
  DATADOG_EU_OTLP_BASE,
  readDatadogOtelConfig,
  routeTemplate,
  scrubSpanAttributes,
  staticSegmentsFromRouteTree,
  type DatadogOtelConfig,
} from "@/lib/observability/datadog-otel-config";
import {
  NOOP_REQUEST_TELEMETRY,
  activateDatadogOtel,
  datadogOtelRuntime,
  loadDatadogOtelSdk,
  resetDatadogOtelForTests,
  startServerRequestTelemetry,
  type DatadogOtelSdk,
} from "@/lib/observability/datadog-otel.server";

const KEY = "dd-test-key-not-real";
const ON = { OBSERVABILITY_DATADOG_ENABLED: "true", DD_API_KEY: KEY };

afterEach(async () => {
  await resetDatadogOtelForTests();
  vi.restoreAllMocks();
});

async function fakeSdk(
  exporter: InMemorySpanExporter,
  seen: DatadogOtelConfig[],
): Promise<DatadogOtelSdk> {
  const real = await loadDatadogOtelSdk();
  return {
    ...real,
    createTraceExporter: (config) => {
      seen.push(config);
      return exporter;
    },
  };
}

describe("OBS-DD-01 config (fail closed)", () => {
  it("is off when the flag is unset, misspelt, or the key is missing", () => {
    expect(readDatadogOtelConfig({})).toBeNull();
    expect(readDatadogOtelConfig({ DD_API_KEY: KEY })).toBeNull();
    for (const v of ["TRUE", "True", "1", "yes", " true", ""]) {
      expect(
        readDatadogOtelConfig({ OBSERVABILITY_DATADOG_ENABLED: v, DD_API_KEY: KEY }),
      ).toBeNull();
    }
    expect(readDatadogOtelConfig({ OBSERVABILITY_DATADOG_ENABLED: "true" })).toBeNull();
    expect(
      readDatadogOtelConfig({ OBSERVABILITY_DATADOG_ENABLED: "true", DD_API_KEY: "  " }),
    ).toBeNull();
  });

  it("refuses any non-EU site or endpoint (data residency)", () => {
    expect(readDatadogOtelConfig({ ...ON, DD_SITE: "datadoghq.com" })).toBeNull();
    expect(readDatadogOtelConfig({ ...ON, DD_SITE: "us5.datadoghq.com" })).toBeNull();
    for (const endpoint of [
      "https://otlp.datadoghq.com",
      "http://otlp.datadoghq.eu",
      "https://otlp.datadoghq.eu.evil.example",
      "https://evil-datadoghq.eu",
      "https://user:pw@otlp.datadoghq.eu",
      "not a url",
    ]) {
      expect(readDatadogOtelConfig({ ...ON, OTEL_EXPORTER_OTLP_ENDPOINT: endpoint })).toBeNull();
    }
  });

  it("targets Datadog's EU OTLP intake with the right headers and resource", () => {
    const config = readDatadogOtelConfig({
      ...ON,
      VERCEL_GIT_COMMIT_SHA: "abc123",
      APP_ENV: "production",
      VITE_APP_ENV: "production",
      VERCEL_ENV: "production",
    });
    expect(config).not.toBeNull();
    expect(DATADOG_EU_OTLP_BASE).toBe("https://otlp.datadoghq.eu");
    expect(config?.tracesUrl).toBe("https://otlp.datadoghq.eu/v1/traces");
    expect(config?.metricsUrl).toBe("https://otlp.datadoghq.eu/v1/metrics");
    expect(config?.metricsEnabled).toBe(false);
    expect(config?.sampleRate).toBe(0.1);
    expect(config?.headers["dd-api-key"]).toBe(KEY);
    expect(config?.headers.compute_stats).toBe("true");
    expect(config?.resourceAttributes).toEqual({
      "service.name": "sherivs-web",
      "service.version": "abc123",
      "deployment.environment.name": "production",
      "deployment.environment": "production",
    });
  });

  it("never serialises the API key", () => {
    const config = readDatadogOtelConfig(ON);
    expect(JSON.stringify(config)).not.toContain(KEY);
    expect(Object.keys(config ?? {})).not.toContain("headers");
  });

  it("accepts the Vercel managed-platform EU endpoint as an override", () => {
    const config = readDatadogOtelConfig({
      ...ON,
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://vercel.integrations.otlp.datadoghq.eu/",
      OBSERVABILITY_DATADOG_METRICS_ENABLED: "true",
      OBSERVABILITY_DATADOG_TRACES_SAMPLE_RATE: "1",
    });
    expect(config?.tracesUrl).toBe("https://vercel.integrations.otlp.datadoghq.eu/v1/traces");
    expect(config?.metricsEnabled).toBe(true);
    expect(config?.sampleRate).toBe(1);
  });
});

describe("OBS-DD-01 PII stripping", () => {
  const segments = staticSegmentsFromRouteTree(
    "path: '/students/$studentId/report' fullPath: '/api/public/webhooks/paystack' path: '/$slug'",
  );

  it("templates ids, tokens, emails, phones and unknown slugs out of paths", () => {
    expect(
      routeTemplate("/students/7f0c6a1e-1111-2222-3333-444455556666/report?token=abc", segments),
    ).toBe("/students/:id/report");
    expect(routeTemplate("/students/12345/report", segments)).toBe("/students/:id/report");
    expect(routeTemplate("/ada.obi@example.com", segments)).toBe("/:id");
    expect(routeTemplate("/+2348031234567", segments)).toBe("/:id");
    expect(routeTemplate("/john-doe", segments)).toBe("/:id");
    expect(routeTemplate("/api/public/webhooks/paystack", segments)).toBe(
      "/api/public/webhooks/paystack",
    );
    expect(segments.has("$slug")).toBe(false);
  });

  it("keeps only allowlisted attributes and scrubs their values", () => {
    const out = scrubSpanAttributes(
      {
        "http.request.method": "GET",
        "url.path": "/students/ada@example.com",
        "user.email": "ada@example.com",
        "enduser.phone": "+2348031234567",
        "student.name": "Ada Obi",
        "http.request.header.authorization": "Bearer abcdefghijklmnop",
        "sherivs.trace_id": "trace-123456",
      },
      segments,
    );
    expect(out).toEqual({
      "http.request.method": "GET",
      "url.path": "/students/:id",
      "sherivs.trace_id": "trace-123456",
    });
    expect(JSON.stringify(out)).not.toMatch(/example\.com|234803|Ada|Bearer/);
  });
});

describe("OBS-DD-01 registration", () => {
  it("flag off: registers nothing and never loads the SDK", () => {
    const load = vi.fn();
    expect(activateDatadogOtel({}, load)).toBe(false);
    expect(activateDatadogOtel({ DD_API_KEY: KEY, DD_SITE: "datadoghq.eu" }, load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(datadogOtelRuntime()).toBeNull();
    expect(startServerRequestTelemetry("GET", "/x", "trace-1")).toBe(NOOP_REQUEST_TELEMETRY);
  });

  it("flag off by default in this process (module-load activation)", async () => {
    const mod = await import("@/lib/observability/datadog-otel.server");
    expect(process.env.OBSERVABILITY_DATADOG_ENABLED).not.toBe("true");
    expect(mod.datadogOtelRequested).toBe(false);
  });

  it("flag on: registers the Datadog exporter and exports a scrubbed SERVER span", async () => {
    const exporter = new InMemorySpanExporter();
    const seen: DatadogOtelConfig[] = [];
    const sdk = await fakeSdk(exporter, seen);
    const activated = activateDatadogOtel(
      { ...ON, OBSERVABILITY_DATADOG_TRACES_SAMPLE_RATE: "1" },
      async () => sdk,
    );
    expect(activated).not.toBe(false);
    await expect(activated).resolves.toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tracesUrl).toBe("https://otlp.datadoghq.eu/v1/traces");
    expect(datadogOtelRuntime()).not.toBeNull();

    const t = startServerRequestTelemetry(
      "GET",
      "/ada.obi@example.com/7f0c6a1e-1111-2222-3333-444455556666",
      "trace-abcdef12",
    );
    expect(t).not.toBe(NOOP_REQUEST_TELEMETRY);
    t.end(500, new TypeError("leaked ada.obi@example.com +2348031234567"));
    await datadogOtelRuntime()?.flush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.name).toBe("GET /:id/:id");
    expect(span.attributes["http.response.status_code"]).toBe(500);
    expect(span.attributes["error.type"]).toBe("TypeError");
    expect(span.resource.attributes["service.name"]).toBe("sherivs-web");
    const wire = JSON.stringify({
      name: span.name,
      attributes: span.attributes,
      events: span.events,
      status: span.status,
    });
    expect(wire).not.toMatch(/example\.com|2348031234567|leaked/);
  });

  it("the real loader builds an OTLP http/protobuf exporter and route allowlist", async () => {
    const sdk = await loadDatadogOtelSdk();
    const config = readDatadogOtelConfig(ON)!;
    const exporter = sdk.createTraceExporter(config);
    expect(exporter).toBeInstanceOf(OTLPTraceExporter);
    await exporter.shutdown();
    expect(sdk.staticSegments.has("api")).toBe(true);
    expect([...sdk.staticSegments].some((s) => s.startsWith("$"))).toBe(false);
  });
});

describe("OBS-DD-01 server entry wiring", () => {
  it("records one span per request with the final status, and is a no-op by default", async () => {
    const { serveFetch } = await import("@/server");
    const ends: Array<{ method: string; path: string; status: number; error: boolean }> = [];
    const startTelemetry = (method: string, path: string) => ({
      end(status: number, error?: unknown) {
        ends.push({ method, path, status, error: error !== undefined });
      },
    });
    const ok = await serveFetch(
      new Request("https://sherivs.test/about?token=x"),
      {},
      {},
      {
        loadEntry: async () => ({ fetch: () => new Response("ok", { status: 200 }) }),
        log: { sink: () => undefined },
        startTelemetry,
      },
    );
    expect(ok.status).toBe(200);
    const failed = await serveFetch(
      new Request("https://sherivs.test/boom", { method: "POST" }),
      {},
      {},
      {
        loadEntry: async () => ({
          fetch: () => {
            throw new Error("boom");
          },
        }),
        log: { sink: () => undefined },
        startTelemetry,
      },
    );
    expect(failed.status).toBe(500);
    expect(ends).toEqual([
      { method: "GET", path: "/about", status: 200, error: false },
      { method: "POST", path: "/boom", status: 500, error: true },
    ]);

    // Default (flag off): the shared no-op is used and the response is unchanged.
    const plain = await serveFetch(
      new Request("https://sherivs.test/about"),
      {},
      {},
      {
        loadEntry: async () => ({ fetch: () => new Response("ok", { status: 200 }) }),
        log: { sink: () => undefined },
      },
    );
    expect(plain.status).toBe(200);
    expect(await plain.text()).toBe("ok");
  });
});
