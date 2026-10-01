/**
 * CoreGrid — Stripe payment adapter (V5.3 Part 21).
 *
 * Implements the `PaymentAdapter` contract for Stripe. Stripe is an
 * implementation dependency only: wire formats are translated into
 * CoreGrid vocabulary at the boundary and never leak inward.
 *
 * Signature scheme (Stripe convention): the `stripe-signature` header
 * carries `t=<unix-seconds>,v1=<hex>` where `v1` is HMAC-SHA256 over
 * `${timestamp}.${rawBody}` with the webhook signing secret. Replay
 * protection is the timestamp tolerance check — signatures outside the
 * tolerance window are rejected even if cryptographically valid.
 * Under BLK-4 this adapter performs no network I/O; test secrets must
 * always be clearly-marked fixtures.
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

export interface StripeAdapterConfig {
  /** Webhook signing secret (`whsec_...` in live mode). */
  signingSecret: string;
  /** Max age of the signed timestamp in seconds (default 300). */
  toleranceSec?: number;
  /**
   * J-045: declared failure-semantics policy. Defaults to
   * `STRIPE_FAILURE_POLICY` when omitted; injected instances allow tests
   * and deployments to tune thresholds without changing the contract.
   */
  failurePolicy?: AdapterFailurePolicy;
}

/**
 * Declared failure-semantics policy for the Stripe adapter (J-045). Under
 * BLK-4 all operations are local, so containment is synchronous; the
 * declared timeout binds the future external-call surface when the block
 * lifts. Webhook processing is exactly-once via the replay guard — the
 * transport never retries.
 */
export const STRIPE_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "stripe",
  timeoutMs: 5_000,
  maxAttempts: 1,
  backoffBaseMs: 250,
  backoffCapMs: 4_000,
  degradedAfterFailures: 3,
  degradedWindowMs: 60_000,
  breakerFailureThreshold: 5,
  breakerResetMs: 30_000,
});

/** The Stripe adapter plus its declared failure policy (J-045, additive). */
export type StripeAdapter = PaymentAdapter & {
  readonly failurePolicy: AdapterFailurePolicy;
};

const SIGNATURE_HEADER = "stripe-signature";
const DEFAULT_TOLERANCE_SEC = 300;

/** Stripe webhook event types this adapter understands (fail closed otherwise). */
const KNOWN_EVENTS: Readonly<
  Record<string, "payment.succeeded" | "payment.failed" | "payment.refunded">
> = {
  "payment_intent.succeeded": "payment.succeeded",
  "payment_intent.payment_failed": "payment.failed",
  "charge.refunded": "payment.refunded",
};

interface StripeWebhookShape {
  id?: unknown;
  type?: unknown;
  data?: {
    object?: {
      id?: unknown;
      amount?: unknown;
      currency?: unknown;
      metadata?: { tenant_id?: unknown; purpose_ref?: unknown } | null;
    } | null;
  } | null;
}

interface ParsedSignatureHeader {
  timestamp: number;
  signatures: readonly string[];
}

