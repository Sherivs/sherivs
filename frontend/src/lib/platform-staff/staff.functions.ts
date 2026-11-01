/**
 * Sherivs internal console — platform staff administration (SHERIVS-008).
 *
 * Every write runs with the SERVICE ROLE after a capability check
 * (`platform.staff.manage`, which includes super admins). Privileged role
 * grants still require the platform-super-admin gate. Clients have no write
 * grant on platform_staff / platform_staff_roles (RLS + grants in migration
 * 20261020000150). Every operation is audited (control-plane scope, tenantId
 * null) — never secrets.
 *
 * `client.server` is imported INSIDE handlers so this file stays safe to
 * import from components.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requirePlatformSuperAdmin } from "@/lib/security-role-gate";
import { assertInternalAal2 } from "@/lib/security/mfa-server";
import { writeAuditRecord } from "@/lib/server/write-audit";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import {
  PLATFORM_ROLE_CODES,
  PRIVILEGED_PLATFORM_ROLES,
  canTransition,
  type PlatformStaffStatus,
} from "./catalogue";
import { CONSOLE_ORIGIN } from "@/lib/experience/console-host-routing";
import { isMissingRelation, store } from "@/lib/internal-console/store";

type GateContext = {
  supabase: Parameters<typeof requirePlatformSuperAdmin>[0];
  claims: { exp: number };
  userId: string;
};

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

async function assertSuper(context: GateContext) {
  assertInternalAal2((context as { claims?: { aal?: unknown } }).claims);
  await requirePlatformSuperAdmin(context.supabase, {
    lifecycle: null,
    sessionValid:
      typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
  });
}

async function assertCapability(context: GateContext, capability: string) {
  assertInternalAal2((context as { claims?: { aal?: unknown } }).claims);
  const { assertConsoleCapability } = await import("@/lib/internal-console/console-access.server");
  await assertConsoleCapability(context, capability);
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const timeAuthority = new TimeAuthority(new SystemClock());

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
function inviteRedirect(): string {
  // Supabase only honours redirects on the Auth → URL Configuration allow-list.
  let origin = CONSOLE_ORIGIN;
  try {
    origin = new URL(getRequest().url).origin;
  } catch {
    /* fall back to the Internal Console host */
  }
  return `${origin}/reset-password`;
}

function inviteExpiry(fromIso: string): string {
  const fromMs = Date.parse(fromIso);
  if (!Number.isFinite(fromMs)) throw new Error("invalid invitation time");
  return new Date(fromMs + INVITE_TTL_MS).toISOString();
}

async function audit(
  context: GateContext,
  action: string,
  recordId: string | null,
  outcome: "succeeded" | "failed",
  details: Record<string, unknown>,
) {
  await writeAuditRecord(await admin(), {
    action: `platform_staff.${action}`,
    gate: "requirePlatformSuperAdmin",
    tenantId: null,
    actorId: context.userId,
    table: "platform_staff",
    recordId,
    outcome,
    details,
  });
}

const roleList = z.array(z.enum(PLATFORM_ROLE_CODES)).max(PLATFORM_ROLE_CODES.length);

/* ---------- list ---------- */
export const listPlatformStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCapability(context, "platform.staff.read");
    const db = await admin();
    const { data, error } = await db
      .from("platform_staff")
      .select(
        "id, email, full_name, department, status, invited_at, activated_at, suspended_at, platform_staff_roles(role_code)",
      )
      .order("invited_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      department: r.department,
      status: r.status as PlatformStaffStatus,
      invitedAt: r.invited_at,
      activatedAt: r.activated_at,
      suspendedAt: r.suspended_at,
      roles: ((r.platform_staff_roles ?? []) as Array<{ role_code: string }>).map(
        (x) => x.role_code,
      ),
    }));
  });

/* ---------- invite ---------- */
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(2).max(120),
  department: z.string().trim().max(80).optional(),
  roles: roleList.min(1),
  initialWorkspaceId: z.string().uuid().optional(),
});

