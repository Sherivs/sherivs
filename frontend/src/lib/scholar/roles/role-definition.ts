/**
 * Sherivs Scholar — Educational Reality Role Engine: role definition.
 *
 * The ROLE entity. A role is a living organizational entity scoped by reality
 * (feature keys, institution templates, education levels, jurisdictions) — not
 * a static database enum and not a hardcoded UI branch.
 *
 * Laws enforced here:
 *  - permissions reference the KERNEL capability graph (`<capability>[:action]`),
 *    so a role can never invent an ability the platform does not own;
 *  - feature/template scopes reference the EXISTING institution vocabulary
 *    (`runtime/scholar-school-templates.ts`) — no second ontology;
 *  - a role that staffs a Scholar workforce post LINKS to that post
 *    (`workforce-kinds` kind code) instead of redefining the job.
 *
 * Authority boundary: a role definition is reality configuration. It never
 * grants access; Phase 08 (RBAC/ABAC/PBAC/ReBAC + RLS) decides.
 */

import { KERNEL_CAPABILITIES } from "@/lib/kernel/kernel-capability-registry";
import { SCHOLAR_WORKFORCE_CODE_SET } from "@/lib/runtime/scholar-workforce";
import {
  SCHOLAR_SCHOOL_TEMPLATES,
  SCHOLAR_TEMPLATE_FEATURE_SET,
} from "@/lib/runtime/scholar-school-templates";
import { isRoleCategory, type RoleCategory } from "./role-categories";
import {
  CATEGORY_WORKSPACES,
  isRoleWorkspaceKey,
  workspacesForCategory,
  type RoleWorkspaceKey,
} from "./role-workspaces";

export const ROLE_PRIORITIES = ["PRIMARY", "SECONDARY", "OPTIONAL", "CUSTOM"] as const;
export type RolePriority = (typeof ROLE_PRIORITIES)[number];

export const ROLE_SECURITY_LEVELS = [
  "public",
  "internal",
  "sensitive",
  "restricted",
  "sovereign",
] as const;
export type RoleSecurityLevel = (typeof ROLE_SECURITY_LEVELS)[number];

export const ROLE_TENANT_SCOPES = [
  "platform",
  "jurisdiction",
  "tenant",
  "cross_tenant_authorized",
] as const;
export type RoleTenantScope = (typeof ROLE_TENANT_SCOPES)[number];

export const EDUCATION_LEVELS = [
  "early_childhood",
  "primary",
  "junior_secondary",
  "senior_secondary",
  "tertiary",
  "adult",
  "vocational",
  "any",
] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const ROLE_STAFFING_KINDS = [
  "scholar_workforce",
  "platform_workforce",
  "non_staff",
] as const;
export type RoleStaffingKind = (typeof ROLE_STAFFING_KINDS)[number];

export const ROLE_ORIGINS = ["catalog", "template", "borrowed", "custom"] as const;
export type RoleOrigin = (typeof ROLE_ORIGINS)[number];

export interface RoleStaffing {
  kind: RoleStaffingKind;
  /** Required (and catalog-verified) when kind is `scholar_workforce`. */
  kindCode: string | null;
}

/**
 * Which authorization models apply to the role. Data only — the decision stays
 * in Phase 08/09.
 */
export interface RoleAuthority {
  rbac: boolean;
  abac: boolean;
  pbac: boolean;
  rebac: boolean;
  rls: boolean;
}

export interface EducationRealityRole {
  /** `role:<slug>` — stable, derived from the name, never renumbered silently. */
  id: string;
  name: string;
  category: RoleCategory;
  priority: RolePriority;
  description: string;
  /** Existing institution feature keys that give this role a home. */
  featureScope: readonly string[];
  /** Existing institution template ids this role belongs to. */
  templateRefs: readonly string[];
  educationLevels: readonly EducationLevel[];
  /** `*` (any) or ISO country / region codes. */
  jurisdictions: readonly string[];
  responsibilities: readonly string[];
  /** `<kernel-capability>[:<action>]`. */
  permissions: readonly string[];
  requiredCredentials: readonly string[];
  workflowAccess: readonly string[];
  workspaceRequirements: readonly RoleWorkspaceKey[];
  parentRoles: readonly string[];
  childRoles: readonly string[];
  relatedRoles: readonly string[];
  policyConstraints: readonly string[];
  securityLevel: RoleSecurityLevel;
  tenantScope: RoleTenantScope;
  staffing: RoleStaffing;
  authority: RoleAuthority;
  origin: RoleOrigin;
}

