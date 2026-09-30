/**
 * CoreGrid — Payment, Billing & Financial Operating System
 * reconciliation, settlement, product/pricing, and subscription domain
 * (Phase 13, Sections G, I, J, K, L, AG, AH, AI, AJ, AN).
 *
 * Implements `architecture/phase-13-financial-system.md`:
 * - Reconciliation (AG): compares provider records against internal records;
 *   discrepancies must be detected explicitly. Reconciliation states (AH).
 * - Settlement (AI): funds becoming available through a provider; track
 *   settlement ID, provider, amount, currency, settlement date, fees, net
 *   amount, reference, reconciliation state.
 * - Provider fees (AJ): recorded separately from the gross payment; never
 *   silently subtract fees from the original payment amount.
 * - Product model (G): products must be versioned; a price change must never
 *   rewrite historical financial records (J).
 * - Pricing engine (I): fixed, variable, tiered, volume, per-user, per-seat,
 *   usage-based, recurring, one-time, promotional, institution-specific.
 * - Billing plans (K) and intervals (L).
 * - Partial payments, overpayments, and payment allocation (FF).
 */

import type { TenantId } from "./tenant-core";
import type { Money } from "./financial-core";
import { money } from "./financial-core";

/* ─────────────────────────────────────────────────────────────
 * Reconciliation (AG, AH)
 * ────────────────────────────────────────────────────────────*/

export type ReconciliationState = "pending" | "matched" | "discrepancy" | "resolved";

export const RECONCILIATION_STATES: readonly ReconciliationState[] = [
  "pending",
  "matched",
  "discrepancy",
  "resolved",
] as const;

export interface ReconciliationRecord {
  id: string;
  tenantId: TenantId;
  provider: string;
  providerAmount: Money;
  internalAmount: Money;
  state: ReconciliationState;
  discrepancyAmount: Money;
  matchedAt: string | null;
}

export interface ReconcileInput {
  tenantId: TenantId;
  provider: string;
  providerAmount: Money;
  internalAmount: Money;
  now: string;
}

export interface ReconcileOutput {
  record: ReconciliationRecord;
  matched: boolean;
  discrepancyDetected: boolean;
}

/**
 * Reconciliation (AG): compares provider records against internal records.
 * Discrepancies must be detected explicitly — never silently absorbed.
 */
