/**
 * CoreGrid — Phase 13 split payments unit tests (financial-splits).
 *
 * The laws under test (Phase 13 EH/EK):
 * - legs sum EXACTLY to the gross; over- and under-allocation are refused;
 * - a split is immutable and settlement is per leg, on real evidence;
 * - provider fees belong to a leg and never reduce the gross;
 * - refunds spread pro rata with a deterministic remainder and never exceed what
 *   a beneficiary received;
 * - the platform's own fee is a leg like any other — there is no privileged path;
 * - replaying a split identity moves no money twice.
 */

import { describe, expect, it } from "vitest";
import { money } from "@/lib/financial-core";
import type { FinancialIdempotencyStore } from "@/lib/financial-controls";
import {
  attributeProviderFee,
  createSplitPayment,
  explainSplit,
  isSplitBalanced,
  markSplitLegUnresolved,
  refundSplitProRata,
  settleSplitLeg,
  splitSettlementState,
  type SplitLeg,
} from "@/lib/financial-splits";

const GBP = "GBP";

function leg(
  legId: string,
  beneficiaryId: string,
  amountMinor: number,
  kind: SplitLeg["beneficiaryKind"] = "institution",
  purpose = "declared purpose",
): Omit<SplitLeg, "state" | "settlementRef" | "providerFees" | "reconciliation"> {
  return {
    legId,
    beneficiaryId,
    beneficiaryKind: kind,
    purpose,
    amount: money(amountMinor, GBP),
    providerRoute: "provider-a",
  };
}

function store(): FinancialIdempotencyStore {
  return { records: new Map() };
}

const PLAN = [
  leg("leg-1", "beneficiary-institution", 9_000, "institution", "service charge"),
  leg("leg-2", "beneficiary-platform", 700, "platform", "platform fee"),
  leg("leg-3", "beneficiary-partner", 300, "partner", "partner share"),
];

function buildPlan() {
  const created = createSplitPayment({ splitId: "split-1", gross: money(10_000, GBP), legs: PLAN });
  if (!created.ok) throw new Error(created.detail);
  return created.split;
}

