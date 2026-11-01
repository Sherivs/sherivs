/**
 * SHERIVS-004 — Paystack settlement: the single path that may mark a fee paid.
 *
 * Both the webhook and the client verify call feed provider-confirmed facts
 * here. A fee is updated only when the reference, status, currency and amount
 * match server-held expectations. Partial settlement consumes its active
 * reference in the same fee-row update so a replay cannot increment twice;
 * full settlement is protected by the terminal `paid` state.
 */
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

const timeAuthority = new TimeAuthority(new SystemClock());

export const PAYSTACK_CURRENCY = "NGN";
export const PAYSTACK_FEE_REFERENCE_TTL_MS = 24 * 60 * 60 * 1000;

export function isExpiredFeePaymentReference(
  reference: string,
  paymentAtMs = timeAuthority.now().atMs,
): boolean {
  const timestamp = /^uos_[0-9a-f]{16}_([0-9]{13})(?:_[0-9a-f]{8})?$/.exec(reference)?.[1];
  if (!timestamp) return true;
  const createdAtMs = Number(timestamp);
  return createdAtMs > paymentAtMs || paymentAtMs - createdAtMs >= PAYSTACK_FEE_REFERENCE_TTL_MS;
}

export type PaystackChargeFacts = {
  reference: string;
  status: string | undefined;
  /** Minor units (kobo) exactly as reported by Paystack. */
  amountKobo: number | undefined;
  currency: string | undefined;
  /** Provider-signed payment completion time, when present in the event/verification response. */
  paidAt?: string;
  /** Amount from the server-created intent, never from provider metadata. */
  canonicalAmountKobo?: number;
  /** Fee identity and scope resolved from the server-held financial intent. */
  canonicalFeeId?: string;
  canonicalScopeRef?: string;
  metadata?: {
    fee_id?: string | null;
    school_id?: string | null;
    sherivs_share_kobo?: number | null;
    sherivs_split?: boolean | null;
  } | null;
  /** SHERIVS-PAY-SPLIT: subaccount Paystack reports for the charge (split checkouts only). */
  subaccountCode?: string | null;
};

export type SettlementOutcome =
  | { outcome: "settled"; feeId: string; schoolId: string; splitError?: string }
  | { outcome: "duplicate"; feeId: string; schoolId: string }
  | { outcome: "rejected"; reason: string; feeId?: string; schoolId?: string }
  | { outcome: "ignored"; reason: string };

type DbResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

export interface SettlementDb {
  /**
   * SHERIVS-A05b: when present, `fee_amount_due` is the authority for what is owed on the row
   * after approved discounts/scholarships/waivers. The real Supabase client always has it.
   */
  rpc?(fn: "fee_amount_due", args: { p_fee: string }): DbResult<number | string>;
  rpc?(
    fn: "fee_split_settle",
    args: { p_reference: string; p_subaccount: string | null; p_share_kobo: number },
  ): DbResult<SplitSettleResult>;
  from(table: "fees"): {
    select(cols: string): {
      eq(col: string, value: string): { maybeSingle(): DbResult<FeeRow> };
    };
    update(patch: Record<string, unknown>): {
      eq(
        col: string,
        value: string,
      ): {
        eq(
          col: string,
          value: string,
        ): {
          neq(
            col: string,
            value: string,
          ): {
            select(cols: string): DbResult<Array<{ id: string }>>;
          };
        };
      };
    };
  };
}

export type SplitSettleResult = {
  ok: boolean;
  reason?: string;
  share_collected?: boolean;
  wallet_refunded?: boolean;
  duplicate?: boolean;
};

type FeeRow = {
  id: string;
  school_id: string;
  amount: number | string;
  paid_amount: number | string | null;
  status: string | null;
  paystack_reference: string | null;
};

/** Expected charge in kobo from the fee row alone (no relief). Settlement prefers `fee_amount_due`. */
export function expectedChargeKobo(fee: Pick<FeeRow, "amount" | "paid_amount">): number {
  return Math.round((Number(fee.amount) - Number(fee.paid_amount ?? 0)) * 100);
}

