import { describe, expect, it, vi } from "vitest";
import {
  sendWhatsAppMessage,
  WhatsAppCloudAdapter,
} from "../../../frontend/src/lib/communications/whatsapp-cloud.server";

const { mockAdminRpc } = vi.hoisted(() => ({ mockAdminRpc: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: mockAdminRpc },
}));

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

  it("uses a validated configured Graph API version and defaults to v21.0", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(receipt());
    const adapter = new WhatsAppCloudAdapter(TOKEN, PHONE_ID, fetchImpl, vi.fn(), "v22.1");

    await adapter.send("2349015056201", "Hello");
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://graph.facebook.com/v22.1/123456789012345/messages",
    );

    const invalid = new WhatsAppCloudAdapter(TOKEN, PHONE_ID, vi.fn(), vi.fn(), "v22.1/evil");
    await expect(invalid.send("2349015056201", "Hello")).resolves.toMatchObject({
      ok: false,
      error: "invalid WhatsApp Graph API version",
    });
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

  it("does not retry transient HTTP responses for at-most-once automatic acknowledgements", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const adapter = new WhatsAppCloudAdapter(TOKEN, PHONE_ID, fetchImpl, vi.fn());

    await expect(
      adapter.send("2349015056201", "Thanks", { retryTransient: false }),
    ).resolves.toMatchObject({ ok: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch an acknowledgement if the prepared address differs from the inbound sender", async () => {
    mockAdminRpc.mockImplementation(async (name: string) => {
      if (name === "cg_whatsapp_prepare_send") {
        return {
          data: [
            {
              message_id: "00000000-0000-4000-8000-000000000001",
              provider_sender_ref: PHONE_ID,
              conversation_id: "00000000-0000-4000-8000-000000000002",
              recipient_address: "+2349015056999",
            },
          ],
          error: null,
        };
      }
      return { data: true, error: null };
    });
    const send = vi.fn();
    const result = await sendWhatsAppMessage(
      {
        tenantId: "tenant-a",
        orgRef: "org-a",
        principalRef: "principal-a",
        conversationId: "00000000-0000-4000-8000-000000000002",
        inboundProviderSenderRef: PHONE_ID,
        inboundProviderRef: "wamid.inbound",
        body: "Thanks",
        expectedRecipientAddress: "+2349015056202",
      },
      { send } as unknown as WhatsAppCloudAdapter,
    );

    expect(result).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
    expect(mockAdminRpc).toHaveBeenCalledWith(
      "cg_whatsapp_dispatch_result",
      expect.objectContaining({ p_status: "failed", p_error_code: "recipient_mismatch" }),
    );
    mockAdminRpc.mockReset();
  });

  it("keeps interleaved sends isolated across four tenants and three senders each", async () => {
    const records = Array.from({ length: 12 }, (_, index) => {
      const tenantIndex = Math.floor(index / 3);
      const senderRef = String(900_000 + index);
      const conversationId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const inboundProviderRef = `wamid.t${tenantIndex}.s${index % 3}`;
      const recipient = `+234800000${String(index).padStart(4, "0")}`;
      return {
        tenantId: `tenant-${tenantIndex}`,
        orgRef: `org-${tenantIndex}`,
        principalRef: `principal-${index}`,
        conversationId,
        inboundProviderSenderRef: senderRef,
        inboundProviderRef,
        recipient,
      };
    });
    const byInboundRef = new Map(
      records.map((record, index) => [record.inboundProviderRef, { ...record, index }]),
    );
    mockAdminRpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "cg_whatsapp_prepare_send") {
        const target = byInboundRef.get(String(args.p_inbound_provider_ref));
        if (!target) return { data: [], error: null };
        return {
          data: [
            {
              message_id: `00000000-0000-4000-8000-${String(target.index + 100).padStart(12, "0")}`,
              provider_sender_ref: target.inboundProviderSenderRef,
              conversation_id: target.conversationId,
              recipient_address: target.recipient,
            },
          ],
          error: null,
        };
      }
      return { data: true, error: null };
    });
    const fetchImpl = vi.fn().mockResolvedValue(receipt());
    const adapter = new WhatsAppCloudAdapter(TOKEN, PHONE_ID, fetchImpl, vi.fn());

    await Promise.all(
      records.map((record) =>
        sendWhatsAppMessage(
          {
            tenantId: record.tenantId,
            orgRef: record.orgRef,
            principalRef: record.principalRef,
            conversationId: record.conversationId,
            inboundProviderSenderRef: record.inboundProviderSenderRef,
            inboundProviderRef: record.inboundProviderRef,
            expectedRecipientAddress: record.recipient,
            body: `reply-${record.inboundProviderRef}`,
          },
          adapter,
          { rpc: mockAdminRpc } as never,
        ),
      ),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(12);
    for (const [name, args] of mockAdminRpc.mock.calls) {
      if (name !== "cg_whatsapp_prepare_send") continue;
      const target = byInboundRef.get(String(args.p_inbound_provider_ref));
      expect(args).toMatchObject({
        p_tenant_id: target?.tenantId,
        p_org_ref: target?.orgRef,
        p_conversation_id: target?.conversationId,
        p_provider_sender_ref: target?.inboundProviderSenderRef,
      });
    }
    (fetchImpl.mock.calls as [string, RequestInit][]).forEach(([url, init], index) => {
      const target = records[index];
      expect(url).toBe(
        `https://graph.facebook.com/v21.0/${target?.inboundProviderSenderRef}/messages`,
      );
      expect(JSON.parse(String(init.body))).toMatchObject({
        to: target?.recipient.slice(1),
        text: { body: `reply-${target?.inboundProviderRef}`, preview_url: false },
      });
    });
    mockAdminRpc.mockReset();
  });
});
