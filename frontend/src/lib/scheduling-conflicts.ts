/**
 * CoreGrid — Scheduling & Timetable Intelligence: the conflict engine.
 *
 * A conflict is not an error message: it is a first-class record naming what collided, which
 * constraint was violated, how severe it is, and what could be done. The rule the blueprint
 * states most firmly (invariants EP.29/30/31) is enforced here: a hard-constraint conflict is
 * never resolved silently, and when nothing feasible exists the engine reports infeasibility
 * with the candidates it tried rather than inventing a valid-looking plan.
 *
 * Domain-neutral by construction: the engine schedules PARTICIPANTS and RESOURCES against TIME
 * under CONSTRAINTS. It never assumes what an organization calls them — a lecture, a theatre
 * slot, a delivery window, a shift, a hearing and a flight leg are all activities.
 */

/** The taxonomy of collisions a schedule can produce. */
export const CONFLICT_TYPES = [
  "time",
  "resource",
  "participant",
  "capacity",
  "capability",
  "policy",
  "travel",
  "accessibility",
  "calendar",
  "dependency",
  "publication",
  "concurrency",
] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

export const CONFLICT_SEVERITIES = ["critical", "major", "minor", "advisory"] as const;
export type ConflictSeverity = (typeof CONFLICT_SEVERITIES)[number];

export const CONFLICT_STATES = ["open", "proposed", "resolved", "waived", "escalated"] as const;
export type ConflictState = (typeof CONFLICT_STATES)[number];

/** How a conflict may be addressed. Waiving a hard constraint is not on this list. */
export const RESOLUTION_STRATEGIES = [
  "move_activity",
  "change_resource",
  "change_participant",
  "split_participants",
  "merge_compatible",
  "change_duration",
  "change_interval",
  "invoke_approved_exception",
  "escalate_to_human",
] as const;
export type ResolutionStrategy = (typeof RESOLUTION_STRATEGIES)[number];

/** An assignment: participants and resources occupying an interval for an activity. */
export interface SchedulingAssignment {
  id: string;
  tenantId: string;
  activityId: string;
  participants: readonly string[];
  resources: readonly string[];
  start: string;
  end: string;
  /** Timezone the interval is expressed in; every interval carries one. */
  timezone: string;
  /** Capability key to units required by the activity. */
  demands?: Readonly<Record<string, number>>;
  /** Minutes of travel needed from a resource to a named other resource. */
  travelMinutesFrom?: Readonly<Record<string, number>>;
  accessibilityRequirements?: readonly string[];
}

export interface SchedulingConstraintRef {
  id: string;
  kind: "hard" | "soft";
  type: string;
}

export interface SchedulingConflict {
  id: string;
  tenantId: string;
  type: ConflictType;
  severity: ConflictSeverity;
  assignments: readonly string[];
  entities: readonly string[];
  constraintId: string;
  constraintKind: "hard" | "soft";
  detail: string;
  detectedAt: string;
  state: ConflictState;
  proposedResolutions: readonly ResolutionStrategy[];
}

export interface DetectConflictsInput {
  tenantId: string;
  assignments: readonly SchedulingAssignment[];
  resourceCapacity?: Readonly<Record<string, number>>;
  resourceCapabilities?: Readonly<Record<string, readonly string[]>>;
  accessibleResources?: Readonly<Record<string, readonly string[]>>;
  constraints?: readonly SchedulingConstraintRef[];
  /** Periods in which nothing may be scheduled: holidays, maintenance, closures. */
  blockedPeriods?: readonly { id: string; start: string; end: string; reason: string }[];
  minimumTurnaroundMinutes?: number;
  now: string;
}

function overlaps(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
}

function minutesBetween(a: { end: string }, b: { start: string }): number {
  return Math.round((Date.parse(b.start) - Date.parse(a.end)) / 60000);
}

