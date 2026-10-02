/**
 * CoreGrid — MISSION H2-26: legacy durable payment-table reconciliation
 * contract tests (J-044, COND-009, ADR-005 tombstone discipline).
 *
 * Credential-free and pure (BLK-4): exercises the classification classes
 * (reconciled / orphaned / duplicate / amount-mismatch / reference-missing),
 * the canonical Paystack-reference linkage, the immutable provenance-stamped
 * report record, the no-mutation invariant over legacy rows, and the
 * fail-closed denial of ambiguous money.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalProviderReference,
  claimsLegacyMoney,
  reconcileLegacyPayments,
  type LegacyPaystackReceipt,
  type LegacyPaymentRow,
  type LegacyReconciliationContext,
} from "../../frontend/src/lib/payments/legacy-reconciliation";
import { tenantId } from "../../frontend/src/lib/tenant-core";

const TENANT = tenantId("tenant-mh26-a");
const OTHER_TENANT = tenantId("tenant-mh26-b");
const CURRENCY = "NGN";
const GENERATED_AT = "2026-10-02T00:00:00.000Z";

const context: LegacyReconciliationContext = { currency: CURRENCY, generatedAt: GENERATED_AT };

/** Legacy `public.fees` row (migration 20260620122048 shape). */
function feeRow(overrides: Partial<LegacyPaymentRow> & { id: string }): LegacyPaymentRow {
  return {
    family: "fees",
    tenantId: TENANT,
    status: "paid",
    amountMinor: 15_000,
    settledMinor: 15_000,
    paystackReference: null,
    ...overrides,
  } as LegacyPaymentRow;
}

/** Legacy `public.student_platform_fee_ledger` row (20260726085612 shape). */
function ledgerRow(overrides: Partial<LegacyPaymentRow> & { id: string }): LegacyPaymentRow {
  return {
    family: "platform_fee_ledger",
    tenantId: TENANT,
    status: "collected",
    amountMinor: 50_000,
    settledMinor: 50_000,
    paymentReference: null,
    ...overrides,
  } as LegacyPaymentRow;
}

function receipt(overrides: Partial<LegacyPaystackReceipt> = {}): LegacyPaystackReceipt {
  return {
    reference: "uos_fee0001_1727740000",
    amountMinor: 15_000,
    currency: CURRENCY,
    occurredAtSec: 1_727_740_000,
    purposeHint: null,
    tenantIdHint: TENANT,
    ...overrides,
  };
}

/** Structural no-mutation probe: deep-freeze every input before the run. */
function freezeAll<T>(values: readonly T[]): readonly T[] {
  for (const value of values) {
    deepFreeze(value);
  }
  return values;
}

function deepFreeze(value: unknown): void {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
}

