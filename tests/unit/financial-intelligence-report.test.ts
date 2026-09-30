/**
 * CoreGrid — Phase 13 financial intelligence report tests (L4 evidence).
 *
 * These assertions hold the report to its own claims:
 * - every rule names a module and a suite that EXIST in the repository;
 * - every executed check passes and carries the observation it produced;
 * - every total is derived from the live arrays, so adding a rule changes the report;
 * - the rules no executed check exercises are DECLARED rather than glossed over;
 * - the gaps are stated as unfinished work, each with a way to close it;
 * - the report carries no institution as the platform's default: it speaks about
 *   every organization that pays, bills or is paid.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FINANCIAL_GAPS,
  FINANCIAL_RULES,
  ORGANIZATION_VOCABULARY,
  buildFinancialIntelligenceReport,
  runFinancialChecks,
} from "@/lib/financial-intelligence-report";

const REPORT = buildFinancialIntelligenceReport();

describe("every claimed rule is wired to real artefacts", () => {
  it("names a module and a suite that exist", () => {
    for (const rule of FINANCIAL_RULES) {
      expect(existsSync(rule.module), `missing module for rule ${rule.id}: ${rule.module}`).toBe(
        true,
      );
      expect(existsSync(rule.suite), `missing suite for rule ${rule.id}: ${rule.suite}`).toBe(true);
    }
  });

  it("ties every rule to a blueprint section", () => {
    for (const rule of FINANCIAL_RULES) {
      expect(
        rule.blueprint.trim().length,
        `rule ${rule.id} claims no blueprint section`,
      ).toBeGreaterThan(0);
      expect(rule.statement.length).toBeGreaterThan(20);
    }
  });

  it("keeps the phase contract citing the suites this report relies on", () => {
    const contract = readFileSync(
      "frontend/src/lib/kernel/phase-contracts/phase-13-financial-system.ts",
      "utf8",
    );
    for (const suite of [
      "tests/unit/financial-core.test.ts",
      "tests/unit/financial-payments.test.ts",
    ]) {
      expect(contract, `contract no longer cites ${suite}`).toContain(suite);
    }
  });
});

describe("every executed check actually ran", () => {
  it("reports a passing observation for each check", () => {
    const checks = runFinancialChecks();
    expect(checks.length).toBeGreaterThanOrEqual(12);
    for (const check of checks) {
      expect(
        check.observed.trim().length,
        `check ${check.id} recorded no observation`,
      ).toBeGreaterThan(10);
      expect(check.passed, `check ${check.id} observed: ${check.observed}`).toBe(true);
    }
  });

  it("exercises the headline capability — split payments — including its refusals", () => {
    const ids = runFinancialChecks().map((check) => check.id);
    expect(ids).toContain("splits-account-for-the-gross");
    expect(ids).toContain("splits-refuse-over-allocation");
    expect(ids).toContain("refunds-sum-exactly");
    expect(ids).toContain("fees-are-not-deductions");
    expect(ids).toContain("settlement-is-per-leg");
  });

  it("exercises provider neutrality and failover safety", () => {
    const ids = runFinancialChecks().map((check) => check.id);
    expect(ids).toContain("routing-selects-capability");
    expect(ids).toContain("routing-reports-unroutable");
    expect(ids).toContain("failover-cannot-double-charge");
  });

  it("exercises the journal, reconstruction and double-entry balance", () => {
    const ids = runFinancialChecks().map((check) => check.id);
    expect(ids).toContain("journal-is-append-only");
    expect(ids).toContain("state-is-reconstructed");
    expect(ids).toContain("postings-must-balance");
    expect(ids).toContain("events-are-durable-before-published");
  });

  it("exercises tax resolution, unknown jurisdictions and both tax modes", () => {
    const ids = runFinancialChecks().map((check) => check.id);
    expect(ids).toContain("tax-is-jurisdiction-data");
    expect(ids).toContain("tax-never-invents-zero");
    expect(ids).toContain("tax-modes-are-distinct");
  });

  it("declares the rules that no executed check reaches yet", () => {
    expect(REPORT.rulesWithoutExecutedCheck).toEqual([
      "money-is-exact",
      "prices-are-versioned",
      "obligation-is-not-invoice",
    ]);
  });
});

describe("the report's totals come from the report's own content", () => {
  it("counts rules, checks, gaps and organizations from the live arrays", () => {
    expect(REPORT.totals.rules).toBe(FINANCIAL_RULES.length);
    expect(REPORT.totals.executedChecks).toBe(runFinancialChecks().length);
    expect(REPORT.totals.declaredGaps).toBe(FINANCIAL_GAPS.length);
    expect(REPORT.totals.organizations).toBe(ORGANIZATION_VOCABULARY.length);
    expect(REPORT.totals.failedChecks).toBe(0);
    expect(REPORT.totals.modules).toBeGreaterThanOrEqual(5);
    expect(REPORT.phase).toBe("13");
    expect(REPORT.capability).toBe("financial-ledger");
  });

  it("lists the modules that carry the phase's claims", () => {
    expect(REPORT.modules).toContain("frontend/src/lib/financial-splits.ts");
    expect(REPORT.modules).toContain("frontend/src/lib/financial-routing.ts");
    expect(REPORT.modules).toContain("frontend/src/lib/financial-journal.ts");
    expect(REPORT.modules).toContain("frontend/src/lib/financial-tax.ts");
  });
});

describe("unfinished work is declared rather than omitted", () => {
  it("states each gap with its area, its way to close and its owner", () => {
    expect(FINANCIAL_GAPS.length).toBeGreaterThanOrEqual(6);
    for (const gap of FINANCIAL_GAPS) {
      expect(gap.statement.length, `gap ${gap.id} states nothing`).toBeGreaterThan(20);
      expect(gap.closesWhen.length, `gap ${gap.id} names no way to close`).toBeGreaterThan(20);
      expect(gap.owner.trim().length).toBeGreaterThan(0);
    }
  });

  it("declares the gaps that matter most: no live provider, no persistence, no authorised boundary", () => {
    const areas = FINANCIAL_GAPS.map((gap) => gap.area);
    expect(areas).toContain("provider adapters");
    expect(areas).toContain("persistence");
    expect(areas).toContain("authorised ingestion boundary");
  });
});

describe("the phase belongs to every organization that handles money", () => {
  it("expresses the same capability in several organizations' own words", () => {
    expect(ORGANIZATION_VOCABULARY.length).toBeGreaterThanOrEqual(6);
    for (const entry of ORGANIZATION_VOCABULARY) {
      expect(entry.whatIsBilled.length).toBeGreaterThan(5);
      expect(entry.whoOwes.length).toBeGreaterThan(3);
      expect(entry.whoIsPaid.length).toBeGreaterThan(5);
      expect(entry.splitStory.length).toBeGreaterThan(10);
    }
  });

  it("never presents a runtime as the platform, and never defaults to one institution's people", () => {
    const serialized = JSON.stringify(REPORT).toLowerCase();
    for (const forbidden of ["scholar", "pupil", "learner", "student", "teacher"]) {
      expect(serialized, `the report frames the platform through "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
  });
});
