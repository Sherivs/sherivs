import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FALLBACK_SPAN_NAME,
  NOOP_TRACER,
  buildOtlpPayload,
  createTracer,
  msToUnixNano,
  safeSpanName,
  screenAttribute,
  screenAttributes,
  validateOtlpEndpoint,
} from "@/lib/observability/tracing";
import { OTLP_TRACES_ENDPOINT_ENV, tracerFromEnv } from "@/lib/observability/tracing.server";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Secret-shaped values are assembled at runtime so none is committed. */
const JWT_LIKE = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjMifQ", "c2lnbmF0dXJlLXZhbHVl"].join(".");
const KEY_LIKE = ["sk", "live", "abcdefghijklmnop"].join("_");
const BEARER = ["Bearer", "abc.def.ghi"].join(" ");

interface Captured {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function capture(ok = true) {
  const calls: Captured[] = [];
  const fetchImpl = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok, status: ok ? 200 : 500 };
  };
  return { calls, fetchImpl };
}

function counterBytes() {
  let n = 0;
  return (length: number) => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) bytes[i] = (n + i) % 256;
    n += 1;
    return bytes;
  };
}

function spansOf(body: Record<string, unknown>) {
  const resourceSpans = body.resourceSpans as {
    resource: { attributes: { key: string }[] };
    scopeSpans: { spans: Record<string, unknown>[] }[];
  }[];
  return resourceSpans[0]!.scopeSpans[0]!.spans;
}

describe("M23 tracing facade: no-op default", () => {
  it("is the no-op tracer without an endpoint, and sends nothing", async () => {
    const { calls, fetchImpl } = capture();
    for (const endpoint of [undefined, "", "   "]) {
      const tracer = createTracer({ endpoint, fetchImpl });
      expect(tracer).toBe(NOOP_TRACER);
      expect(tracer.enabled).toBe(false);
      const span = tracer.startSpan("work", { attributes: { "http.route": "/home" } });
      expect(span.recording).toBe(false);
      span.end();
      await expect(tracer.withSpan("work", async () => 42)).resolves.toBe(42);
      await tracer.flush();
    }
    expect(calls).toHaveLength(0);
  });

  it("stays no-op when the server environment has no endpoint variable", () => {
    expect(tracerFromEnv({})).toBe(NOOP_TRACER);
    expect(tracerFromEnv({ OTEL_SERVICE_NAME: "x" })).toBe(NOOP_TRACER);
  });

  it("refuses unsafe endpoints (plain http off-host, credentials, garbage) by staying no-op", () => {
    expect(validateOtlpEndpoint("http://collector.example.org:4318/v1/traces")).toBeNull();
    expect(validateOtlpEndpoint("https://user:pw@collector.example.org/v1/traces")).toBeNull();
    expect(validateOtlpEndpoint("ftp://localhost/v1/traces")).toBeNull();
    expect(validateOtlpEndpoint("not a url")).toBeNull();
    expect(validateOtlpEndpoint("http://localhost:4318/v1/traces")).toBe(
      "http://localhost:4318/v1/traces",
    );
    expect(validateOtlpEndpoint("https://collector.example.org/v1/traces")).not.toBeNull();
    expect(
      tracerFromEnv({ [OTLP_TRACES_ENDPOINT_ENV]: "http://collector.example.org/v1/traces" }),
    ).toBe(NOOP_TRACER);
  });
});

