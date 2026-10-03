/**
 * CoreGrid — general mission execution path, pure contract (MISSION V1-004).
 *
 * Generalizes the ONE DB-persisted executable mission pattern — the
 * foundation loop (`control-plane/foundation-loop.ts` +
 * `foundation-loop.functions.ts`) — from its single hard-coded intent
 * (`record-observation` on `cg_entity`) into the general execution path:
 *
 *   intent → assignment → lease → execute → evidence → verify
 *
 * persisted in the EXISTING `cg_*` mission tables
 * (20260929000000_coregrid_foundation_mission_001.sql). No new vocabulary is
 * invented: lifecycle vocabulary reuses the canonical 15-state machine
 * (`mission/mission-contract.ts`, RULING-5), execution admission reuses
 * `admitExecution` (`control-plane/foundation-mission.ts`), evidence reuses
 * `EvidenceRecord`/`evidenceIsUsable`, verification reuses
 * `decideVerification`, and verifier independence reuses
 * `checkVerificationIndependence` (`verification.ts`).
 *
 * Execution-path stages (fine-grained, below the mission lifecycle):
 *
 *   assigned → leased → evidenced → verified
 *        \        |
 *         \       +-- lease expiry → requeued (attempt+1) → leased …
 *          +-- admission denial → denied (terminal)
 *     failure → requeued (bounded backoff) | exhausted (terminal)
 *
 * `EXECUTION_STAGE_TO_MISSION_LIFECYCLE` keeps the composition with the
 * canonical machine typed (phase 17 owns it; this path never forks it).
 *
 * Reuse laws honored here:
 *  - Idempotency keys per AGENTS §10: a duplicate assignment replays the
 *    recorded outcome with no new external effect (exactly-once).
 *  - Provenance per AGENTS §12: every evidence record carries who/when/source
 *    and an integrity binding.
 *  - Verification separation: a worker's completion ("done") NEVER flips an
 *    execution to a verified state — only an INDEPENDENT verification act
 *    does, and an independence-failed verifier is recorded as a failed
 *    verification (E-027).
 *  - Time enters only as caller-supplied parseable instants (J-023); this
 *    module performs no I/O and no persistence.
 *
 * Seams for V1-003 (agent execution runtime): `MissionLeasePort` (worker-lease
 * acquisition, heartbeat, completion) and `runLeasedMissionExecution` (the
 * driver that pairs a lease with an executor callback). The runtime supplies
 * `execute`; the mission path owns everything else.
 */

import { z } from "zod";
import { createHash } from "node:crypto";
import { isContractTimestamp, type MissionLifecycleState } from "../mission/mission-contract";
import {
  admitExecution,
  decideVerification,
  evidenceIsUsable,
  type EvidenceRecord,
  type MissionIntent,
} from "../control-plane/foundation-mission";
import {
  checkVerificationIndependence,
  type IdentityEquivalenceRegistry,
  type WorkCriticality,
} from "../verification";
import {
  authorizeMissionOperation,
  missionActorContextSchema,
  type MissionActorContext,
} from "./mission-authorization";

/* ─────────────────────────────────────────────────────────────
 * Execution-path stage machine (composes with, never forks, RULING-5)
 * ────────────────────────────────────────────────────────────*/

export const EXECUTION_PATH_STAGES = [
  "assigned",
  "leased",
  "evidenced",
  "verified",
  "requeued",
  "exhausted",
  "denied",
] as const;

export type ExecutionPathStage = (typeof EXECUTION_PATH_STAGES)[number];

/** Terminal stages: no further transition exists. */
export const TERMINAL_STAGES: ReadonlySet<ExecutionPathStage> = new Set([
  "verified",
  "exhausted",
  "denied",
]);

const EXECUTION_TRANSITIONS: Readonly<Record<ExecutionPathStage, readonly ExecutionPathStage[]>> = {
  assigned: ["leased", "denied"],
  leased: ["evidenced", "requeued"],
  evidenced: ["verified"],
  verified: [],
  requeued: ["leased"],
  exhausted: [],
  denied: [],
};

export function isExecutionStageTransitionAllowed(
  from: ExecutionPathStage,
  to: ExecutionPathStage,
): boolean {
  return from !== to && EXECUTION_TRANSITIONS[from].includes(to);
}

/**
 * Composition mapping onto the canonical 15-state mission lifecycle
 * (`MISSION_LIFECYCLE_STATES`, phase 17 machine). Observability mapping only —
 * the execution path never writes a mission lifecycle state directly.
 */
export const EXECUTION_STAGE_TO_MISSION_LIFECYCLE: Readonly<
  Partial<Record<ExecutionPathStage, MissionLifecycleState>>
