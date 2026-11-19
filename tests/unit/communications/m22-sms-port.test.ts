/**
 * M22 (ADR-120): ONE SMS provider port. BulkSMS.com is now an adapter behind the same port as BulkSMS
 * Nigeria, chosen only by SMS_PROVIDER; the owner-alert sender no longer has its own SMS sender.
 * No provider keys: every credential below is a runtime-built sentinel and fetch is mocked.
 */
import { describe, expect, it, vi } from "vitest";
import {
  BULKSMS_COM_SEND_ENDPOINT,
  bulkSmsComConfigFromEnv,
  createBulkSmsComGateway,
} from "../../../frontend/src/lib/communications/bulksms-com.server";
import {
  BULKSMS_NG_SENDER_ENV,
  BULKSMS_NG_TOKEN_ENV,
  BULKSMS_NG_WEBHOOK_SECRET_ENV,
  BULKSMS_NG_WEBHOOK_URL_ENV,
} from "../../../frontend/src/lib/communications/bulksms-nigeria.server";
import {
  SUPPORTED_SMS_PROVIDERS,
  selectSmsGateway,
} from "../../../frontend/src/lib/communications/sms-gateway.server";

const ID = ["tok", "id", "sentinel"].join("-");
const SECRET = ["tok", "secret", "sentinel"].join("-");
const COM_ENV = { SMS_PROVIDER: "bulksmscom", BULKSMS_TOKEN_ID: ID, BULKSMS_TOKEN_SECRET: SECRET };
const CMD = { messageId: "alert-1:sms:1", recipient: "+2348031234567", body: "[S1] hello" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("SMS provider selection (one port, two adapters)", () => {
  it("offers exactly BulkSMS Nigeria and BulkSMS.com", () => {
    expect([...SUPPORTED_SMS_PROVIDERS]).toEqual(["bulksmsnigeria", "bulksmscom"]);
  });
  it("selects BulkSMS.com only when named and configured", () => {
    const s = selectSmsGateway(COM_ENV, vi.fn() as never);
    expect(s.ok && s.gateway.providerId).toBe("bulksmscom");
    expect(selectSmsGateway({ SMS_PROVIDER: "bulksmscom" })).toMatchObject({
      ok: false,
      code: "provider_not_configured",
    });
  });
  it("refuses the ambiguous name 'bulksms' and an unset provider even when keys exist", () => {
    expect(selectSmsGateway({ ...COM_ENV, SMS_PROVIDER: "bulksms" })).toMatchObject({
      ok: false,
      code: "unsupported_provider",
    });
    const { SMS_PROVIDER: _unset, ...noProvider } = COM_ENV;
    expect(selectSmsGateway(noProvider)).toMatchObject({
      ok: false,
      code: "provider_not_selected",
    });
  });
});

describe("BulkSMS.com adapter", () => {
  it("fails closed with no network call when unconfigured", async () => {
    const f = vi.fn();
    const r = await createBulkSmsComGateway(bulkSmsComConfigFromEnv({}), f as never).send(CMD);
    expect(r).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
    expect(f).not.toHaveBeenCalled();
  });

  it("sends one Basic-auth request to the fixed endpoint and returns the provider id", async () => {
    const f = vi.fn(async () => json([{ id: "bs-1" }], 201));
    const r = await createBulkSmsComGateway(bulkSmsComConfigFromEnv(COM_ENV), f as never).send(CMD);
    expect(r).toMatchObject({ outcome: "sent", providerMessageId: "bs-1" });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(BULKSMS_COM_SEND_ENDPOINT);
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(JSON.parse(String(init.body))).toEqual({ to: "+2348031234567", body: "[S1] hello" });
  });

  it.each([
    [401, "provider_auth_failed", false],
    [429, "provider_rejected", true],
    [503, "provider_error", true],
    [500, "provider_error", false],
    [400, "provider_rejected", false],
  ])(
    "classifies HTTP %i as %s (retryable=%s) and never echoes secrets",
    async (status, code, retryable) => {
      const f = vi.fn(async () => json({ detail: "x" }, status));
      const r = await createBulkSmsComGateway(bulkSmsComConfigFromEnv(COM_ENV), f as never).send(
        CMD,
      );
      expect(r).toMatchObject({ outcome: "failed", code, retryable });
      expect(JSON.stringify(r)).not.toContain(SECRET);
      expect(JSON.stringify(r)).not.toContain(ID);
    },
  );

  it("does not assert a send when the provider answers without an id", async () => {
    const f = vi.fn(async () => json({ ok: true }));
    const r = await createBulkSmsComGateway(bulkSmsComConfigFromEnv(COM_ENV), f as never).send(CMD);
    expect(r).toMatchObject({
      outcome: "failed",
      code: "provider_response_invalid",
      retryable: false,
    });
  });

  it("treats a timeout after the request left as ambiguous (not retryable)", async () => {
    const f = vi.fn(async () => {
      throw new Error("aborted");
    });
    const r = await createBulkSmsComGateway(bulkSmsComConfigFromEnv(COM_ENV), f as never).send(CMD);
    expect(r).toMatchObject({ outcome: "failed", code: "provider_unreachable", retryable: false });
  });
});

describe("BulkSMS Nigeria: a message without an outbound row asks for no delivery callback", () => {
  it("omits callback_url when deliveryReport is false", async () => {
    const env = {
      SMS_PROVIDER: "bulksmsnigeria",
      [BULKSMS_NG_TOKEN_ENV]: ["ng", "token", "sentinel"].join("-"),
      [BULKSMS_NG_SENDER_ENV]: "Sherivs",
      [BULKSMS_NG_WEBHOOK_SECRET_ENV]: ["ng", "hook", "sentinel"].join("-"),
      [BULKSMS_NG_WEBHOOK_URL_ENV]: "https://app.example.test/api/public/webhooks/bulksms",
    };
    const f = vi.fn(async () => json({ status: "success", data: { message_id: "n1" } }));
    const s = selectSmsGateway(env, f as never);
    if (!s.ok) throw new Error("selection failed");
    await s.gateway.send({ ...CMD, recipient: "2348031234567", deliveryReport: false });
    await s.gateway.send({
      ...CMD,
      recipient: "2348031234567",
      messageId: "00000000-0000-4000-8000-000000000001",
    });
    const bodies = f.mock.calls.map((c) =>
      JSON.parse(String((c as unknown as [string, RequestInit])[1].body)),
    );
    expect(bodies[0].callback_url).toBeUndefined();
    expect(bodies[1].callback_url).toContain("sig=");
  });
});
