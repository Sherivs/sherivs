/**
 * Four-eyes SECURITY+QUALITY invariants for standing-fleet claim and
 * Phase 52 V1 engines after HUMAN AUTHORIZATION 2026-10-13.
 *
 * This suite VERIFIES. Missing production files fail closed.
 *
 * Pins:
 *   STANDING_FLEET_CLAIMED true; concurrent processes 0; lease ephemeral
 *   Frozen workers remain unclaimed / not activatable
 *   PHASE52_V1_ENGINE_IMPLEMENTATION_AUTHORIZED true
 *   PHASE52_IMPLEMENTATION_AUTHORIZED false (full corpus / V2 / V3)
 *   PHASE52_REGISTERED false
 *   G-085 frozen; Phase 41 sandbox is not G-058
 *   New libraries have no while(true) / setInterval / new Worker(
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isWorkerActivatable } from "@/lib/workforce/v1-workforce-lock";
import { getPhase52V1Engine } from "@/lib/workforce/phase52-v1-engines";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const PATHS = {
  fleetTs: "frontend/src/lib/workforce/standing-fleet-claim.ts",
  fleetJson: "architecture/COREGRID_V1_STANDING_FLEET_CLAIM.json",
  enginesTs: "frontend/src/lib/workforce/phase52-v1-engines.ts",
  enginesJson: "architecture/COREGRID_PHASE52_V1_ENGINE_REGISTRY.json",
  phase52Ts: "frontend/src/lib/workforce/phase52-attachment.ts",
  phase52Json: "architecture/COREGRID_V1_WORKFORCE_PHASE52_ATTACHMENT.json",
  proof: "architecture/proofs/JARVIS_STANDING_FLEET_AND_PHASE52_V1_ENGINES_RECORD.json",
  recon: "architecture/COREGRID_JARVIS_ENTERPRISE_RECONCILIATION.json",
} as const;

const FROZEN_WORKER_IDS = [
  "sdk_engineer",
  "ml_engineer",
  "knowledge_engineer",
  "intelligence_research_agent",
  "growth_intelligence_agent",
  "customer_success_agent",
] as const;

const LIBRARY_DAEMON_PRIMITIVES = [
  /\bsetInterval\s*\(/,
  /\bwhile\s*\(\s*true\s*\)/,
  /\bnew\s+Worker\s*\(/,
] as const;

const SECRET_VALUE =
  /(?:sk_live_|sk_test_|whsec_|phc_|xox[baprs]-)[A-Za-z0-9]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}/;

function abs(rel: string): string {
  return join(ROOT, rel);
}

function mustExist(rel: string): string {
  const path = abs(rel);
  expect(existsSync(path), `four-eyes fail-closed: missing production module ${rel}`).toBe(true);
  return path;
}

function mustRead(rel: string): string {
  return readFileSync(mustExist(rel), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("standing fleet claim four-eyes", () => {
  it("STANDING_FLEET_CLAIMED === true and concurrent processes stay 0", () => {
    const ts = mustRead(PATHS.fleetTs);
    expect(ts).toMatch(/STANDING_FLEET_CLAIMED\s*=\s*true/);
    expect(ts).toMatch(/STANDING_FLEET_CLAIM_AUTHORIZED\s*=\s*true/);
    expect(ts).toMatch(/STANDING_FLEET_CONCURRENT_PROCESS_LIMIT\s*=\s*0/);
    expect(ts).toMatch(/ephemeral_cycle/);
    expect(stripComments(ts)).not.toMatch(/\bwhile\s*\(\s*true\s*\)/);
  });

  it("JSON lock claims identities, not processes", () => {
    const json = JSON.parse(mustRead(PATHS.fleetJson)) as {
      STANDING_FLEET_CLAIMED?: unknown;
      concurrentStandingProcesses?: unknown;
      frozenUnclaimedWorkerIds?: unknown;
    };
    expect(json.STANDING_FLEET_CLAIMED).toBe(true);
    expect(json.concurrentStandingProcesses).toBe(0);
    expect(json.frozenUnclaimedWorkerIds).toEqual([...FROZEN_WORKER_IDS]);
  });

  it("frozen workers remain not activatable", () => {
    for (const workerId of FROZEN_WORKER_IDS) {
      expect(isWorkerActivatable(workerId), `${workerId} must stay frozen`).toBe(false);
    }
  });
});

describe("Phase 52 V1 engines four-eyes", () => {
  it("V1 engines authorized; full corpus / V2 / V3 / G-085 stay false", () => {
    const ts = mustRead(PATHS.enginesTs);
    expect(ts).toMatch(/PHASE52_V1_ENGINE_IMPLEMENTATION_AUTHORIZED\s*=\s*true/);
    expect(ts).toMatch(/PHASE52_V2_ENGINE_IMPLEMENTATION_AUTHORIZED\s*=\s*false/);
    expect(ts).toMatch(/PHASE52_V3_ENGINE_IMPLEMENTATION_AUTHORIZED\s*=\s*false/);
    expect(ts).toMatch(/PHASE52_G085_ENGINE_IMPLEMENTATION_AUTHORIZED\s*=\s*false/);
    expect(mustRead(PATHS.phase52Ts)).toMatch(/PHASE52_IMPLEMENTATION_AUTHORIZED\s*=\s*false/);
    expect(mustRead(PATHS.phase52Ts)).toMatch(/PHASE52_REGISTERED\s*=\s*false/);
  });

  it("G-058 attaches to the V1 tool sandbox, not Phase 41 civilization sandbox", () => {
    const sandbox = getPhase52V1Engine("G-058");
    expect(sandbox?.modulePaths).toEqual(["frontend/src/lib/workforce/tool-runtime.ts"]);
    expect(sandbox?.modulePaths.join("\n")).not.toMatch(/phase-41-sandbox-engine|sandbox-runtime/);
    expect(mustRead(PATHS.enginesTs)).toMatch(/tool-runtime\.ts/);
  });

  it("JSON registry keeps Phase 52 unregistered and V2/V3 frozen", () => {
    const json = JSON.parse(mustRead(PATHS.enginesJson)) as {
      PHASE52_V1_ENGINE_IMPLEMENTATION_AUTHORIZED?: unknown;
      PHASE52_IMPLEMENTATION_AUTHORIZED?: unknown;
      PHASE52_REGISTERED?: unknown;
      PHASE52_V2_ENGINE_IMPLEMENTATION_AUTHORIZED?: unknown;
      PHASE52_V3_ENGINE_IMPLEMENTATION_AUTHORIZED?: unknown;
      frozenRequirementIds?: unknown;
    };
    expect(json.PHASE52_V1_ENGINE_IMPLEMENTATION_AUTHORIZED).toBe(true);
    expect(json.PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(json.PHASE52_REGISTERED).toBe(false);
    expect(json.PHASE52_V2_ENGINE_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(json.PHASE52_V3_ENGINE_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(json.frozenRequirementIds).toEqual(["G-085"]);
  });

  it("attachment JSON still pins full-corpus implementationAuthorized false", () => {
    const json = JSON.parse(mustRead(PATHS.phase52Json)) as {
      implementationAuthorized?: unknown;
      PHASE52_IMPLEMENTATION_AUTHORIZED?: unknown;
      phase52Registered?: unknown;
      phase52V1EngineImplementationAuthorized?: unknown;
    };
    expect(json.implementationAuthorized).toBe(false);
    expect(json.PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(json.phase52Registered).toBe(false);
    expect(json.phase52V1EngineImplementationAuthorized).toBe(true);
  });
});

describe("libraries stay loop-free; secrets hygiene; reconciliation honesty", () => {
  it.each([PATHS.fleetTs, PATHS.enginesTs, PATHS.phase52Ts] as const)(
    "%s has no daemon primitives",
    (rel) => {
      const source = stripComments(mustRead(rel));
      for (const pattern of LIBRARY_DAEMON_PRIMITIVES) {
        expect(source, `${rel} must not contain ${pattern}`).not.toMatch(pattern);
      }
    },
  );

  it.each([
    PATHS.fleetTs,
    PATHS.enginesTs,
    PATHS.fleetJson,
    PATHS.enginesJson,
    PATHS.proof,
  ] as const)("%s carries no secret values", (rel) => {
    const source = mustRead(rel);
    expect(source).not.toMatch(SECRET_VALUE);
    expect(source).not.toMatch(/sk_live_/);
  });

  it("reconciliation claims standing identities and V1 engines, not V2/V3 unfreeze", () => {
    const json = JSON.parse(mustRead(PATHS.recon)) as {
      notClaimed?: unknown;
      missingClosedThisMission?: Record<string, unknown>;
    };
    expect(json.notClaimed).toEqual(
      expect.arrayContaining([
        "50 concurrent standing processes",
        "full Phase 52 corpus including V2/V3/G-085",
        "V2/V3 unfreeze",
      ]),
    );
    expect(json.notClaimed).not.toContain("50 concurrent standing agents");
    expect(json.missingClosedThisMission?.standingFleetClaim).toEqual(expect.any(String));
    expect(json.missingClosedThisMission?.phase52V1Engines).toEqual(expect.any(String));
  });
});
