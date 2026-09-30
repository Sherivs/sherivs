/**
 * CoreGrid — Academic Learning Intelligence: assessment intelligence.
 *
 * The blueprint (§R–§V) asks for more than storing marks: an assessment declares what it is
 * meant to measure, a blueprint proves it measures it, and a question carries its competency,
 * difficulty and cognitive level before anyone is graded. Grading itself is governed: an
 * assessment is published once, and a high-impact grading change needs a human decision
 * (§AZ, §CA, invariant FB.21).
 *
 * Domain-neutral: no runtime is named.
 */
import type { LearningObjective } from "@/lib/academic-curriculum";

export const ASSESSMENT_TYPES = [
  "formative",
  "summative",
  "diagnostic",
  "benchmark",
  "practical",
  "project",
  "continuous",
] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

/** A cognitive framework is institutional data: the default is one common example (§V). */
export const DEFAULT_COGNITIVE_LEVELS = [
  "recall",
  "comprehension",
  "application",
  "analysis",
  "evaluation",
  "creation",
] as const;

export const COGNITIVE_FRAMEWORKS: Readonly<Record<string, readonly string[]>> = {
  "bloom-revised": DEFAULT_COGNITIVE_LEVELS,
  "recall-application": ["recall", "application"],
};

export interface AssessmentQuestion {
  id: string;
  tenantId: string;
  assessmentId: string;
  competencyId: string;
  objectiveId: string;
  /** 1 = easiest. Used to prove the blueprint's difficulty distribution. */
  difficulty: number;
  cognitiveLevel: string;
  marks: number;
  version: number;
}

export type AddQuestionResult =
  { ok: true; question: AssessmentQuestion } | { ok: false; error: string };

export function addQuestion(
  input: {
    id: string;
    tenantId: string;
    assessmentId: string;
    competencyId: string;
    objectiveId: string;
    difficulty: number;
    cognitiveLevel: string;
    marks: number;
    framework?: string;
  },
  context: { competencies: readonly { id: string }[]; objectives: readonly LearningObjective[] },
): AddQuestionResult {
  if (input.tenantId.trim() === "") return { ok: false, error: "A question requires a tenant" };
  if (input.marks <= 0) return { ok: false, error: "A question must carry positive marks" };
  if (!Number.isInteger(input.difficulty) || input.difficulty < 1 || input.difficulty > 5) {
    return { ok: false, error: "Difficulty runs from 1 to 5" };
  }
  if (!context.competencies.some((competency) => competency.id === input.competencyId)) {
    return {
      ok: false,
      error: `Question ${input.id} references unknown competency ${input.competencyId}`,
    };
  }
  const objective = context.objectives.find((entry) => entry.id === input.objectiveId);
  if (!objective) {
    return {
      ok: false,
      error: `Question ${input.id} references unknown objective ${input.objectiveId}`,
    };
  }
  if (objective.competencyId !== input.competencyId) {
    return {
      ok: false,
      error: `Question ${input.id} pairs objective ${objective.id} with the wrong competency`,
    };
  }
  const levels =
    COGNITIVE_FRAMEWORKS[input.framework ?? "bloom-revised"] ?? DEFAULT_COGNITIVE_LEVELS;
  if (!levels.includes(input.cognitiveLevel)) {
    return { ok: false, error: `Unknown cognitive level ${input.cognitiveLevel}` };
  }

  return {
    ok: true,
    question: {
      id: input.id,
      tenantId: input.tenantId,
      assessmentId: input.assessmentId,
      competencyId: input.competencyId,
      objectiveId: input.objectiveId,
      difficulty: input.difficulty,
      cognitiveLevel: input.cognitiveLevel,
      marks: input.marks,
      version: 1,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Assessment blueprint — prove the assessment measures what it claims (§T)
 * ────────────────────────────────────────────────────────────*/

export interface AssessmentBlueprint {
  id: string;
  tenantId: string;
  assessmentId: string;
  competencies: readonly string[];
  objectives: readonly string[];
  /** Declared difficulty mix, as a proportion per difficulty band (1–5). */
  difficultyDistribution: Readonly<Record<string, number>>;
  weightings: Readonly<Record<string, number>>;
  allowedQuestionTypes: readonly string[];
  totalMarks: number;
}

export interface BlueprintCoverageResult {
  ok: boolean;
  coveredCompetencies: readonly string[];
  missingCompetencies: readonly string[];
  missingObjectives: readonly string[];
  /** Observed difficulty mix, as a proportion of marks. */
  observedDistribution: Readonly<Record<string, number>>;
  marksAllocated: number;
  problems: readonly string[];
}

/**
 * Does the assessment actually measure what it says it measures? The blueprint is checked
 * against the questions that exist, never against good intentions (§T).
 */
export function evaluateBlueprintCoverage(
  blueprint: AssessmentBlueprint,
  questions: readonly AssessmentQuestion[],
): BlueprintCoverageResult {
  const relevant = questions.filter((question) => question.assessmentId === blueprint.assessmentId);
  const covered = new Set(relevant.map((question) => question.competencyId));
  const coveredObjectives = new Set(relevant.map((question) => question.objectiveId));
  const marksAllocated = relevant.reduce((total, question) => total + question.marks, 0);

  const byDifficulty: Record<string, number> = {};
  for (const question of relevant) {
    const key = String(question.difficulty);
    byDifficulty[key] = (byDifficulty[key] ?? 0) + question.marks;
  }
  const observedDistribution: Record<string, number> = {};
  for (const [key, marks] of Object.entries(byDifficulty)) {
    observedDistribution[key] = marksAllocated === 0 ? 0 : marks / marksAllocated;
  }

  const problems: string[] = [];
  const missingCompetencies = blueprint.competencies.filter((id) => !covered.has(id));
  const missingObjectives = blueprint.objectives.filter((id) => !coveredObjectives.has(id));
  if (missingCompetencies.length > 0) {
    problems.push(`No question measures: ${missingCompetencies.join(", ")}`);
  }
  if (missingObjectives.length > 0) {
    problems.push(`No question addresses objectives: ${missingObjectives.join(", ")}`);
  }
  const declared = Object.values(blueprint.difficultyDistribution).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (Object.keys(blueprint.difficultyDistribution).length > 0 && Math.abs(declared - 1) > 0.001) {
    problems.push("The declared difficulty distribution must sum to 1");
  }
  const weightingTotal = Object.values(blueprint.weightings).reduce((sum, value) => sum + value, 0);
  if (Object.keys(blueprint.weightings).length > 0 && Math.abs(weightingTotal - 1) > 0.001) {
    problems.push("Blueprint weightings must sum to 1");
  }
  if (blueprint.totalMarks !== marksAllocated) {
    problems.push(
      `Blueprint declares ${blueprint.totalMarks} marks but ${marksAllocated} are allocated`,
    );
  }

  return {
    ok: problems.length === 0,
    coveredCompetencies: [...covered],
    missingCompetencies,
    missingObjectives,
    observedDistribution,
    marksAllocated,
    problems,
  };
}
