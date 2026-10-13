/**
 * CoreGrid — Phase 52 classified attachment lock (Architecture Council).
 *
 * Phase 52 remains CLASSIFIED and NOT implementation-authorized as a full
 * corpus: PHASE52_IMPLEMENTATION_AUTHORIZED stays false. That token covers
 * V2 / V3 / G-085 / FUTURE-UNASSIGNED. Phase 52 is not a registered
 * canonical phase (PHASE52_REGISTERED stays false).
 *
 * Human authorization (2026-10-13) implements V1 engines via the sibling
 * `phase52-v1-engines.ts` (attach-to-existing) and claims the V1 standing
 * fleet via `standing-fleet-claim.ts`. This lock still refuses full-corpus
 * implementation and keeps frozen workers not implementable.
 *
 * V1 attach vs freeze is decided from the existing workforce lock:
 *   ACTIVE-V1 + ATTACH TO EXISTING ENGINE | CREATE WORKFORCE CAPABILITY
 *     → attachable (V1 engines attach in phase52-v1-engines.ts)
 *   FREEZE V2 | FREEZE BEYOND V2
 *     → frozen, not implementable
 *
 * Frozen workers that must remain not implementable:
 *   sdk_engineer, ml_engineer, knowledge_engineer,
 *   intelligence_research_agent, growth_intelligence_agent,
 *   customer_success_agent
 *
 * Un-freezing V2 / V3 / deferred workers requires an explicit human
 * authorization record. The 2026-10-13 directive keeps those frozen.
 *
 * Boundary: pure data + pure functions. No I/O, no vendor, no secrets.
 * Version target: ACTIVE-V1 (AGENTS.md §45).
 */

import {
  getV1WorkforceWorker,
  V1_WORKFORCE_WORKERS,
  type V1WorkforceWorker,
} from "./v1-workforce-lock";

/**
 * Token pinned by four-eyes: the full Phase 52 corpus (V2/V3/G-085/
 * unassigned) is not authorized. V1 extracted engines attach in
 * `phase52-v1-engines.ts` under PHASE52_V1_ENGINE_IMPLEMENTATION_AUTHORIZED.
 */
export const PHASE52_IMPLEMENTATION_AUTHORIZED = false as const;

/** Sibling V1 engine registry — attach-to-existing, V2/V3 still frozen. */
export const PHASE52_V1_ENGINE_REGISTRY_MODULE =
  "frontend/src/lib/workforce/phase52-v1-engines.ts" as const;

/** Token pinned by four-eyes: Phase 52 is not a registered canonical phase. */
export const PHASE52_REGISTERED = false as const;

/** Alias for tests / callers that look for either export name. */
export const phase52Registered = false as const;

export const PHASE52_VERSION_TARGET = "ACTIVE-V1" as const;

export const V1_ATTACHABLE_PHASE52_ACTIONS = [
  "ATTACH TO EXISTING ENGINE",
  "CREATE WORKFORCE CAPABILITY",
] as const;

export const PHASE52_FROZEN_ACTIONS = ["FREEZE V2", "FREEZE BEYOND V2"] as const;

export type V1AttachablePhase52Action = (typeof V1_ATTACHABLE_PHASE52_ACTIONS)[number];
export type Phase52FrozenAction = (typeof PHASE52_FROZEN_ACTIONS)[number];

/**
 * Named freeze set from the Jarvis enterprise directive. Source-named so
 * four-eyes can grep each id. Runtime attach/freeze still derives from the
 * workforce lock — this list is the classified freeze invariant, not a
 * duplicate of the 64-role table.
 */
export const PHASE52_NAMED_FROZEN_WORKER_IDS = [
  "sdk_engineer",
  "ml_engineer",
  "knowledge_engineer",
  "intelligence_research_agent",
  "growth_intelligence_agent",
  "customer_success_agent",
] as const;

const ATTACHABLE_ACTION_SET: ReadonlySet<string> = new Set(V1_ATTACHABLE_PHASE52_ACTIONS);
const FROZEN_ACTION_SET: ReadonlySet<string> = new Set(PHASE52_FROZEN_ACTIONS);

