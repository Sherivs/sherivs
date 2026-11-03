import { describe, expect, it } from "vitest";
import {
  mobilityAdvisoryEvidence,
  validateMobilityAdvisoryCitations,
  type MobilityAdvisory,
} from "../../frontend/src/lib/scholar/mobility-advisory";

describe("student mobility AI advisory evidence", () => {
  it("keeps only server-preview evidence and drops identity or unrelated fields", () => {
    expect(
      mobilityAdvisoryEvidence({
        student_id: "student-secret",
        full_name: "Private Student",
        eligible: false,
        unmet: ["attendance is below the institution threshold"],
        warnings: [],
        average_pct: 61,
        attendance_pct: 70,
        outstanding_balance: 0,
        occupied_seats: 12,
        target_capacity: 30,
        required_approvals: 2,
        fee_clearance: "block",
        email: "private@example.test",
      }),
    ).toEqual({
      eligible: false,
      unmet: ["attendance is below the institution threshold"],
      warnings: [],
      average_pct: 61,
      attendance_pct: 70,
      outstanding_balance: 0,
      occupied_seats: 12,
      target_capacity: 30,
      required_approvals: 2,
      fee_clearance: "block",
    });
  });

  it("fails closed when the preview evidence is malformed", () => {
    expect(() =>
      mobilityAdvisoryEvidence({
        eligible: true,
        unmet: [],
        warnings: [],
        average_pct: 140,
      }),
    ).toThrow();
  });

  it("accepts only citations that exactly match verified preview facts", () => {
    const evidence = mobilityAdvisoryEvidence({
      eligible: false,
      unmet: ["attendance is below the institution threshold"],
      warnings: [],
      average_pct: null,
      attendance_pct: 70,
      outstanding_balance: 0,
      occupied_seats: 12,
      target_capacity: 30,
      required_approvals: 2,
      fee_clearance: "block",
    });
    const advisory: MobilityAdvisory = {
      headline: "Request human review",
      recommendation: "Resolve attendance eligibility before any movement.",
      rationale: "The preview reports an unmet attendance threshold.",
      evidence: ["Unmet check: attendance is below the institution threshold"],
      limitations: "This snapshot does not replace the approval workflow.",
    };

    expect(validateMobilityAdvisoryCitations(advisory, evidence)).toEqual(advisory);
    expect(() =>
      validateMobilityAdvisoryCitations(
        { ...advisory, evidence: ["Student has excellent attendance"] },
        evidence,
      ),
    ).toThrow("cited evidence outside the verified preview");
  });
});
