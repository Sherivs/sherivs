/**
 * M9 cashier desk (ADR-119): receive cash or POS against an open invoice, and close the day with a drawer count.
 * Works offline: every action is queued in the SV1-LITE outbox (ADR-109) with an idempotency key made when the
 * button is pressed, and sent when the connection returns. The server decides what is owed, the receipt number and
 * the expected drawer total; a refusal is shown on the queued item and never retried (server wins).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { contextFromScope } from "@/lib/offline/context-exit";
import {
  createOutbox,
  OUTBOX_STATUS_EVENT,
  registerOutboxSender,
  type OutboxRecord,
  type OutboxSender,
} from "@/lib/offline/outbox";
import {
  CASHIER_DAY_CLOSE_KIND,
  CASHIER_PAYMENT_KIND,
  businessDate,
  dayCloseVariance,
  formatKobo,
  newIdempotencyKey,
  parseNairaToKobo,
  type CashierDayClose,
  type CashierPayment,
  type DeskOutcome,
} from "@/lib/scholar/cashier-desk";
import {
  closeCashierDay,
  getCashierDesk,
  recordCashierPayment,
  type CashierDesk,
} from "@/lib/runtime/scholar/cashier.functions";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import { useOfflineScope } from "./offline-controls";

const timeAuthority = new TimeAuthority(new SystemClock());
const randomKey = () => globalThis.crypto.randomUUID();

/** Outbox delivery for the two cashier kinds: refusals are final, faults are retried by the outbox. */
export function cashierSender(
  send: (kind: string, payload: unknown) => Promise<DeskOutcome>,
): OutboxSender {
  return async ({ kind, payload }) => {
    const outcome = await send(kind, payload);
    return outcome.status === "recorded"
      ? { outcome: "sent" }
      : { outcome: "rejected", reason: outcome.reason };
  };
}

const deliver = (kind: string, payload: unknown): Promise<DeskOutcome> =>
  kind === CASHIER_PAYMENT_KIND
    ? recordCashierPayment({ data: payload as CashierPayment })
    : closeCashierDay({ data: payload as CashierDayClose });

