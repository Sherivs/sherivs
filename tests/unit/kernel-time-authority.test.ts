/**
 * CoreGrid — time-source authority suite (V1CAP-045 / J-023 / MISSION-R-15).
 *
 * Proves, at unit level, that:
 *  1. the authority is the single clock contract: time is injected
 *     (deterministic test clocks), never sampled implicitly;
 *  2. issuance is MONOTONIC — a timestamp never goes backwards, regressions
 *     within the skew tolerance clamp, regressions beyond it fail closed;
 *  3. every issued timestamp is auditable (strictly increasing sequence,
 *     issuer identity, bounded issuance log);
 *  4. the anti-pattern guards reject raw numbers/strings — a consequential
 *     consumer cannot be fed a wall reading without issuance provenance;
 *  5. the total order over issued time survives concurrent writers
 *     (deterministic tiebreak by sequence and issuer);
 *  6. issued timestamps remain compatible with the bi-temporal contract
 *     and the envelope-era event drafts (kernel/reality.ts).
 */

import { describe, expect, it } from "vitest";
import {
  ClockRegressionError,
  FixedClock,
  RawTimeSourceError,
  SteppedClock,
  SystemClock,
  TimeAuthority,
  assertAuthorityTimestamp,
  compareIssued,
  isAfterInIssuanceOrder,
  isAuthorityTimestampShape,
  issuanceCoordinate,
  type IssuedTimestamp,
} from "@/lib/kernel/time-authority";
import { eventDraft, isTimestamp } from "@/lib/kernel/reality";

const BASE_MS = Date.parse("2026-10-01T00:00:00.000Z");

describe("time authority — injectable deterministic clocks", () => {
  it("holds a FixedClock at one constant instant (deterministic tests)", () => {
    const authority = new TimeAuthority(new FixedClock(BASE_MS));
    const first = authority.now();
    const second = authority.now();
    expect(first.atMs).toBe(BASE_MS);
    expect(second.atMs).toBe(BASE_MS);
    expect(second.sequence).toBe(first.sequence + 1);
  });

  it("advances a SteppedClock by its step on every sample", () => {
    const authority = new TimeAuthority(new SteppedClock(BASE_MS, 1_000));
    const issued = [authority.now(), authority.now(), authority.now()];
    expect(issued.map((t) => t.atMs)).toEqual([BASE_MS, BASE_MS + 1_000, BASE_MS + 2_000]);
  });

  it("records the injected clock identity as the audit issuer", () => {
    const authority = new TimeAuthority(new FixedClock(BASE_MS, "clock:mission-test"));
    expect(authority.now().issuer).toBe("time-authority:clock:mission-test");
    expect(new SystemClock().issuer).toBe("clock:system");
  });
});

describe("time authority — monotonic issuance (never backwards)", () => {
  it("issues strictly non-decreasing atMs with strictly increasing sequence", () => {
    const authority = new TimeAuthority(new SteppedClock(BASE_MS, 500));
    let previous: IssuedTimestamp | null = null;
    for (let i = 0; i < 50; i += 1) {
      const issued = authority.now();
      if (previous !== null) {
        expect(issued.atMs).toBeGreaterThanOrEqual(previous.atMs);
        expect(issued.sequence).toBe(previous.sequence + 1);
      }
      previous = issued;
    }
  });

  it("clamps a clock regression WITHIN the skew tolerance (issued time holds)", () => {
    let current = BASE_MS + 10_000;
    const authority = new TimeAuthority(
      { issuer: "clock:skewed", nowMs: () => current },
      { skewToleranceMs: 5_000 },
    );
    const before = authority.now();
    current = BASE_MS + 8_000; // backwards by 2_000ms — within tolerance
    const after = authority.now();
    expect(after.atMs).toBe(before.atMs);
    expect(after.sequence).toBe(before.sequence + 1);
    expect(after.at).toBe(before.at);
  });

  it("fails CLOSED on a clock regression BEYOND the skew tolerance", () => {
    let current = BASE_MS + 100_000;
    const authority = new TimeAuthority(
      { issuer: "clock:broken", nowMs: () => current },
      { skewToleranceMs: 5_000 },
    );
    authority.now();
    current = BASE_MS; // backwards by 100_000ms — far beyond tolerance
    expect(() => authority.now()).toThrow(ClockRegressionError);
    try {
      authority.now();
    } catch (error) {
      expect(error).toBeInstanceOf(ClockRegressionError);
      const regression = error as ClockRegressionError;
      expect(regression.regressionMs).toBe(100_000);
      expect(regression.lastIssuedMs).toBe(BASE_MS + 100_000);
    }
    // Nothing was issued by the failed calls: the audit trail is unchanged.
    expect(authority.issuanceLog().length).toBe(1);
    expect(authority.lastIssued()?.atMs).toBe(BASE_MS + 100_000);
  });

  it("keeps monotonicity when the clock jumps wildly forward then back within tolerance", () => {
    let current = BASE_MS;
    const authority = new TimeAuthority(
      { issuer: "clock:chaotic", nowMs: () => current },
      { skewToleranceMs: 60_000 },
    );
    current = BASE_MS + 50_000;
    const forward = authority.now();
    current = BASE_MS; // 50_000ms regression, within the tolerance → clamped
    const clamped = authority.now();
    expect(clamped.atMs).toBe(forward.atMs);
    expect(clamped.sequence).toBe(forward.sequence + 1);
  });

  it("fails CLOSED on ANY regression when the skew tolerance is zero", () => {
    let current = BASE_MS + 50_000;
    const authority = new TimeAuthority(
      { issuer: "clock:strict", nowMs: () => current },
      { skewToleranceMs: 0 },
    );
    const forward = authority.now();
    current = BASE_MS + 49_999; // a single ms backwards — zero tolerance
    expect(() => authority.now()).toThrow(ClockRegressionError);
    expect(authority.lastIssued()?.atMs).toBe(forward.atMs);
  });
});

