/**
 * CoreGrid — Paystack payment adapter (V5.3 Part 21).
 *
 * Implements the `PaymentAdapter` contract for Paystack. Paystack is an
 * implementation dependency only: wire formats are translated into
 * CoreGrid vocabulary at the boundary and never leak inward.
 *
 * Signature scheme (Paystack docs): HMAC-SHA512 of the RAW request body
 * with the secret key, hex-encoded, carried in `x-paystack-signature`.
 * Verification is constant-time over the exact injected bytes. Under
 * BLK-4 this adapter performs no network I/O; test secrets must always
 * be clearly-marked fixtures.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  deriveIdempotencyKey,
  validatePaymentReference,
  type CreateIntentResult,
  type PaymentAdapter,
  type PaymentEvent,
  type ParseWebhookResult,
  type RefundResult,
  type VerifySignatureResult,
  type WebhookRequest,
} from "./payment-contract";
import { money, type Money } from "../financial-core";
import { tenantId } from "../tenant-core";
import { createAdapterFailurePolicy, type AdapterFailurePolicy } from "../adapters/failure-policy";

export interface PaystackAdapterConfig {
  /** Platform secret key (PAYSTACK_SECRET_KEY in the Scholar slice). */
  secretKey: string;
  /**
   * J-045: declared failure-semantics policy. Defaults to
   * `PAYSTACK_FAILURE_POLICY` when omitted; injected instances allow tests
   * and deployments to tune thresholds without changing the contract.
   */
  failurePolicy?: AdapterFailurePolicy;
}

/**
 * Declared failure-semantics policy for the Paystack adapter (J-045). Under
 * BLK-4 all operations are local, so containment is synchronous; the
 * declared timeout binds the future external-call surface when the block
 * lifts. Webhook processing is exactly-once via the replay guard — the
 * transport never retries.
 */
export const PAYSTACK_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
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

/** The Paystack adapter plus its declared failure policy (J-045, additive). */
export type PaystackAdapter = PaymentAdapter & {
  readonly failurePolicy: AdapterFailurePolicy;
};

const SIGNATURE_HEADER = "x-paystack-signature";

/** Paystack webhook events this adapter understands (fail closed otherwise). */
const KNOWN_EVENTS: Readonly<
  Record<string, "payment.succeeded" | "payment.failed" | "payment.refunded">
> = {
  "charge.success": "payment.succeeded",
  "charge.failed": "payment.failed",
  "refund.processed": "payment.refunded",
};

interface PaystackWebhookShape {
  event?: unknown;
  data?: {
    reference?: unknown;
    amount?: unknown;
    currency?: unknown;
    metadata?: { school_id?: unknown; fee_id?: unknown } | null;
  } | null;
}

function constantTimeHexEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyPaystackSignature(
  config: PaystackAdapterConfig,
  request: WebhookRequest,
): VerifySignatureResult {
  const header = request.headers[SIGNATURE_HEADER];
  if (typeof header !== "string" || header.trim() === "") {
    return { ok: false, code: "missing_signature", reason: "Missing x-paystack-signature header" };
  }
  if (!/^[0-9a-f]{64,128}$/i.test(header)) {
    return {
      ok: false,
      code: "malformed_signature",
      reason: "Signature header is not a hex digest",
    };
  }
  const expected = createHmac("sha512", config.secretKey).update(request.rawBody).digest("hex");
  if (!constantTimeHexEquals(header, expected)) {
    return {
      ok: false,
      code: "signature_mismatch",
      reason: "Webhook signature does not match payload",
    };
  }
  return { ok: true };
}

/**
 * Translate a verified Paystack payload into a `PaymentEvent`. Only
 * strictly-shaped, known events pass; anything else fails closed.
 * Metadata tenant/purpose hints are evidence only — downstream callers
 * must re-validate ownership against canonical records.
 */
