/**
 * CoreGrid — ephemeral agent runtime lifecycle (V5.3 Parts 13–14, MISSION-V1-009).
 *
 * A PURE lifecycle state machine for ephemeral agent workers. It owns nothing
 * persistent: identity and permission vocabulary is delegated to the existing
 * substrate (`agent-core.ts`), and this module adds only the ephemeral runtime
 * layer — a lease that is born, runs a bounded mission, and TERMINATES.
 *
 * Part 14 law: agents must NOT remain permanently alive.
 * - Persistent (owned elsewhere): identity, configuration, permissions, memory
 *   records, mission history, evidence, state.
 * - Ephemeral (this module): the runtime lease, its stage, its counters, its
 *   expiry.
 *
 * The machine FAILS CLOSED:
 * - every illegal stage transition is rejected with an explicit reason;
 * - lease expiry forces termination (no event survives an expired lease);
 * - action-limit and budget exhaustion force termination;
 * - a terminated lease can never be resurrected (no persist-forever);
 * - there is NO event and NO transition path that escalates permissions —
 *   the event union carries no permission-bearing variant by construction.
 *
 * This module performs no persistence, no I/O, no execution.
 */

import type { AgentDefinitionId, AgentPermission } from "../agent-core";

/* ─────────────────────────────────────────────────────────────
 * Agent definition (runtime view over the persistent substrate)
 * ────────────────────────────────────────────────────────────*/

/**
 * Runtime view of an agent definition. Identity (`id`) and permission
 * vocabulary (`permissions`) are delegated to `agent-core.ts`; the canonical
 * worker-identity authority is pending (BLK-6 / CG-GAP-009/011) so this layer
 * deliberately does NOT become one — it consumes references only.
 */
export interface AgentDefinition {
  id: AgentDefinitionId;
  /** Tenant the worker is bound to; every mission must match it exactly. */
  tenantRef: string;
  capabilities: readonly string[];
  allowedTools: readonly string[];
  permissions: readonly AgentPermission[];
  budget: RuntimeBudget;
  timeLimitMs: number;
  actionLimit: number;
  evidenceRequirements: readonly string[];
}

export interface RuntimeBudget {
  maxTokens: number | null;
  maxFinancialCost: number | null;
}

export interface BudgetConsumption {
  tokensUsed: number;
  financialCostUsed: number;
}

/* ─────────────────────────────────────────────────────────────
 * Ephemeral lifecycle states (Part 14 stages)
 * ────────────────────────────────────────────────────────────*/

export type EphemeralLifecycleState =
  | "defined"
  | "triggered"
  | "mission_bound"
  | "queued"
  | "worker_running"
  | "context_assembled"
  | "reasoning"
  | "acting"
  | "evidence_collected"
  | "verifying"
  | "result_persisted"
  | "sleeping"
  | "terminated";

export const TERMINATED_STATE: EphemeralLifecycleState = "terminated";

/* ─────────────────────────────────────────────────────────────
 * Lifecycle events (discriminated union, one per Part 14 stage)
 * ────────────────────────────────────────────────────────────*/

export type TerminationReason =
  | "mission_completed"
  | "lease_expired"
  | "action_limit_exceeded"
  | "budget_exhausted"
  | "verification_failed"
  | "operator_stop";

export type LifecycleEvent =
  | { type: "TRIGGER"; atMs: number }
  | { type: "MISSION_BIND"; atMs: number; missionId: string; missionTenantRef: string }
  | { type: "ENQUEUE"; atMs: number }
  | { type: "WORKER_START"; atMs: number; workerRef: string }
  | { type: "CONTEXT_ASSEMBLE"; atMs: number; contextRef: string }
  | { type: "REASON"; atMs: number; tokensUsed: number }
  | { type: "ACT"; atMs: number; toolId: string; financialCost: number }
  | { type: "EVIDENCE"; atMs: number; evidenceRef: string }
  | { type: "VERIFY"; atMs: number; passed: boolean }
  | { type: "PERSIST_RESULT"; atMs: number }
  | { type: "SLEEP"; atMs: number }
  | { type: "TERMINATE"; atMs: number; reason: TerminationReason };

