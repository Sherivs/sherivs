/**
 * CoreGrid — Resend-backed email adapter (V1-009, team COMMS).
 *
 * The concrete Resend implementation of the provider-agnostic
 * `EmailAdapter` contract (`notifications/email-adapter-contract.ts`).
 * CoreGrid owns communication INTENT (recipient, authorization, channel,
 * message, delivery state, retries, evidence, audit); Resend is an ADAPTER
 * only (Constitution §24) reached through one bounded fetch here.
 *
 * Fail-closed credential law (battery discipline, exit-2 semantics):
 * - Credentials come from the environment only (`RESEND_API_KEY`,
 *   `RESEND_FROM_ADDRESS`) — never hardcoded, never logged (§30).
 * - On missing credentials the adapter resolves to the typed blocked result
 *   `undeliverable("provider_not_configured")` naming the missing
 *   environment variable and stating that no provider call was attempted.
 *   It NEVER fakes a send and NEVER fabricates a receipt.
 * - The credential is checked twice (registry pre-send gate + adapter-level
 *   recheck) so a lying registry still cannot reach the network.
 * - Secret values never appear in any reason string, log, or result — only
 *   environment variable NAMES do.
 *
 * Outbound message shapes are Zod-validated before any network contact
 * (§26). The transport performs a SINGLE attempt (a send is non-idempotent
 * in V1); retries belong to the notification pipeline, signalled through
 * the structured `retryable` flag (429/5xx retryable, other 4xx not).
 */

import { z } from "zod";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import { withEmailDeliveryEvidence, type DeliveryEvidenceSink } from "./delivery-evidence.server";
import {
  DEFAULT_EMAIL_FAILURE_POLICY,
  evaluateEmailPreSend,
  withEmailFailurePolicy,
  type EmailAdapter,
  type EmailDeliveryResult,
  type EmailProviderRegistry,
  type EmailSendCommand,
} from "../notifications/email-adapter-contract";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const sendTimeAuthority = new TimeAuthority(new SystemClock());

/** Registry provider id under which the Resend adapter is configured. */
export const RESEND_EMAIL_PROVIDER_ID = "resend";

/** Environment variable holding the Resend API credential (name only, §30). */
export const RESEND_API_KEY_ENV = "RESEND_API_KEY";
/** Environment variable holding the verified sender address. */
export const RESEND_FROM_ADDRESS_ENV = "RESEND_FROM_ADDRESS";

/** The single endpoint this adapter may contact. */
export const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

/** The credential reference the registry exposes — a pointer, never a value. */
export const RESEND_CREDENTIAL_REFERENCE = `env://${RESEND_API_KEY_ENV}`;

/** Read-only view over the server environment (never a secret carrier). */
export type ServerEnv = Record<string, string | undefined>;

