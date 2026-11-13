/**
 * SV1-REALITY R1 (#332) — versioned discovery question registry with
 * representative branch packs (ADR-051). Static, deterministic data; no
 * answers are stored here and nothing is persisted.
 *
 * V1 school-onboarding packs only: core (all school types), primary, secondary.
 * Tertiary/health/agriculture packs are future scope and deliberately absent. Answers will map onto the
 * existing `scholar.institution.operating_model` attributes (config mapping).
 */
import type {
  ConfidenceRequirement,
  ConfigMapping,
  DiscoveryQuestion,
  WebsiteMapping,
  QuestionValidation,
  VisibilityCondition,
} from "./question-types";
import {
  INSTITUTION_TYPES,
  REALITY_TAXONOMY_VERSION,
  type AnswerType,
  type InstitutionType,
  type RealityDomain,
} from "./taxonomy";
import {
  registryContentHash,
  validateRegistry,
  type BranchCoverageRule,
} from "./registry-validation";

export const QUESTION_REGISTRY_SCHEMA_VERSION = 1;

interface Opts {
  required?: boolean;
  activate?: boolean;
  when?: readonly VisibilityCondition[];
  validation?: QuestionValidation;
  entity?: string;
  confidence?: ConfidenceRequirement;
  na?: boolean;
  web?: WebsiteMapping;
}

const NOT_PUBLIC: WebsiteMapping = { publicSafe: false };
const PUBLIC = (field: string): WebsiteMapping => ({ publicSafe: true, field });

const OM = "scholar.institution.operating_model";

function build(
  pack: string,
  types: readonly InstitutionType[],
  id: string,
  domain: RealityDomain,
  answerType: AnswerType,
  prompt: string,
  path: string,
  o: Opts = {},
): DiscoveryQuestion {
  const visibleWhen = o.when ?? [];
  const mapping: ConfigMapping = { path: `${OM}.${path}`, entityType: o.entity ?? "institution" };
  return {
    id: `${pack}.${id}`,
    pack,
    domain,
    institutionTypes: types,
    prompt,
    answerType,
    visibleWhen,
    required: o.required ?? o.activate ?? false,
    requiredToActivate: o.activate ?? false,
    dependsOn: visibleWhen.map((c) => c.questionId),
    validation: o.validation ?? {},
    followUps: [],
    configMapping: mapping,
    confidence: o.confidence ?? "confirmed",
    allowNotApplicable: o.na ?? false,
    websiteMapping: o.web ?? NOT_PUBLIC,
  };
}

const eq = (questionId: string, value: string | number | boolean): VisibilityCondition => ({
  questionId,
  op: "equals",
  value,
});

const ALL = INSTITUTION_TYPES;
const pack =
  (name: string, types: readonly InstitutionType[]) =>
  (id: string, domain: RealityDomain, at: AnswerType, prompt: string, path: string, o?: Opts) =>
    build(name, types, id, domain, at, prompt, path, o);

const core = pack("core", ALL);
const primary = pack("primary", ["primary"]);
const secondary = pack("secondary", ["secondary"]);

