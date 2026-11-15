/**
 * Scheduled job endpoint (ENGINE-21): build the weekly report for each organization that has an
 * agent switched on. Call it Monday 06:30 UTC (07:30 in Lagos) with
 * `Authorization: Bearer $CRON_SECRET` from Vercel Cron, the n8n server, or any scheduler.
 * Returns 503 until CRON_SECRET is set and the ENGINE-20 database proposal is applied.
 * It builds and stores reports and queues one email to the administrator; the notification worker
 * (`/api/public/cron/org-notifications`) sends it.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { runWeeklyReports, type JobClient } from "@/lib/org-workforce/weekly-report-job.server";

function authorized(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

async function run(request: Request): Promise<Response> {
  const cron = process.env.CRON_SECRET;
  if (!cron) return new Response("Weekly reports not configured", { status: 503 });
  if (!authorized(request.headers.get("authorization"), cron))
    return new Response("Unauthorized", { status: 401 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    const result = await runWeeklyReports({
      admin: supabaseAdmin as unknown as JobClient,
      now: new Date(),
    });
    if (result.status === "not_applied") {
      return Response.json({ ok: false, error: "org_agent_tables_not_applied" }, { status: 503 });
    }
    return Response.json({ ok: result.failed.length === 0, ...result });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/cron/org-weekly-reports")({
  server: { handlers: { GET: ({ request }) => run(request), POST: ({ request }) => run(request) } },
});
