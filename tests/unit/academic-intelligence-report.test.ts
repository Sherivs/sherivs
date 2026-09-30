/**
 * CoreGrid — Phase 11: the academic intelligence report tests.
 *
 * The report is this phase's L4 evidence, so it is held to the phase's own standard: it must
 * exercise the engines rather than describe them, tie every rule to an implementation and a
 * suite, and declare what the phase does not yet do.
 */
import { describe, expect, it } from "vitest";

import { ASSESSMENT_TYPES, DEFAULT_COGNITIVE_LEVELS } from "@/lib/academic-assessment";
import { CURRICULUM_LEVELS, DEFAULT_COMPETENCY_LEVELS } from "@/lib/academic-curriculum";
import { ACADEMIC_RISK_TYPES } from "@/lib/academic-risk";
import {
  academicIntelligenceGaps,
  academicIntelligenceReport,
  academicIntelligenceRules,
  academicReportSummary,
  runAcademicIntelligenceCheck,
} from "@/lib/academic-intelligence-report";

describe("Phase 11 — the report exercises the phase rather than describing it", () => {
  it("passes every check it runs", () => {
    const checks = runAcademicIntelligenceCheck();
    const failing = checks
      .filter((check) => !check.ok)
      .map((check) => `${check.id}: ${check.detail}`);
    expect(failing).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(10);
  });

  it("reports an observation for every check, never an aspiration", () => {
    for (const check of runAcademicIntelligenceCheck()) {
      expect(check.id.length).toBeGreaterThan(3);
      expect(check.proves.length).toBeGreaterThan(20);
      expect(check.detail.length).toBeGreaterThan(3);
    }
  });

  it("counts its vocabulary from the modules, not from a copy", () => {
    const report = academicIntelligenceReport();
    expect(report.vocabulary.curriculumLevels).toBe(CURRICULUM_LEVELS.length);
    expect(report.vocabulary.competencyLevels).toBe(DEFAULT_COMPETENCY_LEVELS.length);
    expect(report.vocabulary.assessmentTypes).toBe(ASSESSMENT_TYPES.length);
    expect(report.vocabulary.cognitiveLevels).toBe(DEFAULT_COGNITIVE_LEVELS.length);
    expect(report.vocabulary.riskTypes).toBe(ACADEMIC_RISK_TYPES.length);
  });

  it("reports healthy only when nothing failed", () => {
    const report = academicIntelligenceReport();
    expect(report.failed).toBe(report.failingChecks.length);
    expect(report.passed + report.failed).toBe(report.checks.length);
    expect(report.healthy).toBe(report.failed === 0);
  });
});

describe("Phase 11 — every claimed rule names its implementation and its proof", () => {
  it("ties each rule to a module and a suite that exist", () => {
    const rules = academicIntelligenceRules();
    expect(rules.length).toBeGreaterThanOrEqual(6);
    for (const rule of rules) {
      expect(rule.rule.length, `${rule.id} must state the rule`).toBeGreaterThan(40);
      expect(rule.enforcedBy, `${rule.id} must name its module`).toMatch(/^frontend\/src\/lib\//);
      expect(rule.provedBy, `${rule.id} must name its suite`).toMatch(
        /^tests\/unit\/.*\.test\.ts$/,
      );
    }
    const ids = rules.map((rule) => rule.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "curriculum-is-versioned",
        "competency-graph-is-acyclic",
        "objectives-are-measurable",
        "assessments-prove-coverage",
        "mastery-is-an-estimate",
        "risk-is-probabilistic",
      ]),
    );
  });
});

describe("Phase 11 — the report declares what the phase cannot yet do", () => {
  it("reports each gap with its consequence and its owner", () => {
    const gaps = academicIntelligenceGaps();
    expect(gaps.length).toBeGreaterThanOrEqual(5);
    for (const gap of gaps) {
      expect(gap.gap.length, `${gap.id} must state the gap`).toBeGreaterThan(40);
      expect(gap.consequence.length, `${gap.id} must state the consequence`).toBeGreaterThan(40);
      expect(gap.owner.length, `${gap.id} must name an owner`).toBeGreaterThan(10);
    }
    expect(gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining(["no-academic-persistence", "no-model-registry-service"]),
    );
  });

  it("keeps the gaps visible in the report and in one summary line", () => {
    const report = academicIntelligenceReport();
    const summary = academicReportSummary(report);
    expect(report.gaps.length).toBeGreaterThanOrEqual(5);
    expect(summary).toContain(`${report.passed}/${report.checks.length}`);
    expect(summary).toContain(`${report.gaps.length} declared gaps`);
    expect(summary).toContain(`${report.rules.length} enforced rules`);
  });
});
