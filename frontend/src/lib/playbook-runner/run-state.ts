/**
 * Playbook run state machine (ENGINE-05, ADR-083). Pure, serialisable, resumable.
 *
 * A wake event starts at most one run of a playbook declared by the context's
 * Role Pack. A run moves through the playbook's capability steps in order; each
 * step is authorised by the broker (tool steps) or by the autonomy ladder
 * (internal steps) and the run STOPS at the first step that needs a human or is
 * denied. Nothing here executes anything: the orchestrator does, through ports.
 *
 * Fail-closed rules:
 *  - an event raised by a twin or agent can never start a run (no self-waking);
 *  - an event kind no playbook declares starts nothing;
 *  - a kill switch, an inactive context, a spent run cap or action budget refuse admission.
 */
import type { RolePack } from "../twin-engine/role-pack";

export const WAKE_SOURCES = ["user", "system", "scheduler", "workflow", "role_engine"] as const;
export type WakeSource = (typeof WAKE_SOURCES)[number];

export interface WakeEvent {
  readonly eventId: string;
  /** Matches a playbook's `wakeOn` id. */
  readonly kind: string;
  /** "agent" and "twin" are representable only so they can be refused. */
  readonly source: WakeSource | "agent" | "twin";
  readonly tenantRef: string;
  readonly contextId: string;
  readonly occurredAtMs: number;
  readonly correlationId: string;
  /** Opaque reference to what changed; never the record itself. */
  readonly subjectRef: string | null;
}

export type StepResult =
  | {
      readonly kind: "executed";
      readonly outcome: "succeeded" | "failed";
      readonly decisionId: string | null;
    }
  | {
      readonly kind: "not_executed";
      readonly why: "shadow" | "propose" | "replayed";
      readonly decisionId: string | null;
    }
  | { readonly kind: "denied"; readonly code: string; readonly decisionId: string | null }
  | { readonly kind: "awaiting"; readonly approver: string; readonly decisionId: string | null };

export interface StepRecord {
  readonly index: number;
  readonly capabilityId: string;
  readonly result: StepResult;
}

export type RunStatus = "running" | "awaiting_approval" | "completed" | "aborted";

export interface PendingApproval {
  readonly stepIndex: number;
  /** Null for an internal step, which has no ledger decision. */
  readonly decisionId: string | null;
  readonly approver: "role_owner" | "platform_staff" | "sheriff";
}

export interface PlaybookRun {
  readonly runId: string;
  readonly contextId: string;
  readonly tenantRef: string;
  readonly playbookId: string;
  readonly correlationId: string;
  readonly subjectRef: string | null;
  readonly startedAtMs: number;
  readonly status: RunStatus;
  readonly nextStep: number;
  readonly steps: readonly StepRecord[];
  readonly pending: PendingApproval | null;
  readonly abortReason: string | null;
}

export interface Usage {
  /** Runs already started today, per playbook id. */
  readonly runsToday: Readonly<Record<string, number>>;
  /** Brokered calls already made today by this context. */
  readonly actionsToday: number;
}

export type Admission =
  | { readonly admit: true; readonly playbookId: string }
  | {
      readonly admit: false;
      readonly reason:
        | "self_wake"
        | "unknown_wake"
        | "kill_switch"
        | "context_inactive"
        | "run_cap"
        | "action_budget"
        | "wrong_context";
    };

export function admitRun(input: {
  readonly pack: RolePack;
  readonly event: WakeEvent;
  readonly contextId: string;
  readonly contextTenantRef: string;
  readonly contextStatus: "active" | "pending_pack" | "suspended";
  readonly killSwitch: boolean;
  readonly usage: Usage;
}): Admission {
  const { pack, event } = input;
  if (event.source === "agent" || event.source === "twin")
    return { admit: false, reason: "self_wake" };
  if (input.killSwitch) return { admit: false, reason: "kill_switch" };
  if (event.contextId !== input.contextId || event.tenantRef !== input.contextTenantRef) {
    return { admit: false, reason: "wrong_context" };
  }
  if (input.contextStatus !== "active") return { admit: false, reason: "context_inactive" };
  const playbook = pack.playbooks.find((p) => p.wakeOn.includes(event.kind));
  if (!playbook) return { admit: false, reason: "unknown_wake" };
  if ((input.usage.runsToday[playbook.id] ?? 0) >= playbook.maxRunsPerDay) {
    return { admit: false, reason: "run_cap" };
  }
  if (input.usage.actionsToday >= pack.budget.dailyActions)
    return { admit: false, reason: "action_budget" };
  return { admit: true, playbookId: playbook.id };
}

export function startRun(event: WakeEvent, playbookId: string, runId: string): PlaybookRun {
  return {
    runId,
    contextId: event.contextId,
    tenantRef: event.tenantRef,
    playbookId,
    correlationId: event.correlationId,
    subjectRef: event.subjectRef,
    startedAtMs: event.occurredAtMs,
    status: "running",
    nextStep: 0,
    steps: [],
    pending: null,
    abortReason: null,
  };
}

export function recordStep(
  run: PlaybookRun,
  capabilityId: string,
  result: StepResult,
): PlaybookRun {
  const rec: StepRecord = { index: run.nextStep, capabilityId, result };
  return { ...run, steps: [...run.steps, rec], nextStep: run.nextStep + 1 };
}

export function resolveStep(run: PlaybookRun, index: number, result: StepResult): PlaybookRun {
  return { ...run, steps: run.steps.map((s) => (s.index === index ? { ...s, result } : s)) };
}

export const abortRun = (run: PlaybookRun, reason: string): PlaybookRun => ({
  ...run,
  status: "aborted",
  pending: null,
  abortReason: reason,
});

export const completeRun = (run: PlaybookRun): PlaybookRun => ({
  ...run,
  status: "completed",
  pending: null,
});

export const awaitApproval = (run: PlaybookRun, p: PendingApproval): PlaybookRun => ({
  ...run,
  status: "awaiting_approval",
  pending: p,
});

/** A shift report holds counts and ids only: never arguments, never payloads. */
export interface ShiftReport {
  readonly runId: string;
  readonly playbookId: string;
  readonly status: RunStatus;
  readonly correlationId: string;
  readonly stepsTotal: number;
  readonly executed: number;
  readonly failed: number;
  readonly notExecuted: number;
  readonly denied: number;
  readonly awaiting: number;
  readonly abortReason: string | null;
  readonly steps: readonly {
    readonly index: number;
    readonly capabilityId: string;
    readonly result: StepResult["kind"];
  }[];
}

export function shiftReport(run: PlaybookRun): ShiftReport {
  const count = (k: StepResult["kind"]) => run.steps.filter((s) => s.result.kind === k).length;
  return {
    runId: run.runId,
    playbookId: run.playbookId,
    status: run.status,
    correlationId: run.correlationId,
    stepsTotal: run.steps.length,
    executed: run.steps.filter(
      (s) => s.result.kind === "executed" && s.result.outcome === "succeeded",
    ).length,
    failed: run.steps.filter((s) => s.result.kind === "executed" && s.result.outcome === "failed")
      .length,
    notExecuted: count("not_executed"),
    denied: count("denied"),
    awaiting: count("awaiting"),
    abortReason: run.abortReason,
    steps: run.steps.map((s) => ({
      index: s.index,
      capabilityId: s.capabilityId,
      result: s.result.kind,
    })),
  };
}
