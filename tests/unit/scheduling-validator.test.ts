/**
 * CoreGrid Scholar — Phase 12 Scheduling & Timetable Intelligence unit tests
 * (scheduling-validator).
 *
 * Validates:
 * - Independent Validator: instructor/learner/resource conflicts, capacity,
 *   and declared hard constraints (BB, AT, O).
 * - Quality scoring where feasibility always dominates (BE, BC).
 * - Versioning, publication safety, freeze windows, and change requests
 *   (H, BL, BM, BN).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  validateSchedule,
  scoreSchedule,
  scoreFinalSchedule,
  createScheduleVersion,
  recordValidationResult,
  canPublishSchedule,
  createChangeRequest,
  isChangeDuringFreeze,
  type ValidateScheduleOutput,
} from "@/lib/scheduling-validator";
import {
  createScheduledActivity,
  createScheduleResource,
  type ScheduledActivity,
  type ScheduleResource,
  type TimeInterval,
} from "@/lib/scheduling-core";
import {
  createSchedulingConstraint,
  type SchedulingConstraint,
} from "@/lib/scheduling-constraints";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

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

function makeHardConstraint(overrides: Partial<SchedulingConstraint> = {}): SchedulingConstraint {
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

describe("validateSchedule (BB, AT, O)", () => {
  it("accepts a conflict-free schedule", () => {
    const validation = validateSchedule({
      tenantId: TENANT_A,
      activities: [makeActivity(), makeActivity({ id: "activity-2", interval: INTERVAL_C })],
      resources: [ROOM_1],
      constraints: [],
    });
    expect(validation.feasible).toBe(true);
    expect(validation.conflicts).toHaveLength(0);
  });

  it("detects instructor double-booking", () => {
    const validation = validateSchedule({
      tenantId: TENANT_A,
      activities: [makeActivity(), makeActivity({ id: "activity-2", interval: INTERVAL_B })],
      resources: [ROOM_1],
      constraints: [],
    });
    expect(validation.feasible).toBe(false);
    expect(validation.conflicts.some((c) => c.type === "instructor")).toBe(true);
  });

  it("detects resource double-booking", () => {
    const validation = validateSchedule({
      tenantId: TENANT_A,
      activities: [
        makeActivity({ resourceIds: ["room-1"] }),
        makeActivity({ id: "activity-2", interval: INTERVAL_B, resourceIds: ["room-1"] }),
      ],
      resources: [ROOM_1],
      constraints: [],
    });
    expect(validation.conflicts.some((c) => c.type === "resource")).toBe(true);
  });

  it("detects capacity conflicts (O)", () => {
    const validation = validateSchedule({
      tenantId: TENANT_A,
      activities: [makeActivity({ resourceIds: ["room-2"], requiredCapacity: 30 })],
      resources: [ROOM_2],
      constraints: [],
    });
    expect(validation.conflicts.some((c) => c.type === "capacity")).toBe(true);
  });

  it("enforces declared hard constraints (BB)", () => {
    const validation = validateSchedule({
      tenantId: TENANT_A,
      activities: [makeActivity({ requiredCapacity: 50 })],
      resources: [ROOM_1],
      constraints: [makeHardConstraint({ type: "room_capacity" })],
    });
    expect(validation.feasible).toBe(false);
    expect(validation.conflicts.some((c) => c.type === "policy")).toBe(true);
  });
});

describe("Score scheduling (BE, BC)", () => {
  function makeValidation(feasible: boolean): ValidateScheduleOutput {
    return { feasible, conflicts: [], criticalActivityIds: feasible ? [] : ["activity-1"] };
  }

  it("scores zero overall for an infeasible schedule (feasibility dominates)", () => {
    const quality = scoreSchedule({
      activities: [],
      resources: [],
      softConstraints: [],
      softConstraintSatisfaction: {},
    });
    const final = scoreFinalSchedule(makeValidation(false), quality);
    expect(final.feasibility).toBe(0);
    expect(final.overallQuality).toBe(0);
  });

  it("computes an overall quality score for a feasible schedule", () => {
    const soft = makeHardConstraint({ type: "preferred_time", kind: "soft" });
    const quality = scoreSchedule({
      activities: [makeActivity()],
      resources: [ROOM_1, ROOM_2],
      softConstraints: [soft],
      softConstraintSatisfaction: { [soft.id]: 1 },
    });
    const final = scoreFinalSchedule(makeValidation(true), quality);
    expect(final.feasibility).toBe(100);
    expect(final.overallQuality).toBeGreaterThan(0);
  });
});

describe("Schedule lifecycle and publication (G, H, BL, BM, BN)", () => {
  it("creates a version with creator and reason (H)", () => {
    const result = createScheduleVersion({
      versionId: "v2",
      parentVersionId: "v1",
      creatorId: "admin-1",
      reason: "Room change",
      affectedActivityIds: ["activity-1"],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version.validationStatus).toBe("unvalidated");
      expect(result.version.parentVersionId).toBe("v1");
    }
  });

  it("rejects a version without a reason (H)", () => {
    const result = createScheduleVersion({
      versionId: "v2",
      creatorId: "admin-1",
      reason: "",
      affectedActivityIds: [],
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("cannot publish an invalid or unvalidated schedule (BL)", () => {
    const version = createScheduleVersion({
      versionId: "v1",
      creatorId: "admin-1",
      reason: "Initial",
      affectedActivityIds: [],
      now: NOW,
    });
    if (!version.ok) throw new Error("fixture failed");

    const invalidVersion = recordValidationResult(version.version, false);
    expect(
      canPublishSchedule(invalidVersion, {
        feasible: false,
        conflicts: [],
        criticalActivityIds: [],
      }).ok,
    ).toBe(false);

    const unvalidated = { ...version.version, approvalStatus: "approved" as const };
    expect(
      canPublishSchedule(unvalidated, { feasible: true, conflicts: [], criticalActivityIds: [] })
        .ok,
    ).toBe(false);
  });

  it("publishes a validated and approved version", () => {
    const created = createScheduleVersion({
      versionId: "v1",
      creatorId: "admin-1",
      reason: "Initial",
      affectedActivityIds: [],
      now: NOW,
    });
    if (!created.ok) throw new Error("fixture failed");
    const validated = recordValidationResult(created.version, true);
    const approved = { ...validated, approvalStatus: "approved" as const };
    expect(
      canPublishSchedule(approved, { feasible: true, conflicts: [], criticalActivityIds: [] }).ok,
    ).toBe(true);
  });

  it("blocks changes during freeze windows (BM)", () => {
    const request = createChangeRequest({
      tenantId: TENANT_A,
      requestedBy: "admin-1",
      activityId: "activity-1",
      type: "reschedule",
      reason: "Teacher availability",
      requiresElevatedAuthorization: true,
      now: NOW,
    });
    if (!request.ok) throw new Error("fixture failed");
    const frozen = isChangeDuringFreeze(
      request.request,
      [{ tenantId: TENANT_A, reason: "examination week", interval: INTERVAL_A }],
      INTERVAL_A,
    );
    expect(frozen).toBe(true);
    const notFrozen = isChangeDuringFreeze(
      request.request,
      [{ tenantId: TENANT_A, reason: "examination week", interval: INTERVAL_A }],
      INTERVAL_C,
    );
    expect(notFrozen).toBe(false);
  });
});
