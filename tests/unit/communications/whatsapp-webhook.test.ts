import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "../../../frontend/src/routes/api/public/webhooks/whatsapp";
import {
  normalizeWhatsAppPhone,
  verifyWhatsAppWebhookSignature,
  WhatsAppWebhookSchema,
} from "../../../frontend/src/routes/api/public/webhooks/whatsapp";

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));

const SECRET = "whatsapp-app-secret-fixture";
const ORIGINAL_APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const messagePayload = {
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { display_phone_number: "+2349015056201", phone_number_id: "123456" },
            messages: [{ id: "wamid.inbound", from: "2349015056202", text: { body: "STOP" } }],
          },
        },
      ],
    },
  ],
};

function signature(raw: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
}

type Handler = (input: { request: Request }) => Promise<Response>;
const postWebhook = (
  Route as unknown as {
    options: { server: { handlers: { POST: Handler } } };
  }
).options.server.handlers.POST;

afterEach(() => {
  if (ORIGINAL_APP_SECRET === undefined) delete process.env.WHATSAPP_APP_SECRET;
  else process.env.WHATSAPP_APP_SECRET = ORIGINAL_APP_SECRET;
  mockRpc.mockReset();
});

describe("WhatsApp webhook validation", () => {
  it("accepts only a valid raw-body HMAC-SHA256 signature", () => {
    const raw = JSON.stringify(messagePayload);
    expect(verifyWhatsAppWebhookSignature(raw, signature(raw), SECRET)).toBe(true);
    expect(verifyWhatsAppWebhookSignature(raw, signature(raw), "other-secret")).toBe(false);
    expect(verifyWhatsAppWebhookSignature(raw, null, SECRET)).toBe(false);
    expect(verifyWhatsAppWebhookSignature(raw, "sha256=invalid", SECRET)).toBe(false);
    expect(verifyWhatsAppWebhookSignature(`${raw} `, signature(raw), SECRET)).toBe(false);
  });

  it("validates inbound messages and delivery-status callbacks", () => {
    const statusPayload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { display_phone_number: "+2349015056201", phone_number_id: "123456" },
                statuses: [{ id: "wamid.outbound", status: "read", timestamp: "1793476800" }],
              },
            },
          ],
        },
      ],
    };

    expect(WhatsAppWebhookSchema.safeParse(messagePayload).success).toBe(true);
    expect(WhatsAppWebhookSchema.safeParse(statusPayload).success).toBe(true);
    expect(
      WhatsAppWebhookSchema.safeParse({
        entry: [
          {
            changes: [{ value: { statuses: [{ id: "wamid.outbound", status: "unknown" }] } }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("normalizes E.164 senders without accepting malformed numbers", () => {
    expect(normalizeWhatsAppPhone("234 901 505 6202")).toBe("+2349015056202");
    expect(normalizeWhatsAppPhone("+2349015056202")).toBe("+2349015056202");
    expect(normalizeWhatsAppPhone("abc")).toBeNull();
    expect(normalizeWhatsAppPhone("123")).toBeNull();
  });

  it("routes callbacks through the registered tenant sender and persists inbound/status events", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    mockRpc.mockImplementation(async (name: string) => {
      if (name === "cg_whatsapp_status") return { data: true, error: null };
      return { data: "logged", error: null };
    });
    const raw = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: {
                  display_phone_number: "+19995550123",
                  phone_number_id: "123456",
                  org_id: "org-b-spoof",
                  tenant_id: "tenant-b-spoof",
                },
                messages: [{ id: "wamid.inbound", from: "2349015056202", text: { body: "STOP" } }],
                statuses: [{ id: "wamid.outbound", status: "read" }],
              },
            },
          ],
        },
      ],
    });

    const response = await postWebhook({
      request: new Request("https://app.example.test/api/public/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": signature(raw) },
        body: raw,
      }),
    });

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenNthCalledWith(1, "cg_whatsapp_receive", {
      p_provider_sender_ref: "123456",
      p_from: "+2349015056202",
      p_body: "STOP",
      p_provider_ref: "wamid.inbound",
    });
    expect(mockRpc.mock.calls[0]?.[1]).not.toHaveProperty("p_org_id");
    expect(mockRpc.mock.calls[0]?.[1]).not.toHaveProperty("p_tenant_id");
    expect(mockRpc).toHaveBeenNthCalledWith(2, "cg_whatsapp_status", {
      p_provider_sender_ref: "123456",
      p_provider_ref: "wamid.outbound",
      p_status: "read",
      p_error_code: null,
    });
  });

  it("ignores callbacks without the provider's registered sender reference", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    const raw = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { display_phone_number: "+2349015056201", phone_number_id: "123456" },
                messages: [],
              },
            },
          ],
        },
      ],
    });
    const response = await postWebhook({
      request: new Request("https://app.example.test/api/public/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": signature(raw) },
        body: raw,
      }),
    });
    expect(response.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 200 for an unmapped sender and 500 without leaking error text on RPC failure", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    const raw = JSON.stringify(messagePayload);
    const send = () =>
      postWebhook({
        request: new Request("https://app.example.test/api/public/webhooks/whatsapp", {
          method: "POST",
          headers: { "x-hub-signature-256": signature(raw) },
          body: raw,
        }),
      });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockRpc.mockResolvedValueOnce({ data: "unmapped_sender", error: null });
    expect((await send()).status).toBe(200);
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "secret detail" },
    });
    const failed = await send();
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe("processing error");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret detail");
    expect(JSON.stringify(spy.mock.calls)).toContain("P0001");
    spy.mockRestore();
  });

  it("rejects a bad signature without calling persistence RPCs", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    const raw = JSON.stringify(messagePayload);
    const response = await postWebhook({
      request: new Request("https://app.example.test/api/public/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=" + "0".repeat(64) },
        body: raw,
      }),
    });

    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
