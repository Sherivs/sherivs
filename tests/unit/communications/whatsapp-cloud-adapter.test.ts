import { describe, expect, it, vi } from "vitest";
import { WhatsAppCloudAdapter } from "../../../frontend/src/lib/communications/whatsapp-cloud.server";

const TOKEN = "whatsapp-test-token";
const PHONE_ID = "123456789012345";
const receipt = () =>
  new Response(JSON.stringify({ messages: [{ id: "wamid.test-message" }] }), { status: 200 });

describe("WhatsApp Cloud adapter", () => {
  it("sends a bounded text message using the Cloud API and minimizes its receipt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(receipt());
    const adapter = new WhatsAppCloudAdapter(TOKEN, PHONE_ID, fetchImpl, vi.fn());

    await expect(adapter.send("+2349015056201", "Hello")).resolves.toEqual({
      ok: true,
      providerRef: "wamid.test-message",
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer " + TOKEN);
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: "whatsapp",
      to: "2349015056201",
      type: "text",
      text: { body: "Hello", preview_url: false },
    });
  });

  it("sends approved templates with language and text parameters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(receipt());
    const adapter = new WhatsAppCloudAdapter(TOKEN, PHONE_ID, fetchImpl, vi.fn());

    await adapter.send("2349015056201", "", {
      template: "fee_reminder_v1",
      language: "en",
      parameters: ["Ada", "NGN 4,000"],
    });

    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      messaging_product: "whatsapp",
      to: "2349015056201",
      type: "template",
      template: {
        name: "fee_reminder_v1",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Ada" },
              { type: "text", text: "NGN 4,000" },
            ],
          },
        ],
      },
    });
  });

  it("uses only the sender reference resolved for the tenant by the shared gateway", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(receipt());
    const adapter = new WhatsAppCloudAdapter(TOKEN, "untrusted-default", fetchImpl, vi.fn());

    await expect(
      adapter.send("+2349015056201", "Hello", { phoneNumberId: "987654321" }),
    ).resolves.toMatchObject({ ok: true });

    expect(fetchImpl.mock.calls[0][0]).toBe("https://graph.facebook.com/v21.0/987654321/messages");
  });

  it("rejects invalid local input without contacting Meta", async () => {
    const fetchImpl = vi.fn();
    const adapter = new WhatsAppCloudAdapter(TOKEN, PHONE_ID, fetchImpl, vi.fn());

    await expect(adapter.send("not-a-number", "Hello")).resolves.toMatchObject({
      ok: false,
      error: "invalid WhatsApp recipient",
    });
    await expect(adapter.send("+2349015056201", "")).resolves.toMatchObject({
      ok: false,
      error: "invalid WhatsApp text body",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries retryable responses with bounded exponential backoff", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(receipt());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const adapter = new WhatsAppCloudAdapter(TOKEN, PHONE_ID, fetchImpl, sleep);

    await expect(adapter.send("2349015056201", "Hello")).resolves.toMatchObject({ ok: true });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
  });

  it("does not retry non-retryable responses or expose provider/credential data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: `${TOKEN} private detail` } }), {
        status: 400,
      }),
    );
    const sleep = vi.fn();
    const adapter = new WhatsAppCloudAdapter(TOKEN, PHONE_ID, fetchImpl, sleep);

    const result = await adapter.send("2349015056201", "Hello");
    expect(result).toEqual({ ok: false, error: "WhatsApp provider returned HTTP 400" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry an ambiguous network failure that could duplicate a non-idempotent send", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(TOKEN));
    const sleep = vi.fn();
    const adapter = new WhatsAppCloudAdapter(TOKEN, PHONE_ID, fetchImpl, sleep);

    const result = await adapter.send("2349015056201", "Hello");
    expect(result).toEqual({ ok: false, error: "WhatsApp provider request failed" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
