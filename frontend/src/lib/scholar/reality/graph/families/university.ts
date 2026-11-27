/**
 * M5a (E-009) — family: universities (federal, state, private) and
 * distance-learning centres. Ownership is in the type code except for
 * distance-learning centres, which are asked.
 */
import { campusCountStep, eq, familyModule, languagesStep, populationStep } from "../builders";
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

const F = "university";

export const MODULE: GraphModule = familyModule(F, [
  regulatorsStep(F, ["nuc"]),
  ownerStep(
    F,
    ["federal", "state", "private", "faith_based"],
    eq(ROOT_QUESTION_ID, "distance_learning_centre"),
  ),
  unitCountStep(F, "faculty"),
  departmentCountStep(F),
  programmeLevelsStep(F, ["undergraduate", "postgraduate", "sub_degree", "pre_degree"]),
  calendarStep(F, SEMESTER_MODELS),
  gradingScaleStep(F, ["five_point_cgpa", "four_point_cgpa"]),
  intakeRoutesStep(F, [
    "jamb_utme_caps",
    "direct_entry",
    "pre_degree",
    "part_time",
    "postgraduate",
    "distance",
  ]),
  boolStep(F, "welfare.hostels", "hostels"),
  boolStep(F, "placements.industrial_training", "siwes"),
  boolStep(F, "placements.clinical", "clinical_postings"),
  academicBodyStep(F, ["senate", "academic_board"]),
  campusCountStep(F),
  populationStep(F),
  languagesStep(F),
]);
