import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { decideAccountAdministration, resolveRoleGate } from "@/lib/security-role-gate";
import { writeAuditRecord } from "@/lib/server/write-audit";
import {
  membershipInviteDecision,
  type ShellAffiliation,
} from "@/lib/shell/membership-policy";
import type { AppRole } from "@/lib/roles";

const CREATABLE_ROLES = [
  "admin",
  "principal",
  "teacher",
  "bursar",
  "parent",
  "student",
  "driver",
  "hq",
] as const;

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(CREATABLE_ROLES),
});

async function findAuthUserIdByEmail(
  admin: { auth: { admin: { listUsers: (args: { page: number; perPage: number }) => Promise<{ data?: { users?: { id: string; email?: string }[] } }> } } },
  email: string,
): Promise<string | undefined> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users?.find((user) => user.email?.toLowerCase() === email)?.id;
}

/**
 * Invite an EXISTING Sherivs identity into this organization.
 * Never creates a second auth user. A person with no account is refused so
 * the admin uses the staff-account flow instead of silently minting one.
 */
export const inviteExistingMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const lifecycle = {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    };
    const superGate = await resolveRoleGate(context.supabase, "platform_super_admin", lifecycle);
    const adminGate =
      superGate.decision === "allow"
        ? null
        : await resolveRoleGate(context.supabase, "school_admin", lifecycle);
    const access = decideAccountAdministration({
      platformSuper: superGate.decision === "allow",
      schoolAdmin: adminGate?.decision === "allow",
      schoolScope: adminGate?.decision === "allow" ? adminGate.scope : null,
      targetSchoolId: null,
      ...lifecycle,
    });
    if (access.decision === "deny") throw new Error(access.reason);
    const schoolId = access.scope;
    if (!schoolId) throw new Error("A school scope is required to invite a member.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = await findAuthUserIdByEmail(supabaseAdmin, data.email);
    if (!userId) {
      throw new Error("No Sherivs account uses that email. Invite creates membership, not a new login.");
    }

    const { data: rows } = await supabaseAdmin
      .from("organization_memberships")
      .select("school_id, role")
      .eq("user_id", userId)
      .eq("is_active", true);

    const affiliations: ShellAffiliation[] = (rows ?? []).map((row) => ({
      organizationId: row.school_id as string,
      organizationName: "",
      role: row.role as AppRole,
      active: false,
    }));

    const decision = membershipInviteDecision({
      existingUserId: userId,
      affiliations,
      targetOrganizationId: schoolId,
      targetRole: data.role,
    });
    if (decision.kind === "already_held") {
      throw new Error("This person already holds that role in this organization.");
    }
    if (decision.kind === "create_account") {
      throw new Error("No Sherivs account uses that email. Invite creates membership, not a new login.");
    }

    const { error } = await supabaseAdmin.from("organization_memberships").insert({
      user_id: userId,
      school_id: schoolId,
      role: data.role,
      is_primary: false,
      is_active: true,
    });
    if (error) {
      if (error.code === "23505") {
        throw new Error("This person already belongs to this organization. Add a distinct role instead of a second login.");
      }
      throw new Error(error.message);
    }

    await writeAuditRecord(supabaseAdmin, {
      action: "organization.membership.invite_existing",
      gate: "requireSupabaseAuth",
      tenantId: schoolId,
      actorId: context.userId,
      table: "organization_memberships",
      recordId: userId,
      outcome: "succeeded",
      details: { email: data.email, role: data.role, decision: decision.kind },
    });

    return { userId, email: data.email, role: data.role, decision: decision.kind };
  });
