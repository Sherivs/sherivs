/**
 * CoreGrid — V1 payment contract layer (MISSION-V1-012, V5.3 Part 21).
 *
 * Pure, provider-agnostic payment vocabulary. The provider (Paystack,
 * Stripe, …) is an implementation dependency, NEVER the semantic owner:
 * every concept here is expressed in CoreGrid terms (tenant, purpose,
 * minor-unit amount) and adapters merely translate. Live provider calls
 * are blocked (BLK-4) — this layer performs no network I/O by design.
 *
 * Vocabulary extension, not duplication: `Money` and `TenantId` come from
 * the financial/tenant cores, `PaymentIntentStatus` and the intent/refund
 * lifecycle come from `financial-payments.ts` (Phase 13), and the
 * ownership fields mirror the Scholar fee slice in `paystack.functions.ts`
 * (school_id → tenantId, kobo minor units, provider reference stored on
 * the fee row). This module is the shared contract those slices adapt to;
 * it does not re-define amounts, tenants or statuses locally.
 *
 * Webhook security posture (Part 36): provider webhooks are untrusted
 * input. Adapters must verify signatures over the RAW request bytes,
 * fail closed on any parse/verification ambiguity, and hand events to
 * `replay-guard.ts` for idempotent acceptance. Frontend payment state is
 * never trusted; the webhook is only ever evidence, validated against
 * canonical records downstream.
 */
import type { Money } from "../financial-core";
import type { TenantId } from "../tenant-core";
import type { PaymentIntentStatus } from "../financial-payments";

/* ─────────────────────────────────────────────────────────────
 * Payment reference (ownership + purpose)
 * ────────────────────────────────────────────────────────────*/

/** What the payment settles. `ref` is the canonical domain row id
 * (e.g. the fee id in the Scholar slice) — never a provider id. */
export interface PaymentPurpose {
  kind: "fee_payment" | "invoice_payment";
  ref: string;
}

/**
 * The canonical ownership envelope of any payment. Every adapter request
 * and every accepted webhook event must be traceable back to one of these.
 * `payerRef` is the authenticated payer identity resolved server-side —
 * never a client-asserted field.
 */
export interface PaymentReference {
  /** Owning tenant (`school_id` in the Scholar fee slice). */
  tenantId: TenantId;
  /** Server-resolved payer identity (user id). */
  payerRef: string;
  /** Integer minor units + ISO currency — never floating point. */
  amount: Money;
  purpose: PaymentPurpose;
}

export type PaymentReferenceValidation =
  | { ok: true; reference: PaymentReference }
  | { ok: false; code: "empty_tenant" | "empty_payer" | "invalid_amount" | "missing_currency" | "empty_purpose_ref"; reason: string };

/**
 * Validate a payment reference strictly (fail closed). Amounts must be
 * positive integers in minor units with a non-empty ISO currency.
 */
export function validatePaymentReference(
  reference: PaymentReference,
): PaymentReferenceValidation {
  if (reference.tenantId.trim() === "") {
    return { ok: false, code: "empty_tenant", reason: "Payment reference requires a tenant" };
  }
  if (reference.payerRef.trim() === "") {
    return { ok: false, code: "empty_payer", reason: "Payment reference requires a server-resolved payer" };
  }
  if (!Number.isSafeInteger(reference.amount.amountMinor) || reference.amount.amountMinor <= 0) {
    return {
      ok: false,
      code: "invalid_amount",
      reason: "Payment amount must be a positive integer in minor units",
    };
  }
  if (reference.amount.currency.trim() === "") {
    return { ok: false, code: "missing_currency", reason: "Payment amount requires a currency" };
  }
  if (reference.purpose.ref.trim() === "") {
    return { ok: false, code: "empty_purpose_ref", reason: "Payment purpose requires a canonical domain row id" };
  }
  return { ok: true, reference };
}

/* ─────────────────────────────────────────────────────────────
 * Payment intent (contract level)
 * ────────────────────────────────────────────────────────────*/

/**
 * Contract-level payment intent. Reuses the Phase 13 lifecycle
 * (`PaymentIntentStatus`) so the FinOS domain model remains the single
 * authority on intent states. `providerReference` is stored like the
 * Scholar slice stores `paystack_reference` — a locator, never truth.
 */
export interface PaymentIntent {
  id: string;
  reference: PaymentReference;
  provider: string;
  providerReference: string | null;
  /** Deterministic key that makes provider-side (re)execution idempotent. */
  idempotencyKey: string;
  status: PaymentIntentStatus;
  createdAt: string;
}

