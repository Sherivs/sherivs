/**
 * Sherivs — BulkSMS.com SMS adapter (M22, ADR-120). Server only.
 *
 * The second concrete provider behind the ONE SMS gateway port (`sms-gateway-contract.ts`).
 * It replaces the owner-alert-only sender that lived in `jarvis-bridge/owner-alert-bulksms.server.ts`
 * (JARVIS-LIVE-01): the same endpoint, the same credential names, now with the port's typed result
 * and the port's at-most-once failure classification, so every SMS in Sherivs (tenant fabric and
 * platform owner alerts) is sent by exactly one implementation chosen by `SMS_PROVIDER`.
 *
 * Which BulkSMS company the founder contracted is UNVERIFIED (BulkSMS Nigeria vs BulkSMS.com), so
 * both adapters stay behind the port and the provider is chosen by configuration only. The ambiguous
 * value `bulksms` is refused by the selector on purpose.
 *
 * API as already used by JARVIS-LIVE-01 (not re-verified against live provider docs in M22):
 *   POST https://api.bulksms.com/v1/messages   HTTP Basic (token id : token secret), JSON
 *   body: { to, body, from? }   success: 2xx with an array of message objects carrying `id`.
 *
 * Laws honoured (same as the BulkSMS Nigeria adapter):
 * - Fail closed: without BULKSMS_TOKEN_ID and BULKSMS_TOKEN_SECRET the gateway returns the typed
 *   `undeliverable` result BEFORE any network contact. Never fakes a send or a receipt.
 * - At-most-once: one attempt per call. Retryable only when the provider provably did not process
 *   the request (429/503, or a connection that never left Sherivs). Everything ambiguous is terminal.
 * - Credential values never appear in a result or a reason; only variable names do.
 * - No delivery-report webhook is implemented for this provider (none was built before M22).
 */
import { z } from "zod";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import type { SmsGateway, SmsSendCommand, SmsSendResult } from "./sms-gateway-contract";

const timeAuthority = new TimeAuthority(new SystemClock());

/** Registry provider id (value of SMS_PROVIDER, stamped on claimed rows). */
export const BULKSMS_COM_PROVIDER_ID = "bulksmscom";

/** Environment variable names (unchanged from JARVIS-LIVE-01 so existing configuration keeps working). */
export const BULKSMS_TOKEN_ID_ENV = "BULKSMS_TOKEN_ID";
export const BULKSMS_TOKEN_SECRET_ENV = "BULKSMS_TOKEN_SECRET";
export const BULKSMS_SENDER_ENV = "BULKSMS_SENDER";

/** The single endpoint this adapter may contact. Fixed in code, never env-derived. */
export const BULKSMS_COM_SEND_ENDPOINT = "https://api.bulksms.com/v1/messages";
const BODY_MAX = 600;
const REQUEST_TIMEOUT_MS = 15_000;

type Env = Record<string, string | undefined>;

export interface BulkSmsComConfig {
  tokenId: string;
  tokenSecret: string;
  sender: string | null;
}

const clean = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export function missingBulkSmsComEnvVars(env: Env): readonly string[] {
  return [BULKSMS_TOKEN_ID_ENV, BULKSMS_TOKEN_SECRET_ENV].filter((n) => clean(env[n]) === null);
}

/** Null when a required credential is absent or out of bounds: the fail-closed signal. */
export function bulkSmsComConfigFromEnv(env: Env): BulkSmsComConfig | null {
  const tokenId = clean(env[BULKSMS_TOKEN_ID_ENV]);
  const tokenSecret = clean(env[BULKSMS_TOKEN_SECRET_ENV]);
  if (!tokenId || !tokenSecret || tokenId.length > 200 || tokenSecret.length > 400) return null;
  const sender = clean(env[BULKSMS_SENDER_ENV]);
  return {
    tokenId,
    tokenSecret,
    sender: sender && /^[A-Za-z0-9 ]{1,11}$|^\+?[0-9]{3,15}$/.test(sender) ? sender : null,
  };
}

const PayloadSchema = z.strictObject({
  to: z.string().regex(/^\+?[1-9][0-9]{9,14}$/),
  body: z.string().min(1).max(BODY_MAX),
  from: z.string().optional(),
});

const SuccessSchema = z
  .array(z.object({ id: z.union([z.string().trim().min(1).max(120), z.number()]) }))
  .min(1);

const PRE_CONNECT_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]);
function neverReachedProvider(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" && PRE_CONNECT_CODES.has(cause.code);
}

export function createBulkSmsComGateway(
  config: BulkSmsComConfig | null,
  fetchImpl: typeof fetch = fetch,
): SmsGateway {
  return {
    providerId: BULKSMS_COM_PROVIDER_ID,
    async send(command: SmsSendCommand): Promise<SmsSendResult> {
      if (config === null) {
        return {
          outcome: "undeliverable",
          code: "provider_not_configured",
          reason: `BLOCKED_NO_CREDENTIAL: BulkSMS.com requires ${BULKSMS_TOKEN_ID_ENV} and ${BULKSMS_TOKEN_SECRET_ENV}; no SMS was sent and no provider call was attempted`,
        };
      }
      const recipient = /^\+/.test(command.recipient) ? command.recipient : `+${command.recipient}`;
      const parsed = PayloadSchema.safeParse({
        to: recipient,
        body: command.body,
        ...(config.sender ? { from: config.sender } : {}),
      });
      if (!parsed.success) {
        return {
          outcome: "failed",
          code: "invalid_payload",
          reason: `Outbound SMS was rejected by local contract validation (no provider call was attempted): ${parsed.error.issues
            .map((i) => i.path.join("."))
            .join(", ")}`,
          retryable: false,
        };
      }
      let response: Response;
      try {
        response = await fetchImpl(BULKSMS_COM_SEND_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Basic ${Buffer.from(`${config.tokenId}:${config.tokenSecret}`).toString("base64")}`,
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
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return {
            outcome: "failed",
            code: "provider_auth_failed",
            reason: `The SMS provider refused the credentials (http ${response.status}); nothing was sent`,
            retryable: false,
          };
        }
        const notProcessed = response.status === 429 || response.status === 503;
        return {
          outcome: "failed",
          code: response.status >= 500 ? "provider_error" : "provider_rejected",
          reason: `The SMS provider refused the send (http ${response.status})`,
          retryable: notProcessed,
        };
      }
      const body: unknown = await response.json().catch(() => null);
      const success = SuccessSchema.safeParse(body);
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
        providerMessageId: String(success.data[0].id).slice(0, 120),
        confirmedAt: timeAuthority.now().at,
      };
    },
  };
}
