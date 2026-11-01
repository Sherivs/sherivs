/**
 * WhatsApp Cloud API webhook (SHERIVS-020): subscription handshake + inbound replies.
 * Verifies X-Hub-Signature-256 (HMAC-SHA256 of the raw body with WHATSAPP_APP_SECRET).
 * Inbound organization resolution and context live in the existing comms database fabric.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const Body = z.object({
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
                      display_phone_number: z.string().max(20).optional(),
                      phone_number_id: z.string().max(40).optional(),
                    })
                    .partial()
                    .optional(),
                  messages: z
                    .array(
                      z.object({
                        id: z.string().max(200),
                        from: z.string().max(20),
                        text: z
                          .object({ body: z.string().max(4096) })
                          .partial()
                          .optional(),
                      }),
                    )
                    .optional(),
                })
                .partial(),
            }),
          )
          .max(50),
      }),
    )
    .max(50),
});

/** Constant-time string compare (Track E: verify_token was compared with ===). */
function sameSecret(a: string | null, b: string): boolean {
  const x = Buffer.from(a ?? ""),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function validSig(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const exp = createHmac("sha256", secret).update(raw).digest();
  const got = header.slice(7);
  return (
    /^[0-9a-f]+$/i.test(got) &&
    got.length === exp.length * 2 &&
    timingSafeEqual(Buffer.from(got, "hex"), exp)
  );
}

export const Route = createFileRoute("/api/public/webhooks/whatsapp")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const token = process.env.WHATSAPP_VERIFY_TOKEN;
        if (!token) return new Response("WhatsApp not configured", { status: 503 });
        return u.searchParams.get("hub.mode") === "subscribe" &&
          sameSecret(u.searchParams.get("hub.verify_token"), token)
          ? new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 })
          : new Response("forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        const secret = process.env.WHATSAPP_APP_SECRET;
        if (!secret) return new Response("WhatsApp not configured", { status: 503 });
        const raw = await request.text();
        if (raw.length > 512 * 1024) return new Response("Payload too large", { status: 413 });
        if (!validSig(raw, request.headers.get("x-hub-signature-256"), secret))
          return new Response("Invalid signature", { status: 401 });
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(JSON.parse(raw));
        } catch {
          return new Response("bad payload", { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as unknown as {
          rpc: (
            f: string,
            a: Record<string, unknown>,
          ) => Promise<{
            data: unknown;
            error: { message: string } | null;
          }>;
        };
        const { WhatsAppCloudAdapter } = await import("@/lib/scholar/comms/adapters.server");
        const whatsapp = new WhatsAppCloudAdapter();
        for (const e of body.entry)
          for (const ch of e.changes) {
            const num = ch.value.metadata?.display_phone_number;
            if (!num) continue;
            for (const m of ch.value.messages ?? []) {
              const { data, error } = await db.rpc("comms_route_inbound", {
                p_gateway_number: num,
                p_from: m.from,
                p_body: m.text?.body ?? "",
                p_provider_ref: m.id,
              });
              if (error) return new Response("processing error", { status: 500 });
              const result = data as {
                action?: string;
                options?: { number: number; name: string }[];
              } | null;
              if (result?.action === "select_org") {
                const choices = (result.options ?? [])
                  .map((option) => `${option.number}. ${option.name.slice(0, 80)}`)
                  .join("\n");
                const sent = await whatsapp.sendSessionText(
                  m.from,
                  `Choose the organization for this conversation by replying with its number:\n${choices}`,
                );
                if (!sent.ok)
                  return new Response("routing prompt could not be delivered", { status: 502 });
                const { error: auditError } = await db.rpc("comms_audit_gateway_message", {
                  p_gateway_number: num,
                  p_from: m.from,
                  p_provider_ref: sent.providerRef,
                  p_event: "routing_prompt_sent",
                });
                if (auditError) return new Response("routing prompt audit failed", { status: 500 });
              } else if (result?.action === "support") {
                const sent = await whatsapp.sendSessionText(
                  m.from,
                  "This number is not linked to an organization. Please contact Sherivs support.",
                );
                if (!sent.ok)
                  return new Response("support response could not be delivered", { status: 502 });
                const { error: auditError } = await db.rpc("comms_audit_gateway_message", {
                  p_gateway_number: num,
                  p_from: m.from,
                  p_provider_ref: sent.providerRef,
                  p_event: "support_response_sent",
                });
                if (auditError)
                  return new Response("support response audit failed", { status: 500 });
              }
            }
          }
        return new Response("ok");
      },
    },
  },
});
