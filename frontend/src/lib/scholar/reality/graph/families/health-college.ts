/**
 * M5a (E-009) — family: colleges of health technology and colleges of nursing
 * and midwifery (§8.2: programmes, clinical sites and preceptors, licensing
 * exams, indexing). Health licensing-board names marked [VERIFY] in the brief
 * are carried as unverified flags by the plan generator. No patient data is
 * ever collected (Appendix A7).
 */
import {
  campusCountStep,
  familyModule,
  gt,
  languagesStep,
  populationStep,
  question,
} from "../builders";
import type { GraphModule } from "../types";
import {
  boolStep,
  calendarStep,
  gradingScaleStep,
  intakeRoutesStep,
  ownerStep,
} from "./tertiary-shared";

const F = "health_college";
const A = "institutionProfile.attributes";
const SITES = `${F}.clinical.site_count`;

export const HEALTH_PROGRAMMES = [
  "nursing",
  "midwifery",
  "chew",
  "jchew",
  "pharmacy_technician",
  "medical_laboratory_technician",
  "environmental_health",
  "health_information_management",
  "other",
] as const;

export const MODULE: GraphModule = familyModule(F, [
  {
    q: question(`${F}.programmes.offered`, "multi", "curricula", {
      options: HEALTH_PROGRAMMES,
      validation: { minItems: 1 },
      dataClass: "public",
    }),
  },
  ownerStep(F, ["federal", "state", "private", "faith_based", "hospital_owned"]),
  {
    q: question(SITES, "number", `${A}.clinical_site_count`, { validation: { min: 0, max: 100 } }),
  },
  boolStep(F, "clinical.external_preceptors", "external_preceptors", gt(SITES, 0)),
  {
    q: question(`${F}.licensing.bodies`, "multi", "institutionProfile.regulators", {
      options: ["nmcn", "chprbn", "mlscn", "pcn", "other", "not_sure"],
      validation: { minItems: 1 },
      dataClass: "public",
    }),
  },
  boolStep(F, "licensing.indexing", "licensing_indexing"),
  calendarStep(F, ["two_semester", "three_term", "other"]),
  gradingScaleStep(F, ["five_point_cgpa", "four_point_cgpa", "percentage_pass_mark"]),
  intakeRoutesStep(F, ["direct_application", "jamb_utme_caps", "entrance_exam", "interview"]),
  boolStep(F, "welfare.hostels", "hostels"),
  campusCountStep(F),
  populationStep(F),
  languagesStep(F),
]);
