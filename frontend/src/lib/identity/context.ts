import type { SuperAdminProfile, UserProfile, SchoolRow } from "@/contexts/app-context";
import { scholarWorkspaceHome } from "@/lib/runtime/nav-registry";
import { INSTALLED_RUNTIME_ID, INSTALLED_RUNTIME_NAME } from "@/lib/runtime/installed-runtimes";
import { resolveIdentity, type OrganizationMembership } from "./identity";

/**
 * Sherivs — client-side identity derivation from app context.
 *
 * For routing effects that must not wait on a server round-trip (the signed-in
 * homepage redirect, post-refresh navigation), derive the SAME identity chain
 * from the state the app context already resolved. The server-authoritative
 * resolver (`./resolve-identity.functions.ts`) remains the source of truth
 * after sign-in; this derivation must agree with it.
 *
 * The current identity store carries one membership per user (school_id on
 * the users row); when multi-membership storage arrives, only this module and
 * the server resolver change — the destination law in ./identity.ts holds.
 */
export function identityFromAppState(input: {
  superAdmin: SuperAdminProfile | null;
  profile: UserProfile | null;
  school: SchoolRow | null;
}) {
  if (input.superAdmin) {
    return resolveIdentity({ isSherivsInternal: true, memberships: [] });
  }

  const profile = input.profile;
  const school = input.school;
  if (!profile || profile.is_active === false || !school) {
    return resolveIdentity({ isSherivsInternal: false, memberships: [] });
  }

  const membership: OrganizationMembership = {
    organizationId: school.id,
    name: school.name ?? "Your organization",
    slug: school.slug ?? null,
    role: profile.role,
    runtimeId: INSTALLED_RUNTIME_ID,
    runtimeName: INSTALLED_RUNTIME_NAME,
    homePath: scholarWorkspaceHome(profile.role),
  };
  return resolveIdentity({ isSherivsInternal: false, memberships: [membership] });
}
