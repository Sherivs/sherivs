/**
 * CoreGrid — financial reconciliation dry run (MISSION-R-73, J-044).
 *
 * Credential-free verification of the FULL payment-acceptance path at
 * contract level, composed end to end:
 *   signed webhook → HMAC-SHA512 signature verification → payload
 *   translation → replay-guard acceptance → reconciliation arithmetic
 *   between recorded intents and accepted receipts.
 *
 * BLK-4 remains blocked: zero live API calls, zero fabricated charge or
 * delivery claims — every secret below is a clearly-marked test fixture,
 * and the harness only exercises the pure contract surface the adapters
 * already expose. The LIVE verification this suite rehearses (executed by
 * the verifier agent once provider keys are provisioned) is recorded in
 * the MISSION-R-73 report.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPaystackAdapter,
  parsePaystackWebhook,
  verifyPaystackSignature,
} from "../../frontend/src/lib/payments/paystack-adapter";
import {
  deriveIdempotencyKey,
  paymentAdapterFor,
  registerPaymentAdapter,
  resetPaymentAdapters,
  type PaymentEvent,
  type PaymentReference,
  type WebhookRequest,
} from "../../frontend/src/lib/payments/payment-contract";
import { acceptPaymentEvent } from "../../frontend/src/lib/payments/replay-guard";
import { reconcileIntentsWithReceipts } from "../../frontend/src/lib/payments/reconciliation";
import {
  entitledFeaturesForTenant,
  tenantTierEntitlement,
  tierEntitlementsForTenant,
} from "../../frontend/src/lib/payments/tier-entitlements";
import { SUBSCRIPTION_TIERS } from "../../frontend/src/lib/subscription-tiers";
import { money } from "../../frontend/src/lib/financial-core";
import { tenantId } from "../../frontend/src/lib/tenant-core";

/** Clearly-marked test fixture secret — never a real credential (BLK-4). */
const FIXTURE_SECRET = "dry-run-fixture-secret-not-a-real-key";
const TENANT = tenantId("tenant-dry-run-a");
const NOW_SEC = 1_727_740_000;
const NOW = new Date(NOW_SEC * 1000).toISOString();

const adapter = createPaystackAdapter({ secretKey: FIXTURE_SECRET });

function fixtureReference(overrides: Partial<PaymentReference> = {}): PaymentReference {
  return {
    tenantId: TENANT,
    payerRef: "user-0001",
    amount: money(15_000, "NGN"),
    purpose: { kind: "fee_payment", ref: "fee-0001" },
    ...overrides,
  };
}

function paystackBody(providerRef: string, amountMinor: number, currency = "NGN"): string {
  return JSON.stringify({
    event: "charge.success",
    data: {
      reference: providerRef,
      amount: amountMinor,
      currency,
      metadata: { school_id: TENANT, fee_id: "fee-0001" },
    },
  });
}

function signedRequest(body: string, secret = FIXTURE_SECRET): WebhookRequest {
  const signature = createHmac("sha512", secret).update(body, "utf8").digest("hex");
  return {
    rawBody: new TextEncoder().encode(body),
    headers: { "x-paystack-signature": signature },
    receivedAtSec: NOW_SEC,
  };
}

function receipt(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    type: "payment.succeeded",
    eventId: "evt_0001",
    provider: "paystack",
    providerReference: "ref_0001",
    amount: money(15_000, "NGN"),
    tenantId: TENANT,
    purposeRef: "fee-0001",
    occurredAt: NOW,
    ...overrides,
  };
}

