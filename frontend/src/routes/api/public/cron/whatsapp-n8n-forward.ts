import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { dispatchWhatsAppN8nOutbox } from "@/lib/communications/whatsapp-n8n.server";

function isAuthorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from("Bearer " + secret);
  const actual = Buffer.from(header ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function run(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return new Response("WhatsApp forwarding is not configured", { status: 503 });
  if (!isAuthorized(request.headers.get("authorization"), cronSecret))
    return new Response("Unauthorized", { status: 401 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    const result = await dispatchWhatsAppN8nOutbox({
      db: supabaseAdmin as never,
    });
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 503 });
    return Response.json(result);
  } catch {
    return Response.json({ ok: false, error: "forwarding_failed" }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/public/cron/whatsapp-n8n-forward")({
  server: { handlers: { GET: ({ request }) => run(request), POST: ({ request }) => run(request) } },
});
