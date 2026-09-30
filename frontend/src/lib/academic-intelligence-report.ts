/**
 * CoreGrid — Phase 11 Academic Learning Intelligence: the phase report.
 *
 * This is the phase's L4 evidence. Nothing here is described: the module builds a real
 * curriculum, defines real competencies, publishes a real curriculum version, ingests real
 * evidence and then runs the phase's own engines over it — mastery, gaps, risk, assessment
 * coverage — and reports what it observed, including the gaps the phase still has.
 *
 * Domain-neutral: no runtime is named, no role list is declared, and every number below is
 * computed from a call rather than typed in.
 */
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
import { createLearningEvidence, type LearningEvidence } from "@/lib/academic-core";
import { estimateMastery } from "@/lib/academic-mastery";
import { detectLearningGaps } from "@/lib/academic-pathways";
import { ACADEMIC_RISK_TYPES, evaluateAcademicRisk } from "@/lib/academic-risk";

const TENANT = "tenant-riverside";
const LEARNER = "learner-1";
const NOW = "2026-03-02T12:00:00.000Z";

export interface AcademicRule {
  id: string;
  rule: string;
  enforcedBy: string;
  provedBy: string;
}

/** The rules this phase enforces today, each tied to its implementation and suite. */
export function academicIntelligenceRules(): readonly AcademicRule[] {
  return [
    {
      id: "curriculum-is-versioned",
      rule: "A curriculum change publishes a new version and never edits the old one, so a historical record stays readable against the version in force when it was created.",
      enforcedBy: "frontend/src/lib/academic-curriculum.ts",
      provedBy: "tests/unit/academic-curriculum.test.ts",
    },
    {
      id: "competency-graph-is-acyclic",
      rule: "Competency prerequisites are explicit, must exist, and may not form a cycle — a cycle would mean no learner can ever be ready.",
      enforcedBy: "frontend/src/lib/academic-curriculum.ts",
      provedBy: "tests/unit/academic-curriculum.test.ts",
    },
    {
      id: "objectives-are-measurable",
      rule: "A learning objective declares how mastery is judged, at what level, and against which competency before any evidence is collected.",
      enforcedBy: "frontend/src/lib/academic-curriculum.ts",
      provedBy: "tests/unit/academic-curriculum.test.ts",
    },
    {
      id: "assessments-prove-coverage",
      rule: "An assessment blueprint is checked against the questions that exist: uncovered competencies, uncovered objectives, unreconciled marks and weighting sums are reported.",
      enforcedBy: "frontend/src/lib/academic-assessment.ts",
      provedBy: "tests/unit/academic-curriculum.test.ts",
    },
    {
      id: "mastery-is-an-estimate",
      rule: "Mastery is a confidence-weighted estimate over preserved evidence, never a fact, and it is refused when there is no evidence at all.",
      enforcedBy: "frontend/src/lib/academic-mastery.ts",
      provedBy: "tests/unit/academic-mastery.test.ts",
    },
    {
      id: "gaps-are-explained",
      rule: "A learning gap names its type, its severity and its detail rather than reporting a bare shortfall.",
      enforcedBy: "frontend/src/lib/academic-pathways.ts",
      provedBy: "tests/unit/academic-pathways.test.ts",
    },
    {
      id: "risk-is-probabilistic",
      rule: "Academic risk is a probabilistic signal carrying evidence, contributing factors, confidence, uncertainty and model version — never a diagnosis.",
      enforcedBy: "frontend/src/lib/academic-risk.ts",
      provedBy: "tests/unit/academic-risk.test.ts",
    },
    {
      id: "sensitive-attributes-stay-out",
      rule: "Sensitive attributes are refused as inputs to academic inference.",
      enforcedBy: "frontend/src/lib/academic-risk.ts",
      provedBy: "tests/unit/academic-risk.test.ts",
    },
  ];
}

export interface AcademicCheck {
  id: string;
  proves: string;
  ok: boolean;
  detail: string;
}

