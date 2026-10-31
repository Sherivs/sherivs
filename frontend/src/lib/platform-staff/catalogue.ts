/**
 * Sherivs internal console — platform role catalogue (mirror of the seed in
 * migration 20261020000150_sherivs_008_platform_staff.sql) and the per-role
 * internal workspace. PURE: no I/O. The database is the authority for
 * capabilities (`has_platform_capability`); this mirror drives UI only.
 */
export const PLATFORM_ROLE_CODES = [
  "platform_admin",
  "support",
  "engineering",
  "security",
  "finance",
  "sales",
  "operations",
] as const;
export type PlatformRoleCode = (typeof PLATFORM_ROLE_CODES)[number];

export const PLATFORM_STAFF_STATUSES = ["invited", "active", "suspended", "revoked"] as const;
export type PlatformStaffStatus = (typeof PLATFORM_STAFF_STATUSES)[number];

export const PLATFORM_ROLE_CAPABILITIES: Record<PlatformRoleCode, readonly string[]> = {
  platform_admin: [
    "platform.staff.read",
    "platform.staff.manage",
    "platform.tenants.read",
    "platform.tenants.manage",
    "platform.config.read",
    "platform.audit.read",
    "platform.gov.manage",
  ],
  support: ["platform.tenants.read", "platform.support.handle"],
  engineering: ["platform.engineering.read", "platform.config.read"],
  security: ["platform.security.read", "platform.audit.read"],
  finance: ["platform.finance.read"],
  sales: ["platform.tenants.read", "platform.sales.handle"],
  operations: [
    "platform.operations.read",
    "platform.config.read",
    "platform.tenants.read",
    "platform.tenants.manage",
  ],
};

export const PLATFORM_ROLE_LABELS: Record<PlatformRoleCode, string> = {
  platform_admin: "Platform admin",
  support: "Support",
  engineering: "Engineering",
  security: "Security",
  finance: "Finance",
  sales: "Sales",
  operations: "Operations",
};

/** Roles only a super admin may grant (all grants are super-admin-only today). */
export const PRIVILEGED_PLATFORM_ROLES: ReadonlySet<PlatformRoleCode> = new Set(["platform_admin"]);

export function isPlatformRoleCode(v: string): v is PlatformRoleCode {
  return (PLATFORM_ROLE_CODES as readonly string[]).includes(v);
}

/** Union of capabilities for a set of role codes (unknown codes ignored). */
export function capabilitiesForRoles(roles: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const r of roles)
    if (isPlatformRoleCode(r)) PLATFORM_ROLE_CAPABILITIES[r].forEach((c) => out.add(c));
  return out;
}

/** Allowed lifecycle transitions for staff administration. */
const TRANSITIONS: Record<PlatformStaffStatus, readonly PlatformStaffStatus[]> = {
  invited: ["revoked"],
  active: ["suspended", "revoked"],
  suspended: ["active", "revoked"],
  revoked: [],
};
export function canTransition(from: PlatformStaffStatus, to: PlatformStaffStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A section of the internal workspace, shown when the viewer holds `capability`. */
export interface InternalWorkspaceSection {
  key: string;
  title: string;
  description: string;
  /** Capability that unlocks the section; null = every active staff member. */
  capability: string | null;
  /** Target route. Super-admin-only routes are listed for super admins only. */
  href: string;
  superAdminOnly: boolean;
}

export function visibleInternalSections<
  T extends Pick<InternalWorkspaceSection, "capability" | "superAdminOnly">,
>(
  sections: readonly T[],
  viewer: { isSuperAdmin: boolean; capabilities: ReadonlySet<string> },
): T[] {
  if (viewer.isSuperAdmin) return [...sections];
  return sections.filter(
    (s) => !s.superAdminOnly && (s.capability === null || viewer.capabilities.has(s.capability)),
  );
}
