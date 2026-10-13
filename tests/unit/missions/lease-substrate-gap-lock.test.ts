/**
 * Classified lease-substrate gap lock — MISSIONS / OBSERVABILITY.
 *
 * Proves closing the lease-substrate schema gap remains unauthorized:
 * tokens are false, the V1-003 sibling stays AUTHORED_NOT_APPLIED, V1-004
 * still fail-closes with lease_substrate_missing, and Hermes does not invent
 * assigned-without-lease as mission_stuck. Does not apply the sibling, does
 * not author a migration, does not tear down worker-launch's lease port.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEASE_SUBSTRATE_GAP_CLASSIFICATION,
  LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED,
  LEASE_SUBSTRATE_GAP_VERSION_TARGET,
  LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED,
  LEASE_SUBSTRATE_MIGRATION_PATH,
  LEASE_SUBSTRATE_MIGRATION_STATUS,
  assertLeaseSubstrateGapRemainsUnauthorized,
  isLeaseSubstrateGapCloseAuthorized,
} from "@/lib/missions/lease-substrate-gap-lock";
import type { MissionExecutionState } from "@/lib/missions/mission-execution";
import { listHermesFindingsFromState } from "@/lib/hermes/hermes-findings-list";

const ROOT = process.cwd();
const LOCK_SRC = join(ROOT, "frontend/src/lib/missions/lease-substrate-gap-lock.ts");
const EXECUTION_DB_SRC = join(ROOT, "frontend/src/lib/missions/mission-execution-db.server.ts");
const LEASE_DB_SRC = join(ROOT, "frontend/src/lib/missions/mission-lease-db.server.ts");
const FINDINGS_SRC = join(ROOT, "frontend/src/lib/hermes/hermes-findings-list.ts");
const FINDINGS_SERVER_SRC = join(ROOT, "frontend/src/lib/hermes/hermes-findings-list.server.ts");
const PHASE52_SRC = join(ROOT, "frontend/src/lib/workforce/phase52-attachment.ts");
const SIBLING_MIGRATION = join(ROOT, LEASE_SUBSTRATE_MIGRATION_PATH);

const TENANT = "tenant-alpha";
const T0 = "2026-10-01T12:00:00.000Z";
const NOW = "2026-10-01T12:05:00.000Z"; // 5 minutes later — past the 60s stale window

function assignedLeaseNullStale(executionId: string): MissionExecutionState {
  return {
    executionId,
    tenantId: TENANT,
    missionId: `MISSION-${executionId}`,
    missionVersion: "1.0",
    assignedBy: "operator-1",
    lastWorkerId: null,
    action: "record-observation",
    idempotencyKey: `idem-${executionId}-0000001`,
    realityRef: "cg_entity:11111111-1111-4111-8111-111111111111",
    stage: "assigned",
    attempt: 0,
    failureCount: 0,
    retryScheduledAt: null,
    lease: null,
    evidenceIds: [],
    verificationDecision: null,
    denyReason: null,
    assignedAt: T0,
    updatedAt: T0,
  };
}

describe("lease-substrate gap classified lock — tokens", () => {
  it("authorized tokens are false", () => {
    expect(LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED).toBe(false);
    expect(LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED).toBe(false);
  });

  it("assertLeaseSubstrateGapRemainsUnauthorized does not throw on the shipped constants", () => {
    expect(() => assertLeaseSubstrateGapRemainsUnauthorized()).not.toThrow();
  });

  it("isLeaseSubstrateGapCloseAuthorized() === false", () => {
    expect(isLeaseSubstrateGapCloseAuthorized()).toBe(false);
  });

  it("classification, version target, AUTHORED_NOT_APPLIED, and migration path", () => {
    expect(LEASE_SUBSTRATE_GAP_CLASSIFICATION).toBe("CLASSIFIED_NOT_IMPLEMENTATION_AUTHORIZED");
    expect(LEASE_SUBSTRATE_GAP_VERSION_TARGET).toBe("ACTIVE-V1");
    expect(LEASE_SUBSTRATE_MIGRATION_STATUS).toBe("AUTHORED_NOT_APPLIED");
    expect(LEASE_SUBSTRATE_MIGRATION_PATH).toBe(
      "database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql",
    );
  });
});

describe("lease-substrate gap classified lock — source pins", () => {
  it("V1-003 sibling migration still exists (authored, not deleted)", () => {
    expect(existsSync(SIBLING_MIGRATION)).toBe(true);
    const header = readFileSync(SIBLING_MIGRATION, "utf8").slice(0, 800);
    expect(header).toMatch(/AUTHORED,\s*NOT APPLIED/);
  });

  it("mission-execution-db.server.ts still contains lease_substrate_missing and MISSION_LEASE_SUBSTRATE_GAP", () => {
    const source = readFileSync(EXECUTION_DB_SRC, "utf8");
    expect(source).toMatch(/lease_substrate_missing/);
    expect(source).toMatch(/MISSION_LEASE_SUBSTRATE_GAP/);
  });

  it("hermes-findings-list.ts still drops assigned+lease-null mission_stuck", () => {
    const source = readFileSync(FINDINGS_SRC, "utf8");
    expect(source).toMatch(/isLeaseGapAssignedStuck|lease === null[\s\S]*stage === ["']assigned["']/);
    expect(source).toMatch(/mission_stuck/);
    expect(source).toMatch(/assertLeaseSubstrateGapRemainsUnauthorized\(\)/);
    expect(source).not.toMatch(/\bisLeaseSubstrateGapCloseAuthorized\b/);
  });

  it("hermes-findings-list.ts / .server.ts do NOT contain cg_mission_lease", () => {
    expect(readFileSync(FINDINGS_SRC, "utf8")).not.toMatch(/cg_mission_lease/);
    expect(readFileSync(FINDINGS_SERVER_SRC, "utf8")).not.toMatch(/cg_mission_lease/);
  });

  it("lock, findings list, and findings-list server do not start a resident process", () => {
    for (const path of [LOCK_SRC, FINDINGS_SRC, FINDINGS_SERVER_SRC] as const) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path} must not contain setInterval`).not.toMatch(/\bsetInterval\s*\(/);
      expect(source, `${path} must not contain while(true)`).not.toMatch(/\bwhile\s*\(\s*true\s*\)/);
    }
  });

  it("lock is pure (no I/O, no vendor) and load-time asserts", () => {
    const source = readFileSync(LOCK_SRC, "utf8");
    expect(source).toMatch(/assertLeaseSubstrateGapRemainsUnauthorized\(\);/);
    expect(source).not.toMatch(/from\s+["']node:fs["']/);
    expect(source).not.toMatch(/readFileSync/);
    expect(source).not.toMatch(/@supabase/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).toMatch(/admitted\|denied\|rolled_back/);
    expect(source).toMatch(/authored not applied/i);
    expect(source).toMatch(/does not add lease columns/);
    expect(source).toMatch(/assigned-without-lease as `mission_stuck`/);
    expect(source).toMatch(/createDbMissionLeasePort/);
    expect(source).toMatch(/ACTIVE-V1 \(AGENTS\.md §45\)/);
  });

  it("Phase 52 attachment lock is not edited by this remaining-work", () => {
    expect(existsSync(PHASE52_SRC)).toBe(true);
    const source = readFileSync(PHASE52_SRC, "utf8");
    expect(source).toMatch(/PHASE52_IMPLEMENTATION_AUTHORIZED\s*=\s*false/);
    expect(source).not.toMatch(/LEASE_SUBSTRATE/);
  });

  it("mission-lease-db.server.ts sibling is preserved (not torn down)", () => {
    expect(existsSync(LEASE_DB_SRC)).toBe(true);
    const source = readFileSync(LEASE_DB_SRC, "utf8");
    expect(source).toMatch(/createDbMissionLeasePort/);
  });
});

describe("lease-substrate gap classified lock — behavioral honesty", () => {
  it("listHermesFindingsFromState assigned+lease-null stale → []", () => {
    const findings = listHermesFindingsFromState({
      tenantId: TENANT,
      now: NOW,
      executions: [assignedLeaseNullStale("exec-assigned-lease-null")],
      workerPostures: [],
      verificationRecords: [],
    });
    expect(findings).toEqual([]);
    expect(findings.filter((finding) => finding.kind === "mission_stuck")).toEqual([]);
  });
});
