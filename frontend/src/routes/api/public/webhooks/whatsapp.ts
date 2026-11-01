/**
 * WhatsApp Cloud API webhook (SHERIVS-020): subscription handshake, inbound replies,
 * and delivery-status callbacks. The sender registry resolves the tenant; payload
 * tenant identifiers are never trusted.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const MessageSchema = z.object({
  id: z.string().min(1).max(200),
  from: z
    .string()
    .max(20)
    .regex(/^\+?[1-9]\d{7,14}$/),
  text: z
    .object({ body: z.string().max(4096) })
    .partial()
    .optional(),
});

const StatusSchema = z.object({
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
                  messages: z.array(MessageSchema).max(100).optional(),
                  statuses: z.array(StatusSchema).max(100).optional(),
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

export function normalizeWhatsAppPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

function safeMetaErrorCode(code: string | number | undefined): string | null {
  const value = typeof code === "number" && Number.isSafeInteger(code) ? String(code) : code;
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,32}$/.test(value) ? value : null;
}

function logRpcFailure(fn: string, error: { code?: string } | null): void {
  const code = error?.code && /^[A-Za-z0-9_.-]{1,16}$/.test(error.code) ? error.code : "unknown";
  console.error("whatsapp_webhook_rpc_failed", { fn, code });
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
        const db = supabaseAdmin as unknown as {
          rpc: (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
        };

        for (const entry of parsed.data.entry) {
          for (const change of entry.changes) {
            const providerSenderRef = change.value.metadata?.phone_number_id;
            if (!providerSenderRef) continue;

            for (const message of change.value.messages ?? []) {
              const phone = normalizeWhatsAppPhone(message.from);
              if (!phone) continue;
              const { data, error } = await db.rpc("cg_whatsapp_receive", {
                p_provider_sender_ref: providerSenderRef,
                p_from: phone,
                p_body: message.text?.body ?? "",
                p_provider_ref: message.id,
              });
              if (error) {
                logRpcFailure("cg_whatsapp_receive", error);
                return new Response("processing error", { status: 500 });
              }
              if (data === "unmapped_sender") {
                console.warn("whatsapp_webhook_unmapped_sender");
              }
            }

            for (const status of change.value.statuses ?? []) {
              const errorCode = safeMetaErrorCode(status.errors?.[0]?.code);
              const { data, error } = await db.rpc("cg_whatsapp_status", {
                p_provider_sender_ref: providerSenderRef,
                p_provider_ref: status.id,
                p_status: status.status,
                p_error_code: errorCode,
              });
              if (error || data !== true) {
                logRpcFailure("cg_whatsapp_status", error);
                return new Response("processing error", { status: 500 });
              }
            }
          }
        }

        return new Response("ok");
      },
    },
  },
});
