/**
 * M5a (E-009) — step factories shared by the tertiary family modules
 * (§8.2: ownership, regulator, faculties/schools, departments and programmes,
 * semester model, admission routes, hostels, placements, academic board).
 * Factories only; each family composes its own chain.
 */
import { question, type Step } from "../builders";
import type { Predicate } from "../types";

const A = "institutionProfile.attributes";

export const regulatorsStep = (f: string, options: readonly string[]): Step => ({
  q: question(`${f}.authority.regulators`, "multi", "institutionProfile.regulators", {
    options: [...options, "other", "not_sure"],
    validation: { minItems: 1 },
    dataClass: "public",
  }),
});

export const ownerStep = (f: string, options: readonly string[], when?: Predicate): Step => ({
  q: question(`${f}.authority.owner`, "single", "institutionProfile.ownership", {
    options,
    dataClass: "public",
  }),
  when,
});

export const unitCountStep = (f: string, unit: "faculty" | "school"): Step => ({
  q: question(`${f}.structure.${unit}_count`, "number", `${A}.${unit}_count`, {
    validation: { min: 1, max: 60 },
    dataClass: "public",
  }),
});

export const departmentCountStep = (f: string): Step => ({
  q: question(`${f}.structure.department_count`, "number", `${A}.department_count`, {
    validation: { min: 1, max: 400 },
    dataClass: "public",
  }),
});

export const programmeLevelsStep = (f: string, options: readonly string[]): Step => ({
  q: question(`${f}.programmes.levels`, "multi", "curricula", {
    options,
    validation: { minItems: 1 },
    dataClass: "public",
  }),
});

export const calendarStep = (f: string, options: readonly string[]): Step => ({
  q: question(`${f}.calendar.model`, "single", "calendarModel", { options }),
});

export const gradingScaleStep = (f: string, options: readonly string[]): Step => ({
  q: question(`${f}.assessment.scale`, "single", "gradingSystem", {
    options: [...options, "other"],
  }),
});

export const intakeRoutesStep = (f: string, options: readonly string[]): Step => ({
  q: question(`${f}.intake.routes`, "multi", `${A}.intake_routes`, {
    options,
    validation: { minItems: 1 },
    dataClass: "public",
  }),
});

export const boolStep = (f: string, local: string, attr: string, when?: Predicate): Step => ({
  q: question(`${f}.${local}`, "bool", `${A}.${attr}`),
  when,
});

export const academicBodyStep = (f: string, options: readonly string[]): Step => ({
  q: question(`${f}.governance.academic_body`, "single", `${A}.academic_governance`, { options }),
});

export const SEMESTER_MODELS = ["two_semester", "trimester", "other"] as const;
