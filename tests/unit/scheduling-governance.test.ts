import { describe, expect, it } from "vitest";

import {
  CONFLICT_TYPES,
  detectConflicts,
  escalateConflicts,
  isBlocking,
  type SchedulingAssignment,
} from "../../frontend/src/lib/scheduling-conflicts";
import {
  analyseImpact,
  balanceOf,
  compareVersions,
  explainPlacement,
  measureDisruption,
  rankCandidates,
  scoreSchedule,
  type RankedCandidate,
} from "../../frontend/src/lib/scheduling-quality";

const NOW = "2026-01-05T08:00:00Z";

function assignment(
  overrides: Partial<SchedulingAssignment> & { id: string },
): SchedulingAssignment {
  return {
    tenantId: "tenant-a",
    activityId: `activity-${overrides.id}`,
    participants: [],
    resources: [],
    start: "2026-03-02T09:00:00Z",
    end: "2026-03-02T10:00:00Z",
    timezone: "UTC",
    ...overrides,
  };
}

describe("scheduling conflict engine", () => {
  it("declares the full conflict taxonomy, including travel and accessibility", () => {
    expect(CONFLICT_TYPES).toContain("travel");
    expect(CONFLICT_TYPES).toContain("accessibility");
    expect(CONFLICT_TYPES).toContain("calendar");
    expect(CONFLICT_TYPES.length).toBeGreaterThanOrEqual(12);
  });

  it("detects a participant required by two overlapping activities", () => {
    const conflicts = detectConflicts({
      tenantId: "tenant-a",
      now: NOW,
      assignments: [
        assignment({ id: "a1", activityId: "shift-1", participants: ["p-1"] }),
        assignment({
          id: "a2",
          activityId: "shift-2",
          participants: ["p-1"],
          start: "2026-03-02T09:30:00Z",
          end: "2026-03-02T10:30:00Z",
        }),
      ],
    });
    const participant = conflicts.filter((conflict) => conflict.type === "participant");
    expect(participant).toHaveLength(1);
    expect(participant[0].severity).toBe("critical");
    expect(isBlocking(participant[0])).toBe(true);
    expect(participant[0].detail).toContain("p-1");
  });

  it("detects a double-booked resource and offers usable resolution strategies", () => {
    const conflicts = detectConflicts({
      tenantId: "tenant-a",
      now: NOW,
      assignments: [
        assignment({ id: "a1", resources: ["theatre-1"] }),
        assignment({
          id: "a2",
          resources: ["theatre-1"],
          start: "2026-03-02T09:45:00Z",
          end: "2026-03-02T10:15:00Z",
        }),
      ],
    });
    const resource = conflicts.find((conflict) => conflict.type === "resource");
    expect(resource).toBeDefined();
    expect(resource?.entities).toContain("theatre-1");
    expect(resource?.proposedResolutions).toContain("change_resource");
  });

  it("reports nothing when participants and resources are disjoint in time", () => {
    const conflicts = detectConflicts({
      tenantId: "tenant-a",
      now: NOW,
      assignments: [
        assignment({ id: "a1", participants: ["p-1"], resources: ["bay-1"] }),
        assignment({
          id: "a2",
          participants: ["p-1"],
          resources: ["bay-1"],
          start: "2026-03-02T11:00:00Z",
          end: "2026-03-02T12:00:00Z",
        }),
      ],
    });
    expect(conflicts).toHaveLength(0);
  });
});

