/**
 * CoreGrid — universal role vocabulary + directional domain role mapping
 * (V1CAP-014 / J-006, CTO RULING-4).
 *
 * This module is the PLATFORM's authorization vocabulary substrate. It is
 * universal surface: no domain may name itself here, and no domain concept may
 * be defined here. Domains bind to it in ONE direction only (RULING-4): a
 * domain declares mappings FROM its local roles TO neutral roles. Reverse
 * resolution (neutral -> domain) does not exist in this module — it is a type
 * error to author and a runtime error to validate.
 *
 * Closures I-010/I-030/I-031 at the contract level: the platform never learns
 * a domain role name; a domain role's meaning is exactly what it resolves to
 * in this vocabulary, declared by the domain, validated here.
 *
 * Boundary: pure data + pure functions. No imports, no persistence, no vendor.
 */

/* ─────────────────────────────────────────────────────────────
 * The universal role vocabulary (closed, ruled list)
 * ────────────────────────────────────────────────────────────*/

/**
 * The universal role vocabulary — the exact list ruled for V1CAP-014. Closed:
 * roles are never added ad hoc; extending this union is a governed platform
 * decision, never a domain accommodation.
 */
export const UNIVERSAL_ROLES = [
  "ACTOR",
  "MEMBER",
  "OWNER",
  "ADMINISTRATOR",
  "OPERATOR",
  "MANAGER",
  "SUPERVISOR",
  "CONTRIBUTOR",
  "REVIEWER",
  "APPROVER",
  "AUDITOR",
  "WORKER",
  "AGENT",
  "SERVICE",
  "SYSTEM",
] as const;

export type UniversalRole = (typeof UNIVERSAL_ROLES)[number];

export const UNIVERSAL_ROLE_SET: ReadonlySet<string> = new Set<string>(UNIVERSAL_ROLES);

/** Fail-closed membership check for untrusted role strings. */
export function isUniversalRole(value: unknown): value is UniversalRole {
  return typeof value === "string" && UNIVERSAL_ROLE_SET.has(value);
}

export interface UniversalRoleDescriptor {
  role: UniversalRole;
  /** What the role MEANS platform-wide — domains map onto semantics, not names. */
  description: string;
  /** identity = identity-bearing participant (identity-bearing in the security sense; the kind name avoids a token that collides with a domain role name); functional = post/authority; machine = non-human authority. */
  kind: "identity" | "functional" | "machine";
}

/** The typed registry: every role in the vocabulary is described, none guessed. */
export const UNIVERSAL_ROLE_REGISTRY: Readonly<Record<UniversalRole, UniversalRoleDescriptor>> = {
  ACTOR: {
    role: "ACTOR",
    description:
      "Any authenticated participant of the platform; the root of the role hierarchy every other role specializes.",
    kind: "identity",
  },
  MEMBER: {
    role: "MEMBER",
    description:
      "A baseline participant of a tenant holding portal membership with no operational authority.",
    kind: "identity",
  },
  OWNER: {
    role: "OWNER",
    description:
      "The accountable holder of a resource or tenant; ultimate ownership authority over what it governs.",
    kind: "identity",
  },
  ADMINISTRATOR: {
    role: "ADMINISTRATOR",
    description:
      "Configures and governs a tenant's structure, members, and policy surface on the owner's behalf.",
    kind: "functional",
  },
  OPERATOR: {
    role: "OPERATOR",
    description:
      "Runs the tenant's transactional operational workflows: ledgers, payments, dispatch, reconciliation.",
    kind: "functional",
  },
  MANAGER: {
    role: "MANAGER",
    description:
      "Directs a bounded unit of people or work without tenant-wide administration authority.",
    kind: "functional",
  },
  SUPERVISOR: {
    role: "SUPERVISOR",
    description:
      "Oversees execution across units with review authority; observes and directs without configuring the tenant.",
    kind: "functional",
  },
  CONTRIBUTOR: {
    role: "CONTRIBUTOR",
    description:
      "Produces the tenant's primary work product: content, records, and artifacts others rely on.",
    kind: "functional",
  },
  REVIEWER: {
    role: "REVIEWER",
    description:
      "Evaluates submitted work against standards before it advances; evaluates, never releases.",
    kind: "functional",
  },
  APPROVER: {
    role: "APPROVER",
    description: "Grants the formal sign-off that releases work or commits resources.",
    kind: "functional",
  },
  AUDITOR: {
    role: "AUDITOR",
    description:
      "Reads records and history for verification and compliance; observes without mutating.",
    kind: "functional",
  },
  WORKER: {
    role: "WORKER",
    description: "Executes assigned field or floor tasks within an operation run by others.",
    kind: "functional",
  },
  AGENT: {
    role: "AGENT",
    description:
      "An autonomous delegated actor operating strictly under granted capabilities and lifecycle state.",
    kind: "machine",
  },
  SERVICE: {
    role: "SERVICE",
    description:
      "A machine-to-machine integration actor with scoped technical access, no human behind it.",
    kind: "machine",
  },
  SYSTEM: {
    role: "SYSTEM",
    description:
      "The platform's own non-human authority for substrate operations; never a tenant participant.",
    kind: "machine",
  },
};

/* ─────────────────────────────────────────────────────────────
 * Directional mapping contract (RULING-4): domain -> neutral ONLY
 * ────────────────────────────────────────────────────────────*/

/** A domain-local role name (the domain's own vocabulary; never a neutral role). */
export type DomainRoleName = string;

/**
 * A documented, directional mapping entry: what one domain role MEANS in the
 * universal vocabulary. The description is mandatory — a mapping choice that
 * cannot be explained is a mapping that must not exist.
 */
