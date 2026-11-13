/**
 * Scheduled SMS dispatcher (COMMS-03). Call with `Authorization: Bearer $CRON_SECRET` (Vercel
 * Cron, the n8n server, or any scheduler). Returns 503 until CRON_SECRET is set; sends nothing
 * unless SMS_PROVIDER and the provider credentials are configured and the organization's
 * `sms_live` flag is on.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  createSmsDispatchCronHandler,
  type SmsFabricDatabase,
} from "@/lib/communications/sms-fabric.server";

async function run(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return createSmsDispatchCronHandler({
    env: process.env,
    db: supabaseAdmin as unknown as SmsFabricDatabase,
  })(request);
}

export const Route = createFileRoute("/api/public/cron/sms-dispatch")({
  server: { handlers: { GET: ({ request }) => run(request), POST: ({ request }) => run(request) } },
});
