/**
 * CoreGrid — domain authorization contribution registry (V1-006).
 *
 * The registration half of the DomainDefinition pattern (the configuration
 * model proven by `domain-config/restaurant.ts`): a domain declares its own
 * roles ONCE — each with its neutral-role semantics (directional, RULING-4:
 * domain -> neutral only) and its capability grants — and the authorization
 * engine resolves them exactly like a core role. The core never learns a
 * domain role name by declaration; registration is the only path in, and it
 * fails closed.
 *
 * Also resolves the combined grant table for the authorization engine:
 * neutral core roles from `rbac/neutral-roles.ts`, contributed domain roles
 * from the registry below.
 *
 * Boundary: pure data + pure functions over the platform's own vocabularies.
 * No vendor, no persistence, no domain vocabulary of any kind.
 */
import { registerDomainRelationshipTypes, type Permission } from "../identity";
import { isUniversalRole, type UniversalRole } from "../universal-roles";
import { isNeutralCoreRole, NEUTRAL_ROLE_PERMISSIONS } from "./neutral-roles";

/* ─────────────────────────────────────────────────────────────
 * Registered domain role type
 * ────────────────────────────────────────────────────────────*/

/**
 * A role contributed by a domain through registration. Branded: domain code
 * converts a plain role name explicitly (`domainRole("…")`) at its own
 * boundary, keeping the core's `CoreGridRole` union honest — a typo'd or
 * unregistered role cannot flow into the engine unnoticed.
 */
export type DomainRegisteredRole = string & { readonly __brand: "DomainRegisteredRole" };

/** Mark a string as a registered domain role at the domain boundary. */
export function domainRole(value: string): DomainRegisteredRole {
  return value as DomainRegisteredRole;
}

/* ─────────────────────────────────────────────────────────────
 * Contribution contract
 * ────────────────────────────────────────────────────────────*/

export interface DomainRoleContribution {
  /** Domain-local role name (e.g. "floor_manager"); the mapping is the semantic. */
  domainRole: string;
  /** Neutral core-vocabulary semantics this domain role resolves to (RULING-4 direction). */
  neutralRoles: readonly UniversalRole[];
  /** Capability grants the engine honors for this role. */
  permissions: readonly Permission[];
  /** Why this resolution exists — a mapping that cannot be explained must not exist. */
  description: string;
}

export interface DomainAuthorizationContribution {
  /** Namespaced domain id (/^[a-z][a-z0-9_]*$/); registered exactly once. */
  domainId: string;
  roles: readonly DomainRoleContribution[];
  /** Optional domain-contributed relationship types (registered into the identity vocabulary). */
  relationshipTypes?: readonly string[];
}

export type DomainRegistrationResult =
  | { ok: true; domainId: string; registeredRoles: readonly string[] }
  | { ok: false; errors: readonly string[] };

/* ─────────────────────────────────────────────────────────────
 * Registry (fail-closed)
 * ────────────────────────────────────────────────────────────*/

const DOMAIN_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const DOMAIN_ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

const PERMISSION_ACTION_SET: ReadonlySet<string> = new Set([
  "create",
  "read",
  "update",
  "delete",
  "manage",
  "approve",
  "invite",
  "suspend",
  "restore",
  "verify",
  "rotate",
  "execute",
  "review",
]);

interface RegisteredDomainRole {
  domainId: string;
  permissions: readonly Permission[];
}

const REGISTERED_ROLES = new Map<string, RegisteredDomainRole>();
const REGISTERED_DOMAIN_IDS = new Set<string>();

