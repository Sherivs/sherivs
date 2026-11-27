/**
 * M5a (E-009) — family: ministries, UBEC, SUBEB, LGEA, teaching service
 * commissions and boards (§8.2: mandate, jurisdiction, directorates, returns
 * calendar, inspection cycle). Whatever is answered here, the plan keeps the
 * oversight workspace DISABLED with mandate_status 'unverified' (§8.2, A11).
 * The mandate reference is recorded as text; nothing is fetched or checked.
 */
import { familyModule, isIn, languagesStep, question } from "../builders";
import { ROOT_QUESTION_ID } from "../entry";
import type { GraphModule } from "../types";

const F = "oversight";
const id = (s: string) => `${F}.${s}`;
const A = "institutionProfile.attributes";

/** Bodies whose jurisdiction spans the local government areas of one state. */
export const STATE_LEVEL_BODIES = [
  "state_ministry_of_education",
  "ministry_of_higher_education",
  "subeb",
  "teaching_service_commission",
  "secondary_education_board",
  "arabic_islamic_education_board",
  "tvet_board",
  "scholarship_board",
  "agency_for_mass_literacy",
] as const;

export const MODULE: GraphModule = familyModule(F, [
  {
    q: question(id("mandate.instrument"), "text", `${A}.mandate_reference`, {
      validation: { maxLength: 300 },
      dataClass: "public",
    }),
  },
  {
    q: question(id("mandate.link"), "text", `${A}.mandate_link`, {
      validation: { maxLength: 300 },
      dataClass: "public",
    }),
  },
  {
    q: question(
      id("jurisdiction.institution_count"),
      "number",
      `${A}.institutions_in_jurisdiction`,
      {
        validation: { min: 0, max: 200000 },
      },
    ),
  },
  {
    q: question(id("jurisdiction.institution_kinds"), "multi", `${A}.jurisdiction_kinds`, {
      options: [
        "nursery_primary",
        "junior_secondary",
        "senior_secondary",
        "technical_vocational",
        "islamiyya_quranic",
        "tertiary",
        "private_institutions",
        "adult_literacy",
      ],
      validation: { minItems: 1 },
    }),
  },
  {
    q: question(id("jurisdiction.lga_count"), "number", `${A}.lga_count`, {
      validation: { min: 1, max: 44 },
    }),
    when: isIn(ROOT_QUESTION_ID, STATE_LEVEL_BODIES),
  },
  {
    q: question(id("structure.directorates"), "multi", `${A}.directorates`, {
      options: [
        "schools",
        "planning_research_statistics",
        "inspectorate_quality_assurance",
        "private_schools",
        "exams_standards",
        "science_technical",
        "higher_education",
        "finance_administration",
        "human_resources",
        "social_mobilisation",
        "other",
      ],
      validation: { minItems: 1 },
    }),
  },
  {
    q: question(id("returns.calendar"), "single", `${A}.returns_calendar`, {
      options: ["annual_census", "termly", "annual_and_termly", "none"],
    }),
  },
  {
    q: question(id("inspection.cycle"), "single", `${A}.inspection_cycle`, {
      options: ["termly", "annual", "ad_hoc", "none"],
    }),
  },
  languagesStep(F),
]);
