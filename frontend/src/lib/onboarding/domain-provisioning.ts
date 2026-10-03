/**
 * CoreGrid — V1-008: the domain-provisioning contribution registry.
 *
 * The registration half of the onboarding engine's DomainDefinition pattern
 * (modeled on `rbac/domain-contribution.ts`): a domain declares ONCE how its
 * organizations, workspaces, memberships and auxiliary records map onto the
 * EXISTING substrate tables — as pure builder configuration over the neutral
 * provisioning contract — and the platform engine drives those declarations.
 * The engine hardcodes no domain table, no domain column and no domain role.
 *
 * Fail-closed and atomic (§16, §22): malformed domain ids, duplicate domain
 * ids, request-role collisions inside a contribution, cross-domain claims of
 * another contribution's domain-contributed platform role (a domain role name
 * must keep exactly one provisioning owner platform-wide), invalid substrate
 * table names, non-function builders and invalid neutral-role mappings all
 * reject the ENTIRE registration; nothing commits unless everything validates.
 *
 * Boundary: pure data + pure functions over the platform's own vocabularies.
 * No vendor, no persistence, no runtime engine.
 */
import { isNeutralCoreRole } from "@/lib/rbac/neutral-roles";
import { isUniversalRole, type UniversalRole } from "@/lib/universal-roles";
import type { Permission } from "@/lib/identity";
import {
  DOMAIN_ID_PATTERN,
  type OrganizationProvisioningRequest,
  type ProvisioningPerson,
} from "./provisioning-contract";

/* ─────────────────────────────────────────────────────────────
 * Contribution contract
 * ────────────────────────────────────────────────────────────*/

/**
 * What the engine has established so far, handed to every pure builder. The
 * builder composes substrate payloads from these facts — never from client
 * claims about tenants or roles.
 */
export interface ProvisioningContext {
  readonly request: OrganizationProvisioningRequest;
  /** Id of the created organization record; null only before the organization step. */
  readonly organizationId: string | null;
  /** Workspace name -> created record id. */
  readonly workspaceIds: Readonly<Record<string, string>>;
  /** Person email -> provisioned auth-account id (only for createAuthAccount people). */
  readonly authAccountIds: Readonly<Record<string, string>>;
}

/** How ONE requested person role resolves into the platform's role vocabularies. */
export interface ResolvedPersonRole {
  readonly requestedRole: string;
  /**
   * The platform role the request resolves to: either a neutral core role
   * (`rbac/neutral-roles.ts`) or a domain-contributed role registered through
   * `rbac/domain-contribution.ts`.
   */
  readonly platformRole: string;
  readonly vocabulary: "neutral-core" | "domain-contributed";
  /** Value the domain persists in its own membership record for this role. */
  readonly recordValue: string;
  /**
   * Neutral semantics evidence (RULING-4 domain -> neutral for contributed
   * roles; the core role itself for neutral-core roles).
   */
  readonly neutralSemantics: readonly string[];
  /** Capability grants the combined authorization engine resolves for the platform role. */
  readonly grants: readonly Permission[];
}

/** One accepted request-role mapping of a domain's provisioning vocabulary. */
export interface DomainProvisioningRoleDeclaration {
  /** Domain-local role names accepted in requests (canonical name first; legacy aliases allowed). */
  readonly accepts: readonly string[];
  /** The platform role these request names resolve to. */
  readonly platformRole: string;
  /** Value written into the domain's membership record for this role. */
  readonly recordValue: string;
  /** Neutral universal-role semantics (RULING-4 direction) for the provisioning evidence. */
  readonly neutralRoles: readonly UniversalRole[];
  /** Why this resolution exists — a mapping that cannot be explained must not exist. */
  readonly description: string;
}

/** The organization record write: the tenant record itself. */
export interface ProvisioningOrganizationSpec {
  readonly table: string;
  readonly build: (ctx: ProvisioningContext) => Record<string, unknown>;
}

/** A workspace write (0..n), declared by the domain. */
export interface ProvisioningWorkspaceSpec {
  readonly name: string;
  readonly table: string;
  readonly build: (ctx: ProvisioningContext) => Record<string, unknown>;
}

/** The membership write for one provisioned person. */
export interface ProvisioningMembershipSpec {
  readonly table: string;
  readonly build: (
    person: ProvisioningPerson,
    resolved: ResolvedPersonRole,
    ctx: ProvisioningContext,
  ) => Record<string, unknown>;
}

/** A domain-specific auxiliary write executed after memberships (e.g. a subscription row). */
export interface ProvisioningAuxiliarySpec {
  readonly name: string;
  readonly table: string;
  readonly build: (ctx: ProvisioningContext) => Record<string, unknown>;
}

