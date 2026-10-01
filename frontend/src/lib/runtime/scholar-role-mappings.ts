/**
 * CoreGrid Scholar — domain role mapping table (the FIRST domain mapping).
 *
 * V1CAP-014 / J-006 / CTO RULING-4. The Scholar runtime's local role vocabulary
 * is the legacy identity-store AppRole union (frontend/src/lib/roles.ts —
 * finding I-010: a Scholar identity-store union that universal code still
 * reads). This module is where Scholar DECLARES what those roles mean in the
 * universal role vocabulary: mappings run FROM Scholar roles TO neutral roles,
 * never the reverse. No reverse resolver exists and none may be added.
 *
 * Every choice below is documented against the role's actual Scholar semantics
 * as shipped (runtime/scholar-nav-catalog.ts workspace sections + labels):
 *  - super_admin  -> ADMINISTRATOR|SYSTEM  (platform control workspace; platform-grade authority)
 *  - hq           -> SUPERVISOR            (oversees organizations; "HQ operator" workspace copy)
 *  - admin        -> ADMINISTRATOR         (org_admin chrome: configures members, structure, settings)
 *  - principal    -> ADMINISTRATOR         (institution head; shares the org_admin chrome with admin)
 *  - teacher      -> CONTRIBUTOR           (authors attendance/grades/lesson plans — work-product production)
 *  - bursar       -> OPERATOR              (receipts, reconciliation, fee workflows — transactional operations)
 *  - parent       -> MEMBER                (guardian portal membership)
 *  - student      -> MEMBER                (learner portal membership)
 *  - driver       -> WORKER                (transport field workforce executing assigned routes)
 *
 * The capability gate resolves the legacy identity-store union through the
 * universal engine; the gate carries a deprecated bridge that MUST stay
 * coherent with this declared table — proven in tests/unit/capability-gate.test.ts
 * and tests/unit/universal-roles.test.ts. This table is authoritative: when the
 * two ever disagree, the suite fails and this module wins.
 *
 * Layer note: this table lives in the runtime layer (only the runtime layer
 * names its runtime — platform-neutrality Law 3) and deliberately imports only
 * the universal mapping contract, so the platform gate can consume the declared
 * mapping without a universal -> domain definition import. The full Scholar
 * DomainDefinition (entity types, relationships, workspaces) is assembled in
 * tests/unit/domain-config-restaurant.test.ts and later missions.
 */
import {
  roleMappingTable,
  type DirectionalRoleMappings,
  type DomainRoleMappingDeclaration,
} from "@/lib/universal-roles";

export const SCHOLAR_DOMAIN_ID = "scholar";

export const SCHOLAR_ROLE_MAPPINGS: readonly DomainRoleMappingDeclaration[] = [
  {
    domainRole: "super_admin",
    neutralRoles: ["ADMINISTRATOR", "SYSTEM"],
    description:
      "Platform control workspace (super_admin chrome) and platform-only gates: this identity administrates every tenant (ADMINISTRATOR) and carries the platform's own substrate-grade authority (SYSTEM).",
  },
  {
    domainRole: "hq",
    neutralRoles: ["SUPERVISOR"],
    description:
      "Oversees organizations and reports across them without owning any single tenant's administration — the workspace copy itself says 'HQ operator' in the oversight, not configuration, sense.",
  },
  {
    domainRole: "admin",
    neutralRoles: ["ADMINISTRATOR"],
    description:
      "Organization administration chrome (org_admin): configures members, structure, policy surface and settings.",
  },
  {
    domainRole: "principal",
    neutralRoles: ["ADMINISTRATOR"],
    description:
      "Institution head; shares the org_admin chrome with admin — the same administration authority in this runtime, not a separate universal concept.",
  },
  {
    domainRole: "teacher",
    neutralRoles: ["CONTRIBUTOR"],
    description:
      "Authors the runtime's primary work product: attendance, grades, lesson plans, class intelligence. Production, not operations (OPERATOR is the finance-office semantic) and not administration. This is deliberately NOT a floor-workforce semantic — see the restaurant fixture's service_staff (I-030).",
  },
  {
    domainRole: "bursar",
    neutralRoles: ["OPERATOR"],
    description:
      "Operates the transactional workflows: receipts, reconciliation, fee plans, defaulters — the ledger-running authority.",
  },
  {
    domainRole: "parent",
    neutralRoles: ["MEMBER"],
    description:
      "Guardian portal membership: reads the learner's records it is entitled to; no operational authority.",
  },
  {
    domainRole: "student",
    neutralRoles: ["MEMBER"],
    description: "Learner portal membership: reads its own records; no operational authority.",
  },
  {
    domainRole: "driver",
    neutralRoles: ["WORKER"],
    description:
      "Transport field workforce executing assigned routes and tasks within an operation run by others.",
  },
];

/** The validated, directional Scholar mapping table (domain -> neutral only). */
export const SCHOLAR_NEUTRAL_ROLE_MAPPINGS: DirectionalRoleMappings =
  roleMappingTable(SCHOLAR_ROLE_MAPPINGS);
