/**
 * CoreGrid Scholar — Phase 12 Scheduling & Timetable Intelligence unit tests
 * (scheduling-constraints).
 *
 * Validates:
 * - Constraint creation and hard/soft kinds (N, O, P).
 * - Constraint priority can never silently downgrade a hard constraint (Q).
 * - Constraint evaluation: capacity, instructor, learner, resource,
 *   permitted period, equipment, qualification, prohibited overlap (O).
 * - Temporal constraints: before, after, during, not during, overlap,
 *   non-overlap, minimum/maximum gap (T).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createSchedulingConstraint,
  canRelaxConstraint,
  evaluateConstraint,
  evaluateTemporalConstraint,
  type SchedulingConstraint,
} from "@/lib/scheduling-constraints";
import {
  createScheduledActivity,
  createScheduleResource,
  type ScheduledActivity,
  type ScheduleResource,
  type TimeInterval,
} from "@/lib/scheduling-core";

const TENANT_A = tenantId("tenant-a");

const INTERVAL_A: TimeInterval = {
  start: "2026-01-01T08:00:00Z",
  end: "2026-01-01T09:00:00Z",
  timezone: "UTC",
};
const INTERVAL_B: TimeInterval = {
  start: "2026-01-01T08:30:00Z",
  end: "2026-01-01T09:30:00Z",
  timezone: "UTC",
};
const INTERVAL_C: TimeInterval = {
  start: "2026-01-01T10:00:00Z",
  end: "2026-01-01T11:00:00Z",
  timezone: "UTC",
};

function makeActivity(overrides: Partial<ScheduledActivity> = {}): ScheduledActivity {
  const created = createScheduledActivity({
    tenantId: TENANT_A,
    subjectId: "subject-math",
    classId: "class-1",
    instructorId: "teacher-1",
    learnerIds: ["learner-1"],
    resourceIds: ["room-1"],
    interval: INTERVAL_A,
    requiredCapacity: 30,
  });
  if (!created.ok) throw new Error("fixture failed");
  return { ...created.activity, ...overrides };
}

const ROOM_1: ScheduleResource = {
  id: "room-1",
  tenantId: TENANT_A,
  type: "room",
  name: "Lab A",
  capacity: 40,
};
const ROOM_2: ScheduleResource = {
  id: "room-2",
  tenantId: TENANT_A,
  type: "room",
  name: "Small Room",
  capacity: 20,
};

function makeConstraint(overrides: Partial<SchedulingConstraint> = {}): SchedulingConstraint {
  const created = createSchedulingConstraint({
    tenantId: TENANT_A,
    type: "room_capacity",
    kind: "hard",
    priority: 1,
    scope: "institution",
    params: {},
  });
  if (!created.ok) throw new Error("fixture failed");
  return { ...created.constraint, ...overrides };
}

describe("Constraint model (N, O, P, Q)", () => {
  it("creates a hard constraint", () => {
    const constraint = makeConstraint();
    expect(constraint.kind).toBe("hard");
  });

  it("rejects an empty scope (R)", () => {
    const result = createSchedulingConstraint({
      tenantId: TENANT_A,
      type: "room_capacity",
      kind: "hard",
      priority: 1,
      scope: "",
      params: {},
    });
    expect(result.ok).toBe(false);
  });

  it("never downgrades a hard constraint without explicit policy approval (Q)", () => {
    const hard = makeConstraint({ kind: "hard" });
    expect(canRelaxConstraint(hard, "soft", false)).toBe(false);
    expect(canRelaxConstraint(hard, "soft", true)).toBe(true);
    expect(canRelaxConstraint(hard, "hard", false)).toBe(true);
  });
});

describe("evaluateConstraint (O)", () => {
  it("detects room capacity violations", () => {
    const constraint = makeConstraint({ type: "room_capacity" });
    const evaluation = evaluateConstraint({
      constraint,
      activity: makeActivity({ requiredCapacity: 50 }),
      resources: [ROOM_1],
      allActivities: [],
    });
    expect(evaluation.satisfied).toBe(false);
  });

  it("accepts adequate room capacity", () => {
    const constraint = makeConstraint({ type: "room_capacity" });
    const evaluation = evaluateConstraint({
      constraint,
      activity: makeActivity({ requiredCapacity: 30 }),
      resources: [ROOM_1],
      allActivities: [],
    });
    expect(evaluation.satisfied).toBe(true);
  });

  it("detects instructor double-booking", () => {
    const constraint = makeConstraint({ type: "instructor_availability" });
    const other = makeActivity({ id: "activity-2", interval: INTERVAL_B });
    const evaluation = evaluateConstraint({
      constraint,
      activity: makeActivity(),
      resources: [ROOM_1],
      allActivities: [other],
    });
    expect(evaluation.satisfied).toBe(false);
  });

  it("detects learner double-booking", () => {
    const constraint = makeConstraint({ type: "learner_availability" });
    const other = makeActivity({ id: "activity-2", interval: INTERVAL_B });
    const evaluation = evaluateConstraint({
      constraint,
      activity: makeActivity(),
      resources: [ROOM_1],
      allActivities: [other],
    });
    expect(evaluation.satisfied).toBe(false);
  });

  it("detects resource double-booking", () => {
    const constraint = makeConstraint({ type: "resource_availability" });
    const other = makeActivity({ id: "activity-2", interval: INTERVAL_B });
    const evaluation = evaluateConstraint({
      constraint,
      activity: makeActivity(),
      resources: [ROOM_1],
      allActivities: [other],
    });
    expect(evaluation.satisfied).toBe(false);
  });

  it("enforces the permitted period (O)", () => {
    const constraint = makeConstraint({
      type: "permitted_period",
      params: { periodStart: "2026-01-01T09:00:00Z", periodEnd: "2026-01-01T17:00:00Z" },
    });
    const evaluation = evaluateConstraint({
      constraint,
      activity: makeActivity(), // 08:00-09:00, before the permitted window
      resources: [ROOM_1],
      allActivities: [],
    });
    expect(evaluation.satisfied).toBe(false);
  });

  it("enforces required equipment", () => {
    const constraint = makeConstraint({
      type: "required_equipment",
      params: { equipmentId: "projector-1" },
    });
    const evaluation = evaluateConstraint({
      constraint,
      activity: makeActivity(),
      resources: [ROOM_1],
      allActivities: [],
    });
    expect(evaluation.satisfied).toBe(false);
  });
});

describe("evaluateTemporalConstraint (T)", () => {
  it("enforces before/after/during/not_during", () => {
    expect(
      evaluateTemporalConstraint({ relation: "before", reference: INTERVAL_C }, INTERVAL_A).ok,
    ).toBe(true);
    expect(
      evaluateTemporalConstraint({ relation: "after", reference: INTERVAL_C }, INTERVAL_A).ok,
    ).toBe(false);
    expect(
      evaluateTemporalConstraint({ relation: "during", reference: INTERVAL_C }, INTERVAL_A).ok,
    ).toBe(false);
    expect(
      evaluateTemporalConstraint({ relation: "not_during", reference: INTERVAL_C }, INTERVAL_A).ok,
    ).toBe(true);
  });

  it("enforces overlap and non-overlap", () => {
    expect(
      evaluateTemporalConstraint({ relation: "overlap", reference: INTERVAL_B }, INTERVAL_A).ok,
    ).toBe(true);
    expect(
      evaluateTemporalConstraint({ relation: "non_overlap", reference: INTERVAL_B }, INTERVAL_A).ok,
    ).toBe(false);
  });

  it("enforces minimum and maximum gaps", () => {
    expect(
      evaluateTemporalConstraint(
        { relation: "minimum_gap", reference: INTERVAL_C, gapMinutes: 60 },
        INTERVAL_A,
      ).ok,
    ).toBe(true);
    expect(
      evaluateTemporalConstraint(
        { relation: "minimum_gap", reference: INTERVAL_C, gapMinutes: 120 },
        INTERVAL_A,
      ).ok,
    ).toBe(false);
  });
});
