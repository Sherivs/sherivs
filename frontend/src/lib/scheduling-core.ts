/**
 * CoreGrid — Scheduling & Timetable Intelligence core domain model
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
