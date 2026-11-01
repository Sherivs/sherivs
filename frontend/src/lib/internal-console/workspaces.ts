/**
 * V1 internal workspaces.
 *
 * Canonical records live in `platform_workspace` when the Internal Console
 * store is applied. Derived role workspaces remain a fallback when that store
 * is not configured, and never authorize access on their own.
 */
import { CONSOLE_PATHS } from "./paths";
import {
  mappingForRole,
  ROLE_WORKSPACE_MAPPINGS,
  roleCodesForWorkspaceProvisioning,
  type RoleWorkspaceMapping,
} from "./role-workspace";

export const WORKSPACE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type InternalWorkspaceType = "personal" | "shared" | "role";
export type InternalWorkspaceAccess = "owner" | "member";
export type InternalWorkspaceSource = "database" | "derived";

export interface InternalWorkspace {
  id: string;
  recordId: string;
  name: string;
  description: string;
  type: InternalWorkspaceType;
  access: InternalWorkspaceAccess;
  team: string;
  href: string;
  status: "active" | "archived";
  source: InternalWorkspaceSource;
  slug: string;
  members: readonly { userId: string; access: InternalWorkspaceAccess }[];
}

export const PERSONAL_WORKSPACE_ID = "me";

export function personalWorkspace(displayName: string): InternalWorkspace {
  return {
    id: PERSONAL_WORKSPACE_ID,
    recordId: PERSONAL_WORKSPACE_ID,
    name: "My Workspace",
    description: `${displayName}'s personal working environment. Private by default.`,
    type: "personal",
    access: "owner",
    team: displayName,
    href: CONSOLE_PATHS.myWorkspace,
    status: "active",
    source: "derived",
    slug: "me",
    members: [],
  };
}

export function roleWorkspaceFromMapping(mapping: RoleWorkspaceMapping): InternalWorkspace {
  return {
    id: `role:${mapping.roleCode}`,
    recordId: `role:${mapping.roleCode}`,
    name: mapping.name,
    description: `${mapping.description} Membership is not a permission grant.`,
    type: "role",
    access: "member",
    team: mapping.name,
    href: CONSOLE_PATHS.workspace(`role:${mapping.roleCode}`),
    status: "active",
    source: "derived",
    slug: mapping.slug,
    members: [],
  };
}

export function sharedWorkspaceForRole(role: string): InternalWorkspace | null {
  const mapping = mappingForRole(role);
  return mapping ? roleWorkspaceFromMapping(mapping) : null;
}

export function workspacesForViewer(input: {
  displayName: string;
  isSuperAdmin: boolean;
  roles: readonly string[];
}): InternalWorkspace[] {
  const personal = personalWorkspace(input.displayName);
  const roleWorkspaces = roleCodesForWorkspaceProvisioning(input)
    .map((role) => sharedWorkspaceForRole(role))
    .filter((row): row is InternalWorkspace => row !== null);
  const seen = new Set<string>();
  return [personal, ...roleWorkspaces].filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export function parseWorkspaceId(
  raw: string,
): { kind: "personal" } | { kind: "role"; role: string } | { kind: "record"; id: string } | null {
  if (raw === PERSONAL_WORKSPACE_ID) return { kind: "personal" };
  if (WORKSPACE_UUID_RE.test(raw)) return { kind: "record", id: raw };
  const token = raw.startsWith("role:") ? raw.slice("role:".length) : raw;
  const mapped =
    mappingForRole(token) ??
    ROLE_WORKSPACE_MAPPINGS.find((row) => row.slug === raw || row.slug === token) ??
    null;
  if (mapped) return { kind: "role", role: mapped.roleCode };
  return null;
}

export function workspaceById(
  id: string,
  viewer: { displayName: string; isSuperAdmin: boolean; roles: readonly string[] },
): InternalWorkspace | null {
  const parsed = parseWorkspaceId(id);
  if (!parsed) return null;
  if (parsed.kind === "personal") return personalWorkspace(viewer.displayName);
  if (parsed.kind === "record") return null;
  const ws = sharedWorkspaceForRole(parsed.role);
  if (!ws) return null;
  if (
    (viewer.isSuperAdmin && parsed.role === "platform_owner") ||
    viewer.roles.some((role) => mappingForRole(role)?.roleCode === parsed.role)
  ) {
    return ws;
  }
  return null;
}

/**
 * Working-set visibility. Managing staff membership is not a license to open
 * another person's personal workspace. Shared workspaces remain visible to
 * staff.manage for membership administration.
 */
export function isWorkingWorkspace(input: {
  kind: InternalWorkspaceType;
  ownerId: string;
  viewerId: string;
  isMember: boolean;
  canManageShared: boolean;
}): boolean {
  if (input.kind === "personal") return input.isMember || input.ownerId === input.viewerId;
  return input.canManageShared || input.isMember;
}

export function workspaceTypeLabel(type: InternalWorkspaceType): string {
  if (type === "personal") return "Personal";
  if (type === "role") return "Role";
  return "Shared";
}

export function workspaceFromAuthorized(
  id: string,
  workspaces: readonly InternalWorkspace[],
  viewer: { displayName: string; isSuperAdmin: boolean; roles: readonly string[] },
): InternalWorkspace | null {
  const needle = id === PERSONAL_WORKSPACE_ID ? "me" : id;
  const found = workspaces.find((row) => row.id === needle || row.recordId === id);
  if (found) return found;
  return workspaceById(id, viewer);
}

/** Active workspace from the console path, if the path names one. */
export function workspaceIdFromPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === CONSOLE_PATHS.myWorkspace) return PERSONAL_WORKSPACE_ID;
  const prefix = `${CONSOLE_PATHS.workspaces}/`;
  if (!path.startsWith(prefix)) return null;
  const id = decodeURIComponent(path.slice(prefix.length).split("/")[0] ?? "");
  return parseWorkspaceId(id) ? id : null;
}
