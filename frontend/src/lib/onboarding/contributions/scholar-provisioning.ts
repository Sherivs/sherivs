/**
 * CoreGrid — V1-008: Scholar (runtime-001) provisioning contribution.
 *
 * The V1-006 application pattern (`domain-config/scholar-authorization.ts`)
 * carried over to ORGANIZATION PROVISIONING: the education runtime declares
 * ONCE how its organizations, memberships and auxiliary records map onto the
 * EXISTING substrate tables — as a DomainProvisioningContribution — and the
 * NEUTRAL platform onboarding engine (`lib/onboarding/provision-organization.ts`)
 * drives those declarations. Nothing Scholar-specific is hardcoded in the
 * engine; this adapter is the only path in.
 *
 * Substrate mapping (existing tables only — no migrations were authored):
 *   - organization record -> `schools`
 *   - membership row      -> `users` (the legacy tenant-member record; the
 *      person's domain role is persisted in `users.role` via `recordValue`)
 *   - auxiliary record    -> `subscriptions` (initial subscription row)
 *   - workspaces          -> NONE (gap, documented): the Scholar substrate has
 *      no workspace table — the Scholar tenant workspace IS the organization
 *      record, and DomainDefinition workspace declarations are chrome/nav-kind
 *      bindings, not rows. A universal workspace substrate is a reported gap.
 *
 * Importing this module ALSO loads `domain-config/scholar-authorization.ts`,
 * which registers the runtime's RBAC contribution — the engine's grant
 * resolution (resolveRoleGrants) depends on it. Provisioning role semantics:
 * `school_admin` is the tenant-admin role the legacy `createSchoolWithAdmin`
 * path provisioned as `users.role = "admin"`; the Scholar super-admin path
 * remains the CONTROL-PLANE bootstrap (`super_admins`), never a tenant
 * membership, so no school_super_admin mapping exists here.
 */
import { SCHOLAR_DOMAIN_ID, SCHOLAR_NEUTRAL_ROLE_MAPPINGS } from "@/lib/domain-config/scholar-authorization";
import {
  registerDomainProvisioning,
  type DomainProvisioningContribution,
  type DomainProvisioningRoleDeclaration,
} from "@/lib/onboarding/domain-provisioning";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * The Scholar provisioning role vocabulary: request-side names (canonical
 * school_admin plus the legacy alias `admin`, matching the frozen
 * createSchoolWithAdmin contract) resolved directionally onto the
 * rbac-registered Scholar roles, with the legacy `users.role` record values
 * preserved byte-for-byte for backward compatibility.
 */
const SCHOLAR_PROVISIONING_ROLES: readonly DomainProvisioningRoleDeclaration[] = [
  {
    accepts: ["school_admin", "admin"],
    platformRole: "school_admin",
    recordValue: "admin",
    neutralRoles: SCHOLAR_NEUTRAL_ROLE_MAPPINGS.school_admin,
    description:
      "Tenant administration: configures the school's structure, members and settings (legacy users.role = admin).",
  },
  {
    accepts: ["principal"],
    platformRole: "principal",
    recordValue: "principal",
    neutralRoles: SCHOLAR_NEUTRAL_ROLE_MAPPINGS.principal,
    description: "Directs instruction and oversees execution across the school.",
  },
  {
    accepts: ["teacher"],
    platformRole: "teacher",
    recordValue: "teacher",
    neutralRoles: SCHOLAR_NEUTRAL_ROLE_MAPPINGS.teacher,
    description: "Produces the institution's primary work product and executes session tasks.",
  },
  {
    accepts: ["bursar"],
    platformRole: "bursar",
    recordValue: "bursar",
    neutralRoles: SCHOLAR_NEUTRAL_ROLE_MAPPINGS.bursar,
    description: "Runs the school's transactional workflows: ledgers, payments, reconciliation.",
  },
  {
    accepts: ["parent"],
    platformRole: "parent",
    recordValue: "parent",
    neutralRoles: SCHOLAR_NEUTRAL_ROLE_MAPPINGS.parent,
    description: "Baseline participant with read visibility over the linked student record.",
  },
  {
    accepts: ["student"],
    platformRole: "student",
    recordValue: "student",
    neutralRoles: SCHOLAR_NEUTRAL_ROLE_MAPPINGS.student,
    description: "Baseline tenant participant.",
  },
  {
    accepts: ["driver"],
    platformRole: "driver",
    recordValue: "driver",
    neutralRoles: SCHOLAR_NEUTRAL_ROLE_MAPPINGS.driver,
    description: "Field-facing workforce executing assigned transport tasks.",
  },
];

export const SCHOLAR_PROVISIONING_CONTRIBUTION: DomainProvisioningContribution = {
  domainId: SCHOLAR_DOMAIN_ID,
  description:
    "Education runtime (runtime-001) organization provisioning over the existing Scholar substrate tables.",
  roles: SCHOLAR_PROVISIONING_ROLES,
  organization: {
    table: "schools",
    build: (ctx) => ({
      name: ctx.request.identity.name,
      slug: ctx.request.structure.slug ?? (slugify(ctx.request.identity.name) || "school"),
      email: ctx.request.identity.contactEmail ?? null,
      phone: ctx.request.identity.phone ?? null,
      address: ctx.request.identity.address ?? null,
      subscription_tier: ctx.request.structure.subscriptionTier ?? "trial",
      subscription_status: "active",
      monthly_fee: ctx.request.structure.monthlyFee ?? 0,
      is_active: true,
    }),
  },
  // Gap (documented above): the Scholar substrate holds no workspace rows —
  // the tenant workspace is the organization record itself.
  workspaces: [],
  membership: {
    table: "users",
    build: (person, resolved, ctx) => ({
      id: ctx.authAccountIds[person.email],
      school_id: ctx.organizationId,
      full_name: person.fullName,
      email: person.email,
      role: resolved.recordValue,
      is_active: true,
    }),
  },
  auxiliary: [
    {
      name: "subscription",
      table: "subscriptions",
      build: (ctx) => ({
        school_id: ctx.organizationId,
        plan: ctx.request.structure.subscriptionTier ?? "trial",
        status: "active",
        amount_paid: 0,
      }),
    },
  ],
  // The legacy membership record keys on the auth uid (users.id), so every
  // provisioned Scholar person must carry an identity.
  peopleRequireAuthAccounts: true,
};

/**
 * Register the contribution (fail-closed). Called once at module load so a
 * single import of this adapter is sufficient; a second call rejects with the
 * registry's duplicate-registration error.
 */
export function registerScholarProvisioning(): void {
  const result = registerDomainProvisioning(SCHOLAR_PROVISIONING_CONTRIBUTION);
  if (!result.ok) {
    throw new Error(
      `scholar provisioning contribution rejected: ${result.errors.join("; ")}`,
    );
  }
}

registerScholarProvisioning();