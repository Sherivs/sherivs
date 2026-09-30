/**
 * CoreGrid — split payments (Phase 13, domain-neutral).
 *
 * One gross payment, many beneficiaries. A school collecting a fee, a marketplace
 * paying a seller, a platform taking its own share, a partner receiving a referral
 * cut and a tax authority receiving what it is owed are the same problem: money
 * arrives once and must be attributable to several parties, each of whom settles
 * and reconciles on their own.
 *
 * The engine is provider-neutral: a leg names a route (a provider identifier the
 * routing engine resolved), never a provider SDK or a provider-specific shape.
 *
 * Laws enforced here (Phase 13 blueprint EH/EK):
 *   - the legs of a split sum EXACTLY to the gross amount; over- and under-
 *     allocation are refused rather than rounded away;
 *   - a split is immutable once created: a money-carrying leg is never edited,
 *     only compensated;
 *   - provider fees are attributed to the leg whose route produced them and are
 *     never silently deducted from the gross;
 *   - a refund spreads pro rata across the legs that received money, with a
 *     deterministic remainder, and can never return more from a beneficiary than
 *     it received;
 *   - replaying the same split identity moves no money twice;
 *   - a leg that cannot be paid stays unresolved and visible instead of rolling
 *     its remainder into another beneficiary's leg.
 */
import {
  addMoney,
  compareMoney,
  isZeroMoney,
  money,
  subtractMoney,
  type Money,
} from "./financial-core";
import {
  checkFinancialIdempotency,
  type FinancialIdempotencyStore,
  type FinancialIdempotencyResult,
} from "./financial-controls";
import type { ReconciliationState } from "./financial-settlements";

/** What a beneficiary is to the platform — institutional data, never a role list. */
export const SPLIT_BENEFICIARY_KINDS = [
  "platform",
  "institution",
  "seller",
  "partner",
  "tax-authority",
  "service-provider",
  "other",
] as const;
export type SplitBeneficiaryKind = (typeof SPLIT_BENEFICIARY_KINDS)[number];

/** A leg's settlement state is its own; siblings never imply each other. */
export type SplitLegState = "unsettled" | "instructed" | "settled" | "unresolved" | "reversed";

export interface SplitLeg {
  readonly legId: string;
  readonly beneficiaryId: string;
  readonly beneficiaryKind: SplitBeneficiaryKind;
  /** Why this beneficiary receives this money — a declared purpose, never inferred. */
  readonly purpose: string;
  readonly amount: Money;
  /** The provider route the routing engine resolved for this leg, when known. */
  readonly providerRoute: string | null;
  readonly state: SplitLegState;
  readonly settlementRef: string | null;
  /** Fees the provider charged for THIS leg, recorded separately from the leg amount. */
  readonly providerFees: readonly Money[];
  readonly reconciliation: ReconciliationState;
  /** When a leg could not be paid, why — unresolved legs are explained, not hidden. */
  readonly unresolvedReason?: string;
}

export interface SplitPolicy {
  /** Refuse a split that pays the same beneficiary twice (default: allowed only for distinct purposes). */
  readonly allowRepeatedBeneficiary?: boolean;
  /** Refuse legs whose amount is zero (default: zero legs are refused). */
  readonly allowZeroLegs?: boolean;
  readonly maxLegs?: number;
}

export interface CreateSplitPaymentInput {
  readonly splitId: string;
  readonly gross: Money;
  readonly legs: readonly Omit<
    SplitLeg,
    "state" | "settlementRef" | "providerFees" | "reconciliation"
  >[];
  readonly policy?: SplitPolicy;
  readonly idempotency?: FinancialIdempotencyStore;
}

export type SplitViolation =
  | "no-legs"
  | "too-many-legs"
  | "leg-sum-exceeds-gross"
  | "leg-sum-below-gross"
  | "currency-mismatch"
  | "negative-leg"
  | "zero-leg"
  | "unknown-beneficiary"
  | "repeated-beneficiary"
  | "gross-not-positive";

export type CreateSplitPaymentResult =
  | { readonly ok: true; readonly split: SplitPayment; readonly idempotentReplay: boolean }
  | { readonly ok: false; readonly refusals: readonly SplitViolation[]; readonly detail: string }
  | {
      readonly ok: false;
      readonly refusals: readonly ["duplicate-request"];
      readonly detail: string;
      readonly idempotency: FinancialIdempotencyResult;
    };

export interface SplitPayment {
  readonly splitId: string;
  readonly gross: Money;
  readonly legs: readonly SplitLeg[];
  readonly createdAt: string;
  readonly policy: Required<SplitPolicy>;
}

const DEFAULT_SPLIT_POLICY: Required<SplitPolicy> = {
  allowRepeatedBeneficiary: false,
  allowZeroLegs: false,
  maxLegs: 32,
};

