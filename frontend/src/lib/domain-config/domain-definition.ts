/**
 * CoreGrid — V5.3 Part 64: DomainDefinition contract (configuration layer).
 *
 * "ONE CoreGrid substrate -> MANY organizational configurations." A domain
 * (Scholar, Restaurant, …) is not a codebase and not a set of tables: it is a
 * DomainDefinition — ENTITY TYPES + SCHEMA + RELATIONSHIPS + ROLES +
 * WORKSPACES + WORKFLOWS — expressed as typed configuration over the EXISTING
 * universal substrate vocabulary (kernel reality layer: cg_entity,
 * cg_relationship, cg_event, cg_observation).
 *
 * V5.3 Part 46 NO DOMAIN CONTAMINATION: this module adds no domain-specific
 * concept to universal infrastructure. validateDomainDefinition FAILS CLOSED
 * on unknown nav kinds, roles that resolve through NEITHER the legacy
 * identity-store AppRole set NOR the neutral universal-role vocabulary (I-031
 * re-point), entity references to undeclared types, duplicate ids, and any
 * attempt to declare storage — a DomainDefinition defines semantics, never DDL.
 *
 * Boundary: pure data + one pure validator. No persistence, no runtime
 * engine, no vendor imports.
 */
import type { AppRole } from "@/lib/roles";
import { MEMBERSHIP_FOR_NAV_KIND } from "@/lib/capability-gate";
// The runtime layer's nav-kind vocabulary, named neutrally for the platform.
import type { ScholarNavKind as RuntimeNavKind } from "@/lib/runtime/nav-registry";
import { isEntityType, isRelationType } from "@/lib/kernel/reality";
import { isUniversalRole, type UniversalRole } from "@/lib/universal-roles";

/* ─────────────────────────────────────────────────────────────
 * Universal substrate vocabulary (configuration binds to it,
 * it never redefines it)
 * ────────────────────────────────────────────────────────────*/

/**
 * Universal entity concepts a domain entity type may extend — the conceptual
 * vocabulary of the kernel reality substrate (cg_entity, cg_event,
 * cg_relationship, cg_observation). Domain configs specialize these; they
 * never replace or shadow them.
 */
export const UNIVERSAL_ENTITY_VOCABULARY = [
  "entity",
  "event",
  "relationship",
  "observation",
] as const;

export type UniversalEntityConcept = (typeof UNIVERSAL_ENTITY_VOCABULARY)[number];

export const DOMAIN_RELATIONSHIP_CARDINALITIES = [
  "one-to-one",
  "one-to-many",
  "many-to-one",
  "many-to-many",
] as const;

export type DomainRelationshipCardinality = (typeof DOMAIN_RELATIONSHIP_CARDINALITIES)[number];

/**
 * Runtime vocabularies the configuration must satisfy, derived from the
 * installed platform contracts (never re-declared here — re-declaring a
 * vocabulary would itself be a contamination vector).
 */
const PLATFORM_APP_ROLE_SET: ReadonlySet<string> = new Set(
  Object.values(MEMBERSHIP_FOR_NAV_KIND).flat(),
);

/** Every platform AppRole the identity store declares (runtime values). */
export const PLATFORM_APP_ROLES: readonly AppRole[] = [...PLATFORM_APP_ROLE_SET] as AppRole[];

const RUNTIME_NAV_KIND_SET: ReadonlySet<string> = new Set(
  Object.keys(MEMBERSHIP_FOR_NAV_KIND) as RuntimeNavKind[],
);

/* ─────────────────────────────────────────────────────────────
 * The DomainDefinition contract
 * ────────────────────────────────────────────────────────────*/

export type FieldSchema =
  | { kind: "string"; minLength?: number; maxLength?: number; pattern?: string }
  | { kind: "number"; min?: number; max?: number; integer?: boolean }
  | { kind: "boolean" }
  | { kind: "ref"; targetType: string }
  | { kind: "enum"; values: readonly string[] };

export interface DomainEntityType {
  /** Namespaced into the universal entity_type vocabulary: `<domainId>.<local>`. */
  name: string;
  /** Universal concept or declared entity type this declaration specializes. */
  extends: string;
  fields: Record<string, FieldSchema>;
  description?: string;
}

export interface DomainRelationship {
  /** Namespaced relation_type vocabulary: `<domainId>.<local>`. */
  name: string;
  source: string;
  target: string;
  cardinality: DomainRelationshipCardinality;
  description?: string;
}

