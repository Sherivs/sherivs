/**
 * CoreGrid — replay-guard tests (V5.3 Part 21).
 * Idempotent event acceptance: duplicate ids and out-of-tolerance
 * timestamps rejected; acceptance is pure (no hidden mutation). §31.
 */
import { describe, expect, it } from "vitest";
import {
  acceptPaymentEvent,
  type ReplayGuardEvent,
} from "../../frontend/src/lib/payments/replay-guard";

const NOW_SEC = 1_727_740_000;

function event(overrides: Partial<ReplayGuardEvent> = {}): ReplayGuardEvent {
  return {
    eventId: "evt_0001",
    provider: "paystack",
    occurredAtSec: NOW_SEC,
    ...overrides,
  };
}

describe("acceptPaymentEvent (first delivery)", () => {
  it("accepts a fresh, unseen event and records it", () => {
    const seen = new Set<string>();
    const result = acceptPaymentEvent(seen, event(), NOW_SEC);
    expect(result.accept).toBe(true);
    if (result.accept) {
      expect(result.seenEventIds.has("paystack:evt_0001")).toBe(true);
    }
  });

  it("does not mutate the caller's set (pure)", () => {
    const seen = new Set<string>();
    acceptPaymentEvent(seen, event(), NOW_SEC);
    expect(seen.size).toBe(0);
  });
});

describe("acceptPaymentEvent (duplicate suppression)", () => {
  it("rejects a redelivered event with the same id", () => {
    const first = acceptPaymentEvent(new Set(), event(), NOW_SEC);
    const seen = first.accept ? first.seenEventIds : new Set<string>();
    const second = acceptPaymentEvent(seen, event(), NOW_SEC + 5);
    expect(second.accept).toBe(false);
    if (!second.accept) {
      expect(second.code).toBe("duplicate_event");
      expect(second.seenEventIds).toBe(seen);
    }
  });

  it("treats the same event id from a different provider as distinct", () => {
    const first = acceptPaymentEvent(new Set(), event(), NOW_SEC);
    const seen = first.accept ? first.seenEventIds : new Set<string>();
    const otherProvider = acceptPaymentEvent(
      seen,
      event({ provider: "stripe" }),
      NOW_SEC,
    );
    expect(otherProvider.accept).toBe(true);
  });
});

describe("acceptPaymentEvent (tolerance window)", () => {
  it("rejects stale events outside the tolerance", () => {
    const result = acceptPaymentEvent(new Set(), event({ occurredAtSec: NOW_SEC - 301 }), NOW_SEC);
    expect(result.accept).toBe(false);
    if (!result.accept) expect(result.code).toBe("stale_event");
  });

  it("rejects future-dated events outside the tolerance", () => {
    const result = acceptPaymentEvent(new Set(), event({ occurredAtSec: NOW_SEC + 301 }), NOW_SEC);
    expect(result.accept).toBe(false);
    if (!result.accept) expect(result.code).toBe("future_event");
  });

  it("accepts events at the tolerance boundary (inclusive)", () => {
    const edge = acceptPaymentEvent(
      new Set(),
      event({ occurredAtSec: NOW_SEC - 300 }),
      NOW_SEC,
    );
    expect(edge.accept).toBe(true);
  });

  it("honours a custom tolerance", () => {
    const tight = acceptPaymentEvent(
      new Set(),
      event({ occurredAtSec: NOW_SEC - 120 }),
      NOW_SEC,
      60,
    );
    expect(tight.accept).toBe(false);
    if (!tight.accept) expect(tight.code).toBe("stale_event");
  });
});

describe("acceptPaymentEvent (identification)", () => {
  it("fails closed on unidentified events", () => {
    const noId = acceptPaymentEvent(new Set(), event({ eventId: " " }), NOW_SEC);
    expect(noId.accept).toBe(false);
    if (!noId.accept) expect(noId.code).toBe("unidentified_event");

    const noProvider = acceptPaymentEvent(new Set(), event({ provider: "" }), NOW_SEC);
    expect(noProvider.accept).toBe(false);
    if (!noProvider.accept) expect(noProvider.code).toBe("unidentified_event");
  });
});
