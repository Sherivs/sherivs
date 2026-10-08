import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  deriveOrganizationState,
  type OrganizationReality,
} from "./organization-reality";

/**
 * RLS-scoped reads of the organization reality read-model.
 *
 * Every read goes through the CALLER's client, so what comes back is
 * exactly what the caller is authorized to see:
 *   - organization_memberships: the caller's own rows (members read only
 *     their own membership rows by policy).
 *   - schools: active organizations are publicly readable; the runtime is
 *     currently uniform (scholar) because V1 ships exactly one runtime.
 *   - users: readable only within the caller's ACTIVE organization, so the
 *     member count is computed for the active context and is null — never
 *     fabricated — for the others.
 */

const validator = z.object({
  /** Optional filter; omit to read every organization the caller belongs to. */
  organizationId: z.string().uuid().optional(),
});

export const readMyOrganizationsReality = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => validator.parse(input))
  .handler(async ({ data, context }): Promise<OrganizationReality[]> => {
    const db = context.supabase as SupabaseClient<Database>;
    const userId = context.userId;

    let membershipsQuery = db
      .from("organization_memberships")
      .select("school_id, role, is_active")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (data.organizationId) membershipsQuery = membershipsQuery.eq("school_id", data.organizationId);

    const { data: memberships, error: membershipErr } = await membershipsQuery;
    if (membershipErr || !memberships || memberships.length === 0) return [];

    const orgIds = memberships.map((m) => m.school_id);
    const { data: orgs, error: orgsErr } = await db
      .from("schools")
      .select("id, name, slug, onboarding_completed, is_active")
      .in("id", orgIds);
    if (orgsErr || !orgs) return [];

    // The caller's ACTIVE context (self-read is permitted by policy).
    const { data: profile } = await db
      .from("users")
      .select("school_id")
      .eq("id", userId)
      .maybeSingle();
    const activeSchoolId = profile?.school_id ?? null;

    // Live roster count — readable only for the ACTIVE context (RLS);
    // other organizations report null rather than a fabricated number.
    let memberCount: number | null = null;
    if (activeSchoolId && orgIds.includes(activeSchoolId)) {
      const { count, error: countErr } = await db
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("school_id", activeSchoolId);
      if (!countErr) memberCount = count ?? 0;
    }

    return orgs.map((org) => {
      const isActive = org.is_active !== false;
      const onboardingCompleted = org.onboarding_completed === true;
      return {
        organizationId: org.id,
        name: org.name ?? "Organization",
        slug: org.slug ?? null,
        runtimeId: "runtime:scholar",
        onboardingCompleted,
        memberCount: org.id === activeSchoolId ? memberCount : null,
        isActive,
        state: deriveOrganizationState({ isActive, onboardingCompleted }),
      };
    });
  });
