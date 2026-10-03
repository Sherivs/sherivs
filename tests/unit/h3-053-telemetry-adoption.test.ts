/**
 * CoreGrid — substrate telemetry adoption depth tests (MISSION H3-053, §29/§31).
 *
 * Companion to tests/unit/mh-27-substrate-telemetry.test.ts (ground truth):
 * that suite proves straight-line aggregation, basic redaction, episode
 * accounting, and live wiring for the eight substrate adapters. This file
 * DEEPENS the same collector (frontend/src/lib/observability/substrate-
 * telemetry.ts, read-only) with adversarial/depth coverage it does not
 * already carry:
 *
 *  - malformed-payload depth: arrays, functions, symbols, primitives,
 *    non-string kinds, whitespace-only providers, non-finite numbers,
 *    case-sensitive enum rejection — and the invariant that a dropped
 *    event never fabricates provider state;
 *  - cardinality/size bounds: the DEFAULT 500-entry buffer cap, a zero
 *    cap, bounded malformed-drop warn entries, and a high-cardinality
 *    (provider × operation) flood with exact accounting;
 *  - redaction guarantees: hostile secret-bearing extra fields riding on
 *    EVERY event kind (exact key-whitelist assertions), a hostile own
 *    "__proto__" property (prototype-pollution resistance), and
 *    insensitive extra fields being ignored;
 *  - house-shape stability: exact field sets of entries, snapshot,
 *    provider and operation aggregates, fixed code/verdict vocabularies,
 *    component defaulting and the exported constants;
 *  - degraded-episode adversarial depth: instantaneous degraded→degraded
 *    episodes, isolated-mode transitions, close-before-open clock skew,
 *    and clamping of negative live durations;
 *  - sink-failure containment: a throwing emit sink and a throwing live
 *    observer never corrupt aggregation state and never double-emit;
 *  - lookup null-paths and cross-collector isolation.
 *
 * Purity: no network, no database, no real timers — clocks are injected.
 */
import { describe, expect, it } from "vitest";
import {
  createSubstrateTelemetry,
  EMPTY_FAILURE_CODE_COUNTS,
  EMPTY_TRUST_VERDICT_COUNTS,
  SUBSTRATE_TELEMETRY_COMPONENT,
  type SubstrateTelemetry,
} from "@/lib/observability/substrate-telemetry";
import { formatLogLine, type StructuredLogEntry } from "@/lib/observability/structured-log";
import type { AdapterPolicyEvent } from "@/lib/adapters/failure-policy";

const FIXED_TS = "2026-10-02T00:00:00.000Z";
const CANARY = "sk-live-canary-0a1b2c3d4e5f";

/* ── event builders (mirroring the failure-policy vocabulary) ── */

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

/** Adds hostile extra properties (including secret-shaped ones) to an event. */
function poison(event: AdapterPolicyEvent, extras: Record<string, unknown>): AdapterPolicyEvent {
  const target = event as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(extras)) {
    target[key] = value;
  }
  return event;
}

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

