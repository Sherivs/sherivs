/**
 * SV1-REALITY R1 (#332) — Reality Engine domain taxonomy and canonical
 * entity/relationship vocabulary (ADR-051).
 *
 * Contract only: no persistence, no traversal, no AI. Every entity type names
 * the EXISTING owner module that holds its records; the Reality Engine
 * describes configuration and references owners, it never becomes a second
 * source of truth (R0 reuse map, docs/reality/R0-REUSE-MAP.md).
 */

export const REALITY_TAXONOMY_VERSION = "1.0.0";

export const REALITY_DOMAINS = [
  "identity",
  "org_topology",
  "academic_topology",
  "temporal",
  "human",
  "teaching_assignments",
  "assessment_grading",
  "finance",
  "operations",
  "governance_external",
] as const;
export type RealityDomain = (typeof REALITY_DOMAINS)[number];

/** V1 school-onboarding types only; tertiary, health and agriculture are future scope. */
export const INSTITUTION_TYPES = [
  "creche",
  "primary",
  "secondary",
  "islamic",
  "special_needs",
  "multi_institution_group",
] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];

/** Answer value shapes a discovery question may collect. */
export const ANSWER_TYPES = [
  "single",
  "multi",
  "text",
  "number",
  "bool",
  "date",
  "time",
  "entity",
  "hierarchy",
  "repeating_group",
  "natural_language",
] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

/** Domain-level resolution state; distinct from kernel observation kinds. */
export const ANSWER_STATES = [
  "confirmed",
  "inferred",
  "unknown",
  "conflicting",
  "pending",
  "not_applicable",
] as const;
export type AnswerState = (typeof ANSWER_STATES)[number];

/** Lifecycle of a whole manifest; never overloaded onto answer states. */
export const MANIFEST_STATES = ["discovered", "approved", "operational"] as const;
export type ManifestState = (typeof MANIFEST_STATES)[number];

/** Separate concepts that must never be conflated (#229 non-negotiable). */
export const AUTHORITY_CONCEPTS = ["role", "responsibility", "permission", "workspace"] as const;

export interface EntityTypeDef {
  readonly id: string;
  readonly domain: RealityDomain;
  readonly label: string;
  /** Repo path of the existing owner of the canonical records. */
  readonly owner: string;
}

const e = (id: string, domain: RealityDomain, label: string, owner: string): EntityTypeDef => ({
  id,
  domain,
  label,
  owner,
});

export const ENTITY_TYPES: readonly EntityTypeDef[] = [
  e("tenant", "identity", "Tenant (neutral organization key)", "frontend/src/lib/scholar/platform-org"),
  e("group", "org_topology", "Group", "frontend/src/lib/scholar/platform-org"),
  e("institution", "org_topology", "Institution", "frontend/src/lib/scholar/platform-org"),
  e("campus", "org_topology", "Campus", "frontend/src/lib/scholar/structure-graph.ts"),
  e("premises", "org_topology", "Premises", "frontend/src/lib/scholar/facility.ts"),
  e("building", "org_topology", "Building", "frontend/src/lib/scholar/facility.ts"),
  e("room", "org_topology", "Room", "frontend/src/lib/scholar/facility.ts"),
  e("stage", "academic_topology", "Stage", "frontend/src/lib/scholar/education-levels.ts"),
  e("level", "academic_topology", "Level", "frontend/src/lib/scholar/education-levels.ts"),
  e("programme", "academic_topology", "Programme", "frontend/src/lib/scholar/programme.ts"),
  e("section", "academic_topology", "Section / arm", "frontend/src/lib/scholar/class.ts"),
  e("stream", "academic_topology", "Stream", "frontend/src/lib/scholar/class-flexibility.ts"),
  e("calendar", "temporal", "Academic calendar", "frontend/src/lib/scholar/calendar.ts"),
  e("academic_period", "temporal", "Academic period", "frontend/src/lib/scholar/academic-period.ts"),
  e("shift", "temporal", "Shift", "frontend/src/lib/scholar/calendar.ts"),
  e("position", "human", "Position", "frontend/src/lib/scholar/roles/index.ts"),
  e("person", "human", "Person (identity-bound)", "frontend/src/lib/scholar/platform-org"),
  e("teaching_assignment", "teaching_assignments", "Teaching assignment", "frontend/src/lib/scholar/assignment.ts"),
  e("assessment_scheme", "assessment_grading", "Assessment scheme", "frontend/src/lib/scholar/assessment-model.ts"),
  e("grading_scale", "assessment_grading", "Grading scale", "frontend/src/lib/scholar/grading.ts"),
  e("fee_structure", "finance", "Fee structure", "frontend/src/lib/scholar/billing"),
  e("boarding_unit", "operations", "Boarding / hostel unit", "frontend/src/lib/scholar/boarding.ts"),
  e("external_body", "governance_external", "External regulatory / examination body", "frontend/src/lib/scholar/examination.ts"),
];