describe("M23 tracing facade: attribute allowlist and redaction", () => {
  it("drops every key that is not on the allowlist", () => {
    const { accepted, dropped } = screenAttributes({
      "user.id": "u-1",
      "user.email": "someone@example.org",
      "enduser.id": "abc",
      authorization: BEARER,
      "http.request.header.cookie": "session=abc",
      "http.request.body": '{"password":"x"}',
      "url.full": "https://example.org/a?token=x",
      "url.query": "token=x",
      org_id: "org-1",
      "http.route": "/home/$section",
      "http.response.status_code": 200,
    });
    expect(accepted).toEqual({ "http.route": "/home/$section", "http.response.status_code": 200 });
    expect(dropped).toBe(9);
  });

  it("drops allowlisted keys whose values look like personal data or secrets", () => {
    expect(screenAttribute("app.component", JWT_LIKE)).toBeUndefined();
    expect(screenAttribute("app.component", KEY_LIKE)).toBeUndefined();
    expect(screenAttribute("app.outcome", "someone@example.org")).toBeUndefined();
    expect(screenAttribute("app.outcome", "08031234567")).toBeUndefined();
    expect(screenAttribute("app.outcome", "123e4567-e89b-12d3-a456-426614174000")).toBeUndefined();
    expect(screenAttribute("app.outcome", "has spaces in it")).toBeUndefined();
    expect(screenAttribute("app.outcome", "x".repeat(200))).toBeUndefined();
    expect(screenAttribute("app.outcome", "accepted")).toBe("accepted");
  });

  it("accepts routes only as templates, never with a query string or a concrete id", () => {
    expect(screenAttribute("http.route", "/api/public/{id}")).toBe("/api/public/{id}");
    expect(screenAttribute("http.route", "/home?token=abc")).toBeUndefined();
    expect(screenAttribute("http.route", "/home#x")).toBeUndefined();
    expect(
      screenAttribute("http.route", "/people/123e4567-e89b-12d3-a456-426614174000"),
    ).toBeUndefined();
    expect(screenAttribute("http.route", "/people/12345678")).toBeUndefined();
    expect(screenAttribute("http.route", "home")).toBeUndefined();
  });

  it("enforces value kinds", () => {
    expect(screenAttribute("http.response.status_code", "200")).toBeUndefined();
    expect(screenAttribute("http.response.status_code", 2.5)).toBeUndefined();
    expect(screenAttribute("http.response.status_code", -1)).toBeUndefined();
    expect(screenAttribute("app.cache_hit", "true")).toBeUndefined();
    expect(screenAttribute("app.cache_hit", true)).toBe(true);
    expect(screenAttribute("app.component", { nested: "object" })).toBeUndefined();
  });

  it("replaces unsafe span names", () => {
    expect(safeSpanName("load section")).toBe("load section");
    expect(safeSpanName("GET /home/$section")).toBe("GET /home/$section");
    expect(safeSpanName("lookup someone@example.org")).toBe(FALLBACK_SPAN_NAME);
    expect(safeSpanName("fetch 08031234567")).toBe(FALLBACK_SPAN_NAME);
    expect(safeSpanName(JWT_LIKE)).toBe(FALLBACK_SPAN_NAME);
    expect(safeSpanName("x".repeat(200))).toBe(FALLBACK_SPAN_NAME);
    expect(safeSpanName(undefined)).toBe(FALLBACK_SPAN_NAME);
  });
});