/** Every stage name, for exhaustiveness checks and reporting. */
export const LIFECYCLE_EVENT_TYPES = [
  "TRIGGER",
  "MISSION_BIND",
  "ENQUEUE",
  "WORKER_START",
  "CONTEXT_ASSEMBLE",
  "REASON",
  "ACT",
  "EVIDENCE",
  "VERIFY",
  "PERSIST_RESULT",
  "SLEEP",
  "TERMINATE",
] as const;

export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[number];

/* ─────────────────────────────────────────────────────────────
 * Runtime lease (fully ephemeral)
 * ────────────────────────────────────────────────────────────*/

export interface RuntimeLease {
  leaseId: string;
  definitionId: AgentDefinitionId;
  /** Tenant snapshot from the definition; mission binding must match. */
  tenantRef: string;
  /** Mission binding; null until MISSION_BIND succeeds. */
  missionId: string | null;
  state: EphemeralLifecycleState;
  issuedAtMs: number;
  expiresAtMs: number;
  lastEventAtMs: number;
  actionsTaken: number;
  actionLimit: number;
  budget: RuntimeBudget;
  budgetUsed: BudgetConsumption;
  lastVerification: "passed" | "failed" | null;
  /** Set when the machine forced termination (expiry/limits), else null. */
  forcedTermination: TerminationReason | null;
}

export function issueLease(definition: AgentDefinition, nowMs: number): RuntimeLease {
  return {
    leaseId: `lease:${definition.id}:${nowMs}`,
    definitionId: definition.id,
    tenantRef: definition.tenantRef,
    missionId: null,
    state: "defined",
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + definition.timeLimitMs,
    lastEventAtMs: nowMs,
    actionsTaken: 0,
    actionLimit: definition.actionLimit,
    budget: definition.budget,
    budgetUsed: { tokensUsed: 0, financialCostUsed: 0 },
    lastVerification: null,
    forcedTermination: null,
  };
}

export function isLeaseTerminal(lease: RuntimeLease): boolean {
  return lease.state === TERMINATED_STATE;
}

/* ─────────────────────────────────────────────────────────────
 * Transition table (fail closed; anything not listed is illegal)
 * ────────────────────────────────────────────────────────────*/

type TransitionTable = Readonly<
  Record<EphemeralLifecycleState, Partial<Record<LifecycleEventType, EphemeralLifecycleState>>>
>;

const WORKING_STATES: readonly EphemeralLifecycleState[] = [
  "triggered",
  "mission_bound",
  "queued",
  "worker_running",
  "context_assembled",
  "reasoning",
  "acting",
  "evidence_collected",
  "verifying",
  "result_persisted",
  "sleeping",
];

const TRANSITIONS: TransitionTable = {
  defined: { TRIGGER: "triggered" },
  triggered: { MISSION_BIND: "mission_bound", TERMINATE: TERMINATED_STATE },
  mission_bound: { ENQUEUE: "queued", TERMINATE: TERMINATED_STATE },
  queued: { WORKER_START: "worker_running", TERMINATE: TERMINATED_STATE },
  worker_running: { CONTEXT_ASSEMBLE: "context_assembled", TERMINATE: TERMINATED_STATE },
  context_assembled: { REASON: "reasoning", TERMINATE: TERMINATED_STATE },
  reasoning: { ACT: "acting", TERMINATE: TERMINATED_STATE },
  acting: { EVIDENCE: "evidence_collected", TERMINATE: TERMINATED_STATE },
  // Evidence may close the loop iteration (verify) or re-enter reasoning for
  // the next perceive→decide→act cycle (Section AO canonical loop).
  evidence_collected: { VERIFY: "verifying", REASON: "reasoning", TERMINATE: TERMINATED_STATE },
  verifying: { PERSIST_RESULT: "result_persisted", TERMINATE: TERMINATED_STATE },
  result_persisted: { SLEEP: "sleeping", TERMINATE: TERMINATED_STATE },
  // Sleeping is pre-termination quiescence, NOT a resurrection path: the only
  // exit is termination (Part 14 — no permanent aliveness).
  sleeping: { TERMINATE: TERMINATED_STATE },
  terminated: {},
};

