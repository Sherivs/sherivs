/**
 * Sherivs — Paystack split-payment binding (master account + per-organization subaccounts).
 *
 * Guarantee: money paid for a beneficiary in organization A can never be
 * credited to organization B.
 *  1. Server-side binding: beneficiary -> organization -> subaccount is
 *     resolved from canonical records; the client never supplies an org,
 *     subaccount or amount.
 *  2. Signed payment intent: the resolved binding is frozen in an
 *     HMAC-SHA256-signed intent stored server-side and echoed in metadata.
 *  3. Webhook verification: Paystack's x-paystack-signature (HMAC-SHA512 of
 *     the raw body) is checked with the existing adapter.
 *  4. Reconciliation: the webhook's reference, amount, currency and
 *     subaccount must match the stored intent AND the beneficiary's current
 *     binding; any mismatch is quarantined, never credited.
 * TEST KEYS ONLY in this slice (sk_test_).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { verifyPaystackSignature } from "./paystack-adapter";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

const timeAuthority = new TimeAuthority(new SystemClock());
const systemNowMs = (): number => timeAuthority.now().atMs;

/**
 * Decisions 2026-10-22: Sherivs takes a FLAT platform fee per payment (amount set
 * by the owner, configured per subaccount in kobo — never hard-coded), and the
 * school bears the Paystack processing fee (`bearer: "subaccount"`).
 */
export interface Subaccount { orgId: string; subaccountCode: string; active: boolean; platformChargeKobo: number }
export interface BindingStore {
  orgOfBeneficiary(beneficiaryId: string): Promise<string | null>;
  subaccountOf(orgId: string): Promise<Subaccount | null>;
  saveIntent(intent: StoredIntent): Promise<void>;
  intentByReference(reference: string): Promise<StoredIntent | null>;
  markIntent(reference: string, status: "credited" | "quarantined", reason?: string): Promise<void>;
}
export interface PaymentIntent {
  reference: string; orgId: string; beneficiaryId: string; payerId: string; subaccountCode: string;
  amountKobo: number; platformChargeKobo: number; currency: "NGN"; purpose: string; expiresAtMs: number;
}
export interface StoredIntent extends PaymentIntent { signature: string; status: "pending" | "credited" | "quarantined" }

export function assertTestSecret(secret: string): void {
  if (!secret.startsWith("sk_test_")) throw new Error("paystack: only sk_test_ keys are allowed in this slice");
}

function canonical(i: PaymentIntent): string {
  return JSON.stringify([i.reference, i.orgId, i.beneficiaryId, i.payerId, i.subaccountCode, i.amountKobo,
    i.platformChargeKobo, i.currency, i.purpose, i.expiresAtMs]);
}
export function signIntent(i: PaymentIntent, signingKey: string): string {
  return createHmac("sha256", signingKey).update(canonical(i)).digest("hex");
}
export function verifyIntentSignature(i: PaymentIntent, sig: string, signingKey: string): boolean {
  const a = Buffer.from(signIntent(i, signingKey), "hex"); const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export class SplitPaymentBinder {
  constructor(private readonly deps: { store: BindingStore; intentSigningKey: string; now?: () => number; ttlMs?: number }) {
    if (deps.intentSigningKey.length < 32) throw new Error("split-binding: signing key too short");
  }
  private now() { return this.deps.now ? this.deps.now() : systemNowMs(); }

  /** Create an intent and the Paystack /transaction/initialize body. amountKobo comes from the server-side billing record. */
  async createIntent(input: { reference: string; beneficiaryId: string; payerId: string; amountKobo: number; purpose: string; email: string }) {
    if (!Number.isInteger(input.amountKobo) || input.amountKobo < 100) throw new Error("split-binding: invalid amount");
    const orgId = await this.deps.store.orgOfBeneficiary(input.beneficiaryId);
    if (!orgId) throw new Error("split-binding: beneficiary not bound to an organization");
    const sub = await this.deps.store.subaccountOf(orgId);
    if (!sub || !sub.active || sub.orgId !== orgId) throw new Error("split-binding: organization has no active subaccount");
    if (sub.platformChargeKobo < 0 || sub.platformChargeKobo >= input.amountKobo) throw new Error("split-binding: invalid platform charge");
    const intent: PaymentIntent = { reference: input.reference, orgId, beneficiaryId: input.beneficiaryId, payerId: input.payerId,
      subaccountCode: sub.subaccountCode, amountKobo: input.amountKobo, platformChargeKobo: sub.platformChargeKobo,
      currency: "NGN", purpose: input.purpose, expiresAtMs: this.now() + (this.deps.ttlMs ?? 30 * 60_000) };
    const signature = signIntent(intent, this.deps.intentSigningKey);
    await this.deps.store.saveIntent({ ...intent, signature, status: "pending" });
    return {
      intent, signature,
      initializeBody: {
        email: input.email, amount: intent.amountKobo, currency: "NGN", reference: intent.reference,
        subaccount: intent.subaccountCode, transaction_charge: intent.platformChargeKobo, bearer: "subaccount",
        metadata: { sherivs_ref: intent.reference, sherivs_sig: signature },
      },
    };
  }

  /** Verify a Paystack webhook and reconcile it against the stored intent. Never credits on mismatch. */
  async reconcileWebhook(input: { rawBody: Uint8Array; headers: Record<string, string>; paystackSecret: string }):
    Promise<{ ok: true; orgId: string; reference: string } | { ok: false; reason: string; reference?: string }> {
    assertTestSecret(input.paystackSecret);
    const sig = verifyPaystackSignature({ secretKey: input.paystackSecret }, { rawBody: input.rawBody, headers: input.headers, receivedAtSec: Math.floor(this.now() / 1000) });
    if (!sig.ok) return { ok: false, reason: `signature: ${sig.code}` };
    let evt: { event?: string; data?: { reference?: string; amount?: number; currency?: string; status?: string; subaccount?: { subaccount_code?: string } | null; metadata?: { sherivs_sig?: string } } };
    try { evt = JSON.parse(Buffer.from(input.rawBody).toString("utf8")); } catch { return { ok: false, reason: "malformed body" }; }
    if (evt.event !== "charge.success" || evt.data?.status !== "success") return { ok: false, reason: "ignored event" };
    const d = evt.data; const reference = d.reference ?? "";
    const stored = await this.deps.store.intentByReference(reference);
    if (!stored) return { ok: false, reason: "unknown reference", reference };
    if (stored.status !== "pending") return { ok: false, reason: `already ${stored.status}`, reference };
    const quarantine = async (reason: string) => { await this.deps.store.markIntent(reference, "quarantined", reason); return { ok: false as const, reason, reference }; };
    const { signature, status: _s, ...intent } = stored;
    if (!verifyIntentSignature(intent, signature, this.deps.intentSigningKey)) return quarantine("intent signature invalid");
    if (d.metadata?.sherivs_sig !== signature) return quarantine("metadata signature mismatch");
    if (d.amount !== stored.amountKobo || d.currency !== "NGN") return quarantine("amount or currency mismatch");
    if (d.subaccount?.subaccount_code !== stored.subaccountCode) return quarantine("subaccount mismatch");
    if ((await this.deps.store.orgOfBeneficiary(stored.beneficiaryId)) !== stored.orgId) return quarantine("beneficiary binding changed");
    const sub = await this.deps.store.subaccountOf(stored.orgId);
    if (!sub || sub.subaccountCode !== stored.subaccountCode) return quarantine("organization subaccount changed");
    await this.deps.store.markIntent(reference, "credited");
    return { ok: true, orgId: stored.orgId, reference };
  }
}
