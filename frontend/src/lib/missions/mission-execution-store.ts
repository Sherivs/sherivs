/**
 * CoreGrid — general mission execution path, in-memory store (MISSION V1-004).
 *
 * The REFERENCE implementation of the execution path
 * (intent → assignment → lease → execute → evidence → verify) behind the
 * `MissionRecordPort` / `MissionLeasePort` interfaces. It implements the FULL
 * lease semantics — heartbeat, TTL expiry, orphan recovery, bounded retries
 * with backoff — that the DB-backed adapter cannot yet persist (the existing
 * `cg_*` mission tables author no lease substrate; the DB adapter fails
 * closed and reports that gap).
 *
 * Every operation:
 *   1. Zod-validates its input (trust boundary, AGENTS §26),
 *   2. authorizes the actor through the NEUTRAL RBAC core
 *      (`authorizeMissionOperation` — lifecycle gate, tenant boundary gate,
 *      role grants, default DENY),
 *   3. enforces tenant context: an execution is addressed by
 *      (tenantId, executionId), so another tenant's record is indistinguishable
 *      from an unknown one and fails closed with the SAME signal,
 *   4. records provenance (who/when/source) on every outcome (§12).
 *
 * Idempotency (AGENTS §10): intents are unique per (tenant, mission, version);
 * assignments are unique per idempotency key and a duplicate replays the
 * recorded outcome with no new external effect (exactly-once).
 *
 * Verification separation: completion records evidence and moves the
 * execution to `evidenced` — NEVER `verified`. Only a later, independent
 * verification act (different identity AND different effective identity) via
 * `verifyExecution` can produce a `verified` state.
 *
 * Boundary: pure in-memory state + pure functions. No I/O, no vendor, no
 * real database.
 */

import { admitExecution, type EvidenceRecord } from "../control-plane/foundation-mission";
import type { IdentityEquivalenceRegistry, WorkCriticality } from "../verification";
import { missionActorContextSchema, type MissionActorContext } from "./mission-authorization";
import {
  DEFAULT_MISSION_EXECUTION_CONFIG,
  TERMINAL_STAGES,
  authorizeOrDeny,
  buildExecutionEvidence,
  completeExecutionInputSchema,
  decideExecutionVerification,
  deny,
  leaseAcquireInputSchema,
  leaseHeartbeatInputSchema,
  leaseRecoveryDecision,
  leaseIsExpired,
  missionExecutionConfigSchema,
  missionIntentInputSchema,
  assignmentInputSchema,
  nextRetryAt,
  recoveryInputSchema,
  toAdmissionMission,
  verifyExecutionInputSchema,
  type ExecutionPathStage,
  type LeaseGrant,
  type LeaseRecoveryDecision,
  type MissionAssignmentInput,
  type MissionCompleteInput,
  type MissionEvidenceInput,
  type MissionExecutionConfig,
  type MissionExecutionDenyCode,
  type MissionExecutionResult,
  type MissionExecutionState,
  type MissionIntentInput,
  type MissionLease,
  type MissionLeaseAcquireInput,
  type MissionLeaseHeartbeatInput,
  type MissionRecoveryInput,
  type MissionVerifyInput,
} from "./mission-execution";

/* ─────────────────────────────────────────────────────────────
 * Ports (the seams V1-003 codes against)
 * ────────────────────────────────────────────────────────────*/

export interface MissionIntentRecord {
  readonly intent: MissionIntentInput;
  readonly declaredBy: string;
  readonly declaredAt: string;
  readonly replayed: boolean;
}

export interface MissionAssignmentResult {
  readonly execution: MissionExecutionState;
  /** True when the idempotency key replayed an existing assignment. */
  readonly replayed: boolean;
}

export interface MissionVerificationRecord {
  readonly executionId: string;
  readonly decision: "verified" | "failed" | "inconclusive";
  readonly reason: string;
  readonly evidenceIds: readonly string[];
  readonly verifierId: string;
  readonly recordedAt: string;
}

export interface MissionRecordPort {
  recordIntent(input: {
    actor: MissionActorContext;
    intent: MissionIntentInput;
    now: string;
  }): Promise<MissionExecutionResult<MissionIntentRecord>>;

