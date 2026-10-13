/**
 * CoreGrid — Phase 52 V1 engine registry (Architecture Council).
 *
 * Human authorization (2026-10-13): "Claim all the standing fleet of the
 * agents, Implement the phase 52 engines and keep the V2/ V3 frozen."
 *
 * This implements the extracted STREAM_G V1 engines by ATTACHING them to
 * existing governed modules. It does not:
 *   • register Phase 52 as a canonical phase (PHASE52_REGISTERED stays false)
 *   • authorize the full Phase 52 corpus (PHASE52_IMPLEMENTATION_AUTHORIZED
 *     stays false — that token means V2/V3/G-085/unassigned as well)
 *   • implement G-085 autonomous company OS (DEFERRED_CORPUS, extract-only)
 *   • un-freeze V2 device/IoT or V3 Reality Intelligence (AGENTS.md §45)
 *   • attach G-058 to Phase 41 civilization sandbox (FUTURE-V3)
 *
 * Completeness loop (extract mapsOntoExtractedIds):
 *   Mission → Delegation → Worker Execution → Evidence → Verification → Outcome
 *
 * Boundary: pure data + pure functions. No I/O, no vendor, no secrets,
 * no while(true). Library-form WAKE → DISPATCH → SLEEP.
 * Version target: ACTIVE-V1.
 */

import {
  PHASE52_IMPLEMENTATION_AUTHORIZED,
  PHASE52_REGISTERED,
  assertPhase52RemainsClassified,
  phase52Registered,
} from "./phase52-attachment";

/** Token pinned by four-eyes: V1 extracted engines may attach to existing modules. */
export const PHASE52_V1_ENGINE_IMPLEMENTATION_AUTHORIZED = true as const;

/** Full corpus (V2/V3/G-085/unassigned) stays unauthorized. */
export const PHASE52_V2_ENGINE_IMPLEMENTATION_AUTHORIZED = false as const;

export const PHASE52_V3_ENGINE_IMPLEMENTATION_AUTHORIZED = false as const;

export const PHASE52_G085_ENGINE_IMPLEMENTATION_AUTHORIZED = false as const;

export const PHASE52_V1_ENGINE_VERSION_TARGET = "ACTIVE-V1" as const;

export const PHASE52_V1_ENGINE_HUMAN_AUTHORIZATION_AT = "2026-10-13" as const;

export const PHASE52_V1_ENGINE_HUMAN_AUTHORIZATION_DIRECTIVE =
  "Claim all the standing fleet of the agents, Implement the phase 52 engines and keep the V2/ V3 frozen." as const;

/** FUTURE-V3 phases that must never appear in V1 engine module paths. */
export const PHASE52_FROZEN_V3_PHASE_IDS = ["37", "41", "44", "46"] as const;

/**
 * Civilization / reality-simulation surfaces. V1 G-058 attaches to the
 * governed tool sandbox (`tool-runtime.ts`), never these.
 */
export const PHASE52_FROZEN_V3_MODULE_PATHS = [
  "frontend/src/lib/kernel/phase-contracts/phase-37-simulation-engine.ts",
  "frontend/src/lib/kernel/phase-contracts/phase-41-sandbox-engine.ts",
  "frontend/src/lib/sandbox-runtime/contracts.ts",
  "architecture/phase-41-reality-simulation-autonomous-sandbox-civilization-engine.md",
] as const;

export const PHASE52_V1_EXTRACTED_REQUIREMENT_IDS = [
  "G-014",
  "G-018",
  "G-019",
  "G-020",
  "G-029",
  "G-032",
  "G-057",
  "G-058",
  "G-059",
  "G-063",
  "G-092",
  "G-093",
  "G-104",
] as const;

export const PHASE52_FROZEN_REQUIREMENT_IDS = ["G-085"] as const;

export type Phase52V1RequirementId = (typeof PHASE52_V1_EXTRACTED_REQUIREMENT_IDS)[number];
export type Phase52FrozenRequirementId = (typeof PHASE52_FROZEN_REQUIREMENT_IDS)[number];

export interface Phase52V1EngineBinding {
  readonly requirementId: Phase52V1RequirementId;
  readonly name: string;
  readonly engineId: string;
  readonly bucket: "V1";
  readonly versionTarget: "ACTIVE-V1";
  readonly disposition: "attached";
  readonly modulePaths: readonly string[];
}

