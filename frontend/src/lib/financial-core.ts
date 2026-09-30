/**
 * CoreGrid — Payment, Billing & Financial Operating System core
 * domain model (Phase 13, Sections F, N, O, P, Q, R, S, T, U, V).
 *
 * Implements `architecture/phase-13-financial-system.md`:
 * - Financial domain model (F): obligations, invoices, payment intents,
 *   attempts, refunds, credits, adjustments, discounts, taxes, receivables,
 *   settlements must be distinct concepts — never collapsed into a single
 *   "transaction" table.
 * - Money representation (T): never represent financial values using
 *   floating-point arithmetic; use integer minor units.
 * - Currency (S): currency code, precision, minor units, metadata,
 *   supported payment currencies.
 * - Multi-currency and exchange rates (U, V): conversion must preserve the
 *   original amounts; historical rates remain immutable.
 * - Financial obligation (N): obligation ID, tenant, debtor, beneficiary,
 *   source, amount, currency, reason, creation timestamp, due date, status.
 * - Invoice (O): invoice ID, number, issuer, customer, currency, issue/due
 *   dates, status, line items, subtotal, discounts, taxes, total, amount
 *   paid, amount outstanding.
 * - Invoice lifecycle (P): historical invoices must remain reconstructable.
 * - Invoice line (Q): every line must represent a specific financial reason
 *   and preserve its historical price and tax basis.
 * - Invoice numbering (R): tenant/institution/fiscal-period sequences,
 *   configurable prefixes, concurrency-safe uniqueness.
 *
 * Boundaries: Phase 02 owns identity; Phase 03 owns tenancy; every financial
 * object carries tenant context (EZ).
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Money representation (S, T)
 * ────────────────────────────────────────────────────────────*/

export interface CurrencyConfig {
  code: string;
  /** Number of minor units per major unit (e.g. 2 for NGN kobo). */
  precision: number;
  symbol: string;
}

export const DEFAULT_CURRENCIES: Record<string, CurrencyConfig> = {
  NGN: { code: "NGN", precision: 2, symbol: "₦" },
  GHS: { code: "GHS", precision: 2, symbol: "GH₵" },
  USD: { code: "USD", precision: 2, symbol: "$" },
  KES: { code: "KES", precision: 2, symbol: "KSh" },
  ZAR: { code: "ZAR", precision: 2, symbol: "R" },
  EUR: { code: "EUR", precision: 2, symbol: "€" },
  GBP: { code: "GBP", precision: 2, symbol: "£" },
} as const;

export interface Money {
  /** Integer minor units — never floating point (T). */
  amountMinor: number;
  currency: string;
}

export function money(amountMinor: number, currency: string): Money {
  return { amountMinor: Math.trunc(amountMinor), currency };
}

export function isZeroMoney(value: Money): boolean {
  return value.amountMinor === 0;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error("Cannot add amounts in different currencies (T)");
  }
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error("Cannot subtract amounts in different currencies (T)");
  }
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function compareMoney(a: Money, b: Money): number {
  if (a.currency !== b.currency) {
    throw new Error("Cannot compare amounts in different currencies (T)");
  }
  return a.amountMinor - b.amountMinor;
}

export interface ExchangeRateRecord {
  sourceCurrency: string;
  destinationCurrency: string;
  rate: number;
  timestamp: string;
  provider: string;
  method: string;
}

export interface ConvertMoneyInput {
  amount: Money;
  destinationCurrency: string;
  rate: ExchangeRateRecord;
}

export type ConvertMoneyResult =
  { ok: true; converted: Money; rateUsed: ExchangeRateRecord } | { ok: false; error: string };

/** Currency conversion must preserve the original amounts (U, V): the source
 * amount and the immutable rate are retained for traceability. */
