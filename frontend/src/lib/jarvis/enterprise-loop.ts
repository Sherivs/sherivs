/**
 * CoreGrid — Jarvis executive enterprise loop (Executive Command).
 *
 * Jarvis commands the organization. Specialists perform the work. This cycle
 * is a LIBRARY, not a standing process: WAKE → OBSERVE → DETECT → PRIORITIZE
 * → CREATE MISSION → STAFF → DELEGATE → REPORT → SLEEP.
 *
 * It reuses:
 *   - Part 15 boundary: `evaluateJarvisAction` (jarvis-contract.ts)
 *   - no-fabrication briefing: `composeBriefing` (briefing.ts)
 *   - human-closed escalation: `escalateIncident` (escalation.ts)
 *   - V1 workforce lock + staffing (workforce/v1-workforce-lock.ts,
 *     workforce/mission-staffing.ts)
 *   - Hermes remains the operational observe/repair driver over mission
 *     executions. This loop CONSUMES stamped observations; it does not
 *     replace Hermes or become a god-agent.
 *
 * Every important claim is classified OBSERVED | INFERRED | PROPOSED |
 * EXECUTED | VERIFIED | UNKNOWN. Model output is never treated as truth.
 *
 * Night mode: MONITOR / MAINTAIN / ANALYZE / PREPARE only. High-risk
 * execution and deploy require human approval.
 *
 * Boundary: pure functions over injected observations. No I/O, no vendor,
 * no secrets, no invented metrics.
 */

import {
  composeBriefing,
  type BriefingEvent,
  type ExecutiveBriefing,
} from "./briefing";
import { escalateIncident, type EscalationRecord, type IncidentSeverity } from "./escalation";
import {
  evaluateJarvisAction,
  JarvisCapability,
  JARVIS_ACTOR_REF,
  type JarvisAction,
  type JarvisEvaluation,
  type JarvisEvaluationContext,
} from "./jarvis-contract";
import {
  staffMission,
  type MissionStaffingPlan,
  type MissionStaffingProfile,
  type StaffingResult,
} from "../workforce/mission-staffing";

export const JARVIS_CLAIM_CLASSES = [
  "OBSERVED",
  "INFERRED",
  "PROPOSED",
  "EXECUTED",
  "VERIFIED",
  "UNKNOWN",
] as const;

export type JarvisClaimClass = (typeof JARVIS_CLAIM_CLASSES)[number];

export const JARVIS_LOOP_PHASES = [
  "WAKE",
  "OBSERVE",
  "UNDERSTAND",
  "DETECT",
  "PRIORITIZE",
  "CREATE_MISSION",
  "STAFF",
  "DELEGATE",
  "REPORT",
  "SLEEP",
] as const;

export type JarvisLoopPhase = (typeof JARVIS_LOOP_PHASES)[number];

export const DETECTABLE_CONDITIONS = [
  "database_degradation",
  "api_failure",
  "provider_outage",
  "queue_backlog",
  "redis_failure",
  "email_failure",
  "ai_provider_rate_limit",
  "deployment_failure",
  "test_regression",
  "security_vulnerability",
  "cost_anomaly",
  "traffic_spike",
  "storage_growth",
  "failed_webhook",
  "authentication_anomaly",
  "worker_failure",
  "mission_timeout",
] as const;

export type DetectableCondition = (typeof DETECTABLE_CONDITIONS)[number];

const DETECTABLE_SET: ReadonlySet<string> = new Set(DETECTABLE_CONDITIONS);

const CONDITION_PROFILE: Readonly<Record<DetectableCondition, MissionStaffingProfile>> = {
  database_degradation: "database_migration",
  api_failure: "simple_defect",
  provider_outage: "simple_defect",
  queue_backlog: "simple_defect",
  redis_failure: "simple_defect",
  email_failure: "simple_defect",
  ai_provider_rate_limit: "simple_defect",
  deployment_failure: "infrastructure_migration",
  test_regression: "simple_defect",
  security_vulnerability: "database_migration",
  cost_anomaly: "simple_defect",
  traffic_spike: "simple_defect",
  storage_growth: "simple_defect",
  failed_webhook: "simple_defect",
  authentication_anomaly: "database_migration",
  worker_failure: "simple_defect",
  mission_timeout: "simple_defect",
};

const HIGH_RISK_CONDITIONS: ReadonlySet<DetectableCondition> = new Set([
  "deployment_failure",
  "security_vulnerability",
  "authentication_anomaly",
  "database_degradation",
]);