describe("fail-closed malformed-payload depth (beyond mh-27's primitives)", () => {
  it("drops structural non-objects: arrays, functions, symbols, booleans, strings", () => {
    const telemetry = createSubstrateTelemetry();
    expect(telemetry.ingest([])).toBe(false);
    expect(telemetry.ingest(["call_failed", "p1"])).toBe(false);
    expect(telemetry.ingest((): void => undefined)).toBe(false);
    expect(telemetry.ingest(Symbol("event"))).toBe(false);
    expect(telemetry.ingest(true)).toBe(false);
    expect(telemetry.ingest("call_failed")).toBe(false);

    const snap = telemetry.snapshot();
    expect(snap.malformedEventsDropped).toBe(6);
    expect(snap.eventsIngested).toBe(0);
    expect(snap.providers).toHaveLength(0);
  });

  it("rejects non-string `kind` values and reports them as event_kind unknown", () => {
    const telemetry = createSubstrateTelemetry();
    expect(telemetry.ingest({ kind: 5, provider: "p1", atMs: 1 })).toBe(false);
    expect(telemetry.ingest({ kind: ["call_failed"], provider: "p1", atMs: 1 })).toBe(false);
    expect(telemetry.ingest({ kind: null, provider: "p1", atMs: 1 })).toBe(false);

    const entries = telemetry.takeLogEntries();
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect((entry as Record<string, unknown>).event_kind).toBe("unknown");
    }
  });

  it("rejects whitespace-only providers and non-finite timestamps", () => {
    const telemetry = createSubstrateTelemetry();
    expect(
      telemetry.ingest(succeeded("   ", "op.read", 1, 1, 1)),
    ).toBe(false);
    expect(telemetry.ingest(succeeded("", "op.read", 1, 1, 1))).toBe(false);
    expect(
      telemetry.ingest({ kind: "call_succeeded", provider: "p1", operation: "op.read", attempts: 1, durationMs: 1, atMs: Number.NaN }),
    ).toBe(false);
    expect(
      telemetry.ingest({ kind: "call_succeeded", provider: "p1", operation: "op.read", attempts: 1, durationMs: 1, atMs: Number.POSITIVE_INFINITY }),
    ).toBe(false);
    expect(
      telemetry.ingest({ kind: "call_succeeded", provider: "p1", operation: "op.read", attempts: 1, durationMs: 1, atMs: "5" }),
    ).toBe(false);

    const snap = telemetry.snapshot();
    expect(snap.malformedEventsDropped).toBe(5);
    expect(snap.providers).toHaveLength(0);
  });

  it("rejects out-of-range numerics and case-mismatched enum vocabulary", () => {
    const telemetry = createSubstrateTelemetry();
    expect(
      telemetry.ingest({ kind: "call_succeeded", provider: "p1", operation: "op.read", attempts: 0, durationMs: 1, atMs: 1 }),
    ).toBe(false);
    expect(
      telemetry.ingest({ kind: "call_succeeded", provider: "p1", operation: "op.read", attempts: 1, durationMs: -1, atMs: 1 }),
    ).toBe(false);
    expect(
      telemetry.ingest({ kind: "call_succeeded", provider: "p1", operation: "op.read", attempts: 1, durationMs: Number.POSITIVE_INFINITY, atMs: 1 }),
    ).toBe(false);
    expect(
      telemetry.ingest({ kind: "call_failed", provider: "p1", operation: "op.read", code: "TIMEOUT", attempt: 1, atMs: 1, reason: "r" }),
    ).toBe(false);
    expect(
      telemetry.ingest({ kind: "call_failed", provider: "p1", operation: "op.read", code: "timeout", attempt: Number.NaN, atMs: 1, reason: "r" }),
    ).toBe(false);
    expect(
      telemetry.ingest({ kind: "call_failed", provider: "p1", operation: "op.read", code: "timeout", attempt: -1, atMs: 1, reason: "r" }),
    ).toBe(false);
    expect(
      telemetry.ingest({ kind: "mode_change", provider: "p1", from: "healthy", atMs: 1, reason: "r" }),
    ).toBe(false);
    expect(
      telemetry.ingest({ kind: "breaker_change", provider: "p1", from: "closed", to: "OPEN", atMs: 1, reason: "r" }),
    ).toBe(false);
    expect(
      telemetry.ingest({ kind: "trust_decision", provider: "p1", atMs: 1, reason: "r" }),
    ).toBe(false);

    expect(telemetry.snapshot().malformedEventsDropped).toBe(9);
  });

  it("preserves the string `kind` in drop entries when validation fails on other fields", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest({ kind: "call_failed", provider: "p1", operation: "op.read", code: "TIMEOUT", attempt: 1, atMs: 1, reason: "r" });
    const entry = telemetry.takeLogEntries()[0] as Record<string, unknown>;
    expect(entry.event_kind).toBe("call_failed");
    expect(Object.keys(entry).sort()).toEqual(["component", "event_kind", "level", "msg"]);
  });

  it("a dropped event never fabricates provider state for its named provider", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest({ kind: "trust_decision", provider: "ghost-provider", atMs: 1, reason: "r" });
    telemetry.ingest({ kind: "mode_change", provider: "ghost-provider", from: "nope", to: "degraded", atMs: 2, reason: "r" });

    expect(telemetry.provider("ghost-provider")).toBeNull();
    const snap = telemetry.snapshot();
    expect(snap.providers).toHaveLength(0);
    expect(snap.eventsIngested).toBe(0);
    expect(snap.malformedEventsDropped).toBe(2);
  });

  it("accepts boundary numerics: zero duration, attempt 1, atMs 0", () => {
    const telemetry = createSubstrateTelemetry();
    expect(telemetry.ingest(succeeded("p1", "op.zero", 1, 0, 0))).toBe(true);
    const op = telemetry.operation("p1", "op.zero");
    expect(op?.successes).toBe(1);
    expect(op?.lastSuccessDurationMs).toBe(0);
    expect(telemetry.provider("p1")?.lastEventAtMs).toBe(0);
    const entry = telemetry.takeLogEntries()[0] as Record<string, unknown>;
    expect(entry.duration_ms).toBe(0);
  });
});

