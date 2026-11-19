/**
 * M5a (E-009) — family: public nursery, primary and secondary schools run
 * through SUBEB or a ministry (§8.2: governing authority and LGEA, UBE
 * section, levies, census returns, staff control). Admissions on by default.
 */
import { eq, familyModule, languagesStep, populationStep, question } from "../builders";
import type { GraphModule } from "../types";

const F = "public_basic";
const id = (s: string) => `${F}.${s}`;
const A = "institutionProfile.attributes";

export const GOVERNING_BODIES = [
  "subeb",
  "state_ministry_of_education",
  "secondary_education_board",
  "federal_ministry_of_education",
] as const;

const GOV = id("authority.governing_body");
const SECTIONS = id("structure.ube_sections");

export const MODULE: GraphModule = familyModule(F, [
  {
    q: question(GOV, "single", `${A}.governing_authority`, {
      options: GOVERNING_BODIES,
      dataClass: "public",
    }),
  },
  {
    q: question(id("authority.lgea_name"), "text", `${A}.lgea_name`, {
      validation: { maxLength: 120 },
      dataClass: "public",
    }),
    when: eq(GOV, "subeb"),
  },
  {
    q: question(SECTIONS, "multi", `${A}.sections`, {
      options: ["nursery", "primary", "jss", "sss"],
      validation: { minItems: 1 },
      dataClass: "public",
    }),
  },
  {
    q: question(id("finance.levies"), "single", `${A}.levies`, {
      options: ["none", "pta_levies_only"],
    }),
  },
  { q: question(id("returns.census"), "bool", `${A}.census_returns`) },
  {
    q: question(id("workforce.controlled_by"), "single", `${A}.workforce_controlled_by`, {
      options: [
        "subeb",
        "teaching_service_commission",
        "state_ministry_of_education",
        "local_government",
        "institution",
      ],
    }),
  },
  { q: question(id("structure.boarding"), "bool", `${A}.boarding`, { dataClass: "public" }) },
  { q: question(id("layout.shifts"), "bool", `${A}.multi_shift`) },
  {
    q: question(id("intake.mode"), "single", "admissions.mode", {
      options: ["catchment_allocation", "entrance_exam", "open_registration"],
      dataClass: "public",
    }),
  },
  {
    q: question(id("exams.external_centres"), "multi", `${A}.exam_centres`, {
      options: ["waec", "neco", "nabteb", "none"],
      validation: { minItems: 1 },
      dataClass: "public",
    }),
    when: eq(SECTIONS, "sss"),
  },
  populationStep(F),
  languagesStep(F),
]);
