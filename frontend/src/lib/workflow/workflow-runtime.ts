import { metrics, trace, SpanStatusCode } from "@opentelemetry/api";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import {
  advance,
  planAuthorizedAction,
  recordStepEvidence,
  type AdvanceContext,
  type WorkflowActorScope,
  type WorkflowEvidenceRecord,
} from "./workflow-engine";
import type { WorkflowDefinition, WorkflowRun } from "./workflow-contract";
import type { WorkflowActionDefinition } from "./workflow-actions";
import {
  effectiveWorkflowAutonomy,
  WORKFLOW_ACTION_CATEGORY_CAPS,
  WORKFLOW_AUTONOMY_LEVELS,
} from "./workflow-actions";
import type { WorkflowAutonomyLevel } from "./workflow-actions";

export { effectiveWorkflowAutonomy, WORKFLOW_ACTION_CATEGORY_CAPS, WORKFLOW_AUTONOMY_LEVELS };
export type { WorkflowAutonomyLevel };
export type WorkflowActionClass =
  | "money_movement"
  | "safeguarding"
  | "credential_change"
  | "public_publish"
  | "mass_message"
  | "external_authority_share"
  | (string & {});

export function retryDelaySeconds(
  attempt: number,
  baseSeconds = 2,
  maxSeconds = 300,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, Math.min(20, Math.trunc(attempt) - 1));
  const base = Math.min(maxSeconds, baseSeconds * 2 ** exponent);
  const jitter = 0.5 + Math.min(1, Math.max(0, random()));
  return Math.max(1, Math.min(maxSeconds, Math.round(base * jitter)));
}

export function isWithinWorkflowDepth(depth: number, maxDepth: number): boolean {
  return Number.isInteger(depth) && Number.isInteger(maxDepth) && depth >= 0 && depth < maxDepth;
}

export function stepFailureStatus(attempt: number, maxAttempts: number): "retried" | "dead" {
  return attempt >= maxAttempts ? "dead" : "retried";
}

export interface WorkflowEvent {
  id: string;
  orgId: string;
  leaseOwner: string;
  eventType: string;
  dedupeKey: string;
  depth: number;
  attempts: number;
  payload: Record<string, unknown>;
}

export interface ClaimedWorkflowStep {
  id: string;
  orgId: string;
  leaseOwner: string;
  runId: string;
  stepKey: string;
  iteration: number;
  status: string;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string;
  timeoutSeconds: number;
  actionClass: WorkflowActionClass;
  autonomyLevel: WorkflowAutonomyLevel;
  budgetUnits: number;
  spentUnits: number;
}

export interface WorkflowRunRecord {
  orgId: string;
  id: string;
  versionId: string;
  run: WorkflowRun;
  actor: WorkflowActorScope;
  stepCount?: number;
  maxSteps?: number;
  deadlineAt?: string;
}

export interface WorkflowVersionRecord {
  orgId: string;
  id: string;
  definition: WorkflowDefinition;
  maxLoopIterations: number;
}

export interface WorkflowStepRecord {
  id: string;
  stepKey: string;
  iteration: number;
  input: Record<string, unknown>;
}

export interface WorkflowTransition {
  step: ClaimedWorkflowStep;
  run: WorkflowRun | null;
  nextStep?: {
    stepKey: string;
    iteration: number;
    kind: string;
    actionClass: string;
    budgetUnits: number;
    idempotencyKey: string;
    maxAttempts: number;
    timeoutSeconds: number;
  };
  status: "succeeded" | "retried" | "dead" | "skipped" | "waiting";
  retryAt?: string;
  errorCode?: string;
}

/** An approval step whose approval was decided "approved" and that is now leased for resuming (WF-07). */
export interface ApprovedStepClaim {
  step: ClaimedWorkflowStep;
  approval: { id: string; approvedBy: string; approvedAt: string };
}