> = {
  assigned: "QUEUED",
  leased: "RUNNING",
  evidenced: "SUCCEEDED",
  verified: "SUCCEEDED",
  requeued: "RETRYING",
  exhausted: "FAILED",
  denied: "FAILED",
};

/* ─────────────────────────────────────────────────────────────
 * Deny codes (closed; every non-allow is named, AGENTS §16)
 * ────────────────────────────────────────────────────────────*/

export type MissionExecutionDenyCode =
  | "invalid_input"
  | "unauthorized"
  | "cross_tenant"
  | "not_found"
  | "mission_not_found"
  | "mission_expired"
  | "invalid_stage"
  | "lease_held"
  | "lease_expired"
  | "lease_not_held"
  | "retry_backoff"
  | "attempts_exhausted"
  | "evidence_incomplete"
  | "verification_independence_failed"
  | "lease_substrate_missing";

export type MissionExecutionResult<T> =
  { ok: true; value: T } | { ok: false; code: MissionExecutionDenyCode; reason: string };

export function deny<T>(code: MissionExecutionDenyCode, reason: string): MissionExecutionResult<T> {
  return { ok: false, code, reason };
}

/* ─────────────────────────────────────────────────────────────
 * Lease / retry configuration (bounded; Zod-validated at the boundary)
 * ────────────────────────────────────────────────────────────*/

export interface MissionExecutionConfig {
  /** A lease unheartbeated for longer than this is orphaned. */
  readonly leaseTtlMs: number;
  /** Required heartbeat cadence the worker must meet. */
  readonly heartbeatIntervalMs: number;
  /** Maximum lease grants (attempts) per execution. */
  readonly maxAttempts: number;
  /** Bounded exponential backoff base (attempt 1 failure → base). */
  readonly retryBackoffBaseMs: number;
  /** Backoff ceiling. */
  readonly retryBackoffMaxMs: number;
}

export const DEFAULT_MISSION_EXECUTION_CONFIG: MissionExecutionConfig = {
  leaseTtlMs: 30_000,
  heartbeatIntervalMs: 10_000,
  maxAttempts: 3,
  retryBackoffBaseMs: 1_000,
  retryBackoffMaxMs: 60_000,
};

export const missionExecutionConfigSchema = z
  .object({
    leaseTtlMs: z.number().int().positive().max(3_600_000),
    heartbeatIntervalMs: z.number().int().positive().max(3_600_000),
    maxAttempts: z.number().int().positive().max(10),
    retryBackoffBaseMs: z.number().int().positive().max(3_600_000),
    retryBackoffMaxMs: z.number().int().positive().max(3_600_000),
  })
  .refine((c) => c.heartbeatIntervalMs <= c.leaseTtlMs, {
    message: "heartbeatIntervalMs must not exceed leaseTtlMs",
  })
  .refine((c) => c.retryBackoffBaseMs <= c.retryBackoffMaxMs, {
    message: "retryBackoffBaseMs must not exceed retryBackoffMaxMs",
  });

/** Bounded exponential backoff: min(base * 2^(attempt-1), max); deterministic. */
export function nextRetryAt(config: MissionExecutionConfig, failedAttempt: number): number {
  const scaled = config.retryBackoffBaseMs * 2 ** Math.max(0, failedAttempt - 1);
  return Math.min(scaled, config.retryBackoffMaxMs);
}

/* ─────────────────────────────────────────────────────────────
 * Execution aggregate (pure state; stores own persistence)
 * ────────────────────────────────────────────────────────────*/

export interface MissionLease {
  readonly leaseId: string;
  readonly workerId: string;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly leaseExpiresAt: string;
}

export interface MissionExecutionState {
  readonly executionId: string;
  readonly tenantId: string;
  readonly missionId: string;
  readonly missionVersion: string;
  /** The identity whose admission created the assignment (dispatcher). */
  readonly assignedBy: string;
  /** The identity of the most recent lease holder (the executor of record). */
  readonly lastWorkerId: string | null;
  readonly action: string;
  readonly idempotencyKey: string;
  readonly realityRef: string;
  readonly stage: ExecutionPathStage;
  /** Lease grants consumed; bounded by config.maxAttempts. */
  readonly attempt: number;
  readonly failureCount: number;
  readonly retryScheduledAt: string | null;
  readonly lease: MissionLease | null;
  readonly evidenceIds: readonly string[];
  readonly verificationDecision: "verified" | "failed" | "inconclusive" | null;
  readonly denyReason: string | null;
  readonly assignedAt: string;
  readonly updatedAt: string;
}

