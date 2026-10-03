/**
 * CoreGrid — governed worker execution host (MISSION V1-003, team WORKFORCE).
 *
 * Drives ONE host cycle for one claimed execution through the governed
 * worker lifecycle:
 *
 *   WAKE     resolve the worker's authority (read-time gate: definition
 *            lifecycle, quarantine ledger, live delegation grants → neutral
 *            RBAC actor context) and read the claimed execution's mission;
 *   EXECUTE  acquire the worker lease over `cg_mission_lease` and run the
 *            mission work through V1-004's `runLeasedMissionExecution` —
 *            the executor heartbeats through the handle, and the host
 *            re-checks lease liveness AFTER the executor returns (a worker
 *            that lost its lease mid-run may not report success);
 *   PERSIST  the mission path records §12 evidence on success and the
 *            failure record with bounded-retry backoff on failure (the
 *            driver's own completion act — the host observes the result);
 *   VERIFY   hand the evidenced work to an INDEPENDENT verifier identity —
 *            never the executor. A verifier that resolves to the executor's
 *            own identity is refused at the host (fail-closed, no
 *            verification attempt at all); otherwise the record port's
 *            `verifyExecution` (mechanism 09) decides and records;
 *   SLEEP    terminal bookkeeping only: the host is a LIBRARY, not a
 *            process (cost discipline §32) — a cycle ends. A worker whose
 *            failure count crosses its bound is QUARANTINED here (recorded
 *            by the quarantine port, no longer leased to — effective at the
 *            next gate check).
 *
 * §28 separation: `workerId` is the PERSISTENT governed identity (the
 * definition); `runtimeInstanceId` is the EPHEMERAL runtime instance and is
 * carried for observability only — it is never an authority input.
 *
 * Time (J-023): no wall-clock sampling — every instant comes from the
 * injected `now` clock; the mission path receives caller-supplied
 * parseable instants only.
 *
 * Governed clock adoption (W3-INT seam, R5 WORKFORCE-CLOCK): an OPTIONAL
 * `deps.clock` supersedes `now` as the cycle's single time authority and is
 * threaded into the leased driver as its per-phase `clock`, so lease
 * acquisition and the outcome report stamp the ACTUAL act instants. When
 * `clock` is absent (the default — every existing caller), the host is
 * BYTE-IDENTICAL to the pre-adoption behavior: the driver keeps its
 * deterministic single-instant semantics (one `now` wake instant stamps
 * acquisition, completion, failure and the bounded-retry gate — the
 * denial/audit provenance the V1-003/W3-INT suites pin), while heartbeats,
 * verification and quarantine keep sampling `now` per act.
 *
 * Boundary: the host depends ONLY on the V1-004 lease/record ports, the
 * workforce authority port and the quarantine port. No vendor, no direct
 * DB access, no always-on process.
 */

import { z } from "zod";
import { type LeaseGrant, type MissionExecutionState } from "../missions/mission-execution";
import {
  runLeasedMissionExecution,
  type MissionDriverExecutorResult,
  type MissionDriverResult,
} from "../missions/mission-execution-store";
import type { MissionLeasePort, MissionRecordPort } from "../missions/mission-execution-store";
import type { MissionActorContext } from "../missions/mission-authorization";
import type { WorkCriticality } from "../verification";
import { workerQuarantineDecision, type WorkerQuarantineDecision } from "./worker-registry";

/** The lease/record surface the host drives (V1-004 ports, unmodified). */
export type WorkerHostMissionPorts = MissionLeasePort &
  Pick<MissionRecordPort, "getExecution" | "verifyExecution">;

/** Authority resolution (workforce registry): gate → actor context. */
export interface WorkerAuthorityPort {
  resolveAuthority(input: {
    tenantId: string;
    workerId: string;
    missionId: string;
  }): Promise<{ ok: true; actor: MissionActorContext } | { ok: false; reason: string }>;
}

/** Quarantine recording (workforce registry): recorded, no longer leased to. */
export interface WorkerQuarantinePort {
  quarantineWorker(input: {
    tenantId: string;
    workerId: string;
    reason: string;
    failureCount: number;
    threshold: number;
    quarantinedBy: string;
    now: string;
  }): Promise<void>;
}

/** The execution handle the executor callback receives. */
export interface WorkerExecutionHandle {
  readonly grant: LeaseGrant;
  /** Heartbeat the lease; an expired lease denies (recover and re-lease). */
  heartbeat(): Promise<{ ok: true; leaseExpiresAt: string } | { ok: false; reason: string }>;
}

