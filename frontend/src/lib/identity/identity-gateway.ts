/**
 * Sherivs Identity Gateway (ACTIVE-V1).
 *
 * Authentication is not routing. After a session exists, this module resolves:
 *   identity → membership → organization → runtime → experience plane → destination
 *
 * LOGIN must not open an education workspace unless the resolved organization
 * actually has that installed runtime and the actor holds a matching membership role.
 *
 * Super-admins route to the Sherivs internal workspace (Plane D), never a
 * school portal. Unlinked identities go to organization onboarding.
 *
 * Boundary: pure data + pure functions. No I/O, no vendor, no secrets.
 */

import type { AppRole } from "../roles";
import {
  EXPERIENCE_PLANE_A,
  EXPERIENCE_PLANE_B,
  EXPERIENCE_PLANE_C,
  EXPERIENCE_PLANE_D,
  type ExperiencePlane,
} from "../experience/experience-planes";
import {
  bindOrganizationPath,
  organizationWorkspacePath,
} from "../experience/organization-routes";
import { scholarWorkspaceHome } from "../runtime/nav-registry";

export const IDENTITY_GATEWAY_VERSION_TARGET = "ACTIVE-V1" as const;

export const SCHOLAR_RUNTIME_ID = "runtime:scholar" as const;

export const SCHOLAR_MEMBER_ROLES: readonly AppRole[] = [
  "hq",
  "admin",
  "principal",
  "teacher",
  "bursar",
  "parent",
  "student",
  "driver",
] as const;

const SCHOLAR_MEMBER_ROLE_SET: ReadonlySet<string> = new Set(SCHOLAR_MEMBER_ROLES);

export type IdentityHostKind = "public_platform" | "app" | "internal" | "tenant" | "local";

export interface IdentityGatewayInput {
  readonly authenticated: boolean;
  readonly role: AppRole | null;
  readonly superAdmin: boolean;
  readonly tenantSlug: string | null;
  /** Organization slug when membership (or public tenant) has resolved one. */
  readonly organizationSlug?: string | null;
  readonly hasOrganizationMembership: boolean;
  readonly installedRuntimeId: string | null;
  readonly hostKind?: IdentityHostKind;
}

export interface IdentityGatewayDecision {
  readonly plane: ExperiencePlane;
  /** Null means render the current public surface (do not navigate). */
  readonly destination: string | null;
  readonly reason:
    | "sherivs_public"
    | "organization_public"
    | "internal_operator"
    | "internal_signin"
    | "app_signin"
    | "unlinked_identity"
    | "scholar_runtime"
    | "domain_neutral_workspace"
    | "unauthorized_internal";
}

function isScholarMemberRole(role: AppRole | null): role is AppRole {
  return role !== null && SCHOLAR_MEMBER_ROLE_SET.has(role);
}

/**
 * Resolve the post-auth (or public) destination. Never returns an education
 * workspace unless installed-runtime id and membership both resolve to it.
 */
export function resolveIdentityGateway(input: IdentityGatewayInput): IdentityGatewayDecision {
  const hostKind = input.hostKind ?? "local";

  if (!input.authenticated) {
    if (hostKind === "internal") {
      return { plane: EXPERIENCE_PLANE_D, destination: "/auth", reason: "internal_signin" };
    }
    if (hostKind === "app") {
      return { plane: EXPERIENCE_PLANE_C, destination: "/auth", reason: "app_signin" };
    }
    if (input.tenantSlug) {
      return {
        plane: EXPERIENCE_PLANE_B,
        destination: null,
        reason: "organization_public",
      };
    }
    return {
      plane: EXPERIENCE_PLANE_A,
      destination: null,
      reason: "sherivs_public",
    };
  }

  if (input.superAdmin || input.role === "super_admin") {
    return {
      plane: EXPERIENCE_PLANE_D,
      destination: "/super-admin/dashboard",
      reason: "internal_operator",
    };
  }

  if (hostKind === "internal") {
    return {
      plane: EXPERIENCE_PLANE_D,
      destination: "/auth",
      reason: "unauthorized_internal",
    };
  }

  if (!input.hasOrganizationMembership || !input.role) {
    return {
      plane: EXPERIENCE_PLANE_A,
      destination: "/onboarding",
      reason: "unlinked_identity",
    };
  }

  const organizationSlug = input.organizationSlug;

  if (input.installedRuntimeId === SCHOLAR_RUNTIME_ID && isScholarMemberRole(input.role)) {
    const leaf = scholarWorkspaceHome(input.role);
    return {
      plane: EXPERIENCE_PLANE_C,
      destination: organizationSlug ? bindOrganizationPath(organizationSlug, leaf) : leaf,
      reason: "scholar_runtime",
    };
  }

  return {
    plane: EXPERIENCE_PLANE_C,
    destination: organizationSlug ? organizationWorkspacePath(organizationSlug) : "/runtime",
    reason: "domain_neutral_workspace",
  };
}