/** A worker-facing view of a granted lease (the V1-003 seam payload). */
export interface LeaseGrant {
  readonly executionId: string;
  readonly leaseId: string;
  readonly workerId: string;
  readonly attempt: number;
  readonly acquiredAt: string;
  readonly leaseExpiresAt: string;
  readonly heartbeatIntervalMs: number;
}

/** True when the lease's heartbeat window lapsed at instant `now`. */
export function leaseIsExpired(lease: MissionLease, now: string, ttlMs: number): boolean {
  if (!isContractTimestamp(now) || !isContractTimestamp(lease.heartbeatAt)) return true;
  return Date.parse(lease.heartbeatAt) + ttlMs <= Date.parse(now);
}

/** Recovery decision for a (possibly) orphaned lease: requeue when expired. */
export type LeaseRecoveryDecision =
  | { recovered: true; executionId: string; expiredLeaseId: string; workerId: string; at: string }
  | { recovered: false; reason: "lease_active" | "no_lease" | "terminal_stage" };

export function leaseRecoveryDecision(
  execution: MissionExecutionState,
  now: string,
  config: MissionExecutionConfig,
): LeaseRecoveryDecision {
  if (TERMINAL_STAGES.has(execution.stage) || execution.stage === "evidenced") {
    return { recovered: false, reason: "terminal_stage" };
  }
  if (execution.lease === null) return { recovered: false, reason: "no_lease" };
  if (!leaseIsExpired(execution.lease, now, config.leaseTtlMs)) {
    return { recovered: false, reason: "lease_active" };
  }
  return {
    recovered: true,
    executionId: execution.executionId,
    expiredLeaseId: execution.lease.leaseId,
    workerId: execution.lease.workerId,
    at: now,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Input schemas (Zod — everything crossing the trust boundary)
 * ────────────────────────────────────────────────────────────*/

const timestampSchema = z.string().refine(isContractTimestamp, {
  message: "must be a parseable timestamp",
});

const refSchema = z.string().trim().min(1).max(160);

export const missionIntentInputSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128),
    missionId: z.string().trim().min(1).max(160),
    version: z.string().trim().min(1).max(32),
    purpose: z.string().trim().min(1).max(200),
    authorityRef: z.string().trim().min(1).max(200),
    contextRef: z.string().trim().min(1).max(200),
    ownerRef: z.string().trim().min(1).max(200),
    nonScope: z.array(z.string().trim().min(1).max(160)).max(64),
    authorizedActions: z.array(z.string().trim().min(1).max(160)).min(1).max(64),
    expiresAt: timestampSchema.nullable(),
  })
  .strict();

export type MissionIntentInput = z.infer<typeof missionIntentInputSchema>;

export const assignmentInputSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128),
    missionId: z.string().trim().min(1).max(160),
    version: z.string().trim().min(1).max(32),
    executionId: refSchema,
    idempotencyKey: z.string().trim().min(8).max(200),
    action: z.string().trim().min(1).max(160),
    realityRef: z.string().trim().min(1).max(200),
    now: timestampSchema,
  })
  .strict();

export type MissionAssignmentInput = z.infer<typeof assignmentInputSchema>;

export const leaseAcquireInputSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128),
    executionId: refSchema,
    workerId: refSchema,
    now: timestampSchema,
  })
  .strict();

export type MissionLeaseAcquireInput = z.infer<typeof leaseAcquireInputSchema>;

export const leaseHeartbeatInputSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128),
    executionId: refSchema,
    leaseId: refSchema,
    workerId: refSchema,
    now: timestampSchema,
  })
  .strict();

export type MissionLeaseHeartbeatInput = z.infer<typeof leaseHeartbeatInputSchema>;

export const missionEvidenceInputSchema = z
  .object({
    evidenceKind: z.string().trim().min(1).max(160),
    sourceRef: z.string().trim().min(1).max(500),
    lineage: z.array(z.string().trim().min(1).max(200)).max(64),
  })
  .strict();

export type MissionEvidenceInput = z.infer<typeof missionEvidenceInputSchema>;

export type ExecutorOutcome =
  | { outcome: "succeeded"; evidence: readonly MissionEvidenceInput[] }
  | { outcome: "failed"; reason: string };

export const executorOutcomeSchema: z.ZodType<ExecutorOutcome> = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("succeeded"),
      evidence: z.array(missionEvidenceInputSchema).min(1),
    })
    .strict(),
  z.object({ outcome: z.literal("failed"), reason: z.string().trim().min(1).max(500) }).strict(),
]);

export const completeExecutionInputSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128),
    executionId: refSchema,
    leaseId: refSchema,
    workerId: refSchema,
    outcome: executorOutcomeSchema,
    now: timestampSchema,
  })
  .strict();

export type MissionCompleteInput = z.infer<typeof completeExecutionInputSchema>;