export const invitePlatformStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => inviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const privilegedGrant = data.roles.some((role) => PRIVILEGED_PLATFORM_ROLES.has(role));
    if (privilegedGrant) {
      await assertSuper(context);
      const { assertConsoleCapability } =
        await import("@/lib/internal-console/console-access.server");
      await assertConsoleCapability(
        context,
        "platform.staff.manage",
        "staff.privileged_role_approval",
      );
    } else {
      await assertCapability(context, "platform.staff.manage");
    }
    const db = await admin();

    const { data: existing } = await db
      .from("platform_staff")
      .select("id")
      .ilike("email", data.email)
      .maybeSingle();
    if (existing) throw new Error("That email is already platform staff.");

    if (data.initialWorkspaceId) {
      const { data: workspace, error: workspaceErr } = await store(db)
        .from("platform_workspace")
        .select("id, kind, status")
        .eq("id", data.initialWorkspaceId)
        .maybeSingle();
      if (workspaceErr) {
        throw new Error(
          isMissingRelation(workspaceErr)
            ? "Workspace store is not configured."
            : workspaceErr.message,
        );
      }
      const row = workspace as { id: string; kind: string; status: string } | null;
      if (!row || !["shared", "role"].includes(row.kind) || row.status !== "active") {
        throw new Error("Initial workspace must be an active shared or role workspace.");
      }
    }

    // Never repurpose an existing (e.g. customer) account into staff: invite
    // creates a NEW auth user; an existing account makes the invite fail.
    const { data: invited, error } = await db.auth.admin.inviteUserByEmail(data.email, {
      redirectTo: inviteRedirect(),
      data: { full_name: data.fullName, sherivs_staff: true },
    });
    if (error || !invited?.user) {
      await audit(context, "invite", null, "failed", { email: data.email, reason: error?.message });
      throw new Error(
        error?.message?.toLowerCase().includes("already")
          ? "An account with that email already exists. Use a dedicated Sherivs staff email."
          : (error?.message ?? "Invite failed"),
      );
    }
    const staffId = invited.user.id;

    const invitedAt = timeAuthority.now().at;
    const staffRow = {
      id: staffId,
      email: data.email,
      full_name: data.fullName,
      department: data.department || null,
      status: "invited",
      invited_by: context.userId,
      invited_at: invitedAt,
      invite_expires_at: inviteExpiry(invitedAt),
      initial_workspace_id: data.initialWorkspaceId ?? null,
    };
    let { error: insErr } = await db.from("platform_staff").insert(staffRow as never);
    if (insErr && /invite_expires_at|initial_workspace_id|schema cache/i.test(insErr.message)) {
      const retry = await db.from("platform_staff").insert({
        id: staffRow.id,
        email: staffRow.email,
        full_name: staffRow.full_name,
        department: staffRow.department,
        status: staffRow.status,
        invited_by: staffRow.invited_by,
        invited_at: staffRow.invited_at,
      });
      insErr = retry.error;
    }
    if (insErr) {
      // Do not leave a dangling invited auth user behind.
      await db.auth.admin.deleteUser(staffId);
      throw new Error(insErr.message);
    }
    const { error: roleErr } = await db.from("platform_staff_roles").insert(
      data.roles.map((role_code) => ({
        staff_id: staffId,
        role_code,
        granted_by: context.userId,
      })),
    );
    if (roleErr) throw new Error(roleErr.message);

    await audit(context, "invite", staffId, "succeeded", {
      email: data.email,
      roles: data.roles,
      department: data.department ?? null,
      initialWorkspaceId: data.initialWorkspaceId ?? null,
    });
    return { id: staffId };
  });

/* ---------- resend invite ---------- */
const idSchema = z.object({ staffId: z.string().uuid() });

async function loadStaff(staffId: string) {
  const db = await admin();
  const { data, error } = await db
    .from("platform_staff")
    .select("id, email, full_name, status")
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Staff member not found");
  return data as { id: string; email: string; full_name: string; status: PlatformStaffStatus };
}

export const resendPlatformStaffInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertCapability(context, "platform.staff.manage");
    const staff = await loadStaff(data.staffId);
    if (staff.status !== "invited") throw new Error("Only pending invites can be resent.");
    const db = await admin();
    const { error } = await db.auth.admin.inviteUserByEmail(staff.email, {
      redirectTo: inviteRedirect(),
      data: { full_name: staff.full_name, sherivs_staff: true },
    });
    // Unconfirmed invited users can be re-invited; if GoTrue refuses, fall
    // back to a recovery (set-password) email for the same account.
    if (error) {
      const { error: rErr } = await db.auth.resetPasswordForEmail(staff.email, {
        redirectTo: inviteRedirect(),
      });
      if (rErr) {
        await audit(context, "resend_invite", staff.id, "failed", { reason: rErr.message });
        throw new Error(rErr.message);
      }
    }
    const { error: expiryErr } = await db
      .from("platform_staff")
      .update({
        invite_expires_at: inviteExpiry(timeAuthority.now().at),
        updated_at: timeAuthority.now().at,
      } as never)
      .eq("id", staff.id);
    void expiryErr;
    await audit(context, "resend_invite", staff.id, "succeeded", { email: staff.email });
    return { ok: true };
  });

