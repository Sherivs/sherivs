/**
 * CoreGrid — first installed runtime (runtime-001) authorization contribution.
 *
 * The V1-006 application of the DomainDefinition registration pattern proven
 * by `domain-config/restaurant.ts`: this runtime's role vocabulary, its
 * relationship types and its security-gate bindings are contributed to the
 * NEUTRAL platform authorization layer entirely as configuration —
 *
 *   - roles map directionally onto the neutral universal-role vocabulary
 *     (RULING-4: domain -> neutral only) and carry capability grants the
 *     combined authorization engine (`lib/authorization.ts`) resolves from
 *     the domain contribution registry (`lib/rbac/domain-contribution.ts`);
 *   - relationship types register into the identity vocabulary's live
 *     registry (`lib/identity.ts` registerDomainRelationshipTypes);
 *   - gate kinds / RPC primitives / role sets register into the neutral
 *     gate core (`lib/rbac/role-gate.ts`), which the canonical role gate
 *     (`lib/security-role-gate.ts`) resolves registry-first.
 *
 * The platform core hardcodes none of this: importing this module is the
 * single registration path. Values mirror the frozen legacy surface byte for
 * byte, so a registered and an unregistered runtime behave identically
 * (backward compatibility for consumers that load only the legacy module).
 */
import { domainPermissionResource, type Permission } from "@/lib/identity";
import {
  registerDomainAuthorization,
  type DomainAuthorizationContribution,
} from "@/lib/rbac/domain-contribution";
import { registerRuntimeRoleGate, type RuntimeRoleGateContribution } from "@/lib/rbac/role-gate";
import {
  roleMappingTable,
  type DomainRoleMappingDeclaration,
  type UniversalRole,
} from "@/lib/universal-roles";

export const SCHOLAR_DOMAIN_ID = "scholar";
export const SCHOLAR_RUNTIME_ID = "runtime_001";

/* ─────────────────────────────────────────────────────────────
 * Directional role mappings (domain -> neutral, RULING-4)
 * ────────────────────────────────────────────────────────────*/

export const SCHOLAR_ROLE_MAPPINGS: readonly DomainRoleMappingDeclaration[] = [
  {
    domainRole: "school_super_admin",
    neutralRoles: ["ADMINISTRATOR", "OWNER"] satisfies readonly UniversalRole[],
    description:
      "Accountable holder of the institution tenant (OWNER) who configures its structure, members and policy surface (ADMINISTRATOR).",
  },
  {
    domainRole: "school_admin",
    neutralRoles: ["ADMINISTRATOR"] satisfies readonly UniversalRole[],
    description:
      "Configures and governs the tenant's structure, members and settings on the owner's behalf.",
  },
  {
    domainRole: "campus_admin",
    neutralRoles: ["ADMINISTRATOR", "MANAGER"] satisfies readonly UniversalRole[],
    description:
      "Site-level administration of one campus unit plus day-to-day direction of its people.",
  },
  {
    domainRole: "principal",
    neutralRoles: ["MANAGER", "SUPERVISOR"] satisfies readonly UniversalRole[],
    description:
      "Directs the instruction unit and oversees execution across it with review authority.",
  },
  {
    domainRole: "teacher",
    neutralRoles: ["CONTRIBUTOR", "WORKER"] satisfies readonly UniversalRole[],
    description:
      "Produces the institution's primary work product (instruction, records, artifacts) and executes assigned session tasks.",
  },
  {
    domainRole: "bursar",
    neutralRoles: ["OPERATOR"] satisfies readonly UniversalRole[],
    description: "Runs the tenant's transactional workflows: ledgers, payments, reconciliation.",
  },
  {
    domainRole: "parent",
    neutralRoles: ["MEMBER"] satisfies readonly UniversalRole[],
    description: "Baseline tenant participant with read visibility over the linked record.",
  },
  {
    domainRole: "student",
    neutralRoles: ["MEMBER"] satisfies readonly UniversalRole[],
    description: "Baseline tenant participant.",
  },
  {
    domainRole: "driver",
    neutralRoles: ["WORKER"] satisfies readonly UniversalRole[],
    description: "Field-facing workforce executing assigned transport tasks.",
  },
];

/** The validated, directional runtime mapping table (domain -> neutral only). */
export const SCHOLAR_NEUTRAL_ROLE_MAPPINGS = roleMappingTable(SCHOLAR_ROLE_MAPPINGS);

/* ─────────────────────────────────────────────────────────────
 * Capability grants (byte-identical to the frozen legacy table)
 * ────────────────────────────────────────────────────────────*/

