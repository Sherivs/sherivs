/**
 * Scheduled job endpoint (SHERIVS-093): Integration Hub worker.
 * 1. claims due sync_jobs and pulls one batch of pages per job from Fedena / Moodle / OneRoster / Google Classroom,
 * 2. delivers queued outbound write-back events (signed like inbound webhooks).
 * Call with `Authorization: Bearer $CRON_SECRET` (Vercel Cron every 15 minutes, the n8n server, or any scheduler).
 * Returns 503 until CRON_SECRET and the Sherivs Vault (KMS) are configured.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

function authorized(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

async function run(request: Request): Promise<Response> {
  const cron = process.env.CRON_SECRET;
  if (!cron) return new Response("Integration worker not configured", { status: 503 });
  if (!authorized(request.headers.get("authorization"), cron))
    return new Response("Unauthorized", { status: 401 });
  const { getIntegrationVault } = await import("@/lib/integrations-hub/vault.server");
  const vault = await getIntegrationVault();
  if (!vault) return new Response("Integration worker not configured", { status: 503 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { runIntegrationWorker } = await import("@/lib/integrations-hub/runtime.server");
  const { safeFetch } = await import("@/lib/integrations-hub/http.server");
  try {
    const report = await runIntegrationWorker({
      db: supabaseAdmin as never,
      vault,
      fetch: safeFetch,
      deadlineMs: Date.now() + 45_000,
    });
    return Response.json({ ok: true, ...report });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/cron/integrations-sync")({
  server: { handlers: { GET: ({ request }) => run(request), POST: ({ request }) => run(request) } },
});
