/**
 * CoreGrid — Phase 13 tax engine unit tests (financial-tax).
 *
 * The laws under test (Phase 13 BG–BK):
 * - the rule that applied is resolved by jurisdiction, category and instant, and a
 *   miss is UNKNOWN rather than zero tax;
 * - two rules claiming the same jurisdiction, category and instant are ambiguous
 *   and are refused rather than ordered arbitrarily;
 * - tax-inclusive and tax-exclusive pricing are different computations, in exact
 *   minor units with one stated rounding rule;
 * - a declared tax figure is only valid when the lines explain it.
 */

import { describe, expect, it } from "vitest";
import { money } from "@/lib/financial-core";
import {
  calculateTax,
  halfUpDivide,
  resolveTaxRule,
  summariseTaxLines,
  taxFigureIsExplained,
  type TaxRuleVersion,
} from "@/lib/financial-tax";

const AT = "2026-04-01T00:00:00Z";

function rule(overrides: Partial<TaxRuleVersion> = {}): TaxRuleVersion {
  return {
    versionId: "tax-v1",
    jurisdiction: "GB",
    category: "service-charge",
    rateBasisPoints: 2000,
    inclusive: false,
    exempt: false,
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    ...overrides,
  };
}

describe("the applicable tax rule is resolved, never assumed", () => {
  it("resolves the version effective at the instant", () => {
    const old = rule({
      versionId: "tax-v1",
      rateBasisPoints: 1500,
      effectiveTo: "2026-03-01T00:00:00Z",
    });
    const current = rule({
      versionId: "tax-v2",
      rateBasisPoints: 2000,
      effectiveFrom: "2026-03-01T00:00:00Z",
    });
    const resolution = resolveTaxRule([old, current], {
      jurisdiction: "GB",
      category: "service-charge",
      at: AT,
    });
    expect(resolution.known).toBe(true);
    if (resolution.known) expect(resolution.rule.versionId).toBe("tax-v2");
  });

  it("reports an undeclared jurisdiction as unknown instead of zero tax", () => {
    const resolution = resolveTaxRule([rule()], {
      jurisdiction: "FR",
      category: "service-charge",
      at: AT,
    });
    expect(resolution.known).toBe(false);
    if (!resolution.known) expect(resolution.reason).toContain("no tax rule version");
  });

  it("refuses ambiguous rules rather than ordering them arbitrarily", () => {
    const resolution = resolveTaxRule(
      [rule({ versionId: "tax-a" }), rule({ versionId: "tax-b" })],
      {
        jurisdiction: "GB",
        category: "service-charge",
        at: AT,
      },
    );
    expect(resolution.known).toBe(false);
    if (!resolution.known) expect(resolution.reason).toContain("ambiguous rules");
  });
});

describe("tax is computed in exact minor units", () => {
  it("adds tax to a tax-exclusive price", () => {
    const calculation = calculateTax({
      amount: money(1_000, "GBP"),
      mode: "exclusive",
      jurisdiction: "GB",
      category: "service-charge",
      at: AT,
      versions: [rule()],
    });
    expect(calculation.ok).toBe(true);
    if (!calculation.ok) return;
    expect(calculation.tax.amountMinor).toBe(200);
    expect(calculation.gross.amountMinor).toBe(1_200);
  });

  it("extracts tax from a tax-inclusive price", () => {
    const calculation = calculateTax({
      amount: money(1_200, "GBP"),
      mode: "inclusive",
      jurisdiction: "GB",
      category: "service-charge",
      at: AT,
      versions: [rule()],
    });
    expect(calculation.ok).toBe(true);
    if (!calculation.ok) return;
    expect(calculation.tax.amountMinor).toBe(200);
    expect(calculation.net.amountMinor).toBe(1_000);
    expect(calculation.gross.amountMinor).toBe(1_200);
  });

  it("rounds tax half-up, deterministically", () => {
    const calculation = calculateTax({
      amount: money(999, "GBP"),
      mode: "exclusive",
      jurisdiction: "GB",
      category: "service-charge",
      at: AT,
      versions: [rule({ rateBasisPoints: 1050 })],
    });
    expect(calculation.ok).toBe(true);
    if (calculation.ok) expect(calculation.tax.amountMinor).toBe(105);
    expect(halfUpDivide(999 * 1050, 10000)).toBe(105);
  });

  it("treats an exempt rule as zero tax with the exemption named in the provenance", () => {
    const calculation = calculateTax({
      amount: money(5_000, "GBP"),
      mode: "exclusive",
      jurisdiction: "GB",
      category: "service-charge",
      at: AT,
      versions: [rule({ exempt: true })],
    });
    expect(calculation.ok).toBe(true);
    if (!calculation.ok) return;
    expect(calculation.tax.amountMinor).toBe(0);
    expect(calculation.provenance).toContain("exempt");
  });

  it("refuses an undeclared jurisdiction instead of charging zero", () => {
    const calculation = calculateTax({
      amount: money(5_000, "GBP"),
      mode: "exclusive",
      jurisdiction: "FR",
      category: "service-charge",
      at: AT,
      versions: [rule()],
    });
    expect(calculation.ok).toBe(false);
  });

  it("refuses a rate outside the possible range and a negative amount", () => {
    const badRate = calculateTax({
      amount: money(1_000, "GBP"),
      mode: "exclusive",
      jurisdiction: "GB",
      category: "service-charge",
      at: AT,
      versions: [rule({ rateBasisPoints: 12000 })],
    });
    expect(badRate.ok).toBe(false);

    const negative = calculateTax({
      amount: money(-1_000, "GBP"),
      mode: "exclusive",
      jurisdiction: "GB",
      category: "service-charge",
      at: AT,
      versions: [rule()],
    });
    expect(negative.ok).toBe(false);
  });

  it("names the jurisdiction, category, rule version and rate in its provenance", () => {
    const calculation = calculateTax({
      amount: money(1_000, "GBP"),
      mode: "exclusive",
      jurisdiction: "GB",
      category: "service-charge",
      at: AT,
      versions: [rule()],
    });
    expect(calculation.ok).toBe(true);
    if (!calculation.ok) return;
    expect(calculation.provenance).toContain("tax-v1");
    expect(calculation.provenance).toContain("2000 basis points");
    expect(calculation.provenance).toContain("GB");
  });

  it("accepts a declared tax figure only when its lines explain it", () => {
    const calculation = calculateTax({
      amount: money(1_000, "GBP"),
      mode: "exclusive",
      jurisdiction: "GB",
      category: "service-charge",
      at: AT,
      versions: [rule()],
    });
    if (!calculation.ok) throw new Error(calculation.error);
    const summary = summariseTaxLines(calculation.lines);
    expect(summary.taxMinor).toBe(200);
    expect(summary.grossMinor).toBe(1_200);
    expect(taxFigureIsExplained(calculation.lines, 200)).toBe(true);
    expect(taxFigureIsExplained(calculation.lines, 199)).toBe(false);
  });
});
