/**
 * Sherivs — Scheduling & Timetable Intelligence core domain model
 * (Phase 12).
 *
 * Implements `architecture/phase-12-scheduling-intelligence.md`:
 * - Time model (I): instant, date, time, duration, time interval, recurring
 *   interval, academic period, semester, term, holiday, blackout period,
 *   examination period. All timestamps have explicit timezone context.
 * - Recurrence (J): daily, weekly, biweekly, monthly, custom, academic-week,
 *   semester; exception dates. Recurring schedules must not create
 *   uncontrolled duplicate instances.
 * - Calendars (K): institution, academic, department, course, instructor,
 *   learner, facility, examination, public-holiday calendars; calendar
 *   precedence must be explicitly defined.
 * - Availability (L): preferred, allowed, unavailable, mandatory — for
 *   teachers, rooms, learners, equipment, campuses.
 * - Schedule lifecycle (G): invalid schedules must never become ACTIVE.
 * - Schedule versioning (H): every meaningful modification creates a new
 *   version recording version ID, parent version, creator, timestamp,
 *   reason, affected assignments, validation status, approval status,
 *   publication status; previously published versions remain reconstructable.
 *
 * Boundaries:
 * - D.2 tenancy: every schedule operates inside an authorized tenant.
 * - D.3 Phase 04 provides educational reality (classes, subjects,
 *   facilities); Phase 12 converts these into schedules via references.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Time model (I)
 * ────────────────────────────────────────────────────────────*/

export interface TimeInterval {
  start: string;
  end: string;
  /** All timestamps carry explicit timezone context (I). */
  timezone: string;
}

export function createTimeInterval(start: string, end: string, timezone: string): TimeInterval {
  if (Date.parse(end) <= Date.parse(start)) {
    throw new Error("Time interval end must be after start (I)");
  }
  return { start, end, timezone };
}

export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  // Intervals overlap when neither fully precedes the other. The timezone
  // fields must agree; a caller comparing across timezones must normalize
  // first (I).
  if (a.timezone !== b.timezone) return false;
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
}

export function intervalDurationMinutes(interval: TimeInterval): number {
  return (Date.parse(interval.end) - Date.parse(interval.start)) / 60_000;
}

/* ─────────────────────────────────────────────────────────────
 * Recurrence (J)
 * ────────────────────────────────────────────────────────────*/

export type RecurrencePattern =
  "daily" | "weekly" | "biweekly" | "monthly" | "custom" | "academic_week" | "semester";

export const RECURRENCE_PATTERNS: readonly RecurrencePattern[] = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "custom",
  "academic_week",
  "semester",
] as const;

export interface RecurrenceRule {
  pattern: RecurrencePattern;
  /** Optional step (e.g. every 2 weeks). */
  interval: number;
  exceptionDates: string[];
  endDate: string | null;
}

export interface CreateRecurrenceRuleInput {
  pattern: RecurrencePattern;
  interval?: number;
  exceptionDates?: string[];
  endDate?: string | null;
  /** Explicit evaluation timestamp (I): keeps the domain function pure. */
  now: string;
}

export type CreateRecurrenceRuleResult =
  { ok: true; rule: RecurrenceRule } | { ok: false; error: string };

export function createRecurrenceRule(input: CreateRecurrenceRuleInput): CreateRecurrenceRuleResult {
  const interval = input.interval ?? 1;
  if (interval < 1) {
    return { ok: false, error: "Recurrence interval must be at least 1 (J)" };
  }
  if (
    input.endDate !== null &&
    input.endDate !== undefined &&
    Date.parse(input.endDate) < Date.parse(input.now)
  ) {
    return { ok: false, error: "Recurrence end date must be after the current time (J)" };
  }
  return {
    ok: true,
    rule: {
      pattern: input.pattern,
      interval,
      exceptionDates: input.exceptionDates ?? [],
      endDate: input.endDate ?? null,
    },
  };
}

export function isRecurrenceActive(rule: RecurrenceRule, now: string): boolean {
  if (rule.endDate !== null && Date.parse(now) > Date.parse(rule.endDate)) return false;
  return true;
}