describe("MH-26 classification classes", () => {
  it("classifies a reference-bound row whose receipt matches as reconciled", () => {
    const rows = freezeAll([feeRow({ id: "fee-0001", paystackReference: "uos_fee0001_1" })]);
    const receipts = freezeAll([receipt({ reference: "uos_fee0001_1" })]);
    const report = reconcileLegacyPayments(rows, receipts, context);

    expect(report.balanced).toBe(true);
    expect(report.counts.reconciled).toBe(1);
    const entry = report.entries[0];
    expect(entry?.kind).toBe("reconciled");
    if (entry?.kind === "reconciled") {
      expect(entry.family).toBe("fees");
      expect(entry.providerReference).toBe("uos_fee0001_1");
      expect(entry.receiptReference).toBe("uos_fee0001_1");
      expect(entry.claimed).toEqual({ amountMinor: 15_000, currency: "NGN" });
      expect(entry.received).toEqual({ amountMinor: 15_000, currency: "NGN" });
    } else {
      expect.unreachable("expected a reconciled entry");
    }
  });

  it("classifies a collected ledger row reconciled through payment_reference", () => {
    const rows = freezeAll([
      ledgerRow({ id: "ledger-0001", paymentReference: "uos_ledger0001_1" }),
    ]);
    const receipts = freezeAll([receipt({ reference: "uos_ledger0001_1", amountMinor: 50_000 })]);
    const report = reconcileLegacyPayments(rows, receipts, context);

    expect(report.balanced).toBe(true);
    expect(report.counts.reconciled).toBe(1);
    if (report.entries[0]?.kind === "reconciled") {
      expect(report.entries[0].family).toBe("platform_fee_ledger");
    } else {
      expect.unreachable("expected a reconciled entry");
    }
  });

  it("classifies a settled-claim disagreement as amount_mismatch and reports both values without correcting", () => {
    const rows = freezeAll([
      feeRow({ id: "fee-0001", settledMinor: 12_000, paystackReference: "uos_fee0001_2" }),
    ]);
    const receipts = freezeAll([receipt({ reference: "uos_fee0001_2", amountMinor: 15_000 })]);
    const report = reconcileLegacyPayments(rows, receipts, context);

    expect(report.balanced).toBe(false);
    expect(report.counts.amountMismatch).toBe(1);
    const entry = report.entries[0];
    expect(entry?.kind).toBe("amount_mismatch");
    if (entry?.kind === "amount_mismatch") {
      expect(entry.claimed).toEqual({ amountMinor: 12_000, currency: "NGN" });
      expect(entry.received).toEqual({ amountMinor: 15_000, currency: "NGN" });
    } else {
      expect.unreachable("expected an amount_mismatch entry");
    }
  });

  it("classifies money with no binding row as an orphaned unbound receipt", () => {
    const rows = freezeAll([feeRow({ id: "fee-0001", paystackReference: "uos_fee0001_3" })]);
    const receipts = freezeAll([
      receipt({ reference: "uos_unbound_1", amountMinor: 7_500, tenantIdHint: OTHER_TENANT }),
    ]);
    const report = reconcileLegacyPayments(rows, receipts, context);

    expect(report.balanced).toBe(false);
    // Two orphaned directions: the bound row with no receipt (unevidenced
    // claim) AND the receipt with no binding row (unbound receipt).
    expect(report.counts.orphaned).toBe(2);
    const entry = report.entries.find(
      (candidate) => candidate.kind === "orphaned" && candidate.direction === "unbound_receipt",
    );
    expect(entry?.kind).toBe("orphaned");
    if (entry?.kind === "orphaned") {
      expect(entry.direction).toBe("unbound_receipt");
      expect(entry.rowId).toBeNull();
      expect(entry.tenantId).toBe(OTHER_TENANT);
      expect(entry.amount).toEqual({ amountMinor: 7_500, currency: "NGN" });
    } else {
      expect.unreachable("expected an orphaned entry");
    }
  });

  it("classifies a money claim whose reference has no accepted receipt as an orphaned unevidenced claim", () => {
    const rows = freezeAll([
      feeRow({ id: "fee-0001", paystackReference: "uos_never_delivered_1" }),
    ]);
    const report = reconcileLegacyPayments(rows, freezeAll([]), context);

    expect(report.balanced).toBe(false);
    expect(report.counts.orphaned).toBe(1);
    const entry = report.entries[0];
    expect(entry?.kind).toBe("orphaned");
    if (entry?.kind === "orphaned") {
      expect(entry.direction).toBe("unevidenced_claim");
      expect(entry.providerReference).toBe("uos_never_delivered_1");
      expect(entry.amount).toEqual({ amountMinor: 15_000, currency: "NGN" });
    } else {
      expect.unreachable("expected an orphaned entry");
    }
  });

  it("classifies rows sharing one provider reference as duplicate bindings, reconciling the single money claimant", () => {
    // Cross-family drift: `fees.paystack_reference` has a partial unique
    // index, but the ledger's `payment_reference` does not — no cross-family
    // rule exists, so one reference can bind two legacy rows.
    const rows = freezeAll([
      ledgerRow({ id: "ledger-0001", paymentReference: "uos_shared_1" }),
      feeRow({ id: "fee-0002", status: "unpaid", settledMinor: 0, paystackReference: "uos_shared_1" }),
    ]);
    const receipts = freezeAll([receipt({ reference: "uos_shared_1", amountMinor: 50_000 })]);
    const report = reconcileLegacyPayments(rows, receipts, context);

    expect(report.balanced).toBe(false);
    expect(report.counts.duplicate).toBe(2);
    expect(report.counts.reconciled).toBe(1);
    const duplicateEntries = report.entries.filter((entry) => entry.kind === "duplicate");
    expect(duplicateEntries).toHaveLength(2);
    if (duplicateEntries[0]?.kind === "duplicate") {
      expect(duplicateEntries[0].providerReference).toBe("uos_shared_1");
      expect(duplicateEntries[0].coClaimantRowIds).toContain("fees:fee-0002");
    } else {
      expect.unreachable("expected a duplicate entry");
    }
  });

  it("classifies a settled claim with no provider reference as reference_missing", () => {
    const rows = freezeAll([
      feeRow({ id: "fee-manual-0001", paystackReference: null }),
      ledgerRow({ id: "ledger-manual-0001", paymentReference: null }),
    ]);
    const report = reconcileLegacyPayments(rows, freezeAll([]), context);

    expect(report.balanced).toBe(false);
    expect(report.counts.referenceMissing).toBe(2);
    const missing = report.entries.filter((entry) => entry.kind === "reference_missing");
    expect(missing).toHaveLength(2);
    if (missing[1]?.kind === "reference_missing") {
      expect(missing[1].claimed).toEqual({ amountMinor: 50_000, currency: "NGN" });
    } else {
      expect.unreachable("expected a reference_missing entry");
    }
  });

  it("classifies rows that claim no money (pending, waived, refunded, unpaid) as non_monetary", () => {
    const rows = freezeAll([
      ledgerRow({ id: "ledger-pending", status: "pending", settledMinor: 0, paymentReference: null }),
      ledgerRow({ id: "ledger-waived", status: "waived", settledMinor: 0, paymentReference: null }),
      ledgerRow({ id: "ledger-refunded", status: "refunded", settledMinor: 0, paymentReference: null }),
      feeRow({ id: "fee-unpaid", status: "unpaid", settledMinor: 0, paystackReference: null }),
    ]);
    const report = reconcileLegacyPayments(rows, freezeAll([]), context);

    expect(report.balanced).toBe(true);
    expect(report.counts.nonMonetary).toBe(4);
    expect(report.entries.every((entry) => entry.kind === "non_monetary")).toBe(true);
  });
});

