import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SCALES,
  computeGpa,
  degreeClass,
  gradeFor,
  nextSession,
  outstandingCarryovers,
} from "../../frontend/src/lib/academics/grading";

const ROOT = join(__dirname, "..", "..");
const MIG = readFileSync(
  join(
    ROOT,
    "database/supabase/migrations/20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql",
  ),
  "utf8",
);
const RB = readFileSync(
  join(
    ROOT,
    "database/supabase/rollbacks/20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql",
  ),
  "utf8",
);

describe("SHERIVS-016 grading scales", () => {
  it("maps scores to NUC 5-point bands", () => {
    const s = SCALES["NG-UNI-5"];
    expect([100, 70, 69, 60, 50, 45, 44, 40, 39, 0].map((x) => gradeFor(x, s).letter)).toEqual([
      "A",
      "A",
      "B",
      "B",
      "C",
      "D",
      "E",
      "E",
      "F",
      "F",
    ]);
    expect(gradeFor(72, s).point).toBe(5);
  });
  it("maps scores to NBTE 4-point bands", () => {
    const s = SCALES["NG-POLY-4"];
    expect(gradeFor(76, s)).toMatchObject({ letter: "A", point: 4 });
    expect(gradeFor(71, s)).toMatchObject({ letter: "AB", point: 3.5 });
    expect(gradeFor(41, s)).toMatchObject({ letter: "E", point: 2 });
    expect(gradeFor(39, s)).toMatchObject({ letter: "F", point: 0 });
  });
  it("WAEC and K-12 scales are percentage-only", () => {
    expect(gradeFor(76, SCALES["WAEC-9"]).letter).toBe("A1");
    expect(gradeFor(52, SCALES["WAEC-9"]).letter).toBe("C6");
    expect(gradeFor(52, SCALES["K12-PCT"]).point).toBeNull();
  });
  it("SQL bands match the TS scales", () => {
    for (const scale of Object.values(SCALES))
      for (const b of scale.bands)
        expect(MIG).toContain(
          `('${scale.code}', ${b.minScore}, '${b.letter}', ${b.point == null ? "NULL" : b.point.toFixed(2)}`,
        );
  });
});

describe("SHERIVS-016 GPA / CGPA / carry-overs", () => {
  const rows = [
    { courseCode: "MTH101", creditUnits: 3, gradePoint: 0, academicYear: "2025/2026", attempt: 1 },
    { courseCode: "GST101", creditUnits: 2, gradePoint: 5, academicYear: "2025/2026", attempt: 1 },
    { courseCode: "PHY101", creditUnits: 3, gradePoint: 3, academicYear: "2025/2026", attempt: 1 },
  ];
  it("weights by credit units and ignores rows without units", () => {
    expect(computeGpa(rows)).toEqual({ units: 8, qualityPoints: 19, gpa: 2.38 });
    expect(computeGpa([{ courseCode: "X", creditUnits: null, gradePoint: 4 }]).gpa).toBeNull();
  });
  it("tracks carry-overs; a passed retake clears it while both attempts count", () => {
    expect(outstandingCarryovers(rows)).toEqual([
      { courseCode: "MTH101", creditUnits: 3, attempts: 1 },
    ]);
    const retake = [
      ...rows,
      {
        courseCode: "MTH101",
        creditUnits: 3,
        gradePoint: 4,
        academicYear: "2026/2027",
        attempt: 2,
      },
    ];
    expect(outstandingCarryovers(retake)).toEqual([]);
    expect(computeGpa(retake).units).toBe(11);
  });
  it("degree classes", () => {
    expect(degreeClass(4.5, 5)).toBe("First Class");
    expect(degreeClass(3.49, 5)).toBe("Second Class Lower");
    expect(degreeClass(2.39, 5)).toBe("Third Class");
    expect(degreeClass(0.99, 5)).toBe("Fail");
    expect(degreeClass(3.5, 4)).toBe("Distinction");
    expect(degreeClass(2.49, 4)).toBe("Pass");
    expect(degreeClass(3, null)).toBeNull();
  });
  it("next session", () => {
    expect(nextSession("2025/2026")).toBe("2026/2027");
    expect(nextSession("2025/2027")).toBeNull();
  });
});

describe("SHERIVS-016 migration guarantees", () => {
  it("universities repeat on 7+ carry-over courses; CGPA < 1.00 is only a probation flag", () => {
    expect(MIG).toMatch(/max_carryover_courses\s+int/);
    expect(MIG).toMatch(/probation_cgpa\s+numeric\(4,2\)/);
    expect(MIG).toContain("NULL, CASE WHEN i * 100 < v_final THEN NULL ELSE 0 END, CASE WHEN i * 100 < v_final THEN 7 END, 1.00)");
    expect(MIG).toContain("r.carry_courses >= r.max_carryover_courses THEN 'repeat'");
    expect(MIG).toContain("'probation', count(*) FILTER (WHERE probation)");
    expect(MIG).not.toMatch(/1\.00, CASE WHEN i \* 100 < v_final THEN 15 ELSE 0 END/);
  });
  it("rollover is admin-gated, locked, idempotent and audited", () => {
    expect(MIG).toMatch(
      /IF NOT public\.can_administer_org\(p_school\) THEN RAISE EXCEPTION 'not allowed'/,
    );
    expect(MIG).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_school::text \|\| ':rollover'/);
    expect(MIG).toMatch(/UNIQUE \(school_id, from_session, to_session\)/);
    expect(MIG).toMatch(/'already_applied', true/);
    expect(MIG).toMatch(
      /INSERT INTO public\.audit_logs \(school_id, user_id, action, table_name, record_id, new_value\)/,
    );
  });
  it("audit_logs becomes append-only and bridged to the chain", () => {
    expect(MIG).toMatch(
      /CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE ON public\.audit_logs/,
    );
    expect(MIG).toMatch(
      /CREATE TRIGGER trg_audit_logs_no_truncate BEFORE TRUNCATE ON public\.audit_logs/,
    );
    expect(MIG).toMatch(
      /CREATE TRIGGER trg_audit_logs_bridge_chain AFTER INSERT ON public\.audit_logs/,
    );
  });
  it("tier sync and admin mapping are backfilled; privileged helpers are not callable by users", () => {
    expect(MIG).toMatch(/SELECT public\.sync_org_entitlements_from_tier\(NULL\);/);
    expect(MIG).toMatch(/SELECT public\.sync_admin_role_assignments\(NULL\);/);
    expect(MIG).toMatch(
      /REVOKE ALL ON FUNCTION public\.entitlement_quota\(uuid, text\), public\.meter_consume_for_plan\(uuid, text, text, text, bigint\) FROM PUBLIC, anon, authenticated/,
    );
  });
  it("rollback removes every new function", () => {
    for (const fn of [
      "session_rollover",
      "configure_academic_defaults",
      "member_gpa",
      "member_transcript",
      "sync_admin_role_assignments",
      "audit_logs_bridge_to_chain",
      "can_administer_org",
    ])
      expect(RB).toContain(`DROP FUNCTION IF EXISTS public.${fn}(`);
  });
});
