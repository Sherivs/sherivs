/**
 * Personal twin sleep/wake scheduler (SV1-TWIN-03).
 *
 * A twin exists only while it is handling one defined event. Nothing here
 * runs on its own: there is no timer, no polling loop and no background task.
 * The host calls these functions when an event arrives, when it is ready to
 * run the next queued event, and when a run reports progress. If no event is
 * queued and no run is in flight, `planNextWake` returns the same state object
 * and allocates nothing, so idle cost is zero by construction.
 *
 * The module is pure and send-free: it decides, it never executes. It composes
 * with the ephemeral lifecycle (`agent-runtime/ephemeral-lifecycle.ts`) rather
 * than adding a second state machine, so lease expiry, action limits and token
 * budgets are enforced by the existing `transition` function.
 *
 * Guarantees:
 * - Only event types on the allowlist can wake a twin; twin-caused events are
 *   rejected, so a twin cannot wake itself or another twin.
 * - Per-user and per-tenant wake and token budgets are enforced per window.
 * - A kill switch (global, tenant or user) drops queued events and terminates
 *   in-flight runs in the same call.
 * - Every decision appends an audit record carrying the event correlation id.
 */

import { agentDefinitionId } from "@/lib/agent-core";
import {
  issueLease,
  transition,
  type LifecycleEvent,
  type RuntimeLease,
  type TerminationReason,
} from "@/lib/agent-runtime/ephemeral-lifecycle";

/* ─────────────────────────────────────────────────────────────
 * Events
 * ────────────────────────────────────────────────────────────*/

/** The only event types that may wake a twin. Anything else is rejected. */
export const TWIN_WAKE_EVENT_TYPES = [
  "approval_decided",
  "assignment_changed",
  "message_received",
  "deadline_due",
  "brief_requested",
  "record_changed",
] as const;
export type TwinWakeEventType = (typeof TWIN_WAKE_EVENT_TYPES)[number];

/** Who raised the event. A twin is never a legal source. */
export type TwinWakeSource = "user" | "system" | "role_engine" | "workflow" | "scheduler";

