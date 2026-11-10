/**
 * INFRA-01 — the server, start, and root error sites must not emit raw errors.
 * Personal data and tokens stay out of the structured line; trace ids are
 * pseudonymous correlation handles, not user identifiers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { logBoundaryFailure } from "@/lib/observability/boundary-log";
import { createTraceContext } from "@/lib/observability/trace-context";
import { handleStartMiddlewareError } from "@/start-error";
import { reportRootError } from "@/lib/observability/root-boundary";
import { serveFetch } from "@/server";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EMAIL = "parent.ada@school.ng";
const PHONE = "+2348035550101";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIz";
const STUDENT = "Ada Obi";
const PARENT = "Emeka Obi";
const QUERY_TOKEN = "query-token-should-not-log";

function assertNoPersonalData(text: string): void {
  expect(text).not.toContain(EMAIL);
  expect(text).not.toContain(PHONE);
  expect(text).not.toContain("8035550101");
  expect(text).not.toContain("eyJhbGci");
  expect(text).not.toContain(STUDENT);
  expect(text).not.toContain(PARENT);
  expect(text).not.toContain(QUERY_TOKEN);
}

function leakyError(): Error {
  const error = new Error(`failed for ${EMAIL} phone ${PHONE} bearer ${JWT}`);
  Object.assign(error, {
    student_name: STUDENT,
    parent_name: PARENT,
    token: QUERY_TOKEN,
  });
  return error;
}

describe("boundary error log", () => {
  it("emits a scrubbed string with pseudonymous trace ids, not the raw error", () => {
    const lines: string[] = [];
    const raw: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      raw.push(...args);
    });
    const trace = createTraceContext({
      traceId: "trace0001",
      correlationId: "corr00001",
      now: () => 1,
    });
    try {
      logBoundaryFailure(
        {
          msg: "boundary",
          component: "test",
          error: leakyError(),
          trace,
          fields: { path: `/students?token=${QUERY_TOKEN}`, note: EMAIL },
        },
        {
          sink: (line) => lines.push(line),
          now: () => "2026-11-10T00:00:00.000Z",
        },
      );
      expect(lines).toHaveLength(1);
      const line = lines[0] ?? "";
      expect(line.startsWith("{")).toBe(true);
      const parsed = JSON.parse(line) as {
        err: string;
        trace_id: string;
        correlation_id: string;
        path: string;
      };
      expect(parsed.trace_id).toBe("trace0001");
      expect(parsed.correlation_id).toBe("corr00001");
      expect(typeof parsed.err).toBe("string");
      assertNoPersonalData(line);
      expect(parsed.path).toContain("[redacted]");
      expect(raw.every((arg) => !(arg instanceof Error))).toBe(true);
      expect(raw).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("scrubs plain objects that carry student or parent fields", () => {
    const lines: string[] = [];
    logBoundaryFailure(
      {
        msg: "object-error",
        component: "test",
        error: {
          student_name: STUDENT,
          parent: { email: EMAIL, phone: PHONE },
          token: JWT,
          detail: `contact ${EMAIL}`,
        },
      },
      { sink: (line) => lines.push(line), now: () => "2026-11-10T00:00:00.000Z" },
    );
    const line = lines[0] ?? "";
    assertNoPersonalData(line);
    expect(line).toContain("trace_id");
    expect(line).toContain("correlation_id");
    expect(line).not.toContain("[object Object]");
  });
});

describe("the three log sites", () => {
  it("does not console.error in server.ts, start.ts, or __root.tsx", () => {
    for (const path of [
      "frontend/src/server.ts",
      "frontend/src/start.ts",
      "frontend/src/routes/__root.tsx",
    ]) {
      const text = readFileSync(resolve(ROOT, path), "utf8");
      expect(text).not.toMatch(/console\.error/);
    }
    expect(readFileSync(resolve(ROOT, "frontend/src/server.ts"), "utf8")).toContain(
      "logBoundaryFailure",
    );
    const start = readFileSync(resolve(ROOT, "frontend/src/start.ts"), "utf8");
    expect(start).toContain("return handleStartMiddlewareError(error)");
    expect(readFileSync(resolve(ROOT, "frontend/src/start-error.ts"), "utf8")).toContain(
      "logBoundaryFailure",
    );
    const root = readFileSync(resolve(ROOT, "frontend/src/routes/__root.tsx"), "utf8");
    expect(root).toContain("reportRootError(error)");
    expect(
      readFileSync(resolve(ROOT, "frontend/src/lib/observability/root-boundary.ts"), "utf8"),
    ).toContain("logBoundaryFailure");
  });

  it("server fetch does not emit the raw error or the swallowed response body", async () => {
    const lines: string[] = [];
    const raw: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      raw.push(...args);
    });
    const sink = (line: string) => lines.push(line);
    const log = { sink, now: () => "2026-11-10T00:00:00.000Z" };
    const url = `https://app.sherivs.com/students?token=${QUERY_TOKEN}&email=${EMAIL}`;
    try {
      const thrown = await serveFetch(
        new Request(url),
        {},
        {},
        {
          loadEntry: async () => ({
            fetch: async () => {
              throw leakyError();
            },
          }),
          log,
        },
      );
      expect(thrown.status).toBe(500);

      const body = JSON.stringify({
        unhandled: true,
        message: "HTTPError",
        student_name: STUDENT,
        parent_email: EMAIL,
        token: QUERY_TOKEN,
      });
      const swallowed = await serveFetch(
        new Request(url),
        {},
        {},
        {
          loadEntry: async () => ({
            fetch: async () =>
              new Response(body, {
                status: 500,
                headers: { "content-type": "application/json" },
              }),
          }),
          log,
        },
      );
      expect(swallowed.status).toBe(500);

      const joined = lines.join("\n");
      assertNoPersonalData(joined);
      expect(joined).toContain("server-fetch-unhandled");
      expect(joined).toContain("server-ssr-swallowed");
      expect(joined).toContain("trace_id");
      expect(joined).toContain("correlation_id");
      expect(joined).not.toContain("HTTPError");
      expect(joined).not.toContain("parent_email");
      for (const arg of raw) {
        expect(arg).not.toBeInstanceOf(Error);
        const text = typeof arg === "string" ? arg : JSON.stringify(arg);
        assertNoPersonalData(text);
      }
    } finally {
      consoleError.mockRestore();
    }
  });

  it("start middleware and the root boundary log scrubbed lines only", () => {
    const lines: string[] = [];
    const raw: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      raw.push(...args);
    });
    const log = { sink: (line: string) => lines.push(line), now: () => "2026-11-10T00:00:00.000Z" };
    try {
      const response = handleStartMiddlewareError(leakyError(), log);
      expect(response.status).toBe(500);
      expect(() => handleStartMiddlewareError({ statusCode: 404, message: EMAIL })).toThrow();
      reportRootError(
        {
          student_name: STUDENT,
          parent_name: PARENT,
          email: EMAIL,
          token: JWT,
        },
        log,
      );
      const joined = lines.join("\n");
      expect(joined).toContain("start-middleware-error");
      expect(joined).toContain("root-error-boundary");
      assertNoPersonalData(joined);
      expect(joined).toContain("trace_id");
      expect(joined).toContain("correlation_id");
      expect(lines.filter((line) => line.includes("start-middleware-error"))).toHaveLength(1);
      for (const arg of raw) expect(arg).not.toBeInstanceOf(Error);
    } finally {
      consoleError.mockRestore();
    }
  });
});
