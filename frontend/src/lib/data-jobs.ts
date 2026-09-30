/**
 * CoreGrid — data job contracts (Phase 14, domain-neutral).
 *
 * Batch work is where data platforms break their own promises: a partially applied batch,
 * a resumed job that repeats its first half, a webhook burst that overwhelms a table, a
 * "failed" job that actually succeeded twice. This engine states the contract that
 * prevents all four:
 *
 *   - a job's idempotency key is DERIVED from declared fields, so the same logical work
 *     always produces the same key and a replay cannot create a second effect;
 *   - a run's life is an explicit state machine with no arbitrary status;
 *   - restarting is only possible where the job declared it, from a recorded checkpoint;
 *   - a burst limit is a declared budget, and exceeding it is reported, never absorbed.
 *
 * Execution belongs to the runtime (Phase 05) and scheduling to Phase 17; the contract a
 * batch job must satisfy belongs here — the gap a domain phase named when it declared "no
 * asynchronous financial work" without a way to say what safe asynchronous work means.
 */

export type JobState = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export const JOB_STATES: readonly JobState[] = [
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
];

export interface JobContract {
  readonly jobId: string;
  readonly name: string;
  /** The phase that owns the semantics of this work. */
  readonly ownerPhase: string;
  /** Fields that, taken together, identify the logical unit of work. */
  readonly keyFields: readonly string[];
  readonly restartable: boolean;
  readonly cancellable: boolean;
  readonly maxAttempts: number;
  /** Optional ceiling on how many runs may start inside a minute. */
  readonly burstLimitPerMinute?: number;
}

export type JobDefinitionVerdict =
  | { readonly ok: true; readonly contract: JobContract }
  | { readonly ok: false; readonly refusals: readonly string[] };

/** Define a job. A job without a deterministic key is a job that can repeat work. */
export function defineJob(contract: JobContract): JobDefinitionVerdict {
  const refusals: string[] = [];
  if (!contract.jobId?.trim()) refusals.push("a job must be identified");
  if (!contract.ownerPhase?.trim())
    refusals.push("a job must name the phase that owns its semantics");
  if (contract.keyFields.length === 0) {
    refusals.push("a job must declare the fields that identify its logical unit of work");
  }
  if (!Number.isInteger(contract.maxAttempts) || contract.maxAttempts < 1) {
    refusals.push("maxAttempts must be a positive integer, so a job cannot retry forever");
  }
  if (contract.burstLimitPerMinute !== undefined && contract.burstLimitPerMinute < 1) {
    refusals.push("a declared burst limit must be at least one run per minute");
  }
  return refusals.length === 0 ? { ok: true, contract } : { ok: false, refusals };
}

export type JobKeyVerdict =
  { readonly ok: true; readonly key: string } | { readonly ok: false; readonly error: string };

/**
 * Derive the idempotency key from the declared fields. A missing field is refused rather
 * than defaulted, because a key built from partial input is a key that collides.
 */
export function deriveIdempotencyKey(
  contract: JobContract,
  input: Readonly<Record<string, unknown>>,
): JobKeyVerdict {
  const parts: string[] = [];
  for (const field of [...contract.keyFields].sort()) {
    const value = input[field];
    if (value === undefined || value === null || value === "") {
      return {
        ok: false,
        error: `key field ${field} is absent: the job's identity would be ambiguous`,
      };
    }
    parts.push(`${field}=${String(value)}`);
  }
  return { ok: true, key: `${contract.jobId}:${parts.join("|")}` };
}

export interface JobRun {
  readonly runId: string;
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly state: JobState;
  readonly attempt: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  /** Where the run may be resumed from; null means "from the beginning". */
  readonly checkpoint: string | null;
  readonly lastError: string | null;
}

export type StartRunVerdict =
  | { readonly ok: true; readonly run: JobRun }
  | { readonly ok: false; readonly reasons: readonly string[]; readonly detail: string };

/**
 * Start a run. Refuses a replay of a key that already completed, a key that is still
 * running, and a retry beyond the declared attempt ceiling.
 */
export function startRun(input: {
  readonly contract: JobContract;
  readonly existingRuns: readonly JobRun[];
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly at: string;
}): StartRunVerdict {
  const sameKey = input.existingRuns.filter((run) => run.idempotencyKey === input.idempotencyKey);
  const completed = sameKey.find((run) => run.state === "completed");
  if (completed) {
    return {
      ok: false,
      reasons: ["already-completed"],
      detail: `${input.idempotencyKey} completed at ${completed.finishedAt}: the same logical work is never repeated`,
    };
  }
  const live = sameKey.find((run) => run.state === "running" || run.state === "queued");
  if (live) {
    return {
      ok: false,
      reasons: ["already-running"],
      detail: `${input.idempotencyKey} is ${live.state} as ${live.runId}: two runs of one unit of work would duplicate its effect`,
    };
  }
  if (sameKey.length >= input.contract.maxAttempts) {
    return {
      ok: false,
      reasons: ["attempts-exhausted"],
      detail: `${input.idempotencyKey} already has ${sameKey.length} attempts against a ceiling of ${input.contract.maxAttempts}`,
    };
  }
  return {
    ok: true,
    run: {
      runId: input.runId,
      jobId: input.contract.jobId,
      idempotencyKey: input.idempotencyKey,
      state: "running",
      attempt: sameKey.length + 1,
      startedAt: input.at,
      finishedAt: null,
      checkpoint: null,
      lastError: null,
    },
  };
}

