/**
 * CoreGrid — health report tests (V5.3 Part 30 / LAUNCH_BLOCKER).
 * Covers the ok/degraded/failing roll-up, fail-closed normalization of bad
 * check results, throwing/async checks, and the exact leak-free payload shape.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateStatus,
  buildHealthReport,
  isHealthStatus,
  normalizeCheckResult,
  snapshotProcess,
  type DependencyCheckResult,
  type NamedDependencyCheck,
} from "@/lib/observability/health";

const FIXED_TS = "2026-10-01T00:00:00.000Z";
const FIXED_SNAPSHOT = { uptime_s: 42.5, rss_mb: 128.3, heap_used_mb: 64.1 };

function ok(name: string): DependencyCheckResult {
  return { name, status: "ok" };
}

describe("aggregateStatus (worst-wins roll-up)", () => {
  it("is ok only when every check is ok", () => {
    expect(aggregateStatus([])).toBe("ok");
    expect(aggregateStatus(["ok", "ok"])).toBe("ok");
  });
  it("degrades when any check is degraded", () => {
    expect(aggregateStatus(["ok", "degraded"])).toBe("degraded");
  });
  it("fails when any check is failing, regardless of others", () => {
    expect(aggregateStatus(["ok", "degraded", "failing"])).toBe("failing");
    expect(aggregateStatus(["failing"])).toBe("failing");
  });
  it("validates statuses", () => {
    expect(isHealthStatus("ok")).toBe(true);
    expect(isHealthStatus("degraded")).toBe(true);
    expect(isHealthStatus("failing")).toBe(true);
    expect(isHealthStatus("healthy")).toBe(false);
    expect(isHealthStatus(null)).toBe(false);
  });
});

describe("normalizeCheckResult (fail-closed)", () => {
  it("keeps well-formed results", () => {
    expect(
      normalizeCheckResult({ name: "db", status: "degraded", detail: "slow queries" }, "fb"),
    ).toEqual({ name: "db", status: "degraded", detail: "slow queries" });
  });

  it("uses the fallback name when the result omits one", () => {
    expect(normalizeCheckResult({ status: "ok" }, "fallback")).toEqual({
      name: "fallback",
      status: "ok",
    });
  });

  it("turns non-conforming results into failing, never throws", () => {
    expect(normalizeCheckResult(null, "fb")).toEqual({
      name: "fb",
      status: "failing",
      error: "invalid check result shape",
    });
    expect(normalizeCheckResult({ name: "db", status: "healthy" }, "fb")).toEqual({
      name: "db",
      status: "failing",
      error: "invalid check result status",
    });
    expect(normalizeCheckResult({ status: 42 }, "fb").status).toBe("failing");
  });
});

describe("snapshotProcess (injectable process subset)", () => {
  it("converts bytes to rounded MB and keeps uptime", () => {
    expect(
      snapshotProcess({
        uptime: () => 12.25,
        memoryUsage: () => ({ rss: 128 * 1024 * 1024 + 400_000, heapUsed: 64 * 1024 * 1024 }),
      }),
    ).toEqual({ uptime_s: 12.25, rss_mb: 128.4, heap_used_mb: 64 });
  });
});

describe("buildHealthReport (payload shape and status roll-up)", () => {
  it("emits exactly the fixed whitelist of fields", async () => {
    const report = await buildHealthReport({
      snapshot: FIXED_SNAPSHOT,
      version: "1.2.3",
      now: () => FIXED_TS,
      dependencyChecks: [{ name: "db", check: () => ok("db") }],
    });
    expect(Object.keys(report).sort()).toEqual([
      "checks",
      "memory",
      "status",
      "ts",
      "uptime_s",
      "version",
    ]);
    expect(Object.keys(report.memory).sort()).toEqual(["heap_used_mb", "rss_mb"]);
    expect(report).toEqual({
      status: "ok",
      ts: FIXED_TS,
      uptime_s: 42.5,
      memory: { rss_mb: 128.3, heap_used_mb: 64.1 },
      version: "1.2.3",
      checks: [{ name: "db", status: "ok" }],
    });
  });

  it("defaults version to null and accepts zero checks", async () => {
    const report = await buildHealthReport({ snapshot: FIXED_SNAPSHOT, now: () => FIXED_TS });
    expect(report.version).toBeNull();
    expect(report.checks).toEqual([]);
    expect(report.status).toBe("ok");
  });

  it("rolls up degraded and failing dependency checks", async () => {
    const checks: NamedDependencyCheck[] = [
      { name: "db", check: () => ok("db") },
      { name: "cache", check: () => ({ name: "cache", status: "degraded", detail: "high latency" }) },
      { name: "queue", check: () => ({ name: "queue", status: "failing", error: "unreachable" }) },
    ];
    const degraded = await buildHealthReport({
      snapshot: FIXED_SNAPSHOT,
      now: () => FIXED_TS,
      dependencyChecks: checks.slice(0, 2),
    });
    expect(degraded.status).toBe("degraded");

    const failing = await buildHealthReport({
      snapshot: FIXED_SNAPSHOT,
      now: () => FIXED_TS,
      dependencyChecks: checks,
    });
    expect(failing.status).toBe("failing");
  });

  it("supports async checks and turns rejections into failing checks", async () => {
    const report = await buildHealthReport({
      snapshot: FIXED_SNAPSHOT,
      now: () => FIXED_TS,
      dependencyChecks: [
        { name: "async-ok", check: () => Promise.resolve(ok("async-ok")) },
        {
          name: "async-boom",
          check: () => Promise.reject(new Error("connection refused")),
        },
        {
          name: "sync-boom",
          check: () => {
            throw new TypeError("not ready");
          },
        },
      ],
    });
    expect(report.status).toBe("failing");
    expect(report.checks).toEqual([
      { name: "async-ok", status: "ok" },
      { name: "async-boom", status: "failing", error: "Error: connection refused" },
      { name: "sync-boom", status: "failing", error: "TypeError: not ready" },
    ]);
  });

  it("sanitizes thrown errors: message only, never a stack", async () => {
    const report = await buildHealthReport({
      snapshot: FIXED_SNAPSHOT,
      now: () => FIXED_TS,
      dependencyChecks: [
        {
          name: "boom",
          check: () => {
            throw new Error("x");
          },
        },
      ],
    });
    const err = report.checks[0]?.error ?? "";
    expect(err).toBe("Error: x");
    expect(err).not.toContain("at ");
    expect(JSON.stringify(report)).not.toContain("\n");
  });

  it("leaks no secret-shaped values into the payload", async () => {
    const report = await buildHealthReport({
      snapshot: FIXED_SNAPSHOT,
      version: "1.0.0",
      now: () => FIXED_TS,
      dependencyChecks: [{ name: "db", check: () => ok("db") }],
    });
    const json = JSON.stringify(report);
    for (const marker of ["SUPABASE", "postgres://", "sk-", "Bearer ", "password="]) {
      expect(json).not.toContain(marker);
    }
  });
});