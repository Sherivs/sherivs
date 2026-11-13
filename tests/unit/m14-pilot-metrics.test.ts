import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareToBaseline,
  formatPilotReport,
  formatSeconds,
  renderPilotReportMarkdown,
  type PilotMetricsReport,
} from "../../frontend/src/lib/scholar/pilot-metrics-report";

const migration = readFileSync(
  "database/supabase/migrations/20261104017000_sherivs_m14_pilot_metrics.sql",
  "utf8",
);
const rollback = readFileSync(
  "database/supabase/rollbacks/20261104017000_sherivs_m14_pilot_metrics.sql",
  "utf8",
);
const harness = readFileSync("tests/integration/m14-pilot-metrics.local.sql", "utf8");
const method = readFileSync("docs/pilot/baseline-capture-method.md", "utf8");
const report = JSON.parse(
  readFileSync("tests/fixtures/pilot-metrics-report.synthetic.json", "utf8"),
) as PilotMetricsReport;

const tables = ["pilot_metric_definitions", "pilot_metric_samples", "pilot_metric_sample_log"];

describe("M14 pilot metrics schema", () => {
  it("contains no personal-identifier columns or person references", () => {
    const create = migration.match(/CREATE TABLE public\.pilot_metric_[\s\S]*?\);\n/g) ?? [];
    expect(create).toHaveLength(3);
    for (const stmt of create) {
      expect(stmt).not.toMatch(
        /\b(name|email|phone|user_id|student_id|staff_id|teacher_id|guardian|parent|person|subject|actor_id|recorded_by|created_by)\b\s+(text|uuid)/i,
      );
      expect(stmt).not.toMatch(/REFERENCES public\.(users|students)\b/);
    }
  });

  it("enables and forces RLS and grants authenticated SELECT only", () => {
    for (const t of tables) {
      expect(migration).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY;`);
    }
    expect(migration).toMatch(/GRANT SELECT ON public\.pilot_metric_definitions[^;]*TO authenticated;/);
    expect(migration).not.toMatch(/GRANT[^;]*\banon\b/i);
    expect(migration).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE|TRUNCATE)\b[^;]*TO authenticated/i);
  });

  it("pins search_path on every SECURITY DEFINER function", () => {
    const fns = migration.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\n\$\$;/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(8);
    for (const f of fns) if (/SECURITY DEFINER/.test(f)) expect(f).toContain("SET search_path = ''");
  });

  it("suppresses small cohorts and keeps history append-only", () => {
    expect(migration).toContain("coalesce(t.den, 0) < 5");
    expect(migration).toContain("pilot_metric_log_immutable");
    expect(migration).toContain("pilot metric samples cannot be deleted");
  });

  it("rolls back non-destructively", () => {
    expect(rollback).toContain("REVOKE EXECUTE ON FUNCTION");
    expect(rollback).not.toMatch(/DROP\s+(TABLE|SCHEMA)|DELETE\s+FROM|TRUNCATE/i);
  });

  it("ships a real-Postgres harness and a documented baseline capture method", () => {
    expect(harness).toContain("M14 ALL PASS");
    expect(harness).toContain("personal-identifier-like columns");
    for (const key of [
      "attendance_capture_rate",
      "result_turnaround",
      "fee_reconciliation_time",
      "asc_export_completeness",
    ]) {
      expect(method).toContain(key);
    }
  });
});

describe("M14 report from synthetic fixtures", () => {
  it("formats rates, durations and suppressed values", () => {
    const rows = Object.fromEntries(formatPilotReport(report).map((r) => [r.metricKey, r]));
    expect(rows.attendance_capture_rate.display).toBe("75.0%");
    expect(rows.asc_export_completeness.display).toBe("95.0%");
    expect(rows.result_turnaround.display).toBe("10h 0m");
    expect(rows.fee_reconciliation_time.display).toBe("Not enough data");
    expect(rows.fee_reconciliation_time.note).toContain("fewer than 5");
  });

  it("formats seconds defensively", () => {
    expect(formatSeconds(59)).toBe("0m");
    expect(formatSeconds(90061)).toBe("1d 1h");
    expect(formatSeconds(-1)).toBe("n/a");
    expect(formatSeconds(Number.NaN)).toBe("n/a");
  });

  it("compares to a baseline only when both sides are visible", () => {
    const [asc, att, fee, res] = report.metrics;
    expect(compareToBaseline(att, { ...att, value: 0.9 })).toEqual({ direction: "up", change: 0.2 });
    expect(compareToBaseline(res, { ...res, value: 18000 })).toEqual({ direction: "down", change: -0.5 });
    expect(compareToBaseline(asc, asc).direction).toBe("flat");
    expect(compareToBaseline(fee, res).direction).toBe("unavailable");
  });

  it("renders markdown with no identifiers and no suppressed number", () => {
    const md = renderPilotReportMarkdown(report);
    expect(md).toContain("| Attendance capture rate | 75.0% |");
    expect(md).toContain("Not enough data");
    expect(md).not.toMatch(/36000|9000/);
    expect(JSON.stringify(report)).not.toMatch(/student|email|phone|user/i);
  });
});
