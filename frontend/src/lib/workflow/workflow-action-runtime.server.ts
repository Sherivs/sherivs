import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import { effectiveAutonomy } from "../twin-engine/autonomy-ladder";
import { parseRolePack } from "../twin-engine/role-pack";
import { createToolLedgerDb } from "../tool-broker/tool-ledger-db.server";
import { validateConnectorBinding } from "../tool-broker/connector-vault";
import type { ConnectorBinding } from "../tool-broker/connector-vault";
import type { ActingContext, BrokerState } from "../tool-broker/broker";
import type { ToolDefinition } from "../tool-broker/tool-contract";
import type { ConnectorAdapter, HttpPort } from "../connector-adapters/adapter-contract";
import type { WorkflowTickOptions } from "./workflow-runtime";
import {
  parseWorkflowDeliveryMode,
  WORKFLOW_ACTION_KINDS,
  type WorkflowDeliveryEnvironment,
} from "./workflow-actions";
import {
  dispatchWorkflowAction,
  type WorkflowActionType,
} from "./workflow-action-dispatcher.server";
import {
  dispatchApprovedWorkflowDraft,
  type ApprovedDraftPorts,
  type ApprovedWorkflowDraft,
} from "./workflow-approved-draft.server";
import {
  runWorkflowApprovalSweep,
  type ApprovalSweepCounts,
} from "./workflow-approval-sweep.server";

type Row = Record<string, unknown>;
const timeAuthority = new TimeAuthority(new SystemClock());

interface DbError {
  code?: string;
  message?: string;
}

interface DbResult<T> {
  data: T | null;
  error: DbError | null;
}

interface Query<T> extends PromiseLike<DbResult<T[]>> {
  select(columns?: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: readonly unknown[]): Query<T>;
  gte(column: string, value: unknown): Query<T>;
  is(column: string, value: null | boolean): Query<T>;
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
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult<unknown>>;
}

function db(): WorkflowAdmin {
  return supabaseAdmin as unknown as WorkflowAdmin;
}

async function rows(query: PromiseLike<DbResult<Row[]>>): Promise<Row[]> {
  const result = await query;
  if (result.error)
    throw Object.assign(new Error("workflow_action_db_error"), { code: result.error.code });
  return result.data ?? [];
}

async function one(query: PromiseLike<DbResult<Row[]>>): Promise<Row | null> {
  return (await rows(query))[0] ?? null;
}

function connectorBinding(row: Row | null): ConnectorBinding | null {
  if (
    !row ||
    typeof row.connector !== "string" ||
    typeof row.scope !== "string" ||
    typeof row.secret_ref !== "string" ||
    typeof row.status !== "string"
  ) {
    return null;
  }
  const candidate = {
    connector: row.connector,
    scope: row.scope,
    ...(typeof row.tenant_ref === "string" ? { tenantRef: row.tenant_ref } : {}),
    secretRef: row.secret_ref,
    status: row.status,
  };
  return validateConnectorBinding(candidate).length === 0 ? (candidate as ConnectorBinding) : null;
}

function parseActionType(row: Row | null): WorkflowActionType | null {
  if (
    !row ||
    typeof row.kind !== "string" ||
    typeof row.category !== "string" ||
    typeof row.effect !== "string" ||
    typeof row.max_autonomy !== "string" ||
    (row.broker_tool_id !== null && typeof row.broker_tool_id !== "string") ||
    (row.broker_version !== null && typeof row.broker_version !== "string")
  ) {
    return null;
  }
  return {
    kind: row.kind,
    category: row.category,
    brokerToolId: row.broker_tool_id,
    brokerVersion: row.broker_version,
    effect: row.effect,
    maxAutonomy: row.max_autonomy as WorkflowActionType["maxAutonomy"],
  };
}

const DRAFT_AUDIENCES = new Set(["whole_class", "all_guardians", "all_staff"]);
const DRAFT_DATA_CLASSES = new Set(["public", "internal", "confidential", "minor_sensitive"]);

