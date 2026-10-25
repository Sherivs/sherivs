import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assertSplitTestKey, buildFeeInitializeBody, schoolReceivesKobo, sherivsNetKobo, PLAN_SHARE_NAIRA, type FeeCheckoutPlan } from "../../frontend/src/lib/payments/fee-split";
import { settlePaystackCharge, type SettlementDb } from "../../frontend/src/lib/payments/paystack-settlement";

const plan = (p: Partial<FeeCheckoutPlan> = {}): FeeCheckoutPlan => ({
  split: true, amount_kobo: 6_000_000, share_kobo: 300_000, subaccount_code: "ACCT_school1", bearer: "account",
  school_id: "s", student_id: "st", academic_year: "2026/2027", term: "first", ...p });
const input = (expectedKobo = 6_000_000) => ({ email: "p@x.ng", reference: "uos_ref123", expectedKobo, metadata: { fee_id: "f" } });

describe("SHERIVS-PAY-SPLIT initialize body", () => {
  it("routes the fee to the school subaccount, the term share to Sherivs, and Sherivs bears the Paystack fee", () => {
    const b = buildFeeInitializeBody(plan(), input());
    expect(b).toMatchObject({ amount: 6_000_000, subaccount: "ACCT_school1", transaction_charge: 300_000, bearer: "account", currency: "NGN" });
    expect(b.metadata).toMatchObject({ fee_id: "f", sherivs_share_kobo: 300_000, sherivs_split: true });
    expect(schoolReceivesKobo(b.amount, b.transaction_charge!)).toBe(5_700_000);
  });
  it("a second payment in the same term carries no share (charged once per student per term)", () => {
    const b = buildFeeInitializeBody(plan({ share_kobo: 0 }), input());
    expect(b.transaction_charge).toBe(0);
    expect(schoolReceivesKobo(b.amount, 0)).toBe(b.amount);
  });
  it("charges exactly the relief-adjusted amount due and refuses any other amount", () => {
    expect(() => buildFeeInitializeBody(plan(), input(10_000_000))).toThrow(/amount due/);
  });
  it("refuses a share that would leave the school nothing, a bad subaccount, or a negative share", () => {
    expect(() => buildFeeInitializeBody(plan({ share_kobo: 6_000_000 }), input())).toThrow(/share/);
    expect(() => buildFeeInitializeBody(plan({ share_kobo: -1 }), input())).toThrow(/share/);
    expect(() => buildFeeInitializeBody(plan({ subaccount_code: "x" }), input())).toThrow(/subaccount/);
  });
  it("falls back to a plain charge when the school has no active subaccount", () => {
    const b = buildFeeInitializeBody(plan({ split: false, share_kobo: 0, subaccount_code: undefined }), input());
    expect(b.subaccount).toBeUndefined(); expect(b.transaction_charge).toBeUndefined(); expect(b.bearer).toBeUndefined();
    expect(b.metadata.sherivs_split).toBe(false);
  });
  it("split runs on TEST keys only", () => {
    expect(() => assertSplitTestKey("sk_live_abc")).toThrow(/TEST/);
    expect(() => assertSplitTestKey("sk_test_abc")).not.toThrow();
  });
  it("plan tier prices match the pricing book (Starter 2k, Growth 3k, Professional 5k)", () => {
    expect(PLAN_SHARE_NAIRA).toMatchObject({ starter: 2000, growth: 3000, professional: 5000 });
    const sql = readFileSync("database/supabase/migrations/20261024000260_sherivs_019_wallet_ndpa_campus.sql", "utf8");
    expect(sql).toMatch(/'starter',\s+750000,\s+2000/); expect(sql).toMatch(/'growth',\s+1250000,\s+3000/); expect(sql).toMatch(/'professional',\s+2000000,\s+5000/);
  });
  it("Sherivs' net is the share minus the Paystack fee it absorbs", () => {
    expect(sherivsNetKobo(300_000, 60_000)).toBe(240_000);
  });
});

