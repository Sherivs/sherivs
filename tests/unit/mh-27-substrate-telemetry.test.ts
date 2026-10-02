/**
 * CoreGrid — substrate telemetry collector tests (MISSION H2-27, §29).
 * Synthetic AdapterPolicyEvent streams over the collector: aggregation
 * correctness (per-provider/per-operation health), redaction by construction
 * (no payload content or secrets ever reach state or the emitters), degraded-
 * episode open/close accounting, fail-closed malformed-event handling, house
 * format emission through the shared structured-log formatter, and live
 * subscription wiring for all eight substrate adapters.
 */
import { describe, expect, it } from "vitest";
import {
  createSubstrateTelemetry,
  type SubstrateTelemetry,
} from "@/lib/observability/substrate-telemetry";
import { formatLogLine } from "@/lib/observability/structured-log";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterPolicyEvent,
} from "@/lib/adapters/failure-policy";
import { RECONCILIATION_FAILURE_POLICY } from "@/lib/adapters/reconciliation-store.adapter";
import { EVENT_SECURITY_FAILURE_POLICY } from "@/lib/adapters/event-security-store.adapter";
import { EVENT_ROUTING_FAILURE_POLICY } from "@/lib/adapters/event-routing-store.adapter";
import { EVIDENCE_FAILURE_POLICY } from "@/lib/adapters/evidence-capture-store.adapter";
import { REASONING_PROVENANCE_FAILURE_POLICY } from "@/lib/adapters/reasoning-provenance-store.adapter";
import { COST_ATTRIBUTION_FAILURE_POLICY } from "@/lib/adapters/cost-attribution-store.adapter";
import { KNOWLEDGE_CURRENCY_FAILURE_POLICY } from "@/lib/adapters/knowledge-currency-store.adapter";
import { TOOL_RUNTIME_FAILURE_POLICY } from "@/lib/adapters/tool-runtime-store.adapter";

const FIXED_TS = "2026-10-02T00:00:00.000Z";

/** Injectable collector clock: starts at 1_000_000 and advances manually. */
function manualClock(startMs = 1_000_000) {
  let now = startMs;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
    at: () => now,
  };
}

/** Resolves delays instantly (no real timers) for live-policy wiring tests. */
const immediateClock: AdapterClock = {
  nowMs: () => 1_000_000,
  delay: () => Promise.resolve(),
};

/** The eight substrate adapter provider identities, read from their declared
 * default failure policies so the test cannot drift from the real names. */
const EIGHT_PROVIDERS: readonly string[] = [
  RECONCILIATION_FAILURE_POLICY.snapshot().provider,
  EVENT_SECURITY_FAILURE_POLICY.snapshot().provider,
  EVENT_ROUTING_FAILURE_POLICY.snapshot().provider,
  EVIDENCE_FAILURE_POLICY.snapshot().provider,
  REASONING_PROVENANCE_FAILURE_POLICY.snapshot().provider,
  COST_ATTRIBUTION_FAILURE_POLICY.snapshot().provider,
  KNOWLEDGE_CURRENCY_FAILURE_POLICY.snapshot().provider,
  TOOL_RUNTIME_FAILURE_POLICY.snapshot().provider,
];

/** Straight-line event builders (the vocabulary mirrors failure-policy). */
function succeeded(
  provider: string,
  operation: string,
  attempts: number,
  durationMs: number,
  atMs: number,
): AdapterPolicyEvent {
  return { kind: "call_succeeded", provider, operation, attempts, durationMs, atMs };
}

function failed(
  provider: string,
  operation: string,
  code: "timeout" | "provider_error" | "breaker_open",
  attempt: number,
  atMs: number,
  reason: string,
): AdapterPolicyEvent {
  return { kind: "call_failed", provider, operation, code, attempt, atMs, reason };
}

function modeChange(
  provider: string,
  from: "healthy" | "degraded" | "isolated",
  to: "healthy" | "degraded" | "isolated",
  atMs: number,
  reason: string,
): AdapterPolicyEvent {
  return { kind: "mode_change", provider, from, to, atMs, reason };
}

function breakerChange(
  provider: string,
  from: "closed" | "open" | "half_open",
  to: "closed" | "open" | "half_open",
  atMs: number,
  reason: string,
): AdapterPolicyEvent {
  return { kind: "breaker_change", provider, from, to, atMs, reason };
}