describe("cardinality and size bounds", () => {
  it("applies the DEFAULT 500-entry buffer cap exactly, discarding oldest first", () => {
    const telemetry: SubstrateTelemetry = createSubstrateTelemetry();
    for (let i = 0; i < 600; i += 1) {
      telemetry.ingest(succeeded("p1", `op.${i}`, 1, i, i));
    }

    expect(telemetry.bufferedLogCount()).toBe(500);
    const snap = telemetry.snapshot();
    expect(snap.logEntriesBuffered).toBe(500);
    expect(snap.logEntriesDropped).toBe(100);

    const entries = telemetry.takeLogEntries();
    expect(entries).toHaveLength(500);
    const first = entries[0] as Record<string, unknown>;
    const last = entries[entries.length - 1] as Record<string, unknown>;
    expect(first.operation).toBe("op.100");
    expect(last.operation).toBe("op.599");
    expect(telemetry.bufferedLogCount()).toBe(0);
    expect(telemetry.snapshot().logEntriesDropped).toBe(100);
  });

  it("honors a zero buffer cap: every entry is counted as dropped", () => {
    const telemetry = createSubstrateTelemetry({ maxBufferedEntries: 0 });
    telemetry.ingest(succeeded("p1", "op.read", 1, 1, 1));
    telemetry.ingest(failed("p1", "op.read", "timeout", 1, 1, "r"));
    telemetry.ingest(trustDecision("p1", "untrusted", 2, "r"));

    expect(telemetry.bufferedLogCount()).toBe(0);
    expect(telemetry.takeLogEntries()).toHaveLength(0);
    const snap = telemetry.snapshot();
    expect(snap.logEntriesDropped).toBe(3);
    expect(snap.logEntriesBuffered).toBe(0);
    // Aggregation is unaffected by emission pressure.
    expect(snap.eventsIngested).toBe(3);
    expect(telemetry.provider("p1")?.successes).toBe(1);
  });

  it("bounds malformed-drop warn entries under the same cap", () => {
    const telemetry = createSubstrateTelemetry({ maxBufferedEntries: 1 });
    telemetry.ingest({ kind: "bogus", provider: "p1", atMs: 1 });
    telemetry.ingest({ kind: "bogus-too", provider: "p1", atMs: 2 });

    expect(telemetry.bufferedLogCount()).toBe(1);
    const snap = telemetry.snapshot();
    expect(snap.malformedEventsDropped).toBe(2);
    expect(snap.logEntriesDropped).toBe(1);
  });

  it("survives a high-cardinality (provider × operation) flood with exact accounting", () => {
    const telemetry = createSubstrateTelemetry({ maxBufferedEntries: 0 });
    const PROVIDERS = 40;
    const OPS_PER_PROVIDER = 6;

    for (let p = 0; p < PROVIDERS; p += 1) {
      const provider = `provider-${String(p).padStart(2, "0")}`;
      for (let o = 0; o < OPS_PER_PROVIDER; o += 1) {
        telemetry.ingest(succeeded(provider, `op.${o}`, 1, o, o));
      }
    }

    const snap = telemetry.snapshot();
    expect(snap.eventsIngested).toBe(PROVIDERS * OPS_PER_PROVIDER);
    expect(snap.providers).toHaveLength(PROVIDERS);

    let totalSuccesses = 0;
    for (const provider of snap.providers) {
      expect(provider.operations).toHaveLength(OPS_PER_PROVIDER);
      expect(provider.successes).toBe(OPS_PER_PROVIDER);
      totalSuccesses += provider.successes;
      const names = provider.operations.map((op) => op.operation);
      expect(names).toEqual([...names].sort());
    }
    expect(totalSuccesses).toBe(PROVIDERS * OPS_PER_PROVIDER);
    expect(snap.providers.map((p) => p.provider)).toEqual([...snap.providers.map((p) => p.provider)].sort());
  });

  it("deduplicates repeated (provider, operation) pairs into a single aggregate", () => {
    const telemetry = createSubstrateTelemetry();
    for (let i = 0; i < 5; i += 1) {
      telemetry.ingest(succeeded("p1", "op.read", 1, i, i));
    }
    const p1 = telemetry.provider("p1");
    expect(p1?.operations).toHaveLength(1);
    expect(p1?.successes).toBe(5);
    expect(p1?.operations[0]?.successes).toBe(5);
    expect(p1?.operations[0]?.lastSuccessDurationMs).toBe(4);
  });

  it("sorts providers by UTF-16 code units (uppercase before lowercase)", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(succeeded("b", "op.read", 1, 1, 1));
    telemetry.ingest(succeeded("A", "op.read", 1, 1, 1));
    telemetry.ingest(succeeded("a", "op.read", 1, 1, 1));
    telemetry.ingest(succeeded("B", "op.read", 1, 1, 1));

    expect(telemetry.snapshot().providers.map((p) => p.provider)).toEqual(["A", "B", "a", "b"]);
  });
});

