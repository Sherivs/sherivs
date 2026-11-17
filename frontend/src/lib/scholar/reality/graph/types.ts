/**
 * M5a (E-009) — organization reality interview: directed question graph model
 * (ADR-107). Extends the R1 registry contract (ADR-051): answer types and the
 * validation shape are the R1 ones; what is new is that the next question is
 * chosen by declarative edges instead of per-question visibility lists.
 *
 * Pure data types. No storage, no network, no React.
 */
import type { QuestionValidation } from "../question-types";
import type { AnswerType } from "../taxonomy";

/** The answer types the pre-tenant interview collects (a subset of R1's). */
export const GRAPH_ANSWER_TYPES = ["single", "multi", "number", "bool", "text"] as const;
export type GraphAnswerType = Extract<AnswerType, (typeof GRAPH_ANSWER_TYPES)[number]>;

/**
 * Who may see an answer. `public` may appear on the organization's draft
 * website; `internal` is for Sherivs reviewers and the organization's admins;
 * `personal` identifies or describes a person and is never published.
 */
export const DATA_CLASSES = ["public", "internal", "personal"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export type GraphScalar = string | number | boolean;
export type GraphAnswerValue = GraphScalar | readonly string[];
/** Answers so far, keyed by question id. Absent means unknown (never "no"). */
export type GraphAnswers = Readonly<Record<string, GraphAnswerValue>>;

/* ─────────────────────────── predicate language ─────────────────────────── */

/**
 * A small, declarative predicate over earlier answers. JSON-serialisable;
 * evaluated by `evaluatePredicate`, never by `eval` or `Function`.
 */
export type Predicate =
  | { readonly op: "always" }
  | { readonly op: "exists"; readonly q: string }
  | { readonly op: "equals"; readonly q: string; readonly value: GraphScalar }
  | { readonly op: "in"; readonly q: string; readonly values: readonly GraphScalar[] }
  | { readonly op: "gt" | "gte" | "lt" | "lte"; readonly q: string; readonly value: number }
  | { readonly op: "and"; readonly all: readonly Predicate[] }
  | { readonly op: "or"; readonly any: readonly Predicate[] }
  | { readonly op: "not"; readonly p: Predicate };

export type PredicateOp = Predicate["op"];

/* ───────────────────────────── graph structure ───────────────────────────── */

/** Reserved edge target: the interview ends here. */
export const END = "$end";

export interface GraphQuestion {
  /** `<family>.<topic>.<name>`, lower snake segments. */
  readonly id: string;
  readonly type: GraphAnswerType;
  /** i18n key; option labels use `<promptKey>.option.<code>`. */
  readonly promptKey: string;
  /** Allowed codes for single/multi; empty otherwise. */
  readonly options: readonly string[];
  readonly validation: QuestionValidation;
  readonly dataClass: DataClass;
  /** Plan path the answer is written to (checked against the known plan paths). */
  readonly writesTo: string;
}

export interface GraphEdge {
  readonly from: string;
  readonly condition: Predicate;
  /** A question id or `END`. */
  readonly to: string;
  /** Lower runs first; the first edge whose condition holds is taken. Unique per `from`. */
  readonly priority: number;
}

/** A unit of graph data that can be served on its own (the entry, or one family). */
export interface GraphModule {
  readonly moduleId: string;
  readonly questions: readonly GraphQuestion[];
  readonly edges: readonly GraphEdge[];
}

export interface QuestionGraph {
  readonly graphId: string;
  /** Semantic version of the graph data; stored with every interview session. */
  readonly version: string;
  readonly rootId: string;
  readonly questions: readonly GraphQuestion[];
  readonly edges: readonly GraphEdge[];
  /** Module ids this graph was assembled from, in assembly order. */
  readonly modules: readonly string[];
}
