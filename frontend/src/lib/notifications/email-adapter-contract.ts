/**
 * CoreGrid — Email adapter contract (V5.3 Part 20).
 *
 * Pure provider-agnostic contract for email sending, plus a record-only stub
 * adapter. NO implementation and NO network I/O lives here: concrete providers
 * (Resend, SMTP relay, SendGrid, …) plug in behind `EmailAdapter` and are
 * configured server-side. This composes with the Phase 10 adapter registry
 * (`communication-providers.ts`): the registry decides WHICH provider, this
 * contract decides the SHAPE of a send and its result.
 *
 * Invariants:
 * - `send` resolves to `EmailDeliveryReceipt | EmailDeliveryFailure` — success is
 *   only ever a provider-confirmed receipt, never an assumption.
 * - Undelivered is an explicit structured result (`undeliverable` / `failed`),
 *   never a thrown silent success.
 * - The registry exposes configuration facts, not secrets: credential references
 *   are resolved server-side and never enter this contract.
 * - The stub adapter is NOT_FOR_LIVE_USE: it always reports undeliverable so the
 *   pipeline is exercisable without provider keys (BLK-5 hold).
 */

import {
  isCategoryAllowedOnChannel,
  type DeliveryReceipt,
  type Notification,
} from "./notification-contract";
import { createAdapterFailurePolicy, type AdapterFailurePolicy } from "../adapters/failure-policy";

/** Everything an email adapter needs to attempt one send. The recipient address
 * is resolved server-side; the notification carries tenant + category policy. */
export interface EmailSendCommand {
  notification: Notification;
  /** Resolved recipient email address — never a credential, never logged. */
  recipientAddress: string;
  subject: string;
  body: string;
}

/**
 * Server-side configuration registry the adapter consults at send time.
 * Adapters see configuration FACTS only; the secret manager resolves the
 * credential reference behind each provider id (Constitution §30).
 */
export interface EmailProviderRegistry {
  /** True when the named provider has a usable server-side configuration. */
  isProviderConfigured(providerId: string): boolean;
  /** Credential reference (a pointer, not a secret) for the named provider. */
  credentialReferenceFor(providerId: string): string | null;
}

export interface EmailDeliveryReceipt extends DeliveryReceipt {
  channel: "email";
}

export type EmailDeliveryFailure =
  | {
      outcome: "undeliverable";
      code: "provider_not_configured" | "recipient_invalid" | "category_not_permitted";
      reason: string;
    }
  | {
      outcome: "failed";
      code: "provider_error";
      reason: string;
      retryable: boolean;
    };

export type EmailDeliveryResult = EmailDeliveryReceipt | EmailDeliveryFailure;

export function isEmailDeliveryReceipt(value: EmailDeliveryResult): value is EmailDeliveryReceipt {
  return "providerMessageId" in value && !("outcome" in value);
}

/** The one method every email provider adapter implements. */
export interface EmailAdapter {
  readonly providerId: string;
  send(command: EmailSendCommand, registry: EmailProviderRegistry): Promise<EmailDeliveryResult>;
}

/* ─────────────────────────────────────────────────────────────
 * Record-only stub adapter — NOT_FOR_LIVE_USE
 * ────────────────────────────────────────────────────────────*/

/**
 * A no-network, no-key email adapter for development, tests and pipeline
 * rehearsal while BLK-5 provider keys are withheld.
 *
 * NOT_FOR_LIVE_USE: it can NEVER deliver. Every call resolves to
 * `undeliverable("provider_not_configured")` — even when the registry claims the
 * provider is configured — so no caller can mistake a stub run for a real send.
 */
export const RECORD_ONLY_EMAIL_ADAPTER_ID = "record-only-stub";

export function createRecordOnlyEmailAdapter(): EmailAdapter {
  return {
    providerId: RECORD_ONLY_EMAIL_ADAPTER_ID,

    async send(
      command: EmailSendCommand,
      _registry: EmailProviderRegistry,
    ): Promise<EmailDeliveryResult> {
      void _registry;
      return {
        outcome: "undeliverable",
        code: "provider_not_configured",
        reason: `NOT_FOR_LIVE_USE: record-only email adapter holds the send for notification ${command.notification.id}; no live email is possible without provider keys (BLK-5)`,
      };
    },
  };
}

/**
 * Declared default failure-semantics policy for email adapters (J-045).
 * A send is a non-idempotent side effect with no provider-side idempotency
 * key in V1: the transport performs a single attempt and the notification
 * pipeline owns retries via the structured `retryable` flag.
 */
export const DEFAULT_EMAIL_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "email",
  timeoutMs: 8_000,
  maxAttempts: 1,
  backoffBaseMs: 250,
  backoffCapMs: 4_000,
  degradedAfterFailures: 3,
  degradedWindowMs: 60_000,
  breakerFailureThreshold: 5,
  breakerResetMs: 30_000,
});

/**
 * J-045 composition: wrap any `EmailAdapter` so its send is bounded,
 * contained and observable WITHOUT changing the `EmailAdapter` contract.
 *
 * - Timeout + containment: a hung or throwing provider becomes a structured
 *   `failed("provider_error")` result — never a rejection that could crash
 *   the dispatch loop.
 * - Degraded mode, breaker state and trust history are recorded on the
 *   policy and observable via `policy.snapshot()` / `policy.trustBasis()`.
 * - Structured provider results (receipt OR failure) pass through
 *   untouched: the contract's own failure vocabulary stays authoritative.
 * - Sends are always a single transport attempt regardless of the policy's
 *   declared `maxAttempts`: a send is non-idempotent in V1, and retries
 *   belong to the notification pipeline, not the transport.
 */
export function withEmailFailurePolicy(
  adapter: EmailAdapter,
  policy: AdapterFailurePolicy,
): EmailAdapter {
  return {
    providerId: adapter.providerId,
    async send(
      command: EmailSendCommand,
      registry: EmailProviderRegistry,
    ): Promise<EmailDeliveryResult> {
      const outcome = await policy.run({
        operation: `email.send:${adapter.providerId}`,
        maxAttempts: 1,
        call: () => adapter.send(command, registry),
      });
      if (outcome.outcome === "ok") return outcome.value;
      return {
        outcome: "failed",
        code: "provider_error",
        reason: `email delivery for notification ${command.notification.id} failed closed at the adapter boundary (code=${outcome.code}): ${outcome.reason}`,
        retryable: outcome.code !== "breaker_open",
      };
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Shared pre-send validation for any future real adapter
 * ────────────────────────────────────────────────────────────*/

/**
 * Fail-closed pre-send checks every email adapter must run before touching a
 * provider: category permitted on email, recipient present, provider configured.
 * Returns the blocking failure, or null when the command may proceed.
 */
export function evaluateEmailPreSend(
  command: EmailSendCommand,
  registry: EmailProviderRegistry,
  providerId: string,
): EmailDeliveryFailure | null {
  if (!isCategoryAllowedOnChannel(command.notification.category, "email")) {
    return {
      outcome: "undeliverable",
      code: "category_not_permitted",
      reason: `Category "${command.notification.category}" may not be delivered on the email channel (fail closed to in_app)`,
    };
  }
  if (command.recipientAddress.trim().length === 0) {
    return {
      outcome: "undeliverable",
      code: "recipient_invalid",
      reason: "Recipient address is empty; refusing to send",
    };
  }
  if (!registry.isProviderConfigured(providerId)) {
    return {
      outcome: "undeliverable",
      code: "provider_not_configured",
      reason: `Email provider "${providerId}" has no server-side configuration`,
    };
  }
  return null;
}
