/**
 * CoreGrid — financial tax (Phase 13, domain-neutral).
 *
 * Tax is jurisdiction data, not code. An organization declares tax rule versions
 * per jurisdiction and charge category, and FinOS resolves the version that applied
 * at the moment of the charge — then computes in exact minor units.
 *
 * The refusals matter more than the arithmetic:
 *   - an unknown jurisdiction is NOT zero tax. It is unknown, and unknown money is
 *     never invented;
 *   - two rules claiming the same jurisdiction, category and instant are ambiguous
 *     and are refused rather than silently resolved by ordering;
 *   - inclusive and exclusive pricing are different computations, and the mode is
 *     declared per charge rather than guessed from a total.
 */
import { money, type Money } from "./financial-core";

export interface TaxRuleVersion {
  readonly versionId: string;
  readonly jurisdiction: string;
  /** The charge category this rule covers (institutional data: what the organization calls a charge). */
  readonly category: string;
  /** Rate in basis points (10000 = 100%), because floats are never used for money. */
  readonly rateBasisPoints: number;
  /** True when the declared price already includes this tax. */
  readonly inclusive: boolean;
  readonly exempt: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export type TaxRuleResolution =
  | { readonly known: true; readonly rule: TaxRuleVersion }
  | { readonly known: false; readonly reason: string };

/**
 * Resolve the tax rule that applied to a jurisdiction and category at an instant.
 * A miss is reported as unknown — the caller must not treat it as zero tax.
 */
export function resolveTaxRule(
  versions: readonly TaxRuleVersion[],
  input: { readonly jurisdiction: string; readonly category: string; readonly at: string },
): TaxRuleResolution {
  const applicable = versions.filter(
    (version) =>
      version.jurisdiction === input.jurisdiction &&
      version.category === input.category &&
      version.effectiveFrom <= input.at &&
      (version.effectiveTo === null || version.effectiveTo > input.at),
  );
  if (applicable.length === 0) {
    return {
      known: false,
      reason: `no tax rule version is declared for jurisdiction ${input.jurisdiction} and category ${input.category} at ${input.at}`,
    };
  }
  if (applicable.length > 1) {
    return {
      known: false,
      reason: `tax rule versions ${applicable
        .map((rule) => rule.versionId)
        .join(
          ", ",
        )} all claim ${input.jurisdiction}/${input.category} at ${input.at}: ambiguous rules are refused rather than ordered arbitrarily`,
    };
  }
  return { known: true, rule: applicable[0] };
}

export interface TaxLine {
  readonly category: string;
  readonly jurisdiction: string;
  readonly ruleVersionId: string;
  readonly rateBasisPoints: number;
  readonly baseMinor: number;
  readonly taxMinor: number;
}

export type TaxCalculation =
  | {
      readonly ok: true;
      readonly mode: "inclusive" | "exclusive";
      readonly net: Money;
      readonly tax: Money;
      readonly gross: Money;
      readonly lines: readonly TaxLine[];
      readonly provenance: string;
    }
  | { readonly ok: false; readonly error: string };

/** Deterministic half-up integer division: the only rounding this engine performs. */
export function halfUpDivide(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  const sign = numerator < 0 ? -1 : 1;
  const absolute = Math.abs(numerator);
  const quotient = Math.floor(absolute / denominator);
  const remainder = absolute - quotient * denominator;
  const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient;
  return sign * rounded;
}

/**
 * Calculate tax for one charge. Rounding is half-up on the tax amount and is stated
 * here so every consumer rounds identically; amounts stay integer minor units.
 */
export function calculateTax(input: {
  readonly amount: Money;
  readonly mode: "inclusive" | "exclusive";
  readonly jurisdiction: string;
  readonly category: string;
  readonly at: string;
  readonly versions: readonly TaxRuleVersion[];
}): TaxCalculation {
  if (input.amount.amountMinor < 0) {
    return { ok: false, error: "a negative amount cannot be taxed" };
  }
  const resolution = resolveTaxRule(input.versions, {
    jurisdiction: input.jurisdiction,
    category: input.category,
    at: input.at,
  });
  if (!resolution.known) return { ok: false, error: resolution.reason };

  const rule = resolution.rule;
  if (rule.rateBasisPoints < 0 || rule.rateBasisPoints > 10000) {
    return { ok: false, error: `tax rate ${rule.rateBasisPoints} basis points is outside 0–10000` };
  }

  const provenance = `jurisdiction ${rule.jurisdiction} · category ${rule.category} · rule ${rule.versionId} · rate ${rule.rateBasisPoints} basis points · ${
    rule.inclusive ? "tax-inclusive" : "tax-exclusive"
  } price`;
  const baseMinor = input.amount.amountMinor;

  if (rule.exempt || rule.rateBasisPoints === 0) {
    return {
      ok: true,
      mode: input.mode,
      net: money(baseMinor, input.amount.currency),
      tax: money(0, input.amount.currency),
      gross: money(baseMinor, input.amount.currency),
      lines: [],
      provenance: `${provenance} · exempt`,
    };
  }

  if (input.mode === "exclusive") {
    const taxMinor = halfUpDivide(baseMinor * rule.rateBasisPoints, 10000);
    return {
      ok: true,
      mode: "exclusive",
      net: money(baseMinor, input.amount.currency),
      tax: money(taxMinor, input.amount.currency),
      gross: money(baseMinor + taxMinor, input.amount.currency),
      lines: [
        {
          category: rule.category,
          jurisdiction: rule.jurisdiction,
          ruleVersionId: rule.versionId,
          rateBasisPoints: rule.rateBasisPoints,
          baseMinor,
          taxMinor,
        },
      ],
      provenance,
    };
  }

  const taxMinor = halfUpDivide(baseMinor * rule.rateBasisPoints, 10000 + rule.rateBasisPoints);
  const netMinor = baseMinor - taxMinor;
  return {
    ok: true,
    mode: "inclusive",
    net: money(netMinor, input.amount.currency),
    tax: money(taxMinor, input.amount.currency),
    gross: money(baseMinor, input.amount.currency),
    lines: [
      {
        category: rule.category,
        jurisdiction: rule.jurisdiction,
        ruleVersionId: rule.versionId,
        rateBasisPoints: rule.rateBasisPoints,
        baseMinor: netMinor,
        taxMinor,
      },
    ],
    provenance,
  };
}

export interface TaxSummary {
  readonly netMinor: number;
  readonly taxMinor: number;
  readonly grossMinor: number;
}

/** Tax totals come from the lines, never from a separately claimed figure. */
export function summariseTaxLines(lines: readonly TaxLine[]): TaxSummary {
  const netMinor = lines.reduce((total, line) => total + line.baseMinor, 0);
  const taxMinor = lines.reduce((total, line) => total + line.taxMinor, 0);
  return { netMinor, taxMinor, grossMinor: netMinor + taxMinor };
}

/** True when a declared tax figure equals the sum of the lines that explain it. */
export function taxFigureIsExplained(lines: readonly TaxLine[], declaredTaxMinor: number): boolean {
  return summariseTaxLines(lines).taxMinor === declaredTaxMinor;
}
