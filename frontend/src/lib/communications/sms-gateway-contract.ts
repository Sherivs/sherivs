/**
 * Sherivs — SMS gateway port (COMMS-03).
 *
 * Sherivs owns communication INTENT (who may be texted, what is said, consent,
 * metering, audit). An SMS provider is an ADAPTER behind this port (Constitution
 * §24/§25): the fabric dispatcher depends on this contract, never on a vendor.
 *
 * Laws honoured here:
 * - The command carries NO caller-chosen recipient. `recipient` is produced by the
 *   fabric's server-side resolution of an approved, queued `outbound_messages` row.
 * - Results are a typed union. A missing credential is `undeliverable`, never a
 *   faked send and never a fabricated receipt (fail closed).
 * - Reason strings carry codes and HTTP statuses only — never credential values.
 */

/** Environment variable that selects the SMS provider for the fabric. Name only (§30). */
export const SMS_PROVIDER_ENV = "SMS_PROVIDER";

export interface SmsSendCommand {
  /** The queued `outbound_messages.id` — the correlation key for delivery receipts. */
  messageId: string;
  /** Recipient already resolved and normalised server-side (digits, international form). */
  recipient: string;
  /** Message body, already template-rendered by the database fabric. */
  body: string;
}

export type SmsFailureCode =
  | "invalid_payload"
  | "provider_unreachable"
  | "provider_auth_failed"
  | "provider_rejected"
  | "provider_duplicate"
  | "provider_error"
  | "provider_response_invalid";

export type SmsSendResult =
  | { outcome: "sent"; providerMessageId: string; confirmedAt: string }
  | { outcome: "failed"; code: SmsFailureCode; reason: string; retryable: boolean }
  | { outcome: "undeliverable"; code: "provider_not_configured"; reason: string };

export interface SmsGateway {
  /** Registry provider id, stamped on `outbound_messages.provider`. */
  readonly providerId: string;
  /** Exactly one provider attempt per call; retries belong to the dispatcher. */
  send(command: SmsSendCommand): Promise<SmsSendResult>;
}

export type SmsGatewaySelection =
  | { ok: true; gateway: SmsGateway }
  | {
      ok: false;
      code: "provider_not_selected" | "unsupported_provider" | "provider_not_configured";
      reason: string;
    };
