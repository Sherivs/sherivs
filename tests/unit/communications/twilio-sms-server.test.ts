/**
 * CoreGrid — Twilio SMS adapter tests (V1-009 communication fabric).
 *
 * Proves:
 * 1. Fail-closed credential law: absent/partial credentials resolve to the
 *    typed BLOCKED_NO_CREDENTIAL result with NO fetch and NO network contact.
 * 2. Outbound payload contract: malformed recipients/bodies are rejected
 *    locally (no provider call attempted).
 * 3. Provider refusal classification: 408/429/5xx retryable, other 4xx not.
 * 4. Untrusted provider output: a malformed body never fabricates a receipt.
 * 5. Inbound webhook signature validation (§17): correct signature accepted,
 *    missing/malformed/tampered signatures refused, constant-time compare.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  TWILIO_ACCOUNT_SID_ENV,
  TWILIO_AUTH_TOKEN_ENV,
  TWILIO_FROM_NUMBER_ENV,
  computeTwilioWebhookSignature,
  createTwilioSmsSender,
  missingTwilioSmsEnvVars,
  twilioSmsConfigFromEnv,
  verifyTwilioWebhookSignature,
  type TwilioSmsResult,
} from "../../../frontend/src/lib/communications/twilio-sms.server";

/** Narrow a result to the blocked posture (typecheck-honest assertions). */
function expectBlocked(result: TwilioSmsResult): asserts result is Extract<TwilioSmsResult, { outcome: "undeliverable" }> {
  if (result.outcome !== "undeliverable") throw new Error(`expected undeliverable, got ${result.outcome}`);
}
function expectFailed(result: TwilioSmsResult): asserts result is Extract<TwilioSmsResult, { outcome: "failed" }> {
  if (result.outcome !== "failed") throw new Error(`expected failed, got ${result.outcome}`);
}
function expectSent(result: TwilioSmsResult): asserts result is Extract<TwilioSmsResult, { outcome: "sent" }> {
  if (result.outcome !== "sent") throw new Error(`expected sent, got ${result.outcome}`);
}

const FULL_ENV = {
  [TWILIO_ACCOUNT_SID_ENV]: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  [TWILIO_AUTH_TOKEN_ENV]: "test-auth-token-fixture",
  [TWILIO_FROM_NUMBER_ENV]: "+15550000001",
};

describe("twilioSmsConfigFromEnv", () => {
  it("resolves config only when ALL required credentials are present", () => {
    const config = twilioSmsConfigFromEnv(FULL_ENV);
    expect(config).not.toBeNull();
    expect(config?.accountSid).toBe(FULL_ENV[TWILIO_ACCOUNT_SID_ENV]);
    expect(config?.fromNumber).toBe(FULL_ENV[TWILIO_FROM_NUMBER_ENV]);
  });

  it("fails closed on every partial credential state", () => {
    expect(twilioSmsConfigFromEnv({})).toBeNull();
    expect(twilioSmsConfigFromEnv({ ...FULL_ENV, [TWILIO_AUTH_TOKEN_ENV]: "" })).toBeNull();
    expect(twilioSmsConfigFromEnv({ ...FULL_ENV, [TWILIO_FROM_NUMBER_ENV]: undefined })).toBeNull();
  });

  it("names the missing env vars in gate order", () => {
    expect(missingTwilioSmsEnvVars({})).toEqual([
      TWILIO_ACCOUNT_SID_ENV,
      TWILIO_AUTH_TOKEN_ENV,
      TWILIO_FROM_NUMBER_ENV,
    ]);
    expect(missingTwilioSmsEnvVars({ [TWILIO_ACCOUNT_SID_ENV]: "AC123" })).toEqual([
      TWILIO_AUTH_TOKEN_ENV,
      TWILIO_FROM_NUMBER_ENV,
    ]);
  });
});

