/**
 * M9 cashier desk (ADR-150): money parsing, server-function contracts over the M07 ledger, outbox delivery
 * (idempotent, server wins) and the screen itself
 * (frontend/src/components/app-shell/cashier-desk-screen).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CASHIER_PAYMENT_KIND,
  businessDate,
  classifyDatabaseError,
  dayCloseVariance,
  formatKobo,
  newIdempotencyKey,
  parseNairaToKobo,
} from "../../frontend/src/lib/scholar/cashier-desk";
import { createOutbox } from "../../frontend/src/lib/offline/outbox";
import type {
  OfflineDatabase,
  StoredOutboxRow,
} from "../../frontend/src/lib/offline/indexeddb-store";

vi.mock("@/lib/runtime/scholar/cashier.functions", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("../../frontend/src/lib/runtime/scholar/cashier.functions")
    >();
  return {
    ...real,
    getCashierDesk: vi.fn(),
    recordCashierPayment: vi.fn(),
    closeCashierDay: vi.fn(),
  };
});
vi.mock("@/components/app-shell/offline-controls", () => ({
  useOfflineScope: () => ({ tenantId: "org-a", userId: "cashier-1", role: "cashier" }),
}));

const { closeDay, loadCashierDesk, outcomeFromRpc, recordPayment } =
  await import("../../frontend/src/lib/runtime/scholar/cashier.functions");
const { CashierDeskScreen, cashierSender } =
  await import("../../frontend/src/components/app-shell/cashier-desk-screen");

const INVOICE = "11111111-1111-4111-8111-111111111111";
const CAMPUS = "22222222-2222-4222-8222-222222222222";

function fakeDb(
  tables: Record<string, unknown[]>,
  rpcResult: { data: unknown; error: unknown } = { data: {}, error: null },
) {
  const calls: { rpc: [string, Record<string, unknown>][]; filters: [string, string, unknown][] } =
    { rpc: [], filters: [] };
  const query = (table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const q: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    for (const op of ["eq", "gt", "gte", "in", "order", "limit"]) {
      q[op] = (column: string, value: unknown) => {
        calls.filters.push([table, `${op}:${column}`, value]);
        return q;
      };
    }
    return q;
  };
  return {
    calls,
    db: {
      from: (table: string) => ({ select: () => query(table) }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.rpc.push([name, args]);
        return rpcResult;
      },
    },
  };
}

describe("money is integer kobo, typed as naira", () => {
  it("parses plain naira amounts exactly", () => {
    expect(parseNairaToKobo("40,000")).toBe(4_000_000);
    expect(parseNairaToKobo("₦ 40,000.50")).toBe(4_000_050);
    expect(parseNairaToKobo("0.07")).toBe(7);
    expect(parseNairaToKobo("0", { allowZero: true })).toBe(0);
  });
  it("refuses ambiguous, negative, fractional-kobo and zero amounts", () => {
    for (const bad of ["", "-5", "1.234", "1e5", "abc", "0", "12.3.4", "10000000000"]) {
      expect(parseNairaToKobo(bad), bad).toBeNull();
    }
  });
  it("formats kobo and computes the drawer variance", () => {
    expect(formatKobo(4_000_050)).toBe("₦40,000.50");
    expect(formatKobo(-1000)).toBe("-₦10.00");
    expect(
      dayCloseVariance({ cashKobo: 600, posKobo: 1200 }, { cashKobo: 600, posKobo: 1190 }),
    ).toBe(-10);
  });
  it("uses the West Africa Time calendar day", () => {
    // 23:30 UTC on 17 Nov is 00:30 WAT on 18 Nov.
    expect(businessDate(Date.UTC(2026, 10, 17, 23, 30))).toBe("2026-11-18");
    expect(businessDate(Date.UTC(2026, 10, 17, 22, 30))).toBe("2026-11-17");
  });
  it("makes idempotency keys per kind and person", () => {
    expect(newIdempotencyKey(CASHIER_PAYMENT_KIND, "u1", () => "r1")).toBe("cashier.payment:u1:r1");
  });
});

describe("server functions over the ledger", () => {
  it("send only the invoice, the received amount, the method and the key (no amount owed, no organization)", async () => {
    const { db, calls } = fakeDb(
      {},
      { data: { payment_id: "p", receipt_number: 7, duplicate: false }, error: null },
    );
    const outcome = await recordPayment(db as never, {
      invoice_id: INVOICE,
      amount_kobo: 4_000_000,
      method: "cash",
      idempotency_key: "cashier.payment:u1:r1",
      school_id: "attacker-org",
      balance_kobo: 1,
    });
    expect(outcome).toMatchObject({ status: "recorded", duplicate: false, receiptNumber: 7 });
    expect(calls.rpc).toEqual([
      [
        "cg_fee_record_payment",
        {
          p_invoice_id: INVOICE,
          p_amount_kobo: 4_000_000,
          p_method: "cash",
          p_idempotency_key: "cashier.payment:u1:r1",
          p_external_reference: null,
        },
      ],
    ]);
  });
  it("refuses a non-integer or bank-transfer payment before the database", async () => {
    const { db } = fakeDb({});
    await expect(
      recordPayment(db as never, {
        invoice_id: INVOICE,
        amount_kobo: 10.5,
        method: "cash",
        idempotency_key: "k-12345678",
      }),
    ).rejects.toThrow();
    await expect(
      recordPayment(db as never, {
        invoice_id: INVOICE,
        amount_kobo: 10,
        method: "bank_transfer",
        idempotency_key: "k-12345678",
      }),
    ).rejects.toThrow();
  });
  it("turns database refusals into final outcomes and faults into retries", () => {
    expect(outcomeFromRpc(null, { code: "23514", message: "x" })).toMatchObject({
      status: "refused",
      code: "23514",
    });
    expect(outcomeFromRpc(null, { code: "42501", message: "x" })).toMatchObject({
      status: "refused",
    });
    expect(outcomeFromRpc(null, { code: "55000", message: "x" })).toMatchObject({
      status: "refused",
    });
    expect(() => outcomeFromRpc(null, { code: "08006", message: "x" })).toThrow(/stays queued/);
    expect(classifyDatabaseError({ code: "XX000" })).toBeNull();
  });
  it("closes the day with the scope read from the ledger, never from the browser", async () => {
    const { db, calls } = fakeDb(
      { cg_fee_invoice: [{ scope_ref: "scope-a" }, { scope_ref: "scope-a" }] },
      { data: { day_close_id: "d", duplicate: false }, error: null },
    );
    await closeDay(db as never, {
      campus_id: CAMPUS,
      business_date: "2026-11-18",
      counted_cash_kobo: 100,
      counted_pos_kobo: 0,
      idempotency_key: "cashier.day_close:u1:r1",
      scope_ref: "attacker-scope",
    });
    expect(calls.rpc[0]![0]).toBe("cg_fee_close_cash_day");
    expect(calls.rpc[0]![1]).toMatchObject({ p_scope_ref: "scope-a", p_campus_id: CAMPUS });
    expect(calls.rpc[0]![1]).not.toHaveProperty("p_expected_cash_kobo");
  });
  it("refuses a day close when no single ledger is visible for the campus", async () => {
    const { db, calls } = fakeDb({ cg_fee_invoice: [{ scope_ref: "a" }, { scope_ref: "b" }] });
    const outcome = await closeDay(db as never, {
      campus_id: CAMPUS,
      business_date: "2026-11-18",
      counted_cash_kobo: 0,
      counted_pos_kobo: 0,
      idempotency_key: "cashier.day_close:u1:r2",
    });
    expect(outcome.status).toBe("refused");
    expect(calls.rpc).toEqual([]);
  });
  it("loads today's open invoices and only this cashier's own drawer totals", async () => {
    const at = Date.UTC(2026, 10, 18, 10, 0);
    const { db, calls } = fakeDb({
      cg_fee_invoice_balances: [
        {
          invoice_id: INVOICE,
          campus_id: CAMPUS,
          subject_ref: "s1",
          principal_ref: "g1",
          invoiced_kobo: "1000",
          balance_kobo: "600",
        },
      ],
      cg_fee_payment: [
        { amount_kobo: 400, method: "cash", recorded_at: "2026-11-18T08:00:00Z" },
        { amount_kobo: 50, method: "pos", recorded_at: "2026-11-18T09:00:00Z" },
        { amount_kobo: 999, method: "cash", recorded_at: "2026-11-17T08:00:00Z" },
        { amount_kobo: 77, method: "bank_transfer", recorded_at: "2026-11-18T09:00:00Z" },
      ],
      cg_fee_cash_day_close: [],
    });
    const desk = await loadCashierDesk(db as never, "cashier-1", at);
    expect(desk.businessDate).toBe("2026-11-18");
    expect(desk.openInvoices[0]!.balance_kobo).toBe(600);
    expect(desk.mine).toEqual({ cashKobo: 400, posKobo: 50, count: 2 });
    expect(desk.closedToday).toBe(false);
    expect(calls.filters).toContainEqual(["cg_fee_payment", "eq:recorded_by", "cashier-1"]);
  });
});

function memoryDatabase(): OfflineDatabase {
  const rows = new Map<string, StoredOutboxRow>();
  const records = new Map<string, unknown>();
  return {
    readRecord: async (id: string) => records.get(id),
    writeRecord: async (id: string, scopeKey: string, value: unknown, cachedAt: string) =>
      void records.set(id, { scopeKey, value, cachedAt }),
    clear: async () => {
      rows.clear();
      records.clear();
    },
    readMutations: async (scopeKey: string) =>
      [...rows.values()].filter((r) => (r as { scopeKey: string }).scopeKey === scopeKey),
    writeMutation: async (row: StoredOutboxRow) => void rows.set((row as { id: string }).id, row),
    deleteMutation: async (id: string) => void rows.delete(id),
    deleteScope: async (scopeKey: string) => {
      for (const [id, r] of rows)
        if ((r as { scopeKey: string }).scopeKey === scopeKey) rows.delete(id);
    },
  } as unknown as OfflineDatabase;
}

describe("offline delivery through the SV1-LITE outbox", () => {
  const context = { userId: "cashier-1", organizationId: "org-a", role: "cashier" };
  const payment = {
    invoice_id: INVOICE,
    amount_kobo: 100,
    method: "cash",
    idempotency_key: "cashier.payment:cashier-1:r1",
  };

  it("one press is one payment: a re-enqueue of the same key is a duplicate and is sent once", async () => {
    const outbox = createOutbox({
      context,
      database: memoryDatabase(),
      lock: async (_n, run) => run(),
    });
    const send = vi.fn(async () => ({ status: "recorded" as const, duplicate: false }));
    expect(
      (await outbox.enqueue(CASHIER_PAYMENT_KIND, payment, payment.idempotency_key)).duplicate,
    ).toBe(false);
    expect(
      (await outbox.enqueue(CASHIER_PAYMENT_KIND, payment, payment.idempotency_key)).duplicate,
    ).toBe(true);
    const report = await outbox.drain({ [CASHIER_PAYMENT_KIND]: cashierSender(send) });
    expect(report.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    await outbox.drain({ [CASHIER_PAYMENT_KIND]: cashierSender(send) });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("server wins: a refusal is final and kept with its reason", async () => {
    const outbox = createOutbox({
      context,
      database: memoryDatabase(),
      lock: async (_n, run) => run(),
    });
    const send = vi.fn(async () => ({
      status: "refused" as const,
      code: "23514",
      reason: "Refused: over balance",
    }));
    await outbox.enqueue(CASHIER_PAYMENT_KIND, payment, payment.idempotency_key);
    const report = await outbox.drain({ [CASHIER_PAYMENT_KIND]: cashierSender(send) });
    expect(report.rejected).toHaveLength(1);
    const [row] = await outbox.list();
    expect(row!.state).toBe("failed");
    expect(row!.failure).toEqual({ reason: "Refused: over balance", rejectedByServer: true });
    expect(row!.payload).toEqual(payment);
  });

  it("a fault keeps the item queued for a retry", async () => {
    const outbox = createOutbox({
      context,
      database: memoryDatabase(),
      lock: async (_n, run) => run(),
    });
    const send = vi.fn(async () => {
      throw new Error("The ledger could not be reached; the item stays queued");
    });
    await outbox.enqueue(CASHIER_PAYMENT_KIND, payment, payment.idempotency_key);
    const report = await outbox.drain({ [CASHIER_PAYMENT_KIND]: cashierSender(send) });
    expect(report.sent).toBe(0);
    const [row] = await outbox.list();
    expect(row!.state).toBe("queued");
  });
});

describe("CashierDeskScreen", () => {
  it("renders both tasks, says refunds and reconciliation belong to someone else, and offers no refund", () => {
    const html = renderToStaticMarkup(<CashierDeskScreen />);
    expect(html).toContain('data-testid="cashier-desk-screen"');
    expect(html).toContain("Receive payment");
    expect(html).toContain("Day close");
    expect(html).toContain("Refunds and reconciliation are done by someone else");
    expect(html.toLowerCase()).not.toMatch(/>\s*refund\s*</);
    expect(html).toContain("Record payment");
    expect(html).toContain("Close my day");
  });
});
