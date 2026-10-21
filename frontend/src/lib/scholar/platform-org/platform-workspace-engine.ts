/**
 * Sherivs Scholar — Sherivs internal operating workspace (WAVE-R32).
 *
 * Generates the platform organization's workspaces from the roles an actor
 * actually holds (SHERIVS_INTERNAL groups). No fixed dashboards: a CTO sees
 * the executive + engineering departments because those are the groups their
 * roles belong to; an AI engineer sees the AI department.
 */

import { rolesByGroupMember } from "../roles/role-registry";
import { workspacesForRoles, type WorkspaceAssignment } from "../roles/role-workspace-engine";
import {
  PLATFORM_DEPARTMENTS,
  PLATFORM_WIDGET_KEYS,
  type PlatformDepartment,
} from "./department-catalog";

export interface PlatformDepartmentAssignment {
  department: string;
  label: string;
  workspace: PlatformDepartment["workspace"];
  /** Actor's roles that staff this department. */
  roles: readonly string[];
  /** Widgets the department renders for this actor. */
  widgets: readonly string[];
}

export interface PlatformOrgSnapshot {
  departments: readonly {
    department: string;
    label: string;
    roles: readonly string[];
    widgets: readonly string[];
  }[];
  roleCount: number;
  widgetCount: number;
}

/** Every role the platform organization staffs, from the role engine. */
export function platformOrgRoles(): readonly string[] {
  const ids = new Set<string>();
  for (const department of PLATFORM_DEPARTMENTS) {
    for (const group of department.groups) {
      for (const role of rolesByGroupMember(group)) ids.add(role.id);
    }
  }
  return [...ids].sort();
}

/** Department workspaces an actor's roles unlock (deterministic order). */
export function platformWorkspaceForRoles(
  roleIds: readonly string[],
): readonly PlatformDepartmentAssignment[] {
  const assignments: PlatformDepartmentAssignment[] = [];
  for (const department of PLATFORM_DEPARTMENTS) {
    const roles = department.groups.flatMap((group) =>
      rolesByGroupMember(group)
        .map((role) => role.id)
        .filter((id) => roleIds.includes(id)),
    );
    if (roles.length === 0) continue;
    assignments.push({
      department: department.key,
      label: department.label,
      workspace: department.workspace,
      roles: [...new Set(roles)].sort(),
      widgets: department.widgets,
    });
  }
  return assignments;
}

/** Internal workspaces an actor receives (workspace-engine composition). */
export function platformInternalWorkspaces(
  roleIds: readonly string[],
): readonly WorkspaceAssignment[] {
  const platformRoles = roleIds.filter((id) => platformOrgRoles().includes(id));
  return workspacesForRoles(platformRoles);
}

/** Structural snapshot of the platform organization (audit + surfaces). */
export function platformOrgSnapshot(): PlatformOrgSnapshot {
  return {
    departments: PLATFORM_DEPARTMENTS.map((department) => ({
      department: department.key,
      label: department.label,
      roles: department.groups.flatMap((group) => rolesByGroupMember(group).map((role) => role.id)),
      widgets: department.widgets,
    })),
    roleCount: platformOrgRoles().length,
    widgetCount: PLATFORM_WIDGET_KEYS.length,
  };
}

/** Structural audit: every department is staffed and declares widgets. */
export function auditPlatformOrg(): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const department of PLATFORM_DEPARTMENTS) {
    if (seen.has(department.key)) issues.push(`${department.key}: duplicate department key`);
    seen.add(department.key);
    if (department.widgets.length === 0) issues.push(`${department.key}: declares no widget`);
    const roles = department.groups.flatMap((group) => rolesByGroupMember(group));
    if (roles.length === 0) issues.push(`${department.key}: no role staffs this department`);
    for (const widget of department.widgets) {
      if (!PLATFORM_WIDGET_KEYS.includes(widget)) {
        issues.push(`${department.key}: widget "${widget}" is not in the widget index`);
      }
    }
  }
  return issues;
}
