/**
 * Sherivs — DB-backed mission lease port over `cg_mission_lease`
 * (MISSION V1-003, team WORKFORCE).
 *
 * Closes the lease-substrate gap REPORTED (fail-closed) by mission V1-004
 * (`MISSION_LEASE_SUBSTRATE_GAP` in `mission-execution-db.server.ts`): the
 * authorized migration
 * `database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql`
 * authors the `cg_mission_lease` table (lease id, execution FK, worker id,
 * tenant scope, acquired_at, heartbeat_at, expires_at, attempt, state), and
 * this adapter implements V1-004's `MissionLeasePort` seam over it.
 *
 * This is a NEW SIBLING FILE by design: V1-004's
 * `mission-execution-db.server.ts` is not modified (its record ports are
 * reused as-is). The adapter composes:
 *   • a `MissionRecordPort` (injected — the V1-004 DB record port or the pure
 *     store) supplies tenant-scoped execution reads and evidence persistence;
 *   • `cg_mission_lease` rows supply the lease truth V1-004's record tables
 *     cannot carry (owner, heartbeat, expiry, attempt, outcome, retry gate);
 *   • an optional `WorkerLeaseGate` (supplied by the workforce module,
 *     `worker-registry-db.server.ts`) denies leasing to quarantined,
 *     suspended or fully-revoked workers at WAKE — quarantine and delegation
 *     revocation take effect at the NEXT gate check, read-time, never cached.
 *
 * Security posture (V1-004's own law, unchanged): the substrate migration
 * enables RLS with ZERO policies and revokes anon/authenticated, so this
 * adapter runs on the SERVICE-ROLE client and the authorization contract
 * (lifecycle gate, tenant boundary gate, role grants, default DENY via
 * `authorizeOrDeny`) is enforced BEFORE any row is read or written, plus
 * tenant-scoped SQL on every query. Rows read back are Zod-validated
 * (untrusted reads fail closed). The executor of record is the lease-holding
 * worker (`cg_mission_lease.worker_id`) — the refinement V1-004 reported as
 * pending this table.
 *
 * Boundary: infrastructure adapter only. No execution runtime, no agent loop
 * (owned by `workforce/worker-host.ts`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { EvidenceRecord } from "../control-plane/foundation-mission";
import {
  DEFAULT_MISSION_EXECUTION_CONFIG,
  TERMINAL_STAGES,
  authorizeOrDeny,
  completeExecutionInputSchema,
  leaseAcquireInputSchema,
  leaseHeartbeatInputSchema,
  missionExecutionConfigSchema,
  nextRetryAt,
  recoveryInputSchema,
  type LeaseGrant,
  type MissionCompleteInput,
  type MissionExecutionConfig,
  type MissionExecutionDenyCode,
  type MissionExecutionResult,
  type MissionExecutionState,
  type MissionLeaseAcquireInput,
  type MissionLeaseHeartbeatInput,
  type MissionRecoveryInput,
} from "./mission-execution";
import { missionActorContextSchema, type MissionActorContext } from "./mission-authorization";
import type { MissionLeasePort, MissionRecordPort } from "./mission-execution-store";

/**
 * Service-role client posture, identical to `mission-execution-db.server.ts`
 * (the generated `Database` types lag the authored `cg_*` migrations; the
 * untyped surface is contained here and every read is Zod-validated).
 */
export type MissionLeaseDbClient = SupabaseClient;

/** The gate the workforce module supplies: read-time, fail-closed. */
export type WorkerLeaseGate = (input: {
  tenantId: string;
  workerId: string;
  missionId: string;
  now: string;
}) => Promise<{ ok: true } | { ok: false; reason: string }>;

/* ─────────────────────────────────────────────────────────────
 * Row schemas — the untrusted read boundary (Zod, fail-closed)
 * ────────────────────────────────────────────────────────────*/

