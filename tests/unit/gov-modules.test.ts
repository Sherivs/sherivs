import { describe, expect, it } from "vitest";
import { averageScore, canDo, validScores } from "@/lib/gov/modules";

describe("SHERIVS-B03 gov modules", () => {
  it("validates inspection scores like the database", () => {
    expect(validScores({ teaching: 4, records: 3, leadership: 5 })).toBe(true);
    expect(validScores({ teaching: 4, records: 3 })).toBe(false);
    expect(validScores({ teaching: 6, records: 3, leadership: 5 })).toBe(false);
    expect(validScores({ vibes: 4, records: 3, leadership: 5 })).toBe(false);
    expect(validScores({ teaching: 4, records: 3, leadership: undefined, community: 2 })).toBe(true);
  });
  it("averages scores", () => {
    expect(averageScore({ teaching: 4, records: 3, leadership: 4 })).toBe(3.7);
    expect(averageScore(null)).toBeNull();
  });
  it("maps agency roles to actions", () => {
    expect(canDo("inspector", "inspect")).toBe(true);
    expect(canDo("inspector", "publish")).toBe(false);
    expect(canDo("director", "publish")).toBe(true);
    expect(canDo("viewer", "inspect")).toBe(false);
    expect(canDo(null, "inspect")).toBe(false);
  });
});
