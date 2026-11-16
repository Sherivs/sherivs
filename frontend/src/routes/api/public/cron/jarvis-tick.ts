/**
 * Scheduled job endpoint (JARVIS-LIVE-01): run one owner-alert tick. Call it every five minutes
 * with `Authorization: Bearer $CRON_SECRET` from the same external scheduler as the other cron
 * routes. Returns 503 until CRON_SECRET is set. The response is counts and codes only: no
 * destination, message body or provider text.
 *
 * The tick itself fails closed: while JARVIS is paused it does nothing, and until the
 * owner-alert tables exist and the console origin is known it reports `not_configured`. Real
 * sends additionally need mode `live`, an unexpired owner authorization naming the channel, the
 * owner's destination and that provider's secrets (see owner-alert-sender.server.ts).
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import {
  createOwnerAlertPorts,
  type AlertDbClient,
} from "@/lib/jarvis-bridge/owner-alert-store.server";
import { createOwnerAlertSender } from "@/lib/jarvis-bridge/owner-alert-sender.server";
import { runOwnerAlertTick } from "@/lib/jarvis-bridge/owner-alert-tick";
import { JARVIS_SERVICE_ACTOR } from "@/lib/jarvis-bridge/service-identity";
import { CONSOLE_ORIGIN } from "@/lib/experience/console-host-routing";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";

const timeAuthority = new TimeAuthority(new SystemClock());

function authorized(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

async function run(request: Request): Promise<Response> {
  const cron = process.env.CRON_SECRET;
  if (!cron) return new Response("JARVIS tick not configured", { status: 503 });
  if (!authorized(request.headers.get("authorization"), cron))
    return new Response("Unauthorized", { status: 401 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    const ports = createOwnerAlertPorts(
      {
        db: supabaseAdmin as unknown as AlertDbClient,
        consoleOrigin: CONSOLE_ORIGIN,
        nowMs: () => timeAuthority.now().atMs,
      },
      createOwnerAlertSender({ env: process.env }),
    );
    const report = await runOwnerAlertTick(ports);
    try {
      const { writeAuditRecord } = await import("@/lib/server/write-audit");
      await writeAuditRecord(supabaseAdmin as never, {
        action: "jarvis.owner_alert.tick",
        gate: "service_identity:svc:jarvis",
        tenantId: null,
        actorId: null,
        actorRef: JARVIS_SERVICE_ACTOR,
        actorKind: "agent",
        actorEmail: JARVIS_SERVICE_ACTOR,
        table: "owner_alerts",
        outcome: report.status === "ok" ? "succeeded" : "denied",
        details: {
          status: report.status,
          signals: report.signals,
          alerts: report.alertsHandled,
          errors: report.errors.length,
        },
      });
    } catch {
      /* the tick's own tables are the record; audit is best effort */
    }
    return Response.json({ ok: report.status === "ok", ...report });
  } catch {
    return Response.json({ ok: false, error: "tick_failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/jarvis-tick")({
  server: { handlers: { GET: ({ request }) => run(request), POST: ({ request }) => run(request) } },
});