type Fee = { id: string; school_id: string; amount: number; paid_amount: number | null; status: string | null; paystack_reference: string | null };
function db(fee: Fee, due: number, split: { ok: boolean; reason?: string } | { error: string } = { ok: true }) {
  const rpcCalls: [string, unknown][] = [];
  const d = {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push([fn, args]);
      if (fn === "fee_amount_due") return { data: due, error: null };
      return "error" in split ? { data: null, error: { message: split.error } } : { data: split, error: null };
    },
    from: () => ({
      select: () => ({ eq: (_c: string, ref: string) => ({ maybeSingle: async () => ({ data: fee.paystack_reference === ref ? fee : null, error: null }) }) }),
      update: () => ({ eq: () => ({ eq: () => ({ neq: () => ({ select: async () => {
        if (fee.status === "paid") return { data: [], error: null }; fee.status = "paid"; return { data: [{ id: fee.id }], error: null }; } }) }) }) }),
    }),
  } as unknown as SettlementDb;
  return { d, rpcCalls };
}
const fee = (): Fee => ({ id: "11111111-1111-4111-8111-111111111111", school_id: "22222222-2222-4222-8222-222222222222", amount: 60000, paid_amount: 0, status: "unpaid", paystack_reference: "uos_r" });
const facts = (m: Record<string, unknown> | null, sub: string | null = "ACCT_school1") =>
  ({ reference: "uos_r", status: "success", amountKobo: 6_000_000, currency: "NGN", metadata: m, subaccountCode: sub });

describe("SHERIVS-PAY-SPLIT settlement", () => {
  it("records the term share with the subaccount Paystack reported", async () => {
    const { d, rpcCalls } = db(fee(), 60000);
    expect((await settlePaystackCharge(d, facts({ sherivs_split: true, sherivs_share_kobo: 300_000 }))).outcome).toBe("settled");
    expect(rpcCalls[1]).toEqual(["fee_split_settle", { p_reference: "uos_r", p_subaccount: "ACCT_school1", p_share_kobo: 300_000 }]);
  });
  it("non-split charges never touch the split ledger", async () => {
    const { d, rpcCalls } = db(fee(), 60000);
    expect((await settlePaystackCharge(d, facts(null, null))).outcome).toBe("settled");
    expect(rpcCalls.map((c) => c[0])).toEqual(["fee_amount_due"]);
  });
  it("a refused split (wrong subaccount) never un-pays the fee but is reported", async () => {
    const { d } = db(fee(), 60000, { ok: false, reason: "subaccount_mismatch" });
    expect(await settlePaystackCharge(d, facts({ sherivs_split: true, sherivs_share_kobo: 300_000 }, "ACCT_other"))).toMatchObject({ outcome: "settled", splitError: expect.stringMatching(/subaccount_mismatch/) });
  });
  it("replays are duplicates and do not settle the share twice", async () => {
    const f = fee(); const { d, rpcCalls } = db(f, 60000);
    await settlePaystackCharge(d, facts({ sherivs_split: true, sherivs_share_kobo: 300_000 }));
    expect((await settlePaystackCharge(d, facts({ sherivs_split: true, sherivs_share_kobo: 300_000 }))).outcome).toBe("duplicate");
    expect(rpcCalls.filter((c) => c[0] === "fee_split_settle")).toHaveLength(1);
  });
});

describe("SHERIVS-PAY-SPLIT migration", () => {
  const sql = readFileSync("database/supabase/migrations/20261025100250_sherivs_paystack_split_fee.sql", "utf8");
  it("amount comes from fee_amount_due, bearer is the main account, share once per student per term", () => {
    expect(sql).toMatch(/due := public\.fee_amount_due\(p_fee\)/);
    expect(sql).toMatch(/'bearer', 'account'/);
    expect(sql).toMatch(/fee_type = 'platform_share' FOR UPDATE/);
  });
  it("split functions are service_role only; cash payments debit the wallet with the same price", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fee_checkout_split\(uuid, text, interval\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fee_split_settle\(text, text, bigint\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/v_share := public\.platform_share_per_student\(p_school\)/);
    expect(sql).toMatch(/_wallet_post\(p_school, 'platform_share', -v_share/);
  });
});
