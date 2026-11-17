/**
 * Scheduled job endpoint (ENGINE-23): send the organization notification outbox. Call it every
 * five minutes with `Authorization: Bearer $CRON_SECRET` from Vercel Cron, the n8n server, or any
 * scheduler. Returns 503 until CRON_SECRET is set and the ENGINE-20 tables exist.
 *
 * Email goes through the Resend adapter and needs RESEND_API_KEY and RESEND_FROM_ADDRESS; without
 * them every email row is failed with a reason code and nothing is sent. WhatsApp has no sender
 * wired (see notification-worker.server.ts). SMS cannot be queued.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import {
  runNotificationWorker,
  type EmailSend,
  type SendOutcome,
  type WorkerClient,
} from "@/lib/org-workforce/notification-worker.server";
import {
  createResendEmailAdapter,
  createResendEmailProviderRegistry,
  resendEmailConfigFromEnv,
} from "@/lib/communications/resend-email.server";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import { isEmailDeliveryReceipt } from "@/lib/notifications/email-adapter-contract";

const timeAuthority = new TimeAuthority(new SystemClock());

function authorized(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

function emailPort() {
  const adapter = createResendEmailAdapter(resendEmailConfigFromEnv(process.env));
  const registry = createResendEmailProviderRegistry(process.env);
  return async (m: EmailSend): Promise<SendOutcome> => {
    const result = await adapter.send(
      {
        notification: {
          id: m.id,
          tenantRef: m.orgId,
          recipientRef: m.recipientId,
          audienceKind: "user",
          category: m.category,
          subject: m.subject,
          body: m.text,
          actionRef: null,
          state: "queued",
          createdAt: timeAuthority.now().at,
        },
        recipientAddress: m.to,
        subject: m.subject,
        body: m.text,
      },
      registry,
    );
    if (isEmailDeliveryReceipt(result)) return { ok: true };
    // Codes only: the provider's own wording can echo an address.
    return { ok: false, reason: `email_${result.code}` };
  };
}

async function run(request: Request): Promise<Response> {
  const cron = process.env.CRON_SECRET;
  if (!cron) return new Response("Notifications not configured", { status: 503 });
  if (!authorized(request.headers.get("authorization"), cron))
    return new Response("Unauthorized", { status: 401 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    const result = await runNotificationWorker({
      admin: supabaseAdmin as unknown as WorkerClient,
      ports: { sendEmail: emailPort() },
    });
    if (result.status === "not_applied") {
      return Response.json({ ok: false, error: "org_agent_tables_not_applied" }, { status: 503 });
    }
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : "failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/cron/org-notifications")({
  server: { handlers: { GET: ({ request }) => run(request), POST: ({ request }) => run(request) } },
});
