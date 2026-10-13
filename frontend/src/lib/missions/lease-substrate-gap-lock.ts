/**
 * CoreGrid — classified lease-substrate gap lock (MISSIONS / OBSERVABILITY).
 *
 * Closing the lease-substrate schema gap is CLASSIFIED and NOT
 * implementation-authorized. This module is an executable lock, not a
 * close-the-gap implementation, not a migration, and not a resident process.
 *
 * V1-004 `cg_execution_record` still admits only admitted|denied|rolled_back.
 * The V1-003 sibling migration
 * `database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql`
 * is authored not applied. THIS Jarvis/Hermes remaining-work does not apply
 * it, does not add lease columns to `cg_execution_record`, and does not invent
 * assigned-without-lease as `mission_stuck`. Worker-launch's existing
 * `createDbMissionLeasePort` is a different owner and is not torn down here.
 *
 * Authorizing a close requires an explicit human authorization record.
 * This lock does not apply the sibling, does not query `cg_mission_lease`,
 * does not un-freeze Phase 52, and does not start a resident process.
 *
 * Boundary: pure data + pure functions. No I/O, no vendor, no secrets.
 * Version target: ACTIVE-V1 (AGENTS.md §45).
 */

/** Token pinned by four-eyes: closing the lease-substrate gap is not authorized. */
export const LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED = false as const;

/** Token pinned by four-eyes: lease-substrate implementation is not authorized. */
export const LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED = false as const;

export const LEASE_SUBSTRATE_GAP_VERSION_TARGET = "ACTIVE-V1" as const;

export const LEASE_SUBSTRATE_GAP_CLASSIFICATION =
  "CLASSIFIED_NOT_IMPLEMENTATION_AUTHORIZED" as const;

export const LEASE_SUBSTRATE_MIGRATION_STATUS = "AUTHORED_NOT_APPLIED" as const;

export const LEASE_SUBSTRATE_MIGRATION_PATH =
  "database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql" as const;

/**
 * Throws if either authorized token is treated as true.
 * Shipped constants keep this a no-op success; mutation of the tokens fails closed.
 */
export function assertLeaseSubstrateGapRemainsUnauthorized(): void {
  if (LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED !== false) {
    throw new Error("Lease-substrate gap close is classified: close is not authorized.");
  }
  if (LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED !== false) {
    throw new Error(
      "Lease-substrate implementation is classified: implementation is not authorized.",
    );
  }
}

/**
 * Returns the shipped close-authorized token. Always false until an explicit
 * human authorization record changes the constant.
 */
export function isLeaseSubstrateGapCloseAuthorized(): typeof LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED {
  return LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED;
}

assertLeaseSubstrateGapRemainsUnauthorized();
