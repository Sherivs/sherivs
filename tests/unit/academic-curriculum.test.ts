/**
 * CoreGrid — Phase 11 Academic Learning Intelligence: curriculum, competency and assessment.
 *
 * The blueprint's distinctive claims are structural — a curriculum is versioned, a competency
 * graph is acyclic, an objective declares how mastery is judged, an assessment proves what it
 * measures — and those are the claims these tests hold. Phase-level laws under test:
 * FB.23/24 (history stays interpretable), FB.25/26 (relationships explicit), FB.21 (high-impact
 * decisions need governance).
 */
import { describe, expect, it } from "vitest";

import {
  CURRICULUM_LEVELS,
  DEFAULT_COMPETENCY_LEVELS,
  competencyEdges,
  createCurriculumNode,
  createLearningObjective,
  curriculumDiff,
  curriculumVersionAt,
  defineCompetency,
  defineCompetencyScale,
  findCompetencyCycle,
  publishCurriculumVersion,
  transitivePrerequisites,
  type Competency,
  type CurriculumNode,
  type CurriculumVersion,
} from "@/lib/academic-curriculum";
import {
  ASSESSMENT_TYPES,
  DEFAULT_COGNITIVE_LEVELS,
  addQuestion,
  evaluateBlueprintCoverage,
  type AssessmentBlueprint,
} from "@/lib/academic-assessment";

const TENANT = "tenant-1";

function competency(overrides: Partial<Competency> = {}): Competency {
  return {
    id: "c-algebra",
    tenantId: TENANT,
    name: "Algebra",
    description: "Symbolic manipulation and equation solving",
    domain: "mathematics",
    prerequisites: [],
    ...overrides,
  };
}

describe("Phase 11 — the curriculum hierarchy is a chain, not a bag", () => {
  it("refuses a node without a tenant, a key or a title", () => {
    expect(
      createCurriculumNode({ id: "n1", tenantId: " ", level: "course", key: "k", title: "t" }).ok,
    ).toBe(false);
    expect(
      createCurriculumNode({ id: "n1", tenantId: TENANT, level: "course", key: " ", title: "t" })
        .ok,
    ).toBe(false);
    expect(
      createCurriculumNode({ id: "n1", tenantId: TENANT, level: "course", key: "k", title: "" }).ok,
    ).toBe(false);
  });

  it("refuses a node whose parent is at the wrong level or missing", () => {
    const institution = createCurriculumNode({
      id: "i1",
      tenantId: TENANT,
      level: "institution",
      key: "school",
      title: "Riverside Institute",
    });
    expect(institution.ok).toBe(true);

    // A course that claims an institution as its parent skips the chain.
    const skipping = createCurriculumNode(
      {
        id: "c1",
        tenantId: TENANT,
        level: "course",
        key: "maths",
        title: "Mathematics",
        parentId: "i1",
      },
      [institution.ok ? institution.node : competencyNode("i1", "institution")],
    );
    expect(skipping.ok).toBe(false);

    // A node that must sit under a parent and declares none is refused.
    const orphan = createCurriculumNode({
      id: "c1",
      tenantId: TENANT,
      level: "course",
      key: "maths",
      title: "Mathematics",
    });
    expect(orphan.ok).toBe(false);
  });

  it("accepts the declared chain and refuses a cross-tenant parent", () => {
    const nodes: CurriculumNode[] = [
      node("i1", "institution"),
      node("p1", "program", "i1"),
      node("cur1", "curriculum", "p1"),
    ];
    const course = createCurriculumNode(
      {
        id: "c1",
        tenantId: TENANT,
        level: "course",
        key: "maths",
        title: "Mathematics",
        parentId: "cur1",
      },
      nodes,
    );
    expect(course.ok).toBe(true);

    const foreign = createCurriculumNode(
      {
        id: "c2",
        tenantId: "tenant-2",
        level: "course",
        key: "maths",
        title: "Mathematics",
        parentId: "cur1",
      },
      nodes,
    );
    expect(foreign.ok).toBe(false);
  });

  it("declares the nine levels of the hierarchy", () => {
    expect(CURRICULUM_LEVELS).toEqual([
      "institution",
      "program",
      "curriculum",
      "course",
      "module",
      "unit",
      "lesson",
      "objective",
      "competency",
    ]);
  });
});