export type WorkerHostExecutor = (
  handle: WorkerExecutionHandle,
) => Promise<MissionDriverExecutorResult>;

/** The VERIFY step's plan: an independent verifier identity + its criteria. */
export interface WorkerVerificationPlan {
  readonly actor: MissionActorContext;
  readonly criteriaMet: boolean;
  readonly workCriticality?: WorkCriticality;
}

export interface WorkerHostDeps {
  readonly missions: WorkerHostMissionPorts;
  readonly authority: WorkerAuthorityPort;
  readonly quarantine?: WorkerQuarantinePort;
  /** Failure count at which a worker is quarantined (recorded, not leased to). */
  readonly quarantineThreshold: number;
  /** Injected clock (J-023): every host instant comes from here. */
  readonly now: () => string;
  /**
   * Optional governed cycle clock (W3-INT seam adoption). When supplied it
   * SUPERSEDES `now` as the cycle's single time authority and is threaded
   * into the leased driver as its per-phase `clock` (lease-acquisition and
   * outcome-report stamps bind to the act instants). When absent (the
   * default) the host is byte-identical to the pre-adoption behavior: the
   * driver keeps its deterministic single-wake-instant provenance and every
   * other instant still comes from `now`.
   */
  readonly clock?: () => string;
}

export interface WorkerHostCycleInput {
  readonly tenantId: string;
  /** The PERSISTENT governed worker identity (the definition id, §28). */
  readonly workerId: string;
  /** The EPHEMERAL runtime instance id — observability only, never authority. */
  readonly runtimeInstanceId: string;
  readonly executionId: string;
  readonly execute: WorkerHostExecutor;
  /**
   * The VERIFY step: resolved ONLY after the work is evidenced. Returning
   * the executor's own identity is a fail-closed refusal (never verified).
   */
  readonly verify?: (input: {
    execution: MissionExecutionState;
  }) => Promise<WorkerVerificationPlan>;
}

export interface WorkerHostPhase {
  readonly phase: "WAKE" | "EXECUTE" | "PERSIST" | "VERIFY" | "SLEEP";
  readonly ok: boolean;
  readonly detail: string;
}

export interface WorkerHostCycleResult {
  readonly workerId: string;
  readonly runtimeInstanceId: string;
  readonly executionId: string;
  readonly phases: readonly WorkerHostPhase[];
  readonly wake: { readonly ok: true } | { readonly ok: false; readonly reason: string };
  readonly execute: MissionDriverResult;
  readonly persist: {
    readonly ok: boolean;
    readonly evidenceCount: number;
    readonly reason: string;
  };
  readonly verify: {
    readonly attempted: boolean;
    readonly independent: boolean;
    readonly decision: "verified" | "failed" | "inconclusive" | null;
    readonly reason: string;
  };
  readonly sleep: {
    readonly state: "sleeping";
    readonly quarantined: boolean;
    readonly quarantine: WorkerQuarantineDecision | null;
  };
}

const workerHostCycleInputSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128),
    workerId: z.string().trim().min(1).max(160),
    runtimeInstanceId: z.string().trim().min(1).max(200),
    executionId: z.string().trim().min(1).max(160),
    // Callbacks are trust-boundary-checked structurally (callable), not by
    // deep schema — they run under the host's own gates.
    execute: z.custom<WorkerHostExecutor>(
      (v) => typeof v === "function",
      "execute must be a function",
    ),
    verify: z
      .custom<WorkerHostCycleInput["verify"]>(
        (v) => v === undefined || typeof v === "function",
        "verify must be a function when supplied",
      )
      .optional(),
  })
  .strict();

/**
 * Run ONE governed worker host cycle: WAKE → EXECUTE → PERSIST → VERIFY →
 * SLEEP. Library-form: a server function or a standalone runner invokes
 * `runWorkerHost` per claimed execution; there is NO always-on process.
 */