describe("time authority — auditability (sequence, issuer, log)", () => {
  it("records every issuance in the bounded audit log", () => {
    const authority = new TimeAuthority(new SteppedClock(BASE_MS, 10), { maxIssuanceLog: 5 });
    for (let i = 0; i < 8; i += 1) authority.now();
    const log = authority.issuanceLog();
    expect(log.length).toBe(5);
    for (let i = 1; i < log.length; i += 1) {
      expect(log[i].sequence).toBe(log[i - 1].sequence + 1);
      expect(log[i].atMs).toBeGreaterThanOrEqual(log[i - 1].atMs);
      expect(log[i].issuer.length).toBeGreaterThan(0);
    }
  });

  it("answers the audit questions on every issued timestamp: sequence + issuer", () => {
    const issued = new TimeAuthority(new FixedClock(BASE_MS, "clock:audit")).now();
    expect(issued.sequence).toBe(0);
    expect(issued.issuer).toBe("time-authority:clock:audit");
  });
});

describe("time authority — anti-pattern guards (raw time rejection)", () => {
  it("rejects a raw epoch number (the Date.now() anti-pattern)", () => {
    expect(isAuthorityTimestampShape(Date.now())).toBe(false);
    expect(() => assertAuthorityTimestamp(Date.now())).toThrow(RawTimeSourceError);
  });

  it("rejects a raw timestamp string without issuance provenance", () => {
    expect(isAuthorityTimestampShape(BASE_MS.toString())).toBe(false);
    expect(isAuthorityTimestampShape("2026-10-01T00:00:00.000Z")).toBe(false);
    expect(() => assertAuthorityTimestamp("2026-10-01T00:00:00.000Z")).toThrow(RawTimeSourceError);
  });

  it("rejects null, undefined, arrays and shape-forged objects lacking fields", () => {
    expect(isAuthorityTimestampShape(null)).toBe(false);
    expect(isAuthorityTimestampShape(undefined)).toBe(false);
    expect(isAuthorityTimestampShape([])).toBe(false);
    expect(isAuthorityTimestampShape({ at: "2026-10-01T00:00:00.000Z", atMs: BASE_MS })).toBe(false);
    expect(() => assertAuthorityTimestamp(null)).toThrow(RawTimeSourceError);
  });

  it("rejects a forged shape whose at does not parse back to atMs", () => {
    const forged = { at: "2026-10-01T00:00:01.000Z", atMs: BASE_MS, sequence: 0, issuer: "forged" };
    expect(isAuthorityTimestampShape(forged)).toBe(false);
    expect(() => assertAuthorityTimestamp(forged)).toThrow(RawTimeSourceError);
  });

  it("accepts a genuine issued timestamp through the shape guard", () => {
    const issued = new TimeAuthority(new FixedClock(BASE_MS)).now();
    expect(isAuthorityTimestampShape(issued)).toBe(true);
    expect(assertAuthorityTimestamp(issued)).toBe(issued);
  });

  it("verifies issuance provenance against the LEDGER, not the shape alone", () => {
    const authority = new TimeAuthority(new FixedClock(BASE_MS));
    const issued = authority.now();
    expect(authority.isAuthorityTimestamp(issued)).toBe(true);
    const forged = { ...issued, sequence: 999 };
    expect(authority.isAuthorityTimestamp(forged)).toBe(false);
    const foreign = new TimeAuthority(new FixedClock(BASE_MS, "clock:foreign")).now();
    expect(authority.isAuthorityTimestamp(foreign)).toBe(false);
  });
});

