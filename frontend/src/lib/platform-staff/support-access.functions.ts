/**
 * Sherivs internal console phase 4 — time-limited, audited support access
 * (SHERIVS-009) and the access-review read model.
 *
 * - Grants / revokes: super admin only, service role, audited.
 * - Support reads: the caller's own `has_support_access(school)` (RLS-scoped
 *   RPC) must be true; every read is audited against that tenant.
 * - Access review: `platform.audit.read` capability (super admin or Security
 *   / Platform admin staff).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requirePlatformSuperAdmin } from "@/lib/security-role-gate";
import { assertInternalAal2 } from "@/lib/security/mfa-server";
import { writeAuditRecord } from "@/lib/server/write-audit";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";

const timeAuthority = new TimeAuthority(new SystemClock());

export const SUPPORT_GRANT_MAX_HOURS = 8;

export type SecurityAlert = {
  kind: "failed_login_spike" | "super_admin_change" | "role_escalation";
  subject: string;
  event_count: number;
  first_at: string;
  last_at: string;
};

type Ctx = {
  supabase: Parameters<typeof requirePlatformSuperAdmin>[0];
  claims: { exp: number };
  userId: string;
};

async function assertSuper(context: Ctx) {
  assertInternalAal2((context as { claims?: { aal?: unknown } }).claims);
  await requirePlatformSuperAdmin(context.supabase, {
    lifecycle: null,
    sessionValid:
      typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
  });
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Capability check through the caller's own session (database is the authority). */
async function assertCapability(context: Ctx, capability: string) {
  assertInternalAal2((context as { claims?: { aal?: unknown } }).claims);
  const { assertConsoleCapability } = await import("@/lib/internal-console/console-access.server");
  await assertConsoleCapability(context, capability, "audit.read");
}

/* ---------- grant ---------- */
const grantSchema = z.object({
  staffId: z.string().uuid(),
  schoolId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
  hours: z.number().int().min(1).max(SUPPORT_GRANT_MAX_HOURS),
});

export const grantSupportAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => grantSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    const db = await admin();
    const { data: staff } = await db
      .from("platform_staff")
      .select("id, status, platform_staff_roles(role_code)")
      .eq("id", data.staffId)
      .maybeSingle();
    const roles = ((staff?.platform_staff_roles ?? []) as Array<{ role_code: string }>).map(
      (r) => r.role_code,
    );
    if (!staff || staff.status !== "active") throw new Error("Staff member is not active.");
    if (!roles.includes("support") && !roles.includes("platform_admin"))
      throw new Error("Only Support staff can receive support access.");
    const { data: school } = await db
      .from("schools")
      .select("id")
      .eq("id", data.schoolId)
      .maybeSingle();
    if (!school) throw new Error("Organization not found");

    const now = timeAuthority.now().atMs;
    const expiresAt = new Date(now + data.hours * 3_600_000).toISOString();
    const { data: grant, error } = await db
      .from("platform_support_grants")
      .insert({
        staff_id: data.staffId,
        tenant_id: data.schoolId,
        reason: data.reason,
        granted_by: context.userId,
        starts_at: new Date(now).toISOString(),
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditRecord(db, {
      action: "platform_support.grant",
      gate: "requirePlatformSuperAdmin",
      tenantId: data.schoolId,
      actorId: context.userId,
      table: "platform_support_grants",
      recordId: grant.id,
      outcome: "succeeded",
      details: { staff_id: data.staffId, hours: data.hours, reason: data.reason },
    });
    return { id: grant.id, expiresAt };
  });

/* ---------- revoke ---------- */
export const revokeSupportAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ grantId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    const db = await admin();
    const { data: g, error } = await db
      .from("platform_support_grants")
      .update({ revoked_at: timeAuthority.now().at, revoked_by: context.userId })
      .eq("id", data.grantId)
      .is("revoked_at", null)
      .select("id, tenant_id, staff_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!g) throw new Error("Grant not found or already revoked");
    await writeAuditRecord(db, {
      action: "platform_support.revoke",
      gate: "requirePlatformSuperAdmin",
      tenantId: g.tenant_id,
      actorId: context.userId,
      table: "platform_support_grants",
      recordId: g.id,
      outcome: "succeeded",
      details: { staff_id: g.staff_id },
    });
    return { ok: true };
  });

