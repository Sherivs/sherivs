/**
 * CoreGrid — typed metrics registry (MISSION H3-046, Constitution §29).
 *
 * A PURE, fail-closed declaration registry for typed metric families
 * (counter / gauge / histogram) with bounded label cardinality and a
 * structural no-secrets / no-identifier gate on every label value.
 *
 * Governing rules baked into the schema:
 *  - Closed metric vocabulary: a metric name must be declared first. Any
 *    observation addressed to an unknown name is rejected (never recorded,
 *    never thrown, counted as a rejection) — fail-closed, in the same spirit
 *    as the substrate-telemetry collector's malformed-event drop.
 *  - Bounded cardinality: at most `MAX_LABELS_PER_METRIC` label keys per
 *    metric, at most `maxSeriesPerMetric` distinct label-value sets per
 *    metric, and at most `maxSeriesTotal` distinct series in the registry.
 *    Exceeding a bound is a typed rejection, never silent absorption.
 *  - No PII / no secrets in labels (§19, §29, §30): label values must match
 *    a tight structural charset and must fail every secret-shaped and
 *    identifier-shaped detector (tokens, JWTs, UUIDs, emails, long hex or
 *    base64 blobs, credential assignments, bearer strings, long opaque
 *    ids). The validator is a deny-by-default structural gate: if a value
 *    is not demonstrably benign-shaped, it is rejected.
 *  - Purity: no I/O, no wall clock, no randomness. Aggregates are exposed
 *    as fresh copies. Rejections are observable via typed codes and a
 *    rejection ledger (codes only — rejected label values are NEVER echoed
 *    back, so a rejected secret cannot leak through the rejection path).
 *
 * Composition (READ-ONLY): `substrateTelemetrySamples` maps a
 * SubstrateTelemetrySnapshot and `healthCheckSamples` maps a HealthReport
 * into recordable samples; the core declarations for those families ship
 * with the module. Neither source module is modified.
 */

import { z } from "zod";
import type { SubstrateTelemetrySnapshot } from "./substrate-telemetry";
import type { HealthReport, HealthStatus } from "./health";

/* ─────────────────────────────────────────────────────────────
 * Bounds
 * ────────────────────────────────────────────────────────────*/

export const MAX_LABELS_PER_METRIC = 4;
export const MAX_LABEL_VALUE_LENGTH = 64;
export const MAX_METRIC_NAME_LENGTH = 128;
export const MAX_HELP_LENGTH = 512;
export const MAX_BUCKETS = 16;
export const DEFAULT_MAX_SERIES_PER_METRIC = 64;
export const DEFAULT_MAX_SERIES_TOTAL = 256;

/* ─────────────────────────────────────────────────────────────
 * Label value safety gate (no PII, no secrets, no identifiers)
 * ────────────────────────────────────────────────────────────*/

/**
 * The only characters a label value may contain. Deliberately excludes
 * `@`, whitespace, quotes, `=`, `;`, `&`, `\`, and control characters —
 * the structural carriers of emails, injected headers and credential
 * assignments.
 */
const LABEL_VALUE_CHARSET = /^[A-Za-z0-9_.:/%+-]*$/;

/** Values that look like secrets or secret carriers. */
const SECRET_SHAPED_PATTERNS: readonly RegExp[] = [
  /^ey[A-Za-z0-9_-]{10,}$/, // JWT first segment
  /^(?:sk|pk|rk)[-_.][A-Za-z0-9_-]+$/, // provider key prefixes
  /^gh[pousr]_[A-Za-z0-9]+$/, // GitHub tokens
  /^github_pat_[A-Za-z0-9_]+$/,
  /^xox[a-z]-[A-Za-z0-9-]+$/, // Slack tokens
  /^AKIA[0-9A-Z]{16}$/, // cloud access keys
  /(?:password|passwd|secret|token|api[-_]?key|credential|bearer|authorization)\s*[:=]/i, // assignment carrier
  /-----BEGIN [A-Z ]+-----/, // PEM armor
  /^[A-Za-z0-9+/]{40,}={0,2}$/, // long base64 blobs
  /^[A-Fa-f0-9]{32,}$/, // long hex digests
];

