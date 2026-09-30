/**
 * CoreGrid Foundation Mission 001 — in-memory control-plane slice.
 *
 * Owners recorded in
 * architecture/COREGRID_FOUNDATION_MISSION_001_AUTHORITY_DECISION.json:
 * mission lifecycle (mechanism 06), evidence (mechanism 04),
 * execution records (mechanism 08), verification (mechanism 09),
 * conformance (mechanism 10).
 *
 * This module performs no persistence and no network I/O.
 * The durable schema is authored separately and is not applied by this module.
 * A live runtime remains unauthorized.
 */

export const STATUS_SEMANTICS = {
  COMPLETE: "An approved scope has an evidenced outcome for that scope only.",
  VERIFIED:
    "An independent verification decision, backed by evidence, concluded the required result occurred. Worker completion is not verification.",
  CONFORMANT:
    "An independent assessment concluded the observed result matches the declared contract for the assessed scope and version.",
  DEPLOYED:
    "The artifact is installed in a named environment. Installation is not health, verification, or conformance.",
  OPERATIONAL:
    "Named-environment runtime evidence shows the scoped behavior is executing, observable, and recoverable.",
} as const;

export type ClaimStatus = keyof typeof STATUS_SEMANTICS;

export const MISSION_LIFECYCLES = ["proposed", "authorized", "revoked", "closed"] as const;
export type MissionLifecycle = (typeof MISSION_LIFECYCLES)[number];

export const EXECUTION_STATUSES = ["admitted", "denied", "rolled_back"] as const;
export const EXTERNAL_EFFECTS = ["none", "recorded_intent", "compensation_required"] as const;
export const EVIDENCE_LIFECYCLES = ["active", "superseded", "revoked"] as const;
export const VERIFICATION_DECISIONS = ["verified", "failed", "inconclusive"] as const;
export const CONFORMANCE_DECISIONS = ["conformant", "nonconformant", "not_assessed"] as const;

export interface MissionIntent {
  missionId: string;
  version: string;
  tenantId: string;
  purpose: string;
  authorityRef: string;
  contextRef: string;
  ownerRef: string;
  nonScope: readonly string[];
  authorizedActions: readonly string[];
  lifecycle: MissionLifecycle;
  expiresAt: string | null;
}

export interface ActorScope {
  actorId: string;
  tenantId: string;
  revoked: boolean;
}

export interface ExecutionRequest {
  executionId: string;
  idempotencyKey: string;
  missionId: string;
  tenantId: string;
  actorId: string;
  action: string;
  realityRef: string;
  requestedAt: string;
}

export type AdmissionDenyReason =
  | "missing_authority"
  | "unauthorized"
  | "cross_tenant"
  | "expired"
  | "revoked"
  | "out_of_scope"
  | "missing_reality";

export interface ExecutionAttempt {
  attemptId: string;
  startedAt: string;
}

export interface ExecutionResult {
  status: (typeof EXECUTION_STATUSES)[number];
  reason: AdmissionDenyReason | "rollback" | null;
}

export type ExternalEffect = (typeof EXTERNAL_EFFECTS)[number];

export interface ExecutionHistoryEntry {
  at: string;
  status: ExecutionResult["status"];
  reason: ExecutionResult["reason"];
  externalEffect: ExternalEffect;
}

export interface ExecutionRecord {
  recordId: string;
  idempotencyKey: string;
  request: ExecutionRequest;
  attempt: ExecutionAttempt;
  result: ExecutionResult;
  externalEffect: ExternalEffect;
  history: ExecutionHistoryEntry[];
}

export type EvidenceLifecycle = (typeof EVIDENCE_LIFECYCLES)[number];

export interface EvidenceRecord {
  evidenceId: string;
  producer: string;
  actorId: string;
  tenantId: string;
  observedAt: string;
  recordedAt: string;
  provenance: string;
  integrity: string;
  lifecycle: EvidenceLifecycle;
  lineage: readonly string[];
}

export type VerificationDecisionName = (typeof VERIFICATION_DECISIONS)[number];

export interface VerificationResult {
  verificationId: string;
  executionId: string;
  evidenceIds: string[];
  decision: VerificationDecisionName;
  reason: string;
}

export type ConformanceDecisionName = (typeof CONFORMANCE_DECISIONS)[number];

export interface ConformanceAssessment {
  assessmentId: string;
  verificationId: string;
  declaredContractId: string;
  observedContractId: string;
  declaredVersion: string;
  observedVersion: string;
  decision: ConformanceDecisionName;
  reason: string;
}

export interface FoundationLoopResult {
  admission: ExecutionRecord;
  verification: VerificationResult | null;
  conformance: ConformanceAssessment | null;
}

function blankHistory(
  at: string,
  result: ExecutionResult,
  externalEffect: ExternalEffect,
): ExecutionHistoryEntry[] {
  return [{ at, status: result.status, reason: result.reason, externalEffect }];
}

