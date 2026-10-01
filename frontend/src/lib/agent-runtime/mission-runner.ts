/**
 * CoreGrid — ephemeral mission runner PLAN (V5.3 Parts 13–14, MISSION-V1-009).
 *
 * Given an ephemeral agent definition and a mission (existing mission
 * vocabulary from `control-plane/foundation-mission.ts`), produces a RunPlan:
 * the context assembly request, tool invocations as AUTHORIZED action plans,
 * evidence requirements, and termination conditions.
 *
 * This runner NEVER executes anything. It plans. Execution remains with the
 * existing foundation loop (`runFoundationLoop` / `admitExecution` in
 * `control-plane/foundation-mission.ts`) — reuse, not rebuild. Worker claims
 * are never verification (mechanism 09); every authorized action requires
 * evidence.
 *
 * Authorization here is an intersection, fail closed:
 *   tool allowed  ⟺  tool ∈ definition.allowedTools
 *                  && action ∈ mission.authorizedActions
 *                  && action ∉ mission.nonScope
 * Canonical worker ownership is pending (BLK-6 / CG-GAP-009/011); this module
 * is the EPHEMERAL RUNTIME planning layer only and delegates identity and
 * permissions to the existing substrate.
 */

import type { AgentDefinitionId } from "../agent-core";
import type { ActorScope, MissionIntent } from "../control-plane/foundation-mission";
import type { AgentDefinition } from "./ephemeral-lifecycle";

/* ─────────────────────────────────────────────────────────────
 * Run plan model
 * ────────────────────────────────────────────────────────────*/

export interface ContextAssemblyRequest {
  missionId: string;
  tenantId: string;
  purpose: string;
  authorityRef: string;
  /** Mission context reference — resolved by the executor, never here. */
  contextRef: string;
  nonScope: readonly string[];
}

export interface AuthorizedActionPlan {
  kind: "authorized_tool_invocation";
  toolId: string;
  /** Always true: worker claims are never verification (mechanism 09). */
  requiresEvidence: true;
}

export interface DeniedActionPlan {
  kind: "denied_tool_invocation";
  toolId: string;
  reason: "tool_not_in_allowlist" | "out_of_mission_scope";
}

export interface TerminationConditions {
  maxActions: number;
  timeLimitMs: number;
  onLeaseExpiry: "terminate";
  onActionLimitReached: "terminate";
  onBudgetExhaustion: "terminate";
  onEvidenceMissing: "terminate";
}

export interface RunPlan {
  definitionId: AgentDefinitionId;
  missionId: string;
  tenantId: string;
  contextAssembly: ContextAssemblyRequest;
  actions: readonly AuthorizedActionPlan[];
  deniedActions: readonly DeniedActionPlan[];
  evidenceRequirements: readonly string[];
  terminationConditions: TerminationConditions;
}

/* ─────────────────────────────────────────────────────────────
 * Decisions (fail closed)
 * ────────────────────────────────────────────────────────────*/

export type RunnerDenyCode =
  | "mission_not_active"
  | "mission_expired"
  | "actor_revoked"
  | "cross_tenant";

export type RunPlanDecision =
  | { ok: true; plan: RunPlan }
  | { ok: false; code: RunnerDenyCode; reason: string };

export interface CreateRunPlanInput {
  definition: AgentDefinition;
  mission: MissionIntent;
  actor: ActorScope;
  /** Tool invocations the mission work requires, in intended order. */
  requestedTools: readonly string[];
  now: string;
}

/** Per-tool authorization decision (pure; no execution). */
export function evaluateToolAuthorization(
  definition: AgentDefinition,
  mission: MissionIntent,
  toolId: string,
): { authorized: true } | { authorized: false; reason: "tool_not_in_allowlist" | "out_of_mission_scope" } {
  if (!definition.allowedTools.includes(toolId)) {
    return { authorized: false, reason: "tool_not_in_allowlist" };
  }
  if (mission.nonScope.includes(toolId) || !mission.authorizedActions.includes(toolId)) {
    return { authorized: false, reason: "out_of_mission_scope" };
  }
  return { authorized: true };
}

/**
 * Build a RunPlan for an ephemeral worker against an authorized mission.
 * Rejects inactive, expired, cross-tenant missions and revoked actors with an
 * explicit deny code; never throws, never executes.
 */
export function createRunPlan(input: CreateRunPlanInput): RunPlanDecision {
  const { definition, mission, actor, requestedTools, now } = input;

  if (mission.lifecycle !== "authorized") {
    return {
      ok: false,
      code: "mission_not_active",
      reason: `Mission lifecycle is "${mission.lifecycle}"; only authorized missions may be planned`,
    };
  }
  if (mission.expiresAt !== null && mission.expiresAt <= now) {
    return { ok: false, code: "mission_expired", reason: "Mission expired before planning" };
  }
  if (actor.revoked) {
    return { ok: false, code: "actor_revoked", reason: "Actor scope is revoked" };
  }
  if (mission.tenantId !== definition.tenantRef || actor.tenantId !== mission.tenantId) {
    return {
      ok: false,
      code: "cross_tenant",
      reason: "Definition, actor and mission tenant references must match exactly",
    };
  }

  const actions: AuthorizedActionPlan[] = [];
  const deniedActions: DeniedActionPlan[] = [];
  for (const toolId of requestedTools) {
    const verdict = evaluateToolAuthorization(definition, mission, toolId);
    if (verdict.authorized) {
      actions.push({ kind: "authorized_tool_invocation", toolId, requiresEvidence: true });
    } else {
      deniedActions.push({ kind: "denied_tool_invocation", toolId, reason: verdict.reason });
    }
  }

  return {
    ok: true,
    plan: {
      definitionId: definition.id,
      missionId: mission.missionId,
      tenantId: mission.tenantId,
      contextAssembly: {
        missionId: mission.missionId,
        tenantId: mission.tenantId,
        purpose: mission.purpose,
        authorityRef: mission.authorityRef,
        contextRef: mission.contextRef,
        nonScope: mission.nonScope,
      },
      actions,
      deniedActions,
      evidenceRequirements: definition.evidenceRequirements,
      terminationConditions: {
        maxActions: definition.actionLimit,
        timeLimitMs: definition.timeLimitMs,
        onLeaseExpiry: "terminate",
        onActionLimitReached: "terminate",
        onBudgetExhaustion: "terminate",
        onEvidenceMissing: "terminate",
      },
    },
  };
}
