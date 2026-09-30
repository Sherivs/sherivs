/**
 * CoreGrid Scholar — Phase 13 Financial Operating System unit tests
 * (financial-controls).
 *
 * Validates:
 * - Financial invariants: invoices can never be overpaid; refunds can never
 *   exceed the original payment.
 * - Financial idempotency: no duplicate financial effects.
 * - Financial audit events with actor/action/reason/correlation (FC).
 * - Financial state reconstruction from the audit trail (FE).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import { money } from "@/lib/financial-core";
import {
  canApplyPaymentToInvoice,
  canRefundPayment,
  checkFinancialIdempotency,
  createFinancialAuditEvent,
  buildFinancialHistory,
  type FinancialIdempotencyStore,
} from "@/lib/financial-controls";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

describe("Financial invariants", () => {
  it("an invoice can never be overpaid", () => {
    const result = canApplyPaymentToInvoice(
      { total: money(107_500, "NGN"), amountPaid: money(50_000, "NGN") },
      money(80_000, "NGN"),
    );
    expect(result.ok).toBe(false);
  });

  it("allows a payment within the outstanding balance", () => {
    const result = canApplyPaymentToInvoice(
      { total: money(107_500, "NGN"), amountPaid: money(50_000, "NGN") },
      money(57_500, "NGN"),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a cross-currency payment application", () => {
    const result = canApplyPaymentToInvoice(
      { total: money(107_500, "NGN"), amountPaid: money(0, "NGN") },
      money(50, "USD"),
    );
    expect(result.ok).toBe(false);
  });

  it("refunds can never exceed the original payment", () => {
    const ok = canRefundPayment(money(100_000, "NGN"), money(70_000, "NGN"), money(40_000, "NGN"));
    expect(ok.ok).toBe(false);

    const allowed = canRefundPayment(
      money(100_000, "NGN"),
      money(70_000, "NGN"),
      money(30_000, "NGN"),
    );
    expect(allowed.ok).toBe(true);
  });
});

describe("Financial idempotency", () => {
  it("the same key never produces duplicate financial effects", () => {
    const store: FinancialIdempotencyStore = { records: new Map() };
    const first = checkFinancialIdempotency(
      "capture-1",
      "payment.captured",
      "pay-ref-1",
      store,
      NOW,
    );
    expect(first.outcome).toBe("proceed");

    const replay = checkFinancialIdempotency(
      "capture-1",
      "payment.captured",
      "pay-ref-1",
      store,
      NOW,
    );
    expect(replay.outcome).toBe("duplicate");
  });
});

describe("Financial audit (FC) and state reconstruction (FE)", () => {
  it("creates an audit event with actor, action, reason, and correlation", () => {
    const result = createFinancialAuditEvent({
      tenantId: TENANT_A,
      actorId: "admin-1",
      action: "invoice.issued",
      objectType: "invoice",
      objectId: "INV-1",
      previousState: { status: "draft" },
      newState: { status: "issued" },
      reason: "Term start",
      correlationId: "corr-1",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.actorId).toBe("admin-1");
      expect(result.event.reason).toBe("Term start");
      expect(result.event.correlationId).toBe("corr-1");
    }
  });

  it("rejects an audit event without an actor or reason", () => {
    const base = {
      tenantId: TENANT_A,
      action: "invoice.issued" as const,
      objectType: "invoice",
      objectId: "INV-1",
      previousState: {},
      newState: {},
      correlationId: "corr-1",
      now: NOW,
    };
    expect(createFinancialAuditEvent({ ...base, actorId: "", reason: "x" }).ok).toBe(false);
    expect(createFinancialAuditEvent({ ...base, actorId: "admin-1", reason: "" }).ok).toBe(false);
  });

  it("reconstructs financial history from the ordered audit trail (FE)", () => {
    const evt1 = createFinancialAuditEvent({
      tenantId: TENANT_A,
      actorId: "admin-1",
      action: "invoice.issued",
      objectType: "invoice",
      objectId: "INV-1",
      previousState: { status: "draft" },
      newState: { status: "issued" },
      reason: "Term start",
      correlationId: "corr-1",
      now: NOW,
    });
    const evt2 = createFinancialAuditEvent({
      tenantId: TENANT_A,
      actorId: "bursar-1",
      action: "payment.captured",
      objectType: "invoice",
      objectId: "INV-1",
      previousState: { amountPaidMinor: 0 },
      newState: { amountPaidMinor: 107_500 },
      reason: "Webhook capture",
      correlationId: "corr-2",
      now: "2026-01-02T00:00:00Z",
    });
    if (!evt1.ok || !evt2.ok) throw new Error("fixture failed");
    const history = buildFinancialHistory("invoice", "INV-1", [evt2.event, evt1.event], {
      status: "paid",
    });
    expect(history.reconstructable).toBe(true);
    expect(history.events[0].action).toBe("invoice.issued");
    expect(history.events[1].action).toBe("payment.captured");
    expect(history.events[1].actorId).toBe("bursar-1");
  });
});
