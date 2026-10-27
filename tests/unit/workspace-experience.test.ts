/**
 * Sherivs — workspace experience resolver tests (Phase 24).
 */
import { describe, expect, it } from "vitest";
import {
  clockInTimeZone,
  dayPartForHour,
  greetingForHour,
  hourInTimeZone,
  resolveMemberWorkspaceExperience,
  SHELL_TIME_ZONE,
} from "../../frontend/src/lib/experience/workspace-experience";

describe("time-of-day part + greeting", () => {
  it("maps hours to day parts", () => {
    expect(dayPartForHour(0)).toBe("night");
    expect(dayPartForHour(6)).toBe("morning");
    expect(dayPartForHour(11)).toBe("morning");
    expect(dayPartForHour(12)).toBe("afternoon");
    expect(dayPartForHour(16)).toBe("afternoon");
    expect(dayPartForHour(18)).toBe("evening");
    expect(dayPartForHour(23)).toBe("night");
  });

  it("returns the localized greeting", () => {
    expect(greetingForHour(8)).toBe("Good morning");
    expect(greetingForHour(14)).toBe("Good afternoon");
    expect(greetingForHour(19)).toBe("Good evening");
    expect(greetingForHour(2)).toBe("Good night");
  });

  it("reads the greeting hour in Africa/Lagos", () => {
    const at = new Date("2026-10-27T10:54:00Z");
    expect(hourInTimeZone(at, SHELL_TIME_ZONE)).toBe(11);
    expect(greetingForHour(hourInTimeZone(at, SHELL_TIME_ZONE))).toBe("Good morning");
    expect(clockInTimeZone(at, SHELL_TIME_ZONE)).toMatch(/WAT$/);
  });
});

describe("member workspace experience", () => {
  it("prefers the real post title when a primary position exists", () => {
    const exp = resolveMemberWorkspaceExperience({
      hour: 9,
      memberLabel: "Educator",
      positionTitle: "Head of Department",
    });
    expect(exp.greeting).toBe("Good morning");
    expect(exp.roleTitle).toBe("Head of Department");
  });

  it("falls back to the membership label without a position", () => {
    const exp = resolveMemberWorkspaceExperience({ hour: 15, memberLabel: "Finance officer" });
    expect(exp.roleTitle).toBe("Finance officer");
  });

  it("treats blank position titles as absent", () => {
    const exp = resolveMemberWorkspaceExperience({
      hour: 20,
      memberLabel: "Educator",
      positionTitle: "   ",
    });
    expect(exp.roleTitle).toBe("Educator");
    expect(exp.greeting).toBe("Good evening");
  });
});