/**
 * Create a split payment. Refusals are reported as a list, never as a silently
 * adjusted split: a plan whose legs do not sum to the gross is not "close
 * enough" — it is wrong, and money must not move on a wrong plan.
 */
export function createSplitPayment(input: CreateSplitPaymentInput): CreateSplitPaymentResult {
  const policy: Required<SplitPolicy> = { ...DEFAULT_SPLIT_POLICY, ...(input.policy ?? {}) };
  const at = new Date().toISOString();
  const refusals: SplitViolation[] = [];

  if (compareMoney(input.gross, money(0, input.gross.currency)) <= 0)
    refusals.push("gross-not-positive");
  if (input.legs.length === 0) refusals.push("no-legs");
  if (input.legs.length > policy.maxLegs) refusals.push("too-many-legs");

  const seenBeneficiaries = new Set<string>();
  let legSum = money(0, input.gross.currency);
  for (const leg of input.legs) {
    if (!leg.legId || !leg.beneficiaryId || !leg.purpose) refusals.push("unknown-beneficiary");
    if (leg.amount.currency !== input.gross.currency) {
      refusals.push("currency-mismatch");
      continue;
    }
    if (leg.amount.amountMinor < 0) refusals.push("negative-leg");
    else if (isZeroMoney(leg.amount) && !policy.allowZeroLegs) refusals.push("zero-leg");
    if (seenBeneficiaries.has(leg.beneficiaryId) && !policy.allowRepeatedBeneficiary) {
      refusals.push("repeated-beneficiary");
    }
    seenBeneficiaries.add(leg.beneficiaryId);
    legSum = addMoney(legSum, leg.amount);
  }

  const difference = compareMoney(legSum, input.gross);
  if (difference > 0) refusals.push("leg-sum-exceeds-gross");
  else if (difference < 0) refusals.push("leg-sum-below-gross");

  const unique = [...new Set(refusals)];
  if (unique.length > 0) {
    return {
      ok: false,
      refusals: unique,
      detail: describeSplitRefusals(unique, input.gross, legSum),
    };
  }

  if (input.idempotency) {
    const decision = checkFinancialIdempotency(
      `split:${input.splitId}`,
      "split.create",
      input.splitId,
      input.idempotency,
      at,
    );
    if (decision.outcome === "duplicate") {
      return {
        ok: false,
        refusals: ["duplicate-request"],
        detail: `Split ${input.splitId} was already created at ${decision.record.firstSeenAt}: no second movement of money.`,
        idempotency: decision,
      };
    }
  }

  const split: SplitPayment = {
    splitId: input.splitId,
    gross: input.gross,
    createdAt: at,
    policy,
    legs: input.legs.map((leg) => ({
      ...leg,
      state: "unsettled" as const,
      settlementRef: null,
      providerFees: [],
      reconciliation: "pending" as const,
    })),
  };
  return { ok: true, split, idempotentReplay: false };
}

export function describeSplitRefusals(
  refusals: readonly SplitViolation[],
  gross: Money,
  legs: Money,
): string {
  const reasons: Record<SplitViolation, string> = {
    "no-legs": "a split must name at least one beneficiary",
    "too-many-legs": "the split exceeds the policy's maximum number of legs",
    "leg-sum-exceeds-gross": `beneficiary legs (${legs.amountMinor}) exceed the gross amount (${gross.amountMinor}) — money cannot be created`,
    "leg-sum-below-gross": `beneficiary legs (${legs.amountMinor}) do not account for the gross amount (${gross.amountMinor}) — remainder must be assigned, not dropped`,
    "currency-mismatch": "a leg's currency differs from the gross amount's currency",
    "negative-leg": "a leg cannot carry a negative amount",
    "zero-leg": "a zero-value leg is not a beneficiary allocation",
    "unknown-beneficiary": "a leg must name its beneficiary and a purpose",
    "repeated-beneficiary": "the same beneficiary appears more than once while policy forbids it",
    "gross-not-positive": "the gross amount must be positive",
  };
  return refusals.map((refusal) => reasons[refusal]).join("; ");
}

/** A split is balanced only when its legs sum exactly to its gross amount. */
export function isSplitBalanced(split: SplitPayment): boolean {
  const sum = split.legs.reduce(
    (total, leg) => addMoney(total, leg.amount),
    money(0, split.gross.currency),
  );
  return compareMoney(sum, split.gross) === 0;
}

export interface SplitSettlementState {
  readonly settled: Money;
  readonly outstanding: Money;
  readonly unresolvedLegs: readonly string[];
  readonly unsettledLegs: readonly string[];
  /** True only when every leg is settled — an unresolved leg makes the whole unknown. */
  readonly complete: boolean;
  readonly unknown: boolean;
}

