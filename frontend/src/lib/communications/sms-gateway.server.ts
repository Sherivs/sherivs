/**
 * Sherivs — SMS provider selection (COMMS-03, ADR-112; unified in M22, ADR-151). Server only.
 *
 * This is the ONE place an SMS provider is chosen, for every SMS Sherivs sends: the tenant fabric
 * dispatcher (`sms-fabric.server.ts`) and the platform owner alerts
 * (`jarvis-bridge/owner-alert-sender.server.ts`). `SMS_PROVIDER` names the provider. Selection is
 * explicit and fails closed: an unset, unknown or unconfigured provider yields a typed refusal and
 * nothing is sent. The ambiguous value `bulksms` is refused, because which BulkSMS company the
 * founder contracted is UNVERIFIED; the operator must name `bulksmsnigeria` or `bulksmscom`.
 *
 * The Twilio SMS module (`twilio-sms.server.ts`) is NOT selectable and has no caller; a guard test
 * (`tests/unit/communications/m22-one-implementation-per-channel.test.ts`) keeps it that way.
 */
import {
  BULKSMS_COM_PROVIDER_ID,
  bulkSmsComConfigFromEnv,
  createBulkSmsComGateway,
  missingBulkSmsComEnvVars,
} from "./bulksms-com.server";
import {
  BULKSMS_NIGERIA_PROVIDER_ID,
  bulkSmsNigeriaConfigFromEnv,
  createBulkSmsNigeriaGateway,
  missingBulkSmsNigeriaEnvVars,
  type FetchLike,
  type ServerEnv,
} from "./bulksms-nigeria.server";
import { SMS_PROVIDER_ENV, type SmsGatewaySelection } from "./sms-gateway-contract";

export const SUPPORTED_SMS_PROVIDERS = [
  BULKSMS_NIGERIA_PROVIDER_ID,
  BULKSMS_COM_PROVIDER_ID,
] as const;

function notConfigured(label: string, missing: readonly string[]): SmsGatewaySelection {
  return {
    ok: false,
    code: "provider_not_configured",
    reason: `${label} is not configured${missing.length > 0 ? `: missing ${missing.join(", ")}` : ": a credential is malformed"}; no provider call was attempted`,
  };
}

export function selectSmsGateway(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): SmsGatewaySelection {
  const selected = env[SMS_PROVIDER_ENV]?.trim().toLowerCase();
  if (!selected) {
    return {
      ok: false,
      code: "provider_not_selected",
      reason: `${SMS_PROVIDER_ENV} is not set; no SMS provider is selected and nothing was sent`,
    };
  }
  if (selected === BULKSMS_NIGERIA_PROVIDER_ID) {
    const config = bulkSmsNigeriaConfigFromEnv(env);
    if (!config) return notConfigured("BulkSMS Nigeria", missingBulkSmsNigeriaEnvVars(env));
    return { ok: true, gateway: createBulkSmsNigeriaGateway(config, fetchImpl) };
  }
  if (selected === BULKSMS_COM_PROVIDER_ID) {
    const config = bulkSmsComConfigFromEnv(env);
    if (!config) return notConfigured("BulkSMS.com", missingBulkSmsComEnvVars(env));
    return { ok: true, gateway: createBulkSmsComGateway(config, fetchImpl) };
  }
  return {
    ok: false,
    code: "unsupported_provider",
    reason: `${SMS_PROVIDER_ENV} must be one of: ${SUPPORTED_SMS_PROVIDERS.join(", ")}`,
  };
}
