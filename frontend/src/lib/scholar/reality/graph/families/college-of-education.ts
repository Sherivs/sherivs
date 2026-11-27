/**
 * M5a (E-009) — family: colleges of education (federal, state, private).
 * Teaching practice is asked; a degree affiliation is carried as unverified.
 */
import { campusCountStep, eq, familyModule, languagesStep, populationStep } from "../builders";
import type { GraphModule } from "../types";
import {
  academicBodyStep,
  boolStep,
  calendarStep,
  departmentCountStep,
  gradingScaleStep,
  intakeRoutesStep,
  programmeLevelsStep,
  regulatorsStep,
  SEMESTER_MODELS,
  unitCountStep,
} from "./tertiary-shared";

const F = "college_of_education";

export const MODULE: GraphModule = familyModule(F, [
  regulatorsStep(F, ["ncce"]),
  unitCountStep(F, "school"),
  departmentCountStep(F),
  programmeLevelsStep(F, ["nce", "pre_nce", "degree_affiliation"]),
  boolStep(
    F,
    "affiliation.has_partner_university",
    "degree_affiliation",
    eq(`${F}.programmes.levels`, "degree_affiliation"),
  ),
  boolStep(F, "placements.teaching_practice", "teaching_practice"),
  calendarStep(F, SEMESTER_MODELS),
  gradingScaleStep(F, ["five_point_cgpa", "four_point_cgpa"]),
  intakeRoutesStep(F, ["jamb_utme_caps", "direct_entry", "pre_nce", "part_time", "sandwich"]),
  boolStep(F, "welfare.hostels", "hostels"),
  academicBodyStep(F, ["academic_board", "other"]),
  campusCountStep(F),
  populationStep(F),
  languagesStep(F),
]);
