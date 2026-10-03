/**
 * CoreGrid — Twilio voice adapter (V1-009, team COMMS).
 *
 * The concrete Twilio implementation of the provider-agnostic
 * `TelephonyAdapter` contract (`communications/telephony-adapter-contract.ts`).
 * It wraps the exact voice-gateway interaction the scholar digital-twin call
 * site performs today (`runtime/scholar/digital-twin.functions.ts`): same
 * credential precedence, same endpoint resolution, same bounded response
 * contract — so the call site can move behind this adapter without any
 * behavior change when credentials exist.
 *
 * Fail-closed credential law (battery discipline, exit-2 semantics):
 * - Credentials come from the environment only — `AI_API_KEY` (fallback
 *   `TWILIO_API_KEY`) as the voice-gateway bearer, `TWILIO_API_KEY` as the
 *   connection key, `TWILIO_FROM_NUMBER` as the caller id; `TWILIO_GATEWAY_URL`
 *   overrides the gateway base. Never hardcoded, never logged (§30).
 * - On missing credentials `twilioVoiceConfigFromEnv` yields null and the
 *   adapter resolves to the typed blocked result
 *   `undeliverable("provider_not_configured")` naming the required
 *   environment variables (never their values) and stating that no provider
 *   call was attempted. It NEVER fakes a call and NEVER fabricates a receipt.
 * - Secret values never appear in any reason string, log, or result.
 *
 * Provider output is untrusted by default (§21): the response is parsed
 * through a bounded Zod contract and only the consumed fields survive.
 * A call is non-idempotent: the transport performs a SINGLE attempt and
 * retries belong to the calling pipeline (signalled via `retryable`:
 * 408/429/5xx retryable, other 4xx not).
 */

import { z } from "zod";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import {
  DEFAULT_TELEPHONY_FAILURE_POLICY,
  evaluateTelephonyPreCall,
  withTelephonyFailurePolicy,
  type TelephonyAdapter,
  type TelephonyCallResult,
  type TelephonyProviderRegistry,
} from "./telephony-adapter-contract";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/** Registry provider id under which the Twilio voice adapter is configured. */
export const TWILIO_VOICE_PROVIDER_ID = "twilio";

/** Environment variable names this adapter reads (names only, §30). */
export const TWILIO_GATEWAY_URL_ENV = "TWILIO_GATEWAY_URL";
export const TWILIO_API_KEY_ENV = "TWILIO_API_KEY";
export const TWILIO_FROM_NUMBER_ENV = "TWILIO_FROM_NUMBER";
export const TWILIO_GATEWAY_BEARER_FALLBACK_ENV = "AI_API_KEY";

/** Default gateway base — the same default the existing call site resolves. */
export const DEFAULT_TWILIO_GATEWAY_URL = "https://api.twilio.com/2010-04-01";

/** The credential reference the registry exposes — a pointer, never a value. */
export const TWILIO_CREDENTIAL_REFERENCE = `env://${TWILIO_API_KEY_ENV}`;

/** Read-only view over the server environment (never a secret carrier). */
export type ServerEnv = Record<string, string | undefined>;

/**
 * Resolved configuration facts for one Twilio voice adapter. Secret VALUES
 * are carried here only in server memory; they never enter logs, results,
 * or the registry.
 */
export interface TwilioVoiceConfig {
  gatewayUrl: string;
  /** Bearer credential for the voice gateway (AI_API_KEY, fallback TWILIO_API_KEY). */
  gatewayKey: string;
  /** Connection API key (TWILIO_API_KEY). */
  connectionKey: string;
  /** Caller id (TWILIO_FROM_NUMBER). */
  fromNumber: string;
}

/**
 * Environment-derived configuration, mirroring the existing call site's
 * credential precedence exactly. Returns null when ANY required credential
 * is absent — the adapter's fail-closed signal.
 */
export function twilioVoiceConfigFromEnv(env: ServerEnv): TwilioVoiceConfig | null {
  const gatewayKey = env[TWILIO_GATEWAY_BEARER_FALLBACK_ENV] || env[TWILIO_API_KEY_ENV];
  const connectionKey = env[TWILIO_API_KEY_ENV];
  const fromNumber = env[TWILIO_FROM_NUMBER_ENV];
  if (!gatewayKey || !connectionKey || !fromNumber) return null;
  return {
    gatewayUrl: env[TWILIO_GATEWAY_URL_ENV] || DEFAULT_TWILIO_GATEWAY_URL,
    gatewayKey,
    connectionKey,
    fromNumber,
  };
}

