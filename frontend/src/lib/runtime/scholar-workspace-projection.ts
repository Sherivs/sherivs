/**
 * CoreGrid Scholar (runtime-001) — workspace projection adapter.
 *
 * Binds the DOMAIN-NEUTRAL Phase 06 engine to the Scholar catalog. The engine knows
 * nothing about Scholar; this adapter is the only bridge, which is exactly what
 * neutrality requires.
 *
 * Everything here is CATALOG-DRIVEN:
 *  - workspace kinds come from the catalog's own label map, so a new kind appears
 *    automatically and no hand-written role list can go stale;
 *  - reality roles come from the Scholar role registry (`EDUCATION_REALITY_ROLES`),
 *    which is generated from the role groups — hundreds of roles today, and more as
 *    the catalog grows;
 *  - role → workspace coverage comes from the role workspace engine, whose audit
 *    findings are surfaced rather than hidden.
 */
import {
  SCHOLAR_NAV_CONTRIBUTIONS,
  SCHOLAR_WORKSPACE_LABELS,
  scholarCapabilitiesForKind,
  type ScholarNavKind,
} from "@/lib/runtime/nav-registry";
import {
  EDUCATION_REALITY_ROLES,
  ROLE_WORKSPACE_KEYS,
  ROLE_WORKSPACE_LABELS,
  auditRoleWorkspaces,
  workspacesForRole,
  type RoleWorkspaceKey,
} from "@/lib/scholar/roles";
import type { WorkspaceCompositionInput } from "@/lib/workspace-projection";

/** Every workspace kind the Scholar catalog declares — derived, never listed. */
export const SCHOLAR_WORKSPACE_KINDS: readonly ScholarNavKind[] = Object.keys(
  SCHOLAR_WORKSPACE_LABELS,
).sort() as ScholarNavKind[];

/** One composition request per declared kind, ready for the neutral engine. */
export function scholarCompositionInputs(): readonly WorkspaceCompositionInput[] {
  return SCHOLAR_WORKSPACE_KINDS.map((kind) => ({
    key: `r001:${kind}`,
    label: SCHOLAR_WORKSPACE_LABELS[kind],
    capabilities: scholarCapabilitiesForKind(kind),
    contributions: SCHOLAR_NAV_CONTRIBUTIONS,
  }));
}

export interface ScholarRoleWorkspaceCoverage {
  /** Total reality roles in the registry (catalog-derived, not a sample). */
  roleCount: number;
  /** Roles per workspace key, plus keys no role requires. */
  workspaces: readonly {
    key: RoleWorkspaceKey;
    label: string;
    roleCount: number;
  }[];
  /** Roles with no workspace requirement — reported, never assumed away. */
  unassignedRoleIds: readonly string[];
  /** Audit findings from the role workspace engine itself. */
  auditFindings: readonly string[];
}

/**
 * Coverage of the whole registry: how many roles exist, how they distribute across
 * workspaces, and which roles are unassigned.
 */
export function scholarRoleWorkspaceCoverage(): ScholarRoleWorkspaceCoverage {
  const roleCount = EDUCATION_REALITY_ROLES.length;

  const counts = new Map<RoleWorkspaceKey, number>();
  for (const key of ROLE_WORKSPACE_KEYS) counts.set(key, 0);

  const unassigned: string[] = [];
  for (const role of EDUCATION_REALITY_ROLES) {
    const workspaces = role.workspaceRequirements ?? [];
    if (workspaces.length === 0) {
      unassigned.push(role.id);
      continue;
    }
    for (const workspace of workspaces) {
      counts.set(workspace, (counts.get(workspace) ?? 0) + 1);
    }
  }

  return {
    roleCount,
    workspaces: ROLE_WORKSPACE_KEYS.map((key) => ({
      key,
      label: ROLE_WORKSPACE_LABELS[key],
      roleCount: counts.get(key) ?? 0,
    })),
    unassignedRoleIds: unassigned,
    auditFindings: auditRoleWorkspaces(),
  };
}

/**
 * A bounded, clearly-labelled sample of role → workspace assignments. The caller
 * must display the registry total alongside it, so a sample is never mistaken for
 * the whole catalog.
 */
export function scholarRoleWorkspaceSample(limit = 25): readonly {
  roleId: string;
  name: string;
  category: string;
  workspaces: readonly RoleWorkspaceKey[];
}[] {
  return EDUCATION_REALITY_ROLES.slice(0, Math.max(0, limit)).map((role) => ({
    roleId: role.id,
    name: role.name,
    category: role.category,
    workspaces: workspacesForRole(role.id),
  }));
}
