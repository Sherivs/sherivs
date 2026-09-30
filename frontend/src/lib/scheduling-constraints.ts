/**
 * CoreGrid — Scheduling & Timetable Intelligence Constraint Engine
 * (Phase 12, Sections N, O, P, Q, S, T, U).
 *
 * Implements `architecture/phase-12-scheduling-intelligence.md`:
 * - Constraint Engine (N): must distinguish hard constraints (violating them
 *   makes a schedule invalid) from soft constraints (violating them makes a
 *   schedule less desirable but potentially feasible).
 * - Hard constraints (O): room capacity, instructor double-booking, learner
 *   double-booking, room double-booking, permitted period, required
 *   equipment, prohibited examination overlap, required qualification.
 * - Soft constraints (P): preferred teaching time, preferred room/campus,
 *   reduced instructor/learner gaps, preferred sequence, minimized travel,
 *   balanced workload, preferred examination spacing.
 * - Constraint priority (Q): priority alone must never convert a declared
 *   hard constraint into a soft constraint — that requires explicit policy
 *   change.
 * - Temporal constraints (T): before, after, during, not during, overlap,
 *   non-overlap, minimum gap, maximum gap, exact interval, flexible
 *   interval.
 *
 * Boundaries: this module declares and evaluates constraints; schedule
 * generation and optimization (AW-AY) remain solver concerns.
 */

import type { TenantId } from "./tenant-core";
import type { ScheduledActivity, TimeInterval, ScheduleResource } from "./scheduling-core";
import { intervalsOverlap } from "./scheduling-core";

/* ─────────────────────────────────────────────────────────────
 * Constraint model (N, O, P, Q)
 * ────────────────────────────────────────────────────────────*/

export type ConstraintKind = "hard" | "soft";

export const CONSTRAINT_KINDS: readonly ConstraintKind[] = ["hard", "soft"] as const;

export type ConstraintType =
  | "room_capacity"
  | "instructor_availability"
  | "learner_availability"
  | "resource_availability"
  | "permitted_period"
  | "required_equipment"
  | "required_qualification"
  | "prohibited_overlap"
  | "preferred_time"
  | "preferred_room"
  | "reduced_gaps"
  | "balanced_workload"
  | "minimized_travel";

export const CONSTRAINT_TYPES: readonly ConstraintType[] = [
  "room_capacity",
  "instructor_availability",
  "learner_availability",
  "resource_availability",
  "permitted_period",
  "required_equipment",
  "required_qualification",
  "prohibited_overlap",
  "preferred_time",
  "preferred_room",
  "reduced_gaps",
  "balanced_workload",
  "minimized_travel",
] as const;

export interface SchedulingConstraint {
  id: string;
  tenantId: TenantId;
  type: ConstraintType;
  kind: ConstraintKind;
  priority: number;
  /** Scope: institution, department, course, instructor, learner, room, activity, academic period (R). */
  scope: string;
  /** Machine-evaluable rule payload (opaque to this module). */
  params: Record<string, string | number | boolean | null>;
}

export interface CreateConstraintInput {
  tenantId: TenantId;
  type: ConstraintType;
  kind: ConstraintKind;
  priority: number;
  scope: string;
  params: Record<string, string | number | boolean | null>;
}

export type CreateConstraintResult =
  { ok: true; constraint: SchedulingConstraint } | { ok: false; error: string };

export function createSchedulingConstraint(input: CreateConstraintInput): CreateConstraintResult {
  if (input.scope.trim() === "") {
    return { ok: false, error: "Constraint scope is required (R)" };
  }
  return {
    ok: true,
    constraint: {
      id: `constraint-${input.tenantId}-${input.type}-${input.scope}`,
      tenantId: input.tenantId,
      type: input.type,
      kind: input.kind,
      priority: input.priority,
      scope: input.scope,
      params: input.params,
    },
  };
}