export interface DomainRoleDeclaration {
  /** Domain-local role name (e.g. "floor_staff"); the mapping is the semantic. */
  domainRole: string;
  /**
   * Legacy identity-store AppRole vocabulary this domain role resolves to.
   * Backwards-compatibility path: a role may declare EITHER these (validated
   * against the legacy platform AppRole set) OR the neutral mapping below —
   * never neither (fail closed). New domains should prefer `neutralRoles`.
   */
  appRoles?: readonly AppRole[];
  /**
   * Neutral universal-role vocabulary this domain role resolves to (I-031
   * re-point). Validated against the ruled universal vocabulary; a domain
   * role name on this side is rejected (RULING-4 direction).
   */
  neutralRoles?: readonly UniversalRole[];
  description?: string;
}

export interface DomainWorkspace {
  name: string;
  /** Must be a kind the runtime nav registry vocabulary declares. */
  kind: RuntimeNavKind;
  label: string;
  description?: string;
}

/** Workflow names only — binding to the automation engine's workflow vocabulary. */
export interface DomainWorkflowDeclaration {
  name: string;
  description?: string;
}

export interface DomainDefinition {
  domainId: string;
  displayName: string;
  description?: string;
  entityTypes: readonly DomainEntityType[];
  relationships: readonly DomainRelationship[];
  roles: readonly DomainRoleDeclaration[];
  workspaces: readonly DomainWorkspace[];
  workflows: readonly DomainWorkflowDeclaration[];
}

export type DomainDefinitionValidationResult =
  | { ok: true; definition: DomainDefinition }
  | { ok: false; errors: readonly string[] };

/* ─────────────────────────────────────────────────────────────
 * Fail-closed structural validation (input is unknown: config may
 * arrive from untrusted sources, so shape is proven, never assumed)
 * ────────────────────────────────────────────────────────────*/

const DOMAIN_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const LOCAL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

const DEFINITION_KEYS: readonly string[] = [
  "domainId",
  "displayName",
  "description",
  "entityTypes",
  "relationships",
  "roles",
  "workspaces",
  "workflows",
];
const ENTITY_TYPE_KEYS: readonly string[] = ["name", "extends", "fields", "description"];
const RELATIONSHIP_KEYS: readonly string[] = ["name", "source", "target", "cardinality", "description"];
const ROLE_KEYS: readonly string[] = ["domainRole", "appRoles", "neutralRoles", "description"];
const WORKSPACE_KEYS: readonly string[] = ["name", "kind", "label", "description"];
const WORKFLOW_KEYS: readonly string[] = ["name", "description"];

const FIELD_KEYS_BY_KIND: Readonly<Record<FieldSchema["kind"], readonly string[]>> = {
  string: ["kind", "minLength", "maxLength", "pattern"],
  number: ["kind", "min", "max", "integer"],
  boolean: ["kind"],
  ref: ["kind", "targetType"],
  enum: ["kind", "values"],
};

/**
 * Keys that attempt to declare storage. A configuration defines semantics,
 * not DDL (V5.3 Part 46): encountering one is a hard validation failure, not
 * an ignored extra field.
 */
const STORAGE_DECLARATION_KEYS: readonly string[] = [
  "table",
  "tables",
  "table_name",
  "tableName",
  "primary_key",
  "primaryKey",
  "storage",
  "ddl",
  "migration",
  "create_table",
  "createTable",
  "rls",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderValue(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}

function checkKeys(
  scope: string,
  value: Record<string, unknown>,
  allowed: readonly string[],
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    if (STORAGE_DECLARATION_KEYS.includes(key)) {
      errors.push(
        `${scope} attempts to declare storage via key "${key}": a DomainDefinition expresses semantics as configuration, never DDL (V5.3 Part 46)`,
      );
    } else {
      errors.push(`${scope} declares unknown key "${key}"`);
    }
  }
}

function optionalDescription(
  scope: string,
  value: Record<string, unknown>,
  errors: string[],
): void {
  if (value.description !== undefined && typeof value.description !== "string") {
    errors.push(`${scope} description must be a string when present`);
  }
}

function optionalIntConstraint(
  scope: string,
  key: string,
  value: Record<string, unknown>,
  errors: string[],
): void {
  const constraint = value[key];
  if (constraint === undefined) return;
  if (
    typeof constraint !== "number" ||
    !Number.isFinite(constraint) ||
    !Number.isInteger(constraint) ||
    constraint < 0
  ) {
    errors.push(`${scope} ${key} must be a non-negative integer when present`);
  }
}

