/**
 * Authorized Internal Console activity, audit, and security reads.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertInternalAal2 } from "@/lib/security/mfa-server";
import { writeAuditRecord } from "@/lib/server/write-audit";
import type { ConsoleActivityItem } from "./overview";

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

type Ctx = {
  supabase: { rpc: RpcClient["rpc"] };
  claims: { exp: number; aal?: unknown };
  userId: string;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function assertCapability(context: Ctx, capability: string) {
  assertInternalAal2(context.claims);
  const { assertConsoleCapability } = await import("./console-access.server");
  await assertConsoleCapability(context, capability, "audit.read");
}

function describeAction(action: string): string {
  return action.replace(/[._]/g, " ");
}

const listSchema = z.object({
  scope: z.enum(["admin", "security", "all"]).default("all"),
  limit: z.number().int().min(1).max(200).default(80),
});

export const listConsoleAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listSchema.parse(input ?? {}))
  .handler(
    async ({ data, context }): Promise<{ events: ConsoleActivityItem[]; source: string }> => {
      await assertCapability(context as unknown as Ctx, "platform.audit.read");
      const db = await admin();
      const filter =
        data.scope === "security"
          ? "action.like.platform_staff.status.%,action.like.platform_staff.set_roles,action.like.platform_support.%,action.like.platform_organization.state.suspended,action.like.platform_organization.state.deactivated"
          : "action.like.platform_staff.%,action.like.platform_support.%,action.like.platform_access_review.%,action.like.platform_workspace.%,action.like.platform_organization.%";
      const { data: rows, error } = await db
        .from("audit_logs")
        .select("id, action, user_id, record_id, created_at, new_value")
        .or(filter)
        .order("created_at", { ascending: false })
        .limit(data.limit);
      if (error) throw new Error(error.message);
      await writeAuditRecord(db, {
        action: "platform_console.audit.view",
        gate: "has_internal_console_capability:platform.audit.read",
        tenantId: null,
        actorId: context.userId,
        table: "audit_logs",
        outcome: "succeeded",
        details: { scope: data.scope, count: (rows ?? []).length },
      });
      const events: ConsoleActivityItem[] = (rows ?? []).map((row) => {
        const payload = (row.new_value ?? {}) as { outcome?: string };
        return {
          id: String(row.id),
          description: describeAction(row.action),
          actor: row.user_id,
          target: row.record_id,
          at: row.created_at ?? new Date(0).toISOString(),
          outcome: typeof payload.outcome === "string" ? payload.outcome : "recorded",
          action: row.action,
        };
      });
      return { events, source: "audit_logs (control-plane platform_* actions)" };
    },
  );
