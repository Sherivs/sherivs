/**
 * Sherivs organization workspace routing (ACTIVE-V1).
 *
 * Canonical Plane C:
 *   /o/{organization}
 *   /o/{organization}/scholar{legacyScholarPath}
 *
 * Role paths such as /admin and /teacher remain LEGACY aliases. They must
 * redirect to the bound scholar path when an organization slug is known.
 *
 * Does not rename database objects. Does not un-freeze V2/V3.
 */
export const ORGANIZATION_WORKSPACE_PREFIX = "/o" as const;
export const SCHOLAR_RUNTIME_SEGMENT = "scholar" as const;
export const INSTALLED_SCHOLAR_RUNTIME_ID = "runtime:scholar" as const;

/** First URL segment of Scholar role workspaces (LEGACY top-level paths). */
export const LEGACY_SCHOLAR_PATH_PREFIXES = [
  "/admin",
  "/teacher",
  "/student",
  "/parent",
  "/bursar",
  "/hq",
  "/driver",
] as const;

/** Universal organization-workspace paths (not a domain runtime). */
export const ORGANIZATION_SHELL_PATH_PREFIXES = [
  "/messages",
  "/notifications",
  "/settings",
  "/runtime",
] as const;

const SCHOLAR_PREFIX_SET = LEGACY_SCHOLAR_PATH_PREFIXES;
const SHELL_PREFIX_SET = ORGANIZATION_SHELL_PATH_PREFIXES;

export function normalizeAppPath(path: string): string {
  const raw = path.split("?")[0]?.split("#")[0] || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw || "/";
}

export function isOrganizationSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,47}$/.test(value);
}

export function organizationWorkspacePath(organizationSlug: string): string {
  return `${ORGANIZATION_WORKSPACE_PREFIX}/${organizationSlug}`;
}

export function scholarRuntimePath(organizationSlug: string): string {
  return `${organizationWorkspacePath(organizationSlug)}/${SCHOLAR_RUNTIME_SEGMENT}`;
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isLegacyScholarPath(path: string): boolean {
  const normalized = normalizeAppPath(path);
  return SCHOLAR_PREFIX_SET.some((prefix) => matchesPrefix(normalized, prefix));
}

export function isOrganizationShellPath(path: string): boolean {
  const normalized = normalizeAppPath(path);
  return SHELL_PREFIX_SET.some((prefix) => matchesPrefix(normalized, prefix));
}

export function parseOrganizationPath(path: string): {
  readonly organizationSlug: string | null;
  readonly scholarLeaf: string | null;
  readonly shellLeaf: string | null;
  readonly bound: boolean;
} {
  const normalized = normalizeAppPath(path);
  const match = normalized.match(/^\/o\/([a-z0-9][a-z0-9-]{1,47})(?:\/(.*))?$/);
  if (!match) {
    return { organizationSlug: null, scholarLeaf: null, shellLeaf: null, bound: false };
  }
  const organizationSlug = match[1];
  const rest = match[2] ?? "";
  if (!rest) {
    return { organizationSlug, scholarLeaf: null, shellLeaf: null, bound: true };
  }
  if (rest === SCHOLAR_RUNTIME_SEGMENT || rest.startsWith(`${SCHOLAR_RUNTIME_SEGMENT}/`)) {
    const leaf = rest === SCHOLAR_RUNTIME_SEGMENT ? "/" : rest.slice(SCHOLAR_RUNTIME_SEGMENT.length);
    return { organizationSlug, scholarLeaf: leaf || "/", shellLeaf: null, bound: true };
  }
  return { organizationSlug, scholarLeaf: null, shellLeaf: `/${rest}`, bound: true };
}

/**
 * Bind a workspace leaf onto the canonical organization path.
 * Scholar role leaves sit under /scholar. Universal shell leaves sit on the org.
 */
export function bindOrganizationPath(
  organizationSlug: string,
  leafPath: string,
  runtimeId: string | null = INSTALLED_SCHOLAR_RUNTIME_ID,
): string {
  const leaf = normalizeAppPath(leafPath);
  if (!isOrganizationSlug(organizationSlug)) return leaf;
  const parsed = parseOrganizationPath(leaf);
  if (parsed.bound) return leaf;
  if (isLegacyScholarPath(leaf) && runtimeId === INSTALLED_SCHOLAR_RUNTIME_ID) {
    return `${scholarRuntimePath(organizationSlug)}${leaf}`;
  }
  if (isOrganizationShellPath(leaf)) {
    return `${organizationWorkspacePath(organizationSlug)}${leaf}`;
  }
  if (leaf === "/" || leaf === "/runtime") {
    return organizationWorkspacePath(organizationSlug);
  }
  return leaf;
}

export function scholarBoundHome(organizationSlug: string, scholarHome: string): string {
  return bindOrganizationPath(organizationSlug, scholarHome, INSTALLED_SCHOLAR_RUNTIME_ID);
}

/**
 * Bound workspace leaf for highlighting/nav compare. `/o/{org}/scholar/admin/x`
 * compares as `/admin/x` so LEGACY and canonical URLs share the same chrome.
 */
export function workspaceLeafPath(path: string): string {
  const parsed = parseOrganizationPath(path);
  if (parsed.scholarLeaf) return parsed.scholarLeaf;
  if (parsed.shellLeaf) return parsed.shellLeaf;
  return normalizeAppPath(path);
}

/** Bind Scholar role URLs onto the org path. Shell URLs stay top-level. */
export function bindNavUrl(organizationSlug: string | null | undefined, url: string): string {
  if (!organizationSlug || !isOrganizationSlug(organizationSlug)) return url;
  if (isLegacyScholarPath(url)) {
    return bindOrganizationPath(organizationSlug, url, INSTALLED_SCHOLAR_RUNTIME_ID);
  }
  return url;
}

export type ScholarRolePrefix = (typeof LEGACY_SCHOLAR_PATH_PREFIXES)[number];

export const SCHOLAR_ROLE_GUARD: Readonly<Record<string, readonly string[]>> = {
  admin: ["admin", "principal"],
  teacher: ["teacher"],
  student: ["student"],
  parent: ["parent"],
  bursar: ["bursar"],
  hq: ["hq"],
  driver: ["driver"],
};

export function scholarRoleSegmentFromLeaf(leaf: string): string | null {
  const normalized = normalizeAppPath(leaf);
  const first = normalized.split("/").filter(Boolean)[0];
  return first && first in SCHOLAR_ROLE_GUARD ? first : null;
}
