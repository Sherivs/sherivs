import { describe, expect, it } from "vitest";
import {
  hasMultiplePlacementDimensions,
  mobilityActionsFor,
} from "../../frontend/src/lib/scholar/mobility-workflow";

describe("student mobility actions", () => {
  it("shows no movement actions without the granted permission", () => {
    expect(mobilityActionsFor(new Set(["students.view"]), true, true)).toEqual([]);
  });

  it("keeps a single-campus school on plain progression without transfer selectors", () => {
    expect(
      hasMultiplePlacementDimensions(["campus-a"], ["section-a"], ["shift-a"], ["arm-a"]),
    ).toBe(false);
    const actions = mobilityActionsFor(new Set(["students.transfer"]), false, true);
    expect(actions.map(({ type }) => type)).toEqual([
      "promote",
      "repeat",
      "double_promote",
      "conditional_promote",
      "demote",
      "withdraw",
      "graduate",
    ]);
  });

  it("enables placement transfer when configured campuses, sections, shifts, or arms differ", () => {
    expect(
      hasMultiplePlacementDimensions(
        ["campus-a", "campus-b"],
        ["section-a"],
        ["shift-a"],
        ["arm-a"],
      ),
    ).toBe(true);
    expect(
      hasMultiplePlacementDimensions(
        ["campus-a"],
        ["section-a"],
        ["shift-a", "shift-b"],
        ["arm-a"],
      ),
    ).toBe(true);
    expect(
      hasMultiplePlacementDimensions(["campus-a"], ["section-a"], ["shift-a"], ["arm-a", "arm-c"]),
    ).toBe(true);
    expect(
      mobilityActionsFor(new Set(["students.transfer"]), true, true).some(
        ({ type }) => type === "internal_transfer",
      ),
    ).toBe(true);
  });

  it("offers readmission only for inactive students", () => {
    expect(
      mobilityActionsFor(new Set(["students.transfer"]), true, false).map(({ type }) => type),
    ).toContain("readmit");
    expect(
      mobilityActionsFor(new Set(["students.transfer"]), true, false).map(({ type }) => type),
    ).not.toContain("withdraw");
  });
});