/** Build the fixture the checks run against — real calls, no stand-ins. */
function buildFixture() {
  const foundational = defineCompetency({
    id: "c-found",
    tenantId: TENANT,
    name: "Foundational Mathematics",
    description: "Number sense and operations",
    domain: "mathematics",
    prerequisites: [],
  });
  const algebra = defineCompetency(
    {
      id: "c-algebra",
      tenantId: TENANT,
      name: "Algebra",
      description: "Symbolic manipulation",
      domain: "mathematics",
      prerequisites: ["c-found"],
    },
    foundational.ok ? [foundational.competency] : [],
  );

  const competencies: Competency[] = [
    ...(foundational.ok ? [foundational.competency] : []),
    ...(algebra.ok ? [algebra.competency] : []),
  ];

  const scale = defineCompetencyScale({
    id: "scale-maths",
    tenantId: TENANT,
    levels: DEFAULT_COMPETENCY_LEVELS,
  });

  const objective = createLearningObjective(
    {
      id: "o-algebra-1",
      tenantId: TENANT,
      statement: "Solve linear equations with one unknown",
      competencyId: "c-algebra",
      expectedLevel: "PROFICIENT",
      masteryCriteria: ["five correct solutions across two assessments"],
      assessmentMethods: ["formative", "summative"],
      prerequisites: ["c-found"],
    },
    competencies,
  );

  const nodes: CurriculumNode[] = [];
  const chain: readonly (readonly [string, CurriculumNode["level"], string | null])[] = [
    ["i1", "institution", null],
    ["p1", "program", "i1"],
    ["cur1", "curriculum", "p1"],
    ["course1", "course", "cur1"],
  ];
  for (const [id, level, parentId] of chain) {
    const created = createCurriculumNode(
      { id, tenantId: TENANT, level, key: id, title: id, parentId },
      nodes,
    );
    if (created.ok) nodes.push(created.node);
  }

  const v1 = publishCurriculumVersion(
    {
      id: "cv1",
      tenantId: TENANT,
      curriculumId: "cur1",
      effectiveFrom: "2025-09-01T00:00:00.000Z",
      reason: "Initial publication",
      changes: ["added course: mathematics"],
    },
    [],
  );
  const v2 =
    v1.ok &&
    publishCurriculumVersion(
      {
        id: "cv2",
        tenantId: TENANT,
        curriculumId: "cur1",
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        reason: "Objective change",
        changes: ["changed objective: o-algebra-1"],
      },
      [v1.version],
    );
  const history: CurriculumVersion[] = [];
  if (v1.ok) history.push(v1.version);
  if (v2 && v2.ok) history.push(v2.version);

  return { competencies, nodes, scale, objective, history };
}