const leaseRowSchema = z.object({
  lease_id: z.string().min(1).max(160),
  execution_id: z.string().min(1).max(160),
  tenant_id: z.string().min(1).max(128),
  mission_id: z.string().min(1).max(160),
  worker_id: z.string().min(1).max(160),
  acquired_at: z.string().min(1),
  heartbeat_at: z.string().min(1),
  expires_at: z.string().min(1),
  attempt: z.number().int().min(1),
  state: z.enum(["active", "released", "recovered"]),
  outcome: z.enum(["succeeded", "failed"]).nullable(),
  completed_at: z.string().nullable(),
  retry_not_before: z.string().nullable(),
});

type LeaseRow = z.infer<typeof leaseRowSchema>;

const verificationRowSchema = z.object({
  execution_id: z.string().min(1).max(160),
  decision: z.enum(["verified", "failed", "inconclusive"]),
  reason: z.string().min(1).max(200),
});

type VerificationRow = z.infer<typeof verificationRowSchema>;

type LeaseTable = "cg_mission_lease";

function persistenceFailed(table: LeaseTable, error: { message: string }): Error {
  return new Error(`mission lease persistence failed for ${table}: ${error.message}`);
}

function loadFailed(table: LeaseTable, error: { message: string }): Error {
  return new Error(`mission lease load failed for ${table}: ${error.message}`);
}

function invalidInput(reason: string): { ok: false; code: "invalid_input"; reason: string } {
  return { ok: false, code: "invalid_input", reason };
}

export interface CreateDbMissionLeasePortInput {
  /** The record port (V1-004 DB adapter or pure store) for reads + evidence. */
  readonly records: MissionRecordPort;
  /** Lease/heartbeat/retry configuration (defaults to the V1-004 defaults). */
  readonly config?: MissionExecutionConfig;
  /**
   * Read-time worker gate (quarantine + lifecycle + live delegation state),
   * supplied by the workforce module. When configured, a gate denial denies
   * leasing with `unauthorized`. The host ALWAYS wires this gate.
   */
  readonly workerGate?: WorkerLeaseGate;
}

/**
 * Build the DB-backed `MissionLeasePort` over `cg_mission_lease`.
 * Fails closed: config is Zod-validated up front; every untrusted row is
 * Zod-validated; unknown and cross-tenant executions return the SAME
 * `cross_tenant` signal (no existence oracle, AGENTS §31).
 *
 * The returned port ALSO exposes the enriched `getExecution` read (record
 * port state ⊕ lease truth, including the persisted executor of record) —
 * exactly the `MissionLeasePort & Pick<MissionRecordPort, "getExecution">`
 * composite the leased driver and the worker host drive. Wire `getExecution`
 * from THIS port, not from the bare record port, wherever the composite is
 * assembled; reads through the bare record port stay un-enriched by design.
 */
