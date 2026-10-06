/**
 * CoreGrid — provider integration health tests (mission §18).
 *
 * Proves the fail-closed state semantics with injected fetches (no network):
 * 1. NOT_CONFIGURED with ZERO fetch when a credential is absent.
 * 2. CONFIGURED when the provider refuses the credential (401/403).
 * 3. AUTHENTICATED on a 2xx read-only probe (supabase escalates to
 *    OPERATIONAL because its probe is a service-health endpoint).
 * 4. DEGRADED on network failure/timeout and on unexpected 5xx.
 * 5. Non-https or non-URL targets are refused BEFORE any contact.
 * 6. Posture evaluation, the (now empty) static NOT_REQUIRED set, and the
 *    un-frozen vendor probes (DECISIONS #204) incl. redis NOT_REQUIRED.
 */
import { describe, expect, it, vi } from "vitest";
import {
  checkAiGatewayHealth,
  checkCloudflareHealth,
  checkExpoHealth,
  checkNewRelicHealth,
  checkPaystackHealth,
  checkPosthogHealth,
  checkRedisHealth,
  checkResendHealth,
  checkSentryHealth,
  checkSupabaseHealth,
  checkTwilioHealth,
  checkVapiHealth,
  checkVercelHealth,
  evaluateProviderHealthPosture,
  runProviderHealthBattery,
  staticNotRequiredProviders,
} from "../../../frontend/src/lib/observability/provider-health.server";

function okFetch(status: number) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  }) as unknown as typeof fetch;
}

function failingFetch() {
  return vi.fn().mockRejectedValue(new Error("connection refused")) as unknown as typeof fetch;
}