function trustDecision(
  provider: string,
  verdict: "trusted" | "untrusted" | "unproven",
  atMs: number,
  reason: string,
): AdapterPolicyEvent {
  return { kind: "trust_decision", provider, verdict, atMs, reason };
}

describe("aggregation correctness (synthetic streams)", () => {
  it("accumulates per-provider and per-operation health from event streams", () => {
    const clock = manualClock();
    const telemetry = createSubstrateTelemetry({ now: clock.now });

    telemetry.ingest(succeeded("p1", "op.read", 1, 12, clock.at()));
    telemetry.ingest(succeeded("p1", "op.read", 2, 30, clock.at()));
    telemetry.ingest(succeeded("p1", "op.write", 1, 5, clock.at()));
    telemetry.ingest(failed("p1", "op.read", "timeout", 1, clock.at(), "t-1"));
    telemetry.ingest(failed("p1", "op.read", "provider_error", 2, clock.at(), "p-1"));
    telemetry.ingest(failed("p2", "op.sync", "breaker_open", 1, clock.at(), "b-1"));
    telemetry.ingest(failed("p2", "op.sync", "breaker_open", 1, clock.at(), "b-2"));

    const p1 = telemetry.provider("p1");
    expect(p1).not.toBeNull();
    expect(p1?.successes).toBe(3);
    expect(p1?.failureAttempts).toBe(2);
    expect(p1?.timeouts).toBe(1);
    expect(p1?.lastEventAtMs).toBe(clock.at());

    const read = telemetry.operation("p1", "op.read");
    expect(read?.successes).toBe(2);
    expect(read?.failureAttempts).toBe(2);
    expect(read?.codes).toEqual({ timeout: 1, provider_error: 1, breaker_open: 0 });
    expect(read?.lastSuccessDurationMs).toBe(30);
    expect(read?.lastFailureAtMs).toBe(clock.at());

    const write = telemetry.operation("p1", "op.write");
    expect(write?.successes).toBe(1);
    expect(write?.failureAttempts).toBe(0);

    const p2 = telemetry.provider("p2");
    expect(p2?.failureAttempts).toBe(2);
    expect(p2?.timeouts).toBe(0);
    expect(p2?.operations.map((op) => op.operation)).toEqual(["op.sync"]);
  });

  it("tracks breaker transitions and current state per provider", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(breakerChange("p1", "closed", "open", 10, "r1"));
    telemetry.ingest(breakerChange("p1", "open", "half_open", 20, "r2"));
    telemetry.ingest(breakerChange("p1", "half_open", "closed", 30, "r3"));
    telemetry.ingest(breakerChange("p1", "closed", "open", 40, "r4"));

    const p1 = telemetry.provider("p1");
    expect(p1?.breakerChanges).toBe(4);
    expect(p1?.breakerOpens).toBe(2);
    expect(p1?.breakerHalfOpens).toBe(1);
    expect(p1?.breakerCloses).toBe(1);
    expect(p1?.currentBreaker).toBe("open");
  });

  it("tracks mode changes and trust decisions (E-060 vocabulary)", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(modeChange("p1", "healthy", "degraded", 10, "r1"));
    telemetry.ingest(modeChange("p1", "degraded", "healthy", 20, "r2"));
    telemetry.ingest(trustDecision("p1", "untrusted", 30, "r3"));
    telemetry.ingest(trustDecision("p2", "trusted", 40, "r4"));
    telemetry.ingest(trustDecision("p2", "trusted", 50, "r5"));

    const p1 = telemetry.provider("p1");
    expect(p1?.modeChanges).toBe(2);
    expect(p1?.currentMode).toBe("healthy");
    expect(p1?.trustDecisions).toBe(1);
    expect(p1?.trustVerdictCounts).toEqual({ trusted: 0, untrusted: 1, unproven: 0 });
    expect(p1?.lastTrustVerdict).toBe("untrusted");

    const p2 = telemetry.provider("p2");
    expect(p2?.trustVerdictCounts).toEqual({ trusted: 2, untrusted: 0, unproven: 0 });
  });

  it("sorts providers and operations by name in snapshots and never leaks state", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(succeeded("zeta", "op.b", 1, 1, 1));
    telemetry.ingest(succeeded("alpha", "op.d", 1, 1, 1));
    telemetry.ingest(succeeded("alpha", "op.a", 1, 1, 1));

    const snap = telemetry.snapshot();
    expect(snap.providers.map((p) => p.provider)).toEqual(["alpha", "zeta"]);
    expect(snap.providers[0]?.operations.map((op) => op.operation)).toEqual(["op.a", "op.d"]);
    expect(snap.eventsIngested).toBe(3);
    expect(snap.malformedEventsDropped).toBe(0);

    // Mutating the snapshot must not corrupt the collector's state.
    const p1 = snap.providers[0];
    if (p1) p1.successes = 999;
    expect(telemetry.provider("alpha")?.successes).toBe(2);
  });
});

