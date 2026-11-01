import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateMobility,
  type StudentMobilityEvidence,
  type StudentMobilityPolicy,
} from "../../frontend/src/lib/scholar/progression";

const ROOT = join(__dirname, "..", "..");
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261101110000_sv1_student_mobility.sql"),
  "utf8",
);
const BULK_MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261101120000_sv1_student_mobility_bulk.sql"),
  "utf8",
);

const evidence: StudentMobilityEvidence = {
  studentId: "student-1",
  subjectResults: [
    { subjectCode: "MATH", passed: true },
    { subjectCode: "ENGLISH", passed: true },
  ],
  averagePct: 78,
  attendancePct: 90,
  outstandingBalance: 0,
  occupiedSeats: 18,
  targetCapacity: 30,
  completedApprovals: ["form_teacher", "principal"],
};

const policy: StudentMobilityPolicy = {
  id: "school-policy",
  name: "School promotion policy",
  requiredSubjectCodes: ["MATH", "ENGLISH"],
  minAveragePct: 60,
  minAttendancePct: 75,
  feeClearance: "block",
  requiredApprovals: ["form_teacher", "principal"],
};

describe("SV1 student mobility eligibility", () => {
  it("allows a human-approved movement when policy, fee, and capacity gates pass", () => {
    expect(evaluateMobility(evidence, policy)).toMatchObject({
      decision: "promote",
      eligible: true,
      unmet: [],
      warnings: [],
    });
  });

  it("blocks unknown evidence, unpaid fees under block policy, capacity, and missing approvals", () => {
    const result = evaluateMobility(
      {
        ...evidence,
        averagePct: null,
        outstandingBalance: 120,
        occupiedSeats: 30,
        completedApprovals: ["form_teacher"],
      },
      policy,
    );
    expect(result.eligible).toBe(false);
    expect(result.unmet.join(" ")).toContain("average is unknown");
    expect(result.unmet.join(" ")).toContain("outstanding balance");
    expect(result.unmet.join(" ")).toContain("at capacity");
    expect(result.unmet.join(" ")).toContain('approval "principal"');
  });

  it("warns rather than blocks for fees when institutional policy says warn", () => {
    const result = evaluateMobility(
      { ...evidence, outstandingBalance: 120 },
      { ...policy, feeClearance: "warn" },
    );
    expect(result.eligible).toBe(true);
    expect(result.warnings).toContain("outstanding balance 120 requires clearance");
  });

  it("routes outstanding policy failures to human review when configured", () => {
    const result = evaluateMobility(
      { ...evidence, completedApprovals: [] },
      { ...policy, reviewInsteadOfRetain: true },
    );
    expect(result.decision).toBe("review");
    expect(result.eligible).toBe(false);
  });
});

describe("SV1 student mobility migration", () => {
  it("stores tenant-scoped placements and preserves prior placement details", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.student_placements");
    expect(MIGRATION).toMatch(/student_placements_one_current[\s\S]*WHERE effective_to IS NULL;/);
    expect(MIGRATION).toContain("only an open placement may be closed once");
    expect(MIGRATION).toContain("student_placements_one_current");
    expect(MIGRATION).toContain("INSERT INTO public.student_placements");
  });

  it("requires distinct authorized human approvers before commit", () => {
    expect(MIGRATION).toContain("requester cannot approve their own movement");
    expect(MIGRATION).toContain("UNIQUE (request_id, approver_id)");
    expect(MIGRATION).toContain("movement requires all approvals before commit");
    expect(MIGRATION).toContain("public.scholar_can(r.school_id, 'students.transfer')");
    expect(MIGRATION).toContain("required_approvals BETWEEN 1 AND 3");
    expect(MIGRATION).toContain("student_mobility_class_guard");
  });

  it("uses school policy for assessment, attendance, fees, and destination capacity", () => {
    expect(MIGRATION).toContain("required_subjects text[]");
    expect(MIGRATION).toContain("min_average_pct numeric");
    expect(MIGRATION).toContain("min_attendance_pct numeric");
    expect(MIGRATION).toContain("fee_clearance IN ('block', 'warn', 'allow')");
    expect(MIGRATION).toContain("coalesce(v_rules.fee_clearance, 'block') = 'block'");
    expect(MIGRATION).toContain("target class is at capacity");
    expect(MIGRATION).toContain("public.academic_periods");
  });

  it("links open fee balances to the destination placement without duplicating invoices", () => {
    expect(MIGRATION).toContain("student_mobility_finance_links");
    expect(MIGRATION).toContain("student_mobility_finance_carryover");
    expect(MIGRATION).toContain("f.student_id = NEW.student_id");
    expect(MIGRATION).toContain("outstanding_amount");
    expect(MIGRATION).not.toContain("INSERT INTO public.fees");
  });

  it("imports consented external transfers as a new tenant-local student record", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.student_transfer_imports");
    expect(MIGRATION).toContain("source_transfer_id uuid NOT NULL UNIQUE");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.student_transfer_import");
    expect(MIGRATION).toContain("Consent-based transfer import");
    expect(MIGRATION).toContain("t.claimed_by_school IS DISTINCT FROM v_school");
    expect(MIGRATION).toContain("student_transfer_imports");
  });

  it("keeps all requested classes and history within the resolved school", () => {
    expect(MIGRATION).toContain("public.get_my_school_id()");
    expect(MIGRATION).toContain("target class is not in this organization");
    expect(MIGRATION).toContain("target class is not in this school");
    expect(MIGRATION).toContain("school_id = public.get_my_school_id()");
    expect(MIGRATION).toContain("ALTER TABLE public.%I FORCE ROW LEVEL SECURITY");
  });

  it("supports cancellation only before the movement effective date", () => {
    expect(MIGRATION).toContain("movement can only be cancelled before its effective date");
    expect(MIGRATION).toContain("movement cannot be backdated");
    expect(MIGRATION).toContain("student_mobility_cancel");
  });

  it("previews policy evidence and restricts it to the caller's authorized tenant", () => {
    expect(BULK_MIGRATION).toContain("public.scholar_can(v_school, 'students.transfer')");
    expect(BULK_MIGRATION).toContain("WHERE id = p_student AND school_id = v_school");
    expect(BULK_MIGRATION).toContain("'eligible', cardinality(v_unmet) = 0");
    expect(BULK_MIGRATION).toContain("'required_approvals'");
    expect(BULK_MIGRATION).toContain("'outstanding_balance'");
    expect(BULK_MIGRATION).toContain("student_mobility_preview");
  });

  it("bounds and validates bulk requests before atomically inserting per-student requests", () => {
    expect(BULK_MIGRATION).toContain("jsonb_array_length(p_items) NOT BETWEEN 1 AND 200");
    expect(BULK_MIGRATION).toContain("bulk preview contains a missing or duplicate student");
    expect(BULK_MIGRATION).toContain("public.student_mobility_bulk_preview(p_items)");
    expect(BULK_MIGRATION).toContain("public.student_mobility_request(");
    expect(BULK_MIGRATION).toContain("FROM PUBLIC, anon");
    expect(BULK_MIGRATION).toContain("TO authenticated");
    expect(BULK_MIGRATION).not.toContain("INSERT INTO public.student_mobility_requests");
  });
});