describe("scheduling conflict detection, continued", () => {
  it("treats exceedance of declared capacity as blocking and names the numbers", () => {
    const conflicts = detectConflicts({
      tenantId: "tenant-a",
      now: NOW,
      resourceCapacity: { "hall-1": 20 },
      assignments: [
        assignment({
          id: "a1",
          resources: ["hall-1"],
          participants: Array.from({ length: 21 }, (_, index) => `p-${index}`),
        }),
      ],
    });
    const capacity = conflicts.find((conflict) => conflict.type === "capacity");
    expect(capacity?.severity).toBe("critical");
    expect(capacity?.detail).toContain("21");
    expect(capacity?.detail).toContain("20");
  });

  it("detects a missing capability and a missing accessibility requirement", () => {
    const conflicts = detectConflicts({
      tenantId: "tenant-a",
      now: NOW,
      resourceCapabilities: { "line-1": ["standard"] },
      accessibleResources: { "line-1": ["step_free"] },
      assignments: [
        assignment({
          id: "a1",
          resources: ["line-1"],
          demands: { refrigerated: 1 },
          accessibilityRequirements: ["hoist"],
        }),
      ],
    });
    expect(conflicts.some((conflict) => conflict.type === "capability")).toBe(true);
    expect(conflicts.some((conflict) => conflict.type === "accessibility")).toBe(true);
  });

  it("treats a blocked period as policy, not preference", () => {
    const conflicts = detectConflicts({
      tenantId: "tenant-a",
      now: NOW,
      blockedPeriods: [
        {
          id: "closure-1",
          start: "2026-03-02T00:00:00Z",
          end: "2026-03-03T00:00:00Z",
          reason: "annual shutdown",
        },
      ],
      assignments: [assignment({ id: "a1" })],
    });
    const calendar = conflicts.find((conflict) => conflict.type === "calendar");
    expect(calendar?.severity).toBe("critical");
    expect(calendar?.detail).toContain("annual shutdown");
  });

  it("detects impossible travel between two resources", () => {
    const conflicts = detectConflicts({
      tenantId: "tenant-a",
      now: NOW,
      assignments: [
        assignment({ id: "a1", resources: ["depot-a"], travelMinutesFrom: { "site-b": 30 } }),
        assignment({
          id: "a2",
          resources: ["site-b"],
          start: "2026-03-02T10:10:00Z",
          end: "2026-03-02T11:00:00Z",
        }),
      ],
    });
    const travel = conflicts.find((conflict) => conflict.type === "travel");
    expect(travel).toBeDefined();
    expect(travel?.detail).toContain("10 minutes");
  });

  it("detects an interval that ends before it begins and a missing timezone", () => {
    const conflicts = detectConflicts({
      tenantId: "tenant-a",
      now: NOW,
      assignments: [
        assignment({
          id: "a1",
          start: "2026-03-02T10:00:00Z",
          end: "2026-03-02T09:00:00Z",
          timezone: "",
        }),
      ],
    });
    expect(conflicts.filter((conflict) => conflict.type === "time")).toHaveLength(2);
  });

  it("reports infeasibility instead of inventing a valid plan", () => {
    const conflicts = detectConflicts({
      tenantId: "tenant-a",
      now: NOW,
      resourceCapacity: { "ward-1": 2 },
      assignments: [
        assignment({ id: "a1", resources: ["ward-1"], participants: ["p-1", "p-2", "p-3"] }),
      ],
    });
    const escalation = escalateConflicts(conflicts);
    expect(escalation.feasible).toBe(false);
    expect(escalation.blocking.length).toBeGreaterThan(0);
    expect(escalation.guidance.join(" ")).toContain("capacity");
    expect(escalation.guidance.join(" ")).toContain("governance");
  });

  it("confirms feasibility when only non-blocking issues remain", () => {
    const conflicts = detectConflicts({
      tenantId: "tenant-a",
      now: NOW,
      accessibleResources: { "room-9": [] },
      assignments: [
        assignment({ id: "a1", resources: ["room-9"], accessibilityRequirements: ["step_free"] }),
      ],
    });
    const escalation = escalateConflicts(conflicts);
    expect(escalation.feasible).toBe(true);
    expect(escalation.waivable.length).toBeGreaterThan(0);
    expect(escalation.guidance.join(" ")).toContain("policy");
  });
});

describe("scheduling quality, disruption and explanation", () => {
  it("scores each dimension independently and keeps feasibility binary", () => {
    const quality = scoreSchedule({
      assignments: [assignment({ id: "a1", participants: ["p-1"] })],
      conflicts: [],
      preferenceHits: 1,
      loads: { "p-1": 4, "p-2": 4 },
    });
    const feasibility = quality.scores.find((score) => score.dimension === "feasibility");
    expect(feasibility?.value).toBe(1);
    expect(quality.scores.length).toBe(6);
    expect(quality.overall).toBeGreaterThan(0);
    expect(quality.unmeasured).toContain("disruption");
    expect(quality.unmeasured).toContain("stability");
  });

  it("marks a plan with a blocking conflict as infeasible", () => {
    const conflicts = detectConflicts({
      tenantId: "tenant-a",
      now: NOW,
      resourceCapacity: { "bay-1": 1 },
      assignments: [assignment({ id: "a1", resources: ["bay-1"], participants: ["p-1", "p-2"] })],
    });
    const quality = scoreSchedule({ assignments: [assignment({ id: "a1" })], conflicts });
    expect(quality.scores.find((score) => score.dimension === "feasibility")?.value).toBe(0);
  });

  it("measures balance across actors and returns 1 when loads are equal", () => {
    expect(balanceOf({ a: 5, b: 5 })).toBe(1);
    expect(balanceOf({ a: 0, b: 10 })).toBeLessThan(0.5);
    expect(balanceOf({})).toBe(1);
  });

  it("measures a change by how much it disturbs the organization", () => {
    const before = [
      assignment({ id: "a1" }),
      assignment({ id: "a2" }),
      assignment({ id: "a3" }),
      assignment({ id: "a4" }),
    ];
    const disruption = measureDisruption(
      before,
      {
        added: [],
        removed: [],
        moved: [
          {
            before: before[0],
            after: { ...before[0], start: "2026-03-02T14:00:00Z", end: "2026-03-02T15:00:00Z" },
          },
        ],
      },
      before,
      0.25,
    );
    expect(disruption.changedAssignments).toBe(1);
    expect(disruption.withinTolerance).toBe(true);
    expect(disruption.summary).toContain("assignment(s) change");
  });

  it("flags a rewrite that exceeds the stability tolerance", () => {
    const before = [assignment({ id: "a1" }), assignment({ id: "a2" })];
    const disruption = measureDisruption(
      before,
      { added: [], removed: before, moved: [] },
      before,
      0.25,
    );
    expect(disruption.disruptionRatio).toBe(1);
    expect(disruption.withinTolerance).toBe(false);
  });
});