describe("redaction by construction (no payload or secrets reach the emitters)", () => {
  const SECRET_TOKEN = "sk-live-9f8e7d6c5b4a";

  it("never carries reason text, causes or injected secret fields into entries", () => {
    const telemetry = createSubstrateTelemetry();

    // Poisoned event: the free-text reason embeds secret-looking payload, and
    // a hostile extra property rides on the object (cast to the public type).
    const poisoned = failed(
      "p1",
      "op.read",
      "provider_error",
      1,
      1,
      `provider said: {"input":"${SECRET_TOKEN}"}`,
    ) as AdapterPolicyEvent & { reason: string; api_key: string };
    // The reason property is part of the real type; make the hostile extra
    // field explicit so the redaction test exercises unknown-field ingress.
    (poisoned as unknown as Record<string, unknown>).api_key = SECRET_TOKEN;
    telemetry.ingest(poisoned);

    const entries = telemetry.takeLogEntries();
    expect(entries).toHaveLength(1);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(SECRET_TOKEN);
    expect(serialized).not.toContain("provider said");
    expect(serialized).not.toContain('"reason"');
    expect(serialized).not.toContain("api_key");
    // Only bounded whitelist fields survive.
    const entry = entries[0] as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(
      ["attempt", "code", "component", "level", "msg", "operation", "provider"],
    );
  });

  it("keeps secrets out of the aggregate snapshot too", () => {
    const telemetry = createSubstrateTelemetry();
    const poisoned = failed("p1", "op.read", "provider_error", 1, 1, `tok=${SECRET_TOKEN}`);
    telemetry.ingest(poisoned);
    const snap = JSON.stringify(telemetry.snapshot());
    expect(snap).not.toContain(SECRET_TOKEN);
    expect(snap).not.toContain("tok=");
    expect(snap).not.toContain("reason");
  });

  it("formatted log lines stay clean when passed through the house formatter", () => {
    const telemetry = createSubstrateTelemetry({ component: "substrate-telemetry" });
    telemetry.ingest(failed("p1", "op.read", "timeout", 1, 1, `secret=${SECRET_TOKEN}`));
    for (const entry of telemetry.takeLogEntries()) {
      const line = formatLogLine(entry, { now: () => FIXED_TS });
      expect(line).not.toContain(SECRET_TOKEN);
      expect(line).toContain('"level":"warn"');
      expect(line).toContain('"msg":"substrate-adapter-call-failed"');
      expect(JSON.parse(line)).toMatchObject({
        ts: FIXED_TS,
        component: "substrate-telemetry",
      });
    }
  });
});