/** Values that look like personal or entity identifiers. */
const IDENTIFIER_SHAPED_PATTERNS: readonly RegExp[] = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/, // email
  /^[0-9]{7,}$/, // long digit runs (account/phone ids)
  /^[0-9a-f]{16,}$/i, // hex ids
  /^[A-Za-z0-9_-]{25,}$/, // long opaque tokens
];

/** Fail-closed structural gate: reject unless the value is benign-shaped. */
export function isSafeMetricLabelValue(value: string): boolean {
  if (value.length === 0) return true;
  if (value.length > MAX_LABEL_VALUE_LENGTH) return false;
  if (!LABEL_VALUE_CHARSET.test(value)) return false;
  return !SECRET_SHAPED_PATTERNS.some((pattern) => pattern.test(value)) &&
    !IDENTIFIER_SHAPED_PATTERNS.some((pattern) => pattern.test(value));
}

export const safeLabelValueSchema = z
  .string()
  .max(MAX_LABEL_VALUE_LENGTH)
  .refine(isSafeMetricLabelValue, "label value failed the no-secrets/no-identifier gate");

/* ─────────────────────────────────────────────────────────────
 * Metric declarations (typed families)
 * ────────────────────────────────────────────────────────────*/

export const METRIC_KINDS = ["counter", "gauge", "histogram"] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

const METRIC_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const LABEL_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export const metricNameSchema = z
  .string()
  .min(3)
  .max(MAX_METRIC_NAME_LENGTH)
  .regex(METRIC_NAME_PATTERN, "metric names are snake_case without leading digits");

export const labelKeySchema = z
  .string()
  .min(1)
  .max(MAX_LABEL_VALUE_LENGTH)
  .regex(LABEL_KEY_PATTERN, "label keys are snake_case without leading digits");

export const metricDeclarationSchema = z
  .strictObject({
    name: metricNameSchema,
    kind: z.enum(METRIC_KINDS),
    help: z.string().min(1).max(MAX_HELP_LENGTH),
    labels: z.array(labelKeySchema).max(MAX_LABELS_PER_METRIC),
    bucketsMs: z
      .array(z.number().refine(Number.isFinite, "bucket bounds must be finite"))
      .min(1)
      .max(MAX_BUCKETS)
      .optional(),
  })
  .refine((decl) => new Set(decl.labels).size === decl.labels.length, {
    message: "duplicate label keys",
  })
  .refine((decl) => decl.kind !== "histogram" || (decl.bucketsMs?.length ?? 0) > 0, {
    message: "histogram declarations require a non-empty bucketsMs list",
  })
  .refine(
    (decl) => {
      const buckets = decl.bucketsMs;
      return (
        buckets == null ||
        buckets.every((bound, index) => index === 0 || bound > buckets[index - 1])
      );
    },
    { message: "histogram bucket bounds must be strictly increasing" },
  );

export type MetricDeclaration = z.infer<typeof metricDeclarationSchema>;

/* ─────────────────────────────────────────────────────────────
 * Outcomes (fail-closed, typed, content-free)
 * ────────────────────────────────────────────────────────────*/

export type MetricRejectionCode =
  | "invalid_declaration"
  | "duplicate_metric"
  | "unknown_metric"
  | "unknown_label_key"
  | "missing_label"
  | "label_value_rejected"
  | "invalid_value"
  | "cardinality_exceeded"
  | "series_cap_exceeded";

export type MetricOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: MetricRejectionCode; readonly detail: string };

function rejection(code: MetricRejectionCode, detail: string): MetricOutcome {
  return { ok: false, code, detail };
}

const ACCEPTED: MetricOutcome = { ok: true };

/* ─────────────────────────────────────────────────────────────
 * Series shapes (exposed as fresh copies)
 * ────────────────────────────────────────────────────────────*/

export interface CounterSeries {
  readonly labels: Readonly<Record<string, string>>;
  readonly total: number;
}

export interface GaugeSeries {
  readonly labels: Readonly<Record<string, string>>;
  /** Latest finite observation; gauge values may be negative. */
  readonly value: number;
}