/**
 * Priority alone must never convert a declared hard constraint into a soft
 * constraint (Q) — that requires explicit policy change. This guard refuses
 * any attempt to change only the kind of a hard constraint.
 */
export function canRelaxConstraint(
  constraint: SchedulingConstraint,
  requestedKind: ConstraintKind,
  hasPolicyChangeApproval: boolean,
): boolean {
  if (constraint.kind === "hard" && requestedKind === "soft") {
    return hasPolicyChangeApproval; // requires explicit governance (Q, EP.38)
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Constraint evaluation (O, P)
 * ────────────────────────────────────────────────────────────*/

export type ConstraintEvaluation =
  { satisfied: true } | { satisfied: false; violatedType: ConstraintType; reason: string };

export interface EvaluateConstraintInput {
  constraint: SchedulingConstraint;
  activity: ScheduledActivity;
  resources: ScheduleResource[];
  allActivities: ScheduledActivity[];
}

/**
 * Evaluate a single constraint against an activity. Hard constraints are
 * evaluated here; soft constraints are scored by the quality scorer rather
 * than hard-failed.
 */
export function evaluateConstraint(input: EvaluateConstraintInput): ConstraintEvaluation {
  const { constraint, activity, resources, allActivities } = input;

  switch (constraint.type) {
    case "room_capacity": {
      const assigned = resources.filter((r) => activity.resourceIds.includes(r.id));
      const capacityOk = assigned.every((r) => r.capacity >= activity.requiredCapacity);
      return capacityOk
        ? { satisfied: true }
        : {
            satisfied: false,
            violatedType: "room_capacity",
            reason: "Room capacity below required capacity (O)",
          };
    }
    case "instructor_availability": {
      const conflicting = allActivities.some(
        (a) =>
          a.id !== activity.id &&
          a.instructorId === activity.instructorId &&
          intervalsOverlap(a.interval, activity.interval),
      );
      return conflicting
        ? {
            satisfied: false,
            violatedType: "instructor_availability",
            reason: "Instructor double-booked (O)",
          }
        : { satisfied: true };
    }
    case "learner_availability": {
      const conflicting = allActivities.some(
        (a) =>
          a.id !== activity.id &&
          a.learnerIds.some((l) => activity.learnerIds.includes(l)) &&
          intervalsOverlap(a.interval, activity.interval),
      );
      return conflicting
        ? {
            satisfied: false,
            violatedType: "learner_availability",
            reason: "Learner double-booked (O)",
          }
        : { satisfied: true };
    }
    case "resource_availability": {
      const conflicting = allActivities.some(
        (a) =>
          a.id !== activity.id &&
          a.resourceIds.some((r) => activity.resourceIds.includes(r)) &&
          intervalsOverlap(a.interval, activity.interval),
      );
      return conflicting
        ? {
            satisfied: false,
            violatedType: "resource_availability",
            reason: "Resource double-booked (O)",
          }
        : { satisfied: true };
    }
    case "permitted_period": {
      const permittedStart = constraint.params.periodStart;
      const permittedEnd = constraint.params.periodEnd;
      if (typeof permittedStart === "string" && typeof permittedEnd === "string") {
        const ok =
          Date.parse(activity.interval.start) >= Date.parse(permittedStart) &&
          Date.parse(activity.interval.end) <= Date.parse(permittedEnd);
        return ok
          ? { satisfied: true }
          : {
              satisfied: false,
              violatedType: "permitted_period",
              reason: "Activity outside permitted period (O)",
            };
      }
      return { satisfied: true };
    }
    case "required_equipment": {
      const required = String(constraint.params.equipmentId ?? "");
      if (required === "") return { satisfied: true };
      const hasEquipment = resources.some(
        (r) => r.id === required && activity.resourceIds.includes(r.id),
      );
      return hasEquipment
        ? { satisfied: true }
        : {
            satisfied: false,
            violatedType: "required_equipment",
            reason: "Required equipment missing (O)",
          };
    }
    case "required_qualification": {
      const requiredQualification = String(constraint.params.qualification ?? "");
      const instructorHas = Boolean(constraint.params[`qualification:${activity.instructorId}`]);
      return instructorHas || requiredQualification === ""
        ? { satisfied: true }
        : {
            satisfied: false,
            violatedType: "required_qualification",
            reason: "Instructor lacks required qualification (O)",
          };
    }
    case "prohibited_overlap": {
      const prohibitedId = String(constraint.params.prohibitedSubjectId ?? "");
      if (prohibitedId === "") return { satisfied: true };
      const conflicting = allActivities.some(
        (a) =>
          a.id !== activity.id &&
          a.subjectId === prohibitedId &&
          intervalsOverlap(a.interval, activity.interval),
      );
      return conflicting
        ? {
            satisfied: false,
            violatedType: "prohibited_overlap",
            reason: "Prohibited examination overlap (O)",
          }
        : { satisfied: true };
    }
    default:
      // Soft constraints are scored, not hard-failed (P).
      return { satisfied: true };
  }
}

/* ─────────────────────────────────────────────────────────────
 * Temporal constraints (T)
 * ────────────────────────────────────────────────────────────*/

export type TemporalRelation =
  | "before"
  | "after"
  | "during"
  | "not_during"
  | "overlap"
  | "non_overlap"
  | "minimum_gap"
  | "maximum_gap";

export const TEMPORAL_RELATIONS: readonly TemporalRelation[] = [
  "before",
  "after",
  "during",
  "not_during",
  "overlap",
  "non_overlap",
  "minimum_gap",
  "maximum_gap",
] as const;

export interface TemporalConstraintInput {
  relation: TemporalRelation;
  /** Reference interval or another activity's interval. */
  reference: TimeInterval;
  /** Gap in minutes for minimum_gap/maximum_gap. */
  gapMinutes?: number;
}

export type TemporalConstraintResult = { ok: true } | { ok: false; reason: string };

export function evaluateTemporalConstraint(
  input: TemporalConstraintInput,
  activityInterval: TimeInterval,
): TemporalConstraintResult {
  const a = Date.parse(activityInterval.start);
  const aEnd = Date.parse(activityInterval.end);
  const r = Date.parse(input.reference.start);
  const rEnd = Date.parse(input.reference.end);

  switch (input.relation) {
    case "before":
      return aEnd <= r
        ? { ok: true }
        : { ok: false, reason: "Activity must be before reference (T)" };
    case "after":
      return a >= rEnd
        ? { ok: true }
        : { ok: false, reason: "Activity must be after reference (T)" };
    case "during":
      return a >= r && aEnd <= rEnd
        ? { ok: true }
        : { ok: false, reason: "Activity must occur during reference (T)" };
    case "not_during":
      return a >= rEnd || aEnd <= r
        ? { ok: true }
        : { ok: false, reason: "Activity must not occur during reference (T)" };
    case "overlap":
      return a < rEnd && r < aEnd
        ? { ok: true }
        : { ok: false, reason: "Activity must overlap reference (T)" };
    case "non_overlap":
      return a >= rEnd || aEnd <= r
        ? { ok: true }
        : { ok: false, reason: "Activity must not overlap reference (T)" };
    case "minimum_gap": {
      const gap = input.gapMinutes ?? 0;
      const actualGap = a >= rEnd ? a - rEnd : r - aEnd;
      return actualGap / 60_000 >= gap
        ? { ok: true }
        : { ok: false, reason: `Minimum gap of ${gap} minutes required (T)` };
    }
    case "maximum_gap": {
      const gap = input.gapMinutes ?? 0;
      const actualGap = Math.abs(a - rEnd);
      return actualGap / 60_000 <= gap
        ? { ok: true }
        : { ok: false, reason: `Maximum gap of ${gap} minutes allowed (T)` };
    }
    default:
      return { ok: false, reason: "Unsupported temporal relation" };
  }
}
