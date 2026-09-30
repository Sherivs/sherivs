/**
 * CoreGrid — the financial journal (Phase 13, domain-neutral).
 *
 * The blueprint's final principle: money is state that requires proof, not merely
 * data in a database. This module is that proof layer. It keeps three things that
 * financial systems usually lose:
 *
 *   - an append-only event record per aggregate, with sequence, causation and
 *     correlation, so any financial object can be reconstructed and explained;
 *   - a transactional outbox, so a domain event is durable before it is published
 *     and no consumer ever learns about money that was not recorded;
 *   - a double-entry-compatible posting that refuses to post money out of balance,
 *     so a later accounting subsystem can consume the same events instead of the
 *     ledger being "approximated" by an arbitrary balance field.
 */
import { compareMoney, money, type Money } from "./financial-core";

export type FinancialAggregateType =
  | "obligation"
  | "invoice"
  | "payment"
  | "split"
  | "refund"
  | "credit"
  | "adjustment"
  | "settlement";

export type FinancialEventType =
  | "obligation.created"
  | "invoice.issued"
  | "invoice.voided"
  | "payment.intent-created"
  | "payment.attempt-recorded"
  | "payment.confirmed"
  | "payment.failed"
  | "payment.unresolved"
  | "split.created"
  | "split.leg-settled"
  | "split.leg-unresolved"
  | "refund.requested"
  | "refund.processed"
  | "credit.created"
  | "credit.applied"
  | "adjustment.recorded"
  | "tax.calculated"
  | "reconciliation.completed"
  | "reconciliation.exception-resolved";

export interface FinancialActor {
  readonly identityId: string;
  readonly kind: "human" | "agent" | "service";
}

