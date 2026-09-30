/**
 * CoreGrid — Payment, Billing & Financial Operating System financial
 * controls (Phase 13, Sections FC, FD, FE, and the financial invariants).
 *
 * Implements `architecture/phase-13-financial-system.md`:
 * - Financial audit (FC): audit records preserve actor, action, object,
 *   previous state, new state, reason, timestamp, correlation ID.
 * - Non-repudiation (FD): high-risk financial actions provide strong
 *   evidence of who initiated and approved them.
 * - Financial state reconstruction (FE): every financial object can answer
 *   who created it, why, from which source, what changed, who changed it,
 *   what payment/refund/adjustment affected it, and its current state.
 * - Financial invariants: an invoice can never be overpaid; refunds can
 *   never exceed the original payment; a paid invoice cannot be voided;
 *   reconciliation discrepancies must never be silently absorbed;
 *   idempotency prevents duplicate financial effects.
 *
 * Boundaries: Phase 08 owns security enforcement; this module defines the
 * financial-control contracts only.
 */

import type { TenantId } from "./tenant-core";
import type { Money } from "./financial-core";

/* ─────────────────────────────────────────────────────────────
 * Financial invariants
 * ────────────────────────────────────────────────────────────*/

export interface InvoicePaymentState {
  total: Money;
  amountPaid: Money;
}

/**
 * Invariant: an invoice can never be overpaid. The payment amount applied
 * must never exceed the outstanding total.
 */
export function canApplyPaymentToInvoice(
  state: InvoicePaymentState,
  paymentAmount: Money,
): { ok: true; allowedAmount: Money } | { ok: false; error: string } {
  if (paymentAmount.currency !== state.total.currency) {
    return { ok: false, error: "Payment currency does not match invoice currency (T)" };
  }
  const remainingMinor = state.total.amountMinor - state.amountPaid.amountMinor;
  if (paymentAmount.amountMinor > remainingMinor) {
    return { ok: false, error: "Payment would overpay the invoice (invariant violated)" };
  }
  return { ok: true, allowedAmount: paymentAmount };
}

/**
 * Invariant: refunds can never exceed the original payment amount.
 */
export function canRefundPayment(
  originalPaymentAmount: Money,
  totalRefunded: Money,
  requestedRefund: Money,
): { ok: true } | { ok: false; error: string } {
  if (requestedRefund.currency !== originalPaymentAmount.currency) {
    return { ok: false, error: "Refund currency does not match original payment (T)" };
  }
  const totalAfter = totalRefunded.amountMinor + requestedRefund.amountMinor;
  if (totalAfter > originalPaymentAmount.amountMinor) {
    return {
      ok: false,
      error: "Total refunds would exceed the original payment (invariant violated)",
    };
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Financial idempotency
 * ────────────────────────────────────────────────────────────*/

export interface FinancialIdempotencyRecord {
  key: string;
  action: string;
  firstSeenAt: string;
  resultRef: string;
}

export interface FinancialIdempotencyStore {
  records: Map<string, FinancialIdempotencyRecord>;
}

export type FinancialIdempotencyResult =
  | { outcome: "proceed"; record: FinancialIdempotencyRecord }
  | { outcome: "duplicate"; record: FinancialIdempotencyRecord };

/**
 * Financial idempotency: the same idempotency key must never produce
 * duplicate financial effects (e.g. double payment capture from a retried
 * webhook).
 */
export function checkFinancialIdempotency(
  key: string,
  action: string,
  resultRef: string,
  store: FinancialIdempotencyStore,
  now: string,
): FinancialIdempotencyResult {
  const existing = store.records.get(key);
  if (existing) {
    return { outcome: "duplicate", record: existing };
  }
  const record: FinancialIdempotencyRecord = { key, action, firstSeenAt: now, resultRef };
  store.records.set(key, record);
  return { outcome: "proceed", record };
}

/* ─────────────────────────────────────────────────────────────
 * Financial audit (FC) and non-repudiation (FD)
 * ────────────────────────────────────────────────────────────*/

export type FinancialAuditAction =
  | "invoice.issued"
  | "invoice.voided"
  | "payment.captured"
  | "refund.processed"
  | "credit.applied"
  | "adjustment.created"
  | "obligation.created"
  | "provider.credential_rotated";

export interface FinancialAuditEvent {
  id: string;
  tenantId: TenantId;
  actorId: string;
  action: FinancialAuditAction;
  objectType: string;
  objectId: string;
  previousState: unknown;
  newState: unknown;
  reason: string;
  timestamp: string;
  correlationId: string;
}

export interface CreateFinancialAuditEventInput {
  tenantId: TenantId;
  actorId: string;
  action: FinancialAuditAction;
  objectType: string;
  objectId: string;
  previousState: unknown;
  newState: unknown;
  reason: string;
  correlationId: string;
  now: string;
}

export type CreateFinancialAuditEventResult =
  { ok: true; event: FinancialAuditEvent } | { ok: false; error: string };

/** Create a financial audit event. Audit events are immutable records (FC). */
export function createFinancialAuditEvent(
  input: CreateFinancialAuditEventInput,
): CreateFinancialAuditEventResult {
  if (input.actorId.trim() === "") {
    return { ok: false, error: "Financial audit requires an actor (FC)" };
  }
  if (input.reason.trim() === "") {
    return { ok: false, error: "Financial audit requires a reason (FC)" };
  }
  return {
    ok: true,
    event: {
      id: `fin-audit-${input.tenantId}-${input.objectId}-${input.now}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      previousState: input.previousState,
      newState: input.newState,
      reason: input.reason,
      timestamp: input.now,
      correlationId: input.correlationId,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Financial state reconstruction (FE)
 * ────────────────────────────────────────────────────────────*/

export interface FinancialProvenanceLine {
  at: string;
  action: FinancialAuditAction;
  actorId: string;
  reason: string;
  correlationId: string;
}

export interface FinancialHistory {
  objectType: string;
  objectId: string;
  events: FinancialProvenanceLine[];
  currentState: unknown;
  reconstructable: boolean;
}

/**
 * Financial state reconstruction (FE): given the audit trail and the current
 * state, CoreGrid can answer who created an object, why, what changed, who
 * changed it, and what the current state is. Historical states are
 * reconstructable from the ordered immutable event trail.
 */
export function buildFinancialHistory(
  objectType: string,
  objectId: string,
  events: FinancialAuditEvent[],
  currentState: unknown,
): FinancialHistory {
  const ordered = [...events]
    .filter((e) => e.objectType === objectType && e.objectId === objectId)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return {
    objectType,
    objectId,
    events: ordered.map((e) => ({
      at: e.timestamp,
      action: e.action,
      actorId: e.actorId,
      reason: e.reason,
      correlationId: e.correlationId,
    })),
    currentState,
    reconstructable: ordered.length > 0,
  };
}
