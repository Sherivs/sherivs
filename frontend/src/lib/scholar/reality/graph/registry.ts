/**
 * M5a (E-009) — lazy family registry (ADR-107). A step needs the entry module
 * plus at most one family module; families load on demand so each step can be
 * served small.
 */
import { assembleGraph } from "./assemble";
import { ENTRY_MODULE, familyForAnswers } from "./entry";
import type { Family } from "./institution-types";
import type { GraphAnswers, GraphModule, QuestionGraph } from "./types";

type Loader = () => Promise<GraphModule>;

export const FAMILY_LOADERS: Readonly<Record<Family, Loader>> = {
  private_basic: () => import("./families/private-basic").then((m) => m.MODULE),
  public_basic: () => import("./families/public-basic").then((m) => m.MODULE),
  unity_technical: () => import("./families/unity-technical").then((m) => m.MODULE),
  islamiyya: () => import("./families/islamiyya").then((m) => m.MODULE),
  university: () => import("./families/university").then((m) => m.MODULE),
  polytechnic: () => import("./families/polytechnic").then((m) => m.MODULE),
  college_of_education: () => import("./families/college-of-education").then((m) => m.MODULE),
  health_college: () => import("./families/health-college").then((m) => m.MODULE),
  agriculture_college: () => import("./families/agriculture-college").then((m) => m.MODULE),
  tvet: () => import("./families/tvet").then((m) => m.MODULE),
  multi_campus: () => import("./families/multi-campus").then((m) => m.MODULE),
  oversight: () => import("./families/oversight").then((m) => m.MODULE),
};

export const loadFamilyModule = (f: Family): Promise<GraphModule> => FAMILY_LOADERS[f]();

/** Entry plus the one family the answers select (entry alone until it is known). */
export async function loadGraphFor(answers: GraphAnswers): Promise<QuestionGraph> {
  const family = familyForAnswers(answers);
  if (!family) return assembleGraph([ENTRY_MODULE]);
  return assembleGraph([ENTRY_MODULE, await loadFamilyModule(family)]);
}
