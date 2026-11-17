/**
 * M5a (E-009) — the interview walker (ADR-107).
 *
 * A pure function of (graph, answers): start at the root, take each answered
 * question's first edge (by priority) whose condition holds over the answers
 * ON THE PATH SO FAR, and stop at the first unanswered (or invalid) question
 * or at END. Answers to questions not on the path are ignored, never errors,
 * so editing an early answer simply re-routes. Resumable: the same graph
 * version and answers always give the same result.
 *
 * Completion is answered / (answered + longest remaining path). Because the
 * longest remaining path shrinks by at least one per answered step, the
 * percentage never goes down as the interview advances.
 */
import { graphAnswerIssue } from "./answer-validation";
import { evaluatePredicate } from "./predicate";
import {
  END,
  type GraphAnswers,
  type GraphEdge,
  type GraphQuestion,
  type QuestionGraph,
} from "./types";

export type WalkError = "question_not_loaded" | "dead_end" | "path_too_long";

export interface WalkResult {
  readonly graphId: string;
  readonly graphVersion: string;
  /** Accepted answers on the path, in order. */
  readonly path: readonly string[];
  readonly nextId: string | null;
  readonly next: GraphQuestion | null;
  readonly complete: boolean;
  readonly percent: number;
  readonly remainingEstimate: number;
  /** Answered but off the path; sorted. */
  readonly ignoredAnswerIds: readonly string[];
  /** The next question's stored answer, when it failed validation. */
  readonly invalid: { readonly questionId: string; readonly code: string } | null;
  /** Answers on the path only: the input to plan generation. */
  readonly pathAnswers: GraphAnswers;
  readonly error: WalkError | null;
}

interface Index {
  readonly byId: ReadonlyMap<string, GraphQuestion>;
  readonly out: ReadonlyMap<string, readonly GraphEdge[]>;
  readonly longest: Map<string, number>;
}

const INDEX = new WeakMap<QuestionGraph, Index>();

export function graphIndex(graph: QuestionGraph): Index {
  const hit = INDEX.get(graph);
  if (hit) return hit;
  const byId = new Map(graph.questions.map((q) => [q.id, q]));
  const out = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const list = out.get(e.from) ?? [];
    list.push(e);
    out.set(e.from, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.priority - b.priority);
  const idx: Index = { byId, out, longest: new Map() };
  INDEX.set(graph, idx);
  return idx;
}

/** Questions on the longest path from `id` to END, counting `id` (targets not loaded count 1). */
export function longestRemaining(graph: QuestionGraph, id: string): number {
  const idx = graphIndex(graph);
  const visit = (n: string, guard: number): number => {
    if (n === END) return 0;
    const memo = idx.longest.get(n);
    if (memo !== undefined) return memo;
    if (!idx.byId.has(n) || guard > graph.questions.length) return 1;
    let best = 0;
    for (const e of idx.out.get(n) ?? []) best = Math.max(best, visit(e.to, guard + 1));
    idx.longest.set(n, best + 1);
    return best + 1;
  };
  return visit(id, 0);
}

export function walk(graph: QuestionGraph, answers: GraphAnswers): WalkResult {
  const idx = graphIndex(graph);
  const path: string[] = [];
  const pathAnswers: Record<string, GraphAnswers[string]> = {};
  let cur = graph.rootId;
  let invalid: WalkResult["invalid"] = null;
  let error: WalkError | null = null;
  let complete = false;

  for (let steps = 0; ; steps++) {
    if (steps > graph.questions.length) {
      error = "path_too_long";
      break;
    }
    const q = idx.byId.get(cur);
    if (!q) {
      error = "question_not_loaded";
      break;
    }
    if (!Object.prototype.hasOwnProperty.call(answers, cur)) break;
    const value = answers[cur];
    const issue = graphAnswerIssue(q, value);
    if (issue) {
      invalid = { questionId: cur, code: issue };
      break;
    }
    pathAnswers[cur] = value;
    path.push(cur);
    const edge = (idx.out.get(cur) ?? []).find((e) => evaluatePredicate(e.condition, pathAnswers));
    if (!edge) {
      error = "dead_end";
      break;
    }
    if (edge.to === END) {
      complete = true;
      break;
    }
    cur = edge.to;
  }

  const onPath = new Set(path);
  const ignoredAnswerIds = Object.keys(answers)
    .filter((k) => !onPath.has(k) && !(invalid && invalid.questionId === k))
    .sort();
  const remainingEstimate = complete ? 0 : longestRemaining(graph, cur);
  const percent = complete
    ? 100
    : Math.floor((100 * path.length) / (path.length + Math.max(remainingEstimate, 1)));
  const next = complete || error === "question_not_loaded" ? null : (idx.byId.get(cur) ?? null);
  return {
    graphId: graph.graphId,
    graphVersion: graph.version,
    path,
    nextId: complete ? null : cur,
    next,
    complete,
    percent,
    remainingEstimate,
    ignoredAnswerIds,
    invalid,
    pathAnswers,
    error,
  };
}