function validateFieldSchema(
  scope: string,
  fieldName: string,
  value: unknown,
  declaredEntityNames: ReadonlySet<string>,
  errors: string[],
): void {
  if (!LOCAL_NAME_PATTERN.test(fieldName)) {
    errors.push(`${scope} is not a valid field name (/^[a-z][a-z0-9_]*$/)`);
  }
  if (!isRecord(value)) {
    errors.push(`${scope} must be an object`);
    return;
  }
  const kind = value.kind;
  if (kind !== "string" && kind !== "number" && kind !== "boolean" && kind !== "ref" && kind !== "enum") {
    errors.push(
      `${scope} has unknown kind ${renderValue(kind)} — allowed: string|number|boolean|ref|enum`,
    );
    return;
  }
  checkKeys(scope, value, FIELD_KEYS_BY_KIND[kind], errors);
  switch (kind) {
    case "string": {
      optionalIntConstraint(scope, "minLength", value, errors);
      optionalIntConstraint(scope, "maxLength", value, errors);
      if (
        typeof value.minLength === "number" &&
        typeof value.maxLength === "number" &&
        value.minLength > value.maxLength
      ) {
        errors.push(`${scope} minLength must not exceed maxLength`);
      }
      if (value.pattern !== undefined && typeof value.pattern !== "string") {
        errors.push(`${scope} pattern must be a string when present`);
      }
      break;
    }
    case "number": {
      if (value.min !== undefined && (typeof value.min !== "number" || !Number.isFinite(value.min))) {
        errors.push(`${scope} min must be a finite number when present`);
      }
      if (value.max !== undefined && (typeof value.max !== "number" || !Number.isFinite(value.max))) {
        errors.push(`${scope} max must be a finite number when present`);
      }
      if (
        typeof value.min === "number" &&
        typeof value.max === "number" &&
        value.min > value.max
      ) {
        errors.push(`${scope} min must not exceed max`);
      }
      if (value.integer !== undefined && typeof value.integer !== "boolean") {
        errors.push(`${scope} integer must be a boolean when present`);
      }
      break;
    }
    case "ref": {
      const targetType = value.targetType;
      if (typeof targetType !== "string") {
        errors.push(`${scope} ref requires a string "targetType"`);
      } else if (!declaredEntityNames.has(targetType)) {
        errors.push(`${scope} references undeclared entity type "${targetType}"`);
      }
      break;
    }
    case "enum": {
      const values = value.values;
      if (!Array.isArray(values) || values.length === 0) {
        errors.push(`${scope} enum requires a non-empty "values" array`);
        break;
      }
      const seen = new Set<string>();
      for (const entry of values) {
        if (typeof entry !== "string" || entry === "") {
          errors.push(`${scope} enum values must be non-empty strings`);
          break;
        }
        if (seen.has(entry)) {
          errors.push(`${scope} enum value "${entry}" is duplicated`);
        }
        seen.add(entry);
      }
      break;
    }
  }
}

function requireNamespacedName(
  label: string,
  name: string,
  domainId: string,
  errors: string[],
): void {
  const prefix = `${domainId}.`;
  if (!name.startsWith(prefix)) {
    errors.push(
      `${label} is not namespaced under "${prefix}…" — a domain extends the universal vocabulary through its own namespace, never in place of it (V5.3 Part 46)`,
    );
  } else if (!LOCAL_NAME_PATTERN.test(name.slice(prefix.length))) {
    errors.push(`${label} local name is not a valid local name (/^[a-z][a-z0-9_]*$/)`);
  }
}

/**
 * Validate a DomainDefinition. Every non-conforming path produces an explicit
 * error; the definition is only accepted when nothing failed (fail closed).
 */
