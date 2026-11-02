import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchWhatsAppN8nOutbox,
  getN8nWhatsAppConfig,
  N8nWhatsAppReplySchema,
  signN8nWhatsAppPayload,
  verifyN8nWhatsAppSignature,
} from "../../../frontend/src/lib/communications/whatsapp-n8n.server";
import { Route } from "../../../frontend/src/routes/api/public/webhooks/whatsapp-reply";

const { mockRpc, mockSend } = vi.hoisted(() => ({ mockRpc: vi.fn(), mockSend: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));
vi.mock("@/lib/communications/whatsapp-cloud.server", () => ({
  sendWhatsAppMessage: mockSend,
}));

const SECRET = "n8n-signing-secret-fixture-not-a-production-value";
const ORIGINAL_URL = process.env.N8N_WHATSAPP_WEBHOOK_URL;
const ORIGINAL_SECRET = process.env.N8N_WHATSAPP_SIGNING_SECRET;
const POST_REPLY = (
  Route as unknown as {
    options: { server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } } };
  }
).options.server.handlers.POST;

function signedRequest(body: unknown, now = Date.now()): Request {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(now / 1000));
  return new Request("https://app.example.test/api/public/webhooks/whatsapp-reply", {
    method: "POST",
    headers: {
      "x-sherivs-timestamp": timestamp,
      "x-sherivs-signature": signN8nWhatsAppPayload(timestamp, raw, SECRET),
    },
    body: raw,
  });
}

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.N8N_WHATSAPP_WEBHOOK_URL;
  else process.env.N8N_WHATSAPP_WEBHOOK_URL = ORIGINAL_URL;
  if (ORIGINAL_SECRET === undefined) delete process.env.N8N_WHATSAPP_SIGNING_SECRET;
  else process.env.N8N_WHATSAPP_SIGNING_SECRET = ORIGINAL_SECRET;
  mockRpc.mockReset();
  mockSend.mockReset();
});