/** Settlement is per leg: a split is never "settled" because its siblings were. */
export function splitSettlementState(split: SplitPayment): SplitSettlementState {
  let settled = money(0, split.gross.currency);
  const unresolvedLegs: string[] = [];
  const unsettledLegs: string[] = [];
  for (const leg of split.legs) {
    if (leg.state === "settled") settled = addMoney(settled, leg.amount);
    else if (leg.state === "unresolved") unresolvedLegs.push(leg.legId);
    else unsettledLegs.push(leg.legId);
  }
  const outstanding = subtractMoney(split.gross, settled);
  return {
    settled,
    outstanding,
    unresolvedLegs,
    unsettledLegs,
    complete: unresolvedLegs.length === 0 && unsettledLegs.length === 0,
    unknown: unresolvedLegs.length > 0,
  };
}

export type SettleSplitLegResult =
  | { readonly ok: true; readonly split: SplitPayment }
  | { readonly ok: false; readonly error: string };

/** Settle one leg against real evidence. Settlement is never assumed from siblings. */
export function settleSplitLeg(
  split: SplitPayment,
  input: { readonly legId: string; readonly settlementRef: string; readonly amount: Money },
): SettleSplitLegResult {
  const leg = split.legs.find((candidate) => candidate.legId === input.legId);
  if (!leg) return { ok: false, error: `unknown leg ${input.legId}` };
  if (leg.state === "settled")
    return { ok: false, error: "leg already settled: a settlement is recorded once" };
  if (leg.state === "reversed") {
    return {
      ok: false,
      error: "leg was reversed: settle through a governed correction, never by re-settling",
    };
  }
  if (!input.settlementRef) {
    return { ok: false, error: "a settlement must cite the evidence that proves it" };
  }
  if (compareMoney(input.amount, leg.amount) !== 0) {
    return {
      ok: false,
      error: "settlement amount differs from the leg amount: reconcile, do not adjust silently",
    };
  }
  return {
    ok: true,
    split: {
      ...split,
      legs: split.legs.map((candidate) =>
        candidate.legId === input.legId
          ? {
              ...candidate,
              state: "settled" as const,
              settlementRef: input.settlementRef,
              reconciliation: "matched" as const,
            }
          : candidate,
      ),
    },
  };
}

/**
 * A leg that cannot be paid stays unresolved and visible. Its remainder is never
 * rolled into another beneficiary's leg.
 */
export function markSplitLegUnresolved(
  split: SplitPayment,
  input: { readonly legId: string; readonly reason: string },
): SettleSplitLegResult {
  if (!input.reason.trim()) {
    return { ok: false, error: "an unresolved leg must record why it could not be paid" };
  }
  const leg = split.legs.find((candidate) => candidate.legId === input.legId);
  if (!leg) return { ok: false, error: `unknown leg ${input.legId}` };
  if (leg.state === "settled") return { ok: false, error: "a settled leg is not unresolved" };
  return {
    ok: true,
    split: {
      ...split,
      legs: split.legs.map((candidate) =>
        candidate.legId === input.legId
          ? {
              ...candidate,
              state: "unresolved" as const,
              reconciliation: "discrepancy" as const,
              unresolvedReason: input.reason,
            }
          : candidate,
      ),
    },
  };
}

export type AttributeProviderFeeResult =
  | { readonly ok: true; readonly split: SplitPayment }
  | { readonly ok: false; readonly error: string };

/**
 * Provider fees belong to the leg whose route produced them and are recorded
 * separately. The gross amount is never reduced to absorb a fee.
 */
export function attributeProviderFee(
  split: SplitPayment,
  input: { readonly legId: string; readonly fee: Money },
): AttributeProviderFeeResult {
  const leg = split.legs.find((candidate) => candidate.legId === input.legId);
  if (!leg)
    return {
      ok: false,
      error: `unknown leg ${input.legId}: a fee cannot be attributed to nothing`,
    };
  if (input.fee.currency !== leg.amount.currency) {
    return { ok: false, error: "fee currency differs from the leg currency" };
  }
  if (input.fee.amountMinor < 0) return { ok: false, error: "a provider fee cannot be negative" };
  if (compareMoney(input.fee, leg.amount) > 0) {
    return {
      ok: false,
      error: "provider fee exceeds the leg amount: surface the loss, never absorb it silently",
    };
  }
  return {
    ok: true,
    split: {
      ...split,
      legs: split.legs.map((candidate) =>
        candidate.legId === input.legId
          ? { ...candidate, providerFees: [...candidate.providerFees, input.fee] }
          : candidate,
      ),
    },
  };
}

export interface SplitRefundAllocation {
  readonly legId: string;
  readonly beneficiaryId: string;
  readonly amount: Money;
}