describe("redaction guarantees across every event kind", () => {
  it("carries only the whitelisted fields for call_succeeded entries", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(
      poison(succeeded("p1", "op.read", 1, 5, 1), {
        api_key: CANARY,
        password: CANARY,
        authorization: `Bearer ${CANARY}`,
        payload: { token: CANARY },
      }),
    );

    const entries = telemetry.takeLogEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0] as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual([
      "attempts", "component", "duration_ms", "level", "msg", "operation", "provider",
    ]);
    expect(JSON.stringify(entries)).not.toContain(CANARY);
    expect(JSON.stringify(entries)).not.toContain("authorization");
    expect(JSON.stringify(entries)).not.toContain("payload");
  });

  it("carries only the whitelisted fields for mode_change and breaker_change entries", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(
      poison(modeChange("p1", "healthy", "degraded", 1, "r1"), {
        secret_reason: CANARY,
        stack_trace: CANARY,
      }),
    );
    telemetry.ingest(
      poison(breakerChange("p1", "closed", "open", 2, "r2"), {
        refresh_token: CANARY,
        provider_response: CANARY,
      }),
    );

    const entries = telemetry.takeLogEntries();
    expect(entries).toHaveLength(2);
    const modeEntry = entries[0] as Record<string, unknown>;
    const breakerEntry = entries[1] as Record<string, unknown>;
    expect(Object.keys(modeEntry).sort()).toEqual(["component", "from", "level", "msg", "provider", "to"]);
    expect(Object.keys(breakerEntry).sort()).toEqual(["component", "from", "level", "msg", "provider", "to"]);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(CANARY);
    expect(serialized).not.toContain("secret_reason");
    expect(serialized).not.toContain("refresh_token");
    expect(serialized).not.toContain("provider_response");
  });

  it("carries only the whitelisted fields for trust_decision entries", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(
      poison(trustDecision("p1", "untrusted", 1, "r1"), {
        private_key: CANARY,
        evidence_blob: CANARY,
      }),
    );

    const entry = telemetry.takeLogEntries()[0] as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(["component", "level", "msg", "provider", "verdict"]);
    expect(JSON.stringify(entry)).not.toContain(CANARY);
    expect(JSON.stringify(entry)).not.toContain("evidence_blob");
  });

  it("ignores benign extra fields too (no passthrough of unknown properties)", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(
      poison(succeeded("p1", "op.read", 1, 5, 1), {
        requestId: 12345,
        trace_flags: "01",
      }),
    );

    const entry = telemetry.takeLogEntries()[0] as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual([
      "attempts", "component", "duration_ms", "level", "msg", "operation", "provider",
    ]);
    expect(JSON.stringify(entry)).not.toContain("requestId");
    expect(JSON.stringify(entry)).not.toContain("trace_flags");
  });

  it("resists a hostile own __proto__ property (prototype-pollution ingress)", () => {
    const telemetry = createSubstrateTelemetry();
    const poisoned = succeeded("p1", "op.read", 1, 5, 1);
    Object.defineProperty(poisoned, "__proto__", {
      value: { polluted: CANARY },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    telemetry.ingest(poisoned);

    const entries = telemetry.takeLogEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0] as Record<string, unknown>;
    expect(Object.getPrototypeOf(entry)).toBe(Object.prototype);
    expect(Object.keys(entry).sort()).toEqual([
      "attempts", "component", "duration_ms", "level", "msg", "operation", "provider",
    ]);
    expect(JSON.stringify(entries)).not.toContain("polluted");
    expect(JSON.stringify(entries)).not.toContain(CANARY);
    // Aggregates (built from collector state, never from the event) stay clean.
    expect(JSON.stringify(telemetry.snapshot())).not.toContain("polluted");
  });

  it("keeps succeeded/trust aggregates clean in the snapshot (not only log entries)", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(
      poison(succeeded("p1", "op.read", 1, 5, 1), { api_key: CANARY, reason: `tok=${CANARY}` }),
    );
    telemetry.ingest(
      poison(trustDecision("p1", "untrusted", 2, `verdict note ${CANARY}`), { session_key: CANARY }),
    );

    const snap = JSON.stringify(telemetry.snapshot());
    expect(snap).not.toContain(CANARY);
    expect(snap).not.toContain("api_key");
    expect(snap).not.toContain("session_key");
    expect(snap).not.toContain("verdict note");
  });

  it("survives a poisoned event whose reason embeds a JSON-escape attempt", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(
      failed("p1", "op.read", "provider_error", 1, 1, `oops "\\u0041" ${CANARY} "}</script>`),
    );

    const entry = telemetry.takeLogEntries()[0] as StructuredLogEntry;
    expect(Object.keys(entry).sort()).toEqual([
      "attempt", "code", "component", "level", "msg", "operation", "provider",
    ]);
    const line = formatLogLine(entry, { now: () => FIXED_TS });
    expect(line).not.toContain(CANARY);
    // The line must remain valid single-line JSON (no raw control/format breakouts).
    expect(() => JSON.parse(line)).not.toThrow();
  });
});

