import { answerOwnerAlertCallback } from "@/lib/jarvis-bridge/owner-alert-voice.server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOwnerAlertSender,
  ownerContactsFromEnv,
  voiceScript,
} from "../../frontend/src/lib/jarvis-bridge/owner-alert-sender.server";
import type { SendRequest } from "../../frontend/src/lib/jarvis-bridge/owner-alert-tick";

const PHONE = "+2348012345678";
const WA = "+2348099999999";
const MAIL = "owner@example.com";

const req = (channel: SendRequest["channel"], over: Partial<SendRequest> = {}): SendRequest => ({
  channel,
  severity: "S1",
  body: "[S1] Deploy failed Review in console: https://console.sherivs.com/console/alerts?ref=incident%3A1",
  link: "https://console.sherivs.com/console/alerts?ref=incident%3A1",
  idempotencyKey: "alert-1:sms:12345",
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("owner contacts", () => {
  it("accepts only well-formed destinations and treats anything else as absent", () => {
    expect(
      ownerContactsFromEnv({
        OWNER_ALERT_EMAIL: MAIL,
        OWNER_ALERT_PHONE: PHONE,
        OWNER_ALERT_WHATSAPP: WA,
      }),
    ).toEqual({ email: MAIL, phone: PHONE, whatsapp: WA });
    expect(
      ownerContactsFromEnv({
        OWNER_ALERT_EMAIL: "not an email",
        OWNER_ALERT_PHONE: "08012345678",
        OWNER_ALERT_WHATSAPP: "  ",
      }),
    ).toEqual({ email: null, phone: null, whatsapp: null });
  });
});

describe("owner-alert sender is dormant until destination AND provider secrets exist", () => {
  it("makes no network call and reports a code when nothing is configured", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const send = createOwnerAlertSender({ env: {}, fetcher: fetcher as never });
    for (const channel of ["email", "whatsapp", "sms", "voice"] as const) {
      expect(await send(req(channel))).toEqual({ ok: false, code: "contact_not_configured" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("makes no network call when the destination exists but the provider has no secrets", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const env = {
      OWNER_ALERT_EMAIL: MAIL,
      OWNER_ALERT_PHONE: PHONE,
      OWNER_ALERT_WHATSAPP: WA,
      OWNER_ALERT_WHATSAPP_TEMPLATE: "owner_alert",
    };
    const send = createOwnerAlertSender({ env, fetcher: fetcher as never });
    const results = await Promise.all(
      (["email", "whatsapp", "sms", "voice"] as const).map((c) => send(req(c))),
    );
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results.map((r) => (r.ok ? "" : r.code))).toEqual([
      "provider_not_configured",
      "provider_not_configured",
      "provider_not_configured",
      "provider_not_configured",
    ]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(results)).not.toContain(PHONE);
    expect(JSON.stringify(results)).not.toContain(MAIL);
  });

  it("will not send WhatsApp free text: it needs an approved template", async () => {
    const fetcher = vi.fn();
    const send = createOwnerAlertSender({
      env: {
        OWNER_ALERT_WHATSAPP: WA,
        WHATSAPP_TOKEN: "wa-token-value",
        WHATSAPP_PHONE_NUMBER_ID: "1234567890",
      },
      fetcher: fetcher as never,
    });
    expect(await send(req("whatsapp"))).toEqual({ ok: false, code: "template_not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("owner-alert sender when fully configured", () => {
  it("sends SMS through BulkSMS and returns only the provider reference", async () => {
    const fetcher = vi.fn(async () => json([{ id: "bs-0123", type: "SENT" }], 201));
    const send = createOwnerAlertSender({
      env: {
        OWNER_ALERT_PHONE: PHONE,
        BULKSMS_TOKEN_ID: "token-id-value",
        BULKSMS_TOKEN_SECRET: "token-secret-value",
      },
      fetcher: fetcher as never,
    });
    const out = await send(req("sms"));
    expect(out).toEqual({ ok: true, providerRef: "bs-0123" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.bulksms.com/v1/messages");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(JSON.parse(String(init.body)).to).toBe(PHONE);
    expect(JSON.stringify(out)).not.toContain(PHONE);
  });

  it("sends WhatsApp as an approved template, with the body as a single line", async () => {
    const fetcher = vi.fn(async () => json({ messages: [{ id: "wamid.ABC" }] }));
    const send = createOwnerAlertSender({
      env: {
        OWNER_ALERT_WHATSAPP: WA,
        OWNER_ALERT_WHATSAPP_TEMPLATE: "owner_alert",
        WHATSAPP_TOKEN: "wa-token-value",
        WHATSAPP_PHONE_NUMBER_ID: "1234567890",
      },
      fetcher: fetcher as never,
    });
    const out = await send(req("whatsapp", { body: "[S1] Line one\nLine two" }));
    expect(out).toEqual({ ok: true, providerRef: "wamid.ABC" });
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    const payload = JSON.parse(String(init.body));
    expect(payload.type).toBe("template");
    expect(payload.template.name).toBe("owner_alert");
    expect(payload.template.components[0].parameters[0].text).toBe("[S1] Line one Line two");
  });

  it("sends email through Resend with a platform-category notification", async () => {
    const fetcher = vi.fn(async () => json({ id: "re_123" }));
    vi.stubGlobal("fetch", fetcher);
    const send = createOwnerAlertSender({
      env: {
        OWNER_ALERT_EMAIL: MAIL,
        RESEND_API_KEY: "re_key_value",
        RESEND_FROM_ADDRESS: "alerts@sherivs.com",
      },
      fetcher: fetcher as never,
    });
    const out = await send(req("email"));
    expect(out.ok).toBe(true);
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    const payload = JSON.parse(String(init.body));
    expect(payload.to).toBe(MAIL);
    expect(payload.subject).toBe("[S1] Sherivs owner alert");
    expect(JSON.stringify(out)).not.toContain(MAIL);
  });

  it("places a voice call through Africa's Talking with a signed callback and no script in the request", async () => {
    const fetcher = vi.fn(async () =>
      json({ entries: [{ status: "Queued", sessionId: "ATVId_0123" }] }, 201),
    );
    const env = {
      OWNER_ALERT_PHONE: PHONE,
      AT_USERNAME: "sherivs",
      AT_API_KEY: "at-api-key-value",
      AT_VOICE_FROM_NUMBER: "+254711082222",
      AT_VOICE_WEBHOOK_TOKEN: "w".repeat(40),
      OWNER_ALERT_VOICE_CALLBACK_URL:
        "https://console.example.test/api/public/webhooks/owner-alert-voice",
    };
    const send = createOwnerAlertSender({ env, fetcher: fetcher as never });
    const out = await send(req("voice"));
    expect(out).toEqual({ ok: true, providerRef: "ATVId_0123" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://voice.africastalking.com/call");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("to")).toBe(PHONE);
    const callback = new URL(form.get("callbackUrl") ?? "");
    expect(callback.searchParams.get("s")).toBe("S1");
    expect(callback.searchParams.get("token")).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(out)).not.toContain(PHONE);

    // The callback answers only that exact call, and says only the fixed sentence.
    const ok = answerOwnerAlertCallback(new Request(callback, { method: "POST" }), env);
    expect(ok.status).toBe(200);
    const xml = await ok.text();
    expect(xml).toContain("Severity one");
    expect(xml).not.toMatch(/https?:|approve code|token/i);
    const forged = new URL(callback);
    forged.searchParams.set("s", "S2");
    expect(answerOwnerAlertCallback(new Request(forged, { method: "POST" }), env).status).toBe(403);
    expect(answerOwnerAlertCallback(new Request(callback, { method: "GET" }), env).status).toBe(
      403,
    );
    expect(voiceScript("S2")).toContain("Severity two");
  });

  it("returns a code, not the provider's words, when a provider refuses", async () => {
    const fetcher = vi.fn(async () => json({ message: "bad number +2348012345678" }, 400));
    const send = createOwnerAlertSender({
      env: {
        OWNER_ALERT_PHONE: PHONE,
        BULKSMS_TOKEN_ID: "token-id-value",
        BULKSMS_TOKEN_SECRET: "token-secret-value",
      },
      fetcher: fetcher as never,
    });
    const out = await send(req("sms"));
    expect(out).toEqual({ ok: false, code: "provider_error" });
    expect(JSON.stringify(out)).not.toContain(PHONE);
  });
});
