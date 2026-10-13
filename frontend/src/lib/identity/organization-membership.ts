/**
 * Sherivs organization membership facade (ACTIVE-V1).
 *
 * Live login still reads `public.users` + `public.schools` (LEGACY substrate).
 * This module is the domain-neutral view the identity gateway and org shell
 * consume so Plane C does not speak "school" as a universal primitive.
 *
 * cg_org_unit / cg_org_membership remain the intended substrate but the
 * 20261001000000 migration is AUTHORED, NOT APPLIED. Do not pretend those
 * tables are the live login path.
 *
 * Removal criteria for this facade: live reads against applied org-membership
 * rows, with schools remaining a Scholar runtime projection.
 */

export const ORGANIZATION_MEMBERSHIP_SOURCE = "legacy_schools_table" as const;

export interface OrganizationRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly source: typeof ORGANIZATION_MEMBERSHIP_SOURCE;
  readonly installedRuntimeId: string | null;
}

export interface OrganizationMembershipView {
  readonly organization: OrganizationRecord;
  readonly identityId: string;
  readonly role: string;
  readonly hasMembership: boolean;
}

export interface SchoolRowLike {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface UserProfileLike {
  readonly id: string;
  readonly school_id: string;
  readonly role: string;
}

export function organizationFromSchoolRow(
  school: SchoolRowLike,
  installedRuntimeId: string | null,
): OrganizationRecord {
  return {
    id: school.id,
    slug: school.slug,
    name: school.name,
    source: ORGANIZATION_MEMBERSHIP_SOURCE,
    installedRuntimeId,
  };
}

export function membershipFromLegacyProfile(
  profile: UserProfileLike | null,
  school: SchoolRowLike | null,
  installedRuntimeId: string | null,
): OrganizationMembershipView | null {
  if (!profile || !school) return null;
  if (profile.school_id !== school.id) return null;
  return {
    organization: organizationFromSchoolRow(school, installedRuntimeId),
    identityId: profile.id,
    role: profile.role,
    hasMembership: true,
  };
}
