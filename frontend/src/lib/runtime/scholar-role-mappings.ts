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
import type { ScholarNavKind } from "./scholar-nav-catalog";
import type { AppRole } from "@/lib/roles";
import {
  resolveDomainRoleToNeutral,
  roleMappingTable,
  type DirectionalRoleMappings,
  type DomainRoleMappingDeclaration,
  type UniversalRole,
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

/* ─────────────────────────────────────────────────────────────
 * Scholar nav-kind membership (I-012 closure, runtime-declared).
 *
 * The platform capability gate used to hand-write the nav-kind membership
 * table in universal code (finding I-012: MEMBERSHIP_FOR_NAV_KIND keyed on
 * Scholar vocabulary in the universal access path). The correction is
 * runtime-declared declaration: the RUNTIME owns the statement "which of its
 * own roles hold which of its own chrome kinds" — domain vocabulary that
 * legitimately lives here, in the runtime layer — and derives the neutral
 * membership THROUGH its declared mapping table above. The platform gate
 * consumes both tables through the runtime registry's neutral aliases and
 * holds no role list of its own.
 * ────────────────────────────────────────────────────────────*/

/**
 * Scholar's own chrome-kind assignments in Scholar vocabulary: which of the
 * runtime's identity-store roles hold each Scholar nav kind. This is the
 * runtime's domain statement — it stays here because it names Scholar roles
 * and Scholar kinds; the platform never learns it (the gate consumes only the
 * DERIVED neutral table and re-exports this one under a neutral alias).
 */
export const SCHOLAR_NAV_KIND_ROLE_ASSIGNMENTS: Readonly<
  Record<ScholarNavKind, readonly AppRole[]>
> = {
  org_admin: ["admin", "principal"],
  teacher: ["teacher"],
  bursar: ["bursar"],
  hq: ["hq"],
  super_admin: ["super_admin"],
  parent: ["parent"],
  student: ["student"],
  driver: ["driver"],
};

/**
 * The Scholar chrome kinds' membership in the NEUTRAL universal vocabulary —
 * derived (never re-declared) through the authoritative mapping table via
 * FORWARD resolution only. Fails closed at module init if any assigned role
 * loses its declared neutral resolution: a chrome kind whose membership
 * cannot be resolved must not install silently.
 */
export const SCHOLAR_NAV_KIND_NEUTRAL_MEMBERSHIP: Readonly<
  Record<ScholarNavKind, readonly UniversalRole[]>
> = (() => {
  // Deliberate cast: the table is filled for every kind of the closed union in
  // the loop below, failing closed if any assignment loses its resolution.
  const table = {} as Record<ScholarNavKind, readonly UniversalRole[]>;
  for (const kind of Object.keys(SCHOLAR_NAV_KIND_ROLE_ASSIGNMENTS) as ScholarNavKind[]) {
    const resolved: UniversalRole[] = [];
    for (const role of SCHOLAR_NAV_KIND_ROLE_ASSIGNMENTS[kind]) {
      const neutral = resolveDomainRoleToNeutral(SCHOLAR_NEUTRAL_ROLE_MAPPINGS, role);
      if (neutral === null) {
        throw new Error(
          `Scholar nav kind "${kind}" assigns role "${role}" which has no declared neutral resolution — fail closed (I-012)`,
        );
      }
      for (const neutralRole of neutral) {
        if (!resolved.includes(neutralRole)) resolved.push(neutralRole);
      }
    }
    table[kind] = resolved;
  }
  return table;
})();
