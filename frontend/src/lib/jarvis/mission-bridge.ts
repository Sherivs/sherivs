/**
 * CoreGrid — Jarvis mission bridge (V1, directive §34 + DECISIONS #208).
 *
 * The deterministic hand-off between executive PLANNING and the ONE
 * canonical mission substrate (`mission/mission-contract.ts`). The
 * executive loop emits PROPOSALS (data, never executions); this module
 * converts a staffable proposal into a draft MissionContractCore that
 * satisfies every contract law and admission gate — fail closed:
 *
 *  - a proposal that is not in "proposed" status, has no staffed executor,
 *    or carries no acceptance criteria is REJECTED with a reason;
 *  - every draft passes `validateMissionCore` AND
 *    `evaluateMissionAdmissionGates` before it may leave this module —
 *    a draft that cannot satisfy the mission contract is rejected, never
 *    repaired (Constitution §26/§65);
 *  - drafts carry PLANNING-BOUNDED authorized actions only ("observe",
 *    "analyze", "propose"): the authorization surface of a mission is
 *    expanded exclusively at the mission-admission write path, never by
 *    the bridge (authority expansion is not an agent act, §7/§19);
 *  - kernel-envelope stamping (V1CAP-002) remains the write path's
 *    obligation — the bridge mints core drafts only.
 *
 * Boundary: pure functions. No persistence, no I/O, no model calls. The
 * bridge never sets a lifecycle beyond "DEFINED" and never executes.
 */

import {
  evaluateMissionAdmissionGates,
  validateMissionCore,
  type MissionAdmissionGate,
  type MissionContractCore,
  type MissionTask,
} from "../mission/mission-contract";
import type { ExecutiveMissionProposal } from "./executive-loop";

/* ─────────────────────────────────────────────────────────────
 * Bridge vocabulary
 * ────────────────────────────────────────────────────────────*/

/**
 * The PLANNING-BOUNDED action set a Jarvis-drafted mission may declare.
 * Broader authorization (execute/deploy and their specifics) is granted
 * only at the mission-admission write path by the authorization model —
 * the bridge cannot expand it and never tries.
 */
export const MISSION_BRIDGE_AUTHORIZED_ACTIONS = ["observe", "analyze", "propose"] as const;

/** Evidence kinds a Jarvis-drafted mission must satisfy before success. */
export const MISSION_BRIDGE_EVIDENCE_KINDS = ["verification_verdict", "evidence_artifact"] as const;

export interface MissionBridgeDraft {
  readonly sourceProposalRef: string;
  readonly requiresApproval: boolean;
  readonly staffing: ExecutiveMissionProposal["staffing"];
  /** Validated against the mission contract; envelope stamping is the write path's job. */
  readonly mission: MissionContractCore;
}

export interface MissionBridgeRejection {
  readonly sourceProposalRef: string;
  readonly reason: string;
}

export interface MissionBridgeResult {
  readonly draftedAt: string;
  readonly drafts: readonly MissionBridgeDraft[];
  readonly rejected: readonly MissionBridgeRejection[];
}

export interface MissionBridgeInput {
  readonly now: string;
  readonly proposals: readonly ExecutiveMissionProposal[];
  /** Accountable owner recorded on every draft (default: the fixed jarvis ref). */
  readonly ownerRef?: string;
}

/* ─────────────────────────────────────────────────────────────
 * Fail-closed helpers
 * ────────────────────────────────────────────────────────────*/

function isParseableInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function isNonEmptyTrimmed(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= maxLength;
}

function draftTask(missionId: string, objective: string): MissionTask {
  return {
    taskId: `${missionId}-task-1`,
    title: objective.slice(0, 200),
    authorizedActions: [...MISSION_BRIDGE_AUTHORIZED_ACTIONS],
    requiredEvidenceKinds: [...MISSION_BRIDGE_EVIDENCE_KINDS],
  };
}

function draftAdmissionGates(missionId: string, requiresApproval: boolean): MissionAdmissionGate[] {
  const gates: MissionAdmissionGate[] = [
    { gateId: `${missionId}-gate-definition`, kind: "definition", reason: "objective and decomposition are declared" },
    { gateId: `${missionId}-gate-security`, kind: "security", reason: "authorized actions stay inside the planning-bounded set" },
    { gateId: `${missionId}-gate-verification`, kind: "verification", reason: "independent verification evidence is required before success" },
    { gateId: `${missionId}-gate-closure`, kind: "closure", reason: "acceptance criteria are declared" },
  ];
  if (requiresApproval) {
    gates.push({
      gateId: `${missionId}-gate-approval`,
      kind: "security",
      reason: "high-risk Jarvis-drafted mission: human approval is required before this mission may reach READY (directive §19/§43)",
    });
  }
  return gates;
}