export interface HistogramSeries {
  readonly labels: Readonly<Record<string, string>>;
  /** Counts aligned with `bucketsMs`; the final slot is the +Inf bucket. */
  readonly bucketCounts: readonly number[];
  readonly count: number;
  readonly sum: number;
}

export interface CounterFamily {
  readonly kind: "counter";
  readonly declaration: MetricDeclaration;
  readonly series: readonly CounterSeries[];
}

export interface GaugeFamily {
  readonly kind: "gauge";
  readonly declaration: MetricDeclaration;
  readonly series: readonly GaugeSeries[];
}

export interface HistogramFamily {
  readonly kind: "histogram";
  readonly declaration: MetricDeclaration;
  readonly series: readonly HistogramSeries[];
}

export type MetricFamily = CounterFamily | GaugeFamily | HistogramFamily;

export interface MetricsRegistrySnapshot {
  readonly families: readonly MetricFamily[];
  readonly totalSeries: number;
  readonly rejections: Readonly<Record<MetricRejectionCode, number>>;
}

/* ─────────────────────────────────────────────────────────────
 * The registry
 * ────────────────────────────────────────────────────────────*/

export interface MetricsRegistryOptions {
  /** Declarations validated and admitted at construction (fail-closed). */
  declarations?: readonly unknown[];
  /** Ceiling on distinct label-value sets per metric. */
  maxSeriesPerMetric?: number;
  /** Ceiling on distinct series across the whole registry. */
  maxSeriesTotal?: number;
  /** Optional observer invoked with every typed rejection (codes only). */
  onRejection?: (code: MetricRejectionCode, detail: string) => void;
}

export interface MetricsRegistry {
  /** Validate and admit a declaration; duplicates and malformed input are rejections. */
  register(declaration: unknown): MetricOutcome;
  has(name: string): boolean;
  /** Record one observation. Unknown names and unsafe labels fail closed. */
  record(
    metricName: string,
    value: number,
    labels?: Readonly<Record<string, string>>,
  ): MetricOutcome;
  /** Record a batch; stops at the first rejection and reports it. */
  recordAll(samples: readonly MetricSample[]): MetricOutcome;
  snapshot(): MetricsRegistrySnapshot;
  family(name: string): MetricFamily | null;
}

export interface MetricSample {
  readonly metric: string;
  readonly value: number;
  readonly labels?: Readonly<Record<string, string>>;
}

const REJECTION_CODES: readonly MetricRejectionCode[] = [
  "invalid_declaration",
  "duplicate_metric",
  "unknown_metric",
  "unknown_label_key",
  "missing_label",
  "label_value_rejected",
  "invalid_value",
  "cardinality_exceeded",
  "series_cap_exceeded",
];

interface SeriesState {
  labels: Record<string, string>;
  /** counter total / gauge value. */
  scalar: number;
  bucketCounts: number[];
  histogramCount: number;
  histogramSum: number;
}

interface FamilyState {
  declaration: MetricDeclaration;
  series: Map<string, SeriesState>;
}

