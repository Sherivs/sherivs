/**
 * CoreGrid — Jarvis V1 executive briefing composer tests (V5.3 Part 15).
 *
 * Security negatives are mandatory (Constitution section 31): the composer must
 * never fabricate facts (every emitted token is drawn from input summaries or
 * the fixed header), ordering must be deterministic (critical first, then
 * severity, then time), and the hard length cap must hold.
 */
import { describe, expect, it } from "vitest";
import {
  BRIEFING_HEADER,
  BRIEFING_HARD_MAX_LINES,
  composeBriefing,
  type BriefingEvent,
} from "../../frontend/src/lib/jarvis/briefing";

function eventFor(overrides?: Partial<BriefingEvent>): BriefingEvent {
  return {
    kind: "device.heartbeat",
    tenantRef: "tenant-alpha",
    at: "2026-10-01T00:00:00.000Z",
    severity: "info",
    summary: "campus sensor heartbeat nominal",
    ...overrides,
  };
}

/** Tokens the composer is allowed to emit: input summaries plus the fixed header. */
function allowedTokens(events: readonly BriefingEvent[]): Set<string> {
  const source = [
    ...events.map((event) => event.summary),
    BRIEFING_HEADER,
  ].join(" ");
  return new Set(source.split(/\s+/).filter((token) => token.length > 0));
}

describe("composeBriefing — no fabrication", () => {
  it("restates input summaries verbatim, line by line", () => {
    const events = [
      eventFor({ summary: "payment gateway latency elevated in eu-west" }),
      eventFor({ summary: "attendance device offline at north campus", severity: "critical" }),
      eventFor({ summary: "mission worker stalled on reconciliation", severity: "warning" }),
    ];
    const result = composeBriefing(events);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const summaries = new Set(events.map((event) => event.summary));
      for (const line of result.briefing.lines) {
        expect(summaries.has(line.summary)).toBe(true);
      }
    }
  });

  it("emits only tokens drawn from input summaries and the fixed header", () => {
    const events = [
      eventFor({ summary: "camera fleet firmware drift detected", severity: "warning" }),
      eventFor({ summary: "backup job completed successfully", severity: "info" }),
      eventFor({ summary: "tenant quota breach imminent", severity: "critical" }),
    ];
    const result = composeBriefing(events);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const allowed = allowedTokens(events);
      expect(result.briefing.header).toBe(BRIEFING_HEADER);
      const emitted = [
        result.briefing.header,
        ...result.briefing.lines.map((line) => line.summary),
      ].join(" ");
      for (const token of emitted.split(/\s+/)) {
        expect(allowed.has(token)).toBe(true);
      }
    }
  });
});

describe("composeBriefing — deterministic ordering", () => {
  it("orders critical first, then severity, then time", () => {
    const events = [
      eventFor({ summary: "late info event", at: "2026-10-01T05:00:00.000Z", severity: "info" }),
      eventFor({ summary: "early critical event", at: "2026-10-01T01:00:00.000Z", severity: "critical" }),
      eventFor({ summary: "late warning event", at: "2026-10-01T04:00:00.000Z", severity: "warning" }),
      eventFor({ summary: "early info event", at: "2026-10-01T02:00:00.000Z", severity: "info" }),
      eventFor({ summary: "early warning event", at: "2026-10-01T03:00:00.000Z", severity: "warning" }),
    ];
    const result = composeBriefing(events);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.briefing.lines.map((line) => line.summary)).toEqual([
        "early critical event",
        "early warning event",
        "late warning event",
        "early info event",
        "late info event",
      ]);
    }
  });

  it("is stable across repeated compositions", () => {
    const events = [
      eventFor({ summary: "event two", severity: "warning" }),
      eventFor({ summary: "event one", severity: "critical" }),
    ];
    const first = composeBriefing(events);
    const second = composeBriefing([...events].reverse());
    expect(first).toEqual(second);
  });
});

describe("composeBriefing — hard length cap", () => {
  it("caps lines at the requested maximum and flags truncation", () => {
    const events = Array.from({ length: 50 }, (_, index) =>
      eventFor({ summary: `event number ${index}`, at: `2026-10-01T00:00:${String(index % 60).padStart(2, "0")}.000Z` }),
    );
    const result = composeBriefing(events, { maxLines: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.briefing.lines).toHaveLength(10);
      expect(result.briefing.truncated).toBe(true);
      expect(result.briefing.totalEvents).toBe(50);
    }
  });

  it("enforces the hard maximum even when the caller asks for more", () => {
    const events = Array.from({ length: BRIEFING_HARD_MAX_LINES + 25 }, (_, index) =>
      eventFor({ summary: `event number ${index}` }),
    );
    const result = composeBriefing(events, { maxLines: 10_000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.briefing.lines).toHaveLength(BRIEFING_HARD_MAX_LINES);
      expect(result.briefing.truncated).toBe(true);
    }
  });

  it("reports no truncation when everything fits", () => {
    const result = composeBriefing([eventFor()]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.briefing.truncated).toBe(false);
      expect(result.briefing.lines).toHaveLength(1);
    }
  });
});

describe("composeBriefing — fail-closed negatives", () => {
  it("denies events with unknown severity", () => {
    const result = composeBriefing([eventFor({ severity: "sev:1" as BriefingEvent["severity"] })]);
    expect(result.ok).toBe(false);
  });

  it("denies events with unparseable timestamps", () => {
    const result = composeBriefing([eventFor({ at: "not-a-timestamp" })]);
    expect(result.ok).toBe(false);
  });

  it("denies events with empty required fields", () => {
    expect(composeBriefing([eventFor({ summary: "" })]).ok).toBe(false);
    expect(composeBriefing([eventFor({ kind: "" })]).ok).toBe(false);
    expect(composeBriefing([eventFor({ tenantRef: "" })]).ok).toBe(false);
  });

  it("composes an empty briefing for empty input", () => {
    const result = composeBriefing([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.briefing.lines).toEqual([]);
      expect(result.briefing.truncated).toBe(false);
      expect(result.briefing.totalEvents).toBe(0);
    }
  });
});
