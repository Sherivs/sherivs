/**
 * CoreGrid — Scheduling & Timetable Intelligence Independent
 * Validator, quality scoring, and schedule lifecycle (Phase 12, Sections BB,
 * BE, BK, BL, BM, G, H).
 *
 * Implements `architecture/phase-12-scheduling-intelligence.md`:
 * - Independent Validator (BB): solver results are never trusted blindly;
 *   every result passes an independent validation layer checking hard
 *   constraints, resource/participant conflicts, policy constraints,
 *   temporal constraints, capacity, accessibility, required dependencies
 *   (BA).
 * - Conflict types (AT): time, room, instructor, learner, resource,
 *   capacity, qualification, policy, travel, accessibility, calendar.
 * - Schedule scoring (BE): feasibility always dominates optimization
 *   preferences (BC).
 * - Lifecycle/versioning (G, H) and publication safety (BL): invalid
 *   schedules can never become ACTIVE or be published; every meaningful
 *   modification creates a version recording creator, reason, validation,
 *   approval, and publication status. Previously published versions remain
 *   reconstructable.
 * - Schedule freeze (BM): defined periods require elevated authorization.
 *
 * Boundaries: this module is deliberately independent from any solver
 * implementation (AY); it only validates and scores schedules.
 */

import type { TenantId } from "./tenant-core";
import type { ScheduledActivity, TimeInterval, ScheduleResource } from "./scheduling-core";
import { intervalsOverlap } from "./scheduling-core";
import type { SchedulingConstraint } from "./scheduling-constraints";
import { evaluateConstraint } from "./scheduling-constraints";

/* ─────────────────────────────────────────────────────────────
 * Conflict model (AT)
 * ────────────────────────────────────────────────────────────*/

export type ConflictType =
  | "time"
  | "room"
  | "instructor"
  | "learner"
  | "resource"
  | "capacity"
  | "qualification"
  | "policy"
  | "travel"
  | "accessibility"
  | "calendar";

export const CONFLICT_TYPES: readonly ConflictType[] = [
  "time",
  "room",
  "instructor",
  "learner",
  "resource",
  "capacity",
  "qualification",
  "policy",
  "travel",
  "accessibility",
  "calendar",
] as const;

export interface ScheduleConflict {
  type: ConflictType;
  activityId: string;
  otherActivityId: string | null;
  reason: string;
  severity: "critical" | "warning";
}

export interface ValidateScheduleInput {
  tenantId: TenantId;
  activities: ScheduledActivity[];
  resources: ScheduleResource[];
  constraints: SchedulingConstraint[];
}

export interface ValidateScheduleOutput {
  feasible: boolean;
  conflicts: ScheduleConflict[];
  /** Activities involved in critical conflicts. */
  criticalActivityIds: string[];
}

/**
 * Independent Validator (BB): evaluates every hard constraint across all
 * activities and reports every conflict with an explanation. Feasibility is
 * false when any critical conflict exists — the system must never silently
 * violate a hard constraint (AV, EP.30).
 */
