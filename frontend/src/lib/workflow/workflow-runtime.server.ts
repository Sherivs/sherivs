import { randomUUID } from "node:crypto";
import { bindCallerKey, payloadDigest } from "@/lib/reliability/idempotency";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tenantId } from "@/lib/tenant-core";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import { startRun, type WorkflowActorScope, type WorkflowTrigger } from "./workflow-engine";
import {
  resolveWorkflowDataClass,
  workflowActionCategory,
  workflowActionDefinitionSchema,
  workflowDataClassRequired,
} from "./workflow-actions";
import {
  validateWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowRun,
} from "./workflow-contract";
import {
  retryDelaySeconds,
  type ClaimedWorkflowStep,
  type WorkflowEvent,
  type WorkflowRuntimePort,
  type WorkflowRunRecord,
  type WorkflowStepRecord,
  type WorkflowTransition,
  type WorkflowVersionRecord,
} from "./workflow-runtime";

type Row = Record<string, unknown>;

const timeAuthority = new TimeAuthority(new SystemClock());
/** How long a drafted action waits for human review (same as the WF-03 approval expiry). */
const DRAFT_REVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface DbError {
  code?: string;
}

interface DbResult<T> {
  data: T | null;
  error: DbError | null;
}

interface Query<T> extends PromiseLike<DbResult<T[]>> {
  select(columns?: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  order(column: string, options?: { ascending?: boolean }): Query<T>;
  limit(count: number): Query<T>;
  insert(values: Row | readonly Row[]): Query<T>;
  update(values: Row): Query<T>;
  upsert(
    values: Row | readonly Row[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): Query<T>;
}

interface WorkflowAdmin {
  from(table: string): Query<Row>;
  rpc(name: string, args: Row): PromiseLike<DbResult<Row[]>>;
}

function db(): WorkflowAdmin {
  return supabaseAdmin as unknown as WorkflowAdmin;
}

function value<T>(row: Row, key: string, guard: (candidate: unknown) => candidate is T): T {
  const candidate = row[key];
  if (!guard(candidate)) throw new Error("workflow_row_invalid");
  return candidate;
}

function text(row: Row, key: string): string {
  return value(row, key, (candidate): candidate is string => typeof candidate === "string");
}

function integer(row: Row, key: string): number {
  return value(row, key, (candidate): candidate is number => Number.isInteger(candidate));
}

function object(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
}

async function rows(query: PromiseLike<DbResult<Row[]>>): Promise<Row[]> {
  const result = await query;
  if (result.error)
    throw Object.assign(new Error("workflow_db_error"), { code: result.error.code });
  return result.data ?? [];
}

async function one(query: PromiseLike<DbResult<Row[]>>): Promise<Row | null> {
  return (await rows(query))[0] ?? null;
}

async function assertStepLease(client: WorkflowAdmin, step: ClaimedWorkflowStep): Promise<void> {
  const row = await one(
    client
      .from("wf_step_run")
      .select("status,attempt,lease_owner,lease_expires_at")
      .eq("org_id", step.orgId)
      .eq("id", step.id)
      .limit(1),
  );
  if (
    !row ||
    (row.status !== "claimed" && row.status !== "running") ||
    row.attempt !== step.attempt ||
    row.lease_owner !== step.leaseOwner ||
    typeof row.lease_expires_at !== "string" ||
    Date.parse(row.lease_expires_at) <= timeAuthority.now().atMs
  ) {
    throw Object.assign(new Error("workflow_step_lease_lost"), { code: "step.lease_lost" });
  }
}

function eventFromRow(row: Row): WorkflowEvent {
  const payload = object(row.payload);
  return {
    id: text(row, "id"),
    orgId: text(row, "org_id"),
    leaseOwner: text(row, "lease_owner"),
    eventType: text(row, "event_type"),
    dedupeKey: text(row, "dedupe_key"),
    depth: integer(row, "depth"),
    attempts: integer(row, "attempts"),
    payload: payload ?? {},
  };
}

function stepFromRow(row: Row): ClaimedWorkflowStep {
  return {
    id: text(row, "id"),
    orgId: text(row, "org_id"),
    leaseOwner: text(row, "lease_owner"),
    runId: text(row, "run_id"),
    stepKey: text(row, "step_key"),
    iteration: integer(row, "iteration"),
    status: text(row, "status"),
    attempt: integer(row, "attempt"),
    maxAttempts: integer(row, "max_attempts"),
    idempotencyKey: text(row, "idempotency_key"),
    timeoutSeconds: integer(row, "timeout_seconds"),
    actionClass: typeof row.action_class === "string" ? row.action_class : "unclassified",
    autonomyLevel:
      typeof row.autonomy_level === "string"
        ? (row.autonomy_level as ClaimedWorkflowStep["autonomyLevel"])
        : "suggest",
    budgetUnits: integer(row, "budget_units"),
    spentUnits: integer(row, "spent_units"),
  };
}

function workflowTrigger(value: unknown, eventType?: string): WorkflowTrigger {
  const trigger = object(value);
  if (trigger && trigger.kind === "event" && typeof trigger.eventType === "string") {
    return { kind: "event", eventType: trigger.eventType };
  }
  if (eventType) return { kind: "event", eventType };
  throw new Error("workflow_trigger_invalid");
}

function definitionFromGraph(
  graphValue: unknown,
  input: { orgId: string; definitionId: string; name: string; version: number; eventType?: string },
): WorkflowDefinition | null {
  const graph = object(graphValue);
  if (!graph || !Array.isArray(graph.steps)) return null;
  const steps = graph.steps.map((candidate) => {
    const step = object(candidate);
    if (!step || !workflowActionDefinitionSchema.safeParse(step.action).success) return candidate;
    const action = workflowActionDefinitionSchema.parse(step.action);
    const actionClass =
      typeof step.actionClass === "string"
        ? step.actionClass
        : action.kind === "task" || action.kind === "wait"
          ? "internal"
          : "communication";
    return {
      ...step,
      action,
      actionClass: workflowActionCategory({
        actionClass,
        recipientCount: action.recipientIds.length,
        hasAudienceSelector: action.audienceSelector !== undefined,
        dataClass: resolveWorkflowDataClass(action.dataClass, {
          required: workflowDataClassRequired(action.kind),
        }),
      }),
    };
  });
  const definition: WorkflowDefinition = {
    definitionId: input.definitionId,
    tenantRef: tenantId(input.orgId),
    name: input.name,
    version: String(input.version),
    trigger: workflowTrigger(graph.trigger, input.eventType),
    steps: steps as WorkflowDefinition["steps"],
    onFailure: (object(graph.onFailure) ?? { kind: "halt" }) as WorkflowDefinition["onFailure"],
    requiredApprovals: Array.isArray(graph.requiredApprovals)
      ? (graph.requiredApprovals as WorkflowDefinition["requiredApprovals"])
      : [],
  };
  return validateWorkflowDefinition(definition).ok ? definition : null;
}

function runState(value: unknown): WorkflowRun | null {
  const raw = object(value);
  const run = object(raw?.run);
  if (
    !run ||
    typeof run.runId !== "string" ||
    typeof run.definitionId !== "string" ||
    typeof run.tenantRef !== "string" ||
    !["running", "waiting_approval", "completed", "failed", "cancelled"].includes(
      String(run.state),
    ) ||
    !Array.isArray(run.history) ||
    !Array.isArray(run.pendingEvidence) ||
    !Array.isArray(run.evidence) ||
    !Array.isArray(run.attempts)
  )
    return null;
  return run as unknown as WorkflowRun;
}

function dbRunStatus(run: WorkflowRun): string {
  if (run.state === "completed") return "succeeded";
  if (run.state === "waiting_approval") return "waiting";
  return run.state;
}

function dbStepKind(kind: string): string {
  if (kind === "notification") return "notify";
  if (kind === "task") return "action";
  if (kind === "wait") return "wait";
  if (kind === "subflow") return "subflow";
  return kind;
}

async function agentForTemplate(client: WorkflowAdmin, templateId: string): Promise<string | null> {
  const row = await one(
    client.from("wf_template").select("agent_ref").eq("id", templateId).limit(1),
  );
  return typeof row?.agent_ref === "string" ? row.agent_ref : null;
}

export function createWorkflowRuntimePort(): WorkflowRuntimePort {
  const client = db();
  return {
    async claimDueEvents(worker, limit, leaseSeconds) {
      return (
        await rows(
          client.rpc("wf_claim_due_events", {
            p_worker: worker,
            p_limit: limit,
            p_lease_seconds: leaseSeconds,
          }),
        )
      ).map(eventFromRow);
    },

    async claimDueSteps(worker, limit, leaseSeconds) {
      return (
        await rows(
          client.rpc("wf_claim_due_steps", {
            p_worker: worker,
            p_limit: limit,
            p_lease_seconds: leaseSeconds,
          }),
        )
      ).map(stepFromRow);
    },

    async dispatchEvent(event) {
      try {
        const settings = await one(
          client
            .from("wf_org_settings")
            .select("workflows_enabled")
            .eq("org_id", event.orgId)
            .limit(1),
        );
        if (settings?.workflows_enabled !== true) {
          await client
            .from("wf_event")
            .update({
              status: "pending",
              lease_owner: null,
              lease_expires_at: null,
            })
            .eq("org_id", event.orgId)
            .eq("id", event.id);
          return "skipped";
        }
        const binding = await one(
          client
            .from("wf_trigger_binding")
            .select("id,definition_id")
            .eq("org_id", event.orgId)
            .eq("event_type", event.eventType)
            .eq("enabled", true)
            .order("created_at")
            .limit(1),
        );
        if (!binding) {
          await client
            .from("wf_event")
            .update({
              status: "ignored",
              lease_owner: null,
              lease_expires_at: null,
            })
            .eq("org_id", event.orgId)
            .eq("id", event.id);
          return "skipped";
        }
        const definitionId = text(binding, "definition_id");
        const definitionRow = await one(
          client
            .from("wf_definition")
            .select("id,name,current_version_id,status")
            .eq("org_id", event.orgId)
            .eq("id", definitionId)
            .limit(1),
        );
        if (
          !definitionRow ||
          definitionRow.status !== "active" ||
          typeof definitionRow.current_version_id !== "string"
        ) {
          return releaseEvent(client, event);
        }
        const version = await one(
          client
            .from("wf_version")
            .select(
              "id,version,graph,max_run_depth,max_steps_per_run,max_loop_iterations,default_max_attempts,run_timeout_seconds,state",
            )
            .eq("org_id", event.orgId)
            .eq("id", definitionRow.current_version_id)
            .limit(1),
        );
        if (!version || version.state !== "published") return releaseEvent(client, event);
        const definition = definitionFromGraph(version.graph, {
          orgId: event.orgId,
          definitionId,
          name: text(definitionRow, "name"),
          version: integer(version, "version"),
          eventType: event.eventType,
        });
        if (!definition) {
          await ignoreEvent(client, event);
          return "skipped";
        }

        const graph = object(version.graph);
        const templateAgentRef =
          typeof graph?.agentRef === "string"
            ? graph.agentRef
            : typeof graph?.templateId === "string"
              ? await agentForTemplate(client, graph.templateId)
              : null;
        const actor: WorkflowActorScope = {
          actorId: "workflow-runtime",
          tenantRef: tenantId(event.orgId),
          kind: templateAgentRef ? "ai" : "system",
          roleRef: null,
          agentRef: templateAgentRef,
          revoked: false,
        };
        const startedAt = timeAuthority.now().at;
        const id = randomUUID();
        const start = startRun(definition, {
          runId: id,
          actor,
          trigger: { kind: "event", eventType: event.eventType },
          now: startedAt,
        });
        if (!start.ok) {
          await ignoreEvent(client, event);
          return "skipped";
        }

        const firstStep = definition.steps[0];
        if (!firstStep) {
          await ignoreEvent(client, event);
          return "skipped";
        }
        const created = await rows(
          client.rpc("wf_create_event_run", {
            p_run: id,
            p_event: event.id,
            p_lease_owner: event.leaseOwner,
            p_binding: text(binding, "id"),
            p_template: typeof graph?.templateId === "string" ? graph.templateId : null,
            p_agent_ref: templateAgentRef,
            p_started_at: startedAt,
            p_deadline_at: new Date(
              timeAuthority.now().atMs + integer(version, "run_timeout_seconds") * 1000,
            ).toISOString(),
            p_max_depth: integer(version, "max_run_depth"),
            p_max_steps: integer(version, "max_steps_per_run"),
            p_step_key: firstStep.stepId,
            p_step_kind: dbStepKind(firstStep.kind),
            p_action_class: firstStep.actionClass ?? "unclassified",
            p_budget_units: firstStep.budgetUnits ?? 0,
            p_max_attempts: integer(version, "default_max_attempts"),
            p_timeout_seconds: firstStep.timeoutSeconds ?? 60,
            p_input: event.payload,
            p_run_state: { run: start.run },
          }),
        );
        if (created[0]?.created === true) return "succeeded";
        const existingRun = await one(
          client
            .from("wf_run")
            .select("id")
            .eq("org_id", event.orgId)
            .eq("idempotency_key", `wf-event:${event.id}`)
            .limit(1),
        );
        return existingRun ? "succeeded" : "skipped";
      } catch {
        return releaseEvent(client, event);
      }
    },

    async loadRun(orgId, runId): Promise<WorkflowRunRecord | null> {
      const row = await one(
        client
          .from("wf_run")
          .select(
            "id,org_id,version_id,started_by,agent_ref,status,step_count,max_steps,deadline_at",
          )
          .eq("org_id", orgId)
          .eq("id", runId)
          .limit(1),
      );
      if (!row) return null;
      const latest = await one(
        client
          .from("wf_run_event")
          .select("detail")
          .eq("org_id", orgId)
          .eq("run_id", runId)
          .eq("kind", "runtime.state")
          .order("id", { ascending: false })
          .limit(1),
      );
      const run = runState(latest?.detail);
      if (!run) return null;
      return {
        orgId,
        id: runId,
        versionId: text(row, "version_id"),
        run,
        actor: {
          actorId: typeof row.started_by === "string" ? row.started_by : "workflow-runtime",
          tenantRef: tenantId(orgId),
          kind: typeof row.agent_ref === "string" ? "ai" : "system",
          roleRef: null,
          agentRef: typeof row.agent_ref === "string" ? row.agent_ref : null,
          revoked: false,
        },
        stepCount: integer(row, "step_count"),
        maxSteps: integer(row, "max_steps"),
        deadlineAt: text(row, "deadline_at"),
      };
    },

    async loadVersion(orgId, versionId): Promise<WorkflowVersionRecord | null> {
      const row = await one(
        client
          .from("wf_version")
          .select("id,definition_id,version,graph,max_loop_iterations")
          .eq("org_id", orgId)
          .eq("id", versionId)
          .limit(1),
      );
      if (!row) return null;
      const definitionRow = await one(
        client
          .from("wf_definition")
          .select("id,name")
          .eq("org_id", orgId)
          .eq("id", row.definition_id)
          .limit(1),
      );
      if (!definitionRow) return null;
      const definition = definitionFromGraph(row.graph, {
        orgId,
        definitionId: text(definitionRow, "id"),
        name: text(definitionRow, "name"),
        version: integer(row, "version"),
      });
      return definition
        ? {
            orgId,
            id: versionId,
            definition,
            maxLoopIterations: integer(row, "max_loop_iterations"),
          }
        : null;
    },

    async loadSteps(orgId, runId): Promise<WorkflowStepRecord[]> {
      const result = await rows(
        client
          .from("wf_step_run")
          .select("id,step_key,iteration,input_ref")
          .eq("org_id", orgId)
          .eq("run_id", runId)
          .order("created_at"),
      );
      return result.map((row) => ({
        id: text(row, "id"),
        stepKey: text(row, "step_key"),
        iteration: integer(row, "iteration"),
        input: object(row.input_ref) ?? {},
      }));
    },

    async executeIdempotentEffect(orgId, step, costUnits, action) {
      const bound = bindCallerKey({
        callerKey: step.idempotencyKey,
        operationClass: "workflow.step",
        tenantId: orgId,
      });
      if (!bound.ok) throw new Error("workflow_idempotency_key_invalid");
      const table = client.from("cg_idempotency_record");
      const readRecord = () =>
        one(
          table
            .select("payload_digest")
            .eq("tenant_id", orgId)
            .eq("idempotency_key", bound.key)
            .limit(1),
        );
      const digest = payloadDigest({
        runId: step.runId,
        stepId: step.id,
        key: step.idempotencyKey,
      });
      const existing = await readRecord();
      if (existing) {
        if (existing.payload_digest !== digest) throw new Error("workflow_idempotency_conflict");
        return "replayed";
      }
      await assertStepLease(client, step);
      await action();
      await assertStepLease(client, step);
      const spent = await client
        .from("wf_step_run")
        .update({ spent_units: step.spentUnits + costUnits })
        .eq("org_id", orgId)
        .eq("id", step.id)
        .eq("lease_owner", step.leaseOwner)
        .eq("attempt", step.attempt)
        .eq("spent_units", step.spentUnits)
        .eq("budget_units", step.budgetUnits)
        .select("id");
      if (spent.error || !spent.data?.length) {
        throw Object.assign(new Error("workflow_budget_persist_failed"), {
          code: "budget.exhausted",
        });
      }
      const createdAt = timeAuthority.now().at;
      const inserted = await client.from("cg_idempotency_record").insert({
        tenant_id: orgId,
        idempotency_key: bound.key,
        scope: orgId,
        actor_id: "workflow-runtime",
        intent: "workflow.step",
        payload_digest: digest,
        status: "succeeded",
        reason: null,
        external_effect: "recorded_intent",
        response_ref: bound.key,
        created_at: createdAt,
        expires_at: new Date(timeAuthority.now().atMs + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      if (inserted.error) {
        if (inserted.error.code === "23505") {
          const recorded = await readRecord();
          if (recorded?.payload_digest === digest) return "replayed";
          if (recorded) throw new Error("workflow_idempotency_conflict");
        }
        throw Object.assign(new Error("workflow_idempotency_store_failed"), {
          code: inserted.error.code,
        });
      }
      return "executed";
    },

    async persistTransition(transition: WorkflowTransition): Promise<void> {
      if (transition.status === "waiting") {
        // wf_step_run_wait_fields: a waiting non-approval step needs resume_at. An action step
        // waits here when its dispatch produced a draft for human review (WF-06); the review
        // window matches the approval expiry. Set while the lease is still ours, so the same
        // RPC below can move it to waiting. The claimer never resumes waiting steps by itself.
        const marked = await client
          .from("wf_step_run")
          .update({
            resume_at: new Date(timeAuthority.now().atMs + DRAFT_REVIEW_WINDOW_MS).toISOString(),
          })
          .eq("id", transition.step.id)
          .eq("org_id", transition.step.orgId)
          .eq("lease_owner", transition.step.leaseOwner)
          .eq("attempt", transition.step.attempt);
        if (marked.error) throw new Error("workflow_transition_persist_failed");
      }
      const result = await client.rpc("wf_persist_step_transition", {
        p_step: transition.step.id,
        p_lease_owner: transition.step.leaseOwner,
        p_attempt: transition.step.attempt,
        p_step_status: transition.status,
        p_retry_at: transition.retryAt ?? null,
        p_error_code: transition.errorCode ?? null,
        p_run_status: transition.run ? dbRunStatus(transition.run) : null,
        p_run_finished_at: transition.run?.completedAt ?? null,
        p_run_state: transition.run ? { run: transition.run } : null,
        p_next_step_key: transition.nextStep?.stepKey ?? null,
        p_next_iteration: transition.nextStep?.iteration ?? null,
        p_next_kind: transition.nextStep ? dbStepKind(transition.nextStep.kind) : null,
        p_next_action_class: transition.nextStep?.actionClass ?? null,
        p_next_budget_units: transition.nextStep?.budgetUnits ?? null,
        p_next_idempotency_key: transition.nextStep?.idempotencyKey ?? null,
        p_next_max_attempts: transition.nextStep?.maxAttempts ?? null,
        p_next_timeout_seconds: transition.nextStep?.timeoutSeconds ?? null,
      });
      if (result.error) throw new Error("workflow_transition_persist_failed");
      if (!Array.isArray(result.data) || result.data[0]?.persisted !== true) {
        throw new Error("workflow_transition_not_applied");
      }
    },
  };
}

async function ignoreEvent(client: WorkflowAdmin, event: WorkflowEvent) {
  const result = await client
    .from("wf_event")
    .update({
      status: "ignored",
      lease_owner: null,
      lease_expires_at: null,
      updated_at: timeAuthority.now().at,
    })
    .eq("org_id", event.orgId)
    .eq("id", event.id)
    .eq("lease_owner", event.leaseOwner);
  if (result.error) throw new Error("workflow_event_update_failed");
}

async function releaseEvent(client: WorkflowAdmin, event: WorkflowEvent) {
  if (event.depth >= 16 || event.attempts >= 25) {
    await client
      .from("wf_event")
      .update({
        status: "dead",
        lease_owner: null,
        lease_expires_at: null,
        updated_at: timeAuthority.now().at,
      })
      .eq("org_id", event.orgId)
      .eq("id", event.id)
      .eq("lease_owner", event.leaseOwner);
    return "dead";
  }
  await client
    .from("wf_event")
    .update({
      status: "pending",
      lease_owner: null,
      lease_expires_at: null,
      next_attempt_at: new Date(
        timeAuthority.now().atMs + retryDelaySeconds(event.attempts) * 1000,
      ).toISOString(),
      updated_at: timeAuthority.now().at,
    })
    .eq("org_id", event.orgId)
    .eq("id", event.id)
    .eq("lease_owner", event.leaseOwner);
  return "retried";
}