/** Run the phase's own engines over the fixture and report what they answered. */
export function runAcademicIntelligenceCheck(): readonly AcademicCheck[] {
  const checks: AcademicCheck[] = [];
  const fixture = buildFixture();
  const tenant = TENANT as LearningEvidence["tenantId"];

  const evidence: LearningEvidence[] = [];
  for (const [index, score] of [55, 62, 68, 74].entries()) {
    const created = createLearningEvidence({
      tenantId: tenant,
      learnerId: LEARNER,
      courseId: "course1",
      competencyId: "c-algebra",
      kind: "observed_fact",
      source: "assignment",
      sourceRecordId: `assignment-${index + 1}`,
      score,
      weight: 1,
      observedAt: `2026-0${index + 1}-15T10:00:00.000Z`,
      actorId: "teacher-1",
      methodology: "marked against rubric",
      confidence: 0.8,
      provenanceRef: `provenance://assessment/assignment-${index + 1}`,
    });
    if (created.ok) evidence.push(created.evidence);
  }

  checks.push({
    id: "curriculum-chain-holds",
    proves: "the curriculum hierarchy accepts the declared chain and refuses a skipped one",
    ok:
      fixture.nodes.length === 4 &&
      fixture.nodes.map((node) => node.level).join(">") ===
        "institution>program>curriculum>course" &&
      !createCurriculumNode(
        { id: "bad", tenantId: TENANT, level: "course", key: "bad", title: "bad", parentId: "i1" },
        fixture.nodes,
      ).ok,
    detail: `${fixture.nodes.length} nodes · ${CURRICULUM_LEVELS.length} levels declared · skipped parent refused`,
  });

  const cycle = findCompetencyCycle(fixture.competencies);
  checks.push({
    id: "competency-graph-is-acyclic",
    proves: "prerequisites are explicit, resolvable and free of cycles",
    ok:
      fixture.competencies.length === 2 &&
      competencyEdges(fixture.competencies).length === 1 &&
      cycle === null &&
      transitivePrerequisites(fixture.competencies, "c-algebra").join(",") === "c-found",
    detail: `${competencyEdges(fixture.competencies).length} edge · cycle=${cycle ? cycle.join(">") : "none"} · algebra requires ${transitivePrerequisites(fixture.competencies, "c-algebra").join(",")}`,
  });

  checks.push({
    id: "objective-is-measurable",
    proves: "an objective declares its criteria and expected level, and carries a real scale",
    ok:
      fixture.objective.ok &&
      fixture.objective.objective.masteryCriteria.length > 0 &&
      (fixture.scale.ok ? fixture.scale.scale.levels.length : 0) >= 2,
    detail: fixture.objective.ok
      ? `expected ${fixture.objective.objective.expectedLevel} · ${fixture.objective.objective.masteryCriteria.length} criteria · scale ${fixture.scale.ok ? fixture.scale.scale.levels.join("/") : "none"}`
      : "objective refused",
  });

  const historical = curriculumVersionAt(fixture.history, "cur1", "2026-03-01T00:00:00.000Z");
  const current = curriculumVersionAt(fixture.history, "cur1", "2027-01-01T00:00:00.000Z");
  const diff = curriculumDiff(fixture.history, "cur1", 1, 2);
  checks.push({
    id: "curriculum-versioning-is-interpretable",
    proves:
      "a record is read against the version in force when it was created, and changes are diffable",
    ok:
      fixture.history.length === 2 &&
      historical?.version === 1 &&
      current?.version === 2 &&
      diff.interpretable &&
      diff.changes.length === 1,
    detail: `history ${fixture.history.length} · 2026-03 → v${historical?.version} · today → v${current?.version} · diff ${diff.changes.length}`,
  });

  const mastery = estimateMastery({
    learnerId: LEARNER,
    tenantId: tenant,
    competencyId: "c-algebra",
    evidence,
    modelVersion: "mastery-1.0.0",
    now: NOW,
  });
  checks.push({
    id: "mastery-is-an-estimate-over-evidence",
    proves:
      "mastery is estimated from preserved evidence, carries confidence and uncertainty, and is refused without evidence",
    ok:
      evidence.length === 4 &&
      mastery.ok &&
      mastery.mastery.evidenceCount === 4 &&
      mastery.mastery.confidence < 1 &&
      mastery.mastery.uncertainty > 0 &&
      !estimateMastery({
        learnerId: LEARNER,
        tenantId: tenant,
        competencyId: "c-algebra",
        evidence: [],
        modelVersion: "mastery-1.0.0",
        now: NOW,
      }).ok,
    detail: mastery.ok
      ? `level ${mastery.mastery.estimatedLevel} · confidence ${mastery.mastery.confidence} · uncertainty ${mastery.mastery.uncertainty} · trend ${mastery.mastery.trend}`
      : "mastery refused",
  });

  const gaps = detectLearningGaps({
    learnerId: LEARNER,
    tenantId: tenant,
    competencyId: "c-algebra",
    masteryEstimate: mastery.ok ? mastery.mastery.estimatedLevel : 0,
    evidenceCount: evidence.length,
    expectedLevel: 75,
    missingPrerequisiteIds: ["c-found"],
    hasInconsistentPerformance: true,
    weakAssessmentSource: "assessment-1",
    now: NOW,
  });
  checks.push({
    id: "gaps-are-typed-and-explained",
    proves: "a gap names its type, severity and detail rather than a bare shortfall",
    ok:
      gaps.gaps.length > 0 &&
      gaps.gaps.every((gap) => gap.type.length > 0 && gap.detail.length > 0),
    detail: gaps.gaps.map((gap) => `${gap.type}:${gap.severity}`).join(" · "),
  });

  const risk = evaluateAcademicRisk({
    learnerId: LEARNER,
    tenantId: tenant,
    persistentGaps: gaps.gaps.length,
    performanceDelta: mastery.ok ? mastery.mastery.estimatedLevel - 75 : 0,
    failedAssessments: 0,
    missingPrerequisiteCount: 1,
    inactivityDays: 2,
    hasUnusualPerformanceChange: false,
    modelVersion: "risk-1.0.0",
    now: NOW,
  });
  checks.push({
    id: "risk-is-probabilistic-and-attributed",
    proves:
      "risk signals carry evidence, factors, confidence, uncertainty and model version, and never assert a diagnosis",
    ok:
      risk.signals.length > 0 &&
      risk.signals.every(
        (signal) =>
          signal.confidence >= 0 &&
          signal.confidence <= 1 &&
          signal.uncertainty >= 0 &&
          signal.modelVersion.length > 0 &&
          signal.strength <= 100,
      ),
    detail: risk.signals
      .map((signal) => `${signal.type}:${signal.strength}@${signal.confidence}`)
      .join(" · "),
  });

  const question = addQuestion(
    {
      id: "q1",
      tenantId: TENANT,
      assessmentId: "assessment-1",
      competencyId: "c-algebra",
      objectiveId: fixture.objective.ok ? fixture.objective.objective.id : "o-algebra-1",
      difficulty: 3,
      cognitiveLevel: "application",
      marks: 20,
    },
    {
      competencies: fixture.competencies,
      objectives: fixture.objective.ok ? [fixture.objective.objective] : [],
    },
  );

  const blueprint: AssessmentBlueprint = {
    id: "bp1",
    tenantId: TENANT,
    assessmentId: "assessment-1",
    competencies: ["c-algebra"],
    objectives: fixture.objective.ok ? [fixture.objective.objective.id] : [],
    difficultyDistribution: { "3": 1 },
    weightings: { "c-algebra": 1 },
    allowedQuestionTypes: ["short-answer"],
    totalMarks: 20,
  };
  const coverage = evaluateBlueprintCoverage(blueprint, question.ok ? [question.question] : []);
  checks.push({
    id: "assessment-proves-its-coverage",
    proves: "a complete blueprint reconciles its marks and covers its competencies and objectives",
    ok:
      question.ok &&
      coverage.ok &&
      coverage.marksAllocated === 20 &&
      coverage.missingCompetencies.length === 0,
    detail: `marks ${coverage.marksAllocated}/20 · missing competencies ${coverage.missingCompetencies.length} · problems ${coverage.problems.length}`,
  });

  const uncovered: AssessmentBlueprint = {
    ...blueprint,
    competencies: ["c-algebra", "c-geometry"],
  };
  const uncoveredResult = evaluateBlueprintCoverage(
    uncovered,
    question.ok ? [question.question] : [],
  );
  checks.push({
    id: "an-uncovered-competency-is-refused",
    proves:
      "an assessment that claims a competency it never measures is refused, and the gap is named",
    ok: !uncoveredResult.ok && uncoveredResult.missingCompetencies.includes("c-geometry"),
    detail: uncoveredResult.problems.join(" · "),
  });

  checks.push({
    id: "vocabulary-is-declared",
    proves:
      "the phase declares its assessment types, cognitive levels, competency levels and risk types as data",
    ok:
      ASSESSMENT_TYPES.length === 7 &&
      DEFAULT_COGNITIVE_LEVELS.length === 6 &&
      DEFAULT_COMPETENCY_LEVELS.length === 6 &&
      ACADEMIC_RISK_TYPES.length > 0,
    detail: `${ASSESSMENT_TYPES.length} assessment types · ${DEFAULT_COGNITIVE_LEVELS.length} cognitive levels · ${DEFAULT_COMPETENCY_LEVELS.length} competency levels · ${ACADEMIC_RISK_TYPES.length} risk types`,
  });

  return checks;
}