export function convertMoney(input: ConvertMoneyInput): ConvertMoneyResult {
  if (input.amount.currency !== input.rate.sourceCurrency) {
    return { ok: false, error: "Exchange rate source currency does not match amount currency (V)" };
  }
  if (input.rate.destinationCurrency !== input.destinationCurrency) {
    return { ok: false, error: "Exchange rate destination currency mismatch (V)" };
  }
  const convertedMinor = Math.round(input.amount.amountMinor * input.rate.rate);
  return {
    ok: true,
    converted: money(convertedMinor, input.destinationCurrency),
    rateUsed: input.rate,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Financial obligation (N)
 * ────────────────────────────────────────────────────────────*/

export type ObligationStatus =
  "open" | "partial" | "paid" | "overdue" | "written_off" | "cancelled";

export const OBLIGATION_STATUSES: readonly ObligationStatus[] = [
  "open",
  "partial",
  "paid",
  "overdue",
  "written_off",
  "cancelled",
] as const;

export interface FinancialObligation {
  id: string;
  tenantId: TenantId;
  debtorId: string;
  beneficiaryId: string;
  source: string;
  amount: Money;
  reason: string;
  createdAt: string;
  dueDate: string;
  status: ObligationStatus;
}

export interface CreateObligationInput {
  tenantId: TenantId;
  debtorId: string;
  beneficiaryId: string;
  source: string;
  amount: Money;
  reason: string;
  dueDate: string;
  now: string;
}

export type CreateObligationResult =
  { ok: true; obligation: FinancialObligation } | { ok: false; error: string };

export function createFinancialObligation(input: CreateObligationInput): CreateObligationResult {
  if (input.debtorId.trim() === "") {
    return { ok: false, error: "Obligation requires a debtor (N)" };
  }
  if (input.source.trim() === "") {
    return { ok: false, error: "Obligation requires a source (N)" };
  }
  if (input.amount.amountMinor <= 0) {
    return { ok: false, error: "Obligation amount must be positive (N)" };
  }
  return {
    ok: true,
    obligation: {
      id: `obligation-${input.tenantId}-${input.source}-${input.now}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      debtorId: input.debtorId,
      beneficiaryId: input.beneficiaryId,
      source: input.source,
      amount: input.amount,
      reason: input.reason,
      createdAt: input.now,
      dueDate: input.dueDate,
      status: "open",
    },
  };
}

export function isObligationOverdue(obligation: FinancialObligation, now: string): boolean {
  return (
    (obligation.status === "open" || obligation.status === "partial") &&
    Date.parse(now) > Date.parse(obligation.dueDate)
  );
}

/* ─────────────────────────────────────────────────────────────
 * Invoice (O, P, Q, R)
 * ────────────────────────────────────────────────────────────*/

export type InvoiceStatus =
  "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "void" | "cancelled";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "void",
  "cancelled",
] as const;

export interface InvoiceLine {
  id: string;
  /** Specific financial reason (Q): tuition, registration, examination, transport, hostel, software, facility, subscription. */
  reason: string;
  description: string;
  quantity: number;
  /** Historical price preserved on the line (Q). */
  unitPrice: Money;
  taxRateBasis: number;
}

export interface Invoice {
  id: string;
  number: string;
  tenantId: TenantId;
  issuerId: string;
  customerId: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  subtotal: Money;
  discounts: Money;
  taxes: Money;
  total: Money;
  amountPaid: Money;
  amountOutstanding: Money;
}

export interface CreateInvoiceInput {
  tenantId: TenantId;
  issuerId: string;
  customerId: string;
  number: string;
  currency: string;
  dueDate: string;
  lines: InvoiceLine[];
  discounts?: Money;
  now: string;
}

export type CreateInvoiceResult = { ok: true; invoice: Invoice } | { ok: false; error: string };

function sumLines(lines: InvoiceLine[], currency: string): Money {
  const totalMinor = lines.reduce(
    (sum, line) => sum + line.unitPrice.amountMinor * line.quantity,
    0,
  );
  return money(totalMinor, currency);
}

function computeTaxes(subtotal: Money, lines: InvoiceLine[]): Money {
  const taxMinor = lines.reduce(
    (sum, line) => sum + Math.round(line.unitPrice.amountMinor * line.quantity * line.taxRateBasis),
    0,
  );
  return money(taxMinor, subtotal.currency);
}

/** Create an invoice (O). All monetary math uses integer minor units (T). */
export function createInvoice(input: CreateInvoiceInput): CreateInvoiceResult {
  if (input.lines.length === 0) {
    return { ok: false, error: "Invoice requires at least one line item (O)" };
  }
  for (const line of input.lines) {
    if (line.unitPrice.currency !== input.currency) {
      return { ok: false, error: "Invoice line currency must match invoice currency (T)" };
    }
    if (line.quantity <= 0) {
      return { ok: false, error: "Invoice line quantity must be positive (Q)" };
    }
  }
  const subtotal = sumLines(input.lines, input.currency);
  const discounts = input.discounts ?? money(0, input.currency);
  const taxes = computeTaxes(subtotal, input.lines);
  const total = addMoney(
    subtractMoney(addMoney(subtotal, taxes), discounts),
    money(0, input.currency),
  );
  const amountPaid = money(0, input.currency);
  return {
    ok: true,
    invoice: {
      id: `invoice-${input.tenantId}-${input.number}`,
      number: input.number,
      tenantId: input.tenantId,
      issuerId: input.issuerId,
      customerId: input.customerId,
      currency: input.currency,
      issueDate: input.now,
      dueDate: input.dueDate,
      status: "draft",
      lines: input.lines,
      subtotal,
      discounts,
      taxes,
      total,
      amountPaid,
      amountOutstanding: total,
    },
  };
}

const INVOICE_TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  draft: ["issued", "cancelled", "void"],
  issued: ["partially_paid", "paid", "overdue", "void", "cancelled"],
  partially_paid: ["paid", "overdue", "cancelled"],
  paid: [],
  overdue: ["partially_paid", "paid", "cancelled"],
  void: [],
  cancelled: [],
};

export function transitionInvoice(
  invoice: Invoice,
  to: InvoiceStatus,
): { ok: true; invoice: Invoice } | { ok: false; error: string } {
  if (!INVOICE_TRANSITIONS[invoice.status].includes(to)) {
    return { ok: false, error: `Invoice transition ${invoice.status} -> ${to} is not allowed (P)` };
  }
  return { ok: true, invoice: { ...invoice, status: to } };
}

export interface InvoiceNumberingPolicy {
  prefix: string;
  fiscalPeriod: string;
  startSequence: number;
}

export interface IssueInvoiceNumberInput {
  policy: InvoiceNumberingPolicy;
  /** Caller-provided next sequence. Concurrency-safe numbering must be
   * enforced by the caller's durable store (R). */
  nextSequence: number;
}

export function issueInvoiceNumber(input: IssueInvoiceNumberInput): string {
  const seq = String(input.nextSequence).padStart(6, "0");
  return `${input.policy.prefix}-${input.policy.fiscalPeriod}-${seq}`;
}
