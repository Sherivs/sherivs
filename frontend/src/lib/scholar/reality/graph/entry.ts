/**
 * M5a (E-009) — the first-question module of the organization reality
 * interview (ADR-107).
 *
 * Question 1 is the organization type. For the few types whose public/private
 * split is not in the code, the entry then asks ownership; every type except
 * the two national bodies is then asked its state. The last entry edge routes
 * into exactly one family module, named here by its first question id only.
 *
 * Size discipline: this module must stay small and must never import a family
 * module (a unit test checks its import closure). A step on the public site
 * serves this module first and then only the one family the answers select.
 */
import { familyFor, FAMILIES, NATIONAL_BODY_TYPES, type Family } from "./institution-types";
import {
  ENTRY_OWNERSHIP_OPTIONS,
  INSTITUTION_TYPE_CODES,
  NG_STATE_CODES,
  OWNERSHIP_AMBIGUOUS_TYPES,
  PUBLIC_OWNERSHIPS,
  typesInFamily,
} from "./institution-types";
import { always, and, isIn, not, or, question } from "./builders";
import { END, type GraphAnswers, type GraphEdge, type GraphModule } from "./types";

export const REALITY_GRAPH_ID = "ng.reality_interview";
/** Bump on any change to graph data (questions, options, edges, plan paths). */
export const REALITY_GRAPH_VERSION = "1.0.0";

export const ENTRY_MODULE_ID = "entry";
export const ROOT_QUESTION_ID = "entry.org.institution_type";
export const OWNERSHIP_QUESTION_ID = "entry.org.ownership";
export const STATE_QUESTION_ID = "entry.location.state";

/** First question of each family module; each family module must start here. */
export const FAMILY_ENTRY_IDS: Readonly<Record<Family, string>> = {
  private_basic: "private_basic.structure.sections",
  public_basic: "public_basic.authority.governing_body",
  unity_technical: "unity_technical.structure.sections",
  islamiyya: "islamiyya.model.kind",
  university: "university.authority.regulators",
  polytechnic: "polytechnic.authority.regulators",
  college_of_education: "college_of_education.authority.regulators",
  health_college: "health_college.programmes.offered",
  agriculture_college: "agriculture_college.programmes.offered",
  tvet: "tvet.programmes.trades",
  multi_campus: "multi_campus.layout.campus_count",
  oversight: "oversight.mandate.instrument",
};

const rootQ = question(ROOT_QUESTION_ID, "single", "institutionProfile.institution_type", {
  options: INSTITUTION_TYPE_CODES,
  dataClass: "public",
});
const ownershipQ = question(OWNERSHIP_QUESTION_ID, "single", "institutionProfile.ownership", {
  options: ENTRY_OWNERSHIP_OPTIONS,
  dataClass: "public",
});
const stateQ = question(STATE_QUESTION_ID, "single", "institutionProfile.attributes.state", {
  options: NG_STATE_CODES,
  dataClass: "public",
});

const typeIn = (codes: readonly string[]) => isIn(ROOT_QUESTION_ID, codes);
const publicOwner = isIn(OWNERSHIP_QUESTION_ID, PUBLIC_OWNERSHIPS);

function familyCondition(f: Family) {
  const fixed = typesInFamily(f);
  if (f === "public_basic")
    return or(typeIn(fixed), and(typeIn(OWNERSHIP_AMBIGUOUS_TYPES), publicOwner));
  if (f === "private_basic")
    return or(typeIn(fixed), and(typeIn(OWNERSHIP_AMBIGUOUS_TYPES), not(publicOwner)));
  return typeIn(fixed);
}

const edges: GraphEdge[] = [
  {
    from: ROOT_QUESTION_ID,
    condition: typeIn(OWNERSHIP_AMBIGUOUS_TYPES),
    to: OWNERSHIP_QUESTION_ID,
    priority: 10,
  },
  {
    from: ROOT_QUESTION_ID,
    condition: typeIn(NATIONAL_BODY_TYPES),
    to: FAMILY_ENTRY_IDS.oversight,
    priority: 20,
  },
  { from: ROOT_QUESTION_ID, condition: always, to: STATE_QUESTION_ID, priority: 30 },
  { from: OWNERSHIP_QUESTION_ID, condition: always, to: STATE_QUESTION_ID, priority: 10 },
  ...FAMILIES.map((f, i): GraphEdge => ({
    from: STATE_QUESTION_ID,
    condition: familyCondition(f),
    to: FAMILY_ENTRY_IDS[f],
    priority: (i + 1) * 10,
  })),
  { from: STATE_QUESTION_ID, condition: always, to: END, priority: (FAMILIES.length + 1) * 10 },
];

export const ENTRY_MODULE: GraphModule = {
  moduleId: ENTRY_MODULE_ID,
  questions: [rootQ, ownershipQ, stateQ],
  edges,
};

/** Which family module the answers so far route into (null until known). */
export function familyForAnswers(answers: GraphAnswers): Family | null {
  const type = answers[ROOT_QUESTION_ID];
  if (typeof type !== "string") return null;
  const ownership = answers[OWNERSHIP_QUESTION_ID];
  return familyFor(type, typeof ownership === "string" ? ownership : undefined);
}