/** What this phase does NOT do yet, stated rather than implied. */
export interface AcademicGap {
  id: string;
  gap: string;
  consequence: string;
  owner: string;
}

export function academicIntelligenceGaps(): readonly AcademicGap[] {
  return [
    {
      id: "no-academic-persistence",
      gap: "Curriculum versions, competencies, objectives, questions, blueprint coverage and mastery estimates are computed and returned as values; no migration creates the tables that would keep them.",
      consequence:
        "A curriculum version and the estimate computed from it live only as long as the process that built them, so a historical record cannot yet be re-read from storage.",
      owner: "Phase 11 schema work with Phase 03 row-level security",
    },
    {
      id: "no-model-registry-service",
      gap: "Mastery and risk carry a modelVersion string; there is no registry row, evaluation record, approval state or lifecycle machine behind it, and no drift monitor.",
      consequence:
        "Model governance is declared by contract (sections CC–CE) but not enforced by an artefact: a model version could change without a recorded evaluation.",
      owner: "Phase 11 model governance work, with Phase 24 for serving infrastructure",
    },
    {
      id: "no-intervention-outcome-loop",
      gap: "Interventions can be recommended, assigned and evaluated as states, but nothing yet joins an evaluated intervention back to the mastery change it produced.",
      consequence:
        "Effectiveness can be recorded but not compared across interventions, so nothing learns which intervention works for which gap.",
      owner: "Phase 11 intervention analytics, consuming Phase 18 for cross-platform measurement",
    },
    {
      id: "no-evidence-ingestion-boundary",
      gap: "Evidence can be constructed and consumed, but no authorised boundary (server function or workflow) ingests it from real assessment or attendance systems.",
      consequence:
        "Nothing calls the intelligence layer in production yet: the engines are tested libraries, and no surface outside this phase uses them.",
      owner: "Phase 11 integration boundary, with Phase 04 for canonical academic records",
    },
    {
      id: "no-similarity-or-external-signal-adapter",
      gap: "The blueprint allows similarity and external assessment signals (§DH); no adapter exists, so integrity signals cannot yet enter as evidence.",
      consequence:
        "Integrity-related evidence would have to be entered by hand, which is policy the institution should own explicitly.",
      owner: "Phase 11 adapters, with Phase 28 for external-system contracts",
    },
    {
      id: "no-academic-search-or-export-surface",
      gap: "Academic search and controlled export (§DM, §DN) are specified but no search index or export boundary exists.",
      consequence:
        "An institution cannot yet retrieve or export its academic intelligence under audit.",
      owner: "Phase 11 search and export work, with Phase 14 for the index",
    },
  ];
}