describe("house-shape stability (contracts downstream consumers rely on)", () => {
  it("exposes the stable component constant and empty vocabularies", () => {
    expect(SUBSTRATE_TELEMETRY_COMPONENT).toBe("substrate-telemetry");
    expect(Object.keys(EMPTY_FAILURE_CODE_COUNTS)).toEqual(["timeout", "provider_error", "breaker_open"]);
    expect(Object.values(EMPTY_FAILURE_CODE_COUNTS)).toEqual([0, 0, 0]);
    expect(Object.keys(EMPTY_TRUST_VERDICT_COUNTS)).toEqual(["trusted", "untrusted", "unproven"]);
    expect(Object.values(EMPTY_TRUST_VERDICT_COUNTS)).toEqual([0, 0, 0]);
  });

  it("snapshot, provider and operation aggregates carry exactly their documented field sets", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(succeeded("p1", "op.read", 1, 5, 1));
    telemetry.ingest(failed("p1", "op.read", "timeout", 1, 2, "r"));
    telemetry.ingest(modeChange("p1", "healthy", "degraded", 3, "r1"));
    telemetry.ingest(breakerChange("p1", "closed", "open", 4, "r2"));
    telemetry.ingest(trustDecision("p1", "untrusted", 5, "r3"));

    const snap = telemetry.snapshot();
    expect(Object.keys(snap).sort()).toEqual([
      "eventsIngested", "logEntriesBuffered", "logEntriesDropped", "malformedEventsDropped", "providers",
    ]);
    expect(snap.providers).toHaveLength(1);

    const p1 = snap.providers[0] as unknown as Record<string, unknown>;
    expect(Object.keys(p1).sort()).toEqual([
      "breakerChanges", "breakerCloses", "breakerHalfOpens", "breakerOpens",
      "currentBreaker", "currentMode", "degradedEpisodeOpen", "degradedEpisodeOpenMs",
      "degradedEpisodeOpenedAtMs", "degradedEpisodesClosed", "failureAttempts",
      "lastDegradedEpisode", "lastEventAtMs", "lastTrustVerdict", "modeChanges",
      "operations", "provider", "successes", "timeouts", "trustDecisions", "trustVerdictCounts",
    ]);

    const op = p1.operations as unknown as Record<string, unknown>[];
    expect(op).toHaveLength(1);
    expect(Object.keys(op[0] as object).sort()).toEqual([
      "codes", "failureAttempts", "lastEventAtMs", "lastFailureAtMs",
      "lastSuccessDurationMs", "operation", "provider", "successes",
    ]);

    const codes = op[0]?.codes as unknown as Record<string, unknown>;
    expect(Object.keys(codes)).toEqual(["timeout", "provider_error", "breaker_open"]);
    expect(codes).toEqual({ timeout: 1, provider_error: 0, breaker_open: 0 });
  });

  it("defaults the component field and honors a custom one on every entry class", () => {
    const defaulted = createSubstrateTelemetry();
    defaulted.ingest(succeeded("p1", "op.read", 1, 1, 1));
    defaulted.ingest({ kind: "bogus", provider: "p1", atMs: 1 });
    const defaultEntries = defaulted.takeLogEntries();
    for (const entry of defaultEntries) {
      expect((entry as Record<string, unknown>).component).toBe(SUBSTRATE_TELEMETRY_COMPONENT);
    }

    const custom = createSubstrateTelemetry({ component: "substrate-telemetry-test" });
    custom.ingest(failed("p1", "op.read", "timeout", 1, 1, "r"));
    const customEntry = custom.takeLogEntries()[0] as Record<string, unknown>;
    expect(customEntry.component).toBe("substrate-telemetry-test");
  });

  it("formats mode-change lines through the house formatter with the right severity and fields", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(
      poison(modeChange("p1", "healthy", "degraded", 1, `secret=${CANARY}`), { api_key: CANARY }),
    );
    const entry = telemetry.takeLogEntries()[0];
    const line = formatLogLine(entry, { now: () => FIXED_TS });
    expect(line).not.toContain(CANARY);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      ts: FIXED_TS,
      level: "warn",
      msg: "substrate-adapter-mode-change",
      component: SUBSTRATE_TELEMETRY_COMPONENT,
      provider: "p1",
      from: "healthy",
      to: "degraded",
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "component", "from", "level", "msg", "provider", "to", "ts",
    ]);
  });

  it("returns fresh deep copies from provider() so callers cannot corrupt state", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(succeeded("p1", "op.read", 1, 5, 1));

    const p1 = telemetry.provider("p1");
    if (p1) {
      p1.successes = 999;
      if (p1.operations[0]) {
        p1.operations[0].successes = 888;
        p1.operations[0].codes.timeout = 777;
      }
    }
    const fresh = telemetry.provider("p1");
    expect(fresh?.successes).toBe(1);
    expect(fresh?.operations[0]?.successes).toBe(1);
    expect(fresh?.operations[0]?.codes.timeout).toBe(0);
  });
});

