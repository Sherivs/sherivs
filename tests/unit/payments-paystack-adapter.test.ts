/**
 * CoreGrid — Paystack adapter tests (V5.3 Part 21).
 * Signature verification (HMAC-SHA512 over raw body), webhook translation,
 * idempotency key handling — plus forgery/tamper negative cases (§31).
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPaystackAdapter,
  PAYSTACK_FAILURE_POLICY,
  parsePaystackWebhook,
  verifyPaystackSignature,
} from "../../frontend/src/lib/payments/paystack-adapter";
import type { WebhookRequest } from "../../frontend/src/lib/payments/payment-contract";
import { money } from "../../frontend/src/lib/financial-core";
import { tenantId } from "../../frontend/src/lib/tenant-core";
import { createAdapterFailurePolicy } from "../../frontend/src/lib/adapters/failure-policy";

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
    const garbage = parsePaystackWebhook({ secretKey: FIXTURE_SECRET }, signedRequest("{not json"));
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

/* ─────────────────────────────────────────────────────────────
 * J-045 failure-semantics wiring (additive; results unchanged)
 * ────────────────────────────────────────────────────────────*/

describe("paystack adapter failure policy (J-045)", () => {
  /** Fresh policy per test: counters must be deterministic, never shared. */
  const freshPolicy = () =>
    createAdapterFailurePolicy({
      provider: "paystack",
      timeoutMs: 5_000,
      maxAttempts: 1,
      backoffBaseMs: 250,
      backoffCapMs: 4_000,
      degradedAfterFailures: 3,
      degradedWindowMs: 60_000,
      breakerFailureThreshold: 5,
      breakerResetMs: 30_000,
    });

  it("declares its policy instance with timeouts and thresholds", () => {
    const adapter = createPaystackAdapter({
      secretKey: FIXTURE_SECRET,
      failurePolicy: freshPolicy(),
    });
    expect(PAYSTACK_FAILURE_POLICY.snapshot().provider).toBe("paystack");
    const snap = adapter.failurePolicy.snapshot();
    expect(snap.provider).toBe("paystack");
    expect(snap.declared.timeoutMs).toBe(5_000);
    expect(snap.declared.maxAttempts).toBe(1);
    expect(snap.declared.breakerFailureThreshold).toBe(5);
  });

  it("contains adapter-internal defects and fails closed on signatures", () => {
    // A non-string secret makes the HMAC construction throw — the adapter
    // must contain the defect and fail closed, never propagate the throw.
    const hostile = createPaystackAdapter({
      secretKey: 12_345 as unknown as string,
      failurePolicy: freshPolicy(),
    });
    const verified = hostile.verifySignature(signedRequest(successBody));
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.code).toBe("signature_mismatch");
      expect(verified.reason).toContain("contained");
    }
    const parsed = hostile.parseWebhook(signedRequest(successBody));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe("malformed_payload");
      expect(parsed.reason).toContain("contained");
    }
  });

  it("contains intent-creation defects without fabricating an intent", () => {
    const adapter = createPaystackAdapter({
      secretKey: FIXTURE_SECRET,
      failurePolicy: freshPolicy(),
    });
    const result = adapter.createIntent(
      {
        tenantId: null as unknown as ReturnType<typeof tenantId>,
        payerRef: "user-0001",
        amount: money(15_000, "NGN"),
        purpose: { kind: "fee_payment", ref: "fee-0001" },
      },
      "2026-10-01T00:00:00.000Z",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_reference");
      expect(result.reason).toContain("contained");
    }
  });

  it("feeds contained failures into degraded mode, breaker state and trust history", () => {
    const adapter = createPaystackAdapter({
      secretKey: 12_345 as unknown as string,
      failurePolicy: freshPolicy(),
    });
    for (let i = 0; i < 3; i += 1) {
      const result = adapter.verifySignature(signedRequest(successBody));
      expect(result.ok).toBe(false);
    }
    const snap = adapter.failurePolicy.snapshot();
    expect(snap.consecutiveFailures).toBe(3);
    expect(snap.mode).toBe("degraded");
    expect(snap.degradedActive).toBe(true);
    expect(adapter.failurePolicy.trustBasis().totalFailures).toBe(3);
    // Below the trust floor (threshold 5): distrust must not be premature.
    expect(adapter.failurePolicy.recommendTrust().verdict).toBe("unproven");

    for (let i = 0; i < 2; i += 1) {
      expect(adapter.verifySignature(signedRequest(successBody)).ok).toBe(false);
    }
    // Crossing the breaker threshold feeds the untrusted recommendation.
    expect(adapter.failurePolicy.recommendTrust().verdict).toBe("untrusted");

    // A healthy operation clears the degraded episode.
    const restored = createPaystackAdapter({
      secretKey: FIXTURE_SECRET,
      failurePolicy: freshPolicy(),
    });
    expect(restored.verifySignature(signedRequest(successBody)).ok).toBe(true);
    expect(restored.failurePolicy.snapshot().consecutiveFailures).toBe(0);
  });
});
