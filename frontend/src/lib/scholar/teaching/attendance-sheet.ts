/**
 * M7 (ADR-149) attendance sheet: pure helpers for the register screen. Marks go to the existing
 * M05 queue (`createClassAttendanceQueue`, server function `syncClassAttendance` ->
 * `offline_attendance_capture_sync_m05`); this module only shapes them.
 */
import type { AttendanceStatus, ClassAttendanceMark } from "@/lib/offline/attendance-queue";

export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = [
  "present",
  "absent",
  "late",
  "excused",
];

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  excused: "Excused",
};

export interface RosterEntry {
  student_id: string;
  display_name: string;
  admission_number: string | null;
}

export interface SavedMark {
  id: string;
  student_id: string;
  status: AttendanceStatus;
  attendance_date: string;
}

export type Sheet = Record<string, AttendanceStatus | undefined>;

/** Start from what the server already holds for that day; unmarked learners stay blank. */
export function initialSheet(roster: readonly RosterEntry[], saved: readonly SavedMark[]): Sheet {
  const byStudent = new Map(saved.map((mark) => [mark.student_id, mark.status]));
  return Object.fromEntries(roster.map((r) => [r.student_id, byStudent.get(r.student_id)]));
}

export function markAll(roster: readonly RosterEntry[], status: AttendanceStatus): Sheet {
  return Object.fromEntries(roster.map((r) => [r.student_id, status]));
}

export function summarise(sheet: Sheet): Record<AttendanceStatus | "unmarked", number> {
  const counts = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
  for (const status of Object.values(sheet)) counts[status ?? "unmarked"] += 1;
  return counts;
}

/**
 * Marks to queue: only learners whose status differs from the saved one. A same-day re-mark by
 * the same teacher is accepted by the M05 sync; a past mark goes through a correction instead.
 */
export function changedMarks(
  classId: string,
  date: string,
  sheet: Sheet,
  saved: readonly SavedMark[],
): ClassAttendanceMark[] {
  const savedBy = new Map(saved.map((mark) => [mark.student_id, mark.status]));
  const out: ClassAttendanceMark[] = [];
  for (const [studentId, status] of Object.entries(sheet)) {
    if (!status || savedBy.get(studentId) === status) continue;
    out.push({
      class_id: classId,
      student_id: studentId,
      date,
      status,
      shift_id: null,
      period_key: "daily",
    });
  }
  return out;
}

/** Which save path a date uses: today -> register (offline queue); earlier -> audited correction. */
export function attendanceMode(date: string, today: string): "register" | "correction" | "future" {
  if (date > today) return "future";
  return date === today ? "register" : "correction";
}

export const CORRECTION_REASON_MIN = 8;
export const CORRECTION_REASON_MAX = 1000;

export function correctionReasonError(reason: string): string | null {
  const length = reason.trim().length;
  if (length < CORRECTION_REASON_MIN)
    return "Say why the mark is changing (at least 8 characters).";
  if (length > CORRECTION_REASON_MAX) return "Keep the reason under 1000 characters.";
  return null;
}

/** Human text for the M05 sync conflict codes, so a refused mark is never silent. */
export function conflictText(why: string): string {
  switch (why) {
    case "server_has_other_mark":
      return "Someone else already marked this learner; ask them or use a correction.";
    case "not_your_class":
      return "This is not one of your classes.";
    case "date_out_of_range":
      return "This date is outside the register window.";
    case "student_not_in_class":
      return "This learner is no longer in the class.";
    case "captured_time_invalid":
      return "The device clock looks wrong; check the date and time.";
    default:
      return `Not saved (${why}).`;
  }
}
