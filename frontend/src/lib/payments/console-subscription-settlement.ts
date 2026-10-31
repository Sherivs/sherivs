/**
 * Settle Internal Console organization-subscription charges.
 * Webhook remains the source of truth; compare-and-set on pending rows.
 */
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import { CONSOLE_SUBSCRIPTION_PREFIX } from "../internal-console/operations";

const timeAuthority = new TimeAuthority(new SystemClock());
export const PAYSTACK_CURRENCY = "NGN";

export type ConsoleSubscriptionFacts = {
  reference: string;
  status: string | undefined;
  amountKobo: number | undefined;
  currency: string | undefined;
};

export type ConsoleSubscriptionOutcome =
  | { outcome: "settled"; subscriptionId: string; schoolId: string }
  | { outcome: "duplicate"; subscriptionId: string; schoolId: string }
  | { outcome: "rejected"; reason: string; subscriptionId?: string; schoolId?: string }
  | { outcome: "ignored"; reason: string };

type DbResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

export interface ConsoleSubscriptionDb {
  from(table: "subscriptions"): {
    select(cols: string): {
      eq(col: string, value: string): { maybeSingle(): DbResult<SubscriptionRow> };
    };
    update(patch: Record<string, unknown>): {
      eq(col: string, value: string): {
        eq(col: string, value: string): {
          select(cols: string): DbResult<Array<{ id: string }>>;
        };
      };
    };
  };
}

type SubscriptionRow = {
  id: string;
  school_id: string;
  amount_paid: number | string | null;
  status: string | null;
  paystack_reference: string | null;
};

export async function settleConsoleSubscription(
  db: ConsoleSubscriptionDb,
  facts: ConsoleSubscriptionFacts,
): Promise<ConsoleSubscriptionOutcome> {
  if (!facts.reference.startsWith(CONSOLE_SUBSCRIPTION_PREFIX)) {
    return { outcome: "ignored", reason: "not_console_subscription" };
  }
  if (facts.status !== "success") return { outcome: "ignored", reason: "charge_not_successful" };
  const { data: row, error } = await db
    .from("subscriptions")
    .select("id, school_id, amount_paid, status, paystack_reference")
    .eq("paystack_reference", facts.reference)
    .maybeSingle();
  if (error) return { outcome: "rejected", reason: error.message };
  if (!row) return { outcome: "ignored", reason: "subscription_not_found" };
  if (row.status === "active") {
    return { outcome: "duplicate", subscriptionId: row.id, schoolId: row.school_id };
  }
  if (row.status !== "pending") {
    return { outcome: "rejected", reason: "subscription_not_pending", subscriptionId: row.id, schoolId: row.school_id };
  }
  if ((facts.currency ?? PAYSTACK_CURRENCY).toUpperCase() !== PAYSTACK_CURRENCY) {
    return { outcome: "rejected", reason: "currency_mismatch", subscriptionId: row.id, schoolId: row.school_id };
  }
  const expected = Math.round(Number(row.amount_paid ?? 0) * 100);
  if (!Number.isFinite(facts.amountKobo) || facts.amountKobo !== expected) {
    return { outcome: "rejected", reason: "amount_mismatch", subscriptionId: row.id, schoolId: row.school_id };
  }
  const { data: updated, error: upErr } = await db
    .from("subscriptions")
    .update({ status: "active", started_at: timeAuthority.now().at })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");
  if (upErr) return { outcome: "rejected", reason: upErr.message, subscriptionId: row.id, schoolId: row.school_id };
  if (!updated?.length) {
    return { outcome: "duplicate", subscriptionId: row.id, schoolId: row.school_id };
  }
  return { outcome: "settled", subscriptionId: row.id, schoolId: row.school_id };
}
