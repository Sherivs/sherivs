import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { INSTALLED_RUNTIME_ID, INSTALLED_RUNTIME_NAME } from "@/lib/runtime/installed-runtimes";
import { runtimeWorkspaceHome } from "@/lib/runtime/nav-registry";
import { resolveIdentity, type OrganizationMembership } from "./identity";

/**
 * Sherivs — server-authoritative identity resolver (§11).
 *
 * Resolves the full identity chain for the authenticated caller:
 *
 *   auth user → super_admins (internal workforce) →
 *   organization_memberships (the membership SET — N organizations) →
 *   schools (organization reality) → role → runtime → workspace home
 *
 * The membership set lives in `organization_memberships` (migration
 * 20261008000050), mirrored from `users` by trigger and backfilled. The
 * caller's OWN rows are read through the caller's RLS-scoped client, so the
 * caller can never observe another actor's memberships. If the substrate is
 * unreachable or empty, resolution falls back to the legacy single-membership
 * path (`users.school_id`) — fail-open TO THE LEGACY STORE, never to a
 * guess: an actor with neither substrate rows nor a users row is unlinked.
 *
 * The ACTIVE membership is `users.school_id`/`users.role` (switchable via
 * `switchActiveOrganization`); the primary membership is the default active
 * context after sign-in.
 */
export const resolveSherivsIdentity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as SupabaseClient<Database>;
    const userId = context.userId;

    // 1. Internal Sherivs workforce (super admins) — never routed into a
    //    customer organization workspace by default.
    const { data: internal } = await db
      .from("super_admins")
      .select("id, full_name, email")
      .eq("id", userId)
      .maybeSingle();
    if (internal) {
      return resolveIdentity({ isSherivsInternal: true, memberships: [] });
    }

    // 1b. Internal Sherivs staff (SHERIVS-008): accept a pending invite (own
    //     row only; grants nothing) and route ACTIVE staff to /console.
    await db.rpc("claim_platform_staff_invite");
    const { data: staff } = await db
      .from("platform_staff")
      .select("id")
      .eq("id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (staff) {
      return resolveIdentity({ isSherivsInternal: true, memberships: [] });
    }

    // 2. The membership SET (active only, primary first) — RLS-scoped to the
    //    caller's own rows. Substrate failure or emptiness falls back to the
    //    legacy single-membership path.
    let memberships = await readMembershipRows(db, userId);

    if (memberships.length === 0) {
      memberships = await readLegacyMembership(db, userId);
    }

    if (memberships.length === 0) {
      return resolveIdentity({ isSherivsInternal: false, memberships: [] });
    }

    return resolveIdentity({ isSherivsInternal: false, memberships });
  });

type ResolverClient = SupabaseClient<Database>;

interface MembershipRow {
  school_id: string;
  role: string;
}

async function readMembershipRows(
  db: ResolverClient,
  userId: string,
): Promise<OrganizationMembership[]> {
  // Explicit failure → legacy fallback (never a guessed workspace).
  const { data, error } = await db
    .from("organization_memberships")
    .select("school_id, role, is_primary, is_active, created_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) return [];

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const orgIds = [...new Set(rows.map((r) => r.school_id))];
  const orgs = await db.from("schools").select("id, name, slug").in("id", orgIds);
  const orgById = new Map(
    ((orgs.data ?? []) as Array<{ id: string; name: string | null; slug: string | null }>).map(
      (o) => [o.id, o],
    ),
  );

  return rows
    .filter((row) => row.school_id && row.role)
    .map((row) => toMembership(row, orgById.get(row.school_id) ?? null));
}

async function readLegacyMembership(
  db: ResolverClient,
  userId: string,
): Promise<OrganizationMembership[]> {
  const { data: profile, error } = await db
    .from("users")
    .select("id, school_id, role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (error || !profile || profile.is_active === false) return [];

  const role = profile.role as OrganizationMembership["role"];
  const organizationId = profile.school_id as string;
  if (!organizationId || !role) return [];

  const { data: org } = await db
    .from("schools")
    .select("id, name, slug")
    .eq("id", organizationId)
    .maybeSingle();

  return [
    {
      organizationId,
      name: (org?.name as string | undefined) ?? "Your organization",
      slug: (org?.slug as string | null | undefined) ?? null,
      role,
      runtimeId: INSTALLED_RUNTIME_ID,
      runtimeName: INSTALLED_RUNTIME_NAME,
      homePath: runtimeWorkspaceHome(role),
    },
  ];
}

function toMembership(
  row: MembershipRow,
  org: { id: string; name: string | null; slug: string | null } | null | undefined,
): OrganizationMembership {
  // The substrate CHECK constrains role to the declared tenant-role
  // vocabulary (mirroring users_role_check); the resolver narrows it to the
  // app-role union at this single boundary.
  const role = row.role as OrganizationMembership["role"];
  return {
    organizationId: row.school_id,
    name: (org?.name as string | undefined) ?? "Your organization",
    slug: (org?.slug as string | null | undefined) ?? null,
    role,
    runtimeId: INSTALLED_RUNTIME_ID,
    runtimeName: INSTALLED_RUNTIME_NAME,
    homePath: runtimeWorkspaceHome(role),
  };
}
