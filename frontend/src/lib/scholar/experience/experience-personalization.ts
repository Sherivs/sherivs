/**
 * Sherivs Scholar — Experience engine: personalization.
 *
 * Different people see different experiences. The difference is derived from
 * AUTHORIZED roles (the role context), never from a hardcoded portal per role
 * name: a public visitor reaches the marketing presence, a relationship
 * (parent/learner) reaches a portal, and anyone holding working roles reaches
 * the workspaces those roles unlock.
 */

import type { RoleCategory } from "../roles/role-categories";
import { roleById } from "../roles/role-registry";
import { workspacesForRoles } from "../roles/role-workspace-engine";
import type { RoleWorkspaceKey } from "../roles/role-workspaces";
import type { ExperienceAudience } from "./experience-catalog";

export type ExperienceSurface = "marketing_site" | "portal" | "workspace";

/** Role categories that serve each audience (data, not logic). */
export const AUDIENCE_ROLE_CATEGORIES: Record<ExperienceAudience, readonly RoleCategory[]> = {
  public_visitor: [],
  parent: [],
  student: [],
  teacher: ["TEACHING", "VOCATIONAL", "TECHNICAL", "AGRICULTURAL", "RELIGIOUS"],
  leadership: ["INSTITUTIONAL_LEADERSHIP", "ACADEMIC"],
  staff: [
    "OPERATIONS",
    "FINANCE",
    "TECHNOLOGY",
    "FACILITIES",
    "TRANSPORT",
    "HEALTH",
    "SAFETY",
    "BOARDING",
    "STUDENT_SUPPORT",
    "COMMUNITY",
    "TRADITIONAL",
    "RESEARCH",
    "SHERIVS_INTERNAL",
  ],
  regulator: ["GOVERNMENT", "REGULATORY", "EXAMINATION", "QUALITY_ASSURANCE"],
};

/** Relationship audiences reach a portal without holding a workforce role. */
const RELATIONSHIP_AUDIENCES: readonly ExperienceAudience[] = ["parent", "student"];

export interface PersonalizedExperience {
  audience: ExperienceAudience;
  surface: ExperienceSurface;
  /** True when the identity's roles (or relationship) actually reach it. */
  reached: boolean;
  workspaces: readonly RoleWorkspaceKey[];
  rationale: readonly string[];
}

/** Audiences an identity's roles make them part of (public always applies). */
export function audiencesForRoles(roleIds: readonly string[]): readonly ExperienceAudience[] {
  const categories = new Set(
    roleIds
      .map((id) => roleById(id)?.category)
      .filter((category): category is RoleCategory => category !== undefined),
  );
  const audiences: ExperienceAudience[] = ["public_visitor"];
  for (const audience of ["teacher", "leadership", "staff", "regulator"] as const) {
    if (AUDIENCE_ROLE_CATEGORIES[audience].some((category) => categories.has(category))) {
      audiences.push(audience);
    }
  }
  return audiences;
}

/** Resolve one audience's experience for an identity's role set. */
export function personaliseForAudience(
  audience: ExperienceAudience,
  roleIds: readonly string[],
): PersonalizedExperience {
  if (audience === "public_visitor") {
    return {
      audience,
      surface: "marketing_site",
      reached: true,
      workspaces: [],
      rationale: ["anonymous reality-derived presence"],
    };
  }
  if (RELATIONSHIP_AUDIENCES.includes(audience)) {
    return {
      audience,
      surface: "portal",
      reached: true,
      workspaces: [],
      rationale: ["relationship audience (guardian/learner), not a workforce post"],
    };
  }

  const matchedRoles = roleIds.filter((id) => {
    const role = roleById(id);
    return role !== undefined && AUDIENCE_ROLE_CATEGORIES[audience].includes(role.category);
  });

  return {
    audience,
    surface: "workspace",
    reached: matchedRoles.length > 0,
    workspaces: workspacesForRoles(matchedRoles).map((assignment) => assignment.workspace),
    rationale:
      matchedRoles.length > 0
        ? matchedRoles.map((id) => `role:${id}`)
        : ["no role in the categories this audience serves"],
  };
}