function isAttachableAction(action: V1WorkforceWorker["phase52Action"]): action is V1AttachablePhase52Action {
  return ATTACHABLE_ACTION_SET.has(action);
}

function isFrozenAction(action: V1WorkforceWorker["phase52Action"]): action is Phase52FrozenAction {
  return FROZEN_ACTION_SET.has(action);
}

function isV1AttachableWorker(entry: V1WorkforceWorker): boolean {
  return entry.versionTarget === "ACTIVE-V1" && isAttachableAction(entry.phase52Action);
}

function deriveAttachableWorkerIds(): readonly string[] {
  return V1_WORKFORCE_WORKERS.filter(isV1AttachableWorker).map((entry) => entry.workerId);
}

function deriveFrozenWorkerIds(): readonly string[] {
  return V1_WORKFORCE_WORKERS.filter((entry) => isFrozenAction(entry.phase52Action)).map(
    (entry) => entry.workerId,
  );
}

export interface Phase52AttachmentPolicy {
  readonly implementationAuthorized: false;
  readonly phase52Registered: false;
  readonly versionTarget: "ACTIVE-V1";
  readonly v1AttachableWorkerIds: readonly string[];
  readonly frozenWorkerIds: readonly string[];
}

/**
 * Load the classified attachment policy. Attachable / frozen ids are derived
 * from v1-workforce-lock exports (phase52Action + versionTarget). Full-corpus
 * implementationAuthorized stays false. V1 engines attach in the sibling
 * phase52-v1-engines module.
 */
export function loadPhase52AttachmentPolicy(): Phase52AttachmentPolicy {
  return {
    implementationAuthorized: false,
    phase52Registered: false,
    versionTarget: PHASE52_VERSION_TARGET,
    v1AttachableWorkerIds: deriveAttachableWorkerIds(),
    frozenWorkerIds: deriveFrozenWorkerIds(),
  };
}

/**
 * Throws if Phase 52 is treated as implementation-authorized or registered.
 * Shipped constants keep this a no-op success; mutation of the tokens fails closed.
 */
export function assertPhase52RemainsClassified(): void {
  if (PHASE52_IMPLEMENTATION_AUTHORIZED !== false) {
    throw new Error("Phase 52 is classified: implementation is not authorized.");
  }
  if (PHASE52_REGISTERED !== false || phase52Registered !== false) {
    throw new Error("Phase 52 is classified: it is not a registered canonical phase.");
  }
}

function assertNamedFrozenWorkersRemainFrozen(): void {
  for (const workerId of PHASE52_NAMED_FROZEN_WORKER_IDS) {
    if (isPhase52WorkerImplementable(workerId)) {
      throw new Error(
        `Phase 52 classified lock: ${workerId} is frozen and is not implementable.`,
      );
    }
    const entry = getV1WorkforceWorker(workerId);
    if (!entry || !isFrozenAction(entry.phase52Action)) {
      throw new Error(
        `Phase 52 classified lock: ${workerId} must remain on a FREEZE action.`,
      );
    }
  }
}

/**
 * True only for ACTIVE-V1 workers whose phase52Action is ATTACH TO EXISTING
 * ENGINE or CREATE WORKFORCE CAPABILITY. False for FREEZE V2 / FREEZE
 * BEYOND V2, unknown ids, and every frozen worker (sdk_engineer,
 * ml_engineer, knowledge_engineer, intelligence_research_agent,
 * growth_intelligence_agent, customer_success_agent). V1 engine attach
 * lives in phase52-v1-engines.ts; this predicate does not un-freeze V2/V3.
 */
export function isPhase52WorkerImplementable(workerId: string): boolean {
  const entry = getV1WorkforceWorker(workerId);
  if (!entry) return false;
  return isV1AttachableWorker(entry);
}

assertPhase52RemainsClassified();
assertNamedFrozenWorkersRemainFrozen();