/* ---------- my grants (RLS: own rows; audit readers see all) ---------- */
export const listSupportGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as unknown as SupabaseClient<Database>;
    const { data, error } = await db
      .from("platform_support_grants")
      .select("id, staff_id, tenant_id, reason, starts_at, expires_at, revoked_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("Could not load grants");
    const nowMs = timeAuthority.now().atMs;
    return (data ?? []).map((g) => ({
      ...g,
      active: !g.revoked_at && Date.parse(g.expires_at) > nowMs,
    }));
  });

/* ---------- support read: tenant summary under an active grant ---------- */
export const readSupportTenantSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ schoolId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await (context.supabase as unknown as RpcClient).rpc(
      "has_support_access",
      { p_tenant: data.schoolId },
    );
    const db = await admin();
    if (error || ok !== true) {
      await writeAuditRecord(db, {
        action: "platform_support.read",
        gate: "has_support_access",
        tenantId: data.schoolId,
        actorId: context.userId,
        table: "schools",
        recordId: data.schoolId,
        outcome: "failed",
        details: { reason: "no_active_grant" },
      });
      throw new Error("No active support access for this organization.");
    }
    const [{ data: school }, { count: members }] = await Promise.all([
      db
        .from("schools")
        .select("id, name, slug, is_active, subscription_tier, subscription_status, created_at")
        .eq("id", data.schoolId)
        .maybeSingle(),
      db.from("users").select("id", { count: "exact", head: true }).eq("school_id", data.schoolId),
    ]);
    await writeAuditRecord(db, {
      action: "platform_support.read",
      gate: "has_support_access",
      tenantId: data.schoolId,
      actorId: context.userId,
      table: "schools",
      recordId: data.schoolId,
      outcome: "succeeded",
      details: { view: "tenant_summary" },
    });
    return { school, memberCount: members ?? 0 };
  });

/* ---------- access review ---------- */
export const getAccessReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCapability(context, "platform.audit.read");
    const db = await admin();
    const nowIso = timeAuthority.now().at;
    const [staff, grants, events, supers] = await Promise.all([
      db
        .from("platform_staff")
        .select("id, email, full_name, status, activated_at, platform_staff_roles(role_code)")
        .order("email")
        .limit(500),
      db
        .from("platform_support_grants")
        .select("id, staff_id, tenant_id, reason, expires_at")
        .is("revoked_at", null)
        .gt("expires_at", nowIso)
        .limit(500),
      db
        .from("audit_logs")
        .select("id, action, user_id, school_id, record_id, created_at")
        .or("action.like.platform_staff.%,action.like.platform_support.%")
        .order("created_at", { ascending: false })
        .limit(100),
      db.from("super_admins").select("id, email, full_name, is_active"),
    ]);
    // Security P2 (SHERIVS-010): alert scan. Absent until 0170 is applied —
    // the review still renders, with alertsAvailable=false.
    const alertsRes = await (db as unknown as RpcClient).rpc("security_alerts", {
      p_hours: 24,
      p_failed_login_threshold: 10,
    });
    await writeAuditRecord(db, {
      action: "platform_access_review.view",
      gate: "has_internal_console_capability:platform.audit.read",
      tenantId: null,
      actorId: context.userId,
      table: "platform_staff",
      outcome: "succeeded",
    });
    return {
      superAdmins: supers.data ?? [],
      staff: (staff.data ?? []).map((s) => ({
        ...s,
        roles: ((s.platform_staff_roles ?? []) as Array<{ role_code: string }>).map(
          (r) => r.role_code,
        ),
      })),
      activeGrants: grants.data ?? [],
      recentEvents: events.data ?? [],
      alertsAvailable: !alertsRes.error,
      alerts: (alertsRes.error ? [] : ((alertsRes.data ?? []) as SecurityAlert[])).slice(0, 100),
    };
  });
