/**
 * CoreGrid — pure mission-lease projection (MISSIONS / OBSERVABILITY).
 *
 * Copies the stage derivation from `createDbMissionLeasePort.enrichedExecution`
 * (`mission-lease-db.server.ts`) into a PURE function so Jarvis/Hermes can
 * OBSERVE applied `cg_mission_lease` rows without rewriting V1-004 and
 * without calling the write-owning sibling.
 *
 * Empty leases → caller `base` unchanged (do not invent leases). Active
 * leases project `stage: "leased"` with the lease object intact, including
 * already-expired `expiresAt` as `leaseExpiresAt` — expiry is assessed by
 * Hermes, not rewritten here.
 *
 * Boundary: pure functions over caller-supplied state. No I/O, no vendor,
 * no `.server` imports, no wall-clock sampling.
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */

import type { MissionExecutionState } from "./mission-execution";

const DEFAULT_MAX_ATTEMPTS = 3;

export type MissionLeaseProjectionRow = {
  readonly leaseId: string;
  readonly executionId: string;
  readonly tenantId: string;
  readonly workerId: string;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
  readonly attempt: number;
  readonly state: "active" | "released" | "recovered";
  readonly outcome: "succeeded" | "failed" | null;
  readonly completedAt: string | null;
  readonly retryNotBefore: string | null;
};

/**
 * Merge a V1-004 record-port execution with tenant-scoped lease rows.
 * Denied stays denied. Verification verified → verified, else evidenced.
 * Active lease → leased (expired timestamp stays on the lease object).
 * Succeeded release → evidenced. Failed/recovered → exhausted when
 * `attempt >= maxAttempts`, else requeued.
 */
export function projectExecutionWithLeases(input: {
  base: MissionExecutionState;
  leases: readonly {
    leaseId: string;
    executionId: string;
    tenantId: string;
    workerId: string;
    acquiredAt: string;
    heartbeatAt: string;
    expiresAt: string;
    attempt: number;
    state: "active" | "released" | "recovered";
    outcome: "succeeded" | "failed" | null;
    completedAt: string | null;
    retryNotBefore: string | null;
  }[];
  verificationDecision: "verified" | "failed" | "inconclusive" | null;
  maxAttempts?: number;
}): MissionExecutionState {
  const leases = input.leases;
  if (leases.length === 0) return input.base;

  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sorted = [...leases].sort((a, b) => a.attempt - b.attempt);
  const latest = sorted[sorted.length - 1]!;
  const active = sorted.find((row) => row.state === "active") ?? null;
  const failedCount = sorted.filter((row) => row.outcome === "failed").length;
  const verificationDecision = input.verificationDecision;

  let stage = input.base.stage;
  if (input.base.stage !== "denied") {
    if (verificationDecision !== null) {
      stage = verificationDecision === "verified" ? "verified" : "evidenced";
    } else if (active !== null) {
      stage = "leased";
    } else if (latest.outcome === "succeeded") {
      stage = "evidenced";
    } else if (latest.outcome === "failed" || latest.state === "recovered") {
      stage = latest.attempt >= maxAttempts ? "exhausted" : "requeued";
    }
  }

  return {
    ...input.base,
    stage,
    attempt: Math.max(input.base.attempt, latest.attempt),
    failureCount: Math.max(input.base.failureCount, failedCount),
    retryScheduledAt: latest.retryNotBefore ?? input.base.retryScheduledAt,
    lastWorkerId: latest.workerId,
    verificationDecision: verificationDecision ?? input.base.verificationDecision,
    lease:
      active === null
        ? null
        : {
            leaseId: active.leaseId,
            workerId: active.workerId,
            acquiredAt: active.acquiredAt,
            heartbeatAt: active.heartbeatAt,
            leaseExpiresAt: active.expiresAt,
          },
  };
}
