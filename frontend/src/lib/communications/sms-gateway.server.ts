/**
 * Sherivs — SMS provider selection (COMMS-03, ADR-069). Server only.
 *
 * `SMS_PROVIDER` names the provider the fabric dispatcher uses. Selection is explicit and
 * fails closed: an unset, unknown or unconfigured provider yields a typed refusal and the
 * dispatcher sends nothing. The registry below is the only place a new provider is added.
 *
 * Only `bulksmsnigeria` is implemented. That is the provider id the database fabric
 * (`comms_send`) already stamps on queued SMS rows. The Twilio SMS adapter
 * (`twilio-sms.server.ts`) is untouched and is not part of this selection.
 */
import {
  BULKSMS_NIGERIA_PROVIDER_ID,
  bulkSmsNigeriaConfigFromEnv,
  createBulkSmsNigeriaGateway,
  missingBulkSmsNigeriaEnvVars,
  type FetchLike,
  type ServerEnv,
} from "./bulksms-nigeria.server";
import { SMS_PROVIDER_ENV, type SmsGatewaySelection } from "./sms-gateway-contract";

export const SUPPORTED_SMS_PROVIDERS = [BULKSMS_NIGERIA_PROVIDER_ID] as const;

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
  if (selected !== BULKSMS_NIGERIA_PROVIDER_ID) {
    return {
      ok: false,
      code: "unsupported_provider",
      reason: `${SMS_PROVIDER_ENV} must be one of: ${SUPPORTED_SMS_PROVIDERS.join(", ")}`,
    };
  }
  const config = bulkSmsNigeriaConfigFromEnv(env);
  if (!config) {
    const missing = missingBulkSmsNigeriaEnvVars(env);
    return {
      ok: false,
      code: "provider_not_configured",
      reason: `BulkSMS Nigeria is not configured${missing.length > 0 ? `: missing ${missing.join(", ")}` : ": a credential is malformed"}; no provider call was attempted`,
    };
  }
  return { ok: true, gateway: createBulkSmsNigeriaGateway(config, fetchImpl) };
}
