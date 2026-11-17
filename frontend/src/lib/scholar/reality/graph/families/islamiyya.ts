/**
 * M5a (E-009) — family: Islamiyya, Tsangaya and integrated Qur'anic schools
 * (Appendix A3). Board names differ by state and are carried as unverified.
 */
import { eq, familyModule, languagesStep, not, or, populationStep, question } from "../builders";
import type { GraphModule } from "../types";

const F = "islamiyya";
const id = (s: string) => `${F}.${s}`;
const A = "institutionProfile.attributes";

const OWNER = id("authority.owner");
const USE_SHERIVS = id("intake.use_sherivs");

export const MODULE: GraphModule = familyModule(F, [
  {
    q: question(id("model.kind"), "single", `${A}.model`, {
      options: [
        "tsangaya_traditional",
        "integrated_quranic",
        "islamiyya_primary",
        "islamiyya_secondary",
      ],
      dataClass: "public",
    }),
  },
  {
    q: question(id("model.integrated_subjects"), "bool", `${A}.integrated_subjects`, {
      dataClass: "public",
    }),
  },
  {
    q: question(OWNER, "single", "institutionProfile.ownership", {
      options: ["community", "private", "faith_based", "state"],
      dataClass: "public",
    }),
  },
  {
    q: question(id("authority.board"), "single", `${A}.governing_authority`, {
      options: [
        "arabic_islamic_education_board",
        "subeb",
        "state_ministry_of_education",
        "none",
        "not_sure",
      ],
    }),
  },
  { q: question(id("welfare.feeding_programme"), "bool", `${A}.feeding_programme`) },
  { q: question(id("operations.low_end_capture"), "bool", `${A}.low_end_capture`) },
  {
    q: question(id("finance.levy"), "single", `${A}.billing_period`, {
      options: ["none", "voluntary_contribution", "termly", "per_session"],
    }),
  },
  {
    q: question(id("exams.bodies"), "multi", `${A}.exam_centres`, {
      options: ["nbais", "waec", "neco", "none"],
      validation: { minItems: 1 },
    }),
  },
  {
    q: question(USE_SHERIVS, "bool", "admissions.enabledByDefault"),
    when: not(eq(OWNER, "state")),
  },
  {
    q: question(id("intake.mode"), "single", "admissions.mode", {
      options: ["open_rolling", "term_cycle"],
      dataClass: "public",
    }),
    when: or(eq(OWNER, "state"), eq(USE_SHERIVS, true)),
  },
  populationStep(F),
  languagesStep(F),
]);