const SCHOLAR_ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  school_super_admin: [
    { resource: domainPermissionResource("school"), action: "manage", scope: null },
    { resource: "user", action: "manage", scope: null },
    { resource: "identity", action: "manage", scope: null },
    { resource: "settings", action: "manage", scope: null },
  ],
  school_admin: [
    { resource: domainPermissionResource("school"), action: "update", scope: null },
    { resource: "user", action: "manage", scope: null },
    { resource: "settings", action: "update", scope: null },
  ],
  campus_admin: [
    { resource: domainPermissionResource("campus"), action: "manage", scope: null },
    { resource: "user", action: "manage", scope: null },
  ],
  principal: [
    { resource: domainPermissionResource("school"), action: "read", scope: null },
    { resource: domainPermissionResource("teacher"), action: "read", scope: null },
    { resource: domainPermissionResource("student"), action: "read", scope: null },
    { resource: domainPermissionResource("attendance"), action: "read", scope: null },
    { resource: domainPermissionResource("grades"), action: "read", scope: null },
  ],
  teacher: [
    { resource: domainPermissionResource("class"), action: "read", scope: null },
    { resource: domainPermissionResource("student"), action: "read", scope: null },
    { resource: domainPermissionResource("attendance"), action: "update", scope: null },
    { resource: domainPermissionResource("grades"), action: "update", scope: null },
  ],
  bursar: [
    { resource: domainPermissionResource("fees"), action: "manage", scope: null },
    { resource: "payments", action: "manage", scope: null },
  ],
  parent: [{ resource: domainPermissionResource("student"), action: "read", scope: null }],
  student: [{ resource: domainPermissionResource("student"), action: "read", scope: null }],
  driver: [{ resource: domainPermissionResource("student"), action: "read", scope: null }],
};

/* ─────────────────────────────────────────────────────────────
 * The domain authorization contribution (DomainDefinition pattern)
 * ────────────────────────────────────────────────────────────*/

export const SCHOLAR_AUTHORIZATION_CONTRIBUTION: DomainAuthorizationContribution = {
  domainId: SCHOLAR_DOMAIN_ID,
  roles: SCHOLAR_ROLE_MAPPINGS.map((mapping) => ({
    domainRole: mapping.domainRole,
    neutralRoles: SCHOLAR_NEUTRAL_ROLE_MAPPINGS[mapping.domainRole],
    permissions: SCHOLAR_ROLE_PERMISSIONS[mapping.domainRole],
    description: mapping.description,
  })),
  relationshipTypes: ["enrolled_in", "parent_of", "teaches", "guardian_of"],
};

/* ─────────────────────────────────────────────────────────────
 * The runtime gate contribution (neutral role-gate core)
 * ────────────────────────────────────────────────────────────*/

export const SCHOLAR_RUNTIME_GATE_CONTRIBUTION: RuntimeRoleGateContribution = {
  runtimeId: SCHOLAR_RUNTIME_ID,
  gateKinds: [
    {
      kind: "school_admin",
      requiresScope: true,
      rpc: { role: "is_school_admin", scope: "get_my_school_id" },
      roleRequiredReason: "Forbidden: school admin role required",
      tenantUnresolvedReason: "No school in scope",
    },
    {
      kind: "platform_super_admin",
      requiresScope: false,
      rpc: { role: "is_super_admin" },
      roleRequiredReason: "Forbidden: platform super admin role required",
      tenantUnresolvedReason: "No school in scope",
    },
  ],
  staffRoleSets: [
    { kind: "school_admin", roles: ["admin", "principal"] },
    { kind: "school_teacher", roles: ["teacher"] },
    { kind: "teaching_staff", roles: ["admin", "principal", "teacher"] },
    { kind: "finance_staff", roles: ["admin", "principal", "bursar"] },
  ],
};

/**
 * Register both contributions (fail-closed). Called once at module load so a
 * single import of this adapter is sufficient; a second call rejects with
 * the registry's duplicate-registration error — registration is an
 * auditable, one-time event, never a silent overwrite.
 */
export function registerScholarAuthorization(): void {
  const domainResult = registerDomainAuthorization(SCHOLAR_AUTHORIZATION_CONTRIBUTION);
  if (!domainResult.ok) {
    throw new Error(
      `runtime-001 authorization contribution rejected: ${domainResult.errors.join("; ")}`,
    );
  }
  const gateResult = registerRuntimeRoleGate(SCHOLAR_RUNTIME_GATE_CONTRIBUTION);
  if (!gateResult.ok) {
    throw new Error(`runtime-001 gate contribution rejected: ${gateResult.errors.join("; ")}`);
  }
}

registerScholarAuthorization();
