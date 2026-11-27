import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { evaluate } from "../../tools/sim-lab/sim/scenario-ratchet.mjs";

const r = (area: string, name: string, pass: boolean) => ({
  area,
  name,
  pass,
  detail: "",
  severity: "high",
});
const base = { min_total: 3, known_failing: ["a :: bad"] };
const ok = [r("a", "good", true), r("a", "bad", false), r("b", "fine", true)];

describe("scenario ratchet", () => {
  it("passes when exactly the known failures fail", () => {
    expect(evaluate(ok, base).ok).toBe(true);
  });
  it("fails on a new failure", () => {
    const v = evaluate([...ok.slice(0, 2), r("b", "fine", false)], base);
    expect(v.ok).toBe(false);
    expect(v.regressions).toEqual(["b :: fine"]);
  });
  it("fails when a known failure now passes, so the baseline only shrinks", () => {
    const v = evaluate([r("a", "good", true), r("a", "bad", true), r("b", "fine", true)], base);
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toContain("now passes");
  });
  it("fails when a known failure disappeared (renamed or deleted)", () => {
    const v = evaluate([r("a", "good", true), r("b", "fine", true), r("c", "extra", true)], base);
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toContain("no longer exists");
  });
  it("fails closed on empty, short, malformed and duplicated results", () => {
    expect(evaluate([], base).ok).toBe(false);
    expect(evaluate(ok.slice(0, 2), base).ok).toBe(false);
    expect(evaluate([{ area: "a" }], base).ok).toBe(false);
    expect(evaluate([...ok, r("a", "good", true)], { ...base, min_total: 3 }).ok).toBe(false);
    expect(evaluate(ok, { known_failing: [] }).ok).toBe(false);
    expect(evaluate(undefined, base).ok).toBe(false);
  });
  it("allows more scenarios than the minimum", () => {
    expect(evaluate([...ok, r("c", "new", true)], base).ok).toBe(true);
  });
});
