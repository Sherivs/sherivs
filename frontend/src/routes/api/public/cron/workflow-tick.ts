import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { runWorkflowTick } from "@/lib/workflow/workflow-runtime";
import type { WorkflowRuntimePort, WorkflowTickOptions } from "@/lib/workflow/workflow-runtime";
import type { ApprovalSweepCounts } from "@/lib/workflow/workflow-approval-sweep.server";

type WorkflowTickEnv = Record<string, string | undefined>;
const BEARER_SCHEME = "Bearer";

function isAuthorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`${BEARER_SCHEME} ${secret}`);
  const received = Buffer.from(header ?? "", "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createWorkflowTickHandler(dependencies: {
  env?: WorkflowTickEnv;
  createPort?: () => WorkflowRuntimePort | Promise<WorkflowRuntimePort>;
  createActionExecutor?: (
    env: WorkflowTickEnv,
  ) =>
    | NonNullable<WorkflowTickOptions["executeAction"]>
    | Promise<NonNullable<WorkflowTickOptions["executeAction"]>>;
  /**
   * WF-07 approval sweep (request missing approvals, expire, dispatch approved drafts). Runs before
   * the tick so a draft approved since the last pass continues in the same cycle. Defaults to the
   * production sweep only when no test doubles are injected, so the existing tests are unchanged.
   */
  createApprovalSweep?: (env: WorkflowTickEnv) => () => Promise<ApprovalSweepCounts>;
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
      const createPort =
        dependencies.createPort ??
        (await import("@/lib/workflow/workflow-runtime.server")).createWorkflowRuntimePort;
      const port = await createPort();
      // Injected executors get no replay outcome lookup: a replayed action step then waits.
      const actionRuntime: Pick<WorkflowTickOptions, "executeAction" | "actionOutcome"> =
        dependencies.createActionExecutor
          ? { executeAction: await dependencies.createActionExecutor(env) }
          : dependencies.createPort
            ? {}
            : (
                await import("@/lib/workflow/workflow-action-runtime.server")
              ).createWorkflowActionRuntime(env);
      const production = !dependencies.createActionExecutor && !dependencies.createPort;
      let approvals: ApprovalSweepCounts | { failed: 1 } | undefined;
      if (dependencies.createApprovalSweep || production) {
        try {
          const sweep = dependencies.createApprovalSweep
            ? dependencies.createApprovalSweep(env)
            : (
                await import("@/lib/workflow/workflow-action-runtime.server")
              ).createWorkflowApprovalSweepRuntime(env);
          approvals = await sweep();
        } catch {
          // A sweep failure must not stop the tick; the next pass retries.
          approvals = { failed: 1 };
        }
      }
      const counts = await runWorkflowTick(port, {
        worker: "workflow-tick",
        limit: 50,
        leaseSeconds: 60,
        budgetMs: 45_000,
        ...actionRuntime,
      });
      return Response.json({ ok: true, ...counts, ...(approvals ? { approvals } : {}) });
    } catch {
      return Response.json({ ok: false, error: "workflow_tick_failed" }, { status: 500 });
    }
  };
}

const handle = createWorkflowTickHandler({});

export const Route = createFileRoute("/api/public/cron/workflow-tick")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