describe("split payments: the legs must account for the gross exactly", () => {
  it("accounts a three-way split and reports it balanced", () => {
    const split = buildPlan();
    expect(isSplitBalanced(split)).toBe(true);
    expect(split.legs).toHaveLength(3);
  });

  it("refuses legs that exceed the gross instead of creating money", () => {
    const created = createSplitPayment({
      splitId: "split-over",
      gross: money(10_000, GBP),
      legs: [leg("a", "one", 9_000), leg("b", "two", 2_000)],
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.refusals).toContain("leg-sum-exceeds-gross");
    expect(created.detail).toContain("money cannot be created");
  });

  it("refuses legs below the gross instead of dropping the remainder", () => {
    const created = createSplitPayment({
      splitId: "split-under",
      gross: money(10_000, GBP),
      legs: [leg("a", "one", 5_000), leg("b", "two", 4_000)],
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.refusals).toContain("leg-sum-below-gross");
  });

  it("refuses negative legs", () => {
    const created = createSplitPayment({
      splitId: "split-negative",
      gross: money(1_000, GBP),
      legs: [leg("a", "one", -500), leg("b", "two", 1_500)],
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.refusals).toContain("negative-leg");
  });

  it("refuses the same beneficiary twice unless policy allows it", () => {
    const refused = createSplitPayment({
      splitId: "split-repeat",
      gross: money(1_000, GBP),
      legs: [leg("a", "one", 400), leg("b", "one", 600)],
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.refusals).toContain("repeated-beneficiary");

    const allowed = createSplitPayment({
      splitId: "split-repeat-allowed",
      gross: money(1_000, GBP),
      legs: [
        leg("a", "one", 400, "institution", "charge"),
        leg("b", "one", 600, "institution", "fee"),
      ],
      policy: { allowRepeatedBeneficiary: true },
    });
    expect(allowed.ok).toBe(true);
  });

  it("moves no money twice when the same split identity is replayed", () => {
    const idempotency = store();
    const first = createSplitPayment({
      splitId: "split-replay",
      gross: money(1_000, GBP),
      legs: [leg("a", "one", 1_000)],
      idempotency,
    });
    expect(first.ok).toBe(true);
    const second = createSplitPayment({
      splitId: "split-replay",
      gross: money(1_000, GBP),
      legs: [leg("a", "one", 1_000)],
      idempotency,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.refusals[0]).toBe("duplicate-request");
  });
});

describe("split payments: settlement belongs to each leg", () => {
  it("settles a leg only against evidence and only once", () => {
    const split = buildPlan();
    const settled = settleSplitLeg(split, {
      legId: "leg-1",
      settlementRef: "settlement-1",
      amount: money(9_000, GBP),
    });
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    const again = settleSplitLeg(settled.split, {
      legId: "leg-1",
      settlementRef: "settlement-2",
      amount: money(9_000, GBP),
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already settled");
  });

  it("refuses a settlement whose amount differs from the leg", () => {
    const split = buildPlan();
    const mismatched = settleSplitLeg(split, {
      legId: "leg-1",
      settlementRef: "settlement-1",
      amount: money(8_000, GBP),
    });
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) expect(mismatched.error).toContain("differs from the leg amount");
  });

  it("keeps the split incomplete and unknown while a leg is unresolved", () => {
    const split = buildPlan();
    const first = settleSplitLeg(split, {
      legId: "leg-1",
      settlementRef: "settlement-1",
      amount: money(9_000, GBP),
    });
    if (!first.ok) throw new Error(first.error);
    const unresolved = markSplitLegUnresolved(first.split, {
      legId: "leg-3",
      reason: "beneficiary cannot receive payment",
    });
    if (!unresolved.ok) throw new Error(unresolved.error);
    const state = splitSettlementState(unresolved.split);
    expect(state.complete).toBe(false);
    expect(state.unknown).toBe(true);
    expect(state.unresolvedLegs).toEqual(["leg-3"]);
    expect(state.outstanding.amountMinor).toBe(1_000);
  });

  it("requires a reason before a leg may be recorded unresolved", () => {
    const split = buildPlan();
    const attempt = markSplitLegUnresolved(split, { legId: "leg-2", reason: "   " });
    expect(attempt.ok).toBe(false);
  });
});

describe("split payments: provider fees and refunds", () => {
  it("attributes a provider fee to its leg and leaves the gross untouched", () => {
    const split = buildPlan();
    const attributed = attributeProviderFee(split, { legId: "leg-1", fee: money(150, GBP) });
    expect(attributed.ok).toBe(true);
    if (!attributed.ok) return;
    const explained = explainSplit(attributed.split);
    expect(explained.gross.amountMinor).toBe(10_000);
    expect(explained.perLeg[0].providerFeesMinor).toBe(150);
    expect(explained.perLeg[0].netToBeneficiary.amountMinor).toBe(8_850);
  });

  it("refuses a fee larger than the leg rather than absorbing a loss silently", () => {
    const split = buildPlan();
    const oversized = attributeProviderFee(split, { legId: "leg-3", fee: money(400, GBP) });
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.error).toContain("never absorb it silently");
  });

  it("refuses a fee attributed to a beneficiary that does not exist", () => {
    const split = buildPlan();
    const orphanFee = attributeProviderFee(split, { legId: "leg-9", fee: money(100, GBP) });
    expect(orphanFee.ok).toBe(false);
  });

  it("spreads a refund pro rata and returns exactly the requested amount", () => {
    const split = buildPlan();
    const refund = refundSplitProRata(split, {
      amount: money(3_333, GBP),
      reason: "service not delivered",
    });
    expect(refund.ok).toBe(true);
    if (!refund.ok) return;
    const total = refund.allocations.reduce(
      (sum, allocation) => sum + allocation.amount.amountMinor,
      0,
    );
    expect(total).toBe(3_333);
    const institution = refund.allocations.find((allocation) => allocation.legId === "leg-1");
    expect(institution?.amount.amountMinor).toBe(3_000);
  });

  it("is deterministic: the same refund produces the same allocation", () => {
    const split = buildPlan();
    const first = refundSplitProRata(split, { amount: money(1_001, GBP), reason: "adjustment" });
    const second = refundSplitProRata(split, { amount: money(1_001, GBP), reason: "adjustment" });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("refuses a refund beyond what the split actually received", () => {
    const split = buildPlan();
    const excessive = refundSplitProRata(split, {
      amount: money(10_001, GBP),
      reason: "excessive",
    });
    expect(excessive.ok).toBe(false);
    if (!excessive.ok) expect(excessive.error).toContain("only returns what it received");
  });

  it("never refunds more from a leg than that leg has left", () => {
    const split = buildPlan();
    const refund = refundSplitProRata(split, {
      amount: money(1_000, GBP),
      reason: "partial",
      alreadyRefundedMinor: { "leg-1": 8_900 },
    });
    expect(refund.ok).toBe(true);
    if (!refund.ok) return;
    for (const allocation of refund.allocations) {
      const source = split.legs.find((candidate) => candidate.legId === allocation.legId);
      const already = allocation.legId === "leg-1" ? 8_900 : 0;
      expect(allocation.amount.amountMinor).toBeLessThanOrEqual(
        (source?.amount.amountMinor ?? 0) - already,
      );
    }
  });

  it("treats the platform fee as a leg like any other", () => {
    const split = buildPlan();
    const platformLeg = split.legs.find((candidate) => candidate.beneficiaryKind === "platform");
    expect(platformLeg?.amount.amountMinor).toBe(700);
    const explained = explainSplit(split);
    expect(explained.perLeg.map((entry) => entry.beneficiaryKind)).toEqual([
      "institution",
      "platform",
      "partner",
    ]);
  });
});
