/**
 * BulkSMS Nigeria delivery-report webhook (COMMS-03). The provider does not sign requests, so
 * every callback carries a per-message HMAC token we minted at send time; the organization is
 * resolved from our own outbound_messages row, never from the payload.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  createBulkSmsWebhookHandler,
  type SmsFabricDatabase,
} from "@/lib/communications/sms-fabric.server";

export const Route = createFileRoute("/api/public/webhooks/bulksms")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const handler = createBulkSmsWebhookHandler({
          env: process.env,
          db: supabaseAdmin as unknown as SmsFabricDatabase,
        });
        return handler(request);
      },
    },
  },
});