function parseApprovedDraft(row: Row): ApprovedWorkflowDraft | null {
  const params = row.template_params;
  if (
    typeof row.id !== "string" ||
    typeof row.org_id !== "string" ||
    typeof row.run_id !== "string" ||
    typeof row.step_run_id !== "string" ||
    typeof row.kind !== "string" ||
    typeof row.category !== "string" ||
    typeof row.idempotency_key !== "string" ||
    typeof row.approval_id !== "string" ||
    typeof row.data_class !== "string" ||
    !DRAFT_DATA_CLASSES.has(row.data_class) ||
    !Array.isArray(row.recipient_ids) ||
    !row.recipient_ids.every((id) => typeof id === "string") ||
    typeof params !== "object" ||
    params === null ||
    Array.isArray(params) ||
    !Object.values(params).every((v) => ["string", "number", "boolean"].includes(typeof v)) ||
    (row.audience_selector !== null &&
      !(typeof row.audience_selector === "string" && DRAFT_AUDIENCES.has(row.audience_selector))) ||
    (row.template_ref !== null && typeof row.template_ref !== "string") ||
    (row.webhook_target_id !== null && typeof row.webhook_target_id !== "string")
  ) {
    return null;
  }
  return {
    draftId: row.id,
    approvalId: row.approval_id,
    orgId: row.org_id,
    runId: row.run_id,
    stepRunId: row.step_run_id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    category: row.category,
    templateRef: row.template_ref,
    templateParams: params as Record<string, string | number | boolean>,
    recipientIds: row.recipient_ids as string[],
    audienceSelector: row.audience_selector as ApprovedWorkflowDraft["audienceSelector"],
    dataClass: row.data_class as ApprovedWorkflowDraft["dataClass"],
    webhookTargetId: row.webhook_target_id,
  };
}

export interface WorkflowActionRuntimeDependencies {
  /**
   * Outbound provider adapters for `live` delivery, keyed by connector. None are bound in v1, so
   * live delivery is refused with `workflow_live_adapter_unavailable`. Tests inject counting stubs.
   */
  readonly adapters?: Readonly<Record<string, ConnectorAdapter>>;
  readonly http?: HttpPort;
}

type ExecuteAction = NonNullable<WorkflowTickOptions["executeAction"]>;
type ActionOutcome = NonNullable<WorkflowTickOptions["actionOutcome"]>;

const WORKFLOW_ACTION_TOOL_IDS = WORKFLOW_ACTION_KINDS.map((kind) => `workflow.action.${kind}`);

/** The production executor plus the replay outcome lookup the tick needs (review note 1). */
export function createWorkflowActionRuntime(
  env: WorkflowDeliveryEnvironment = process.env,
  dependencies: WorkflowActionRuntimeDependencies = {},
): { executeAction: ExecuteAction; actionOutcome: ActionOutcome } {
  const executeAction = createWorkflowActionExecutor(env, dependencies);
  const client = db();
  const actionOutcome: ActionOutcome = async ({ orgId, step }) => {
    // The executed record comes first: an approved draft keeps its draft row (status approved) and
    // gains an outbox row once dispatched. A replayed step must then continue, not wait again.
    const sandbox = await one(
      client
        .from("wf_action_sandbox_outbox")
        .select("id")
        .eq("org_id", orgId)
        .eq("idempotency_key", step.idempotencyKey)
        .limit(1),
    );
    if (sandbox) return "executed";
    const draft = await one(
      client
        .from("wf_action_draft")
        .select("id")
        .eq("org_id", orgId)
        .eq("idempotency_key", step.idempotencyKey)
        .limit(1),
    );
    if (draft) return "draft";
    const decisions = await rows(
      client
        .from("cg_tool_call_ledger")
        .select("id")
        .eq("kind", "decision")
        .eq("tenant_ref", orgId)
        .eq("verdict", "execute")
        .eq("idempotency_key", step.idempotencyKey)
        .in("tool_id", WORKFLOW_ACTION_TOOL_IDS)
        .limit(2),
    );
    const decisionIds = decisions
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string");
    if (decisionIds.length !== 1) return null;
    const succeeded = await one(
      client
        .from("cg_tool_call_ledger")
        .select("id")
        .eq("kind", "outcome")
        .eq("parent_id", decisionIds[0])
        .eq("outcome", "succeeded")
        .limit(1),
    );
    return succeeded ? "executed" : null;
  };
  return { executeAction, actionOutcome };
}

/**
 * The dispatcher ports over the real stores. Shared by the executor (first dispatch of an action)
 * and the approval sweep (dispatch of a draft after approval), so both apply the same broker
 * authority, the same recipient/template/webhook checks and the same kill switch.
 */