/** Category-derived security level (a role may raise it explicitly). */
const CATEGORY_SECURITY_LEVEL: Record<RoleCategory, RoleSecurityLevel> = {
  GOVERNMENT: "sovereign",
  REGULATORY: "sovereign",
  EXAMINATION: "sovereign",
  INSTITUTIONAL_LEADERSHIP: "sensitive",
  ACADEMIC: "internal",
  TEACHING: "internal",
  STUDENT_SUPPORT: "sensitive",
  FINANCE: "sensitive",
  OPERATIONS: "internal",
  HEALTH: "sensitive",
  SAFETY: "sensitive",
  TECHNOLOGY: "sensitive",
  FACILITIES: "internal",
  TRANSPORT: "internal",
  BOARDING: "sensitive",
  COMMUNITY: "internal",
  VOCATIONAL: "internal",
  TECHNICAL: "internal",
  AGRICULTURAL: "internal",
  RELIGIOUS: "internal",
  TRADITIONAL: "internal",
  RESEARCH: "internal",
  QUALITY_ASSURANCE: "sensitive",
  SHERIVS_INTERNAL: "restricted",
};

const SOVEREIGN_CATEGORIES: readonly RoleCategory[] = [
  "GOVERNMENT",
  "REGULATORY",
  "EXAMINATION",
  "QUALITY_ASSURANCE",
];

/** Categories whose authority is relationship-scoped by nature. */
const RELATIONSHIP_SCOPED_CATEGORIES: readonly RoleCategory[] = [
  "TEACHING",
  "ACADEMIC",
  "STUDENT_SUPPORT",
  "BOARDING",
  "COMMUNITY",
  "TRANSPORT",
];

export function roleIdFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `role:${slug}`;
}

export interface RoleSpec {
  name: string;
  category: RoleCategory;
  priority?: RolePriority;
  description?: string;
  featureScope?: readonly string[];
  templateRefs?: readonly string[];
  educationLevels?: readonly EducationLevel[];
  jurisdictions?: readonly string[];
  responsibilities?: readonly string[];
  permissions?: readonly string[];
  requiredCredentials?: readonly string[];
  workflowAccess?: readonly string[];
  workspaceRequirements?: readonly RoleWorkspaceKey[];
  parentRoles?: readonly string[];
  childRoles?: readonly string[];
  relatedRoles?: readonly string[];
  policyConstraints?: readonly string[];
  securityLevel?: RoleSecurityLevel;
  tenantScope?: RoleTenantScope;
  staffing?: RoleStaffing;
  origin?: RoleOrigin;
}

/** Build a role from a spec, applying category-derived defaults. */
export function defineRole(spec: RoleSpec): EducationRealityRole {
  const category = spec.category;
  const workspaces = [
    ...new Set<RoleWorkspaceKey>([
      ...workspacesForCategory(category),
      ...(spec.workspaceRequirements ?? []),
    ]),
  ];
  const jurisdictions = spec.jurisdictions ?? ["*"];
  return {
    id: roleIdFromName(spec.name),
    name: spec.name,
    category,
    priority: spec.priority ?? "OPTIONAL",
    description: spec.description ?? `${spec.name} — ${category.replace(/_/g, " ").toLowerCase()}.`,
    featureScope: spec.featureScope ?? [],
    templateRefs: spec.templateRefs ?? [],
    educationLevels: spec.educationLevels ?? ["any"],
    jurisdictions,
    responsibilities: spec.responsibilities ?? [],
    permissions: spec.permissions ?? [],
    requiredCredentials: spec.requiredCredentials ?? [],
    workflowAccess: spec.workflowAccess ?? [],
    workspaceRequirements: workspaces,
    parentRoles: spec.parentRoles ?? [],
    childRoles: spec.childRoles ?? [],
    relatedRoles: spec.relatedRoles ?? [],
    policyConstraints: spec.policyConstraints ?? [],
    securityLevel: spec.securityLevel ?? CATEGORY_SECURITY_LEVEL[category] ?? "internal",
    tenantScope:
      spec.tenantScope ??
      (category === "SHERIVS_INTERNAL"
        ? "platform"
        : SOVEREIGN_CATEGORIES.includes(category)
          ? "jurisdiction"
          : "tenant"),
    staffing: spec.staffing ?? { kind: "non_staff", kindCode: null },
    authority: {
      rbac: true,
      abac: jurisdictions.some((jurisdiction) => jurisdiction !== "*"),
      pbac: true,
      rebac: RELATIONSHIP_SCOPED_CATEGORIES.includes(category),
      rls: true,
    },
    origin: spec.origin ?? "catalog",
  };
}

export interface RoleValidationContext {
  knownRoleIds?: ReadonlySet<string>;
  knownCapabilityIds?: ReadonlySet<string>;
  knownFeatureKeys?: ReadonlySet<string>;
  knownTemplateIds?: ReadonlySet<string>;
  knownWorkforceKindCodes?: ReadonlySet<string>;
}

const PERMISSION_RE = /^([a-z][a-z0-9-]*)(?::([a-z][a-z0-9_-]*))?$/;
const JURISDICTION_RE = /^(\*|[A-Z]{2}(?:-[A-Z0-9]{1,8})?)$/;
const ROLE_ID_RE = /^role:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Structural validation of one role against the platform vocabulary. Pure: the
 * caller supplies the known sets (defaults are the real registries).
 */
