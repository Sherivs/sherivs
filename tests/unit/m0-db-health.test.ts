import { describe, expect, it, vi } from "vitest";
import {
  createDatabaseHealthCheck,
  DB_HEALTH_CHECK_NAME,
} from "@/lib/observability/db-health.server";
import { buildHealthReport } from "@/lib/observability/health";

describe("M0 database health check", () => {
  it("reports ok when the database answers", async () => {
    const check = createDatabaseHealthCheck({ probe: async () => true, nowMs: () => 0 });
    expect(await check.check()).toEqual({ name: DB_HEALTH_CHECK_NAME, status: "ok" });
  });

  it("reports failing, in fixed words, when the query errors or throws", async () => {
    const errored = createDatabaseHealthCheck({ probe: async () => false, nowMs: () => 0 });
    expect(await errored.check()).toEqual({
      name: "database",
      status: "failing",
      detail: "query failed",
    });
    const thrown = createDatabaseHealthCheck({
      probe: async () => {
        throw new Error("postgres://user:pw@host/db refused");
      },
      nowMs: () => 0,
    });
    const result = await thrown.check();
    expect(result).toEqual({ name: "database", status: "failing", detail: "not reachable" });
    expect(JSON.stringify(result)).not.toMatch(/postgres:|pw@/);
  });

  it("gives up after the time limit instead of hanging the endpoint", async () => {
    vi.useFakeTimers();
    const check = createDatabaseHealthCheck({
      probe: () => new Promise<boolean>(() => {}),
      nowMs: () => 0,
      timeoutMs: 50,
    });
    const pending = check.check();
    await vi.advanceTimersByTimeAsync(60);
    expect(await pending).toEqual({
      name: "database",
      status: "failing",
      detail: "no answer in time",
    });
    vi.useRealTimers();
  });

  it("does not leave a rejection unhandled when the probe fails after the time limit", async () => {
    vi.useFakeTimers();
    let reject: (e: Error) => void = () => {};
    const check = createDatabaseHealthCheck({
      probe: () => new Promise<boolean>((_, r) => (reject = r)),
      nowMs: () => 0,
      timeoutMs: 50,
    });
    const pending = check.check();
    await vi.advanceTimersByTimeAsync(60);
    expect((await pending).detail).toBe("no answer in time");
    reject(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
  });

  it("caches the answer so repeated calls do not each query the database", async () => {
    let now = 0;
    const probe = vi.fn(async () => true);
    const check = createDatabaseHealthCheck({ probe, nowMs: () => now, cacheMs: 1_000 });
    await check.check();
    await check.check();
    now = 999;
    await check.check();
    expect(probe).toHaveBeenCalledTimes(1);
    now = 1_001;
    await check.check();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("shares one query between concurrent callers", async () => {
    const probe = vi.fn(async () => true);
    const check = createDatabaseHealthCheck({ probe, nowMs: () => 0 });
    await Promise.all([check.check(), check.check(), check.check()]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("turns the whole report to failing when the database is down", async () => {
    const report = await buildHealthReport({
      version: "1",
      now: () => "2026-11-16T00:00:00.000Z",
      snapshot: { uptime_s: 1, rss_mb: 1, heap_used_mb: 1 },
      dependencyChecks: [createDatabaseHealthCheck({ probe: async () => false, nowMs: () => 0 })],
    });
    expect(report.status).toBe("failing");
    expect(report.checks).toHaveLength(1);
  });
});