/* ─────────────────────────────────────────────────────────────
 * The bridge
 * ────────────────────────────────────────────────────────────*/

/**
 * Convert staffable executive proposals into validated mission drafts.
 * Every draft passes the mission-contract laws and its own admission
 * gates; anything else is rejected with a reason. Jarvis plans missions;
 * the organization executes them.
 */
export function draftMissionsFromProposals(input: MissionBridgeInput): MissionBridgeResult {
  if (!isParseableInstant(input.now)) {
    throw new Error("mission bridge: now must be a parseable instant (clock discipline)");
  }
  const ownerRef = input.ownerRef?.trim() || "jarvis";
  if (!isNonEmptyTrimmed(ownerRef, 128)) {
    throw new Error("mission bridge: ownerRef must be a non-empty string when provided");
  }
  const draftedAtMs = new Date(input.now).getTime();
  const draftedAt = new Date(draftedAtMs).toISOString();

  const drafts: MissionBridgeDraft[] = [];
  const rejected: MissionBridgeRejection[] = [];

  for (const proposal of input.proposals) {
    const reject = (reason: string): void => {
      rejected.push({ sourceProposalRef: proposal.missionRef, reason });
    };

    if (proposal.status !== "proposed") {
      reject(`proposal status is "${proposal.status}" — only "proposed" proposals may be drafted`);
      continue;
    }
    if (!isNonEmptyTrimmed(proposal.missionRef, 200)) {
      reject("proposal missionRef missing");
      continue;
    }
    if (!isNonEmptyTrimmed(proposal.tenantRef, 128)) {
      reject("proposal tenantRef missing (multi-tenancy law)");
      continue;
    }
    if (!isNonEmptyTrimmed(proposal.objective, 400)) {
      reject("proposal objective missing");
      continue;
    }
    if (!isParseableInstant(proposal.detectedAt)) {
      reject("proposal detectedAt is not a parseable instant");
      continue;
    }
    if (proposal.staffing.executorRoleIds.length === 0) {
      reject("proposal has no staffed executor role — unstaffable proposals escalate, they are never drafted");
      continue;
    }
    if (proposal.acceptanceCriteria.length === 0) {
      reject("proposal carries no acceptance criteria — a mission without success criteria is not a mission");
      continue;
    }

    const missionId = proposal.missionRef;
    const core: MissionContractCore = {
      missionId,
      schemaVersion: "1.0",
      tenantId: proposal.tenantRef.trim(),
      objective: proposal.objective.trim(),
      nonScope: ["execute", "deploy", "approve"],
      ownerRef,
      actorRefs: [...new Set(proposal.staffing.executorRoleIds)].sort(),
      authorizedActions: [...MISSION_BRIDGE_AUTHORIZED_ACTIONS],
      tasks: [draftTask(missionId, proposal.objective)],
      admissionGates: draftAdmissionGates(missionId, proposal.requiresApproval),
      successCriteria: [...proposal.acceptanceCriteria],
      requiredEvidenceKinds: [...MISSION_BRIDGE_EVIDENCE_KINDS],
      lifecycle: "DEFINED",
      expiresAt: null,
      provenance: {
        declaredBy: "jarvis",
        declaredAt: draftedAt,
        authorityRef: `executive-loop proposal ${missionId} (DECISIONS.md #206/#208 directive authorization)`,
        contextRef: `observations: ${proposal.basisObservationIds.join(", ")}`.slice(0, 500),
        sourceRef: proposal.reason.slice(0, 500),
        generatedByAi: true,
        verified: false,
      },
    };

    // Fail-closed contract law check: a draft that violates the mission
    // contract is rejected with its first violated law — never repaired.
    const coreError = validateMissionCore(core);
    if (coreError !== null) {
      reject(`draft failed mission-contract validation: ${coreError}`);
      continue;
    }
    const gates = evaluateMissionAdmissionGates(core);
    if (!gates.ok) {
      const named = gates.failedGates.map((gate) => `${gate.gateId}(${gate.kind})`).join(", ");
      reject(`draft failed its own admission gates: ${named}`);
      continue;
    }

    drafts.push({
      sourceProposalRef: proposal.missionRef,
      requiresApproval: proposal.requiresApproval,
      staffing: proposal.staffing,
      mission: core,
    });
  }

  return { draftedAt, drafts, rejected };
}