export function parsePaystackWebhook(
  config: PaystackAdapterConfig,
  request: WebhookRequest,
): ParseWebhookResult {
  const signature = verifyPaystackSignature(config, request);
  if (!signature.ok) {
    return { ok: false, code: "signature_invalid", reason: signature.reason };
  }

  let parsed: PaystackWebhookShape;
  try {
    parsed = JSON.parse(Buffer.from(request.rawBody).toString("utf8")) as PaystackWebhookShape;
  } catch {
    return { ok: false, code: "malformed_payload", reason: "Webhook body is not valid JSON" };
  }

  if (typeof parsed.event !== "string" || typeof parsed.data !== "object" || parsed.data === null) {
    return {
      ok: false,
      code: "malformed_payload",
      reason: "Webhook payload requires event and data",
    };
  }
  const type = KNOWN_EVENTS[parsed.event];
  if (!type) {
    return { ok: false, code: "unknown_event", reason: `Unknown Paystack event "${parsed.event}"` };
  }

  const { reference, amount, currency, metadata } = parsed.data;
  if (
    typeof reference !== "string" ||
    reference.trim() === "" ||
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    typeof currency !== "string" ||
    currency.trim() === ""
  ) {
    return {
      ok: false,
      code: "malformed_payload",
      reason: "Webhook data requires reference, positive integer amount and currency",
    };
  }

  const amountMoney: Money = money(amount, currency);
  const event: PaymentEvent = {
    type,
    // Paystack does not send a separate event id on charge.* webhooks; the
    // transaction reference is the durable idempotency identity here.
    eventId: reference,
    provider: "paystack",
    providerReference: reference,
    amount: amountMoney,
    tenantId:
      typeof metadata?.school_id === "string" && metadata.school_id.trim() !== ""
        ? tenantId(metadata.school_id)
        : null,
    purposeRef:
      typeof metadata?.fee_id === "string" && metadata.fee_id.trim() !== ""
        ? metadata.fee_id
        : null,
    occurredAt: new Date(request.receivedAtSec * 1000).toISOString(),
  };
  return { ok: true, event };
}

/**
 * Paystack adapter. Refunds are declared but BLK-4 blocks live execution —
 * the refund capability stays false until the block is lifted, so the
 * contract never promises what it cannot deliver.
 */
export function createPaystackAdapter(config: PaystackAdapterConfig): PaystackAdapter {
  const policy = config.failurePolicy ?? PAYSTACK_FAILURE_POLICY;
  return {
    provider: "paystack",
    capabilities: { refunds: false },
    failurePolicy: policy,
    createIntent(reference, now) {
      const outcome = policy.containSync("paystack.createIntent", () => {
        const validation = validatePaymentReference(reference);
        if (!validation.ok) {
          return {
            ok: false as const,
            code: "invalid_reference" as const,
            reason: validation.reason,
          };
        }
        return {
          ok: true as const,
          intent: {
            id: `intent_paystack_${reference.purpose.kind}_${reference.purpose.ref}_${now}`,
            reference,
            provider: "paystack",
            providerReference: null,
            idempotencyKey: deriveIdempotencyKey(reference),
            status: "created" as const,
            createdAt: now,
          },
        };
      });
      // Fail closed: a contained defect can never fabricate an intent.
      return outcome.outcome === "ok"
        ? outcome.value
        : {
            ok: false,
            code: "invalid_reference",
            reason: `intent creation failed closed (contained: ${outcome.reason})`,
          };
    },
    verifySignature(request) {
      const outcome = policy.containSync("paystack.verifySignature", () =>
        verifyPaystackSignature(config, request),
      );
      return outcome.outcome === "ok"
        ? outcome.value
        : {
            ok: false,
            code: "signature_mismatch",
            reason: `signature verification failed closed (contained: ${outcome.reason})`,
          };
    },
    parseWebhook(request) {
      const outcome = policy.containSync("paystack.parseWebhook", () =>
        parsePaystackWebhook(config, request),
      );
      return outcome.outcome === "ok"
        ? outcome.value
        : {
            ok: false,
            code: "malformed_payload",
            reason: `webhook processing failed closed (contained: ${outcome.reason})`,
          };
    },
  };
}

/** Refund entry point for when the BLK-4 block lifts (capability-gated). */
export function paystackRefundUnsupported(): RefundResult {
  return { ok: false, code: "unsupported", reason: "Paystack refunds are BLK-4 blocked in V1" };
}