describe("degraded-episode open/close accounting", () => {
  it("opens on healthy->degraded, reports live open duration, closes on degraded->healthy", () => {
    const clock = manualClock();
    const telemetry = createSubstrateTelemetry({ now: clock.now });
    const openedAt = clock.at(); // 1_000_000

    telemetry.ingest(modeChange("p1", "healthy", "degraded", openedAt, "r1"));
    let p1 = telemetry.provider("p1");
    expect(p1?.degradedEpisodeOpen).toBe(true);
    expect(p1?.degradedEpisodeOpenedAtMs).toBe(openedAt);
    expect(p1?.degradedEpisodesClosed).toBe(0);

    clock.advance(4_500);
    p1 = telemetry.provider("p1");
    expect(p1?.degradedEpisodeOpenMs).toBe(4_500);

    const closedAt = clock.at(); // 1_004_500
    telemetry.ingest(modeChange("p1", "degraded", "healthy", closedAt, "r2"));
    p1 = telemetry.provider("p1");
    expect(p1?.degradedEpisodeOpen).toBe(false);
    expect(p1?.degradedEpisodeOpenMs).toBeNull();
    expect(p1?.degradedEpisodeOpenedAtMs).toBeNull();
    expect(p1?.degradedEpisodesClosed).toBe(1);
    expect(p1?.lastDegradedEpisode).toEqual({
      openedAtMs: openedAt,
      closedAtMs: closedAt,
      openMs: 4_500,
    });
  });

  it("counts repeated episodes and ignores duplicate/orphan transitions", () => {
    const telemetry = createSubstrateTelemetry();

    telemetry.ingest(modeChange("p1", "healthy", "degraded", 100, "r1"));
    // Duplicate degraded transition while already open: never double-counted.
    telemetry.ingest(modeChange("p1", "healthy", "degraded", 200, "r2"));
    telemetry.ingest(modeChange("p1", "degraded", "healthy", 300, "r3"));
    telemetry.ingest(modeChange("p1", "healthy", "degraded", 400, "r4"));
    telemetry.ingest(modeChange("p1", "degraded", "healthy", 900, "r5"));

    const p1 = telemetry.provider("p1");
    expect(p1?.degradedEpisodeOpen).toBe(false);
    expect(p1?.degradedEpisodesClosed).toBe(2);
    expect(p1?.lastDegradedEpisode).toEqual({
      openedAtMs: 400,
      closedAtMs: 900,
      openMs: 500,
    });
    // Orphan close (no episode open) does not fabricate an episode.
    telemetry.ingest(modeChange("p2", "degraded", "healthy", 100, "r6"));
    const p2 = telemetry.provider("p2");
    expect(p2?.degradedEpisodesClosed).toBe(0);
    expect(p2?.lastDegradedEpisode).toBeNull();
    expect(p2?.degradedEpisodeOpen).toBe(false);
  });
});

describe("fail-closed malformed-event handling", () => {
  it("drops malformed events, counts them, and never throws", () => {
    const telemetry = createSubstrateTelemetry();
    expect(telemetry.ingest(null)).toBe(false);
    expect(telemetry.ingest(42)).toBe(false);
    expect(telemetry.ingest({})).toBe(false);
    expect(telemetry.ingest({ kind: "call_failed", provider: "p1" })).toBe(false);
    expect(
      telemetry.ingest({ kind: "unknown_kind", provider: "p1", atMs: 1 }),
    ).toBe(false);
    expect(
      // attempt out of range
      telemetry.ingest({ kind: "call_failed", provider: "p1", operation: "op", code: "timeout", attempt: 0, atMs: 1, reason: "x" }),
    ).toBe(false);

    const snap = telemetry.snapshot();
    expect(snap.malformedEventsDropped).toBe(6);
    expect(snap.eventsIngested).toBe(0);
    expect(snap.providers).toHaveLength(0);
  });

  it("emits a bounded warn entry (event kind only, never content) per drop", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest({ kind: "mode_change", provider: "p1", atMs: 1, from: "nope", to: "degraded" });
    const entries = telemetry.takeLogEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0] as Record<string, unknown>;
    expect(entry.msg).toBe("substrate-telemetry-malformed-event-dropped");
    expect(entry.event_kind).toBe("mode_change");
    expect(Object.keys(entry).sort()).toEqual(["component", "event_kind", "level", "msg"]);
  });
});

