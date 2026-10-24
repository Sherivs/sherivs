/**
 * Scheduled job endpoint (SHERIVS-028): reconcile pending wallet top-ups.
 * Call with `Authorization: Bearer $CRON_SECRET` (Vercel Cron, the n8n server, or any scheduler).
 * Returns 503 until CRON_SECRET and a Paystack TEST key are configured; never runs on a live key.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { reconcileWalletTopups } from "@/lib/payments/wallet-topup-reconcile.server";

function authorized(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

async function run(request: Request): Promise<Response> {
  const cron = process.env.CRON_SECRET;
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!cron || !key || !key.startsWith("sk_test_")) return new Response("Reconciliation not configured", { status: 503 });
  if (!authorized(request.headers.get("authorization"), cron)) return new Response("Unauthorized", { status: 401 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    const report = await reconcileWalletTopups({ admin: supabaseAdmin as never, secret: key });
    return Response.json({ ok: true, ...report });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/wallet-topup-reconcile")({
  server: { handlers: { GET: ({ request }) => run(request), POST: ({ request }) => run(request) } },
});
