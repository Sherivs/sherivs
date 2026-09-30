/**
 * CoreGrid Scholar — Phase 11 Academic Learning Intelligence unit tests
 * (academic-pathways).
 *
 * Validates:
 * - Prerequisite engine: direct, transitive, alternative (OR-group), and
 *   exception semantics with cycle safety (AD).
 * - Learning gap detection: missing prerequisite, weak competency,
 *   incomplete objective, inconsistent performance, assessment weakness (AE).
 * - Intervention lifecycle: recommendation, review, assignment, activation,
 *   evaluation (AF, AG, AH).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createPrerequisiteEdge,
  resolvePrerequisites,
  detectLearningGaps,
  recommendIntervention,
  transitionIntervention,
  assignIntervention,
  evaluateIntervention,
  isInterventionTransitionAllowed,
  type Intervention,
  type PrerequisiteEdge,
} from "@/lib/academic-pathways";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

function edge(overrides: Partial<PrerequisiteEdge> = {}): PrerequisiteEdge {
  return {
    id: "e1",
    prerequisiteId: "comp-basic",
    dependentId: "comp-algebra",
    alternativeGroupId: null,
    isException: false,
    tenantId: TENANT_A,
    ...overrides,
  };
}

describe("createPrerequisiteEdge (AD)", () => {
  it("rejects a competency being its own prerequisite", () => {
    const result = createPrerequisiteEdge({
      id: "e1",
      prerequisiteId: "comp-a",
      dependentId: "comp-a",
      tenantId: TENANT_A,
    });
    expect(result.ok).toBe(false);
  });

  it("creates a valid prerequisite edge", () => {
    const result = createPrerequisiteEdge({
      id: "e1",
      prerequisiteId: "comp-basic",
      dependentId: "comp-algebra",
      tenantId: TENANT_A,
    });
    expect(result.ok).toBe(true);
  });
});

describe("resolvePrerequisites (AD)", () => {
  it("satisfies a direct prerequisite", () => {
    const result = resolvePrerequisites({
      competencyId: "comp-algebra",
      edges: [edge()],
      satisfiedIds: ["comp-basic"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.satisfied).toBe(true);
    }
  });

  it("reports a missing direct prerequisite", () => {
    const result = resolvePrerequisites({
      competencyId: "comp-algebra",
      edges: [edge()],
      satisfiedIds: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.satisfied).toBe(false);
      expect(result.missing).toContain("comp-basic");
    }
  });

  it("resolves transitive prerequisites", () => {
    const edges = [
      edge({ prerequisiteId: "comp-basic", dependentId: "comp-algebra" }),
      edge({ prerequisiteId: "comp-algebra", dependentId: "comp-calculus" }),
    ];
    const result = resolvePrerequisites({
      competencyId: "comp-calculus",
      edges,
      satisfiedIds: ["comp-basic"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.satisfied).toBe(true);
    }
  });

  it("satisfies an alternative (OR-group) prerequisite when any member is met", () => {
    const edges = [
      edge({
        id: "e1",
        prerequisiteId: "comp-geometry",
        dependentId: "comp-trig",
        alternativeGroupId: "alt-1",
      }),
      edge({
        id: "e2",
        prerequisiteId: "comp-prealgebra",
        dependentId: "comp-trig",
        alternativeGroupId: "alt-1",
      }),
    ];
    const result = resolvePrerequisites({
      competencyId: "comp-trig",
      edges,
      satisfiedIds: ["comp-prealgebra"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.satisfied).toBe(true);
    }
  });

  it("reports a missing alternative group when no member is met", () => {
    const edges = [
      edge({
        id: "e1",
        prerequisiteId: "comp-geometry",
        dependentId: "comp-trig",
        alternativeGroupId: "alt-1",
      }),
      edge({
        id: "e2",
        prerequisiteId: "comp-prealgebra",
        dependentId: "comp-trig",
        alternativeGroupId: "alt-1",
      }),
    ];
    const result = resolvePrerequisites({
      competencyId: "comp-trig",
      edges,
      satisfiedIds: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.satisfied).toBe(false);
    }
  });

  it("honors prerequisite exceptions (AD)", () => {
    const result = resolvePrerequisites({
      competencyId: "comp-algebra",
      edges: [edge({ isException: true })],
      satisfiedIds: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.satisfied).toBe(true);
    }
  });

  it("is cycle-safe", () => {
    const edges = [
      edge({ prerequisiteId: "comp-a", dependentId: "comp-b" }),
      edge({ prerequisiteId: "comp-b", dependentId: "comp-a" }),
    ];
    const result = resolvePrerequisites({
      competencyId: "comp-a",
      edges,
      satisfiedIds: [],
    });
    expect(result.ok).toBe(true); // no infinite loop; returns a verdict
  });
});

describe("detectLearningGaps (AE)", () => {
  it("detects a missing prerequisite as a high-severity gap", () => {
    const { gaps } = detectLearningGaps({
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-algebra",
      masteryEstimate: 80,
      evidenceCount: 3,
      expectedLevel: 70,
      missingPrerequisiteIds: ["comp-basic"],
      hasInconsistentPerformance: false,
      weakAssessmentSource: null,
      now: NOW,
    });
    expect(gaps.some((g) => g.type === "missing_prerequisite" && g.severity === "high")).toBe(true);
  });

  it("detects a weak competency when mastery is below expected", () => {
    const { gaps } = detectLearningGaps({
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-algebra",
      masteryEstimate: 40,
      evidenceCount: 3,
      expectedLevel: 70,
      missingPrerequisiteIds: [],
      hasInconsistentPerformance: false,
      weakAssessmentSource: null,
      now: NOW,
    });
    expect(gaps.some((g) => g.type === "weak_competency")).toBe(true);
  });

  it("detects an incomplete objective when no evidence exists", () => {
    const { gaps } = detectLearningGaps({
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-algebra",
      masteryEstimate: 0,
      evidenceCount: 0,
      expectedLevel: 70,
      missingPrerequisiteIds: [],
      hasInconsistentPerformance: false,
      weakAssessmentSource: null,
      now: NOW,
    });
    expect(gaps.some((g) => g.type === "incomplete_objective")).toBe(true);
  });

  it("detects inconsistent performance and assessment weakness", () => {
    const { gaps } = detectLearningGaps({
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-algebra",
      masteryEstimate: 60,
      evidenceCount: 3,
      expectedLevel: 70,
      missingPrerequisiteIds: [],
      hasInconsistentPerformance: true,
      weakAssessmentSource: "examination",
      now: NOW,
    });
    expect(gaps.some((g) => g.type === "inconsistent_performance")).toBe(true);
    expect(gaps.some((g) => g.type === "assessment_weakness")).toBe(true);
  });
});

describe("Intervention lifecycle (AF, AG, AH)", () => {
  function makeIntervention(overrides: Partial<Intervention> = {}): Intervention {
    const created = recommendIntervention({
      id: "intervention-1",
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-algebra",
      type: "remediation",
      reason: "Weak mastery below expected",
      evidenceRefs: ["evt-1"],
      now: NOW,
    });
    if (!created.ok) throw new Error("fixture failed");
    return { ...created.intervention, ...overrides };
  }

  it("rejects assessment retake without institutional permission (AF)", () => {
    const result = recommendIntervention({
      id: "i1",
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-1",
      type: "assessment_retake",
      reason: "retake",
      evidenceRefs: ["evt-1"],
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an intervention without a reason", () => {
    const result = recommendIntervention({
      id: "i1",
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-1",
      type: "tutoring",
      reason: "",
      evidenceRefs: ["evt-1"],
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("moves DETECTED -> ANALYZED -> RECOMMENDED -> REVIEWED -> ASSIGNED -> ACTIVE -> EVALUATED -> RESOLVED (AG)", () => {
    expect(isInterventionTransitionAllowed("DETECTED", "ANALYZED")).toBe(true);
    expect(isInterventionTransitionAllowed("DETECTED", "RESOLVED")).toBe(false);

    let intervention = makeIntervention();
    for (const to of ["ANALYZED", "RECOMMENDED", "REVIEWED"] as const) {
      const step = transitionIntervention(intervention, to, NOW);
      if (!step.ok) throw new Error(`transition to ${to} failed`);
      intervention = step.intervention;
    }
    const assigned = assignIntervention(intervention, "teacher-1", NOW);
    if (!assigned.ok) throw new Error("assign failed");
    intervention = assigned.intervention;
    const active = transitionIntervention(intervention, "ACTIVE", NOW);
    if (!active.ok) throw new Error("activate failed");
    intervention = active.intervention;
    const evaluated = evaluateIntervention(intervention, 40, 75, NOW);
    expect(evaluated.ok).toBe(true);
    if (evaluated.ok) {
      expect(evaluated.intervention.outcome?.improvement).toBe(true);
      intervention = evaluated.intervention;
    }
    const resolved = transitionIntervention(intervention, "RESOLVED", NOW);
    expect(resolved.ok).toBe(true);
  });

  it("requires review before assignment (AG)", () => {
    const intervention = makeIntervention({ state: "RECOMMENDED" });
    const result = assignIntervention(intervention, "teacher-1", NOW);
    expect(result.ok).toBe(false);
  });

  it("only evaluates an active intervention (AH)", () => {
    const intervention = makeIntervention({ state: "ASSIGNED" });
    const result = evaluateIntervention(intervention, 40, 50, NOW);
    expect(result.ok).toBe(false);
  });
});