export interface Phase52FrozenEngineBinding {
  readonly requirementId: Phase52FrozenRequirementId;
  readonly name: string;
  readonly bucket: "DEFERRED_CORPUS";
  readonly versionTarget: "FROZEN";
  readonly disposition: "frozen";
  readonly reason: string;
}

export const PHASE52_V1_ENGINE_BINDINGS: readonly Phase52V1EngineBinding[] = [
  {
    requirementId: "G-014",
    name: "Agent as first-class governed actor",
    engineId: "governed_actor_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: [
      "frontend/src/lib/workforce/worker-definition.ts",
      "frontend/src/lib/workforce/worker-registry.ts",
      "frontend/src/lib/workforce/v1-workforce-lock.ts",
      "frontend/src/lib/identity-actor.ts",
    ],
  },
  {
    requirementId: "G-018",
    name: "Workflow fabric with trigger -> plan -> policy -> approval -> execute -> verify -> event",
    engineId: "workflow_fabric_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: [
      "frontend/src/lib/workflow/workflow-engine.ts",
      "frontend/src/lib/workflow/workflow-contract.ts",
    ],
  },
  {
    requirementId: "G-019",
    name: "Action lifecycle from PROPOSED to VERIFIED",
    engineId: "action_lifecycle_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: [
      "frontend/src/lib/missions/mission-execution.ts",
      "frontend/src/lib/workforce/worker-host.ts",
    ],
  },
  {
    requirementId: "G-020",
    name: "Evidence object and claim-evidence-observation-source graph",
    engineId: "evidence_graph_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: ["frontend/src/lib/evidence/capture.ts"],
  },
  {
    requirementId: "G-029",
    name: "AI safety boundary: thought -> proposal -> authorization -> execution",
    engineId: "ai_output_trust_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: ["frontend/src/lib/ai-gateway/output-trust-pipeline.ts"],
  },
  {
    requirementId: "G-032",
    name: "Delegation, acting-on-behalf-of, and impersonation with revocation and non-escalation",
    engineId: "delegation_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: ["frontend/src/lib/mission/delegation-contract.ts"],
  },
  {
    requirementId: "G-057",
    name: "Agent runtime: sessions, coordination, delegation, conflict resolution, priority, concurrency, dormancy",
    engineId: "agent_runtime_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: [
      "frontend/src/lib/agent-runtime/ephemeral-lifecycle.ts",
      "frontend/src/lib/workforce/worker-host.ts",
    ],
  },
  {
    requirementId: "G-058",
    name: "Agent sandbox, shadow mode, and rollout safety",
    engineId: "agent_sandbox_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: ["frontend/src/lib/workforce/tool-runtime.ts"],
  },
  {
    requirementId: "G-059",
    name: "Agent observability, explanation and activity graphs",
    engineId: "agent_observability_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: [
      "frontend/src/lib/observability/structured-log.ts",
      "frontend/src/lib/observability/trace-context.ts",
    ],
  },
  {
    requirementId: "G-063",
    name: "Workflow/tool/action execution substrate with verification and compensation",
    engineId: "execution_substrate_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: [
      "frontend/src/lib/missions/mission-execution-store.ts",
      "frontend/src/lib/missions/mission-execution.ts",
    ],
  },
  {
    requirementId: "G-092",
    name: "Mission and objective representation for delegated work",
    engineId: "mission_objective_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: ["frontend/src/lib/mission/mission-contract.ts"],
  },
  {
    requirementId: "G-093",
    name: "Outcome measurement and learning without rewriting truth",
    engineId: "outcome_measurement_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: [
      "frontend/src/lib/hermes/hermes-cycle.ts",
      "frontend/src/lib/assurance/verification-independence.ts",
    ],
  },
  {
    requirementId: "G-104",
    name: "Reality loop as the platform invariant (V1 core; V3 loop tail frozen)",
    engineId: "reality_loop_engine",
    bucket: "V1",
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
    modulePaths: ["frontend/src/lib/jarvis/enterprise-loop.ts"],
  },
];