describe("dry run: full acceptance path over the HMAC-SHA512 rail", () => {
  it("walks a signed webhook from raw bytes to a balanced reconciliation", () => {
    const intentResult = adapter.createIntent(fixtureReference(), NOW);
    expect(intentResult.ok).toBe(true);
    if (!intentResult.ok) return;
    const intent = intentResult.intent;

    const body = paystackBody("dryrun_fee0001_0001", 15_000);
    const request = signedRequest(body);

    const signature = verifyPaystackSignature({ secretKey: FIXTURE_SECRET }, request);
    expect(signature.ok).toBe(true);

    const parsed = parsePaystackWebhook({ secretKey: FIXTURE_SECRET }, request);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event.type).toBe("payment.succeeded");
    expect(parsed.event.amount).toEqual(money(15_000, "NGN"));
    expect(parsed.event.purposeRef).toBe("fee-0001");

    const guard = acceptPaymentEvent(
      new Set<string>(),
      { eventId: parsed.event.eventId, provider: parsed.event.provider, occurredAtSec: NOW_SEC },
      NOW_SEC,
    );
    expect(guard.accept).toBe(true);

    const report = reconcileIntentsWithReceipts([intent], [parsed.event]);
    expect(report.balanced).toBe(true);
    expect(report.counts.matched).toBe(1);
    expect(report.entries[0]?.kind).toBe("matched");
  });

  it("rejects a redelivered webhook at the replay guard — the financial effect stays exactly-once", () => {
    const request = signedRequest(paystackBody("dryrun_fee0001_replay", 15_000));
    const parsed = parsePaystackWebhook({ secretKey: FIXTURE_SECRET }, request);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const first = acceptPaymentEvent(
      new Set<string>(),
      { eventId: parsed.event.eventId, provider: parsed.event.provider, occurredAtSec: NOW_SEC },
      NOW_SEC,
    );
    expect(first.accept).toBe(true);

    const second = acceptPaymentEvent(
      first.accept ? first.seenEventIds : new Set<string>(),
      { eventId: parsed.event.eventId, provider: parsed.event.provider, occurredAtSec: NOW_SEC },
      NOW_SEC + 10,
    );
    expect(second.accept).toBe(false);
    if (!second.accept) expect(second.code).toBe("duplicate_event");

    const intentResult = adapter.createIntent(fixtureReference(), NOW);
    expect(intentResult.ok).toBe(true);
    if (!intentResult.ok) return;
    const report = reconcileIntentsWithReceipts([intentResult.intent], [parsed.event]);
    expect(report.counts.succeededReceipts).toBe(1);
    expect(report.balanced).toBe(true);
  });

  it("exposes a double charge the moment the guard is bypassed (guard is load-bearing)", () => {
    const intentResult = adapter.createIntent(fixtureReference(), NOW);
    expect(intentResult.ok).toBe(true);
    if (!intentResult.ok) return;
    const report = reconcileIntentsWithReceipts([intentResult.intent], [
      receipt({ eventId: "evt_0001", providerReference: "ref_0001" }),
      receipt({ eventId: "evt_0002", providerReference: "ref_0002" }),
    ]);
    expect(report.balanced).toBe(false);
    expect(report.counts.overpaid).toBe(1);
    if (report.entries[0]?.kind === "overpaid_intent") {
      expect(report.entries[0].received).toEqual(money(30_000, "NGN"));
    } else {
      expect.unreachable("expected an overpaid entry");
    }
  });

  it("rejects a forged webhook (attacker-signed with the wrong secret) and records nothing", () => {
    const forged = signedRequest(paystackBody("dryrun_forged_0001", 15_000), "attacker-secret");
    const signature = verifyPaystackSignature({ secretKey: FIXTURE_SECRET }, forged);
    expect(signature.ok).toBe(false);
    if (!signature.ok) expect(signature.code).toBe("signature_mismatch");

    const parsed = parsePaystackWebhook({ secretKey: FIXTURE_SECRET }, forged);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe("signature_invalid");

    const intentResult = adapter.createIntent(fixtureReference(), NOW);
    expect(intentResult.ok).toBe(true);
    if (!intentResult.ok) return;
    const report = reconcileIntentsWithReceipts([intentResult.intent], []);
    expect(report.counts.pending).toBe(1);
    expect(report.counts.succeededReceipts).toBe(0);
  });

  it("rejects a tampered body whose signature was computed over the original payload", () => {
    const original = signedRequest(paystackBody("dryrun_tamper_0001", 15_000));
    const tampered: WebhookRequest = {
      ...original,
      rawBody: new TextEncoder().encode(paystackBody("dryrun_tamper_0001", 1)),
    };
    const result = verifyPaystackSignature({ secretKey: FIXTURE_SECRET }, tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("signature_mismatch");
  });
});

describe("dry run: idempotency of intent creation", () => {
  it("derives an identical idempotency key and envelope for a repeated reference", () => {
    const first = adapter.createIntent(fixtureReference(), NOW);
    const second = adapter.createIntent(fixtureReference(), NOW);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.intent.idempotencyKey).toBe(second.intent.idempotencyKey);
    expect(first.intent.id).toBe(second.intent.id);
    expect(first.intent.status).toBe("created");
    expect(first.intent.providerReference).toBeNull();
  });

  it("separates idempotency keys across amounts, purposes and payers", () => {
    const base = deriveIdempotencyKey(fixtureReference());
    expect(deriveIdempotencyKey(fixtureReference({ amount: money(15_001, "NGN") }))).not.toBe(base);
    expect(
      deriveIdempotencyKey(fixtureReference({ purpose: { kind: "fee_payment", ref: "fee-0002" } })),
    ).not.toBe(base);
    expect(deriveIdempotencyKey(fixtureReference({ payerRef: "user-0002" }))).not.toBe(base);
  });

  it("resolves the same adapter through the fail-closed registry and creates identically", () => {
    resetPaymentAdapters();
    registerPaymentAdapter(adapter);
    const lookup = paymentAdapterFor("paystack");
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;
    const viaRegistry = lookup.adapter.createIntent(fixtureReference(), NOW);
    const direct = adapter.createIntent(fixtureReference(), NOW);
    expect(viaRegistry.ok && direct.ok).toBe(true);
    if (!viaRegistry.ok || !direct.ok) return;
    expect(viaRegistry.intent.idempotencyKey).toBe(direct.intent.idempotencyKey);
  });
});