describe("Phase 11 — competency levels are institutional data", () => {
  it("offers the blueprint's default scale without hard-coding it", () => {
    expect(DEFAULT_COMPETENCY_LEVELS).toEqual([
      "INTRODUCED",
      "DEVELOPING",
      "PRACTICING",
      "PROFICIENT",
      "ADVANCED",
      "MASTERED",
    ]);
  });

  it("accepts a custom scale and refuses a degenerate or duplicated one", () => {
    const custom = defineCompetencyScale({
      id: "s1",
      tenantId: TENANT,
      levels: ["beginning", "secure"],
    });
    expect(custom.ok && custom.scale.levels).toEqual(["BEGINNING", "SECURE"]);
    expect(defineCompetencyScale({ id: "s1", tenantId: TENANT, levels: ["only"] }).ok).toBe(false);
    expect(
      defineCompetencyScale({ id: "s1", tenantId: TENANT, levels: ["secure", "secure"] }).ok,
    ).toBe(false);
  });
});

function node(
  id: string,
  level: CurriculumNode["level"],
  parentId: string | null = null,
): CurriculumNode {
  return {
    id,
    tenantId: TENANT,
    level,
    key: id,
    title: id,
    parentId,
    competencies: [],
    version: 1,
  };
}

function competencyNode(id: string, level: CurriculumNode["level"]): CurriculumNode {
  return {
    id,
    tenantId: TENANT,
    level,
    key: id,
    title: id,
    parentId: null,
    competencies: [],
    version: 1,
  };
}

