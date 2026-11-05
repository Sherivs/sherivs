/**
 * Resend delivery / bounce / complaint webhook (COMMS-04). Svix-signature verified;
 * the organization is resolved from our own outbound_messages row, never the payload.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createPostgresChainStore } from "@/lib/communications/africas-talking-voice.server";
import {
  createEmailAuditRecorder,
  createResendWebhookHandler,
  type ResendFabricDatabase,
} from "@/lib/communications/resend-fabric.server";

export const Route = createFileRoute("/api/public/webhooks/resend")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as unknown as ResendFabricDatabase;
        const handler = createResendWebhookHandler({
          env: process.env,
          db,
          audit: createEmailAuditRecorder(
            createPostgresChainStore(db as unknown as Parameters<typeof createPostgresChainStore>[0]),
          ),
        });
        return handler(request);
      },
    },
  },
});
