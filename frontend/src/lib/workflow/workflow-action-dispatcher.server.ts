import { z } from "zod";
import {
  brokerToolCall,
  type AuthorityPort,
  type LedgerPort,
} from "../tool-broker/broker-service.server";
import { toolById } from "../tool-broker/platform-tools";
import { executeCleared, type GatePorts } from "../connector-adapters/execution-gate.server";
import type { EffectiveAutonomy } from "../twin-engine/autonomy-ladder";
import {
  effectiveWorkflowAutonomy,
  isWorkflowWebhookTargetAllowed,
  resolveWorkflowDataClass,
  workflowActionHasMoneyEffect,
  workflowDataClassRequired,
  workflowActionCategory,
  workflowDeliveryGate,
  workflowActionDefinitionSchema,
  WORKFLOW_ACTION_CATEGORY_CAPS,
  type WorkflowAutonomyLevel,
  type WorkflowDataClass,
  type WorkflowDeliveryEnvironment,
} from "./workflow-actions";

const uuid = z.string().uuid();
const AUTONOMY_RANK: Readonly<Record<WorkflowAutonomyLevel, number>> = {
  suggest: 0,
  draft: 1,
  act_with_approval: 2,
  act_and_report: 3,
};

function lowerAutonomy(a: WorkflowAutonomyLevel, b: WorkflowAutonomyLevel) {
  return AUTONOMY_RANK[a] <= AUTONOMY_RANK[b] ? a : b;
}

function brokerAutonomy(level: WorkflowAutonomyLevel): EffectiveAutonomy {
  if (level === "act_and_report") return "act_autonomously";
  if (level === "act_with_approval") return "act_with_approval";
  return "propose_only";
}

export interface WorkflowActionType {
  kind: string;
  category: string;
  brokerToolId: string | null;
  brokerVersion: string | null;
  effect: string;
  maxAutonomy: WorkflowAutonomyLevel;
}

export interface WorkflowActionDraftInput {
  orgId: string;
  runId: string;
  stepRunId: string;
  idempotencyKey: string;
  kind: string;
  category: string;
  templateRef: string | null;
  templateParams: Record<string, string | number | boolean>;
  recipientIds: readonly string[];
  audienceSelector: "whole_class" | "all_guardians" | "all_staff" | null;
  /** Resolved fail-closed: unknown or missing-but-required values are `confidential`. */
  dataClass: WorkflowDataClass;
  webhookTargetId: string | null;
}

export interface WorkflowActionOutboxInput extends WorkflowActionDraftInput {
  brokerDecisionId: string;
}

export interface WorkflowQuotaCheckInput {
  orgId: string;
  runId: string;
  kind: string;
  recipientCount: number;
  mode: "draft" | "execute";
}

export interface WorkflowQuotaCheckResult {
  allowed: boolean;
  code: string | null;
}

/** Fail closed: anything but an explicit `allowed: true` from a working port stops the action. */
export async function enforceWorkflowQuota(
  ports: Pick<WorkflowActionDispatcherPorts, "quotaCheck">,
  input: WorkflowQuotaCheckInput,
): Promise<void> {
  if (typeof ports.quotaCheck !== "function") throw new Error("workflow_quota_unavailable");
  let result: WorkflowQuotaCheckResult;
  try {
    result = await ports.quotaCheck(input);
  } catch {
    throw new Error("workflow_quota_unavailable");
  }
  if (!result || result.allowed !== true) {
    const code = result && typeof result.code === "string" ? result.code : "";
    throw new Error(
      /^[a-z_]{3,40}$/.test(code) ? `workflow_quota_${code}` : "workflow_quota_unavailable",
    );
  }
}

