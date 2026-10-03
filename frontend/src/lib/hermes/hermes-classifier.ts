/**
 * CoreGrid — Hermes action classifier (MISSION V1-002, bounded self-healing).
 *
 * The fail-closed policy gate between Hermes' assessments and Hermes' acts.
 * EVERY proposed action passes through `classifyHermesAction` before the
 * cycle will touch anything: the classifier returns exactly one of
 *
 *   ALLOW             — the action class is inside the bounded
 *                       self-healing envelope (§45): safe retries, repair
 *                       intents, human escalation, provenance-preserving
 *                       memory writes;
 *   REQUIRE_APPROVAL  — a critical/high-risk decision: typed REQUIRE_APPROVAL
 *                       outcome routed to a human operator; the cycle NEVER
 *                       executes past this gate (AGENTS §21);
 *   DENY              — a destructive or out-of-bounds action class (deploy,
 *                       delete, production-state mutation, governance
 *                       mutation, self-authority grant) or an UNKNOWN class.
 *
 * Deny rules are ENCODED IN CODE (fail-closed): an unknown action class is
 * denied, not guessed; a destructive class is denied regardless of any
 * urgency, severity or justification carried by the finding. There is no
 * override parameter.
 *
 * `lib/jarvis/jarvis-contract.ts` classification (§52): SUPERSEDED — that
 * module evaluated actions against an ENUMERATED capability list held by the
 * caller; Hermes instead resolves its authority through the neutral RBAC
 * engine over pre-recorded delegation grants (Invariant 12) and classifies
 * ACTIONS here. The jarvis module is retained unmodified for provenance.
 *
 * Boundary: pure functions. No I/O, no state, no clock.
 */

import {
  HERMES_ACTION_CLASSES,
  isCriticalMissionAction,
  type HermesActionClass,
  type HermesClassifierVerdict,
} from "./hermes-contract";

function isKnownActionClass(actionClass: string): actionClass is HermesActionClass {
  return (HERMES_ACTION_CLASSES as readonly string[]).includes(actionClass);
}

/** The classify input: the proposed class plus the underlying mission action. */
export interface HermesClassificationInput {
  readonly actionClass: HermesActionClass;
  /** The underlying mission action the proposal concerns ("" when none). */
  readonly underlyingAction: string;
}

/**
 * Classify ONE proposed Hermes action. Order is fail-closed: unknown class
 * first, then the encoded destructive deny rules, then the approval gate,
 * then the bounded self-healing allow-list.
 */
export function classifyHermesAction(input: HermesClassificationInput): HermesClassifierVerdict {
  const { actionClass, underlyingAction } = input;
  if (typeof actionClass !== "string" || !isKnownActionClass(actionClass)) {
    return {
      decision: "DENY",
      code: "unknown_action_class",
      reason: `Unknown action class "${String(actionClass)}" — Hermes fails closed`,
    };
  }

  // Encoded deny rules (§45 fail-closed): destructive action classes are
  // denied by name, with reasons. No context can lift them.
  switch (actionClass) {
    case "deploy":
      return {
        decision: "DENY",
        code: "deploy_forbidden",
        reason: "Hermes may not deploy — bounded self-healing excludes deployments (§45)",
      };
    case "delete_data":
      return {
        decision: "DENY",
        code: "destructive_write_forbidden",
        reason:
          "Hermes may not delete data — bounded self-healing excludes destructive writes (§45)",
      };
    case "purge_production_state":
      return {
        decision: "DENY",
        code: "production_state_forbidden",
        reason:
          "Hermes may not mutate production state destructively — bounded self-healing excludes it (§45)",
      };
    case "modify_governance":
      return {
        decision: "DENY",
        code: "governance_mutation_forbidden",
        reason: "Hermes may not modify governance rules (AGENTS §37)",
      };
    case "grant_authority":
      return {
        decision: "DENY",
        code: "self_authority_grant_forbidden",
        reason:
          "Hermes may not grant authority — AI improvement is not permission expansion (AGENTS §8)",
      };
    default:
      break;
  }

  if (actionClass === "execute_critical_action") {
    return {
      decision: "REQUIRE_APPROVAL",
      reason: `Critical action "${underlyingAction}" requires a human approval record before any execution (AGENTS §21)`,
      routedTo: "human_operator",
    };
  }

  // Allow-list: the bounded self-healing envelope. A "safe" retry whose
  // UNDERLYING mission action is itself critical is re-raised to the
  // approval gate — the class never launders the underlying risk.
  if (actionClass === "retry_safe_mission" || actionClass === "open_repair_intent") {
    if (isCriticalMissionAction(underlyingAction)) {
      return {
        decision: "REQUIRE_APPROVAL",
        reason: `Underlying mission action "${underlyingAction}" is critical — routed to a human, not self-healed`,
        routedTo: "human_operator",
      };
    }
    return {
      decision: "ALLOW",
      reason: `Safe self-healing action class "${actionClass}" inside the §45 envelope`,
    };
  }

  if (actionClass === "escalate_to_human" || actionClass === "record_cycle_memory") {
    return {
      decision: "ALLOW",
      reason: `Governed observability act "${actionClass}" (requesting IS the lawful path)`,
    };
  }

  // Unreachable given the closed union, but fail closed anyway.
  return {
    decision: "DENY",
    code: "unknown_action_class",
    reason: `Action class "${actionClass}" fell through classification — denied`,
  };
}
