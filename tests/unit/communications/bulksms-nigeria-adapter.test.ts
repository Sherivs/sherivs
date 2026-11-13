/**
 * Sherivs — BulkSMS Nigeria adapter + provider selection tests (COMMS-03).
 *
 * Proves:
 * 1. Fail-closed credential law: absent/malformed credentials resolve to the typed
 *    undeliverable result with NO fetch; selection refuses unset/unsupported/unconfigured.
 * 2. Outbound contract: the exact documented v2 body, bounded locally before any provider contact.
 * 3. At-most-once classification: only provably-unprocessed failures are retryable.
 * 4. Untrusted provider output never fabricates a receipt.
 * 5. Per-message callback tokens verify in constant time and fail closed.
 * 6. No credential value appears in any result.
 */
import { describe, expect, it, vi } from "vitest";
import {
  BULKSMS_NG_SENDER_ENV,
  BULKSMS_NG_SEND_ENDPOINT,
  BULKSMS_NG_TOKEN_ENV,
  BULKSMS_NG_WEBHOOK_SECRET_ENV,
  BULKSMS_NG_WEBHOOK_URL_ENV,
  bulkSmsCallbackUrl,
  bulkSmsNigeriaConfigFromEnv,
  createBulkSmsNigeriaGateway,
  mapBulkSmsDeliveryStatus,
  missingBulkSmsNigeriaEnvVars,
  normalizeSmsRecipient,
  signBulkSmsCallback,
  verifyBulkSmsCallback,
} from "../../../frontend/src/lib/communications/bulksms-nigeria.server";
import { SMS_PROVIDER_ENV } from "../../../frontend/src/lib/communications/sms-gateway-contract";
import { selectSmsGateway } from "../../../frontend/src/lib/communications/sms-gateway.server";

const TOKEN = "unit-token-sentinel";
const SECRET = "unit-webhook-secret-sentinel";
const MSG = "00000000-0000-4000-8000-0000000a0001";
const ENV = {
  [BULKSMS_NG_TOKEN_ENV]: TOKEN,
  [BULKSMS_NG_SENDER_ENV]: "Sherivs",
  [BULKSMS_NG_WEBHOOK_SECRET_ENV]: SECRET,
  [BULKSMS_NG_WEBHOOK_URL_ENV]: "https://app.example.test/api/public/webhooks/bulksms",
};

const ok = (id: string | number = "bsng-1") =>
  new Response(
    JSON.stringify({ status: "success", code: "BSNG-0000", data: { message_id: id, cost: 6.49 } }),
    { status: 200 },
  );
const failure = (status: number, code = "BSNG-2013") =>
  new Response(JSON.stringify({ status: "error", error: { code, message: "no" } }), { status });
const command = { messageId: MSG, recipient: "2348031234567", body: "Hello from the school" };

function gateway(fetchImpl: typeof fetch, env: Record<string, string> = ENV) {
  const config = bulkSmsNigeriaConfigFromEnv(env);
  return createBulkSmsNigeriaGateway(config, fetchImpl);
}

describe("configuration (fail closed)", () => {
  it("returns null and names only variables when a credential is absent", () => {
    expect(bulkSmsNigeriaConfigFromEnv({})).toBeNull();
    expect(missingBulkSmsNigeriaEnvVars({ [BULKSMS_NG_TOKEN_ENV]: TOKEN })).toEqual([
      BULKSMS_NG_SENDER_ENV,
    ]);
    expect(bulkSmsNigeriaConfigFromEnv({ ...ENV, [BULKSMS_NG_TOKEN_ENV]: "  " })).toBeNull();
  });

  it("rejects a sender id outside the documented 11-character bound", () => {
    expect(
      bulkSmsNigeriaConfigFromEnv({ ...ENV, [BULKSMS_NG_SENDER_ENV]: "TooLongSender" }),
    ).toBeNull();
  });

  it("enables callbacks only with an https base URL and a secret together", () => {
    expect(bulkSmsNigeriaConfigFromEnv(ENV)?.webhook).not.toBeNull();
    const noSecret = { ...ENV, [BULKSMS_NG_WEBHOOK_SECRET_ENV]: "" };
    expect(bulkSmsNigeriaConfigFromEnv(noSecret)?.webhook).toBeNull();
    const http = { ...ENV, [BULKSMS_NG_WEBHOOK_URL_ENV]: "http://app.example.test/x" };
    expect(bulkSmsNigeriaConfigFromEnv(http)?.webhook).toBeNull();
    const withQuery = { ...ENV, [BULKSMS_NG_WEBHOOK_URL_ENV]: "https://app.example.test/x?a=1" };
    expect(bulkSmsNigeriaConfigFromEnv(withQuery)?.webhook).toBeNull();
  });
});

