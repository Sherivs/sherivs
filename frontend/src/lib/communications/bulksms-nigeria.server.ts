/**
 * Sherivs — BulkSMS Nigeria SMS adapter (COMMS-03). Server only.
 *
 * The concrete provider behind the SMS gateway port (`sms-gateway-contract.ts`).
 * It speaks the documented BulkSMS Nigeria v2 API:
 *   POST https://www.bulksmsnigeria.com/api/v2/sms   (Bearer token, JSON body)
 *   body fields: from (sender id, max 11), to (digits, international form),
 *                body (max 1530), unicode?, callback_url?
 *   success:     { status: "success", code: "BSNG-0000", data: { message_id, ... } }
 *   errors:      { status: "error", error: { code: "BSNG-XXXX", ... } }, HTTP 4xx
 * Delivery outcomes are POSTed per recipient to `callback_url` as JSON
 * { message_id, recipient, delivery_status, ... }. The provider does NOT sign those
 * requests, so authenticity is established by a per-message HMAC token carried in the
 * callback URL we hand the provider (see `signBulkSmsCallback`).
 * The provider documents no inbound-reply webhook, so none is implemented.
 *
 * Laws honoured:
 * - Fail-closed credential law: without `BULKSMS_NG_TOKEN` + `BULKSMS_NG_SENDER` the
 *   gateway returns the typed `undeliverable` result BEFORE any network contact. It never
 *   fakes a send and never fabricates a receipt. Secret values appear in no result,
 *   reason, log or URL — only variable NAMES do (§30).
 * - At-most-once SMS: the provider offers no idempotency key, so a send is a SINGLE
 *   attempt and is retryable only when the provider provably did not process it
 *   (HTTP 429/503, or a connection that never reached the provider). Any ambiguous
 *   outcome is terminal; a parent is never texted twice because of a retry.
 * - Payloads are bounded and validated locally before any provider contact (§26).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import type { SmsGateway, SmsSendCommand, SmsSendResult } from "./sms-gateway-contract";

/** J-023: time enters only via the kernel time-authority. */
const timeAuthority = new TimeAuthority(new SystemClock());

/** Registry provider id; identical to the value `comms_send` stamps on queued SMS rows. */
export const BULKSMS_NIGERIA_PROVIDER_ID = "bulksmsnigeria";

/** Environment variable names this adapter reads (names only, §30). */
export const BULKSMS_NG_TOKEN_ENV = "BULKSMS_NG_TOKEN";
export const BULKSMS_NG_SENDER_ENV = "BULKSMS_NG_SENDER";
export const BULKSMS_NG_WEBHOOK_SECRET_ENV = "BULKSMS_NG_WEBHOOK_SECRET";
export const BULKSMS_NG_WEBHOOK_URL_ENV = "BULKSMS_NG_WEBHOOK_URL";

/** The single endpoint this adapter may contact. Fixed in code: never env-derived (SSRF). */
export const BULKSMS_NG_SEND_ENDPOINT = "https://www.bulksmsnigeria.com/api/v2/sms";

/** Provider-documented bounds. */
export const BULKSMS_NG_LIMITS = { sender: 11, body: 1_530 } as const;
const REQUEST_TIMEOUT_MS = 15_000;

export type ServerEnv = Record<string, string | undefined>;
export type FetchLike = typeof fetch;

