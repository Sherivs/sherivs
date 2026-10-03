/**
 * CoreGrid — H3-046 tests: typed metrics registry
 * (`frontend/src/lib/observability/metrics-registry.ts`).
 *
 * The suite proves:
 *  1. declaration validation — typed counter/gauge/histogram families with
 *     bounded label keys; malformed declarations (bad names, unknown kinds,
 *     duplicate label keys, >4 labels, histogram without buckets, unsorted
 *     buckets, unknown keys) are rejections, never throw;
 *  2. fail-closed closed vocabulary — observations addressed to unknown
 *     metric names are rejected and counted, never recorded;
 *  3. label safety — the structural no-secrets/no-identifier gate rejects
 *     token-shaped, digest-shaped, identifier-shaped, email-shaped and
 *     credential-carrier values; rejected values are never echoed back;
 *  4. cardinality bounds — per-metric and registry-wide series ceilings are
 *     enforced as typed rejections;
 *  5. family semantics — counters accumulate, gauges hold the latest value,
 *     histograms place observations in the correct bucket with an overflow
 *     slot, count and sum;
 *  6. composition (READ-ONLY) with the existing observability modules —
 *     substrate-telemetry snapshots and health reports map into samples that
 *     record through the registry without modifying either source module;
 *  7. purity — snapshots are fresh copies; inputs are never mutated;
 *     no wall clock, no network, no database.
 */

import { describe, expect, it } from "vitest";
import {
  CORE_METRIC_DECLARATIONS,
  DEFAULT_MAX_SERIES_PER_METRIC,
  DEFAULT_MAX_SERIES_TOTAL,
  HEALTH_STATUS_VALUE,
  MAX_BUCKETS,
  MAX_LABELS_PER_METRIC,
  createMetricsRegistry,
  isSafeMetricLabelValue,
  healthCheckSamples,
  substrateTelemetrySamples,
  type MetricOutcome,
} from "@/lib/observability/metrics-registry";
import { createSubstrateTelemetry } from "@/lib/observability/substrate-telemetry";
import { buildHealthReport } from "@/lib/observability/health";

function expectRejected(
  outcome: MetricOutcome,
  code: string,
): void {
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect(outcome.code).toBe(code);
  }
}

function counterDeclaration(): { name: string; kind: "counter"; help: string; labels: string[] } {
  return {
    name: "synthetic_calls_total",
    kind: "counter",
    help: "synthetic counter",
    labels: ["provider"],
  };
}

/* ─────────────────────────────────────────────────────────────
 * 1. Label value safety gate
 * ────────────────────────────────────────────────────────────*/