function resolutionsFor(type: ConflictType): readonly ResolutionStrategy[] {
  switch (type) {
    case "resource":
    case "capacity":
      return [
        "change_resource",
        "move_activity",
        "split_participants",
        "invoke_approved_exception",
      ];
    case "capability":
    case "accessibility":
      return ["change_resource", "invoke_approved_exception", "escalate_to_human"];
    case "participant":
      return ["move_activity", "change_participant", "split_participants", "escalate_to_human"];
    case "travel":
      return ["move_activity", "change_resource", "change_interval"];
    case "dependency":
      return ["change_interval", "move_activity", "escalate_to_human"];
    default:
      return ["move_activity", "change_interval", "escalate_to_human"];
  }
}

/** True when a conflict cannot be waived: it must be resolved or escalated. */
export function isBlocking(conflict: SchedulingConflict): boolean {
  return conflict.constraintKind === "hard" && conflict.severity === "critical";
}

/**
 * Detect every collision in a set of assignments. Detection is deterministic and independent of
 * any solver — this is the layer that decides whether a proposed plan is actually feasible.
 */
export function detectConflicts(input: DetectConflictsInput): readonly SchedulingConflict[] {
  const conflicts: SchedulingConflict[] = [];
  const hardByType = new Map<string, SchedulingConstraintRef>();
  for (const constraint of input.constraints ?? []) {
    if (constraint.kind === "hard" && !hardByType.has(constraint.type)) {
      hardByType.set(constraint.type, constraint);
    }
  }
  const constraintFor = (type: ConflictType): SchedulingConstraintRef =>
    hardByType.get(type) ?? { id: `implicit:${type}`, kind: "hard", type };

  const push = (
    type: ConflictType,
    severity: ConflictSeverity,
    involved: readonly SchedulingAssignment[],
    entities: readonly string[],
    detail: string,
  ) => {
    const constraint = constraintFor(type);
    conflicts.push({
      id: `conflict-${type}-${conflicts.length + 1}-${involved.map((a) => a.id).join("+")}`,
      tenantId: input.tenantId,
      type,
      severity,
      assignments: involved.map((assignment) => assignment.id),
      entities,
      constraintId: constraint.id,
      constraintKind: constraint.kind,
      detail,
      detectedAt: input.now,
      state: "open",
      proposedResolutions: resolutionsFor(type),
    });
  };

  for (const assignment of input.assignments) {
    if (Date.parse(assignment.end) <= Date.parse(assignment.start)) {
      push(
        "time",
        "critical",
        [assignment],
        [assignment.activityId],
        "The activity ends before it begins",
      );
    }
    if (assignment.timezone.trim() === "") {
      push(
        "time",
        "major",
        [assignment],
        [assignment.activityId],
        "The interval carries no timezone",
      );
    }
    for (const blocked of input.blockedPeriods ?? []) {
      if (overlaps(assignment, blocked)) {
        push(
          "calendar",
          "critical",
          [assignment],
          [assignment.activityId, blocked.id],
          `The activity falls inside a blocked period: ${blocked.reason}`,
        );
      }
    }
    for (const resourceRef of assignment.resources) {
      const capacity = input.resourceCapacity?.[resourceRef];
      if (capacity !== undefined && assignment.participants.length > capacity) {
        push(
          "capacity",
          "critical",
          [assignment],
          [resourceRef, assignment.activityId],
          `${assignment.participants.length} participants exceed the declared capacity of ${capacity}`,
        );
      }
      const required = Object.keys(assignment.demands ?? {});
      const capabilities = input.resourceCapabilities?.[resourceRef];
      if (required.length > 0 && capabilities !== undefined) {
        const missing = required.filter((key) => !capabilities.includes(key));
        if (missing.length > 0) {
          push(
            "capability",
            "critical",
            [assignment],
            [resourceRef, ...missing],
            `The resource cannot supply: ${missing.join(", ")}`,
          );
        }
      }
      const accessible = input.accessibleResources?.[resourceRef];
      const needed = assignment.accessibilityRequirements ?? [];
      if (needed.length > 0 && accessible !== undefined) {
        const missing = needed.filter((requirement) => !accessible.includes(requirement));
        if (missing.length > 0) {
          push(
            "accessibility",
            "major",
            [assignment],
            [resourceRef, ...missing],
            `The resource does not meet accessibility requirements: ${missing.join(", ")}`,
          );
        }
      }
    }
  }

  for (let i = 0; i < input.assignments.length; i += 1) {
    for (let j = i + 1; j < input.assignments.length; j += 1) {
      const a = input.assignments[i];
      const b = input.assignments[j];
      if (a.activityId === b.activityId) continue;

      const sharedParticipants = a.participants.filter((participant) =>
        b.participants.includes(participant),
      );
      const sharedResources = a.resources.filter((resourceRef) =>
        b.resources.includes(resourceRef),
      );

      if (sharedParticipants.length > 0 && overlaps(a, b)) {
        push(
          "participant",
          "critical",
          [a, b],
          sharedParticipants,
          `Participant(s) ${sharedParticipants.join(", ")} are required by two overlapping activities`,
        );
      }
      if (sharedResources.length > 0 && overlaps(a, b)) {
        push(
          "resource",
          "critical",
          [a, b],
          sharedResources,
          `Resource(s) ${sharedResources.join(", ")} are booked twice at once`,
        );
      }

      const turnaround = input.minimumTurnaroundMinutes ?? 0;
      for (const resourceRef of sharedResources) {
        if (overlaps(a, b)) continue;
        const [earlier, later] = Date.parse(a.end) <= Date.parse(b.start) ? [a, b] : [b, a];
        const gap = minutesBetween(earlier, later);
        if (gap >= 0 && gap < turnaround) {
          push(
            "resource",
            "major",
            [earlier, later],
            [resourceRef],
            `Only ${gap} minutes for turnaround, below the required ${turnaround}`,
          );
        }
      }

      for (const [targetResource, needed] of Object.entries(a.travelMinutesFrom ?? {})) {
        if (!b.resources.includes(targetResource)) continue;
        const [earlier, later] = Date.parse(a.end) <= Date.parse(b.start) ? [a, b] : [b, a];
        const gap = minutesBetween(earlier, later);
        if (gap >= 0 && gap < needed) {
          push(
            "travel",
            "major",
            [earlier, later],
            [targetResource, a.activityId, b.activityId],
            `${gap} minutes are available to reach ${targetResource}, which needs ${needed}`,
          );
        }
      }
    }
  }

  return conflicts;
}

