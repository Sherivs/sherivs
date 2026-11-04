import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchWhatsAppN8nOutbox,
  getN8nWhatsAppConfig,
  N8nWhatsAppReplySchema,
  signN8nWhatsAppPayload,
  verifyN8nWhatsAppSignature,
} from "../../../frontend/src/lib/communications/whatsapp-n8n.server";
import { Route } from "../../../frontend/src/routes/api/public/webhooks/whatsapp-reply";
import { Route as ForwardRoute } from "../../../frontend/src/routes/api/public/cron/whatsapp-n8n-forward";

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
const ORIGINAL_ALLOWED_HOSTS = process.env.N8N_WHATSAPP_ALLOWED_HOSTS;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const inboundExport = JSON.parse(
  readFileSync(
    new URL("../../../automation/n8n/sherivs-wa-inbound-handler.json", import.meta.url),
    "utf8",
  ),
) as {
  nodes: { name: string; parameters: { jsCode?: string } }[];
};
const POST_REPLY = (
  Route as unknown as {
    options: { server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } } };
  }
).options.server.handlers.POST;
const POST_FORWARD = (
  ForwardRoute as unknown as {
    options: { server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } } };
  }
).options.server.handlers.POST;
const GET_FORWARD = (
  ForwardRoute as unknown as {
    options: { server: { handlers: { GET: (input: { request: Request }) => Promise<Response> } } };
  }
).options.server.handlers.GET;

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
  if (ORIGINAL_ALLOWED_HOSTS === undefined) delete process.env.N8N_WHATSAPP_ALLOWED_HOSTS;
  else process.env.N8N_WHATSAPP_ALLOWED_HOSTS = ORIGINAL_ALLOWED_HOSTS;
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  mockRpc.mockReset();
  mockSend.mockReset();
});