describe("label value safety gate (no PII, no secrets)", () => {
  const benign = [
    "web",
    "worker",
    "primary",
    "us-east-1",
    "v1",
    "2026-10-03",
    "http-500",
    "202",
  ];

  it.each(benign)("accepts benign value %s", (value) => {
    expect(isSafeMetricLabelValue(value)).toBe(true);
  });

  const unsafe: Array<[string, string]> = [
    ["uuid", "9b2f4c1e-8a7d-4c3b-9e2f-1a2b3c4d5e6f"],
    ["email", "someone@example-site.invalid"],
    ["long hex digest", "deadbeefdeadbeefdeadbeefdeadbeef"],
    ["long digit run", "42424242424"],
    ["opaque token", "Ab3xY9_qQ2zZ8LmN0oP7vV5cCdEfGhIjKlMn"],
    ["bearer carrier", "token:abc123"],
    ["secret carrier", "secret:key-material"],
    ["api key carrier", "api_key:xyz"],
    ["provider key prefix", "sk_live_abcdefghijklmnop123456"],
    ["github token shape", "ghp_abcdefghijklmnopqrstuvwxyz012345"],
    ["slack token shape", "xoxb-123456789012-abcdefghijklmnop"],
    ["cloud access key shape", "AKIAIOSFODNN7EXAMPLE"],
    ["jwt-ish", "eyJhbGciOiJIUzI1NiJ9abc123"],
    ["long base64 blob", "c3VwZXJzZWNyZXR2YWx1ZWV4YW1wbGVob2xkZXI="],
    ["password carrier", "password:example123"],
    ["quote", 'quote"inject'],
    ["semicolon", "semi;colon"],
    ["ampersand", "a&b"],
    ["backslash", "back\\slash"],
    ["space", "two words"],
    ["at sign", "name@host"],
    ["equals", "key=value"],
    ["newline", "line\nbreak"],
  ];

  it.each(unsafe)("rejects %s", (_label, value) => {
    expect(isSafeMetricLabelValue(value)).toBe(false);
  });

  it("accepts the empty value (unset label) but nothing over the length cap", () => {
    expect(isSafeMetricLabelValue("")).toBe(true);
    expect(isSafeMetricLabelValue("a".repeat(65))).toBe(false);
    expect(isSafeMetricLabelValue("a.".repeat(32))).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Declaration validation
 * ────────────────────────────────────────────────────────────*/

describe("declaration validation", () => {
  it("admits valid counter, gauge and histogram declarations", () => {
    const registry = createMetricsRegistry();
    expect(registry.register(counterDeclaration()).ok).toBe(true);
    expect(
      registry.register({
        name: "synthetic_depth_current",
        kind: "gauge",
        help: "synthetic gauge",
        labels: [],
      }).ok,
    ).toBe(true);
    expect(
      registry.register({
        name: "synthetic_duration_ms",
        kind: "histogram",
        help: "synthetic histogram",
        labels: ["result"],
        bucketsMs: [10, 100, 1000],
      }).ok,
    ).toBe(true);
  });

  const malformed: Array<[string, unknown]> = [
    ["bad name (leading digit)", { name: "9bad", kind: "counter", help: "x", labels: [] }],
    ["bad name (caps)", { name: "BadName", kind: "counter", help: "x", labels: [] }],
    ["name too short", { name: "ab", kind: "counter", help: "x", labels: [] }],
    ["unknown kind", { name: "synthetic_x", kind: "summary", help: "x", labels: [] }],
    ["missing help", { name: "synthetic_x", kind: "counter", labels: [] }],
    ["empty help", { name: "synthetic_x", kind: "counter", help: "", labels: [] }],
    ["duplicate label keys", { name: "synthetic_x", kind: "counter", help: "x", labels: ["a", "a"] }],
    ["bad label key", { name: "synthetic_x", kind: "counter", help: "x", labels: ["Bad-Key"] }],
    ["too many label keys", {
      name: "synthetic_x",
      kind: "counter",
      help: "x",
      labels: ["a", "b", "c", "d", "e"],
    }],
    ["histogram without buckets", { name: "synthetic_x", kind: "histogram", help: "x", labels: [] }],
    ["unsorted buckets", {
      name: "synthetic_x",
      kind: "histogram",
      help: "x",
      labels: [],
      bucketsMs: [100, 10],
    }],
    ["non-finite bucket", {
      name: "synthetic_x",
      kind: "histogram",
      help: "x",
      labels: [],
      bucketsMs: [Number.POSITIVE_INFINITY],
    }],
    ["too many buckets", {
      name: "synthetic_x",
      kind: "histogram",
      help: "x",
      labels: [],
      bucketsMs: Array.from({ length: MAX_BUCKETS + 1 }, (_, i) => (i + 1) * 10),
    }],
  ];

  it.each(malformed)("rejects %s fail-closed", (_label, declaration) => {
    const registry = createMetricsRegistry();
    const outcome = registry.register(declaration);
    expectRejected(outcome, "invalid_declaration");
    expect(registry.snapshot().totalSeries).toBe(0);
  });

  it("rejects unknown keys and duplicate metric names", () => {
    const registry = createMetricsRegistry();
    expect(registry.register(counterDeclaration()).ok).toBe(true);
    expectRejected(
      registry.register({ ...counterDeclaration(), extra: true }),
      "invalid_declaration",
    );
    expectRejected(registry.register(counterDeclaration()), "duplicate_metric");
  });

  it("bounds label keys per metric at MAX_LABELS_PER_METRIC", () => {
    expect(MAX_LABELS_PER_METRIC).toBe(4);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Fail-closed recording (unknown names, unsafe labels)
 * ────────────────────────────────────────────────────────────*/

describe("fail-closed recording", () => {
  function registryWithCounter(): ReturnType<typeof createMetricsRegistry> {
    const registry = createMetricsRegistry();
    registry.register(counterDeclaration());
    return registry;
  }

  it("rejects observations to unknown metric names and counts them", () => {
    const registry = registryWithCounter();
    const outcome = registry.record("totally_undeclared_metric", 1);
    expectRejected(outcome, "unknown_metric");
    const snapshot = registry.snapshot();
    expect(snapshot.totalSeries).toBe(0);
    expect(snapshot.rejections.unknown_metric).toBe(1);
  });

  it("rejects unknown label keys", () => {
    const registry = registryWithCounter();
    expectRejected(
      registry.record("synthetic_calls_total", 1, { provider: "web", region: "us-east-1" }),
      "unknown_label_key",
    );
  });

  it("rejects missing declared labels", () => {
    const registry = registryWithCounter();
    expectRejected(registry.record("synthetic_calls_total", 1, {}), "missing_label");
  });

  it("rejects unsafe label values and never echoes them back", () => {
    const registry = registryWithCounter();
    const secret = "sk_live_abcdefghijklmnop123456";
    const outcome = registry.record("synthetic_calls_total", 1, { provider: secret });
    expectRejected(outcome, "label_value_rejected");
    if (!outcome.ok) {
      expect(outcome.detail).not.toContain(secret);
      expect(outcome.detail).not.toContain("sk_live");
    }
    expect(registry.snapshot().totalSeries).toBe(0);
    expect(registry.snapshot().rejections.label_value_rejected).toBe(1);
  });

  it("rejects non-finite and negative counter values", () => {
    const registry = registryWithCounter();
    expectRejected(registry.record("synthetic_calls_total", Number.NaN), "invalid_value");
    expectRejected(
      registry.record("synthetic_calls_total", Number.POSITIVE_INFINITY),
      "invalid_value",
    );
    expectRejected(registry.record("synthetic_calls_total", -1), "invalid_value");
    expect(registry.snapshot().totalSeries).toBe(0);
  });

  it("does not mutate caller-supplied label objects", () => {
    const registry = registryWithCounter();
    const labels = { provider: "web" };
    registry.record("synthetic_calls_total", 1, labels);
    expect(labels).toEqual({ provider: "web" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Cardinality bounds
 * ────────────────────────────────────────────────────────────*/

describe("cardinality bounds", () => {
  it("enforces the per-metric series ceiling", () => {
    const registry = createMetricsRegistry({
      declarations: [counterDeclaration()],
      maxSeriesPerMetric: 3,
    });
    for (const provider of ["p1", "p2", "p3"]) {
      expect(registry.record("synthetic_calls_total", 1, { provider }).ok).toBe(true);
    }
    expectRejected(
      registry.record("synthetic_calls_total", 1, { provider: "p4" }),
      "cardinality_exceeded",
    );
    // Re-recording an existing series stays within the bound.
    expect(registry.record("synthetic_calls_total", 1, { provider: "p1" }).ok).toBe(true);
    expect(registry.snapshot().rejections.cardinality_exceeded).toBe(1);
  });

  it("enforces the registry-wide series ceiling", () => {
    const registry = createMetricsRegistry({
      declarations: [counterDeclaration()],
      maxSeriesTotal: 2,
    });
    expect(registry.record("synthetic_calls_total", 1, { provider: "p1" }).ok).toBe(true);
    expect(registry.record("synthetic_calls_total", 1, { provider: "p2" }).ok).toBe(true);
    expectRejected(
      registry.record("synthetic_calls_total", 1, { provider: "p3" }),
      "series_cap_exceeded",
    );
    expect(DEFAULT_MAX_SERIES_PER_METRIC).toBeLessThan(DEFAULT_MAX_SERIES_TOTAL);
  });

  it("reports rejections through the injectable observer (codes only)", () => {
    const seen: Array<{ code: string; detail: string }> = [];
    const registry = createMetricsRegistry({
      onRejection: (code, detail) => seen.push({ code, detail }),
    });
    registry.record("no_such_metric", 1);
    expect(seen).toEqual([{ code: "unknown_metric", detail: "no_such_metric" }]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Family semantics (counter / gauge / histogram)
 * ────────────────────────────────────────────────────────────*/

describe("metric family semantics", () => {
  it("accumulates counters per label set", () => {
    const registry = createMetricsRegistry({ declarations: [counterDeclaration()] });
    registry.record("synthetic_calls_total", 2, { provider: "web" });
    registry.record("synthetic_calls_total", 3, { provider: "web" });
    registry.record("synthetic_calls_total", 5, { provider: "worker" });
    const family = registry.family("synthetic_calls_total");
    expect(family?.kind).toBe("counter");
    if (family?.kind === "counter") {
      expect(family.series).toEqual([
        { labels: { provider: "web" }, total: 5 },
        { labels: { provider: "worker" }, total: 5 },
      ]);
    }
  });

  it("gauges hold the latest finite value, including negative values", () => {
    const registry = createMetricsRegistry({
      declarations: [{ name: "synthetic_depth_current", kind: "gauge", help: "g", labels: [] }],
    });
    registry.record("synthetic_depth_current", 12);
    registry.record("synthetic_depth_current", -3);
    const family = registry.family("synthetic_depth_current");
    if (family?.kind === "gauge") {
      expect(family.series).toEqual([{ labels: {}, value: -3 }]);
    }
  });

  it("histograms bucket observations with an overflow slot, count and sum", () => {
    const registry = createMetricsRegistry({
      declarations: [{
        name: "synthetic_duration_ms",
        kind: "histogram",
        help: "h",
        labels: [],
        bucketsMs: [10, 100, 1000],
      }],
    });
    for (const ms of [5, 10, 50, 999, 1000, 1001, 5000]) {
      registry.record("synthetic_duration_ms", ms);
    }
    const family = registry.family("synthetic_duration_ms");
    if (family?.kind === "histogram") {
      expect(family.series).toHaveLength(1);
      const series = family.series[0];
      expect(series.bucketCounts).toEqual([2, 1, 2, 2]);
      expect(series.count).toBe(7);
      expect(series.sum).toBe(5 + 10 + 50 + 999 + 1000 + 1001 + 5000);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Composition (READ-ONLY) with the existing observability modules
 * ────────────────────────────────────────────────────────────*/

describe("composition with substrate-telemetry and health", () => {
  it("admits every core declaration and maps a live substrate snapshot", () => {
    const registry = createMetricsRegistry({ declarations: CORE_METRIC_DECLARATIONS });
    for (const declaration of CORE_METRIC_DECLARATIONS) {
      expect(registry.has(declaration.name)).toBe(true);
    }

    const telemetry = createSubstrateTelemetry({ now: () => 0 });
    telemetry.ingest({
      kind: "call_succeeded",
      provider: "webhook-main",
      operation: "send",
      attempts: 1,
      durationMs: 12,
      atMs: 0,
    });
    telemetry.ingest({
      kind: "call_failed",
      provider: "webhook-main",
      operation: "send",
      code: "timeout",
      attempt: 1,
      atMs: 1,
    });
    telemetry.ingest({ kind: "call_failed", provider: "webhook-main", operation: "send", code: "timeout", attempt: 2, atMs: 2 });

    const outcome = registry.recordAll(substrateTelemetrySamples(telemetry.snapshot()));
    expect(outcome.ok).toBe(true);

    const snapshot = registry.snapshot();
    const ingested = snapshot.families.find((f) => f.declaration.name === "substrate_events_ingested");
    const failures = snapshot.families.find(
      (f) => f.declaration.name === "substrate_adapter_call_failures",
    );
    const timeouts = snapshot.families.find((f) => f.declaration.name === "substrate_adapter_timeouts");
    expect(ingested && ingested.kind === "counter" && ingested.series[0]?.total).toBe(3);
    expect(failures && failures.kind === "counter" && failures.series[0]?.total).toBe(2);
    expect(timeouts && timeouts.kind === "counter" && timeouts.series[0]?.total).toBe(2);
  });

  it("maps health reports into status gauges with bounded label values", async () => {
    const registry = createMetricsRegistry({ declarations: CORE_METRIC_DECLARATIONS });
    const report = await buildHealthReport({
      snapshot: { uptime_s: 1, rss_mb: 10, heap_used_mb: 5 },
      version: null,
      now: () => "2026-10-03T00:00:00.000Z",
      dependencyChecks: [
        { name: "queue", check: () => ({ name: "queue", status: "ok" }) },
        {
          name: "downstream",
          check: () => ({ name: "downstream", status: "failing", error: "connect: refused" }),
        },
      ],
    });
    const outcome = registry.recordAll(healthCheckSamples(report));
    expect(outcome.ok).toBe(true);

    const family = registry.family("health_check_status");
    expect(family?.kind).toBe("gauge");
    if (family?.kind === "gauge") {
      const values = new Map(
        family.series.map((series) => [JSON.stringify(series.labels), series.value]),
      );
      expect(values.get(JSON.stringify({ check: "queue", status: "ok" }))).toBe(
        HEALTH_STATUS_VALUE.ok,
      );
      expect(values.get(JSON.stringify({ check: "downstream", status: "failing" }))).toBe(
        HEALTH_STATUS_VALUE.failing,
      );
    }
    const totals = registry.family("health_report_checks_total");
    if (totals?.kind === "gauge") {
      expect(totals.series[0]?.value).toBe(2);
    }
  });

  it("fails closed when a source module carries an unsafe label value", () => {
    const registry = createMetricsRegistry({ declarations: CORE_METRIC_DECLARATIONS });
    const outcome = registry.recordAll(
      substrateTelemetrySamples({
        eventsIngested: 1,
        malformedEventsDropped: 0,
        logEntriesBuffered: 0,
        logEntriesDropped: 0,
        providers: [
          {
            provider: "ghp_abcdefghijklmnopqrstuvwxyz012345",
            successes: 1,
            failureAttempts: 0,
            timeouts: 0,
            modeChanges: 0,
            breakerChanges: 0,
            breakerOpens: 0,
            breakerHalfOpens: 0,
            breakerCloses: 0,
            currentMode: "healthy",
            currentBreaker: "closed",
            degradedEpisodeOpen: false,
            degradedEpisodeOpenedAtMs: null,
            degradedEpisodeOpenMs: null,
            degradedEpisodesClosed: 0,
            lastDegradedEpisode: null,
            trustDecisions: 0,
            trustVerdictCounts: { trusted: 0, untrusted: 0, unproven: 0 },
            lastTrustVerdict: null,
            lastEventAtMs: 0,
            operations: [],
          },
        ],
      }),
    );
    expectRejected(outcome, "label_value_rejected");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Purity
 * ────────────────────────────────────────────────────────────*/

describe("purity", () => {
  it("returns fresh snapshot copies that do not alias internal state", () => {
    const registry = createMetricsRegistry({ declarations: [counterDeclaration()] });
    registry.record("synthetic_calls_total", 1, { provider: "web" });
    const first = registry.snapshot();
    registry.record("synthetic_calls_total", 1, { provider: "web" });
    const counterFamily = first.families.find(
      (f) => f.declaration.name === "synthetic_calls_total",
    );
    expect(counterFamily?.kind === "counter" && counterFamily.series[0]?.total).toBe(1);

    const second = registry.snapshot();
    const secondFamily = second.families.find(
      (f) => f.declaration.name === "synthetic_calls_total",
    );
    expect(secondFamily?.kind === "counter" && secondFamily.series[0]?.total).toBe(2);
  });

  it("sorts families and series deterministically", () => {
    const registry = createMetricsRegistry({
      declarations: [
        counterDeclaration(),
        { name: "aaa_first_total", kind: "counter", help: "h", labels: ["provider"] },
      ],
    });
    registry.record("synthetic_calls_total", 1, { provider: "worker" });
    registry.record("synthetic_calls_total", 1, { provider: "web" });
    const snapshot = registry.snapshot();
    expect(snapshot.families.map((f) => f.declaration.name)).toEqual([
      "aaa_first_total",
      "synthetic_calls_total",
    ]);
    const family = snapshot.families.find((f) => f.declaration.name === "synthetic_calls_total");
    if (family?.kind === "counter") {
      expect(family.series.map((s) => s.labels.provider)).toEqual(["web", "worker"]);
    }
  });
});
