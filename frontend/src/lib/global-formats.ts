/**
 * CoreGrid Global Formats — currency, tax, measurement, number, data format,
 * document/report/audit/log/API, communication, payment, and integration
 * localization domain.
 *
 * Implements `architecture/phase-30-globalization.md`:
 * - Currency platform (AV), currency model (AW): a localized monetary value
 *   preserves amount (minor units), currency, precision, source, timestamp,
 *   and applicable conversion context.
 * - Currency display (AX), number formatting (BI), currency conversion (AY),
 *   FX rate boundary (AZ) — a presentation/conversion service, never a
 *   trading or treasury engine — historical FX (BA), currency rounding (BB).
 *   Phase 13 financial-core remains the money authority; consumed by
 *   reference, never duplicated (AGENTS.md 65).
 * - Tax localization (BC), tax types (BD), tax rate versioning (BE).
 * - Measurement system (BF), unit conversion (BG) — original units and
 *   conversion context preserved — educational measurements (BH).
 * - Data formats (EK), import/export (EL), CSV localization (EM).
 * - Document localization (EN), PDF localization (EO) — scripts and layout
 *   directions — report localization (EP).
 * - Audit localization (EQ), log localization (ER), API localization (ES):
 *   canonical records and machine-readable contracts stay stable; localized
 *   views are presentation only.
 * - Communication localization (CS), payment localization (CT), African
 *   payment localization (CU) — providers configurable, never one hard-coded
 *   provider — integration localization (EV).
 */

import type { MeasurementSystem } from "./globalization-core";

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type FxRateId = string & { readonly __brand: "FxRateId" };
export type TaxConfigId = string & { readonly __brand: "TaxConfigId" };
export type UnitSystemId = string & { readonly __brand: "UnitSystemId" };

export function fxRateId(raw: string): FxRateId {
  return raw as FxRateId;
}
export function taxConfigId(raw: string): TaxConfigId {
  return raw as TaxConfigId;
}
export function unitSystemId(raw: string): UnitSystemId {
  return raw as UnitSystemId;
}

/* ─────────────────────────────────────────────────────────────
 * Currency model (Section AW)
 * ────────────────────────────────────────────────────────────*/

export interface LocalizedMonetaryValue {
  /** Integer minor units (kobo/cents) — matches Phase 13 Money. */
  amountMinor: number;
  /** ISO 4217 code. */
  currency: string;
  precision: number;
  source: string;
  timestamp: string;
  conversionContext?: string;
}

