/**
 * SHERIVS-016 — grading scales, GPA/CGPA, carry-overs and degree class.
 *
 * Pure functions mirroring the SQL in migration 20261024000230
 * (grades_points_fill, member_gpa, member_outstanding_carryovers,
 * degree_class) so the UI and server code can compute and preview the same
 * numbers the database stores. Policy: every attempt counts in the CGPA; an
 * outstanding carry-over is a course whose latest attempt scored 0 points.
 */

export type ScaleKind = "points" | "percentage";
export interface ScaleBand {
  minScore: number;
  letter: string;
  point: number | null;
  remark: string;
}
export interface GradingScale {
  code: string;
  name: string;
  kind: ScaleKind;
  maxPoint: number | null;
  bands: ScaleBand[];
}

const band = (
  minScore: number,
  letter: string,
  point: number | null,
  remark: string,
): ScaleBand => ({
  minScore,
  letter,
  point,
  remark,
});

export const SCALES: Record<string, GradingScale> = {
  "NG-UNI-5": {
    code: "NG-UNI-5",
    name: "Nigerian university 5-point (NUC)",
    kind: "points",
    maxPoint: 5,
    bands: [
      band(70, "A", 5, "Excellent"),
      band(60, "B", 4, "Very Good"),
      band(50, "C", 3, "Good"),
      band(45, "D", 2, "Fair"),
      band(40, "E", 1, "Pass"),
      band(0, "F", 0, "Fail"),
    ],
  },
  "NG-POLY-4": {
    code: "NG-POLY-4",
    name: "Nigerian polytechnic 4-point (NBTE)",
    kind: "points",
    maxPoint: 4,
    bands: [
      band(75, "A", 4, "Distinction"),
      band(70, "AB", 3.5, "Very Good"),
      band(65, "B", 3.25, "Good"),
      band(60, "BC", 3, "Upper Credit"),
      band(55, "C", 2.75, "Credit"),
      band(50, "CD", 2.5, "Lower Credit"),
      band(45, "D", 2.25, "Pass"),
      band(40, "E", 2, "Pass"),
      band(0, "F", 0, "Fail"),
    ],
  },
  "WAEC-9": {
    code: "WAEC-9",
    name: "WAEC/NECO 9-point (A1-F9)",
    kind: "percentage",
    maxPoint: null,
    bands: [
      band(75, "A1", null, "Excellent"),
      band(70, "B2", null, "Very Good"),
      band(65, "B3", null, "Good"),
      band(60, "C4", null, "Credit"),
      band(55, "C5", null, "Credit"),
      band(50, "C6", null, "Credit"),
      band(45, "D7", null, "Pass"),
      band(40, "E8", null, "Pass"),
      band(0, "F9", null, "Fail"),
    ],
  },
  "K12-PCT": {
    code: "K12-PCT",
    name: "Primary/secondary percentage (A-F)",
    kind: "percentage",
    maxPoint: null,
    bands: [
      band(70, "A", null, "Excellent"),
      band(60, "B", null, "Very Good"),
      band(50, "C", null, "Good"),
      band(45, "D", null, "Pass"),
      band(40, "E", null, "Weak Pass"),
      band(0, "F", null, "Fail"),
    ],
  },
};

/** Band for a 0..100 score (scores are clamped to the range). */
export function gradeFor(score: number, scale: GradingScale): ScaleBand {
  const s = Math.max(0, Math.min(100, score));
  const sorted = [...scale.bands].sort((a, b) => b.minScore - a.minScore);
  return sorted.find((b) => s >= b.minScore) ?? sorted[sorted.length - 1];
}

export interface ResultRow {
  courseCode: string;
  creditUnits: number | null;
  gradePoint: number | null;
  academicYear?: string | null;
  term?: string | null;
  attempt?: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const counted = (r: ResultRow) => (r.creditUnits ?? 0) > 0 && r.gradePoint != null;

export interface GpaResult {
  units: number;
  qualityPoints: number;
  gpa: number | null;
}

/** Weighted GPA over the given rows (filter by session/term before calling for a GPA; pass all rows for the CGPA). */
export function computeGpa(rows: ResultRow[]): GpaResult {
  let units = 0;
  let qp = 0;
  for (const r of rows) {
    if (!counted(r)) continue;
    units += r.creditUnits as number;
    qp += (r.creditUnits as number) * (r.gradePoint as number);
  }
  return { units, qualityPoints: round2(qp), gpa: units > 0 ? round2(qp / units) : null };
}

/** Courses whose latest attempt scored 0 points. */
export function outstandingCarryovers(
  rows: ResultRow[],
): Array<{ courseCode: string; creditUnits: number; attempts: number }> {
  const byCourse = new Map<string, ResultRow[]>();
  for (const r of rows)
    if (counted(r)) byCourse.set(r.courseCode, [...(byCourse.get(r.courseCode) ?? []), r]);
  const out: Array<{ courseCode: string; creditUnits: number; attempts: number }> = [];
  for (const [code, list] of byCourse) {
    const latest = [...list].sort(
      (a, b) =>
        String(b.academicYear ?? "").localeCompare(String(a.academicYear ?? "")) ||
        (b.attempt ?? 1) - (a.attempt ?? 1),
    )[0];
    if (latest.gradePoint === 0)
      out.push({
        courseCode: code,
        creditUnits: latest.creditUnits as number,
        attempts: list.length,
      });
  }
  return out.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
}

/** Class of degree (NUC 5-point) or diploma grade (NBTE 4-point). */
export function degreeClass(cgpa: number | null, maxPoint: number | null): string | null {
  if (cgpa == null || maxPoint == null) return null;
  if (maxPoint === 5) {
    if (cgpa >= 4.5) return "First Class";
    if (cgpa >= 3.5) return "Second Class Upper";
    if (cgpa >= 2.4) return "Second Class Lower";
    if (cgpa >= 1.5) return "Third Class";
    if (cgpa >= 1.0) return "Pass";
    return "Fail";
  }
  if (maxPoint === 4) {
    if (cgpa >= 3.5) return "Distinction";
    if (cgpa >= 3.0) return "Upper Credit";
    if (cgpa >= 2.5) return "Lower Credit";
    if (cgpa >= 2.0) return "Pass";
    return "Fail";
  }
  return null;
}

/** Rollover preview returned by public.session_rollover(..., p_dry_run => true). */
export interface RolloverSummary {
  school_id: string;
  from_session: string;
  to_session: string;
  dry_run: boolean;
  total: number;
  promoted: number;
  repeated: number;
  graduated: number;
  withdrawn: number;
  transferred: number;
  skipped: number;
  /** Students below the probation CGPA (flag only; universities repeat on 7+ carry-over courses). */
  probation?: number;
  promoted_without_class: number;
  by_level: Record<string, number>;
  sample: Array<{
    student_id: string;
    decision: string;
    from_level: string | null;
    to_level: string | null;
    cgpa: number | null;
    carry_units: number;
    carry_courses?: number;
    probation?: boolean;
    reason: string | null;
  }>;
  already_applied: boolean;
  rollover_id?: string;
  applied_at?: string;
}

/** "2025/2026" -> "2026/2027". Returns null for anything else. */
export function nextSession(session: string): string | null {
  const m = /^(\d{4})\/(\d{4})$/.exec(session.trim());
  if (!m || Number(m[2]) !== Number(m[1]) + 1) return null;
  return `${Number(m[1]) + 1}/${Number(m[2]) + 1}`;
}
