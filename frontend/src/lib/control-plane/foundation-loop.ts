/**
 * Pure plan for the foundation server path.
 *
 * Reality reference, tenant, and verification criteria come from the server.
 * A caller cannot supply the tenant or the verification decision.
 * This module does not write to a database.
 */
import { createHash } from "node:crypto";
import {
  admitExecution,
  decideVerification,
  type EvidenceRecord,
  type ExecutionRecord,
  type MissionIntent,
  type VerificationResult,
} from "./foundation-mission";
import {
  checkVerificationIndependence,
  type IdentityEquivalenceRegistry,
  type IndependenceCheckResult,
  type WorkCriticality,
} from "../verification";

export interface FoundationRealityRef {
  id: string;
  tenantId: string | null;
}

export interface FoundationLoopRequest {
  executionId: string;
  idempotencyKey: string;
  missionId: string;
  version: string;
  purpose: string;
  authorityRef: string;
  contextRef: string;
  ownerRef: string;
  action: string;
  requestedAt: string;
}

export interface FoundationMissionRow {
  mission_id: string;
  version: string;
  tenant_id: string;
  purpose: string;
  authority_ref: string;
  context_ref: string;
  owner_ref: string;
  non_scope: string[];
  authorized_actions: string[];
  lifecycle: MissionIntent["lifecycle"];
  expires_at: string | null;
}

export interface FoundationExecutionRow {
  id: string;
  idempotency_key: string;
  mission_id: string;
  mission_version: string;
  tenant_id: string;
  actor_id: string;
  action: string;
  reality_ref: string;
  requested_at: string;
  attempt_id: string;
  started_at: string;
  status: ExecutionRecord["result"]["status"];
  reason: string | null;
  external_effect: ExecutionRecord["externalEffect"];
}

export interface FoundationHistoryRow {
  execution_id: string;
  recorded_at: string;
  status: ExecutionRecord["result"]["status"];
  reason: string | null;
  external_effect: ExecutionRecord["externalEffect"];
}

export interface FoundationEvidenceRow {
  evidence_id: string;
  producer: string;
  actor_id: string;
  tenant_id: string;
  observed_at: string;
  recorded_at: string;
  provenance: string;
  integrity: string;
  lifecycle: EvidenceRecord["lifecycle"];
  lineage: string[];
}

export interface FoundationVerificationRow {
  verification_id: string;
  execution_id: string;
  evidence_ids: string[];
  decision: VerificationResult["decision"];
  reason: string;
}

/**
 * Additive loop-stage verification governance (J-038 / V1CAP-060 /
 * MISSION-R-92): when the verification stage declares a verifier, the loop
 * consumes the independence check. A stage whose verification fails
 * independence BLOCKS stage closure — the loop cannot proceed on self-verified
 * or equivalent-identity-verified work, and critical work can never close on
 * an AI verifier (E-027 structural law).
 */
export interface LoopVerificationGovernance {
  /** The verifier identity for this loop stage's verification act. */
  readonly verifierIdentityRef: string;
  /** Criticality of the work being verified (critical work requires a human verifier). */
  readonly workCriticality: WorkCriticality;
  /** Declarative identity → effective-identity equivalence-class registry. */
  readonly identityRegistry: IdentityEquivalenceRegistry;
}

export interface FoundationLoopPlan {
  admission: ExecutionRecord;
  mission: FoundationMissionRow;
  execution: FoundationExecutionRow;
  history: FoundationHistoryRow;
  evidence: FoundationEvidenceRow | null;
  verification: FoundationVerificationRow | null;
  /**
   * Independence check for the loop's verification stage, when the stage
   * declared a verifier (additive — null otherwise).
   */
  verificationIndependence: IndependenceCheckResult | null;
}

const AUTHORIZED_ACTION = "record-observation";

function integrityBinding(tenantId: string, realityId: string, observedAt: string): string {
  return createHash("sha256").update(`${tenantId}|${realityId}|${observedAt}`).digest("hex");
}

