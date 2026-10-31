import type { AppRole } from "@/lib/roles";

/**
 * Sherivs — identity resolution chain (§11 Authentication Refoundation).
 *
 * Sign-in never assumes a workspace. Authentication resolves WHO the caller
 * is; this module resolves WHAT they can enter:
 *
 *   login → Sherivs Identity → resolve user → resolve memberships →
 *   resolve organizations → resolve roles → resolve runtime →
 *   resolve workspace → route appropriately
 *
 * PURE domain logic only — no I/O. The server-authoritative resolver lives in
 * `./resolve-identity.functions.ts` (RLS-scoped reads); client derivation
 * from app context lives in `./context.ts`.
 *
 * Destination law:
 *   - Sherivs employee (internal workforce)  → the internal Sherivs
 *     operating environment (/console), never a customer workspace.
 *   - Exactly one organization membership    → that organization's runtime
 *     workspace (the membership carries its own resolved home path).
 *   - Multiple organization memberships      → the organization selector
 *     (/organizations).
 *   - No membership (unlinked account)       → /welcome (pending link /
 *     organization creation), never a runtime workspace.
 */

/** Route of the internal Sherivs operating environment (plane 4). */
export const SHERIVS_INTERNAL_HOME = "/console";
/** Route of the multi-organization selector. */
export const ORGANIZATION_SELECTOR_PATH = "/organizations";
/** Route shown to authenticated users with no organization membership yet. */
export const UNLINKED_ACCOUNT_PATH = "/welcome";

export interface OrganizationMembership {
  /** Organization id (tenant id in the current identity store). */
  organizationId: string;
  /** Display name of the organization. */
  name: string;
  /** URL slug when the organization has a public site. */
  slug: string | null;
  /** The member's role within the organization. */
  role: AppRole;
  /** Manifest id of the runtime serving this organization, e.g. runtime:scholar. */
  runtimeId: string;
  /** Human name of that runtime, e.g. Scholar. */
  runtimeName: string;
  /** Resolved workspace home for this membership. */
  homePath: string;
}

export type SherivsIdentity =
  | {
      kind: "sherivs_internal";
      organizations: [];
      destination: typeof SHERIVS_INTERNAL_HOME;
    }
  | {
      kind: "organization_member";
      organizations: [OrganizationMembership, ...OrganizationMembership[]];
      destination: string;
    }
  | {
      kind: "unlinked";
      organizations: [];
      destination: typeof UNLINKED_ACCOUNT_PATH;
    };

export interface IdentityInput {
  /** True when the authenticated user is internal Sherivs workforce. */
  isSherivsInternal: boolean;
  /** Every organization membership resolved for the user (active only). */
  memberships: readonly OrganizationMembership[];
}

/** Resolve the identity chain for an authenticated user. */
export function resolveIdentity(input: IdentityInput): SherivsIdentity {
  if (input.isSherivsInternal) {
    return {
      kind: "sherivs_internal",
      organizations: [],
      destination: SHERIVS_INTERNAL_HOME,
    };
  }

  if (input.memberships.length === 0) {
    return { kind: "unlinked", organizations: [], destination: UNLINKED_ACCOUNT_PATH };
  }

  const organizations = [...input.memberships];
  return {
    kind: "organization_member",
    organizations: organizations as [OrganizationMembership, ...OrganizationMembership[]],
    destination:
      organizations.length === 1 ? organizations[0].homePath : ORGANIZATION_SELECTOR_PATH,
  };
}
