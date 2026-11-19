/**
 * M5a (E-009, ADR-107) — reality interview graph: predicate language, graph
 * validation, walker, lazy modules and size discipline.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assembleGraph,
  checkPredicateShape,
  END,
  ENTRY_MODULE,
  evaluatePredicate,
  FAMILIES,
  FAMILY_ENTRY_IDS,
  familyModule,
  INSTITUTION_TYPE_CODES,
  loadGraphFor,
  NG_STATE_CODES,
  OWNERSHIP_AMBIGUOUS_TYPES,
  OWNERSHIP_QUESTION_ID,
  PLAN_PATHS,
  question,
  ROOT_QUESTION_ID,
  STATE_QUESTION_ID,
  validateGraph,
  walk,
  type GraphAnswers,
  type Predicate,
  type QuestionGraph,
} from "@/lib/scholar/reality/graph";
import { ALL_FAMILY_MODULES, FULL_REALITY_GRAPH } from "@/lib/scholar/reality/graph/full-graph";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GRAPH_DIR = join(ROOT, "frontend/src/lib/scholar/reality/graph");
const known = { isKnownPlanPath: PLAN_PATHS.isKnown };

describe("predicate language", () => {
  const a: GraphAnswers = { x: "a", n: 5, m: ["p", "q"], b: false, t: "  " };
  const cases: [Predicate, boolean][] = [
    [{ op: "always" }, true],
    [{ op: "exists", q: "x" }, true],
    [{ op: "exists", q: "missing" }, false],
    [{ op: "exists", q: "t" }, false],
    [{ op: "exists", q: "b" }, true],
    [{ op: "equals", q: "x", value: "a" }, true],
    [{ op: "equals", q: "b", value: false }, true],
    [{ op: "equals", q: "m", value: "q" }, true],
    [{ op: "equals", q: "missing", value: "a" }, false],
    [{ op: "in", q: "x", values: ["z", "a"] }, true],
    [{ op: "in", q: "m", values: ["z"] }, false],
    [{ op: "in", q: "m", values: ["z", "p"] }, true],
    [{ op: "gt", q: "n", value: 4 }, true],
    [{ op: "gte", q: "n", value: 5 }, true],
    [{ op: "lt", q: "n", value: 5 }, false],
    [{ op: "lte", q: "n", value: 5 }, true],
    [{ op: "gt", q: "x", value: 0 }, false],
    [{ op: "and", all: [{ op: "always" }, { op: "exists", q: "missing" }] }, false],
    [
      {
        op: "or",
        any: [
          { op: "exists", q: "missing" },
          { op: "exists", q: "x" },
        ],
      },
      true,
    ],
    [{ op: "not", p: { op: "equals", q: "missing", value: "a" } }, true],
  ];
  it.each(cases.map((c, i) => [i, ...c] as const))("case %i", (_i, p, expected) => {
    expect(evaluatePredicate(p, a)).toBe(expected);
  });

  it("fails closed on unknown operators and rejects malformed shapes", () => {
    expect(evaluatePredicate({ op: "eval", q: "x" } as unknown as Predicate, a)).toBe(false);
    expect(checkPredicateShape({ op: "eval" }).map((i) => i.code)).toContain("unknown_op");
    expect(checkPredicateShape({ op: "and", all: [] }).map((i) => i.code)).toContain(
      "empty_combinator",
    );
    expect(checkPredicateShape({ op: "gt", q: "n", value: "1" }).map((i) => i.code)).toContain(
      "bad_value",
    );
    let deep: unknown = { op: "always" };
    for (let i = 0; i < 12; i++) deep = { op: "not", p: deep };
    expect(checkPredicateShape(deep).map((i) => i.code)).toContain("predicate_too_deep");
    expect(checkPredicateShape({ op: "in", q: "x", values: ["a"] })).toEqual([]);
  });

  it("never uses eval or Function", () => {
    const src = readFileSync(join(GRAPH_DIR, "predicate.ts"), "utf8");
    expect(src).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
  });
});

describe("graph validation", () => {
  it("the full graph has no issues", () => {
    expect(validateGraph(FULL_REALITY_GRAPH, known)).toEqual([]);
  });

  it("each step graph (entry plus one family) is valid apart from edges into other families", () => {
    for (const m of ALL_FAMILY_MODULES) {
      const g = assembleGraph([ENTRY_MODULE, m]);
      const issues = validateGraph(g, known).filter(
        (i) =>
          !(
            i.code === "unknown_edge_target" && Object.values(FAMILY_ENTRY_IDS).includes(i.message)
          ),
      );
      expect(issues, m.moduleId).toEqual([]);
    }
  });

  it("question 1 is the organization type and covers every §6.1 tenant type", () => {
    expect(FULL_REALITY_GRAPH.rootId).toBe(ROOT_QUESTION_ID);
    const root = FULL_REALITY_GRAPH.questions.find((q) => q.id === ROOT_QUESTION_ID)!;
    expect(root.options).toEqual(INSTITUTION_TYPE_CODES);
    for (const c of [
      "private_secondary",
      "subeb",
      "lgea",
      "college_of_nursing_midwifery",
      "monotechnic",
      "islamiyya_sangaya",
      "innovation_enterprise_institution",
      "teaching_service_commission",
    ])
      expect(root.options).toContain(c);
  });

  it("each family module starts at its declared entry id and routes from the entry", () => {
    for (const m of ALL_FAMILY_MODULES) {
      expect(FAMILY_ENTRY_IDS[m.moduleId as (typeof FAMILIES)[number]]).toBe(m.questions[0].id);
    }
    expect(ALL_FAMILY_MODULES.map((m) => m.moduleId).sort()).toEqual([...FAMILIES].sort());
  });

  const base = (): QuestionGraph =>
    assembleGraph([
      {
        moduleId: "t",
        questions: [
          question("entry.org.institution_type", "single", "institutionProfile.institution_type", {
            options: ["a", "b"],
          }),
          question("t.x.one", "bool", "institutionProfile.attributes.one"),
        ],
        edges: [
          {
            from: "entry.org.institution_type",
            condition: { op: "always" },
            to: "t.x.one",
            priority: 10,
          },
          { from: "t.x.one", condition: { op: "always" }, to: END, priority: 10 },
        ],
      },
    ]);
  const codes = (g: QuestionGraph) => validateGraph(g, known).map((i) => i.code);

  it("detects each defect class", () => {
    expect(codes(base())).toEqual([]);
    const g = base();
    expect(codes({ ...g, questions: [...g.questions, g.questions[1]] })).toContain("duplicate_id");
    expect(
      codes({
        ...g,
        edges: [
          ...g.edges,
          { from: "t.x.one", condition: { op: "always" }, to: "t.x.nope", priority: 5 },
        ],
      }),
    ).toContain("unknown_edge_target");
    expect(
      codes({
        ...g,
        edges: [
          g.edges[0],
          {
            from: "t.x.one",
            condition: { op: "always" },
            to: "entry.org.institution_type",
            priority: 10,
          },
        ],
      }),
    ).toEqual(expect.arrayContaining(["cycle", "cannot_terminate"]));
    expect(
      codes({
        ...g,
        edges: [
          g.edges[0],
          { from: "t.x.one", condition: { op: "exists", q: "t.x.one" }, to: END, priority: 10 },
        ],
      }),
    ).toContain("no_fallback_edge");
    expect(
      codes({
        ...g,
        questions: [
          ...g.questions,
          question("t.x.orphan", "bool", "institutionProfile.attributes.o"),
        ],
        edges: [
          ...g.edges,
          { from: "t.x.orphan", condition: { op: "always" }, to: END, priority: 10 },
        ],
      }),
    ).toContain("unreachable");
    expect(
      codes({ ...g, questions: [g.questions[0], question("t.x.one", "bool", "nowhere.path")] }),
    ).toContain("unknown_plan_path");
    expect(
      codes({
        ...g,
        edges: [
          { ...g.edges[0], condition: { op: "equals", q: "t.x.one", value: true } },
          { ...g.edges[0], priority: 20 },
          g.edges[1],
        ],
      }),
    ).toContain("predicate_reads_non_ancestor");
    expect(
      codes({
        ...g,
        edges: [
          {
            ...g.edges[0],
            condition: { op: "equals", q: "entry.org.institution_type", value: "zzz" },
          },
          { ...g.edges[0], priority: 20 },
          g.edges[1],
        ],
      }),
    ).toContain("predicate_unknown_option");
    expect(codes({ ...g, edges: [...g.edges, { ...g.edges[1] }] })).toContain("duplicate_priority");
  });

  it("chain steps cannot start conditionally", () => {
    expect(() =>
      familyModule("x", [{ q: question("x.a.b", "bool", "curricula"), when: { op: "always" } }]),
    ).toThrow();
  });
});

describe("walker", () => {
  const g = FULL_REALITY_GRAPH;

  it("starts at question 1 with 0%", () => {
    const r = walk(g, {});
    expect(r.nextId).toBe(ROOT_QUESTION_ID);
    expect(r.percent).toBe(0);
    expect(r.complete).toBe(false);
  });

  it("asks ownership only for ambiguous types, and skips the state for national bodies", () => {
    expect(walk(g, { [ROOT_QUESTION_ID]: "nursery_ecce" }).nextId).toBe(OWNERSHIP_QUESTION_ID);
    expect(walk(g, { [ROOT_QUESTION_ID]: "private_primary" }).nextId).toBe(STATE_QUESTION_ID);
    expect(walk(g, { [ROOT_QUESTION_ID]: "ubec" }).nextId).toBe(FAMILY_ENTRY_IDS.oversight);
    expect(
      walk(g, {
        [ROOT_QUESTION_ID]: "nursery_ecce",
        [OWNERSHIP_QUESTION_ID]: "state",
        [STATE_QUESTION_ID]: "kano",
      }).nextId,
    ).toBe(FAMILY_ENTRY_IDS.public_basic);
    expect(
      walk(g, {
        [ROOT_QUESTION_ID]: "nursery_ecce",
        [OWNERSHIP_QUESTION_ID]: "private",
        [STATE_QUESTION_ID]: "kano",
      }).nextId,
    ).toBe(FAMILY_ENTRY_IDS.private_basic);
  });

  it("every type routes to a family and every family can be walked to completion", () => {
    for (const type of INSTITUTION_TYPE_CODES) {
      const answers: Record<string, GraphAnswers[string]> = {};
      let last = -1;
      for (let i = 0; i < 60; i++) {
        const r = walk(g, answers);
        expect(r.error).toBeNull();
        expect(r.percent).toBeGreaterThanOrEqual(last);
        last = r.percent;
        if (r.complete) break;
        const q = r.next!;
        answers[q.id] =
          q.id === OWNERSHIP_QUESTION_ID
            ? "state"
            : q.id === ROOT_QUESTION_ID
              ? type
              : q.type === "single"
                ? q.options[0]
                : q.type === "multi"
                  ? [q.options[0]]
                  : q.type === "bool"
                    ? true
                    : q.type === "number"
                      ? (q.validation.min ?? 1) + 1
                      : "Reference text";
      }
      const r = walk(g, answers);
      expect(r.complete, type).toBe(true);
      expect(r.percent).toBe(100);
      expect(r.path[0]).toBe(ROOT_QUESTION_ID);
      if (!OWNERSHIP_AMBIGUOUS_TYPES.includes(type))
        expect(r.path).not.toContain(OWNERSHIP_QUESTION_ID);
    }
  });

  it("ignores answers to questions that are no longer on the path", () => {
    const answers = {
      [ROOT_QUESTION_ID]: "polytechnic_federal",
      [STATE_QUESTION_ID]: "oyo",
      "private_basic.structure.sections": ["primary"],
      "polytechnic.specialisation.field": "survey",
    };
    const r = walk(g, answers);
    expect(r.error).toBeNull();
    expect(r.ignoredAnswerIds).toEqual([
      "polytechnic.specialisation.field",
      "private_basic.structure.sections",
    ]);
    expect(Object.keys(r.pathAnswers).sort()).toEqual([ROOT_QUESTION_ID, STATE_QUESTION_ID].sort());
    expect(r.nextId).toBe("polytechnic.authority.regulators");
  });

  it("stops at an invalid stored answer and reports it", () => {
    const r = walk(g, { [ROOT_QUESTION_ID]: "private_primary", [STATE_QUESTION_ID]: "atlantis" });
    expect(r.nextId).toBe(STATE_QUESTION_ID);
    expect(r.invalid).toEqual({ questionId: STATE_QUESTION_ID, code: "invalid_option" });
    expect(NG_STATE_CODES).toHaveLength(37);
  });

  it("is deterministic and carries the graph version", () => {
    const answers = { [ROOT_QUESTION_ID]: "subeb", [STATE_QUESTION_ID]: "kaduna" };
    expect(walk(g, answers)).toEqual(walk(g, { ...answers }));
    expect(walk(g, answers).graphVersion).toBe(g.version);
  });

  it("lazy step graphs walk exactly like the full graph", async () => {
    const answers = {
      [ROOT_QUESTION_ID]: "college_of_nursing_midwifery",
      [STATE_QUESTION_ID]: "enugu",
      "health_college.programmes.offered": ["nursing"],
    };
    const lazy = await loadGraphFor(answers);
    expect(lazy.modules).toEqual(["entry", "health_college"]);
    const a = walk(lazy, answers);
    const b = walk(g, answers);
    expect(a.nextId).toBe(b.nextId);
    expect(a.path).toEqual(b.path);
    expect((await loadGraphFor({})).modules).toEqual(["entry"]);
  });
});

describe("size discipline", () => {
  /** Transitive local import closure of a source file. */
  function closure(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) return seen;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)[^"']*from\s+["']([^"']+)["']/gm)) {
      const spec = m[1];
      let target: string | null = null;
      if (spec.startsWith(".")) target = resolve(dirname(file), spec);
      else if (spec.startsWith("@/")) target = join(ROOT, "frontend/src", spec.slice(2));
      if (!target) continue;
      for (const cand of [`${target}.ts`, join(target, "index.ts")]) {
        try {
          readFileSync(cand);
          closure(cand, seen);
          break;
        } catch {
          /* try next */
        }
      }
    }
    return seen;
  }

  it("the first-question module does not import any family module", () => {
    const files = [...closure(join(GRAPH_DIR, "entry.ts"))];
    expect(files.some((f) => f.includes(`${join("graph", "families")}`))).toBe(false);
    expect(files.some((f) => f.endsWith("full-graph.ts") || f.endsWith("registry.ts"))).toBe(false);
  });

  it("no family module imports another family module", () => {
    for (const m of ALL_FAMILY_MODULES) {
      const file = join(GRAPH_DIR, "families", `${m.moduleId.replace(/_/g, "-")}.ts`);
      const others = [...closure(file)].filter(
        (f) =>
          f.includes(join("graph", "families")) &&
          f !== file &&
          !/(options|tertiary-shared)\.ts$/.test(f),
      );
      expect(others, m.moduleId).toEqual([]);
    }
  });

  it("serialised step data stays small", () => {
    expect(JSON.stringify(ENTRY_MODULE).length).toBeLessThan(12_000);
    for (const m of ALL_FAMILY_MODULES)
      expect(JSON.stringify(m).length, m.moduleId).toBeLessThan(20_000);
  });
});
