import { describe, expect, it } from "vitest";

import {
  computeWorkforcePerformance,
  type MissionTransitionObservation,
} from "../../../frontend/src/lib/workforce/performance-metrics";
import type {
  MissionContractCore,
  MissionEvidenceRecord,
  MissionLifecycleState,
} from "../../../frontend/src/lib/mission/mission-contract";
import type { UsageRecord } from "../../../frontend/src/lib/metering/usage-ledger";

const TENANT = "tenant-a";
const NOW = "2026-10-07T04:00:00.000Z";

let seq = 0;
function makeMission(overrides: Partial<MissionContractCore> = {}): MissionContractCore {
  seq += 1;
  return {
    missionId: `m-${seq}`,
    schemaVersion: "1.0",
    tenantId: TENANT,
    objective: "deliver the declared outcome",
    nonScope: [],
    ownerRef: "owner-1",
    actorRefs: ["worker-1"],
    authorizedActions: ["observe"],
    tasks: [
      {
        taskId: `t-${seq}`,
        title: "task",
        authorizedActions: ["observe"],
        requiredEvidenceKinds: ["test_report"],
      },
    ],
    admissionGates: [{ gateId: `g-${seq}`, kind: "definition", reason: "definition gate" }],
    successCriteria: ["outcome verified"],
    requiredEvidenceKinds: ["test_report"],
    lifecycle: "RUNNING",
    expiresAt: null,
    provenance: {
      declaredBy: "jarvis",
      declaredAt: "2026-10-06T00:00:00.000Z",
      authorityRef: "DECISIONS.md#206",
      contextRef: null,
      sourceRef: null,
      generatedByAi: true,
      verified: false,
    },
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<MissionEvidenceRecord> = {}): MissionEvidenceRecord {
  seq += 1;
  return {
    evidenceId: `e-${seq}`,
    missionId: "m-1",
    taskId: null,
    evidenceKind: "test_report",
    producer: "verification-agent",
    actorId: "worker-1",
    tenantId: TENANT,
    recordedAt: "2026-10-06T01:00:00.000Z",
    provenance: "unit test fixture",
    integrity: "sha256:fixture",
    lifecycle: "active",
    ...overrides,
  };
}

function makeTransition(overrides: Partial<MissionTransitionObservation> = {}): MissionTransitionObservation {
  seq += 1;
  return {
    missionId: "m-1",
    actorId: "worker-1",
    from: "RUNNING",
    to: "SUCCEEDED",
    at: "2026-10-06T02:00:00.000Z",
    ...overrides,
  };
}

function makeUsage(overrides: Partial<UsageRecord> = {}): UsageRecord {
  seq += 1;
  return {
    tenantRef: TENANT,
    actorRef: "worker-1",
    agentRef: "sdk_engineer",
    missionRef: "m-1",
    model: "coregrid-test-model",
    provider: "ai-gateway",
    purpose: "summarization",
    tokensIn: 100,
    tokensOut: 50,
    durationMs: 1200,
    estimatedCostUsd: 0.0003,
    at: "2026-10-06T02:00:00.000Z",
    ...overrides,
  };
}

describe("workforce performance metrics (directive §40)", () => {
  it("computes a completion rate of 1.0 when every resolved mission completed", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [
        makeMission({ lifecycle: "SUCCEEDED" }),
        makeMission({ lifecycle: "ARCHIVED" }),
      ],
      evidence: [],
      transitions: [],
    });
    expect(report.metrics.missionCompletionRate).toEqual({
      status: "computed",
      value: 1,
      claimClass: "observed",
      reason: null,
      sample: 2,
    });
  });

  it("computes fractional completion and failure rates over resolved outcomes", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [
        makeMission({ lifecycle: "SUCCEEDED" }),
        makeMission({ lifecycle: "FAILED" }),
        makeMission({ lifecycle: "CANCELLED" }),
        makeMission({ lifecycle: "TIMED_OUT" }),
      ],
      evidence: [],
      transitions: [],
    });
    expect(report.metrics.missionCompletionRate.value).toBeCloseTo(0.25, 10);
    expect(report.metrics.missionFailureRate.value).toBeCloseTo(0.5, 10);
    expect(report.metrics.missionFailureRate.sample).toBe(4);
  });

  it("returns completion rate as not_observable with no resolved missions (never divides by zero)", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission({ lifecycle: "RUNNING" })],
      evidence: [],
      transitions: [],
    });
    expect(report.metrics.missionCompletionRate.status).toBe("not_observable");
    expect(report.metrics.missionCompletionRate.value).toBeNull();
    expect(report.metrics.missionCompletionRate.reason).toMatch(/no resolved missions/);
  });

  it("computes verification pass rate from usable-evidence coverage only", () => {
    const covered = makeMission({ missionId: "m-covered" });
    const uncovered = makeMission({ missionId: "m-uncovered", requiredEvidenceKinds: ["deploy_proof"] });
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [covered, uncovered],
      evidence: [makeEvidence({ missionId: "m-covered", evidenceKind: "test_report" })],
      transitions: [],
    });
    expect(report.metrics.verificationPassRate.value).toBeCloseTo(0.5, 10);
    expect(report.metrics.verificationPassRate.claimClass).toBe("observed");
  });

  it("does not count superseded evidence as verification coverage", () => {
    const mission = makeMission({ missionId: "m-1" });
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [mission],
      evidence: [makeEvidence({ missionId: "m-1", lifecycle: "superseded" })],
      transitions: [],
    });
    expect(report.metrics.verificationPassRate.value).toBe(0);
  });

  it("computes rework rate over recorded transitions", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission({ missionId: "m-1" })],
      evidence: [],
      transitions: [
        makeTransition({ to: "RETRYING" }),
        makeTransition({ to: "COMPENSATING" }),
        makeTransition({ from: "RETRYING", to: "SUCCEEDED" }),
      ],
    });
    expect(report.metrics.reworkRate.value).toBeCloseTo(2 / 3, 10);
    expect(report.metrics.reworkRate.sample).toBe(3);
  });

  it("returns rework rate as not_observable without recorded transitions", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission()],
      evidence: [],
      transitions: [],
    });
    expect(report.metrics.reworkRate.status).toBe("not_observable");
    expect(report.metrics.reworkRate.reason).toMatch(/no recorded lifecycle transitions/);
  });

  it("computes rollback rate over distinct resolved missions", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [
        makeMission({ missionId: "m-1", lifecycle: "COMPENSATED" }),
        makeMission({ missionId: "m-2", lifecycle: "SUCCEEDED" }),
      ],
      evidence: [],
      transitions: [
        makeTransition({ missionId: "m-1", to: "COMPENSATING" }),
        makeTransition({ missionId: "m-1", from: "COMPENSATING", to: "COMPENSATED" }),
      ],
    });
    expect(report.metrics.rollbackRate.value).toBeCloseTo(0.5, 10);
  });

  it("computes mean time to completion from completion transitions minus declared-at", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission({ missionId: "m-1", lifecycle: "SUCCEEDED" })],
      evidence: [],
      transitions: [makeTransition({ missionId: "m-1", at: "2026-10-06T03:00:00.000Z" })],
    });
    expect(report.metrics.meanTimeToCompletionMs.status).toBe("computed");
    expect(report.metrics.meanTimeToCompletionMs.value).toBe(3 * 3600 * 1000);
  });

  it("ignores completion transitions recorded before the mission was declared", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission({ missionId: "m-1" })],
      evidence: [],
      transitions: [makeTransition({ missionId: "m-1", at: "2026-10-05T00:00:00.000Z" })],
    });
    expect(report.metrics.meanTimeToCompletionMs.status).toBe("not_observable");
  });

  it("computes mean time to recovery across FAILED→completed sequences", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission({ missionId: "m-1" })],
      evidence: [],
      transitions: [
        makeTransition({ missionId: "m-1", from: "RUNNING", to: "FAILED", at: "2026-10-06T02:00:00.000Z" }),
        makeTransition({ missionId: "m-1", from: "FAILED", to: "RETRYING", at: "2026-10-06T02:30:00.000Z" }),
        makeTransition({ missionId: "m-1", from: "RETRYING", to: "SUCCEEDED", at: "2026-10-06T03:00:00.000Z" }),
      ],
    });
    expect(report.metrics.meanTimeToRecoveryMs.status).toBe("computed");
    expect(report.metrics.meanTimeToRecoveryMs.value).toBe(3600 * 1000);
  });

  it("declares token usage, cost, tool errors, and security violations not observable (§65)", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission({ lifecycle: "SUCCEEDED" })],
      evidence: [],
      transitions: [],
    });
    for (const key of ["tokenUsage", "computeCost", "toolErrors", "securityViolations"] as const) {
      const metric = report.metrics[key];
      expect(metric.status).toBe("not_observable");
      expect(metric.value).toBeNull();
      expect(metric.reason).toMatch(/§65/);
    }
  });

  it("computes token usage from supplied metering records only (no records → not observable)", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission({ missionId: "m-1" })],
      evidence: [],
      transitions: [],
      usage: [makeUsage(), makeUsage({ tokensIn: 40, tokensOut: 10 })],
    });
    const metric = report.metrics.tokenUsage;
    expect(metric.status).toBe("computed");
    expect(metric.claimClass).toBe("observed");
    expect(metric.value).toBe(100 + 50 + 40 + 10);
    expect(metric.sample).toBe(2);
  });

  it("sums only non-null cost estimates and rounds to micro-dollar precision", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission({ missionId: "m-1" })],
      evidence: [],
      transitions: [],
      usage: [
        makeUsage({ estimatedCostUsd: 0.0001 }),
        makeUsage({ estimatedCostUsd: 0.0002 }),
        makeUsage({ estimatedCostUsd: null }),
      ],
    });
    const metric = report.metrics.computeCost;
    expect(metric.status).toBe("computed");
    expect(metric.value).toBeCloseTo(0.0003, 9);
    expect(metric.sample).toBe(2);
  });

  it("never guesses a cost when no usage record carries a rate entry (Part 9)", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission({ missionId: "m-1" })],
      evidence: [],
      transitions: [],
      usage: [makeUsage({ estimatedCostUsd: null }), makeUsage({ estimatedCostUsd: null })],
    });
    expect(report.metrics.computeCost.status).toBe("not_observable");
    expect(report.metrics.computeCost.value).toBeNull();
    expect(report.metrics.computeCost.reason).toMatch(/never guessed/);
    expect(report.metrics.tokenUsage.status).toBe("computed");
  });

  it("excludes and counts cross-tenant usage records without mixing them", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission({ missionId: "m-1" })],
      evidence: [],
      transitions: [],
      usage: [makeUsage(), makeUsage({ tenantRef: "tenant-b", tokensIn: 9999 })],
    });
    expect(report.excludedCrossTenant.usage).toBe(1);
    expect(report.metrics.tokenUsage.value).toBe(150);
  });

  it("fails closed on a usage record that is not attribution-complete", () => {
    expect(() =>
      computeWorkforcePerformance({
        tenantId: TENANT,
        now: NOW,
        missions: [makeMission({ missionId: "m-1" })],
        evidence: [],
        transitions: [],
        usage: [makeUsage({ actorRef: "  " })],
      }),
    ).toThrow(/usage record: actorRef is required/);
  });

  it("computes the quality score as an inferred composite of observables only", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [
        makeMission({ missionId: "m-1", lifecycle: "SUCCEEDED" }),
        makeMission({ missionId: "m-2", lifecycle: "SUCCEEDED" }),
      ],
      evidence: [
        makeEvidence({ missionId: "m-1", evidenceKind: "test_report" }),
        makeEvidence({ missionId: "m-2", evidenceKind: "test_report" }),
      ],
      transitions: [
        makeTransition({ missionId: "m-1", to: "SUCCEEDED" }),
        makeTransition({ missionId: "m-2", to: "SUCCEEDED" }),
      ],
    });
    const score = report.metrics.qualityScore;
    expect(score.status).toBe("computed");
    expect(score.claimClass).toBe("inferred");
    // completion 1.0, verification 1.0, rework 0, rollback 0 → 1.0
    expect(score.value).toBe(1);
  });

  it("returns the quality score as not_observable when a component is not observable", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission({ lifecycle: "SUCCEEDED" })],
      evidence: [makeEvidence({ missionId: "m-1" })],
      transitions: [],
    });
    expect(report.metrics.qualityScore.status).toBe("not_observable");
    expect(report.metrics.qualityScore.reason).toMatch(/completion, verification, rework, and rollback/);
  });

  it("excludes and counts cross-tenant records without ever mixing them", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [
        makeMission({ missionId: "m-1", lifecycle: "SUCCEEDED" }),
        makeMission({ missionId: "m-b", tenantId: "tenant-b", lifecycle: "SUCCEEDED" }),
      ],
      evidence: [
        makeEvidence({ missionId: "m-1" }),
        makeEvidence({ missionId: "m-1", tenantId: "tenant-b" }),
      ],
      transitions: [
        makeTransition({ missionId: "m-1" }),
        makeTransition({ missionId: "m-unknown" }),
      ],
    });
    expect(report.excludedCrossTenant).toEqual({ missions: 1, evidence: 1, transitions: 1, usage: 0 });
    expect(report.sampleSize).toBe(1);
    expect(report.metrics.missionCompletionRate.value).toBe(1);
  });

  it("attributes per-actor rework and rollback signals", () => {
    const report = computeWorkforcePerformance({
      tenantId: TENANT,
      now: NOW,
      missions: [makeMission({ missionId: "m-1" })],
      evidence: [],
      transitions: [
        makeTransition({ actorId: "worker-1", to: "RETRYING" }),
        makeTransition({ actorId: "worker-1", from: "RETRYING", to: "SUCCEEDED" }),
        makeTransition({ actorId: "worker-2", to: "COMPENSATING" }),
        makeTransition({ actorId: "worker-2", from: "COMPENSATING", to: "SUCCEEDED" }),
      ],
    });
    const actors = Object.fromEntries(report.perActor.map((a) => [a.actorId, a]));
    expect(actors["worker-1"].reworkTransitions).toBe(1);
    expect(actors["worker-1"].rollbackTransitions).toBe(0);
    expect(actors["worker-2"].reworkTransitions).toBe(1);
    expect(actors["worker-2"].rollbackTransitions).toBe(1);
    expect(actors["worker-2"].missionsActedOn).toBe(1);
  });

  it("fails closed on an invalid mission core", () => {
    expect(() =>
      computeWorkforcePerformance({
        tenantId: TENANT,
        now: NOW,
        missions: [makeMission({ objective: "" })],
        evidence: [],
        transitions: [],
      }),
    ).toThrow(/objective \(declared outcome\) is required/);
  });

  it("fails closed on non-canonical transition states, unparseable clocks, and unattributed actors", () => {
    const base = { tenantId: TENANT, now: NOW, missions: [makeMission()], evidence: [] };
    expect(() =>
      computeWorkforcePerformance({
        ...base,
        transitions: [makeTransition({ from: "SOMETHING_ELSE" as MissionLifecycleState })],
      }),
    ).toThrow(/non-canonical lifecycle state/);
    expect(() =>
      computeWorkforcePerformance({
        ...base,
        transitions: [makeTransition({ at: "not-a-timestamp" })],
      }),
    ).toThrow(/unparseable timestamp/);
    expect(() =>
      computeWorkforcePerformance({
        ...base,
        transitions: [makeTransition({ actorId: "  " })],
      }),
    ).toThrow(/no attributed actor/);
  });

  it("fails closed on an empty tenant or unparseable report clock", () => {
    expect(() =>
      computeWorkforcePerformance({ tenantId: "  ", now: NOW, missions: [], evidence: [], transitions: [] }),
    ).toThrow(/tenantId is required/);
    expect(() =>
      computeWorkforcePerformance({ tenantId: TENANT, now: "junk", missions: [], evidence: [], transitions: [] }),
    ).toThrow(/parseable timestamp/);
  });
});