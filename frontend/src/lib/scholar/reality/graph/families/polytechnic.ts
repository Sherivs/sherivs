/**
 * M5a (E-009) — family: polytechnics (federal, state, private) and
 * monotechnics. Monotechnics are asked their specialisation and ownership.
 */
import {
  campusCountStep,
  eq,
  familyModule,
  languagesStep,
  populationStep,
  question,
} from "../builders";
import { ROOT_QUESTION_ID } from "../entry";
import type { GraphModule } from "../types";
import {
  academicBodyStep,
  boolStep,
  calendarStep,
  departmentCountStep,
  gradingScaleStep,
  intakeRoutesStep,
  ownerStep,
  programmeLevelsStep,
  regulatorsStep,
  SEMESTER_MODELS,
  unitCountStep,
} from "./tertiary-shared";

const F = "polytechnic";
const isMono = eq(ROOT_QUESTION_ID, "monotechnic");

export const MODULE: GraphModule = familyModule(F, [
  regulatorsStep(F, ["nbte"]),
  {
    q: question(
      `${F}.specialisation.field`,
      "single",
      "institutionProfile.attributes.specialisation",
      {
        options: ["survey", "petroleum", "aviation", "fisheries", "other"],
        dataClass: "public",
      },
    ),
    when: isMono,
  },
  ownerStep(F, ["federal", "state", "private"], isMono),
  unitCountStep(F, "school"),
  departmentCountStep(F),
  programmeLevelsStep(F, ["nd", "hnd", "pre_nd", "certificate", "postgraduate_diploma"]),
  calendarStep(F, SEMESTER_MODELS),
  gradingScaleStep(F, ["four_point_cgpa", "five_point_cgpa"]),
  intakeRoutesStep(F, ["jamb_utme_caps", "direct_entry", "pre_nd", "part_time"]),
  boolStep(F, "welfare.hostels", "hostels"),
  boolStep(F, "placements.industrial_training", "siwes"),
  boolStep(F, "enterprise.consultancy_unit", "consultancy_unit"),
  academicBodyStep(F, ["academic_board", "other"]),
  campusCountStep(F),
  populationStep(F),
  languagesStep(F),
]);
