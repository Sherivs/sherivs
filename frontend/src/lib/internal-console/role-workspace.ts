/**
 * Role-to-Workspace Provisioning Engine — mapping contract.
 *
 * Presentation labels map onto existing `platform_roles` codes. Super admins
 * are not a platform_roles row; they resolve to the `platform_owner` mapping.
 * Workspace membership never grants capabilities.
 */
import { PLATFORM_ROLE_CODES, PLATFORM_ROLE_LABELS } from "@/lib/platform-staff/catalogue";
import { presentationRoleFor, type ConsolePresentationRole } from "./roles";

export type RoleWorkspaceKind = "personal" | "shared" | "role";

export interface RoleWorkspaceMapping {
  roleCode: string;
  slug: string;
  name: string;
  description: string;
  presentationRole: ConsolePresentationRole;
  inPlatformRoles: boolean;
}

export const ROLE_WORKSPACE_MAPPINGS: readonly RoleWorkspaceMapping[] = [
  {
    roleCode: "platform_owner",
    slug: "role-platform-operations",
    name: "Platform Operations",
    description:
      "Platform governance and authorized oversight. Membership is not a permission grant.",
    presentationRole: "platform_owner",
    inPlatformRoles: false,
  },
  {
    roleCode: "platform_admin",
    slug: "role-platform-admin",
    name: "Platform Administration",
    description: "Staff access and platform configuration within granted capabilities.",
    presentationRole: "platform_administrator",
    inPlatformRoles: true,
  },
  {
    roleCode: "operations",
    slug: "role-operations",
    name: "Operations",
    description: "Operational workflows and organization onboarding.",
    presentationRole: "operations_administrator",
    inPlatformRoles: true,
  },
  {
    roleCode: "engineering",
    slug: "role-engineering",
    name: "Engineering",
    description: "Technical diagnostics and engineering operations.",
    presentationRole: "engineer",
    inPlatformRoles: true,
  },
  {
    roleCode: "support",
    slug: "role-support",
    name: "Support",
    description: "Authorized support workflows and organization assistance.",
    presentationRole: "support_specialist",
    inPlatformRoles: true,
  },
];

const WORKSPACE_ROLE_ALIASES: Readonly<Record<string, string>> = {
  security: "platform_admin",
  finance: "operations",
  sales: "operations",
};

const PRIORITY = ROLE_WORKSPACE_MAPPINGS.map((row) => row.roleCode);

export function mappingForRole(roleCode: string): RoleWorkspaceMapping | null {
  const workspaceRole = WORKSPACE_ROLE_ALIASES[roleCode] ?? roleCode;
  return ROLE_WORKSPACE_MAPPINGS.find((row) => row.roleCode === workspaceRole) ?? null;
}

export function roleCodesForWorkspaceProvisioning(input: {
  isSuperAdmin: boolean;
  roles: readonly string[];
}): string[] {
  const codes = new Set<string>();
  if (input.isSuperAdmin) codes.add("platform_owner");
  for (const role of input.roles) {
    const mapping = mappingForRole(role);
    if (mapping) codes.add(mapping.roleCode);
  }
  return PRIORITY.filter((role) => codes.has(role));
}

export function defaultRoleWorkspaceCode(input: {
  isSuperAdmin: boolean;
  roles: readonly string[];
}): string | null {
  return roleCodesForWorkspaceProvisioning(input)[0] ?? null;
}

export function presentationToDatabaseRoles(
  presentation: ConsolePresentationRole,
): readonly string[] {
  switch (presentation) {
    case "platform_owner":
      return [];
    case "platform_administrator":
      return ["platform_admin"];
    case "operations_administrator":
      return ["operations"];
    case "engineer":
      return ["engineering"];
    case "support_specialist":
      return ["support"];
    case "standard_team_member":
      return [];
  }
}

export function databaseRolesCoveredByMappings(): readonly string[] {
  return PLATFORM_ROLE_CODES.filter((code) =>
    ROLE_WORKSPACE_MAPPINGS.some((row) => row.roleCode === code),
  );
}

export function mappingLabel(roleCode: string): string {
  const mapped = mappingForRole(roleCode);
  if (mapped) return mapped.name;
  return roleCode in PLATFORM_ROLE_LABELS
    ? PLATFORM_ROLE_LABELS[roleCode as keyof typeof PLATFORM_ROLE_LABELS]
    : roleCode;
}

export function workspaceToolsForRole(input: {
  isSuperAdmin: boolean;
  roles: readonly string[];
  slug: string;
}): ConsolePresentationRole {
  const mapping = ROLE_WORKSPACE_MAPPINGS.find((row) => row.slug === input.slug);
  if (mapping) return mapping.presentationRole;
  return presentationRoleFor(input);
}
