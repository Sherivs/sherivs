/**
 * Client-safe helpers for time-limited support grants (SHERIVS-009).
 * Grant/revoke still run only through super-admin server functions.
 */

export const SUPPORT_GRANTABLE_ROLES = ["support", "platform_admin"] as const;

export type GrantableSupportStaff = {
  id: string;
  status: string;
  full_name?: string | null;
  email?: string | null;
  roles: readonly string[];
};

export function isGrantableSupportStaff(staff: GrantableSupportStaff): boolean {
  return (
    staff.status === "active" &&
    staff.roles.some((role) =>
      (SUPPORT_GRANTABLE_ROLES as readonly string[]).includes(role),
    )
  );
}

export function grantableSupportStaff<T extends GrantableSupportStaff>(
  staff: readonly T[],
): T[] {
  return staff.filter(isGrantableSupportStaff);
}

export function grantableSupportOrganizations<
  T extends { schoolId: string | null; displayName: string },
>(organizations: readonly T[]): T[] {
  return organizations.filter(
    (organization) =>
      typeof organization.schoolId === "string" && organization.schoolId.length > 0,
  );
}