/** Strict `t=…,v1=…,v1=…` header parse; null on anything malformed. */
function parseStripeSignatureHeader(header: string): ParsedSignatureHeader | null {
  if (header.trim() === "") return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      if (!/^\d+$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === "v1") {
      if (!/^[0-9a-f]{64}$/i.test(value)) return null;
      signatures.push(value);
    }
    // Unknown keys (e.g. future v2 schemes) are ignored, per Stripe practice.
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function constantTimeHexEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyStripeSignature(
  config: StripeAdapterConfig,
  request: WebhookRequest,
): VerifySignatureResult {
  const header = request.headers[SIGNATURE_HEADER];
  if (typeof header !== "string" || header.trim() === "") {
    return { ok: false, code: "missing_signature", reason: "Missing stripe-signature header" };
  }
  const parsed = parseStripeSignatureHeader(header);
  if (!parsed) {
    return {
      ok: false,
      code: "malformed_signature",
      reason: "stripe-signature header is malformed",
    };
  }

  const tolerance = config.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  // Replay protection: reject signatures whose timestamp drifted outside
  // the tolerance window in either direction (stale or future-dated).
  if (Math.abs(request.receivedAtSec - parsed.timestamp) > tolerance) {
    return {
      ok: false,
      code: "stale_timestamp",
      reason: `Signed timestamp outside the ${tolerance}s tolerance window`,
    };
  }

  const body = Buffer.from(request.rawBody).toString("utf8");
  const expected = createHmac("sha256", config.signingSecret)
    .update(`${parsed.timestamp}.${body}`)
    .digest("hex");
  // Stripe may emit multiple v1 entries during key rotation — any valid
  // match accepts, every mismatch denies.
  const matched = parsed.signatures.some((candidate) => constantTimeHexEquals(candidate, expected));
  if (!matched) {
    return {
      ok: false,
      code: "signature_mismatch",
      reason: "Webhook signature does not match payload",
    };
  }
  return { ok: true };
}

/**
 * Translate a verified Stripe payload into a `PaymentEvent`. Only
 * strictly-shaped, known events pass; anything else fails closed.
 * Metadata tenant/purpose hints are evidence only — downstream callers
 * must re-validate ownership against canonical records.
 */
export function parseStripeWebhook(
  config: StripeAdapterConfig,
  request: WebhookRequest,
): ParseWebhookResult {
  const signature = verifyStripeSignature(config, request);
  if (!signature.ok) {
    return { ok: false, code: "signature_invalid", reason: signature.reason };
  }

  let parsed: StripeWebhookShape;
  try {
    parsed = JSON.parse(Buffer.from(request.rawBody).toString("utf8")) as StripeWebhookShape;
  } catch {
    return { ok: false, code: "malformed_payload", reason: "Webhook body is not valid JSON" };
  }

  if (typeof parsed.id !== "string" || parsed.id.trim() === "" || typeof parsed.type !== "string") {
    return { ok: false, code: "malformed_payload", reason: "Webhook payload requires id and type" };
  }
  const type = KNOWN_EVENTS[parsed.type];
  if (!type) {
    return { ok: false, code: "unknown_event", reason: `Unknown Stripe event "${parsed.type}"` };
  }

  const object = parsed.data?.object ?? null;
  const providerReference =
    typeof object?.id === "string" && object.id.trim() !== "" ? object.id : null;
  const amount = object?.amount;
  const currency = object?.currency;
  if (
    providerReference === null ||
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    typeof currency !== "string" ||
    currency.trim() === ""
  ) {
    return {
      ok: false,
      code: "malformed_payload",
      reason: "Webhook data.object requires id, positive integer amount and currency",
    };
  }

  const amountMoney: Money = money(amount, currency);
  const event: PaymentEvent = {
    type,
    eventId: parsed.id,
    provider: "stripe",
    providerReference,
    amount: amountMoney,
    tenantId:
      typeof object?.metadata?.tenant_id === "string" && object.metadata.tenant_id.trim() !== ""
        ? tenantId(object.metadata.tenant_id)
        : null,
    purposeRef:
      typeof object?.metadata?.purpose_ref === "string" && object.metadata.purpose_ref.trim() !== ""
        ? object.metadata.purpose_ref
        : null,
    occurredAt: new Date(request.receivedAtSec * 1000).toISOString(),
  };
  return { ok: true, event };
}

/**
 * Stripe adapter. Refunds are declared but BLK-4 blocks live execution —
 * the refund capability stays false until the block is lifted, so the
 * contract never promises what it cannot deliver.
 */
export function createStripeAdapter(config: StripeAdapterConfig): StripeAdapter {
  const policy = config.failurePolicy ?? STRIPE_FAILURE_POLICY;
  return {
    provider: "stripe",
    capabilities: { refunds: false },
    failurePolicy: policy,
    createIntent(reference, now) {
      const outcome = policy.containSync("stripe.createIntent", () => {
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
            id: `intent_stripe_${reference.purpose.kind}_${reference.purpose.ref}_${now}`,
            reference,
            provider: "stripe",
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
      const outcome = policy.containSync("stripe.verifySignature", () =>
        verifyStripeSignature(config, request),
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
      const outcome = policy.containSync("stripe.parseWebhook", () =>
        parseStripeWebhook(config, request),
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
export function stripeRefundUnsupported(): RefundResult {
  return { ok: false, code: "unsupported", reason: "Stripe refunds are BLK-4 blocked in V1" };
}