export interface DomainRoleMappingDeclaration {
  domainRole: DomainRoleName;
  /** Neutral roles this domain role resolves to — the ONLY permitted direction. */
  neutralRoles: readonly UniversalRole[];
  /** Why this resolution — documented against the domain role's actual semantics. */
  description: string;
}

/**
 * Domain role -> neutral role mappings. Keys are DOMAIN role names; values are
 * ALWAYS universal roles. Author via defineDomainRoleMappings/roleMappingTable:
 * the shape is directional by construction and any reverse attempt is rejected
 * by the type system and the runtime validator.
 */
export type DirectionalRoleMappings = Readonly<Record<DomainRoleName, readonly UniversalRole[]>>;

export type DirectionalRoleMappingsValidationResult =
  { ok: true; mappings: DirectionalRoleMappings } | { ok: false; errors: readonly string[] };

const DOMAIN_ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate untrusted input as directional role mappings (fail closed):
 *  - a key that IS a universal role is a reverse-mapping attempt (RULING-4) — rejected;
 *  - a value that is not a universal role puts a domain (or invented) role name
 *    on the neutral side — rejected;
 *  - keys must be well-formed domain-local names.
 */
export function validateDirectionalRoleMappings(
  input: unknown,
): DirectionalRoleMappingsValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["role mappings must be an object"] };
  }
  for (const [key, value] of Object.entries(input)) {
    if (isUniversalRole(key)) {
      errors.push(
        `reverse mapping attempt (RULING-4): "${key}" is a neutral role and can never be a mapping key — mappings run domain -> neutral only`,
      );
      continue;
    }
    if (typeof key !== "string" || key === "" || !DOMAIN_ROLE_NAME_PATTERN.test(key)) {
      errors.push(
        `mapping key ${JSON.stringify(key)} is not a valid domain role name (/^[a-z][a-z0-9_]*$/)`,
      );
      continue;
    }
    if (!Array.isArray(value) || value.length === 0) {
      errors.push(`domain role "${key}" must map to a non-empty array of neutral roles`);
      continue;
    }
    for (const entry of value) {
      if (!isUniversalRole(entry)) {
        errors.push(
          `domain role "${key}" maps to ${JSON.stringify(entry)} which is not in the universal role vocabulary — domain role names are forbidden on the neutral side`,
        );
      }
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, mappings: input as DirectionalRoleMappings };
}

/**
 * Type-level RULING-4 enforcement: a mapping key that names a neutral role
 * fails to type-check (the intersection forces that property to an error
 * marker), and the runtime validator rejects it anyway — the prohibition holds
 * even against `as any` callers and untrusted data.
 */
type ReverseMappingKeyError =
  "RULING-4 violation: a neutral role is not a domain role and can never be a mapping key (direction is domain -> neutral only)";

export function defineDomainRoleMappings<
  const M extends Readonly<Record<string, readonly UniversalRole[]>>,
>(
  mappings: M & {
    readonly [K in keyof M & UniversalRole]?: ReverseMappingKeyError;
  },
): M {
  const result = validateDirectionalRoleMappings(mappings);
  if (!result.ok) {
    throw new Error(`Directional role mappings rejected (RULING-4): ${result.errors.join("; ")}`);
  }
  return mappings;
}

/** Build a validated mapping table from documented declarations (duplicate ids fail closed). */
export function roleMappingTable(
  declarations: readonly DomainRoleMappingDeclaration[],
): DirectionalRoleMappings {
  const errors: string[] = [];
  const table: Record<string, readonly UniversalRole[]> = {};
  declarations.forEach((declaration, index) => {
    const scope = `mapping #${index}`;
    if (!isRecord(declaration)) {
      errors.push(`${scope} must be an object`);
      return;
    }
    const domainRole = declaration.domainRole;
    if (
      typeof domainRole !== "string" ||
      domainRole === "" ||
      !DOMAIN_ROLE_NAME_PATTERN.test(domainRole)
    ) {
      errors.push(`${scope} requires a valid domainRole (/^[a-z][a-z0-9_]*$/)`);
      return;
    }
    if (isUniversalRole(domainRole)) {
      errors.push(
        `reverse mapping attempt (RULING-4): "${domainRole}" is a neutral role and can never be declared as a domain role`,
      );
      return;
    }
    if (Object.prototype.hasOwnProperty.call(table, domainRole)) {
      errors.push(`duplicate domain role id "${domainRole}"`);
    }
    if (!Array.isArray(declaration.neutralRoles) || declaration.neutralRoles.length === 0) {
      errors.push(`domain role "${domainRole}" must map to a non-empty neutralRoles array`);
    } else {
      for (const entry of declaration.neutralRoles) {
        if (!isUniversalRole(entry)) {
          errors.push(
            `domain role "${domainRole}" maps to ${JSON.stringify(entry)} which is not in the universal role vocabulary`,
          );
        }
      }
    }
    if (typeof declaration.description !== "string" || declaration.description.trim() === "") {
      errors.push(`domain role "${domainRole}" requires a documentation string`);
    }
    table[domainRole] = declaration.neutralRoles;
  });
  if (errors.length > 0) {
    throw new Error(`Role mapping table rejected (RULING-4): ${errors.join("; ")}`);
  }
  return table;
}

/**
 * The directional resolution engine: domain role -> neutral roles, fail closed.
 * Returns null for any role the table does not declare — including neutral
 * role names, which are not domain roles and therefore resolve nothing here.
 * There is no reverse resolver and none may be added (RULING-4).
 */
export function resolveDomainRoleToNeutral(
  mappings: DirectionalRoleMappings,
  domainRole: string,
): readonly UniversalRole[] | null {
  if (typeof domainRole !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(mappings, domainRole)) return null;
  const resolved = mappings[domainRole];
  return resolved && resolved.length > 0 ? resolved : null;
}