export type RunTransitionVerdict =
  { readonly ok: true; readonly run: JobRun } | { readonly ok: false; readonly error: string };

/** Record progress. Only a running job may checkpoint, and the marker must be named. */
export function checkpointRun(run: JobRun, marker: string): RunTransitionVerdict {
  if (run.state !== "running") return { ok: false, error: `a ${run.state} run cannot checkpoint` };
  if (!marker.trim()) return { ok: false, error: "a checkpoint must name what has been completed" };
  return { ok: true, run: { ...run, checkpoint: marker } };
}

export function completeRun(run: JobRun, at: string): RunTransitionVerdict {
  if (run.state !== "running") return { ok: false, error: `a ${run.state} run cannot complete` };
  return { ok: true, run: { ...run, state: "completed", finishedAt: at } };
}

/** A failure must say what failed; "it failed" is not a record. */
export function failRun(run: JobRun, error: string, at: string): RunTransitionVerdict {
  if (run.state !== "running") return { ok: false, error: `a ${run.state} run cannot fail` };
  if (!error.trim()) return { ok: false, error: "a failure must record what failed" };
  return { ok: true, run: { ...run, state: "failed", finishedAt: at, lastError: error } };
}

/** Cancellation is refused for a job that did not declare itself cancellable. */
export function cancelRun(run: JobRun, contract: JobContract, at: string): RunTransitionVerdict {
  if (!contract.cancellable)
    return { ok: false, error: `${contract.jobId} is not declared cancellable` };
  if (run.state === "completed" || run.state === "cancelled") {
    return { ok: false, error: `a ${run.state} run cannot be cancelled` };
  }
  return { ok: true, run: { ...run, state: "cancelled", finishedAt: at } };
}

/** Resume is refused unless the job declared itself restartable; it resumes from the checkpoint. */
export function resumeRun(run: JobRun, contract: JobContract, at: string): StartRunVerdict {
  if (!contract.restartable) {
    return {
      ok: false,
      reasons: ["not-restartable"],
      detail: `${contract.jobId} is not restartable: a re-run could repeat work that already happened`,
    };
  }
  if (run.state !== "failed" && run.state !== "paused") {
    return { ok: false, reasons: ["wrong-state"], detail: `a ${run.state} run cannot be resumed` };
  }
  if (run.attempt >= contract.maxAttempts) {
    return {
      ok: false,
      reasons: ["attempts-exhausted"],
      detail: `attempt ${run.attempt} is the ceiling of ${contract.maxAttempts}`,
    };
  }
  return {
    ok: true,
    run: {
      ...run,
      state: "running",
      attempt: run.attempt + 1,
      finishedAt: null,
      lastError: null,
      startedAt: at,
    },
  };
}

export interface BurstVerdict {
  readonly allowed: boolean;
  readonly observed: number;
  readonly limit: number | null;
  readonly detail: string;
}

/** Count starts inside the last minute and compare them with the declared burst budget. */
export function burstVerdict(
  contract: JobContract,
  recentStartTimes: readonly string[],
  at: string,
): BurstVerdict {
  const limit = contract.burstLimitPerMinute ?? null;
  const windowStart = new Date(at).getTime() - 60_000;
  const observed = recentStartTimes.filter(
    (time) => new Date(time).getTime() >= windowStart,
  ).length;
  if (limit === null) {
    return { allowed: true, observed, limit, detail: `${contract.jobId} declares no burst budget` };
  }
  if (observed >= limit) {
    return {
      allowed: false,
      observed,
      limit,
      detail: `${observed} runs started inside the last minute against a budget of ${limit}: the burst is refused rather than absorbed`,
    };
  }
  return {
    allowed: true,
    observed,
    limit,
    detail: `${observed} of ${limit} runs used in the last minute`,
  };
}

export interface JobHealthReport {
  readonly total: number;
  readonly byState: Readonly<Record<JobState, number>>;
  readonly failedKeys: readonly string[];
  readonly stuckKeys: readonly string[];
}

/** How the job's runs stand: failures are named, and so is work that never finished. */
export function jobHealth(
  runs: readonly JobRun[],
  now: string,
  stuckAfterMinutes = 60,
): JobHealthReport {
  const byState = JOB_STATES.reduce<Record<JobState, number>>(
    (counts, state) => ({ ...counts, [state]: runs.filter((run) => run.state === state).length }),
    { queued: 0, running: 0, paused: 0, completed: 0, failed: 0, cancelled: 0 },
  );
  const cutoff = new Date(now).getTime() - stuckAfterMinutes * 60_000;
  return {
    total: runs.length,
    byState,
    failedKeys: runs.filter((run) => run.state === "failed").map((run) => run.idempotencyKey),
    stuckKeys: runs
      .filter((run) => run.state === "running" && new Date(run.startedAt).getTime() < cutoff)
      .map((run) => run.idempotencyKey),
  };
}
