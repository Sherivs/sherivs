import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "../../../frontend/src/routes/api/public/webhooks/whatsapp";
import {
  normalizeWhatsAppPhone,
  verifyWhatsAppWebhookSignature,
  WhatsAppInboundMessageSchema,
  WhatsAppStatusSchema,
  WhatsAppWebhookSchema,
} from "../../../frontend/src/routes/api/public/webhooks/whatsapp";

const { mockRpc, mockSend } = vi.hoisted(() => ({ mockRpc: vi.fn(), mockSend: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));
vi.mock("@/lib/communications/whatsapp-cloud.server", () => ({
  sendWhatsAppMessage: mockSend,
}));

const SECRET = "whatsapp-app-secret-fixture";
const ORIGINAL_APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const ORIGINAL_AUTO_ACK_TEXT = process.env.WHATSAPP_AUTO_ACK_TEXT;
const MESSAGE_TIMESTAMP = String(Math.floor(Date.now() / 1000));
const messagePayload = {
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { display_phone_number: "+2349015056201", phone_number_id: "123456" },
            messages: [
              {
                id: "wamid.inbound",
                from: "2349015056202",
                timestamp: MESSAGE_TIMESTAMP,
                text: { body: "STOP" },
              },
            ],
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
  if (ORIGINAL_AUTO_ACK_TEXT === undefined) delete process.env.WHATSAPP_AUTO_ACK_TEXT;
  else process.env.WHATSAPP_AUTO_ACK_TEXT = ORIGINAL_AUTO_ACK_TEXT;
  mockRpc.mockReset();
  mockSend.mockReset();
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
    const invalidStatus = {
      entry: [
        {
          changes: [{ value: { statuses: [{ id: "wamid.outbound", status: "unknown" }] } }],
        },
      ],
    };
    expect(WhatsAppWebhookSchema.safeParse(invalidStatus).success).toBe(true);
    expect(
      WhatsAppStatusSchema.safeParse(invalidStatus.entry[0]?.changes[0]?.value.statuses[0]).success,
    ).toBe(false);
    expect(
      WhatsAppInboundMessageSchema.safeParse({ id: "wamid.bad", from: "invalid" }).success,
    ).toBe(false);
  });

  it("normalizes E.164 senders without accepting malformed numbers", () => {
    expect(normalizeWhatsAppPhone("234 901 505 6202")).toBe("+2349015056202");
    expect(normalizeWhatsAppPhone("+2349015056202")).toBe("+2349015056202");
    expect(normalizeWhatsAppPhone("09015056202")).toBe("+2349015056202");
    expect(normalizeWhatsAppPhone("+09015056202")).toBe("+2349015056202");
    expect(
      WhatsAppInboundMessageSchema.safeParse({ id: "wamid.local", from: "09015056202" }).success,
    ).toBe(true);
    expect(normalizeWhatsAppPhone("abc")).toBeNull();
    expect(normalizeWhatsAppPhone("123")).toBeNull();
  });

  it("routes callbacks through the registered tenant sender and persists inbound/status events", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    mockRpc.mockImplementation(async (name: string) => {
      if (name === "cg_whatsapp_status") return { data: true, error: null };
      if (name === "cg_whatsapp_receive") return { data: "opted_out", error: null };
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
                messages: [
                  {
                    id: "wamid.inbound",
                    from: "2349015056202",
                    timestamp: MESSAGE_TIMESTAMP,
                    text: { body: "STOP" },
                  },
                ],
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
      p_provider_timestamp: new Date(Number(MESSAGE_TIMESTAMP) * 1000).toISOString(),
    });
    expect(mockRpc.mock.calls[0]?.[1]).not.toHaveProperty("p_org_id");
    expect(mockRpc.mock.calls[0]?.[1]).not.toHaveProperty("p_tenant_id");
    expect(mockRpc).toHaveBeenNthCalledWith(2, "cg_whatsapp_status", {
      p_provider_sender_ref: "123456",
      p_provider_ref: "wamid.outbound",
      p_status: "read",
      p_error_code: null,
    });
    expect(mockRpc).not.toHaveBeenCalledWith("cg_whatsapp_prepare_auto_ack", expect.anything());
    expect(mockSend).not.toHaveBeenCalled();
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

  it("returns 200 for a durable dead letter and does not leak RPC error text", async () => {
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
    mockRpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "P0001", message: "secret detail" },
      })
      .mockResolvedValueOnce({ data: true, error: null });
    const failed = await send();
    expect(failed.status).toBe(200);
    expect(await failed.text()).toBe("ok");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret detail");
    expect(JSON.stringify(spy.mock.calls)).toContain("P0001");
    spy.mockRestore();
  });

  it("returns 500 only when a failed message cannot be durably dead-lettered", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "private detail" } })
      .mockResolvedValueOnce({ data: null, error: { code: "08006", message: "private detail" } });
    const raw = JSON.stringify(messagePayload);
    const response = await postWebhook({
      request: new Request("https://app.example.test/api/public/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": signature(raw) },
        body: raw,
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("processing error");
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain("private detail");
  });

  it("isolates malformed messages, dead-letters them, and continues the batch", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    mockRpc.mockImplementation(async (name: string) => {
      if (name === "cg_whatsapp_receive") return { data: "opted_out", error: null };
      if (name === "cg_whatsapp_dead_letter") return { data: true, error: null };
      return { data: true, error: null };
    });
    const raw = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123456" },
                messages: [
                  { id: "wamid.bad", from: "invalid" },
                  { id: "wamid.good", from: "2349015056202", text: { body: "STOP" } },
                ],
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
    expect(mockRpc).toHaveBeenCalledWith("cg_whatsapp_dead_letter", {
      p_provider_sender_ref: "123456",
      p_provider_ref: "wamid.bad",
      p_event_type: "message",
      p_error_code: "invalid_message",
    });
    expect(mockRpc).toHaveBeenCalledWith("cg_whatsapp_receive", {
      p_provider_sender_ref: "123456",
      p_from: "+2349015056202",
      p_body: "STOP",
      p_provider_ref: "wamid.good",
      p_provider_timestamp: null,
    });
  });

  it("dispatches at most one auto-ack after a newly stored, opted-in inbound message", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    process.env.WHATSAPP_AUTO_ACK_TEXT = "Thanks, we received your message.";
    mockRpc.mockImplementation(async (name: string) => {
      if (name === "cg_whatsapp_receive") return { data: "logged", error: null };
      if (name === "cg_whatsapp_prepare_auto_ack") {
        return {
          data: [
            {
              tenant_id: "tenant-a",
              org_ref: "org-a",
              principal_ref: "principal-a",
              provider_sender_ref: "123456",
              conversation_id: "00000000-0000-4000-8000-000000000001",
              recipient_address: "+2349015056202",
            },
          ],
          error: null,
        };
      }
      if (name === "cg_whatsapp_auto_ack_result") return { data: true, error: null };
      return { data: true, error: null };
    });
    mockSend.mockResolvedValue({ ok: true, providerRef: "wamid.ack" });
    const raw = JSON.stringify(messagePayload);
    const response = await postWebhook({
      request: new Request("https://app.example.test/api/public/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": signature(raw) },
        body: raw,
      }),
    });

    expect(response.status).toBe(200);
    expect(mockSend).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      orgRef: "org-a",
      principalRef: "principal-a",
      conversationId: "00000000-0000-4000-8000-000000000001",
      inboundProviderSenderRef: "123456",
      inboundProviderRef: "wamid.inbound",
      expectedRecipientAddress: "+2349015056202",
      body: "Thanks, we received your message.",
      retryTransient: false,
    });
    expect(mockRpc).toHaveBeenCalledWith("cg_whatsapp_prepare_auto_ack", {
      p_provider_sender_ref: "123456",
      p_inbound_provider_ref: "wamid.inbound",
      p_body: "Thanks, we received your message.",
    });
    expect(mockRpc).toHaveBeenCalledWith("cg_whatsapp_auto_ack_result", {
      p_provider_sender_ref: "123456",
      p_inbound_provider_ref: "wamid.inbound",
      p_status: "sent",
      p_error_code: null,
    });
  });

  it("does not prepare an auto-ack for duplicates or STOP", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    mockRpc.mockResolvedValue({ data: "duplicate", error: null });
    const raw = JSON.stringify(messagePayload);
    const response = await postWebhook({
      request: new Request("https://app.example.test/api/public/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": signature(raw) },
        body: raw,
      }),
    });

    expect(response.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalledWith("cg_whatsapp_prepare_auto_ack", expect.anything());
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("stores non-text inbound messages as typed placeholders without media access", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    mockRpc.mockImplementation(async (name: string) => {
      if (name === "cg_whatsapp_receive") return { data: "opted_out", error: null };
      return { data: true, error: null };
    });
    const raw = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123456" },
                messages: [
                  {
                    id: "wamid.image",
                    from: "2349015056202",
                    type: "image",
                    image: { id: "media-secret-fixture" },
                  },
                ],
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
    expect(mockRpc).toHaveBeenCalledWith("cg_whatsapp_receive", {
      p_provider_sender_ref: "123456",
      p_from: "+2349015056202",
      p_body: "[image message]",
      p_provider_ref: "wamid.image",
      p_provider_timestamp: null,
    });
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain("media-secret-fixture");
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
