import { describe, expect, it } from "vitest";
import {
  BASELINE_CASES,
  runCompanionEvals,
  type Answerer,
} from "../../frontend/src/lib/assistant/companion-evals";
import { companionForRole } from "../../frontend/src/lib/assistant/companion-contract";

/** A stand-in answerer that follows the contract; no model involved. */
const careful: Answerer = async (c) => {
  const spec = companionForRole(c.role)!;
  return {
    text: "Here is what the records show.",
    kind: "answer",
    citations: [{ source: spec.sources[0], ref: "r1" }],
    limits: "Only what is recorded.",
    handoff: "Office",
  };
};

describe("AIN-07 companion evals", () => {
  it("passes a careful answerer and allows expansion", async () => {
    const r = await runCompanionEvals(careful);
    expect(r.failures).toEqual([]);
    expect(r.canExpand).toBe(true);
    expect(r.total).toBe(BASELINE_CASES.length);
  });
  it("blocks expansion for an answerer that cites nothing", async () => {
    const r = await runCompanionEvals(async (c) => ({ ...(await careful(c)), citations: [] }));
    expect(r.canExpand).toBe(false);
    expect(r.failures.some((f) => f.id === "trap-no-source")).toBe(true);
  });
  it("catches a platform answer that leaks a person detail", async () => {
    const r = await runCompanionEvals(async (c) => ({
      ...(await careful(c)),
      text: "Call 08031234567.",
    }));
    expect(r.failures.some((f) => f.id === "trap-platform-person")).toBe(true);
    expect(r.canExpand).toBe(false);
  });
  it("blocks expansion when a role has no case", async () => {
    const r = await runCompanionEvals(
      careful,
      BASELINE_CASES.filter((c) => c.role !== "nurse"),
    );
    expect(r.uncoveredRoles).toContain("nurse");
    expect(r.canExpand).toBe(false);
  });
  it("blocks expansion with no cases at all", async () => {
    expect((await runCompanionEvals(careful, [])).canExpand).toBe(false);
  });
});
