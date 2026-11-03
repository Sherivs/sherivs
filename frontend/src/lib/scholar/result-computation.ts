import { gradeForPercentage, type GradingModel, type GradeResult } from "./grading";

export interface CaComponentWeight {
  code: string;
  weight: number;
  maxScore: number;
}

export interface TermResultWeights {
  caWeight: number;
  terminalWeight: number;
  terminalMaxScore: number;
  caComponents: readonly CaComponentWeight[];
}

export interface CaComponentMark {
  code: string;
  score: number | null;
}

export interface ComputedTermResult {
  caScore: number | null;
  terminalScore: number | null;
  totalScore: number | null;
  grade: GradeResult | null;
  missingCaComponents: string[];
}

const roundToHundredth = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function computeTermResult(
  weights: TermResultWeights,
  caMarks: readonly CaComponentMark[],
  terminalMark: number | null,
  gradingModel: GradingModel,
): ComputedTermResult {
  if (
    !Number.isFinite(weights.caWeight) ||
    !Number.isFinite(weights.terminalWeight) ||
    weights.caWeight <= 0 ||
    weights.terminalWeight <= 0 ||
    roundToHundredth(weights.caWeight) !== weights.caWeight ||
    roundToHundredth(weights.terminalWeight) !== weights.terminalWeight ||
    roundToHundredth(weights.caWeight + weights.terminalWeight) !== 100
  ) {
    throw new Error("CA and terminal weights must be positive and sum to 100");
  }
  if (!Number.isFinite(weights.terminalMaxScore) || weights.terminalMaxScore <= 0) {
    throw new Error("terminal maximum score must be positive");
  }
  if (weights.caComponents.length === 0) {
    throw new Error("at least one CA component is required");
  }

  const componentCodes = new Set<string>();
  let componentWeight = 0;
  for (const component of weights.caComponents) {
    if (
      !component.code.trim() ||
      component.code !== component.code.trim() ||
      componentCodes.has(component.code)
    ) {
      throw new Error("CA component codes must be non-empty and unique");
    }
    if (
      !Number.isFinite(component.weight) ||
      component.weight <= 0 ||
      roundToHundredth(component.weight) !== component.weight ||
      !Number.isFinite(component.maxScore) ||
      component.maxScore <= 0
    ) {
      throw new Error("CA component weights and maximum scores must be positive");
    }
    componentCodes.add(component.code);
    componentWeight += component.weight;
  }
  if (roundToHundredth(componentWeight) !== 100) {
    throw new Error("CA component weights must sum to 100");
  }

  const marksByCode = new Map<string, number | null>();
  for (const mark of caMarks) {
    if (!componentCodes.has(mark.code) || marksByCode.has(mark.code)) {
      throw new Error("CA marks must contain unique configured component codes");
    }
    const component = weights.caComponents.find((item) => item.code === mark.code);
    if (
      mark.score !== null &&
      (!Number.isFinite(mark.score) || mark.score < 0 || mark.score > component!.maxScore)
    ) {
      throw new Error(`CA mark "${mark.code}" is outside its possible range`);
    }
    marksByCode.set(mark.code, mark.score);
  }

  if (
    terminalMark !== null &&
    (!Number.isFinite(terminalMark) || terminalMark < 0 || terminalMark > weights.terminalMaxScore)
  ) {
    throw new Error("terminal mark is outside its possible range");
  }

  const missingCaComponents = weights.caComponents
    .filter((component) => marksByCode.get(component.code) == null)
    .map((component) => component.code);
  const caScore =
    missingCaComponents.length === 0
      ? roundToHundredth(
          weights.caWeight *
            weights.caComponents.reduce((sum, component) => {
              const score = marksByCode.get(component.code)!;
              return sum + (score / component.maxScore) * (component.weight / 100);
            }, 0),
        )
      : null;
  const weightedTerminal =
    terminalMark === null
      ? null
      : roundToHundredth((terminalMark / weights.terminalMaxScore) * weights.terminalWeight);
  const totalScore =
    caScore === null || weightedTerminal === null
      ? null
      : roundToHundredth(caScore + weightedTerminal);

  return {
    caScore,
    terminalScore: weightedTerminal,
    totalScore,
    grade: totalScore === null ? null : gradeForPercentage(gradingModel, totalScore),
    missingCaComponents,
  };
}
