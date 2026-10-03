/**
 * CoreGrid Mobile — worker/agent status client (read-only).
 *
 * The sanctioned tenant-scoped read path in the web app is the
 * `listIdentities` server function (frontend/src/lib/identity-registry
 * .functions.ts), which resolves the tenant from the actor's school-admin
 * scope and reads `cg_identity` through the service role after the gate.
 * Mobile consumes that SAME endpoint via the `/_serverFn/<id>` URL
 * contract and validates the response against the mirrored contract —
 * including the tenant-boundary check against the actor's resolved tenant.
 */
import { listIdentitiesResponseSchema, type ListIdentitiesResponse } from "./contracts/identity-contracts";
import { ApiError } from "./errors";
import { invokeServerFn, type ServerFnCaller } from "./serverFn.client";

export interface WorkerAgentQuery {
  readonly limit?: number;
  readonly kind?: string;
}

export async function listWorkerAgents(
  caller: ServerFnCaller,
  expectedTenantId: string,
  query: WorkerAgentQuery = {},
): Promise<ListIdentitiesResponse> {
  const input: Record<string, number | string> = {};
  if (query.limit !== undefined) input.limit = query.limit;
  if (query.kind !== undefined) input.kind = query.kind;

  const payload = await invokeServerFn<unknown>(caller, "listIdentities", input);
  const parsed = listIdentitiesResponseSchema.parse(payload);
  if (parsed.tenant_id !== expectedTenantId) {
    throw new ApiError("authorization", "identity listing returned a foreign tenant scope");
  }
  return parsed;
}