describe("provider health — fail-closed credential gates", () => {
  it("reports NOT_CONFIGURED without any fetch when credentials are absent", async () => {
    const fetchImpl = vi.fn();
    for (const [check, env] of [
      [checkResendHealth, {}],
      [checkPaystackHealth, {}],
      [checkVapiHealth, {}],
      [checkTwilioHealth, {}],
      [checkSupabaseHealth, { SUPABASE_URL: "https://example.supabase.co" }],
      [checkAiGatewayHealth, { AI_API_KEY: "present" }],
    ] as const) {
      const report = await check(env, fetchImpl as unknown as typeof fetch);
      expect(report.state).toBe("NOT_CONFIGURED");
      expect(report.httpStatus).toBeNull();
      expect(report.detail).toContain("BLOCKED_NO_CREDENTIAL");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses non-https and non-URL targets before any contact", async () => {
    const fetchImpl = vi.fn();
    const http = await checkSupabaseHealth(
      { SUPABASE_URL: "http://insecure.example", SUPABASE_PUBLISHABLE_KEY: "k" },
      fetchImpl,
    );
    expect(http.state).toBe("NOT_CONFIGURED");
    const malformed = await checkAiGatewayHealth(
      { AI_API_KEY: "k", AI_GATEWAY_URL: "not a url" },
      fetchImpl,
    );
    expect(malformed.state).toBe("NOT_CONFIGURED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("provider health — probe state derivation", () => {
  it("maps 401/403 to CONFIGURED (credential present, refused)", async () => {
    const report = await checkResendHealth({ RESEND_API_KEY: "k" }, okFetch(401));
    expect(report.state).toBe("CONFIGURED");
    expect(report.httpStatus).toBe(401);
  });

  it("maps a 2xx read-only probe to AUTHENTICATED", async () => {
    const report = await checkPaystackHealth({ PAYSTACK_SECRET_KEY: "sk_test_k" }, okFetch(200));
    expect(report.state).toBe("AUTHENTICATED");
  });

  it("escalates the supabase service-health 2xx to OPERATIONAL", async () => {
    const report = await checkSupabaseHealth(
      { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "k" },
      okFetch(200),
    );
    expect(report.state).toBe("OPERATIONAL");
  });

  it("maps network failure to DEGRADED (never a fake success)", async () => {
    const report = await checkVapiHealth({ VAPI_API_KEY: "k" }, failingFetch());
    expect(report.state).toBe("DEGRADED");
    expect(report.httpStatus).toBeNull();
  });

  it("maps an unexpected 5xx to DEGRADED", async () => {
    const report = await checkTwilioHealth(
      { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok" },
      okFetch(503),
    );
    expect(report.state).toBe("DEGRADED");
  });

  it("hard-refuses a non-https AI gateway URL even with credentials", async () => {
    const report = await checkAiGatewayHealth(
      { AI_API_KEY: "k", AI_GATEWAY_URL: "ftp://gateway.example/v1" },
      okFetch(200),
    );
    expect(report.state).toBe("NOT_CONFIGURED");
  });
});

describe("provider health — battery posture and statics", () => {
  it("evaluates posture ok / degraded / failing", () => {
    expect(
      evaluateProviderHealthPosture([
        { provider: "a", state: "AUTHENTICATED", detail: "", checkedAt: "", httpStatus: 200, durationMs: 1 },
        { provider: "b", state: "NOT_REQUIRED", detail: "", checkedAt: "", httpStatus: null, durationMs: 0 },
      ]).status,
    ).toBe("ok");
    expect(
      evaluateProviderHealthPosture([
        { provider: "a", state: "CONFIGURED", detail: "", checkedAt: "", httpStatus: 401, durationMs: 1 },
      ]).status,
    ).toBe("degraded");
    expect(
      evaluateProviderHealthPosture([
        { provider: "a", state: "DEGRADED", detail: "", checkedAt: "", httpStatus: null, durationMs: 1 },
      ]).status,
    ).toBe("failing");
    expect(
      evaluateProviderHealthPosture([
        { provider: "a", state: "NOT_CONFIGURED", detail: "", checkedAt: "", httpStatus: null, durationMs: 0 },
      ]).status,
    ).toBe("failing");
  });

  it("declares no statically NOT_REQUIRED providers after the DECISIONS #204 un-freeze", () => {
    // Every supplied vendor credential now carries a live verification probe;
    // the static set exists only as the declared-none escape hatch.
    expect(staticNotRequiredProviders()).toEqual([]);
  });

  it("reports redis NOT_REQUIRED (never failing) when no credential is supplied", async () => {
    const fetchImpl = vi.fn();
    const report = await checkRedisHealth({}, fetchImpl as unknown as typeof fetch);
    expect(report.state).toBe("NOT_REQUIRED");
    expect(report.httpStatus).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(evaluateProviderHealthPosture([report]).status).toBe("ok");
    expect(report.detail).toContain("in-process rate limiter");
  });

  it("un-frozen vendor probes derive probe states like every other provider", async () => {
    const refused = await checkPosthogHealth({ POSTHOG_PERSONAL_API_KEY: "k" }, okFetch(401));
    expect(refused.state).toBe("CONFIGURED");
    const degraded = await checkVercelHealth({ VERCEL_API_TOKEN: "k" }, failingFetch());
    expect(degraded.state).toBe("DEGRADED");
    const sentryOk = await checkSentryHealth({ SENTRY_AUTH_TOKEN: "k" }, okFetch(200));
    expect(sentryOk.state).toBe("AUTHENTICATED");
    const newRelicOk = await checkNewRelicHealth(
      { NEW_RELIC_USER_KEY: "k", NEW_RELIC_API_URL: "https://api.eu.newrelic.com" },
      okFetch(200),
    );
    expect(newRelicOk.state).toBe("AUTHENTICATED");
    const cloudflareOk = await checkCloudflareHealth({ CLOUDFLARE_API_TOKEN: "k" }, okFetch(200));
    expect(cloudflareOk.state).toBe("AUTHENTICATED");
    const expoOk = await checkExpoHealth({ EXPO_TOKEN: "k" }, okFetch(200));
    expect(expoOk.state).toBe("AUTHENTICATED");
  });

  it("refuses a non-https redis or region-host URL before any contact", async () => {
    const fetchImpl = vi.fn();
    const redis = await checkRedisHealth(
      { REDIS_REST_URL: "http://insecure.example", REDIS_REST_TOKEN: "k" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(redis.state).toBe("NOT_CONFIGURED");
    const posthog = await checkPosthogHealth(
      { POSTHOG_PERSONAL_API_KEY: "k", POSTHOG_API_URL: "not a url" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(posthog.state).toBe("NOT_CONFIGURED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("runs the full battery with injected fetches and secret-free details", async () => {
    const fetchImpl = okFetch(200);
    const reports = await runProviderHealthBattery(
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "k",
        RESEND_API_KEY: "k",
        PAYSTACK_SECRET_KEY: "k",
        TWILIO_ACCOUNT_SID: "AC123",
        TWILIO_AUTH_TOKEN: "tok",
        VAPI_API_KEY: "k",
        AI_API_KEY: "k",
        AI_GATEWAY_URL: "https://gateway.example/v1",
        POSTHOG_PERSONAL_API_KEY: "k",
        SENTRY_AUTH_TOKEN: "k",
        NEW_RELIC_USER_KEY: "k",
        CLOUDFLARE_API_TOKEN: "k",
        VERCEL_API_TOKEN: "k",
        EXPO_TOKEN: "k",
      },
      fetchImpl as unknown as typeof fetch,
    );
    const states = new Map(reports.map((report) => [report.provider, report.state]));
    expect(states.get("supabase")).toBe("OPERATIONAL");
    expect(states.get("resend")).toBe("AUTHENTICATED");
    expect(states.get("paystack")).toBe("AUTHENTICATED");
    expect(states.get("twilio")).toBe("AUTHENTICATED");
    expect(states.get("vapi")).toBe("AUTHENTICATED");
    expect(states.get("ai-gateway")).toBe("AUTHENTICATED");
    expect(states.get("posthog")).toBe("AUTHENTICATED");
    expect(states.get("sentry")).toBe("AUTHENTICATED");
    expect(states.get("new-relic")).toBe("AUTHENTICATED");
    expect(states.get("cloudflare")).toBe("AUTHENTICATED");
    expect(states.get("vercel")).toBe("AUTHENTICATED");
    expect(states.get("expo-eas")).toBe("AUTHENTICATED");
    expect(states.get("redis")).toBe("NOT_REQUIRED");
    expect(evaluateProviderHealthPosture(reports).status).toBe("ok");
    for (const report of reports) {
      // No secret VALUES ever enter a report: details carry status text only.
      expect(report.detail).not.toContain("sk_test_");
    }
  });
});