describe("WhatsApp n8n forwarding and reply authentication", () => {
  it("uses the same timestamp-prefixed HMAC vector as the n8n export", () => {
    const verifierCode = inboundExport.nodes.find(
      (node) => node.name === "Verify signature and inbound shape",
    )?.parameters.jsCode;
    expect(verifierCode).toContain("update(`${timestamp}.${rawBody}`)");

    const timestamp = "1800000000";
    const raw = '{"event_type":"whatsapp.inbound"}';
    const exportSignature = `sha256=${createHmac("sha256", SECRET)
      .update(`${timestamp}.${raw}`)
      .digest("hex")}`;
    expect(exportSignature).toBe(signN8nWhatsAppPayload(timestamp, raw, SECRET));
  });

  it("accepts only HTTPS exact-host allowlist entries and a strong signing secret", () => {
    expect(
      getN8nWhatsAppConfig({
        N8N_WHATSAPP_WEBHOOK_URL: "https://automate.sherivs.com/hooks/wa",
        N8N_WHATSAPP_ALLOWED_HOSTS: " automate.sherivs.com,other.example.test ",
        N8N_WHATSAPP_SIGNING_SECRET: SECRET,
      }),
    ).toMatchObject({ webhookUrl: "https://automate.sherivs.com/hooks/wa" });
    expect(
      getN8nWhatsAppConfig({
        N8N_WHATSAPP_WEBHOOK_URL: "http://automate.sherivs.com/hooks/wa",
        N8N_WHATSAPP_ALLOWED_HOSTS: "automate.sherivs.com",
        N8N_WHATSAPP_SIGNING_SECRET: SECRET,
      }),
    ).toBeNull();
    expect(
      getN8nWhatsAppConfig({
        N8N_WHATSAPP_WEBHOOK_URL: "https://unlisted.sherivs.com/hooks/wa",
        N8N_WHATSAPP_ALLOWED_HOSTS: "automate.sherivs.com",
        N8N_WHATSAPP_SIGNING_SECRET: SECRET,
      }),
    ).toBeNull();
    expect(
      getN8nWhatsAppConfig({
        N8N_WHATSAPP_WEBHOOK_URL: "https://automate.sherivs.com.evil.test/hooks/wa",
        N8N_WHATSAPP_ALLOWED_HOSTS: "automate.sherivs.com",
        N8N_WHATSAPP_SIGNING_SECRET: SECRET,
      }),
    ).toBeNull();
    expect(
      getN8nWhatsAppConfig({
        N8N_WHATSAPP_WEBHOOK_URL: "https://automate.sherivs.com/hooks/wa",
        N8N_WHATSAPP_ALLOWED_HOSTS: "*.sherivs.com",
        N8N_WHATSAPP_SIGNING_SECRET: SECRET,
      }),
    ).toBeNull();
    expect(
      getN8nWhatsAppConfig({
        N8N_WHATSAPP_WEBHOOK_URL: "https://automate.sherivs.com/hooks/wa",
        N8N_WHATSAPP_ALLOWED_HOSTS: "automate.sherivs.com",
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
    process.env.N8N_WHATSAPP_WEBHOOK_URL = "https://automate.sherivs.com/hooks/wa";
    process.env.N8N_WHATSAPP_ALLOWED_HOSTS = "automate.sherivs.com";
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
    expect(url).toBe("https://automate.sherivs.com/hooks/wa");
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

  it("logs only the Postgres error code before returning claim_failed", async () => {
    process.env.N8N_WHATSAPP_WEBHOOK_URL = "https://automate.sherivs.com/hooks/wa";
    process.env.N8N_WHATSAPP_ALLOWED_HOSTS = "automate.sherivs.com";
    process.env.N8N_WHATSAPP_SIGNING_SECRET = SECRET;
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42702", message: 'column reference "attempt_count" is ambiguous' },
    });
    await expect(dispatchWhatsAppN8nOutbox({ db: { rpc: mockRpc } })).resolves.toEqual({
      ok: false,
      error: "claim_failed",
    });
    expect(logSpy).toHaveBeenCalledWith("whatsapp_n8n_claim_failed", { code: "42702" });
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain("ambiguous");
    logSpy.mockRestore();
  });

  it("allows the documented minute scheduler to trigger the bearer-protected outbox endpoint", async () => {
    process.env.CRON_SECRET = "cron-secret-fixture-not-a-production-value";
    process.env.N8N_WHATSAPP_WEBHOOK_URL = "https://automate.sherivs.com/hooks/wa";
    process.env.N8N_WHATSAPP_ALLOWED_HOSTS = "automate.sherivs.com";
    process.env.N8N_WHATSAPP_SIGNING_SECRET = SECRET;
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    const url = "https://www.sherivs.com/api/public/cron/whatsapp-n8n-forward";

    expect(
      (
        await GET_FORWARD({
          request: new Request(url, { method: "GET" }),
        })
      ).status,
    ).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();

    const response = await GET_FORWARD({
      request: new Request(url, {
        method: "GET",
        headers: {
          authorization: ["Bear", "er ", process.env.CRON_SECRET].join(""),
        },
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, delivered: 0 });
    expect(mockRpc).toHaveBeenCalledWith("cg_whatsapp_claim_n8n_outbox", { p_limit: 20 });
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
            claim_token: "00000000-0000-4000-8000-000000000004",
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
      p_claim_token: "00000000-0000-4000-8000-000000000004",
      p_status: "sent",
    });

    const withTenant = signedRequest({ ...reply, tenant_id: "tenant-b" });
    expect((await POST_REPLY({ request: withTenant })).status).toBe(400);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(N8nWhatsAppReplySchema.safeParse({ ...reply, org_ref: "org-b" }).success).toBe(false);
  });

  it("allows a failed reply to retry the same payload with a fresh claim token", async () => {
    process.env.N8N_WHATSAPP_SIGNING_SECRET = SECRET;
    const reply = {
      reply_id: "automation-retry-1",
      inbound_provider_ref: "wamid.inbound",
      conversation_id: "00000000-0000-4000-8000-000000000002",
      body: "Thanks",
    };
    const target = {
      tenant_id: "tenant-a",
      org_ref: "org-a",
      principal_ref: "principal-a",
      provider_sender_ref: "123456",
      conversation_id: reply.conversation_id,
      recipient_address: "+2349015056201",
    };
    mockRpc
      .mockResolvedValueOnce({
        data: [{ ...target, claim_token: "00000000-0000-4000-8000-000000000004" }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({
        data: [{ ...target, claim_token: "00000000-0000-4000-8000-000000000005" }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    mockSend
      .mockResolvedValueOnce({ ok: false, error: "provider unavailable" })
      .mockResolvedValueOnce({ ok: true, providerRef: "wamid.outbound" });

    expect((await POST_REPLY({ request: signedRequest(reply) })).status).toBe(502);
    expect((await POST_REPLY({ request: signedRequest(reply) })).status).toBe(200);
    expect(mockRpc).toHaveBeenNthCalledWith(2, "cg_whatsapp_n8n_reply_result", {
      p_tenant_id: "tenant-a",
      p_reply_id: reply.reply_id,
      p_inbound_provider_ref: reply.inbound_provider_ref,
      p_conversation_id: reply.conversation_id,
      p_claim_token: "00000000-0000-4000-8000-000000000004",
      p_status: "failed",
    });
    expect(mockRpc).toHaveBeenNthCalledWith(4, "cg_whatsapp_n8n_reply_result", {
      p_tenant_id: "tenant-a",
      p_reply_id: reply.reply_id,
      p_inbound_provider_ref: reply.inbound_provider_ref,
      p_conversation_id: reply.conversation_id,
      p_claim_token: "00000000-0000-4000-8000-000000000005",
      p_status: "sent",
    });
  });
});