describe("dry run: reconciliation arithmetic (recorded intents vs accepted receipts)", () => {
  function intentFor(purposeRef: string, amountMinor: number) {
    const result = adapter.createIntent(
      fixtureReference({ purpose: { kind: "fee_payment", ref: purposeRef }, amount: money(amountMinor, "NGN") }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture intent creation failed");
    return result.intent;
  }

  it("matches equal amounts and stays balanced", () => {
    const report = reconcileIntentsWithReceipts(
      [intentFor("fee-0001", 15_000)],
      [receipt({ amount: money(15_000, "NGN") })],
    );
    expect(report.balanced).toBe(true);
    expect(report.counts).toMatchObject({ matched: 1, pending: 0, partial: 0, overpaid: 0 });
  });

  it("flags under-payment as partial receipts", () => {
    const report = reconcileIntentsWithReceipts(
      [intentFor("fee-0001", 15_000)],
      [receipt({ amount: money(4_000, "NGN") })],
    );
    expect(report.balanced).toBe(false);
    expect(report.counts.partial).toBe(1);
    if (report.entries[0]?.kind === "partial_receipts") {
      expect(report.entries[0].received).toEqual(money(4_000, "NGN"));
    } else {
      expect.unreachable("expected a partial entry");
    }
  });

  it("nets multiple receipts per intent", () => {
    const report = reconcileIntentsWithReceipts(
      [intentFor("fee-0001", 15_000)],
      [receipt({ eventId: "evt_0001", amount: money(10_000, "NGN") }), receipt({ eventId: "evt_0002", amount: money(5_000, "NGN") })],
    );
    expect(report.balanced).toBe(true);
    expect(report.counts.matched).toBe(1);
  });

  it("fails closed on a receipt in a foreign currency (never mixes money)", () => {
    const report = reconcileIntentsWithReceipts(
      [intentFor("fee-0001", 15_000)],
      [receipt({ amount: money(15_000, "USD") })],
    );
    expect(report.balanced).toBe(false);
    expect(report.counts.currencyMismatch).toBe(1);
  });

  it("never silently absorbs a receipt with no purpose attribution", () => {
    const report = reconcileIntentsWithReceipts(
      [intentFor("fee-0001", 15_000)],
      [receipt({ purposeRef: null })],
    );
    expect(report.balanced).toBe(false);
    expect(report.counts.unattributed).toBe(1);
    expect(report.entries.at(-1)?.kind).toBe("unattributed_receipt");
  });

  it("treats an intent without receipts as pending, not as a balance failure", () => {
    const report = reconcileIntentsWithReceipts([intentFor("fee-0001", 15_000)], []);
    expect(report.balanced).toBe(true);
    expect(report.counts.pending).toBe(1);
    expect(report.entries[0]?.kind).toBe("pending_intent");
  });

  it("throws on ambiguous input: two intents claiming one purpose ref", () => {
    expect(() =>
      reconcileIntentsWithReceipts(
        [intentFor("fee-0001", 15_000), intentFor("fee-0001", 15_000)],
        [],
      ),
    ).toThrow(/ambiguity/i);
  });
});

describe("tier reconciliation: legacy vocabulary re-keyed by TenantId", () => {
  it("resolves commercial entitlements against a canonical TenantId with declared provenance", () => {
    const trial = tenantTierEntitlement(TENANT, "trial", "paystack_payments");
    expect(trial).toEqual({
      tenantId: TENANT,
      tier: "trial",
      feature: "paystack_payments",
      entitled: false,
      source: "legacy-tier-catalog",
    });
    expect(tenantTierEntitlement(TENANT, "enterprise", "paystack_payments").entitled).toBe(true);
  });

  it("fails closed on unknown tiers and throws on a tenant-less entitlement", () => {
    expect(tenantTierEntitlement(TENANT, "nonexistent-tier", "admin_portal").tier).toBe("trial");
    expect(() => tenantTierEntitlement(tenantId("  "), "trial", "admin_portal")).toThrow(
      /tenant id/i,
    );
  });

  it("translates the full feature matrix per tenant without loss", () => {
    const entitlements = tierEntitlementsForTenant(TENANT, "enterprise");
    expect(entitlements.length).toBe(
      Object.keys(SUBSCRIPTION_TIERS.enterprise.features).length,
    );
    for (const entitlement of entitlements) {
      expect(entitlement.tenantId).toBe(TENANT);
      expect(entitlement.source).toBe("legacy-tier-catalog");
    }
    const trialEntitled = entitledFeaturesForTenant(TENANT, "trial");
    expect(trialEntitled).toContain("admin_portal");
    expect(trialEntitled).not.toContain("paystack_payments");
    expect(
      entitledFeaturesForTenant(TENANT, "enterprise").length,
    ).toBe(Object.keys(SUBSCRIPTION_TIERS.enterprise.features).length);
  });
});
