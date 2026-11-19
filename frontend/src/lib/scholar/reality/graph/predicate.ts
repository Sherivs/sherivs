/**
 * M5a (E-009) — the edge predicate language and its evaluator (ADR-107).
 *
 * Operators: always, exists, equals, in, gt, gte, lt, lte, and, or, not.
 * Semantics (each pinned by tests):
 *  - An absent answer is unknown: `exists` is false and every comparison is
 *    false (so `not equals` is true). Nothing is guessed.
 *  - `equals` compares scalars strictly; on a multi answer it is true when the
 *    list contains the value.
 *  - `in` is true when a scalar answer is one of `values`, or when a multi
 *    answer shares at least one element with `values`.
 *  - Numeric comparisons are true only for a finite numeric answer.
 *  - `and` over an empty list is true, `or` over an empty list is false
 *    (validation rejects both as malformed anyway).
 * There is no eval, no property access by name beyond the answer map, and a
 * hard depth limit, so a stored predicate cannot run code or loop.
 */
import type { GraphAnswers, GraphAnswerValue, GraphScalar, Predicate } from "./types";

export const MAX_PREDICATE_DEPTH = 8;
export const MAX_PREDICATE_NODES = 64;

const COMPARISONS = new Set(["gt", "gte", "lt", "lte"]);

function answerOf(answers: GraphAnswers, q: string): GraphAnswerValue | undefined {
  return Object.prototype.hasOwnProperty.call(answers, q) ? answers[q] : undefined;
}

export function evaluatePredicate(p: Predicate, answers: GraphAnswers, depth = 0): boolean {
  if (depth > MAX_PREDICATE_DEPTH) throw new Error("predicate too deep");
  switch (p.op) {
    case "always":
      return true;
    case "exists": {
      const v = answerOf(answers, p.q);
      if (v === undefined) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "string") return v.trim().length > 0;
      return true;
    }
    case "equals": {
      const v = answerOf(answers, p.q);
      if (v === undefined) return false;
      if (Array.isArray(v)) return (v as readonly GraphScalar[]).includes(p.value);
      return v === p.value;
    }
    case "in": {
      const v = answerOf(answers, p.q);
      if (v === undefined) return false;
      if (Array.isArray(v)) return v.some((x) => p.values.includes(x));
      return p.values.includes(v as GraphScalar);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const v = answerOf(answers, p.q);
      if (typeof v !== "number" || !Number.isFinite(v)) return false;
      if (p.op === "gt") return v > p.value;
      if (p.op === "gte") return v >= p.value;
      if (p.op === "lt") return v < p.value;
      return v <= p.value;
    }
    case "and":
      return p.all.every((c) => evaluatePredicate(c, answers, depth + 1));
    case "or":
      return p.any.some((c) => evaluatePredicate(c, answers, depth + 1));
    case "not":
      return !evaluatePredicate(p.p, answers, depth + 1);
    default:
      // Unknown operator (for example from a tampered stored graph): fail closed.
      return false;
  }
}

/** Question ids a predicate reads, sorted and de-duplicated. */
export function predicateReferences(p: Predicate): string[] {
  const out = new Set<string>();
  const walk = (n: Predicate) => {
    switch (n.op) {
      case "and":
        n.all.forEach(walk);
        return;
      case "or":
        n.any.forEach(walk);
        return;
      case "not":
        walk(n.p);
        return;
      case "always":
        return;
      default:
        out.add(n.q);
    }
  };
  walk(p);
  return [...out].sort();
}

export interface PredicateIssue {
  readonly code: string;
  readonly message: string;
}

const isScalar = (v: unknown): v is GraphScalar =>
  typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

/**
 * Structural check of an untrusted predicate value (for example one read back
 * from storage): known operators only, required fields with the right types,
 * depth and size limits. Reference checks against a graph live in validate.ts.
 */
export function checkPredicateShape(raw: unknown): PredicateIssue[] {
  const issues: PredicateIssue[] = [];
  let nodes = 0;
  const bad = (code: string, message: string) => issues.push({ code, message });
  const walk = (n: unknown, depth: number) => {
    nodes += 1;
    if (nodes > MAX_PREDICATE_NODES) return bad("predicate_too_large", `> ${MAX_PREDICATE_NODES}`);
    if (depth > MAX_PREDICATE_DEPTH) return bad("predicate_too_deep", `> ${MAX_PREDICATE_DEPTH}`);
    if (!n || typeof n !== "object" || Array.isArray(n)) return bad("not_an_object", String(n));
    const o = n as Record<string, unknown>;
    const op = o.op;
    const needQ = () => {
      if (typeof o.q !== "string" || o.q.length === 0) bad("missing_q", String(op));
    };
    switch (op) {
      case "always":
        return;
      case "exists":
        return needQ();
      case "equals":
        needQ();
        if (!isScalar(o.value)) bad("bad_value", "equals needs a scalar value");
        return;
      case "in":
        needQ();
        if (!Array.isArray(o.values) || o.values.length === 0 || !o.values.every(isScalar))
          bad("bad_values", "in needs a non-empty list of scalars");
        return;
      case "and":
      case "or": {
        const list = op === "and" ? o.all : o.any;
        if (!Array.isArray(list) || list.length === 0)
          return bad("empty_combinator", `${op} needs at least one operand`);
        for (const c of list) walk(c, depth + 1);
        return;
      }
      case "not":
        return walk(o.p, depth + 1);
      default:
        if (typeof op === "string" && COMPARISONS.has(op)) {
          needQ();
          if (typeof o.value !== "number" || !Number.isFinite(o.value))
            bad("bad_value", `${op} needs a finite number`);
          return;
        }
        bad("unknown_op", String(op));
    }
  };
  walk(raw, 0);
  return issues;
}