export function admitExecution(
  mission: MissionIntent,
  actor: ActorScope,
  request: ExecutionRequest,
  now: string,
  prior: readonly ExecutionRecord[] = [],
): ExecutionRecord {
  const existing = prior.find(
    (record) =>
      record.idempotencyKey === request.idempotencyKey &&
      record.request.tenantId === request.tenantId &&
      record.request.missionId === request.missionId &&
      record.request.action === request.action,
  );
  if (existing) {
    return {
      ...existing,
      externalEffect: "none",
      history: [
        ...existing.history,
        {
          at: now,
          status: existing.result.status,
          reason: existing.result.reason,
          externalEffect: "none",
        },
      ],
    };
  }

  const denied = (reason: AdmissionDenyReason): ExecutionRecord => {
    const result: ExecutionResult = { status: "denied", reason };
    return {
      recordId: request.executionId,
      idempotencyKey: request.idempotencyKey,
      request,
      attempt: { attemptId: `${request.executionId}:1`, startedAt: now },
      result,
      externalEffect: "none",
      history: blankHistory(now, result, "none"),
    };
  };

  if (!mission.authorityRef.trim() || mission.lifecycle === "proposed") {
    return denied("missing_authority");
  }
  if (mission.lifecycle === "revoked" || actor.revoked || mission.lifecycle === "closed") {
    return denied(mission.lifecycle === "closed" ? "unauthorized" : "revoked");
  }
  if (
    request.tenantId !== mission.tenantId ||
    actor.tenantId !== mission.tenantId ||
    actor.actorId !== request.actorId
  ) {
    return denied("cross_tenant");
  }
  if (mission.expiresAt !== null && mission.expiresAt <= now) {
    return denied("expired");
  }
  if (
    !mission.authorizedActions.includes(request.action) ||
    mission.nonScope.includes(request.action)
  ) {
    return denied("out_of_scope");
  }
  if (!request.realityRef.trim()) return denied("missing_reality");

  const result: ExecutionResult = { status: "admitted", reason: null };
  return {
    recordId: request.executionId,
    idempotencyKey: request.idempotencyKey,
    request,
    attempt: { attemptId: `${request.executionId}:1`, startedAt: now },
    result,
    externalEffect: "recorded_intent",
    history: blankHistory(now, result, "recorded_intent"),
  };
}

export function rollbackExecution(record: ExecutionRecord, at: string): ExecutionRecord {
  const result: ExecutionResult = { status: "rolled_back", reason: "rollback" };
  return {
    ...record,
    result,
    externalEffect: "compensation_required",
    history: [
      ...record.history,
      { at, status: result.status, reason: result.reason, externalEffect: "compensation_required" },
    ],
  };
}

export function evidenceIsUsable(record: EvidenceRecord): boolean {
  return (
    record.lifecycle === "active" &&
    record.producer.trim().length > 0 &&
    record.actorId.trim().length > 0 &&
    record.tenantId.trim().length > 0 &&
    record.observedAt.trim().length > 0 &&
    record.recordedAt.trim().length > 0 &&
    record.provenance.trim().length > 0 &&
    record.integrity.trim().length > 0
  );
}

export function decideVerification(input: {
  verificationId: string;
  executionId: string;
  executionSucceeded: boolean;
  evidence: readonly EvidenceRecord[];
  criteriaMet: boolean;
}): VerificationResult {
  const evidenceIds = input.evidence.map((record) => record.evidenceId);
  if (input.evidence.length === 0) {
    return {
      verificationId: input.verificationId,
      executionId: input.executionId,
      evidenceIds,
      decision: "inconclusive",
      reason: "execution_success_is_not_verification",
    };
  }
  if (input.evidence.some((record) => !evidenceIsUsable(record))) {
    return {
      verificationId: input.verificationId,
      executionId: input.executionId,
      evidenceIds,
      decision: "failed",
      reason: "evidence_not_usable",
    };
  }
  if (!input.criteriaMet) {
    return {
      verificationId: input.verificationId,
      executionId: input.executionId,
      evidenceIds,
      decision: "failed",
      reason: "criteria_not_met",
    };
  }
  return {
    verificationId: input.verificationId,
    executionId: input.executionId,
    evidenceIds,
    decision: "verified",
    reason: "independent_criteria_and_evidence",
  };
}

export function assessConformance(input: {
  assessmentId: string;
  verification: VerificationResult;
  declaredContractId: string;
  observedContractId: string;
  declaredVersion: string;
  observedVersion: string;
}): ConformanceAssessment {
  const base = {
    assessmentId: input.assessmentId,
    verificationId: input.verification.verificationId,
    declaredContractId: input.declaredContractId,
    observedContractId: input.observedContractId,
    declaredVersion: input.declaredVersion,
    observedVersion: input.observedVersion,
  };
  if (input.verification.decision !== "verified") {
    return { ...base, decision: "not_assessed", reason: "verification_not_established" };
  }
  if (
    input.declaredContractId !== input.observedContractId ||
    input.declaredVersion !== input.observedVersion
  ) {
    return { ...base, decision: "nonconformant", reason: "contract_mismatch" };
  }
  return { ...base, decision: "conformant", reason: "declared_contract_matched" };
}

export function runFoundationLoop(input: {
  mission: MissionIntent;
  actor: ActorScope;
  request: ExecutionRequest;
  now: string;
  prior?: readonly ExecutionRecord[];
  evidence?: readonly EvidenceRecord[];
  criteriaMet?: boolean;
  declaredContractId?: string;
  observedContractId?: string;
  declaredVersion?: string;
  observedVersion?: string;
}): FoundationLoopResult {
  const admission = admitExecution(
    input.mission,
    input.actor,
    input.request,
    input.now,
    input.prior ?? [],
  );
  if (admission.result.status !== "admitted" || admission.externalEffect === "none") {
    return { admission, verification: null, conformance: null };
  }
  const verification = decideVerification({
    verificationId: `${admission.recordId}:verification`,
    executionId: admission.recordId,
    executionSucceeded: true,
    evidence: input.evidence ?? [],
    criteriaMet: input.criteriaMet ?? false,
  });
  const conformance = assessConformance({
    assessmentId: `${admission.recordId}:conformance`,
    verification,
    declaredContractId: input.declaredContractId ?? "",
    observedContractId: input.observedContractId ?? "",
    declaredVersion: input.declaredVersion ?? "",
    observedVersion: input.observedVersion ?? "",
  });
  return { admission, verification, conformance };
}
