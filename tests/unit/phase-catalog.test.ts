import { describe, expect, it } from "vitest";
import { PHASE_CATALOG, PHASE_LAYERS, PHASES_TOTAL } from "@/lib/phase-catalog";

describe("phase-catalog (Command Centre data)", () => {
  it("contains exactly 51 phases", () => {
    expect(PHASES_TOTAL).toBe(51);
    expect(PHASE_CATALOG).toHaveLength(51);
  });

  it("covers the full 01..51 sequence in order", () => {
    PHASE_CATALOG.forEach((entry, index) => {
      const expected = String(index + 1).padStart(2, "0");
      expect(entry.phase).toBe(expected);
    });
  });

  it("assigns every phase to a known layer", () => {
    for (const entry of PHASE_CATALOG) {
      expect(PHASE_LAYERS).toContain(entry.layer);
    }
  });

  it("lists at least one domain module per phase", () => {
    for (const entry of PHASE_CATALOG) {
      expect(entry.modules.length).toBeGreaterThan(0);
    }
  });

  it("has measured test suites for phases 20–32", () => {
    for (const entry of PHASE_CATALOG) {
      const phase = Number(entry.phase);
      if (phase >= 20 && phase <= 32) {
        expect(entry.testCount).toBeTypeOf("number");
        expect(entry.testCount!).toBeGreaterThan(0);
      }
    }
  });

  it("marks phases 33–51 as architecture-defined without test counts", () => {
    for (const entry of PHASE_CATALOG) {
      const phase = Number(entry.phase);
      if (phase >= 33) {
        expect(entry.status).toBe("architecture");
        expect(entry.testCount).toBeUndefined();
      }
    }
  });
});
