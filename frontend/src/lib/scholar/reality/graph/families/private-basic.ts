/**
 * M5a (E-009) — family: private nursery, primary and secondary (also mission
 * schools and privately owned nursery or special-needs schools). Follows the
 * master brief §8.2 illustration in order. Admissions are optional (§9.1).
 */
import {
  campusCountStep,
  eq,
  familyModule,
  languagesStep,
  populationStep,
  question,
} from "../builders";
import type { GraphModule } from "../types";
import { PRIVATE_CURRICULA, PRIVATE_INTAKE_MODES, SECTION_OPTIONS } from "./options";

const F = "private_basic";
const id = (s: string) => `${F}.${s}`;
const A = "institutionProfile.attributes";

const SECTIONS = id("structure.sections");
const USE_SHERIVS = id("intake.use_sherivs");

export const MODULE: GraphModule = familyModule(F, [
  {
    q: question(SECTIONS, "multi", `${A}.sections`, {
      options: SECTION_OPTIONS,
      validation: { minItems: 1, maxItems: SECTION_OPTIONS.length },
      dataClass: "public",
    }),
  },
  { q: question(id("structure.boarding"), "bool", `${A}.boarding`, { dataClass: "public" }) },
  campusCountStep(F),
  { q: question(id("layout.shifts"), "bool", `${A}.multi_shift`) },
  {
    q: question(id("academics.curricula"), "multi", "curricula", {
      options: PRIVATE_CURRICULA,
      validation: { minItems: 1, maxItems: PRIVATE_CURRICULA.length },
      dataClass: "public",
    }),
  },
  {
    q: question(id("finance.billing_period"), "single", `${A}.billing_period`, {
      options: ["termly", "per_session", "termly_and_session"],
    }),
  },
  { q: question(id("finance.instalments"), "bool", `${A}.instalments`) },
  { q: question(USE_SHERIVS, "bool", "admissions.enabledByDefault") },
  {
    q: question(id("intake.mode"), "single", "admissions.mode", {
      options: PRIVATE_INTAKE_MODES,
      dataClass: "public",
    }),
    when: eq(USE_SHERIVS, true),
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
  {
    q: question(id("governance.leadership"), "single", `${A}.leadership_model`, {
      options: ["proprietor_led", "head_led"],
    }),
  },
  languagesStep(F),
]);