export interface DomainProvisioningContribution {
  /** Namespaced domain id (/^[a-z][a-z0-9_]*$/); registered exactly once. */
  readonly domainId: string;
  readonly description?: string;
  /** The domain's provisioning role vocabulary (who may be provisioned, as what). */
  readonly roles: readonly DomainProvisioningRoleDeclaration[];
  readonly organization: ProvisioningOrganizationSpec;
  readonly workspaces: readonly ProvisioningWorkspaceSpec[];
  readonly membership: ProvisioningMembershipSpec;
  readonly auxiliary: readonly ProvisioningAuxiliarySpec[];
  /** Fail-closed flag: when true, every requested person must carry createAuthAccount. */
  readonly peopleRequireAuthAccounts?: boolean;
}

export type DomainProvisioningRegistrationResult =
  | { ok: true; domainId: string }
  | { ok: false; errors: readonly string[] };

/* ─────────────────────────────────────────────────────────────
 * Registry (fail-closed, atomic)
 * ────────────────────────────────────────────────────────────*/

const LOCAL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const SUBSTRATE_TABLE_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;

interface RegisteredContribution {
  readonly contribution: DomainProvisioningContribution;
}

const REGISTERED_CONTRIBUTIONS = new Map<string, RegisteredContribution>();

/**
 * The domain-contributed platform roles already owned by a registered
 * contribution. A domain role name must keep exactly one provisioning owner
 * platform-wide; neutral core roles may legitimately appear in several
 * domains' vocabularies and are excluded from this check.
 */
const OWNED_DOMAIN_PLATFORM_ROLES = new Map<string, string>();

