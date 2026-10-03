/**
 * CoreGrid — neutral core role vocabulary (V1-006 platform authorization layer).
 *
 * The platform's RBAC substrate: every role here is domain-neutral. Education
 * (runtime-001) and restaurant (second-domain fixture) roles are NOT defined
 * here — a domain contributes its own roles through
 * `rbac/domain-contribution.ts` registerDomainAuthorization, mapping each
 * domain role onto THIS vocabulary (directional, RULING-4: domain -> neutral
 * only) plus its capability grants.
 *
 * Boundary: pure data. Types only — no runtime imports, no vendor, no domain
 * vocabulary of any kind.
 */
import type { Permission } from "../identity";

/**
 * The neutral core role set. Platform/engineering roles keep their historical
 * names (behavioral compatibility); the organizational trio (org_owner,
 * org_admin, member) is the tenant-facing neutral hierarchy every domain maps
 * onto.
 */
export const NEUTRAL_CORE_ROLES = [
  // Control plane + platform engineering.
  "coregrid_owner",
  "platform_admin",
  "engineer",
  "senior_engineer",
  "support_engineer",
  "security_engineer",
  "sre",
  "data_engineer",
  "ai_engineer",
  "ai_operator",
  "product",
  "finance",
  "compliance",
  "auditor",
  "support",
  "read_only",
  // Neutral tenant organization hierarchy.
  "org_owner",
  "org_admin",
  "member",
] as const;

export type NeutralCoreRole = (typeof NEUTRAL_CORE_ROLES)[number];

export const NEUTRAL_CORE_ROLE_SET: ReadonlySet<string> = new Set<string>(NEUTRAL_CORE_ROLES);

/** Fail-closed membership check for untrusted role strings. */
export function isNeutralCoreRole(value: unknown): value is NeutralCoreRole {
  return typeof value === "string" && NEUTRAL_CORE_ROLE_SET.has(value);
}

/**
 * Coarse-grained neutral role -> capability grants. RBAC alone is never
 * sufficient (the combined engine layers PBAC/ABAC/ReBAC on top).
 *
 * Capability resources are the NEUTRAL permission-resource vocabulary of the
 * identity model (tenant, identity, user, session, …). A domain resource name
 * never appears here: domain roles carry their own grants in the domain
 * contribution registry.
 */
export const NEUTRAL_ROLE_PERMISSIONS: Readonly<Record<NeutralCoreRole, readonly Permission[]>> = {
  coregrid_owner: [
    { resource: "tenant", action: "manage", scope: null },
    { resource: "identity", action: "manage", scope: null },
    { resource: "settings", action: "manage", scope: null },
    { resource: "audit_log", action: "read", scope: null },
  ],
  platform_admin: [
    { resource: "tenant", action: "manage", scope: null },
    { resource: "identity", action: "manage", scope: null },
    { resource: "settings", action: "manage", scope: null },
  ],
  engineer: [
    { resource: "settings", action: "read", scope: null },
    { resource: "audit_log", action: "read", scope: null },
  ],
  senior_engineer: [
    { resource: "settings", action: "manage", scope: null },
    { resource: "audit_log", action: "read", scope: null },
  ],
  support_engineer: [
    { resource: "user", action: "read", scope: null },
    { resource: "identity", action: "read", scope: null },
  ],
  security_engineer: [
    { resource: "identity", action: "read", scope: null },
    { resource: "audit_log", action: "read", scope: null },
    { resource: "session", action: "read", scope: null },
  ],
  sre: [
    { resource: "settings", action: "read", scope: null },
    { resource: "audit_log", action: "read", scope: null },
  ],
  data_engineer: [{ resource: "analytics", action: "read", scope: null }],
  ai_engineer: [{ resource: "ai_agent", action: "manage", scope: null }],
  ai_operator: [
    { resource: "ai_agent", action: "read", scope: null },
    { resource: "ai_agent", action: "execute", scope: null },
  ],
  product: [{ resource: "analytics", action: "read", scope: null }],
  finance: [
    { resource: "payments", action: "read", scope: null },
    { resource: "billing", action: "read", scope: null },
  ],
  compliance: [
    { resource: "audit_log", action: "read", scope: null },
    { resource: "identity", action: "read", scope: null },
  ],
  auditor: [{ resource: "audit_log", action: "read", scope: null }],
  support: [{ resource: "user", action: "read", scope: null }],
  read_only: [],
  org_owner: [
    { resource: "tenant", action: "manage", scope: null },
    { resource: "identity", action: "manage", scope: null },
    { resource: "settings", action: "manage", scope: null },
    { resource: "audit_log", action: "read", scope: null },
  ],
  org_admin: [
    { resource: "tenant", action: "update", scope: null },
    { resource: "user", action: "manage", scope: null },
    { resource: "settings", action: "update", scope: null },
    { resource: "identity", action: "read", scope: null },
  ],
  // Baseline tenant participant: authority flows only through explicit
  // delegation (extraPermissions) or an owns/manages relationship.
  member: [],
};
