/**
 * M14 pilot metrics report formatting.
 *
 * Pure functions over the aggregate report returned by `pilot_metrics_report`. The input holds
 * counters only; there is no personal identifier anywhere in the shape, and suppressed values
 * (fewer than the minimum observations) are never rendered as a number.
 */

export interface PilotMetricRow {
  metricKey: string;
  title: string;
  kind: "rate" | "duration";
  unit: "ratio" | "seconds";
  captureMethod: string;
  samples: number;
  numerator: number | null;
  denominator: number | null;
  suppressed: boolean;
  value: number | null;
}

export interface PilotMetricsReport {
  periodStart: string;
  periodEnd: string;
  minObservations: number;
  metrics: PilotMetricRow[];
}

export interface PilotMetricDisplay {
  metricKey: string;
  title: string;
  display: string;
  note: string;
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "n/a";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatPilotMetric(row: PilotMetricRow, minObservations: number): PilotMetricDisplay {
  if (row.suppressed || row.value === null) {
    return {
      metricKey: row.metricKey,
      title: row.title,
      display: "Not enough data",
      note: `Suppressed: fewer than ${minObservations} observations in this period.`,
    };
  }
  const display =
    row.kind === "rate" ? `${(row.value * 100).toFixed(1)}%` : formatSeconds(row.value);
  return {
    metricKey: row.metricKey,
    title: row.title,
    display,
    note: `${row.samples} sample${row.samples === 1 ? "" : "s"}, ${row.denominator} observations.`,
  };
}

export function formatPilotReport(report: PilotMetricsReport): PilotMetricDisplay[] {
  return report.metrics.map((row) => formatPilotMetric(row, report.minObservations));
}

/** Baseline vs outcome: relative change of the same metric across two periods. */
export function compareToBaseline(
  baseline: PilotMetricRow,
  outcome: PilotMetricRow,
): { direction: "up" | "down" | "flat" | "unavailable"; change: number | null } {
  if (baseline.suppressed || outcome.suppressed || baseline.value === null || outcome.value === null) {
    return { direction: "unavailable", change: null };
  }
  if (baseline.value === 0) return { direction: "unavailable", change: null };
  const change = (outcome.value - baseline.value) / baseline.value;
  const rounded = Math.round(change * 10000) / 10000;
  return { direction: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat", change: rounded };
}

export function renderPilotReportMarkdown(report: PilotMetricsReport): string {
  const lines = [
    `# Pilot metrics ${report.periodStart} to ${report.periodEnd}`,
    "",
    "| Metric | Value | Note |",
    "| --- | --- | --- |",
  ];
  for (const d of formatPilotReport(report)) {
    lines.push(`| ${d.title} | ${d.display} | ${d.note} |`);
  }
  return lines.join("\n") + "\n";
}