export function validateSchedule(input: ValidateScheduleInput): ValidateScheduleOutput {
  const conflicts: ScheduleConflict[] = [];
  const activities = input.activities;

  // Structural conflict detection (AT): instructor, learner, resource.
  for (let i = 0; i < activities.length; i++) {
    for (let j = i + 1; j < activities.length; j++) {
      const a = activities[i];
      const b = activities[j];
      if (!intervalsOverlap(a.interval, b.interval)) continue;

      if (a.instructorId === b.instructorId) {
        conflicts.push({
          type: "instructor",
          activityId: a.id,
          otherActivityId: b.id,
          reason: `Instructor ${a.instructorId} double-booked (AT)`,
          severity: "critical",
        });
      }
      if (a.learnerIds.some((l) => b.learnerIds.includes(l))) {
        conflicts.push({
          type: "learner",
          activityId: a.id,
          otherActivityId: b.id,
          reason: "Learners double-booked across mandatory activities (AT)",
          severity: "critical",
        });
      }
      if (a.resourceIds.some((r) => b.resourceIds.includes(r))) {
        conflicts.push({
          type: "resource",
          activityId: a.id,
          otherActivityId: b.id,
          reason: "Resource double-booked (AT)",
          severity: "critical",
        });
      }
    }
  }

  // Capacity conflicts (O): assigned rooms must meet required capacity.
  for (const activity of activities) {
    const assigned = input.resources.filter((r) => activity.resourceIds.includes(r.id));
    for (const room of assigned) {
      if (room.capacity < activity.requiredCapacity) {
        conflicts.push({
          type: "capacity",
          activityId: activity.id,
          otherActivityId: null,
          reason: `Room ${room.id} capacity ${room.capacity} below required ${activity.requiredCapacity} (O)`,
          severity: "critical",
        });
      }
    }
  }

  // Declared hard constraints (BB): evaluate each hard constraint per
  // activity; record a policy conflict when violated.
  for (const constraint of input.constraints) {
    if (constraint.kind !== "hard") continue;
    for (const activity of activities) {
      const evaluation = evaluateConstraint({
        constraint,
        activity,
        resources: input.resources,
        allActivities: activities,
      });
      if (!evaluation.satisfied) {
        conflicts.push({
          type: "policy",
          activityId: activity.id,
          otherActivityId: null,
          reason: evaluation.reason,
          severity: "critical",
        });
      }
    }
  }

  const criticalActivityIds = [
    ...new Set(conflicts.filter((c) => c.severity === "critical").map((c) => c.activityId)),
  ];
  return {
    feasible: criticalActivityIds.length === 0,
    conflicts,
    criticalActivityIds,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Schedule quality scoring (BE, BC)
 * ────────────────────────────────────────────────────────────*/

export interface ScheduleQualityScore {
  feasibility: number;
  constraintScore: number;
  resourceUtilization: number;
  learnerConvenience: number;
  overallQuality: number;
}

export interface ScoreScheduleInput {
  activities: ScheduledActivity[];
  resources: ScheduleResource[];
  softConstraints: SchedulingConstraint[];
  /** Soft-preference satisfaction ratios per constraint (0-1). */
  softConstraintSatisfaction: Record<string, number>;
}

/**
 * Score schedule quality (BE). Feasibility always dominates optimization
 * preferences (BC): an infeasible schedule scores 0 overall regardless of
 * soft-preference satisfaction.
 */
export function scoreSchedule(input: ScoreScheduleInput): ScheduleQualityScore {
  const resourceCount = input.resources.length;
  const resourceUtilization =
    resourceCount === 0
      ? 0
      : Math.round(
          (input.activities.reduce((s, a) => s + a.resourceIds.length, 0) / resourceCount) * 100,
        );

  const softCount = input.softConstraints.length;
  const constraintScore =
    softCount === 0
      ? 100
      : Math.round(
          (input.softConstraints.reduce(
            (sum, c) => sum + (input.softConstraintSatisfaction[c.id] ?? 0),
            0,
          ) /
            softCount) *
            100,
        );

  return {
    feasibility: 100,
    constraintScore,
    resourceUtilization: Math.min(100, resourceUtilization),
    learnerConvenience: constraintScore,
    overallQuality: 0, // recomputed by scoreFinalSchedule
  };
}

export function scoreFinalSchedule(
  validation: ValidateScheduleOutput,
  quality: ScheduleQualityScore,
): ScheduleQualityScore {
  if (!validation.feasible) {
    return { ...quality, feasibility: 0, overallQuality: 0 };
  }
  const overall = Math.round(
    quality.constraintScore * 0.4 +
      quality.resourceUtilization * 0.3 +
      quality.learnerConvenience * 0.3,
  );
  return { ...quality, feasibility: 100, overallQuality: overall };
}

/* ─────────────────────────────────────────────────────────────
 * Schedule lifecycle & versioning (G, H)
 * ────────────────────────────────────────────────────────────*/

export type ScheduleState =
  "draft" | "validated" | "approved" | "published" | "active" | "archived" | "rejected";

export const SCHEDULE_STATES: readonly ScheduleState[] = [
  "draft",
  "validated",
  "approved",
  "published",
  "active",
  "archived",
  "rejected",
] as const;

export interface ScheduleVersion {
  versionId: string;
  parentVersionId: string | null;
  creatorId: string;
  createdAt: string;
  reason: string;
  affectedActivityIds: string[];
  validationStatus: "unvalidated" | "validated" | "invalid";
  approvalStatus: "none" | "approved" | "rejected";
  publicationStatus: "unpublished" | "published" | "active";
}

export interface CreateScheduleVersionInput {
  versionId: string;
  parentVersionId?: string | null;
  creatorId: string;
  reason: string;
  affectedActivityIds: string[];
  now: string;
}

export type CreateScheduleVersionResult =
  { ok: true; version: ScheduleVersion } | { ok: false; error: string };

export function createScheduleVersion(
  input: CreateScheduleVersionInput,
): CreateScheduleVersionResult {
  if (input.creatorId.trim() === "") {
    return { ok: false, error: "Schedule version requires a creator (H)" };
  }
  if (input.reason.trim() === "") {
    return { ok: false, error: "Schedule version requires a reason (H)" };
  }
  return {
    ok: true,
    version: {
      versionId: input.versionId,
      parentVersionId: input.parentVersionId ?? null,
      creatorId: input.creatorId,
      createdAt: input.now,
      reason: input.reason,
      affectedActivityIds: input.affectedActivityIds,
      validationStatus: "unvalidated",
      approvalStatus: "none",
      publicationStatus: "unpublished",
    },
  };
}

export function recordValidationResult(version: ScheduleVersion, valid: boolean): ScheduleVersion {
  return { ...version, validationStatus: valid ? "validated" : "invalid" };
}

/**
 * Publication safety (BL): an invalid schedule cannot be published; a
 * schedule with unresolved critical conflicts cannot become active.
 */
export function canPublishSchedule(
  version: ScheduleVersion,
  validation: ValidateScheduleOutput,
): { ok: true } | { ok: false; reason: string } {
  if (version.validationStatus === "invalid" || !validation.feasible) {
    return { ok: false, reason: "An invalid schedule cannot be published (BL)" };
  }
  if (version.validationStatus === "unvalidated") {
    return { ok: false, reason: "Schedule must be validated before publication (BL)" };
  }
  if (version.approvalStatus !== "approved") {
    return { ok: false, reason: "Schedule requires approval where required (BK)" };
  }
  return { ok: true };
}

export interface FreezeWindow {
  tenantId: TenantId;
  reason: string;
  interval: TimeInterval;
}

export interface ChangeRequest {
  id: string;
  tenantId: TenantId;
  requestedBy: string;
  activityId: string;
  type: "reschedule" | "room_change" | "instructor_change" | "time_change";
  reason: string;
  requiresElevatedAuthorization: boolean;
  createdAt: string;
}

export interface CreateChangeRequestInput {
  tenantId: TenantId;
  requestedBy: string;
  activityId: string;
  type: ChangeRequest["type"];
  reason: string;
  requiresElevatedAuthorization: boolean;
  now: string;
}

export type CreateChangeRequestResult =
  { ok: true; request: ChangeRequest } | { ok: false; error: string };

export function createChangeRequest(input: CreateChangeRequestInput): CreateChangeRequestResult {
  if (input.reason.trim() === "") {
    return { ok: false, error: "Change request requires a reason (BN)" };
  }
  return {
    ok: true,
    request: {
      id: `change-${input.tenantId}-${input.activityId}-${input.now}`,
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      activityId: input.activityId,
      type: input.type,
      reason: input.reason,
      requiresElevatedAuthorization: input.requiresElevatedAuthorization,
      createdAt: input.now,
    },
  };
}

/**
 * Schedule freeze (BM): during freeze windows (examination week, final
 * publication, government reporting), changes require elevated
 * authorization.
 */
export function isChangeDuringFreeze(
  changeRequest: ChangeRequest,
  freezeWindows: FreezeWindow[],
  interval: TimeInterval,
): boolean {
  return freezeWindows.some(
    (f) => f.tenantId === changeRequest.tenantId && intervalsOverlap(f.interval, interval),
  );
}