export function registerDomainProvisioning(
  contribution: DomainProvisioningContribution,
): DomainProvisioningRegistrationResult {
  const errors: string[] = [];
  const { domainId, roles, organization, workspaces, membership, auxiliary } = contribution;

  if (typeof domainId !== "string" || !DOMAIN_ID_PATTERN.test(domainId)) {
    return {
      ok: false,
      errors: [
        `domain id ${JSON.stringify(domainId)} is not a valid domain id (/^[a-z][a-z0-9_]*$/)`,
      ],
    };
  }
  if (REGISTERED_CONTRIBUTIONS.has(domainId)) {
    return { ok: false, errors: [`domain "${domainId}" is already registered for provisioning`] };
  }

  const claimedPlatformRoles = new Map<string, string>();
  const acceptedRequestRoles = new Set<string>();
  if (!Array.isArray(roles) || roles.length === 0) {
    errors.push(`domain "${domainId}" must declare at least one provisioning role`);
  } else {
    for (const role of roles) {
      const scope = `domain "${domainId}" role ${JSON.stringify(role?.accepts?.[0])}`;
      if (!Array.isArray(role.accepts) || role.accepts.length === 0) {
        errors.push(`${scope} must accept at least one request role name`);
      } else {
        for (const accepted of role.accepts) {
          if (typeof accepted !== "string" || !LOCAL_NAME_PATTERN.test(accepted)) {
            errors.push(
              `${scope} accepts ${JSON.stringify(accepted)} which is not a valid local name (/^[a-z][a-z0-9_]*$/)`,
            );
          } else if (acceptedRequestRoles.has(accepted)) {
            errors.push(
              `${scope} accepts "${accepted}" twice — a request role name must have exactly one resolution per domain`,
            );
          } else {
            acceptedRequestRoles.add(accepted);
          }
        }
      }
      const platformRole = role.platformRole;
      if (typeof platformRole !== "string" || !LOCAL_NAME_PATTERN.test(platformRole)) {
        errors.push(`${scope} requires a valid platformRole (/^[a-z][a-z0-9_]*$/)`);
      } else if (claimedPlatformRoles.has(platformRole)) {
        errors.push(
          `${scope} resolves to platform role "${platformRole}" twice inside the contribution`,
        );
      } else if (
        !isNeutralCoreRole(platformRole) &&
        OWNED_DOMAIN_PLATFORM_ROLES.has(platformRole) &&
        OWNED_DOMAIN_PLATFORM_ROLES.get(platformRole) !== domainId
      ) {
        errors.push(
          `${scope} claims platform role "${platformRole}" already owned by domain "${OWNED_DOMAIN_PLATFORM_ROLES.get(platformRole)}" — a domain-contributed role has exactly one provisioning owner platform-wide`,
        );
      } else {
        claimedPlatformRoles.set(platformRole, scope);
      }
      if (typeof role.recordValue !== "string" || role.recordValue.trim() === "") {
        errors.push(`${scope} requires a non-empty recordValue`);
      }
      if (!Array.isArray(role.neutralRoles) || role.neutralRoles.length === 0) {
        errors.push(`${scope} must declare a non-empty neutralRoles mapping (RULING-4)`);
      } else {
        for (const neutralRole of role.neutralRoles) {
          if (!isUniversalRole(neutralRole)) {
            errors.push(
              `${scope} maps to ${JSON.stringify(neutralRole)} which is not in the universal role vocabulary`,
            );
          }
        }
      }
      if (typeof role.description !== "string" || role.description.trim() === "") {
        errors.push(`${scope} requires a documentation string`);
      }
    }
  }

  if (
    !organization ||
    typeof organization.table !== "string" ||
    !SUBSTRATE_TABLE_PATTERN.test(organization.table)
  ) {
    errors.push(`domain "${domainId}" organization spec requires a valid substrate table name`);
  } else if (typeof organization.build !== "function") {
    errors.push(`domain "${domainId}" organization spec requires a build function`);
  }

  if (!Array.isArray(workspaces)) {
    errors.push(`domain "${domainId}" workspaces must be an array`);
  } else {
    const seenWorkspaces = new Set<string>();
    for (const workspace of workspaces) {
      const scope = `domain "${domainId}" workspace ${JSON.stringify(workspace?.name)}`;
      if (typeof workspace.name !== "string" || !LOCAL_NAME_PATTERN.test(workspace.name)) {
        errors.push(`${scope} is not a valid workspace name (/^[a-z][a-z0-9_]*$/)`);
      } else if (seenWorkspaces.has(workspace.name)) {
        errors.push(`${scope} is declared twice`);
      } else {
        seenWorkspaces.add(workspace.name);
      }
      if (
        typeof workspace.table !== "string" ||
        !SUBSTRATE_TABLE_PATTERN.test(workspace.table)
      ) {
        errors.push(`${scope} requires a valid substrate table name`);
      }
      if (typeof workspace.build !== "function") {
        errors.push(`${scope} requires a build function`);
      }
    }
  }

  if (!membership || typeof membership.table !== "string" || !SUBSTRATE_TABLE_PATTERN.test(membership.table)) {
    errors.push(`domain "${domainId}" membership spec requires a valid substrate table name`);
  } else if (typeof membership.build !== "function") {
    errors.push(`domain "${domainId}" membership spec requires a build function`);
  }

  if (!Array.isArray(auxiliary)) {
    errors.push(`domain "${domainId}" auxiliary must be an array`);
  } else {
    const seenAuxiliary = new Set<string>();
    for (const aux of auxiliary) {
      const scope = `domain "${domainId}" auxiliary ${JSON.stringify(aux?.name)}`;
      if (typeof aux.name !== "string" || !LOCAL_NAME_PATTERN.test(aux.name)) {
        errors.push(`${scope} is not a valid auxiliary name (/^[a-z][a-z0-9_]*$/)`);
      } else if (seenAuxiliary.has(aux.name)) {
        errors.push(`${scope} is declared twice`);
      } else {
        seenAuxiliary.add(aux.name);
      }
      if (typeof aux.table !== "string" || !SUBSTRATE_TABLE_PATTERN.test(aux.table)) {
        errors.push(`${scope} requires a valid substrate table name`);
      }
      if (typeof aux.build !== "function") {
        errors.push(`${scope} requires a build function`);
      }
    }
  }

  if (
    contribution.peopleRequireAuthAccounts !== undefined &&
    typeof contribution.peopleRequireAuthAccounts !== "boolean"
  ) {
    errors.push(`domain "${domainId}" peopleRequireAuthAccounts must be a boolean when present`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  for (const [platformRole] of claimedPlatformRoles) {
    if (!isNeutralCoreRole(platformRole)) OWNED_DOMAIN_PLATFORM_ROLES.set(platformRole, domainId);
  }
  REGISTERED_CONTRIBUTIONS.set(domainId, { contribution });
  return { ok: true, domainId };
}

export type DomainProvisioningResolution =
  | { ok: true; contribution: DomainProvisioningContribution }
  | { ok: false; errors: readonly string[] };

/** Resolve a registered contribution; fails closed for unregistered domains. */
export function resolveDomainProvisioning(domainId: string): DomainProvisioningResolution {
  const registered = REGISTERED_CONTRIBUTIONS.get(domainId);
  if (!registered) {
    return {
      ok: false,
      errors: [
        `domain ${JSON.stringify(domainId)} has no registered provisioning contribution — registration is the only path in`,
      ],
    };
  }
  return { ok: true, contribution: registered.contribution };
}

/** Every registered provisioning domain id. */
export function registeredProvisioningDomainIds(): readonly string[] {
  return [...REGISTERED_CONTRIBUTIONS.keys()];
}