describe("MH-26 canonical Paystack-reference linkage", () => {
  it("derives the linkage key per family, exactly as the webhook route binds", () => {
    expect(
      canonicalProviderReference(feeRow({ id: "f", paystackReference: "uos_x" })),
    ).toBe("uos_x");
    expect(
      canonicalProviderReference(ledgerRow({ id: "l", paymentReference: "uos_y" })),
    ).toBe("uos_y");
    expect(canonicalProviderReference(feeRow({ id: "f", paystackReference: null }))).toBeNull();
    expect(canonicalProviderReference(ledgerRow({ id: "l", paymentReference: "  " }))).toBeNull();
  });

  it("treats the money-bearing predicate as the webhook source-of-truth gate", () => {
    expect(claimsLegacyMoney(feeRow({ id: "f", status: "paid" }))).toBe(true);
    expect(claimsLegacyMoney(feeRow({ id: "f", status: "partial" }))).toBe(true);
    expect(claimsLegacyMoney(feeRow({ id: "f", status: "unpaid" }))).toBe(false);
    expect(claimsLegacyMoney(ledgerRow({ id: "l", status: "collected" }))).toBe(true);
    expect(claimsLegacyMoney(ledgerRow({ id: "l", status: "waived" }))).toBe(false);
    expect(claimsLegacyMoney(ledgerRow({ id: "l", status: "refunded" }))).toBe(false);
  });

  it("re-validates the metadata hint against the reference binding: agreement reconciles", () => {
    const rows = freezeAll([
      feeRow({ id: "fee-0001", paystackReference: "uos_hint_ok_1" }),
    ]);
    const receipts = freezeAll([
      receipt({ reference: "uos_hint_ok_1", purposeHint: "fee-0001" }),
    ]);
    const report = reconcileLegacyPayments(rows, receipts, context);
    expect(report.counts.reconciled).toBe(1);
  });
});

