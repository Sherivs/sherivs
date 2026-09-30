/**
 * CoreGrid — Payment, Billing & Financial Operating System payment
 * domain (Phase 13, Sections W, X, Y, Z, AA, AB, AC, AD, AE, AF, AK, AL).
 *
 * Implements `architecture/phase-13-financial-system.md`:
 * - Payment Intent (W): intent ID, invoice, amount, currency, customer,
 *   payment-method requirements, expiration, status.
 * - Payment Attempt (X): an actual attempt to process a payment; one intent
 *   may have multiple attempts.
 * - Payment lifecycle (Y): explicit state transitions.
 * - Payment Provider Abstraction (Z, AA): FinOS is not coupled to a single
 *   provider; each adapter handles authentication, request/response
 *   translation, webhook translation, provider-specific errors, provider
 *   identifiers, provider capabilities. The domain model remains
 *   provider-independent.
 * - Payment method tokenization (AC) and the card data boundary (AD): store
 *   tokens, provider, masked metadata — never raw credentials.
 * - Webhook processing (AE): payment webhooks are untrusted external input
 *   until verified; every provider event requires a durable idempotency
 *   identity (AF).
 * - Refunds (AK): must reference the original payment; partial refunds and
 *   overpayment allocation are supported.
 * - Credits and adjustments: independent financial objects (F).
 *
 * Boundaries: Phase 08 owns authorization; Phase 10 owns communication of
 * financial events; Phase 18 consumes financial events without modifying
 * financial truth.
 */

import type { TenantId } from "./tenant-core";
import type { Money } from "./financial-core";
import { money, isZeroMoney } from "./financial-core";

/* ─────────────────────────────────────────────────────────────
 * Payment intent (W)
 * ────────────────────────────────────────────────────────────*/

export type PaymentIntentStatus =
  | "created"
  | "requires_payment_method"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export const PAYMENT_INTENT_STATUSES: readonly PaymentIntentStatus[] = [
  "created",
  "requires_payment_method",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
] as const;

export interface PaymentIntent {
  id: string;
  tenantId: TenantId;
  invoiceId: string;
  amount: Money;
  customerId: string;
  paymentMethodRequirements: string[];
  expiresAt: string | null;
  status: PaymentIntentStatus;
  createdAt: string;
}

export interface CreatePaymentIntentInput {
  tenantId: TenantId;
  invoiceId: string;
  amount: Money;
  customerId: string;
  paymentMethodRequirements?: string[];
  expiresAt?: string | null;
  now: string;
}

export type CreatePaymentIntentResult =
  { ok: true; intent: PaymentIntent } | { ok: false; error: string };

