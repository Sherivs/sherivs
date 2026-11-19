/**
 * M5a (E-009) — family: TVET innovation enterprise institutions (IEI) and
 * vocational enterprise institutions (VEI) (Appendix A9).
 */
import {
  campusCountStep,
  familyModule,
  languagesStep,
  populationStep,
  question,
} from "../builders";
import type { GraphModule } from "../types";
import { boolStep, calendarStep, intakeRoutesStep, ownerStep } from "./tertiary-shared";
import { TRADE_OPTIONS } from "./options";

const F = "tvet";

export const MODULE: GraphModule = familyModule(F, [
  {
    q: question(`${F}.programmes.trades`, "multi", "curricula", {
      options: TRADE_OPTIONS,
      validation: { minItems: 1 },
      dataClass: "public",
    }),
  },
  ownerStep(F, ["private", "state", "federal", "faith_based", "community"]),
  boolStep(F, "assessment.nsq_centre", "nsq_centre"),
  boolStep(F, "exams.nabteb", "nabteb_candidates"),
  boolStep(F, "placements.industry", "industry_placement"),
  calendarStep(F, ["two_semester", "three_term", "modular"]),
  intakeRoutesStep(F, ["direct_application", "entrance_exam", "jamb_utme_caps"]),
  boolStep(F, "welfare.hostels", "hostels"),
  campusCountStep(F),
  populationStep(F),
  languagesStep(F),
]);
