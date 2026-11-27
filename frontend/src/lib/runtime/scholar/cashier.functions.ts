/**
 * M9 cashier desk server functions (ADR-150), over the applied M07 fees ledger.
 *
 * Every call runs with the signed-in person's own Supabase session, so the database derives the organization, checks
 * the cashier role and the campus scope, enforces separation of duties and computes what is owed. No amount owed, no
 * expected cash total and no organization id is accepted from the browser. Refusals come back as data (server wins) so
 * the offline outbox can show them on the queued item; only faults are thrown (and retried).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import {
  businessDate,
  cashierDayCloseSchema,
  cashierPaymentSchema,
  classifyDatabaseError,
  type DeskOutcome,
} from "@/lib/scholar/cashier-desk";

const timeAuthority = new TimeAuthority(new SystemClock());

type DbError = { code?: string; message: string } | null;
type Rows<T> = PromiseLike<{ data: T[] | null; error: DbError }>;
interface Query<T> extends Rows<T> {
  eq(column: string, value: string): Query<T>;
  gt(column: string, value: number | string): Query<T>;
  gte(column: string, value: string): Query<T>;
  in(column: string, values: string[]): Query<T>;
  order(column: string, options?: { ascending: boolean }): Query<T>;
  limit(count: number): Query<T>;
}
export interface FinanceDb {
  from<T>(table: string): { select(columns: string): Query<T> };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>;
}

export interface OpenInvoice {
  invoice_id: string;
  campus_id: string;
  subject_ref: string;
  principal_ref: string;
  invoiced_kobo: number;
  balance_kobo: number;
}
export interface CashierDesk {
  businessDate: string;
  openInvoices: OpenInvoice[];
  campuses: string[];
  mine: { cashKobo: number; posKobo: number; count: number };
  closedToday: boolean;
}

export function outcomeFromRpc(data: unknown, error: DbError): DeskOutcome {
  if (error) {
    const refused = classifyDatabaseError(error);
    if (refused) return refused;
    throw new Error("The ledger could not be reached; the item stays queued");
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const detail: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      detail[key] = value as string | number | boolean | null;
    }
  }
  return {
    status: "recorded",
    duplicate: row.duplicate === true,
    ...(typeof row.receipt_number === "number" ? { receiptNumber: row.receipt_number } : {}),
    detail,
  };
}

export async function loadCashierDesk(
  db: FinanceDb,
  userId: string,
  atMs: number,
): Promise<CashierDesk> {
  const today = businessDate(atMs);
  const since = new Date(atMs - 36 * 60 * 60 * 1000).toISOString();
  const [invoices, payments, closes] = await Promise.all([
    db
      .from<OpenInvoice>("cg_fee_invoice_balances")
      .select("invoice_id, campus_id, subject_ref, principal_ref, invoiced_kobo, balance_kobo")
      .gt("balance_kobo", 0)
      .order("balance_kobo", { ascending: false })
      .limit(200),
    db
      .from<{ amount_kobo: number; method: string; recorded_at: string }>("cg_fee_payment")
      .select("amount_kobo, method, recorded_at")
      .eq("recorded_by", userId)
      .gte("recorded_at", since),
    db
      .from<{ business_date: string }>("cg_fee_cash_day_close")
      .select("business_date")
      .eq("cashier_id", userId)
      .eq("business_date", today),
  ]);
  for (const result of [invoices, payments, closes]) {
    if (result.error) throw new Error("Cashier desk could not be loaded");
  }
  const mine = { cashKobo: 0, posKobo: 0, count: 0 };
  for (const p of payments.data ?? []) {
    if (businessDate(Date.parse(p.recorded_at)) !== today) continue;
    if (p.method === "cash") mine.cashKobo += Number(p.amount_kobo);
    else if (p.method === "pos") mine.posKobo += Number(p.amount_kobo);
    else continue;
    mine.count += 1;
  }
  const openInvoices = (invoices.data ?? []).map((i) => ({
    ...i,
    invoiced_kobo: Number(i.invoiced_kobo),
    balance_kobo: Number(i.balance_kobo),
  }));
  return {
    businessDate: today,
    openInvoices,
    campuses: [...new Set(openInvoices.map((i) => i.campus_id))],
    mine,
    closedToday: (closes.data ?? []).length > 0,
  };
}

export async function recordPayment(db: FinanceDb, input: unknown): Promise<DeskOutcome> {
  const data = cashierPaymentSchema.parse(input);
  const { data: result, error } = await db.rpc("cg_fee_record_payment", {
    p_invoice_id: data.invoice_id,
    p_amount_kobo: data.amount_kobo,
    p_method: data.method,
    p_idempotency_key: data.idempotency_key,
    p_external_reference: data.external_reference ?? null,
  });
  return outcomeFromRpc(result, error);
}

export async function closeDay(db: FinanceDb, input: unknown): Promise<DeskOutcome> {
  const data = cashierDayCloseSchema.parse(input);
  // The financial scope is read from the ledger the person can see on that campus, never sent by the browser.
  const { data: scopes, error: scopeError } = await db
    .from<{ scope_ref: string }>("cg_fee_invoice")
    .select("scope_ref")
    .eq("campus_id", data.campus_id)
    .limit(50);
  if (scopeError) throw new Error("The ledger could not be reached; the item stays queued");
  const distinct = [...new Set((scopes ?? []).map((s) => s.scope_ref))];
  if (distinct.length !== 1) {
    return {
      status: "refused",
      code: "scope",
      reason: "No single fee ledger is visible for this campus",
    };
  }
  const { data: result, error } = await db.rpc("cg_fee_close_cash_day", {
    p_scope_ref: distinct[0],
    p_campus_id: data.campus_id,
    p_business_date: data.business_date,
    p_counted_cash_kobo: data.counted_cash_kobo,
    p_counted_pos_kobo: data.counted_pos_kobo,
    p_idempotency_key: data.idempotency_key,
    p_note: data.note ?? null,
  });
  return outcomeFromRpc(result, error);
}

export const getCashierDesk = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    loadCashierDesk(
      context.supabase as unknown as FinanceDb,
      context.userId,
      timeAuthority.now().atMs,
    ),
  );

export const recordCashierPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => cashierPaymentSchema.parse(input))
  .handler(async ({ data, context }) =>
    recordPayment(context.supabase as unknown as FinanceDb, data),
  );

export const closeCashierDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => cashierDayCloseSchema.parse(input))
  .handler(async ({ data, context }) => closeDay(context.supabase as unknown as FinanceDb, data));