/**
 * Generate the occurrence dates of a recurrence within a window. Exception
 * dates are excluded so recurring schedules never create uncontrolled
 * duplicate instances (J). Daily patterns step by 1 day × interval; weekly,
 * biweekly, academic-week, and semester patterns step by 7 days × interval.
 */
export function expandRecurrence(
  rule: RecurrenceRule,
  anchorStart: string,
  windowEnd: string,
): string[] {
  const occurrences: string[] = [];
  const isDaily = rule.pattern === "daily";
  const stepMs = rule.interval * (isDaily ? 86_400_000 : 7 * 86_400_000);
  let cursor = Date.parse(anchorStart);
  const end = Math.min(
    Date.parse(windowEnd),
    rule.endDate !== null ? Date.parse(rule.endDate) : Infinity,
  );
  const exceptionSet = new Set(rule.exceptionDates);
  while (cursor <= end) {
    if (!exceptionSet.has(new Date(cursor).toISOString())) {
      occurrences.push(new Date(cursor).toISOString());
    }
    cursor += stepMs;
  }
  return occurrences;
}

/* ─────────────────────────────────────────────────────────────
 * Calendars (K)
 * ────────────────────────────────────────────────────────────*/

export type CalendarKind =
  | "institution"
  | "academic"
  | "department"
  | "course"
  | "instructor"
  | "learner"
  | "facility"
  | "examination"
  | "public_holiday";

export const CALENDAR_KINDS: readonly CalendarKind[] = [
  "institution",
  "academic",
  "department",
  "course",
  "instructor",
  "learner",
  "facility",
  "examination",
  "public_holiday",
] as const;

export interface CalendarEntry {
  id: string;
  tenantId: TenantId;
  kind: CalendarKind;
  name: string;
  interval: TimeInterval;
  /** Explicit precedence; lower numbers win (K). */
  precedence: number;
}

export interface CreateCalendarEntryInput {
  tenantId: TenantId;
  kind: CalendarKind;
  name: string;
  interval: TimeInterval;
  precedence: number;
}

export type CreateCalendarEntryResult =
  { ok: true; entry: CalendarEntry } | { ok: false; error: string };

export function createCalendarEntry(input: CreateCalendarEntryInput): CreateCalendarEntryResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Calendar entry name is required (K)" };
  }
  return {
    ok: true,
    entry: {
      id: `cal-${input.tenantId}-${input.kind}-${input.interval.start}`,
      tenantId: input.tenantId,
      kind: input.kind,
      name: input.name,
      interval: input.interval,
      precedence: input.precedence,
    },
  };
}

/**
 * Resolve whether an interval is blocked according to calendar precedence
 * (K): the highest-precedence covering calendar determines the answer.
 */
export function isBlockedByCalendar(
  entries: CalendarEntry[],
  interval: TimeInterval,
  tenantId: TenantId,
): { blocked: boolean; byCalendar: string | null } {
  const covering = entries
    .filter((e) => e.tenantId === tenantId && intervalsOverlap(e.interval, interval))
    .sort((a, b) => a.precedence - b.precedence);
  if (covering.length === 0) return { blocked: false, byCalendar: null };
  const highest = covering[0];
  return { blocked: true, byCalendar: highest.name };
}

/* ─────────────────────────────────────────────────────────────
 * Scheduling resources
 * ────────────────────────────────────────────────────────────*/

export type ScheduleResourceType = "room" | "laboratory" | "equipment" | "campus" | "other";

export const SCHEDULE_RESOURCE_TYPES: readonly ScheduleResourceType[] = [
  "room",
  "laboratory",
  "equipment",
  "campus",
  "other",
] as const;

export interface ScheduleResource {
  id: string;
  tenantId: TenantId;
  type: ScheduleResourceType;
  name: string;
  capacity: number;
}

export interface CreateScheduleResourceInput {
  id: string;
  tenantId: TenantId;
  type: ScheduleResourceType;
  name: string;
  capacity: number;
}

export type CreateScheduleResourceResult =
  { ok: true; resource: ScheduleResource } | { ok: false; error: string };