export interface FinancialEvent {
  readonly eventId: string;
  readonly aggregateType: FinancialAggregateType;
  readonly aggregateId: string;
  /** Per-aggregate sequence: 1, 2, 3 … with no gaps and no reuse. */
  readonly sequence: number;
  /** Schema version of the payload, so consumers evolve without guessing. */
  readonly version: number;
  readonly type: FinancialEventType;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actor: FinancialActor;
  /** What caused this event, when another event did. */
  readonly causationId: string | null;
  /** Ties a whole financial operation together across services. */
  readonly correlationId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface FinancialJournal {
  readonly events: readonly FinancialEvent[];
}

export type AppendEventProblem =
  | "duplicate-event-id"
  | "sequence-out-of-order"
  | "sequence-gap"
  | "version-regression"
  | "missing-correlation"
  | "missing-actor";

export type AppendEventResult =
  | { readonly ok: true; readonly journal: FinancialJournal; readonly event: FinancialEvent }
  | {
      readonly ok: false;
      readonly problems: readonly AppendEventProblem[];
      readonly detail: string;
    };

/** Append one event. The journal never rewrites and never removes an event. */
export function appendFinancialEvent(
  journal: FinancialJournal,
  event: FinancialEvent,
): AppendEventResult {
  const problems: AppendEventProblem[] = [];
  if (journal.events.some((existing) => existing.eventId === event.eventId))
    problems.push("duplicate-event-id");
  if (!event.correlationId?.trim()) problems.push("missing-correlation");
  if (!event.actor?.identityId?.trim()) problems.push("missing-actor");

  const siblings = journal.events.filter(
    (existing) =>
      existing.aggregateType === event.aggregateType && existing.aggregateId === event.aggregateId,
  );
  const last = siblings.reduce<FinancialEvent | null>(
    (highest, candidate) =>
      !highest || candidate.sequence > highest.sequence ? candidate : highest,
    null,
  );
  if (!last) {
    if (event.sequence !== 1) problems.push("sequence-gap");
  } else {
    if (event.sequence <= last.sequence) problems.push("sequence-out-of-order");
    else if (event.sequence !== last.sequence + 1) problems.push("sequence-gap");
    if (event.version < last.version) problems.push("version-regression");
  }

  if (problems.length > 0) {
    return {
      ok: false,
      problems: [...new Set(problems)],
      detail: describeAppendProblems(problems, event),
    };
  }
  return { ok: true, journal: { events: [...journal.events, event] }, event };
}

export function describeAppendProblems(
  problems: readonly AppendEventProblem[],
  event: FinancialEvent,
): string {
  const reasons: Record<AppendEventProblem, string> = {
    "duplicate-event-id":
      "an event with this identity was already recorded: money is never recorded twice",
    "sequence-out-of-order": "the sequence does not advance past the aggregate's last event",
    "sequence-gap": "the sequence skips a position, so the aggregate's history would have a hole",
    "version-regression": "the payload version regresses below the aggregate's recorded version",
    "missing-correlation": "an event must carry the correlation that ties the operation together",
    "missing-actor": "an event must name the identity that caused it",
  };
  return `${event.aggregateType} ${event.aggregateId}: ${[...new Set(problems)].map((problem) => reasons[problem]).join("; ")}`;
}

export function eventsFor(
  journal: FinancialJournal,
  aggregateType: FinancialAggregateType,
  aggregateId: string,
): readonly FinancialEvent[] {
  return journal.events
    .filter((event) => event.aggregateType === aggregateType && event.aggregateId === aggregateId)
    .sort((a, b) => a.sequence - b.sequence);
}

export interface JournalIntegrityReport {
  readonly ok: boolean;
  readonly aggregates: number;
  readonly events: number;
  readonly problems: readonly string[];
}

/** Verify the journal's own integrity: contiguous sequences, no duplicates, no time travel. */
export function verifyJournalIntegrity(journal: FinancialJournal): JournalIntegrityReport {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const byAggregate = new Map<string, FinancialEvent[]>();

  for (const event of journal.events) {
    if (seenIds.has(event.eventId)) problems.push(`duplicate event id ${event.eventId}`);
    seenIds.add(event.eventId);
    if (!event.correlationId?.trim())
      problems.push(`event ${event.eventId} carries no correlation`);
    const key = `${event.aggregateType}:${event.aggregateId}`;
    byAggregate.set(key, [...(byAggregate.get(key) ?? []), event]);
  }

  for (const [key, list] of byAggregate) {
    const ordered = [...list].sort((a, b) => a.sequence - b.sequence);
    ordered.forEach((event, index) => {
      if (event.sequence !== index + 1) {
        problems.push(`${key} sequence ${event.sequence} where ${index + 1} was expected`);
      }
      if (index > 0 && event.recordedAt < ordered[index - 1].recordedAt) {
        problems.push(`${key} event ${event.eventId} was recorded before its predecessor`);
      }
    });
  }

  return {
    ok: problems.length === 0,
    aggregates: byAggregate.size,
    events: journal.events.length,
    problems,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Transactional outbox (BU, BV, BW)
 * ────────────────────────────────────────────────────────────*/

export interface OutboxEntry {
  readonly entryId: string;
  readonly eventId: string;
  readonly status: "pending" | "published" | "failed";
  readonly attempts: number;
  readonly lastAttemptAt: string | null;
}

export interface FinancialOutbox {
  readonly entries: readonly OutboxEntry[];
}

export type EnqueueOutboxResult =
  | { readonly ok: true; readonly outbox: FinancialOutbox }
  | { readonly ok: false; readonly error: string };

/**
 * Enqueue the event in the same unit of work as the state change it describes.
 * The same event can never enter the outbox twice.
 */
export function enqueueOutbox(outbox: FinancialOutbox, event: FinancialEvent): EnqueueOutboxResult {
  if (outbox.entries.some((entry) => entry.eventId === event.eventId)) {
    return {
      ok: false,
      error: `event ${event.eventId} is already queued: a financial event is published once`,
    };
  }
  return {
    ok: true,
    outbox: {
      entries: [
        ...outbox.entries,
        {
          entryId: `outbox:${event.eventId}`,
          eventId: event.eventId,
          status: "pending",
          attempts: 0,
          lastAttemptAt: null,
        },
      ],
    },
  };
}

export function markOutboxPublished(
  outbox: FinancialOutbox,
  entryId: string,
  at: string,
): FinancialOutbox {
  return {
    entries: outbox.entries.map((entry) =>
      entry.entryId === entryId
        ? {
            ...entry,
            status: "published" as const,
            attempts: entry.attempts + 1,
            lastAttemptAt: at,
          }
        : entry,
    ),
  };
}

export function markOutboxFailed(
  outbox: FinancialOutbox,
  entryId: string,
  at: string,
): FinancialOutbox {
  return {
    entries: outbox.entries.map((entry) =>
      entry.entryId === entryId
        ? { ...entry, status: "failed" as const, attempts: entry.attempts + 1, lastAttemptAt: at }
        : entry,
    ),
  };
}

export function pendingOutbox(outbox: FinancialOutbox): readonly OutboxEntry[] {
  return outbox.entries.filter((entry) => entry.status !== "published");
}

/* ─────────────────────────────────────────────────────────────
 * Reconstruction (BD) and double-entry compatibility (BE)
 * ────────────────────────────────────────────────────────────*/

export interface ObligationProjection {
  readonly known: boolean;
  readonly obligationId: string;
  readonly charged: Money;
  readonly paid: Money;
  readonly refunded: Money;
  readonly credited: Money;
  readonly outstanding: Money;
  readonly currency: string | null;
  /** The events that produced this projection, in order — the proof of the number. */
  readonly evidence: readonly string[];
}

function amountFrom(payload: Readonly<Record<string, unknown>>, key: string): number {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function currencyFrom(payload: Readonly<Record<string, unknown>>): string | null {
  const value = payload.currency;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Rebuild an obligation's money state from its events alone. A missing history is
 * reported as unknown rather than as a zero balance.
 */
export function reconstructObligation(
  journal: FinancialJournal,
  obligationId: string,
): ObligationProjection {
  const events = journal.events
    .filter(
      (event) => event.aggregateId === obligationId || event.payload.obligationId === obligationId,
    )
    .sort((a, b) =>
      a.occurredAt === b.occurredAt
        ? a.sequence - b.sequence
        : a.occurredAt.localeCompare(b.occurredAt),
    );

  if (events.length === 0) {
    return {
      known: false,
      obligationId,
      charged: money(0, "XXX"),
      paid: money(0, "XXX"),
      refunded: money(0, "XXX"),
      credited: money(0, "XXX"),
      outstanding: money(0, "XXX"),
      currency: null,
      evidence: [],
    };
  }

  let currency: string | null = null;
  let chargedMinor = 0;
  let paidMinor = 0;
  let refundedMinor = 0;
  let creditedMinor = 0;

  for (const event of events) {
    currency = currency || currencyFrom(event.payload);
    switch (event.type) {
      case "obligation.created":
      case "invoice.issued":
        chargedMinor += amountFrom(event.payload, "amountMinor");
        break;
      case "payment.confirmed":
        paidMinor += amountFrom(event.payload, "amountMinor");
        break;
      case "refund.processed":
        refundedMinor += amountFrom(event.payload, "amountMinor");
        break;
      case "credit.applied":
        creditedMinor += amountFrom(event.payload, "amountMinor");
        break;
      default:
        break;
    }
  }

  const resolved = currency ?? "XXX";
  return {
    known: true,
    obligationId,
    charged: money(chargedMinor, resolved),
    paid: money(paidMinor, resolved),
    refunded: money(refundedMinor, resolved),
    credited: money(creditedMinor, resolved),
    outstanding: money(
      Math.max(chargedMinor - paidMinor - creditedMinor + refundedMinor, 0),
      resolved,
    ),
    currency,
    evidence: events.map((event) => event.eventId),
  };
}

export interface ProjectionMismatch {
  readonly field: string;
  readonly projectedMinor: number;
  readonly snapshotMinor: number;
}

/**
 * Compare a reconstructed projection with a cached snapshot. A mismatch is
 * reported, never resolved in favour of the cache: the events are the proof.
 */
export function compareProjectionToSnapshot(
  projection: ObligationProjection,
  snapshot: {
    readonly chargedMinor: number;
    readonly paidMinor: number;
    readonly outstandingMinor: number;
  },
): readonly ProjectionMismatch[] {
  const pairs: readonly [string, number, number][] = [
    ["charged", projection.charged.amountMinor, snapshot.chargedMinor],
    ["paid", projection.paid.amountMinor, snapshot.paidMinor],
    ["outstanding", projection.outstanding.amountMinor, snapshot.outstandingMinor],
  ];
  return pairs
    .filter(([, projected, snapshotted]) => projected !== snapshotted)
    .map(([field, projectedMinor, snapshotMinor]) => ({ field, projectedMinor, snapshotMinor }));
}

export const LEDGER_ACCOUNTS = [
  "accounts-receivable",
  "cash",
  "payment-clearing",
  "refunds-payable",
  "revenue",
  "tax-payable",
  "provider-fees",
  "platform-fees",
  "beneficiary-payable",
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

export interface LedgerLine {
  readonly account: LedgerAccount;
  readonly direction: "debit" | "credit";
  readonly amount: Money;
}

export interface DoubleEntryPosting {
  readonly entryId: string;
  readonly occurredAt: string;
  readonly lines: readonly LedgerLine[];
  readonly currency: string;
  readonly totalDebitMinor: number;
  readonly totalCreditMinor: number;
}

export type PostingResult =
  | { readonly ok: true; readonly posting: DoubleEntryPosting }
  | { readonly ok: false; readonly error: string };

/** Debits must equal credits, in one currency, with no negative line. */
export function postDoubleEntry(input: {
  readonly entryId: string;
  readonly occurredAt: string;
  readonly lines: readonly LedgerLine[];
}): PostingResult {
  if (input.lines.length < 2) {
    return { ok: false, error: "a posting needs at least one debit and one credit" };
  }
  const currencies = [...new Set(input.lines.map((line) => line.amount.currency))];
  if (currencies.length !== 1) {
    return {
      ok: false,
      error: "a posting must be single-currency: convert explicitly and record the rate",
    };
  }
  const negative = input.lines.find((line) => line.amount.amountMinor < 0);
  if (negative) {
    return { ok: false, error: "a ledger line cannot be negative: use the opposite direction" };
  }
  const debit = input.lines
    .filter((line) => line.direction === "debit")
    .reduce((total, line) => total + line.amount.amountMinor, 0);
  const credit = input.lines
    .filter((line) => line.direction === "credit")
    .reduce((total, line) => total + line.amount.amountMinor, 0);
  if (debit !== credit) {
    return {
      ok: false,
      error: `posting does not balance: debits ${debit} against credits ${credit} — an unbalanced posting is refused, never rounded`,
    };
  }
  return {
    ok: true,
    posting: {
      entryId: input.entryId,
      occurredAt: input.occurredAt,
      lines: input.lines,
      currency: currencies[0],
      totalDebitMinor: debit,
      totalCreditMinor: credit,
    },
  };
}

/** A posting is balanced when its debits equal its credits in one currency. */
export function isPostingBalanced(posting: DoubleEntryPosting): boolean {
  const debit = posting.lines
    .filter((line) => line.direction === "debit")
    .reduce((total, line) => total + line.amount.amountMinor, 0);
  const credit = posting.lines
    .filter((line) => line.direction === "credit")
    .reduce((total, line) => total + line.amount.amountMinor, 0);
  return compareMoney(money(debit, posting.currency), money(credit, posting.currency)) === 0;
}
