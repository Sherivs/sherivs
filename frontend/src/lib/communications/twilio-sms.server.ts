/**
 * CoreGrid — Twilio SMS adapter (V1-009 communication fabric).
 *
 * The concrete Twilio implementation of CoreGrid's outbound SMS capability.
 * Like the Resend email adapter, CoreGrid owns communication INTENT
 * (recipient, authorization, message, delivery state, retries); Twilio is an
 * ADAPTER only (Constitution §24), reached through one bounded fetch here.
 *
 * Fail-closed credential law (battery discipline, exit-2 semantics):
 * - Credentials come from the environment only — `TWILIO_ACCOUNT_SID`,
 *   `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (Basic-auth scheme
 *   `SID:AUTH_TOKEN`, the canonical Twilio REST credential pair). Never
 *   hardcoded, never logged (§30).
 * - On missing credentials the sender resolves to the typed blocked result
 *   `undeliverable("provider_not_configured")` naming the missing
 *   environment variable and stating that no provider call was attempted.
 *   It NEVER fakes a send and NEVER fabricates a receipt.
 * - Secret values never appear in any reason string, log, or result — only
 *   environment variable NAMES do.
 *
 * Inbound webhook law (Constitution §17/§37): Twilio signs POST parameters
 * with `x-twilio-signature` (base64 HMAC-SHA1 over the full request URL
 * concatenated with its sorted parameters, keyed by the auth token). The
 * validator here is constant-time over the exact injected bytes. An inbound
 * webhook is NEVER processed as trusted merely because it reached an
 * endpoint.
 *
 * Outbound payloads are bounded before any network contact (§26). A send is
 * non-idempotent: the transport performs a SINGLE attempt; retries belong to
 * the calling pipeline, signalled through the structured `retryable` flag
 * (408/429/5xx retryable, other 4xx not).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const sendTimeAuthority = new TimeAuthority(new SystemClock());

/** Registry provider id under which the Twilio SMS adapter is configured. */
export const TWILIO_SMS_PROVIDER_ID = "twilio-sms";

/** Environment variable names this adapter reads (names only, §30). */
export const TWILIO_ACCOUNT_SID_ENV = "TWILIO_ACCOUNT_SID";
export const TWILIO_AUTH_TOKEN_ENV = "TWILIO_AUTH_TOKEN";
export const TWILIO_FROM_NUMBER_ENV = "TWILIO_FROM_NUMBER";

/** The credential references the registry exposes — pointers, never values. */
export const TWILIO_ACCOUNT_SID_REFERENCE = `env://${TWILIO_ACCOUNT_SID_ENV}`;
export const TWILIO_AUTH_TOKEN_REFERENCE = `env://${TWILIO_AUTH_TOKEN_ENV}`;
export const TWILIO_FROM_NUMBER_REFERENCE = `env://${TWILIO_FROM_NUMBER_ENV}`;

/** The single endpoint family this adapter may contact (messages resource). */
export const TWILIO_MESSAGES_ENDPOINT_BASE = "https://api.twilio.com/2010-04-01/Accounts";

/** Read-only view over the server environment (never a secret carrier). */
export type ServerEnv = Record<string, string | undefined>;

