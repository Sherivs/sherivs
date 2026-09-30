/**
 * CoreGrid — Phase 05 Core Application Runtime: self-report tests.
 *
 * The runtime's self-check is only worth showing if it can fail, so these tests
 * prove (a) the report reflects the shipped contracts, (b) every check passes
 * today, and (c) a failing check would be named rather than absorbed.
 */
import { describe, expect, it } from "vitest";

import {
  runRuntimeSelfCheck,
  runtimeSelfReport,
  runtimeSubsystems,
} from "@/lib/runtime-self-report";
import { JOB_STATUSES } from "@/lib/runtime-jobs";
import { CAPABILITY_STATUSES } from "@/lib/runtime-capabilities";

describe("Phase 05 — the runtime reports its own execution fabric", () => {
  it("names the subsystems the runtime owns and their real state vocabularies", () => {
    const subsystems = runtimeSubsystems();
    const ids = subsystems.map((subsystem) => subsystem.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "capabilities",
        "jobs",
        "events",
        "approvals",
        "command-query",
        "resilience",
      ]),
    );
    for (const subsystem of subsystems) {
      expect(subsystem.owns.length, `${subsystem.id} must state what it owns`).toBeGreaterThan(0);
      expect(subsystem.states.length, `${subsystem.id} must expose its states`).toBeGreaterThan(0);
    }
    const jobs = subsystems.find((subsystem) => subsystem.id === "jobs");
    expect(jobs?.states).toEqual(JOB_STATUSES);
    const capabilities = subsystems.find((subsystem) => subsystem.id === "capabilities");
    expect(capabilities?.states).toEqual(CAPABILITY_STATUSES);
  });
});

describe("Phase 05 — the self-check exercises the shipped state machines", () => {
  it("passes every check on the current runtime", () => {
    const checks = runRuntimeSelfCheck();

    expect(checks.length).toBeGreaterThanOrEqual(5);
    expect(checks.filter((check) => !check.ok)).toEqual([]);
    for (const check of checks) {
      expect(check.detail.length, `${check.id} must report its evidence`).toBeGreaterThan(0);
      expect(check.proves.length, `${check.id} must state what it proves`).toBeGreaterThan(0);
    }
  });

  it("covers the behaviours that keep execution safe", () => {
    const ids = runRuntimeSelfCheck().map((check) => check.id);

    expect(ids).toContain("rate-limit-window");
    expect(ids).toContain("circuit-breaker");
    expect(ids).toContain("timeout-policy");
    expect(ids).toContain("event-compatibility");
    expect(ids).toContain("command-idempotency");
  });

  it("is deterministic: the same runtime yields the same result", () => {
    expect(runRuntimeSelfCheck().map((check) => check.ok)).toEqual(
      runRuntimeSelfCheck().map((check) => check.ok),
    );
  });
});

describe("Phase 05 — the report cannot claim a health the runtime lacks", () => {
  it("counts passes and failures consistently and names failures", () => {
    const report = runtimeSelfReport();

    expect(report.passed + report.failed).toBe(report.checks.length);
    expect(report.healthy).toBe(report.failed === 0);
    expect(report.failingChecks).toEqual(
      report.checks.filter((check) => !check.ok).map((c) => c.id),
    );
    expect(report.failingChecks).toEqual([]);
  });
});
