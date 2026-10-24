/**
 * Provider adapters for school comms (SHERIVS-020). Server only.
 * The database decides WHAT may be sent (templates, opt-in, wallet, caps) and records it in
 * outbound_messages. A worker picks rows with status 'queued' (only when the `<channel>_live`
 * flag is on) and calls one of these adapters. With no credentials every adapter is a stub.
 */
export type SendResult = { ok: true; providerRef: string } | { ok: false; error: string };
export interface CommsAdapter { readonly name: string; readonly live: boolean; send(to: string, body: string, opts?: { template?: string; language?: string }): Promise<SendResult> }

export class StubAdapter implements CommsAdapter {
  readonly live = false;
  constructor(readonly name: string) {}
  async send(): Promise<SendResult> { return { ok: true, providerRef: `stub-${crypto.randomUUID()}` }; }
}

/** Meta WhatsApp Cloud API. Needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID. */
export class WhatsAppCloudAdapter implements CommsAdapter {
  readonly name = "meta_cloud";
  constructor(private token = process.env.WHATSAPP_TOKEN, private phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID) {}
  get live() { return !!this.token && !!this.phoneId; }
  async send(to: string, _body: string, opts?: { template?: string; language?: string }): Promise<SendResult> {
    if (!this.live) return { ok: false, error: "whatsapp not configured" };
    const res = await fetch(`https://graph.facebook.com/v21.0/${this.phoneId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: opts?.template, language: { code: opts?.language === "en" ? "en" : opts?.language ?? "en" } } }),
    });
    const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    return res.ok && j.messages?.[0]?.id ? { ok: true, providerRef: j.messages[0].id } : { ok: false, error: j.error?.message ?? `http ${res.status}` };
  }
}

/** BulkSMSNigeria. Needs BULKSMS_NG_TOKEN and BULKSMS_NG_SENDER. */
export class BulkSmsNigeriaAdapter implements CommsAdapter {
  readonly name = "bulksmsnigeria";
  constructor(private token = process.env.BULKSMS_NG_TOKEN, private sender = process.env.BULKSMS_NG_SENDER) {}
  get live() { return !!this.token && !!this.sender; }
  async send(to: string, body: string): Promise<SendResult> {
    if (!this.live) return { ok: false, error: "sms not configured" };
    const res = await fetch("https://www.bulksmsnigeria.com/api/v2/sms", {
      method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ from: this.sender, to, body, gateway: "direct-refund" }),
    });
    const j = (await res.json().catch(() => ({}))) as { data?: { message_id?: string }; message?: string };
    return res.ok ? { ok: true, providerRef: j.data?.message_id ?? `bsn-${Date.now()}` } : { ok: false, error: j.message ?? `http ${res.status}` };
  }
}

export function adapterFor(channel: string, liveFlag: boolean): CommsAdapter {
  if (!liveFlag) return new StubAdapter(`${channel}_stub`);
  if (channel === "whatsapp") { const a = new WhatsAppCloudAdapter(); return a.live ? a : new StubAdapter("whatsapp_stub"); }
  if (channel === "sms") { const a = new BulkSmsNigeriaAdapter(); return a.live ? a : new StubAdapter("sms_stub"); }
  return new StubAdapter(`${channel}_stub`);
}
