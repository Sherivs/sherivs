/**
 * WF-08: server functions behind tenant run history, retry and cancel (ADR-123).
 *
 * Every function requires a signed-in session; the person's id comes from the verified session and
 * is passed to SECURITY DEFINER database functions that decide everything else (organisation,
 * permission, what a retry may never do) and redact what they return. Results carry codes and
 * counts, never recipients, parameters, payloads or free text. Time never enters here.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  RunCancelInput,
  RunHistoryError,
  RunIdInput,
  RunListInput,
  RunRetryInput,
  runErrorMessage,
} from "./workflow/run-history";
import type { RunHistoryPorts } from "./workflow/run-history.server";

type Rpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: unknown; code?: unknown } | null }>;
};

async function ports(): Promise<RunHistoryPorts> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { rpc: (fn, args) => (supabaseAdmin as unknown as Rpc).rpc(fn, args) };
}

/** Server functions throw plain messages; a refusal carries its safe sentence, nothing else. */
function surface(err: unknown): never {
  if (err instanceof RunHistoryError) throw new Error(err.message);
  throw new Error(runErrorMessage("unavailable"));
}

export const listWorkflowRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RunListInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { listRuns } = await import("./workflow/run-history.server");
      return await listRuns(await ports(), { actorId: context.userId, ...data });
    } catch (err) {
      return surface(err);
    }
  });

export const getWorkflowRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RunIdInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { viewRun } = await import("./workflow/run-history.server");
      return await viewRun(await ports(), { actorId: context.userId, runId: data.runId });
    } catch (err) {
      return surface(err);
    }
  });

export const cancelWorkflowRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RunCancelInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { cancelRun } = await import("./workflow/run-history.server");
      return await cancelRun(await ports(), { actorId: context.userId, ...data });
    } catch (err) {
      return surface(err);
    }
  });

export const retryWorkflowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RunRetryInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { retryStep } = await import("./workflow/run-history.server");
      return await retryStep(await ports(), { actorId: context.userId, ...data });
    } catch (err) {
      return surface(err);
    }
  });
