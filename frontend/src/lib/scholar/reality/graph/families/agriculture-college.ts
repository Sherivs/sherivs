/**
 * M5a (E-009) — family: colleges of agriculture (§8.2: programmes, farm units
 * and practicals, produce and revenue, fieldwork logs).
 */
import {
  campusCountStep,
  eq,
  familyModule,
  languagesStep,
  not,
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
  regulatorsStep,
  SEMESTER_MODELS,
} from "./tertiary-shared";

const F = "agriculture_college";
const UNITS = `${F}.farm.units`;
const hasFarm = not(eq(UNITS, "none"));

export const MODULE: GraphModule = familyModule(F, [
  {
    q: question(`${F}.programmes.offered`, "multi", "curricula", {
      options: [
        "agronomy",
        "animal_health",
        "agricultural_engineering",
        "fisheries",
        "forestry",
        "agricultural_extension",
        "other",
      ],
      validation: { minItems: 1 },
      dataClass: "public",
    }),
  },
  ownerStep(F, ["federal", "state", "private"]),
  regulatorsStep(F, ["nbte"]),
  {
    q: question(UNITS, "multi", "institutionProfile.attributes.farm_units", {
      options: ["crops", "livestock", "poultry", "fishery", "forestry_nursery", "none"],
      validation: { minItems: 1 },
      dataClass: "public",
    }),
  },
  boolStep(F, "farm.practical_logs", "practical_logs", hasFarm),
  boolStep(F, "farm.produce_sales", "produce_sales", hasFarm),
  boolStep(F, "fieldwork.logs", "fieldwork_logs"),
  calendarStep(F, SEMESTER_MODELS),
  gradingScaleStep(F, ["four_point_cgpa", "five_point_cgpa"]),
  intakeRoutesStep(F, ["jamb_utme_caps", "direct_entry", "part_time", "entrance_exam"]),
  boolStep(F, "welfare.hostels", "hostels"),
  boolStep(F, "placements.industrial_training", "siwes"),
  campusCountStep(F),
  populationStep(F),
  languagesStep(F),
]);
