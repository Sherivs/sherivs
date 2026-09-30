/**
 * CoreGrid Scholar — Phase 12 Scheduling & Timetable Intelligence unit tests
 * (scheduling-core).
 *
 * Validates:
 * - Time model: interval creation, overlap, duration (I).
 * - Recurrence: pattern creation, end-date, exception-date expansion (J).
 * - Calendars: precedence resolution and blocking (K).
 * - Resources and activities: capacity and instructor requirements (O, D.3).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createTimeInterval,
  intervalsOverlap,
  intervalDurationMinutes,
  createRecurrenceRule,
  isRecurrenceActive,
  expandRecurrence,
  createCalendarEntry,
  isBlockedByCalendar,
  createScheduleResource,
  createScheduledActivity,
  type TimeInterval,
} from "@/lib/scheduling-core";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";
const FUTURE = "2026-06-01T00:00:00Z";

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

describe("Time model (I)", () => {
  it("creates a valid time interval", () => {
    const interval = createTimeInterval("2026-01-01T08:00:00Z", "2026-01-01T09:00:00Z", "UTC");
    expect(interval.timezone).toBe("UTC");
  });

  it("rejects an inverted interval", () => {
    expect(() =>
      createTimeInterval("2026-01-01T09:00:00Z", "2026-01-01T08:00:00Z", "UTC"),
    ).toThrow();
  });

  it("detects overlapping intervals", () => {
    expect(intervalsOverlap(INTERVAL_A, INTERVAL_B)).toBe(true);
    expect(intervalsOverlap(INTERVAL_A, INTERVAL_C)).toBe(false);
  });

  it("computes duration in minutes", () => {
    expect(intervalDurationMinutes(INTERVAL_A)).toBe(60);
  });
});

describe("Recurrence (J)", () => {
  it("creates a recurrence rule with a valid interval", () => {
    const result = createRecurrenceRule({
      pattern: "weekly",
      interval: 2,
      endDate: FUTURE,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.interval).toBe(2);
      expect(isRecurrenceActive(result.rule, NOW)).toBe(true);
    }
  });

  it("rejects a zero interval", () => {
    const result = createRecurrenceRule({ pattern: "daily", interval: 0, now: NOW });
    expect(result.ok).toBe(false);
  });

  it("excludes exception dates from expansion (no uncontrolled duplicates)", () => {
    const result = createRecurrenceRule({
      pattern: "weekly",
      exceptionDates: ["2026-01-08T08:00:00.000Z"],
      endDate: "2026-01-29T00:00:00.000Z",
      now: "2026-01-01T00:00:00.000Z",
    });
    if (!result.ok) throw new Error("fixture failed");
    const occurrences = expandRecurrence(
      result.rule,
      "2026-01-01T08:00:00.000Z",
      "2026-01-29T00:00:00.000Z",
    );
    // 01-01, 01-15, 01-22 (01-08 excluded; 01-29T08:00 exceeds the end boundary)
    expect(occurrences).toHaveLength(3);
    expect(occurrences.some((o) => o.startsWith("2026-01-08"))).toBe(false);
  });

  it("stops expansion at the end date", () => {
    const result = createRecurrenceRule({
      pattern: "daily",
      endDate: "2026-01-04T00:00:00.000Z",
      now: "2026-01-01T00:00:00.000Z",
    });
    if (!result.ok) throw new Error("fixture failed");
    const occurrences = expandRecurrence(
      result.rule,
      "2026-01-01T08:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    );
    // 01-01, 01-02, 01-03 (01-04T08:00 exceeds the end boundary)
    expect(occurrences).toHaveLength(3);
  });
});

describe("Calendars (K)", () => {
  it("blocks an interval covered by a higher-precedence calendar entry", () => {
    const holiday = createCalendarEntry({
      tenantId: TENANT_A,
      kind: "public_holiday",
      name: "Independence Day",
      interval: INTERVAL_A,
      precedence: 1,
    });
    if (!holiday.ok) throw new Error("fixture failed");
    const result = isBlockedByCalendar([holiday.entry], INTERVAL_A, TENANT_A);
    expect(result.blocked).toBe(true);
    expect(result.byCalendar).toBe("Independence Day");
  });

  it("does not block intervals outside covering calendars", () => {
    const holiday = createCalendarEntry({
      tenantId: TENANT_A,
      kind: "public_holiday",
      name: "Independence Day",
      interval: INTERVAL_A,
      precedence: 1,
    });
    if (!holiday.ok) throw new Error("fixture failed");
    expect(isBlockedByCalendar([holiday.entry], INTERVAL_C, TENANT_A).blocked).toBe(false);
  });
});

describe("Resources and activities (O, D.3)", () => {
  it("creates a room resource with positive capacity", () => {
    const result = createScheduleResource({
      id: "room-1",
      tenantId: TENANT_A,
      type: "room",
      name: "Lab A",
      capacity: 40,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a resource with zero capacity", () => {
    const result = createScheduleResource({
      id: "room-1",
      tenantId: TENANT_A,
      type: "room",
      name: "Lab A",
      capacity: 0,
    });
    expect(result.ok).toBe(false);
  });

  it("creates an activity requiring a subject, class, and instructor", () => {
    const result = createScheduledActivity({
      tenantId: TENANT_A,
      subjectId: "subject-math",
      classId: "class-1",
      instructorId: "teacher-1",
      learnerIds: ["learner-1"],
      resourceIds: ["room-1"],
      interval: INTERVAL_A,
      requiredCapacity: 30,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an activity without an instructor (O)", () => {
    const result = createScheduledActivity({
      tenantId: TENANT_A,
      subjectId: "subject-math",
      classId: "class-1",
      instructorId: "",
      learnerIds: ["learner-1"],
      resourceIds: ["room-1"],
      interval: INTERVAL_A,
      requiredCapacity: 30,
    });
    expect(result.ok).toBe(false);
  });
});
