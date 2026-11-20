/**
 * WF-12: server operations behind workflow limits and retention (ADR-124). Ports only: no database
 * or request import, so the whole path runs in a unit test and in the sim e2e against the real
 * functions.
 *
 * Authority is the database's. Every call passes the VERIFIED user id (from the signed-in session,
 * never from the request body) to a SECURITY DEFINER function that derives the organisation, checks
 * `workflows.view` or `workflows.manage`, validates against the safe bounds and audits the change.
 * Nothing here re-decides or relaxes any of that.
 */
import {
  LimitsError,
  limitErrorFromDatabase,
  parseLimitsUpdateResult,
  parseLimitsView,
  parseRetentionResult,
  type LimitsPatch,
  type LimitsView,
  type OrgLimits,
  type RetentionResult,
} from "./limits";

export interface LimitsRpcResult {
  readonly data: unknown;
  readonly error: { readonly message?: unknown; readonly code?: unknown } | null;
}

export interface LimitsPorts {
  readonly rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<LimitsRpcResult>;
}

async function call(
  ports: LimitsPorts,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let result: LimitsRpcResult;
  try {
    result = await ports.rpc(fn, args);
  } catch {
    throw new LimitsError("unavailable");
  }
  if (result.error) throw limitErrorFromDatabase(result.error);
  return result.data;
}

export async function getLimits(
  ports: LimitsPorts,
  input: { actorId: string },
): Promise<LimitsView> {
  return parseLimitsView(await call(ports, "wf_limits_get", { p_actor: input.actorId }));
}

export async function updateLimits(
  ports: LimitsPorts,
  input: { actorId: string; patch: LimitsPatch },
): Promise<OrgLimits> {
  return parseLimitsUpdateResult(
    await call(ports, "wf_limits_update", { p_actor: input.actorId, p_patch: input.patch }),
  );
}

export async function runRetention(
  ports: LimitsPorts,
  input: { actorId: string; dryRun: boolean; dryRunId: string | null },
): Promise<RetentionResult> {
  return parseRetentionResult(
    await call(ports, "wf_retention_run_manual", {
      p_actor: input.actorId,
      p_dry_run: input.dryRun,
      p_dry_run_id: input.dryRunId,
    }),
  );
}