function validatePermission(value: unknown, scope: string, errors: string[]): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${scope} must be a permission object`);
    return;
  }
  const permission = value as Partial<Permission>;
  if (typeof permission.resource !== "string" || permission.resource.trim() === "") {
    errors.push(`${scope} requires a non-empty resource string`);
  }
  if (typeof permission.action !== "string" || !PERMISSION_ACTION_SET.has(permission.action)) {
    errors.push(`${scope} action must be one of the modeled permission actions`);
  }
  if (
    permission.scope !== undefined &&
    permission.scope !== null &&
    typeof permission.scope !== "string"
  ) {
    errors.push(`${scope} scope must be a string or null`);
  }
}

/**
 * Register a domain authorization contribution (fail-closed, atomic).
 *
 * Rejections:
 *  - malformed domainId or duplicate domainId;
 *  - a domain role name that is malformed, shadows a neutral core role, is a
 *    neutral universal-role name (RULING-4 reverse attempt), or collides with
 *    any previously registered domain role (a bare role string must have
 *    exactly one meaning platform-wide);
 *  - an empty or unknown neutralRoles mapping, or an invalid permission grant;
 *  - an invalid relationship type (delegated to the identity vocabulary's own
 *    fail-closed registration).
 *
 * Nothing is committed unless every entry validates.
 */
export function registerDomainAuthorization(
  contribution: DomainAuthorizationContribution,
): DomainRegistrationResult {
  const errors: string[] = [];
  const { domainId, roles, relationshipTypes } = contribution;

  if (typeof domainId !== "string" || !DOMAIN_ID_PATTERN.test(domainId)) {
    return {
      ok: false,
      errors: [
        `domain id ${JSON.stringify(domainId)} is not a valid domain id (/^[a-z][a-z0-9_]*$/)`,
      ],
    };
  }
  if (REGISTERED_DOMAIN_IDS.has(domainId)) {
    return { ok: false, errors: [`domain "${domainId}" is already registered`] };
  }
  if (!Array.isArray(roles) || roles.length === 0) {
    errors.push(`domain "${domainId}" must contribute at least one role`);
  }

  const validated: Array<{ domainRole: string; permissions: readonly Permission[] }> = [];
  if (Array.isArray(roles)) {
    for (const role of roles) {
      const name = role?.domainRole;
      const scope = `domain "${domainId}" role ${JSON.stringify(name)}`;
      if (typeof name !== "string" || !DOMAIN_ROLE_NAME_PATTERN.test(name)) {
        errors.push(`${scope} is not a valid domain role name (/^[a-z][a-z0-9_]*$/)`);
        continue;
      }
      if (isNeutralCoreRole(name)) {
        errors.push(`${scope} shadows a neutral core role — the core vocabulary is closed`);
        continue;
      }
      if (isUniversalRole(name)) {
        errors.push(
          `${scope} is a neutral universal-role name — a domain role can never be one (RULING-4)`,
        );
        continue;
      }
      if (REGISTERED_ROLES.has(name)) {
        errors.push(
          `${scope} collides with a role already registered by domain "${REGISTERED_ROLES.get(name)?.domainId}" — a bare role name must have one meaning platform-wide`,
        );
        continue;
      }
      if (!Array.isArray(role.neutralRoles) || role.neutralRoles.length === 0) {
        errors.push(`${scope} must declare a non-empty neutralRoles mapping`);
      } else {
        for (const neutralRole of role.neutralRoles) {
          if (!isUniversalRole(neutralRole)) {
            errors.push(
              `${scope} maps to ${JSON.stringify(neutralRole)} which is not in the universal role vocabulary`,
            );
          }
        }
      }
      if (!Array.isArray(role.permissions) || role.permissions.length === 0) {
        errors.push(`${scope} must declare a non-empty permissions array`);
      } else {
        role.permissions.forEach((permission: Permission, index: number) =>
          validatePermission(permission, `${scope} permission #${index}`, errors),
        );
      }
      if (typeof role.description !== "string" || role.description.trim() === "") {
        errors.push(`${scope} requires a documentation string`);
      }
      validated.push({ domainRole: name, permissions: role.permissions });
    }
  }

  // Relationship types register through the identity vocabulary's own
  // fail-closed path — but only once the role declarations validate, so a
  // rejection anywhere leaves the registry untouched (atomic).
  if (errors.length === 0 && relationshipTypes !== undefined) {
    const relationshipResult = registerDomainRelationshipTypes(relationshipTypes);
    if (!relationshipResult.ok) {
      errors.push(...relationshipResult.errors);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  for (const entry of validated) {
    REGISTERED_ROLES.set(entry.domainRole, { domainId, permissions: entry.permissions });
  }
  REGISTERED_DOMAIN_IDS.add(domainId);
  return {
    ok: true,
    domainId,
    registeredRoles: validated.map((entry) => entry.domainRole),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Resolution
 * ────────────────────────────────────────────────────────────*/

/** Grants for a registered domain role; null for anything unregistered. */
export function resolveDomainRoleGrants(role: string): readonly Permission[] | null {
  const registered = REGISTERED_ROLES.get(role);
  return registered ? registered.permissions : null;
}

/** Whether the role string is a registered domain role (never a core role check — use isNeutralCoreRole). */
export function isRegisteredDomainRole(role: string): boolean {
  return REGISTERED_ROLES.has(role);
}

/** Every registered domain role name, across all registered domains. */
export function registeredDomainRoles(): readonly string[] {
  return [...REGISTERED_ROLES.keys()];
}

/** Every registered domain id. */
export function registeredDomainIds(): readonly string[] {
  return [...REGISTERED_DOMAIN_IDS];
}

/**
 * Combined grant resolution for the authorization engine: neutral core roles
 * resolve from the platform table, registered domain roles from the
 * registry, and the result is the union (a name resolves in exactly one of
 * the two vocabularies — registration rejects shadowing). Unknown roles
 * resolve to no grants; the engine then fails closed.
 */
export function resolveRoleGrants(role: string): readonly Permission[] {
  const neutral = isNeutralCoreRole(role) ? NEUTRAL_ROLE_PERMISSIONS[role] : [];
  const domain = resolveDomainRoleGrants(role) ?? [];
  return [...(neutral ?? []), ...domain];
}
