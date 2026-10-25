/**
 * SHERIVS-PAY-SPLIT — fee checkout through a Paystack split.
 *
 * The school's subaccount receives the fee; the Sherivs main account takes the per-student
 * per-term platform fee as `transaction_charge`, and `bearer: "account"` makes the main account
 * absorb Paystack's processing fee, so nothing else is taken from the school's side.
 *
 * Everything here is computed on the server from `fee_checkout_split` (amount from the A05b relief
 * function `fee_amount_due`, share reserved once per student per term). The client never supplies
 * an amount, subaccount or share. TEST KEYS ONLY while the split is being proven (sk_test_).
 */

export type FeeCheckoutPlan = {
  split: boolean;
  amount_kobo: number;
  share_kobo: number;
  subaccount_code?: string;
  bearer?: "account";
  school_id: string;
  student_id: string;
  academic_year?: string;
  term?: string;
};

export type FeeInitializeBody = {
  email: string;
  amount: number;
  reference: string;
  currency: "NGN";
  metadata: Record<string, unknown>;
  subaccount?: string;
  transaction_charge?: number;
  bearer?: "account";
};

export function assertSplitTestKey(secret: string): void {
  if (!secret.startsWith("sk_test_")) throw new Error("Paystack split is enabled on TEST keys only (sk_test_)");
}

/** Validate the server plan and build the /transaction/initialize body. Throws on any inconsistency. */
export function buildFeeInitializeBody(
  plan: FeeCheckoutPlan,
  input: { email: string; reference: string; expectedKobo: number; metadata: Record<string, unknown> },
): FeeInitializeBody {
  const amount = plan.amount_kobo;
  if (!Number.isInteger(amount) || amount < 100) throw new Error("fee split: invalid amount");
  if (amount !== input.expectedKobo) throw new Error("fee split: amount does not match the amount due");
  const body: FeeInitializeBody = {
    email: input.email,
    amount,
    reference: input.reference,
    currency: "NGN",
    metadata: { ...input.metadata, sherivs_share_kobo: 0, sherivs_split: false },
  };
  if (!plan.split) return body;
  if (!plan.subaccount_code || !/^ACCT_[A-Za-z0-9]+$/.test(plan.subaccount_code)) throw new Error("fee split: invalid subaccount");
  const share = plan.share_kobo;
  if (!Number.isInteger(share) || share < 0 || share >= amount) throw new Error("fee split: invalid platform share");
  body.subaccount = plan.subaccount_code;
  // Flat amount to the main account. 0 means the term's share was already taken (or is held by another checkout).
  body.transaction_charge = share;
  body.bearer = "account";
  body.metadata = { ...body.metadata, sherivs_share_kobo: share, sherivs_split: true };
  return body;
}

/** What the school's subaccount receives for a split charge (Sherivs bears the Paystack fee). */
export function schoolReceivesKobo(amountKobo: number, shareKobo: number): number {
  return amountKobo - shareKobo;
}

/** Sherivs' net on a split charge: the share minus the Paystack fee it absorbs (can be negative on a 0-share charge). */
export function sherivsNetKobo(shareKobo: number, paystackFeeKobo: number): number {
  return shareKobo - paystackFeeKobo;
}

/** Per-student per-term price by plan tier in naira (the DB `plan_allowances` is the authority; this mirrors it for UI/tests). */
export const PLAN_SHARE_NAIRA = { trial: 0, starter: 2000, growth: 3000, professional: 5000 } as const;
