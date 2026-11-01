import { writeAuditRecord } from "@/lib/server/write-audit";

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type ConsoleAccessContext = {
  supabase: unknown;
  userId: string;
};

const PLATFORM_OPERATIONS_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  "platform.operations.read": [
    "overview.read",
    "organization.summary.read",
    "incident.summary.read",
  ],
  "platform.audit.read": ["audit.read", "logs.search"],
  "platform.operations.assign": ["organization.assign_operations"],
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function hasConsoleCapability(
  context: ConsoleAccessContext,
  capability: string,
  platformOperationsAction?: string | null,
): Promise<boolean> {
  const rpc = context.supabase as RpcClient;
  const { data: isSuperAdmin, error: superError } = await rpc.rpc("is_super_admin");
  if (superError) throw new Error("Unable to resolve console identity.");

  if (isSuperAdmin === true) {
    const operation =
      platformOperationsAction === undefined
        ? PLATFORM_OPERATIONS_ACTIONS[capability]?.[0]
        : platformOperationsAction;
    if (!operation || !PLATFORM_OPERATIONS_ACTIONS[capability]?.includes(operation)) return false;
    await auditPlatformOperationsBypass(context, capability, operation);
    return true;
  }

  const { data, error } = await rpc.rpc("has_internal_console_capability", {
    p_capability: capability,
  });
  if (error) throw new Error("Unable to resolve console capability.");
  return data === true;
}

export async function assertConsoleCapability(
  context: ConsoleAccessContext,
  capability: string,
  platformOperationsAction?: string,
): Promise<boolean> {
  const rpc = context.supabase as RpcClient;
  const { data: isSuperAdmin, error: superError } = await rpc.rpc("is_super_admin");
  if (superError) throw new Error("Unable to resolve console identity.");

  if (isSuperAdmin === true) {
    if (!PLATFORM_OPERATIONS_ACTIONS[capability]?.includes(platformOperationsAction ?? "")) {
      throw new Error("Not authorized");
    }
    await auditPlatformOperationsBypass(context, capability, platformOperationsAction as string);
    return true;
  }

  const { data, error } = await rpc.rpc("has_internal_console_capability", {
    p_capability: capability,
  });
  if (error || data !== true) throw new Error("Not authorized");
  return false;
}

async function auditPlatformOperationsBypass(
  context: ConsoleAccessContext,
  capability: string,
  operation: string,
): Promise<void> {
  await writeAuditRecord(await admin(), {
    action: "platform_operations.capability_bypass",
    gate: `is_super_admin:${operation}`,
    tenantId: null,
    actorId: context.userId,
    table: "platform_authorization",
    outcome: "succeeded",
    details: { capability, operation },
  });
}
