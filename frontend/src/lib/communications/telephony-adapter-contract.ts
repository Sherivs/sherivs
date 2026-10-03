/**
 * CoreGrid — Telephony adapter contract (V1-009, team COMMS).
 *
 * Provider-agnostic contract for outbound voice calls, mirroring the shape of
 * the email adapter contract (V5.3 Part 20) so both channels share one
 * failure vocabulary and one failure-policy composition (J-045).
 *
 * Boundaries (Constitution §24):
 * - CoreGrid owns communication INTENT (recipient, authorization, channel,
 *   message, delivery state, retries, evidence, audit). Providers are
 *   adapters ONLY: concrete providers (Twilio, Vapi, Africa's Talking, …)
 *   plug in behind `TelephonyAdapter` and are configured server-side.
 * - No implementation and no network I/O lives here. This module imports no
 *   vendor and no runtime domain vocabulary.
 * - `placeCall` resolves to `TelephonyCallReceipt | TelephonyCallFailure` —
 *   success is only ever a provider-confirmed result, never an assumption.
 * - Undelivered is an explicit structured result (`undeliverable` /
 *   `failed`), never a thrown silent success and never a fabricated receipt.
 * - Missing credentials FAIL CLOSED: the blocked result is a typed
 *   `undeliverable("provider_not_configured")` record naming the missing
 *   environment variables (never their values) and stating that no provider
 *   call was attempted — the adapter equivalent of the exit-2
 *   `BLOCKED_NO_CREDENTIAL` battery discipline.
 * - Adapters see configuration FACTS only (`TelephonyProviderRegistry`);
 *   credential references are pointers, never secrets (Constitution §30).
 */

import { z } from "zod";
import { createAdapterFailurePolicy, type AdapterFailurePolicy } from "../adapters/failure-policy";

/* ─────────────────────────────────────────────────────────────
 * Command + validation (§26: validate everything crossing the boundary)
 * ────────────────────────────────────────────────────────────*/

/** Everything a telephony adapter needs to attempt one outbound call. */
export interface TelephonyCallCommand {
  /** Bounded caller-supplied classification (e.g. "attendance_alert"). */
  callKind: string;
  /** Tenant the call belongs to — resolved server-side, never client-asserted. */
  tenantRef: string;
  recipientName: string;
  /** Resolved recipient phone number — never a credential, never logged. */
  recipientPhone: string;
  /** Spoken script; bounded by the same limits as the scholar call contract. */
  script: string;
  /** Optional correlation to the triggering event. */
  triggerEvent: string | null;
}

/** Outbound call-command shape every telephony adapter must enforce (§19 minimization). */
export const TELEPHONY_CALL_COMMAND_MAX = {
  callKind: 80,
  tenantRef: 200,
  recipientName: 160,
  recipientPhone: 32,
  script: 4_000,
  triggerEvent: 120,
} as const;

export const TelephonyCallCommandSchema = z.strictObject({
  callKind: z.string().trim().min(1).max(TELEPHONY_CALL_COMMAND_MAX.callKind),
  tenantRef: z.string().trim().min(1).max(TELEPHONY_CALL_COMMAND_MAX.tenantRef),
  recipientName: z.string().trim().min(1).max(TELEPHONY_CALL_COMMAND_MAX.recipientName),
  recipientPhone: z.string().trim().min(6).max(TELEPHONY_CALL_COMMAND_MAX.recipientPhone),
  script: z.string().trim().min(1).max(TELEPHONY_CALL_COMMAND_MAX.script),
  triggerEvent: z.string().trim().max(TELEPHONY_CALL_COMMAND_MAX.triggerEvent).nullable(),
});

/* ─────────────────────────────────────────────────────────────
 * Results
 * ────────────────────────────────────────────────────────────*/

/**
 * Provider-confirmed proof that the provider accepted a call. Produced only
 * from a real provider result; `callId` is null exactly when the provider
 * accepted without returning an id — never fabricated.
 */
export interface TelephonyCallReceipt {
  callId: string | null;
  providerId: string;
  /** Bounded provider-reported status (e.g. "queued"). */
  status: string;
  /** ISO-8601 timestamp issued by the kernel time authority at confirmation. */
  placedAt: string;
}

export type TelephonyCallFailure =
  | {
      outcome: "undeliverable";
      code:
        "provider_not_configured" | "recipient_invalid" | "invalid_command" | "provider_not_live";
      reason: string;
    }
  | {
      outcome: "failed";
      code: "provider_error";
      reason: string;
      retryable: boolean;
      /** Present when the failure came from an HTTP response. */
      httpStatus: number | null;
    };

