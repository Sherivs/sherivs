import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { runtimeWorkspaceHome } from "@/lib/runtime/nav-registry";
import type { OrganizationMembership } from "@/lib/identity/identity";
import { writeAuditRecord } from "@/lib/server/write-audit";

/**
 * Sherivs — active-organization switch (§11 multi-membership).
 *
 * A member with several organization memberships switches their ACTIVE
 * workspace context. Security posture (submit–resolve; the client submits a
 * CHOICE and nothing else):
 *
 *   1. The choice is validated against the caller's OWN membership set,
 *      read through the caller's RLS-scoped client — a membership the actor
 *      does not hold (or that is deactivated) is unswitchable, fail-closed.
 *   2. The active context is persisted by re-pointing the identity store's
 *      active-context binding (`users.school_id`/`role`) through the
 *      service role — the same binding every live tenant RLS predicate
 *      resolves through. Nothing about the authorization model changes;
 *      the actor simply moves into an organization they verifiably belong
 *      to. The membership-sync trigger keeps the substrate coherent.
 *   3. The write is audited (fail-closed, never logs secrets).
 *
 * Returns the resolved destination for the switched context.
 */

const switchValidator = z.object({
  /** The organization to make active (must be an ACTIVE membership of the caller). */
  organizationId: z.string().uuid(),
  /** Optional role when the person holds more than one role in that organization. */
  role: z.string().min(2).max(40).optional(),
});

/** Pure selection helper — testable; mirrors the resolver's ordering. */
export function pickSwitchTarget<T extends { organizationId: string; role?: string }>(
  memberships: readonly T[],
  organizationId: string,
  role?: string,
): T | null {
  if (role) {
    return (
      memberships.find((row) => row.organizationId === organizationId && row.role === role) ??
      memberships.find((row) => row.organizationId === organizationId) ??
      null
    );
  }
  return memberships.find((row) => row.organizationId === organizationId) ?? null;
}

export const switchActiveOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => switchValidator.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as SupabaseClient<Database>;
    const userId = context.userId;

    // 1. Resolve the caller's own ACTIVE membership (RLS-scoped).
    let membershipQuery = db
      .from("organization_memberships")
      .select("school_id, role, is_active")
      .eq("user_id", userId)
      .eq("school_id", data.organizationId)
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .limit(1);
    if (data.role) membershipQuery = membershipQuery.eq("role", data.role);
    const { data: membership, error: membershipErr } = await membershipQuery.maybeSingle();
    if (membershipErr || !membership) {
      throw new Error("Not an active member of that organization.");
    }
    // The substrate CHECK constrains role to the declared tenant-role
    // vocabulary (mirroring users_role_check); narrowed at this boundary.
    const membershipRole = membership.role as OrganizationMembership["role"];

    // 2. Verify the caller's identity-store row is live (deactivated
    //    accounts cannot switch contexts at all).
    const { data: profile, error: profileErr } = await db
      .from("users")
      .select("id, school_id, role, is_active")
      .eq("id", userId)
      .maybeSingle();
    if (profileErr || !profile || profile.is_active === false) {
      throw new Error("Account is not active.");
    }
    if (profile.school_id === data.organizationId && profile.role === membershipRole) {
      return {
        destination: runtimeWorkspaceHome(membershipRole),
        organizationId: data.organizationId,
      };
    }

    // 3. Persist the active-context move (service role; trigger mirrors the
    //    membership substrate and demotes the previous primary).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updateErr } = await supabaseAdmin
      .from("users")
      .update({ school_id: data.organizationId, role: membershipRole })
      .eq("id", userId);
    if (updateErr) throw new Error(updateErr.message);

    // 4. Audit — fail-closed; never records secrets.
    await writeAuditRecord(supabaseAdmin, {
      action: "organization.switch",
      gate: "requireSupabaseAuth",
      tenantId: data.organizationId,
      actorId: userId,
      table: "users",
      recordId: userId,
      outcome: "succeeded",
      details: { from_school_id: profile.school_id, to_school_id: data.organizationId },
    });

    return {
      destination: runtimeWorkspaceHome(membershipRole),
      organizationId: data.organizationId,
    };
  });