describe("M23 tracing facade: OTLP/HTTP JSON export when an endpoint is set", () => {
  it("exports allowlisted attributes only, with OTLP ids, times and status", async () => {
    const { calls, fetchImpl } = capture();
    let now = 1_700_000_000_000;
    const tracer = createTracer({
      endpoint: "http://localhost:4318/v1/traces",
      fetchImpl,
      nowMs: () => now,
      randomBytes: counterBytes(),
      serviceName: "sherivs-web",
      deploymentEnvironment: "staging",
    });
    expect(tracer.enabled).toBe(true);
    const parent = tracer.startSpan("GET /home", {
      kind: "server",
      attributes: {
        "http.request.method": "GET",
        "http.route": "/home",
        "user.email": "someone@example.org",
      },
    });
    now += 25;
    const child = tracer.startSpan("db read", {
      parent,
      attributes: { "db.operation.name": "select" },
    });
    child.setAttribute("db.statement", "select * from people where email = 'someone@example.org'");
    now += 5;
    child.end();
    parent.setAttribute("http.response.status_code", 200);
    parent.setStatus("ok");
    now += 10;
    parent.end();
    await tracer.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://localhost:4318/v1/traces");
    expect(calls[0]!.headers).toEqual({ "Content-Type": "application/json" });
    const serialized = JSON.stringify(calls[0]!.body);
    expect(serialized).not.toContain("someone@example.org");
    expect(serialized).not.toContain("db.statement");
    expect(serialized).not.toContain("user.email");

    const [childSpan, parentSpan] = spansOf(calls[0]!.body);
    expect(parentSpan!.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(parentSpan!.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(childSpan!.traceId).toBe(parentSpan!.traceId);
    expect(childSpan!.parentSpanId).toBe(parentSpan!.spanId);
    expect(parentSpan!.kind).toBe(2);
    expect(parentSpan!.status).toEqual({ code: 1 });
    expect(parentSpan!.startTimeUnixNano).toBe("1700000000000000000");
    expect(parentSpan!.endTimeUnixNano).toBe("1700000000040000000");
    expect(parentSpan!.attributes).toEqual([
      { key: "http.request.method", value: { stringValue: "GET" } },
      { key: "http.route", value: { stringValue: "/home" } },
      { key: "http.response.status_code", value: { intValue: "200" } },
    ]);
    expect(tracer.stats()).toMatchObject({
      exportedSpans: 2,
      droppedAttributes: 2,
      failedExports: 0,
    });
  });

  it("records an error's type only, never its message", async () => {
    const { calls, fetchImpl } = capture();
    const tracer = createTracer({
      endpoint: "http://127.0.0.1:4318/v1/traces",
      fetchImpl,
      nowMs: () => 1,
    });
    class LookupFailed extends Error {
      override name = "LookupFailed";
    }
    await expect(
      tracer.withSpan("lookup", async () => {
        throw new LookupFailed(`no account for someone@example.org with ${KEY_LIKE}`);
      }),
    ).rejects.toThrow(LookupFailed);
    await tracer.flush();
    const serialized = JSON.stringify(calls[0]!.body);
    expect(serialized).toContain("LookupFailed");
    expect(serialized).not.toContain("someone@example.org");
    expect(serialized).not.toContain(KEY_LIKE);
    expect(spansOf(calls[0]!.body)[0]!.status).toEqual({ code: 2 });
  });

  it("never throws into the caller when the collector fails, and counts the loss", async () => {
    const failing = createTracer({
      endpoint: "http://localhost:4318/v1/traces",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
      nowMs: () => 1,
    });
    failing.startSpan("a").end();
    await expect(failing.flush()).resolves.toBeUndefined();
    expect(failing.stats()).toMatchObject({ failedExports: 1, droppedSpans: 1 });

    const { fetchImpl } = capture(false);
    const rejected = createTracer({
      endpoint: "http://localhost:4318/v1/traces",
      fetchImpl,
      nowMs: () => 1,
    });
    rejected.startSpan("a").end();
    await rejected.flush();
    expect(rejected.stats()).toMatchObject({ failedExports: 1, exportedSpans: 0 });
  });

  it("bounds the queue and the attribute count", async () => {
    const { fetchImpl } = capture();
    const tracer = createTracer({
      endpoint: "http://localhost:4318/v1/traces",
      fetchImpl,
      nowMs: () => 1,
      maxQueueSize: 2,
      maxBatchSize: 100,
    });
    for (let i = 0; i < 5; i += 1) tracer.startSpan("a").end();
    expect(tracer.stats().droppedSpans).toBe(3);
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) many[`app.k${i}`] = "v";
    expect(screenAttributes(many).dropped).toBe(40);
  });

  it("keeps resource attributes to safe tokens", () => {
    const body = buildOtlpPayload([], { "service.name": "sherivs-web" });
    expect(JSON.stringify(body)).toContain("sherivs-web");
    expect(msToUnixNano(0)).toBe("0");
    expect(msToUnixNano(12.9)).toBe("12000000");
  });

  it("reads no header or API-key variable and never logs the endpoint", () => {
    const source = readFileSync(
      join(ROOT, "frontend/src/lib/observability/tracing.server.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/OTEL_EXPORTER_OTLP_HEADERS|DD_API_KEY|API_KEY/);
    const facade = readFileSync(join(ROOT, "frontend/src/lib/observability/tracing.ts"), "utf8");
    expect(facade).not.toMatch(/console\.|logStructured/);
    expect(facade).not.toMatch(/from "@opentelemetry|from "dd-trace|from "@datadog/);
  });
});
