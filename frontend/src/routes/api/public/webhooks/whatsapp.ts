/**
 * WhatsApp Cloud API webhook (SHERIVS-020): subscription handshake, inbound replies,
 * and delivery-status callbacks. The sender registry resolves the tenant; payload
 * tenant identifiers are never trusted.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sendWhatsAppMessage } from "@/lib/communications/whatsapp-cloud.server";
import { normalizeWhatsAppPhone } from "@/lib/communications/whatsapp-phone";
export { normalizeWhatsAppPhone } from "@/lib/communications/whatsapp-phone";

export const WhatsAppInboundMessageSchema = z.object({
  id: z.string().min(1).max(200),
  timestamp: z
    .string()
    .regex(/^\d{1,13}$/)
    .optional(),
  from: z
    .string()
    .max(20)
    .regex(/^(?:\+?[1-9]\d{7,14}|0\d{10})$/),
  type: z
    .enum([
      "text",
      "image",
      "audio",
      "video",
      "document",
      "sticker",
      "location",
      "contacts",
      "interactive",
      "button",
      "order",
      "system",
      "reaction",
      "referral",
    ])
    .optional(),
  text: z
    .object({ body: z.string().max(4096) })
    .partial()
    .optional(),
});

export const WhatsAppStatusSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  errors: z
    .array(z.object({ code: z.union([z.number(), z.string().max(32)]).optional() }).passthrough())
    .optional(),
});

export const WhatsAppWebhookSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z
                .object({
                  metadata: z
                    .object({
                      display_phone_number: z.string().max(40).optional(),
                      phone_number_id: z.string().min(1).max(160).optional(),
                    })
                    .partial()
                    .optional(),
                  messages: z.array(z.unknown()).max(100).optional(),
                  statuses: z.array(z.unknown()).max(100).optional(),
                })
                .partial(),
            }),
          )
          .max(50),
      }),
    )
    .max(50),
});

function sameSecret(a: string | null, b: string): boolean {
  const x = Buffer.from(a ?? "");
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyWhatsAppWebhookSignature(
  raw: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(Buffer.from(header.slice(7), "hex"), expected);
}

function candidateEventId(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("id" in value)) return null;
  const id = value.id;
  return typeof id === "string" && id.length >= 1 && id.length <= 200 ? id : null;
}

function messageBody(message: z.infer<typeof WhatsAppInboundMessageSchema>): string {
  const text = message.text?.body;
  if ((message.type === undefined || message.type === "text") && text !== undefined) return text;
  const type = message.type ?? (text !== undefined ? "text" : "unknown");
  return `[${type} message]`;
}

function providerTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const milliseconds = Number(value) * 1000;
  const date = new Date(milliseconds);
  return Number.isSafeInteger(Number(value)) && !Number.isNaN(date.getTime())
    ? date.toISOString()
    : null;
}

function safeMetaErrorCode(code: string | number | undefined): string | null {
  const value = typeof code === "number" && Number.isSafeInteger(code) ? String(code) : code;
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,32}$/.test(value) ? value : null;
}

function logRpcFailure(fn: string, error: { code?: string } | null): void {
  const code = error?.code && /^[A-Za-z0-9_.-]{1,16}$/.test(error.code) ? error.code : "unknown";
  console.error("whatsapp_webhook_rpc_failed", { fn, code });
}

type WebhookDb = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

async function deadLetter(
  db: WebhookDb,
  providerSenderRef: string,
  providerRef: string | null,
  eventType: "message" | "status",
  errorCode: string,
): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("cg_whatsapp_dead_letter", {
      p_provider_sender_ref: providerSenderRef || "unknown",
      p_provider_ref: providerRef,
      p_event_type: eventType,
      p_error_code: errorCode,
    });
    if (!error && data === true) return true;
    logRpcFailure("cg_whatsapp_dead_letter", error);
    return false;
  } catch {
    logRpcFailure("cg_whatsapp_dead_letter", null);
    return false;
  }
}

async function sendAutomaticAcknowledgement(
  db: WebhookDb,
  providerSenderRef: string,
  providerRef: string,
): Promise<boolean> {
  const body =
    process.env.WHATSAPP_AUTO_ACK_TEXT ??
    "Thanks for your message. A Sherivs team member will respond soon.";
  if (!body.trim() || body.length > 4096) {
    console.error("whatsapp_auto_ack_configuration_invalid");
    return true;
  }

  try {
    const { data, error } = await db.rpc("cg_whatsapp_prepare_auto_ack", {
      p_provider_sender_ref: providerSenderRef,
      p_inbound_provider_ref: providerRef,
      p_body: body,
    });
    if (error) {
      logRpcFailure("cg_whatsapp_prepare_auto_ack", error);
      return false;
    }
    const targets = z
      .array(
        z.object({
          tenant_id: z.string().min(1).max(128),
          org_ref: z.string().min(1).max(160),
          principal_ref: z.string().min(1).max(160),
          provider_sender_ref: z.string().regex(/^[0-9]{1,160}$/),
          conversation_id: z.string().uuid(),
          recipient_address: z.string().regex(/^\+[1-9]\d{7,14}$/),
        }),
      )
      .safeParse(data);
    if (!targets.success) {
      console.error("whatsapp_auto_ack_target_invalid");
      return false;
    }
    const target = targets.data[0];
    if (!target) return true;

    let result: Awaited<ReturnType<typeof sendWhatsAppMessage>>;
    try {
      result = await sendWhatsAppMessage({
        tenantId: target.tenant_id,
        orgRef: target.org_ref,
        principalRef: target.principal_ref,
        conversationId: target.conversation_id,
        inboundProviderSenderRef: target.provider_sender_ref,
        inboundProviderRef: providerRef,
        expectedRecipientAddress: target.recipient_address,
        body,
        retryTransient: false,
      });
    } catch {
      result = { ok: false, error: "WhatsApp automatic acknowledgement failed" };
    }
    const { error: recordError, data: recorded } = await db.rpc("cg_whatsapp_auto_ack_result", {
      p_provider_sender_ref: providerSenderRef,
      p_inbound_provider_ref: providerRef,
      p_status: result.ok ? "sent" : "failed",
      p_error_code: result.ok ? null : "send_failed",
    });
    if (recordError || recorded !== true) {
      logRpcFailure("cg_whatsapp_auto_ack_result", recordError);
      return false;
    }
    return result.ok;
  } catch {
    logRpcFailure("cg_whatsapp_prepare_auto_ack", null);
    return false;
  }
}

export const Route = createFileRoute("/api/public/webhooks/whatsapp")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = process.env.WHATSAPP_VERIFY_TOKEN;
        if (!token) return new Response("WhatsApp not configured", { status: 503 });
        const challenge = url.searchParams.get("hub.challenge");
        return url.searchParams.get("hub.mode") === "subscribe" &&
          sameSecret(url.searchParams.get("hub.verify_token"), token) &&
          challenge !== null
          ? new Response(challenge, { status: 200 })
          : new Response("forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        const secret = process.env.WHATSAPP_APP_SECRET;
        if (!secret) return new Response("WhatsApp not configured", { status: 503 });
        const raw = await request.text();
        if (Buffer.byteLength(raw, "utf8") > 512 * 1024)
          return new Response("Payload too large", { status: 413 });
        if (
          !verifyWhatsAppWebhookSignature(raw, request.headers.get("x-hub-signature-256"), secret)
        ) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("bad payload", { status: 400 });
        }
        const parsed = WhatsAppWebhookSchema.safeParse(payload);
        if (!parsed.success) return new Response("bad payload", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as unknown as WebhookDb;
        let allEventsDurable = true;

        for (const entry of parsed.data.entry) {
          for (const change of entry.changes) {
            const providerSenderRef = change.value.metadata?.phone_number_id;

            for (const rawMessage of change.value.messages ?? []) {
              const providerRef = candidateEventId(rawMessage);
              const message = WhatsAppInboundMessageSchema.safeParse(rawMessage);
              if (!message.success) {
                const stored = await deadLetter(
                  db,
                  providerSenderRef ?? "unknown",
                  providerRef,
                  "message",
                  "invalid_message",
                );
                allEventsDurable = allEventsDurable && stored;
                continue;
              }
              if (!providerSenderRef) {
                const stored = await deadLetter(
                  db,
                  "unknown",
                  message.data.id,
                  "message",
                  "invalid_sender_metadata",
                );
                allEventsDurable = allEventsDurable && stored;
                continue;
              }
              const phone = normalizeWhatsAppPhone(message.data.from);
              if (!phone) {
                const stored = await deadLetter(
                  db,
                  providerSenderRef,
                  message.data.id,
                  "message",
                  "invalid_phone",
                );
                allEventsDurable = allEventsDurable && stored;
                continue;
              }
              let data: unknown;
              let error: { code?: string; message?: string } | null;
              try {
                ({ data, error } = await db.rpc("cg_whatsapp_receive", {
                  p_provider_sender_ref: providerSenderRef,
                  p_from: phone,
                  p_body: messageBody(message.data),
                  p_provider_ref: message.data.id,
                  p_provider_timestamp: providerTimestamp(message.data.timestamp),
                }));
              } catch {
                error = { code: "unknown" };
                data = null;
              }
              if (error) {
                logRpcFailure("cg_whatsapp_receive", error);
                const stored = await deadLetter(
                  db,
                  providerSenderRef,
                  message.data.id,
                  "message",
                  safeMetaErrorCode(error.code) ?? "receive_failed",
                );
                allEventsDurable = allEventsDurable && stored;
                continue;
              }
              if (data === "unmapped_sender") {
                console.warn("whatsapp_webhook_unmapped_sender");
              } else if (data === "rate_limited") {
                console.warn("whatsapp_webhook_rate_limited");
              } else if (data === "logged" || data === "opted_in") {
                const sent = await sendAutomaticAcknowledgement(
                  db,
                  providerSenderRef,
                  message.data.id,
                );
                if (!sent) {
                  const stored = await deadLetter(
                    db,
                    providerSenderRef,
                    message.data.id,
                    "message",
                    "auto_ack_failed",
                  );
                  allEventsDurable = allEventsDurable && stored;
                }
              }
            }

            for (const rawStatus of change.value.statuses ?? []) {
              const providerRef = candidateEventId(rawStatus);
              const status = WhatsAppStatusSchema.safeParse(rawStatus);
              if (!status.success) {
                const stored = await deadLetter(
                  db,
                  providerSenderRef ?? "unknown",
                  providerRef,
                  "status",
                  "invalid_status",
                );
                allEventsDurable = allEventsDurable && stored;
                continue;
              }
              if (!providerSenderRef) {
                const stored = await deadLetter(
                  db,
                  "unknown",
                  status.data.id,
                  "status",
                  "invalid_sender_metadata",
                );
                allEventsDurable = allEventsDurable && stored;
                continue;
              }
              const errorCode = safeMetaErrorCode(status.data.errors?.[0]?.code);
              let data: unknown;
              let error: { code?: string; message?: string } | null;
              try {
                ({ data, error } = await db.rpc("cg_whatsapp_status", {
                  p_provider_sender_ref: providerSenderRef,
                  p_provider_ref: status.data.id,
                  p_status: status.data.status,
                  p_error_code: errorCode,
                }));
              } catch {
                error = { code: "unknown" };
                data = null;
              }
              if (error || data !== true) {
                logRpcFailure("cg_whatsapp_status", error);
                const stored = await deadLetter(
                  db,
                  providerSenderRef,
                  status.data.id,
                  "status",
                  error ? (safeMetaErrorCode(error.code) ?? "status_failed") : "status_unmatched",
                );
                allEventsDurable = allEventsDurable && stored;
              }
            }
          }
        }

        return allEventsDurable
          ? new Response("ok")
          : new Response("processing error", { status: 500 });
      },
    },
  },
});