export function validateRoleDefinition(
  role: EducationRealityRole,
  context: RoleValidationContext = {},
): string[] {
  const issues: string[] = [];
  const capabilities = context.knownCapabilityIds ?? new Set(KERNEL_CAPABILITIES.map((c) => c.id));
  const features = context.knownFeatureKeys ?? SCHOLAR_TEMPLATE_FEATURE_SET;
  const templates = context.knownTemplateIds ?? new Set(SCHOLAR_SCHOOL_TEMPLATES.map((t) => t.id));
  const kindCodes = context.knownWorkforceKindCodes ?? SCHOLAR_WORKFORCE_CODE_SET;

  if (!ROLE_ID_RE.test(role.id)) issues.push(`${role.id}: id must be "role:<kebab-case>"`);
  if (role.id !== roleIdFromName(role.name))
    issues.push(`${role.id}: id must derive from the name`);
  if (role.name.trim().length < 2) issues.push(`${role.id}: name is required`);
  if (!isRoleCategory(role.category))
    issues.push(`${role.id}: unknown category "${role.category}"`);
  if (!ROLE_PRIORITIES.includes(role.priority)) issues.push(`${role.id}: unknown priority`);
  if (!ROLE_SECURITY_LEVELS.includes(role.securityLevel)) {
    issues.push(`${role.id}: unknown security level`);
  }
  if (!ROLE_TENANT_SCOPES.includes(role.tenantScope)) {
    issues.push(`${role.id}: unknown tenant scope`);
  }
  if (!ROLE_ORIGINS.includes(role.origin)) issues.push(`${role.id}: unknown origin`);
  if (role.educationLevels.length === 0) issues.push(`${role.id}: at least one education level`);
  for (const level of role.educationLevels) {
    if (!EDUCATION_LEVELS.includes(level)) {
      issues.push(`${role.id}: unknown education level "${level}"`);
    }
  }
  for (const jurisdiction of role.jurisdictions) {
    if (!JURISDICTION_RE.test(jurisdiction)) {
      issues.push(`${role.id}: invalid jurisdiction "${jurisdiction}"`);
    }
  }
  for (const key of role.featureScope) {
    if (!features.has(key)) issues.push(`${role.id}: unknown feature key "${key}"`);
  }
  for (const ref of role.templateRefs) {
    if (!templates.has(ref)) issues.push(`${role.id}: unknown institution template "${ref}"`);
  }
  for (const key of role.workspaceRequirements) {
    if (!isRoleWorkspaceKey(key)) issues.push(`${role.id}: unknown workspace "${key}"`);
  }
  for (const workspace of CATEGORY_WORKSPACES[role.category] ?? []) {
    if (!role.workspaceRequirements.includes(workspace)) {
      issues.push(`${role.id}: category workspace "${workspace}" must be declared`);
    }
  }
  for (const permission of role.permissions) {
    const match = PERMISSION_RE.exec(permission);
    if (!match) {
      issues.push(`${role.id}: permission "${permission}" must be <capability>[:action]`);
      continue;
    }
    if (!capabilities.has(match[1])) {
      issues.push(`${role.id}: permission "${permission}" references an unknown capability`);
    }
  }

  const staffing = role.staffing;
  if (!ROLE_STAFFING_KINDS.includes(staffing.kind)) {
    issues.push(`${role.id}: unknown staffing kind`);
  } else if (staffing.kind === "scholar_workforce") {
    if (!staffing.kindCode) {
      issues.push(`${role.id}: scholar_workforce staffing requires a kind code`);
    } else if (!kindCodes.has(staffing.kindCode)) {
      issues.push(
        `${role.id}: staffing kind "${staffing.kindCode}" is not in the Scholar workforce catalog`,
      );
    }
  } else if (staffing.kindCode !== null) {
    issues.push(`${role.id}: kind code is only valid for scholar_workforce staffing`);
  }

  for (const list of [role.parentRoles, role.childRoles, role.relatedRoles]) {
    for (const ref of list) {
      if (ref === role.id) issues.push(`${role.id}: cannot reference itself`);
      if (context.knownRoleIds && !context.knownRoleIds.has(ref)) {
        issues.push(`${role.id}: unknown role reference "${ref}"`);
      }
    }
  }
  if (role.parentRoles.some((parent) => role.childRoles.includes(parent))) {
    issues.push(`${role.id}: a role cannot be both parent and child of the same role`);
  }

  const lists: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["responsibility", role.responsibilities],
    ["credential", role.requiredCredentials],
    ["workflow", role.workflowAccess],
    ["policy constraint", role.policyConstraints],
    ["permission", role.permissions],
  ];
  for (const [label, list] of lists) {
    if (new Set(list).size !== list.length) issues.push(`${role.id}: duplicate ${label}`);
  }

  return issues;
}
