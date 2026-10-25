import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { settlePaystackCharge, type SettlementDb } from "../../frontend/src/lib/payments/paystack-settlement";

type Fee = { id: string; school_id: string; amount: number; paid_amount: number | null; status: string | null; paystack_reference: string | null };
function db(fee: Fee, due: number | { error: string }) {
  const updates: Record<string, unknown>[] = []; const rpcCalls: unknown[] = [];
  const d = {
    rpc: async (fn: string, args: unknown) => { rpcCalls.push([fn, args]); return typeof due === "number" ? { data: due, error: null } : { data: null, error: { message: due.error } }; },
    from: () => ({
      select: () => ({ eq: (_c: string, ref: string) => ({ maybeSingle: async () => ({ data: fee.paystack_reference === ref ? fee : null, error: null }) }) }),
      update: (patch: Record<string, unknown>) => ({ eq: () => ({ eq: () => ({ neq: () => ({ select: async () => {
        if (fee.status === "paid") return { data: [], error: null }; updates.push(patch); fee.status = "paid"; return { data: [{ id: fee.id }], error: null }; } }) }) }) }),
    }),
  } as unknown as SettlementDb;
  return { d, updates, rpcCalls };
}
const fee = (): Fee => ({ id: "11111111-1111-4111-8111-111111111111", school_id: "22222222-2222-4222-8222-222222222222", amount: 100000, paid_amount: 0, status: "unpaid", paystack_reference: "uos_r" });
const facts = (kobo: number) => ({ reference: "uos_r", status: "success", amountKobo: kobo, currency: "NGN", metadata: null });

describe("SHERIVS-A05b settlement charges the amount after relief", () => {
  it("settles the net amount (₦100,000 tuition with ₦40,000 relief → ₦60,000) and records what was paid", async () => {
    const { d, updates, rpcCalls } = db(fee(), 60000);
    expect((await settlePaystackCharge(d, facts(6_000_000))).outcome).toBe("settled");
    expect(rpcCalls[0]).toEqual(["fee_amount_due", { p_fee: fee().id }]);
    expect(updates[0]).toMatchObject({ status: "paid", paid_amount: 60000 });
  });
  it("rejects a charge for the gross amount once relief applies", async () => {
    const { d, updates } = db(fee(), 60000);
    expect(await settlePaystackCharge(d, facts(10_000_000))).toMatchObject({ outcome: "rejected", reason: "amount_mismatch" });
    expect(updates).toHaveLength(0);
  });
  it("rejects when relief changed after checkout started (amount no longer matches)", async () => {
    const { d } = db(fee(), 50000);
    expect((await settlePaystackCharge(d, facts(6_000_000))).outcome).toBe("rejected");
  });
  it("rejects when nothing is owed (fully waived)", async () => {
    const { d } = db(fee(), 0);
    expect((await settlePaystackCharge(d, facts(0))).outcome).toBe("rejected");
  });
  it("fails closed (throws, webhook retries) when the amount-due lookup errors", async () => {
    const { d } = db(fee(), { error: "boom" });
    await expect(settlePaystackCharge(d, facts(6_000_000))).rejects.toThrow(/amount due lookup failed/);
  });
  it("checkout initialisation charges fee_amount_due, not the gross row amount", () => {
    const src = readFileSync("frontend/src/lib/runtime/scholar/paystack.functions.ts", "utf8");
    expect(src).toContain('rpc("fee_amount_due"');
    expect(src).not.toMatch(/const outstanding = Number\(fee\.amount\)/);
  });
});
