/**
 * CoreGrid — Paystack adapter tests (V5.3 Part 21).
 * Signature verification (HMAC-SHA512 over raw body), webhook translation,
 * idempotency key handling — plus forgery/tamper negative cases (§31).
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPaystackAdapter,
  parsePaystackWebhook,
  verifyPaystackSignature,
} from "../../frontend/src/lib/payments/paystack-adapter";
import type { WebhookRequest } from "../../frontend/src/lib/payments/payment-contract";
import { money } from "../../frontend/src/lib/financial-core";
import { tenantId } from "../../frontend/src/lib/tenant-core";

/** Clearly-marked test fixture secret — never a real credential. */
const FIXTURE_SECRET = "test-secret-fixture";

const successBody = JSON.stringify({
  event: "charge.success",
  data: {
    reference: "uos_fee0001_1727740000",
    amount: 15_000,
    currency: "NGN",
    metadata: { school_id: "scholar-tenant-a", fee_id: "fee-0001" },
  },
});

function signedRequest(body: string, secret = FIXTURE_SECRET): WebhookRequest {
  const signature = createHmac("sha512", secret).update(body, "utf8").digest("hex");
  return {
    rawBody: new TextEncoder().encode(body),
    headers: { "x-paystack-signature": signature },
    receivedAtSec: 1_727_740_000,
  };
}

describe("verifyPaystackSignature", () => {
  it("accepts a correctly signed raw body", () => {
    const result = verifyPaystackSignature(
      { secretKey: FIXTURE_SECRET },
      signedRequest(successBody),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a forged signature (attacker-signed with wrong secret)", () => {
    const attackerSigned = signedRequest(successBody, "attacker-secret");
    const result = verifyPaystackSignature({ secretKey: FIXTURE_SECRET }, attackerSigned);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("signature_mismatch");
  });

  it("rejects a tampered body whose signature was computed over the original", () => {
    const original = signedRequest(successBody);
    const tampered: WebhookRequest = {
      ...original,
      rawBody: new TextEncoder().encode(successBody.replace("15000", "1")),
    };
    const result = verifyPaystackSignature({ secretKey: FIXTURE_SECRET }, tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("signature_mismatch");
  });

  it("fails closed on missing and malformed signature headers", () => {
    const bare: WebhookRequest = {
      rawBody: new TextEncoder().encode(successBody),
      headers: {},
      receivedAtSec: 1_727_740_000,
    };
    expect(verifyPaystackSignature({ secretKey: FIXTURE_SECRET }, bare).ok).toBe(false);

    const malformed: WebhookRequest = {
      ...bare,
      headers: { "x-paystack-signature": "not-a-hex-digest" },
    };
    const result = verifyPaystackSignature({ secretKey: FIXTURE_SECRET }, malformed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("malformed_signature");
  });
});

describe("parsePaystackWebhook", () => {
  it("translates a signed charge.success into a CoreGrid payment event", () => {
    const result = parsePaystackWebhook({ secretKey: FIXTURE_SECRET }, signedRequest(successBody));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.type).toBe("payment.succeeded");
      expect(result.event.provider).toBe("paystack");
      expect(result.event.providerReference).toBe("uos_fee0001_1727740000");
      expect(result.event.amount).toEqual(money(15_000, "NGN"));
      expect(result.event.tenantId).toBe(tenantId("scholar-tenant-a"));
      expect(result.event.purposeRef).toBe("fee-0001");
    }
  });

  it("rejects an unsigned-but-valid payload (signature first, always)", () => {
    const unsigned: WebhookRequest = {
      rawBody: new TextEncoder().encode(successBody),
      headers: {},
      receivedAtSec: 1_727_740_000,
    };
    const result = parsePaystackWebhook({ secretKey: FIXTURE_SECRET }, unsigned);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("signature_invalid");
  });

  it("fails closed on malformed JSON and unknown event types", () => {
    const garbage = parsePaystackWebhook(
      { secretKey: FIXTURE_SECRET },
      signedRequest("{not json"),
    );
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.code).toBe("malformed_payload");

    const unknownEvent = parsePaystackWebhook(
      { secretKey: FIXTURE_SECRET },
      signedRequest(JSON.stringify({ event: "charge.novel", data: {} })),
    );
    expect(unknownEvent.ok).toBe(false);
    if (!unknownEvent.ok) expect(unknownEvent.code).toBe("unknown_event");
  });

  it("fails closed on well-signed payloads with bad amounts", () => {
    const negative = parsePaystackWebhook(
      { secretKey: FIXTURE_SECRET },
      signedRequest(
        JSON.stringify({
          event: "charge.success",
          data: { reference: "ref-1", amount: -100, currency: "NGN" },
        }),
      ),
    );
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.code).toBe("malformed_payload");
  });
});

describe("createPaystackAdapter contract", () => {
  const adapter = createPaystackAdapter({ secretKey: FIXTURE_SECRET });

  it("builds a local intent with a deterministic idempotency key and no live call", () => {
    const result = adapter.createIntent(
      {
        tenantId: tenantId("scholar-tenant-a"),
        payerRef: "user-0001",
        amount: money(15_000, "NGN"),
        purpose: { kind: "fee_payment", ref: "fee-0001" },
      },
      "2026-10-01T00:00:00.000Z",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.status).toBe("created");
      expect(result.intent.providerReference).toBeNull();
      expect(result.intent.idempotencyKey).toBe(
        "cg_scholar-tenant-a_user-0001_fee_payment_fee-0001_NGN_15000",
      );
    }
  });

  it("declares refunds unsupported while BLK-4 blocks live execution", () => {
    expect(adapter.capabilities.refunds).toBe(false);
    expect(adapter.refund).toBeUndefined();
  });
});
