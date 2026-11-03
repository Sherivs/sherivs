import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const OutboxClaimSchema = z.object({
  outbox_id: z.string().uuid(),
  tenant_id: z.string().min(1).max(128),
  org_ref: z.string().min(1).max(160),
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  provider_ref: z.string().min(1).max(200),
  payload: z.unknown(),
  attempt_count: z.number().int().positive(),
  claim_token: z.string().uuid(),
});

const OutboxPayloadSchema = z.object({
  event_id: z.string().uuid(),
  provider_message_id: z.string().min(1).max(200),
  event_type: z.literal("whatsapp.inbound"),
  tenant_id: z.string().min(1).max(128),
  org_ref: z.string().min(1).max(160),
  conversation_id: z.string().uuid(),
  recipient_hash: z.string().regex(/^[0-9a-f]{64}$/),
  received_at: z.string().datetime().nullable(),
  body: z.string().max(4096),
});

export type WhatsAppN8nDatabase = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string } | null }>;
};

export function getN8nWhatsAppConfig(env = process.env) {
  const webhookUrl = env.N8N_WHATSAPP_WEBHOOK_URL?.trim();
  const signingSecret = env.N8N_WHATSAPP_SIGNING_SECRET;
  const allowedHosts = (env.N8N_WHATSAPP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
        host,
      ),
    );
  if (!webhookUrl || !signingSecret || signingSecret.length < 32) return null;
  try {
    const url = new URL(webhookUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !allowedHosts.includes(url.hostname.toLowerCase())
    )
      return null;
    return { webhookUrl: url.toString(), signingSecret };
  } catch {
    return null;
  }
}

export function signN8nWhatsAppPayload(timestamp: string, rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export async function dispatchWhatsAppN8nOutbox(input: {
  db: WhatsAppN8nDatabase;
  fetchImpl?: typeof fetch;
  now?: () => number;
}) {
  const config = getN8nWhatsAppConfig();
  if (!config) return { ok: false as const, error: "not_configured" };
  const fetchImpl = input.fetchImpl ?? fetch;
  const { data, error } = await input.db.rpc("cg_whatsapp_claim_n8n_outbox", { p_limit: 20 });
  if (error || !Array.isArray(data)) return { ok: false as const, error: "claim_failed" };
  let delivered = 0;
  let failed = 0;

  for (const rawRow of data) {
    const parsed = OutboxClaimSchema.safeParse(rawRow);
    if (!parsed.success) continue;
    const payload = OutboxPayloadSchema.safeParse(parsed.data.payload);
    if (
      !payload.success ||
      payload.data.event_id !== parsed.data.message_id ||
      payload.data.tenant_id !== parsed.data.tenant_id ||
      payload.data.org_ref !== parsed.data.org_ref ||
      payload.data.conversation_id !== parsed.data.conversation_id ||
      payload.data.provider_message_id !== parsed.data.provider_ref
    ) {
      const { data: recorded, error: recordError } = await input.db.rpc(
        "cg_whatsapp_complete_n8n_outbox",
        {
          p_outbox_id: parsed.data.outbox_id,
          p_claim_token: parsed.data.claim_token,
          p_success: false,
          p_error_code: "invalid_payload",
        },
      );
      if (recordError || recorded !== true)
        return { ok: false as const, error: "completion_failed" };
      failed += 1;
      continue;
    }
    const row = parsed.data;
    const body = JSON.stringify(payload.data);
    const timestamp = String(Math.floor((input.now?.() ?? timeAuthority.now().atMs) / 1000));
    let success = false;
    let errorCode = "delivery_failed";
    try {
      const response = await fetchImpl(config.webhookUrl, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/json",
          "x-sherivs-timestamp": timestamp,
          "x-sherivs-signature": signN8nWhatsAppPayload(timestamp, body, config.signingSecret),
        },
        body,
      });
      success = response.ok;
      errorCode = response.ok ? "" : `http_${response.status}`;
    } catch {
      errorCode = "network_error";
    }
    const { data: recorded, error: recordError } = await input.db.rpc(
      "cg_whatsapp_complete_n8n_outbox",
      {
        p_outbox_id: row.outbox_id,
        p_claim_token: row.claim_token,
        p_success: success,
        p_error_code: success ? null : errorCode,
      },
    );
    if (recordError || recorded !== true) return { ok: false as const, error: "completion_failed" };
    if (success) delivered += 1;
    else failed += 1;
  }

  return { ok: true as const, delivered, failed };
}

export function verifyN8nWhatsAppSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  now?: number;
}): boolean {
  if (!input.timestamp || !/^\d{1,10}$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  const now = Math.floor((input.now ?? timeAuthority.now().atMs) / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300) return false;
  if (!input.signature || !/^sha256=[0-9a-f]{64}$/i.test(input.signature)) return false;
  const expected = Buffer.from(
    signN8nWhatsAppPayload(input.timestamp, input.rawBody, input.secret),
  );
  const supplied = Buffer.from(input.signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export const N8nWhatsAppReplySchema = z
  .object({
    reply_id: z.string().min(1).max(160),
    inbound_provider_ref: z.string().min(1).max(200),
    conversation_id: z.string().uuid(),
    body: z.string().min(1).max(4096),
  })
  .strict();