export function createPaymentIntent(input: CreatePaymentIntentInput): CreatePaymentIntentResult {
  if (input.invoiceId.trim() === "") {
    return { ok: false, error: "Payment intent requires an invoice (W)" };
  }
  if (input.amount.amountMinor <= 0) {
    return { ok: false, error: "Payment intent amount must be positive (W)" };
  }
  return {
    ok: true,
    intent: {
      id: `intent-${input.tenantId}-${input.invoiceId}-${input.now}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      invoiceId: input.invoiceId,
      amount: input.amount,
      customerId: input.customerId,
      paymentMethodRequirements: input.paymentMethodRequirements ?? [],
      expiresAt: input.expiresAt ?? null,
      status: "created",
      createdAt: input.now,
    },
  };
}

const INTENT_TRANSITIONS: Readonly<Record<PaymentIntentStatus, readonly PaymentIntentStatus[]>> = {
  created: ["requires_payment_method", "processing", "cancelled", "expired"],
  requires_payment_method: ["processing", "cancelled", "expired"],
  processing: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: ["requires_payment_method", "cancelled"],
  cancelled: [],
  expired: [],
};

export function transitionPaymentIntent(
  intent: PaymentIntent,
  to: PaymentIntentStatus,
): { ok: true; intent: PaymentIntent } | { ok: false; error: string } {
  if (!INTENT_TRANSITIONS[intent.status].includes(to)) {
    return {
      ok: false,
      error: `Payment intent transition ${intent.status} -> ${to} is not allowed (Y)`,
    };
  }
  return { ok: true, intent: { ...intent, status: to } };
}

/* ─────────────────────────────────────────────────────────────
 * Payment attempt (X)
 * ────────────────────────────────────────────────────────────*/

export interface PaymentAttempt {
  id: string;
  intentId: string;
  tenantId: TenantId;
  attemptNumber: number;
  provider: string;
  providerReference: string | null;
  status: "pending" | "succeeded" | "failed";
  amount: Money;
  attemptedAt: string;
  providerError: string | null;
}

export interface RecordPaymentAttemptInput {
  intentId: string;
  tenantId: TenantId;
  attemptNumber: number;
  provider: string;
  amount: Money;
  now: string;
}

export type RecordPaymentAttemptResult =
  { ok: true; attempt: PaymentAttempt } | { ok: false; error: string };

export function recordPaymentAttempt(input: RecordPaymentAttemptInput): RecordPaymentAttemptResult {
  if (input.provider.trim() === "") {
    return { ok: false, error: "Payment attempt requires a provider (X)" };
  }
  return {
    ok: true,
    attempt: {
      id: `attempt-${input.intentId}-${input.attemptNumber}`,
      intentId: input.intentId,
      tenantId: input.tenantId,
      attemptNumber: input.attemptNumber,
      provider: input.provider,
      providerReference: null,
      status: "pending",
      amount: input.amount,
      attemptedAt: input.now,
      providerError: null,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Provider abstraction (Z, AA)
 * ────────────────────────────────────────────────────────────*/

export interface ProviderCapabilities {
  supportsCards: boolean;
  supportsBankTransfer: boolean;
  supportsMobileMoney: boolean;
  supportsRecurring: boolean;
}

export interface ProviderAdapterContract {
  provider: string;
  capabilities: ProviderCapabilities;
}

export interface ProviderAdapter {
  readonly contract: ProviderAdapterContract;
  createPaymentLink(intent: PaymentIntent): Promise<{ url: string; providerReference: string }>;
}

/* ─────────────────────────────────────────────────────────────
 * Tokenized payment method (AC, AD)
 * ────────────────────────────────────────────────────────────*/

export type PaymentMethodKind =
  | "bank_transfer"
  | "card"
  | "mobile_money"
  | "wallet"
  | "direct_debit"
  | "payment_link"
  | "cash"
  | "external"
  | "institutional";

export const PAYMENT_METHOD_KINDS: readonly PaymentMethodKind[] = [
  "bank_transfer",
  "card",
  "mobile_money",
  "wallet",
  "direct_debit",
  "payment_link",
  "cash",
  "external",
  "institutional",
] as const;

export interface TokenizedPaymentMethod {
  id: string;
  tenantId: TenantId;
  customerId: string;
  kind: PaymentMethodKind;
  provider: string;
  /** Provider token — raw credentials are never stored (AC, AD). */
  token: string;
  maskedMetadata: string | null;
  expiresAt: string | null;
}

export interface CreateTokenizedPaymentMethodInput {
  tenantId: TenantId;
  customerId: string;
  kind: PaymentMethodKind;
  provider: string;
  token: string;
  maskedMetadata?: string | null;
  expiresAt?: string | null;
}

export type CreateTokenizedPaymentMethodResult =
  { ok: true; method: TokenizedPaymentMethod } | { ok: false; error: string };

export function createTokenizedPaymentMethod(
  input: CreateTokenizedPaymentMethodInput,
): CreateTokenizedPaymentMethodResult {
  if (input.token.trim() === "") {
    return { ok: false, error: "Payment method requires a provider token (AC)" };
  }
  return {
    ok: true,
    method: {
      id: `pm-${input.tenantId}-${input.customerId}-${input.provider}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      customerId: input.customerId,
      kind: input.kind,
      provider: input.provider,
      token: input.token,
      maskedMetadata: input.maskedMetadata ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Webhook processing (AE, AF)
 * ────────────────────────────────────────────────────────────*/

export type WebhookVerificationResult =
  { ok: true; verifiedEventId: string } | { ok: false; error: string };

/**
 * Webhooks are untrusted external input until verified (AE). This function
 * models the verification contract; the concrete signature check is
 * provider-adapter responsibility. Every provider event requires a durable
 * idempotency identity (AF).
 */
export function verifyWebhook(rawEvent: {
  provider: string;
  eventId: string;
  signatureValid: boolean;
}): WebhookVerificationResult {
  if (!rawEvent.signatureValid) {
    return { ok: false, error: "Webhook signature verification failed (AE)" };
  }
  return { ok: true, verifiedEventId: rawEvent.eventId };
}

export interface WebhookIdempotencyState {
  processedEventIds: Set<string>;
}

export function isWebhookEventProcessed(eventId: string, state: WebhookIdempotencyState): boolean {
  return state.processedEventIds.has(eventId);
}

/** Mark a webhook event processed so repeated provider webhooks cannot
 * produce duplicate financial effects (AF). */
export function markWebhookEventProcessed(eventId: string, state: WebhookIdempotencyState): void {
  state.processedEventIds.add(eventId);
}

/* ─────────────────────────────────────────────────────────────
 * Refunds (AK)
 * ────────────────────────────────────────────────────────────*/

export type RefundStatus = "requested" | "processed" | "failed" | "cancelled";

export const REFUND_STATUSES: readonly RefundStatus[] = [
  "requested",
  "processed",
  "failed",
  "cancelled",
] as const;

export interface Refund {
  id: string;
  tenantId: TenantId;
  originalPaymentReference: string;
  amount: Money;
  reason: string;
  status: RefundStatus;
  createdAt: string;
  processedAt: string | null;
}

export interface CreateRefundInput {
  tenantId: TenantId;
  originalPaymentReference: string;
  amount: Money;
  reason: string;
  now: string;
}

export type CreateRefundResult = { ok: true; refund: Refund } | { ok: false; error: string };

export function createRefund(input: CreateRefundInput): CreateRefundResult {
  if (input.originalPaymentReference.trim() === "") {
    return { ok: false, error: "Refund must reference the original payment (AK)" };
  }
  if (input.amount.amountMinor <= 0) {
    return { ok: false, error: "Refund amount must be positive (AK)" };
  }
  return {
    ok: true,
    refund: {
      id: `refund-${input.tenantId}-${input.originalPaymentReference}-${input.now}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      originalPaymentReference: input.originalPaymentReference,
      amount: input.amount,
      reason: input.reason,
      status: "requested",
      createdAt: input.now,
      processedAt: null,
    },
  };
}

export function transitionRefund(
  refund: Refund,
  to: RefundStatus,
  now: string,
): { ok: true; refund: Refund } | { ok: false; error: string } {
  const allowed: Record<RefundStatus, readonly RefundStatus[]> = {
    requested: ["processed", "failed", "cancelled"],
    processed: [],
    failed: ["requested"],
    cancelled: [],
  };
  if (!allowed[refund.status].includes(to)) {
    return { ok: false, error: `Refund transition ${refund.status} -> ${to} is not allowed` };
  }
  return {
    ok: true,
    refund: { ...refund, status: to, processedAt: to === "processed" ? now : refund.processedAt },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Credits and adjustments (F)
 * ────────────────────────────────────────────────────────────*/

export interface FinancialCredit {
  id: string;
  tenantId: TenantId;
  customerId: string;
  amount: Money;
  remaining: Money;
  reason: string;
  createdAt: string;
}

export interface CreateCreditInput {
  tenantId: TenantId;
  customerId: string;
  amount: Money;
  reason: string;
  now: string;
}

export type CreateCreditResult =
  { ok: true; credit: FinancialCredit } | { ok: false; error: string };

export function createFinancialCredit(input: CreateCreditInput): CreateCreditResult {
  if (input.amount.amountMinor <= 0) {
    return { ok: false, error: "Credit amount must be positive" };
  }
  return {
    ok: true,
    credit: {
      id: `credit-${input.tenantId}-${input.customerId}-${input.now}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      customerId: input.customerId,
      amount: input.amount,
      remaining: input.amount,
      reason: input.reason,
      createdAt: input.now,
    },
  };
}

export type ApplyCreditResult =
  { ok: true; credit: FinancialCredit; applied: Money } | { ok: false; error: string };

/** Apply a credit toward an outstanding amount; partial application is
 * supported; a credit can never be over-applied. */
export function applyCredit(credit: FinancialCredit, amount: Money): ApplyCreditResult {
  if (amount.currency !== credit.remaining.currency) {
    return { ok: false, error: "Credit and application currency mismatch (T)" };
  }
  if (amount.amountMinor > credit.remaining.amountMinor) {
    return { ok: false, error: "Credit application exceeds remaining balance" };
  }
  const remainingMinor = credit.remaining.amountMinor - amount.amountMinor;
  return {
    ok: true,
    credit: { ...credit, remaining: money(remainingMinor, credit.remaining.currency) },
    applied: amount,
  };
}

export type AdjustmentKind = "discount" | "surcharge" | "correction";

export interface FinancialAdjustment {
  id: string;
  tenantId: TenantId;
  invoiceId: string;
  kind: AdjustmentKind;
  amount: Money;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface CreateAdjustmentInput {
  tenantId: TenantId;
  invoiceId: string;
  kind: AdjustmentKind;
  amount: Money;
  reason: string;
  createdBy: string;
  now: string;
}

export type CreateAdjustmentResult =
  { ok: true; adjustment: FinancialAdjustment } | { ok: false; error: string };

export function createFinancialAdjustment(input: CreateAdjustmentInput): CreateAdjustmentResult {
  if (input.reason.trim() === "") {
    return { ok: false, error: "Adjustment requires a reason" };
  }
  if (isZeroMoney(input.amount)) {
    return { ok: false, error: "Adjustment amount cannot be zero" };
  }
  return {
    ok: true,
    adjustment: {
      id: `adjustment-${input.tenantId}-${input.invoiceId}-${input.now}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      invoiceId: input.invoiceId,
      kind: input.kind,
      amount: input.amount,
      reason: input.reason,
      createdBy: input.createdBy,
      createdAt: input.now,
    },
  };
}