export async function settlePaystackCharge(
  db: SettlementDb,
  facts: PaystackChargeFacts,
): Promise<SettlementOutcome> {
  if (facts.status !== "success") return { outcome: "ignored", reason: "charge_not_successful" };
  if (!facts.reference) return { outcome: "ignored", reason: "missing_reference" };

  const feeQuery = db
    .from("fees")
    .select("id, school_id, amount, paid_amount, status, paystack_reference")
    .eq(
      facts.canonicalFeeId ? "id" : "paystack_reference",
      facts.canonicalFeeId ?? facts.reference,
    );
  const { data: fee, error } = await feeQuery.maybeSingle();
  if (error) throw new Error(`fee lookup failed: ${error.message}`);
  if (!fee) return { outcome: "ignored", reason: "unknown_reference" };

  const ref = { feeId: fee.id, schoolId: fee.school_id };
  if (
    (facts.canonicalFeeId && facts.canonicalFeeId !== fee.id) ||
    (facts.canonicalScopeRef && facts.canonicalScopeRef !== fee.school_id) ||
    (!facts.canonicalFeeId && fee.paystack_reference !== facts.reference)
  ) {
    return { outcome: "rejected", reason: "canonical_intent_mismatch", ...ref };
  }
  if (facts.canonicalFeeId && fee.paystack_reference !== facts.reference) {
    if (fee.paystack_reference === null || fee.status === "paid") {
      return { outcome: "duplicate", ...ref };
    }
    return { outcome: "rejected", reason: "reference_no_longer_current", ...ref };
  }
  const claimedFee = facts.metadata?.fee_id;
  const claimedSchool = facts.metadata?.school_id;
  if ((claimedFee && claimedFee !== fee.id) || (claimedSchool && claimedSchool !== fee.school_id)) {
    return { outcome: "rejected", reason: "metadata_mismatch", ...ref };
  }
  if (fee.status === "paid") return { outcome: "duplicate", ...ref };
  const paidAtMs = facts.paidAt === undefined ? undefined : Date.parse(facts.paidAt);
  if (
    (paidAtMs !== undefined && !Number.isFinite(paidAtMs)) ||
    isExpiredFeePaymentReference(facts.reference, paidAtMs ?? timeAuthority.now().atMs)
  ) {
    return { outcome: "rejected", reason: "expired_reference", ...ref };
  }

  if ((facts.currency ?? "").toUpperCase() !== PAYSTACK_CURRENCY) {
    return { outcome: "rejected", reason: "currency_mismatch", ...ref };
  }
  let outstanding = expectedChargeKobo(fee);
  if (db.rpc) {
    const { data: due, error: dueErr } = await db.rpc("fee_amount_due", { p_fee: fee.id });
    if (dueErr) throw new Error(`amount due lookup failed: ${dueErr.message}`);
    outstanding = Math.round(Number(due ?? 0) * 100);
  }
  const expected = facts.canonicalAmountKobo ?? outstanding;
  if (expected <= 0 || expected > outstanding || facts.amountKobo !== expected) {
    return { outcome: "rejected", reason: "amount_mismatch", ...ref };
  }
  const paidAmount = Math.round((Number(fee.paid_amount ?? 0) + expected / 100) * 100) / 100;
  const fullySettled = expected === outstanding;

  const { data: updated, error: upErr } = await db
    .from("fees")
    .update({
      status: fullySettled ? "paid" : "partial",
      paid_amount: paidAmount,
      paid_at: fullySettled ? timeAuthority.now().at : null,
      paystack_reference: fullySettled ? facts.reference : null,
      paystack_access_code: null,
    })
    .eq("id", fee.id)
    .eq("paystack_reference", facts.reference)
    .neq("status", "paid")
    .select("id");
  if (upErr) throw new Error(`fee settlement failed: ${upErr.message}`);
  if (!updated || updated.length === 0) return { outcome: "duplicate", ...ref };
  // The fee is paid either way; a split-ledger problem is reported (webhook log) for reconciliation, never un-pays.
  try {
    await settleSplitShare(db, facts);
  } catch (e) {
    return { outcome: "settled", ...ref, splitError: (e as Error).message };
  }
  return { outcome: "settled", ...ref };
}

/**
 * SHERIVS-PAY-SPLIT: after the fee is marked paid, record the term share the split sent to the
 * main account (once per student per term; a wallet debit taken meanwhile by a cash payment is refunded).
 * Non-split charges are a no-op. A failure here never un-pays the fee; it throws so the webhook logs it.
 */
export async function settleSplitShare(
  db: SettlementDb,
  facts: PaystackChargeFacts,
): Promise<SplitSettleResult | null> {
  if (!facts.metadata?.sherivs_split || !db.rpc) return null;
  const share = Number(facts.metadata.sherivs_share_kobo ?? 0);
  const { data, error } = await db.rpc("fee_split_settle", {
    p_reference: facts.reference,
    p_subaccount: facts.subaccountCode ?? null,
    p_share_kobo: Number.isInteger(share) && share > 0 ? share : 0,
  });
  if (error) throw new Error(`split settle failed: ${error.message}`);
  if (data && !data.ok) throw new Error(`split settle refused: ${data.reason ?? "unknown"}`);
  return data ?? null;
}