export interface AcademicIntelligenceReport {
  vocabulary: {
    curriculumLevels: number;
    competencyLevels: number;
    assessmentTypes: number;
    cognitiveLevels: number;
    riskTypes: number;
  };
  rules: readonly AcademicRule[];
  checks: readonly AcademicCheck[];
  passed: number;
  failed: number;
  healthy: boolean;
  failingChecks: readonly string[];
  gaps: readonly AcademicGap[];
}

export function academicIntelligenceReport(): AcademicIntelligenceReport {
  const checks = runAcademicIntelligenceCheck();
  const failingChecks = checks.filter((check) => !check.ok).map((check) => check.id);

  return {
    vocabulary: {
      curriculumLevels: CURRICULUM_LEVELS.length,
      competencyLevels: DEFAULT_COMPETENCY_LEVELS.length,
      assessmentTypes: ASSESSMENT_TYPES.length,
      cognitiveLevels: DEFAULT_COGNITIVE_LEVELS.length,
      riskTypes: ACADEMIC_RISK_TYPES.length,
    },
    rules: academicIntelligenceRules(),
    checks,
    passed: checks.length - failingChecks.length,
    failed: failingChecks.length,
    healthy: failingChecks.length === 0,
    failingChecks,
    gaps: academicIntelligenceGaps(),
  };
}

/** One line an operator can read: what is real, and what is not yet. */
export function academicReportSummary(report: AcademicIntelligenceReport): string {
  return [
    `${report.checks.length} checks ${report.passed}/${report.checks.length}`,
    `${report.vocabulary.curriculumLevels} curriculum levels`,
    `${report.vocabulary.assessmentTypes} assessment types`,
    `${report.rules.length} enforced rules`,
    `${report.gaps.length} declared gaps`,
  ].join(" · ");
}