export function createLocalizedMonetaryValue(input: {
  amountMinor: number;
  currency: string;
  precision: number;
  source: string;
  timestamp: string;
  conversionContext?: string;
}): { ok: true; value: LocalizedMonetaryValue } | { ok: false; error: string } {
  if (!Number.isInteger(input.amountMinor)) {
    return { ok: false, error: "Monetary amount must be integer minor units (Section AW)" };
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    return { ok: false, error: "Currency must be an ISO 4217 code (Section AW)" };
  }
  if (!Number.isInteger(input.precision) || input.precision < 0) {
    return { ok: false, error: "Currency precision must be a non-negative integer (Section AW)" };
  }
  if (!input.source.trim()) {
    return { ok: false, error: "Monetary value source is required (Section AW)" };
  }
  if (!input.timestamp) {
    return { ok: false, error: "Monetary value timestamp is required (Section AW)" };
  }
  return {
    ok: true,
    value: {
      amountMinor: input.amountMinor,
      currency: input.currency,
      precision: input.precision,
      source: input.source,
      timestamp: input.timestamp,
      conversionContext: input.conversionContext,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Number formatting (Section BI)
 * ────────────────────────────────────────────────────────────*/

export interface NumberFormatConfig {
  decimalSeparator: string;
  thousandsSeparator: string;
}

export function createNumberFormatConfig(input: {
  decimalSeparator: string;
  thousandsSeparator: string;
}): { ok: true; config: NumberFormatConfig } | { ok: false; error: string } {
  if (!input.decimalSeparator || !input.thousandsSeparator) {
    return { ok: false, error: "Number format separators are required (Section BI)" };
  }
  if (input.decimalSeparator === input.thousandsSeparator) {
    return { ok: false, error: "Decimal and thousands separators must differ (Section BI)" };
  }
  return {
    ok: true,
    config: {
      decimalSeparator: input.decimalSeparator,
      thousandsSeparator: input.thousandsSeparator,
    },
  };
}

export function formatNumber(
  value: number,
  config: NumberFormatConfig,
  precision?: number,
): string {
  const rounded = Math.abs(value).toFixed(precision ?? 0);
  const [intPart, decPart] = rounded.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, config.thousandsSeparator);
  const sign = value < 0 ? "-" : "";
  const decimal = decPart ? `${config.decimalSeparator}${decPart}` : "";
  return `${sign}${grouped}${decimal}`;
}

/* ─────────────────────────────────────────────────────────────
 * Currency display (Section AX)
 * ────────────────────────────────────────────────────────────*/

export function formatCurrencyForLocale(
  value: LocalizedMonetaryValue,
  config: NumberFormatConfig,
  symbol: string,
): string {
  const major = value.amountMinor / Math.pow(10, value.precision);
  return `${symbol}${formatNumber(major, config, value.precision)}`;
}

/* ─────────────────────────────────────────────────────────────
 * FX rates + conversion (Sections AY, AZ, BA, BB)
 * ────────────────────────────────────────────────────────────*/

export interface FxRate {
  id: FxRateId;
  sourceCurrency: string;
  targetCurrency: string;
  /** 1 source unit = `rate` target units. */
  rate: number;
  timestamp: string;
  provider?: string;
}

export function createFxRate(input: {
  id: FxRateId;
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
  timestamp: string;
  provider?: string;
}): { ok: true; rate: FxRate } | { ok: false; error: string } {
  if (!/^[A-Z]{3}$/.test(input.sourceCurrency) || !/^[A-Z]{3}$/.test(input.targetCurrency)) {
    return { ok: false, error: "FX rate currencies must be ISO 4217 codes (Section AY)" };
  }
  if (input.sourceCurrency === input.targetCurrency) {
    return {
      ok: false,
      error: "FX rate requires distinct source and target currencies (Section AY)",
    };
  }
  if (!Number.isFinite(input.rate) || input.rate <= 0) {
    return { ok: false, error: "FX rate must be a finite positive number (Section AY)" };
  }
  if (!input.timestamp) {
    return { ok: false, error: "FX rate timestamp is required (Section BA)" };
  }
  return {
    ok: true,
    rate: {
      id: input.id,
      sourceCurrency: input.sourceCurrency,
      targetCurrency: input.targetCurrency,
      rate: input.rate,
      timestamp: input.timestamp,
      provider: input.provider,
    },
  };
}

// Section BB: round a major-unit amount to the currency's precision.
export function roundCurrencyMajor(amountMajor: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(amountMajor * factor) / factor;
}

// Section AY: presentation conversion — never a trading/treasury engine.
export function convertCurrency(
  value: LocalizedMonetaryValue,
  rate: FxRate,
  targetPrecision: number,
): { ok: true; value: LocalizedMonetaryValue } | { ok: false; error: string } {
  if (rate.sourceCurrency !== value.currency) {
    return {
      ok: false,
      error: "FX rate source currency must match the value currency (Section AY)",
    };
  }
  const sourceMajor = value.amountMinor / Math.pow(10, value.precision);
  const targetMajor = roundCurrencyMajor(sourceMajor * rate.rate, targetPrecision);
  const targetMinor = Math.round(targetMajor * Math.pow(10, targetPrecision));
  return {
    ok: true,
    value: {
      amountMinor: targetMinor,
      currency: rate.targetCurrency,
      precision: targetPrecision,
      source: value.source,
      timestamp: value.timestamp,
      conversionContext: `${value.currency}->${rate.targetCurrency}@${rate.timestamp}`,
    },
  };
}

// Section BA: historical FX must be timestamp-aware.
export function getHistoricalFxRate(
  rates: readonly FxRate[],
  source: string,
  target: string,
  atDate: string,
): FxRate | null {
  const candidates = rates
    .filter(
      (r) => r.sourceCurrency === source && r.targetCurrency === target && r.timestamp <= atDate,
    )
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return candidates[0] ?? null;
}

/* ─────────────────────────────────────────────────────────────
 * Tax localization (Sections BC, BD, BE)
 * ────────────────────────────────────────────────────────────*/

export type TaxType = "vat" | "gst" | "sales_tax" | "withholding" | "local_levy";

export const TAX_TYPES: readonly TaxType[] = [
  "vat",
  "gst",
  "sales_tax",
  "withholding",
  "local_levy",
] as const;

export interface TaxConfiguration {
  id: TaxConfigId;
  jurisdictionRef: string;
  taxType: TaxType;
  ratePercent: number;
  effectiveFrom: string;
  effectiveUntil?: string;
  version: number;
}

export function createTaxConfiguration(input: {
  id: TaxConfigId;
  jurisdictionRef: string;
  taxType: TaxType;
  ratePercent: number;
  effectiveFrom: string;
  effectiveUntil?: string;
}): { ok: true; config: TaxConfiguration } | { ok: false; error: string } {
  if (!input.jurisdictionRef)
    return { ok: false, error: "Tax jurisdiction is required (Section BC)" };
  if (!TAX_TYPES.includes(input.taxType)) {
    return { ok: false, error: "Unknown tax type (Section BD)" };
  }
  if (!Number.isFinite(input.ratePercent) || input.ratePercent < 0) {
    return { ok: false, error: "Tax rate must be a non-negative percentage (Section BC)" };
  }
  if (!input.effectiveFrom)
    return { ok: false, error: "Tax effective date is required (Section BE)" };
  if (input.effectiveUntil && input.effectiveUntil <= input.effectiveFrom) {
    return { ok: false, error: "Tax effective-until must be after effective-from (Section BE)" };
  }
  return {
    ok: true,
    config: {
      id: input.id,
      jurisdictionRef: input.jurisdictionRef,
      taxType: input.taxType,
      ratePercent: input.ratePercent,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil,
      version: 1,
    },
  };
}

export function getEffectiveTaxRate(
  configs: readonly TaxConfiguration[],
  jurisdictionRef: string,
  taxType: TaxType,
  atDate: string,
): TaxConfiguration | null {
  const candidates = configs
    .filter(
      (c) =>
        c.jurisdictionRef === jurisdictionRef &&
        c.taxType === taxType &&
        c.effectiveFrom <= atDate &&
        (c.effectiveUntil === undefined || atDate < c.effectiveUntil),
    )
    .sort((a, b) => b.version - a.version || b.effectiveFrom.localeCompare(a.effectiveFrom));
  return candidates[0] ?? null;
}

/* ─────────────────────────────────────────────────────────────
 * Measurement system + units (Sections BF, BG, BH)
 * ────────────────────────────────────────────────────────────*/

export interface UnitDefinition {
  id: UnitSystemId;
  system: MeasurementSystem;
  name: string;
  symbol: string;
  kind: "length" | "mass" | "volume" | "temperature" | "area" | "other";
}

export function createUnitDefinition(input: {
  id: UnitSystemId;
  system: MeasurementSystem;
  name: string;
  symbol: string;
  kind: UnitDefinition["kind"];
}): { ok: true; unit: UnitDefinition } | { ok: false; error: string } {
  if (!input.name.trim()) return { ok: false, error: "Unit name is required (Section BF)" };
  if (!input.symbol.trim()) return { ok: false, error: "Unit symbol is required (Section BF)" };
  return {
    ok: true,
    unit: {
      id: input.id,
      system: input.system,
      name: input.name,
      symbol: input.symbol,
      kind: input.kind,
    },
  };
}

export interface UnitConversion {
  source: string;
  target: string;
  /** 1 source unit = `factor` target units. */
  factor: number;
  context?: string;
}

export function createUnitConversion(input: {
  source: string;
  target: string;
  factor: number;
  context?: string;
}): { ok: true; conversion: UnitConversion } | { ok: false; error: string } {
  if (input.source === input.target) {
    return { ok: false, error: "Unit conversion requires distinct source and target (Section BG)" };
  }
  if (!Number.isFinite(input.factor) || input.factor <= 0) {
    return {
      ok: false,
      error: "Unit conversion factor must be a finite positive number (Section BG)",
    };
  }
  return {
    ok: true,
    conversion: {
      source: input.source,
      target: input.target,
      factor: input.factor,
      context: input.context,
    },
  };
}

// Section BG: conversion preserves the original unit and context.
export function convertUnit(
  value: number,
  conversion: UnitConversion,
):
  | {
      ok: true;
      result: { value: number; originalUnit: string; convertedUnit: string; context?: string };
    }
  | { ok: false; error: string } {
  if (!Number.isFinite(value)) {
    return { ok: false, error: "Converted value must be finite (Section BG)" };
  }
  return {
    ok: true,
    result: {
      value: value * conversion.factor,
      originalUnit: conversion.source,
      convertedUnit: conversion.target,
      context: conversion.context,
    },
  };
}

// Section BH: schools may use locally familiar units.
export function createEducationalMeasurement(input: {
  concept: string;
  localUnit: string;
  system: MeasurementSystem;
}):
  | {
      ok: true;
      measurement: { concept: string; localUnit: string; system: MeasurementSystem };
    }
  | { ok: false; error: string } {
  if (!input.concept.trim())
    return { ok: false, error: "Measurement concept is required (Section BH)" };
  if (!input.localUnit.trim()) return { ok: false, error: "Local unit is required (Section BH)" };
  return {
    ok: true,
    measurement: { concept: input.concept, localUnit: input.localUnit, system: input.system },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Data formats + CSV localization (Sections EK, EL, EM)
 * ────────────────────────────────────────────────────────────*/

export interface CsvLocalizationConfig {
  separator: string;
  encoding: string;
  decimalSeparator: string;
  dateFormat: string;
}

export function createCsvLocalizationConfig(input: {
  separator: string;
  encoding: string;
  decimalSeparator: string;
  dateFormat: string;
}): { ok: true; config: CsvLocalizationConfig } | { ok: false; error: string } {
  if (!input.separator) return { ok: false, error: "CSV separator is required (Section EM)" };
  return {
    ok: true,
    config: {
      separator: input.separator,
      encoding: input.encoding,
      decimalSeparator: input.decimalSeparator,
      dateFormat: input.dateFormat,
    },
  };
}

// Section EM: escape cells that contain the configured separator or quotes.
export function formatCsvCell(value: string, config: CsvLocalizationConfig): string {
  if (
    value.includes(config.separator) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export interface ExportFormatConfig {
  locale: string;
  encoding: string;
  lineEnding: "crlf" | "lf";
  dateFormat: string;
  numberFormat: NumberFormatConfig;
}

export function createExportFormatConfig(input: {
  locale: string;
  encoding: string;
  lineEnding: "crlf" | "lf";
  dateFormat: string;
  numberFormat: NumberFormatConfig;
}): { ok: true; config: ExportFormatConfig } | { ok: false; error: string } {
  if (!input.locale.trim()) return { ok: false, error: "Export locale is required (Section EL)" };
  if (!input.encoding.trim())
    return { ok: false, error: "Export encoding is required (Section EL)" };
  return {
    ok: true,
    config: {
      locale: input.locale,
      encoding: input.encoding,
      lineEnding: input.lineEnding,
      dateFormat: input.dateFormat,
      numberFormat: input.numberFormat,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Document + report localization (Sections EN, EO, EP)
 * ────────────────────────────────────────────────────────────*/

export interface DocumentLocalizationProfile {
  language: string;
  locale: string;
  script: string;
  direction: "ltr" | "rtl";
  dateFormat: string;
  numberingSystem: string;
  currency?: string;
  jurisdictionRef?: string;
}

export function createDocumentLocalizationProfile(input: {
  language: string;
  locale: string;
  script: string;
  direction?: "ltr" | "rtl";
  dateFormat: string;
  numberingSystem: string;
  currency?: string;
  jurisdictionRef?: string;
}): { ok: true; profile: DocumentLocalizationProfile } | { ok: false; error: string } {
  if (!input.language.trim() || !input.locale.trim() || !input.script.trim()) {
    return {
      ok: false,
      error: "Document localization requires language, locale, and script (Section EO)",
    };
  }
  const direction = input.direction ?? (input.script === "arab" ? "rtl" : "ltr");
  return {
    ok: true,
    profile: {
      language: input.language,
      locale: input.locale,
      script: input.script,
      direction,
      dateFormat: input.dateFormat,
      numberingSystem: input.numberingSystem,
      currency: input.currency,
      jurisdictionRef: input.jurisdictionRef,
    },
  };
}

export interface ReportLocalization {
  titleKey: string;
  locale: string;
  metricKeys: string[];
  dateFormat: string;
  currency?: string;
  terminologyRef: string;
}

export function createReportLocalization(input: {
  titleKey: string;
  locale: string;
  metricKeys: string[];
  dateFormat: string;
  currency?: string;
  terminologyRef: string;
}): { ok: true; localization: ReportLocalization } | { ok: false; error: string } {
  if (!input.titleKey.trim() || !input.locale.trim() || !input.terminologyRef.trim()) {
    return {
      ok: false,
      error: "Report localization requires title, locale, and terminology (Section EP)",
    };
  }
  return { ok: true, localization: { ...input } };
}

/* ─────────────────────────────────────────────────────────────
 * Audit + log + API localization (Sections EQ, ER, ES)
 * ────────────────────────────────────────────────────────────*/

export interface AuditDisplayLocalization {
  canonicalRef: string;
  displayText: string;
  locale: string;
}

export function createAuditDisplayLocalization(input: {
  canonicalRef: string;
  displayText: string;
  locale: string;
}): { ok: true; localization: AuditDisplayLocalization } | { ok: false; error: string } {
  if (!input.canonicalRef.trim()) {
    return { ok: false, error: "Canonical audit reference is required (Section EQ)" };
  }
  return {
    ok: true,
    localization: {
      canonicalRef: input.canonicalRef,
      displayText: input.displayText,
      locale: input.locale,
    },
  };
}

export interface LocalizedLogView {
  machineKey: string;
  humanView?: string;
  locale: string;
}

export function createLocalizedLogView(input: {
  machineKey: string;
  humanView?: string;
  locale: string;
}): { ok: true; view: LocalizedLogView } | { ok: false; error: string } {
  if (!input.machineKey.trim()) {
    return { ok: false, error: "Machine log key is required (Section ER)" };
  }
  return {
    ok: true,
    view: { machineKey: input.machineKey, humanView: input.humanView, locale: input.locale },
  };
}

export function createApiLocalizationBoundary(input: {
  apiRef: string;
}):
  | { ok: true; boundary: { apiRef: string; presentationLocalized: boolean } }
  | { ok: false; error: string } {
  if (!input.apiRef.trim()) {
    return { ok: false, error: "API reference is required (Section ES)" };
  }
  return { ok: true, boundary: { apiRef: input.apiRef, presentationLocalized: true } };
}

/* ─────────────────────────────────────────────────────────────
 * Communication + payment localization (CS, CT, CU)
 * ────────────────────────────────────────────────────────────*/

export interface CommunicationLocalization {
  language: string;
  templateRef: string;
  dateFormat: string;
  timezone: string;
  regionalSenderConventions: string[];
}

export function createCommunicationLocalization(input: {
  language: string;
  templateRef: string;
  dateFormat: string;
  timezone: string;
  regionalSenderConventions?: string[];
}): { ok: true; localization: CommunicationLocalization } | { ok: false; error: string } {
  if (!input.language.trim() || !input.templateRef.trim() || !input.timezone.trim()) {
    return {
      ok: false,
      error: "Communication localization requires language, template, and timezone (Section CS)",
    };
  }
  return {
    ok: true,
    localization: {
      language: input.language,
      templateRef: input.templateRef,
      dateFormat: input.dateFormat,
      timezone: input.timezone,
      regionalSenderConventions: input.regionalSenderConventions ?? [],
    },
  };
}

export type AfricanPaymentMethod =
  "bank_transfer" | "mobile_money" | "card" | "ussd" | "cash" | "local_provider";

export interface PaymentLocalization {
  jurisdictionRef: string;
  supportedMethods: AfricanPaymentMethod[];
  providers: string[];
  currency: string;
}

export function createPaymentLocalization(input: {
  jurisdictionRef: string;
  supportedMethods: AfricanPaymentMethod[];
  providers?: string[];
  currency: string;
}): { ok: true; localization: PaymentLocalization } | { ok: false; error: string } {
  if (!input.jurisdictionRef.trim()) {
    return { ok: false, error: "Payment jurisdiction is required (Section CT)" };
  }
  if (input.supportedMethods.length === 0) {
    return { ok: false, error: "At least one supported payment method is required (Section CT)" };
  }
  return {
    ok: true,
    localization: {
      jurisdictionRef: input.jurisdictionRef,
      supportedMethods: input.supportedMethods,
      // Section CU: providers are configurable — never a single hard-coded provider.
      providers: input.providers ?? [],
      currency: input.currency,
    },
  };
}

export interface IntegrationLocalization {
  providerRef: string;
  locale: string;
  language: string;
  currency?: string;
  timezone?: string;
  jurisdictionRef?: string;
  regionalSchemaRef?: string;
}

export function createIntegrationLocalization(input: {
  providerRef: string;
  locale: string;
  language: string;
  currency?: string;
  timezone?: string;
  jurisdictionRef?: string;
  regionalSchemaRef?: string;
}): { ok: true; localization: IntegrationLocalization } | { ok: false; error: string } {
  if (!input.providerRef.trim() || !input.locale.trim() || !input.language.trim()) {
    return {
      ok: false,
      error: "Integration localization requires provider, locale, and language (Section EV)",
    };
  }
  return { ok: true, localization: { ...input } };
}