export interface RelationshipTypeDef {
  readonly id: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly label: string;
  /** Effective-dated in the later graph phase (R2); recorded here as contract. */
  readonly temporal: boolean;
}

const r = (
  id: string,
  from: readonly string[],
  to: readonly string[],
  label: string,
  temporal = true,
): RelationshipTypeDef => ({ id, from, to, label, temporal });

export const RELATIONSHIP_TYPES: readonly RelationshipTypeDef[] = [
  r("contains", ["tenant", "group", "institution", "campus", "premises", "building"], ["group", "institution", "campus", "premises", "building", "room"], "contains"),
  r("offers", ["institution", "campus"], ["stage", "programme"], "offers"),
  r("has_level", ["stage", "programme"], ["level"], "has level"),
  r("has_section", ["level"], ["section", "stream"], "has section"),
  r("operates_shift", ["campus", "institution"], ["shift"], "operates shift"),
  r("follows_calendar", ["institution", "campus", "programme"], ["calendar"], "follows calendar"),
  r("has_period", ["calendar"], ["academic_period"], "has period"),
  r("assessed_by", ["level", "programme"], ["assessment_scheme"], "assessed by"),
  r("graded_on", ["assessment_scheme"], ["grading_scale"], "graded on"),
  r("staffed_by", ["campus", "institution", "programme"], ["position"], "staffed by"),
  r("held_by", ["position"], ["person"], "held by"),
  r("teaches", ["person"], ["teaching_assignment"], "teaches"),
  r("assigned_to", ["teaching_assignment"], ["section", "level", "programme"], "assigned to"),
  r("billed_by", ["level", "programme"], ["fee_structure"], "billed by"),
  r("houses", ["campus", "premises", "building"], ["boarding_unit"], "houses"),
  r("answers_to", ["institution", "programme"], ["external_body"], "answers to"),
];

const ENTITY_IDS = new Set(ENTITY_TYPES.map((x) => x.id));

export const isRealityDomain = (v: string): v is RealityDomain =>
  (REALITY_DOMAINS as readonly string[]).includes(v);
export const isInstitutionType = (v: string): v is InstitutionType =>
  (INSTITUTION_TYPES as readonly string[]).includes(v);
export const isAnswerType = (v: string): v is AnswerType =>
  (ANSWER_TYPES as readonly string[]).includes(v);
export const isEntityType = (v: string): boolean => ENTITY_IDS.has(v);

export interface TaxonomyIssue {
  readonly code: string;
  readonly message: string;
}

/** Internal consistency of the taxonomy itself (unique ids, known endpoints). */
export function validateTaxonomy(
  entities: readonly EntityTypeDef[] = ENTITY_TYPES,
  relationships: readonly RelationshipTypeDef[] = RELATIONSHIP_TYPES,
): TaxonomyIssue[] {
  const issues: TaxonomyIssue[] = [];
  const ids = new Set<string>();
  for (const x of entities) {
    if (ids.has(x.id)) issues.push({ code: "duplicate_entity_type", message: x.id });
    ids.add(x.id);
    if (!isRealityDomain(x.domain)) issues.push({ code: "unknown_domain", message: `${x.id}:${x.domain}` });
    if (!x.owner) issues.push({ code: "missing_owner", message: x.id });
  }
  const rids = new Set<string>();
  for (const x of relationships) {
    if (rids.has(x.id)) issues.push({ code: "duplicate_relationship_type", message: x.id });
    rids.add(x.id);
    for (const end of [...x.from, ...x.to]) {
      if (!ids.has(end)) issues.push({ code: "unknown_entity_type", message: `${x.id}:${end}` });
    }
  }
  return issues;
}