export type RefundSplitResult =
  | {
      readonly ok: true;
      readonly allocations: readonly SplitRefundAllocation[];
      readonly remainderAssignedTo: string;
    }
  | { readonly ok: false; readonly error: string };

/**
 * Refund a split pro rata to what each leg received, with a deterministic
 * remainder (largest fractional share, ties broken by leg id). A refund can never
 * return more from a beneficiary than that beneficiary received.
 */
export function refundSplitProRata(
  split: SplitPayment,
  input: {
    readonly amount: Money;
    readonly reason: string;
    readonly alreadyRefundedMinor?: Readonly<Record<string, number>>;
  },
): RefundSplitResult {
  if (!input.reason.trim()) return { ok: false, error: "a refund must declare its reason" };
  if (input.amount.currency !== split.gross.currency) {
    return { ok: false, error: "refund currency differs from the split currency" };
  }
  if (input.amount.amountMinor <= 0)
    return { ok: false, error: "a refund must be a positive amount" };

  const alreadyRefunded = input.alreadyRefundedMinor ?? {};
  const refundable = split.legs
    .map((leg) => ({ leg, remaining: leg.amount.amountMinor - (alreadyRefunded[leg.legId] ?? 0) }))
    .filter((entry) => entry.remaining > 0);

  if (refundable.length === 0) return { ok: false, error: "no leg has refundable value left" };
  const totalRefundable = refundable.reduce((total, entry) => total + entry.remaining, 0);
  if (input.amount.amountMinor > totalRefundable) {
    return {
      ok: false,
      error: `refund of ${input.amount.amountMinor} exceeds the refundable value ${totalRefundable}: each leg only returns what it received`,
    };
  }

  const requested = input.amount.amountMinor;
  const shares = refundable.map((entry) => {
    const exact = (requested * entry.remaining) / totalRefundable;
    return {
      leg: entry.leg,
      remaining: entry.remaining,
      floor: Math.floor(exact),
      fraction: exact - Math.floor(exact),
    };
  });

  let allocated = shares.reduce((total, share) => total + share.floor, 0);
  const byRemainder = [...shares].sort((a, b) =>
    b.fraction === a.fraction ? a.leg.legId.localeCompare(b.leg.legId) : b.fraction - a.fraction,
  );
  const extra = new Map<string, number>();
  for (const share of byRemainder) {
    if (allocated >= requested) break;
    extra.set(share.leg.legId, (extra.get(share.leg.legId) ?? 0) + 1);
    allocated += 1;
  }

  const allocations: SplitRefundAllocation[] = shares.map((share) => {
    const shareMinor = share.floor + (extra.get(share.leg.legId) ?? 0);
    return {
      legId: share.leg.legId,
      beneficiaryId: share.leg.beneficiaryId,
      amount: money(Math.min(shareMinor, share.remaining), split.gross.currency),
    };
  });

  const check = allocations.reduce((total, allocation) => total + allocation.amount.amountMinor, 0);
  if (check !== requested) {
    return {
      ok: false,
      error: `pro-rata allocation produced ${check} against a requested ${requested}: refund refused rather than approximated`,
    };
  }
  const remainderAssignedTo = [...extra.keys()].sort()[0] ?? allocations[0].legId;
  return { ok: true, allocations, remainderAssignedTo };
}

export interface SplitExplanation {
  readonly splitId: string;
  readonly gross: Money;
  readonly balanced: boolean;
  readonly settled: Money;
  readonly outstanding: Money;
  readonly unknown: boolean;
  readonly perLeg: readonly {
    readonly legId: string;
    readonly beneficiaryId: string;
    readonly beneficiaryKind: SplitBeneficiaryKind;
    readonly amount: Money;
    readonly purpose: string;
    readonly state: SplitLegState;
    readonly providerFeesMinor: number;
    readonly netToBeneficiary: Money;
  }[];
}

/** Explain a split: who is paid what, on which route, and what is still owed to whom. */
export function explainSplit(split: SplitPayment): SplitExplanation {
  const settlement = splitSettlementState(split);
  return {
    splitId: split.splitId,
    gross: split.gross,
    balanced: isSplitBalanced(split),
    settled: settlement.settled,
    outstanding: settlement.outstanding,
    unknown: settlement.unknown,
    perLeg: split.legs.map((leg) => {
      const fees = leg.providerFees.reduce((total, fee) => total + fee.amountMinor, 0);
      return {
        legId: leg.legId,
        beneficiaryId: leg.beneficiaryId,
        beneficiaryKind: leg.beneficiaryKind,
        amount: leg.amount,
        purpose: leg.purpose,
        state: leg.state,
        providerFeesMinor: fees,
        netToBeneficiary: money(leg.amount.amountMinor - fees, leg.amount.currency),
      };
    }),
  };
}
