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
import {
  authorizeDelegatedAction,
  evaluateDelegationChainAsOf,
  type DelegationChainDenyReason,
  type DelegationDenyReason,
  type MissionDelegation,
} from "../mission/delegation-contract";
import { isContractTimestamp } from "../mission/mission-contract";

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

/* ─────────────────────────────────────────────────────────────
 * Bounded delegation gate (MISSION-R-52 / V1CAP-021, DEFECT-4)
 *
 * Mission execution under delegation validates the delegation contract at
 * EXECUTION time, as-of an explicit instant supplied per gated step. A
 * delegated step is authorized only through a task-assignment delegation
 * record (workers never self-assign, V1CAP-021), the contract's bounded
 * authorization (capability/role/task/identity bounds), and the transitive
 * chain law where an expired, revoked, suspended, not-yet-effective or
 * structurally invalid link anywhere upstream breaks the whole path.
 *
 * Expiry-during-execution is handled by re-evaluation: the gate is pure and
 * receives the instant per call, so a long-running step's next gated action
 * re-evaluates the contract as-of the new instant and fails closed once the
 * delegation has lapsed.
 *
 * Every evaluation — allow or deny — records a mission lifecycle signal
 * (DelegationGateSignal) carrying the verdict used, the named deny code and
 * the defect reference (DEFECT-4) on expiry-enforcement denials.
 * ────────────────────────────────────────────────────────────*/

export type DelegatedStepDenyCode =
  | DelegationChainDenyReason
  | DelegationDenyReason
  | "delegation_missing"
  | "invalid_instant";

/** Mission lifecycle signal recording the delegation verdict used by a gate. */
export interface DelegationGateSignal {
  readonly signalKind: "delegation_gate_verdict";
  readonly missionId: string;
  readonly stepId: string;
  readonly delegationId: string | null;
  readonly verdict: "allow" | "deny";
  readonly denyCode: DelegatedStepDenyCode | null;
  /** Set to DEFECT-4 when the denial is expiry enforcement. */
  readonly defectRef: string | null;
  readonly onBehalfOf: string | null;
  /** The explicit execution instant the verdict was evaluated as-of. */
  readonly evaluatedAt: string;
}

export interface DelegatedStepAttempt {
  readonly stepId: string;
  /** The action (tool) the delegated step performs. */
  readonly action: string;
  /** null = mission-level step. */
  readonly taskRef: string | null;
  readonly delegateRef: string;
}

export interface DelegatedStepGateInput {
  readonly mission: MissionIntent;
  /** The task-assignment delegation under which the step executes. */
  readonly delegation: MissionDelegation | null;
  /** Chain context (target included); empty when the delegation is a lone record. */
  readonly chain: readonly MissionDelegation[];
}

export type DelegatedStepGateDecision =
  | { ok: true; onBehalfOf: string; signal: DelegationGateSignal }
  | { ok: false; code: DelegatedStepDenyCode; reason: string; signal: DelegationGateSignal };

const EXPIRY_DEFECT_REF = "DEFECT-4";

function delegationGateSignal(
  missionId: string,
  stepId: string,
  delegationId: string | null,
  verdict: "allow" | "deny",
  denyCode: DelegatedStepDenyCode | null,
  onBehalfOf: string | null,
  now: string,
): DelegationGateSignal {
  return {
    signalKind: "delegation_gate_verdict",
    missionId,
    stepId,
    delegationId,
    verdict,
    denyCode,
    defectRef: denyCode === "expired" || denyCode === "not_yet_effective" ? EXPIRY_DEFECT_REF : null,
    onBehalfOf,
    evaluatedAt: now,
  };
}

/**
 * Gate ONE delegated step against the delegation contract as-of the given
 * execution instant. Never throws, never executes. Fails closed on: a
 * missing delegation record (self-assignment), a broken chain (including an
 * expired or revoked upstream link), the time window (expiry + notBefore —
 * DEFECT-4), lifecycle status, identity/tenant/mission binding, capability
 * bound and task scope. The recorded signal is returned on BOTH paths so
 * gates always record the delegation verdict used.
 */
export function evaluateDelegatedStepGate(
  input: DelegatedStepGateInput,
  attempt: DelegatedStepAttempt,
  now: string,
): DelegatedStepGateDecision {
  const { mission, delegation, chain } = input;
  const delegationId = delegation?.delegationId ?? null;
  if (!isContractTimestamp(now)) {
    return {
      ok: false,
      code: "invalid_instant",
      reason: "execution instant is not a parseable timestamp",
      signal: delegationGateSignal(mission.missionId, attempt.stepId, delegationId, "deny", "invalid_instant", null, now),
    };
  }
  if (delegation === null) {
    return {
      ok: false,
      code: "delegation_missing",
      reason:
        "delegated steps require a task-assignment delegation record — workers never self-assign (V1CAP-021)",
      signal: delegationGateSignal(mission.missionId, attempt.stepId, null, "deny", "delegation_missing", null, now),
    };
  }

  const chainVerdict = evaluateDelegationChainAsOf(
    chain.length > 0 ? chain : [delegation],
    delegation.delegationId,
    now,
  );
  if (!chainVerdict.ok) {
    return {
      ok: false,
      code: chainVerdict.denyReason,
      reason: chainVerdict.error,
      signal: delegationGateSignal(mission.missionId, attempt.stepId, delegationId, "deny", chainVerdict.denyReason, null, now),
    };
  }

  const authorization = authorizeDelegatedAction(
    delegation,
    {
      delegateRef: attempt.delegateRef,
      tenantId: mission.tenantId,
      missionId: mission.missionId,
      action: attempt.action,
      taskRef: attempt.taskRef,
    },
    now,
  );
  if (!authorization.ok) {
    return {
      ok: false,
      code: authorization.denyReason,
      reason: `delegation "${delegation.delegationId}" denies "${attempt.action}": ${authorization.denyReason}`,
      signal: delegationGateSignal(mission.missionId, attempt.stepId, delegationId, "deny", authorization.denyReason, null, now),
    };
  }
  return {
    ok: true,
    onBehalfOf: authorization.onBehalfOf,
    signal: delegationGateSignal(mission.missionId, attempt.stepId, delegationId, "allow", null, authorization.onBehalfOf, now),
  };
}