  assignExecution(input: {
    actor: MissionActorContext;
    assignment: MissionAssignmentInput;
  }): Promise<MissionExecutionResult<MissionAssignmentResult>>;

  /** Persist outcome evidence for a completed execution (§12 provenance). */
  recordEvidence(input: {
    tenantId: string;
    executionId: string;
    evidence: readonly MissionEvidenceInput[];
    workerId: string;
    now: string;
  }): Promise<MissionExecutionResult<readonly EvidenceRecord[]>>;

  /** Persist the independent verification act (replay-protected). */
  recordVerification(input: {
    execution: MissionExecutionState;
    decision: "verified" | "failed" | "inconclusive";
    reason: string;
    evidenceIds: readonly string[];
    verifierId: string;
    now: string;
  }): Promise<MissionExecutionResult<{ decision: string; replayed: boolean }>>;

  /** Tenant-scoped execution read; other tenants' rows are not visible. */
  getExecution(tenantId: string, executionId: string): Promise<MissionExecutionState | null>;

  /** The independent verification step: executor ≠ verifier, evidence required. */
  verifyExecution(
    actor: MissionActorContext,
    request: MissionVerifyInput,
  ): Promise<
    MissionExecutionResult<{
      execution: MissionExecutionState;
      verification: {
        decision: "verified" | "failed" | "inconclusive";
        reason: string;
        evidenceIds: readonly string[];
      };
      replayed: boolean;
    }>
  >;
}

export interface MissionLeasePort {
  acquireLease(input: {
    actor: MissionActorContext;
    request: MissionLeaseAcquireInput;
  }): Promise<MissionExecutionResult<LeaseGrant>>;

  heartbeatLease(input: {
    actor: MissionActorContext;
    request: MissionLeaseHeartbeatInput;
  }): Promise<MissionExecutionResult<{ leaseExpiresAt: string }>>;

  completeExecution(input: { actor: MissionActorContext; request: MissionCompleteInput }): Promise<
    MissionExecutionResult<{
      execution: MissionExecutionState;
      evidence: readonly EvidenceRecord[];
    }>
  >;

  failExecution(input: {
    actor: MissionActorContext;
    tenantId: string;
    executionId: string;
    leaseId: string;
    workerId: string;
    reason: string;
    now: string;
  }): Promise<
    MissionExecutionResult<{ execution: MissionExecutionState; retryScheduledAt: string | null }>
  >;

  recoverOrphanedLeases(input: {
    actor: MissionActorContext;
    request: MissionRecoveryInput;
  }): Promise<
    MissionExecutionResult<
      readonly { executionId: string; expiredLeaseId: string; workerId: string }[]
    >
  >;
}

export interface MissionExecutionStore extends MissionRecordPort, MissionLeasePort {
  readonly backend: "memory";
}

export interface CreateMissionExecutionStoreInput {
  readonly config?: MissionExecutionConfig;
  /** Declarative identity → effective-identity equivalence registry (verification independence). */
  readonly identityRegistry?: IdentityEquivalenceRegistry;
  /** Default criticality for verification independence checks. */
  readonly defaultWorkCriticality?: WorkCriticality;
}

/* ─────────────────────────────────────────────────────────────
 * Store
 * ────────────────────────────────────────────────────────────*/

function key(tenantId: string, id: string): string {
  return `${tenantId}::${id}`;
}