function isNonBlank(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Environment-derived configuration facts for the Resend adapter. Null
 * fields mean "not configured" — the adapter fails closed on them.
 */
export interface ResendEmailConfig {
  apiKey: string | null;
  fromAddress: string | null;
}

export function resendEmailConfigFromEnv(env: ServerEnv): ResendEmailConfig {
  return {
    apiKey: isNonBlank(env[RESEND_API_KEY_ENV]) ? (env[RESEND_API_KEY_ENV] as string) : null,
    fromAddress: isNonBlank(env[RESEND_FROM_ADDRESS_ENV])
      ? (env[RESEND_FROM_ADDRESS_ENV] as string)
      : null,
  };
}

/**
 * Environment-backed `EmailProviderRegistry` for Resend. `isProviderConfigured`
 * evaluates the CURRENT environment at call time, so a credential provisioned
 * (or revoked) between calls is observed on the next send.
 */
export function createResendEmailProviderRegistry(env: ServerEnv): EmailProviderRegistry {
  return {
    isProviderConfigured: (providerId: string): boolean =>
      providerId === RESEND_EMAIL_PROVIDER_ID && isNonBlank(env[RESEND_API_KEY_ENV]),
    credentialReferenceFor: (providerId: string): string | null =>
      providerId === RESEND_EMAIL_PROVIDER_ID ? RESEND_CREDENTIAL_REFERENCE : null,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Outbound payload contract (Zod — §26, §32)
 * ────────────────────────────────────────────────────────────*/

export const RESEND_EMAIL_PAYLOAD_MAX = {
  address: 254,
  subject: 500,
  text: 100_000,
} as const;

const EMAIL_ADDRESS_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The exact JSON body this adapter sends to Resend — bounded and validated. */
export const ResendEmailPayloadSchema = z.strictObject({
  from: z.string().trim().min(3).max(RESEND_EMAIL_PAYLOAD_MAX.address),
  to: z
    .string()
    .trim()
    .min(3)
    .max(RESEND_EMAIL_PAYLOAD_MAX.address)
    .regex(EMAIL_ADDRESS_SHAPE, "recipient address must be a bare email address"),
  subject: z.string().max(RESEND_EMAIL_PAYLOAD_MAX.subject),
  text: z.string().min(1).max(RESEND_EMAIL_PAYLOAD_MAX.text),
});

/** Untrusted provider output is minimized to the one field this adapter consumes. */
export const ResendEmailResponseSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

/* ─────────────────────────────────────────────────────────────
 * The adapter
 * ────────────────────────────────────────────────────────────*/

/**
 * Build the Resend email adapter. Returns a J-045-composed adapter: the raw
 * fetch is wrapped by `withEmailFailurePolicy(DEFAULT_EMAIL_FAILURE_POLICY)`
 * so a hung or throwing transport is contained as a structured failure.
 *
 * `evidence` (optional): a `DeliveryEvidenceSink` — when present, EVERY send
 * attempt (receipt, structured failure, or typed BLOCKED_NO_CREDENTIAL
 * block) records one append-only delivery-evidence row, non-fatally. Pass
 * null/omit when no substrate is configured: the send result stays exactly
 * as typed.
 */
export function createResendEmailAdapter(config: ResendEmailConfig, evidence: DeliveryEvidenceSink | null = null): EmailAdapter {
  const raw: EmailAdapter = {
    providerId: RESEND_EMAIL_PROVIDER_ID,

    async send(
      command: EmailSendCommand,
      registry: EmailProviderRegistry,
    ): Promise<EmailDeliveryResult> {
      // Credential gate FIRST — before any other work, before any provider
      // contact (the adapter equivalent of the drills' exit-2 gate order).
      if (!isNonBlank(config.apiKey)) {
        return {
          outcome: "undeliverable",
          code: "provider_not_configured",
          reason: `BLOCKED_NO_CREDENTIAL: ${RESEND_API_KEY_ENV} is not set; no email was sent and no provider call was attempted`,
        };
      }
      if (!isNonBlank(config.fromAddress)) {
        return {
          outcome: "undeliverable",
          code: "provider_not_configured",
          reason: `BLOCKED_NO_CREDENTIAL: ${RESEND_FROM_ADDRESS_ENV} is not set; a verified sender address is required before any email is sent`,
        };
      }

      // Fail-closed pre-send gate (category policy, recipient, registry).
      const registryGate = evaluateEmailPreSend(command, registry, RESEND_EMAIL_PROVIDER_ID);
      if (registryGate) return registryGate;

      const payload = {
        from: config.fromAddress as string,
        to: command.recipientAddress,
        subject: command.subject,
        text: command.body,
      };
      const parsedPayload = ResendEmailPayloadSchema.safeParse(payload);
      if (!parsedPayload.success) {
        return {
          outcome: "failed",
          code: "provider_error",
          reason: `Outbound email payload for notification ${command.notification.id} was rejected by local contract validation (no provider call was attempted): ${parsedPayload.error.issues
            .map((issue) => issue.path.join("."))
            .join(", ")}`,
          retryable: false,
        };
      }

      let response: Response;
      try {
        response = await fetch(RESEND_EMAIL_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey as string}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(parsedPayload.data),
        });
      } catch (err) {
        return {
          outcome: "failed",
          code: "provider_error",
          reason: `Email delivery for notification ${command.notification.id} could not reach the email provider: ${err instanceof Error ? err.message : String(err)}`,
          retryable: true,
        };
      }

      if (!response.ok) {
        const retryable =
          response.status === 408 || response.status === 429 || response.status >= 500;
        return {
          outcome: "failed",
          code: "provider_error",
          reason: `Email provider refused the send for notification ${command.notification.id} (http ${response.status}); the credential value is never logged`,
          retryable,
        };
      }

      const parsedBody = ResendEmailResponseSchema.safeParse(
        await response.json().catch(() => ({})),
      );
      if (!parsedBody.success) {
        return {
          outcome: "failed",
          code: "provider_error",
          reason: `Email provider accepted the send for notification ${command.notification.id} but returned no usable message id; delivery is NOT asserted`,
          retryable: false,
        };
      }

      return {
        notificationId: command.notification.id,
        channel: "email",
        providerId: RESEND_EMAIL_PROVIDER_ID,
        providerMessageId: parsedBody.data.id,
        confirmedAt: sendTimeAuthority.now().at,
      };
    },
  };

  // Evidence wraps OUTSIDE the failure policy so the recorded row reflects
  // the attempt's FINAL typed outcome — including a transport failure the
  // policy contained as a structured failure.
  return withEmailDeliveryEvidence(withEmailFailurePolicy(raw, DEFAULT_EMAIL_FAILURE_POLICY), evidence);
}
