/**
 * CoreGrid — payment reconciliation arithmetic (MISSION-R-73, J-044).
 *
 * Reconciles recorded contract-level payment intents against accepted
 * webhook-derived receipts (V5.3 Part 21 + Part 36 posture): the webhook is
 * only ever evidence, validated against canonical records — this module IS
 * that validation, expressed as pure arithmetic over the contract types.
 *
 * Receipts are `PaymentEvent`s that have already passed adapter signature
 * verification and the replay guard; acceptance order is the caller's
 * exactly-once guarantee (an event rejected by the guard must never appear
 * here). Matching key is `purpose.ref` — the canonical domain row id (e.g.
 * the Scholar fee id), never a provider id.
 *
 * Refund events are deliberately out of scope for balance arithmetic: no V1
 * adapter declares the refund capability while BLK-4 stands, so a refund
 * receipt cannot exist yet. Refund netting is follow-up work when a
 * capability-gated refund path ships — never faked here.
 *
 * Credential-free and pure: no network I/O, no clock reads, no hidden
 * mutation (BLK-4 dry-run surface). All money is integer minor units (T) and
 * currencies are never mixed — a receipt in a foreign currency is a
 * `currency_mismatch` discrepancy, not an arithmetic operand.
 */
import { money, type Money } from "../financial-core";
import type { PaymentEvent, PaymentIntent } from "./payment-contract";

export type ReconciliationEntry =
  | {
      kind: "matched";
      intentId: string;
      purposeRef: string;
      intentAmount: Money;
      received: Money;
      receiptEventIds: readonly string[];
    }
  | {
      kind: "pending_intent";
      intentId: string;
      purposeRef: string;
      intentAmount: Money;
    }
  | {
      kind: "partial_receipts";
      intentId: string;
      purposeRef: string;
      intentAmount: Money;
      received: Money;
      receiptEventIds: readonly string[];
    }
  | {
      kind: "overpaid_intent";
      intentId: string;
      purposeRef: string;
      intentAmount: Money;
      received: Money;
      receiptEventIds: readonly string[];
    }
  | {
      kind: "currency_mismatch";
      intentId: string;
      purposeRef: string;
      intentCurrency: string;
      receiptEventIds: readonly string[];
    }
  | {
      kind: "unattributed_receipt";
      eventId: string;
      provider: string;
      amount: Money;
    };

export interface ReconciliationCounts {
  intents: number;
  succeededReceipts: number;
  matched: number;
  pending: number;
  partial: number;
  overpaid: number;
  currencyMismatch: number;
  unattributed: number;
}

export interface ReconciliationReport {
  /**
   * True when every recorded receipt is attributed to an intent whose net
   * received amount equals the recorded intent amount. Pending intents (no
   * receipts yet) do not break balance — money in flight is not a
   * discrepancy. Any partial, overpaid, currency-mismatch or unattributed
   * entry does.
   */
  balanced: boolean;
  counts: ReconciliationCounts;
  /** Deterministic order: intent entries in input order, then unattributed receipts in input order. */
  entries: readonly ReconciliationEntry[];
}

/**
 * Reconcile recorded intents against accepted receipts, fail-closed:
 * ambiguous input (two intents claiming the same purpose ref) throws rather
 * than being silently resolved — a financial ambiguity must be observable.
 */
export function reconcileIntentsWithReceipts(
  intents: readonly PaymentIntent[],
  events: readonly PaymentEvent[],
): ReconciliationReport {
  const intentByPurpose = new Map<string, PaymentIntent>();
  for (const intent of intents) {
    const purposeRef = intent.reference.purpose.ref;
    if (intentByPurpose.has(purposeRef)) {
      throw new Error(
        `Reconciliation ambiguity: multiple recorded intents claim purpose ref "${purposeRef}"`,
      );
    }
    intentByPurpose.set(purposeRef, intent);
  }

  const succeededByPurpose = new Map<string, PaymentEvent[]>();
  const unattributed: PaymentEvent[] = [];
  let succeededReceipts = 0;
  for (const event of events) {
    if (event.type !== "payment.succeeded") continue;
    succeededReceipts += 1;
    const purposeRef = event.purposeRef?.trim() ?? "";
    if (purposeRef === "") {
      unattributed.push(event);
      continue;
    }
    const bucket = succeededByPurpose.get(purposeRef);
    if (bucket) bucket.push(event);
    else succeededByPurpose.set(purposeRef, [event]);
  }

  const entries: ReconciliationEntry[] = [];
  const counts: ReconciliationCounts = {
    intents: intents.length,
    succeededReceipts,
    matched: 0,
    pending: 0,
    partial: 0,
    overpaid: 0,
    currencyMismatch: 0,
    unattributed: unattributed.length,
  };

  for (const intent of intents) {
    const purposeRef = intent.reference.purpose.ref;
    const receipts = succeededByPurpose.get(purposeRef) ?? [];
    succeededByPurpose.delete(purposeRef);

    if (receipts.length === 0) {
      counts.pending += 1;
      entries.push({
        kind: "pending_intent",
        intentId: intent.id,
        purposeRef,
        intentAmount: intent.reference.amount,
      });
      continue;
    }

    const foreign = receipts.filter(
      (receipt) => receipt.amount.currency !== intent.reference.amount.currency,
    );
    if (foreign.length > 0) {
      counts.currencyMismatch += 1;
      entries.push({
        kind: "currency_mismatch",
        intentId: intent.id,
        purposeRef,
        intentCurrency: intent.reference.amount.currency,
        receiptEventIds: foreign.map((receipt) => receipt.eventId),
      });
    }

    const domestic = receipts.filter((receipt) => !foreign.includes(receipt));
    if (domestic.length === 0) continue;

    const netMinor = domestic.reduce((sum, receipt) => sum + receipt.amount.amountMinor, 0);
    const received = money(netMinor, intent.reference.amount.currency);
    const receiptEventIds = domestic.map((receipt) => receipt.eventId);
    const delta = netMinor - intent.reference.amount.amountMinor;

    if (delta === 0) {
      counts.matched += 1;
      entries.push({
        kind: "matched",
        intentId: intent.id,
        purposeRef,
        intentAmount: intent.reference.amount,
        received,
        receiptEventIds,
      });
    } else if (delta < 0) {
      counts.partial += 1;
      entries.push({
        kind: "partial_receipts",
        intentId: intent.id,
        purposeRef,
        intentAmount: intent.reference.amount,
        received,
        receiptEventIds,
      });
    } else {
      counts.overpaid += 1;
      entries.push({
        kind: "overpaid_intent",
        intentId: intent.id,
        purposeRef,
        intentAmount: intent.reference.amount,
        received,
        receiptEventIds,
      });
    }
  }

  for (const event of unattributed) {
    entries.push({
      kind: "unattributed_receipt",
      eventId: event.eventId,
      provider: event.provider,
      amount: event.amount,
    });
  }

  return {
    balanced:
      counts.partial === 0 &&
      counts.overpaid === 0 &&
      counts.currencyMismatch === 0 &&
      counts.unattributed === 0,
    counts,
    entries,
  };
}