export interface TwinWakeEvent {
  /** Unique per event; used for duplicate suppression. */
  readonly eventId: string;
  readonly type: TwinWakeEventType;
  readonly source: TwinWakeSource | "twin";
  readonly tenantRef: string;
  readonly userRef: string;
  readonly occurredAtMs: number;
  /** Carried onto every audit record for the run. */
  readonly correlationId: string;
  /** Opaque reference to the record that changed; never the record itself. */
  readonly subjectRef: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Configuration
 * ────────────────────────────────────────────────────────────*/

export interface BudgetWindowLimits {
  readonly maxWakes: number;
  readonly maxTokens: number;
}

export interface SleepWakeConfig {
  readonly windowMs: number;
  readonly perUser: BudgetWindowLimits;
  readonly perTenant: BudgetWindowLimits;
  readonly perRun: {
    readonly maxTokens: number;
    readonly maxFinancialCost: number;
    readonly timeLimitMs: number;
    readonly actionLimit: number;
  };
  readonly maxQueuePerUser: number;
  readonly maxQueueTotal: number;
  /** An event older than this when it reaches the head of the queue is dropped. */
  readonly eventTtlMs: number;
  readonly maxConcurrentRunsPerUser: number;
  /** Bound on the duplicate-suppression window, so state cannot grow forever. */
  readonly maxRememberedEventIds: number;
}

export const DEFAULT_SLEEP_WAKE_CONFIG: SleepWakeConfig = Object.freeze({
  windowMs: 60 * 60 * 1000,
  perUser: Object.freeze({ maxWakes: 20, maxTokens: 50_000 }),
  perTenant: Object.freeze({ maxWakes: 2_000, maxTokens: 5_000_000 }),
  perRun: Object.freeze({
    maxTokens: 8_000,
    maxFinancialCost: 0.5,
    timeLimitMs: 2 * 60 * 1000,
    actionLimit: 5,
  }),
  maxQueuePerUser: 10,
  maxQueueTotal: 10_000,
  eventTtlMs: 15 * 60 * 1000,
  maxConcurrentRunsPerUser: 1,
  maxRememberedEventIds: 5_000,
});

/* ─────────────────────────────────────────────────────────────
 * State
 * ────────────────────────────────────────────────────────────*/

export type KillSwitchScope = "global" | "tenant" | "user";

export interface KillSwitch {
  readonly scope: KillSwitchScope;
  /** tenantRef for tenant scope, `${tenantRef}/${userRef}` for user scope, null for global. */
  readonly key: string | null;
  readonly engagedAtMs: number;
  readonly actor: string;
  readonly reason: string;
}

export interface InFlightRun {
  readonly runId: string;
  readonly correlationId: string;
  readonly tenantRef: string;
  readonly userRef: string;
  readonly eventType: TwinWakeEventType;
  readonly lease: RuntimeLease;
}

interface UsageBucket {
  readonly scope: "user" | "tenant";
  readonly key: string;
  readonly windowStartMs: number;
  readonly wakes: number;
  readonly tokens: number;
}

export type DeadLetterReason = "event_expired" | "kill_switch";

export interface DeadLetter {
  readonly event: TwinWakeEvent;
  readonly reason: DeadLetterReason;
  readonly atMs: number;
}

export type AuditKind =
  | "event_queued"
  | "event_rejected"
  | "event_dead_lettered"
  | "wake_started"
  | "run_progress"
  | "run_stopped"
  | "request_rejected"
  | "run_slept"
  | "kill_switch_engaged"
  | "kill_switch_released";

export interface TwinAuditRecord {
  readonly seq: number;
  readonly atMs: number;
  readonly kind: AuditKind;
  readonly correlationId: string | null;
  readonly tenantRef: string | null;
  readonly userRef: string | null;
  readonly runId: string | null;
  readonly detail: string;
}

export interface SleepWakeState {
  readonly queue: readonly TwinWakeEvent[];
  readonly seenEventIds: readonly string[];
  readonly inFlight: readonly InFlightRun[];
  readonly usage: readonly UsageBucket[];
  readonly killSwitches: readonly KillSwitch[];
  readonly deadLetter: readonly DeadLetter[];
  readonly audit: readonly TwinAuditRecord[];
  readonly nextSeq: number;
}

export const EMPTY_SLEEP_WAKE_STATE: SleepWakeState = Object.freeze({
  queue: Object.freeze([]),
  seenEventIds: Object.freeze([]),
  inFlight: Object.freeze([]),
  usage: Object.freeze([]),
  killSwitches: Object.freeze([]),
  deadLetter: Object.freeze([]),
  audit: Object.freeze([]),
  nextSeq: 1,
});

/* ─────────────────────────────────────────────────────────────
 * Internal helpers
 * ────────────────────────────────────────────────────────────*/

const userKey = (tenantRef: string, userRef: string): string => `${tenantRef}/${userRef}`;

function withAudit(
  state: SleepWakeState,
  atMs: number,
  kind: AuditKind,
  detail: string,
  ctx: {
    correlationId?: string | null;
    tenantRef?: string | null;
    userRef?: string | null;
    runId?: string | null;
  } = {},
): SleepWakeState {
  const record: TwinAuditRecord = Object.freeze({
    seq: state.nextSeq,
    atMs,
    kind,
    correlationId: ctx.correlationId ?? null,
    tenantRef: ctx.tenantRef ?? null,
    userRef: ctx.userRef ?? null,
    runId: ctx.runId ?? null,
    detail,
  });
  return { ...state, audit: [...state.audit, record], nextSeq: state.nextSeq + 1 };
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function nonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function killSwitchFor(
  state: SleepWakeState,
  tenantRef: string,
  userRef: string,
): KillSwitch | null {
  return (
    state.killSwitches.find(
      (k) =>
        k.scope === "global" ||
        (k.scope === "tenant" && k.key === tenantRef) ||
        (k.scope === "user" && k.key === userKey(tenantRef, userRef)),
    ) ?? null
  );
}

/** The bucket as it stands at `nowMs`: a bucket from an earlier window counts as empty. */
function currentBucket(
  state: SleepWakeState,
  config: SleepWakeConfig,
  scope: "user" | "tenant",
  key: string,
  nowMs: number,
): UsageBucket {
  const found = state.usage.find((b) => b.scope === scope && b.key === key);
  if (!found || nowMs - found.windowStartMs >= config.windowMs) {
    return { scope, key, windowStartMs: nowMs, wakes: 0, tokens: 0 };
  }
  return found;
}

function putBucket(state: SleepWakeState, bucket: UsageBucket): SleepWakeState {
  const rest = state.usage.filter((b) => !(b.scope === bucket.scope && b.key === bucket.key));
  return { ...state, usage: [...rest, bucket] };
}

function remainingTokens(
  state: SleepWakeState,
  config: SleepWakeConfig,
  ev: { tenantRef: string; userRef: string },
  nowMs: number,
): number {
  const u = currentBucket(state, config, "user", userKey(ev.tenantRef, ev.userRef), nowMs);
  const t = currentBucket(state, config, "tenant", ev.tenantRef, nowMs);
  return Math.max(
    0,
    Math.min(config.perUser.maxTokens - u.tokens, config.perTenant.maxTokens - t.tokens),
  );
}

function wakesAvailable(
  state: SleepWakeState,
  config: SleepWakeConfig,
  ev: { tenantRef: string; userRef: string },
  nowMs: number,
): boolean {
  const u = currentBucket(state, config, "user", userKey(ev.tenantRef, ev.userRef), nowMs);
  const t = currentBucket(state, config, "tenant", ev.tenantRef, nowMs);
  return u.wakes < config.perUser.maxWakes && t.wakes < config.perTenant.maxWakes;
}

/* ─────────────────────────────────────────────────────────────
 * Enqueue
 * ────────────────────────────────────────────────────────────*/

export type EnqueueRejection =
  | "invalid_event"
  | "event_type_not_allowed"
  | "twin_cannot_trigger_twin"
  | "kill_switch_engaged"
  | "duplicate_event"
  | "event_from_the_future"
  | "event_already_expired"
  | "user_queue_full"
  | "queue_full";

export type EnqueueResult =
  | { readonly ok: true; readonly state: SleepWakeState }
  | { readonly ok: false; readonly reason: EnqueueRejection; readonly state: SleepWakeState };

/** Maximum clock skew tolerated for an event stamped slightly ahead of the host. */
const MAX_FUTURE_SKEW_MS = 5_000;

export function enqueueWakeEvent(
  state: SleepWakeState,
  event: TwinWakeEvent,
  config: SleepWakeConfig,
  nowMs: number,
): EnqueueResult {
  const reject = (reason: EnqueueRejection): EnqueueResult => ({
    ok: false,
    reason,
    state: withAudit(state, nowMs, "event_rejected", reason, {
      correlationId: nonEmpty(event?.correlationId) ? event.correlationId : null,
      tenantRef: nonEmpty(event?.tenantRef) ? event.tenantRef : null,
      userRef: nonEmpty(event?.userRef) ? event.userRef : null,
    }),
  });

  if (
    !event ||
    !nonEmpty(event.eventId) ||
    !nonEmpty(event.tenantRef) ||
    !nonEmpty(event.userRef) ||
    !nonEmpty(event.correlationId) ||
    !isFiniteNonNegative(event.occurredAtMs)
  ) {
    return reject("invalid_event");
  }
  if (!(TWIN_WAKE_EVENT_TYPES as readonly string[]).includes(event.type)) {
    return reject("event_type_not_allowed");
  }
  if (event.source === "twin") return reject("twin_cannot_trigger_twin");
  if (killSwitchFor(state, event.tenantRef, event.userRef)) return reject("kill_switch_engaged");
  if (state.seenEventIds.includes(event.eventId)) return reject("duplicate_event");
  if (event.occurredAtMs > nowMs + MAX_FUTURE_SKEW_MS) return reject("event_from_the_future");
  if (nowMs - event.occurredAtMs > config.eventTtlMs) return reject("event_already_expired");
  if (state.queue.length >= config.maxQueueTotal) return reject("queue_full");
  const mine = state.queue.filter(
    (q) => q.tenantRef === event.tenantRef && q.userRef === event.userRef,
  ).length;
  if (mine >= config.maxQueuePerUser) return reject("user_queue_full");

  const seen = [...state.seenEventIds, event.eventId];
  const trimmed =
    seen.length > config.maxRememberedEventIds
      ? seen.slice(seen.length - config.maxRememberedEventIds)
      : seen;
  const next: SleepWakeState = {
    ...state,
    queue: [...state.queue, Object.freeze({ ...event })],
    seenEventIds: trimmed,
  };
  return {
    ok: true,
    state: withAudit(next, nowMs, "event_queued", event.type, {
      correlationId: event.correlationId,
      tenantRef: event.tenantRef,
      userRef: event.userRef,
    }),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Wake planning
 * ────────────────────────────────────────────────────────────*/

export interface WokenRun {
  readonly runId: string;
  readonly correlationId: string;
  readonly event: TwinWakeEvent;
  readonly lease: RuntimeLease;
}

export type WakePlan =
  | { readonly decision: "wake"; readonly state: SleepWakeState; readonly run: WokenRun }
  | { readonly decision: "idle"; readonly state: SleepWakeState };

/**
 * Pick the next runnable event, FIFO per user, and issue a lease for it.
 * Returns the very same state object when there is nothing to do.
 */
export function planNextWake(
  state: SleepWakeState,
  config: SleepWakeConfig,
  nowMs: number,
): WakePlan {
  if (state.queue.length === 0) return { decision: "idle", state };

  let working = state;
  const keep: TwinWakeEvent[] = [];
  let chosen: TwinWakeEvent | null = null;
  let changed = false;

  for (const ev of state.queue) {
    if (chosen) {
      keep.push(ev);
      continue;
    }
    if (nowMs - ev.occurredAtMs > config.eventTtlMs) {
      working = deadLetter(working, ev, "event_expired", nowMs);
      changed = true;
      continue;
    }
    if (killSwitchFor(working, ev.tenantRef, ev.userRef)) {
      working = deadLetter(working, ev, "kill_switch", nowMs);
      changed = true;
      continue;
    }
    const running = working.inFlight.filter(
      (r) => r.tenantRef === ev.tenantRef && r.userRef === ev.userRef,
    ).length;
    const blockedByEarlierSameUser = keep.some(
      (k) => k.tenantRef === ev.tenantRef && k.userRef === ev.userRef,
    );
    if (
      running >= config.maxConcurrentRunsPerUser ||
      blockedByEarlierSameUser ||
      !wakesAvailable(working, config, ev, nowMs) ||
      remainingTokens(working, config, ev, nowMs) <= 0
    ) {
      keep.push(ev);
      continue;
    }
    chosen = ev;
  }

  if (!chosen) {
    return changed
      ? { decision: "idle", state: { ...working, queue: keep } }
      : { decision: "idle", state };
  }

  const tokenCeiling = Math.min(
    config.perRun.maxTokens,
    remainingTokens(working, config, chosen, nowMs),
  );
  const runId = `run:${chosen.correlationId}`;
  const lease0 = issueLease(
    {
      id: agentDefinitionId(`agent-def:personal_twin:${chosen.type}:v1`),
      tenantRef: chosen.tenantRef,
      capabilities: [],
      allowedTools: [],
      permissions: [],
      budget: { maxTokens: tokenCeiling, maxFinancialCost: config.perRun.maxFinancialCost },
      timeLimitMs: config.perRun.timeLimitMs,
      actionLimit: config.perRun.actionLimit,
      evidenceRequirements: ["execution_record"],
    },
    nowMs,
  );
  const t1 = transition(lease0, { type: "TRIGGER", atMs: nowMs });
  if (!t1.ok) return { decision: "idle", state };
  const t2 = transition(t1.lease, {
    type: "MISSION_BIND",
    atMs: nowMs,
    missionId: runId,
    missionTenantRef: chosen.tenantRef,
  });
  if (!t2.ok) return { decision: "idle", state };

  const uKey = userKey(chosen.tenantRef, chosen.userRef);
  const ub = currentBucket(working, config, "user", uKey, nowMs);
  const tb = currentBucket(working, config, "tenant", chosen.tenantRef, nowMs);
  working = putBucket(working, { ...ub, wakes: ub.wakes + 1 });
  working = putBucket(working, { ...tb, wakes: tb.wakes + 1 });

  const run: InFlightRun = {
    runId,
    correlationId: chosen.correlationId,
    tenantRef: chosen.tenantRef,
    userRef: chosen.userRef,
    eventType: chosen.type,
    lease: t2.lease,
  };
  working = { ...working, queue: keep, inFlight: [...working.inFlight, run] };
  working = withAudit(working, nowMs, "wake_started", chosen.type, {
    correlationId: chosen.correlationId,
    tenantRef: chosen.tenantRef,
    userRef: chosen.userRef,
    runId,
  });
  return {
    decision: "wake",
    state: working,
    run: { runId, correlationId: chosen.correlationId, event: chosen, lease: t2.lease },
  };
}

function deadLetter(
  state: SleepWakeState,
  event: TwinWakeEvent,
  reason: DeadLetterReason,
  atMs: number,
): SleepWakeState {
  const next: SleepWakeState = {
    ...state,
    deadLetter: [...state.deadLetter, Object.freeze({ event, reason, atMs })],
  };
  return withAudit(next, atMs, "event_dead_lettered", reason, {
    correlationId: event.correlationId,
    tenantRef: event.tenantRef,
    userRef: event.userRef,
  });
}

/* ─────────────────────────────────────────────────────────────
 * Run progress
 * ────────────────────────────────────────────────────────────*/

export type RunStopReason = TerminationReason | "unknown_run" | "illegal_transition";

export type AdvanceResult =
  | { readonly ok: true; readonly state: SleepWakeState; readonly lease: RuntimeLease }
  | {
      readonly ok: false;
      readonly state: SleepWakeState;
      /** True when the run has been terminated and removed; the caller must stop work now. */
      readonly stopped: boolean;
      readonly reason: RunStopReason;
    };

function removeRun(state: SleepWakeState, runId: string): SleepWakeState {
  return { ...state, inFlight: state.inFlight.filter((r) => r.runId !== runId) };
}

function stopRun(
  state: SleepWakeState,
  run: InFlightRun,
  reason: TerminationReason,
  atMs: number,
): SleepWakeState {
  const at = Math.max(atMs, run.lease.lastEventAtMs);
  const t = transition(run.lease, { type: "TERMINATE", atMs: at, reason });
  void t; // The run is removed regardless of the lifecycle result: a stop must always stop.
  return withAudit(removeRun(state, run.runId), atMs, "run_stopped", reason, {
    correlationId: run.correlationId,
    tenantRef: run.tenantRef,
    userRef: run.userRef,
    runId: run.runId,
  });
}

/**
 * Apply one lifecycle event to a run. Checks the kill switch first, then the
 * lifecycle machine (expiry, action limit, per-run token cap), then the per-user
 * and per-tenant window budgets. Any stop terminates and removes the run at once.
 */
export function advanceRun(
  state: SleepWakeState,
  config: SleepWakeConfig,
  runId: string,
  event: LifecycleEvent,
  nowMs: number,
): AdvanceResult {
  const run = state.inFlight.find((r) => r.runId === runId);
  if (!run) {
    return {
      ok: false,
      state: withAudit(state, nowMs, "request_rejected", `advance:unknown_run:${event.type}`, {
        runId,
      }),
      stopped: false,
      reason: "unknown_run",
    };
  }

  if (killSwitchFor(state, run.tenantRef, run.userRef)) {
    return {
      ok: false,
      stopped: true,
      reason: "operator_stop",
      state: stopRun(state, run, "operator_stop", nowMs),
    };
  }

  // The worker may not use a lifecycle event to end the run itself except via
  // completeRun, which is what releases the slot. TERMINATE here is an abort.
  const result = transition(run.lease, event);
  if (!result.ok) {
    return {
      ok: false,
      state: withAudit(state, nowMs, "request_rejected", `advance:${result.reason}:${event.type}`, {
        correlationId: run.correlationId,
        tenantRef: run.tenantRef,
        userRef: run.userRef,
        runId,
      }),
      stopped: false,
      reason: "illegal_transition",
    };
  }
  if (result.forcedTermination) {
    return {
      ok: false,
      stopped: true,
      reason: result.forcedTermination,
      state: stopRun(state, run, result.forcedTermination, nowMs),
    };
  }

  let next = state;
  if (event.type === "REASON" && event.tokensUsed > 0) {
    const uKey = userKey(run.tenantRef, run.userRef);
    const ub = currentBucket(next, config, "user", uKey, nowMs);
    const tb = currentBucket(next, config, "tenant", run.tenantRef, nowMs);
    const ub2 = { ...ub, tokens: ub.tokens + event.tokensUsed };
    const tb2 = { ...tb, tokens: tb.tokens + event.tokensUsed };
    next = putBucket(putBucket(next, ub2), tb2);
    if (ub2.tokens > config.perUser.maxTokens || tb2.tokens > config.perTenant.maxTokens) {
      return {
        ok: false,
        stopped: true,
        reason: "budget_exhausted",
        state: stopRun(next, run, "budget_exhausted", nowMs),
      };
    }
  }

  const updated: InFlightRun = { ...run, lease: result.lease };
  next = {
    ...next,
    inFlight: next.inFlight.map((r) => (r.runId === runId ? updated : r)),
  };
  if (event.type === "TERMINATE") {
    next = removeRun(next, runId);
    next = withAudit(next, nowMs, "run_stopped", event.reason, {
      correlationId: run.correlationId,
      tenantRef: run.tenantRef,
      userRef: run.userRef,
      runId,
    });
    return { ok: true, state: next, lease: result.lease };
  }
  next = withAudit(next, nowMs, "run_progress", event.type, {
    correlationId: run.correlationId,
    tenantRef: run.tenantRef,
    userRef: run.userRef,
    runId,
  });
  return { ok: true, state: next, lease: result.lease };
}

export type CompleteResult =
  | { readonly ok: true; readonly state: SleepWakeState }
  | {
      readonly ok: false;
      readonly state: SleepWakeState;
      readonly reason: "unknown_run" | "run_not_asleep";
    };

/**
 * Close a finished run. The lease must already be in the sleeping state
 * (the worker issued SLEEP); the run is then terminated and its slot released,
 * so no twin stays alive after its event is handled.
 */
export function completeRun(state: SleepWakeState, runId: string, nowMs: number): CompleteResult {
  const run = state.inFlight.find((r) => r.runId === runId);
  if (!run) {
    return {
      ok: false,
      state: withAudit(state, nowMs, "request_rejected", "complete:unknown_run", { runId }),
      reason: "unknown_run",
    };
  }
  if (run.lease.state !== "sleeping") {
    return {
      ok: false,
      state: withAudit(state, nowMs, "request_rejected", "complete:run_not_asleep", {
        correlationId: run.correlationId,
        tenantRef: run.tenantRef,
        userRef: run.userRef,
        runId,
      }),
      reason: "run_not_asleep",
    };
  }
  const at = Math.max(nowMs, run.lease.lastEventAtMs);
  transition(run.lease, { type: "TERMINATE", atMs: at, reason: "mission_completed" });
  return {
    ok: true,
    state: withAudit(removeRun(state, runId), nowMs, "run_slept", "mission_completed", {
      correlationId: run.correlationId,
      tenantRef: run.tenantRef,
      userRef: run.userRef,
      runId,
    }),
  };
}

/**
 * Terminate runs whose lease has expired. The host calls this when it handles
 * any other event; nothing in this module polls.
 */
export function reapExpiredRuns(state: SleepWakeState, nowMs: number): SleepWakeState {
  let next = state;
  for (const run of state.inFlight) {
    if (nowMs > run.lease.expiresAtMs) next = stopRun(next, run, "lease_expired", nowMs);
  }
  return next;
}

/* ─────────────────────────────────────────────────────────────
 * Kill switch
 * ────────────────────────────────────────────────────────────*/

export interface KillSwitchRequest {
  readonly scope: KillSwitchScope;
  readonly tenantRef?: string;
  readonly userRef?: string;
  readonly actor: string;
  readonly reason: string;
}

export type KillSwitchResult =
  | { readonly ok: true; readonly state: SleepWakeState }
  | { readonly ok: false; readonly state: SleepWakeState; readonly reason: "invalid_request" };

function switchKey(req: KillSwitchRequest): string | null | undefined {
  if (req.scope === "global") return null;
  if (req.scope === "tenant") return nonEmpty(req.tenantRef) ? req.tenantRef : undefined;
  return nonEmpty(req.tenantRef) && nonEmpty(req.userRef)
    ? userKey(req.tenantRef, req.userRef)
    : undefined;
}

function matchesSwitch(sw: KillSwitch, tenantRef: string, userRef: string): boolean {
  return (
    sw.scope === "global" ||
    (sw.scope === "tenant" && sw.key === tenantRef) ||
    (sw.scope === "user" && sw.key === userKey(tenantRef, userRef))
  );
}

/** Engage a kill switch: drop matching queued events and stop matching runs in this call. */
export function engageKillSwitch(
  state: SleepWakeState,
  req: KillSwitchRequest,
  nowMs: number,
): KillSwitchResult {
  const key = switchKey(req);
  if (key === undefined || !nonEmpty(req.actor) || !nonEmpty(req.reason)) {
    return {
      ok: false,
      state: withAudit(state, nowMs, "request_rejected", `engage:invalid_request:${req.scope}`, {
        tenantRef: req.tenantRef ?? null,
        userRef: req.userRef ?? null,
      }),
      reason: "invalid_request",
    };
  }
  const sw: KillSwitch = Object.freeze({
    scope: req.scope,
    key,
    engagedAtMs: nowMs,
    actor: req.actor,
    reason: req.reason,
  });
  let next: SleepWakeState = { ...state, killSwitches: [...state.killSwitches, sw] };
  next = withAudit(next, nowMs, "kill_switch_engaged", `${req.scope}:${req.reason}`, {
    tenantRef: req.tenantRef ?? null,
    userRef: req.userRef ?? null,
  });
  for (const ev of state.queue) {
    if (matchesSwitch(sw, ev.tenantRef, ev.userRef)) {
      next = deadLetter(next, ev, "kill_switch", nowMs);
      next = { ...next, queue: next.queue.filter((q) => q.eventId !== ev.eventId) };
    }
  }
  for (const run of state.inFlight) {
    if (matchesSwitch(sw, run.tenantRef, run.userRef)) {
      next = stopRun(next, run, "operator_stop", nowMs);
    }
  }
  return { ok: true, state: next };
}

export function releaseKillSwitch(
  state: SleepWakeState,
  req: Omit<KillSwitchRequest, "reason"> & { readonly reason?: string },
  nowMs: number,
): KillSwitchResult {
  const key = switchKey({ ...req, reason: req.reason ?? "release" });
  const rejectRelease = (detail: string): KillSwitchResult => ({
    ok: false,
    state: withAudit(state, nowMs, "request_rejected", `release:${detail}:${req.scope}`, {
      tenantRef: req.tenantRef ?? null,
      userRef: req.userRef ?? null,
    }),
    reason: "invalid_request",
  });
  if (key === undefined || !nonEmpty(req.actor)) return rejectRelease("invalid_request");
  const remaining = state.killSwitches.filter((k) => !(k.scope === req.scope && k.key === key));
  if (remaining.length === state.killSwitches.length) return rejectRelease("no_such_switch");
  return {
    ok: true,
    state: withAudit(
      { ...state, killSwitches: remaining },
      nowMs,
      "kill_switch_released",
      req.scope,
      {
        tenantRef: req.tenantRef ?? null,
        userRef: req.userRef ?? null,
      },
    ),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Reporting
 * ────────────────────────────────────────────────────────────*/

export interface SleepWakeReport {
  readonly queued: number;
  readonly inFlight: number;
  readonly deadLettered: number;
  /** True when no event is queued and no run is alive: the system is costing nothing. */
  readonly idle: boolean;
  readonly auditRecords: number;
}

export function reportSleepWake(state: SleepWakeState): SleepWakeReport {
  return {
    queued: state.queue.length,
    inFlight: state.inFlight.length,
    deadLettered: state.deadLetter.length,
    idle: state.queue.length === 0 && state.inFlight.length === 0,
    auditRecords: state.audit.length,
  };
}