export function createMetricsRegistry(
  options: MetricsRegistryOptions = {},
): MetricsRegistry {
  const maxSeriesPerMetric = options.maxSeriesPerMetric ?? DEFAULT_MAX_SERIES_PER_METRIC;
  const maxSeriesTotal = options.maxSeriesTotal ?? DEFAULT_MAX_SERIES_TOTAL;

  const families = new Map<string, FamilyState>();
  const rejections = Object.fromEntries(
    REJECTION_CODES.map((code) => [code, 0]),
  ) as Record<MetricRejectionCode, number>;

  function report(outcome: MetricOutcome): MetricOutcome {
    if (!outcome.ok) {
      rejections[outcome.code] += 1;
      options.onRejection?.(outcome.code, outcome.detail);
    }
    return outcome;
  }

  function register(raw: unknown): MetricOutcome {
    const parsed = metricDeclarationSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first ? first.path.join(".") : "(root)";
      return report(rejection("invalid_declaration", `invalid metric declaration at ${path}`));
    }
    const declaration = parsed.data;
    if (families.has(declaration.name)) {
      return report(rejection("duplicate_metric", declaration.name));
    }
    families.set(declaration.name, { declaration, series: new Map() });
    return ACCEPTED;
  }

  function seriesKey(labels: Readonly<Record<string, string>>): string {
    const keys = Object.keys(labels).sort();
    return keys.map((key) => `${key}=${labels[key]}`).join("|");
  }

  function admitSeries(
    state: FamilyState,
    labels: Record<string, string>,
  ): SeriesState | MetricOutcome {
    const key = seriesKey(labels);
    const existing = state.series.get(key);
    if (existing != null) return existing;
    if (state.series.size >= maxSeriesPerMetric) {
      return rejection("cardinality_exceeded", state.declaration.name);
    }
    let totalSeries = 0;
    for (const family of families.values()) totalSeries += family.series.size;
    if (totalSeries >= maxSeriesTotal) {
      return rejection("series_cap_exceeded", state.declaration.name);
    }
    const created: SeriesState = {
      labels,
      scalar: 0,
      bucketCounts: new Array((state.declaration.bucketsMs?.length ?? 0) + 1).fill(0),
      histogramCount: 0,
      histogramSum: 0,
    };
    state.series.set(key, created);
    return created;
  }

  function record(
    metricName: string,
    value: number,
    rawLabels: Readonly<Record<string, string>> = {},
  ): MetricOutcome {
    const state = families.get(metricName);
    if (state == null) {
      return report(rejection("unknown_metric", metricName));
    }
    if (!Number.isFinite(value)) {
      return report(rejection("invalid_value", metricName));
    }
    if (state.declaration.kind === "counter" && value < 0) {
      return report(rejection("invalid_value", metricName));
    }

    const declaredKeys = state.declaration.labels;
    for (const key of declaredKeys) {
      if (!(key in rawLabels)) {
        return report(rejection("missing_label", `${metricName}.${key}`));
      }
    }
    const boundedLabels: Record<string, string> = {};
    for (const [key, value_] of Object.entries(rawLabels)) {
      if (!declaredKeys.includes(key)) {
        return report(rejection("unknown_label_key", `${metricName}.${key}`));
      }
      if (typeof value_ !== "string" || !isSafeMetricLabelValue(value_)) {
        // The rejected value is never echoed — rejections stay content-free.
        return report(rejection("label_value_rejected", `${metricName}.${key}`));
      }
      boundedLabels[key] = value_;
    }

    const admitted = admitSeries(state, boundedLabels);
    if ("ok" in admitted) return report(admitted);
    const series = admitted;

    switch (state.declaration.kind) {
      case "counter":
        series.scalar += value;
        break;
      case "gauge":
        series.scalar = value;
        break;
      case "histogram": {
        const buckets = state.declaration.bucketsMs ?? [];
        let slot = buckets.findIndex((bound) => value <= bound);
        if (slot === -1) slot = buckets.length;
        series.bucketCounts[slot] += 1;
        series.histogramCount += 1;
        series.histogramSum += value;
        break;
      }
    }
    return ACCEPTED;
  }

  for (const declaration of options.declarations ?? []) {
    register(declaration);
  }

  function toFamily(state: FamilyState): MetricFamily {
    const declaration = state.declaration;
    const seriesStates = [...state.series.values()].sort((a, b) =>
      seriesKey(a.labels) < seriesKey(b.labels) ? -1 : 1,
    );
    if (declaration.kind === "counter") {
      return {
        kind: "counter",
        declaration,
        series: seriesStates.map((series) => ({
          labels: { ...series.labels },
          total: series.scalar,
        })),
      };
    }
    if (declaration.kind === "gauge") {
      return {
        kind: "gauge",
        declaration,
        series: seriesStates.map((series) => ({
          labels: { ...series.labels },
          value: series.scalar,
        })),
      };
    }
    return {
      kind: "histogram",
      declaration,
      series: seriesStates.map((series) => ({
        labels: { ...series.labels },
        bucketCounts: [...series.bucketCounts],
        count: series.histogramCount,
        sum: series.histogramSum,
      })),
    };
  }

  return {
    register,

    has(name: string): boolean {
      return families.has(name);
    },

    record,

    recordAll(samples: readonly MetricSample[]): MetricOutcome {
      for (const sample of samples) {
        const outcome = record(sample.metric, sample.value, sample.labels ?? {});
        if (!outcome.ok) return outcome;
      }
      return ACCEPTED;
    },

    snapshot(): MetricsRegistrySnapshot {
      let totalSeries = 0;
      const familiesOut: MetricFamily[] = [];
      for (const state of [...families.values()].sort((a, b) =>
        a.declaration.name < b.declaration.name ? -1 : 1,
      )) {
        familiesOut.push(toFamily(state));
        totalSeries += state.series.size;
      }
      return {
        families: familiesOut,
        totalSeries,
        rejections: { ...rejections },
      };
    },

    family(name: string): MetricFamily | null {
      const state = families.get(name);
      return state == null ? null : toFamily(state);
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Built-in declarations (composed READ-ONLY with the substrate
 * telemetry collector and the health report builder)
 * ────────────────────────────────────────────────────────────*/

export const CORE_METRIC_DECLARATIONS: readonly MetricDeclaration[] = [
  { name: "substrate_events_ingested", kind: "counter", help: "Accepted adapter policy events.", labels: [] },
  { name: "substrate_events_malformed_dropped", kind: "counter", help: "Dropped malformed adapter policy events.", labels: [] },
  { name: "substrate_adapter_calls_succeeded", kind: "counter", help: "Resolved substrate adapter calls.", labels: ["provider"] },
  { name: "substrate_adapter_call_failures", kind: "counter", help: "Failed substrate adapter call attempts.", labels: ["provider"] },
  { name: "substrate_adapter_timeouts", kind: "counter", help: "Timed-out substrate adapter attempts.", labels: ["provider"] },
  { name: "substrate_adapter_breaker_opens", kind: "counter", help: "Breaker trips per substrate adapter provider.", labels: ["provider"] },
  { name: "substrate_adapter_degraded_episodes_closed", kind: "counter", help: "Closed degraded episodes per provider.", labels: ["provider"] },
  { name: "health_report_checks_total", kind: "gauge", help: "Declared dependency checks in the last health report.", labels: [] },
  { name: "health_check_status", kind: "gauge", help: "Dependency check status as ok=1, degraded=0, failing=-1.", labels: ["check", "status"] },
];

/** Fixed numeric encoding of health statuses (bounded label vocabulary). */
export const HEALTH_STATUS_VALUE: Readonly<Record<HealthStatus, number>> = {
  ok: 1,
  degraded: 0,
  failing: -1,
};

/** Map a substrate-telemetry snapshot into recordable samples. */
export function substrateTelemetrySamples(
  snapshot: SubstrateTelemetrySnapshot,
): readonly MetricSample[] {
  const samples: MetricSample[] = [
    { metric: "substrate_events_ingested", value: snapshot.eventsIngested },
    {
      metric: "substrate_events_malformed_dropped",
      value: snapshot.malformedEventsDropped,
    },
  ];
  for (const provider of snapshot.providers) {
    const labels = { provider: provider.provider };
    samples.push(
      { metric: "substrate_adapter_calls_succeeded", value: provider.successes, labels },
      { metric: "substrate_adapter_call_failures", value: provider.failureAttempts, labels },
      { metric: "substrate_adapter_timeouts", value: provider.timeouts, labels },
      { metric: "substrate_adapter_breaker_opens", value: provider.breakerOpens, labels },
      {
        metric: "substrate_adapter_degraded_episodes_closed",
        value: provider.degradedEpisodesClosed,
        labels,
      },
    );
  }
  return samples;
}

/** Map a health report into recordable samples. */
export function healthCheckSamples(report: HealthReport): readonly MetricSample[] {
  const samples: MetricSample[] = [
    { metric: "health_report_checks_total", value: report.checks.length },
  ];
  for (const check of report.checks) {
    samples.push({
      metric: "health_check_status",
      value: HEALTH_STATUS_VALUE[check.status],
      labels: { check: check.name, status: check.status },
    });
  }
  return samples;
}