/* ─────────────────────────────────────────────────────────────
 * Transition result
 * ────────────────────────────────────────────────────────────*/

export type TransitionResult =
  | { ok: true; lease: RuntimeLease; forcedTermination: TerminationReason | null }
  | { ok: false; reason: string; lease: RuntimeLease };

/**
 * Apply a lifecycle event to a lease. Fails closed on every illegal input;
 * expiry, action-limit and budget exhaustion FORCE termination instead of
 * being applied as normal events.
 */
export function transition(current: RuntimeLease, event: LifecycleEvent): TransitionResult {
  // A terminated lease is dead. No event — not even TERMINATE — revives it
  // (no persist-forever, Part 14).
  if (current.state === TERMINATED_STATE) {
    return { ok: false, reason: "terminated_lease_cannot_transition", lease: current };
  }

  // Monotonic clock: replayed or out-of-order events are rejected.
  if (event.atMs < current.lastEventAtMs) {
    return { ok: false, reason: "event_time_before_last_event", lease: current };
  }

  // Lease expiry forces terminate: any non-TERMINATE event past the expiry
  // instant does not run; the machine terminates instead.
  if (event.atMs > current.expiresAtMs && event.type !== "TERMINATE") {
    return {
      ok: true,
      lease: forceTerminate(current, event.atMs, "lease_expired"),
      forcedTermination: "lease_expired",
    };
  }

  if (event.type === "MISSION_BIND") {
    // Cross-tenant mission binding is rejected outright (Section FO).
    if (event.missionTenantRef !== current.tenantRef) {
      return { ok: false, reason: "cross_tenant_mission_rejected", lease: current };
    }
  }

  if (event.type === "REASON" && current.budget.maxTokens !== null) {
    const tokensAfter = current.budgetUsed.tokensUsed + event.tokensUsed;
    if (tokensAfter > current.budget.maxTokens) {
      return {
        ok: true,
        lease: forceTerminate(current, event.atMs, "budget_exhausted"),
        forcedTermination: "budget_exhausted",
      };
    }
  }

  if (event.type === "ACT") {
    // Action-count over limit forces terminate before the action is counted.
    if (current.actionsTaken + 1 > current.actionLimit) {
      return {
        ok: true,
        lease: forceTerminate(current, event.atMs, "action_limit_exceeded"),
        forcedTermination: "action_limit_exceeded",
      };
    }
    if (current.budget.maxFinancialCost !== null) {
      const costAfter = current.budgetUsed.financialCostUsed + event.financialCost;
      if (costAfter > current.budget.maxFinancialCost) {
        return {
          ok: true,
          lease: forceTerminate(current, event.atMs, "budget_exhausted"),
          forcedTermination: "budget_exhausted",
        };
      }
    }
  }

  const to = TRANSITIONS[current.state][event.type];
  if (to === undefined) {
    return {
      ok: false,
      reason: `illegal_transition:${current.state}->${event.type}`,
      lease: current,
    };
  }

  const next: RuntimeLease = {
    ...current,
    state: to,
    lastEventAtMs: event.atMs,
  };

  if (event.type === "MISSION_BIND") {
    next.missionId = event.missionId;
  }
  if (event.type === "REASON") {
    next.budgetUsed = {
      ...current.budgetUsed,
      tokensUsed: current.budgetUsed.tokensUsed + event.tokensUsed,
    };
  }
  if (event.type === "ACT") {
    next.actionsTaken = current.actionsTaken + 1;
    next.budgetUsed = {
      ...current.budgetUsed,
      financialCostUsed: current.budgetUsed.financialCostUsed + event.financialCost,
    };
  }
  if (event.type === "VERIFY") {
    next.lastVerification = event.passed ? "passed" : "failed";
  }
  if (event.type === "TERMINATE") {
    next.forcedTermination = null;
  }

  return { ok: true, lease: next, forcedTermination: null };
}

function forceTerminate(
  current: RuntimeLease,
  atMs: number,
  reason: TerminationReason,
): RuntimeLease {
  return {
    ...current,
    state: TERMINATED_STATE,
    lastEventAtMs: atMs,
    forcedTermination: reason,
  };
}