describe("MH-26 fails closed on ambiguous money", () => {
  it("denies two money-bearing rows claiming the same provider reference", () => {
    const rows = freezeAll([
      feeRow({ id: "fee-0001", paystackReference: "uos_dup_money_1" }),
      ledgerRow({ id: "ledger-0001", paymentReference: "uos_dup_money_1" }),
    ]);
    expect(() => reconcileLegacyPayments(rows, freezeAll([]), context)).toThrow(
      /ambiguous money/i,
    );
  });

  it("denies two accepted receipts carrying the same reference (exactly-once replay violation)", () => {
    const rows = freezeAll([feeRow({ id: "fee-0001", paystackReference: "uos_replay_1" })]);
    const receipts = freezeAll([
      receipt({ reference: "uos_replay_1", occurredAtSec: 1_727_740_000 }),
      receipt({ reference: "uos_replay_1", occurredAtSec: 1_727_740_100 }),
    ]);
    expect(() => reconcileLegacyPayments(rows, receipts, context)).toThrow(
      /exactly-once replay violation/i,
    );
  });

  it("denies a metadata hint that contradicts the reference binding", () => {
    const rows = freezeAll([
      feeRow({ id: "fee-0001", paystackReference: "uos_hint_conflict_1" }),
    ]);
    const receipts = freezeAll([
      receipt({ reference: "uos_hint_conflict_1", purposeHint: "fee-9999" }),
    ]);
    expect(() => reconcileLegacyPayments(rows, receipts, context)).toThrow(
      /contradicts the reference-bound row/i,
    );
  });

  it("denies money outside the reconciliation currency — never mixes money", () => {
    const rows = freezeAll([feeRow({ id: "fee-0001", paystackReference: "uos_usd_1" })]);
    const receipts = freezeAll([
      receipt({ reference: "uos_usd_1", currency: "USD" }),
    ]);
    expect(() => reconcileLegacyPayments(rows, receipts, context)).toThrow(
      /money is never mixed/i,
    );
  });

  it("denies fractional or negative legacy money operands", () => {
    const fractional = freezeAll([
      feeRow({ id: "fee-frac", settledMinor: 1500.5, paystackReference: "uos_frac_1" }),
    ]);
    expect(() => reconcileLegacyPayments(fractional, freezeAll([]), context)).toThrow(
      /integer in minor units/i,
    );

    const negative = freezeAll([
      ledgerRow({ id: "ledger-neg", settledMinor: -1, paymentReference: "uos_neg_1" }),
    ]);
    expect(() => reconcileLegacyPayments(negative, freezeAll([]), context)).toThrow(
      /integer in minor units/i,
    );

    const badReceipt = freezeAll([receipt({ amountMinor: 0 })]);
    const rows = freezeAll([feeRow({ id: "fee-0001", paystackReference: "uos_zero_1" })]);
    expect(() => reconcileLegacyPayments(rows, badReceipt, context)).toThrow(
      /positive integer in minor units/i,
    );
  });

  it("denies a paid legacy row whose settled claim exceeds the invoiced amount", () => {
    const rows = freezeAll([
      feeRow({ id: "fee-over", settledMinor: 20_000, amountMinor: 15_000 }),
    ]);
    expect(() => reconcileLegacyPayments(rows, freezeAll([]), context)).toThrow(
      /ambiguous money/i,
    );
  });

  it("denies a paid legacy row claiming zero money", () => {
    const rows = freezeAll([
      feeRow({ id: "fee-zero", status: "paid", settledMinor: 0 }),
    ]);
    expect(() => reconcileLegacyPayments(rows, freezeAll([]), context)).toThrow(
      /non-positive amount/i,
    );
  });

  it("denies duplicate row identities within a family", () => {
    const rows = freezeAll([
      feeRow({ id: "fee-0001", paystackReference: "uos_id_dup_1" }),
      feeRow({ id: "fee-0001", status: "unpaid", settledMinor: 0, paystackReference: "uos_id_dup_1" }),
    ]);
    expect(() => reconcileLegacyPayments(rows, freezeAll([]), context)).toThrow(
      /ambiguous identity/i,
    );
  });

  it("denies a context without a currency or a generation timestamp", () => {
    const rows = freezeAll([feeRow({ id: "fee-0001" })]);
    expect(() =>
      reconcileLegacyPayments(rows, freezeAll([]), { currency: "  ", generatedAt: GENERATED_AT }),
    ).toThrow(/currency/i);
    expect(() =>
      reconcileLegacyPayments(rows, freezeAll([]), { currency: CURRENCY, generatedAt: "" }),
    ).toThrow(/timestamp/i);
  });
});

