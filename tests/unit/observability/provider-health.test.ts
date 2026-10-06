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
 * 6. Posture evaluation and the static NOT_REQUIRED set (§45 V2-deferred).
 */
import { describe, expect, it, vi } from "vitest";
import {
  checkAiGatewayHealth,
  checkPaystackHealth,
  checkResendHealth,
  checkSupabaseHealth,
  checkTwilioHealth,
  checkVapiHealth,
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

  it("declares V2-deferred and infrastructure providers NOT_REQUIRED without probing", () => {
    const statics = staticNotRequiredProviders();
    const providers = statics.map((report) => report.provider);
    expect(providers).toContain("posthog");
    expect(providers).toContain("sentry");
    expect(providers).toContain("redis");
    for (const report of statics) {
      expect(report.state).toBe("NOT_REQUIRED");
      expect(report.httpStatus).toBeNull();
      expect(report.detail).not.toMatch(/sk_|secret|token value/i);
    }
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
    expect(states.get("posthog")).toBe("NOT_REQUIRED");
    for (const report of reports) {
      // No secret VALUES ever enter a report: details carry status text only.
      expect(report.detail).not.toContain("sk_test_");
    }
  });
});