export type TelephonyCallResult = TelephonyCallReceipt | TelephonyCallFailure;

export function isTelephonyCallReceipt(value: TelephonyCallResult): value is TelephonyCallReceipt {
  return "callId" in value && !("outcome" in value);
}

/* ─────────────────────────────────────────────────────────────
 * Registry (configuration facts, never secrets — §30)
 * ────────────────────────────────────────────────────────────*/

/**
 * Server-side configuration registry the adapter consults at call time.
 * Credential references are pointers the secret manager resolves; a raw
 * secret never enters this contract.
 */
export interface TelephonyProviderRegistry {
  /** True when the named provider has a usable server-side configuration. */
  isProviderConfigured(providerId: string): boolean;
  /** Credential reference (a pointer, not a secret) for the named provider. */
  credentialReferenceFor(providerId: string): string | null;
}

/* ─────────────────────────────────────────────────────────────
 * The one method every telephony provider adapter implements
 * ────────────────────────────────────────────────────────────*/

export interface TelephonyAdapter {
  readonly providerId: string;
  placeCall(
    command: TelephonyCallCommand,
    registry: TelephonyProviderRegistry,
  ): Promise<TelephonyCallResult>;
}

/* ─────────────────────────────────────────────────────────────
 * Shared pre-call validation (fail closed)
 * ────────────────────────────────────────────────────────────*/

/**
 * Fail-closed pre-call checks every telephony adapter must run before
 * touching a provider: command shape, recipient present, provider configured.
 * Returns the blocking failure, or null when the call may proceed.
 */
export function evaluateTelephonyPreCall(
  command: TelephonyCallCommand,
  registry: TelephonyProviderRegistry,
  providerId: string,
): TelephonyCallFailure | null {
  const parsed = TelephonyCallCommandSchema.safeParse(command);
  if (!parsed.success) {
    return {
      outcome: "undeliverable",
      code: "invalid_command",
      reason: `Outbound call command failed local contract validation for provider "${providerId}"; nothing was sent`,
    };
  }
  if (command.recipientPhone.trim().length === 0) {
    return {
      outcome: "undeliverable",
      code: "recipient_invalid",
      reason: "Recipient phone is empty; refusing to place a call",
    };
  }
  if (!registry.isProviderConfigured(providerId)) {
    return {
      outcome: "undeliverable",
      code: "provider_not_configured",
      reason: `Telephony provider "${providerId}" has no server-side configuration; no provider call was attempted`,
    };
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────
 * J-045 composition (mirrors withEmailFailurePolicy)
 * ────────────────────────────────────────────────────────────*/

/**
 * Declared default failure-semantics policy for telephony adapters.
 * A call is a non-idempotent side effect with no provider-side idempotency
 * key in V1: the transport performs a single attempt and the calling
 * pipeline owns retries via the structured `retryable` flag.
 */
export const DEFAULT_TELEPHONY_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "telephony",
  timeoutMs: 12_000,
  maxAttempts: 1,
  backoffBaseMs: 250,
  backoffCapMs: 4_000,
  degradedAfterFailures: 3,
  degradedWindowMs: 60_000,
  breakerFailureThreshold: 5,
  breakerResetMs: 30_000,
});

/**
 * J-045 composition: wrap any `TelephonyAdapter` so its placeCall is bounded,
 * contained and observable WITHOUT changing the `TelephonyAdapter` contract.
 * Structured provider results (receipt OR failure) pass through untouched;
 * a hung or throwing provider becomes a structured
 * `failed("provider_error")` result — never a rejection that could crash
 * the dispatch loop. Exactly one transport attempt regardless of the
 * policy's declared `maxAttempts` (non-idempotent side effect).
 */
export function withTelephonyFailurePolicy(
  adapter: TelephonyAdapter,
  policy: AdapterFailurePolicy,
): TelephonyAdapter {
  return {
    providerId: adapter.providerId,
    async placeCall(
      command: TelephonyCallCommand,
      registry: TelephonyProviderRegistry,
    ): Promise<TelephonyCallResult> {
      const outcome = await policy.run({
        operation: `telephony.placeCall:${adapter.providerId}`,
        maxAttempts: 1,
        call: () => adapter.placeCall(command, registry),
      });
      if (outcome.outcome === "ok") return outcome.value;
      return {
        outcome: "failed",
        code: "provider_error",
        reason: `telephony call for "${adapter.providerId}" failed closed at the adapter boundary (code=${outcome.code}): ${outcome.reason}`,
        retryable: outcome.code !== "breaker_open",
        httpStatus: null,
      };
    },
  };
}
