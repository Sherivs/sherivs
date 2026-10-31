import { z } from "zod";

/**
 * Provider adapters for school comms (SHERIVS-020). Server only.
 * The database decides WHAT may be sent (templates, opt-in, wallet, caps) and records it in
 * outbound_messages. A worker picks rows with status 'queued' (only when the `<channel>_live`
 * flag is on) and calls one of these adapters. With no credentials every adapter is a stub.
 */
export type SendResult = { ok: true; providerRef: string } | { ok: false; error: string };
export interface CommsAdapter {
  readonly name: string;
  readonly live: boolean;
  send(
    to: string,
    body: string,
    opts?: { template?: string; language?: string; parameters?: string[] },
  ): Promise<SendResult>;
}

export class StubAdapter implements CommsAdapter {
  readonly live = false;
  constructor(readonly name: string) {}
  async send(): Promise<SendResult> {
    return { ok: true, providerRef: `stub-${crypto.randomUUID()}` };
  }
}

/** Meta WhatsApp Cloud API. Needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID. */
export class WhatsAppCloudAdapter implements CommsAdapter {
  readonly name = "meta_cloud";
  constructor(
    private token = process.env.WHATSAPP_TOKEN,
    private phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID,
    private fetchImpl: typeof fetch = fetch,
    private sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  get live() {
    return !!this.token?.trim() && !!this.phoneId?.trim();
  }

  async send(
    to: string,
    body: string,
    opts?: { template?: string; language?: string; parameters?: string[] },
  ): Promise<SendResult> {
    if (!this.live) return { ok: false, error: "whatsapp not configured" };
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
    const endpoint = `https://graph.facebook.com/v21.0/${encodeURIComponent(this.phoneId!)}/messages`;

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
        if (retryable && attempt < 2) {
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

/** BulkSMSNigeria. Needs BULKSMS_NG_TOKEN and BULKSMS_NG_SENDER. */
export class BulkSmsNigeriaAdapter implements CommsAdapter {
  readonly name = "bulksmsnigeria";
  constructor(
    private token = process.env.BULKSMS_NG_TOKEN,
    private sender = process.env.BULKSMS_NG_SENDER,
  ) {}
  get live() {
    return !!this.token && !!this.sender;
  }
  async send(to: string, body: string): Promise<SendResult> {
    if (!this.live) return { ok: false, error: "sms not configured" };
    const res = await fetch("https://www.bulksmsnigeria.com/api/v2/sms", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ from: this.sender, to, body, gateway: "direct-refund" }),
    });
    const j = (await res.json().catch(() => ({}))) as {
      data?: { message_id?: string };
      message?: string;
    };
    return res.ok
      ? { ok: true, providerRef: j.data?.message_id ?? `bsn-${crypto.randomUUID()}` }
      : { ok: false, error: j.message ?? `http ${res.status}` };
  }
}

export function adapterFor(channel: string, liveFlag: boolean): CommsAdapter {
  if (!liveFlag) return new StubAdapter(`${channel}_stub`);
  if (channel === "whatsapp") {
    const a = new WhatsAppCloudAdapter();
    return a.live ? a : new StubAdapter("whatsapp_stub");
  }
  if (channel === "sms") {
    const a = new BulkSmsNigeriaAdapter();
    return a.live ? a : new StubAdapter("sms_stub");
  }
  return new StubAdapter(`${channel}_stub`);
}