export interface WorkflowActionDispatcherPorts {
  readonly env: WorkflowDeliveryEnvironment;
  readonly broker: { readonly authority: AuthorityPort; readonly ledger: LedgerPort };
  readonly gate: GatePorts;
  readonly orgWorkflowsEnabled: (orgId: string) => Promise<boolean>;
  readonly actionType: (kind: string) => Promise<WorkflowActionType | null>;
  readonly approvedTemplate: (
    orgId: string,
    kind: string,
    templateRef: string,
    params: Readonly<Record<string, string | number | boolean>>,
  ) => Promise<boolean>;
  /** Returns the same IDs only after tenant-local membership checks. */
  readonly resolveRecipients: (
    orgId: string,
    recipientIds: readonly string[],
  ) => Promise<readonly string[] | null>;
  readonly registeredWebhook: (
    orgId: string,
    targetUrl: string,
  ) => Promise<{ id: string; targetUrl: string } | null>;
  readonly brokerContext: (orgId: string, runId: string) => Promise<string | null>;
  /**
   * WF-12: the per-organization quota and wallet-cap pre-check. The database triggers are the authority;
   * this stops the work before a broker ledger row is written. Required: a missing or failing port refuses.
   */
  readonly quotaCheck: (input: WorkflowQuotaCheckInput) => Promise<WorkflowQuotaCheckResult>;
  readonly createDraft: (input: WorkflowActionDraftInput) => Promise<void>;
  readonly createSandboxOutbox: (input: WorkflowActionOutboxInput) => Promise<void>;
}

export interface WorkflowActionDispatchInput {
  orgId: string;
  runId: string;
  stepRunId: string;
  idempotencyKey: string;
  actionClass: string;
  authorizedActions: readonly string[];
  autonomy: {
    template: WorkflowAutonomyLevel;
    tenant: WorkflowAutonomyLevel;
    agent: WorkflowAutonomyLevel;
  };
  action: unknown;
}

