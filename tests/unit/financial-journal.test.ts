/**
 * CoreGrid — Phase 13 financial journal unit tests (financial-journal).
 *
 * The laws under test (Phase 13 BB–BW):
 * - the journal is append-only: no duplicate identity, no sequence hole, no
 *   version regression, and every event names its cause, correlation and actor;
 * - a domain event is durable in the outbox before it is published, and the same
 *   event never enters the queue twice;
 * - an obligation's money state is reconstructed from its events, and a missing
 *   history is reported as unknown rather than as a zero balance;
 * - a cached snapshot that disagrees with the reconstruction is reported, never
 *   allowed to overrule the events;
 * - a ledger posting must balance, in one currency, with no negative line.
 */

import { describe, expect, it } from "vitest";
import { money } from "@/lib/financial-core";
import {
  appendFinancialEvent,
  compareProjectionToSnapshot,
  enqueueOutbox,
  isPostingBalanced,
  markOutboxFailed,
  markOutboxPublished,
  pendingOutbox,
  postDoubleEntry,
  reconstructObligation,
  verifyJournalIntegrity,
  type FinancialEvent,
  type FinancialJournal,
} from "@/lib/financial-journal";

const AT = "2026-03-01T10:00:00Z";

function event(overrides: Partial<FinancialEvent> = {}): FinancialEvent {
  return {
    eventId: "event-1",
    aggregateType: "obligation",
    aggregateId: "obligation-1",
    sequence: 1,
    version: 1,
    type: "obligation.created",
    occurredAt: AT,
    recordedAt: AT,
    actor: { identityId: "identity-1", kind: "human" },
    causationId: null,
    correlationId: "correlation-1",
    payload: { amountMinor: 10_000, currency: "GBP", obligationId: "obligation-1" },
    ...overrides,
  };
}

function append(journal: FinancialJournal, next: FinancialEvent): FinancialJournal {
  const result = appendFinancialEvent(journal, next);
  if (!result.ok) throw new Error(result.detail);
  return result.journal;
}

describe("the journal is append-only and ordered per aggregate", () => {
  it("records events in sequence with their cause, correlation and actor", () => {
    const journal = append({ events: [] }, event());
    const integrity = verifyJournalIntegrity(journal);
    expect(integrity.ok).toBe(true);
    expect(integrity.events).toBe(1);
    expect(integrity.aggregates).toBe(1);
  });

  it("refuses the same event identity twice", () => {
    const journal = append({ events: [] }, event());
    const duplicate = appendFinancialEvent(journal, event());
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.problems).toContain("duplicate-event-id");
  });

  it("refuses a sequence hole rather than accepting an incomplete history", () => {
    const journal = append({ events: [] }, event());
    const gapped = appendFinancialEvent(journal, event({ eventId: "event-3", sequence: 3 }));
    expect(gapped.ok).toBe(false);
    if (!gapped.ok) expect(gapped.problems).toContain("sequence-gap");
  });

  it("refuses a sequence that goes backwards", () => {
    const journal = append({ events: [] }, event({ sequence: 1 }));
    const backwards = appendFinancialEvent(journal, event({ eventId: "event-2", sequence: 1 }));
    expect(backwards.ok).toBe(false);
    if (!backwards.ok) expect(backwards.problems).toContain("sequence-out-of-order");
  });

  it("refuses an event with no correlation or no actor", () => {
    const noCorrelation = appendFinancialEvent({ events: [] }, event({ correlationId: "" }));
    expect(noCorrelation.ok).toBe(false);
    if (!noCorrelation.ok) expect(noCorrelation.problems).toContain("missing-correlation");
    const noActor = appendFinancialEvent(
      { events: [] },
      event({ actor: { identityId: "", kind: "service" } }),
    );
    expect(noActor.ok).toBe(false);
    if (!noActor.ok) expect(noActor.problems).toContain("missing-actor");
  });

  it("reports a hole in a journal it did not build", () => {
    const journal: FinancialJournal = {
      events: [event(), event({ eventId: "event-2", sequence: 3 })],
    };
    const integrity = verifyJournalIntegrity(journal);
    expect(integrity.ok).toBe(false);
    expect(integrity.problems.join(" ")).toContain("was expected");
  });
});

