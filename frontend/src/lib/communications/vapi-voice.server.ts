/**
 * CoreGrid — Vapi voice adapter stub (V1-009, team COMMS).
 *
 * The Vapi implementation of the `TelephonyAdapter` contract, shipped in V1
 * as a CREDENTIAL-GATED STUB: the contract, the env credential gate and the
 * fail-closed semantics are real; the live call path is NOT (no Vapi
 * endpoint is contacted by this module in any state).
 *
 * Fail-closed credential law (battery discipline, exit-2 semantics):
 * - The credential comes from the environment only (`VAPI_API_KEY`) — never
 *   hardcoded, never logged (§30).
 * - Missing `VAPI_API_KEY` → typed blocked result
 *   `undeliverable("provider_not_configured")` naming the environment
 *   variable and stating that no provider call was attempted. Never a fake
 *   send, never a fabricated receipt, never a thrown silent success.
 * - Present `VAPI_API_KEY` → `undeliverable("provider_not_live")`: V1
 *   declares the provider and gates the credential but does not implement
 *   the live call path. A stub must never mistake itself for a delivery —
 *   the blocked result is explicit even when a credential exists.
 * - Secret values never appear in any reason string, log, or result.
 */

import {
  DEFAULT_TELEPHONY_FAILURE_POLICY,
  evaluateTelephonyPreCall,
  withTelephonyFailurePolicy,
  type TelephonyAdapter,
  type TelephonyCallResult,
  type TelephonyProviderRegistry,
} from "./telephony-adapter-contract";

/** Registry provider id under which the Vapi adapter is configured. */
export const VAPI_VOICE_PROVIDER_ID = "vapi";

/** Environment variable holding the Vapi credential (name only, §30). */
export const VAPI_API_KEY_ENV = "VAPI_API_KEY";

/** The credential reference the registry exposes — a pointer, never a value. */
export const VAPI_CREDENTIAL_REFERENCE = `env://${VAPI_API_KEY_ENV}`;

/** Read-only view over the server environment (never a secret carrier). */
export type ServerEnv = Record<string, string | undefined>;

function isNonBlank(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface VapiVoiceConfig {
  apiKey: string | null;
}

export function vapiVoiceConfigFromEnv(env: ServerEnv): VapiVoiceConfig {
  return {
    apiKey: isNonBlank(env[VAPI_API_KEY_ENV]) ? (env[VAPI_API_KEY_ENV] as string) : null,
  };
}

/** Environment-backed `TelephonyProviderRegistry` for Vapi. */
export function createVapiVoiceProviderRegistry(env: ServerEnv): TelephonyProviderRegistry {
  return {
    isProviderConfigured: (providerId: string): boolean =>
      providerId === VAPI_VOICE_PROVIDER_ID && vapiVoiceConfigFromEnv(env).apiKey !== null,
    credentialReferenceFor: (providerId: string): string | null =>
      providerId === VAPI_VOICE_PROVIDER_ID ? VAPI_CREDENTIAL_REFERENCE : null,
  };
}

/**
 * Build the Vapi voice adapter stub. J-045-composed like the real adapters
 * so its observability posture matches, though its `placeCall` never
 * performs network I/O in any credential state.
 */
export function createVapiVoiceAdapter(config: VapiVoiceConfig): TelephonyAdapter {
  const raw: TelephonyAdapter = {
    providerId: VAPI_VOICE_PROVIDER_ID,

    async placeCall(command, registry): Promise<TelephonyCallResult> {
      // Credential gate FIRST (see twilio-voice.server.ts for the gate order).
      if (config.apiKey === null) {
        return {
          outcome: "undeliverable",
          code: "provider_not_configured",
          reason: `BLOCKED_NO_CREDENTIAL: ${VAPI_API_KEY_ENV} is not set; no voice call was placed and no provider call was attempted`,
        };
      }

      const preCall = evaluateTelephonyPreCall(command, registry, VAPI_VOICE_PROVIDER_ID);
      if (preCall) return preCall;

      return {
        outcome: "undeliverable",
        code: "provider_not_live",
        reason: `NOT_FOR_LIVE_USE: the Vapi voice adapter is a credential-gated stub in V1 — ${VAPI_API_KEY_ENV} is present, but no live call path is implemented and no provider call was attempted`,
      };
    },
  };

  return withTelephonyFailurePolicy(raw, DEFAULT_TELEPHONY_FAILURE_POLICY);
}
