/**
 * M5a (E-009) — the plan generator: a pure function answers -> provisioning
 * plan (master brief §8.4, ADR-107).
 *
 * Only answers ON THE WALKED PATH count. Each one is written to its question's
 * `writesTo` path, then the rest of the plan is derived from the institution
 * type, the family and those answers. Output is canonical (sorted keys,
 * sorted set-like arrays), so the same answers always give byte-identical JSON.
 *
 * Honesty rules:
 *  - Role pack codes are PLACEHOLDERS `ng.<institution_type>` @ 0.1.0 until the
 *    role-pack catalogue publishes real packs (flag `placeholder:role_pack`).
 *  - Every authority link candidate has status 'unverified'.
 *  - Oversight bodies get the oversight workspace DISABLED with mandate_status
 *    'unverified'; nothing here can enable it.
 *  - Anything the brief marks [VERIFY], and any default we could not confirm,
 *    is carried as a `verify:` / `unconfirmed:` flag, never asserted.
 */
import {
  canonicalize,
  normalizeAuthorityLinks,
  setAtPlanPath,
  sortedUnique,
  unverifiedLink,
  type AuthorityLinkCandidate,
} from "@/lib/onboarding/plan";
import { familyForAnswers, ROOT_QUESTION_ID, STATE_QUESTION_ID } from "./entry";
import { FULL_REALITY_GRAPH } from "./full-graph";
import type { Family } from "./institution-types";
import { typeDef } from "./institution-types";
import type { GraphAnswers, QuestionGraph } from "./types";
import { walk } from "./walker";

export const PLACEHOLDER_PACK_VERSION = "0.1.0";
export const MAX_PLACEHOLDER_UNITS = 30;

export interface PlanOrgUnit {
  readonly key: string;
  readonly kind: string;
  readonly parentKey: string | null;
}

export interface PlanModule {
  readonly code: string;
  readonly enabled: boolean;
  readonly gate: null | {
    readonly kind: "mandate_verification";
    readonly mandate_status: "unverified";
  };
}

export interface OnboardingPlan {
  readonly rolePack: { readonly code: string; readonly version: string };
  readonly orgUnits: readonly PlanOrgUnit[];
  readonly calendarModel: string;
  readonly gradingSystem: string;
  readonly curricula: readonly string[];
  readonly modules: readonly PlanModule[];
  readonly websiteTemplate: string;
  readonly admissions: { readonly enabledByDefault: boolean; readonly mode: string };
  readonly authorityLinkCandidates: readonly AuthorityLinkCandidate[];
  readonly institutionProfile: {
    readonly institution_type: string | null;
    readonly ownership: string;
    readonly regulators: readonly string[];
    readonly calendar_model: string;
    readonly grading_system: string;
    readonly curricula: readonly string[];
    readonly languages: readonly string[];
    readonly attributes: Readonly<Record<string, unknown>>;
  };
  readonly flags: readonly string[];
}

const TERTIARY: readonly Family[] = [
  "university",
  "polytechnic",
  "college_of_education",
  "health_college",
  "agriculture_college",
  "tvet",
];

const DEFAULT_REGULATORS: Partial<Record<string, readonly string[]>> = {
  university: ["nuc"],
  polytechnic: ["nbte"],
  college_of_education: ["ncce"],
  agriculture_college: ["nbte"],
  tvet: ["nbte"],
};

const WEBSITE_TEMPLATE: Record<Family, string> = {
  private_basic: "basic_private",
  public_basic: "basic_public",
  unity_technical: "secondary_public",
  islamiyya: "islamiyya",
  university: "tertiary_university",
  polytechnic: "tertiary_polytechnic",
  college_of_education: "tertiary_college_of_education",
  health_college: "tertiary_health_college",
  agriculture_college: "tertiary_agriculture_college",
  tvet: "tvet_institution",
  multi_campus: "group",
  oversight: "authority_information",
};

/** Bodies whose names differ by state (§6.1 [VERIFY each name per state]). */
const NAME_VARIES_BY_STATE = [
  "teaching_service_commission",
  "secondary_education_board",
  "arabic_islamic_education_board",
];