export const PHASE52_FROZEN_ENGINE_BINDINGS: readonly Phase52FrozenEngineBinding[] = [
  {
    requirementId: "G-085",
    name: "CoreGrid autonomous company operating system (internal AI departments, CEO agent, self-operating company)",
    bucket: "DEFERRED_CORPUS",
    versionTarget: "FROZEN",
    disposition: "frozen",
    reason:
      "G-085 is DEFERRED_CORPUS. Extract-only. V1 share lives on G-057. Do not implement the autonomous company OS.",
  },
];

export const PHASE52_V1_COMPLETENESS_LOOP = [
  { stage: "Mission", requirementIds: ["G-092"] },
  { stage: "Delegation", requirementIds: ["G-032"] },
  { stage: "Worker Execution", requirementIds: ["G-014", "G-057", "G-058"] },
  { stage: "Evidence", requirementIds: ["G-020"] },
  { stage: "Verification", requirementIds: ["G-019", "G-029", "G-063"] },
  { stage: "Outcome", requirementIds: ["G-093", "G-104"] },
] as const;

const V1_BY_ID = new Map<string, Phase52V1EngineBinding>(
  PHASE52_V1_ENGINE_BINDINGS.map((binding) => [binding.requirementId, binding]),
);
const FROZEN_BY_ID = new Map<string, Phase52FrozenEngineBinding>(
  PHASE52_FROZEN_ENGINE_BINDINGS.map((binding) => [binding.requirementId, binding]),
);

export type Phase52EngineDenyReason =
  | "missing_tenant"
  | "missing_actor"
  | "unknown_requirement"
  | "frozen_v2"
  | "frozen_v3"
  | "frozen_deferred"
  | "full_corpus_unauthorized"
  | "v1_engines_unauthorized";

export type Phase52EngineInvokeResult =
  | {
      readonly ok: true;
      readonly requirementId: Phase52V1RequirementId;
      readonly engineId: string;
      readonly name: string;
      readonly modulePaths: readonly string[];
      readonly versionTarget: "ACTIVE-V1";
      readonly disposition: "attached";
    }
  | {
      readonly ok: false;
      readonly requirementId: string;
      readonly reason: Phase52EngineDenyReason;
    };

