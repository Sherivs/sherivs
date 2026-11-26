/**
 * WF-08: server operations behind tenant run history (ADR-123). Ports only: no database or request
 * import, so the whole path runs in a unit test and in the sim e2e against the real functions.
 *
 * Authority is the database's. Every call passes the VERIFIED user id (from the signed-in session,
 * never from the request body) to a SECURITY DEFINER function that checks `workflows.view`,
 * `workflows.run` or `workflows.manage` for that person's own organisation, redacts what it
 * returns, and (for retry and cancel) is idempotent and audited. Nothing here re-decides or relaxes
 * any of that; this file only forwards, parses strictly and maps errors to safe sentences.
 */
import {
  RunHistoryError,
  parseCancelResult,
  parseRetryResult,
  parseRunDetail,
  parseRunList,
  runErrorFromDatabase,
  type RunCancelResult,
  type RunControlReason,
  type RunDetail,
  type RunHistoryFilter,
  type RunList,
  type RunRetryResult,
} from "./run-history";

export interface RunRpcResult {
  readonly data: unknown;
  readonly error: { readonly message?: unknown; readonly code?: unknown } | null;
}

export interface RunHistoryPorts {
  readonly rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RunRpcResult>;
}

async function call(
  ports: RunHistoryPorts,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let result: RunRpcResult;
  try {
    result = await ports.rpc(fn, args);
  } catch {
    throw new RunHistoryError("unavailable");
  }
  if (result.error) throw runErrorFromDatabase(result.error);
  return result.data;
}

export async function listRuns(
  ports: RunHistoryPorts,
  input: {
    actorId: string;
    filter: RunHistoryFilter;
    workflow?: string;
    before?: string;
    beforeId?: string;
  },
): Promise<RunList> {
  const data = await call(ports, "wf_run_history_list", {
    p_actor: input.actorId,
    p_status: input.filter,
    p_workflow: input.workflow ?? null,
    p_before: input.before ?? null,
    p_limit: 25,
    p_before_id: input.beforeId ?? null,
  });
  return parseRunList(data);
}

export async function viewRun(
  ports: RunHistoryPorts,
  input: { actorId: string; runId: string },
): Promise<RunDetail> {
  const data = await call(ports, "wf_run_history_detail", {
    p_actor: input.actorId,
    p_run: input.runId,
  });
  return parseRunDetail(data);
}

export async function cancelRun(
  ports: RunHistoryPorts,
  input: { actorId: string; runId: string; reason: RunControlReason },
): Promise<RunCancelResult> {
  const data = await call(ports, "wf_run_cancel", {
    p_actor: input.actorId,
    p_run: input.runId,
    p_reason: input.reason,
  });
  return parseCancelResult(data);
}

export async function retryStep(
  ports: RunHistoryPorts,
  input: { actorId: string; stepId: string; reason: RunControlReason },
): Promise<RunRetryResult> {
  const data = await call(ports, "wf_run_retry", {
    p_actor: input.actorId,
    p_step: input.stepId,
    p_reason: input.reason,
  });
  return parseRetryResult(data);
}
