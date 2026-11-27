/**
 * Scheduled job endpoint (ENGINE-23): send the organization notification outbox. Call it every
 * five minutes with an `Authorization` header whose value is the word Bearer, one space, then
 * the CRON_SECRET value, from Vercel Cron, the n8n server, or
 * any scheduler. Returns 503 until CRON_SECRET is set and the ENGINE-20 tables exist.
 *
 * Email goes through the Resend adapter and needs RESEND_API_KEY and RESEND_FROM_ADDRESS; without
 * them every email row is failed with a reason code and nothing is sent. Every attempt records a
 * `cg_delivery_evidence` row when the substrate is configured (M22, ADR-151). WhatsApp has no sender
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
import { createTransactionalEmailSender } from "@/lib/communications/email-send.server";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import {
  isTruthyFlag,
  pollExpoPushReceipts,
  revokeMobilePushDevicesById,
  type ExpoReceiptEntry,
} from "@/lib/push/expo-push.server";

const timeAuthority = new TimeAuthority(new SystemClock());

function authorized(header: string | null, secret: string): boolean {
  const want = Buffer.from(["Bearer", secret].join(" "));
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Email goes through the one transactional email path (Resend + delivery evidence, M22). */
function emailPort() {
  const send = createTransactionalEmailSender(process.env);
  return async (m: EmailSend): Promise<SendOutcome> => {
    const out = await send({
      id: m.id,
      tenantRef: m.orgId,
      recipientRef: m.recipientId,
      category: m.category,
      to: m.to,
      subject: m.subject,
      body: m.text,
    });
    return out.ok ? { ok: true } : { ok: false, reason: `email_${out.code}` };
  };
}

type OutboxPayload = {
  expo_pending_receipts?: Array<{ receiptId?: unknown; deviceId?: unknown }>;
  [key: string]: unknown;
};

async function pollExpoReceipts(supabaseAdmin: unknown): Promise<Response> {
  if (!isTruthyFlag(process.env.PUSH_EXPO_ENABLED)) {
    return Response.json({ ok: true, enabled: false, checked: 0, pruned: 0 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- org_notification_outbox is not in generated table unions.
  const { data, error } = await (supabaseAdmin as any)
    .from("org_notification_outbox")
    .select("id,payload")
    .eq("channel", "push")
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message.slice(0, 120));

  let checked = 0;
  let pruned = 0;
  const pruneErrors: string[] = [];

  for (const row of data ?? []) {
    const payload = (row.payload ?? {}) as OutboxPayload;
    const entries = (payload.expo_pending_receipts ?? [])
      .map((entry) => ({
        receiptId: typeof entry.receiptId === "string" ? entry.receiptId : "",
        deviceId: typeof entry.deviceId === "string" ? entry.deviceId : undefined,
      }))
      .filter((entry) => entry.receiptId.length > 0) as ExpoReceiptEntry[];

    if (!entries.length) continue;

    const polled = await pollExpoPushReceipts({
      entries,
      accessToken: process.env.EXPO_ACCESS_TOKEN,
    });

    checked += polled.checkedReceiptIds.length;
    if (polled.deviceIdsToPrune.length) {
      const pruneReason = await revokeMobilePushDevicesById(supabaseAdmin, polled.deviceIdsToPrune);
      if (pruneReason) {
        pruneErrors.push(pruneReason);
        console.warn("push_prune_failed", {
          reason: pruneReason,
          count: polled.deviceIdsToPrune.length,
        });
      } else pruned += polled.deviceIdsToPrune.length;
    }

    const checkedSet = new Set(polled.checkedReceiptIds);
    const remaining = entries.filter((entry) => !checkedSet.has(entry.receiptId));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- org_notification_outbox is not in generated table unions.
    await (supabaseAdmin as any)
      .from("org_notification_outbox")
      .update({
        payload: {
          ...payload,
          expo_pending_receipts: remaining,
          expo_receipt_checked_at: timeAuthority.now().at,
        },
      })
      .eq("id", row.id);
  }

  return Response.json({ ok: true, enabled: true, checked, pruned, pruneErrors });
}

async function run(request: Request): Promise<Response> {
  const cron = process.env.CRON_SECRET;
  if (!cron) return new Response("Notifications not configured", { status: 503 });
  if (!authorized(request.headers.get("authorization"), cron))
    return new Response("Unauthorized", { status: 401 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { deliverPushToUsers } = await import("@/lib/push.server");

  if (new URL(request.url).searchParams.get("mode") === "expo-receipts") {
    try {
      return await pollExpoReceipts(supabaseAdmin);
    } catch (e) {
      return Response.json(
        { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : "failed" },
        { status: 500 },
      );
    }
  }

  try {
    const result = await runNotificationWorker({
      admin: supabaseAdmin as unknown as WorkerClient,
      ports: {
        sendEmail: emailPort(),
        sendPush: async (m) => {
          const delivery = await deliverPushToUsers(supabaseAdmin, [m.recipientId], {
            category: m.category,
            route: m.route,
            notificationId: m.id,
            title: m.title,
            body: m.body,
            redacted: m.redacted,
            safeguarding: m.safeguarding,
            severity: m.severity,
          });

          if (delivery.expoReceipts?.length) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- org_notification_outbox is not in generated table unions.
            await (supabaseAdmin as any)
              .from("org_notification_outbox")
              .update({
                payload: {
                  ...m.payload,
                  expo_pending_receipts: delivery.expoReceipts,
                },
              })
              .eq("id", m.id);
          }

          if ((delivery.delivered ?? 0) + (delivery.expoDelivered ?? 0) > 0) return { ok: true };
          return { ok: false, reason: delivery.skippedReason ?? "push_not_delivered" };
        },
      },
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
