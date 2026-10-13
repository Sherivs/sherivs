/**
 * CoreGrid — classified lease-substrate governance lock (MISSIONS / OBSERVABILITY).
 *
 * Human authorization (2026-10-13): "Authorize the CoreGrid execution records
 * status, and execute the v1 004 lease write also, and then extract the phase
 * 52 corpus that related to this execution we are doing and then also apply
 * resident for Hermes and the jarvis." Prior same-day directive: "Apply the
 * lease migration and then execute the remaining works professionally."
 *
 * The coordinator applied
 * `database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql`
 * idempotently. THIS module does not edit that checksum-bound SQL file.
 *
 * Authorized remaining-work (2026-10-13 four-eyes):
 *   • APPLY the authored V1-003 sibling (already APPLIED)
 *   • GAP_CLOSE: observe applied `cg_mission_lease` rows into Jarvis/Hermes
 *   • EXECUTION_STATUS_WIDEN: widen `cg_execution_record.status` beyond
 *     admitted|denied|rolled_back (migration 20261013000050)
 *   • IMPLEMENTATION: V1-004 composes `createDbMissionLeasePort` as
 *     adapter.lease (real MissionLeasePort writes)
 *
 * THIS remaining-work does not add lease columns to `cg_execution_record`
 * and does not invent assigned-without-lease as `mission_stuck`.
 * It does not un-freeze Phase 52. Residents are separate supervisors
 * (`scripts/run-*-resident.mjs`); this lock module does not loop.
 *
 * Worker-launch's existing `createDbMissionLeasePort` is a different owner
 * and is not torn down here.
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
 * is authorized.
 */
export const LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED = true as const;

/** Token pinned by four-eyes: V1-004 lease composition is authorized. */
export const LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED = true as const;

/**
 * Token pinned by four-eyes: widening `cg_execution_record.status` beyond
 * admitted|denied|rolled_back is authorized (20261013000050).
 */
export const LEASE_SUBSTRATE_EXECUTION_STATUS_WIDEN_AUTHORIZED = true as const;

export const LEASE_SUBSTRATE_GAP_VERSION_TARGET = "ACTIVE-V1" as const;

export const LEASE_SUBSTRATE_GAP_CLASSIFICATION =
  "CLASSIFIED_IMPLEMENTATION_AUTHORIZED" as const;

export const LEASE_SUBSTRATE_MIGRATION_STATUS = "APPLIED" as const;

export const LEASE_SUBSTRATE_MIGRATION_PATH =
  "database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql" as const;

/**
 * Fail-closed governance: lease writes + status widen are live only when
 * apply, gap-close, widen, and implementation are all authorized and the
 * sibling is APPLIED.
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
  if (LEASE_SUBSTRATE_EXECUTION_STATUS_WIDEN_AUTHORIZED !== true) {
    throw new Error(
      "Widening cg_execution_record.status is not authorized: fail closed.",
    );
  }
  if (LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED !== true) {
    throw new Error(
      "Lease-substrate implementation is not authorized: V1-004 rewrite is classified.",
    );
  }
}

/**
 * Wrapper: authorization was used. Asserts APPLY true so nothing is silently
 * unauthorized. Does not throw on widen true (widen is now authorized).
 * Name is historical — gap-close, widen, and V1-004 lease writes are live.
 */
export function assertLeaseSubstrateGapRemainsUnauthorized(): void {
  if (LEASE_SUBSTRATE_APPLY_AUTHORIZED !== true) {
    throw new Error("Lease-substrate apply is not authorized: fail closed.");
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