export function createWorkflowActionPorts(
  env: WorkflowDeliveryEnvironment = process.env,
  dependencies: WorkflowActionRuntimeDependencies = {},
): ApprovedDraftPorts {
  const client = db();
  const ledger = createToolLedgerDb(supabaseAdmin);

  const resolveBrokerContext = async (orgId: string, runId: string) => {
    const run = await one(
      client.from("wf_run").select("agent_ref").eq("org_id", orgId).eq("id", runId).limit(1),
    );
    if (typeof run?.agent_ref !== "string") return null;
    const contexts = await rows(
      client
        .from("cg_twin_context")
        .select("id")
        .eq("tenant_ref", orgId)
        .eq("agent_definition_ref", run.agent_ref)
        .eq("context_kind", "tenant_membership")
        .eq("status", "active")
        .limit(2),
    );
    return contexts.length === 1 && typeof contexts[0]?.id === "string" ? contexts[0].id : null;
  };

  const brokerAuthority = {
    async resolve(input: {
      twinContextId: string;
      tool: ToolDefinition;
    }): Promise<{ ctx: ActingContext; state: BrokerState } | null> {
      const context = await one(
        client
          .from("cg_twin_context")
          .select("id,context_kind,tenant_ref,role_code,status,pack_code,pack_version")
          .eq("id", input.twinContextId)
          .limit(1),
      );
      if (
        !context ||
        context.context_kind !== "tenant_membership" ||
        context.status !== "active" ||
        typeof context.tenant_ref !== "string" ||
        typeof context.pack_code !== "string" ||
        typeof context.pack_version !== "string"
      ) {
        return null;
      }
      const packRow = await one(
        client
          .from("cg_role_pack")
          .select("definition,status")
          .eq("code", context.pack_code)
          .eq("version", context.pack_version)
          .limit(1),
      );
      if (!packRow || packRow.status !== "published") return null;
      const parsed = parseRolePack(packRow.definition);
      if (!parsed.ok) return null;
      const capability = parsed.pack.capabilities.find(
        (candidate) => candidate.connector === input.tool.connector,
      );
      if (
        !capability ||
        !parsed.pack.permissions.includes(capability.requiresPermission) ||
        capability.tier === "T4"
      ) {
        return null;
      }
      const trustRow = await one(
        client
          .from("cg_twin_trust")
          .select("state,sheriff_promotion_id")
          .eq("context_id", input.twinContextId)
          .eq("capability_id", capability.id)
          .limit(1),
      );
      const trustState =
        trustRow?.state === "propose" ||
        trustRow?.state === "assist" ||
        trustRow?.state === "autonomous"
          ? trustRow.state
          : "shadow";
      const effective = effectiveAutonomy(capability, {
        capabilityId: capability.id,
        state: trustState,
        ...(typeof trustRow?.sheriff_promotion_id === "string"
          ? { sheriffPromotionId: trustRow.sheriff_promotion_id }
          : {}),
      });
      const bindingRow = await one(
        client
          .from("cg_connector_binding")
          .select("connector,scope,tenant_ref,secret_ref,status")
          .eq("connector", input.tool.connector)
          .eq("scope", "tenant")
          .eq("tenant_ref", context.tenant_ref)
          .eq("status", "active")
          .limit(1),
      );
      const registry = await one(
        client
          .from("cg_tool_registry")
          .select("enabled")
          .eq("tool_id", input.tool.id)
          .eq("version", input.tool.version)
          .limit(1),
      );
      if (typeof registry?.enabled !== "boolean") return null;
      const recentCalls = await rows(
        client
          .from("cg_tool_call_ledger")
          .select("id")
          .eq("kind", "decision")
          .eq("twin_context_id", input.twinContextId)
          .eq("tool_id", input.tool.id)
          .gte("created_at", new Date(timeAuthority.now().atMs - 60 * 60 * 1000).toISOString())
          .limit(input.tool.maxCallsPerHour + 1),
      );
      const ctx: ActingContext = {
        kind: "tenant_membership",
        tenantRef: context.tenant_ref,
        status: "active",
        permissions: new Set(parsed.pack.permissions),
        capability: {
          id: capability.id,
          tier: capability.tier,
          requiresPermission: capability.requiresPermission,
          ...(capability.connector ? { connector: capability.connector } : {}),
          ...(capability.approver ? { approver: capability.approver } : {}),
        },
        effective,
      };
      return {
        ctx,
        state: {
          killSwitch:
            env.WORKFLOWS_ENABLED !== "true" ||
            parseWorkflowDeliveryMode(env.WORKFLOW_DELIVERY_MODE) === "off",
          disabledTools: registry.enabled ? new Set() : new Set([input.tool.id]),
          callsThisHour: recentCalls.length,
          binding: connectorBinding(bindingRow),
        },
      };
    },
  };

  const ports: ApprovedDraftPorts = {
    env,
    broker: { authority: brokerAuthority, ledger },
    gate: {
      ledger,
      adapters: dependencies.adapters ?? {},
      secrets: { resolve: async () => null },
      bindings: async ({ connector, scope, tenantRef }) => {
        const row = await one(
          client
            .from("cg_connector_binding")
            .select("connector,scope,tenant_ref,secret_ref,status")
            .eq("connector", connector)
            .eq("scope", scope)
            .eq("status", "active")
            .eq("tenant_ref", scope === "tenant" ? tenantRef : null)
            .limit(1),
        );
        return connectorBinding(row);
      },
      http: dependencies.http ?? {
        request: async () => {
          throw new Error("workflow_adapter_unavailable");
        },
      },
    },
    orgWorkflowsEnabled: async (orgId) => {
      const row = await one(
        client.from("wf_org_settings").select("workflows_enabled").eq("org_id", orgId).limit(1),
      );
      return row?.workflows_enabled === true;
    },
    actionType: async (kind) =>
      parseActionType(
        await one(
          client
            .from("wf_action_type")
            .select("kind,category,broker_tool_id,broker_version,effect,max_autonomy")
            .eq("kind", kind)
            .limit(1),
        ),
      ),
    approvedTemplate: async (orgId, kind, templateRef, params) => {
      if (kind === "in_app") {
        const row = await one(
          client
            .from("wf_action_template")
            .select("parameter_keys")
            .eq("org_id", orgId)
            .eq("kind", kind)
            .eq("template_ref", templateRef)
            .eq("status", "approved")
            .limit(1),
        );
        return (
          Array.isArray(row?.parameter_keys) &&
          Object.keys(params).every((key) => (row.parameter_keys as string[]).includes(key))
        );
      }
      const row = await one(
        client
          .from("comms_templates")
          .select("id")
          .eq("school_id", orgId)
          .eq("code", templateRef)
          .eq("channel", kind)
          .eq("status", "approved")
          .limit(1),
      );
      return row !== null;
    },
    resolveRecipients: async (orgId, recipientIds) => {
      if (recipientIds.length === 0) return [];
      const found = await rows(
        client
          .from("organization_memberships")
          .select("user_id")
          .eq("school_id", orgId)
          .eq("is_active", true)
          .in("user_id", recipientIds)
          .limit(500),
      );
      const resolved = found
        .map((row) => row.user_id)
        .filter((id): id is string => typeof id === "string");
      return resolved.length === recipientIds.length &&
        new Set(resolved).size === recipientIds.length
        ? resolved
        : null;
    },
    registeredWebhook: async (orgId, targetUrl) => {
      const row = await one(
        client
          .from("wf_webhook_target")
          .select("id,target_url")
          .eq("org_id", orgId)
          .eq("target_url", targetUrl)
          .eq("enabled", true)
          .limit(1),
      );
      return typeof row?.id === "string" && typeof row.target_url === "string"
        ? { id: row.id, targetUrl: row.target_url }
        : null;
    },
    brokerContext: resolveBrokerContext,
    quotaCheck: async (check) => {
      const { data, error } = await client.rpc("wf_quota_check_action", {
        p_org: check.orgId,
        p_kind: check.kind,
        p_recipients: check.recipientCount,
        p_mode: check.mode,
        p_run: check.runId,
      });
      if (error || !data || typeof data !== "object") throw new Error("workflow_quota_unavailable");
      const result = data as { allowed?: unknown; code?: unknown };
      return {
        allowed: result.allowed === true,
        code: typeof result.code === "string" ? result.code : null,
      };
    },
    createDraft: async (draft) => {
      const { error } = await client.from("wf_action_draft").upsert(
        {
          org_id: draft.orgId,
          run_id: draft.runId,
          step_run_id: draft.stepRunId,
          kind: draft.kind,
          category: draft.category,
          template_ref: draft.templateRef,
          template_params: draft.templateParams,
          recipient_ids: draft.recipientIds,
          audience_selector: draft.audienceSelector,
          data_class: draft.dataClass,
          webhook_target_id: draft.webhookTargetId,
          idempotency_key: draft.idempotencyKey,
        },
        { onConflict: "org_id,idempotency_key", ignoreDuplicates: true },
      );
      if (error) throw new Error("workflow_action_draft_write_failed");
      // WF-07: every draft gets an approval in the tenant inbox. The call is idempotent. If it
      // fails the draft is still safe (it cannot be approved without one) and the approval sweep
      // requests it on its next pass, so a failure here must not fail the step.
      const stored = await one(
        client
          .from("wf_action_draft")
          .select("id")
          .eq("org_id", draft.orgId)
          .eq("idempotency_key", draft.idempotencyKey)
          .limit(1),
      );
      if (typeof stored?.id === "string") {
        try {
          await client.rpc("wf_request_draft_approval", { p_org: draft.orgId, p_draft: stored.id });
        } catch {
          /* picked up by wf_request_missing_draft_approvals */
        }
      }
    },
    createSandboxOutbox: async (outbox) => {
      const { error } = await client.from("wf_action_sandbox_outbox").upsert(
        {
          ...(outbox.draftId ? { draft_id: outbox.draftId } : {}),
          org_id: outbox.orgId,
          run_id: outbox.runId,
          step_run_id: outbox.stepRunId,
          kind: outbox.kind,
          category: outbox.category,
          template_ref: outbox.templateRef,
          template_params: outbox.templateParams,
          recipient_ids: outbox.recipientIds,
          audience_selector: outbox.audienceSelector,
          data_class: outbox.dataClass,
          webhook_target_id: outbox.webhookTargetId,
          idempotency_key: outbox.idempotencyKey,
          broker_decision_id: outbox.brokerDecisionId,
        },
        { onConflict: "org_id,idempotency_key", ignoreDuplicates: true },
      );
      if (error) throw new Error("workflow_action_sandbox_write_failed");
    },
    approvedDraft: async (orgId, draftId) => {
      const draft = await one(
        client
          .from("wf_action_draft")
          .select(
            "id,org_id,run_id,step_run_id,kind,category,template_ref,template_params,recipient_ids,audience_selector,data_class,webhook_target_id,idempotency_key,approval_id,status",
          )
          .eq("org_id", orgId)
          .eq("id", draftId)
          .eq("status", "approved")
          .limit(1),
      );
      if (!draft || typeof draft.approval_id !== "string") return null;
      const approval = await one(
        client
          .from("wf_approval")
          .select("id,status")
          .eq("org_id", orgId)
          .eq("id", draft.approval_id)
          .eq("status", "approved")
          .limit(1),
      );
      return approval ? parseApprovedDraft(draft) : null;
    },
    webhookTargetEnabled: async (orgId, targetId) =>
      (await one(
        client
          .from("wf_webhook_target")
          .select("id")
          .eq("org_id", orgId)
          .eq("id", targetId)
          .eq("enabled", true)
          .limit(1),
      )) !== null,
  };

  return ports;
}