describe("degraded-episode adversarial depth", () => {
  it("treats degraded→degraded as an instantaneous open-and-close (openMs 0)", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(modeChange("p1", "degraded", "degraded", 100, "self-transition"));

    const p1 = telemetry.provider("p1");
    expect(p1?.currentMode).toBe("degraded");
    expect(p1?.degradedEpisodesClosed).toBe(1);
    expect(p1?.degradedEpisodeOpen).toBe(false);
    expect(p1?.lastDegradedEpisode).toEqual({ openedAtMs: 100, closedAtMs: 100, openMs: 0 });
  });

  it("isolated mode never opens an episode; degraded→isolated closes an open one", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(modeChange("p1", "healthy", "isolated", 100, "r1"));
    let p1 = telemetry.provider("p1");
    expect(p1?.currentMode).toBe("isolated");
    expect(p1?.degradedEpisodeOpen).toBe(false);
    expect(p1?.degradedEpisodesClosed).toBe(0);

    telemetry.ingest(modeChange("p1", "isolated", "degraded", 200, "r2"));
    p1 = telemetry.provider("p1");
    expect(p1?.degradedEpisodeOpen).toBe(true);
    expect(p1?.degradedEpisodeOpenedAtMs).toBe(200);

    telemetry.ingest(modeChange("p1", "degraded", "isolated", 500, "r3"));
    p1 = telemetry.provider("p1");
    expect(p1?.degradedEpisodeOpen).toBe(false);
    expect(p1?.degradedEpisodesClosed).toBe(1);
    expect(p1?.lastDegradedEpisode).toEqual({ openedAtMs: 200, closedAtMs: 500, openMs: 300 });
    expect(p1?.currentMode).toBe("isolated");
  });

  it("clamps a close event that arrives before the open (clock skew) to openMs 0", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(modeChange("p1", "healthy", "degraded", 1_000, "r1"));
    telemetry.ingest(modeChange("p1", "degraded", "healthy", 500, "skewed-close"));

    const p1 = telemetry.provider("p1");
    expect(p1?.degradedEpisodesClosed).toBe(1);
    expect(p1?.lastDegradedEpisode).toEqual({ openedAtMs: 1_000, closedAtMs: 1_000, openMs: 0 });
    expect(p1?.degradedEpisodeOpen).toBe(false);
  });

  it("never reports a negative live open duration even when now() precedes the open", () => {
    const telemetry = createSubstrateTelemetry({ now: () => 500 });
    telemetry.ingest(modeChange("p1", "healthy", "degraded", 1_000, "r1"));

    const p1 = telemetry.provider("p1");
    expect(p1?.degradedEpisodeOpen).toBe(true);
    expect(p1?.degradedEpisodeOpenMs).toBe(0);
  });

  it("chains three episode opens and closes across isolated-mode detours", () => {
    const clock = manualClock();
    const telemetry = createSubstrateTelemetry({ now: clock.now });
    telemetry.ingest(modeChange("p1", "healthy", "degraded", 100, "r1"));
    telemetry.ingest(modeChange("p1", "degraded", "isolated", 200, "r2"));
    telemetry.ingest(modeChange("p1", "isolated", "degraded", 300, "r3"));
    telemetry.ingest(modeChange("p1", "degraded", "healthy", 600, "r4"));
    telemetry.ingest(modeChange("p1", "healthy", "degraded", 900, "r5"));
    telemetry.ingest(modeChange("p1", "degraded", "healthy", 1_000, "r6"));

    const p1 = telemetry.provider("p1");
    expect(p1?.degradedEpisodesClosed).toBe(3);
    expect(p1?.degradedEpisodeOpen).toBe(false);
    expect(p1?.lastDegradedEpisode).toEqual({ openedAtMs: 900, closedAtMs: 1_000, openMs: 100 });
    expect(p1?.currentMode).toBe("healthy");
  });
});