export interface ConflictEscalation {
  feasible: boolean;
  blocking: readonly SchedulingConflict[];
  waivable: readonly SchedulingConflict[];
  /** What the organization can do next. Empty only when the plan is clean. */
  guidance: readonly string[];
}

/**
 * Classify conflicts into what blocks a plan and what only degrades it. This is the function a
 * publication gate calls: a plan with blocking conflicts cannot become active, and an infeasible
 * request is reported as infeasible with guidance, never returned as a valid schedule.
 */
export function escalateConflicts(conflicts: readonly SchedulingConflict[]): ConflictEscalation {
  const blocking = conflicts.filter(isBlocking);
  const waivable = conflicts.filter((conflict) => !isBlocking(conflict));
  const guidance: string[] = [];

  if (blocking.length > 0) {
    const types = Array.from(new Set(blocking.map((conflict) => conflict.type))).join(", ");
    guidance.push(`Resolve the blocking constraints before publication: ${types}.`);
    guidance.push("Relaxation of a hard constraint requires explicit governance, not a rewrite.");
    if (blocking.some((conflict) => conflict.type === "capacity")) {
      guidance.push("Split the participant group or add capacity at a resource that can host it.");
    }
    if (
      blocking.some(
        (conflict) => conflict.type === "capability" || conflict.type === "accessibility",
      )
    ) {
      guidance.push(
        "Reassign to a resource declaring the missing capability or access requirement.",
      );
    }
    if (blocking.some((conflict) => conflict.type === "calendar")) {
      guidance.push(
        "Move the activity outside the blocked period; blocked periods are policy, not preference.",
      );
    }
  }
  if (waivable.length > 0) {
    guidance.push(
      `${waivable.length} non-blocking issue(s) may be accepted only under the organization's stated policy.`,
    );
  }

  return { feasible: blocking.length === 0, blocking, waivable, guidance };
}