export function createWorkflowActionExecutor(
  env: WorkflowDeliveryEnvironment = process.env,
  dependencies: WorkflowActionRuntimeDependencies = {},
): ExecuteAction {
  const ports = createWorkflowActionPorts(env, dependencies);

  return async (input: {
    orgId: string;
    step: Parameters<NonNullable<WorkflowTickOptions["executeAction"]>>[0]["step"];
    action?: Parameters<NonNullable<WorkflowTickOptions["executeAction"]>>[0]["action"];
    authorizedActions: readonly string[];
  }) => {
    if (!input.action) throw new Error("workflow_action_missing");
    return dispatchWorkflowAction(ports, {
      orgId: input.orgId,
      runId: input.step.runId,
      stepRunId: input.step.id,
      idempotencyKey: input.step.idempotencyKey,
      actionClass: input.step.actionClass,
      authorizedActions: input.authorizedActions,
      autonomy: {
        template: input.step.autonomyLevel,
        tenant: input.step.autonomyLevel,
        agent: input.step.autonomyLevel,
      },
      action: input.action,
    });
  };
}

/** The production approval sweep: the same ports and guards as the executor, no extra authority. */
export function createWorkflowApprovalSweepRuntime(
  env: WorkflowDeliveryEnvironment = process.env,
  dependencies: WorkflowActionRuntimeDependencies = {},
): () => Promise<ApprovalSweepCounts> {
  const ports = createWorkflowActionPorts(env, dependencies);
  const client = db();
  return () =>
    runWorkflowApprovalSweep({
      rpc: (fn, args) => client.rpc(fn, args),
      dispatchApprovedDraft: async (orgId, draftId) => {
        await dispatchApprovedWorkflowDraft(ports, { orgId, draftId });
      },
    });
}
