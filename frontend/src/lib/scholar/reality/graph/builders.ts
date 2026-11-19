/**
 * M5a (E-009) — small authoring helpers for graph modules (ADR-107).
 * Data construction only: every helper returns plain, serialisable objects.
 */
import type { QuestionValidation } from "../question-types";
import {
  END,
  type DataClass,
  type GraphAnswerType,
  type GraphEdge,
  type GraphModule,
  type GraphQuestion,
  type GraphScalar,
  type Predicate,
} from "./types";

export const PROMPT_KEY_PREFIX = "reality.graph";

export interface QuestionOpts {
  readonly options?: readonly string[];
  readonly validation?: QuestionValidation;
  readonly dataClass?: DataClass;
}

export function question(
  id: string,
  type: GraphAnswerType,
  writesTo: string,
  o: QuestionOpts = {},
): GraphQuestion {
  const options = o.options ?? [];
  const validation: QuestionValidation =
    type === "single" || type === "multi"
      ? { ...(o.validation ?? {}), options }
      : type === "text"
        ? { maxLength: 200, ...(o.validation ?? {}) }
        : (o.validation ?? {});
  return {
    id,
    type,
    promptKey: `${PROMPT_KEY_PREFIX}.${id}`,
    options,
    validation,
    dataClass: o.dataClass ?? "internal",
    writesTo,
  };
}

/* ───────────────────────────── predicate helpers ───────────────────────────── */

export const always: Predicate = { op: "always" };
export const exists = (q: string): Predicate => ({ op: "exists", q });
export const eq = (q: string, value: GraphScalar): Predicate => ({ op: "equals", q, value });
export const isIn = (q: string, values: readonly GraphScalar[]): Predicate => ({
  op: "in",
  q,
  values,
});
export const gt = (q: string, value: number): Predicate => ({ op: "gt", q, value });
export const gte = (q: string, value: number): Predicate => ({ op: "gte", q, value });
export const lt = (q: string, value: number): Predicate => ({ op: "lt", q, value });
export const lte = (q: string, value: number): Predicate => ({ op: "lte", q, value });
export const and = (...all: Predicate[]): Predicate => ({ op: "and", all });
export const or = (...any: Predicate[]): Predicate => ({ op: "or", any });
export const not = (p: Predicate): Predicate => ({ op: "not", p });

/* ─────────────────────────────── chain compiler ─────────────────────────────── */

export interface Step {
  readonly q: GraphQuestion;
  /** Ask this step only when the predicate holds; otherwise it is skipped. */
  readonly when?: Predicate;
}

export const PRIORITY_STEP = 10;

/** Constant-false predicate (used when a condition can never hold on a path). */
export const never: Predicate = { op: "not", p: always };

type Folded = Predicate | true | false;

/**
 * Partially evaluate `p` knowing that every id in `absent` is unanswered on
 * this path (those steps were skipped, so they were never asked). Leaves that
 * read an absent id become constant false, exactly as the evaluator would
 * treat them; combinators are simplified.
 */
export function foldAbsent(p: Predicate, absent: ReadonlySet<string>): Folded {
  switch (p.op) {
    case "always":
      return true;
    case "and": {
      const parts: Predicate[] = [];
      for (const c of p.all) {
        const f = foldAbsent(c, absent);
        if (f === false) return false;
        if (f !== true) parts.push(f);
      }
      return parts.length === 0 ? true : parts.length === 1 ? parts[0] : { op: "and", all: parts };
    }
    case "or": {
      const parts: Predicate[] = [];
      for (const c of p.any) {
        const f = foldAbsent(c, absent);
        if (f === true) return true;
        if (f !== false) parts.push(f);
      }
      return parts.length === 0 ? false : parts.length === 1 ? parts[0] : { op: "or", any: parts };
    }
    case "not": {
      const f = foldAbsent(p.p, absent);
      return f === true ? false : f === false ? true : { op: "not", p: f };
    }
    default:
      return absent.has(p.q) ? false : p;
  }
}

/**
 * Compile an ordered list of steps with skip conditions into explicit edges.
 * From step i the candidates are i+1, i+2, ... in order. When jumping from i
 * to j the steps between them were skipped, so the candidate's condition is
 * folded with those ids known to be unanswered. A candidate whose folded
 * condition is constant true gets the fallback `always` edge and ends the
 * list; one that is constant false needs no edge; otherwise it gets a guarded
 * edge. If no candidate is unconditional the fallback goes to END. Every
 * question therefore ends with an `always` edge, so no path can get stuck.
 */
export function chainEdges(steps: readonly Step[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (let i = 0; i < steps.length; i++) {
    let priority = PRIORITY_STEP;
    let closed = false;
    const skipped = new Set<string>();
    for (let j = i + 1; j < steps.length; j++) {
      const target = steps[j];
      const folded: Folded = target.when ? foldAbsent(target.when, skipped) : true;
      if (folded === true) {
        edges.push({ from: steps[i].q.id, condition: always, to: target.q.id, priority });
        closed = true;
        break;
      }
      if (folded !== false) {
        edges.push({ from: steps[i].q.id, condition: folded, to: target.q.id, priority });
        priority += PRIORITY_STEP;
      }
      skipped.add(target.q.id);
    }
    if (!closed) edges.push({ from: steps[i].q.id, condition: always, to: END, priority });
  }
  return edges;
}

/** A family module: an ordered chain whose first step is unconditional. */
export function familyModule(moduleId: string, steps: readonly Step[]): GraphModule {
  if (steps.length === 0 || steps[0].when) {
    throw new Error(`${moduleId}: the first step of a family must be unconditional`);
  }
  return {
    moduleId,
    questions: steps.map((s) => s.q),
    edges: chainEdges(steps),
  };
}

/* ─────────────────────────── shared option lists ─────────────────────────── */

/** Interface languages the organization wants (copy for ha/yo/ig is still to be supplied). */
export const LANGUAGE_OPTIONS = ["en", "ha", "yo", "ig", "ar"] as const;

/** Approximate learner population bands (no exact counts are collected). */
export const POPULATION_BANDS = [
  "under_100",
  "from_100_to_300",
  "from_300_to_1000",
  "from_1000_to_5000",
  "over_5000",
] as const;

export const languagesStep = (family: string): Step => ({
  q: question(`${family}.profile.languages`, "multi", "institutionProfile.languages", {
    options: LANGUAGE_OPTIONS,
    validation: { minItems: 1, maxItems: LANGUAGE_OPTIONS.length },
    dataClass: "public",
  }),
});

export const populationStep = (family: string, when?: Predicate): Step => ({
  q: question(
    `${family}.size.population_band`,
    "single",
    "institutionProfile.attributes.population_band",
    {
      options: POPULATION_BANDS,
    },
  ),
  when,
});

export const campusCountStep = (family: string): Step => ({
  q: question(
    `${family}.layout.campus_count`,
    "number",
    "institutionProfile.attributes.campus_count",
    {
      validation: { min: 1, max: 50 },
      dataClass: "public",
    },
  ),
});
