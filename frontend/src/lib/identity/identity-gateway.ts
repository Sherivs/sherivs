/**
 * Sherivs Identity Gateway (ACTIVE-V1).
 *
 * Authentication is not routing. After a session exists, this module resolves:
 *   identity → membership → organization → runtime → experience plane → destination
 *
 * LOGIN → Scholar is forbidden unless the resolved organization actually has
 * the Scholar runtime and the actor holds a Scholar membership role.
 *
 * Super-admins route to the Sherivs internal workspace (Plane D), never a
 * school portal. Unlinked identities stay on the auth surface.
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

export interface IdentityGatewayInput {
  readonly authenticated: boolean;
  readonly role: AppRole | null;
  readonly superAdmin: boolean;
  readonly tenantSlug: string | null;
  readonly hasOrganizationMembership: boolean;
  readonly installedRuntimeId: string | null;
}

export interface IdentityGatewayDecision {
  readonly plane: ExperiencePlane;
  /** Null means render the current public surface (do not navigate). */
  readonly destination: string | null;
  readonly reason:
    | "sherivs_public"
    | "organization_public"
    | "internal_operator"
    | "unlinked_identity"
    | "scholar_runtime"
    | "domain_neutral_workspace";
}

function isScholarMemberRole(role: AppRole | null): role is AppRole {
  return role !== null && SCHOLAR_MEMBER_ROLE_SET.has(role);
}

/**
 * Resolve the post-auth (or public) destination. Never returns a Scholar
 * workspace unless runtime + membership both resolve to Scholar.
 */
export function resolveIdentityGateway(input: IdentityGatewayInput): IdentityGatewayDecision {
  if (!input.authenticated) {
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

  if (!input.hasOrganizationMembership || !input.role) {
    return {
      plane: EXPERIENCE_PLANE_A,
      destination: "/auth",
      reason: "unlinked_identity",
    };
  }

  if (input.installedRuntimeId === SCHOLAR_RUNTIME_ID && isScholarMemberRole(input.role)) {
    return {
      plane: EXPERIENCE_PLANE_C,
      destination: scholarWorkspaceHome(input.role),
      reason: "scholar_runtime",
    };
  }

  return {
    plane: EXPERIENCE_PLANE_C,
    destination: "/runtime",
    reason: "domain_neutral_workspace",
  };
}
