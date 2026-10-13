/**
 * CoreGrid — classified lease-substrate governance lock (MISSIONS / OBSERVABILITY).
 *
 * Human authorization (2026-10-13): "Apply the lease migration and then
 * execute the remaining works professionally." The coordinator applied
 * `database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql`
 * idempotently. THIS module does not edit that checksum-bound SQL file.
 *
 * Authorized remaining-work: OBSERVE applied `cg_mission_lease` rows into
 * Jarvis/Hermes findings via the pure projector. Not authorized: widening
 * `cg_execution_record.status` beyond admitted|denied|rolled_back, rewriting
 * V1-004 `leaseOperation` (stays fail-closed). THIS remaining-work does not add lease columns
 * to `cg_execution_record` and does not invent assigned-without-lease as `mission_stuck`.
 * It does not un-freeze Phase 52, start a resident process, or call runHermesCycle.
 *
 * Worker-launch's existing `createDbMissionLeasePort` is a different owner
 * and is not torn down here. V1-004 `mission-execution-db.server.ts` is not
 * modified (IMPLEMENTATION_AUTHORIZED stays false).
 *
 * Boundary: pure data + pure functions. No I/O, no vendor, no secrets.
 * Version target: ACTIVE-V1 (AGENTS.md §45).
 */

/** Token pinned by four-eyes: applying the authored V1-003 sibling is authorized. */
export const LEASE_SUBSTRATE_APPLY_AUTHORIZED = true as const;

/** Calendar day of the human apply-and-remaining-work authorization. */
export const LEASE_SUBSTRATE_HUMAN_AUTHORIZATION_AT = "2026-10-13" as const;

/** Exact human directive that authorized apply + remaining observability work. */
export const LEASE_SUBSTRATE_HUMAN_AUTHORIZATION_DIRECTIVE =
  "Apply the lease migration and then execute the remaining works professionally." as const;

/**
 * Token pinned by four-eyes: observing applied leases into Jarvis findings
 * is authorized. Does not authorize V1-004 rewrite or status widen.
 */
export const LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED = true as const;

/** Token pinned by four-eyes: lease-substrate implementation is not authorized. */
export const LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED = false as const;

/**
 * Token pinned by four-eyes: widening `cg_execution_record.status` beyond
 * admitted|denied|rolled_back is not authorized.
 */
export const LEASE_SUBSTRATE_EXECUTION_STATUS_WIDEN_AUTHORIZED = false as const;

export const LEASE_SUBSTRATE_GAP_VERSION_TARGET = "ACTIVE-V1" as const;

export const LEASE_SUBSTRATE_GAP_CLASSIFICATION =
  "CLASSIFIED_NOT_IMPLEMENTATION_AUTHORIZED" as const;

export const LEASE_SUBSTRATE_MIGRATION_STATUS = "APPLIED" as const;

export const LEASE_SUBSTRATE_MIGRATION_PATH =
  "database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql" as const;

/**
 * Fail-closed governance: observe-applied-leases is live only when apply and
 * gap-close are authorized, the sibling is APPLIED, and schema-widen plus
 * V1-004 rewrite stay unauthorized.
 */
export function assertLeaseSubstrateGovernance(): void {
  if (LEASE_SUBSTRATE_APPLY_AUTHORIZED !== true) {
    throw new Error("Lease-substrate apply is not authorized: fail closed.");
  }
  if (LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED !== true) {
    throw new Error("Lease-substrate gap close is not authorized: fail closed.");
  }
  if (LEASE_SUBSTRATE_MIGRATION_STATUS !== "APPLIED") {
    throw new Error("Lease-substrate migration is not APPLIED: fail closed.");
  }
  if (LEASE_SUBSTRATE_EXECUTION_STATUS_WIDEN_AUTHORIZED !== false) {
    throw new Error(
      "Widening cg_execution_record.status is not authorized: fail closed.",
    );
  }
  if (LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED !== false) {
    throw new Error(
      "Lease-substrate implementation is classified: V1-004 rewrite is not authorized.",
    );
  }
}

/**
 * Wrapper: do not widen `cg_execution_record.status` and do not rewrite
 * V1-004 (`leaseOperation` stays fail-closed). Name no longer means
 * "gap close is unauthorized" — observe-applied-leases is authorized.
 */
export function assertLeaseSubstrateGapRemainsUnauthorized(): void {
  if (LEASE_SUBSTRATE_EXECUTION_STATUS_WIDEN_AUTHORIZED !== false) {
    throw new Error(
      "Widening cg_execution_record.status is not authorized.",
    );
  }
  if (LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED !== false) {
    throw new Error(
      "Lease-substrate implementation is classified: implementation is not authorized.",
    );
  }
}

/**
 * Returns the shipped gap-close token. True after the 2026-10-13 human
 * authorization to observe applied leases into Jarvis findings.
 */
export function isLeaseSubstrateGapCloseAuthorized(): typeof LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED {
  return LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED;
}

assertLeaseSubstrateGovernance();
