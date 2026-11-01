import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  sendWhatsAppMessage,
  WhatsAppCloudAdapter,
} from "@/lib/communications/whatsapp-cloud.server";

const rpc = vi.mocked(supabaseAdmin.rpc);
const TENANT_ID = "tenant-1";
const ORG_REF = "org-1";
const PRINCIPAL_REF = "principal-1";

describe("shared WhatsApp gateway send flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the gateway-resolved recipient and sender for an approved template", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: "provider-ref" }] }), { status: 200 }),
      );
    const adapter = new WhatsAppCloudAdapter("test-token", "unused-default", fetchImpl, vi.fn());
    rpc
      .mockResolvedValueOnce({
        data: [
          {
            message_id: "00000000-0000-4000-8000-000000000001",
            provider_sender_ref: "123456789",
            recipient_address: "+2348030000001",
          },
        ],
        error: null,
      } as never)
      .mockResolvedValueOnce({ data: true, error: null } as never);

    await expect(
      sendWhatsAppMessage(
        {
          tenantId: TENANT_ID,
          orgRef: ORG_REF,
          principalRef: PRINCIPAL_REF,
          body: "Sherivs Academy: Ada",
          templateCode: "absence_alert_v1",
          language: "en",
          parameters: ["Sherivs Academy", "Ada"],
        },
        adapter,
      ),
    ).resolves.toEqual({ ok: true, providerRef: "provider-ref" });

    expect(rpc.mock.calls[0]?.[0]).toBe("cg_whatsapp_prepare_send");
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_tenant_id: TENANT_ID,
      p_org_ref: ORG_REF,
      p_principal_ref: PRINCIPAL_REF,
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_recipient_address");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://graph.facebook.com/v21.0/123456789/messages",
    );
    const payload = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      template: { components: { parameters: { text: string }[] }[] };
    };
    expect(payload.template.components[0]?.parameters.map(({ text }) => text)).toEqual([
      "Sherivs Academy",
      "Ada",
    ]);
    expect(rpc.mock.calls[1]?.[0]).toBe("cg_whatsapp_dispatch_result");
  });

  it("does not dispatch when the gateway cannot verify the recipient", async () => {
    const fetchImpl = vi.fn();
    const adapter = new WhatsAppCloudAdapter("test-token", "phone-id", fetchImpl, vi.fn());
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "recipient not authorized" },
    } as never);

    await expect(
      sendWhatsAppMessage(
        {
          tenantId: TENANT_ID,
          orgRef: ORG_REF,
          principalRef: PRINCIPAL_REF,
          body: "Unverified destination",
        },
        adapter,
      ),
    ).resolves.toEqual({
      ok: false,
      error: "WhatsApp recipient or consent could not be verified",
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
