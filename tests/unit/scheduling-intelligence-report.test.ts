import { describe, expect, it } from "vitest";

import {
  buildSchedulingIntelligenceReport,
  SCHEDULING_GAPS,
  SCHEDULING_RULES,
  runSchedulingChecks,
  runSchedulingQualityChecks,
} from "../../frontend/src/lib/scheduling-intelligence-report";

describe("scheduling intelligence report", () => {
  const report = buildSchedulingIntelligenceReport("2026-01-05T08:00:00.000Z");

  it("reports every check as enforced, with an observation that came from a live call", () => {
    expect(report.checks.length).toBeGreaterThanOrEqual(13);
    expect(report.totals.failed).toBe(0);
    expect(report.totals.enforced).toBe(report.checks.length);
    expect(report.totals.declared).toBe(0);
    for (const check of report.checks) {
      expect(check.evidence.trim().length).toBeGreaterThan(0);
      expect(check.module.endsWith(".ts")).toBe(true);
      expect(check.suite).toBe("scheduling-governance.test.ts");
    }
  });

  it("ties every rule to a module and a suite that exist", () => {
    expect(SCHEDULING_RULES.length).toBeGreaterThanOrEqual(14);
    for (const rule of SCHEDULING_RULES) {
      expect(rule.module.endsWith(".ts")).toBe(true);
      expect(rule.suite.endsWith(".test.ts")).toBe(true);
      expect(rule.statement.length).toBeGreaterThan(20);
    }
    expect(
      SCHEDULING_RULES.filter((rule) => rule.module === "scheduling-conflicts.ts").length,
    ).toBeGreaterThan(3);
    expect(
      SCHEDULING_RULES.filter((rule) => rule.module === "scheduling-quality.ts").length,
    ).toBeGreaterThan(3);
  });

  it("declares its gaps with an owner instead of implying completeness", () => {
    expect(SCHEDULING_GAPS.length).toBeGreaterThanOrEqual(6);
    for (const gap of SCHEDULING_GAPS) {
      expect(gap.why.length).toBeGreaterThan(20);
      expect(gap.owner.trim().length).toBeGreaterThan(0);
    }
  });

  it("computes totals from live module constants rather than literals", () => {
    expect(report.totals.rules).toBe(SCHEDULING_RULES.length);
    expect(report.totals.gaps).toBe(SCHEDULING_GAPS.length);
    expect(report.totals.conflictTypes).toBeGreaterThanOrEqual(12);
    expect(report.totals.scoreDimensions).toBeGreaterThanOrEqual(8);
    expect(report.totals.resolutionStrategies).toBeGreaterThanOrEqual(9);
    expect(report.summary).toContain(String(report.totals.conflictTypes));
    expect(report.phase).toBe("12");
  });

  it("splits its checks across the conflict engine and the quality engine", () => {
    expect(runSchedulingChecks().length).toBeGreaterThanOrEqual(6);
    expect(runSchedulingQualityChecks().length).toBeGreaterThanOrEqual(6);
    for (const check of runSchedulingQualityChecks()) {
      expect(check.module).toBe("scheduling-quality.ts");
    }
  });

  it("names no runtime and no customer in its declarations", () => {
    const serialised = JSON.stringify(report).toLowerCase();
    for (const forbidden of ["scholar", "school:", "academy", "pupil"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});
