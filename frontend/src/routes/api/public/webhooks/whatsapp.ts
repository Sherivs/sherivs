/**
 * WhatsApp Cloud API webhook (SHERIVS-020): subscription handshake + inbound replies.
 * Verifies X-Hub-Signature-256 (HMAC-SHA256 of the raw body with WHATSAPP_APP_SECRET).
 * Unconfigured -> 503. STOP/START keywords update opt-in inside public.comms_inbound.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const Body = z.object({ entry: z.array(z.object({ changes: z.array(z.object({ value: z.object({
  metadata: z.object({ display_phone_number: z.string().max(20).optional(), phone_number_id: z.string().max(40).optional() }).partial().optional(),
  messages: z.array(z.object({ id: z.string().max(200), from: z.string().max(20), text: z.object({ body: z.string().max(4096) }).partial().optional() })).optional(),
}).partial() })).max(50) })).max(50) });

function validSig(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const exp = createHmac("sha256", secret).update(raw).digest(); const got = header.slice(7);
  return /^[0-9a-f]+$/i.test(got) && got.length === exp.length * 2 && timingSafeEqual(Buffer.from(got, "hex"), exp);
}

export const Route = createFileRoute("/api/public/webhooks/whatsapp")({
  server: { handlers: {
    GET: async ({ request }) => {
      const u = new URL(request.url); const token = process.env.WHATSAPP_VERIFY_TOKEN;
      if (!token) return new Response("WhatsApp not configured", { status: 503 });
      return u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === token
        ? new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 });
    },
    POST: async ({ request }) => {
      const secret = process.env.WHATSAPP_APP_SECRET;
      if (!secret) return new Response("WhatsApp not configured", { status: 503 });
      const raw = await request.text();
      if (raw.length > 512 * 1024) return new Response("Payload too large", { status: 413 });
      if (!validSig(raw, request.headers.get("x-hub-signature-256"), secret)) return new Response("Invalid signature", { status: 401 });
      let body: z.infer<typeof Body>;
      try { body = Body.parse(JSON.parse(raw)); } catch { return new Response("bad payload", { status: 400 }); }
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const db = supabaseAdmin as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { school_id: string } | null }> } } } };
        rpc: (f: string, a: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      };
      for (const e of body.entry) for (const ch of e.changes) {
        const num = ch.value.metadata?.display_phone_number; if (!num) continue;
        const { data: sender } = await db.from("comms_sender_numbers").select("school_id").eq("channel", "whatsapp").eq("provider_number", num).maybeSingle();
        if (!sender) continue;   // school comes from our sender registry, never from the payload
        for (const m of ch.value.messages ?? []) {
          const { error } = await db.rpc("comms_inbound", { p_school: sender.school_id, p_channel: "whatsapp", p_from: m.from, p_body: m.text?.body ?? "", p_provider_ref: m.id });
          if (error) return new Response("processing error", { status: 500 });   // Meta redelivers; comms_inbound is idempotent on provider_ref
        }
      }
      return new Response("ok");
    },
  } },
});
