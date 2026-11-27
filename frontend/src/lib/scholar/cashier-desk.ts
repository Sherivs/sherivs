/**
 * M9 cashier desk (ADR-150): pure rules shared by the screen, the outbox sender and the server functions.
 *
 * - Money is integer kobo end to end. The cashier types naira; `parseNairaToKobo` refuses anything that is not a
 *   plain positive amount with at most two decimals, so no float ever reaches the ledger.
 * - What is OWED never comes from the client: invoice balances are read from the M07 ledger, and the database refuses
 *   a payment above the outstanding balance. What the client sends is only the cash or POS amount actually received.
 * - Every queued item carries an idempotency key made once, at the moment the cashier presses the button; a replay of
 *   the same item is a duplicate on the server (`cg_fee_record_payment` / `cg_fee_close_cash_day`), never a second
 *   payment.
 * - Server wins: a refusal (permission, separation of duties, over-balance, closed day, key conflict) is final and is
 *   shown on the queued item; only network or unknown server faults are retried.
 */
import { z } from "zod";

export const CASHIER_PAYMENT_KIND = "cashier.payment";
export const CASHIER_DAY_CLOSE_KIND = "cashier.day_close";
/** The organization's business day is the West Africa Time calendar day (no daylight saving). */
export const BUSINESS_TIME_ZONE = "Africa/Lagos";
const MAX_KOBO = 100_000_000_000; // NGN 1 billion: far above any single receipt, keeps values safe integers

export const cashierPaymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount_kobo: z.number().int().positive().max(MAX_KOBO),
  method: z.enum(["cash", "pos"]),
  idempotency_key: z.string().trim().min(8).max(200),
  external_reference: z.string().trim().min(1).max(200).optional(),
});
export type CashierPayment = z.infer<typeof cashierPaymentSchema>;

export const cashierDayCloseSchema = z.object({
  campus_id: z.string().uuid(),
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  counted_cash_kobo: z.number().int().min(0).max(MAX_KOBO),
  counted_pos_kobo: z.number().int().min(0).max(MAX_KOBO),
  idempotency_key: z.string().trim().min(8).max(200),
  note: z.string().trim().min(1).max(500).optional(),
});
export type CashierDayClose = z.infer<typeof cashierDayCloseSchema>;

/** "40,000", "40000.5", "₦ 40,000.50" -> kobo. Returns null for anything ambiguous or not positive. */
export function parseNairaToKobo(input: string, { allowZero = false } = {}): number | null {
  const cleaned = input.replace(/[₦,\s]/g, "").replace(/^NGN/i, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const kobo = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(kobo) || kobo > MAX_KOBO) return null;
  if (kobo === 0 && !allowZero) return null;
  return kobo;
}

export function formatKobo(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const abs = Math.abs(kobo);
  const naira = Math.floor(abs / 100).toLocaleString("en-NG");
  return `${sign}₦${naira}.${String(abs % 100).padStart(2, "0")}`;
}

/** Calendar date (YYYY-MM-DD) of an instant in the business time zone. */
export function businessDate(atMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(atMs);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** One key per press of the button: kind, actor and a random part, so two cashiers never collide. */
export function newIdempotencyKey(kind: string, userId: string, random: () => string): string {
  return `${kind}:${userId}:${random()}`;
}

/** SQLSTATEs the database uses for a final refusal. Anything else is a fault worth retrying. */
const FINAL_REFUSALS: Record<string, string> = {
  "42501": "Not allowed: your role cannot do this here, or separation of duties applies",
  "23514": "Refused: the amount is above what is still owed on this invoice",
  "23505": "Refused: this item was already recorded with different details",
  "22023": "Refused: the details are not valid",
  "55000": "Refused: your cash day is already closed",
  "23503": "Refused: the invoice or campus no longer exists",
};

export type DeskOutcome =
  | {
      status: "recorded";
      duplicate: boolean;
      receiptNumber?: number;
      detail?: Record<string, string | number | boolean | null>;
    }
  | { status: "refused"; code: string; reason: string };

export function classifyDatabaseError(error: {
  code?: string;
  message?: string;
}): DeskOutcome | null {
  const code = error.code ?? "";
  const reason = FINAL_REFUSALS[code];
  return reason ? { status: "refused", code, reason } : null;
}

/** Day-close variance, shown before the cashier confirms (the server recomputes the expected side). */
export function dayCloseVariance(
  expected: { cashKobo: number; posKobo: number },
  counted: { cashKobo: number; posKobo: number },
): number {
  return counted.cashKobo + counted.posKobo - (expected.cashKobo + expected.posKobo);
}
