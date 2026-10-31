/**
 * Post-authentication organization authorization helpers.
 *
 * A valid Auth session is not membership. Protected organizational surfaces
 * require an active public.users row (or console identity on the console host)
 * and, on a school domain, school_domain_login_allowed.
 */
export const ORGANIZATION_ACCESS_DENIED =
  "This account cannot access this organization. Contact your administrator.";

export const ACCOUNT_INVITATION_COPY = "Don't have an account? Contact your administrator.";

export const SIGN_IN_IDENTIFIER_PLACEHOLDER = "Email, ID number, or phone";

export type MembershipAccessInput = {
  hasActiveMembership: boolean;
  organizationActive: boolean;
  schoolIdMatchesTenant: boolean;
};

export function organizationAccessDecision(input: MembershipAccessInput): "allow" | "deny" {
  if (!input.hasActiveMembership) return "deny";
  if (!input.organizationActive) return "deny";
  if (!input.schoolIdMatchesTenant) return "deny";
  return "allow";
}

export function isActiveMembership(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  return (row as { is_active?: boolean | null }).is_active !== false;
}
