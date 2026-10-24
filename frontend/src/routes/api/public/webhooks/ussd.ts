/**
 * USSD gateway webhook (SHERIVS-025), Africa's Talking style form post: sessionId, phoneNumber, text.
 * Disabled (503) until USSD_SHARED_SECRET is configured and the ussd_live flag is on; the caller must present the shared secret.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

function same(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }

export const Route = createFileRoute("/api/public/webhooks/ussd")({
  server: { handlers: {
    POST: async ({ request }) => {
      const secret = process.env.USSD_SHARED_SECRET;
      if (!secret) return new Response("USSD not configured", { status: 503 });
      if (!same(request.headers.get("x-ussd-secret") ?? "", secret)) return new Response("forbidden", { status: 403 });
      const form = await request.formData().catch(() => null);
      const session = String(form?.get("sessionId") ?? "").slice(0, 100), phone = String(form?.get("phoneNumber") ?? "").slice(0, 20), text = String(form?.get("text") ?? "").slice(0, 200);
      if (!session || !phone) return new Response("END Bad request", { status: 400, headers: { "content-type": "text/plain" } });
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const db = supabaseAdmin as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
      const live = await db.rpc("flag_on", { p_key: "ussd_live", p_org: null });
      if (live.data !== true) return new Response("END Service not yet available.", { headers: { "content-type": "text/plain" } });
      const { data, error } = await db.rpc("ussd_handle", { p_session: session, p_phone: phone, p_text: text });
      return new Response(error ? "END Sorry, please try again." : String(data), { headers: { "content-type": "text/plain" } });
    },
  } },
});
