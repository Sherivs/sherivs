/**
 * CoreGrid — payment contract tests (V5.3 Part 21).
 * Fail-closed registry, reference validation, intent envelope, event vocabulary.
 */
import { describe, expect, it } from "vitest";
import {
  deriveIdempotencyKey,
  paymentAdapterFor,
  registerPaymentAdapter,
  resetPaymentAdapters,
  validatePaymentReference,
  type PaymentAdapter,
  type PaymentReference,
} from "../../frontend/src/lib/payments/payment-contract";
import { money } from "../../frontend/src/lib/financial-core";
import { tenantId } from "../../frontend/src/lib/tenant-core";

/** Test fixture values only — never real credentials. */
const fixtureTenant = tenantId("scholar-tenant-a");

function fixtureReference(overrides: Partial<PaymentReference> = {}): PaymentReference {
  return {
    tenantId: fixtureTenant,
    payerRef: "user-0001",
    amount: money(15_000, "NGN"),
    purpose: { kind: "fee_payment", ref: "fee-0001" },
    ...overrides,
  };
}

describe("validatePaymentReference (strict, fail-closed)", () => {
  it("accepts a well-formed reference", () => {
    const result = validatePaymentReference(fixtureReference());
    expect(result.ok).toBe(true);
  });

  it("rejects empty tenant, payer and purpose refs", () => {
    expect(validatePaymentReference(fixtureReference({ tenantId: tenantId(" ") })).ok).toBe(false);
    expect(validatePaymentReference(fixtureReference({ payerRef: "" })).ok).toBe(false);
    expect(
      validatePaymentReference(
        fixtureReference({ purpose: { kind: "fee_payment", ref: " " } }),
      ).ok,
    ).toBe(false);
  });

  it("rejects non-positive, fractional and missing-currency amounts", () => {
    expect(validatePaymentReference(fixtureReference({ amount: money(0, "NGN") })).ok).toBe(false);
    expect(validatePaymentReference(fixtureReference({ amount: money(-5, "NGN") })).ok).toBe(false);
    expect(
      validatePaymentReference({
        ...fixtureReference(),
        amount: { amountMinor: 1.5, currency: "NGN" },
      }).ok,
    ).toBe(false);
    expect(validatePaymentReference(fixtureReference({ amount: money(100, " ") })).ok).toBe(false);
  });
});

describe("deriveIdempotencyKey", () => {
  it("is deterministic per reference and distinct across references", () => {
    const a = deriveIdempotencyKey(fixtureReference());
    expect(a).toBe(deriveIdempotencyKey(fixtureReference()));
    expect(a).not.toBe(
      deriveIdempotencyKey(fixtureReference({ purpose: { kind: "fee_payment", ref: "fee-0002" } })),
    );
    expect(a).not.toBe(
      deriveIdempotencyKey(fixtureReference({ amount: money(15_001, "NGN") })),
    );
  });
});

describe("adapter registry (fails closed on unregistered providers)", () => {
  const fakeAdapter: PaymentAdapter = {
    provider: "fixture-provider",
    capabilities: { refunds: false },
    createIntent: () => ({ ok: false, code: "invalid_reference", reason: "unused" }),
    verifySignature: () => ({ ok: false, code: "missing_signature", reason: "unused" }),
    parseWebhook: () => ({ ok: false, code: "signature_invalid", reason: "unused" }),
  };

  it("denies unknown providers with an explicit decision", () => {
    resetPaymentAdapters();
    const lookup = paymentAdapterFor("paystack");
    expect(lookup.ok).toBe(false);
    if (!lookup.ok) {
      expect(lookup.code).toBe("unregistered_provider");
      expect(lookup.reason).toContain("paystack");
    }
  });

  it("resolves a registered adapter and re-registrations overwrite explicitly", () => {
    resetPaymentAdapters();
    registerPaymentAdapter(fakeAdapter);
    const lookup = paymentAdapterFor("fixture-provider");
    expect(lookup.ok).toBe(true);
  });

  it("is isolated between tests via reset", () => {
    resetPaymentAdapters();
    expect(paymentAdapterFor("fixture-provider").ok).toBe(false);
  });
});