export function createScheduleResource(
  input: CreateScheduleResourceInput,
): CreateScheduleResourceResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Resource name is required" };
  }
  if (input.capacity <= 0) {
    return { ok: false, error: "Resource capacity must be positive (O)" };
  }
  return {
    ok: true,
    resource: {
      id: input.id,
      tenantId: input.tenantId,
      type: input.type,
      name: input.name,
      capacity: input.capacity,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Scheduled activity (session)
 * ────────────────────────────────────────────────────────────*/

export interface ScheduledActivity {
  id: string;
  tenantId: TenantId;
  /** Academic subject/course reference (Phase 04 structure). */
  subjectId: string;
  /** Class/cohort reference (Phase 04 structure). */
  classId: string;
  instructorId: string;
  learnerIds: string[];
  resourceIds: string[];
  interval: TimeInterval;
  /** Minimum required room capacity (hard constraint check, O). */
  requiredCapacity: number;
}

export interface CreateScheduledActivityInput {
  tenantId: TenantId;
  subjectId: string;
  classId: string;
  instructorId: string;
  learnerIds: string[];
  resourceIds: string[];
  interval: TimeInterval;
  requiredCapacity: number;
}

export type CreateScheduledActivityResult =
  { ok: true; activity: ScheduledActivity } | { ok: false; error: string };

export function createScheduledActivity(
  input: CreateScheduledActivityInput,
): CreateScheduledActivityResult {
  if (input.subjectId.trim() === "" || input.classId.trim() === "") {
    return { ok: false, error: "Activity requires a subject and class (D.3)" };
  }
  if (input.instructorId.trim() === "") {
    return { ok: false, error: "Activity requires an instructor (O)" };
  }
  if (input.requiredCapacity <= 0) {
    return { ok: false, error: "Required capacity must be positive (O)" };
  }
  return {
    ok: true,
    activity: {
      id: `activity-${input.tenantId}-${input.classId}-${input.interval.start}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      classId: input.classId,
      instructorId: input.instructorId,
      learnerIds: input.learnerIds,
      resourceIds: input.resourceIds,
      interval: input.interval,
      requiredCapacity: input.requiredCapacity,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Deterministic weekly timetable solver (Phase 12, AX–BF)
 * ────────────────────────────────────────────────────────────*/

export interface SolverPeriod {
  id: string;
  /** ISO weekday: Monday = 1, Sunday = 7. */
  dayOfWeek: number;
  periodNumber: number;
  startMinute: number;
  endMinute: number;
}

export interface SolverClassArm {
  id: string;
  learnerCount: number;
}

export interface SolverInstructor {
  id: string;
  qualifiedSubjectIds: string[];
  /** If omitted, the instructor may be considered for every period. */
  availablePeriodIds?: string[];
  unavailablePeriodIds?: string[];
  preferredPeriodIds?: string[];
}

export interface SolverRoom {
  id: string;
  type: string;
  capacity: number;
  availablePeriodIds?: string[];
  unavailablePeriodIds?: string[];
}

export interface SolverTeachingLoad {
  classArmId: string;
  subjectId: string;
  periodsPerWeek: number;
  /** When supplied, restricts the qualified instructors considered. */
  instructorIds?: string[];
  requiredRoomType?: string;
  heavy?: boolean;
}

export interface SolveWeeklyTimetableInput {
  seed: number | string;
  periods: SolverPeriod[];
  classArms: SolverClassArm[];
  instructors: SolverInstructor[];
  rooms: SolverRoom[];
  teachingLoads: SolverTeachingLoad[];
}

export interface TimetablePlacement {
  activityId: string;
  classArmId: string;
  subjectId: string;
  periodId: string;
  instructorId: string;
  roomId: string;
  score: number;
  hardConstraints: string[];
  explanation: string[];
}

export interface UnplacedTimetableActivity {
  activityId: string;
  classArmId: string;
  subjectId: string;
  explanation: string[];
}

export interface SolveWeeklyTimetableResult {
  seed: number | string;
  requestedActivityCount: number;
  placements: TimetablePlacement[];
  unplaced: UnplacedTimetableActivity[];
  /** Mean placement score across all requested activities; unplaced activities score zero. */
  qualityScore: number;
}

interface SolverActivity {
  activityId: string;
  classArmId: string;
  subjectId: string;
  sequence: number;
  periodsPerWeek: number;
  requiredRoomType?: string;
  heavy: boolean;
  instructors: SolverInstructor[];
  rooms: SolverRoom[];
}

interface SolverPlacementState extends TimetablePlacement {
  dayOfWeek: number;
  periodNumber: number;
  heavy: boolean;
}

function assertUniqueIds<T extends { id: string }>(items: T[], name: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.id.trim() === "" || ids.has(item.id)) {
      throw new Error(`${name} IDs must be non-empty and unique`);
    }
    ids.add(item.id);
  }
}

function hashSeededValue(seed: number | string, value: string): number {
  let hash = 2166136261;
  const input = `${seed}\u0000${value}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function validateSolverInput(input: SolveWeeklyTimetableInput): void {
  if (typeof input.seed === "number" && !Number.isFinite(input.seed)) {
    throw new Error("Solver seed must be finite");
  }
  assertUniqueIds(input.periods, "Period");
  assertUniqueIds(input.classArms, "Class-arm");
  assertUniqueIds(input.instructors, "Instructor");
  assertUniqueIds(input.rooms, "Room");

  const periodIds = new Set(input.periods.map((period) => period.id));
  const periodNumbers = new Set<string>();
  const periodsByDay = new Map<number, SolverPeriod[]>();
  for (const period of input.periods) {
    if (
      !Number.isInteger(period.dayOfWeek) ||
      period.dayOfWeek < 1 ||
      period.dayOfWeek > 7 ||
      !Number.isInteger(period.periodNumber) ||
      period.periodNumber < 1 ||
      !Number.isInteger(period.startMinute) ||
      !Number.isInteger(period.endMinute) ||
      period.startMinute < 0 ||
      period.endMinute > 1440 ||
      period.endMinute <= period.startMinute
    ) {
      throw new Error(`Period ${period.id} has invalid time data`);
    }
    const dayNumber = `${period.dayOfWeek}:${period.periodNumber}`;
    if (periodNumbers.has(dayNumber)) throw new Error("Period numbers must be unique per day");
    periodNumbers.add(dayNumber);
    const sameDay = periodsByDay.get(period.dayOfWeek) ?? [];
    sameDay.push(period);
    periodsByDay.set(period.dayOfWeek, sameDay);
  }
  for (const sameDay of periodsByDay.values()) {
    sameDay.sort((a, b) => a.startMinute - b.startMinute);
    for (let index = 1; index < sameDay.length; index += 1) {
      if (sameDay[index].startMinute < sameDay[index - 1].endMinute) {
        throw new Error("Solver periods must not overlap");
      }
    }
  }

  const classArmIds = new Set(input.classArms.map((arm) => arm.id));
  const instructorIds = new Set(input.instructors.map((instructor) => instructor.id));
  const checkPeriodRefs = (ids: string[] | undefined, entityId: string): void => {
    for (const id of ids ?? []) {
      if (!periodIds.has(id)) throw new Error(`${entityId} references unknown period ${id}`);
    }
  };
  for (const arm of input.classArms) {
    if (!Number.isInteger(arm.learnerCount) || arm.learnerCount < 0) {
      throw new Error(`Class arm ${arm.id} has invalid learner count`);
    }
  }
  for (const instructor of input.instructors) {
    checkPeriodRefs(instructor.availablePeriodIds, `Instructor ${instructor.id}`);
    checkPeriodRefs(instructor.unavailablePeriodIds, `Instructor ${instructor.id}`);
    checkPeriodRefs(instructor.preferredPeriodIds, `Instructor ${instructor.id}`);
  }
  for (const room of input.rooms) {
    if (room.type.trim() === "" || !Number.isFinite(room.capacity) || room.capacity <= 0) {
      throw new Error(`Room ${room.id} has invalid type or capacity`);
    }
    checkPeriodRefs(room.availablePeriodIds, `Room ${room.id}`);
    checkPeriodRefs(room.unavailablePeriodIds, `Room ${room.id}`);
  }

  const loadKeys = new Set<string>();
  for (const load of input.teachingLoads) {
    if (!classArmIds.has(load.classArmId)) {
      throw new Error(`Teaching load references unknown class arm ${load.classArmId}`);
    }
    if (
      load.subjectId.trim() === "" ||
      !Number.isInteger(load.periodsPerWeek) ||
      load.periodsPerWeek < 1
    ) {
      throw new Error("Teaching loads require a subject and positive periods per week");
    }
    if (load.instructorIds?.some((id) => !instructorIds.has(id))) {
      throw new Error(`Teaching load for ${load.subjectId} references an unknown instructor`);
    }
    const loadKey = JSON.stringify([load.classArmId, load.subjectId]);
    if (loadKeys.has(loadKey))
      throw new Error("Teaching loads must be unique per class arm and subject");
    loadKeys.add(loadKey);
  }
}

function isPeriodAvailable(
  periodId: string,
  availablePeriodIds: string[] | undefined,
  unavailablePeriodIds: string[] | undefined,
): boolean {
  return (
    !(unavailablePeriodIds ?? []).includes(periodId) &&
    (availablePeriodIds === undefined || availablePeriodIds.includes(periodId))
  );
}

function getDailyGaps(periodNumbers: number[]): number {
  const ordered = [...periodNumbers].sort((a, b) => a - b);
  let gaps = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    gaps += Math.max(0, ordered[index] - ordered[index - 1] - 1);
  }
  return gaps;
}

/**
 * Places weekly teaching loads without violating hard constraints. Candidate
 * ties use the supplied seed; soft preferences only influence which feasible
 * placement is selected. Every requested activity is returned as either a
 * placement with its reasons or an unplaced activity with the blocking reasons.
 */
export function solveWeeklyTimetable(input: SolveWeeklyTimetableInput): SolveWeeklyTimetableResult {
  validateSolverInput(input);

  const armById = new Map(input.classArms.map((arm) => [arm.id, arm]));
  const activities: SolverActivity[] = [];

  for (const load of input.teachingLoads) {
    const instructors = input.instructors
      .filter(
        (instructor) =>
          instructor.qualifiedSubjectIds.includes(load.subjectId) &&
          (load.instructorIds === undefined || load.instructorIds.includes(instructor.id)),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const requiredCapacity = armById.get(load.classArmId)?.learnerCount ?? 0;
    const rooms = input.rooms
      .filter(
        (room) =>
          room.capacity >= requiredCapacity &&
          (load.requiredRoomType === undefined || room.type === load.requiredRoomType),
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    for (let sequence = 1; sequence <= load.periodsPerWeek; sequence += 1) {
      activities.push({
        activityId: JSON.stringify([load.classArmId, load.subjectId, sequence]),
        classArmId: load.classArmId,
        subjectId: load.subjectId,
        sequence,
        periodsPerWeek: load.periodsPerWeek,
        requiredRoomType: load.requiredRoomType,
        heavy: load.heavy ?? false,
        instructors,
        rooms,
      });
    }
  }

  activities.sort((a, b) => {
    const aDomainSize = a.instructors.length * a.rooms.length * input.periods.length;
    const bDomainSize = b.instructors.length * b.rooms.length * input.periods.length;
    if (aDomainSize !== bDomainSize) return aDomainSize - bDomainSize;
    return (
      hashSeededValue(input.seed, a.activityId) - hashSeededValue(input.seed, b.activityId) ||
      a.activityId.localeCompare(b.activityId)
    );
  });

  const classOccupancy = new Map<string, Set<string>>();
  const instructorOccupancy = new Map<string, Set<string>>();
  const roomOccupancy = new Map<string, Set<string>>();
  const classPlacements = new Map<string, SolverPlacementState[]>();
  const instructorPlacements = new Map<string, SolverPlacementState[]>();
  const placements: SolverPlacementState[] = [];
  const unplaced: UnplacedTimetableActivity[] = [];
  const occupancyKey = (entityId: string, periodId: string): string =>
    JSON.stringify([entityId, periodId]);

  for (const activity of activities) {
    const reasons = new Set<string>();
    const orderedPeriods = [...input.periods].sort(
      (a, b) =>
        hashSeededValue(input.seed, `${activity.activityId}:${a.id}`) -
          hashSeededValue(input.seed, `${activity.activityId}:${b.id}`) || a.id.localeCompare(b.id),
    );
    const orderedInstructors = [...activity.instructors].sort(
      (a, b) =>
        hashSeededValue(input.seed, `${activity.activityId}:${a.id}`) -
          hashSeededValue(input.seed, `${activity.activityId}:${b.id}`) || a.id.localeCompare(b.id),
    );
    const orderedRooms = [...activity.rooms].sort(
      (a, b) =>
        hashSeededValue(input.seed, `${activity.activityId}:${a.id}`) -
          hashSeededValue(input.seed, `${activity.activityId}:${b.id}`) || a.id.localeCompare(b.id),
    );
    let best:
      | {
          period: SolverPeriod;
          instructor: SolverInstructor;
          room: SolverRoom;
          penalty: number;
          tieBreak: number;
          explanation: string[];
        }
      | undefined;

    if (activity.instructors.length === 0) {
      reasons.add(`No assigned and qualified instructor is available for ${activity.subjectId}`);
    }
    if (activity.rooms.length === 0) {
      reasons.add(
        `No room meets the capacity${activity.requiredRoomType ? ` and type (${activity.requiredRoomType})` : ""} requirement`,
      );
    }

    periodCandidates: for (const period of orderedPeriods) {
      if (classOccupancy.get(activity.classArmId)?.has(period.id)) {
        reasons.add("The class arm is already scheduled in every remaining feasible period");
        continue;
      }
      const availableInstructors = orderedInstructors.filter((instructor) =>
        isPeriodAvailable(
          period.id,
          instructor.availablePeriodIds,
          instructor.unavailablePeriodIds,
        ),
      );
      if (availableInstructors.length === 0 && activity.instructors.length > 0) {
        reasons.add("Qualified instructors are unavailable during the remaining periods");
        continue;
      }
      const availableRooms = orderedRooms.filter((room) =>
        isPeriodAvailable(period.id, room.availablePeriodIds, room.unavailablePeriodIds),
      );
      if (availableRooms.length === 0 && activity.rooms.length > 0) {
        reasons.add("Suitable rooms are unavailable during the remaining periods");
        continue;
      }

      for (const instructor of availableInstructors) {
        if (instructorOccupancy.get(occupancyKey(instructor.id, period.id))?.has(period.id)) {
          reasons.add("Qualified instructors are already scheduled during the remaining periods");
          continue;
        }
        const previousClass = classPlacements.get(activity.classArmId) ?? [];
        const sameSubjectToday = previousClass.filter(
          (placement) =>
            placement.subjectId === activity.subjectId && placement.dayOfWeek === period.dayOfWeek,
        ).length;
        const adjacentHeavy = activity.heavy
          ? previousClass.some(
              (placement) =>
                placement.heavy &&
                placement.dayOfWeek === period.dayOfWeek &&
                Math.abs(placement.periodNumber - period.periodNumber) === 1,
            )
          : false;
        const priorInstructorDay = (instructorPlacements.get(instructor.id) ?? [])
          .filter((placement) => placement.dayOfWeek === period.dayOfWeek)
          .map((placement) => placement.periodNumber);
        const gapsBefore = getDailyGaps(priorInstructorDay);
        const gapsAfter = getDailyGaps([...priorInstructorDay, period.periodNumber]);
        const newGaps = Math.max(0, gapsAfter - gapsBefore);
        const hasPreference = (instructor.preferredPeriodIds?.length ?? 0) > 0;
        const preferred =
          !hasPreference || instructor.preferredPeriodIds?.includes(period.id) === true;
        const penalty =
          sameSubjectToday * 20 +
          (adjacentHeavy ? 12 : 0) +
          (preferred || !hasPreference ? 0 : 8) +
          newGaps * 3;
        const explanation = [
          sameSubjectToday === 0
            ? "Spreads this subject across the week"
            : `Adds a same-day repeat of this subject (soft penalty ${sameSubjectToday * 20})`,
          adjacentHeavy
            ? "Places a heavy subject back-to-back with another heavy subject (soft penalty 12)"
            : "Avoids a back-to-back heavy-subject placement",
          hasPreference
            ? preferred
              ? "Matches the instructor's preferred period"
              : "Uses a non-preferred instructor period (soft penalty 8)"
            : "No instructor period preference was supplied",
          newGaps > 0
            ? `Adds ${newGaps} instructor free gap(s) (soft penalty ${newGaps * 3})`
            : "Does not add an instructor free gap",
        ];
        for (const room of availableRooms) {
          if (roomOccupancy.get(occupancyKey(room.id, period.id))?.has(period.id)) {
            reasons.add("Suitable rooms are already scheduled during the remaining periods");
            continue;
          }

          const tieBreak =
            hashSeededValue(
              input.seed,
              `${activity.activityId}\u0000${period.id}\u0000${instructor.id}\u0000${room.id}`,
            ) / 0x1_0000_0000;
          if (
            best === undefined ||
            penalty < best.penalty ||
            (penalty === best.penalty && tieBreak < best.tieBreak)
          ) {
            best = { period, instructor, room, penalty, tieBreak, explanation };
            if (penalty === 0) break periodCandidates;
          }
        }
      }
    }

    if (best === undefined) {
      if (reasons.size === 0)
        reasons.add("No feasible period, instructor, and room combination remains");
      unplaced.push({
        activityId: activity.activityId,
        classArmId: activity.classArmId,
        subjectId: activity.subjectId,
        explanation: [...reasons],
      });
      continue;
    }

    const placement: SolverPlacementState = {
      activityId: activity.activityId,
      classArmId: activity.classArmId,
      subjectId: activity.subjectId,
      periodId: best.period.id,
      instructorId: best.instructor.id,
      roomId: best.room.id,
      score: Math.max(0, 100 - best.penalty),
      hardConstraints: [
        "Instructor is qualified and available",
        "Class arm, instructor, and room are not double-booked",
        "Room meets the required capacity and type",
      ],
      explanation: [
        `Placed activity ${activity.sequence} of ${activity.periodsPerWeek} requested periods per week`,
        ...best.explanation,
      ],
      dayOfWeek: best.period.dayOfWeek,
      periodNumber: best.period.periodNumber,
      heavy: activity.heavy,
    };
    placements.push(placement);
    for (const [occupancy, key] of [
      [classOccupancy, activity.classArmId],
      [instructorOccupancy, occupancyKey(best.instructor.id, best.period.id)],
      [roomOccupancy, occupancyKey(best.room.id, best.period.id)],
    ] as const) {
      const periods = occupancy.get(key) ?? new Set<string>();
      periods.add(best.period.id);
      occupancy.set(key, periods);
    }
    classPlacements.set(activity.classArmId, [
      ...(classPlacements.get(activity.classArmId) ?? []),
      placement,
    ]);
    instructorPlacements.set(best.instructor.id, [
      ...(instructorPlacements.get(best.instructor.id) ?? []),
      placement,
    ]);
  }

  const requestedActivityCount = activities.length;
  const qualityScore =
    requestedActivityCount === 0
      ? 100
      : Math.round(
          (placements.reduce((total, placement) => total + placement.score, 0) /
            requestedActivityCount) *
            100,
        ) / 100;
  const orderByPeriod = (a: SolverPlacementState, b: SolverPlacementState): number =>
    a.dayOfWeek - b.dayOfWeek ||
    a.periodNumber - b.periodNumber ||
    a.classArmId.localeCompare(b.classArmId) ||
    a.subjectId.localeCompare(b.subjectId);

  return {
    seed: input.seed,
    requestedActivityCount,
    placements: placements
      .sort(orderByPeriod)
      .map(
        ({ dayOfWeek: _dayOfWeek, periodNumber: _periodNumber, heavy: _heavy, ...placement }) =>
          placement,
      ),
    unplaced: unplaced.sort((a, b) => a.activityId.localeCompare(b.activityId)),
    qualityScore,
  };
}
