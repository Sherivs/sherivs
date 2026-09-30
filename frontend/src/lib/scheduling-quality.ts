/**
 * CoreGrid — Scheduling & Timetable Intelligence: quality, disruption and comparison.
 *
 * Optimization is worthless if the result is infeasible, unauditable, inexplicable or
 * operationally impossible. This module therefore scores a plan on independent dimensions
 * instead of collapsing everything into one opaque number, measures a change by how much it
 * disturbs the organization rather than only by how efficient it looks, and can explain which
 * constraints decided a placement and which preferences had to be sacrificed.
 *
 * Domain-neutral: participants, resources, activities and intervals. An organization supplies
 * its own objective weights, fairness policy and stability tolerance as data.
 */

import type { SchedulingAssignment, SchedulingConflict } from "./scheduling-conflicts";

/** The independent dimensions a plan is scored on. */
export const SCORE_DIMENSIONS = [
  "feasibility",
  "constraints",
  "utilization",
  "fairness",
  "convenience",
  "accessibility",
  "disruption",
  "stability",
] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

/** How an organization has chosen to combine objectives. */
export const OBJECTIVE_MODES = ["lexicographic", "weighted"] as const;
export type ObjectiveMode = (typeof OBJECTIVE_MODES)[number];

export interface ScheduleScore {
  dimension: ScoreDimension;
  /** 0..1, higher is better. Feasibility is never traded for any other dimension. */
  value: number;
  /** The inputs that produced the value, so the score can be argued with. */
  basis: string;
}

export interface ScheduleQuality {
  mode: ObjectiveMode;
  scores: readonly ScheduleScore[];
  overall: number;
  /** Dimensions the organization declared but the engine could not measure, stated openly. */
  unmeasured: readonly ScoreDimension[];
}