export async function runWorkerHost(
  deps: WorkerHostDeps,
  input: WorkerHostCycleInput,
): Promise<WorkerHostCycleResult> {
  const parsedInput = workerHostCycleInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new Error(`worker host input rejected: ${parsedInput.error.message}`);
  }
  const { tenantId, workerId, executionId } = parsedInput.data;
  // `clock` supersedes `now` when supplied; absent, this reference IS
  // `deps.now` and the whole cycle is byte-identical to the pre-adoption host.
  const now = deps.clock ?? deps.now;
  const phases: WorkerHostPhase[] = [];

  /* ── WAKE ─────────────────────────────────────────────── */
  const execution = await deps.missions.getExecution(tenantId, executionId);
  if (execution === null) {
    phases.push({ phase: "WAKE", ok: false, detail: "execution not found in scope" });
    return deniedCycle(parsedInput.data, phases, "execution not found in scope");
  }
  const authority = await deps.authority.resolveAuthority({
    tenantId,
    workerId,
    missionId: execution.missionId,
  });
  if (!authority.ok) {
    phases.push({ phase: "WAKE", ok: false, detail: authority.reason });
    return deniedCycle(parsedInput.data, phases, authority.reason);
  }
  const actor = authority.actor;
  if (actor.actorId !== workerId) {
    // Fail closed: the resolved actor MUST be the governed worker identity.
    const detail = "authority resolved a different actor than the governed worker identity";
    phases.push({ phase: "WAKE", ok: false, detail });
    return deniedCycle(parsedInput.data, phases, detail);
  }
  phases.push({
    phase: "WAKE",
    ok: true,
    detail: `governed worker ${workerId} (runtime ${parsedInput.data.runtimeInstanceId}) authorized for mission ${execution.missionId}`,
  });

  /* ── EXECUTE (via V1-004's leased driver, with heartbeat) ── */
  const driverResult = await runLeasedMissionExecution(deps.missions, {
    worker: actor,
    tenantId,
    executionId,
    // Wake instant: the driver's deterministic default when no governed
    // clock is adopted. `clock` present → per-phase act instants (W3-INT
    // seam); `clock` absent/undefined → the driver keeps its single-instant
    // provenance (byte-identical default, pinned by the clock tests).
    now: now(),
    clock: deps.clock,
    execute: async (grant) => {
      const heartbeat = async (): Promise<
        { ok: true; leaseExpiresAt: string } | { ok: false; reason: string }
      > => {
        const beat = await deps.missions.heartbeatLease({
          actor,
          request: {
            tenantId,
            executionId,
            leaseId: grant.leaseId,
            workerId,
            now: now(),
          },
        });
        return beat.ok
          ? { ok: true, leaseExpiresAt: beat.value.leaseExpiresAt }
          : { ok: false, reason: beat.reason };
      };
      let outcome: MissionDriverExecutorResult;
      try {
        outcome = await input.execute({ grant, heartbeat });
      } catch (error) {
        // An executor exception is a worker-reported failure, never a crash
        // path: the failure is recorded with bounded-retry backoff.
        return {
          outcome: "failed",
          reason: `executor_error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      // Final liveness gate (fail-closed): a worker that lost its lease
      // mid-run may not report success.
      if (outcome.outcome === "succeeded") {
        const liveness = await heartbeat();
        if (!liveness.ok) {
          return {
            outcome: "failed",
            reason: `lease_expired_during_execution: ${liveness.reason}`,
          };
        }
      }
      return outcome;
    },
  });
  phases.push({
    phase: "EXECUTE",
    ok: driverResult.outcome === "evidenced",
    detail: driverResult.reason,
  });

  /* ── PERSIST (evidence on success; failure record + backoff on failure) ── */
  const persisted = await deps.missions.getExecution(tenantId, executionId);
  const evidenceCount = persisted?.evidenceIds.length ?? 0;
  // Under the adopted per-phase clock, the completion ACT can land past the
  // lease TTL (the store then denies it `lease_expired`, fail-closed, with
  // ZERO writes — the driver surfaces that as outcome `failed` + denyCode).
  // The host reports that truthfully: nothing was persisted and the
  // execution waits for inline orphan recovery. On the DEFAULT single-wake-
  // instant path a just-acquired lease cannot be expired at the completion
  // instant, so this branch is unreachable without an adopted clock and the
  // default provenance is byte-identical (pinned by the clock tests).
  const completionDenied = driverResult.outcome === "failed" && driverResult.denyCode !== null;
  const persistOk =
    !completionDenied &&
    (driverResult.outcome === "evidenced" || driverResult.outcome === "failed");
  phases.push({
    phase: "PERSIST",
    ok: persistOk,
    detail: completionDenied
      ? `completion denied (${driverResult.denyCode}): ${driverResult.reason} — nothing persisted; the expired lease awaits recovery`
      : persistOk
        ? driverResult.outcome === "evidenced"
          ? `${evidenceCount} evidence record(s) persisted with §12 provenance`
          : `failure recorded with bounded-retry backoff: ${driverResult.reason}`
        : "nothing persisted — the execution was not leased",
  });

  /* ── VERIFY (independent verifier identity — never the executor) ── */
  let verify: WorkerHostCycleResult["verify"] = {
    attempted: false,
    independent: false,
    decision: null,
    reason: "no verification plan supplied — evidenced work awaits independent verification",
  };
  if (driverResult.outcome === "evidenced" && persisted !== null && input.verify !== undefined) {
    const plan = await input.verify({ execution: persisted });
    const independent = plan.actor.actorId !== workerId;
    if (!independent) {
      // Fail closed: the host REFUSES to hand verification to the executor's
      // own identity — no verification act at all (mechanism 09).
      verify = {
        attempted: false,
        independent: false,
        decision: null,
        reason: "verification_independence_refused:verifier resolves to the executor identity",
      };
      phases.push({ phase: "VERIFY", ok: false, detail: verify.reason });
    } else {
      const verified = await deps.missions.verifyExecution(plan.actor, {
        tenantId,
        executionId,
        criteriaMet: plan.criteriaMet,
        now: now(),
        workCriticality: plan.workCriticality,
      });
      if (verified.ok) {
        verify = {
          attempted: true,
          independent: true,
          decision: verified.value.verification.decision,
          reason: verified.value.verification.reason,
        };
        phases.push({
          phase: "VERIFY",
          ok: verified.value.verification.decision === "verified",
          detail: `${verified.value.verification.decision}: ${verified.value.verification.reason}`,
        });
      } else {
        verify = {
          attempted: true,
          independent: true,
          decision: null,
          reason: `verification denied: ${verified.code} ${verified.reason}`,
        };
        phases.push({ phase: "VERIFY", ok: false, detail: verify.reason });
      }
    }
  } else if (driverResult.outcome !== "evidenced") {
    phases.push({
      phase: "VERIFY",
      ok: false,
      detail: "skipped — verification requires evidenced work",
    });
  } else {
    phases.push({
      phase: "VERIFY",
      ok: false,
      detail:
        "skipped — no verification plan supplied; evidenced work awaits independent verification",
    });
  }

  /* ── SLEEP (quarantine bound; no process survives the cycle, §32) ── */
  const failureCount = persisted?.failureCount ?? 0;
  const quarantineDecision = workerQuarantineDecision({
    failureCount,
    threshold: deps.quarantineThreshold,
  });
  let quarantined = false;
  if (quarantineDecision.quarantined && deps.quarantine !== undefined) {
    await deps.quarantine.quarantineWorker({
      tenantId,
      workerId,
      reason: quarantineDecision.reason ?? "quarantine threshold reached",
      failureCount,
      threshold: deps.quarantineThreshold,
      quarantinedBy: "worker-host",
      now: now(),
    });
    quarantined = true;
  }
  phases.push({
    phase: "SLEEP",
    ok: true,
    detail: quarantined
      ? `worker quarantined: ${quarantineDecision.reason}`
      : "cycle complete — host sleeps (library-form, no resident process)",
  });

  return {
    workerId,
    runtimeInstanceId: parsedInput.data.runtimeInstanceId,
    executionId,
    phases,
    wake: { ok: true },
    execute: driverResult,
    persist: {
      ok: persistOk,
      evidenceCount,
      reason: phases.find((p) => p.phase === "PERSIST")?.detail ?? "",
    },
    verify,
    sleep: { state: "sleeping", quarantined, quarantine: quarantineDecision },
  };
}

function deniedCycle(
  input: { workerId: string; runtimeInstanceId: string; executionId: string },
  phases: WorkerHostPhase[],
  reason: string,
): WorkerHostCycleResult {
  const notLeased: MissionDriverResult = {
    leased: false,
    stage: null,
    lease: null,
    outcome: "not_leased",
    denyCode: null,
    reason,
  };
  return {
    workerId: input.workerId,
    runtimeInstanceId: input.runtimeInstanceId,
    executionId: input.executionId,
    phases,
    wake: { ok: false, reason },
    execute: notLeased,
    persist: { ok: false, evidenceCount: 0, reason: "wake denied — nothing persisted" },
    verify: {
      attempted: false,
      independent: false,
      decision: null,
      reason: "wake denied — nothing to verify",
    },
    sleep: { state: "sleeping", quarantined: false, quarantine: null },
  };
}