export function reconcile(input: ReconcileInput): ReconcileOutput {
  const matched =
    input.providerAmount.currency === input.internalAmount.currency &&
    input.providerAmount.amountMinor === input.internalAmount.amountMinor;
  const discrepancyAmount = matched
    ? money(0, input.internalAmount.currency)
    : money(
        input.internalAmount.amountMinor - input.providerAmount.amountMinor,
        input.internalAmount.currency,
      );
  return {
    record: {
      id: `recon-${input.tenantId}-${input.provider}-${input.now}`,
      tenantId: input.tenantId,
      provider: input.provider,
      providerAmount: input.providerAmount,
      internalAmount: input.internalAmount,
      state: matched ? "matched" : "discrepancy",
      discrepancyAmount,
      matchedAt: matched ? input.now : null,
    },
    matched,
    discrepancyDetected: !matched,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Settlement (AI) and provider fees (AJ)
 * ────────────────────────────────────────────────────────────*/

export interface Settlement {
  id: string;
  tenantId: TenantId;
  provider: string;
  grossAmount: Money;
  /** Provider fees recorded separately from the gross payment (AJ). */
  fees: Money;
  netAmount: Money;
  settlementDate: string;
  reference: string;
  reconciliationState: ReconciliationState;
}

export interface CreateSettlementInput {
  tenantId: TenantId;
  provider: string;
  grossAmount: Money;
  fees: Money;
  settlementDate: string;
  reference: string;
  now: string;
}

export type CreateSettlementResult =
  { ok: true; settlement: Settlement } | { ok: false; error: string };

export function createSettlement(input: CreateSettlementInput): CreateSettlementResult {
  if (input.grossAmount.currency !== input.fees.currency) {
    return { ok: false, error: "Settlement gross and fees currency mismatch (AJ)" };
  }
  if (input.fees.amountMinor > input.grossAmount.amountMinor) {
    return { ok: false, error: "Provider fees cannot exceed the gross amount (AJ)" };
  }
  const netMinor = input.grossAmount.amountMinor - input.fees.amountMinor;
  return {
    ok: true,
    settlement: {
      id: `settlement-${input.tenantId}-${input.provider}-${input.reference}`,
      tenantId: input.tenantId,
      provider: input.provider,
      grossAmount: input.grossAmount,
      fees: input.fees,
      netAmount: money(netMinor, input.grossAmount.currency),
      settlementDate: input.settlementDate,
      reference: input.reference,
      reconciliationState: "pending",
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Payment allocation (FF)
 * ────────────────────────────────────────────────────────────*/

export interface PaymentAllocationInput {
  paymentAmount: Money;
  outstandingAmount: Money;
}

export type PaymentAllocationOutput =
  { ok: true; allocated: Money; overpayment: Money } | { ok: false; error: string };

/**
 * Payment allocation (FF): partial payments and overpayments work. The
 * allocated portion is capped by the outstanding amount; the excess is
 * reported as overpayment (never silently discarded).
 */
export function allocatePayment(input: PaymentAllocationInput): PaymentAllocationOutput {
  if (input.paymentAmount.currency !== input.outstandingAmount.currency) {
    return { ok: false, error: "Payment and outstanding currency mismatch (T)" };
  }
  const allocatedMinor = Math.min(
    input.paymentAmount.amountMinor,
    input.outstandingAmount.amountMinor,
  );
  const overpaymentMinor = input.paymentAmount.amountMinor - allocatedMinor;
  return {
    ok: true,
    allocated: money(allocatedMinor, input.paymentAmount.currency),
    overpayment: money(overpaymentMinor, input.paymentAmount.currency),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Products and pricing (G, I, J)
 * ────────────────────────────────────────────────────────────*/

export type PricingModel =
  | "fixed"
  | "variable"
  | "tiered"
  | "volume"
  | "per_user"
  | "per_seat"
  | "usage_based"
  | "recurring"
  | "one_time"
  | "promotional"
  | "institution_specific";

export const PRICING_MODELS: readonly PricingModel[] = [
  "fixed",
  "variable",
  "tiered",
  "volume",
  "per_user",
  "per_seat",
  "usage_based",
  "recurring",
  "one_time",
  "promotional",
  "institution_specific",
] as const;

export interface FinancialProduct {
  id: string;
  tenantId: TenantId;
  name: string;
  version: number;
  pricingModel: PricingModel;
  /** Base price in minor units for fixed/per-user/per-seat models. */
  basePrice: Money;
  billingInterval: string | null;
  active: boolean;
  createdAt: string;
}

export interface CreateProductInput {
  id: string;
  tenantId: TenantId;
  name: string;
  version: number;
  pricingModel: PricingModel;
  basePrice: Money;
  billingInterval?: string | null;
  active?: boolean;
  now: string;
}

export type CreateProductResult =
  { ok: true; product: FinancialProduct } | { ok: false; error: string };

export function createFinancialProduct(input: CreateProductInput): CreateProductResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Product name is required (G)" };
  }
  if (input.basePrice.amountMinor < 0) {
    return { ok: false, error: "Product base price cannot be negative (I)" };
  }
  return {
    ok: true,
    product: {
      id: input.id,
      tenantId: input.tenantId,
      name: input.name,
      version: input.version,
      pricingModel: input.pricingModel,
      basePrice: input.basePrice,
      billingInterval: input.billingInterval ?? null,
      active: input.active ?? true,
      createdAt: input.now,
    },
  };
}

/**
 * Price versioning (J): a price change must never rewrite historical
 * financial records. Existing invoices retain the old version; new invoices
 * use the new version. This function produces a new product version rather
 * than mutating the existing one.
 */
export function versionProductPrice(
  product: FinancialProduct,
  newPrice: Money,
  now: string,
): FinancialProduct {
  return {
    ...product,
    version: product.version + 1,
    basePrice: newPrice,
    createdAt: now,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Billing plans and subscriptions (K, L, AN)
 * ────────────────────────────────────────────────────────────*/

export type BillingInterval =
  | "one_time"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "academic_term"
  | "academic_semester"
  | "custom";

export const BILLING_INTERVALS: readonly BillingInterval[] = [
  "one_time",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "academic_term",
  "academic_semester",
  "custom",
] as const;

export interface BillingPlan {
  id: string;
  tenantId: TenantId;
  name: string;
  price: Money;
  billingInterval: BillingInterval;
  includedProductIds: string[];
  usageLimits: Record<string, number>;
  gracePeriodDays: number;
  cancellationRules: string[];
  active: boolean;
}

export interface CreateBillingPlanInput {
  id: string;
  tenantId: TenantId;
  name: string;
  price: Money;
  billingInterval: BillingInterval;
  includedProductIds?: string[];
  usageLimits?: Record<string, number>;
  gracePeriodDays?: number;
  cancellationRules?: string[];
  active?: boolean;
}

export type CreateBillingPlanResult =
  { ok: true; plan: BillingPlan } | { ok: false; error: string };

export function createBillingPlan(input: CreateBillingPlanInput): CreateBillingPlanResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Billing plan name is required (K)" };
  }
  return {
    ok: true,
    plan: {
      id: input.id,
      tenantId: input.tenantId,
      name: input.name,
      price: input.price,
      billingInterval: input.billingInterval,
      includedProductIds: input.includedProductIds ?? [],
      usageLimits: input.usageLimits ?? {},
      gracePeriodDays: input.gracePeriodDays ?? 0,
      cancellationRules: input.cancellationRules ?? [],
      active: input.active ?? true,
    },
  };
}

export interface Subscription {
  id: string;
  tenantId: TenantId;
  customerId: string;
  planId: string;
  status: "active" | "past_due" | "cancelled" | "expired";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  createdAt: string;
}

export interface CreateSubscriptionInput {
  tenantId: TenantId;
  customerId: string;
  planId: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  now: string;
}

export type CreateSubscriptionResult =
  { ok: true; subscription: Subscription } | { ok: false; error: string };

export function createSubscription(input: CreateSubscriptionInput): CreateSubscriptionResult {
  if (Date.parse(input.currentPeriodEnd) <= Date.parse(input.currentPeriodStart)) {
    return { ok: false, error: "Subscription period end must be after period start" };
  }
  return {
    ok: true,
    subscription: {
      id: `sub-${input.tenantId}-${input.customerId}-${input.planId}-${input.now}`,
      tenantId: input.tenantId,
      customerId: input.customerId,
      planId: input.planId,
      status: "active",
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      createdAt: input.now,
    },
  };
}

export function isSubscriptionActive(subscription: Subscription, now: string): boolean {
  return (
    subscription.status === "active" &&
    Date.parse(now) >= Date.parse(subscription.currentPeriodStart) &&
    Date.parse(now) <= Date.parse(subscription.currentPeriodEnd)
  );
}