export function planFoundationLoop(input: {
  tenantId: string;
  actorId: string;
  now: string;
  reality: FoundationRealityRef | null;
  requestedRealityRef: string;
  request: FoundationLoopRequest;
  verificationGovernance?: LoopVerificationGovernance;
}): FoundationLoopPlan {
  const realityInTenant = input.reality !== null && input.reality.tenantId === input.tenantId;
  const crossTenantReality = input.reality !== null && input.reality.tenantId !== input.tenantId;
  const mission: MissionIntent = {
    missionId: input.request.missionId,
    version: input.request.version,
    tenantId: input.tenantId,
    purpose: input.request.purpose,
    authorityRef: input.request.authorityRef,
    contextRef: input.request.contextRef,
    ownerRef: input.request.ownerRef,
    nonScope: ["deploy"],
    authorizedActions: [AUTHORIZED_ACTION],
    lifecycle: "authorized",
    expiresAt: null,
  };
  const admission = admitExecution(
    mission,
    { actorId: input.actorId, tenantId: input.tenantId, revoked: false },
    {
      executionId: input.request.executionId,
      idempotencyKey: input.request.idempotencyKey,
      missionId: input.request.missionId,
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: input.request.action,
      realityRef: realityInTenant && !crossTenantReality ? input.reality!.id : "",
      requestedAt: input.request.requestedAt,
    },
    input.now,
  );
  if (crossTenantReality) {
    admission.result = { status: "denied", reason: "cross_tenant" };
    admission.externalEffect = "none";
    admission.history = [
      {
        at: input.now,
        status: "denied",
        reason: "cross_tenant",
        externalEffect: "none",
      },
    ];
  }

  const missionRow: FoundationMissionRow = {
    mission_id: mission.missionId,
    version: mission.version,
    tenant_id: input.tenantId,
    purpose: mission.purpose,
    authority_ref: mission.authorityRef,
    context_ref: mission.contextRef,
    owner_ref: mission.ownerRef,
    non_scope: [...mission.nonScope],
    authorized_actions: [...mission.authorizedActions],
    lifecycle: mission.lifecycle,
    expires_at: mission.expiresAt,
  };
  const execution: FoundationExecutionRow = {
    id: admission.recordId,
    idempotency_key: admission.idempotencyKey,
    mission_id: input.request.missionId,
    mission_version: input.request.version,
    tenant_id: input.tenantId,
    actor_id: input.actorId,
    action: input.request.action,
    reality_ref: input.requestedRealityRef,
    requested_at: input.request.requestedAt,
    attempt_id: admission.attempt.attemptId,
    started_at: admission.attempt.startedAt,
    status: admission.result.status,
    reason: admission.result.reason,
    external_effect: admission.externalEffect,
  };
  const history: FoundationHistoryRow = {
    execution_id: admission.recordId,
    recorded_at: input.now,
    status: admission.result.status,
    reason: admission.result.reason,
    external_effect: admission.externalEffect,
  };

  if (admission.result.status !== "admitted" || !realityInTenant || !input.reality) {
    return {
      admission,
      mission: missionRow,
      execution,
      history,
      evidence: null,
      verification: null,
      verificationIndependence: null,
    };
  }

  const evidenceRecord: EvidenceRecord = {
    evidenceId: `${admission.recordId}:evidence`,
    producer: "foundation-loop",
    actorId: input.actorId,
    tenantId: input.tenantId,
    observedAt: input.now,
    recordedAt: input.now,
    provenance: `cg_entity:${input.reality.id}`,
    integrity: integrityBinding(input.tenantId, input.reality.id, input.now),
    lifecycle: "active",
    lineage: [input.reality.id],
  };
  const verification = decideVerification({
    verificationId: `${admission.recordId}:verification`,
    executionId: admission.recordId,
    executionSucceeded: true,
    evidence: [evidenceRecord],
    criteriaMet: input.reality.tenantId === input.tenantId,
  });

  // Loop verification stage consumes the independence check (J-038 /
  // V1CAP-060): the executor of the verified work is the loop actor. A
  // verifier that fails independence BLOCKS stage closure — the verification
  // decision is forced to "failed" with the independence reason, so the loop
  // cannot proceed on self-verified critical work (E-027 structural law).
  const governance = input.verificationGovernance ?? null;
  let verificationIndependence: IndependenceCheckResult | null = null;
  let effectiveDecision = verification.decision;
  let effectiveReason = verification.reason;
  if (governance !== null) {
    verificationIndependence = checkVerificationIndependence({
      verifierIdentityRef: governance.verifierIdentityRef,
      executorIdentityRef: input.actorId,
      workCriticality: governance.workCriticality,
      identityRegistry: governance.identityRegistry,
    });
    if (!verificationIndependence.independent) {
      effectiveDecision = "failed";
      effectiveReason = "verification_independence_failed";
    }
  }

  return {
    admission,
    mission: missionRow,
    execution,
    history,
    evidence: {
      evidence_id: evidenceRecord.evidenceId,
      producer: evidenceRecord.producer,
      actor_id: evidenceRecord.actorId,
      tenant_id: evidenceRecord.tenantId,
      observed_at: evidenceRecord.observedAt,
      recorded_at: evidenceRecord.recordedAt,
      provenance: evidenceRecord.provenance,
      integrity: evidenceRecord.integrity,
      lifecycle: evidenceRecord.lifecycle,
      lineage: [...evidenceRecord.lineage],
    },
    verification: {
      verification_id: verification.verificationId,
      execution_id: verification.executionId,
      evidence_ids: verification.evidenceIds,
      decision: effectiveDecision,
      reason: effectiveReason,
    },
    verificationIndependence,
  };
}