const RAW: readonly DiscoveryQuestion[] = [
  core(
    "type.institution_type",
    "identity",
    "single",
    "What type of institution is this?",
    "institution_type",
    {
      web: PUBLIC("institution_type"),
      activate: true,
      validation: { options: INSTITUTION_TYPES },
    },
  ),
  core(
    "layout.campus_count",
    "org_topology",
    "number",
    "How many campuses does the institution operate?",
    "campus_count",
    {
      web: PUBLIC("campus_count"),
      activate: true,
      entity: "campus",
      validation: { min: 1, max: 100 },
    },
  ),
  core(
    "layout.campuses",
    "org_topology",
    "repeating_group",
    "List each campus and its premises.",
    "campuses",
    {
      activate: true,
      entity: "campus",
      when: [{ questionId: "core.layout.campus_count", op: "answered" }],
      validation: { minItems: 1, maxItems: 100 },
    },
  ),
  core(
    "academics.calendar_kind",
    "temporal",
    "single",
    "Which calendar structure does the institution follow?",
    "calendar_kind",
    {
      activate: true,
      entity: "calendar",
      validation: { options: ["term", "semester", "trimester", "block", "custom"] },
    },
  ),
  core(
    "academics.shifts",
    "temporal",
    "bool",
    "Does any campus run more than one shift?",
    "uses_shifts",
    {
      entity: "shift",
      na: true,
    },
  ),
  core(
    "people.head_position",
    "human",
    "text",
    "Which position leads the institution?",
    "head_position",
    {
      entity: "position",
      validation: { maxLength: 120 },
    },
  ),
  core(
    "services.boarding",
    "operations",
    "bool",
    "Does the institution provide boarding or hostels?",
    "boarding_enabled",
    {
      entity: "boarding_unit",
      na: true,
    },
  ),
  core(
    "authority.external_bodies",
    "governance_external",
    "multi",
    "Which external bodies set obligations for the institution?",
    "external_bodies",
    {
      entity: "external_body",
      confidence: "inferred_ok",
      na: true,
      validation: { options: ["waec", "neco", "nabteb", "other"] },
    },
  ),
  core(
    "finance.fee_model",
    "finance",
    "single",
    "Is finance managed centrally or per institution?",
    "finance_mode",
    {
      entity: "fee_structure",
      validation: { options: ["centralised", "decentralised"] },
    },
  ),
  core(
    "group.hr_model",
    "human",
    "single",
    "Is HR managed centrally or per institution?",
    "hr_mode",
    {
      entity: "position",
      validation: { options: ["centralised", "decentralised"] },
    },
  ),

  primary(
    "academics.levels",
    "academic_topology",
    "multi",
    "Which primary levels are offered?",
    "levels",
    {
      web: PUBLIC("levels_offered"),
      activate: true,
      entity: "level",
      validation: {
        options: [
          "nursery",
          "primary_1",
          "primary_2",
          "primary_3",
          "primary_4",
          "primary_5",
          "primary_6",
        ],
        minItems: 1,
      },
    },
  ),
  primary(
    "academics.arms_enabled",
    "academic_topology",
    "bool",
    "Do levels have multiple arms (A, B, C…)?",
    "arms_enabled",
    {
      entity: "section",
    },
  ),
  primary(
    "academics.arm_names",
    "academic_topology",
    "multi",
    "Which arm names are used?",
    "arm_names",
    {
      entity: "section",
      when: [eq("primary.academics.arms_enabled", true)],
      validation: { options: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), minItems: 1 },
    },
  ),
  primary(
    "assessment.ca_weight",
    "assessment_grading",
    "number",
    "What percentage of the total is continuous assessment?",
    "ca_weight_percent",
    {
      entity: "assessment_scheme",
      validation: { min: 0, max: 100 },
    },
  ),

  secondary(
    "academics.structure",
    "academic_topology",
    "single",
    "Are junior and senior secondary run together or separately?",
    "secondary_structure",
    {
      activate: true,
      entity: "stage",
      validation: { options: ["combined", "jss_only", "sss_only", "separate_campuses"] },
    },
  ),
  secondary(
    "academics.streams",
    "academic_topology",
    "multi",
    "Which senior streams are offered?",
    "streams",
    {
      web: PUBLIC("streams_offered"),
      entity: "stream",
      when: [
        {
          questionId: "secondary.academics.structure",
          op: "in",
          value: ["combined", "sss_only", "separate_campuses"],
        },
      ],
      validation: { options: ["science", "arts", "commercial", "technical"], minItems: 1 },
    },
  ),
  secondary(
    "assessment.positions",
    "assessment_grading",
    "single",
    "How are class positions computed?",
    "positions_policy",
    {
      entity: "assessment_scheme",
      validation: { options: ["none", "per_class", "per_section", "across_parallel_arms"] },
    },
  ),
  secondary(
    "governance.exam_bodies",
    "governance_external",
    "multi",
    "Which external examinations are sat?",
    "exam_bodies",
    {
      web: PUBLIC("examinations"),
      entity: "external_body",
      na: true,
      validation: { options: ["waec", "neco", "nabteb"] },
    },
  ),
];

/** Derive follow-ups from visibility gating so the two can never disagree. */
function withFollowUps(list: readonly DiscoveryQuestion[]): DiscoveryQuestion[] {
  return list.map((q) => ({
    ...q,
    followUps: list
      .filter((c) => c.visibleWhen.some((v) => v.questionId === q.id))
      .map((c) => c.id),
  }));
}

export const QUESTION_REGISTRY: readonly DiscoveryQuestion[] = Object.freeze(withFollowUps(RAW));

export const REQUIRED_BRANCH_COVERAGE: readonly BranchCoverageRule[] = (
  ["primary", "secondary"] as const
).map((institutionType) => ({
  institutionType,
  domains: ["org_topology", "academic_topology", "assessment_grading"],
}));

export interface RegistryVersion {
  readonly schemaVersion: number;
  readonly taxonomyVersion: string;
  readonly questionCount: number;
  readonly contentHash: string;
}

export function registryVersion(
  questions: readonly DiscoveryQuestion[] = QUESTION_REGISTRY,
): RegistryVersion {
  return {
    schemaVersion: QUESTION_REGISTRY_SCHEMA_VERSION,
    taxonomyVersion: REALITY_TAXONOMY_VERSION,
    questionCount: questions.length,
    contentHash: registryContentHash(questions),
  };
}

export const validateQuestionRegistry = (
  questions: readonly DiscoveryQuestion[] = QUESTION_REGISTRY,
) => validateRegistry(questions, REQUIRED_BRANCH_COVERAGE);

export const questionsForType = (type: InstitutionType): DiscoveryQuestion[] =>
  QUESTION_REGISTRY.filter((q) => q.institutionTypes.includes(type));