export const verifyExecutionInputSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128),
    executionId: refSchema,
    criteriaMet: z.boolean(),
    now: timestampSchema,
    workCriticality: z.custom<WorkCriticality>((value) => typeof value === "string").optional(),
  })
  .strict();

export type MissionVerifyInput = z.infer<typeof verifyExecutionInputSchema>;

export const recoveryInputSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128),
    now: timestampSchema,
  })
  .strict();

export type MissionRecoveryInput = z.infer<typeof recoveryInputSchema>;

export type { MissionActorContext };

/* ─────────────────────────────────────────────────────────────
 * Evidence builder (§12 provenance: who / when / source)
 * ────────────────────────────────────────────────────────────*/

export function buildExecutionEvidence(input: {
  executionId: string;
  tenantId: string;
  workerId: string;
  evidenceKind: string;
  sourceRef: string;
  lineage: readonly string[];
  observedAt: string;
}): EvidenceRecord {
  const evidenceId = `${input.executionId}:evidence:${input.evidenceKind}`;
  const integrity = createHash("sha256")
    .update(`${input.tenantId}|${input.executionId}|${input.evidenceKind}|${input.observedAt}`)
    .digest("hex");
  return {
    evidenceId,
    producer: "mission-execution",
    actorId: input.workerId,
    tenantId: input.tenantId,
    observedAt: input.observedAt,
    recordedAt: input.observedAt,
    provenance: `worker:${input.workerId}|execution:${input.executionId}|source:${input.sourceRef}`,
    integrity,
    lifecycle: "active",
    lineage: [...input.lineage],
  };
}

/* ─────────────────────────────────────────────────────────────
 * Verification decision (executor ≠ verifier, EVIDENCE before VERIFY)
 * ────────────────────────────────────────────────────────────*/

export type ExecutionVerificationOutcome = {
  decision: "verified" | "failed" | "inconclusive";
  reason: string;
  evidenceIds: readonly string[];
};

/**
 * Decide the verification act for an evidenced execution. The verifier's
 * independence from the executor is enforced FIRST (identity + effective
 * identity via the equivalence registry): an independence failure is recorded
 * as a FAILED verification, never silently retried or ignored.
 */
export function decideExecutionVerification(input: {
  verificationId: string;
  executionId: string;
  executorIdentityRef: string;
  verifierIdentityRef: string;
  evidence: readonly EvidenceRecord[];
  criteriaMet: boolean;
  workCriticality: WorkCriticality;
  identityRegistry: IdentityEquivalenceRegistry;
}): ExecutionVerificationOutcome {
  const evidenceIds = input.evidence.map((record) => record.evidenceId);
  const independence = checkVerificationIndependence({
    verifierIdentityRef: input.verifierIdentityRef,
    executorIdentityRef: input.executorIdentityRef,
    workCriticality: input.workCriticality,
    identityRegistry: input.identityRegistry,
  });
  if (!independence.independent) {
    return {
      decision: "failed",
      reason: "verification_independence_failed",
      evidenceIds,
    };
  }
  if (input.evidence.length === 0 || input.evidence.some((record) => !evidenceIsUsable(record))) {
    return {
      decision: "failed",
      reason: "evidence_not_usable",
      evidenceIds,
    };
  }
  const verification = decideVerification({
    verificationId: input.verificationId,
    executionId: input.executionId,
    executionSucceeded: true,
    evidence: input.evidence,
    criteriaMet: input.criteriaMet,
  });
  return {
    decision: verification.decision,
    reason: verification.reason,
    evidenceIds: verification.evidenceIds,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Shared admission helper (used by stores; reuses admitExecution)
 * ────────────────────────────────────────────────────────────*/

export function authorizeOrDeny(
  actor: MissionActorContext,
  tenantId: string,
  missionId: string,
  capability: "create" | "execute" | "verify",
): MissionExecutionResult<null> {
  if (!missionActorContextSchema.safeParse(actor).success) {
    return deny("invalid_input", "actor context failed schema validation");
  }
  const verdict = authorizeMissionOperation({ actor, tenantId, missionId, capability });
  return verdict.ok ? { ok: true, value: null } : deny("unauthorized", verdict.reason);
}

/** Build the admission input for the reused foundation admission machine. */
export function toAdmissionMission(intent: MissionIntentInput): MissionIntent {
  return {
    missionId: intent.missionId,
    version: intent.version,
    tenantId: intent.tenantId,
    purpose: intent.purpose,
    authorityRef: intent.authorityRef,
    contextRef: intent.contextRef,
    ownerRef: intent.ownerRef,
    nonScope: intent.nonScope,
    authorizedActions: intent.authorizedActions,
    lifecycle: "authorized",
    expiresAt: intent.expiresAt,
  };
}