export interface WorkflowRuntimePort {
  /** Optional: ports that cannot resume approved approval steps leave them waiting. */
  claimApprovedSteps?(
    worker: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<ApprovedStepClaim[]>;
  /** True while this person holds the role, in this organisation, right now. Needed only when the definition names a role. */
  approverHoldsRole?(orgId: string, userId: string, roleRef: string): Promise<boolean>;
  claimDueEvents(worker: string, limit: number, leaseSeconds: number): Promise<WorkflowEvent[]>;
  claimDueSteps(
    worker: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<ClaimedWorkflowStep[]>;
  dispatchEvent(event: WorkflowEvent): Promise<"succeeded" | "retried" | "dead" | "skipped">;
  loadRun(orgId: string, runId: string): Promise<WorkflowRunRecord | null>;
  loadVersion(orgId: string, versionId: string): Promise<WorkflowVersionRecord | null>;
  loadSteps(orgId: string, runId: string): Promise<WorkflowStepRecord[]>;
  executeIdempotentEffect(
    orgId: string,
    step: ClaimedWorkflowStep,
    costUnits: number,
    action: () => Promise<void>,
  ): Promise<"executed" | "replayed">;
  persistTransition(transition: WorkflowTransition): Promise<void>;
}

export interface WorkflowTickCounts {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
  skipped: number;
}

export interface WorkflowTickOptions {
  worker: string;
  limit?: number;
  leaseSeconds?: number;
  budgetMs?: number;
  now?: () => number;
  clock?: () => Date;
  random?: () => number;
  executeAction?: (input: {
    orgId: string;
    step: ClaimedWorkflowStep;
    action?: WorkflowActionDefinition;
    authorizedActions: readonly string[];
    planId: string;
    idempotencyKey: string;
    signal: AbortSignal;
  }) => Promise<void | { status: "draft" | "executed" }>;
  /**
   * Looks up what an earlier dispatch of this step's action produced. Called only when the
   * idempotent effect is replayed (the action callback is not run again). `null` means the
   * outcome is unknown; the runtime then fails closed and leaves the step waiting.
   */
  actionOutcome?: (input: {
    orgId: string;
    step: ClaimedWorkflowStep;
  }) => Promise<"draft" | "executed" | null>;
  estimateActionCost?: (input: {
    orgId: string;
    step: ClaimedWorkflowStep;
    planId: string;
    idempotencyKey: string;
  }) => number;
}

const tracer = trace.getTracer("sherivs-workflow-runtime");
const tickFailureCounter = metrics
  .getMeter("sherivs-workflow-runtime")
  .createCounter("workflow.tick.failures");
const timeAuthority = new TimeAuthority(new SystemClock());
const MAX_TICK_BUDGET_MS = 45_000;
const STOP_BEFORE_DEADLINE_MS = 2_000;

async function withTimeout<T>(timeoutSeconds: number, action: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => {
            controller.abort();
            reject(Object.assign(new Error("step_timeout"), { code: "step.timeout" }));
          },
          Math.max(1, timeoutSeconds) * 1000,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function countResult(counts: WorkflowTickCounts, status: WorkflowTransition["status"]) {
  counts[status === "waiting" ? "skipped" : status] += 1;
}

export async function runWorkflowTick(
  port: WorkflowRuntimePort,
  options: WorkflowTickOptions,
): Promise<WorkflowTickCounts> {
  const clock = options.clock ?? (() => new Date(timeAuthority.now().atMs));
  const monotonicNow = options.now ?? (() => performance.now());
  const startedAt = monotonicNow();
  const budgetMs = Math.min(
    MAX_TICK_BUDGET_MS,
    Math.max(1, options.budgetMs ?? MAX_TICK_BUDGET_MS),
  );
  const counts: WorkflowTickCounts = {
    claimed: 0,
    succeeded: 0,
    retried: 0,
    dead: 0,
    skipped: 0,
  };
  let tickFailed = false;

  await tracer.startActiveSpan("workflow.tick", async (tickSpan) => {
    try {
      if (budgetMs <= STOP_BEFORE_DEADLINE_MS) return;
      const eventSpan = tracer.startSpan("workflow.claim.events");
      let events: WorkflowEvent[] = [];
      try {
        events = await port.claimDueEvents(
          options.worker,
          options.limit ?? 50,
          options.leaseSeconds ?? 60,
        );
        counts.claimed += events.length;
        eventSpan.setAttribute("workflow.claimed.count", events.length);
      } catch {
        tickFailed = true;
        eventSpan.setStatus({ code: SpanStatusCode.ERROR });
        tickSpan.setAttribute("workflow.error_code", "event_claim_failed");
      } finally {
        eventSpan.end();
      }

      for (const event of events) {
        if (monotonicNow() - startedAt >= budgetMs - STOP_BEFORE_DEADLINE_MS) break;
        const span = tracer.startSpan("workflow.run.advance", {
          attributes: { "workflow.event.id": event.id, "workflow.org.id": event.orgId },
        });
        try {
          const result = await port.dispatchEvent(event);
          countResult(counts, result);
          if (result === "retried" || result === "dead") tickFailed = true;
          span.setAttribute("workflow.status", result);
        } catch {
          tickFailed = true;
          counts.retried += 1;
          span.setAttribute("workflow.status", "retried");
          span.setAttribute("workflow.error_code", "event_dispatch_failed");
        } finally {
          span.end();
        }
      }

      if (monotonicNow() - startedAt < budgetMs - STOP_BEFORE_DEADLINE_MS) {
        const claimSpan = tracer.startSpan("workflow.claim.steps");
        let steps: ClaimedWorkflowStep[] = [];
        try {
          steps = await port.claimDueSteps(
            options.worker,
            options.limit ?? 50,
            options.leaseSeconds ?? 60,
          );
          counts.claimed += steps.length;
          claimSpan.setAttribute("workflow.claimed.count", steps.length);
        } catch {
          tickFailed = true;
          claimSpan.setStatus({ code: SpanStatusCode.ERROR });
          tickSpan.setAttribute("workflow.error_code", "step_claim_failed");
        } finally {
          claimSpan.end();
        }

        for (const step of steps) {
          if (monotonicNow() - startedAt >= budgetMs - STOP_BEFORE_DEADLINE_MS) break;
          const span = tracer.startSpan("workflow.step.execute", {
            attributes: {
              "workflow.step.id": step.id,
              "workflow.run.id": step.runId,
              "workflow.org.id": step.orgId,
              "workflow.step.attempt": step.attempt,
            },
          });
          let transition: WorkflowTransition;
          try {
            transition = await advanceClaimedStep(port, step, {
              clock,
              random: options.random,
              executeAction: options.executeAction,
              actionOutcome: options.actionOutcome,
              estimateActionCost: options.estimateActionCost,
              timeoutMs: Math.max(
                1,
                budgetMs - (monotonicNow() - startedAt) - STOP_BEFORE_DEADLINE_MS,
              ),
            });
            await port.persistTransition(transition);
            span.setAttribute("workflow.status", transition.status);
            countResult(counts, transition.status);
            if (transition.status === "retried" || transition.status === "dead") {
              tickFailed = true;
            }
          } catch (error) {
            tickFailed = true;
            const errorCode =
              error instanceof Error && "code" in error && typeof error.code === "string"
                ? error.code
                : "step.failed";
            let dead =
              errorCode === "budget.exhausted" ||
              stepFailureStatus(step.attempt, step.maxAttempts) === "dead";
            const failedRun = await port.loadRun(step.orgId, step.runId);
            const failedVersion = failedRun
              ? await port.loadVersion(failedRun.orgId, failedRun.versionId)
              : null;
            let run = failedRun?.run ?? null;
            if (failedRun && failedVersion) {
              const definition = dead
                ? { ...failedVersion.definition, onFailure: { kind: "halt" as const } }
                : failedVersion.definition;
              const failure = advance(
                definition,
                failedRun.run,
                { kind: "failure", reason: errorCode, at: clock().toISOString() },
                { actor: failedRun.actor, now: clock().toISOString() },
              );
              run = failure.run;
              if (!dead && !failure.ok) dead = true;
            }
            if (dead && run?.state !== "failed") run = null;
            transition = {
              step,
              run,
              status: dead ? "dead" : "retried",
              ...(dead
                ? { errorCode }
                : {
                    retryAt: new Date(
                      clock().getTime() +
                        retryDelaySeconds(step.attempt, 2, 300, options.random) * 1000,
                    ).toISOString(),
                    errorCode,
                  }),
            };
            await port.persistTransition(transition);
            span.setAttribute("workflow.status", transition.status);
            span.setAttribute("workflow.error_code", transition.errorCode ?? "step.failed");
            countResult(counts, transition.status);
          } finally {
            span.end();
          }
        }
      }
      if (port.claimApprovedSteps && monotonicNow() - startedAt < budgetMs - STOP_BEFORE_DEADLINE_MS) {
        let approved: ApprovedStepClaim[] = [];
        try {
          approved = await port.claimApprovedSteps(
            options.worker,
            options.limit ?? 50,
            options.leaseSeconds ?? 60,
          );
          counts.claimed += approved.length;
        } catch {
          tickFailed = true;
          tickSpan.setAttribute("workflow.error_code", "approved_step_claim_failed");
        }
        for (const claim of approved) {
          if (monotonicNow() - startedAt >= budgetMs - STOP_BEFORE_DEADLINE_MS) break;
          try {
            const transition = await resumeApprovedStep(port, claim, clock);
            await port.persistTransition(transition);
            countResult(counts, transition.status);
            if (transition.status === "dead") tickFailed = true;
          } catch {
            // The lease expires and the step is claimed again; nothing is advanced on a failed persist.
            tickFailed = true;
          }
        }
      }
      tickSpan.setAttribute("workflow.claimed.count", counts.claimed);
      tickSpan.setAttribute("workflow.succeeded.count", counts.succeeded);
      tickSpan.setAttribute("workflow.retried.count", counts.retried);
      tickSpan.setAttribute("workflow.dead.count", counts.dead);
      tickSpan.setAttribute("workflow.skipped.count", counts.skipped);
    } catch (error) {
      tickFailed = true;
      throw error;
    } finally {
      if (tickFailed) {
        tickSpan.setStatus({ code: SpanStatusCode.ERROR });
        tickFailureCounter.add(1);
      }
      tickSpan.end();
    }
  });
  return counts;
}

async function advanceClaimedStep(
  port: WorkflowRuntimePort,
  step: ClaimedWorkflowStep,
  options: Pick<
    WorkflowTickOptions,
    "clock" | "random" | "executeAction" | "actionOutcome" | "estimateActionCost"
  > & { timeoutMs: number },
): Promise<WorkflowTransition> {
  const record = await port.loadRun(step.orgId, step.runId);
  const [version, steps] = record
    ? await Promise.all([
        port.loadVersion(record.orgId, record.versionId),
        port.loadSteps(step.orgId, step.runId),
      ])
    : [null, []];
  if (!record || !version) {
    return { step, run: record?.run ?? null, status: "dead", errorCode: "run_context_missing" };
  }
  if (!isWithinWorkflowDepth(step.iteration, version.maxLoopIterations)) {
    return { step, run: record.run, status: "dead", errorCode: "loop_depth_exceeded" };
  }
  const currentStep = version.definition.steps.find((item) => item.stepId === step.stepKey);
  if (!currentStep || record.run.currentStepId !== currentStep.stepId) {
    return { step, run: record.run, status: "skipped" };
  }
  if (currentStep.kind === "approval") {
    return { step, run: record.run, status: "waiting" };
  }
  const clock = options.clock ?? (() => new Date(timeAuthority.now().atMs));
  const context: AdvanceContext = { actor: record.actor, now: clock().toISOString() };

  if (currentStep.kind === "action") {
    const planned = planAuthorizedAction(version.definition, record.run, null, context);
    if (!planned.ok) {
      throw Object.assign(new Error("action_not_authorized"), { code: planned.denyCode });
    }
    if (
      options.executeAction &&
      (currentStep.action !== undefined || step.autonomyLevel === "act_and_report")
    ) {
      const costUnits =
        options.estimateActionCost?.({
          orgId: step.orgId,
          step,
          planId: planned.plan.planId,
          idempotencyKey: step.idempotencyKey,
        }) ?? (step.autonomyLevel === "act_and_report" ? 1 : 0);
      if (
        !Number.isInteger(costUnits) ||
        costUnits < 0 ||
        step.spentUnits + costUnits > step.budgetUnits
      ) {
        throw Object.assign(new Error("budget_exhausted"), { code: "budget.exhausted" });
      }
      const actionResult: { value?: void | { status: "draft" | "executed" } } = {};
      const effectStatus = await withTimeout(
        Math.min(step.timeoutSeconds, Math.max(1, Math.floor(options.timeoutMs / 1000))),
        async (signal) => {
          let status: "executed" | "replayed" = "executed";
          status = await port.executeIdempotentEffect(step.orgId, step, costUnits, async () => {
            actionResult.value = await options.executeAction!({
              orgId: step.orgId,
              step,
              ...(currentStep.action ? { action: currentStep.action } : {}),
              authorizedActions: currentStep.authorizedActions,
              planId: planned.plan.planId,
              idempotencyKey: step.idempotencyKey,
              signal,
            });
          });
          return status;
        },
      );
      if (actionResult.value?.status === "draft") {
        return { step, run: record.run, status: "waiting" };
      }
      if (effectStatus === "replayed") {
        // The callback did not run, so its result is unknown here. A replay must not advance
        // the run as if the action executed when the original dispatch produced a draft.
        const replayedOutcome =
          currentStep.action !== undefined
            ? options.actionOutcome
              ? await options.actionOutcome({ orgId: step.orgId, step })
              : null
            : step.autonomyLevel === "draft"
              ? "draft"
              : "executed";
        if (replayedOutcome !== "executed") {
          return { step, run: record.run, status: "waiting" };
        }
      }
    }
  }

  const advanced = advance(
    version.definition,
    record.run,
    {
      kind: "step_input",
      payload: steps.find((item) => item.id === step.id)?.input ?? {},
      at: context.now,
    },
    context,
  );
  if (!advanced.ok) {
    if (advanced.denyCode === "evidence_pending") {
      return { step, run: advanced.run, status: "skipped" };
    }
    throw Object.assign(new Error("advance_denied"), { code: advanced.denyCode });
  }

  return settleAdvancedStep(step, record, version, steps, currentStep, advanced, context);
}

/**
 * Everything that happens after the engine has accepted a step: record its evidence, then complete the run,
 * stop it at the step or loop limit, or hand back the next step. Shared by claimed steps and by approved
 * approval steps (WF-07 resume), so both settle a step the same way.
 */
export function settleAdvancedStep(
  step: ClaimedWorkflowStep,
  record: WorkflowRunRecord,
  version: WorkflowVersionRecord,
  steps: WorkflowStepRecord[],
  currentStep: WorkflowDefinition["steps"][number],
  advanced: { run: WorkflowRun },
  context: AdvanceContext,
  /** True when the engine held the run at its last step only for this step's evidence (so complete it once recorded). */
  completesRun = false,
): WorkflowTransition {
  const evidenceKind =
    currentStep.kind === "approval"
      ? "approval_recorded"
      : currentStep.kind === "condition"
      ? "condition_evaluated"
      : currentStep.kind === "action"
        ? "action_planned"
        : currentStep.kind === "notification"
          ? "notification_delivered"
          : "task_completed";
  const evidence: WorkflowEvidenceRecord = {
    evidenceId: `${step.idempotencyKey}:evidence`,
    runId: advanced.run.runId,
    stepId: currentStep.stepId,
    evidenceKind,
    producer: "workflow-runtime",
    actorId: record.actor.actorId,
    tenantRef: record.run.tenantRef,
    recordedAt: context.now,
    provenance: "workflow-runtime",
    integrity: step.idempotencyKey,
  };
  const recorded = recordStepEvidence(advanced.run, evidence);
  if (!recorded.ok)
    throw Object.assign(new Error("evidence_rejected"), { code: recorded.denyCode });
  if (recorded.run.currentStepId === null || completesRun) {
    const completed = advance(
      version.definition,
      recorded.run,
      { kind: "complete", at: context.now },
      context,
    );
    if (completed.ok) return { step, run: completed.run, status: "succeeded" };
  }
  const nextId = recorded.run.currentStepId;
  const nextDefinitionStep =
    nextId === null ? undefined : version.definition.steps.find((item) => item.stepId === nextId);
  if (
    nextDefinitionStep &&
    record.stepCount !== undefined &&
    record.maxSteps !== undefined &&
    record.stepCount + 1 >= record.maxSteps
  ) {
    const stopped = advance(
      { ...version.definition, onFailure: { kind: "halt" } },
      recorded.run,
      { kind: "failure", reason: "step_limit_exceeded", at: context.now },
      context,
    );
    return {
      step,
      run: stopped.run,
      status: "succeeded",
      errorCode: "step_limit_exceeded",
    };
  }
  const nextIteration =
    nextId === null ? 0 : steps.filter((item) => item.stepKey === nextId).length;
  if (nextDefinitionStep && nextIteration >= version.maxLoopIterations) {
    const stopped = advance(
      version.definition,
      recorded.run,
      { kind: "failure", reason: "loop_depth_exceeded", at: context.now },
      context,
    );
    return {
      step,
      run: stopped.ok ? stopped.run : recorded.run,
      status: "dead",
      errorCode: "loop_depth_exceeded",
    };
  }
  return {
    step,
    run: recorded.run,
    status: "succeeded",
    ...(nextDefinitionStep
      ? {
          nextStep: {
            stepKey: nextDefinitionStep.stepId,
            iteration: nextIteration,
            kind: nextDefinitionStep.kind,
            actionClass: nextDefinitionStep.actionClass ?? "unclassified",
            budgetUnits: nextDefinitionStep.budgetUnits ?? 0,
            idempotencyKey: `wf-step:${recorded.run.runId}:${nextDefinitionStep.stepId}:${nextIteration}`,
            maxAttempts: step.maxAttempts,
            timeoutSeconds: step.timeoutSeconds,
          },
        }
      : {}),
  };
}

/**
 * Resumes one approval step after people approved it. The approval itself was already decided and
 * checked by the database (wf_decide_approval: permission, separation of duties, passkey for high
 * risk). This adds the one rule the database does not know, the role a definition names for the step,
 * then lets the engine move the run exactly as it would for any step. An AI can never be the approver.
 * Fails closed: if the engine refuses, the run ends failed with the engine's own code.
 */
export async function resumeApprovedStep(
  port: WorkflowRuntimePort,
  claim: ApprovedStepClaim,
  clock: () => Date,
): Promise<WorkflowTransition> {
  const { step, approval } = claim;
  const record = await port.loadRun(step.orgId, step.runId);
  const [version, steps] = record
    ? await Promise.all([
        port.loadVersion(record.orgId, record.versionId),
        port.loadSteps(step.orgId, step.runId),
      ])
    : [null, []];
  if (!record || !version) {
    return { step, run: record?.run ?? null, status: "dead", errorCode: "run_context_missing" };
  }
  const currentStep = version.definition.steps.find((item) => item.stepId === step.stepKey);
  if (!currentStep || currentStep.kind !== "approval" || record.run.currentStepId !== currentStep.stepId) {
    return { step, run: record.run, status: "skipped" };
  }
  const now = clock().toISOString();
  const context: AdvanceContext = { actor: record.actor, now };
  const requirement = version.definition.requiredApprovals.find(
    (item) => item.stepId === currentStep.stepId,
  );
  const roleOk = requirement
    ? ((await port.approverHoldsRole?.(step.orgId, approval.approvedBy, requirement.approverRoleRef)) ?? false)
    : true;
  const advanced = roleOk
    ? advance(
        version.definition,
        record.run,
        {
          kind: "approval",
          record: {
            recordId: approval.id,
            stepId: currentStep.stepId,
            decision: "approved",
            approver: {
              kind: "human",
              humanRef: approval.approvedBy,
              roleRef: requirement?.approverRoleRef ?? "approver",
            },
            decidedAt: approval.approvedAt,
          },
          at: now,
        },
        context,
      )
    : null;
  // On the last step the engine returns "evidence_pending" with the run already approved and the
  // expectation for this step's evidence added: record that evidence and complete, as any final step does.
  const lastStep = advanced !== null && !advanced.ok && advanced.denyCode === "evidence_pending";
  if (!advanced || (!advanced.ok && !lastStep)) {
    const code = advanced && !advanced.ok ? advanced.denyCode : "approver_role_mismatch";
    const stopped = advance(
      { ...version.definition, onFailure: { kind: "halt" } },
      record.run,
      { kind: "failure", reason: code, at: now },
      context,
    );
    return {
      step,
      run: stopped.run.state === "failed" ? stopped.run : null,
      status: "dead",
      errorCode: `approval.${code}`.slice(0, 64),
    };
  }
  return settleAdvancedStep(step, record, version, steps, currentStep, advanced, context, lastStep);
}

export class InMemoryWorkflowRuntimePort implements WorkflowRuntimePort {
  readonly events: WorkflowEvent[] = [];
  readonly runs = new Map<string, WorkflowRunRecord>();
  readonly versions = new Map<string, WorkflowVersionRecord>();
  readonly steps = new Map<string, WorkflowStepRecord[]>();
  readonly stepsToClaim: ClaimedWorkflowStep[] = [];
  readonly approvedToClaim: ApprovedStepClaim[] = [];
  readonly rolesByUser = new Map<string, Set<string>>();
  readonly completedEffects = new Set<string>();
  readonly transitions: WorkflowTransition[] = [];
  private readonly eventRuns = new Map<string, string>();
  private readonly spentUnitsByStep = new Map<string, number>();

  get createdEventRunCount(): number {
    return this.eventRuns.size;
  }

  async claimDueEvents(
    _worker: string,
    _limit: number,
    _leaseSeconds: number,
  ): Promise<WorkflowEvent[]> {
    return this.events.splice(0);
  }

  async claimDueSteps(
    _worker: string,
    _limit: number,
    _leaseSeconds: number,
  ): Promise<ClaimedWorkflowStep[]> {
    return this.stepsToClaim.splice(0);
  }

  async claimApprovedSteps(
    _worker: string,
    _limit: number,
    _leaseSeconds: number,
  ): Promise<ApprovedStepClaim[]> {
    return this.approvedToClaim.splice(0);
  }

  async approverHoldsRole(_orgId: string, userId: string, roleRef: string): Promise<boolean> {
    return this.rolesByUser.get(userId)?.has(roleRef) ?? false;
  }

  async dispatchEvent(event: WorkflowEvent): Promise<"succeeded" | "retried" | "dead" | "skipped"> {
    const key = `${event.orgId}:${event.dedupeKey}`;
    if (this.eventRuns.has(key)) return "skipped";
    this.eventRuns.set(key, `memory-run-${this.eventRuns.size + 1}`);
    return "succeeded";
  }

  async loadRun(orgId: string, runId: string): Promise<WorkflowRunRecord | null> {
    const run = this.runs.get(runId);
    return run?.orgId === orgId ? run : null;
  }

  async loadVersion(orgId: string, versionId: string): Promise<WorkflowVersionRecord | null> {
    const version = this.versions.get(versionId);
    return version?.orgId === orgId ? version : null;
  }

  async loadSteps(orgId: string, runId: string): Promise<WorkflowStepRecord[]> {
    return (this.steps.get(runId) ?? []).filter((step) => this.runs.get(runId)?.orgId === orgId);
  }

  async executeIdempotentEffect(
    orgId: string,
    step: ClaimedWorkflowStep,
    costUnits: number,
    action: () => Promise<void>,
  ): Promise<"executed" | "replayed"> {
    const key = `${orgId}:${step.idempotencyKey}`;
    if (this.completedEffects.has(key)) return "replayed";
    const spentUnits = Math.max(step.spentUnits, this.spentUnitsByStep.get(key) ?? 0);
    if (
      !Number.isInteger(costUnits) ||
      costUnits < 0 ||
      spentUnits + costUnits > step.budgetUnits
    ) {
      throw Object.assign(new Error("budget_exhausted"), { code: "budget.exhausted" });
    }
    await action();
    this.completedEffects.add(key);
    this.spentUnitsByStep.set(key, spentUnits + costUnits);
    return "executed";
  }

  async persistTransition(transition: WorkflowTransition): Promise<void> {
    this.transitions.push(transition);
    if (!transition.run) return;
    const run = this.runs.get(transition.run.runId);
    if (run) run.run = transition.run;
  }
}
