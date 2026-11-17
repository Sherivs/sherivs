import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { runWorkflowTick } from "@/lib/workflow/workflow-runtime";
import type { WorkflowRuntimePort, WorkflowTickOptions } from "@/lib/workflow/workflow-runtime";

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
      const executeAction = dependencies.createActionExecutor
        ? await dependencies.createActionExecutor(env)
        : dependencies.createPort
          ? undefined
          : (await import("@/lib/workflow/workflow-action-runtime.server"))
              .createWorkflowActionExecutor(env);
      const counts = await runWorkflowTick(port, {
        worker: "workflow-tick",
        limit: 50,
        leaseSeconds: 60,
        budgetMs: 45_000,
        ...(executeAction ? { executeAction } : {}),
      });
      return Response.json({ ok: true, ...counts });
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
