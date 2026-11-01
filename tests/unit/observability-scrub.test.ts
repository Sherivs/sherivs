import { describe, expect, it } from "vitest";
import { REDACTED, scrubEvent, scrubString, scrubValue } from "@/lib/observability/scrub";
import { sentryOptions, SENTRY_TRACES_SAMPLE_RATE } from "@/lib/observability/sentry-config";

describe("Sentry scrubbing", () => {
  it("removes emails, phones, JWTs, bearer tokens, keys and secret query params from text", () => {
    const s = scrubString(
      "user ada.obi@school.ng called +234 803 555 0101 / 08035550101 with " +
        "Bearer abcDEF1234567890xyz and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIz " +
        "key sb_secret_ABCDEFGH12345678 url /cb?access_token=SECRET123&ok=1 " +
        "NODE_ENV=production API_KEY=raw-secret DATABASE_URL=postgres://db.test/app",
    );
    for (const leak of [
      "ada.obi@school.ng",
      "803 555",
      "08035550101",
      "abcDEF1234567890xyz",
      "eyJhbGci",
      "sb_secret_ABCDEFGH",
      "SECRET123",
      "production",
      "raw-secret",
      "postgres://",
      "db.test",
    ])
      expect(s).not.toContain(leak);
    expect(s).toContain("ok=1");
    expect(scrubString("error 404 at line 12")).toBe("error 404 at line 12");
  });

  it("redacts sensitive keys (passwords, tokens, student data, names) at any depth", () => {
    const out = scrubValue({
      password: "Hunter2xyz!",
      nested: {
        access_token: "t",
        student_name: "Ada",
        guardian: { phone: "1" },
        grade: "A1",
        ok: "fine",
      },
      list: [{ email: "x@y.zz" }],
    }) as {
      password: unknown;
      nested: {
        access_token: unknown;
        student_name: unknown;
        guardian: unknown;
        grade: unknown;
        ok: unknown;
      };
      list: Array<{ email: unknown }>;
    };
    expect(out.password).toBe(REDACTED);
    expect(out.nested.access_token).toBe(REDACTED);
    expect(out.nested.student_name).toBe(REDACTED);
    expect(out.nested.guardian).toBe(REDACTED);
    expect(out.nested.grade).toBe(REDACTED);
    expect(out.nested.ok).toBe("fine");
    expect(out.list[0].email).toBe(REDACTED);
  });

  it("keeps only the internal user id and drops cookies, bodies and query strings", () => {
    const ev = scrubEvent({
      user: { id: "u-1", email: "a@b.cc", username: "ada", ip_address: "1.2.3.4" },
      request: {
        url: "https://app.sherivs.com/reset?token=abc",
        cookies: { sb: "x" },
        data: { password: "p" },
        query_string: "token=abc",
        headers: { cookie: "sb=x", authorization: "Bearer zzz", "user-agent": "UA" },
      },
      sdk: { name: "sentry.javascript.tanstackstart-react", version: "11" },
      exception: { values: [{ type: "Error", value: "failed for ada@x.org" }] },
    });
    expect(ev.user).toEqual({ id: "u-1" });
    expect(ev.request).toEqual({
      url: "https://app.sherivs.com/reset",
      headers: { "user-agent": "UA" },
    });
    expect(ev.sdk).toEqual({ name: "sentry.javascript.tanstackstart-react", version: "11" });
    expect(JSON.stringify(ev)).not.toContain("ada@x.org");
  });

  it("handles cycles without throwing", () => {
    const a: Record<string, unknown> = { ok: 1 };
    a.self = a;
    expect(() => scrubValue(a)).not.toThrow();
  });
});

describe("Sentry options / no-DSN safety", () => {
  it("returns null (Sentry disabled) when the DSN is unset or blank", () => {
    expect(sentryOptions({})).toBeNull();
    expect(sentryOptions({ dsn: "  " })).toBeNull();
    expect(sentryOptions({ dsn: null })).toBeNull();
  });

  it("has no PII, no replay, low tracing, and scrubs in beforeSend", () => {
    const o = sentryOptions({
      dsn: "https://k@o1.ingest.de.sentry.io/1",
      environment: "preview",
      release: "abc",
    })!;
    expect(o.sendDefaultPii).toBe(false);
    expect(o.tracesSampleRate).toBe(SENTRY_TRACES_SAMPLE_RATE);
    expect(SENTRY_TRACES_SAMPLE_RATE).toBeLessThanOrEqual(0.1);
    expect(o.replaysSessionSampleRate).toBe(0);
    expect(o.replaysOnErrorSampleRate).toBe(0);
    expect(o.environment).toBe("preview");
    expect(o.release).toBe("abc");
    const ev = o.beforeSend({ user: { id: "u", email: "a@b.cc" }, message: "hi a@b.cc" } as Record<
      string,
      unknown
    >);
    expect(JSON.stringify(ev)).not.toContain("a@b.cc");
    expect(o.beforeBreadcrumb({ category: "ui.input", message: "typed" })).toBeNull();
  });

  it("server and client wrappers are inert without a DSN", async () => {
    delete process.env.SENTRY_DSN;
    const server = await import("@/lib/observability/sentry.server");
    expect(server.serverSentryEnabled).toBe(false);
    const entry = { fetch: async () => new Response("ok") };
    expect(server.withServerSentry(entry)).toBe(entry);
    expect(() => server.captureServerError(new Error("x"))).not.toThrow();
    const client = await import("@/lib/observability/sentry-browser");
    expect(client.initClientSentry({})).toBe(false);
    expect(() => client.captureClientError(new Error("x"))).not.toThrow();
  });
});

describe("beforeSendSpan", () => {
  it("scrubs span descriptions and attributes", async () => {
    const { sentryOptions } = await import("@/lib/observability/sentry-config");
    const o = sentryOptions({
      dsn: "https://k@o1.ingest.de.sentry.io/1",
      environment: "test",
      release: "x",
    })!;
    const s = o.beforeSendSpan({
      description: "GET /api/x?token=abc",
      data: { password: "hunter2", "http.url": "https://a.b/c?email=a@b.co", ok: 1 },
    } as Record<string, unknown>) as { description: string; data: Record<string, unknown> };
    expect(s.description).toBe("GET /api/x");
    expect(s.data.password).toBe("[redacted]");
    expect(JSON.stringify(s)).not.toContain("a@b.co");
    expect(s.data.ok).toBe(1);
  });
});