describe("house-format emitters", () => {
  it("buffers entries, drains them via takeLogEntries, and emits through a sink", () => {
    const lines: string[] = [];
    const telemetry = createSubstrateTelemetry({ now: () => 1_000 });

    telemetry.ingest(succeeded("p1", "op.read", 1, 7, 1_000));
    telemetry.ingest(failed("p1", "op.read", "timeout", 1, 1_000, "r"));
    expect(telemetry.bufferedLogCount()).toBe(2);

    expect(telemetry.emitPendingLogs({ sink: (line) => lines.push(line), now: () => FIXED_TS })).toBe(2);
    expect(telemetry.bufferedLogCount()).toBe(0);
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(first).toMatchObject({
      ts: FIXED_TS,
      level: "debug",
      msg: "substrate-adapter-call-succeeded",
      component: "substrate-telemetry",
      provider: "p1",
      operation: "op.read",
      attempts: 1,
      duration_ms: 7,
    });
    const second = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
    expect(second).toMatchObject({
      ts: FIXED_TS,
      level: "warn",
      msg: "substrate-adapter-call-failed",
      provider: "p1",
      operation: "op.read",
      code: "timeout",
    });
  });

  it("assigns severity by transition target", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(modeChange("p1", "healthy", "degraded", 1, "r1"));
    telemetry.ingest(modeChange("p1", "degraded", "healthy", 2, "r2"));
    telemetry.ingest(breakerChange("p1", "closed", "open", 3, "r3"));
    telemetry.ingest(breakerChange("p1", "open", "half_open", 4, "r4"));
    telemetry.ingest(breakerChange("p1", "half_open", "closed", 5, "r5"));
    telemetry.ingest(trustDecision("p1", "untrusted", 6, "r6"));
    telemetry.ingest(trustDecision("p1", "unproven", 7, "r7"));

    const levels = telemetry.takeLogEntries().map((entry) => entry.level);
    expect(levels).toEqual([
      "warn", // degraded episode opened
      "info", // healthy again
      "error", // breaker opened
      "warn", // half-open probe admitted
      "info", // breaker closed
      "warn", // untrusted trust decision
      "info", // non-untrusted trust decision
    ]);
  });

  it("keeps the entry buffer bounded, discarding oldest entries first", () => {
    const telemetry: SubstrateTelemetry = createSubstrateTelemetry({ maxBufferedEntries: 3 });
    for (let i = 0; i < 5; i += 1) {
      telemetry.ingest(succeeded("p1", `op.${i}`, 1, i, i));
    }
    expect(telemetry.bufferedLogCount()).toBe(3);
    const entries = telemetry.takeLogEntries();
    expect(entries.map((entry) => (entry as Record<string, unknown>).operation)).toEqual([
      "op.2",
      "op.3",
      "op.4",
    ]);
    const snap = telemetry.snapshot();
    expect(snap.logEntriesDropped).toBe(2);
    expect(snap.logEntriesBuffered).toBe(0);
  });

  it("invokes the optional live observer exactly once per ingested event", () => {
    const observed: string[] = [];
    const telemetry = createSubstrateTelemetry({
      onEntry: (entry) => observed.push(entry.msg),
    });
    telemetry.ingest(succeeded("p1", "op.read", 1, 1, 1));
    telemetry.ingest(trustDecision("p1", "untrusted", 2, "r"));
    expect(observed).toEqual([
      "substrate-adapter-call-succeeded",
      "substrate-adapter-trust-decision",
    ]);
  });
});

describe("subscription wiring for all eight substrate adapters", () => {
  it("aggregates live AdapterFailurePolicy streams from all eight adapters", async () => {
    const clock = manualClock();
    const telemetry = createSubstrateTelemetry({ now: clock.now });

    for (const provider of EIGHT_PROVIDERS) {
      const policy = createAdapterFailurePolicy({
        provider,
        timeoutMs: 5_000,
        maxAttempts: 1,
        backoffBaseMs: 100,
        backoffCapMs: 1_000,
        degradedAfterFailures: 1,
        degradedWindowMs: 30_000,
        breakerFailureThreshold: 5,
        breakerResetMs: 15_000,
        clock: immediateClock,
        onEvent: telemetry.sink(),
      });
      const result = await policy.run({
        operation: "probe",
        call: async () => {
          throw new Error("simulated provider outage");
        },
      });
      expect(result.outcome).toBe("error");
    }

    const snap = telemetry.snapshot();
    expect(snap.eventsIngested).toBeGreaterThanOrEqual(EIGHT_PROVIDERS.length);
    expect(snap.providers.map((p) => p.provider)).toEqual([...EIGHT_PROVIDERS].sort());
    for (const p of snap.providers) {
      expect(p.failureAttempts).toBeGreaterThanOrEqual(1);
      expect(p.currentMode).toBe("degraded");
      expect(p.degradedEpisodeOpen).toBe(true);
    }
  });
});