export interface Phase52EngineInvokeInput {
  readonly requirementId: string;
  readonly tenantId: string;
  readonly actorId: string;
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function pathLooksFrozenV3(modulePath: string): boolean {
  const lower = modulePath.toLowerCase();
  if (PHASE52_FROZEN_V3_MODULE_PATHS.some((frozen) => frozen === modulePath)) {
    return true;
  }
  if (lower.includes("phase-37") || lower.includes("phase-41") || lower.includes("phase-44") || lower.includes("phase-46")) {
    return true;
  }
  if (lower.includes("sandbox-runtime")) {
    return true;
  }
  return false;
}

/**
 * Dispatch one extracted Phase 52 requirement onto its attached V1 engine.
 * Fail closed for missing tenant/actor, unknown ids, G-085, V2/V3, and
 * full-corpus authorization.
 */
export function invokePhase52Engine(input: Phase52EngineInvokeInput): Phase52EngineInvokeResult {
  if (isBlank(input.tenantId)) {
    return { ok: false, requirementId: input.requirementId, reason: "missing_tenant" };
  }
  if (isBlank(input.actorId)) {
    return { ok: false, requirementId: input.requirementId, reason: "missing_actor" };
  }
  if (PHASE52_V1_ENGINE_IMPLEMENTATION_AUTHORIZED !== true) {
    return { ok: false, requirementId: input.requirementId, reason: "v1_engines_unauthorized" };
  }
  if (PHASE52_V2_ENGINE_IMPLEMENTATION_AUTHORIZED === true) {
    return { ok: false, requirementId: input.requirementId, reason: "frozen_v2" };
  }
  if (PHASE52_V3_ENGINE_IMPLEMENTATION_AUTHORIZED === true) {
    return { ok: false, requirementId: input.requirementId, reason: "frozen_v3" };
  }

  const frozen = FROZEN_BY_ID.get(input.requirementId);
  if (frozen) {
    return { ok: false, requirementId: input.requirementId, reason: "frozen_deferred" };
  }

  const binding = V1_BY_ID.get(input.requirementId);
  if (!binding) {
    return { ok: false, requirementId: input.requirementId, reason: "unknown_requirement" };
  }

  if (binding.modulePaths.some(pathLooksFrozenV3)) {
    return { ok: false, requirementId: input.requirementId, reason: "frozen_v3" };
  }

  return {
    ok: true,
    requirementId: binding.requirementId,
    engineId: binding.engineId,
    name: binding.name,
    modulePaths: binding.modulePaths,
    versionTarget: "ACTIVE-V1",
    disposition: "attached",
  };
}

export function getPhase52V1Engine(requirementId: string): Phase52V1EngineBinding | undefined {
  return V1_BY_ID.get(requirementId);
}

export function listPhase52V1Engines(): readonly Phase52V1EngineBinding[] {
  return PHASE52_V1_ENGINE_BINDINGS;
}

export interface Phase52CompletenessLoopResult {
  readonly ok: true;
  readonly versionTarget: "ACTIVE-V1";
  readonly stages: readonly {
    readonly stage: string;
    readonly engines: readonly Extract<Phase52EngineInvokeResult, { ok: true }>[];
  }[];
}

export type Phase52CompletenessLoopOutcome =
  | Phase52CompletenessLoopResult
  | { readonly ok: false; readonly reason: Phase52EngineDenyReason; readonly requirementId: string };

/**
 * Library-form completeness loop: dispatch every V1 loop stage, then SLEEP.
 * A frozen or unknown requirement in the loop fails closed.
 */
export function runPhase52V1CompletenessLoop(input: {
  tenantId: string;
  actorId: string;
}): Phase52CompletenessLoopOutcome {
  const stages: Phase52CompletenessLoopResult["stages"][number][] = [];
  for (const stage of PHASE52_V1_COMPLETENESS_LOOP) {
    const engines: Extract<Phase52EngineInvokeResult, { ok: true }>[] = [];
    for (const requirementId of stage.requirementIds) {
      const result = invokePhase52Engine({
        requirementId,
        tenantId: input.tenantId,
        actorId: input.actorId,
      });
      if (!result.ok) {
        return { ok: false, reason: result.reason, requirementId: result.requirementId };
      }
      engines.push(result);
    }
    stages.push({ stage: stage.stage, engines });
  }
  return { ok: true, versionTarget: "ACTIVE-V1", stages };
}

export function assertPhase52V2V3RemainFrozen(): void {
  if (PHASE52_V2_ENGINE_IMPLEMENTATION_AUTHORIZED !== false) {
    throw new Error("Phase 52 V2 engines are frozen (AGENTS.md §45): fail closed.");
  }
  if (PHASE52_V3_ENGINE_IMPLEMENTATION_AUTHORIZED !== false) {
    throw new Error("Phase 52 V3 engines are frozen (AGENTS.md §45): fail closed.");
  }
  if (PHASE52_G085_ENGINE_IMPLEMENTATION_AUTHORIZED !== false) {
    throw new Error("G-085 autonomous company OS is deferred: fail closed.");
  }
  if (PHASE52_IMPLEMENTATION_AUTHORIZED !== false) {
    throw new Error("Full Phase 52 corpus implementation is not authorized: fail closed.");
  }
  if (PHASE52_REGISTERED !== false || phase52Registered !== false) {
    throw new Error("Phase 52 is not a registered canonical phase: fail closed.");
  }
}

export function assertPhase52V1EnginesAuthorized(): void {
  if (PHASE52_V1_ENGINE_IMPLEMENTATION_AUTHORIZED !== true) {
    throw new Error("Phase 52 V1 engines are not authorized: fail closed.");
  }
  assertPhase52RemainsClassified();
  assertPhase52V2V3RemainFrozen();
  for (const binding of PHASE52_V1_ENGINE_BINDINGS) {
    if (binding.modulePaths.some(pathLooksFrozenV3)) {
      throw new Error(
        `Phase 52 V1 engine ${binding.requirementId} attached a frozen V3 module: fail closed.`,
      );
    }
  }
  const g085 = invokePhase52Engine({
    requirementId: "G-085",
    tenantId: "governance",
    actorId: "architecture_council",
  });
  if (g085.ok || g085.reason !== "frozen_deferred") {
    throw new Error("G-085 must remain frozen_deferred: fail closed.");
  }
}

assertPhase52V1EnginesAuthorized();