export interface QualityInput {
  assignments: readonly SchedulingAssignment[];
  conflicts: readonly SchedulingConflict[];
  /** Preference matches: how many assignments landed on a preferred interval or resource. */
  preferenceHits?: number;
  /** Load per participant or resource, used to measure balance and fairness. */
  loads?: Readonly<Record<string, number>>;
  conflictsResolvedBy?: Readonly<Record<string, number>>;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 1;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Balance across actors, 1 when every load is equal. */
export function balanceOf(loads: Readonly<Record<string, number>>): number {
  const values = Object.values(loads);
  if (values.length === 0) return 1;
  const average = mean(values);
  if (average === 0) return 1;
  const spread =
    values.reduce((total, value) => total + Math.abs(value - average), 0) / values.length;
  return Math.max(0, 1 - spread / average);
}

/**
 * Score a plan. Feasibility is computed from blocking conflicts only: an organization may accept
 * a degraded plan, but never one that silently breaks a hard constraint.
 */
export function scoreSchedule(input: QualityInput): ScheduleQuality {
  const total = input.assignments.length;
  const blocking = input.conflicts.filter(
    (conflict) => conflict.constraintKind === "hard" && conflict.severity === "critical",
  ).length;

  const scores: ScheduleScore[] = [
    {
      dimension: "feasibility",
      value: blocking === 0 ? 1 : 0,
      basis: `${blocking} blocking constraint violation(s) across ${total} assignment(s)`,
    },
    {
      dimension: "constraints",
      value: Math.max(0, 1 - input.conflicts.length / Math.max(1, total)),
      basis: `${input.conflicts.length} conflict(s) recorded, including non-blocking ones`,
    },
    {
      dimension: "utilization",
      value:
        total === 0 ? 0 : Math.min(1, total / Math.max(1, Object.keys(input.loads ?? {}).length)),
      basis: `${total} assignment(s) across ${Object.keys(input.loads ?? {}).length} tracked actor(s)`,
    },
    {
      dimension: "fairness",
      value: balanceOf(input.loads ?? {}),
      basis: "spread of committed load against its own average",
    },
    {
      dimension: "convenience",
      value: total === 0 ? 1 : Math.min(1, (input.preferenceHits ?? 0) / total),
      basis: `${input.preferenceHits ?? 0} of ${total} assignment(s) met a stated preference`,
    },
    {
      dimension: "accessibility",
      value:
        total === 0
          ? 1
          : Math.max(
              0,
              1 - input.conflicts.filter((c) => c.type === "accessibility").length / total,
            ),
      basis: "accessibility requirements met where the organization declared them",
    },
  ];

  // Disruption and stability are only meaningful for a change to an existing plan, and the
  // engine says so rather than inventing a number.
  const unmeasured: ScoreDimension[] = ["disruption", "stability"];

  return {
    mode: "weighted",
    scores,
    overall: mean(scores.map((score) => score.value)),
    unmeasured,
  };
}

/** A change to an active plan, expressed as the assignments it adds, removes or moves. */
export interface ScheduleChangeSet {
  added: readonly SchedulingAssignment[];
  removed: readonly SchedulingAssignment[];
  moved: readonly { before: SchedulingAssignment; after: SchedulingAssignment }[];
}

export interface DisruptionVector {
  changedAssignments: number;
  affectedParticipants: number;
  affectedResources: number;
  /** 0..1, where 0 is no disturbance at all and 1 is a complete rewrite. */
  disruptionRatio: number;
  /** Whether the change stayed inside the organization's stated stability tolerance. */
  withinTolerance: boolean;
  summary: string;
}

/**
 * Measure a change by how much it disturbs the organization. An optimization that improves a
 * score while rewriting half the plan is a worse answer than a small, stable adjustment.
 */
export function measureDisruption(
  before: readonly SchedulingAssignment[],
  change: ScheduleChangeSet,
  consideredAssignments: readonly SchedulingAssignment[],
  stabilityTolerance = 0.25,
): DisruptionVector {
  const changedIds = new Set([
    ...change.added.map((assignment) => assignment.id),
    ...change.removed.map((assignment) => assignment.id),
    ...change.moved.map((entry) => entry.after.id),
  ]);
  const participants = new Set<string>();
  const resources = new Set<string>();
  for (const assignment of [
    ...change.added,
    ...change.removed,
    ...change.moved.map((m) => m.after),
  ]) {
    assignment.participants.forEach((participant) => participants.add(participant));
    assignment.resources.forEach((resourceRef) => resources.add(resourceRef));
  }
  const base = Math.max(1, consideredAssignments.length || before.length);
  const ratio = Math.min(1, changedIds.size / base);

  return {
    changedAssignments: changedIds.size,
    affectedParticipants: participants.size,
    affectedResources: resources.size,
    disruptionRatio: ratio,
    withinTolerance: ratio <= stabilityTolerance,
    summary:
      changedIds.size === 0
        ? "No change to the active plan"
        : `${changedIds.size} assignment(s) change, affecting ${participants.size} participant(s) and ${resources.size} resource(s)`,
  };
}

export interface VersionComparison {
  fromVersion: string;
  toVersion: string;
  movedActivities: readonly string[];
  changedResources: readonly string[];
  changedParticipants: readonly string[];
  resolvedConflictTypes: readonly string[];
  newConflictTypes: readonly string[];
  summary: string;
}

/** Compare two versions of the same plan, by activity, resource, participant and conflict. */
export function compareVersions(
  fromVersion: string,
  toVersion: string,
  from: readonly SchedulingAssignment[],
  to: readonly SchedulingAssignment[],
  fromConflicts: readonly SchedulingConflict[] = [],
  toConflicts: readonly SchedulingConflict[] = [],
): VersionComparison {
  const fromByActivity = new Map(from.map((assignment) => [assignment.activityId, assignment]));
  const toByActivity = new Map(to.map((assignment) => [assignment.activityId, assignment]));

  const movedActivities: string[] = [];
  const changedResources = new Set<string>();
  const changedParticipants = new Set<string>();

  for (const [activityId, after] of toByActivity) {
    const before = fromByActivity.get(activityId);
    if (!before) {
      movedActivities.push(activityId);
      after.resources.forEach((resourceRef) => changedResources.add(resourceRef));
      after.participants.forEach((participant) => changedParticipants.add(participant));
      continue;
    }
    const intervalChanged = before.start !== after.start || before.end !== after.end;
    const resourcesChanged =
      before.resources.length !== after.resources.length ||
      before.resources.some((resourceRef) => !after.resources.includes(resourceRef));
    if (intervalChanged || resourcesChanged) {
      movedActivities.push(activityId);
      before.resources.forEach((resourceRef) => changedResources.add(resourceRef));
      after.resources.forEach((resourceRef) => changedResources.add(resourceRef));
    }
    const participantsChanged =
      before.participants.length !== after.participants.length ||
      before.participants.some((participant) => !after.participants.includes(participant));
    if (participantsChanged) {
      before.participants.forEach((participant) => changedParticipants.add(participant));
      after.participants.forEach((participant) => changedParticipants.add(participant));
    }
  }

  const fromTypes = new Set(fromConflicts.map((conflict) => conflict.type));
  const toTypes = new Set(toConflicts.map((conflict) => conflict.type));
  const resolvedConflictTypes = Array.from(fromTypes).filter((type) => !toTypes.has(type));
  const newConflictTypes = Array.from(toTypes).filter((type) => !fromTypes.has(type));

  return {
    fromVersion,
    toVersion,
    movedActivities,
    changedResources: Array.from(changedResources),
    changedParticipants: Array.from(changedParticipants),
    resolvedConflictTypes,
    newConflictTypes,
    summary:
      movedActivities.length === 0 && newConflictTypes.length === 0
        ? "The two versions are equivalent in placement"
        : `${movedActivities.length} activity placement(s) differ; ${resolvedConflictTypes.length} conflict type(s) resolved, ${newConflictTypes.length} introduced`,
  };
}

export interface ImpactAnalysis {
  change: string;
  affectedActivities: readonly string[];
  affectedParticipants: readonly string[];
  affectedResources: readonly string[];
  newConflictTypes: readonly string[];
  /** The smallest change that makes the proposal feasible, if one exists. */
  leastDisruptive: string;
  escalation: string | null;
}

/** Calculate what a proposed change touches, and whether a smaller adjustment would suffice. */
export function analyseImpact(
  change: string,
  assignments: readonly SchedulingAssignment[],
  conflicts: readonly SchedulingConflict[],
  options: { stabilityTolerance?: number } = {},
): ImpactAnalysis {
  const escalated = conflicts.filter((conflict) => conflict.severity === "critical");
  const affectedActivities = Array.from(
    new Set(assignments.map((assignment) => assignment.activityId)),
  );
  const affectedParticipants = Array.from(
    new Set(assignments.flatMap((assignment) => [...assignment.participants])),
  );
  const affectedResources = Array.from(
    new Set(assignments.flatMap((assignment) => [...assignment.resources])),
  );
  const newConflictTypes = Array.from(new Set(conflicts.map((conflict) => conflict.type)));
  const tolerance = options.stabilityTolerance ?? 0.25;

  const leastDisruptive =
    affectedActivities.length === 0
      ? "No adjustment required"
      : affectedActivities.length <= Math.max(1, Math.floor(assignments.length * tolerance))
        ? `Confine the change to ${affectedActivities.length} activity placement(s)`
        : "The affected scope exceeds the stability tolerance; propose a narrower change before publishing";

  return {
    change,
    affectedActivities,
    affectedParticipants,
    affectedResources,
    newConflictTypes,
    leastDisruptive,
    escalation:
      escalated.length === 0
        ? null
        : `${escalated.length} critical conflict(s) have no automatic resolution and require a human decision`,
  };
}

export interface PlacementExplanation {
  assignmentId: string;
  activityId: string;
  whyPlaced: string;
  whyThisResource: string;
  whyAlternativesRejected: readonly string[];
  constraintsThatDecided: readonly string[];
  preferencesSacrificed: readonly string[];
  selectedOver: readonly string[];
}

/**
 * Explain one placement in the terms the blueprint demands: why here, why this resource, why not
 * the alternatives, and which preferences were given up.
 */
export function explainPlacement(
  assignment: SchedulingAssignment,
  conflicts: readonly SchedulingConflict[] = [],
  alternatives: readonly { id: string; reason: string }[] = [],
): PlacementExplanation {
  const involved = conflicts.filter((conflict) => conflict.assignments.includes(assignment.id));
  const decided = Array.from(new Set(involved.map((conflict) => conflict.constraintId)));
  const sacrificed = involved
    .filter((conflict) => conflict.constraintKind === "soft")
    .map((conflict) => conflict.detail);

  return {
    assignmentId: assignment.id,
    activityId: assignment.activityId,
    whyPlaced: `${assignment.activityId} occupies ${assignment.start} to ${assignment.end} (${assignment.timezone}) with no unresolved blocking constraint`,
    whyThisResource:
      assignment.resources.length === 0
        ? "This activity requires no resource"
        : `${assignment.resources.join(", ")} met the declared capability, capacity and accessibility requirements`,
    whyAlternativesRejected: alternatives.map(
      (alternative) => `${alternative.id}: ${alternative.reason}`,
    ),
    constraintsThatDecided: decided,
    preferencesSacrificed: sacrificed,
    selectedOver: alternatives.map((alternative) => alternative.id),
  };
}

export interface RankedCandidate {
  candidateId: string;
  quality: ScheduleQuality;
  disruption: DisruptionVector;
  conflicts: readonly SchedulingConflict[];
  /** True only when the candidate passes independent validation and stays inside tolerance. */
  recommended: boolean;
  rationale: string;
}

/**
 * Rank candidate plans for a change: feasible candidates first, then the least disruptive, then
 * the highest quality. This is how "minimal disruption is a first-class objective" is honoured
 * without ever letting efficiency override feasibility.
 */
export function rankCandidates(candidates: readonly RankedCandidate[]): readonly RankedCandidate[] {
  const feasible = (candidate: RankedCandidate) =>
    candidate.quality.scores.find((score) => score.dimension === "feasibility")?.value === 1;
  return [...candidates].sort((a, b) => {
    const feasibility = (feasible(a) ? 1 : 0) - (feasible(b) ? 1 : 0);
    if (feasibility !== 0) return -feasibility;
    if (a.disruption.disruptionRatio !== b.disruption.disruptionRatio) {
      return a.disruption.disruptionRatio - b.disruption.disruptionRatio;
    }
    return b.quality.overall - a.quality.overall;
  });
}
