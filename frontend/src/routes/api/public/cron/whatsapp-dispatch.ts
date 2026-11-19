/**
 * Scheduled proactive WhatsApp dispatcher (M22, ADR-120). Call with `Authorization: Bearer $CRON_SECRET`.
 * Returns 503 until CRON_SECRET is set; sends nothing unless WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID
 * are configured, the organization's `whatsapp_live` flag is on, and each message has an approved,
 * registered template. Not scheduled by this change.
 */
import { createFileRoute } from "@tanstack/react-router";
import { deliveryEvidenceSinkFromEnv } from "@/lib/communications/delivery-evidence.server";
import { WhatsAppCloudAdapter } from "@/lib/communications/whatsapp-cloud.server";
import {
  createWhatsAppDispatchCronHandler,
  type WhatsAppFabricDatabase,
} from "@/lib/communications/whatsapp-fabric.server";

async function run(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return createWhatsAppDispatchCronHandler({
    env: process.env,
    db: supabaseAdmin as unknown as WhatsAppFabricDatabase,
    adapter: new WhatsAppCloudAdapter(),
    evidence: deliveryEvidenceSinkFromEnv(process.env),
  })(request);
}

export const Route = createFileRoute("/api/public/cron/whatsapp-dispatch")({
  server: { handlers: { GET: ({ request }) => run(request), POST: ({ request }) => run(request) } },
});