export async function dispatchWorkflowAction(
  ports: WorkflowActionDispatcherPorts,
  input: WorkflowActionDispatchInput,
): Promise<{ status: "draft" | "executed" }> {
  const parsedIds = [input.orgId, input.runId, input.stepRunId].every(
    (id) => uuid.safeParse(id).success,
  );
  if (!parsedIds || input.idempotencyKey.trim().length < 8) {
    throw new Error("workflow_action_scope_invalid");
  }
  const parsed = workflowActionDefinitionSchema.safeParse(input.action);
  if (!parsed.success) throw new Error("workflow_action_invalid");
  const action = parsed.data;
  if (!(await ports.orgWorkflowsEnabled(input.orgId))) {
    throw new Error("workflow_organization_disabled");
  }

  const actionType = await ports.actionType(action.kind);
  if (!actionType || actionType.kind !== action.kind)
    throw new Error("workflow_action_unregistered");
  const toolId = actionType.brokerToolId ?? action.kind;
  if (!input.authorizedActions.includes(action.kind) && !input.authorizedActions.includes(toolId)) {
    throw new Error("workflow_action_not_authorized");
  }
  const recipients = await ports.resolveRecipients(input.orgId, action.recipientIds);
  if (
    recipients === null ||
    recipients.length !== action.recipientIds.length ||
    recipients.some((id) => !action.recipientIds.includes(id))
  ) {
    throw new Error("workflow_recipient_scope_invalid");
  }

  let webhookTargetId: string | null = null;
  let webhookRegistered = false;
  if (action.kind === "webhook" && action.targetUrl) {
    const target = await ports.registeredWebhook(input.orgId, action.targetUrl);
    if (
      target &&
      target.id &&
      isWorkflowWebhookTargetAllowed({
        targetUrl: action.targetUrl,
        registeredTargetUrl: target.targetUrl,
      })
    ) {
      webhookTargetId = target.id;
      webhookRegistered = true;
    }
  }

  if (
    ["email", "whatsapp", "sms", "in_app"].includes(action.kind) &&
    (!action.templateRef ||
      !(await ports.approvedTemplate(
        input.orgId,
        action.kind,
        action.templateRef,
        action.templateParams,
      )))
  ) {
    throw new Error("workflow_action_template_unavailable");
  }

  const dataClass = resolveWorkflowDataClass(action.dataClass, {
    required: workflowDataClassRequired(action.kind),
  });
  let category = workflowActionCategory({
    actionClass: Object.prototype.hasOwnProperty.call(
      WORKFLOW_ACTION_CATEGORY_CAPS,
      input.actionClass,
    )
      ? input.actionClass
      : actionType.category,
    recipientCount: recipients.length,
    hasAudienceSelector: action.audienceSelector !== undefined,
    dataClass,
  });
  if (workflowActionHasMoneyEffect(actionType.effect)) category = "money_movement";
  if (action.kind === "webhook" && !webhookRegistered) category = "unregistered_webhook";

  const autonomy = effectiveWorkflowAutonomy({
    template: lowerAutonomy(input.autonomy.template, actionType.maxAutonomy),
    tenant: input.autonomy.tenant,
    agent: input.autonomy.agent,
    actionClass: category,
  });
  const draftInput: WorkflowActionDraftInput = {
    orgId: input.orgId,
    runId: input.runId,
    stepRunId: input.stepRunId,
    idempotencyKey: input.idempotencyKey,
    kind: action.kind,
    category,
    templateRef: action.templateRef ?? null,
    templateParams: action.templateParams,
    recipientIds: recipients,
    audienceSelector: action.audienceSelector ?? null,
    dataClass,
    webhookTargetId,
  };
  if (
    autonomy === "suggest" ||
    autonomy === "draft" ||
    actionType.brokerToolId === null ||
    actionType.brokerVersion === null
  ) {
    await enforceWorkflowQuota(ports, {
      orgId: input.orgId,
      runId: input.runId,
      kind: action.kind,
      recipientCount: recipients.length,
      mode: "draft",
    });
    await ports.createDraft(draftInput);
    return { status: "draft" };
  }

  const delivery = workflowDeliveryGate({
    env: ports.env,
    orgWorkflowsEnabled: true,
    kind: action.kind as Parameters<typeof workflowDeliveryGate>[0]["kind"],
  });
  if (!delivery.allowed) throw new Error("workflow_delivery_refused");
  // Judged before the broker writes its ledger row, in the stricter mode (spend counts only when it would be sent).
  await enforceWorkflowQuota(ports, {
    orgId: input.orgId,
    runId: input.runId,
    kind: action.kind,
    recipientCount: recipients.length,
    mode: "execute",
  });

  const contextId = await ports.brokerContext(input.orgId, input.runId);
  if (!contextId) throw new Error("workflow_broker_context_unavailable");
  const tool = toolById(actionType.brokerToolId);
  if (!tool || tool.version !== actionType.brokerVersion) {
    throw new Error("workflow_broker_tool_unavailable");
  }
  if (
    delivery.mode === "live" &&
    (!ports.gate.adapters?.[tool.connector] ||
      ports.gate.adapters[tool.connector]?.connector !== tool.connector ||
      !ports.gate.adapters[tool.connector]?.tools.includes(tool.id))
  ) {
    throw new Error("workflow_live_adapter_unavailable");
  }
  const args = {
    kind: action.kind,
    templateRef: action.templateRef ?? null,
    templateParams: action.templateParams,
    recipientIds: recipients,
    webhookTargetId,
  };
  const broker: WorkflowActionDispatcherPorts["broker"] = {
    authority: {
      resolve: async (request) => {
        const authority = await ports.broker.authority.resolve(request);
        if (!authority) return null;
        const ceiling = brokerAutonomy(autonomy);
        const effective =
          authority.ctx.effective === "shadow" ||
          ceiling === "shadow" ||
          authority.ctx.effective === "propose_only" ||
          ceiling === "propose_only"
            ? authority.ctx.effective === "shadow" || ceiling === "shadow"
              ? "shadow"
              : "propose_only"
            : authority.ctx.effective === "act_with_approval" || ceiling === "act_with_approval"
              ? "act_with_approval"
              : "act_autonomously";
        return { ...authority, ctx: { ...authority.ctx, effective } };
      },
    },
    ledger: ports.broker.ledger,
  };
  const decision = await brokerToolCall(broker, {
    twinContextId: contextId,
    tool,
    args,
    idempotencyKey: input.idempotencyKey,
  });
  if (!decision.ok) throw new Error("workflow_broker_unavailable");
  if (decision.decision.verdict !== "execute") {
    await enforceWorkflowQuota(ports, {
      orgId: input.orgId,
      runId: input.runId,
      kind: action.kind,
      recipientCount: recipients.length,
      mode: "draft",
    });
    await ports.createDraft(draftInput);
    return { status: "draft" };
  }

  if (delivery.mode === "sandbox") {
    await ports.createSandboxOutbox({ ...draftInput, brokerDecisionId: decision.id });
    return { status: "executed" };
  }

  const result = await executeCleared(ports.gate, {
    decisionId: decision.id,
    args,
    idempotencyKey: input.idempotencyKey,
    approval: null,
  });
  if (!result.ok && result.error === "already_succeeded") return { status: "executed" };
  if (!result.ok || result.outcome !== "succeeded") {
    throw new Error("workflow_execution_refused");
  }
  return { status: "executed" };
}