describe("gateway send", () => {
  it("makes no provider call without credentials", async () => {
    const f = vi.fn();
    const result = await createBulkSmsNigeriaGateway(null, f as unknown as typeof fetch).send(
      command,
    );
    expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
    expect(f).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("posts the documented v2 body with a Bearer token and a per-message callback", async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok("bsng-77"));
    const result = await gateway(f as unknown as typeof fetch).send(command);
    expect(result).toMatchObject({ outcome: "sent", providerMessageId: "bsng-77" });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(BULKSMS_NG_SEND_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: "Sherivs", to: "2348031234567", body: command.body });
    expect(body.unicode).toBeUndefined();
    const callback = new URL(body.callback_url);
    expect(callback.searchParams.get("ref")).toBe(MSG);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(
      verifyBulkSmsCallback({
        secret: SECRET,
        messageId: MSG,
        signature: callback.searchParams.get("sig"),
      }),
    ).toBe(true);
  });

  it("omits the callback when none is configured and flags non-ASCII bodies as unicode", async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok(42));
    const bare = { [BULKSMS_NG_TOKEN_ENV]: TOKEN, [BULKSMS_NG_SENDER_ENV]: "Sherivs" };
    const result = await gateway(f as unknown as typeof fetch, bare).send({
      ...command,
      body: "Ẹ káàbọ̀ sí ilé-ẹ̀kọ́",
    });
    expect(result).toMatchObject({ outcome: "sent", providerMessageId: "42" });
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.unicode).toBe(true);
    expect(body.callback_url).toBeUndefined();
  });

  it("rejects a malformed recipient or oversized body locally with no provider call", async () => {
    const f = vi.fn();
    const g = gateway(f as unknown as typeof fetch);
    expect(await g.send({ ...command, recipient: "+2348031234567" })).toMatchObject({
      outcome: "failed",
      code: "invalid_payload",
      retryable: false,
    });
    expect(await g.send({ ...command, recipient: "12345" })).toMatchObject({
      code: "invalid_payload",
    });
    expect(await g.send({ ...command, body: "x".repeat(1_531) })).toMatchObject({
      code: "invalid_payload",
    });
    expect(await g.send({ ...command, body: "" })).toMatchObject({ code: "invalid_payload" });
    expect(f).not.toHaveBeenCalled();
  });

  it("fails closed on invalid credentials without retry and without leaking the token", async () => {
    const f = vi.fn(async () => failure(401, "BSNG-1001"));
    const result = await gateway(f as unknown as typeof fetch).send(command);
    expect(result).toMatchObject({
      outcome: "failed",
      code: "provider_auth_failed",
      retryable: false,
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("classifies provider refusals for at-most-once delivery", async () => {
    const g = (status: number, code?: string) =>
      gateway((async () => failure(status, code)) as unknown as typeof fetch).send(command);
    expect(await g(409, "BSNG-2012")).toMatchObject({
      code: "provider_duplicate",
      retryable: false,
    });
    expect(await g(422, "BSNG-2002")).toMatchObject({
      code: "provider_rejected",
      retryable: false,
    });
    expect(await g(429)).toMatchObject({ code: "provider_rejected", retryable: true });
    expect(await g(503)).toMatchObject({ code: "provider_error", retryable: true });
    // Ambiguous: the provider may have processed these, so they are never retried.
    expect(await g(500)).toMatchObject({ code: "provider_error", retryable: false });
    expect(await g(502)).toMatchObject({ code: "provider_error", retryable: false });
    expect(await g(408)).toMatchObject({ retryable: false });
  });

  it("retries a transport failure only when the request never left Sherivs", async () => {
    const dns = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    const never = await gateway((async () => {
      throw dns;
    }) as unknown as typeof fetch).send(command);
    expect(never).toMatchObject({ code: "provider_unreachable", retryable: true });
    const unknown = await gateway((async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch).send(command);
    expect(unknown).toMatchObject({ code: "provider_unreachable", retryable: false });
  });

  it("never fabricates a receipt from a malformed provider answer", async () => {
    for (const response of [
      new Response("not json", { status: 200 }),
      new Response(JSON.stringify({ status: "success", data: {} }), { status: 200 }),
      new Response(JSON.stringify({ status: "error", data: { message_id: "x" } }), { status: 200 }),
    ]) {
      const result = await gateway((async () => response) as unknown as typeof fetch).send(command);
      expect(result).toMatchObject({
        outcome: "failed",
        code: "provider_response_invalid",
        retryable: false,
      });
    }
  });
});

describe("recipient normalisation", () => {
  it("accepts international digits and converts Nigerian local form", () => {
    expect(normalizeSmsRecipient("+234 803 123 4567")).toBe("2348031234567");
    expect(normalizeSmsRecipient("08031234567")).toBe("2348031234567");
    expect(normalizeSmsRecipient("002348031234567")).toBe("2348031234567");
    expect(normalizeSmsRecipient("2348031234567")).toBe("2348031234567");
  });

  it("refuses anything that cannot be made a valid international number", () => {
    for (const raw of ["", "12345", "abc", "0803", "1".repeat(16)]) {
      expect(normalizeSmsRecipient(raw)).toBeNull();
    }
  });
});

describe("callback token", () => {
  it("verifies only the exact message it was minted for", () => {
    const sig = signBulkSmsCallback(SECRET, MSG);
    expect(verifyBulkSmsCallback({ secret: SECRET, messageId: MSG, signature: sig })).toBe(true);
    expect(
      verifyBulkSmsCallback({
        secret: SECRET,
        messageId: "00000000-0000-4000-8000-0000000b0001",
        signature: sig,
      }),
    ).toBe(false);
    expect(verifyBulkSmsCallback({ secret: "other", messageId: MSG, signature: sig })).toBe(false);
    expect(verifyBulkSmsCallback({ secret: SECRET, messageId: MSG, signature: `${sig}x` })).toBe(
      false,
    );
  });

  it("fails closed when any input is missing", () => {
    const sig = signBulkSmsCallback(SECRET, MSG);
    expect(verifyBulkSmsCallback({ secret: undefined, messageId: MSG, signature: sig })).toBe(
      false,
    );
    expect(verifyBulkSmsCallback({ secret: SECRET, messageId: null, signature: sig })).toBe(false);
    expect(verifyBulkSmsCallback({ secret: SECRET, messageId: MSG, signature: null })).toBe(false);
  });

  it("builds a callback URL that carries only the ref and the per-message token", () => {
    const url = new URL(
      bulkSmsCallbackUrl({ baseUrl: ENV[BULKSMS_NG_WEBHOOK_URL_ENV], secret: SECRET }, MSG),
    );
    expect([...url.searchParams.keys()].sort()).toEqual(["ref", "sig"]);
    expect(url.toString()).not.toContain(SECRET);
  });

  it("preserves a query string already on the configured webhook URL and never lets it forge ref/sig", () => {
    const url = new URL(
      bulkSmsCallbackUrl(
        {
          baseUrl:
            "https://app.example.test/api/public/webhooks/bulksms?env=prod&ref=forged&sig=forged",
          secret: SECRET,
        },
        MSG,
      ),
    );
    expect(url.searchParams.get("env")).toBe("prod");
    expect(url.searchParams.getAll("ref")).toEqual([MSG]);
    expect(url.searchParams.getAll("sig")).toHaveLength(1);
    expect(
      verifyBulkSmsCallback({
        secret: SECRET,
        messageId: MSG,
        signature: url.searchParams.get("sig"),
      }),
    ).toBe(true);
  });
});

describe("delivery status mapping", () => {
  it("treats only the documented success values as delivered and unknown values as failed", () => {
    for (const s of ["delivrd", "DELIVERED", " success "]) {
      expect(mapBulkSmsDeliveryStatus(s)).toEqual({ outcome: "delivered", code: null });
    }
    expect(mapBulkSmsDeliveryStatus("sent awaiting status").outcome).toBe("pending");
    expect(mapBulkSmsDeliveryStatus("undeliv")).toEqual({ outcome: "failed", code: "dlr_undeliv" });
    expect(mapBulkSmsDeliveryStatus("Brand New Status!")).toEqual({
      outcome: "failed",
      code: "dlr_brand_new_status",
    });
  });
});

describe("provider selection", () => {
  it("refuses an unset, unsupported or unconfigured provider and never builds a gateway", () => {
    expect(selectSmsGateway({})).toMatchObject({ ok: false, code: "provider_not_selected" });
    expect(selectSmsGateway({ ...ENV, [SMS_PROVIDER_ENV]: "bulksms" })).toMatchObject({
      ok: false,
      code: "unsupported_provider",
    });
    expect(selectSmsGateway({ [SMS_PROVIDER_ENV]: "bulksmsnigeria" })).toMatchObject({
      ok: false,
      code: "provider_not_configured",
    });
  });

  it("selects BulkSMS Nigeria when explicitly named and fully configured", () => {
    const selection = selectSmsGateway({ ...ENV, [SMS_PROVIDER_ENV]: " BulkSMSNigeria " });
    expect(selection.ok).toBe(true);
    if (selection.ok) expect(selection.gateway.providerId).toBe("bulksmsnigeria");
  });
});
