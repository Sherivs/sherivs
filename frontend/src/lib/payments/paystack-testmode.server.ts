/**
 * CoreGrid — Paystack TEST-MODE live client (MISSION-R-32, AGENTS §36).
 *
 * The contract adapter (`paystack-adapter.ts`) owns webhook translation and
 * stays local under BLK-4. This module is the governed LIVE surface for the
 * test rails only: it executes real Paystack API calls with real (sk_test)
 * credentials through the declared failure policy (bounded timeout, error
 * containment, circuit breaker from `adapters/failure-policy.ts`).
 *
 * Security posture (Constitution §36, §26):
 * - TEST KEYS ONLY: the secret key must start with `sk_test_`. A live key
 *   (`sk_live_`), a public key, or any other credential class is refused
 *   with an explicit deny — never half-trusted, never "configured later".
 * - Ownership validation: amounts and currency come exclusively from the
 *   server-resolved `PaymentReference` (never from client payment state),
 *   and `verifyOwnedPayment` re-checks the provider's record against the
 *   canonical reference before any financial effect is accepted.
 * - Idempotency: the derived reference idempotency key is sent as the
 *   Paystack transaction reference — the provider deduplicates replays of
 *   the same payment server-side.
 * - Audit before execute: the injected audit sink is awaited BEFORE the
 *   provider call; if the sink throws, the mutation is denied — no payment
 *   mutation can ever happen without its audit record.
 * - Failure containment: every network call goes through the policy's
 *   `run` boundary; provider failures return structured results and feed
 *   the circuit breaker, never the host loop.
 *
 * Secrets are never logged; deny reasons carry no key material.
 */
import {
  deriveIdempotencyKey,
  validatePaymentReference,
  type PaymentReference,
} from "./payment-contract";
import { createAdapterFailurePolicy, type AdapterFailurePolicy } from "../adapters/failure-policy";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const DEFAULT_BASE_URL = "https://api.paystack.co";
const TEST_KEY_PREFIX = "sk_test_";

export interface PaystackTestModeConfig {
  /** Platform secret key. MUST be a Paystack TEST secret (`sk_test_...`). */
  secretKey: string;
  /** Override the API base URL (injected transports in tests). */
  baseUrl?: string;
  /** Injectable failure policy; a dedicated instance is created when omitted. */
  failurePolicy?: AdapterFailurePolicy;
  /**
   * Injectable HTTP transport (unit tests inject fakes; live calls use fetch).
   * Must behave like `fetch(url, init)`.
   */
  transport?: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * REQUIRED audit sink (AGENTS §36). Awaited before every mutating provider
   * call; a throwing sink denies the mutation (fail closed).
   */
  audit: (entry: PaystackAuditEntry) => Promise<void> | void;
}

export type PaystackAuditEntry = {
  action: "paystack.transaction.initialize";
  provider: "paystack";
  mode: "test";
  /** Server-resolved owning tenant (from the canonical reference). */
  tenantId: string;
  /** Canonical purpose row id (from the canonical reference). */
  purposeRef: string;
  idempotencyKey: string;
  amountMinor: number;
  currency: string;
  atIso: string;
};

export type PaystackTestModeDenyCode =
  | "missing_key"
  | "non_test_key"
  | "missing_audit_sink"
  | "invalid_reference"
  | "audit_failed"
  | "provider_error"
  | "timeout"
  | "breaker_open"
  | "malformed_response"
  | "ownership_mismatch";

export type PaystackTestModeResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: PaystackTestModeDenyCode; reason: string };

export interface InitializedTransaction {
  provider: "paystack";
  mode: "test";
  /** Our idempotency key, registered server-side as the Paystack reference. */
  reference: string;
  idempotencyKey: string;
  authorizationUrl: string;
  accessCode: string;
}

export interface VerifiedTransaction {
  provider: "paystack";
  mode: "test";
  reference: string;
  status: string;
  amountMinor: number;
  currency: string;
}

/** The dedicated declared policy for live test-mode calls (J-045 semantics). */
export function createPaystackTestModePolicy(): AdapterFailurePolicy {
  return createAdapterFailurePolicy({
    provider: "paystack-testmode",
    timeoutMs: 10_000,
    maxAttempts: 2,
    backoffBaseMs: 250,
    backoffCapMs: 4_000,
    degradedAfterFailures: 3,
    degradedWindowMs: 60_000,
    breakerFailureThreshold: 5,
    breakerResetMs: 30_000,
  });
}