/** Licensing-board names the brief marks [VERIFY] (§6.1, §8.2), plus our own unchecked one. */
const UNVERIFIED_BOARD_NAMES = ["chprbn", "mlscn", "pcn"];

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

function derivedOwnership(
  type: string,
  family: Family | null,
  attrs: Record<string, unknown>,
): string {
  if (type.endsWith("_federal") || type === "unity_college") return "federal";
  if (type.endsWith("_state")) return "state";
  if (type.endsWith("_private") || type.startsWith("private_")) return "private";
  if (type === "mission_school") return "faith_based";
  if (family === "oversight") return "government";
  if (family === "public_basic")
    return str(attrs.governing_authority) === "federal_ministry_of_education" ? "federal" : "state";
  return "unspecified";
}

export function generatePlan(
  answers: GraphAnswers,
  graph: QuestionGraph = FULL_REALITY_GRAPH,
): OnboardingPlan {
  const w = walk(graph, answers);
  const pa = w.pathAnswers;
  const byId = new Map(graph.questions.map((q) => [q.id, q]));
  let draft: Record<string, unknown> = {};
  for (const id of w.path) draft = setAtPlanPath(draft, byId.get(id)!.writesTo, pa[id]);

  const flags = new Set<string>();
  const type = str(pa[ROOT_QUESTION_ID]) ?? null;
  const family = familyForAnswers(pa);
  const profileDraft = (draft.institutionProfile ?? {}) as Record<string, unknown>;
  const attrs = { ...((profileDraft.attributes ?? {}) as Record<string, unknown>) };
  const state = str(pa[STATE_QUESTION_ID]) ?? null;
  const isOversight = family === "oversight";
  const isTertiary = family !== null && TERTIARY.includes(family);

  if (!w.complete) flags.add("interview_incomplete");
  if (!type || !family) flags.add("unconfirmed:institution_type");

  // Ownership.
  const ownership =
    str(profileDraft.ownership) ?? (type ? derivedOwnership(type, family, attrs) : "unspecified");
  const isPublic = ["state", "local_government", "federal", "government"].includes(ownership);

  // Regulators.
  let regulators = list(profileDraft.regulators);
  if (regulators.includes("not_sure")) flags.add("unconfirmed:regulator");
  if (regulators.includes("other")) flags.add("unconfirmed:unlisted_regulator");
  regulators = regulators.filter((r) => r !== "not_sure" && r !== "other");
  if (regulators.length === 0) {
    if (type === "college_of_nursing_midwifery") regulators = ["nmcn"];
    else if (family && DEFAULT_REGULATORS[family]) regulators = [...DEFAULT_REGULATORS[family]!];
    if (
      isTertiary &&
      family !== "university" &&
      family !== "polytechnic" &&
      family !== "college_of_education"
    )
      flags.add("unconfirmed:regulator");
  }
  for (const r of regulators) if (UNVERIFIED_BOARD_NAMES.includes(r)) flags.add(`verify:${r}_name`);
  if (family === "agriculture_college") flags.add("verify:agriculture_college_regulator");
  if (family === "tvet") flags.add("verify:tvet_regulator");
  if (type === "technical_college" || type === "science_technical_college")
    flags.add("verify:technical_college_regulator");

  // Calendar, assessment, curricula.
  const calendarModel =
    str(draft.calendarModel) ??
    (isOversight
      ? "not_applicable"
      : isTertiary
        ? "two_semester"
        : str(attrs.model) === "tsangaya_traditional"
          ? "continuous"
          : "three_term");
  if (isTertiary && !str(draft.calendarModel)) flags.add("unconfirmed:calendar_model");
  let gradingSystem = str(draft.gradingSystem);
  if (gradingSystem === "other") {
    flags.add("unconfirmed:grading_system");
    gradingSystem = "to_be_configured";
  }
  if (!gradingSystem) {
    if (isOversight) gradingSystem = "not_applicable";
    else if (isTertiary) {
      gradingSystem = "to_be_configured";
      flags.add("unconfirmed:grading_system");
    } else if (str(attrs.model) === "tsangaya_traditional") gradingSystem = "progress_record";
    else gradingSystem = "continuous_assessment_and_exam";
  }
  let curricula = list(draft.curricula);
  if (curricula.length === 0) {
    if (family === "public_basic" || family === "unity_technical")
      curricula = ["nigerian_national"];
    else if (family === "islamiyya")
      curricula =
        attrs.integrated_subjects === true ? ["nigerian_national", "quranic"] : ["quranic"];
  }
  curricula = sortedUnique(curricula);

  // Admissions (§9.1: on for public and all tertiary, optional for private).
  const admDraft = (draft.admissions ?? {}) as Record<string, unknown>;
  let enabledByDefault: boolean;
  let mode: string;
  const routes = list(attrs.intake_routes);
  if (isOversight || !family) {
    enabledByDefault = false;
    mode = "none";
  } else if (isTertiary) {
    enabledByDefault = true;
    mode = routes.includes("jamb_utme_caps") ? "jamb_caps_cycle" : "direct_cycle";
  } else if (isPublic) {
    enabledByDefault = true;
    mode = str(admDraft.mode) ?? "cycle";
  } else {
    enabledByDefault = admDraft.enabledByDefault === true;
    mode = enabledByDefault ? (str(admDraft.mode) ?? "cycle") : "not_configured";
  }
  if (routes.includes("jamb_utme_caps")) flags.add("verify:jamb_caps_access_terms");
  if (!isOversight && family) flags.add("founder_confirm:admissions_availability");

  // Authority link candidates (all unverified).
  const links: AuthorityLinkCandidate[] = regulators.map((r) => unverifiedLink(r, "regulated_by"));
  const gov = str(attrs.governing_authority);
  if (gov && gov !== "none" && gov !== "not_sure") {
    const national = gov === "federal_ministry_of_education";
    links.push(unverifiedLink(gov, "supervised_by", national ? null : state));
    if (NAME_VARIES_BY_STATE.includes(gov)) flags.add("verify:authority_name_per_state");
  }
  if (gov === "not_sure") flags.add("unconfirmed:governing_authority");
  if (gov === "subeb") links.push(unverifiedLink("lgea", "supervised_by", state));
  if (type === "unity_college")
    links.push(unverifiedLink("federal_ministry_of_education", "supervised_by"));
  if (type === "technical_college" || type === "science_technical_college")
    links.push(unverifiedLink("nbte", "regulated_by"));
  if ((family === "private_basic" || family === "multi_campus") && state)
    links.push(unverifiedLink("state_ministry_of_education", "registered_with", state));
  for (const body of list(attrs.exam_centres))
    if (body !== "none") links.push(unverifiedLink(body, "candidate_centre_of"));
  if (attrs.nabteb_candidates === true) links.push(unverifiedLink("nabteb", "candidate_centre_of"));
  if (isOversight && type) {
    if (NAME_VARIES_BY_STATE.includes(type)) flags.add("verify:authority_name_per_state");
    if (type === "subeb") links.push(unverifiedLink("ubec", "reports_to"));
    if (type === "lgea") links.push(unverifiedLink("subeb", "reports_to", state));
    if (type === "ubec")
      links.push(unverifiedLink("federal_ministry_of_education", "supervised_by"));
    if (
      ![
        "federal_ministry_of_education",
        "ubec",
        "state_ministry_of_education",
        "ministry_of_higher_education",
        "subeb",
        "lgea",
      ].includes(type)
    )
      links.push(unverifiedLink("state_ministry_of_education", "supervised_by", state));
    flags.add("oversight_mandate_unverified");
  }

  // Org units (placeholder keys; reviewers rename them).
  const units: PlanOrgUnit[] = [{ key: "org", kind: "organization", parentKey: null }];
  const counted = (n: number | undefined, kind: string) => {
    const k = Math.min(n ?? 0, MAX_PLACEHOLDER_UNITS);
    if ((n ?? 0) > MAX_PLACEHOLDER_UNITS) flags.add(`truncated:${kind}_units`);
    for (let i = 1; i <= k; i++) units.push({ key: `${kind}_${i}`, kind, parentKey: "org" });
  };
  const campusCount = num(attrs.campus_count);
  if (campusCount !== undefined && campusCount > 1) counted(campusCount, "campus");
  for (const s of list(attrs.sections))
    units.push({ key: `section_${s}`, kind: "section", parentKey: "org" });
  counted(num(attrs.faculty_count), "faculty");
  counted(num(attrs.school_count), "school");
  if (family === "health_college" || family === "agriculture_college" || family === "tvet")
    for (const p of curricula)
      units.push({ key: `programme_${p}`, kind: "programme", parentKey: "org" });
  for (const f of list(attrs.farm_units))
    if (f !== "none") units.push({ key: `farm_unit_${f}`, kind: "farm_unit", parentKey: "org" });
  for (const d of list(attrs.directorates))
    units.push({ key: `directorate_${d}`, kind: "directorate", parentKey: "org" });
  for (const t of list(attrs.trades))
    units.push({ key: `trade_${t}`, kind: "trade", parentKey: "org" });

  // Modules.
  const mods = new Map<string, PlanModule>();
  const on = (code: string, enabled = true) => mods.set(code, { code, enabled, gate: null });
  if (isOversight) {
    mods.set("oversight_workspace", {
      code: "oversight_workspace",
      enabled: false,
      gate: { kind: "mandate_verification", mandate_status: "unverified" },
    });
    on("website");
    on("communications");
  } else if (family) {
    for (const c of [
      "people_records",
      "website",
      "communications",
      "assessment_results",
      "attendance",
      "timetable",
    ])
      on(c);
    on("admissions", enabledByDefault);
    if (!isPublic || attrs.levies === "pta_levies_only" || isTertiary) on("billing");
    if (attrs.boarding === true || attrs.hostels === true) on("boarding_hostels");
    if (list(attrs.exam_centres).some((x) => x !== "none") || attrs.nabteb_candidates === true)
      on("exam_body_registrations");
    if (isTertiary) on("course_registration");
    if (attrs.siwes === true || attrs.industry_placement === true) on("industrial_training");
    if (attrs.teaching_practice === true) on("teaching_practice");
    if (attrs.clinical_postings === true || family === "health_college") on("clinical_postings");
    if (attrs.licensing_indexing === true) on("licensing_indexing");
    if (list(attrs.farm_units).some((x) => x !== "none")) on("farm_operations");
    if (attrs.produce_sales === true) on("produce_sales");
    if (attrs.practical_logs === true || attrs.fieldwork_logs === true) on("practical_logs");
    if (attrs.nsq_centre === true) on("trade_assessment");
    if (attrs.census_returns === true) on("returns");
    if (attrs.feeding_programme === true) on("welfare_feeding");
    if (family === "multi_campus") on("group_console");
  }
  const modules = [...mods.values()].sort((a, b) => (a.code < b.code ? -1 : 1));

  const languages = sortedUnique(
    list(profileDraft.languages).length ? list(profileDraft.languages) : ["en"],
  );
  if (state) attrs.state = state;

  if (type) flags.add("placeholder:role_pack");
  if (family) flags.add("placeholder:website_template");

  const plan: OnboardingPlan = {
    rolePack: { code: type ? `ng.${type}` : "ng.unknown", version: PLACEHOLDER_PACK_VERSION },
    orgUnits: units,
    calendarModel,
    gradingSystem,
    curricula,
    modules,
    websiteTemplate: family ? WEBSITE_TEMPLATE[family] : "none",
    admissions: { enabledByDefault, mode },
    authorityLinkCandidates: normalizeAuthorityLinks(links),
    institutionProfile: {
      institution_type: type && typeDef(type) ? type : null,
      ownership,
      regulators: sortedUnique(regulators),
      calendar_model: calendarModel,
      grading_system: gradingSystem,
      curricula,
      languages,
      attributes: attrs,
    },
    flags: sortedUnique(flags),
  };
  return canonicalize(plan) as unknown as OnboardingPlan;
}
