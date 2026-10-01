/**
 * CoreGrid — Stripe adapter tests (V5.3 Part 21).
 * Signature verification (t=/v1= HMAC-SHA256 over `${t}.${body}`),
 * tolerance-based replay protection — plus forgery/replay/tamper negatives (§31).
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createStripeAdapter,
  parseStripeWebhook,
  verifyStripeSignature,
} from "../../frontend/src/lib/payments/stripe-adapter";
import type { WebhookRequest } from "../../frontend/src/lib/payments/payment-contract";
import { money } from "../../frontend/src/lib/financial-core";
import { tenantId } from "../../frontend/src/lib/tenant-core";

/** Clearly-marked test fixture secret — never a real credential. */
const FIXTURE_SECRET = "test-secret-fixture";
const NOW_SEC = 1_727_740_000;

const successBody = JSON.stringify({
  id: "evt_fixture_0001",
  type: "payment_intent.succeeded",
  data: {
    object: {
      id: "pi_fixture_0001",
      amount: 12_500,
      currency: "usd",
      metadata: { tenant_id: "scholar-tenant-a", purpose_ref: "invoice-0009" },
    },
  },
});

function stripeSignature(body: string, timestamp: number, secret = FIXTURE_SECRET): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

function signedRequest(
  body: string,
  options: { timestamp?: number; signature?: string; secret?: string } = {},
): WebhookRequest {
  const timestamp = options.timestamp ?? NOW_SEC;
  const signature = options.signature ?? stripeSignature(body, timestamp, options.secret);
  return {
    rawBody: new TextEncoder().encode(body),
    headers: { "stripe-signature": signature },
    receivedAtSec: NOW_SEC,
  };
}

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed body inside the tolerance window", () => {
    const result = verifyStripeSignature(
      { signingSecret: FIXTURE_SECRET },
      signedRequest(successBody),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts any rotated v1 signature in the header", () => {
    const rotated = signedRequest(successBody, { secret: "test-secret-fixture-rotated" });
    const both = `t=${NOW_SEC},v1=${stripeSignature(successBody, NOW_SEC).split("v1=")[1]},v1=${
      createHmac("sha256", "test-secret-fixture-rotated")
        .update(`${NOW_SEC}.${successBody}`)
        .digest("hex")
    }`;
    const result = verifyStripeSignature(
      { signingSecret: FIXTURE_SECRET },
      { ...rotated, headers: { "stripe-signature": both } },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a forged signature (attacker-signed with wrong secret)", () => {
    const result = verifyStripeSignature(
      { signingSecret: FIXTURE_SECRET },
      signedRequest(successBody, { secret: "attacker-secret" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("signature_mismatch");
  });

  it("rejects a tampered body signed over the original", () => {
    const original = signedRequest(successBody);
    const tampered: WebhookRequest = {
      ...original,
      rawBody: new TextEncoder().encode(successBody.replace("12500", "1250000")),
    };
    const result = verifyStripeSignature({ signingSecret: FIXTURE_SECRET }, tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("signature_mismatch");
  });

  it("rejects replayed signatures outside the tolerance window (stale)", () => {
    const staleTimestamp = NOW_SEC - 3600;
    const result = verifyStripeSignature(
      { signingSecret: FIXTURE_SECRET, toleranceSec: 300 },
      signedRequest(successBody, { timestamp: staleTimestamp }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("stale_timestamp");
  });

  it("rejects future-dated signatures (clock-skew forgery vector)", () => {
    const futureTimestamp = NOW_SEC + 3600;
    const result = verifyStripeSignature(
      { signingSecret: FIXTURE_SECRET, toleranceSec: 300 },
      signedRequest(successBody, { timestamp: futureTimestamp }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("stale_timestamp");
  });

  it("fails closed on missing and malformed signature headers", () => {
    const missing: WebhookRequest = {
      rawBody: new TextEncoder().encode(successBody),
      headers: {},
      receivedAtSec: NOW_SEC,
    };
    expect(verifyStripeSignature({ signingSecret: FIXTURE_SECRET }, missing).ok).toBe(false);

    for (const bad of [
      "t=abc,v1=deadbeef",
      "v1=" + "a".repeat(64),
      "t=1727740000",
      "garbage",
    ]) {
      const result = verifyStripeSignature(
        { signingSecret: FIXTURE_SECRET },
        signedRequest(successBody, { signature: bad }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("malformed_signature");
    }
  });
});

describe("parseStripeWebhook", () => {
  it("translates a signed payment_intent.succeeded into a CoreGrid payment event", () => {
    const result = parseStripeWebhook({ signingSecret: FIXTURE_SECRET }, signedRequest(successBody));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.type).toBe("payment.succeeded");
      expect(result.event.provider).toBe("stripe");
      expect(result.event.eventId).toBe("evt_fixture_0001");
      expect(result.event.providerReference).toBe("pi_fixture_0001");
      expect(result.event.amount).toEqual(money(12_500, "usd"));
      expect(result.event.tenantId).toBe(tenantId("scholar-tenant-a"));
      expect(result.event.purposeRef).toBe("invoice-0009");
    }
  });

  it("rejects a replayed event that is signed but stale", () => {
    const replay = signedRequest(successBody, { timestamp: NOW_SEC - 600 });
    const result = parseStripeWebhook(
      { signingSecret: FIXTURE_SECRET, toleranceSec: 300 },
      replay,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("signature_invalid");
  });

  it("fails closed on malformed JSON and unknown event types", () => {
    const garbage = parseStripeWebhook({ signingSecret: FIXTURE_SECRET }, signedRequest("[1,2,3]"));
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.code).toBe("malformed_payload");

    const unknown = parseStripeWebhook(
      { signingSecret: FIXTURE_SECRET },
      signedRequest(JSON.stringify({ id: "evt_x", type: "novel.event", data: {} })),
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.code).toBe("unknown_event");
  });
});

describe("createStripeAdapter contract", () => {
  const adapter = createStripeAdapter({ signingSecret: FIXTURE_SECRET });

  it("builds a local intent reusing the shared idempotency derivation", () => {
    const result = adapter.createIntent(
      {
        tenantId: tenantId("scholar-tenant-a"),
        payerRef: "user-0001",
        amount: money(12_500, "USD"),
        purpose: { kind: "invoice_payment", ref: "invoice-0009" },
      },
      "2026-10-01T00:00:00.000Z",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.status).toBe("created");
      expect(result.intent.providerReference).toBeNull();
      expect(result.intent.idempotencyKey).toBe(
        "cg_scholar-tenant-a_user-0001_invoice_payment_invoice-0009_USD_12500",
      );
    }
  });

  it("declares refunds unsupported while BLK-4 blocks live execution", () => {
    expect(adapter.capabilities.refunds).toBe(false);
    expect(adapter.refund).toBeUndefined();
  });
});