/** Validate the credential class. Deny reasons never echo the key. */
export function validateTestModeKey(
  secretKey: string,
): { ok: true } | { ok: false; code: "missing_key" | "non_test_key"; reason: string } {
  const key = secretKey.trim();
  if (!key) return { ok: false, code: "missing_key", reason: "Paystack secret key is required" };
  if (!key.startsWith(TEST_KEY_PREFIX)) {
    return {
      ok: false,
      code: "non_test_key",
      reason: "Only Paystack TEST secret keys (sk_test_…) may use this surface",
    };
  }
  return { ok: true };
}

interface PaystackApiEnvelope {
  status?: unknown;
  message?: unknown;
  data?: unknown;
}

/** Extract a contained, secret-free reason from a provider error response. */
function providerReason(status: number, bodyText: string): string {
  let message = "";
  try {
    const parsed = JSON.parse(bodyText) as PaystackApiEnvelope;
    if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    message = bodyText.slice(0, 120);
  }
  return `paystack api ${status}${message ? `: ${message}` : ""}`;
}

function defaultTransport(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

/** Shared construction validation (fail fast, before any caller mutation). */
function buildRuntime(config: PaystackTestModeConfig): {
  ok: true;
  runtime: {
    key: string;
    baseUrl: string;
    policy: AdapterFailurePolicy;
    transport: (url: string, init: RequestInit) => Promise<Response>;
  };
} | {
  ok: false;
  code: "missing_key" | "non_test_key" | "missing_audit_sink";
  reason: string;
} {
  const keyCheck = validateTestModeKey(config.secretKey);
  if (!keyCheck.ok) return keyCheck;
  if (typeof config.audit !== "function") {
    return {
      ok: false,
      code: "missing_audit_sink",
      reason: "an audit sink is required — no mutation without an audit record (AGENTS §36)",
    };
  }
  return {
    ok: true,
    runtime: {
      key: config.secretKey.trim(),
      baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
      policy: config.failurePolicy ?? createPaystackTestModePolicy(),
      transport: config.transport ?? defaultTransport,
    },
  };
}

/**
 * Initialize a Paystack test-mode transaction for a validated canonical
 * reference. The idempotency key is the provider-side reference, so replays
 * of the same payment deduplicate server-side. Audits BEFORE executing.
 */
export async function initializePaystackTestTransaction(
  config: PaystackTestModeConfig,
  reference: PaymentReference,
  payerEmail: string,
): Promise<PaystackTestModeResult<InitializedTransaction>> {
  const runtime = buildRuntime(config);
  if (!runtime.ok) return runtime;

  const validation = validatePaymentReference(reference);
  if (!validation.ok) {
    return { ok: false, code: "invalid_reference", reason: validation.reason };
  }
  if (typeof payerEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail.trim())) {
    return { ok: false, code: "invalid_reference", reason: "a valid payer email is required" };
  }

  const idempotencyKey = deriveIdempotencyKey(reference);

  // Audit-before-execute: a throwing sink denies the mutation (§36).
  try {
    await config.audit({
      action: "paystack.transaction.initialize",
      provider: "paystack",
      mode: "test",
      tenantId: reference.tenantId,
      purposeRef: reference.purpose.ref,
      idempotencyKey,
      amountMinor: reference.amount.amountMinor,
      currency: reference.amount.currency,
      atIso: timeAuthority.now().at,
    });
  } catch (err) {
    return {
      ok: false,
      code: "audit_failed",
      reason: `mutation denied: the audit sink rejected the record (contained: ${err instanceof Error ? err.message : String(err)})`,
    };
  }

  const outcome = await runtime.runtime.policy.run({
    operation: "paystack.transaction.initialize",
    // A payment initialization is a mutation: exactly one attempt, no
    // transport retry (replays dedupe only via the registered reference).
    maxAttempts: 1,
    call: async () => {
      const res = await runtime.runtime.transport(`${runtime.runtime.baseUrl}/transaction/initialize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runtime.runtime.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reference: idempotencyKey,
          amount: reference.amount.amountMinor,
          currency: reference.amount.currency,
          email: payerEmail.trim(),
          metadata: {
            tenant_id: reference.tenantId,
            purpose_kind: reference.purpose.kind,
            purpose_ref: reference.purpose.ref,
          },
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(providerReason(res.status, text));
      return JSON.parse(text) as PaystackApiEnvelope;
    },
  });

  if (outcome.outcome === "error") {
    return {
      ok: false,
      code: outcome.code,
      reason: outcome.reason,
    };
  }

  const data = outcome.value.data;
  if (
    outcome.value.status !== true ||
    typeof data !== "object" ||
    data === null ||
    typeof (data as Record<string, unknown>).authorization_url !== "string" ||
    typeof (data as Record<string, unknown>).access_code !== "string"
  ) {
    return {
      ok: false,
      code: "malformed_response",
      reason: "initialize response did not carry the expected authorization payload",
    };
  }
  const payload = data as { authorization_url: string; access_code: string };
  return {
    ok: true,
    value: {
      provider: "paystack",
      mode: "test",
      reference: idempotencyKey,
      idempotencyKey,
      authorizationUrl: payload.authorization_url,
      accessCode: payload.access_code,
    },
  };
}

/**
 * Verify a Paystack test-mode transaction by reference (read-only) and
 * validate OWNERSHIP against the canonical reference: the provider's
 * recorded amount and currency must match exactly. A mismatch denies —
 * the provider's word alone is never ownership evidence.
 */
export async function verifyOwnedPayment(
  config: PaystackTestModeConfig,
  providerReference: string,
  expected: Pick<PaymentReference, "amount">,
): Promise<PaystackTestModeResult<VerifiedTransaction>> {
  const runtime = buildRuntime(config);
  if (!runtime.ok) return runtime;

  if (typeof providerReference !== "string" || providerReference.trim() === "") {
    return { ok: false, code: "invalid_reference", reason: "a provider reference is required" };
  }

  const outcome = await runtime.runtime.policy.run({
    operation: "paystack.transaction.verify",
    // Verification is an idempotent read: bounded retries are safe.
    call: async () => {
      const res = await runtime.runtime.transport(
        `${runtime.runtime.baseUrl}/transaction/verify/${encodeURIComponent(providerReference.trim())}`,
        { method: "GET", headers: { Authorization: `Bearer ${runtime.runtime.key}` } },
      );
      const text = await res.text();
      if (!res.ok) throw new Error(providerReason(res.status, text));
      return JSON.parse(text) as PaystackApiEnvelope;
    },
  });

  if (outcome.outcome === "error") {
    return { ok: false, code: outcome.code, reason: outcome.reason };
  }

  const data = outcome.value.data;
  if (
    outcome.value.status !== true ||
    typeof data !== "object" ||
    data === null ||
    typeof (data as Record<string, unknown>).status !== "string" ||
    typeof (data as Record<string, unknown>).amount !== "number" ||
    typeof (data as Record<string, unknown>).currency !== "string"
  ) {
    return {
      ok: false,
      code: "malformed_response",
      reason: "verify response did not carry the expected transaction payload",
    };
  }
  const payload = data as { status: string; amount: number; currency: string };
  if (
    payload.amount !== expected.amount.amountMinor ||
    payload.currency.toUpperCase() !== expected.amount.currency.toUpperCase()
  ) {
    return {
      ok: false,
      code: "ownership_mismatch",
      reason: "provider-recorded amount/currency does not match the canonical reference",
    };
  }
  return {
    ok: true,
    value: {
      provider: "paystack",
      mode: "test",
      reference: providerReference,
      status: payload.status,
      amountMinor: payload.amount,
      currency: payload.currency,
    },
  };
}

/** Environment composition root. Fails closed on absent or non-test keys. */
export function paystackTestModeFromEnv(
  audit: PaystackTestModeConfig["audit"],
  env: NodeJS.ProcessEnv = process.env,
):
  | { ok: true; config: PaystackTestModeConfig }
  | { ok: false; code: "missing_key" | "non_test_key"; reason: string } {
  const keyCheck = validateTestModeKey(env.PAYSTACK_SECRET_KEY ?? "");
  if (!keyCheck.ok) return keyCheck;
  return { ok: true, config: { secretKey: (env.PAYSTACK_SECRET_KEY ?? "").trim(), audit } };
}