export function CashierDeskScreen() {
  const scope = useOfflineScope();
  const outbox = useMemo(
    () => (scope ? createOutbox({ context: contextFromScope(scope) }) : null),
    [scope],
  );
  const [desk, setDesk] = useState<CashierDesk | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queued, setQueued] = useState<OutboxRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "pos">("cash");
  const [countedCash, setCountedCash] = useState("");
  const [countedPos, setCountedPos] = useState("");
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    try {
      setDesk(await getCashierDesk());
      setLoadError(null);
    } catch {
      setLoadError(
        "Offline or unavailable: open invoices cannot be loaded. Queued work is kept and sent later.",
      );
    }
    if (outbox) {
      const rows = await outbox.list();
      setQueued(
        rows.filter((r) => r.kind === CASHIER_PAYMENT_KIND || r.kind === CASHIER_DAY_CLOSE_KIND),
      );
    }
  }, [outbox]);

  const sync = useCallback(async () => {
    if (!outbox) return;
    await outbox.drain({
      [CASHIER_PAYMENT_KIND]: cashierSender(deliver),
      [CASHIER_DAY_CLOSE_KIND]: cashierSender(deliver),
    });
    await refresh();
  }, [outbox, refresh]);

  useEffect(() => {
    const offPayment = registerOutboxSender(CASHIER_PAYMENT_KIND, cashierSender(deliver));
    const offClose = registerOutboxSender(CASHIER_DAY_CLOSE_KIND, cashierSender(deliver));
    void refresh();
    const onStatus = () => void refresh();
    const onOnline = () => void sync();
    window.addEventListener(OUTBOX_STATUS_EVENT, onStatus);
    window.addEventListener("online", onOnline);
    return () => {
      offPayment();
      offClose();
      window.removeEventListener(OUTBOX_STATUS_EVENT, onStatus);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh, sync]);

  if (!scope || !outbox) {
    return (
      <section className="app-shell-section" data-testid="cashier-desk-screen">
        <h1>Cashier desk</h1>
        <p role="status">Sign in to an organization to use the cashier desk.</p>
      </section>
    );
  }

  const selected = desk?.openInvoices.find((i) => i.invoice_id === invoiceId) ?? null;
  const amountKobo = parseNairaToKobo(amount);
  const cashKobo = parseNairaToKobo(countedCash, { allowZero: true });
  const posKobo = parseNairaToKobo(countedPos, { allowZero: true });
  const today = desk?.businessDate ?? businessDate(timeAuthority.now().atMs);
  const campus = selected?.campus_id ?? desk?.campuses[0] ?? null;

  async function receive() {
    if (!outbox || !selected || amountKobo === null) return;
    const payload: CashierPayment = {
      invoice_id: selected.invoice_id,
      amount_kobo: amountKobo,
      method,
      idempotency_key: newIdempotencyKey(CASHIER_PAYMENT_KIND, scope!.userId, randomKey),
    };
    await outbox.enqueue(CASHIER_PAYMENT_KIND, payload, payload.idempotency_key, {
      label: `${method === "cash" ? "Cash" : "POS"} ${formatKobo(amountKobo)} for ${selected.subject_ref}`,
    });
    setAmount("");
    setMessage(
      "Payment queued. It is recorded and a receipt number issued as soon as the server confirms it.",
    );
    await sync();
  }

  async function closeDay() {
    if (!outbox || !campus || cashKobo === null || posKobo === null) return;
    const payload: CashierDayClose = {
      campus_id: campus,
      business_date: today,
      counted_cash_kobo: cashKobo,
      counted_pos_kobo: posKobo,
      idempotency_key: newIdempotencyKey(CASHIER_DAY_CLOSE_KIND, scope!.userId, randomKey),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    await outbox.enqueue(CASHIER_DAY_CLOSE_KIND, payload, payload.idempotency_key, {
      label: `Day close ${today}`,
    });
    setMessage(
      "Day close queued. The expected total is recomputed from the ledger when it is recorded.",
    );
    await sync();
  }

  const variance =
    desk && cashKobo !== null && posKobo !== null
      ? dayCloseVariance(
          { cashKobo: desk.mine.cashKobo, posKobo: desk.mine.posKobo },
          { cashKobo, posKobo },
        )
      : null;

  return (
    <section className="app-shell-section" data-testid="cashier-desk-screen">
      <h1>Cashier desk</h1>
      <p>
        Business day {today}. Payments and the day close work offline and are sent when you are back
        online. Refunds and reconciliation are done by someone else.
      </p>
      {loadError ? <p role="status">{loadError}</p> : null}
      {message ? (
        <p role="status" aria-live="polite">
          {message}
        </p>
      ) : null}

      <h2>Receive payment</h2>
      {desk?.closedToday ? (
        <p role="status">Your cash day is closed. New cash and POS payments start tomorrow.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void receive();
          }}
        >
          <label>
            Invoice
            <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} required>
              <option value="">Choose an open invoice</option>
              {(desk?.openInvoices ?? []).map((i) => (
                <option key={i.invoice_id} value={i.invoice_id}>
                  {i.subject_ref}, owes {formatKobo(i.balance_kobo)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount received (₦)
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={amount !== "" && amountKobo === null}
              required
            />
          </label>
          <fieldset>
            <legend>Method</legend>
            <label>
              <input type="radio" checked={method === "cash"} onChange={() => setMethod("cash")} />{" "}
              Cash
            </label>
            <label>
              <input type="radio" checked={method === "pos"} onChange={() => setMethod("pos")} />{" "}
              POS
            </label>
          </fieldset>
          {selected && amountKobo !== null && amountKobo > selected.balance_kobo ? (
            <p role="alert">
              That is more than is owed ({formatKobo(selected.balance_kobo)}); the server will
              refuse it.
            </p>
          ) : null}
          <button type="submit" disabled={!selected || amountKobo === null}>
            Record payment
          </button>
        </form>
      )}

      <h2>Day close</h2>
      <p>
        Recorded by you today: cash {formatKobo(desk?.mine.cashKobo ?? 0)}, POS{" "}
        {formatKobo(desk?.mine.posKobo ?? 0)} ({desk?.mine.count ?? 0} payments).
      </p>
      {desk?.closedToday ? (
        <p role="status">Closed for {today}. A bursar or accountant reconciles it.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void closeDay();
          }}
        >
          <label>
            Cash counted in the drawer (₦)
            <input
              inputMode="decimal"
              value={countedCash}
              onChange={(e) => setCountedCash(e.target.value)}
              required
            />
          </label>
          <label>
            POS slips total (₦)
            <input
              inputMode="decimal"
              value={countedPos}
              onChange={(e) => setCountedPos(e.target.value)}
              required
            />
          </label>
          <label>
            Note (needed if the count differs)
            <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
          {variance !== null && variance !== 0 ? (
            <p role="alert">Difference from your recorded total: {formatKobo(variance)}.</p>
          ) : null}
          <button type="submit" disabled={!campus || cashKobo === null || posKobo === null}>
            Close my day
          </button>
        </form>
      )}

      <h2>Queued and recent</h2>
      {queued.length === 0 ? (
        <p>Nothing waiting.</p>
      ) : (
        <ul>
          {queued.map((row) => (
            <li key={row.id}>
              {row.label ?? row.kind}: {row.state}
              {row.failure ? ` (${row.failure.reason})` : ""}
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => void sync()}>
        Send queued work now
      </button>
    </section>
  );
}
