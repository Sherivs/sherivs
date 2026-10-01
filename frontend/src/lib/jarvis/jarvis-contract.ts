/**
 * CoreGrid — Jarvis V1 executive-orchestrator contract (V5.3 Part 15).
 *
 * Jarvis is an EXECUTIVE ORCHESTRATOR + MISSION COORDINATOR + ESCALATION LAYER +
 * PLATFORM OBSERVABILITY INTERFACE — not an unrestricted god-agent. This module
 * encodes the Part 15 boundary as an evaluated contract: every capability Jarvis
 * may exercise is enumerated, every action Jarvis proposes carries a tenant ref,
 * the fixed "jarvis" actor ref, a justification and an approval requirement, and
 * every Part 15 MUST-NOT is an enforced deny code that FAILS CLOSED.
 *
 * This is a pure, testable boundary. It performs no I/O, calls no model, and
 * grants nothing by itself: the runtime that adopts it remains the authorization
 * boundary (RLS + server functions + the capability gate).
 */

/** Capabilities policy may grant to Jarvis (V5.3 Part 15 MAY-list). */
export enum JarvisCapability {
  ObservePlatformState = "observe_platform_state",
  InspectMissionState = "inspect_mission_state",
  CoordinateWorkers = "coordinate_workers",
  InitiateGovernedMission = "initiate_governed_mission",
  RequestApproval = "request_approval",
  EscalateIncident = "escalate_incident",
  SummarizeEvents = "summarize_events",
  RecommendAction = "recommend_action",
}

const ALL_CAPABILITIES: readonly JarvisCapability[] = Object.values(JarvisCapability);

/** Part 15 MUST-NOTs, each an enforced deny code, plus the fail-closed unknown. */
export type JarvisProhibitionCode =
  | "authorization_bypass"
  | "secret_access"
  | "governance_mutation"
  | "self_authority_grant"
  | "approval_override"
  | "out_of_policy_critical_action"
  | "state_fabrication"
  | "unverified_claim"
  | "unknown_capability";

export const JARVIS_PROHIBITION_CODES: readonly JarvisProhibitionCode[] = [
  "authorization_bypass",
  "secret_access",
  "governance_mutation",
  "self_authority_grant",
  "approval_override",
  "out_of_policy_critical_action",
  "state_fabrication",
  "unverified_claim",
  "unknown_capability",
];

/** The only actor ref Jarvis may sign actions with. */
export const JARVIS_ACTOR_REF = "jarvis" as const;

/** Strict runtime check — unknown capability codes fail closed. */
export function isJarvisCapability(code: string): code is JarvisCapability {
  return (ALL_CAPABILITIES as readonly string[]).includes(code);
}

interface JarvisActionFields {
  tenantRef: string;
  actorRef: typeof JARVIS_ACTOR_REF;
  justification: string;
  requiredApproval: boolean;
  /**
   * Declared-intent markers the evaluator enforces against. The caller declares
   * what the action reaches for; the evaluator denies every Part 15 MUST-NOT
   * regardless of how the request is dressed up (unknown capabilities included).
   */
  requestsSecretMaterial?: boolean;
  mutatesGovernance?: boolean;
  expandsOwnAuthority?: boolean;
  bypassesHumanApprovalGate?: boolean;
  executesCriticalOutsidePolicy?: boolean;
  fabricatesSystemState?: boolean;
  claimsVerificationWithoutEvidence?: boolean;
}

/** Discriminated by capability; every variant is a governed Jarvis proposal. */
export type JarvisAction =
  | (JarvisActionFields & {
      capability: JarvisCapability.ObservePlatformState;
      payload: { scope: string };
    })
  | (JarvisActionFields & {
      capability: JarvisCapability.InspectMissionState;
      payload: { missionRef: string };
    })
  | (JarvisActionFields & {
      capability: JarvisCapability.CoordinateWorkers;
      payload: { workerRefs: readonly string[]; directive: string };
    })
  | (JarvisActionFields & {
      capability: JarvisCapability.InitiateGovernedMission;
      payload: { missionRef: string; blueprintSummary: string };
    })
  | (JarvisActionFields & {
      capability: JarvisCapability.RequestApproval;
      payload: { proposalSummary: string };
    })
  | (JarvisActionFields & {
      capability: JarvisCapability.EscalateIncident;
      payload: { incidentRef: string; severity: "info" | "warning" | "critical" };
    })
  | (JarvisActionFields & {
      capability: JarvisCapability.SummarizeEvents;
      payload: { eventRefs: readonly string[] };
    })
  | (JarvisActionFields & {
      capability: JarvisCapability.RecommendAction;
      payload: { recommendationSummary: string };
    });

