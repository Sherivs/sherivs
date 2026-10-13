/**
 * CoreGrid — V1 standing-fleet identity claim (Architecture Council).
 *
 * Human authorization (2026-10-13): "Claim all the standing fleet of the
 * agents, Implement the phase 52 engines and keep the V2/ V3 frozen."
 *
 * Standing fleet means STANDING IDENTITY, not standing compute:
 *   • ACTIVE-V1 attach/create workers are claimed as persistent governed
 *     identities (G-014: identity survives process termination).
 *   • Lease remains `ephemeral_cycle`. Compute wakes, works, sleeps.
 *   • `capability_defined` on the workforce lock is unchanged — this
 *     overlay does not mint 58 always-on Node processes.
 *   • Concurrent standing processes remain unclaimed (the old "50
 *     concurrent standing agents" remaining-work stays closed as
 *     identities, not as a process farm).
 *
 * Frozen workers are NOT claimed and stay not activatable:
 *   sdk_engineer, ml_engineer, knowledge_engineer,
 *   intelligence_research_agent, growth_intelligence_agent,
 *   customer_success_agent
 *
 * V2 device/IoT and V3 Reality Intelligence remain frozen (AGENTS.md §45).
 *
 * Boundary: pure data + pure functions. No I/O, no vendor, no secrets,
 * no while(true), no process spawn.
 * Version target: ACTIVE-V1.
 */

import {
  PHASE52_NAMED_FROZEN_WORKER_IDS,
  isPhase52WorkerImplementable,
} from "./phase52-attachment";
import {
  getV1WorkforceWorker,
  isWorkerActivatable,
  listActivatableV1Workers,
  validateV1WorkforceLock,
  type V1WorkforceWorker,
} from "./v1-workforce-lock";

/** Token pinned by four-eyes: claiming the V1 standing fleet is authorized. */
export const STANDING_FLEET_CLAIM_AUTHORIZED = true as const;

/** Token pinned by four-eyes: the V1 standing fleet is claimed. */
export const STANDING_FLEET_CLAIMED = true as const;

export const STANDING_FLEET_VERSION_TARGET = "ACTIVE-V1" as const;

export const STANDING_FLEET_HUMAN_AUTHORIZATION_AT = "2026-10-13" as const;

export const STANDING_FLEET_HUMAN_AUTHORIZATION_DIRECTIVE =
  "Claim all the standing fleet of the agents, Implement the phase 52 engines and keep the V2/ V3 frozen." as const;

/**
 * Identities stand. Compute does not. Four-eyes pin this so a later edit
 * cannot silently turn the fleet into always-on processes.
 */
export const STANDING_FLEET_COMPUTE_MODEL = "ephemeral_cycle" as const;

/** Concurrent standing processes are NOT claimed. Identities are. */
export const STANDING_FLEET_CONCURRENT_PROCESS_LIMIT = 0 as const;

export const STANDING_FLEET_IDENTITY_STATUS = "standing_identity_claimed" as const;

export const STANDING_FLEET_PROCESS_STATUS = "no_standing_process" as const;

export type StandingFleetIdentityStatus = typeof STANDING_FLEET_IDENTITY_STATUS;
export type StandingFleetProcessStatus = typeof STANDING_FLEET_PROCESS_STATUS;

export interface StandingFleetClaim {
  readonly workerId: string;
  readonly workerName: string;
  readonly command: V1WorkforceWorker["command"];
  readonly phase52Action: V1WorkforceWorker["phase52Action"];
  readonly versionTarget: "ACTIVE-V1";
  readonly identityStatus: StandingFleetIdentityStatus;
  readonly lease: "ephemeral_cycle";
  readonly processStatus: StandingFleetProcessStatus;
  readonly lockStatus: "capability_defined";
}

export interface StandingFleetClaimSnapshot {
  readonly artifact: "COREGRID_V1_STANDING_FLEET_CLAIM";
  readonly claimed: true;
  readonly versionTarget: "ACTIVE-V1";
  readonly computeModel: "ephemeral_cycle";
  readonly concurrentStandingProcesses: 0;
  readonly claimedWorkers: readonly StandingFleetClaim[];
  readonly claimedCount: number;
  readonly frozenUnclaimedWorkerIds: readonly string[];
  readonly frozenUnclaimedCount: number;
}

function toClaim(entry: V1WorkforceWorker): StandingFleetClaim {
  return {
    workerId: entry.workerId,
    workerName: entry.workerName,
    command: entry.command,
    phase52Action: entry.phase52Action,
    versionTarget: "ACTIVE-V1",
    identityStatus: STANDING_FLEET_IDENTITY_STATUS,
    lease: "ephemeral_cycle",
    processStatus: STANDING_FLEET_PROCESS_STATUS,
    lockStatus: "capability_defined",
  };
}

/**
 * Claim every ACTIVE-V1 worker as a standing identity. Frozen workers are
 * returned as unclaimed, never as claims.
 */
export function claimStandingFleet(): StandingFleetClaimSnapshot {
  const claimedWorkers = listActivatableV1Workers().map(toClaim);
  return {
    artifact: "COREGRID_V1_STANDING_FLEET_CLAIM",
    claimed: true,
    versionTarget: STANDING_FLEET_VERSION_TARGET,
    computeModel: STANDING_FLEET_COMPUTE_MODEL,
    concurrentStandingProcesses: STANDING_FLEET_CONCURRENT_PROCESS_LIMIT,
    claimedWorkers,
    claimedCount: claimedWorkers.length,
    frozenUnclaimedWorkerIds: PHASE52_NAMED_FROZEN_WORKER_IDS,
    frozenUnclaimedCount: PHASE52_NAMED_FROZEN_WORKER_IDS.length,
  };
}

