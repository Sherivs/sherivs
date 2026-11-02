import { z } from "zod";

export type WhatsAppSendResult = { ok: true; providerRef: string } | { ok: false; error: string };

export type WhatsAppSendOptions = {
  template?: string;
  language?: string;
  parameters?: string[];
  phoneNumberId?: string;
  retryTransient?: boolean;
};

export interface WhatsAppGatewaySendCommand {
  tenantId: string;
  orgRef: string;
  principalRef: string;
  conversationId: string;
  inboundProviderSenderRef: string;
  inboundProviderRef: string;
  body: string;
  templateCode?: string;
  language?: string;
  parameters?: string[];
  retryTransient?: boolean;
  expectedRecipientAddress: string;
}

export type WhatsAppSendDatabase = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Dispatch through the shared tenant/org message ledger. The caller must pass
 * tenant and principal references already authorized by the communications gateway.
 */
export async function sendWhatsAppMessage(
  command: WhatsAppGatewaySendCommand,
  adapter = new WhatsAppCloudAdapter(),
  database?: WhatsAppSendDatabase,
): Promise<WhatsAppSendResult> {
  let db = database;
  if (!db) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    db = supabaseAdmin as unknown as WhatsAppSendDatabase;
  }
  const prepared = await db.rpc("cg_whatsapp_prepare_send", {
    p_tenant_id: command.tenantId,
    p_org_ref: command.orgRef,
    p_principal_ref: command.principalRef,
    p_conversation_id: command.conversationId,
    p_provider_sender_ref: command.inboundProviderSenderRef,
    p_inbound_provider_ref: command.inboundProviderRef,
    p_body: command.body,
    p_template_code: command.templateCode ?? null,
  });
  if (prepared.error)
    return { ok: false, error: "WhatsApp recipient or consent could not be verified" };
  const rows = z
    .array(
      z.object({
        message_id: z.string().uuid(),
        provider_sender_ref: z.string().min(1).max(160),
        conversation_id: z.string().uuid(),
        recipient_address: z.string().regex(/^\+[1-9]\d{7,14}$/),
      }),
    )
    .safeParse(prepared.data);
  if (!rows.success || rows.data.length !== 1)
    return { ok: false, error: "WhatsApp gateway returned no unique send target" };

  const target = rows.data[0];
  if (
    target.provider_sender_ref !== command.inboundProviderSenderRef ||
    target.recipient_address !== command.expectedRecipientAddress
  ) {
    await db.rpc("cg_whatsapp_dispatch_result", {
      p_message_id: target.message_id,
      p_status: "failed",
      p_provider_ref: null,
      p_error_code: "recipient_mismatch",
    });
    return { ok: false, error: "WhatsApp send target no longer matches the inbound sender" };
  }
  if (target.conversation_id !== command.conversationId) {
    await db.rpc("cg_whatsapp_dispatch_result", {
      p_message_id: target.message_id,
      p_status: "failed",
      p_provider_ref: null,
      p_error_code: "conversation_mismatch",
    });
    return { ok: false, error: "WhatsApp conversation no longer matches the inbound message" };
  }
  const sent = await adapter.send(target.recipient_address, command.body, {
    template: command.templateCode,
    language: command.language,
    parameters: command.parameters,
    phoneNumberId: target.provider_sender_ref,
    retryTransient: command.retryTransient,
  });
  const recorded = await db.rpc("cg_whatsapp_dispatch_result", {
    p_message_id: target.message_id,
    p_status: sent.ok ? "sent" : "failed",
    p_provider_ref: sent.ok ? sent.providerRef : null,
    p_error_code: sent.ok ? null : "provider_error",
  });
  if (recorded.error || recorded.data !== true)
    return { ok: false, error: "WhatsApp delivery outcome could not be recorded" };
  return sent;
}

/** Transport adapter only; the shared gateway resolves tenant, sender, and recipient first. */
export class WhatsAppCloudAdapter {
  readonly name = "meta_cloud";

  constructor(
    private token = process.env.WHATSAPP_TOKEN,
    private defaultPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID,
    private fetchImpl: typeof fetch = fetch,
    private sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private graphVersion = process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0",
  ) {}

  get live() {
    return !!this.token?.trim();
  }

  async send(to: string, body: string, opts?: WhatsAppSendOptions): Promise<WhatsAppSendResult> {
    const phoneNumberId = opts?.phoneNumberId ?? this.defaultPhoneId;
    if (!this.live || !phoneNumberId) return { ok: false, error: "whatsapp not configured" };
    if (!/^v\d+\.\d+$/.test(this.graphVersion))
      return { ok: false, error: "invalid WhatsApp Graph API version" };
    if (!/^[0-9]{1,32}$/.test(phoneNumberId))
      return { ok: false, error: "invalid WhatsApp sender reference" };
    const recipient = to.replace(/^\+/, "");
    if (!/^[1-9]\d{7,14}$/.test(recipient))
      return { ok: false, error: "invalid WhatsApp recipient" };
    if (opts?.template !== undefined) {
      if (!/^[a-z0-9_]{1,512}$/.test(opts.template))
        return { ok: false, error: "invalid WhatsApp template" };
      if (opts.language && !/^[a-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?$/.test(opts.language))
        return { ok: false, error: "invalid WhatsApp template language" };
      if (opts.parameters?.some((parameter) => parameter.length > 1024)) {
        return { ok: false, error: "invalid WhatsApp template parameters" };
      }
    } else if (body.length < 1 || body.length > 4096) {
      return { ok: false, error: "invalid WhatsApp text body" };
    }

    const payload = opts?.template
      ? {
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: {
            name: opts.template,
            language: { code: opts.language ?? "en" },
            ...(opts.parameters?.length
              ? {
                  components: [
                    {
                      type: "body",
                      parameters: opts.parameters.map((text) => ({ type: "text", text })),
                    },
                  ],
                }
              : {}),
          },
        }
      : {
          messaging_product: "whatsapp",
          to: recipient,
          type: "text",
          text: { body, preview_url: false },
        };
    const endpoint = `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(endpoint, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        return { ok: false, error: "WhatsApp provider request failed" };
      }

      if (!response.ok) {
        const retryable =
          response.status === 408 || response.status === 429 || response.status >= 500;
        if (retryable && opts?.retryTransient !== false && attempt < 2) {
          await this.sleep(250 * 2 ** attempt);
          continue;
        }
        return { ok: false, error: `WhatsApp provider returned HTTP ${response.status}` };
      }

      const parsed = z
        .object({ messages: z.array(z.object({ id: z.string().min(1).max(200) })).min(1) })
        .safeParse(await response.json().catch(() => null));
      if (!parsed.success)
        return { ok: false, error: "WhatsApp provider returned no message receipt" };
      return { ok: true, providerRef: parsed.data.messages[0].id };
    }

    return { ok: false, error: "WhatsApp provider request failed" };
  }
}
