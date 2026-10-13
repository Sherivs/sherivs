/**
 * V1 standing-fleet identity claim — Architecture Council.
 *
 * Proves ACTIVE-V1 workers are claimed as standing identities, leases stay
 * ephemeral_cycle, concurrent processes stay 0, and frozen workers are not
 * claimed. Does not mint standing processes.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  STANDING_FLEET_CLAIM_AUTHORIZED,
  STANDING_FLEET_CLAIMED,
  STANDING_FLEET_COMPUTE_MODEL,
  STANDING_FLEET_CONCURRENT_PROCESS_LIMIT,
  STANDING_FLEET_VERSION_TARGET,
  assertStandingFleetClaimed,
  claimStandingFleet,
  isStandingFleetWorkerClaimed,
  validateStandingFleetClaim,
} from "@/lib/workforce/standing-fleet-claim";
import { PHASE52_NAMED_FROZEN_WORKER_IDS } from "@/lib/workforce/phase52-attachment";
import {
  V1_WORKFORCE_WORKERS,
  isWorkerActivatable,
  listActivatableV1Workers,
  validateV1WorkforceLock,
} from "@/lib/workforce/v1-workforce-lock";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLAIM_JSON = resolve(ROOT, "architecture/COREGRID_V1_STANDING_FLEET_CLAIM.json");

describe("V1 standing fleet identity claim", () => {
  it("authorizes and claims the standing fleet", () => {
    expect(STANDING_FLEET_CLAIM_AUTHORIZED).toBe(true);
    expect(STANDING_FLEET_CLAIMED).toBe(true);
    expect(STANDING_FLEET_VERSION_TARGET).toBe("ACTIVE-V1");
    expect(STANDING_FLEET_COMPUTE_MODEL).toBe("ephemeral_cycle");
    expect(STANDING_FLEET_CONCURRENT_PROCESS_LIMIT).toBe(0);
    expect(() => assertStandingFleetClaimed()).not.toThrow();
  });

  it("claims every ACTIVE-V1 worker as a standing identity", () => {
    const snapshot = claimStandingFleet();
    const lock = validateV1WorkforceLock();
    expect(snapshot.claimed).toBe(true);
    expect(snapshot.claimedCount).toBe(lock.v1Count);
    expect(snapshot.claimedCount).toBe(listActivatableV1Workers().length);
    expect(snapshot.concurrentStandingProcesses).toBe(0);
    expect(snapshot.computeModel).toBe("ephemeral_cycle");

    const claimedIds = snapshot.claimedWorkers.map((claim) => claim.workerId);
    expect(claimedIds).toEqual(listActivatableV1Workers().map((worker) => worker.workerId));

    for (const claim of snapshot.claimedWorkers) {
      expect(claim.versionTarget).toBe("ACTIVE-V1");
      expect(claim.lease).toBe("ephemeral_cycle");
      expect(claim.processStatus).toBe("no_standing_process");
      expect(claim.lockStatus).toBe("capability_defined");
      expect(claim.identityStatus).toBe("standing_identity_claimed");
      expect(isStandingFleetWorkerClaimed(claim.workerId)).toBe(true);
      expect(isWorkerActivatable(claim.workerId)).toBe(true);
    }
  });

  it("does not claim frozen workers and does not activate them", () => {
    const snapshot = claimStandingFleet();
    expect(snapshot.frozenUnclaimedWorkerIds).toEqual([...PHASE52_NAMED_FROZEN_WORKER_IDS]);
    expect(snapshot.frozenUnclaimedCount).toBe(6);
    expect(snapshot.claimedCount + snapshot.frozenUnclaimedCount).toBe(V1_WORKFORCE_WORKERS.length);

    for (const workerId of PHASE52_NAMED_FROZEN_WORKER_IDS) {
      expect(isStandingFleetWorkerClaimed(workerId)).toBe(false);
      expect(isWorkerActivatable(workerId)).toBe(false);
      expect(snapshot.claimedWorkers.map((claim) => claim.workerId)).not.toContain(workerId);
    }
  });

  it("keeps the workforce lock on capability_defined / ephemeral_cycle", () => {
    for (const worker of V1_WORKFORCE_WORKERS) {
      expect(worker.status).toBe("capability_defined");
      expect(worker.lease).toBe("ephemeral_cycle");
    }
  });

  it("validates the claim overlay", () => {
    const integrity = validateStandingFleetClaim();
    expect(integrity.ok).toBe(true);
    expect(integrity.errors).toEqual([]);
    expect(integrity.claimedCount).toBe(58);
    expect(integrity.frozenUnclaimedCount).toBe(6);
  });

  it("JSON lock matches the executable claim", () => {
    const json = JSON.parse(readFileSync(CLAIM_JSON, "utf8")) as {
      STANDING_FLEET_CLAIMED?: unknown;
      concurrentStandingProcesses?: unknown;
      expectedClaimedCount?: unknown;
      expectedFrozenUnclaimedCount?: unknown;
      frozenUnclaimedWorkerIds?: unknown;
    };
    expect(json.STANDING_FLEET_CLAIMED).toBe(true);
    expect(json.concurrentStandingProcesses).toBe(0);
    expect(json.expectedClaimedCount).toBe(58);
    expect(json.expectedFrozenUnclaimedCount).toBe(6);
    expect(json.frozenUnclaimedWorkerIds).toEqual([...PHASE52_NAMED_FROZEN_WORKER_IDS]);
  });

  it("unknown workers are not claimed", () => {
    expect(isStandingFleetWorkerClaimed("not_a_worker")).toBe(false);
    expect(isStandingFleetWorkerClaimed("")).toBe(false);
  });
});
