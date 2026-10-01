/**
 * CoreGrid — payment webhook replay guard (V5.3 Part 21, Part 36).
 *
 * Pure, idempotent event-acceptance logic. Providers redeliver webhooks;
 * a financial effect must happen exactly once. Two rejection axes:
 *
 * 1. Seen event ids (per provider) are duplicates — rejected.
 * 2. Event timestamps outside the tolerance window (stale or
 *    future-dated) are replay/forgery indicators — rejected.
 *
 * The guard is stateless-in/stateless-out: callers pass the current
 * seen-set and receive a decision plus the next set, so acceptance is
 * trivially testable and free of hidden mutation. It decides only
 * whether an event may be PROCESSED — the financial effect itself is
 * applied by the governed server function afterwards.
 */

export interface ReplayGuardEvent {
  /** Provider's durable event id (unique per provider). */
  eventId: string;
  provider: string;
  /** Event occurrence time in unix seconds (per the signed payload). */
  occurredAtSec: number;
}

export type ReplayGuardDecision =
  | { accept: true; seenEventIds: ReadonlySet<string> }
  | {
      accept: false;
      code: "duplicate_event" | "stale_event" | "future_event" | "unidentified_event";
      reason: string;
      seenEventIds: ReadonlySet<string>;
    };

/**
 * Decide whether a webhook event may be processed exactly once.
 * Never mutates the input set; on acceptance returns the next set with
 * the event recorded. Default tolerance is 300s, matching the Stripe
 * adapter's signature tolerance.
 */
export function acceptPaymentEvent(
  seenEventIds: ReadonlySet<string>,
  event: ReplayGuardEvent,
  nowSec: number,
  toleranceSec = 300,
): ReplayGuardDecision {
  if (event.eventId.trim() === "" || event.provider.trim() === "") {
    return {
      accept: false,
      code: "unidentified_event",
      reason: "Event requires a durable event id and provider",
      seenEventIds,
    };
  }

  const key = `${event.provider}:${event.eventId}`;
  if (seenEventIds.has(key)) {
    return {
      accept: false,
      code: "duplicate_event",
      reason: `Event ${key} was already accepted`,
      seenEventIds,
    };
  }

  const age = nowSec - event.occurredAtSec;
  if (age > toleranceSec) {
    return {
      accept: false,
      code: "stale_event",
      reason: `Event is ${age}s old, outside the ${toleranceSec}s tolerance`,
      seenEventIds,
    };
  }
  if (age < -toleranceSec) {
    return {
      accept: false,
      code: "future_event",
      reason: `Event timestamp is ${-age}s in the future, outside the ${toleranceSec}s tolerance`,
      seenEventIds,
    };
  }

  const next = new Set(seenEventIds);
  next.add(key);
  return { accept: true, seenEventIds: next };
}
