import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

// ─── CoreGrid Phase 20 — Government Education Cloud ──────────────────
// government-core.ts — Government identity, hierarchy, federation,
//                      jurisdiction, organisation, network, autonomy
// ──────────────────────────────────────────────────────────────────────

export type GovernmentEntityId = string & { __brand: "GovernmentEntityId" };
export type JurisdictionId = string & { __brand: "JurisdictionId" };
export type OrganisationId = string & { __brand: "OrganisationId" };
export type EducationNetworkId = string & { __brand: "EducationNetworkId" };
export type InstitutionRef = string & { __brand: "InstitutionRef" };

// ─── A.5 Government Operating Hierarchy ────────────────────────────────
export type GovernmentLevel =
  | "national"
  | "ministry"
  | "regional_authority"
  | "state_province"
  | "district"
  | "local_authority"
  | "education_network"
  | "institution"
  | "campus"
  | "department";

// ─── E. Government Tenancy Model ──────────────────────────────────────
export interface GovernmentTenant {
  readonly id: GovernmentEntityId;
  readonly name: string;
  readonly level: GovernmentLevel;
  readonly jurisdiction: JurisdictionId;
  readonly parentId: GovernmentEntityId | null;
  readonly tenantRef: string;
  readonly status: "active" | "suspended" | "decommissioned";
  readonly autonomous: boolean;
}

// ─── H. Jurisdiction Model ────────────────────────────────────────────
export interface Jurisdiction {
  readonly id: JurisdictionId;
  readonly name: string;
  readonly code: string;
  readonly country: string;
  readonly region: string;
  readonly configurableHierarchy: boolean;
  readonly allowedLevels: GovernmentLevel[];
  readonly regulatoryBody: string | null;
  readonly dataResidencyRequired: boolean;
}

// ─── J. Education Network Model ───────────────────────────────────────
export interface EducationNetwork {
  readonly id: EducationNetworkId;
  readonly name: string;
  readonly organisationId: OrganisationId;
  readonly memberInstitutions: InstitutionRef[];
  readonly networkType: "public" | "private" | "charter" | "religious" | "special";
  readonly status: "active" | "suspended";
}

// ─── F. Tenant Authority / G. Government Federation ──────────────────
export type TenantAuthority =
  | "oversight"
  | "funding"
  | "curriculum"
  | "examinations"
  | "staffing"
  | "admissions"
  | "infrastructure"
  | "discipline"
  | "reporting"
  | "policy_enforcement";

export interface GovernmentFederation {
  readonly sourceOrganisation: OrganisationId;
  readonly targetOrganisation: OrganisationId;
  readonly scope: TenantAuthority[];
  readonly expiresAt: string | null;
  readonly status: "active" | "expired" | "revoked";
}

// ─── BA–BB. Government Identity Mapping ──────────────────────────────
export interface GovernmentIdentityMapping {
  readonly governmentId: GovernmentEntityId;
  readonly externalIdentity: string;
  readonly identitySystem: string;
  readonly jurisdiction: JurisdictionId;
  readonly verified: boolean;
  readonly verifiedAt: string | null;
}

// ─── BE–BG. Government Administrative Roles ──────────────────────────
export type GovernmentRole =
  | "minister"
  | "deputy_minister"
  | "director"
  | "regional_director"
  | "district_officer"
  | "education_officer"
  | "inspector"
  | "auditor"
  | "compliance_officer"
  | "analyst"
  | "viewer";

export interface GovernmentRoleAssignment {
  readonly role: GovernmentRole;
  readonly scope: OrganisationId | "all";
  readonly privileges: string[];
  readonly grantedAt: string;
  readonly grantedBy: string;
  readonly expiresAt: string | null;
}

// ─── CW–CX. Government Master Data ───────────────────────────────────
export interface GovernmentMasterRecord {
  readonly id: string;
  readonly domain: string;
  readonly value: string;
  readonly version: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly supersededBy: string | null;
  readonly status: "current" | "superseded" | "deprecated";
}

// ─── CY. Government Calendar ──────────────────────────────────────────
export interface GovernmentCalendar {
  readonly jurisdiction: JurisdictionId;
  readonly academicYear: string;
  readonly termDates: { term: string; start: string; end: string }[];
  readonly holidays: { name: string; date: string }[];
  readonly examinationPeriods: { name: string; start: string; end: string }[];
}

// ─── I. Government Organisation Model ─────────────────────────────────
export interface GovernmentOrganisation {
  readonly id: OrganisationId;
  readonly name: string;
  readonly jurisdiction: JurisdictionId;
  readonly level: GovernmentLevel;
  readonly parentOrganisation: OrganisationId | null;
  readonly children: OrganisationId[];
  readonly status: "active" | "inactive" | "dissolved";
  readonly autonomous: boolean;
  readonly serviceTag: string;
}
// ─── Functions ─────────────────────────────────────────────────────────