/* ---------- status changes: revoke / suspend / reactivate ---------- */
const statusSchema = z.object({
  staffId: z.string().uuid(),
  status: z.enum(["active", "suspended", "revoked"]),
});

export const setPlatformStaffStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => statusSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertCapability(context, "platform.staff.manage");
    if (data.staffId === context.userId) throw new Error("You cannot change your own status.");
    const staff = await loadStaff(data.staffId);
    if (!canTransition(staff.status, data.status)) {
      throw new Error(`Cannot change status from ${staff.status} to ${data.status}.`);
    }
    const db = await admin();
    const now = timeAuthority.now().at;
    const { error } = await db
      .from("platform_staff")
      .update({
        status: data.status,
        updated_at: now,
        suspended_at: data.status === "suspended" ? now : null,
      })
      .eq("id", staff.id);
    if (error) throw new Error(error.message);

    let identityError: string | null = null;
    let roleError: string | null = null;
    if (data.status !== "active") {
      // Cut off live sessions: ban the auth account (suspend/revoke) — the
      // 'none' duration lifts it on reactivation. Revoked staff also lose roles.
      const { error: banError } = await db.auth.admin.updateUserById(staff.id, {
        ban_duration: "876000h",
      });
      identityError = banError?.message ?? null;
      if (data.status === "revoked") {
        const { error: revokeRolesError } = await db
          .from("platform_staff_roles")
          .delete()
          .eq("staff_id", staff.id);
        roleError = revokeRolesError?.message ?? null;
      }
    } else {
      const { error: unbanError } = await db.auth.admin.updateUserById(staff.id, {
        ban_duration: "none",
      });
      identityError = unbanError?.message ?? null;
    }
    await audit(context, `status.${data.status}`, staff.id, "succeeded", {
      from: staff.status,
      to: data.status,
      identityUpdateSucceeded: identityError === null,
      roleRemovalSucceeded: roleError === null,
    });
    const { error: syncErr } = await store(db).rpc("sync_platform_staff_workspaces", {
      p_user_id: staff.id,
    });
    if (syncErr && !isMissingRelation(syncErr)) throw new Error(syncErr.message);
    if (identityError || roleError) {
      throw new Error("The staff status was saved, but one or more access updates failed.");
    }
    return { ok: true };
  });

/* ---------- set roles ---------- */
const rolesSchema = z.object({ staffId: z.string().uuid(), roles: roleList });

export const setPlatformStaffRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => rolesSchema.parse(input))
  .handler(async ({ data, context }) => {
    const staff = await loadStaff(data.staffId);
    if (staff.status === "revoked") throw new Error("Revoked staff cannot hold roles.");
    const db = await admin();
    const { data: current } = await db
      .from("platform_staff_roles")
      .select("role_code")
      .eq("staff_id", staff.id);
    const before = new Set((current ?? []).map((r) => r.role_code));
    const after = new Set<string>(data.roles);
    const privilegedGrant = [...before, ...after].some((role) =>
      (PRIVILEGED_PLATFORM_ROLES as ReadonlySet<string>).has(role),
    );
    if (privilegedGrant) {
      await assertSuper(context);
      const { assertConsoleCapability } =
        await import("@/lib/internal-console/console-access.server");
      await assertConsoleCapability(
        context,
        "platform.staff.manage",
        "staff.privileged_role_approval",
      );
    } else {
      await assertCapability(context, "platform.staff.manage");
    }
    const toAdd = [...after].filter((r) => !before.has(r));
    const toRemove = [...before].filter((r) => !after.has(r));
    const { error: roleError } = await (db as unknown as RpcClient).rpc(
      "set_platform_staff_roles",
      {
        p_staff_id: staff.id,
        p_role_codes: [...after],
        p_actor_id: context.userId,
      },
    );
    if (roleError) throw new Error("The role change could not be reconciled.");
    await audit(context, "set_roles", staff.id, "succeeded", { added: toAdd, removed: toRemove });
    return { roles: [...after] };
  });
