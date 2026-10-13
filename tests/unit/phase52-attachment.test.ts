/**
 * Phase 52 classified attachment lock — Architecture Council.
 *
 * Proves Phase 52 remains unregistered and not implementation-authorized as a
 * full corpus (V2/V3/G-085), V1 attach/create workers can be attached, and
 * frozen workers are not implementable. V1 engines live in the sibling
 * phase52-v1-engines module. Does not re-extract the corpus.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PHASE52_IMPLEMENTATION_AUTHORIZED,
  PHASE52_NAMED_FROZEN_WORKER_IDS,
  PHASE52_REGISTERED,
  PHASE52_VERSION_TARGET,
  assertPhase52RemainsClassified,
  isPhase52WorkerImplementable,
  loadPhase52AttachmentPolicy,
  phase52Registered,
} from "@/lib/workforce/phase52-attachment";
import {
  V1_WORKFORCE_WORKERS,
  getV1WorkforceWorker,
  isWorkerActivatable,
} from "@/lib/workforce/v1-workforce-lock";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ATTACHMENT_JSON = resolve(ROOT, "architecture/COREGRID_V1_WORKFORCE_PHASE52_ATTACHMENT.json");
const ROUTING_JSON = resolve(ROOT, "architecture/COREGRID_PHASE_52_ROUTING_DECOMPOSITION.json");

const ATTACH_OR_CREATE = new Set([
  "ATTACH TO EXISTING ENGINE",
  "CREATE WORKFORCE CAPABILITY",
]);

describe("Phase 52 classified attachment lock", () => {
  it("implementationAuthorized is false", () => {
    expect(PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(loadPhase52AttachmentPolicy().implementationAuthorized).toBe(false);
  });

  it("phase52Registered is false", () => {
    expect(phase52Registered).toBe(false);
    expect(PHASE52_REGISTERED).toBe(false);
    expect(loadPhase52AttachmentPolicy().phase52Registered).toBe(false);
  });

  it("frozen worker ids cannot be implementable", () => {
    for (const workerId of PHASE52_NAMED_FROZEN_WORKER_IDS) {
      expect(isPhase52WorkerImplementable(workerId), `${workerId} must not be implementable`).toBe(
        false,
      );
      expect(isWorkerActivatable(workerId), `${workerId} must not be activatable`).toBe(false);
      const entry = getV1WorkforceWorker(workerId);
      expect(entry?.phase52Action.startsWith("FREEZE"), `${workerId} must carry FREEZE`).toBe(
        true,
      );
    }
    const policy = loadPhase52AttachmentPolicy();
    for (const workerId of PHASE52_NAMED_FROZEN_WORKER_IDS) {
      expect(policy.frozenWorkerIds).toContain(workerId);
      expect(policy.v1AttachableWorkerIds).not.toContain(workerId);
    }
  });

  it("ACTIVE-V1 attach/create workers can be attached (capability mapping only)", () => {
    const policy = loadPhase52AttachmentPolicy();
    expect(policy.versionTarget).toBe("ACTIVE-V1");
    expect(PHASE52_VERSION_TARGET).toBe("ACTIVE-V1");

    const attachableFromLock = V1_WORKFORCE_WORKERS.filter(
      (worker) =>
        worker.versionTarget === "ACTIVE-V1" && ATTACH_OR_CREATE.has(worker.phase52Action),
    ).map((worker) => worker.workerId);

    expect(policy.v1AttachableWorkerIds).toEqual(attachableFromLock);
    expect(policy.v1AttachableWorkerIds.length).toBeGreaterThan(40);

    expect(isPhase52WorkerImplementable("jarvis")).toBe(true);
    expect(isPhase52WorkerImplementable("chief_architect")).toBe(true);
    expect(isPhase52WorkerImplementable("backend_engineer")).toBe(true);
    expect(getV1WorkforceWorker("jarvis")?.phase52Action).toBe("ATTACH TO EXISTING ENGINE");
    expect(getV1WorkforceWorker("backend_engineer")?.phase52Action).toBe(
      "CREATE WORKFORCE CAPABILITY",
    );

    for (const workerId of policy.v1AttachableWorkerIds) {
      expect(isPhase52WorkerImplementable(workerId)).toBe(true);
      expect(getV1WorkforceWorker(workerId)?.versionTarget).toBe("ACTIVE-V1");
    }
  });

  it("JSON file has implementationAuthorized false AND PHASE52_IMPLEMENTATION_AUTHORIZED false", () => {
    const jsonText = readFileSync(ATTACHMENT_JSON, "utf8");
    expect(jsonText).toMatch(/PHASE52_IMPLEMENTATION_AUTHORIZED/);
    const json = JSON.parse(jsonText) as {
      implementationAuthorized?: unknown;
      PHASE52_IMPLEMENTATION_AUTHORIZED?: unknown;
      phase52Registered?: unknown;
      status?: unknown;
      versionTarget?: unknown;
      v1AuthorizedActions?: unknown;
      frozenActions?: unknown;
      humanUnfreezeRequirement?: unknown;
      notDone?: unknown;
    };
    expect(json.implementationAuthorized).toBe(false);
    expect(json.PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(json.phase52Registered).toBe(false);
    expect(json.status).toBe("ATTACHED_NOT_REIMPLEMENTED");
    expect(json.versionTarget).toBe("ACTIVE-V1");
    expect(json.v1AuthorizedActions).toEqual([
      "ATTACH TO EXISTING ENGINE",
      "CREATE WORKFORCE CAPABILITY",
    ]);
    expect(json.frozenActions).toEqual(["FREEZE V2", "FREEZE BEYOND V2"]);
    expect(typeof json.humanUnfreezeRequirement).toBe("string");
    expect(String(json.humanUnfreezeRequirement)).toMatch(/explicit human authorization record/i);
    expect(json.notDone).toEqual(
      expect.arrayContaining([
        "No new canonical phase was created.",
        "Phase 52 remains unregistered and not implementation-authorized.",
        "Frozen material is preserved, not deleted.",
      ]),
    );
    expect(
      (json as { phase52V1EngineImplementationAuthorized?: unknown })
        .phase52V1EngineImplementationAuthorized,
    ).toBe(true);
  });

  it("routing decomposition JSON summary.implementationAuthorized is false", () => {
    const jsonText = readFileSync(ROUTING_JSON, "utf8");
    const json = JSON.parse(jsonText) as {
      summary?: { implementationAuthorized?: unknown; phase52Registered?: unknown };
    };
    expect(json.summary?.implementationAuthorized).toBe(false);
    expect(json.summary?.phase52Registered).toBe(false);
  });

  it("assertPhase52RemainsClassified does not throw on the shipped constants", () => {
    expect(() => assertPhase52RemainsClassified()).not.toThrow();
  });

  it("unknown workers are not implementable", () => {
    expect(isPhase52WorkerImplementable("not_a_worker")).toBe(false);
    expect(isPhase52WorkerImplementable("")).toBe(false);
  });
});