/** True only for claimed ACTIVE-V1 standing identities. Frozen/unknown are false. */
export function isStandingFleetWorkerClaimed(workerId: string): boolean {
  if (!STANDING_FLEET_CLAIMED || !STANDING_FLEET_CLAIM_AUTHORIZED) return false;
  const entry = getV1WorkforceWorker(workerId);
  if (!entry) return false;
  if (entry.versionTarget !== "ACTIVE-V1") return false;
  if (!isWorkerActivatable(workerId)) return false;
  if (!isPhase52WorkerImplementable(workerId)) return false;
  return entry.lease === "ephemeral_cycle" && entry.status === "capability_defined";
}

export interface StandingFleetIntegrity {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly claimedCount: number;
  readonly frozenUnclaimedCount: number;
}

export function validateStandingFleetClaim(
  snapshot: StandingFleetClaimSnapshot = claimStandingFleet(),
): StandingFleetIntegrity {
  const errors: string[] = [];
  const lock = validateV1WorkforceLock();
  if (!lock.ok) {
    errors.push(`workforce lock invalid: ${lock.errors.join("; ")}`);
  }
  if (STANDING_FLEET_CLAIM_AUTHORIZED !== true) {
    errors.push("standing fleet claim is not authorized");
  }
  if (STANDING_FLEET_CLAIMED !== true) {
    errors.push("standing fleet is not claimed");
  }
  if (STANDING_FLEET_CONCURRENT_PROCESS_LIMIT !== 0) {
    errors.push("standing fleet must not claim concurrent standing processes");
  }
  if (STANDING_FLEET_COMPUTE_MODEL !== "ephemeral_cycle") {
    errors.push("standing fleet compute must remain ephemeral_cycle");
  }
  if (snapshot.claimedCount !== lock.v1Count) {
    errors.push(
      `claimed count ${snapshot.claimedCount} must equal ACTIVE-V1 lock count ${lock.v1Count}`,
    );
  }
  if (snapshot.frozenUnclaimedCount !== lock.frozenCount) {
    errors.push(
      `frozen unclaimed ${snapshot.frozenUnclaimedCount} must equal frozen lock count ${lock.frozenCount}`,
    );
  }
  if (snapshot.claimedCount + snapshot.frozenUnclaimedCount !== lock.workerCount) {
    errors.push("claimed + frozen unclaimed must equal the 64-role lock");
  }
  const claimedIds = new Set<string>();
  for (const claim of snapshot.claimedWorkers) {
    if (claimedIds.has(claim.workerId)) {
      errors.push(`duplicate standing claim ${claim.workerId}`);
    }
    claimedIds.add(claim.workerId);
    if (claim.versionTarget !== "ACTIVE-V1") {
      errors.push(`${claim.workerId}: standing claim must stay ACTIVE-V1`);
    }
    if (claim.lease !== "ephemeral_cycle") {
      errors.push(`${claim.workerId}: standing claim must keep ephemeral_cycle lease`);
    }
    if (claim.processStatus !== "no_standing_process") {
      errors.push(`${claim.workerId}: standing claim must not mint a standing process`);
    }
    if (claim.lockStatus !== "capability_defined") {
      errors.push(`${claim.workerId}: workforce lock status must remain capability_defined`);
    }
    if (!isStandingFleetWorkerClaimed(claim.workerId)) {
      errors.push(`${claim.workerId}: claimed worker must pass isStandingFleetWorkerClaimed`);
    }
  }
  for (const workerId of PHASE52_NAMED_FROZEN_WORKER_IDS) {
    if (claimedIds.has(workerId)) {
      errors.push(`${workerId}: frozen worker must not be standing-claimed`);
    }
    if (isStandingFleetWorkerClaimed(workerId)) {
      errors.push(`${workerId}: frozen worker must not pass isStandingFleetWorkerClaimed`);
    }
    if (isWorkerActivatable(workerId)) {
      errors.push(`${workerId}: frozen worker must stay not activatable`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    claimedCount: snapshot.claimedCount,
    frozenUnclaimedCount: snapshot.frozenUnclaimedCount,
  };
}

/**
 * Throws if the standing-fleet claim is unauthorized, incomplete, or has
 * drifted into standing processes / frozen-worker activation.
 */
export function assertStandingFleetClaimed(): void {
  if (STANDING_FLEET_CLAIM_AUTHORIZED !== true) {
    throw new Error("Standing fleet claim is not authorized: fail closed.");
  }
  if (STANDING_FLEET_CLAIMED !== true) {
    throw new Error("Standing fleet is not claimed: fail closed.");
  }
  if (STANDING_FLEET_CONCURRENT_PROCESS_LIMIT !== 0) {
    throw new Error("Standing fleet must not spawn concurrent standing processes: fail closed.");
  }
  const integrity = validateStandingFleetClaim();
  if (!integrity.ok) {
    throw new Error(`Standing fleet claim is invalid: ${integrity.errors.join("; ")}`);
  }
}

assertStandingFleetClaimed();