export interface JarvisEvaluationContext {
  /** Tenant this evaluation is scoped to (multi-tenancy law). */
  tenantRef: string;
  /** Capability codes policy has granted Jarvis. Raw strings so unknown codes stay testable and fail closed. */
  grantedCapabilities: readonly string[];
  /** Whether a recorded human approval currently covers required-approval actions. */
  humanApprovalGranted?: boolean;
}

export type JarvisEvaluation =
  | { decision: "allow"; capability: JarvisCapability; requiredApproval: boolean; reason: string }
  | { decision: "deny"; prohibition: JarvisProhibitionCode; reason: string };

/**
 * Evaluate a Jarvis action against the Part 15 boundary. Every non-allow path is
 * an explicit deny carrying a prohibition code. Denial order is fail-closed:
 * unknown capability first, then identity/tenant/grant, then each MUST-NOT.
 *
 * The only action that may proceed with requiredApproval=true and no human
 * approval on record is `request_approval` itself — requesting IS the governed
 * path. Every other required-approval action is denied as approval_override
 * until a human approval exists in the context.
 */
export function evaluateJarvisAction(
  action: JarvisAction,
  context: JarvisEvaluationContext,
): JarvisEvaluation {
  if (!isJarvisCapability(action.capability)) {
    return {
      decision: "deny",
      prohibition: "unknown_capability",
      reason: `Unknown capability "${String(action.capability)}" — Part 15 fails closed`,
    };
  }
  if (action.actorRef !== JARVIS_ACTOR_REF) {
    return {
      decision: "deny",
      prohibition: "authorization_bypass",
      reason: `Action actor "${String(action.actorRef)}" is not the governed Jarvis actor ref`,
    };
  }
  if (action.tenantRef !== context.tenantRef) {
    return {
      decision: "deny",
      prohibition: "authorization_bypass",
      reason: `Action tenant "${action.tenantRef}" does not match evaluation tenant "${context.tenantRef}"`,
    };
  }
  if (!context.grantedCapabilities.includes(action.capability)) {
    return {
      decision: "deny",
      prohibition: "authorization_bypass",
      reason: `Capability "${action.capability}" is not granted by policy for this evaluation`,
    };
  }
  if (action.requestsSecretMaterial === true) {
    return {
      decision: "deny",
      prohibition: "secret_access",
      reason: "Jarvis must not reveal or access secrets (Part 15)",
    };
  }
  if (action.mutatesGovernance === true) {
    return {
      decision: "deny",
      prohibition: "governance_mutation",
      reason: "Jarvis must not mutate governance arbitrarily (Part 15)",
    };
  }
  if (action.expandsOwnAuthority === true) {
    return {
      decision: "deny",
      prohibition: "self_authority_grant",
      reason: "Jarvis must not grant itself authority (Part 15)",
    };
  }
  const approvalGateRespected =
    action.bypassesHumanApprovalGate !== true &&
    (action.requiredApproval !== true ||
      context.humanApprovalGranted === true ||
      action.capability === JarvisCapability.RequestApproval);
  if (!approvalGateRespected) {
    return {
      decision: "deny",
      prohibition: "approval_override",
      reason: "Required-approval action attempted without a human approval on record (Part 15)",
    };
  }
  if (action.executesCriticalOutsidePolicy === true) {
    return {
      decision: "deny",
      prohibition: "out_of_policy_critical_action",
      reason: "Jarvis must not execute critical actions outside policy (Part 15)",
    };
  }
  if (action.fabricatesSystemState === true) {
    return {
      decision: "deny",
      prohibition: "state_fabrication",
      reason: "Jarvis must not fabricate system state (Part 15)",
    };
  }
  if (action.claimsVerificationWithoutEvidence === true) {
    return {
      decision: "deny",
      prohibition: "unverified_claim",
      reason: "Jarvis must not claim verification without evidence (Part 15)",
    };
  }
  return {
    decision: "allow",
    capability: action.capability,
    requiredApproval: action.requiredApproval,
    reason: "Action within the Part 15 Jarvis boundary",
  };
}