export function createInMemoryMissionExecutionStore(
  input: CreateMissionExecutionStoreInput = {},
): MissionExecutionStore {
  const config = missionExecutionConfigSchema.safeParse(
    input.config ?? DEFAULT_MISSION_EXECUTION_CONFIG,
  );
  if (!config.success)
    throw new Error(`mission execution config rejected: ${config.error.message}`);
  const cfg = config.data;
  const identityRegistry = input.identityRegistry ?? [];
  const defaultCriticality: WorkCriticality = input.defaultWorkCriticality ?? "minor";

  const intents = new Map<string, MissionIntentRecord>();
  const executions = new Map<string, MissionExecutionState>();
  // Idempotency arbiter (§10): key → tenant-scoped execution id whose
  // recorded outcome is canonical truth for that key.
  const assignmentsByKey = new Map<string, string>();
  const evidenceStore = new Map<string, EvidenceRecord>();
  const verificationStore = new Map<string, MissionVerificationRecord>();

  function getExecutionSync(tenantId: string, executionId: string): MissionExecutionState | null {
    return executions.get(key(tenantId, executionId)) ?? null;
  }

  function putExecution(execution: MissionExecutionState): void {
    executions.set(key(execution.tenantId, execution.executionId), execution);
  }

  function recordEvidenceSync(input: {
    tenantId: string;
    executionId: string;
    evidence: readonly MissionEvidenceInput[];
    workerId: string;
    now: string;
  }): MissionExecutionResult<readonly EvidenceRecord[]> {
    const execution = getExecutionSync(input.tenantId, input.executionId);
    if (execution === null) {
      return deny("not_found", `execution not found in scope for tenant ${input.tenantId}`);
    }
    const records = input.evidence.map((entry) =>
      buildExecutionEvidence({
        executionId: input.executionId,
        tenantId: input.tenantId,
        workerId: input.workerId,
        evidenceKind: entry.evidenceKind,
        sourceRef: entry.sourceRef,
        lineage: entry.lineage,
        observedAt: input.now,
      }),
    );
    for (const record of records) {
      if (!evidenceStore.has(record.evidenceId)) evidenceStore.set(record.evidenceId, record);
    }
    putExecution({
      ...execution,
      evidenceIds: [...new Set([...execution.evidenceIds, ...records.map((r) => r.evidenceId)])],
      updatedAt: input.now,
    });
    return { ok: true, value: records };
  }

  function recordVerificationSync(input: {
    execution: MissionExecutionState;
    decision: "verified" | "failed" | "inconclusive";
    reason: string;
    evidenceIds: readonly string[];
    verifierId: string;
    now: string;
  }): MissionExecutionResult<{ decision: string; replayed: boolean }> {
    const executionId = input.execution.executionId;
    const existing = verificationStore.get(executionId);
    if (existing) {
      return { ok: true, value: { decision: existing.decision, replayed: true } };
    }
    verificationStore.set(executionId, {
      executionId,
      decision: input.decision,
      reason: input.reason,
      evidenceIds: input.evidenceIds,
      verifierId: input.verifierId,
      recordedAt: input.now,
    });
    const nextStage: ExecutionPathStage = input.decision === "verified" ? "verified" : "evidenced";
    putExecution({
      ...input.execution,
      stage: nextStage,
      verificationDecision: input.decision,
      updatedAt: input.now,
    });
    return { ok: true, value: { decision: input.decision, replayed: false } };
  }

  function failExecutionSync(input: {
    actor: MissionActorContext;
    tenantId: string;
    executionId: string;
    leaseId: string;
    workerId: string;
    reason: string;
    now: string;
  }): MissionExecutionResult<{
    execution: MissionExecutionState;
    retryScheduledAt: string | null;
  }> {
    const { tenantId, executionId, leaseId, workerId, reason, now } = input;
    const execution = getExecutionSync(tenantId, executionId);
    if (execution === null || input.actor.tenantId !== tenantId) {
      // Unknown and cross-tenant executions fail closed with the SAME signal
      // (no existence oracle across the tenant boundary, AGENTS §31).
      return deny("cross_tenant", "execution not found in scope");
    }
    const authorized = authorizeOrDeny(input.actor, tenantId, execution.missionId, "execute");
    if (!authorized.ok) return authorized;
    if (
      execution.lease === null ||
      execution.lease.leaseId !== leaseId ||
      execution.lease.workerId !== workerId
    ) {
      return deny(
        "lease_not_held",
        "failure report names a lease or worker that does not hold the execution",
      );
    }

    const failureCount = execution.failureCount + 1;
    if (execution.attempt >= cfg.maxAttempts) {
      // Terminal write clears the retry gate: a stale backoff stamp on an
      // exhausted execution is dead state (the acquire gate denies on
      // attempts_exhausted first, so it is inert — but the stored record must
      // not carry a schedule it will never honor).
      putExecution({
        ...execution,
        stage: "exhausted",
        lease: null,
        failureCount,
        retryScheduledAt: null,
        updatedAt: now,
      });
      const exhausted = getExecutionSync(tenantId, executionId);
      return exhausted === null
        ? deny("not_found", "execution vanished during failure recording")
        : { ok: true, value: { execution: exhausted, retryScheduledAt: null } };
    }
    const backoffMs = nextRetryAt(cfg, execution.attempt);
    const retryScheduledAt = new Date(Date.parse(now) + backoffMs).toISOString();
    putExecution({
      ...execution,
      stage: "requeued",
      lease: null,
      failureCount,
      retryScheduledAt,
      updatedAt: now,
    });
    const requeued = getExecutionSync(tenantId, executionId);
    return requeued === null
      ? deny("not_found", "execution vanished during failure recording")
      : { ok: true, value: { execution: requeued, retryScheduledAt } };
  }

  return {
    backend: "memory",

    async recordIntent({ actor, intent, now }) {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success)
        return deny("invalid_input", "actor context failed schema validation");
      const parsed = missionIntentInputSchema.safeParse(intent);
      if (!parsed.success) return deny("invalid_input", `intent rejected: ${parsed.error.message}`);
      if (parsed.data.tenantId !== actor.tenantId) {
        return deny(
          "cross_tenant",
          "intent tenant does not match the acting identity's resolved tenant",
        );
      }
      const authorized = authorizeOrDeny(
        actor,
        parsed.data.tenantId,
        parsed.data.missionId,
        "create",
      );
      if (!authorized.ok) return authorized;
      if (!parsed.data.authorityRef.trim()) {
        return deny(
          "invalid_input",
          "a mission intent requires an authorityRef (authorization source)",
        );
      }

      const intentKey = key(
        parsed.data.tenantId,
        `${parsed.data.missionId}::${parsed.data.version}`,
      );
      const existing = intents.get(intentKey);
      if (existing) {
        // Idempotent replay: the declared intent already exists (§10).
        return { ok: true, value: { ...existing, replayed: true } };
      }
      const record: MissionIntentRecord = {
        intent: parsed.data,
        declaredBy: actor.actorId,
        declaredAt: now,
        replayed: false,
      };
      intents.set(intentKey, record);
      return { ok: true, value: record };
    },

    async assignExecution({ actor, assignment }) {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success)
        return deny("invalid_input", "actor context failed schema validation");
      const parsed = assignmentInputSchema.safeParse(assignment);
      if (!parsed.success)
        return deny("invalid_input", `assignment rejected: ${parsed.error.message}`);
      const authorized = authorizeOrDeny(
        actor,
        parsed.data.tenantId,
        parsed.data.missionId,
        "execute",
      );
      if (!authorized.ok) return authorized;

      const intentRecord = intents.get(
        key(parsed.data.tenantId, `${parsed.data.missionId}::${parsed.data.version}`),
      );
      if (!intentRecord) {
        return deny(
          "mission_not_found",
          `mission intent ${parsed.data.missionId}@${parsed.data.version} is not declared in tenant ${parsed.data.tenantId}`,
        );
      }

      const assignmentKey = key(
        parsed.data.tenantId,
        `${parsed.data.missionId}::${parsed.data.idempotencyKey}::${parsed.data.action}`,
      );
      const replayExecutionId = assignmentsByKey.get(assignmentKey);
      const existing = replayExecutionId
        ? getExecutionSync(parsed.data.tenantId, replayExecutionId)
        : getExecutionSync(parsed.data.tenantId, parsed.data.executionId);
      if (existing) {
        // Idempotent replay: the idempotency key's recorded outcome is
        // canonical truth; no new external effect, no second record (§10).
        return { ok: true, value: { execution: existing, replayed: true } };
      }

      const admission = admitExecution(
        toAdmissionMission(intentRecord.intent),
        { actorId: actor.actorId, tenantId: parsed.data.tenantId, revoked: false },
        {
          executionId: parsed.data.executionId,
          idempotencyKey: parsed.data.idempotencyKey,
          missionId: parsed.data.missionId,
          tenantId: parsed.data.tenantId,
          actorId: actor.actorId,
          action: parsed.data.action,
          realityRef: parsed.data.realityRef,
          requestedAt: parsed.data.now,
        },
        parsed.data.now,
      );

      const stage: ExecutionPathStage =
        admission.result.status === "admitted" ? "assigned" : "denied";
      const execution: MissionExecutionState = {
        executionId: parsed.data.executionId,
        tenantId: parsed.data.tenantId,
        missionId: parsed.data.missionId,
        missionVersion: parsed.data.version,
        assignedBy: actor.actorId,
        lastWorkerId: null,
        action: parsed.data.action,
        idempotencyKey: parsed.data.idempotencyKey,
        realityRef: parsed.data.realityRef,
        stage,
        attempt: 0,
        failureCount: 0,
        retryScheduledAt: null,
        lease: null,
        evidenceIds: [],
        verificationDecision: null,
        denyReason: admission.result.reason,
        assignedAt: parsed.data.now,
        updatedAt: parsed.data.now,
      };
      putExecution(execution);
      assignmentsByKey.set(assignmentKey, execution.executionId);
      return { ok: true, value: { execution, replayed: false } };
    },

    async acquireLease({ actor, request }) {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success)
        return deny("invalid_input", "actor context failed schema validation");
      const parsed = leaseAcquireInputSchema.safeParse(request);
      if (!parsed.success)
        return deny("invalid_input", `lease request rejected: ${parsed.error.message}`);
      const { tenantId, executionId, workerId, now } = parsed.data;

      const execution = getExecutionSync(tenantId, executionId);
      if (execution === null || actor.tenantId !== tenantId) {
        // Unknown and cross-tenant executions fail closed with the SAME signal
        // (no existence oracle across the tenant boundary, AGENTS §31).
        return deny("cross_tenant", "execution not found in scope");
      }
      const authorized = authorizeOrDeny(actor, tenantId, execution.missionId, "execute");
      if (!authorized.ok) return authorized;
      if (execution.stage === "exhausted" || execution.attempt >= cfg.maxAttempts) {
        return deny(
          "attempts_exhausted",
          `execution consumed ${execution.attempt} of ${cfg.maxAttempts} allowed attempts`,
        );
      }
      if (TERMINAL_STAGES.has(execution.stage)) {
        return deny("invalid_stage", `execution is terminal (${execution.stage})`);
      }
      if (execution.stage === "evidenced" || execution.stage === "verified") {
        return deny("invalid_stage", `execution already completed (${execution.stage})`);
      }
      if (execution.stage === "denied") {
        return deny("invalid_stage", "execution was denied at admission and can never be leased");
      }
      if (
        execution.retryScheduledAt !== null &&
        Date.parse(now) < Date.parse(execution.retryScheduledAt)
      ) {
        return deny("retry_backoff", `retry is scheduled at ${execution.retryScheduledAt}`);
      }

      // Orphaned-lease recovery happens inline: an expired (unheartbeated)
      // lease is requeued and the attempt counter advances BEFORE a new lease
      // is granted, so the stale holder loses its rights atomically.
      if (execution.lease !== null) {
        const recovery: LeaseRecoveryDecision = leaseRecoveryDecision(execution, now, cfg);
        if (recovery.recovered) {
          putExecution({
            ...execution,
            stage: "requeued",
            lease: null,
            retryScheduledAt: null,
            updatedAt: now,
          });
        } else {
          return deny(
            "lease_held",
            `execution is leased by ${execution.lease.workerId} until ${execution.lease.leaseExpiresAt}`,
          );
        }
      }

      const current = getExecutionSync(tenantId, executionId);
      if (current === null) return deny("not_found", "execution vanished during recovery");
      const lease: MissionLease = {
        leaseId: `${executionId}:lease:${current.attempt + 1}`,
        workerId,
        acquiredAt: now,
        heartbeatAt: now,
        leaseExpiresAt: new Date(Date.parse(now) + cfg.leaseTtlMs).toISOString(),
      };
      const leased: MissionExecutionState = {
        ...current,
        stage: "leased",
        attempt: current.attempt + 1,
        lease,
        lastWorkerId: workerId,
        updatedAt: now,
      };
      putExecution(leased);
      return {
        ok: true,
        value: {
          executionId,
          leaseId: lease.leaseId,
          workerId,
          attempt: leased.attempt,
          acquiredAt: lease.acquiredAt,
          leaseExpiresAt: lease.leaseExpiresAt,
          heartbeatIntervalMs: cfg.heartbeatIntervalMs,
        },
      };
    },

    async heartbeatLease({ actor, request }) {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success)
        return deny("invalid_input", "actor context failed schema validation");
      const parsed = leaseHeartbeatInputSchema.safeParse(request);
      if (!parsed.success)
        return deny("invalid_input", `heartbeat rejected: ${parsed.error.message}`);
      const { tenantId, executionId, leaseId, workerId, now } = parsed.data;

      const execution = getExecutionSync(tenantId, executionId);
      if (execution === null || actor.tenantId !== tenantId) {
        // Unknown and cross-tenant executions fail closed with the SAME signal.
        return deny("cross_tenant", "execution not found in scope");
      }
      const authorized = authorizeOrDeny(actor, tenantId, execution.missionId, "execute");
      if (!authorized.ok) return authorized;
      if (execution.lease === null)
        return deny("lease_not_held", "execution holds no active lease");
      if (execution.lease.leaseId !== leaseId || execution.lease.workerId !== workerId) {
        return deny(
          "lease_not_held",
          "heartbeat names a lease or worker that does not hold the execution",
        );
      }
      if (leaseIsExpired(execution.lease, now, cfg.leaseTtlMs)) {
        return deny(
          "lease_expired",
          `lease expired at ${execution.lease.leaseExpiresAt} — recover and re-lease`,
        );
      }
      const leaseExpiresAt = new Date(Date.parse(now) + cfg.leaseTtlMs).toISOString();
      putExecution({
        ...execution,
        lease: { ...execution.lease, heartbeatAt: now, leaseExpiresAt },
        updatedAt: now,
      });
      return { ok: true, value: { leaseExpiresAt } };
    },

    async completeExecution({ actor, request }) {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success)
        return deny("invalid_input", "actor context failed schema validation");
      const parsed = completeExecutionInputSchema.safeParse(request);
      if (!parsed.success)
        return deny("invalid_input", `completion rejected: ${parsed.error.message}`);
      const { tenantId, executionId, leaseId, workerId, outcome, now } = parsed.data;

      const execution = getExecutionSync(tenantId, executionId);
      if (execution === null || actor.tenantId !== tenantId) {
        // Unknown and cross-tenant executions fail closed with the SAME signal.
        return deny("cross_tenant", "execution not found in scope");
      }
      const authorized = authorizeOrDeny(actor, tenantId, execution.missionId, "execute");
      if (!authorized.ok) return authorized;
      if (execution.stage !== "leased") {
        return deny(
          "invalid_stage",
          `completion requires a leased execution (stage ${execution.stage})`,
        );
      }
      if (
        execution.lease === null ||
        execution.lease.leaseId !== leaseId ||
        execution.lease.workerId !== workerId
      ) {
        return deny(
          "lease_not_held",
          "completion names a lease or worker that does not hold the execution",
        );
      }
      if (leaseIsExpired(execution.lease, now, cfg.leaseTtlMs)) {
        return deny(
          "lease_expired",
          `lease expired at ${execution.lease.leaseExpiresAt} — the work must be re-leased and redone`,
        );
      }

      if (outcome.outcome === "failed") {
        const failed = failExecutionSync({
          actor,
          tenantId,
          executionId,
          leaseId,
          workerId,
          reason: outcome.reason,
          now,
        });
        if (!failed.ok) return failed;
        // A failed outcome records the failure state; it produces no evidence.
        return { ok: true, value: { execution: failed.value.execution, evidence: [] } };
      }

      // A worker's "done" records evidence and reaches `evidenced` — never
      // `verified`. Independent verification is a separate act (§31).
      const evidenceResult = recordEvidenceSync({
        tenantId,
        executionId,
        evidence: outcome.evidence,
        workerId,
        now,
      });
      if (!evidenceResult.ok) return evidenceResult;
      const completed = getExecutionSync(tenantId, executionId);
      if (completed === null) return deny("not_found", "execution vanished during completion");
      const evidenced: MissionExecutionState = {
        ...completed,
        stage: "evidenced",
        lease: null,
        retryScheduledAt: null,
        updatedAt: now,
      };
      putExecution(evidenced);
      return { ok: true, value: { execution: evidenced, evidence: evidenceResult.value } };
    },

    async failExecution(input) {
      const actorCheck = missionActorContextSchema.safeParse(input.actor);
      if (!actorCheck.success)
        return deny("invalid_input", "actor context failed schema validation");
      const execution = getExecutionSync(input.tenantId, input.executionId);
      if (execution === null) return deny("cross_tenant", "execution not found in scope");
      const authorized = authorizeOrDeny(
        input.actor,
        input.tenantId,
        execution.missionId,
        "execute",
      );
      if (!authorized.ok) return authorized;
      return failExecutionSync(input);
    },

    async recoverOrphanedLeases({ actor, request }) {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success)
        return deny("invalid_input", "actor context failed schema validation");
      const parsed = recoveryInputSchema.safeParse(request);
      if (!parsed.success)
        return deny("invalid_input", `recovery rejected: ${parsed.error.message}`);
      const { tenantId, now } = parsed.data;
      if (actor.tenantId !== tenantId) {
        return deny(
          "cross_tenant",
          "acting identity tenant does not match the requested tenant scope",
        );
      }

      const recovered: Array<{ executionId: string; expiredLeaseId: string; workerId: string }> =
        [];
      for (const execution of executions.values()) {
        if (execution.tenantId !== tenantId) continue;
        const decision: LeaseRecoveryDecision = leaseRecoveryDecision(execution, now, cfg);
        if (!decision.recovered) continue;
        // Fail-closed authorization per recovered execution's owning mission.
        const authorized = authorizeOrDeny(actor, tenantId, execution.missionId, "execute");
        if (!authorized.ok) continue;
        putExecution({
          ...execution,
          stage: "requeued",
          lease: null,
          retryScheduledAt: null,
          updatedAt: now,
        });
        recovered.push({
          executionId: execution.executionId,
          expiredLeaseId: decision.expiredLeaseId,
          workerId: decision.workerId,
        });
      }
      return { ok: true, value: recovered };
    },

    async recordEvidence(input) {
      return Promise.resolve(recordEvidenceSync(input));
    },

    async recordVerification(input) {
      return Promise.resolve(recordVerificationSync(input));
    },

    async getExecution(tenantId, executionId) {
      return getExecutionSync(tenantId, executionId);
    },

    async verifyExecution(actor, request) {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success)
        return deny("invalid_input", "actor context failed schema validation");
      const parsed = verifyExecutionInputSchema.safeParse(request);
      if (!parsed.success)
        return deny("invalid_input", `verification rejected: ${parsed.error.message}`);
      const { tenantId, executionId, criteriaMet, now, workCriticality } = parsed.data;

      const execution = getExecutionSync(tenantId, executionId);
      if (execution === null || actor.tenantId !== tenantId) {
        // Unknown and cross-tenant executions fail closed with the SAME signal.
        return deny("cross_tenant", "execution not found in scope");
      }
      const authorized = authorizeOrDeny(actor, tenantId, execution.missionId, "verify");
      if (!authorized.ok) return authorized;

      // Replay (§10): a recorded verification decision is canonical truth —
      // re-verification attempts replay it and never re-decide.
      const existingVerification = verificationStore.get(executionId);
      if (existingVerification) {
        return {
          ok: true,
          value: {
            execution,
            verification: {
              decision: existingVerification.decision,
              reason: existingVerification.reason,
              evidenceIds: existingVerification.evidenceIds,
            },
            replayed: true,
          },
        };
      }

      if (execution.stage !== "evidenced") {
        return deny(
          "invalid_stage",
          `verification requires evidenced work (stage ${execution.stage}) — a worker's done is not verification`,
        );
      }

      const evidence = [...evidenceStore.values()].filter(
        (record) =>
          execution.evidenceIds.includes(record.evidenceId) && record.tenantId === tenantId,
      );
      const outcome = decideExecutionVerification({
        verificationId: `${executionId}:verification`,
        executionId,
        executorIdentityRef: execution.lastWorkerId ?? execution.assignedBy,
        verifierIdentityRef: actor.actorId,
        evidence,
        criteriaMet,
        workCriticality: workCriticality ?? defaultCriticality,
        identityRegistry,
      });

      const recorded = recordVerificationSync({
        execution,
        decision: outcome.decision,
        reason: outcome.reason,
        evidenceIds: [...outcome.evidenceIds],
        verifierId: actor.actorId,
        now,
      });
      if (!recorded.ok) return recorded;
      const updated = getExecutionSync(tenantId, executionId);
      if (updated === null) return deny("not_found", "execution vanished during verification");
      return {
        ok: true,
        value: { execution: updated, verification: outcome, replayed: recorded.value.replayed },
      };
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Driver seam (V1-003 implements `execute`; the mission path owns the rest)
 * ────────────────────────────────────────────────────────────*/