describe("sink-failure containment", () => {
  it("a throwing emit sink never corrupts aggregation and never double-emits", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(succeeded("p1", "op.read", 1, 5, 1));
    telemetry.ingest(succeeded("p1", "op.read", 1, 6, 2));
    telemetry.ingest(failed("p1", "op.read", "timeout", 1, 3, "r"));

    let sinkCalls = 0;
    const flakySink = (): void => {
      sinkCalls += 1;
      if (sinkCalls === 2) throw new Error("sink down");
    };

    // The buffer is drained before emission, so the failure surfaces on the
    // second line but no entry is re-emitted afterwards.
    expect(() => telemetry.emitPendingLogs({ sink: flakySink, now: () => FIXED_TS })).toThrow("sink down");
    expect(sinkCalls).toBe(2);
    expect(telemetry.bufferedLogCount()).toBe(0);

    // Aggregation state survived untouched.
    const p1 = telemetry.provider("p1");
    expect(p1?.successes).toBe(2);
    expect(p1?.failureAttempts).toBe(1);
    const snap = telemetry.snapshot();
    expect(snap.eventsIngested).toBe(3);
    expect(snap.logEntriesBuffered).toBe(0);
    expect(snap.logEntriesDropped).toBe(0);

    // The collector remains fully usable after the failure.
    telemetry.ingest(trustDecision("p1", "untrusted", 4, "r"));
    expect(telemetry.bufferedLogCount()).toBe(1);
    const lines: string[] = [];
    expect(telemetry.emitPendingLogs({ sink: (line) => lines.push(line), now: () => FIXED_TS })).toBe(1);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ msg: "substrate-adapter-trust-decision" });
  });

  it("a throwing live observer leaves aggregation consistent (fail-fast, no silent loss)", () => {
    const telemetry = createSubstrateTelemetry({
      onEntry: (): never => {
        throw new Error("observer down");
      },
    });

    expect(() => telemetry.ingest(succeeded("p1", "op.read", 1, 5, 1))).toThrow("observer down");
    // The event was still counted and aggregated before emission blew up.
    let snap = telemetry.snapshot();
    expect(snap.eventsIngested).toBe(1);
    expect(telemetry.provider("p1")?.successes).toBe(1);
    expect(snap.logEntriesBuffered).toBe(0);

    // Malformed drops behave the same way: counted, never swallowed.
    expect(() => telemetry.ingest(42)).toThrow("observer down");
    snap = telemetry.snapshot();
    expect(snap.malformedEventsDropped).toBe(1);
    expect(snap.eventsIngested).toBe(1);
  });
});

