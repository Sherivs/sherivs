/**
 * M7 (ADR-118) pure screen logic: today's periods, the attendance sheet, the gradebook payload
 * and lesson-note rules; plus the migration's static contract.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  localClock,
  localIsoDate,
  localWeekday,
  periodStates,
  type Period,
} from "@/lib/scholar/teaching/today";
import {
  attendanceMode,
  changedMarks,
  conflictText,
  correctionReasonError,
  initialSheet,
  markAll,
  summarise,
} from "@/lib/scholar/teaching/attendance-sheet";
import {
  buildPayload,
  caIdempotencyKey,
  draftChanged,
  draftFromRow,
  isServerRejection,
  parseWeightProfile,
  rowEditable,
  type GradebookRow,
  type WeightProfile,
} from "@/lib/scholar/teaching/gradebook";
import {
  canEdit,
  canReview,
  canSubmit,
  displayStatus,
  returnCommentError,
  titleError,
} from "@/lib/scholar/teaching/lesson-notes";

// 2026-11-18 is a Wednesday. 22:30 UTC is already Thursday in Lagos (UTC+1).
const LATE_UTC = Date.parse("2026-11-18T23:30:00Z");

describe("today's classes", () => {
  it("reads weekday, date and clock in the given time zone, not UTC", () => {
    expect(localWeekday(LATE_UTC, "UTC")).toBe("wednesday");
    expect(localWeekday(LATE_UTC, "Africa/Lagos")).toBe("thursday");
    expect(localIsoDate(LATE_UTC, "Africa/Lagos")).toBe("2026-11-19");
    expect(localClock(LATE_UTC, "Africa/Lagos")).toBe("00:30");
  });

  it("labels periods finished, now, next and later, in time order", () => {
    const p = (id: string, start: string, end: string): Period => ({
      slot_id: id,
      class_id: "c",
      class_name: "JSS1 A",
      period_number: Number(id),
      start_time: `${start}:00`,
      end_time: `${end}:00`,
      subject: "Maths",
      room: null,
    });
    const states = periodStates(
      [
        p("3", "10:00", "10:40"),
        p("1", "08:00", "08:40"),
        p("2", "09:00", "09:40"),
        p("4", "11:00", "11:40"),
      ],
      "09:10",
    );
    expect(states.map((s) => `${s.period.slot_id}:${s.state}`)).toEqual([
      "1:done",
      "2:now",
      "3:next",
      "4:later",
    ]);
  });
});

describe("attendance sheet", () => {
  const roster = [
    { student_id: "s1", display_name: "Ada", admission_number: "A1" },
    { student_id: "s2", display_name: "Bayo", admission_number: "A2" },
    { student_id: "s3", display_name: "Chi", admission_number: null },
  ];
  const saved = [
    { id: "m1", student_id: "s1", status: "present" as const, attendance_date: "2026-11-18" },
  ];

  it("starts from the saved marks and leaves the rest blank", () => {
    const sheet = initialSheet(roster, saved);
    expect(sheet).toEqual({ s1: "present", s2: undefined, s3: undefined });
    expect(summarise(sheet)).toEqual({ present: 1, absent: 0, late: 0, excused: 0, unmarked: 2 });
  });

  it("queues only changed marks, as daily M05 marks without a shift", () => {
    const sheet = { ...markAll(roster, "present"), s2: "absent" as const };
    expect(changedMarks("c1", "2026-11-18", sheet, saved)).toEqual([
      {
        class_id: "c1",
        student_id: "s2",
        date: "2026-11-18",
        status: "absent",
        shift_id: null,
        period_key: "daily",
      },
      {
        class_id: "c1",
        student_id: "s3",
        date: "2026-11-18",
        status: "present",
        shift_id: null,
        period_key: "daily",
      },
    ]);
  });

  it("uses the register today, a correction for a past day, and refuses the future", () => {
    expect(attendanceMode("2026-11-18", "2026-11-18")).toBe("register");
    expect(attendanceMode("2026-11-10", "2026-11-18")).toBe("correction");
    expect(attendanceMode("2026-11-19", "2026-11-18")).toBe("future");
  });

  it("requires a real reason for a correction (same bounds as the database)", () => {
    expect(correctionReasonError("oops")).not.toBeNull();
    expect(correctionReasonError("Marked present by mistake")).toBeNull();
    expect(correctionReasonError("x".repeat(1001))).not.toBeNull();
  });

  it("explains every M05 conflict code instead of failing silently", () => {
    expect(conflictText("not_your_class")).toMatch(/not one of your classes/);
    expect(conflictText("server_has_other_mark")).toMatch(/already marked/);
    expect(conflictText("weird_code")).toContain("weird_code");
  });
});

describe("gradebook payload", () => {
  const profile = parseWeightProfile({
    subject: "Maths",
    term: "First",
    academic_year: "2026/2027",
    ca_weight: "40",
    terminal_weight: 60,
    terminal_max_score: 60,
    ca_components: [
      { code: "test1", weight: 50, max_score: 10 },
      { code: "project", weight: 50, max_score: 20 },
    ],
  }) as WeightProfile;
  const row: GradebookRow = {
    student_id: "s1",
    display_name: "Ada",
    admission_number: "A1",
    grade_id: null,
    ca_scores: { test1: 8 },
    terminal_score_raw: null,
    total_score: null,
    grade: null,
    state: "draft_mine",
  };

  it("parses the M06 weight profile and refuses a malformed one", () => {
    expect(profile.ca_weight).toBe(40);
    expect(parseWeightProfile(null)).toBeNull();
    expect(parseWeightProfile({ ca_components: "x" })).toBeNull();
  });

  it("builds exactly the enterResultScores payload, every component present, blanks as null", () => {
    const draft = draftFromRow(row, profile);
    expect(draft).toEqual({ test1: "8", project: "", terminal: "" });
    const built = buildPayload("s1", { ...draft, terminal: "45" }, profile);
    expect(built).toEqual({
      payload: {
        student_id: "s1",
        subject: "Maths",
        term: "First",
        academic_year: "2026/2027",
        ca_scores: { test1: 8, project: null },
        terminal_score: 45,
      },
    });
  });

  it("refuses out-of-range and non-numeric cells before anything is queued", () => {
    const built = buildPayload("s1", { test1: "11", project: "abc", terminal: "61" }, profile);
    expect("errors" in built && built.errors).toEqual([
      "test1: must be between 0 and 10",
      "project: enter a number",
      "Exam: must be between 0 and 60",
    ]);
  });

  it("detects changes and locks approved, published and other authors' rows", () => {
    expect(draftChanged({ a: "1" }, { a: " 1 " })).toBe(false);
    expect(draftChanged({ a: "1" }, { a: "2" })).toBe(true);
    expect(rowEditable("none")).toBe(true);
    expect(rowEditable("draft_mine")).toBe(true);
    expect(rowEditable("draft_other")).toBe(false);
    expect(rowEditable("approved")).toBe(false);
    expect(rowEditable("published")).toBe(false);
  });

  it("derives one idempotency key per save and learner", () => {
    expect(caIdempotencyKey(profile, "s1", "save-1")).toBe("ca:2026/2027:First:Maths:s1:save-1");
    expect(caIdempotencyKey(profile, "s1", "save-2")).not.toBe(
      caIdempotencyKey(profile, "s1", "save-1"),
    );
  });

  it("treats the m06 refusals as final and other errors as retryable", () => {
    expect(
      isServerRejection(
        new Error("result is locked or belongs to another author; use audited amendment"),
      ),
    ).toBe(true);
    expect(isServerRejection(new Error("not allowed"))).toBe(true);
    expect(isServerRejection(new Error("CA score is outside its possible range"))).toBe(true);
    expect(isServerRejection(new Error("upstream timeout"))).toBe(false);
  });
});

describe("lesson notes", () => {
  it("lets the author edit and submit drafts only", () => {
    expect(canEdit({ status: "draft" })).toBe(true);
    expect(canEdit({ status: "submitted" })).toBe(false);
    expect(canEdit({ status: "approved" })).toBe(false);
    expect(canSubmit({ status: "draft", title: " " })).toBe(false);
    expect(canSubmit({ status: "draft", title: "Fractions" })).toBe(true);
  });

  it("never offers review of your own note", () => {
    expect(canReview({ submitted_by: "me" }, "me")).toBe(false);
    expect(canReview({ submitted_by: "other" }, "me")).toBe(true);
  });

  it("requires a comment to return a note and labels returned drafts", () => {
    expect(returnCommentError("ok")).not.toBeNull();
    expect(returnCommentError("Add a worked example")).toBeNull();
    expect(displayStatus({ status: "draft", review_notes: "Add a worked example" })).toBe(
      "Returned with comment",
    );
    expect(displayStatus({ status: "submitted", review_notes: null })).toBe("Waiting for review");
    expect(titleError("")).not.toBeNull();
  });
});

describe("migration contract", () => {
  const migration = readFileSync(
    "database/supabase/migrations/20261117003200_sherivs_m7_academic_core.sql",
    "utf8",
  );
  const rollback = readFileSync(
    "database/supabase/rollbacks/20261117003200_sherivs_m7_academic_core.sql",
    "utf8",
  );

  it("is marked not applied, has no transaction control, and emits no events itself", () => {
    expect(migration.split("\n")[0]).toBe(
      "-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.",
    );
    expect(migration).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    expect(migration).not.toMatch(/wf_event|wf05_emit|INSERT INTO public\.wf_/i);
  });

  it("gives every new function an empty search_path and no anon execute", () => {
    const fns = [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(m7_\w+)\(/g)].map(
      (m) => m[1],
    );
    expect(fns.length).toBeGreaterThanOrEqual(7);
    for (const fn of fns) {
      expect(migration, fn).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`),
      );
    }
    expect((migration.match(/SET search_path = ''/g) ?? []).length).toBe(fns.length);
  });

  it("forces RLS on the new table, grants explicitly, and audits it", () => {
    expect(migration).toContain(
      "ALTER TABLE public.m7_attendance_corrections FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.m7_attendance_corrections FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain("EXECUTE FUNCTION public.scholar_audit()");
    expect(migration).toContain("EXECUTE FUNCTION public.append_only_guard()");
  });

  it("narrows grades with a RESTRICTIVE policy (never widens)", () => {
    expect(migration).toMatch(
      /CREATE POLICY m7_grades_teacher_own_classes ON public\.grades\s+AS RESTRICTIVE FOR SELECT/,
    );
    expect(migration).not.toMatch(/AS PERMISSIVE/i);
  });

  it("has a paired rollback that refuses while corrections exist", () => {
    expect(rollback).toContain("M7 rollback refused");
    for (const name of [
      "m7_lesson_plan_guard",
      "m7_correct_attendance",
      "m7_grades_teacher_own_classes",
      "m7_class_gradebook",
    ]) {
      expect(rollback).toContain(name);
    }
  });
});