export type CreateIntentResult =
  | { ok: true; intent: PaymentIntent }
  | { ok: false; code: "invalid_reference"; reason: string };

/* ─────────────────────────────────────────────────────────────
 * Payment events (webhooks)
 * ────────────────────────────────────────────────────────────*/

export type PaymentEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded";

/**
 * A verified provider webhook, translated into CoreGrid vocabulary.
 * `eventId` is the provider's durable event id (idempotency identity);
 * `providerReference` locates the provider-side transaction.
 * Provider metadata (e.g. tenant hints) is carried as evidence — the
 * consuming server function must re-validate ownership against canonical
 * records before any financial effect.
 */
export interface PaymentEvent {
  type: PaymentEventType;
  /** Provider's durable event id — unique per provider. */
  eventId: string;
  provider: string;
  providerReference: string;
  amount: Money;
  /** Tenant hint from provider metadata (evidence, not authorization). */
  tenantId: TenantId | null;
  /** Purpose hint from provider metadata (evidence, not authorization). */
  purposeRef: string | null;
  occurredAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Adapter contract
 * ────────────────────────────────────────────────────────────*/

/** Raw, untrusted webhook transport as received by the server route. */
export interface WebhookRequest {
  /** Exact raw request bytes — signatures must be computed over these. */
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string>>;
  /** Wall-clock receipt time in seconds (drives replay tolerance). */
  receivedAtSec: number;
}

export type VerifySignatureResult =
  | { ok: true }
  | {
      ok: false;
      code: "missing_signature" | "malformed_signature" | "signature_mismatch" | "stale_timestamp";
      reason: string;
    };

export type ParseWebhookResult =
  | { ok: true; event: PaymentEvent }
  | {
      ok: false;
      code: "signature_invalid" | "malformed_payload" | "unknown_event";
      reason: string;
    };

export type RefundResult =
  | { ok: true; refundId: string }
  | { ok: false; code: "unsupported" | "invalid_amount"; reason: string };

export interface PaymentAdapterCapabilities {
  refunds: boolean;
}

/**
 * The full adapter contract. Adapters translate provider wire formats into
 * CoreGrid vocabulary and own provider-specific signature schemes — never
 * the semantics. All operations are pure/local: under BLK-4 no adapter
 * performs network I/O.
 */
export interface PaymentAdapter {
  readonly provider: string;
  readonly capabilities: PaymentAdapterCapabilities;
  /**
   * Build a local intent envelope for a validated reference. The live
   * provider execution remains BLK-4 blocked; the intent starts in the
   * Phase 13 `created` state with no provider reference yet.
   */
  createIntent(reference: PaymentReference, now: string): CreateIntentResult;
  /** Provider-specific signature verification over the raw bytes. */
  verifySignature(request: WebhookRequest): VerifySignatureResult;
  /** Verify, parse and translate a webhook — fail closed on anything odd. */
  parseWebhook(request: WebhookRequest): ParseWebhookResult;
  /** Present only when `capabilities.refunds` is true. */
  refund?(intent: PaymentIntent, amount: Money, reason: string): RefundResult;
}

/** Deterministic adapter idempotency key derived from the reference —
 * the same payment retried with the same reference must not double-charge. */
export function deriveIdempotencyKey(reference: PaymentReference): string {
  const { tenantId, payerRef, amount, purpose } = reference;
  return `cg_${tenantId}_${payerRef}_${purpose.kind}_${purpose.ref}_${amount.currency}_${amount.amountMinor}`
    .replace(/[^a-zA-Z0-9_.-]/g, "_");
}

/* ─────────────────────────────────────────────────────────────
 * Strict adapter registry (fail closed)
 * ────────────────────────────────────────────────────────────*/

export type AdapterLookup =
  | { ok: true; adapter: PaymentAdapter }
  | { ok: false; code: "unregistered_provider"; reason: string };

const adapters = new Map<string, PaymentAdapter>();

/** Register an adapter. Registration is explicit, never implicit. */
export function registerPaymentAdapter(adapter: PaymentAdapter): void {
  adapters.set(adapter.provider, adapter);
}

/**
 * Resolve the adapter for a provider. Every unknown provider DENIES —
 * the registry fails closed, mirroring the capability gate (AT.9).
 */
export function paymentAdapterFor(provider: string): AdapterLookup {
  const adapter = adapters.get(provider);
  if (!adapter) {
    return {
      ok: false,
      code: "unregistered_provider",
      reason: `No payment adapter registered for provider "${provider}"`,
    };
  }
  return { ok: true, adapter };
}

/** Test/worker isolation hook — clears all registrations. */
export function resetPaymentAdapters(): void {
  adapters.clear();
}