describe("MH-26 immutable report record (ADR-005 tombstone discipline)", () => {
  it("never mutates the legacy rows or receipts it reconciles", () => {
    const rows: LegacyPaymentRow[] = [
      feeRow({ id: "fee-0001", settledMinor: 12_000, paystackReference: "uos_nomut_1" }),
      ledgerRow({ id: "ledger-0001", status: "pending", settledMinor: 0, paymentReference: null }),
    ];
    const receipts: LegacyPaystackReceipt[] = [
      receipt({ reference: "uos_nomut_1", amountMinor: 15_000 }),
    ];
    const rowsBefore = JSON.stringify(rows);
    const receiptsBefore = JSON.stringify(receipts);

    const report = reconcileLegacyPayments(freezeAll(rows), freezeAll(receipts), context);

    expect(JSON.stringify(rows)).toBe(rowsBefore);
    expect(JSON.stringify(receipts)).toBe(receiptsBefore);
    // The mismatch is reported, not corrected: the report never adopts the
    // receipt amount as the claim.
    const mismatch = report.entries.find((entry) => entry.kind === "amount_mismatch");
    expect(mismatch).toBeDefined();
    if (mismatch?.kind === "amount_mismatch") {
      expect(mismatch.claimed.amountMinor).toBe(12_000);
      expect(mismatch.received.amountMinor).toBe(15_000);
    }
  });

  it("returns a deeply frozen report: the record cannot be rewritten after the fact", () => {
    const report = reconcileLegacyPayments(
      freezeAll([feeRow({ id: "fee-0001", paystackReference: "uos_frozen_1" })]),
      freezeAll([receipt({ reference: "uos_frozen_1" })]),
      context,
    );
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.entries)).toBe(true);
    expect(Object.isFrozen(report.counts)).toBe(true);
    expect(Object.isFrozen(report.provenance)).toBe(true);
    for (const entry of report.entries) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
    expect(() => {
      (report as { disposition: string }).disposition = "mutated";
    }).toThrow();
    expect(report.disposition).toBe("report_only");
  });

  it("stamps §12 provenance: source tables, census, caller clock, generatedBy", () => {
    const rows = freezeAll([feeRow({ id: "fee-0001" }), ledgerRow({ id: "ledger-0001" })]);
    const receipts = freezeAll([receipt({ reference: "uos_prov_1" })]);
    const report = reconcileLegacyPayments(rows, receipts, context);

    expect(report.provenance.generatedAt).toBe(GENERATED_AT);
    expect(report.provenance.generatedBy).toContain("legacy-reconciliation.ts");
    expect(report.provenance.missionRef).toContain("J-044");
    expect(report.provenance.sourceTables.some((table) => table.includes("public.fees"))).toBe(true);
    expect(
      report.provenance.sourceTables.some((table) =>
        table.includes("public.student_platform_fee_ledger"),
      ),
    ).toBe(true);
    expect(report.provenance.inputCensus).toEqual({ legacyRows: 2, paystackReceipts: 1 });
    expect(report.provenance.inputsDigest).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces a deterministic, order-insensitive report id (idempotent re-runs)", () => {
    const rowsA = freezeAll([
      feeRow({ id: "fee-0001", paystackReference: "uos_det_1" }),
      ledgerRow({ id: "ledger-0001", status: "pending", settledMinor: 0, paymentReference: null }),
    ]);
    const rowsB = freezeAll([
      ledgerRow({ id: "ledger-0001", status: "pending", settledMinor: 0, paymentReference: null }),
      feeRow({ id: "fee-0001", paystackReference: "uos_det_1" }),
    ]);
    const receipts = freezeAll([receipt({ reference: "uos_det_1" })]);

    const first = reconcileLegacyPayments(rowsA, receipts, context);
    const second = reconcileLegacyPayments(rowsB, receipts, context);
    expect(first.reportId).toBe(second.reportId);
    expect(first.provenance.inputsDigest).toBe(second.provenance.inputsDigest);

    const altered = reconcileLegacyPayments(
      rowsA,
      freezeAll([receipt({ reference: "uos_det_1", amountMinor: 15_001 })]),
      context,
    );
    expect(altered.provenance.inputsDigest).not.toBe(first.provenance.inputsDigest);
    expect(altered.reportId).not.toBe(first.reportId);
  });
});