export function createDbMissionLeasePort(
  client: MissionLeaseDbClient,
  input: CreateDbMissionLeasePortInput,
): MissionLeasePort & Pick<MissionRecordPort, "getExecution"> {
  const configCheck = missionExecutionConfigSchema.safeParse(
    input.config ?? DEFAULT_MISSION_EXECUTION_CONFIG,
  );
  if (!configCheck.success) {
    throw new Error(`mission lease config rejected: ${configCheck.error.message}`);
  }
  const cfg: MissionExecutionConfig = configCheck.data;
  const records = input.records;
  const workerGate = input.workerGate;

  async function selectLeaseRows(
    filters: ReadonlyArray<readonly [string, string]>,
  ): Promise<LeaseRow[]> {
    let query = client.from("cg_mission_lease").select("*");
    for (const [column, value] of filters) {
      query = query.eq(column, value);
    }
    const result = await query;
    if (result.error) throw loadFailed("cg_mission_lease", result.error);
    return (result.data ?? []).map((row: unknown) => {
      const parsed = leaseRowSchema.safeParse(row);
      if (!parsed.success) {
        // Untrusted read: a row outside the migration's own CHECK vocabulary
        // never enters contract state (fail closed, loudly).
        throw new Error(
          `mission lease load failed for cg_mission_lease: row validation rejected — ${parsed.error.message}`,
        );
      }
      return parsed.data;
    });
  }

  async function maybeVerificationRow(executionId: string): Promise<VerificationRow | null> {
    const result = await client
      .from("cg_verification_result")
      .select("*")
      .eq("execution_id", executionId)
      .maybeSingle();
    if (result.error) throw loadFailed("cg_mission_lease", result.error);
    if (result.data === null) return null;
    const parsed = verificationRowSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new Error(
        `mission lease load failed for cg_verification_result: row validation rejected — ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  /**
   * Merge the record port's tenant-scoped execution projection with the lease
   * truth this adapter owns. The stage derivation follows the execution-path
   * machine: denial persists; an active lease is `leased`; a succeeded lease
   * release is `evidenced`; a recorded verification decision is `verified`
   * (or stays `evidenced`); otherwise failed/recovered leases requeue — and
   * an attempt budget fully consumed by failures is `exhausted`.
   *
   * `lastWorkerId` is the executor of record: the latest persisted lease
   * row's worker. Lease rows survive release/recovery (only their state
   * changes), so the executor of record remains persisted for post-release
   * audit — the refinement V1-004 reported as pending the lease substrate
   * (V1-003 §42 reported edit 4). No lease rows → the record port's own
   * projection stands (conservatively null on the DB record path).
   */
  async function enrichedExecution(
    tenantId: string,
    executionId: string,
  ): Promise<MissionExecutionState | null> {
    const base = await records.getExecution(tenantId, executionId);
    if (base === null) return null;

    const leases = await selectLeaseRows([
      ["tenant_id", tenantId],
      ["execution_id", executionId],
    ]);
    if (leases.length === 0) return base;

    const sorted = [...leases].sort((a, b) => a.attempt - b.attempt);
    const latest = sorted[sorted.length - 1]!;
    const active = sorted.find((row) => row.state === "active") ?? null;
    const failedCount = sorted.filter((row) => row.outcome === "failed").length;
    const verification = await maybeVerificationRow(executionId);

    let stage = base.stage;
    if (base.stage !== "denied") {
      if (verification !== null) {
        stage = verification.decision === "verified" ? "verified" : "evidenced";
      } else if (active !== null) {
        stage = "leased";
      } else if (latest.outcome === "succeeded") {
        stage = "evidenced";
      } else if (latest.outcome === "failed" || latest.state === "recovered") {
        stage = latest.attempt >= cfg.maxAttempts ? "exhausted" : "requeued";
      }
    }

    return {
      ...base,
      stage,
      attempt: Math.max(base.attempt, latest.attempt),
      failureCount: Math.max(base.failureCount, failedCount),
      retryScheduledAt: latest.retry_not_before ?? base.retryScheduledAt,
      lastWorkerId: latest.worker_id,
      verificationDecision: verification?.decision ?? base.verificationDecision,
      lease:
        active === null
          ? null
          : {
              leaseId: active.lease_id,
              workerId: active.worker_id,
              acquiredAt: active.acquired_at,
              heartbeatAt: active.heartbeat_at,
              leaseExpiresAt: active.expires_at,
            },
    };
  }

  async function updateLeaseRow(
    leaseId: string,
    tenantId: string,
    patch: Partial<LeaseRow>,
  ): Promise<void> {
    const result = await client
      .from("cg_mission_lease")
      .update(patch)
      .eq("lease_id", leaseId)
      .eq("tenant_id", tenantId);
    if (result.error) throw persistenceFailed("cg_mission_lease", result.error);
  }

  function leaseIsExpired(row: LeaseRow, now: string): boolean {
    const heartbeat = Date.parse(row.heartbeat_at);
    const at = Date.parse(now);
    if (Number.isNaN(heartbeat) || Number.isNaN(at)) return true;
    return heartbeat + cfg.leaseTtlMs <= at;
  }

  async function checkWorkerGate(
    tenantId: string,
    workerId: string,
    missionId: string,
    now: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (workerGate === undefined) return { ok: true };
    return workerGate({ tenantId, workerId, missionId, now });
  }

  type CompleteExecutionValue = {
    execution: MissionExecutionState;
    evidence: readonly EvidenceRecord[];
  };

  async function completeExecutionImpl(
    actor: MissionActorContext,
    request: MissionCompleteInput,
  ): Promise<MissionExecutionResult<CompleteExecutionValue>> {
    const { tenantId, executionId, leaseId, workerId, outcome, now } = request;

    const execution = await enrichedExecution(tenantId, executionId);
    if (execution === null || actor.tenantId !== tenantId) {
      // Unknown and cross-tenant executions fail closed with the SAME signal.
      return { ok: false, code: "cross_tenant", reason: "execution not found in scope" };
    }
    const authorized = authorizeOrDeny(actor, tenantId, execution.missionId, "execute");
    if (!authorized.ok) return authorized;
    if (execution.stage !== "leased") {
      return {
        ok: false,
        code: "invalid_stage",
        reason: `completion requires a leased execution (stage ${execution.stage})`,
      };
    }
    const leases = await selectLeaseRows([
      ["tenant_id", tenantId],
      ["execution_id", executionId],
    ]);
    const lease = leases.find((row) => row.lease_id === leaseId);
    if (lease === undefined || lease.worker_id !== workerId || lease.state !== "active") {
      return {
        ok: false,
        code: "lease_not_held",
        reason: "completion names a lease or worker that does not hold the execution",
      };
    }
    if (leaseIsExpired(lease, now)) {
      return {
        ok: false,
        code: "lease_expired",
        reason: `lease expired at ${lease.expires_at} — the work must be re-leased and redone`,
      };
    }
    const gate = await checkWorkerGate(tenantId, workerId, execution.missionId, now);
    if (!gate.ok) {
      return { ok: false, code: "unauthorized", reason: gate.reason };
    }

    if (outcome.outcome === "failed") {
      const retryNotBefore = new Date(
        Date.parse(now) + nextRetryAt(cfg, lease.attempt),
      ).toISOString();
      await updateLeaseRow(leaseId, tenantId, {
        state: "released",
        outcome: "failed",
        completed_at: now,
        retry_not_before: retryNotBefore,
      });
      const requeued = await enrichedExecution(tenantId, executionId);
      if (requeued === null) {
        return {
          ok: false,
          code: "not_found",
          reason: "execution vanished during failure recording",
        };
      }
      return { ok: true, value: { execution: requeued, evidence: [] } };
    }

    // A worker's "done" records evidence and reaches `evidenced` — never
    // `verified`. Independent verification is a separate act (§31/mechanism 09).
    const evidenceResult = await records.recordEvidence({
      tenantId,
      executionId,
      evidence: outcome.evidence,
      workerId,
      now,
    });
    if (!evidenceResult.ok) return evidenceResult;
    await updateLeaseRow(leaseId, tenantId, {
      state: "released",
      outcome: "succeeded",
      completed_at: now,
      retry_not_before: null,
    });
    const completed = await enrichedExecution(tenantId, executionId);
    if (completed === null) {
      return { ok: false, code: "not_found", reason: "execution vanished during completion" };
    }
    return { ok: true, value: { execution: completed, evidence: evidenceResult.value } };
  }

  return {
    /**
     * The enriched execution read: record-port projection ⊕ lease truth
     * (stage, attempt, retry gate, verification decision, active lease and
     * the persisted executor of record). Unknown executions return null —
     * the same fail-closed signal every lease operation composes over.
     */
    async getExecution(tenantId: string, executionId: string) {
      return enrichedExecution(tenantId, executionId);
    },

    async acquireLease({
      actor,
      request,
    }: {
      actor: MissionActorContext;
      request: MissionLeaseAcquireInput;
    }): Promise<MissionExecutionResult<LeaseGrant>> {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success) return invalidInput("actor context failed schema validation");
      const parsed = leaseAcquireInputSchema.safeParse(request);
      if (!parsed.success) {
        return invalidInput(`lease request rejected: ${parsed.error.message}`);
      }
      const { tenantId, executionId, workerId, now } = parsed.data;

      const execution = await enrichedExecution(tenantId, executionId);
      if (execution === null || actor.tenantId !== tenantId) {
        return { ok: false, code: "cross_tenant", reason: "execution not found in scope" };
      }
      const gate = await checkWorkerGate(tenantId, workerId, execution.missionId, now);
      if (!gate.ok) {
        return { ok: false, code: "unauthorized", reason: gate.reason };
      }
      const authorized = authorizeOrDeny(actor, tenantId, execution.missionId, "execute");
      if (!authorized.ok) return authorized;
      if (execution.stage === "exhausted" || execution.attempt >= cfg.maxAttempts) {
        return {
          ok: false,
          code: "attempts_exhausted",
          reason: `execution consumed ${execution.attempt} of ${cfg.maxAttempts} allowed attempts`,
        };
      }
      if (TERMINAL_STAGES.has(execution.stage) || execution.stage === "evidenced") {
        return {
          ok: false,
          code: "invalid_stage",
          reason: `execution is not leasable (${execution.stage})`,
        };
      }
      if (execution.stage === "denied") {
        return {
          ok: false,
          code: "invalid_stage",
          reason: "execution was denied at admission and can never be leased",
        };
      }
      if (
        execution.retryScheduledAt !== null &&
        Date.parse(now) < Date.parse(execution.retryScheduledAt)
      ) {
        return {
          ok: false,
          code: "retry_backoff",
          reason: `retry is scheduled at ${execution.retryScheduledAt}`,
        };
      }

      // Orphan recovery is inline: an unheartbeated active lease loses its
      // rights atomically BEFORE the new grant (the attempt counter advances
      // with the new row; the stale row is marked recovered).
      const leases = await selectLeaseRows([
        ["tenant_id", tenantId],
        ["execution_id", executionId],
      ]);
      const active = leases.find((row) => row.state === "active");
      if (active !== undefined) {
        if (!leaseIsExpired(active, now)) {
          return {
            ok: false,
            code: "lease_held",
            reason: `execution is leased by ${active.worker_id} until ${active.expires_at}`,
          };
        }
        await updateLeaseRow(active.lease_id, tenantId, {
          state: "recovered",
          completed_at: now,
        });
      }

      const attempt = execution.attempt + 1;
      const leaseId = `${executionId}:lease:${attempt}`;
      const expiresAt = new Date(Date.parse(now) + cfg.leaseTtlMs).toISOString();
      const insert = await client.from("cg_mission_lease").insert({
        lease_id: leaseId,
        execution_id: executionId,
        tenant_id: tenantId,
        mission_id: execution.missionId,
        worker_id: workerId,
        acquired_at: now,
        heartbeat_at: now,
        expires_at: expiresAt,
        attempt,
        state: "active",
        outcome: null,
        completed_at: null,
        retry_not_before: null,
      });
      if (insert.error) throw persistenceFailed("cg_mission_lease", insert.error);

      const grant: LeaseGrant = {
        executionId,
        leaseId,
        workerId,
        attempt,
        acquiredAt: now,
        leaseExpiresAt: expiresAt,
        heartbeatIntervalMs: cfg.heartbeatIntervalMs,
      };
      return { ok: true, value: grant };
    },

    async heartbeatLease({
      actor,
      request,
    }: {
      actor: MissionActorContext;
      request: MissionLeaseHeartbeatInput;
    }): Promise<MissionExecutionResult<{ leaseExpiresAt: string }>> {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success) return invalidInput("actor context failed schema validation");
      const parsed = leaseHeartbeatInputSchema.safeParse(request);
      if (!parsed.success) return invalidInput(`heartbeat rejected: ${parsed.error.message}`);
      const { tenantId, executionId, leaseId, workerId, now } = parsed.data;

      if (actor.tenantId !== tenantId) {
        return { ok: false, code: "cross_tenant", reason: "execution not found in scope" };
      }
      const leases = await selectLeaseRows([
        ["tenant_id", tenantId],
        ["execution_id", executionId],
      ]);
      const lease = leases.find((row) => row.lease_id === leaseId);
      if (lease === undefined || lease.worker_id !== workerId || lease.state !== "active") {
        return {
          ok: false,
          code: "lease_not_held",
          reason: "heartbeat names a lease or worker that does not hold the execution",
        };
      }
      if (leaseIsExpired(lease, now)) {
        return {
          ok: false,
          code: "lease_expired",
          reason: `lease expired at ${lease.expires_at} — recover and re-lease`,
        };
      }
      const gate = await checkWorkerGate(tenantId, workerId, lease.mission_id, now);
      if (!gate.ok) {
        return { ok: false, code: "unauthorized", reason: gate.reason };
      }
      const leaseExpiresAt = new Date(Date.parse(now) + cfg.leaseTtlMs).toISOString();
      await updateLeaseRow(leaseId, tenantId, {
        heartbeat_at: now,
        expires_at: leaseExpiresAt,
      });
      return { ok: true, value: { leaseExpiresAt } };
    },

    async completeExecution({
      actor,
      request,
    }: {
      actor: MissionActorContext;
      request: MissionCompleteInput;
    }): Promise<MissionExecutionResult<CompleteExecutionValue>> {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success) return invalidInput("actor context failed schema validation");
      const parsed = completeExecutionInputSchema.safeParse(request);
      if (!parsed.success) return invalidInput(`completion rejected: ${parsed.error.message}`);
      return completeExecutionImpl(actor, parsed.data);
    },

    async failExecution(input: {
      actor: MissionActorContext;
      tenantId: string;
      executionId: string;
      leaseId: string;
      workerId: string;
      reason: string;
      now: string;
    }): Promise<
      MissionExecutionResult<{ execution: MissionExecutionState; retryScheduledAt: string | null }>
    > {
      const actorCheck = missionActorContextSchema.safeParse(input.actor);
      if (!actorCheck.success) return invalidInput("actor context failed schema validation");
      const reported = await completeExecutionImpl(input.actor, {
        tenantId: input.tenantId,
        executionId: input.executionId,
        leaseId: input.leaseId,
        workerId: input.workerId,
        outcome: { outcome: "failed", reason: input.reason },
        now: input.now,
      });
      if (!reported.ok) return reported;
      return {
        ok: true,
        value: {
          execution: reported.value.execution,
          retryScheduledAt: reported.value.execution.retryScheduledAt,
        },
      };
    },

    async recoverOrphanedLeases({
      actor,
      request,
    }: {
      actor: MissionActorContext;
      request: MissionRecoveryInput;
    }): Promise<
      MissionExecutionResult<
        readonly { executionId: string; expiredLeaseId: string; workerId: string }[]
      >
    > {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success) return invalidInput("actor context failed schema validation");
      const parsed = recoveryInputSchema.safeParse(request);
      if (!parsed.success) return invalidInput(`recovery rejected: ${parsed.error.message}`);
      const { tenantId, now } = parsed.data;
      if (actor.tenantId !== tenantId) {
        return {
          ok: false,
          code: "cross_tenant",
          reason: "acting identity tenant does not match the requested tenant scope",
        };
      }

      const leases = await selectLeaseRows([
        ["tenant_id", tenantId],
        ["state", "active"],
      ]);
      const recovered: Array<{
        executionId: string;
        expiredLeaseId: string;
        workerId: string;
      }> = [];
      for (const lease of leases) {
        if (!leaseIsExpired(lease, now)) continue;
        // Fail-closed authorization per recovered execution's owning mission.
        const execution = await enrichedExecution(tenantId, lease.execution_id);
        if (execution === null) continue;
        const authorized = authorizeOrDeny(actor, tenantId, execution.missionId, "execute");
        if (!authorized.ok) continue;
        await updateLeaseRow(lease.lease_id, tenantId, {
          state: "recovered",
          completed_at: now,
        });
        recovered.push({
          executionId: lease.execution_id,
          expiredLeaseId: lease.lease_id,
          workerId: lease.worker_id,
        });
      }
      return { ok: true, value: recovered };
    },
  };
}

/** The deny-code shape is the shared closed union; re-exported for typing hosts. */
export type MissionLeaseDenyCode = MissionExecutionDenyCode;
