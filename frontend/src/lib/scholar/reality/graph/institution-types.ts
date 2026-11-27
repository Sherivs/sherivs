/**
 * M5a (E-009) — institution type codes for question 1 and the family each one
 * branches into (ADR-107). Codes are the canonical ones of master brief §6.1.
 *
 * Not included as answers to question 1:
 *  - `boarding` and `multi_shift` are modifiers, asked inside a family;
 *  - regulators and exam bodies (NUC, NBTE, WAEC, JAMB, ...) are external
 *    authorities, not tenants, unless a regulator signs an MoU (§6.1).
 *
 * The R1 taxonomy (`INSTITUTION_TYPES` in ../taxonomy.ts) is left unchanged:
 * it types the post-tenant operating-model registry and its tests pin it.
 *
 * This module is imported by the first-question module, so it must never
 * import a family module.
 */

export const TYPE_GROUPS = ["basic_secondary", "tertiary", "government"] as const;
export type TypeGroup = (typeof TYPE_GROUPS)[number];

export const FAMILIES = [
  "private_basic",
  "public_basic",
  "unity_technical",
  "islamiyya",
  "university",
  "polytechnic",
  "college_of_education",
  "health_college",
  "agriculture_college",
  "tvet",
  "multi_campus",
  "oversight",
] as const;
export type Family = (typeof FAMILIES)[number];

interface TypeDef {
  readonly code: string;
  readonly group: TypeGroup;
  /** Fixed family, or "by_ownership" when ownership decides public vs private. */
  readonly family: Family | "by_ownership";
}

const t = (code: string, group: TypeGroup, family: TypeDef["family"]): TypeDef => ({
  code,
  group,
  family,
});

export const INSTITUTION_TYPE_DEFS: readonly TypeDef[] = [
  t("nursery_ecce", "basic_secondary", "by_ownership"),
  t("private_primary", "basic_secondary", "private_basic"),
  t("public_primary", "basic_secondary", "public_basic"),
  t("private_secondary", "basic_secondary", "private_basic"),
  t("public_jss", "basic_secondary", "public_basic"),
  t("public_sss", "basic_secondary", "public_basic"),
  t("public_secondary", "basic_secondary", "public_basic"),
  t("unity_college", "basic_secondary", "unity_technical"),
  t("technical_college", "basic_secondary", "unity_technical"),
  t("science_technical_college", "basic_secondary", "unity_technical"),
  t("special_needs_school", "basic_secondary", "by_ownership"),
  t("islamiyya_sangaya", "basic_secondary", "islamiyya"),
  t("mission_school", "basic_secondary", "private_basic"),
  t("multi_campus_group", "basic_secondary", "multi_campus"),
  t("university_federal", "tertiary", "university"),
  t("university_state", "tertiary", "university"),
  t("university_private", "tertiary", "university"),
  t("distance_learning_centre", "tertiary", "university"),
  t("polytechnic_federal", "tertiary", "polytechnic"),
  t("polytechnic_state", "tertiary", "polytechnic"),
  t("polytechnic_private", "tertiary", "polytechnic"),
  t("monotechnic", "tertiary", "polytechnic"),
  t("college_of_education_federal", "tertiary", "college_of_education"),
  t("college_of_education_state", "tertiary", "college_of_education"),
  t("college_of_education_private", "tertiary", "college_of_education"),
  t("college_of_health_technology", "tertiary", "health_college"),
  t("college_of_nursing_midwifery", "tertiary", "health_college"),
  t("college_of_agriculture", "tertiary", "agriculture_college"),
  t("innovation_enterprise_institution", "tertiary", "tvet"),
  t("vocational_enterprise_institution", "tertiary", "tvet"),
  t("federal_ministry_of_education", "government", "oversight"),
  t("state_ministry_of_education", "government", "oversight"),
  t("ministry_of_higher_education", "government", "oversight"),
  t("ubec", "government", "oversight"),
  t("subeb", "government", "oversight"),
  t("lgea", "government", "oversight"),
  t("teaching_service_commission", "government", "oversight"),
  t("secondary_education_board", "government", "oversight"),
  t("arabic_islamic_education_board", "government", "oversight"),
  t("tvet_board", "government", "oversight"),
  t("scholarship_board", "government", "oversight"),
  t("agency_for_mass_literacy", "government", "oversight"),
];

export const INSTITUTION_TYPE_CODES: readonly string[] = INSTITUTION_TYPE_DEFS.map((d) => d.code);

const DEF_BY_CODE = new Map(INSTITUTION_TYPE_DEFS.map((d) => [d.code, d]));

export const typeDef = (code: string): TypeDef | undefined => DEF_BY_CODE.get(code);

/** Types whose public/private split is not in the code; the entry asks ownership. */
export const OWNERSHIP_AMBIGUOUS_TYPES: readonly string[] = INSTITUTION_TYPE_DEFS.filter(
  (d) => d.family === "by_ownership",
).map((d) => d.code);

/** National bodies with no state of location to ask. */
export const NATIONAL_BODY_TYPES: readonly string[] = ["federal_ministry_of_education", "ubec"];

/** Ownership codes for the entry ownership question (ambiguous types only). */
export const ENTRY_OWNERSHIP_OPTIONS = [
  "private",
  "faith_based",
  "community",
  "state",
  "local_government",
  "federal",
] as const;
export const PUBLIC_OWNERSHIPS: readonly string[] = ["state", "local_government", "federal"];

/** 36 states and the FCT, as lower-snake codes. */
export const NG_STATE_CODES = [
  "abia",
  "adamawa",
  "akwa_ibom",
  "anambra",
  "bauchi",
  "bayelsa",
  "benue",
  "borno",
  "cross_river",
  "delta",
  "ebonyi",
  "edo",
  "ekiti",
  "enugu",
  "fct",
  "gombe",
  "imo",
  "jigawa",
  "kaduna",
  "kano",
  "katsina",
  "kebbi",
  "kogi",
  "kwara",
  "lagos",
  "nasarawa",
  "niger",
  "ogun",
  "ondo",
  "osun",
  "oyo",
  "plateau",
  "rivers",
  "sokoto",
  "taraba",
  "yobe",
  "zamfara",
] as const;

/** Family for a type code plus (for ambiguous types) the entry ownership answer. */
export function familyFor(typeCode: string, ownership?: string): Family | null {
  const d = typeDef(typeCode);
  if (!d) return null;
  if (d.family !== "by_ownership") return d.family;
  if (ownership === undefined) return null;
  return PUBLIC_OWNERSHIPS.includes(ownership) ? "public_basic" : "private_basic";
}

export const typesInFamily = (family: Family): string[] =>
  INSTITUTION_TYPE_DEFS.filter((d) => d.family === family).map((d) => d.code);