const hierarchyOrder: GovernmentLevel[] = [
  "national",
  "ministry",
  "regional_authority",
  "state_province",
  "district",
  "local_authority",
  "education_network",
  "institution",
  "campus",
  "department",
];

function isValidChildLevel(parent: GovernmentLevel, child: GovernmentLevel): boolean {
  const parentIdx = hierarchyOrder.indexOf(parent);
  const childIdx = hierarchyOrder.indexOf(child);
  return parentIdx >= 0 && childIdx > parentIdx;
}

export function createGovernmentTenant(params: {
  id: GovernmentEntityId;
  name: string;
  level: GovernmentLevel;
  jurisdiction: JurisdictionId;
  parentId: GovernmentEntityId | null;
  tenantRef: string;
  autonomous: boolean;
}): GovernmentTenant {
  if (!params.id || !params.name) throw new Error("Government tenant requires id and name");
  return { ...params, status: "active" as const };
}

export function createFederation(params: {
  sourceOrganisation: OrganisationId;
  targetOrganisation: OrganisationId;
  scope: TenantAuthority[];
  expiresAt: string | null;
}): GovernmentFederation {
  if (params.scope.length === 0)
    throw new Error("Federation must have at least one authority scope");
  if (params.expiresAt && new Date(params.expiresAt) <= new Date(timeAuthority.now().atMs)) {
    throw new Error("Federation expiry must be in the future");
  }
  return { ...params, status: "active" as const };
}

export function assignGovernmentRole(params: {
  role: GovernmentRole;
  scope: OrganisationId | "all";
  privileges: string[];
  grantedBy: string;
  expiresAt: string | null;
}): GovernmentRoleAssignment {
  if (params.privileges.length === 0) throw new Error("Role must have at least one privilege");
  if (params.expiresAt && new Date(params.expiresAt) <= new Date(timeAuthority.now().atMs)) {
    throw new Error("Role expiry must be in the future");
  }
  return { ...params, grantedAt: timeAuthority.now().at };
}

export function createJurisdiction(params: {
  id: JurisdictionId;
  name: string;
  code: string;
  country: string;
  region: string;
  allowedLevels: GovernmentLevel[];
  dataResidencyRequired?: boolean;
}): Jurisdiction {
  if (!params.id || !params.name || !params.code) {
    throw new Error("Jurisdiction requires id, name and code");
  }
  return {
    id: params.id,
    name: params.name,
    code: params.code,
    country: params.country,
    region: params.region,
    configurableHierarchy: true,
    allowedLevels: params.allowedLevels,
    regulatoryBody: null,
    dataResidencyRequired: params.dataResidencyRequired ?? false,
  };
}

export function validateOrganisationHierarchy(
  org: GovernmentOrganisation,
  allOrgs: GovernmentOrganisation[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (org.parentOrganisation && !allOrgs.find((o) => o.id === org.parentOrganisation)) {
    errors.push(`Parent organisation ${org.parentOrganisation} not found`);
  }
  if (org.parentOrganisation) {
    const parent = allOrgs.find((o) => o.id === org.parentOrganisation);
    if (parent && !isValidChildLevel(parent.level, org.level)) {
      errors.push(`Invalid hierarchy: ${org.level} cannot be child of ${parent.level}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function createGovernmentMasterRecord(params: {
  id: string;
  domain: string;
  value: string;
  effectiveFrom: string;
  effectiveTo?: string;
}): GovernmentMasterRecord {
  if (!params.id || !params.domain || !params.value) {
    throw new Error("Master record requires id, domain and value");
  }
  return {
    id: params.id,
    domain: params.domain,
    value: params.value,
    version: 1,
    effectiveFrom: params.effectiveFrom,
    effectiveTo: params.effectiveTo ?? null,
    supersededBy: null,
    status: "current" as const,
  };
}

export function supersedeMasterRecord(
  record: GovernmentMasterRecord,
  replacementId: string,
): GovernmentMasterRecord {
  return {
    ...record,
    status: "superseded" as const,
    effectiveTo: timeAuthority.now().at,
    supersededBy: replacementId,
  };
}

export function createEducationNetwork(params: {
  id: EducationNetworkId;
  name: string;
  organisationId: OrganisationId;
  memberInstitutions: InstitutionRef[];
  networkType: EducationNetwork["networkType"];
}): EducationNetwork {
  if (!params.id || !params.name) throw new Error("Education network requires id and name");
  return { ...params, status: "active" as const };
}

export function createGovernmentCalendar(params: {
  jurisdiction: JurisdictionId;
  academicYear: string;
  termDates: { term: string; start: string; end: string }[];
  holidays: { name: string; date: string }[];
  examinationPeriods: { name: string; start: string; end: string }[];
}): GovernmentCalendar {
  if (!params.jurisdiction || !params.academicYear) {
    throw new Error("Calendar requires jurisdiction and academic year");
  }
  if (params.termDates.length === 0) {
    throw new Error("Calendar must have at least one term");
  }
  return { ...params };
}
