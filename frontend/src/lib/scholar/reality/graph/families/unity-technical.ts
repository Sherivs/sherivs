/**
 * M5a (E-009) — family: unity colleges (federal government colleges) and
 * technical / science-technical colleges. Unity colleges are federal by type,
 * so ownership is asked only of technical colleges.
 */
import {
  and,
  eq,
  familyModule,
  isIn,
  languagesStep,
  not,
  or,
  populationStep,
  question,
} from "../builders";
import { ROOT_QUESTION_ID } from "../entry";
import type { GraphModule } from "../types";
import { TRADE_OPTIONS } from "./options";

const F = "unity_technical";
const id = (s: string) => `${F}.${s}`;
const A = "institutionProfile.attributes";

const OWNER = id("authority.owner");
const USE_SHERIVS = id("intake.use_sherivs");
const isTechnical = isIn(ROOT_QUESTION_ID, ["technical_college", "science_technical_college"]);

export const MODULE: GraphModule = familyModule(F, [
  {
    q: question(id("structure.sections"), "multi", `${A}.sections`, {
      options: ["jss", "sss", "technical_programmes"],
      validation: { minItems: 1 },
      dataClass: "public",
    }),
  },
  {
    q: question(OWNER, "single", "institutionProfile.ownership", {
      options: ["federal", "state", "private"],
      dataClass: "public",
    }),
    when: isTechnical,
  },
  {
    q: question(id("programmes.trades"), "multi", `${A}.trades`, {
      options: TRADE_OPTIONS,
      validation: { minItems: 1 },
      dataClass: "public",
    }),
    when: isTechnical,
  },
  { q: question(id("structure.boarding"), "bool", `${A}.boarding`, { dataClass: "public" }) },
  {
    q: question(id("exams.external_centres"), "multi", `${A}.exam_centres`, {
      options: ["waec", "neco", "nabteb", "none"],
      validation: { minItems: 1 },
      dataClass: "public",
    }),
  },
  { q: question(USE_SHERIVS, "bool", "admissions.enabledByDefault"), when: eq(OWNER, "private") },
  {
    q: question(id("intake.mode"), "single", "admissions.mode", {
      options: [
        "national_common_entrance",
        "state_common_entrance",
        "entrance_exam",
        "open_registration",
      ],
      dataClass: "public",
    }),
    when: or(not(eq(OWNER, "private")), and(eq(OWNER, "private"), eq(USE_SHERIVS, true))),
  },
  populationStep(F),
  languagesStep(F),
]);
