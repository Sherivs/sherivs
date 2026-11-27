import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

/**
 * WF-15a3: the scheduled fee-reminder scan (ADR-137). It asks the database to emit due-date-relative reminder events
 * (`wf_fee_reminder_scan`, ADR-136); it sends nothing itself. The function takes no organisation, window or invoice
 * from the request: the caller is the cron secret and nothing else. Organisations without workflows enabled emit
 * nothing. Not registered in the Cloudflare cron worker in this change.
 */
type ScanEnv = Record<string, string | undefined>;
const BEARER_SCHEME = "Bearer";
const SCAN_LIMIT = 500;

function isAuthorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`${BEARER_SCHEME} ${secret}`);
  const received = Buffer.from(header ?? "", "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createFeeReminderScanHandler(dependencies: {
  env?: ScanEnv;
  scan?: (limit: number) => Promise<unknown>;
}) {
  const env = dependencies.env ?? process.env;
  return async (request: Request): Promise<Response> => {
    const secret = env.CRON_SECRET;
    if (!secret) return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
    if (!isAuthorized(request.headers.get("authorization"), secret)) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    if (env.WORKFLOWS_ENABLED !== "true") {
      return Response.json({ ok: true, skipped: "workflows_disabled" });
    }
    try {
      const run =
        dependencies.scan ??
        (async (limit: number) => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await (
            supabaseAdmin as unknown as {
              rpc: (
                fn: string,
                args: Record<string, unknown>,
              ) => PromiseLike<{ data: unknown; error: unknown }>;
            }
          ).rpc("wf_fee_reminder_scan", { p_limit: limit });
          if (error) throw new Error("fee_reminder_scan_failed");
          return data;
        });
      const result = (await run(SCAN_LIMIT)) as {
        scanned?: number;
        emitted?: number;
        skipped_paid?: number;
      };
      // Counts only: no invoice, organisation or amount leaves this route.
      return Response.json({
        ok: true,
        scanned: Number(result?.scanned ?? 0),
        emitted: Number(result?.emitted ?? 0),
        skipped_paid: Number(result?.skipped_paid ?? 0),
      });
    } catch {
      return Response.json({ ok: false, error: "fee_reminder_scan_failed" }, { status: 500 });
    }
  };
}

const handle = createFeeReminderScanHandler({});

export const Route = createFileRoute("/api/public/cron/workflow-fee-reminders")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