function isNonBlank(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface BulkSmsNigeriaConfig {
  token: string;
  sender: string;
  /** Delivery-report callback; null when not (fully) configured — sends then carry no callback. */
  webhook: { baseUrl: string; secret: string } | null;
}

/** Missing REQUIRED environment variable names, in gate order. */
export function missingBulkSmsNigeriaEnvVars(env: ServerEnv): readonly string[] {
  return [BULKSMS_NG_TOKEN_ENV, BULKSMS_NG_SENDER_ENV].filter((name) => !isNonBlank(env[name]));
}

function validWebhookBase(raw: string | undefined): string | null {
  if (!isNonBlank(raw)) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Null on the whole when a required credential is absent or malformed — the fail-closed signal. */
export function bulkSmsNigeriaConfigFromEnv(env: ServerEnv): BulkSmsNigeriaConfig | null {
  if (missingBulkSmsNigeriaEnvVars(env).length > 0) return null;
  const sender = (env[BULKSMS_NG_SENDER_ENV] as string).trim();
  if (!/^[\x20-\x7E]{1,11}$/.test(sender)) return null;
  const base = validWebhookBase(env[BULKSMS_NG_WEBHOOK_URL_ENV]);
  const secret = env[BULKSMS_NG_WEBHOOK_SECRET_ENV];
  return {
    token: (env[BULKSMS_NG_TOKEN_ENV] as string).trim(),
    sender,
    webhook: base && isNonBlank(secret) ? { baseUrl: base, secret: secret.trim() } : null,
  };
}

/**
 * Normalise a stored member phone to the provider's digits-only international form.
 * Nigerian local form (0 + 10 digits) becomes 234…; anything else must already be a
 * 10–15 digit international number. Returns null when it cannot be made valid.
 */
export function normalizeSmsRecipient(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (/^0[0-9]{10}$/.test(digits)) digits = `234${digits.slice(1)}`;
  return /^[1-9][0-9]{9,14}$/.test(digits) ? digits : null;
}

/* ─────────────────────────────────────────────────────────────
 * Outbound contract (Zod — §26, §32)
 * ────────────────────────────────────────────────────────────*/

export const BulkSmsNigeriaPayloadSchema = z.strictObject({
  from: z
    .string()
    .trim()
    .regex(/^[\x20-\x7E]{1,11}$/, "sender id must be 1-11 printable ASCII characters"),
  to: z.string().regex(/^[1-9][0-9]{9,14}$/, "recipient must be an international number"),
  body: z.string().min(1).max(BULKSMS_NG_LIMITS.body),
  unicode: z.boolean().optional(),
  callback_url: z.string().url().max(2_000).optional(),
});

/** Untrusted provider output is minimised to the fields this adapter consumes. */
const SuccessResponseSchema = z.object({
  status: z.literal("success"),
  data: z.object({ message_id: z.union([z.string().trim().min(1).max(128), z.number()]) }),
});

/* ─────────────────────────────────────────────────────────────
 * Delivery-report callback authenticity
 * ────────────────────────────────────────────────────────────*/

/**
 * Per-message callback token: HMAC-SHA256(secret, messageId). A token leaked from a request
 * log authenticates a callback for ONE message only, never the endpoint.
 */
export function signBulkSmsCallback(secret: string, messageId: string): string {
  return createHmac("sha256", secret)
    .update(`bulksms-ng-callback:${messageId}`)
    .digest("base64url");
}

/** Constant-time verification of the per-message callback token. Fails closed. */
export function verifyBulkSmsCallback(input: {
  secret: string | null | undefined;
  messageId: string | null;
  signature: string | null;
}): boolean {
  const { secret, messageId, signature } = input;
  if (!isNonBlank(secret) || !messageId || !signature) return false;
  const expected = Buffer.from(signBulkSmsCallback(secret.trim(), messageId), "utf8");
  const provided = Buffer.from(signature, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function bulkSmsCallbackUrl(
  webhook: { baseUrl: string; secret: string },
  messageId: string,
): string {
  const url = new URL(webhook.baseUrl);
  url.searchParams.set("ref", messageId);
  url.searchParams.set("sig", signBulkSmsCallback(webhook.secret, messageId));
  return url.toString();
}

export type BulkSmsDeliveryOutcome = "delivered" | "failed" | "pending";

/**
 * Map the provider's per-recipient `delivery_status`. Per the provider: `delivrd`,
 * `delivered` and `success` mean delivered; any other final value is NOT delivered; new
 * values can appear over time, so unknown values resolve to failed, never to delivered.
 */
export function mapBulkSmsDeliveryStatus(raw: string): {
  outcome: BulkSmsDeliveryOutcome;
  code: string | null;
} {
  const status = raw.trim().toLowerCase();
  if (["delivrd", "delivered", "success"].includes(status)) {
    return { outcome: "delivered", code: null };
  }
  if (["sent awaiting status", "pending", "queued"].includes(status)) {
    return { outcome: "pending", code: null };
  }
  const slug =
    status
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || "unknown";
  return { outcome: "failed", code: `dlr_${slug}` };
}

/* ─────────────────────────────────────────────────────────────
 * Gateway
 * ────────────────────────────────────────────────────────────*/

/** Non-GSM/Unicode bodies must be flagged so the provider does not mangle them. */
function hasNonAscii(text: string): boolean {
  return Array.from(text).some((char) => (char.codePointAt(0) ?? 0) > 0x7f);
}

const PRE_CONNECT_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]);

function neverReachedProvider(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" && PRE_CONNECT_CODES.has(cause.code);
}

/** Build the BulkSMS Nigeria gateway. The credential gate runs FIRST, before any other work. */
export function createBulkSmsNigeriaGateway(
  config: BulkSmsNigeriaConfig | null,
  fetchImpl: FetchLike = fetch,
): SmsGateway {
  return {
    providerId: BULKSMS_NIGERIA_PROVIDER_ID,
    async send(command: SmsSendCommand): Promise<SmsSendResult> {
      if (config === null) {
        return {
          outcome: "undeliverable",
          code: "provider_not_configured",
          reason: `BLOCKED_NO_CREDENTIAL: BulkSMS Nigeria requires ${BULKSMS_NG_TOKEN_ENV} and ${BULKSMS_NG_SENDER_ENV}; no SMS was sent and no provider call was attempted`,
        };
      }

      const parsed = BulkSmsNigeriaPayloadSchema.safeParse({
        from: config.sender,
        to: command.recipient,
        body: command.body,
        ...(hasNonAscii(command.body) ? { unicode: true } : {}),
        ...(config.webhook
          ? { callback_url: bulkSmsCallbackUrl(config.webhook, command.messageId) }
          : {}),
      });
      if (!parsed.success) {
        return {
          outcome: "failed",
          code: "invalid_payload",
          reason: `Outbound SMS was rejected by local contract validation (no provider call was attempted): ${parsed.error.issues
            .map((issue) => issue.path.join("."))
            .join(", ")}`,
          retryable: false,
        };
      }

      let response: Response;
      try {
        response = await fetchImpl(BULKSMS_NG_SEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(parsed.data),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const safe = neverReachedProvider(error);
        return {
          outcome: "failed",
          code: "provider_unreachable",
          reason: safe
            ? "The SMS provider could not be reached; the request never left Sherivs"
            : "The SMS provider did not answer; delivery state is unknown so the send is not retried",
          retryable: safe,
        };
      }

      const payload: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        const rawCode = (payload as { error?: { code?: unknown } } | null)?.error?.code;
        const providerCode =
          typeof rawCode === "string" && /^BSNG-[0-9]{4}$/.test(rawCode) ? ` ${rawCode}` : "";
        if (response.status === 401 || response.status === 403) {
          return {
            outcome: "failed",
            code: "provider_auth_failed",
            reason: `The SMS provider refused the credentials (http ${response.status}); nothing was sent`,
            retryable: false,
          };
        }
        if (response.status === 409) {
          return {
            outcome: "failed",
            code: "provider_duplicate",
            reason: `The SMS provider suppressed a duplicate message${providerCode} (http 409)`,
            retryable: false,
          };
        }
        const notProcessed = response.status === 429 || response.status === 503;
        return {
          outcome: "failed",
          code: response.status >= 500 ? "provider_error" : "provider_rejected",
          reason: `The SMS provider refused the send${providerCode} (http ${response.status})${notProcessed ? "" : "; delivery state is not retried"}`,
          retryable: notProcessed,
        };
      }

      const success = SuccessResponseSchema.safeParse(payload);
      if (!success.success) {
        return {
          outcome: "failed",
          code: "provider_response_invalid",
          reason: "The SMS provider answered without a usable message id; delivery is NOT asserted",
          retryable: false,
        };
      }
      return {
        outcome: "sent",
        providerMessageId: String(success.data.data.message_id),
        confirmedAt: timeAuthority.now().at,
      };
    },
  };
}
