import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

/**
 * WF-12: the scheduled retention pass (ADR-124). Only organisations that opted in to automatic purge
 * are touched, each at most once a day, each within its own windows, and the database refuses while a
 * legal hold is active. The function carries no organisation or window from the request: the caller
 * is the cron secret and nothing else. Not registered in the Cloudflare cron worker in this change.
 */
type RetentionEnv = Record<string, string | undefined>;
const BEARER_SCHEME = "Bearer";
const MAX_ORGS_PER_PASS = 20;

function isAuthorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`${BEARER_SCHEME} ${secret}`);
  const received = Buffer.from(header ?? "", "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createWorkflowRetentionHandler(dependencies: {
  env?: RetentionEnv;
  runScheduled?: (maxOrgs: number) => Promise<unknown>;
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
        dependencies.runScheduled ??
        (async (maxOrgs: number) => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await (
            supabaseAdmin as unknown as {
              rpc: (
                fn: string,
                args: Record<string, unknown>,
              ) => PromiseLike<{ data: unknown; error: unknown }>;
            }
          ).rpc("wf_retention_run_scheduled", { p_max_orgs: maxOrgs });
          if (error) throw new Error("workflow_retention_failed");
          return data;
        });
      const result = (await run(MAX_ORGS_PER_PASS)) as { orgs?: Array<Record<string, unknown>> };
      // Counts only: no organisation id, no row content leaves this route.
      const orgs = Array.isArray(result?.orgs) ? result.orgs : [];
      return Response.json({
        ok: true,
        organisations: orgs.length,
        refused: orgs.filter((o) => o?.outcome === "refused").length,
      });
    } catch {
      return Response.json({ ok: false, error: "workflow_retention_failed" }, { status: 500 });
    }
  };
}

const handle = createWorkflowRetentionHandler({});

export const Route = createFileRoute("/api/public/cron/workflow-retention")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