describe("the outbox makes an event durable before it is published", () => {
  it("queues an event once and never twice", () => {
    const first = enqueueOutbox({ entries: [] }, event());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(pendingOutbox(first.outbox)).toHaveLength(1);
    const second = enqueueOutbox(first.outbox, event());
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("published once");
  });

  it("tracks publish and failure with attempt counts", () => {
    const queued = enqueueOutbox({ entries: [] }, event());
    if (!queued.ok) throw new Error(queued.error);
    const entryId = queued.outbox.entries[0].entryId;
    const failed = markOutboxFailed(queued.outbox, entryId, AT);
    expect(pendingOutbox(failed)[0].attempts).toBe(1);
    const published = markOutboxPublished(failed, entryId, AT);
    expect(published.entries[0].status).toBe("published");
    expect(pendingOutbox(published)).toHaveLength(0);
  });
});

describe("reconstruction from events is the proof of a balance", () => {
  function paidJournal(): FinancialJournal {
    let journal = append({ events: [] }, event());
    journal = append(
      journal,
      event({
        eventId: "event-2",
        sequence: 2,
        type: "payment.confirmed",
        payload: { amountMinor: 4_000, currency: "GBP", obligationId: "obligation-1" },
      }),
    );
    journal = append(
      journal,
      event({
        eventId: "event-3",
        sequence: 3,
        type: "refund.processed",
        payload: { amountMinor: 500, currency: "GBP", obligationId: "obligation-1" },
      }),
    );
    return journal;
  }

  it("derives charged, paid, refunded and outstanding from the events alone", () => {
    const projection = reconstructObligation(paidJournal(), "obligation-1");
    expect(projection.known).toBe(true);
    expect(projection.charged.amountMinor).toBe(10_000);
    expect(projection.paid.amountMinor).toBe(4_000);
    expect(projection.refunded.amountMinor).toBe(500);
    expect(projection.outstanding.amountMinor).toBe(6_500);
    expect(projection.evidence).toEqual(["event-1", "event-2", "event-3"]);
  });

  it("reports an unknown obligation as unknown, never as a zero balance", () => {
    const projection = reconstructObligation(paidJournal(), "obligation-unknown");
    expect(projection.known).toBe(false);
    expect(projection.currency).toBeNull();
  });

  it("reports a cached snapshot that disagrees with the reconstruction", () => {
    const projection = reconstructObligation(paidJournal(), "obligation-1");
    const mismatches = compareProjectionToSnapshot(projection, {
      chargedMinor: 10_000,
      paidMinor: 5_000,
      outstandingMinor: 5_000,
    });
    expect(mismatches.map((mismatch) => mismatch.field)).toEqual(["paid", "outstanding"]);
    expect(mismatches[0].projectedMinor).toBe(4_000);
    expect(mismatches[0].snapshotMinor).toBe(5_000);
  });
});

describe("double-entry compatibility refuses postings that do not balance", () => {
  it("accepts a balanced posting and reports its totals", () => {
    const posted = postDoubleEntry({
      entryId: "posting-1",
      occurredAt: AT,
      lines: [
        { account: "cash", direction: "debit", amount: money(10_000, "GBP") },
        { account: "accounts-receivable", direction: "credit", amount: money(9_300, "GBP") },
        { account: "platform-fees", direction: "credit", amount: money(700, "GBP") },
      ],
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    expect(posted.posting.totalDebitMinor).toBe(10_000);
    expect(isPostingBalanced(posted.posting)).toBe(true);
  });

  it("refuses an unbalanced posting rather than rounding it", () => {
    const posted = postDoubleEntry({
      entryId: "posting-2",
      occurredAt: AT,
      lines: [
        { account: "cash", direction: "debit", amount: money(10_000, "GBP") },
        { account: "revenue", direction: "credit", amount: money(9_999, "GBP") },
      ],
    });
    expect(posted.ok).toBe(false);
    if (!posted.ok) expect(posted.error).toContain("never rounded");
  });

  it("refuses a multi-currency posting and a negative line", () => {
    const multi = postDoubleEntry({
      entryId: "posting-3",
      occurredAt: AT,
      lines: [
        { account: "cash", direction: "debit", amount: money(1_000, "GBP") },
        { account: "revenue", direction: "credit", amount: money(1_000, "USD") },
      ],
    });
    expect(multi.ok).toBe(false);

    const negative = postDoubleEntry({
      entryId: "posting-4",
      occurredAt: AT,
      lines: [
        { account: "cash", direction: "debit", amount: money(-1_000, "GBP") },
        { account: "revenue", direction: "credit", amount: money(-1_000, "GBP") },
      ],
    });
    expect(negative.ok).toBe(false);
  });

  it("refuses a posting that is not even two lines", () => {
    const single = postDoubleEntry({
      entryId: "posting-5",
      occurredAt: AT,
      lines: [{ account: "cash", direction: "debit", amount: money(500, "GBP") }],
    });
    expect(single.ok).toBe(false);
  });
});