export function validateDomainDefinition(input: unknown): DomainDefinitionValidationResult {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ["DomainDefinition must be an object"] };
  }
  checkKeys("domain definition", input, DEFINITION_KEYS, errors);

  const domainId = input.domainId;
  const domainIdValid = typeof domainId === "string" && DOMAIN_ID_PATTERN.test(domainId);
  if (!domainIdValid) {
    errors.push(
      `domain id ${renderValue(domainId)} is not a valid domain id (/^[a-z][a-z0-9_]*$/)`,
    );
  }
  if (typeof input.displayName !== "string" || input.displayName.trim() === "") {
    errors.push("displayName must be a non-empty string");
  }
  optionalDescription("domain definition", input, errors);

  if (!Array.isArray(input.entityTypes)) {
    errors.push("entityTypes must be an array");
  } else if (input.entityTypes.length === 0) {
    errors.push("a DomainDefinition must declare at least one entity type");
  }
  if (!Array.isArray(input.relationships)) errors.push("relationships must be an array");
  if (!Array.isArray(input.roles)) errors.push("roles must be an array");
  if (!Array.isArray(input.workspaces)) errors.push("workspaces must be an array");
  if (!Array.isArray(input.workflows)) errors.push("workflows must be an array");

  // Pass 1 — collect declared entity names (duplicate ids fail closed).
  const declaredEntityNames = new Set<string>();
  if (Array.isArray(input.entityTypes)) {
    for (const entry of input.entityTypes) {
      if (!isRecord(entry)) {
        errors.push("every entity type declaration must be an object");
        continue;
      }
      const name = entry.name;
      if (typeof name !== "string") {
        errors.push('every entity type declaration requires a string "name"');
        continue;
      }
      if (declaredEntityNames.has(name)) errors.push(`duplicate entity type id "${name}"`);
      declaredEntityNames.add(name);
    }
  }

  // Pass 2 — entity declarations in detail.
  if (Array.isArray(input.entityTypes)) {
    input.entityTypes.forEach((entry, index) => {
      const scope = `entity type #${index}`;
      if (!isRecord(entry)) return; // already reported in pass 1
      checkKeys(scope, entry, ENTITY_TYPE_KEYS, errors);
      const name = entry.name;
      if (typeof name !== "string") return;
      const label = `entity type "${name}"`;
      if (domainIdValid) {
        requireNamespacedName(label, name, domainId as string, errors);
      }
      if (!isEntityType(name)) {
        errors.push(`${label} violates the substrate entity_type constraint (1–128 characters)`);
      }
      const extendsTarget = entry.extends;
      if (typeof extendsTarget !== "string") {
        errors.push(`${label} requires a string "extends" target`);
      } else if (
        !(UNIVERSAL_ENTITY_VOCABULARY as readonly string[]).includes(extendsTarget) &&
        !declaredEntityNames.has(extendsTarget)
      ) {
        errors.push(
          `${label} extends ${renderValue(extendsTarget)} which is neither a universal entity concept nor a declared entity type`,
        );
      }
      if (!isRecord(entry.fields)) {
        errors.push(`${label} fields must be an object`);
      } else {
        for (const [fieldName, schema] of Object.entries(entry.fields)) {
          validateFieldSchema(
            `${label} field "${fieldName}"`,
            fieldName,
            schema,
            declaredEntityNames,
            errors,
          );
        }
      }
      optionalDescription(label, entry, errors);
    });
  }

  if (Array.isArray(input.relationships)) {
    const seen = new Set<string>();
    input.relationships.forEach((entry, index) => {
      const scope = `relationship #${index}`;
      if (!isRecord(entry)) {
        errors.push(`${scope} must be an object`);
        return;
      }
      checkKeys(scope, entry, RELATIONSHIP_KEYS, errors);
      const name = entry.name;
      if (typeof name !== "string") {
        errors.push(`${scope} requires a string "name"`);
        return;
      }
      const label = `relationship "${name}"`;
      if (seen.has(name)) errors.push(`duplicate relationship id "${name}"`);
      seen.add(name);
      if (domainIdValid) {
        requireNamespacedName(label, name, domainId as string, errors);
      }
      if (!isRelationType(name)) {
        errors.push(`${label} violates the substrate relation_type constraint (1–128 characters)`);
      }
      for (const endpoint of ["source", "target"] as const) {
        const endpointValue = entry[endpoint];
        if (typeof endpointValue !== "string") {
          errors.push(`${label} requires a string "${endpoint}"`);
        } else if (!declaredEntityNames.has(endpointValue)) {
          errors.push(`${label} ${endpoint} references undeclared entity type "${endpointValue}"`);
        }
      }
      const cardinality = entry.cardinality;
      if (
        typeof cardinality !== "string" ||
        !(DOMAIN_RELATIONSHIP_CARDINALITIES as readonly string[]).includes(cardinality)
      ) {
        errors.push(`${label} has unknown cardinality ${renderValue(cardinality)}`);
      }
      optionalDescription(label, entry, errors);
    });
  }

  if (Array.isArray(input.roles)) {
    const seen = new Set<string>();
    input.roles.forEach((entry, index) => {
      const scope = `role #${index}`;
      if (!isRecord(entry)) {
        errors.push(`${scope} must be an object`);
        return;
      }
      checkKeys(scope, entry, ROLE_KEYS, errors);
      const domainRole = entry.domainRole;
      if (typeof domainRole !== "string" || !LOCAL_NAME_PATTERN.test(domainRole)) {
        errors.push(`${scope} requires a valid domainRole (/^[a-z][a-z0-9_]*$/)`);
        return;
      }
      if (seen.has(domainRole)) errors.push(`duplicate role id "${domainRole}"`);
      seen.add(domainRole);
      // I-031 re-point: a role resolves through EITHER the legacy identity-store
      // appRoles (validated against the legacy set for backwards compatibility)
      // OR the neutral universal-role mapping. Neither is a validation failure
      // (fail closed); an invalid entry in either supplied vocabulary also fails.
      const appRoles = entry.appRoles;
      const neutralRoles = entry.neutralRoles;
      const appRolesSupplied = appRoles !== undefined;
      const neutralRolesSupplied = neutralRoles !== undefined;
      if (!appRolesSupplied && !neutralRolesSupplied) {
        errors.push(
          `domain role "${domainRole}" must declare a non-empty appRoles array or a non-empty neutralRoles mapping`,
        );
        return;
      }
      if (appRolesSupplied) {
        if (!Array.isArray(appRoles) || appRoles.length === 0) {
          errors.push(
            `domain role "${domainRole}" appRoles must be a non-empty array when present`,
          );
        } else {
          for (const appRole of appRoles) {
            if (typeof appRole !== "string" || !PLATFORM_APP_ROLE_SET.has(appRole)) {
              errors.push(
                `domain role "${domainRole}" maps to ${renderValue(appRole)} which is not in the platform AppRole vocabulary`,
              );
            }
          }
        }
      }
      if (neutralRolesSupplied) {
        if (!Array.isArray(neutralRoles) || neutralRoles.length === 0) {
          errors.push(
            `domain role "${domainRole}" neutralRoles must be a non-empty array when present`,
          );
        } else {
          for (const neutralRole of neutralRoles) {
            if (!isUniversalRole(neutralRole)) {
              errors.push(
                `domain role "${domainRole}" maps to ${renderValue(neutralRole)} which is not in the universal role vocabulary`,
              );
            }
          }
        }
      }
      optionalDescription(`domain role "${domainRole}"`, entry, errors);
    });
  }

  if (Array.isArray(input.workspaces)) {
    const seen = new Set<string>();
    input.workspaces.forEach((entry, index) => {
      const scope = `workspace #${index}`;
      if (!isRecord(entry)) {
        errors.push(`${scope} must be an object`);
        return;
      }
      checkKeys(scope, entry, WORKSPACE_KEYS, errors);
      const name = entry.name;
      if (typeof name !== "string" || name.trim() === "") {
        errors.push(`${scope} requires a non-empty string "name"`);
        return;
      }
      if (seen.has(name)) errors.push(`duplicate workspace id "${name}"`);
      seen.add(name);
      const kind = entry.kind;
      if (typeof kind !== "string" || !RUNTIME_NAV_KIND_SET.has(kind)) {
        errors.push(
          `workspace "${name}" uses nav kind ${renderValue(kind)} which is not in the runtime nav registry vocabulary`,
        );
      }
      if (typeof entry.label !== "string" || entry.label.trim() === "") {
        errors.push(`workspace "${name}" requires a non-empty string "label"`);
      }
      optionalDescription(`workspace "${name}"`, entry, errors);
    });
  }

  if (Array.isArray(input.workflows)) {
    const seen = new Set<string>();
    input.workflows.forEach((entry, index) => {
      const scope = `workflow #${index}`;
      if (!isRecord(entry)) {
        errors.push(`${scope} must be an object`);
        return;
      }
      checkKeys(scope, entry, WORKFLOW_KEYS, errors);
      const name = entry.name;
      if (typeof name !== "string") {
        errors.push(`${scope} requires a string "name"`);
        return;
      }
      if (seen.has(name)) errors.push(`duplicate workflow id "${name}"`);
      seen.add(name);
      if (domainIdValid) {
        requireNamespacedName(`workflow "${name}"`, name, domainId as string, errors);
      }
      optionalDescription(`workflow "${name}"`, entry, errors);
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  // Every rule above passed; narrow the validated configuration once.
  return { ok: true, definition: input as unknown as DomainDefinition };
}