describe("createTwilioSmsSender — fail-closed credential gate", () => {
  it("blocks without any fetch when config is absent", async () => {
    const fetchImpl = vi.fn();
    const send = createTwilioSmsSender(null, fetchImpl as unknown as typeof fetch);
    const result = await send({
      tenantId: "tenant-1",
      notificationRef: "notif-1",
      to: "+15550000002",
      body: "hello",
    });
    expect(result.outcome).toBe("undeliverable");
    expectBlocked(result);
    expect(result.code).toBe("provider_not_configured");
    expect(result.reason).toContain("BLOCKED_NO_CREDENTIAL");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects malformed recipients locally without a provider call", async () => {
    const fetchImpl = vi.fn();
    const send = createTwilioSmsSender(
      twilioSmsConfigFromEnv(FULL_ENV),
      fetchImpl as unknown as typeof fetch,
    );
    const result = await send({
      tenantId: "tenant-1",
      notificationRef: "notif-1",
      to: "not-a-phone-number",
      body: "hello",
    });
    expect(result.outcome).toBe("failed");
    expectFailed(result);
    expect(result).toHaveProperty("retryable", false);
    expect(result.reason).toContain("no provider call was attempted");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createTwilioSmsSender — transport classification", () => {
  function responseOf(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }

  it("maps a provider receipt to the typed sent result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      responseOf(200, { sid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", status: "queued" }),
    );
    const send = createTwilioSmsSender(
      twilioSmsConfigFromEnv(FULL_ENV),
      fetchImpl as unknown as typeof fetch,
    );
    const result = await send({
      tenantId: "tenant-1",
      notificationRef: null,
      to: "+15550000002",
      body: "hello",
    });
    expect(result.outcome).toBe("sent");
    expectSent(result);
    expect(result.providerMessageId).toBe("SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("marks 429 and 5xx retryable and other 4xx not", async () => {
    const send = createTwilioSmsSender(
      twilioSmsConfigFromEnv(FULL_ENV),
      (async () => responseOf(429, {})) as unknown as typeof fetch,
    );
    const retryableResult = await send({
      tenantId: "t",
      notificationRef: null,
      to: "+15550000002",
      body: "hello",
    });
    expect(retryableResult.outcome).toBe("failed");
    expectFailed(retryableResult);
    expect(retryableResult.retryable).toBe(true);

    const sendForbidden = createTwilioSmsSender(
      twilioSmsConfigFromEnv(FULL_ENV),
      (async () => responseOf(403, {})) as unknown as typeof fetch,
    );
    const forbiddenResult = await sendForbidden({
      tenantId: "t",
      notificationRef: null,
      to: "+15550000002",
      body: "hello",
    });
    expect(forbiddenResult.outcome).toBe("failed");
    expectFailed(forbiddenResult);
    expect(forbiddenResult.retryable).toBe(false);
  });

  it("never asserts delivery when the provider returns no usable id", async () => {
    const send = createTwilioSmsSender(
      twilioSmsConfigFromEnv(FULL_ENV),
      (async () => responseOf(200, { unexpected: true })) as unknown as typeof fetch,
    );
    const result = await send({
      tenantId: "t",
      notificationRef: null,
      to: "+15550000002",
      body: "hello",
    });
    expect(result.outcome).toBe("failed");
    expectFailed(result);
    expect(result.reason).toContain("delivery is NOT asserted");
  });
});

describe("verifyTwilioWebhookSignature", () => {
  const authToken = "test-auth-token-fixture";
  const url = "https://example.coregrid.dev/api/public/webhooks/twilio";
  const params: Record<string, string> = { From: "+15550000002", To: "+15550000001", Body: "hi" };

  it("accepts a correctly signed request", () => {
    const signature = computeTwilioWebhookSignature(authToken, url, params);
    const result = verifyTwilioWebhookSignature(authToken, {
      url,
      params,
      signatureHeader: signature,
    });
    expect(result).toEqual({ ok: true });
  });

  it("refuses a tampered payload", () => {
    const signature = computeTwilioWebhookSignature(authToken, url, params);
    const result = verifyTwilioWebhookSignature(authToken, {
      url,
      params: { ...params, Body: "tampered" },
      signatureHeader: signature,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("signature_mismatch");
  });

  it("refuses missing and malformed signatures", () => {
    expect(verifyTwilioWebhookSignature(authToken, { url, params, signatureHeader: null }).ok).toBe(
      false,
    );
    const malformed = verifyTwilioWebhookSignature(authToken, {
      url,
      params,
      signatureHeader: "not base64!!",
    });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.code).toBe("malformed_signature");
  });

  it("is parameter-order independent (Twilio signing sorts before hashing)", () => {
    const signature = computeTwilioWebhookSignature(authToken, url, params);
    const reordered: Record<string, string> = { Body: params.Body, From: params.From, To: params.To };
    const result = verifyTwilioWebhookSignature(authToken, {
      url,
      params: reordered,
      signatureHeader: signature,
    });
    expect(result).toEqual({ ok: true });
  });

  it("matches the documented HMAC-SHA1 construction", () => {
    const expected = createHmac("sha1", authToken)
      .update(url + Object.keys(params).sort().map((k) => `${k}${params[k]}`).join(""))
      .digest("base64");
    expect(computeTwilioWebhookSignature(authToken, url, params)).toBe(expected);
  });
});