describe("lookup null-paths and cross-collector isolation", () => {
  it("returns null for unknown providers, unknown operations, and mismatched pairs", () => {
    const telemetry = createSubstrateTelemetry();
    telemetry.ingest(succeeded("p1", "op.read", 1, 5, 1));

    expect(telemetry.provider("nope")).toBeNull();
    expect(telemetry.operation("p1", "op.write")).toBeNull();
    expect(telemetry.operation("nope", "op.read")).toBeNull();
    telemetry.ingest(succeeded("p2", "op.sync", 1, 1, 1));
    expect(telemetry.operation("p2", "op.read")).toBeNull();
    expect(telemetry.operation("p1", "op.read")).not.toBeNull();
  });

  it("keeps two collectors fully independent (no shared aggregation state)", () => {
    const a = createSubstrateTelemetry();
    const b = createSubstrateTelemetry();
    a.ingest(succeeded("p1", "op.read", 1, 5, 1));
    b.ingest(succeeded("p2", "op.sync", 1, 7, 1));

    expect(a.snapshot().providers.map((p) => p.provider)).toEqual(["p1"]);
    expect(b.snapshot().providers.map((p) => p.provider)).toEqual(["p2"]);
    expect(a.snapshot().eventsIngested).toBe(1);
    expect(b.snapshot().eventsIngested).toBe(1);
    expect(a.snapshot().malformedEventsDropped).toBe(0);
    expect(b.snapshot().malformedEventsDropped).toBe(0);
  });
});