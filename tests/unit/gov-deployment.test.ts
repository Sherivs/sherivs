import { describe, expect, it } from "vitest";
import { canDeploy, nextSchoolStep, ptrBand, validTeacherRef } from "@/lib/gov/deployment";

describe("SHERIVS-B05 gov deployment", () => {
  it("bands pupil-teacher ratios and hides suppressed rows", () => {
    expect(ptrBand({ ptr: 30, suppressed: false })).toBe("ok");
    expect(ptrBand({ ptr: 45, suppressed: false })).toBe("high");
    expect(ptrBand({ ptr: 70, suppressed: false })).toBe("critical");
    expect(ptrBand({ ptr: null, suppressed: true })).toBeNull();
  });
  it("orders release before receive", () => {
    const base = { status: "approved" as const, received: false, from_school: "A" };
    expect(nextSchoolStep({ ...base, released: false, direction: "outgoing" })).toBe("release");
    expect(nextSchoolStep({ ...base, released: false, direction: "incoming" })).toBe("wait");
    expect(nextSchoolStep({ ...base, released: true, direction: "incoming" })).toBe("receive");
    expect(nextSchoolStep({ ...base, from_school: null, released: false, direction: "incoming" })).toBe("receive");
    expect(nextSchoolStep({ ...base, status: "proposed", released: false, direction: "incoming" })).toBeNull();
  });
  it("mirrors role and ref checks", () => {
    expect(canDeploy("planning_officer", "propose")).toBe(true);
    expect(canDeploy("planning_officer", "decide")).toBe(false);
    expect(canDeploy("data_officer", "export")).toBe(true);
    expect(canDeploy("viewer", "export")).toBe(false);
    expect(validTeacherRef("TRCN-12345")).toBe(true);
    expect(validTeacherRef("<script>")).toBe(false);
  });
});