export interface JarvisObservation {
  readonly observationId: string;
  readonly tenantRef: string;
  readonly at: string;
  readonly kind: string;
  readonly severity: IncidentSeverity;
  readonly summary: string;
  readonly evidenceRef: string;
  readonly claimClass: JarvisClaimClass;
}

export interface JarvisEnterpriseLoopInput {
  readonly tenantRef: string;
  readonly now: string;
  readonly observations: readonly JarvisObservation[];
  readonly grantedCapabilities: readonly string[];
  readonly humanApprovalGranted?: boolean;
  readonly nightMode?: boolean;
  readonly mode?: "day" | "night";
}

export interface JarvisLoopPhaseTrace {
  readonly phase: JarvisLoopPhase;
  readonly ok: boolean;
  readonly detail: string;
}

export interface JarvisStampedClaim {
  readonly claimClass: JarvisClaimClass;
  readonly text: string;
  readonly evidenceRef: string | null;
}

export interface JarvisDetection {
  readonly condition: DetectableCondition;
  readonly observationId: string;
  readonly severity: IncidentSeverity;
  readonly summary: string;
  readonly claim: JarvisStampedClaim;
}

export interface JarvisMissionProposal {
  readonly missionRef: string;
  readonly condition: DetectableCondition;
  readonly profile: MissionStaffingProfile;
  readonly evaluation: JarvisEvaluation;
  readonly requiresHumanApproval: boolean;
}

export interface JarvisDelegationDirective {
  readonly workerRefs: readonly string[];
  readonly directive: string;
  readonly evaluation: JarvisEvaluation;
}

export interface JarvisEnterpriseLoopResult {
  readonly tenantRef: string;
  readonly nightMode: boolean;
  readonly phases: readonly JarvisLoopPhaseTrace[];
  readonly detections: readonly JarvisDetection[];
  readonly missionProposals: readonly JarvisMissionProposal[];
  readonly staffingPlans: readonly MissionStaffingPlan[];
  readonly staffingFailures: readonly { missionRef: string; errors: readonly string[] }[];
  readonly delegations: readonly JarvisDelegationDirective[];
  readonly escalations: readonly EscalationRecord[];
  readonly briefing: ExecutiveBriefing | null;
  readonly claims: readonly JarvisStampedClaim[];
  readonly sleep: { readonly reason: string };
}

