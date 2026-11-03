import { describe, expect, it } from "vitest";
import { computeTermResult, type TermResultWeights } from "@/lib/scholar/result-computation";
import type { GradingModel } from "@/lib/scholar/grading";

const gradingModel: GradingModel = {
  code: "M06-PERCENT",
  name: "M06 percentage scale",
  kind: "letter",
  scale: [
    { label: "A", minPercentage: 70, maxPercentage: 100, passed: true },
    { label: "B", minPercentage: 60, maxPercentage: 69.99, passed: true },
    { label: "C", minPercentage: 50, maxPercentage: 59.99, passed: true },
    { label: "F", minPercentage: 0, maxPercentage: 49.99, passed: false },
  ],
};

const weights: TermResultWeights = {
  caWeight: 40,
  terminalWeight: 60,
  terminalMaxScore: 30,
  caComponents: [
    { code: "quiz", weight: 50, maxScore: 3 },
    { code: "project", weight: 50, maxScore: 3 },
  ],
};

describe("M06 weighted CA and terminal results", () => {
  it("weights each CA component and rounds the computed contributions and total", () => {
    const result = computeTermResult(
      weights,
      [
        { code: "quiz", score: 1 },
        { code: "project", score: 1 },
      ],
      20,
      gradingModel,
    );

    expect(result.caScore).toBe(13.33);
    expect(result.terminalScore).toBe(40);
    expect(result.totalScore).toBe(53.33);
    expect(result.grade?.label).toBe("C");
    expect(result.missingCaComponents).toEqual([]);
  });

  it("keeps a blank CA component unavailable rather than treating it as zero", () => {
    const result = computeTermResult(
      weights,
      [
        { code: "quiz", score: 3 },
        { code: "project", score: null },
      ],
      30,
      gradingModel,
    );

    expect(result.caScore).toBeNull();
    expect(result.totalScore).toBeNull();
    expect(result.grade).toBeNull();
    expect(result.missingCaComponents).toEqual(["project"]);
  });

  it("keeps a missing terminal mark unavailable while preserving a genuine zero", () => {
    const result = computeTermResult(
      weights,
      [
        { code: "quiz", score: 0 },
        { code: "project", score: 3 },
      ],
      null,
      gradingModel,
    );

    expect(result.caScore).toBe(20);
    expect(result.terminalScore).toBeNull();
    expect(result.totalScore).toBeNull();
  });

  it("rejects malformed or out-of-range weight and score configuration", () => {
    expect(() =>
      computeTermResult({ ...weights, terminalWeight: 50 }, [], null, gradingModel),
    ).toThrow("sum to 100");
    expect(() =>
      computeTermResult(
        { ...weights, caComponents: [{ code: "quiz", weight: 90, maxScore: 3 }] },
        [],
        null,
        gradingModel,
      ),
    ).toThrow("CA component weights must sum to 100");
    expect(() =>
      computeTermResult(weights, [{ code: "quiz", score: 4 }], null, gradingModel),
    ).toThrow('outside its possible range');
  });
});
