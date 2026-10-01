/**
 * CoreGrid — structured logging tests (V5.3 Part 30 observability-minimal).
 * Covers redaction (fail-closed), levels, field ordering/omission, and
 * safe error serialization with no stack traces.
 */
import { describe, expect, it } from "vitest";
import {
  formatLogLine,
  isSensitiveKey,
  logStructured,
  redactValue,
  serializeError,
  type StructuredLogEntry,
} from "@/lib/observability/structured-log";

const FIXED_TS = "2026-10-01T00:00:00.000Z";

describe("isSensitiveKey / redactValue (fail-closed redaction)", () => {
  it("marks secret/token/password/key-like keys, case-insensitively", () => {
    expect(isSensitiveKey("api_key")).toBe(true);
    expect(isSensitiveKey("accessToken")).toBe(true);
    expect(isSensitiveKey("PASSWORD")).toBe(true);
    expect(isSensitiveKey("clientSecret")).toBe(true);
    expect(isSensitiveKey("auth_header")).toBe(false);
    expect(isSensitiveKey("tenant_id")).toBe(false);
  });

  it("redacts sensitive keys at the top level and nested", () => {
    expect(
      redactValue({
        api_key: "k-123",
        accessToken: "t-123",
        PASSWORD: "p-123",
        nested: { client_secret: "s-123", safe: 1 },
        list: [{ token: "x-123" }, 5],
        tenant_id: "t1",
      }),
    ).toEqual({
      api_key: "[REDACTED]",
      accessToken: "[REDACTED]",
      PASSWORD: "[REDACTED]",
      nested: { client_secret: "[REDACTED]", safe: 1 },
      list: [{ token: "[REDACTED]" }, 5],
      tenant_id: "t1",
    });
  });

  it("degrades cycles and over-deep structures instead of throwing", () => {
    const circular: Record<string, unknown> = { name: "ok" };
    circular.self = circular;
    expect(redactValue(circular)).toEqual({ name: "ok", self: "[circular]" });

    let deep: unknown = "leaf";
    for (let i = 0; i < 20; i += 1) deep = { child: deep };
    let expected: unknown = "[truncated]";
    for (let i = 0; i < 8; i += 1) expected = { child: expected };
    expect(redactValue(deep)).toEqual(expected);
  });
});

describe("serializeError (no stacks, no raw payloads)", () => {
  it("formats Errors as Name: message only", () => {
    const out = serializeError(new TypeError("boom"));
    expect(out).toBe("TypeError: boom");
    expect(out).not.toContain("at ");
    expect(out).not.toContain("\n");
  });

  it("handles strings, objects, undefined and circular safely", () => {
    expect(serializeError("plain")).toBe("plain");
    expect(serializeError({ code: 7 })).toBe('{"code":7}');
    expect(serializeError(undefined)).toBe("undefined");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeError(circular)).toBe("[unserializable-error]");
  });
});

describe("formatLogLine (pure JSON-lines)", () => {
  it("emits ts/level/msg plus optional fields, redacting extras", () => {
    const line: StructuredLogEntry = {
      msg: "request-handled",
      level: "warn",
      tenant_id: "tenant-a",
      component: "server",
      duration_ms: 12.5,
      err: new TypeError("boom"),
      user_id: "u1",
      api_key: "k-123",
    };
    expect(JSON.parse(formatLogLine(line, { now: () => FIXED_TS }))).toEqual({
      ts: FIXED_TS,
      level: "warn",
      msg: "request-handled",
      tenant_id: "tenant-a",
      component: "server",
      duration_ms: 12.5,
      err: "TypeError: boom",
      user_id: "u1",
      api_key: "[REDACTED]",
    });
  });

  it("defaults to info level and omits null/undefined optional fields", () => {
    const parsed = JSON.parse(
      formatLogLine({ msg: "minimal", tenant_id: null, component: null }, { now: () => FIXED_TS }),
    ) as Record<string, unknown>;
    expect(parsed).toEqual({ ts: FIXED_TS, level: "info", msg: "minimal" });
  });

  it("skips non-finite durations", () => {
    const parsed = JSON.parse(
      formatLogLine({ msg: "m", duration_ms: Number.NaN }, { now: () => FIXED_TS }),
    ) as Record<string, unknown>;
    expect(parsed).toEqual({ ts: FIXED_TS, level: "info", msg: "m" });
  });

  it("uses a real ISO timestamp by default", () => {
    const parsed = JSON.parse(formatLogLine({ msg: "m" })) as { ts: string };
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("logStructured (injectable sink)", () => {
  it("writes exactly one JSON line per event through the sink", () => {
    const lines: string[] = [];
    logStructured(
      {
        msg: "server-fetch",
        level: "error",
        component: "server",
        path: "/health.json",
        supabase_service_key: "k-123",
        err: new Error("db down"),
      },
      { sink: (line) => lines.push(line), now: () => FIXED_TS },
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      ts: FIXED_TS,
      level: "error",
      msg: "server-fetch",
      component: "server",
      path: "/health.json",
      supabase_service_key: "[REDACTED]",
      err: "Error: db down",
    });
  });

  it("never emits query strings the caller passes — callers log pathname only", () => {
    const lines: string[] = [];
    logStructured(
      { msg: "server-fetch", path: "/login", query_token: "secret-value" },
      { sink: (line) => lines.push(line), now: () => FIXED_TS },
    );
    expect(lines[0]).not.toContain("secret-value");
    expect(lines[0]).toContain('"query_token":"[REDACTED]"');
  });
});