function isParseableInstant(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function jarvisContext(input: JarvisEnterpriseLoopInput): JarvisEvaluationContext {
  return {
    tenantRef: input.tenantRef,
    grantedCapabilities: input.grantedCapabilities,
    humanApprovalGranted: input.humanApprovalGranted === true,
  };
}

function observeAction(tenantRef: string, justification: string): JarvisAction {
  return {
    capability: JarvisCapability.ObservePlatformState,
    tenantRef,
    actorRef: JARVIS_ACTOR_REF,
    justification,
    requiredApproval: false,
    payload: { scope: "platform" },
  };
}

function initiateAction(tenantRef: string, missionRef: string, summary: string, requiredApproval: boolean): JarvisAction {
  return {
    capability: JarvisCapability.InitiateGovernedMission,
    tenantRef,
    actorRef: JARVIS_ACTOR_REF,
    justification: summary,
    requiredApproval,
    payload: { missionRef, blueprintSummary: summary },
  };
}

function coordinateAction(tenantRef: string, workerRefs: readonly string[], directive: string): JarvisAction {
  return {
    capability: JarvisCapability.CoordinateWorkers,
    tenantRef,
    actorRef: JARVIS_ACTOR_REF,
    justification: directive,
    requiredApproval: false,
    payload: { workerRefs, directive },
  };
}

function requestApprovalAction(tenantRef: string, proposalSummary: string): JarvisAction {
  return {
    capability: JarvisCapability.RequestApproval,
    tenantRef,
    actorRef: JARVIS_ACTOR_REF,
    justification: proposalSummary,
    requiredApproval: false,
    payload: { proposalSummary },
  };
}

function classifyObservation(observation: JarvisObservation): JarvisClaimClass {
  if (observation.claimClass === "VERIFIED" || observation.claimClass === "EXECUTED") {
    return observation.claimClass;
  }
  if (observation.evidenceRef.trim().length === 0) return "UNKNOWN";
  if (observation.claimClass === "OBSERVED" || observation.claimClass === "INFERRED") {
    return observation.claimClass;
  }
  return "UNKNOWN";
}

function nightModeOf(input: JarvisEnterpriseLoopInput): boolean {
  return input.nightMode === true || input.mode === "night";
}

/**
 * Run one Jarvis enterprise cycle over already-stamped observations.
 * Invented observations are impossible: the cycle never synthesizes kinds,
 * metrics, or users. Unknown kinds stay UNKNOWN and do not spawn missions.
 */
export function runJarvisEnterpriseCycle(input: JarvisEnterpriseLoopInput): JarvisEnterpriseLoopResult {
  const phases: JarvisLoopPhaseTrace[] = [];
  const claims: JarvisStampedClaim[] = [];
  const detections: JarvisDetection[] = [];
  const missionProposals: JarvisMissionProposal[] = [];
  const staffingPlans: MissionStaffingPlan[] = [];
  const staffingFailures: { missionRef: string; errors: readonly string[] }[] = [];
  const delegations: JarvisDelegationDirective[] = [];
  const escalations: EscalationRecord[] = [];
  const nightMode = nightModeOf(input);
  const context = jarvisContext(input);

  phases.push({ phase: "WAKE", ok: true, detail: "ephemeral executive cycle; no standing Jarvis process" });

  if (!input.tenantRef?.trim() || !isParseableInstant(input.now)) {
    phases.push({ phase: "SLEEP", ok: false, detail: "tenantRef and a parseable now instant are required" });
    return {
      tenantRef: input.tenantRef,
      nightMode,
      phases,
      detections,
      missionProposals,
      staffingPlans,
      staffingFailures,
      delegations,
      escalations,
      briefing: null,
      claims,
      sleep: { reason: "cycle refused: invalid identity of time or tenant" },
    };
  }

  const observeEval = evaluateJarvisAction(
    observeAction(input.tenantRef, "observe platform state for this cycle"),
    context,
  );
  const observeOk = observeEval.decision === "allow";
  phases.push({
    phase: "OBSERVE",
    ok: observeOk,
    detail: observeOk ? `consumed ${input.observations.length} stamped observations` : observeEval.reason,
  });
  if (!observeOk) {
    phases.push({ phase: "SLEEP", ok: true, detail: "observation denied; nothing fabricated" });
    return {
      tenantRef: input.tenantRef,
      nightMode,
      phases,
      detections,
      missionProposals,
      staffingPlans,
      staffingFailures,
      delegations,
      escalations,
      briefing: null,
      claims: [
        {
          claimClass: "UNKNOWN",
          text: observeEval.reason,
          evidenceRef: null,
        },
      ],
      sleep: { reason: "observation capability denied; cycle ends" },
    };
  }

  for (const observation of input.observations) {
    if (observation.tenantRef !== input.tenantRef) {
      claims.push({
        claimClass: "UNKNOWN",
        text: `crossed tenant boundary on observation ${observation.observationId}`,
        evidenceRef: observation.evidenceRef,
      });
      continue;
    }
    const claimClass = classifyObservation(observation);
    claims.push({
      claimClass,
      text: observation.summary,
      evidenceRef: observation.evidenceRef,
    });
  }
  phases.push({
    phase: "UNDERSTAND",
    ok: true,
    detail: `classified ${claims.length} claims; model output is not truth`,
  });

  for (const observation of input.observations) {
    if (observation.tenantRef !== input.tenantRef) continue;
    if (!DETECTABLE_SET.has(observation.kind)) continue;
    if (classifyObservation(observation) === "UNKNOWN") continue;
    const condition = observation.kind as DetectableCondition;
    detections.push({
      condition,
      observationId: observation.observationId,
      severity: observation.severity,
      summary: observation.summary,
      claim: {
        claimClass: classifyObservation(observation),
        text: observation.summary,
        evidenceRef: observation.evidenceRef,
      },
    });
  }
  phases.push({
    phase: "DETECT",
    ok: true,
    detail:
      detections.length === 0
        ? "no detectable conditions in stamped observations"
        : `detected ${detections.length} conditions from evidence`,
  });

  const prioritized = [...detections].sort((a, b) => {
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    const delta = rank[a.severity] - rank[b.severity];
    if (delta !== 0) return delta;
    return a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0;
  });
  phases.push({
    phase: "PRIORITIZE",
    ok: true,
    detail: `deterministic severity then observation id (${prioritized.length} items)`,
  });

  for (const detection of prioritized) {
    const profile = CONDITION_PROFILE[detection.condition];
    const highRisk = HIGH_RISK_CONDITIONS.has(detection.condition) || detection.severity === "critical";
    const missionRef = `jarvis:${detection.condition}:${detection.observationId}`;
    const requiresHumanApproval = nightMode && highRisk;
    const action: JarvisAction = requiresHumanApproval
      ? requestApprovalAction(input.tenantRef, detection.summary)
      : initiateAction(input.tenantRef, missionRef, detection.summary, highRisk);
    const evaluation = evaluateJarvisAction(action, context);
    missionProposals.push({
      missionRef,
      condition: detection.condition,
      profile,
      evaluation,
      requiresHumanApproval,
    });
    if (evaluation.decision === "deny" || requiresHumanApproval) {
      const incident = escalateIncident({
        incidentRef: missionRef,
        tenantRef: input.tenantRef,
        severity: detection.severity === "info" && highRisk ? "warning" : detection.severity,
        summary: detection.summary,
        evidenceRefs: [detection.claim.evidenceRef ?? detection.observationId],
        at: input.now,
      });
      if (incident.decision === "escalate") escalations.push(incident.record);
    }
  }
  phases.push({
    phase: "CREATE_MISSION",
    ok: true,
    detail: `${missionProposals.filter((proposal) => proposal.evaluation.decision === "allow" && !proposal.requiresHumanApproval).length} missions proposed; high-risk night work escalated`,
  });

  for (const proposal of missionProposals) {
    if (proposal.evaluation.decision !== "allow" || proposal.requiresHumanApproval) continue;
    const staffed: StaffingResult = staffMission({
      tenantId: input.tenantRef,
      missionRef: proposal.missionRef,
      profile: proposal.profile,
    });
    if (!staffed.ok) {
      staffingFailures.push({ missionRef: proposal.missionRef, errors: staffed.errors });
      continue;
    }
    staffingPlans.push(staffed.plan);
  }
  phases.push({
    phase: "STAFF",
    ok: staffingFailures.length === 0,
    detail: `${staffingPlans.length} teams planned; workers wake on mission and sleep when complete`,
  });

  for (const plan of staffingPlans) {
    const workerRefs = plan.slots
      .filter((slot) => slot.slotKind !== "coordinate")
      .map((slot) => slot.roleId);
    const directive = `staff ${plan.missionRef} then sleep; Jarvis does not perform the work`;
    const evaluation = evaluateJarvisAction(coordinateAction(input.tenantRef, workerRefs, directive), context);
    delegations.push({ workerRefs, directive, evaluation });
  }
  phases.push({
    phase: "DELEGATE",
    ok: delegations.every((item) => item.evaluation.decision === "allow") || delegations.length === 0,
    detail: "coordinate_workers only — no execution by Jarvis",
  });

  const briefingEvents: BriefingEvent[] = input.observations
    .filter((observation) => observation.tenantRef === input.tenantRef && observation.summary.trim().length > 0)
    .map((observation) => ({
      kind: observation.kind,
      tenantRef: observation.tenantRef,
      at: observation.at,
      severity: observation.severity,
      summary: observation.summary,
    }));
  const briefingResult = briefingEvents.length === 0 ? null : composeBriefing(briefingEvents);
  const briefing = briefingResult && briefingResult.ok ? briefingResult.briefing : null;
  phases.push({
    phase: "REPORT",
    ok: briefingResult === null || briefingResult.ok,
    detail: briefing ? `briefing restates ${briefing.lines.length} observed events` : "no events to brief; nothing invented",
  });

  phases.push({
    phase: "SLEEP",
    ok: true,
    detail: "executive cycle ended; no resident Jarvis compute",
  });

  return {
    tenantRef: input.tenantRef,
    nightMode,
    phases,
    detections: prioritized,
    missionProposals,
    staffingPlans,
    staffingFailures,
    delegations,
    escalations,
    briefing,
    claims,
    sleep: { reason: "cycle complete; specialists wake only if a mission was staffed" },
  };
}

/** Morning report is the briefing plus blocked items — still restated evidence only. */
export function morningExecutiveReport(result: JarvisEnterpriseLoopResult): {
  readonly header: string;
  readonly happened: readonly string[];
  readonly blocked: readonly string[];
  readonly requiresHuman: readonly string[];
} {
  const happened = result.briefing?.lines.map((line) => line.summary) ?? [];
  const blocked = result.staffingFailures.flatMap((failure) => failure.errors);
  const requiresHuman = result.escalations.map((record) => record.summary);
  return {
    header: "Morning executive report (observed evidence only)",
    happened,
    blocked,
    requiresHuman,
  };
}