describe("scheduling version comparison, impact and candidate ranking", () => {
  it("compares two versions by placement, resource, participant and conflict", () => {
    const from = [
      assignment({ id: "a1", activityId: "shift-1", resources: ["bay-1"], participants: ["p-1"] }),
    ];
    const to = [
      assignment({
        id: "a1",
        activityId: "shift-1",
        resources: ["bay-2"],
        participants: ["p-1", "p-2"],
        start: "2026-03-02T13:00:00Z",
        end: "2026-03-02T14:00:00Z",
      }),
    ];
    const comparison = compareVersions("v1", "v2", from, to);
    expect(comparison.movedActivities).toContain("shift-1");
    expect(comparison.changedResources).toContain("bay-2");
    expect(comparison.changedParticipants).toContain("p-2");
    expect(comparison.summary).toContain("activity placement(s) differ");
  });

  it("returns an equivalence statement when two versions match", () => {
    const plan = [assignment({ id: "a1", resources: ["bay-1"] })];
    const comparison = compareVersions("v1", "v2", plan, plan);
    expect(comparison.movedActivities).toHaveLength(0);
    expect(comparison.summary).toContain("equivalent");
  });

  it("calculates impact and demands a narrower change when scope is too wide", () => {
    const wide = Array.from({ length: 10 }, (_, index) =>
      assignment({ id: `a${index}`, participants: [`p-${index}`] }),
    );
    const impact = analyseImpact("close a site", wide, [
      {
        id: "conflict-1",
        tenantId: "tenant-a",
        type: "calendar",
        severity: "critical",
        assignments: ["a0"],
        entities: ["site-1"],
        constraintId: "blocked-periods",
        constraintKind: "hard",
        detail: "Site closed",
        detectedAt: NOW,
        state: "open",
        proposedResolutions: ["move_activity"],
      },
    ]);
    expect(impact.affectedActivities).toHaveLength(10);
    expect(impact.affectedParticipants).toHaveLength(10);
    expect(impact.leastDisruptive).toContain("stability tolerance");
    expect(impact.escalation).toContain("human decision");
  });

  it("explains a placement: why here, why this resource, why not the alternatives", () => {
    const whole = assignment({ id: "a1", resources: ["hall-1"], participants: ["p-1"] });
    const conflicts = detectConflicts({
      tenantId: "tenant-a",
      now: NOW,
      resourceCapabilities: { "hall-1": ["standard"] },
      assignments: [{ ...whole, demands: { projector: 1 } }],
    });
    const explanation = explainPlacement(whole, conflicts, [
      { id: "hall-2", reason: "already committed elsewhere" },
    ]);
    expect(explanation.whyPlaced).toContain("unresolved blocking constraint");
    expect(explanation.whyThisResource).toContain("hall-1");
    expect(explanation.whyAlternativesRejected[0]).toContain("already committed elsewhere");
    expect(explanation.selectedOver).toContain("hall-2");
    expect(explanation.constraintsThatDecided.length).toBeGreaterThan(0);
  });

  it("ranks feasible, least-disruptive candidates ahead of merely efficient ones", () => {
    const quality = scoreSchedule({
      assignments: [assignment({ id: "a1" })],
      conflicts: [],
      loads: { "p-1": 1 },
    });
    const steady: RankedCandidate = {
      candidateId: "steady",
      quality,
      disruption: {
        changedAssignments: 1,
        affectedParticipants: 1,
        affectedResources: 1,
        disruptionRatio: 0.1,
        withinTolerance: true,
        summary: "small stable adjustment",
      },
      conflicts: [],
      recommended: true,
      rationale: "small stable adjustment",
    };
    const sweeping: RankedCandidate = {
      candidateId: "sweeping",
      quality: { ...quality, overall: 0.99 },
      disruption: {
        changedAssignments: 9,
        affectedParticipants: 9,
        affectedResources: 9,
        disruptionRatio: 0.9,
        withinTolerance: false,
        summary: "rewrite",
      },
      conflicts: [],
      recommended: false,
      rationale: "theoretical efficiency at the cost of disruption",
    };
    const ranked = rankCandidates([sweeping, steady]);
    expect(ranked[0].candidateId).toBe("steady");
  });
});
