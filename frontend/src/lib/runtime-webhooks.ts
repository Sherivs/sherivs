/**
 * Sherivs — Core Application Runtime webhook handling.
 *
 * Implements `architecture/phase-05-core-application-runtime.md`:
 * - Webhook runtime (Section BH): outbound webhooks, inbound webhook processing,
 *   signature verification, retry, delivery tracking, idempotency.
 * - Webhook security (Section BI): signature validation, timestamp validation,
 *   replay protection, source validation.
 * - Webhook delivery model (Section GR): endpoint, event, attempt, response,
 *   delivery status, retry state.
 */

import type { TenantId } from "./tenant-core";
import type { CorrelationId } from "./runtime-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";
import { createHmac, timingSafeEqual } from "node:crypto";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Webhook delivery model (Section GR)
 * ────────────────────────────────────────────────────────────*/

export type WebhookDeliveryStatus =
  "pending" | "delivered" | "failed" | "retrying" | "dead_lettered";

export interface WebhookDeliveryAttempt {
  attemptNumber: number;
  sentAt: string;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  retryDecision: "retry" | "permanent_failure" | "delivered";
}

export interface WebhookDelivery {
  id: string;
  endpoint: string;
  eventName: string;
  eventId: string;
  tenantId: TenantId | null;
  correlationId: CorrelationId;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: WebhookDeliveryAttempt[];
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  nextRetryAt: string | null;
}

export interface CreateWebhookDeliveryInput {
  endpoint: string;
  eventName: string;
  eventId: string;
  tenantId: TenantId | null;
  correlationId: CorrelationId;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  now: string;
}

export function createWebhookDelivery(input: CreateWebhookDeliveryInput): WebhookDelivery {
  return {
    id: `wh-${input.now}-${Math.random().toString(36).slice(2, 10)}`,
    endpoint: input.endpoint,
    eventName: input.eventName,
    eventId: input.eventId,
    tenantId: input.tenantId,
    correlationId: input.correlationId,
    payload: input.payload,
    status: "pending",
    attempts: [],
    maxAttempts: input.maxAttempts ?? 3,
    createdAt: input.now,
    updatedAt: input.now,
    nextRetryAt: null,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Webhook security (Section BI)
 * ────────────────────────────────────────────────────────────*/

export interface WebhookSignature {
  /** HMAC signature (hex). */
  signature: string;
  /** Timestamp used for replay protection. */
  timestamp: string;
  /** Signature version. */
  version: string;
}

export interface WebhookSecurityConfig {
  /** Secret used for HMAC signing. */
  secret: string;
  /** Maximum allowed timestamp skew in milliseconds. */
  maxTimestampSkewMs: number;
  /** Allowed signature versions. */
  allowedVersions: readonly string[];
}

/**
 * Validates an inbound webhook signature (Section BI).
 * - Signature validation
 * - Timestamp validation (replay protection)
 * - Source validation via version check
 */
export function validateWebhookSignature(
  signature: WebhookSignature,
  config: WebhookSecurityConfig,
  now: string,
  rawBody: string | Uint8Array,
): { valid: true } | { valid: false; reason: string } {
  // Version must be allowed.
  if (!config.allowedVersions.includes(signature.version)) {
    return { valid: false, reason: "Unsupported signature version" };
  }

  // Timestamp must be within allowed skew (replay protection).
  const timestampMs = Date.parse(signature.timestamp);
  if (Number.isNaN(timestampMs)) {
    return { valid: false, reason: "Invalid timestamp" };
  }
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    return { valid: false, reason: "Invalid current time" };
  }
  const skew = Math.abs(nowMs - timestampMs);
  if (skew > config.maxTimestampSkewMs) {
    return { valid: false, reason: "Timestamp outside allowed skew" };
  }

  if (!config.secret || !/^[a-f0-9]{64}$/i.test(signature.signature)) {
    return { valid: false, reason: "Invalid signature" };
  }

  const expected = Buffer.from(
    computeWebhookSignature(rawBody, config.secret, signature.timestamp),
    "hex",
  );
  const received = Buffer.from(signature.signature, "hex");
  return timingSafeEqual(received, expected)
    ? { valid: true }
    : { valid: false, reason: "Signature mismatch" };
}

/**
 * Computes an HMAC-SHA256 signature over the exact request body and timestamp.
 */
export function computeWebhookSignature(
  rawBody: string | Uint8Array,
  secret: string,
  timestamp: string,
): string {
  if (!secret) {
    throw new Error("Webhook signing secret must not be empty");
  }
  const timestampBytes = Buffer.from(timestamp, "utf8");
  const bodyBytes =
    typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody);
  const lengths = Buffer.alloc(16);
  lengths.writeBigUInt64BE(BigInt(timestampBytes.length), 0);
  lengths.writeBigUInt64BE(BigInt(bodyBytes.length), 8);

  return createHmac("sha256", secret)
    .update("sherivs.webhook.signature.hmac-sha256\0", "utf8")
    .update(lengths)
    .update(timestampBytes)
    .update(bodyBytes)
    .digest("hex");
}

/* ─────────────────────────────────────────────────────────────
 * Webhook delivery tracking (Section GR)
 * ────────────────────────────────────────────────────────────*/

export interface WebhookSender {
  send(
    delivery: WebhookDelivery,
  ): Promise<{ ok: true; status: number; body: string } | { ok: false; error: string }>;
}

export interface WebhookDeliveryTracker {
  deliveries: WebhookDelivery[];
  record(delivery: WebhookDelivery): void;
  find(id: string): WebhookDelivery | null;
  updateStatus(id: string, status: WebhookDeliveryStatus): boolean;
}

export function createWebhookDeliveryTracker(): WebhookDeliveryTracker {
  const deliveries: WebhookDelivery[] = [];
  return {
    deliveries,
    record(delivery) {
      deliveries.push(delivery);
    },
    find(id) {
      return deliveries.find((d) => d.id === id) ?? null;
    },
    updateStatus(id, status) {
      const d = deliveries.find((x) => x.id === id);
      if (!d) return false;
      d.status = status;
      d.updatedAt = timeAuthority.now().at;
      return true;
    },
  };
}

/**
 * Processes a webhook delivery with retry (Section BH).
 * - Tracks delivery attempts
 * - Applies bounded retries
 * - Moves to dead-letter on permanent failure
 */
export async function processWebhookDelivery(
  delivery: WebhookDelivery,
  sender: WebhookSender,
  now: string,
): Promise<WebhookDelivery> {
  const attemptNumber = delivery.attempts.length + 1;

  const attempt: WebhookDeliveryAttempt = {
    attemptNumber,
    sentAt: now,
    responseStatus: null,
    responseBody: null,
    error: null,
    retryDecision: "retry",
  };

  const result = await sender.send(delivery);

  if (!result.ok) {
    attempt.error = result.error;
    attempt.retryDecision = attemptNumber >= delivery.maxAttempts ? "permanent_failure" : "retry";
    delivery.status = attempt.retryDecision === "retry" ? "retrying" : "dead_lettered";
    delivery.nextRetryAt =
      attempt.retryDecision === "retry"
        ? new Date(timeAuthority.now().atMs + 1000 * Math.pow(2, attemptNumber - 1)).toISOString()
        : null;
  } else {
    attempt.responseStatus = result.status;
    attempt.responseBody = result.body;
    attempt.retryDecision = "delivered";
    delivery.status = "delivered";
    delivery.nextRetryAt = null;
  }

  delivery.attempts.push(attempt);
  delivery.updatedAt = now;
  return delivery;
}