/** Environment-backed `TelephonyProviderRegistry` for Twilio. */
export function createTwilioVoiceProviderRegistry(env: ServerEnv): TelephonyProviderRegistry {
  return {
    isProviderConfigured: (providerId: string): boolean =>
      providerId === TWILIO_VOICE_PROVIDER_ID && twilioVoiceConfigFromEnv(env) !== null,
    credentialReferenceFor: (providerId: string): string | null =>
      providerId === TWILIO_VOICE_PROVIDER_ID ? TWILIO_CREDENTIAL_REFERENCE : null,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Untrusted provider output (§21) — bounded to the consumed fields
 * ────────────────────────────────────────────────────────────*/

export const TwilioVoiceCallResponseSchema = z.object({
  sid: z.string().trim().min(1).max(64).optional(),
  message: z.string().trim().max(500).optional(),
});

/* ─────────────────────────────────────────────────────────────
 * The adapter
 * ────────────────────────────────────────────────────────────*/

/**
 * Build the Twilio voice adapter. A null config yields an adapter that is
 * permanently fail-closed (the typed BLOCKED_NO_CREDENTIAL result, zero
 * network contact); a present config yields the real gateway call. The raw
 * adapter is wrapped by `withTelephonyFailurePolicy(
 * DEFAULT_TELEPHONY_FAILURE_POLICY)` so a hung or throwing transport is
 * contained as a structured failure.
 */
export function createTwilioVoiceAdapter(config: TwilioVoiceConfig | null): TelephonyAdapter {
  const raw: TelephonyAdapter = {
    providerId: TWILIO_VOICE_PROVIDER_ID,

    async placeCall(command, registry): Promise<TelephonyCallResult> {
      // Credential gate FIRST — before any other work, before any provider
      // contact (the adapter equivalent of the drills' exit-2 gate order).
      // Even if a registry lies, a null local configuration can never reach
      // the network.
      if (config === null) {
        return {
          outcome: "undeliverable",
          code: "provider_not_configured",
          reason: `BLOCKED_NO_CREDENTIAL: no usable Twilio voice configuration (requires ${TWILIO_GATEWAY_BEARER_FALLBACK_ENV} or ${TWILIO_API_KEY_ENV} as the gateway credential, ${TWILIO_API_KEY_ENV} as the connection credential, and ${TWILIO_FROM_NUMBER_ENV} as the caller id); no provider call was attempted`,
        };
      }

      const preCall = evaluateTelephonyPreCall(command, registry, TWILIO_VOICE_PROVIDER_ID);
      if (preCall) return preCall;

      const twiml = `<Response><Say voice="alice">${command.script
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</Say></Response>`;

      let response: Response;
      try {
        response = await fetch(`${config.gatewayUrl}/Calls.json`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.gatewayKey}`,
            "X-Connection-Api-Key": config.connectionKey,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: command.recipientPhone,
            From: config.fromNumber,
            Twiml: twiml,
          }),
        });
      } catch (err) {
        return {
          outcome: "failed",
          code: "provider_error",
          reason: `Twilio voice call could not reach the voice gateway: ${err instanceof Error ? err.message : String(err)}`,
          retryable: true,
          httpStatus: null,
        };
      }

      const parsed = TwilioVoiceCallResponseSchema.safeParse(
        await response.json().catch(() => ({})),
      );
      const body = parsed.success ? parsed.data : {};

      if (!response.ok) {
        const retryable =
          response.status === 408 || response.status === 429 || response.status >= 500;
        return {
          outcome: "failed",
          code: "provider_error",
          reason: body.message ?? `twilio_${response.status}`,
          retryable,
          httpStatus: response.status,
        };
      }

      return {
        callId: body.sid ?? null,
        providerId: TWILIO_VOICE_PROVIDER_ID,
        status: "queued",
        placedAt: timeAuthority.now().at,
      };
    },
  };

  return withTelephonyFailurePolicy(raw, DEFAULT_TELEPHONY_FAILURE_POLICY);
}