/** The outcome payload the runtime's executor callback returns. */
export type MissionDriverExecutorResult =
  | { outcome: "succeeded"; evidence: readonly MissionEvidenceInput[] }
  | { outcome: "failed"; reason: string };

export interface MissionDriverResult {
  readonly leased: boolean;
  readonly stage: ExecutionPathStage | null;
  readonly lease: LeaseGrant | null;
  readonly outcome: "evidenced" | "failed" | "not_leased";
  readonly denyCode: MissionExecutionDenyCode | null;
  readonly reason: string;
}

/**
 * The lease-execution seam: acquire a worker lease, invoke the executor
 * callback, then report the outcome (evidence on success, failure record on
 * failure). V1-003's agent runtime supplies `execute`; everything else —
 * authorization, idempotency, lease semantics, evidence provenance, retry
 * accounting — is the mission path's own law. This driver executes NOTHING
 * itself and owns no agent runtime.
 */
export async function runLeasedMissionExecution(
  store: MissionLeasePort & Pick<MissionRecordPort, "getExecution">,
  input: {
    worker: MissionActorContext;
    tenantId: string;
    executionId: string;
    /** Executor callback (V1-003's seam): run the mission work under the lease. */
    execute: (grant: LeaseGrant) => Promise<MissionDriverExecutorResult>;
    /** The wake instant: stamps the lease-acquisition phase without a clock. */
    now: string;
    /**
     * Optional injected clock (J-023 — no wall-clock sampling here; the caller
     * owns the time authority). When supplied, the driver samples it at EACH
     * phase boundary (lease acquisition, outcome report) so completion and
     * retry stamps reflect the actual act instants instead of the single wake
     * instant. Absent → the one `now` instant stamps every phase (the
     * deterministic behavior every existing caller keeps). Unparseable clock
     * output is rejected by the store's Zod timestamp boundary — fail closed.
     */
    clock?: () => string;
  },
): Promise<MissionDriverResult> {
  const phaseNow = input.clock ?? (() => input.now);
  const acquired = await store.acquireLease({
    actor: input.worker,
    request: {
      tenantId: input.tenantId,
      executionId: input.executionId,
      workerId: input.worker.actorId,
      now: phaseNow(),
    },
  });
  if (!acquired.ok) {
    return {
      leased: false,
      stage: null,
      lease: null,
      outcome: "not_leased",
      denyCode: acquired.code,
      reason: acquired.reason,
    };
  }
  const grant = acquired.value;
  const outcome = await input.execute(grant);
  // The outcome report is its own phase: completion/failure/retry stamps bind
  // to THIS instant, not to the wake instant (per-phase instants, V1-003 §42
  // reported edit 1 — the host threads its injected clock here).
  const reported = await store.completeExecution({
    actor: input.worker,
    request: {
      tenantId: input.tenantId,
      executionId: input.executionId,
      leaseId: grant.leaseId,
      workerId: grant.workerId,
      outcome,
      now: phaseNow(),
    },
  });
  if (!reported.ok) {
    return {
      leased: true,
      stage: null,
      lease: grant,
      outcome: "failed",
      denyCode: reported.code,
      reason: reported.reason,
    };
  }
  return {
    leased: true,
    stage: reported.value.execution.stage,
    lease: grant,
    outcome: reported.value.execution.stage === "evidenced" ? "evidenced" : "failed",
    denyCode: null,
    reason:
      outcome.outcome === "failed"
        ? outcome.reason
        : "evidence recorded; pending independent verification",
  };
}