function isNonBlank(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Environment-derived configuration facts for the Twilio SMS adapter. Null
 * on the whole when ANY required credential is absent — the fail-closed
 * signal. Secret VALUES are carried here only in server memory; they never
 * enter logs, results, or the registry.
 */
export interface TwilioSmsConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

/** Missing environment variable names for the Twilio SMS adapter, in gate order. */
export function missingTwilioSmsEnvVars(env: ServerEnv): readonly string[] {
  return [TWILIO_ACCOUNT_SID_ENV, TWILIO_AUTH_TOKEN_ENV, TWILIO_FROM_NUMBER_ENV].filter(
    (name) => !isNonBlank(env[name]),
  );
}

/**
 * Environment-derived configuration. Returns null when ANY required
 * credential is absent — the adapter's fail-closed signal.
 */
export function twilioSmsConfigFromEnv(env: ServerEnv): TwilioSmsConfig | null {
  if (missingTwilioSmsEnvVars(env).length > 0) return null;
  return {
    accountSid: env[TWILIO_ACCOUNT_SID_ENV] as string,
    authToken: env[TWILIO_AUTH_TOKEN_ENV] as string,
    fromNumber: env[TWILIO_FROM_NUMBER_ENV] as string,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Outbound contract (Zod — §26, §32)
 * ────────────────────────────────────────────────────────────*/

export const TWILIO_SMS_PAYLOAD_MAX = {
  number: 20,
  body: 1_600, // one GSM-7 concatenated-message bound
} as const;

const E164_SHAPE = /^\+[1-9][0-9]{1,14}$/;

/** The exact form fields this adapter sends to Twilio — bounded and validated. */
export const TwilioSmsPayloadSchema = z.strictObject({
  To: z
    .string()
    .trim()
    .max(TWILIO_SMS_PAYLOAD_MAX.number)
    .regex(E164_SHAPE, "recipient must be an E.164 phone number"),
  From: z
    .string()
    .trim()
    .max(TWILIO_SMS_PAYLOAD_MAX.number)
    .regex(E164_SHAPE, "sender must be an E.164 phone number"),
  Body: z.string().min(1).max(TWILIO_SMS_PAYLOAD_MAX.body),
});

/** Untrusted provider output is minimized to the fields this adapter consumes. */
export const TwilioSmsResponseSchema = z.object({
  sid: z.string().trim().min(6).max(64),
  status: z.string().trim().min(1).max(32),
});

/* ─────────────────────────────────────────────────────────────
 * Typed results (CoreGrid vocabulary — provider shapes never leak inward)
 * ────────────────────────────────────────────────────────────*/

export type TwilioSmsResult =
  | {
      outcome: "sent";
      providerMessageId: string;
      providerStatus: string;
      confirmedAt: string;
    }
  | { outcome: "failed"; code: "provider_error"; reason: string; retryable: boolean }
  | {
      outcome: "undeliverable";
      code: "provider_not_configured";
      reason: string;
    };

export interface TwilioSmsCommand {
  /** Tenant the message belongs to (resolved server-side by the caller). */
  tenantId: string;
  /** Correlation ref for the originating notification/event (human-safe). */
  notificationRef: string | null;
  /** Recipient in E.164 form. */
  to: string;
  /** Message body (already template-rendered by the calling service). */
  body: string;
}

export type FetchLike = typeof fetch;

/**
 * Build the Twilio SMS sender. Single transport attempt per call; the
 * credential gate runs FIRST — before any other work, before any provider
 * contact.
 */
export function createTwilioSmsSender(
  config: TwilioSmsConfig | null,
  fetchImpl: FetchLike = fetch,
): (command: TwilioSmsCommand) => Promise<TwilioSmsResult> {
  return async (command: TwilioSmsCommand): Promise<TwilioSmsResult> => {
    if (config === null) {
      return {
        outcome: "undeliverable",
        code: "provider_not_configured",
        reason: `BLOCKED_NO_CREDENTIAL: Twilio SMS requires ${TWILIO_ACCOUNT_SID_ENV}, ${TWILIO_AUTH_TOKEN_ENV} and ${TWILIO_FROM_NUMBER_ENV}; no SMS was sent and no provider call was attempted`,
      };
    }

    const payload = {
      To: command.to,
      From: config.fromNumber,
      Body: command.body,
    };
    const parsedPayload = TwilioSmsPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return {
        outcome: "failed",
        code: "provider_error",
        reason: `Outbound SMS payload for ${command.notificationRef ?? "unreferenced message"} was rejected by local contract validation (no provider call was attempted): ${parsedPayload.error.issues
          .map((issue) => issue.path.join("."))
          .join(", ")}`,
        retryable: false,
      };
    }

    const endpoint = `${TWILIO_MESSAGES_ENDPOINT_BASE}/${encodeURIComponent(config.accountSid)}/Messages.json`;
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(parsedPayload.data).toString(),
      });
    } catch (err) {
      return {
        outcome: "failed",
        code: "provider_error",
        reason: `SMS delivery could not reach the telephony provider: ${err instanceof Error ? err.message : String(err)}`,
        retryable: true,
      };
    }

    if (!response.ok) {
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      return {
        outcome: "failed",
        code: "provider_error",
        reason: `Telephony provider refused the SMS send (http ${response.status}); the credential value is never logged`,
        retryable,
      };
    }

    const parsedBody = TwilioSmsResponseSchema.safeParse(
      await response.json().catch(() => ({})),
    );
    if (!parsedBody.success) {
      return {
        outcome: "failed",
        code: "provider_error",
        reason: "Telephony provider accepted the send but returned no usable message id; delivery is NOT asserted",
        retryable: false,
      };
    }

    return {
      outcome: "sent",
      providerMessageId: parsedBody.data.sid,
      providerStatus: parsedBody.data.status,
      confirmedAt: sendTimeAuthority.now().at,
    };
  };
}

/* ─────────────────────────────────────────────────────────────
 * Inbound webhook signature validation (§17 — never trust inbound)
 * ────────────────────────────────────────────────────────────*/

export interface TwilioWebhookRequest {
  /** The FULL request URL as Twilio saw it (scheme + host + path + query). */
  url: string;
  /** Parsed POST parameters (form-decoded, order-independent). */
  params: Record<string, string>;
  /** The raw `x-twilio-signature` header value. */
  signatureHeader: string | null;
}

export type TwilioWebhookVerificationResult =
  | { ok: true }
  | { ok: false; code: "missing_signature" | "malformed_signature" | "signature_mismatch"; reason: string };

/** Twilio's signing scheme: base64(HMAC-SHA1(authToken, url + sortedParams)). */
export function computeTwilioWebhookSignature(authToken: string, url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  const concatenated = url + sortedKeys.map((key) => `${key}${params[key]}`).join("");
  return createHmac("sha1", authToken).update(concatenated).digest("base64");
}

function constantTimeBase64Equals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validate an inbound Twilio webhook request. Constant-time over the exact
 * injected bytes; the auth token never appears in any returned reason.
 */
export function verifyTwilioWebhookSignature(
  authToken: string,
  request: TwilioWebhookRequest,
): TwilioWebhookVerificationResult {
  if (!isNonBlank(request.signatureHeader)) {
    return { ok: false, code: "missing_signature", reason: "Missing x-twilio-signature header" };
  }
  if (!/^[0-9A-Za-z+/=]{10,}$/.test(request.signatureHeader)) {
    return {
      ok: false,
      code: "malformed_signature",
      reason: "Signature header is not a base64 digest",
    };
  }
  const expected = computeTwilioWebhookSignature(authToken, request.url, request.params);
  if (!constantTimeBase64Equals(request.signatureHeader, expected)) {
    return { ok: false, code: "signature_mismatch", reason: "Webhook signature does not match request" };
  }
  return { ok: true };
}