/**
 * M5a (E-009) — structural validation of a question graph (ADR-107).
 * Checks: unique ids; root exists; every edge endpoint exists; unique edge
 * priorities per question; every question ends with an `always` edge (no
 * dead ends); no cycles; every question reachable from the root; every
 * question can reach END; predicates well-formed and reading only the
 * question itself or its ancestors; option values in predicates are real
 * options; writes_to is a known plan path; option and range sanity.
 */
import { checkPredicateShape, predicateReferences } from "./predicate";
import { DATA_CLASSES, END, GRAPH_ANSWER_TYPES, type Predicate, type QuestionGraph } from "./types";

export interface GraphIssue {
  readonly code: string;
  readonly at: string;
  readonly message: string;
}

export const GRAPH_QUESTION_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$/;

function leaves(p: Predicate, out: Predicate[] = []): Predicate[] {
  if (p.op === "and") p.all.forEach((c) => leaves(c, out));
  else if (p.op === "or") p.any.forEach((c) => leaves(c, out));
  else if (p.op === "not") leaves(p.p, out);
  else out.push(p);
  return out;
}

export function validateGraph(
  graph: QuestionGraph,
  opts: { readonly isKnownPlanPath: (path: string) => boolean },
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const add = (code: string, at: string, message = "") => issues.push({ code, at, message });
  const byId = new Map<string, (typeof graph.questions)[number]>();
  for (const q of graph.questions) {
    if (byId.has(q.id)) add("duplicate_id", q.id);
    byId.set(q.id, q);
    if (!GRAPH_QUESTION_ID.test(q.id)) add("bad_id_format", q.id);
    if (!(GRAPH_ANSWER_TYPES as readonly string[]).includes(q.type))
      add("unknown_type", q.id, q.type);
    if (!(DATA_CLASSES as readonly string[]).includes(q.dataClass)) add("unknown_data_class", q.id);
    if (!q.promptKey) add("missing_prompt_key", q.id);
    if (!opts.isKnownPlanPath(q.writesTo)) add("unknown_plan_path", q.id, q.writesTo);
    const optionType = q.type === "single" || q.type === "multi";
    if (optionType && q.options.length === 0) add("missing_options", q.id);
    if (!optionType && q.options.length > 0) add("unexpected_options", q.id);
    if (new Set(q.options).size !== q.options.length) add("duplicate_option", q.id);
    const v = q.validation;
    if (v.min !== undefined && v.max !== undefined && v.min > v.max) add("bad_range", q.id);
    if (v.minItems !== undefined && v.maxItems !== undefined && v.minItems > v.maxItems)
      add("bad_range", q.id);
  }
  if (!byId.has(graph.rootId)) add("missing_root", graph.rootId);

  const out = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const byFrom = new Map<string, (typeof graph.edges)[number][]>();
  for (const e of graph.edges) {
    if (!byId.has(e.from)) add("unknown_edge_source", e.from, `-> ${e.to}`);
    if (e.to !== END && !byId.has(e.to)) add("unknown_edge_target", e.from, e.to);
    if (e.to === e.from) add("self_edge", e.from);
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    if (e.to !== END) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
    byFrom.set(e.from, [...(byFrom.get(e.from) ?? []), e]);
  }

  for (const q of graph.questions) {
    const list = [...(byFrom.get(q.id) ?? [])].sort((a, b) => a.priority - b.priority);
    if (list.length === 0) {
      add("no_outgoing_edge", q.id);
      continue;
    }
    if (new Set(list.map((e) => e.priority)).size !== list.length) add("duplicate_priority", q.id);
    if (list[list.length - 1].condition.op !== "always") add("no_fallback_edge", q.id);
  }

  // Cycles (DFS).
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, stack: string[]) => {
    state.set(id, 1);
    for (const to of out.get(id) ?? []) {
      if (to === END || !byId.has(to)) continue;
      if (state.get(to) === 1) add("cycle", to, [...stack, id, to].join(" -> "));
      else if (!state.has(to)) visit(to, [...stack, id]);
    }
    state.set(id, 2);
  };
  for (const q of graph.questions) if (!state.has(q.id)) visit(q.id, []);

  // Reachability from root and to END.
  const reach = new Set<string>();
  const stack = [graph.rootId];
  while (stack.length) {
    const n = stack.pop()!;
    if (reach.has(n) || !byId.has(n)) continue;
    reach.add(n);
    for (const to of out.get(n) ?? []) stack.push(to);
  }
  for (const q of graph.questions) if (!reach.has(q.id)) add("unreachable", q.id);
  const reachesEnd = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const q of graph.questions) {
      if (reachesEnd.has(q.id)) continue;
      if ((out.get(q.id) ?? []).some((t) => t === END || reachesEnd.has(t))) {
        reachesEnd.add(q.id);
        changed = true;
      }
    }
  }
  for (const q of graph.questions) if (!reachesEnd.has(q.id)) add("cannot_terminate", q.id);

  // Ancestors for predicate reference checks.
  const ancestors = (id: string): Set<string> => {
    const seen = new Set<string>();
    const st = [...(incoming.get(id) ?? [])];
    while (st.length) {
      const n = st.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      st.push(...(incoming.get(n) ?? []));
    }
    return seen;
  };
  const ancestorCache = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    const shape = checkPredicateShape(e.condition);
    for (const s of shape) add(`predicate_${s.code}`, e.from, `${e.to}: ${s.message}`);
    if (shape.length) continue;
    if (!ancestorCache.has(e.from)) ancestorCache.set(e.from, ancestors(e.from));
    const anc = ancestorCache.get(e.from)!;
    for (const ref of predicateReferences(e.condition)) {
      if (!byId.has(ref)) add("predicate_unknown_question", e.from, ref);
      else if (ref !== e.from && !anc.has(ref))
        add("predicate_reads_non_ancestor", e.from, `${ref} (edge to ${e.to})`);
    }
    for (const leaf of leaves(e.condition)) {
      if (leaf.op !== "equals" && leaf.op !== "in") {
        if (["gt", "gte", "lt", "lte"].includes(leaf.op) && "q" in leaf) {
          const target = byId.get(leaf.q);
          if (target && target.type !== "number")
            add("predicate_numeric_on_non_number", e.from, leaf.q);
        }
        continue;
      }
      const target = byId.get(leaf.q);
      if (!target || target.options.length === 0) continue;
      const vals = leaf.op === "equals" ? [leaf.value] : leaf.values;
      for (const v of vals)
        if (typeof v !== "string" || !target.options.includes(v))
          add("predicate_unknown_option", e.from, `${leaf.q}=${String(v)}`);
    }
  }
  return issues;
}
