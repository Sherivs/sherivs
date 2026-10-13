/**
 * Phase 52 V1 engine registry — Architecture Council.
 *
 * Proves extracted STREAM_G V1 engines attach to existing modules, G-085 and
 * V2/V3 stay frozen, Phase 52 stays unregistered, and the completeness loop
 * dispatches library-form. Does not register a new canonical phase.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PHASE52_FROZEN_ENGINE_BINDINGS,
  PHASE52_FROZEN_V3_MODULE_PATHS,
  PHASE52_G085_ENGINE_IMPLEMENTATION_AUTHORIZED,
  PHASE52_V1_COMPLETENESS_LOOP,
  PHASE52_V1_ENGINE_BINDINGS,
  PHASE52_V1_ENGINE_IMPLEMENTATION_AUTHORIZED,
  PHASE52_V1_EXTRACTED_REQUIREMENT_IDS,
  PHASE52_V2_ENGINE_IMPLEMENTATION_AUTHORIZED,
  PHASE52_V3_ENGINE_IMPLEMENTATION_AUTHORIZED,
  assertPhase52V1EnginesAuthorized,
  assertPhase52V2V3RemainFrozen,
  invokePhase52Engine,
  listPhase52V1Engines,
  runPhase52V1CompletenessLoop,
} from "@/lib/workforce/phase52-v1-engines";
import {
  PHASE52_IMPLEMENTATION_AUTHORIZED,
  PHASE52_REGISTERED,
} from "@/lib/workforce/phase52-attachment";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENGINE_JSON = resolve(ROOT, "architecture/COREGRID_PHASE52_V1_ENGINE_REGISTRY.json");

describe("Phase 52 V1 engine registry", () => {
  it("authorizes V1 engines only", () => {
    expect(PHASE52_V1_ENGINE_IMPLEMENTATION_AUTHORIZED).toBe(true);
    expect(PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(PHASE52_REGISTERED).toBe(false);
    expect(PHASE52_V2_ENGINE_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(PHASE52_V3_ENGINE_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(PHASE52_G085_ENGINE_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(() => assertPhase52V1EnginesAuthorized()).not.toThrow();
    expect(() => assertPhase52V2V3RemainFrozen()).not.toThrow();
  });

  it("attaches every extracted V1 requirement to an existing module", () => {
    expect(listPhase52V1Engines()).toHaveLength(PHASE52_V1_EXTRACTED_REQUIREMENT_IDS.length);
    expect(PHASE52_V1_ENGINE_BINDINGS.map((binding) => binding.requirementId)).toEqual(
      [...PHASE52_V1_EXTRACTED_REQUIREMENT_IDS],
    );

    for (const binding of PHASE52_V1_ENGINE_BINDINGS) {
      expect(binding.bucket).toBe("V1");
      expect(binding.versionTarget).toBe("ACTIVE-V1");
      expect(binding.disposition).toBe("attached");
      expect(binding.modulePaths.length).toBeGreaterThan(0);
      for (const modulePath of binding.modulePaths) {
        expect(existsSync(resolve(ROOT, modulePath)), modulePath).toBe(true);
        expect(PHASE52_FROZEN_V3_MODULE_PATHS).not.toContain(modulePath);
        expect(modulePath).not.toMatch(/phase-3[7]|phase-41|phase-44|phase-46|sandbox-runtime/);
      }

      const result = invokePhase52Engine({
        requirementId: binding.requirementId,
        tenantId: "tenant-a",
        actorId: "chief_architect",
      });
      expect(result.ok, binding.requirementId).toBe(true);
      if (result.ok) {
        expect(result.engineId).toBe(binding.engineId);
        expect(result.disposition).toBe("attached");
      }
    }
  });

  it("fail-closes G-085, unknown ids, missing tenant/actor, and V3 sandbox paths", () => {
    expect(PHASE52_FROZEN_ENGINE_BINDINGS.map((binding) => binding.requirementId)).toEqual(["G-085"]);
    expect(
      invokePhase52Engine({
        requirementId: "G-085",
        tenantId: "tenant-a",
        actorId: "jarvis",
      }),
    ).toEqual({ ok: false, requirementId: "G-085", reason: "frozen_deferred" });

    expect(
      invokePhase52Engine({
        requirementId: "G-086",
        tenantId: "tenant-a",
        actorId: "jarvis",
      }).ok,
    ).toBe(false);

    expect(
      invokePhase52Engine({
        requirementId: "G-014",
        tenantId: "  ",
        actorId: "jarvis",
      }).reason,
    ).toBe("missing_tenant");

    expect(
      invokePhase52Engine({
        requirementId: "G-014",
        tenantId: "tenant-a",
        actorId: "",
      }).reason,
    ).toBe("missing_actor");
  });

  it("G-058 attaches to the V1 tool sandbox, not Phase 41 civilization sandbox", () => {
    const sandbox = PHASE52_V1_ENGINE_BINDINGS.find((binding) => binding.requirementId === "G-058");
    expect(sandbox?.modulePaths).toEqual(["frontend/src/lib/workforce/tool-runtime.ts"]);
    expect(sandbox?.modulePaths).not.toContain(
      "frontend/src/lib/kernel/phase-contracts/phase-41-sandbox-engine.ts",
    );
    expect(sandbox?.modulePaths).not.toContain("frontend/src/lib/sandbox-runtime/contracts.ts");
  });

  it("runs the V1 completeness loop library-form", () => {
    const loop = runPhase52V1CompletenessLoop({
      tenantId: "tenant-a",
      actorId: "chief_architect",
    });
    expect(loop.ok).toBe(true);
    if (!loop.ok) return;
    expect(loop.versionTarget).toBe("ACTIVE-V1");
    expect(loop.stages.map((stage) => stage.stage)).toEqual(
      PHASE52_V1_COMPLETENESS_LOOP.map((stage) => stage.stage),
    );
    expect(loop.stages.every((stage) => stage.engines.every((engine) => engine.ok))).toBe(true);
  });

  it("fail-closes the completeness loop without tenant context", () => {
    const loop = runPhase52V1CompletenessLoop({ tenantId: "", actorId: "jarvis" });
    expect(loop.ok).toBe(false);
    if (loop.ok) return;
    expect(loop.reason).toBe("missing_tenant");
  });

  it("JSON registry matches the executable lock", () => {
    const json = JSON.parse(readFileSync(ENGINE_JSON, "utf8")) as {
      PHASE52_V1_ENGINE_IMPLEMENTATION_AUTHORIZED?: unknown;
      PHASE52_IMPLEMENTATION_AUTHORIZED?: unknown;
      PHASE52_REGISTERED?: unknown;
      PHASE52_V2_ENGINE_IMPLEMENTATION_AUTHORIZED?: unknown;
      PHASE52_V3_ENGINE_IMPLEMENTATION_AUTHORIZED?: unknown;
      v1RequirementIds?: unknown;
      frozenRequirementIds?: unknown;
    };
    expect(json.PHASE52_V1_ENGINE_IMPLEMENTATION_AUTHORIZED).toBe(true);
    expect(json.PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(json.PHASE52_REGISTERED).toBe(false);
    expect(json.PHASE52_V2_ENGINE_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(json.PHASE52_V3_ENGINE_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(json.v1RequirementIds).toEqual([...PHASE52_V1_EXTRACTED_REQUIREMENT_IDS]);
    expect(json.frozenRequirementIds).toEqual(["G-085"]);
  });
});