describe("Phase 11 — prerequisites are explicit and the competency graph is acyclic", () => {
  it("refuses a competency without a name or domain, and a self-prerequisite", () => {
    expect(defineCompetency(competency({ name: " " })).ok).toBe(false);
    expect(defineCompetency(competency({ domain: "" })).ok).toBe(false);
    expect(defineCompetency(competency({ prerequisites: ["c-algebra"] })).ok).toBe(false);
  });

  it("refuses a prerequisite that does not exist", () => {
    const result = defineCompetency(competency({ prerequisites: ["c-ghost"] }), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unknown prerequisite");
  });

  it("builds the blueprint's chain and derives its edges", () => {
    const foundational = competency({ id: "c-found", name: "Foundational Mathematics" });
    const algebra = competency({ id: "c-algebra", prerequisites: ["c-found"] });
    const functions = competency({ id: "c-functions", prerequisites: ["c-algebra"] });
    const calculus = competency({ id: "c-calculus", prerequisites: ["c-functions"] });

    const defined = defineCompetency(calculus, [foundational, algebra, functions]);
    expect(defined.ok).toBe(true);
    expect(competencyEdges([foundational, algebra, functions, calculus])).toEqual([
      ["c-found", "c-algebra"],
      ["c-algebra", "c-functions"],
      ["c-functions", "c-calculus"],
    ]);
    expect(findCompetencyCycle([foundational, algebra, functions, calculus])).toBeNull();
  });

  it("finds the cycle that would make readiness impossible", () => {
    const a = competency({ id: "a", prerequisites: ["c"] });
    const b = competency({ id: "b", prerequisites: ["a"] });
    const c = competency({ id: "c", prerequisites: ["b"] });
    const cycle = findCompetencyCycle([a, b, c]);
    expect(cycle).not.toBeNull();
    expect((cycle ?? []).length).toBeGreaterThan(2);
  });

  it("resolves transitive prerequisites in dependency-first order", () => {
    const foundational = competency({ id: "c-found" });
    const algebra = competency({ id: "c-algebra", prerequisites: ["c-found"] });
    const functions = competency({ id: "c-functions", prerequisites: ["c-algebra"] });
    const calculus = competency({ id: "c-calculus", prerequisites: ["c-functions"] });

    expect(
      transitivePrerequisites([foundational, algebra, functions, calculus], "c-calculus"),
    ).toEqual(["c-found", "c-algebra", "c-functions"]);
  });

  it("accepts alternative prerequisite groups and refuses an empty one", () => {
    const statistics = {
      id: "c-stats",
      tenantId: TENANT,
      name: "Statistics",
      description: "",
      domain: "mathematics",
      prerequisites: [],
    };
    const data = {
      id: "c-data",
      tenantId: TENANT,
      name: "Data",
      description: "",
      domain: "mathematics",
      prerequisites: [],
    };
    const inferential = competency({
      id: "c-inferential",
      prerequisites: [],
      alternativePrerequisites: [["c-stats", "c-data"]],
    });
    expect(defineCompetency(inferential, [statistics, data]).ok).toBe(true);
    expect(
      defineCompetency(competency({ id: "c-bad", alternativePrerequisites: [[]] }), []).ok,
    ).toBe(false);
  });
});

describe("Phase 11 — a learning objective declares how mastery is judged", () => {
  const competencies = [competency({ id: "c-algebra" })];

  it("refuses an objective that is not measurable, has no criteria, or has no expected level", () => {
    const base = {
      id: "o1",
      tenantId: TENANT,
      statement: "Solve linear equations with one unknown",
      competencyId: "c-algebra",
      expectedLevel: "PROFICIENT",
      masteryCriteria: ["five correct solutions"],
      assessmentMethods: ["quiz"],
      prerequisites: [],
    };
    expect(createLearningObjective({ ...base, statement: "learn" }, competencies).ok).toBe(false);
    expect(createLearningObjective({ ...base, masteryCriteria: [] }, competencies).ok).toBe(false);
    expect(createLearningObjective({ ...base, expectedLevel: " " }, competencies).ok).toBe(false);
  });

  it("refuses an objective bound to an unknown competency", () => {
    const result = createLearningObjective(
      {
        id: "o1",
        tenantId: TENANT,
        statement: "Solve linear equations with one unknown",
        competencyId: "c-ghost",
        expectedLevel: "PROFICIENT",
        masteryCriteria: ["five correct solutions"],
        assessmentMethods: ["quiz"],
        prerequisites: [],
      },
      competencies,
    );
    expect(result.ok).toBe(false);
  });
});

describe("Phase 11 — a curriculum history stays interpretable", () => {
  const base = {
    tenantId: TENANT,
    curriculumId: "cur-maths",
    effectiveFrom: "2025-09-01T00:00:00.000Z",
    reason: "Initial publication",
    changes: ["added course: mathematics"],
  };

  it("publishes version 1 and then supersedes it without editing it", () => {
    const v1 = publishCurriculumVersion({ id: "v1", ...base }, []);
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    expect(v1.version.version).toBe(1);
    expect(v1.version.supersedes).toBeNull();

    const v2 = publishCurriculumVersion(
      {
        id: "v2",
        ...base,
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        reason: "Objective change",
        changes: ["changed objective: o1"],
      },
      [v1.version],
    );
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;
    expect(v2.version.version).toBe(2);
    expect(v2.version.supersedes).toBe(1);
  });

  it("refuses a version without a reason or without a recorded change", () => {
    expect(publishCurriculumVersion({ id: "v1", ...base, reason: "no" }, []).ok).toBe(false);
    expect(publishCurriculumVersion({ id: "v1", ...base, changes: [] }, []).ok).toBe(false);
  });

  it("refuses a version that takes effect before the one it supersedes", () => {
    const v1 = publishCurriculumVersion({ id: "v1", ...base }, []);
    if (!v1.ok) return;
    const backwards = publishCurriculumVersion(
      {
        id: "v2",
        ...base,
        effectiveFrom: "2024-09-01T00:00:00.000Z",
        reason: "Backdated",
        changes: ["moved assessment window"],
      },
      [v1.version],
    );
    expect(backwards.ok).toBe(false);
  });

  it("reads a historical record against the version in force at its timestamp", () => {
    const v1 = publishCurriculumVersion({ id: "v1", ...base }, []);
    if (!v1.ok) return;
    const v2 = publishCurriculumVersion(
      {
        id: "v2",
        ...base,
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        reason: "Objective change",
        changes: ["changed objective: o1"],
      },
      [v1.version],
    );
    if (!v2.ok) return;
    const history: CurriculumVersion[] = [v1.version, v2.version];

    expect(curriculumVersionAt(history, "cur-maths", "2026-03-01T00:00:00.000Z")?.version).toBe(1);
    expect(curriculumVersionAt(history, "cur-maths", "2027-01-01T00:00:00.000Z")?.version).toBe(2);
  });

  it("diffs two versions, and reports a gap it cannot interpret", () => {
    const v1 = publishCurriculumVersion({ id: "v1", ...base }, []);
    if (!v1.ok) return;
    const v2 = publishCurriculumVersion(
      {
        id: "v2",
        ...base,
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        reason: "Objective change",
        changes: ["changed objective: o1"],
      },
      [v1.version],
    );
    if (!v2.ok) return;

    const diff = curriculumDiff([v1.version, v2.version], "cur-maths", 1, 2);
    expect(diff.interpretable).toBe(true);
    expect(diff.changes).toEqual(["changed objective: o1"]);
    expect(curriculumDiff([v1.version], "cur-maths", 1, 5).interpretable).toBe(false);
  });
});

describe("Phase 11 — assessment intelligence proves what it measures", () => {
  const competencies = [{ id: "c-algebra" }];
  const objectives = [
    {
      id: "o1",
      tenantId: TENANT,
      statement: "Solve linear equations with one unknown",
      competencyId: "c-algebra",
      expectedLevel: "PROFICIENT",
      masteryCriteria: ["five correct solutions"],
      assessmentMethods: ["quiz"],
      prerequisites: [],
    },
  ];

  it("declares the seven assessment types and a configurable cognitive framework", () => {
    expect(ASSESSMENT_TYPES).toContain("diagnostic");
    expect(ASSESSMENT_TYPES).toHaveLength(7);
    expect(DEFAULT_COGNITIVE_LEVELS).toContain("analysis");
  });

  it("refuses a question without marks, with an impossible difficulty, or an unknown level", () => {
    const valid = {
      id: "q1",
      tenantId: TENANT,
      assessmentId: "a1",
      competencyId: "c-algebra",
      objectiveId: "o1",
      difficulty: 3,
      cognitiveLevel: "application",
      marks: 5,
    };
    expect(addQuestion({ ...valid, marks: 0 }, { competencies, objectives }).ok).toBe(false);
    expect(addQuestion({ ...valid, difficulty: 9 }, { competencies, objectives }).ok).toBe(false);
    expect(
      addQuestion({ ...valid, cognitiveLevel: "vibes" }, { competencies, objectives }).ok,
    ).toBe(false);
    expect(addQuestion({ ...valid, objectiveId: "o-ghost" }, { competencies, objectives }).ok).toBe(
      false,
    );
  });

  it("accepts a question that names both its competency and its objective", () => {
    const added = addQuestion(
      {
        id: "q1",
        tenantId: TENANT,
        assessmentId: "a1",
        competencyId: "c-algebra",
        objectiveId: "o1",
        difficulty: 3,
        cognitiveLevel: "application",
        marks: 5,
      },
      { competencies, objectives },
    );
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.question.version).toBe(1);
  });

  it("proves coverage against the questions that exist, not the intent", () => {
    const blueprint: AssessmentBlueprint = {
      id: "bp1",
      tenantId: TENANT,
      assessmentId: "a1",
      competencies: ["c-algebra", "c-geometry"],
      objectives: ["o1"],
      difficultyDistribution: { "3": 1 },
      weightings: { "c-algebra": 1 },
      allowedQuestionTypes: ["short-answer"],
      totalMarks: 5,
    };
    const added = addQuestion(
      {
        id: "q1",
        tenantId: TENANT,
        assessmentId: "a1",
        competencyId: "c-algebra",
        objectiveId: "o1",
        difficulty: 3,
        cognitiveLevel: "application",
        marks: 5,
      },
      { competencies, objectives },
    );
    const questions = added.ok ? [added.question] : [];

    const coverage = evaluateBlueprintCoverage(blueprint, questions);
    expect(coverage.ok).toBe(false);
    expect(coverage.missingCompetencies).toEqual(["c-geometry"]);
    expect(coverage.marksAllocated).toBe(5);
    expect(coverage.observedDistribution["3"]).toBe(1);
    expect(coverage.problems.some((problem) => problem.includes("c-geometry"))).toBe(true);
  });

  it("refuses a blueprint whose marks and weightings do not add up", () => {
    const blueprint: AssessmentBlueprint = {
      id: "bp1",
      tenantId: TENANT,
      assessmentId: "a1",
      competencies: ["c-algebra"],
      objectives: ["o1"],
      difficultyDistribution: { "3": 0.5 },
      weightings: { "c-algebra": 0.8 },
      allowedQuestionTypes: [],
      totalMarks: 99,
    };
    const coverage = evaluateBlueprintCoverage(blueprint, []);
    expect(coverage.ok).toBe(false);
    expect(coverage.problems.join(" ")).toContain("marks");
    expect(coverage.problems.join(" ")).toContain("weightings");
  });
});
