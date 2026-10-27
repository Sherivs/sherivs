/**
 * Multi-membership / multi-role conflict law (V1 organizational envelope).
 *
 * A person is one identity. Organizations send membership invites; they never
 * mint a second auth user. A parent may also be staff. Children at different
 * schools are separate memberships of the same parent, not extra accounts.
 */

import type { AppRole } from "@/lib/roles";

export interface ShellAffiliation {
  organizationId: string;
  organizationName: string;
  role: AppRole;
  /** True when this is the session's active users.school_id + users.role. */
  active: boolean;
}

export type MembershipInviteDecision =
  | { kind: "invite_existing"; reason: "same_person_new_organization" }
  | { kind: "add_role"; reason: "same_organization_additional_role" }
  | { kind: "already_held"; reason: "duplicate_affiliation" }
  | { kind: "create_account"; reason: "no_identity_yet" };

export function membershipInviteDecision(input: {
  existingUserId: string | null;
  affiliations: readonly Pick<ShellAffiliation, "organizationId" | "role">[];
  targetOrganizationId: string;
  targetRole: AppRole;
}): MembershipInviteDecision {
  if (!input.existingUserId) {
    return { kind: "create_account", reason: "no_identity_yet" };
  }
  const held = input.affiliations.find(
    (row) => row.organizationId === input.targetOrganizationId && row.role === input.targetRole,
  );
  if (held) {
    return { kind: "already_held", reason: "duplicate_affiliation" };
  }
  const sameOrg = input.affiliations.some((row) => row.organizationId === input.targetOrganizationId);
  if (sameOrg) {
    return { kind: "add_role", reason: "same_organization_additional_role" };
  }
  return { kind: "invite_existing", reason: "same_person_new_organization" };
}

export function affiliationKey(row: Pick<ShellAffiliation, "organizationId" | "role">): string {
  return `${row.organizationId}:${row.role}`;
}

/** Switcher is hidden unless the person holds more than one context. */
export function shouldShowContextSwitcher(affiliations: readonly ShellAffiliation[]): boolean {
  if (affiliations.length <= 1) return false;
  const orgs = new Set(affiliations.map((row) => row.organizationId));
  const roles = new Set(affiliations.map((row) => row.role));
  return orgs.size > 1 || roles.size > 1;
}

export function mergeAffiliations(rows: readonly ShellAffiliation[]): ShellAffiliation[] {
  const seen = new Map<string, ShellAffiliation>();
  for (const row of rows) {
    const key = affiliationKey(row);
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, row);
      continue;
    }
    seen.set(key, { ...prior, active: prior.active || row.active });
  }
  return [...seen.values()];
}

export function activeAffiliation(affiliations: readonly ShellAffiliation[]): ShellAffiliation | null {
  return affiliations.find((row) => row.active) ?? affiliations[0] ?? null;
}
