import { z } from "zod";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import {
  AFRICAS_TALKING_API_KEY_ENV,
  AFRICAS_TALKING_PROVIDER_ID,
  AFRICAS_TALKING_USERNAME_ENV,
  africaTalkingVoiceConfigFromEnv,
  type AfricaTalkingVoiceConfig,
  type VoiceServerEnv,
} from "./africas-talking-voice.server";
import {
  DEFAULT_TELEPHONY_FAILURE_POLICY,
  evaluateTelephonyPreCall,
  withTelephonyFailurePolicy,
  type TelephonyAdapter,
  type TelephonyCallResult,
  type TelephonyProviderRegistry,
} from "./telephony-adapter-contract";
import {
  withTelephonyDeliveryEvidence,
  type DeliveryEvidenceSink,
} from "./delivery-evidence.server";

const timeAuthority = new TimeAuthority(new SystemClock());
const AFRICAS_TALKING_CALL_URL = "https://voice.africastalking.com/call";
const ProviderResponse = z.object({
  entries: z.array(
    z.object({
      sessionId: z.string().trim().min(1).max(160),
      status: z.string().trim().min(1).max(80),
    }),
  ),
});

export function createAfricaTalkingVoiceProviderRegistry(
  env: VoiceServerEnv,
): TelephonyProviderRegistry {
  const configured = africaTalkingVoiceConfigFromEnv(env) !== null;
  return {
    isProviderConfigured: (providerId) => providerId === AFRICAS_TALKING_PROVIDER_ID && configured,
    credentialReferenceFor: (providerId) =>
      providerId === AFRICAS_TALKING_PROVIDER_ID ? `env://${AFRICAS_TALKING_API_KEY_ENV}` : null,
  };
}

export function createAfricaTalkingVoiceAdapter(options: {
  config: AfricaTalkingVoiceConfig | null;
  fromNumber: string;
  callId: string;
  fetcher?: typeof fetch;
  evidence?: DeliveryEvidenceSink | null;
}): TelephonyAdapter {
  const { config, fromNumber, callId, evidence = null } = options;
  const fetcher = options.fetcher ?? fetch;
  const raw: TelephonyAdapter = {
    providerId: AFRICAS_TALKING_PROVIDER_ID,
    async placeCall(command, registry): Promise<TelephonyCallResult> {
      if (config === null) {
        return {
          outcome: "undeliverable",
          code: "provider_not_configured",
          reason: `BLOCKED_NO_CREDENTIAL: ${AFRICAS_TALKING_API_KEY_ENV}, ${AFRICAS_TALKING_USERNAME_ENV}, and the phase-1 callback configuration are required; no call was attempted`,
        };
      }

      const preCall = evaluateTelephonyPreCall(command, registry, AFRICAS_TALKING_PROVIDER_ID);
      if (preCall) return preCall;

      const callbackUrl = new URL(config.callbackUrl);
      callbackUrl.searchParams.set("call_id", callId);
      try {
        const response = await fetcher(AFRICAS_TALKING_CALL_URL, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            apikey: config.apiKey,
          },
          body: new URLSearchParams({
            username: config.username,
            from: fromNumber,
            to: command.recipientPhone,
            callbackUrl: callbackUrl.toString(),
            clientRequestId: callId,
          }),
        });
        const payload = await response.json().catch(() => null);
        const parsed = ProviderResponse.safeParse(payload);
        const entry = parsed.success ? parsed.data.entries[0] : undefined;
        if (!response.ok || !entry || !/^queued$/i.test(entry.status)) {
          const retryable =
            response.status === 408 || response.status === 429 || response.status >= 500;
          return {
            outcome: "failed",
            code: "provider_error",
            reason: "Africa’s Talking did not accept the voice call.",
            retryable,
            httpStatus: response.status || null,
          };
        }
        return {
          callId: entry.sessionId,
          providerId: AFRICAS_TALKING_PROVIDER_ID,
          status: entry.status,
          placedAt: timeAuthority.now().at,
        };
      } catch {
        return {
          outcome: "failed",
          code: "provider_error",
          reason: "Africa’s Talking voice call request failed.",
          retryable: true,
          httpStatus: null,
        };
      }
    },
  };

  return withTelephonyDeliveryEvidence(
    withTelephonyFailurePolicy(raw, DEFAULT_TELEPHONY_FAILURE_POLICY),
    evidence,
  );
}
