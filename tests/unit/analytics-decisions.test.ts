/**
 * CoreGrid Scholar — Phase 18 Analytics & Decision Intelligence unit tests
 * (analytics-decisions).
 *
 * Validates:
 * - Scenario isolation (BC): scenario calculations never mutate
 *   production.
 * - Constraint engine (BK): violated constraints make options infeasible;
 *   unknown feasibility fails safe.
 * - Optimization guardrail (BM): policy violations block results.
 * - Recommendation contract (BN-BQ): evidence/uncertainty required;
 *   confidence bounded and never presented as certainty.
 * - Decision audit (BT) and outcome attribution (BW, FF).
 * - Uncertainty coherence (EY) and assumption expiration (FC).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  runIsolatedScenario,
  areConstraintsSatisfied,
  isOptionFeasible,
  guardOptimizationResult,
  createRecommendation,
  isEvidenceSufficient,
  createDecision,
  recordDecisionOutcome,
  isUncertaintyCoherent,
  isAssumptionExpired,
  type DecisionOption,
} from "@/lib/analytics-decisions";

const TENANT_A = tenantId("tenant-a");

function option(overrides: Partial<DecisionOption> = {}): DecisionOption {
  return {
    optionId: "opt-1",
    name: "Increase class size",
    expectedBenefit: 100,
    expectedCost: 50,
    risk: "moderate",
    feasibility: "high",
    policyCompliant: true,
    ...overrides,
  };
}

describe("Scenario isolation (BC)", () => {
  it("never mutates production state", () => {
    const result = runIsolatedScenario(
      {
        scenarioId: "s1",
        name: "enrollment +10%",
        type: "deterministic",
        tenantId: TENANT_A,
        assumptions: ["growth continues"],
        inputChanges: { enrollment: 1.1 },
      },
      (base, changes) => ({ enrollment: base.enrollment * changes.enrollment }),
      { enrollment: 1000 },
    );
    expect(result.simulatedValues.enrollment).toBe(1100);
    expect(result.productionMutated).toBe(false);
  });
});

describe("Constraint engine (BK)", () => {
  it("accepts satisfied constraints", () => {
    expect(areConstraintsSatisfied([{ name: "budget", limit: 1000, currentValue: 800 }]).ok).toBe(
      true,
    );
  });

  it("rejects violated constraints", () => {
    const result = areConstraintsSatisfied([{ name: "budget", limit: 1000, currentValue: 1200 }]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("budget");
  });

  it("treats unknown feasibility as infeasible", () => {
    expect(
      isOptionFeasible(option({ feasibility: "unknown" }), [
        { name: "budget", limit: 1000, currentValue: 800 },
      ]),
    ).toBe(false);
    expect(isOptionFeasible(option({ policyCompliant: false }), [])).toBe(false);
    expect(isOptionFeasible(option(), [{ name: "budget", limit: 1000, currentValue: 800 }])).toBe(
      true,
    );
  });
});

describe("Optimization guardrail (BM)", () => {
  it("accepts a policy-clean optimization result", () => {
    const result = guardOptimizationResult("opt-1", { cost: 50 }, []);
    expect(result.ok).toBe(true);
  });

  it("rejects an optimization that violates policy", () => {
    const result = guardOptimizationResult("opt-1", { cost: 50 }, ["student-staff ratio exceeded"]);
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toContain("policy");
  });
});

describe("Recommendation contract (BN, BQ, BR)", () => {
  it("creates a complete recommendation", () => {
    const result = createRecommendation({
      recommendationId: "r1",
      tenantId: TENANT_A,
      recommendation: "Add two support sessions per week",
      evidence: ["attendance-trend"],
      evidenceQuality: "strong",
      assumptions: ["staffing available"],
      alternatives: ["online module", "peer tutoring"],
      risks: ["schedule conflict"],
      confidence: 0.8,
      uncertainty: "attendance may vary by cohort",
      modelVersion: "model-v2",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rec.alternatives.length).toBeGreaterThan(0);
    }
  });

  it("rejects recommendations without evidence or uncertainty", () => {
    expect(
      createRecommendation({
        recommendationId: "r1",
        tenantId: TENANT_A,
        recommendation: "do something",
        evidence: [],
        evidenceQuality: "strong",
        assumptions: [],
        alternatives: [],
        risks: [],
        confidence: 0.8,
        uncertainty: "u",
        modelVersion: null,
      }).ok,
    ).toBe(false);
    expect(
      createRecommendation({
        recommendationId: "r1",
        tenantId: TENANT_A,
        recommendation: "do something",
        evidence: ["e"],
        evidenceQuality: "strong",
        assumptions: [],
        alternatives: [],
        risks: [],
        confidence: 0.8,
        uncertainty: "",
        modelVersion: null,
      }).ok,
    ).toBe(false);
  });

  it("rejects confidence outside [0, 1] — never presented as certainty (BQ)", () => {
    expect(
      createRecommendation({
        recommendationId: "r1",
        tenantId: TENANT_A,
        recommendation: "x",
        evidence: ["e"],
        evidenceQuality: "moderate",
        assumptions: [],
        alternatives: [],
        risks: [],
        confidence: 1.5,
        uncertainty: "u",
        modelVersion: null,
      }).ok,
    ).toBe(false);
  });

  it("distinguishes strong evidence from weak (BR)", () => {
    expect(isEvidenceSufficient("strong")).toBe(true);
    expect(isEvidenceSufficient("contradictory")).toBe(false);
  });
});

describe("Decision audit and outcome (BT, BW, FF)", () => {
  it("records an audited decision", () => {
    const result = createDecision({
      decisionId: "d1",
      tenantId: TENANT_A,
      actor: "principal",
      time: "2026-01-01T00:00:00Z",
      evidence: ["attendance-report"],
      options: ["opt-a", "opt-b"],
      selectedOption: "opt-a",
      rationale: "higher expected benefit",
      assumptions: ["staffing stable"],
      modelVersion: "model-v1",
      reversibility: "reversible",
      risks: ["operational"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a decision whose selected option is not among the options", () => {
    const result = createDecision({
      decisionId: "d1",
      tenantId: TENANT_A,
      actor: "principal",
      time: "2026-01-01T00:00:00Z",
      evidence: [],
      options: ["opt-a"],
      selectedOption: "opt-c",
      rationale: "x",
      assumptions: [],
      modelVersion: null,
      reversibility: "reversible",
      risks: [],
    });
    expect(result.ok).toBe(false);
  });

  it("attributes outcomes and leaves missing actuals explicit (BW, FF)", () => {
    const outcome = recordDecisionOutcome({
      decisionId: "d1",
      expectedResult: 90,
      actualResult: 85,
      lessons: ["overestimated"],
    });
    expect(outcome.variance).toBe(-5);
    const missing = recordDecisionOutcome({
      decisionId: "d2",
      expectedResult: 90,
      actualResult: null,
      lessons: [],
    });
    expect(missing.variance).toBeNull();
  });
});

describe("Uncertainty and assumptions (EY, FB, FC)", () => {
  it("rejects incoherent uncertainty intervals", () => {
    expect(
      isUncertaintyCoherent({
        pointEstimate: 100,
        lowerBound: 110,
        upperBound: 90,
        confidenceLevel: 0.9,
        distribution: "normal",
      }),
    ).toBe(false);
    expect(
      isUncertaintyCoherent({
        pointEstimate: 100,
        lowerBound: 90,
        upperBound: 110,
        confidenceLevel: 0.9,
        distribution: "normal",
      }),
    ).toBe(true);
  });

  it("expires assumptions beyond their expiry (FC)", () => {
    const assumption = {
      assumptionId: "a1",
      name: "retention",
      statement: "retention stable",
      registeredAt: "2025-01-01T00:00:00Z",
      expiresAt: "2025-06-01T00:00:00Z",
    };
    expect(isAssumptionExpired(assumption, "2025-07-01T00:00:00Z")).toBe(true);
    expect(isAssumptionExpired(assumption, "2025-03-01T00:00:00Z")).toBe(false);
  });
});
