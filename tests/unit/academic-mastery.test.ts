/**
 * CoreGrid Scholar — Phase 11 Academic Learning Intelligence unit tests
 * (academic-mastery).
 *
 * Validates:
 * - Mastery estimation from evidence (W, X).
 * - Evidence history retention (Y) — estimation never discards evidence.
 * - Trend detection (X).
 * - Mastery explanation references real evidence (AC).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import { estimateMastery, explainMastery, type MasteryState } from "@/lib/academic-mastery";
import { createLearningEvidence, type LearningEvidence } from "@/lib/academic-core";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

function makeEvidence(overrides: Partial<LearningEvidence> = {}): LearningEvidence {
  const created = createLearningEvidence({
    tenantId: TENANT_A,
    learnerId: "learner-1",
    courseId: "course-1",
    competencyId: "comp-algebra",
    kind: "observed_fact",
    source: "quiz",
    sourceRecordId: "quiz-1",
    score: 60,
    weight: 1,
    observedAt: NOW,
    actorId: "teacher-1",
    methodology: "quiz",
    confidence: 0.8,
  });
  if (!created.ok) throw new Error("fixture failed");
  return { ...created.evidence, ...overrides };
}

describe("estimateMastery (W, X)", () => {
  it("rejects estimation without evidence", () => {
    const result = estimateMastery({
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-algebra",
      evidence: [],
      modelVersion: "v1",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("produces a bounded estimate with confidence and uncertainty", () => {
    const result = estimateMastery({
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-algebra",
      evidence: [makeEvidence({ score: 80 }), makeEvidence({ score: 60 })],
      modelVersion: "v1",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mastery.estimatedLevel).toBeGreaterThanOrEqual(0);
      expect(result.mastery.estimatedLevel).toBeLessThanOrEqual(100);
      expect(result.mastery.confidence).toBeGreaterThan(0);
      expect(result.mastery.confidence).toBeLessThanOrEqual(0.95);
      expect(result.mastery.uncertainty + result.mastery.confidence).toBeCloseTo(1, 1);
      expect(result.mastery.evidenceCount).toBe(2);
    }
  });

  it("reports insufficient_data trend with a single observation", () => {
    const result = estimateMastery({
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-algebra",
      evidence: [makeEvidence({ score: 70 })],
      modelVersion: "v1",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mastery.trend).toBe("insufficient_data");
    }
  });

  it("detects an improving trend from increasing evidence (X)", () => {
    const evidence = [
      makeEvidence({ score: 40, observedAt: "2026-01-01T00:00:00Z" }),
      makeEvidence({ score: 45, observedAt: "2026-01-02T00:00:00Z" }),
      makeEvidence({ score: 90, observedAt: "2026-01-03T00:00:00Z" }),
    ];
    const result = estimateMastery({
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-algebra",
      evidence,
      modelVersion: "v1",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mastery.trend).toBe("improving");
    }
  });

  it("retains the full evidence history rather than replacing observations (Y)", () => {
    // Estimation consumes all evidence; the input array is never mutated or
    // truncated, and evidenceCount reflects the full history.
    const evidence = [
      makeEvidence({ score: 30, observedAt: "2026-01-01T00:00:00Z" }),
      makeEvidence({ score: 90, observedAt: "2026-01-02T00:00:00Z" }),
    ];
    const result = estimateMastery({
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-algebra",
      evidence,
      modelVersion: "v1",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mastery.evidenceCount).toBe(2);
      expect(evidence).toHaveLength(2); // history untouched
    }
  });
});

describe("explainMastery (AC)", () => {
  function makeMastery(overrides: Partial<MasteryState> = {}): MasteryState {
    return {
      learnerId: "learner-1",
      tenantId: TENANT_A,
      competencyId: "comp-algebra",
      estimatedLevel: 70,
      confidence: 0.8,
      evidenceCount: 3,
      lastEvidenceAt: NOW,
      trend: "stable",
      uncertainty: 0.2,
      modelVersion: "v1",
      updatedAt: NOW,
      ...overrides,
    };
  }

  it("references the actual strongest evidence", () => {
    const evidence = [
      makeEvidence({ score: 90, source: "examination", observedAt: "2026-01-02T00:00:00Z" }),
      makeEvidence({ score: 40, source: "quiz", observedAt: "2026-01-01T00:00:00Z" }),
    ];
    const explanation = explainMastery(makeMastery(), evidence);
    expect(explanation.topEvidence[0].score).toBe(90);
    expect(explanation.topEvidence[0].source).toBe("examination");
    expect(explanation.note).toMatch(/estimate/i);
  });
});
