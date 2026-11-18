import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import worker from "../../infra/cloudflare/sherivs-cron/src/index.js";
import {
  createRecorder,
  telemetryConfig,
} from "../../infra/cloudflare/sherivs-cron/src/telemetry.js";

type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const workerConfig = readFileSync("infra/cloudflare/sherivs-cron/wrangler.jsonc", "utf8");
const secret = "scheduled-test-value";
const apiKey = "dd-test-key-value";
const on = {
  OBSERVABILITY_DATADOG_ENABLED: "true",
  DD_API_KEY: apiKey,
  DEPLOYMENT_ENVIRONMENT: "production",
  CF_VERSION_METADATA: { id: "c04dfea6-test" },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function runScheduled(env: Record<string, unknown>, fetchImpl: ReturnType<typeof vi.fn>) {
  const pending: Promise<unknown>[] = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetchImpl);
  await worker.scheduled({ scheduledTime: Date.parse("2026-11-17T12:20:00.000Z") }, env as never, {
    waitUntil: (promise) => pending.push(promise),
  });
  await Promise.all(pending);
}

describe("sherivs-cron Datadog telemetry", () => {
  it("ships with export off in production and staging, EU only", () => {
    expect(workerConfig.match(/"OBSERVABILITY_DATADOG_ENABLED": "false"/g)).toHaveLength(2);
    expect(workerConfig).not.toContain('"OBSERVABILITY_DATADOG_ENABLED": "true"');
    expect(workerConfig.match(/"DD_SITE": "datadoghq.eu"/g)).toHaveLength(2);
    expect(workerConfig).not.toMatch(/"DD_API_KEY"\s*:/);
  });

  it.each([
    [{}],
    [{ OBSERVABILITY_DATADOG_ENABLED: "1", DD_API_KEY: apiKey }],
    [{ OBSERVABILITY_DATADOG_ENABLED: "true" }],
    [{ OBSERVABILITY_DATADOG_ENABLED: "true", DD_API_KEY: "  " }],
    [{ OBSERVABILITY_DATADOG_ENABLED: "true", DD_API_KEY: apiKey, DD_SITE: "datadoghq.com" }],
  ])("fails closed for %o", (env) => {
    expect(telemetryConfig(env)).toBeNull();
  });

  it("never exposes the API key when the config is serialised", () => {
    const config = telemetryConfig(on);
    expect(config?.tracesUrl).toBe("https://otlp.datadoghq.eu/v1/traces");
    expect(config?.logsUrl).toBe("https://otlp.datadoghq.eu/v1/logs");
    expect(config?.headers["dd-api-key"]).toBe(apiKey);
    expect(JSON.stringify(config)).not.toContain(apiKey);
    expect(config?.resource).toMatchObject({
      "service.name": "sherivs-cron",
      "service.version": "c04dfea6-test",
      "deployment.environment": "production",
    });
  });

  it("makes no export request when the switch is off", async () => {
    const fetchImpl = vi.fn<FetchFunction>(async () => new Response("ok"));
    await runScheduled({ CRON_SECRET: secret, DD_API_KEY: apiKey }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("datadoghq"))).toBe(false);
  });

  it("exports one span and one log per called route without bodies or credentials", async () => {
    const fetchImpl = vi.fn<FetchFunction>(async (url) =>
      String(url).includes("datadoghq.eu")
        ? new Response("{}", { status: 200 })
        : new Response("private response body", { status: 500 }),
    );
    await runScheduled({ ...on, CRON_SECRET: secret }, fetchImpl);
    const exports = fetchImpl.mock.calls.filter(([url]) => String(url).includes("datadoghq.eu"));
    expect(exports.map(([url]) => String(url)).sort()).toEqual([
      "https://otlp.datadoghq.eu/v1/logs",
      "https://otlp.datadoghq.eu/v1/traces",
    ]);
    for (const [, init] of exports) {
      const body = String(init?.body);
      expect(body).not.toContain(secret);
      expect(body).not.toContain(apiKey);
      expect(body).not.toContain("private response body");
      expect((init?.headers as Record<string, string>)["dd-api-key"]).toBe(apiKey);
    }
    const traces = JSON.parse(
      String(exports.find(([u]) => String(u).endsWith("traces"))?.[1]?.body),
    );
    const span = traces.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe("cron wallet-topup-reconcile");
    expect(span.status.code).toBe(2);
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    const logs = JSON.parse(String(exports.find(([u]) => String(u).endsWith("logs"))?.[1]?.body));
    const log = logs.resourceLogs[0].scopeLogs[0].logRecords[0];
    expect(log.severityText).toBe("ERROR");
    expect(log.spanId).toBe(span.spanId);
  });

  it("never throws or blocks when the intake fails", async () => {
    const recorder = createRecorder(on, "manual");
    recorder.record({ route: "r", path: "/p", status: 200, ms: 3, bytes: 2, startedAt: 1 });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      recorder.flush(async () => {
        throw new Error(apiKey);
      }),
    ).resolves.toBeUndefined();
    expect(vi.mocked(console.log).mock.calls.flat().join(" ")).not.toContain(apiKey);
  });
});
