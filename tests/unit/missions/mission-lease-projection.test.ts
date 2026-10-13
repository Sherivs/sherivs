/**
 * Pure mission-lease projection — MISSIONS / OBSERVABILITY.
 *
 * Copies createDbMissionLeasePort.enrichedExecution stage rules. Empty
 * leases leave the V1-004 base unchanged. An active lease (including an
 * already-expired expiresAt) projects stage leased with the timestamp
 * intact on the lease object. No I/O, no vendor, no V1-004 rewrite.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MissionExecutionState } from "@/lib/missions/mission-execution";
import { projectExecutionWithLeases } from "@/lib/missions/mission-lease-projection";

const TENANT = "tenant-alpha";
const T0 = "2026-10-01T12:00:00.000Z";
const T_EXPIRED = "2026-10-01T12:00:30.000Z";
const SRC = join(process.cwd(), "frontend/src/lib/missions/mission-lease-projection.ts");

function base(partial: Partial<MissionExecutionState> = {}): MissionExecutionState {
  return {
    executionId: "exec-1",
    tenantId: TENANT,
    missionId: "MISSION-exec-1",
    missionVersion: "1.0",
    assignedBy: "operator-1",
    lastWorkerId: null,
    action: "record-observation",
    idempotencyKey: "idem-exec-1-0000001",
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
    ...partial,
  };
}

function lease(partial: Partial<Parameters<typeof projectExecutionWithLeases>[0]["leases"][number]> = {}) {
  return {
    leaseId: "exec-1:lease:1",
    executionId: "exec-1",
    tenantId: TENANT,
    workerId: "worker-1",
    acquiredAt: T0,
    heartbeatAt: T0,
    expiresAt: T_EXPIRED,
    attempt: 1,
    state: "active" as const,
    outcome: null,
    completedAt: null,
    retryNotBefore: null,
    ...partial,
  };
}

describe("projectExecutionWithLeases", () => {
  it("empty leases → base unchanged", () => {
    const assigned = base();
    const projected = projectExecutionWithLeases({
      base: assigned,
      leases: [],
      verificationDecision: null,
    });
    expect(projected).toBe(assigned);
    expect(projected).toEqual(assigned);
  });

  it("active lease → stage leased; expired fields stay on the lease object", () => {
    const assigned = base();
    const projected = projectExecutionWithLeases({
      base: assigned,
      leases: [lease({ expiresAt: T_EXPIRED, heartbeatAt: T0 })],
      verificationDecision: null,
    });
    expect(projected).not.toBe(assigned);
    expect(projected.stage).toBe("leased");
    expect(projected.lease).toEqual({
      leaseId: "exec-1:lease:1",
      workerId: "worker-1",
      acquiredAt: T0,
      heartbeatAt: T0,
      leaseExpiresAt: T_EXPIRED,
    });
    expect(projected.lastWorkerId).toBe("worker-1");
    expect(projected.attempt).toBe(1);
  });

  it("denied stays denied even with an active lease", () => {
    const denied = base({ stage: "denied", denyReason: "action not authorized" });
    const projected = projectExecutionWithLeases({
      base: denied,
      leases: [lease()],
      verificationDecision: null,
    });
    expect(projected.stage).toBe("denied");
    expect(projected.lease).not.toBeNull();
  });

  it("verification verified → verified; otherwise evidenced", () => {
    const assigned = base();
    expect(
      projectExecutionWithLeases({
        base: assigned,
        leases: [lease()],
        verificationDecision: "verified",
      }).stage,
    ).toBe("verified");
    expect(
      projectExecutionWithLeases({
        base: assigned,
        leases: [lease()],
        verificationDecision: "failed",
      }).stage,
    ).toBe("evidenced");
    expect(
      projectExecutionWithLeases({
        base: assigned,
        leases: [lease()],
        verificationDecision: "inconclusive",
      }).stage,
    ).toBe("evidenced");
  });

  it("succeeded release → evidenced", () => {
    const projected = projectExecutionWithLeases({
      base: base(),
      leases: [lease({ state: "released", outcome: "succeeded", completedAt: T0 })],
      verificationDecision: null,
    });
    expect(projected.stage).toBe("evidenced");
    expect(projected.lease).toBeNull();
  });

  it("failed/recovered → requeued below maxAttempts, exhausted at maxAttempts", () => {
    expect(
      projectExecutionWithLeases({
        base: base(),
        leases: [lease({ state: "released", outcome: "failed", attempt: 1 })],
        verificationDecision: null,
      }).stage,
    ).toBe("requeued");
    expect(
      projectExecutionWithLeases({
        base: base(),
        leases: [lease({ state: "recovered", outcome: null, attempt: 2 })],
        verificationDecision: null,
      }).stage,
    ).toBe("requeued");
    expect(
      projectExecutionWithLeases({
        base: base(),
        leases: [lease({ state: "released", outcome: "failed", attempt: 3 })],
        verificationDecision: null,
      }).stage,
    ).toBe("exhausted");
  });
});

describe("projectExecutionWithLeases — source pins", () => {
  it("is pure (no I/O, no vendor, no .server)", () => {
    const source = readFileSync(SRC, "utf8");
    expect(source).toMatch(/export function projectExecutionWithLeases/);
    expect(source).not.toMatch(/from\s+["']node:fs["']/);
    expect(source).not.toMatch(/@supabase/);
    expect(source).not.toMatch(/from\s+["'][^"']*\.server/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bsetInterval\s*\(/);
    expect(source).not.toMatch(/runHermesCycle/);
  });
});