describe("WhatsApp n8n forwarding and reply authentication", () => {
  it("accepts only HTTPS AWS endpoints and a strong environment signing secret", () => {
    expect(
      getN8nWhatsAppConfig({
        N8N_WHATSAPP_WEBHOOK_URL: "https://n8n-prod.us-east-1.amazonaws.com/hooks/wa",
        N8N_WHATSAPP_SIGNING_SECRET: SECRET,
      }),
    ).toMatchObject({ webhookUrl: "https://n8n-prod.us-east-1.amazonaws.com/hooks/wa" });
    expect(
      getN8nWhatsAppConfig({
        N8N_WHATSAPP_WEBHOOK_URL: "http://n8n-prod.us-east-1.amazonaws.com/hooks/wa",
        N8N_WHATSAPP_SIGNING_SECRET: SECRET,
      }),
    ).toBeNull();
    expect(
      getN8nWhatsAppConfig({
        N8N_WHATSAPP_WEBHOOK_URL: "https://127.0.0.1/hooks/wa",
        N8N_WHATSAPP_SIGNING_SECRET: SECRET,
      }),
    ).toBeNull();
    expect(
      getN8nWhatsAppConfig({
        N8N_WHATSAPP_WEBHOOK_URL: "https://n8n.example.test/hooks/wa",
        N8N_WHATSAPP_SIGNING_SECRET: SECRET,
      }),
    ).toBeNull();
    expect(
      getN8nWhatsAppConfig({
        N8N_WHATSAPP_WEBHOOK_URL: "https://n8n-prod.amazonaws.com/hooks/wa",
        N8N_WHATSAPP_SIGNING_SECRET: "short",
      }),
    ).toBeNull();
  });

  it("verifies the raw HMAC body and rejects stale, future, or modified requests", () => {
    const now = 1_800_000_000_000;
    const timestamp = String(Math.floor(now / 1000));
    const raw = '{"event":"whatsapp.inbound"}';
    const signature = signN8nWhatsAppPayload(timestamp, raw, SECRET);
    expect(
      verifyN8nWhatsAppSignature({ rawBody: raw, timestamp, signature, secret: SECRET, now }),
    ).toBe(true);
    expect(
      verifyN8nWhatsAppSignature({
        rawBody: raw,
        timestamp: String(Number(timestamp) - 301),
        signature,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
    expect(
      verifyN8nWhatsAppSignature({
        rawBody: `${raw} `,
        timestamp,
        signature,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
    expect(
      verifyN8nWhatsAppSignature({
        rawBody: raw,
        timestamp,
        signature: `sha256=${createHmac("sha256", "wrong").update(`${timestamp}.${raw}`).digest("hex")}`,
        secret: SECRET,
        now,
      }),
    ).toBe(false);
  });

  it("signs and durably records a tenant-scoped outbox delivery without exposing secrets", async () => {
    process.env.N8N_WHATSAPP_WEBHOOK_URL = "https://n8n-prod.amazonaws.com/hooks/wa";
    process.env.N8N_WHATSAPP_SIGNING_SECRET = SECRET;
    const now = 1_800_000_000_000;
    const payload = {
      event_id: "00000000-0000-4000-8000-000000000001",
      provider_message_id: "wamid.inbound",
      event_type: "whatsapp.inbound",
      tenant_id: "tenant-a",
      org_ref: "org-a",
      conversation_id: "00000000-0000-4000-8000-000000000002",
      recipient_hash: "a".repeat(64),
      received_at: new Date(now).toISOString(),
      body: "hello",
    };
    const row = {
      outbox_id: "00000000-0000-4000-8000-000000000003",
      tenant_id: "tenant-a",
      org_ref: "org-a",
      conversation_id: payload.conversation_id,
      message_id: payload.event_id,
      provider_ref: payload.provider_message_id,
      payload,
      attempt_count: 1,
      claim_token: "00000000-0000-4000-8000-000000000004",
    };
    mockRpc
      .mockResolvedValueOnce({ data: [row], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    await expect(
      dispatchWhatsAppN8nOutbox({
        db: { rpc: mockRpc },
        fetchImpl,
        now: () => now,
      }),
    ).resolves.toEqual({ ok: true, delivered: 1, failed: 0 });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://n8n-prod.amazonaws.com/hooks/wa");
    const headers = new Headers(init.headers);
    const raw = String(init.body);
    expect(
      verifyN8nWhatsAppSignature({
        rawBody: raw,
        timestamp: headers.get("x-sherivs-timestamp"),
        signature: headers.get("x-sherivs-signature"),
        secret: SECRET,
        now,
      }),
    ).toBe(true);
    expect(raw).toContain('"tenant_id":"tenant-a"');
    expect(raw).not.toContain(SECRET);
    expect(mockRpc).toHaveBeenLastCalledWith("cg_whatsapp_complete_n8n_outbox", {
      p_outbox_id: row.outbox_id,
      p_claim_token: row.claim_token,
      p_success: true,
      p_error_code: null,
    });
  });

  it("rejects tenant overrides in n8n replies and only sends a server-resolved target", async () => {
    process.env.N8N_WHATSAPP_SIGNING_SECRET = SECRET;
    const reply = {
      reply_id: "automation-reply-1",
      inbound_provider_ref: "wamid.inbound",
      conversation_id: "00000000-0000-4000-8000-000000000002",
      body: "Thanks",
    };
    mockRpc
      .mockResolvedValueOnce({
        data: [
          {
            tenant_id: "tenant-a",
            org_ref: "org-a",
            principal_ref: "principal-a",
            provider_sender_ref: "123456",
            conversation_id: reply.conversation_id,
            recipient_address: "+2349015056201",
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    mockSend.mockResolvedValue({ ok: true, providerRef: "wamid.outbound" });

    const response = await POST_REPLY({ request: signedRequest(reply) });
    expect(response.status).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        orgRef: "org-a",
        principalRef: "principal-a",
        inboundProviderSenderRef: "123456",
        expectedRecipientAddress: "+2349015056201",
        conversationId: reply.conversation_id,
        inboundProviderRef: "wamid.inbound",
        body: "Thanks",
      }),
    );
    expect(mockRpc).toHaveBeenLastCalledWith("cg_whatsapp_n8n_reply_result", {
      p_tenant_id: "tenant-a",
      p_reply_id: reply.reply_id,
      p_inbound_provider_ref: reply.inbound_provider_ref,
      p_conversation_id: reply.conversation_id,
      p_status: "sent",
    });

    const withTenant = signedRequest({ ...reply, tenant_id: "tenant-b" });
    expect((await POST_REPLY({ request: withTenant })).status).toBe(400);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(
      N8nWhatsAppReplySchema.safeParse({ ...reply, org_ref: "org-b" }).success,
    ).toBe(false);
  });
});