describe("time authority — total order surviving concurrent writers", () => {
  it("breaks ties on the same millisecond by sequence, then issuer", () => {
    const early: IssuedTimestamp = { at: new Date(BASE_MS).toISOString(), atMs: BASE_MS, sequence: 1, issuer: "time-authority:clock:a" };
    const late: IssuedTimestamp = { at: new Date(BASE_MS).toISOString(), atMs: BASE_MS, sequence: 2, issuer: "time-authority:clock:a" };
    const other: IssuedTimestamp = { at: new Date(BASE_MS).toISOString(), atMs: BASE_MS, sequence: 1, issuer: "time-authority:clock:b" };
    expect(compareIssued(early, late)).toBe(-1);
    expect(compareIssued(late, early)).toBe(1);
    expect(compareIssued(early, other)).toBe(-1);
    expect(compareIssued(other, early)).toBe(1);
    expect(compareIssued(early, { ...early })).toBe(0);
  });

  it("produces the SAME total order for ANY permutation of concurrent issuances", () => {
    const a = new TimeAuthority(new SteppedClock(BASE_MS, 1_000), { skewToleranceMs: 0 });
    const b = new TimeAuthority(new FixedClock(BASE_MS), { skewToleranceMs: 0 });
    const concurrent = [a.now(), b.now(), a.now(), b.now(), a.now()];
    const ordered = [...concurrent].sort(compareIssued);
    // Any reshuffle must re-sort to the identical sequence.
    const reversed = [...ordered].reverse().sort(compareIssued);
    expect(reversed).toEqual(ordered);
    // Sequences within one issuer are strictly ordered in the total order.
    const aOnly = ordered.filter((t) => t.issuer === "time-authority:clock:stepped");
    for (let i = 1; i < aOnly.length; i += 1) {
      expect(isAfterInIssuanceOrder(aOnly[i - 1], aOnly[i])).toBe(true);
    }
  });

  it("derives a stable, collision-free UUIDv7 ordering coordinate per issuance", () => {
    const authority = new TimeAuthority(new FixedClock(BASE_MS));
    const first = authority.now();
    const second = authority.now();
    // Same millisecond, different issuance → different coordinate.
    expect(issuanceCoordinate(first)).not.toBe(issuanceCoordinate(second));
    expect(issuanceCoordinate(first)).toBe(issuanceCoordinate(first));
    expect(issuanceCoordinate(first)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("time authority — compatibility with the reality kernel contracts", () => {
  it("issues timestamps that satisfy the bi-temporal ISO-8601 grammar", () => {
    const issued = new TimeAuthority(new SteppedClock(BASE_MS, 1)).now();
    expect(isTimestamp(issued.at)).toBe(true);
  });

  it("feeds issued timestamps into envelope-stamped event drafts as record time", () => {
    const authority = new TimeAuthority(new SteppedClock(BASE_MS, 1));
    const issued = authority.now();
    const draft = eventDraft(
      {
        eventType: "core.state.changed",
        aggregateType: "core.aggregate",
        aggregateId: "aggregate-1",
        tenantId: "tenant-1",
        envelope: {
          objectType: "core.event",
          schemaVersion: "1.0",
          status: "active",
          createdBy: "identity:engineer-1",
          updatedBy: "identity:engineer-1",
          provenance: { source: "kernel:test", originTenantId: "tenant-1" },
          policyContext: {},
          traceId: "trace-1",
          correlationId: "corr-1",
          declaredOrigin: "kernel:test:bootstrap",
        },
      },
      assertAuthorityTimestamp(issued).at,
    );
    expect(draft.recorded_at).toBe(issued.at);
    expect(draft.occurred_at).toBe(issued.at);
  });
});