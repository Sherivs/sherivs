/**
 * WF-07: dispatch of a drafted action after people approved it (ADR-122).
 *
 * A draft is what WF-06 produced when autonomy or a category cap kept an action from running. Once
 * the approval inbox records the required approvals (two people, each with a passkey for the
 * high-risk categories), this module lets the action proceed, with three limits that do not move:
 *
 *  - Sandbox only. A live send of an approved draft is refused in v1 (`workflow_approved_live_unsupported`):
 *    no outbound provider is wired for workflows, and an approval is not a delivery switch.
 *  - Everything that guarded the first dispatch is checked again now, not trusted from approval
 *    time: the organisation switch, the delivery environment, the recipients' tenant membership,
 *    the approved template, the registered webhook target, the tool registry, the connector
 *    binding, the per-hour budget and the kill switch. The broker still decides and still writes
 *    its ledger row before anything is recorded.
 *  - The record written is the draft, field for field. The database refuses an outbox row that
 *    differs from the approved draft, or whose approval is incomplete (`wf_draft_approval_gap`).
 *
 * The one change to the broker's view is the autonomy rung: a capability that would only
 * "propose" or "act with approval" is treated as cleared for THIS draft, because the approval has
 * now happened. A capability in `shadow` is not raised; a kill switch, a disabled tool, a missing
 * binding or an exhausted budget still denies.
 */
import { z } from "zod";
import { brokerToolCall, type AuthorityPort } from "../tool-broker/broker-service.server";
import { toolById } from "../tool-broker/platform-tools";
import { workflowDeliveryGate, type WorkflowActionKind } from "./workflow-actions";
import type {
  WorkflowActionDispatcherPorts,
  WorkflowActionDraftInput,
  WorkflowActionOutboxInput,
} from "./workflow-action-dispatcher.server";

const uuid = z.string().uuid();

export interface ApprovedWorkflowDraft extends WorkflowActionDraftInput {
  readonly draftId: string;
  readonly approvalId: string;
}

export interface ApprovedDraftPorts extends WorkflowActionDispatcherPorts {
  /** The draft, only while it is `approved` and its approval row is `approved`. */
  readonly approvedDraft: (orgId: string, draftId: string) => Promise<ApprovedWorkflowDraft | null>;
  /** True when the registered webhook target is still enabled for this organisation. */
  readonly webhookTargetEnabled: (orgId: string, targetId: string) => Promise<boolean>;
  readonly createSandboxOutbox: (
    input: WorkflowActionOutboxInput & { draftId?: string },
  ) => Promise<void>;
}

const TEMPLATED_KINDS = new Set(["email", "whatsapp", "sms", "in_app"]);

/** The broker key for an approved draft. The outbox guard accepts exactly this form. */
export function approvedDraftDecisionKey(draftId: string): string {
  return `wf-approved:${draftId}`;
}

export type ApprovedDraftDispatch = { status: "executed" };

export async function dispatchApprovedWorkflowDraft(
  ports: ApprovedDraftPorts,
  input: { orgId: string; draftId: string },
): Promise<ApprovedDraftDispatch> {
  if (!uuid.safeParse(input.orgId).success || !uuid.safeParse(input.draftId).success) {
    throw new Error("workflow_action_scope_invalid");
  }
  if (!(await ports.orgWorkflowsEnabled(input.orgId))) {
    throw new Error("workflow_organization_disabled");
  }
  const draft = await ports.approvedDraft(input.orgId, input.draftId);
  if (!draft || draft.orgId !== input.orgId || draft.draftId !== input.draftId) {
    throw new Error("workflow_approved_draft_unavailable");
  }
  const actionType = await ports.actionType(draft.kind);
  if (
    !actionType ||
    actionType.kind !== draft.kind ||
    actionType.brokerToolId === null ||
    actionType.brokerVersion === null
  ) {
    throw new Error("workflow_action_unregistered");
  }

  const delivery = workflowDeliveryGate({
    env: ports.env,
    orgWorkflowsEnabled: true,
    kind: draft.kind as WorkflowActionKind,
  });
  if (!delivery.allowed) throw new Error("workflow_delivery_refused");
  if (delivery.mode !== "sandbox") throw new Error("workflow_approved_live_unsupported");

  // Re-check the world the approvers could not see change.
  const recipients = await ports.resolveRecipients(draft.orgId, draft.recipientIds);
  if (
    recipients === null ||
    recipients.length !== draft.recipientIds.length ||
    recipients.some((id) => !draft.recipientIds.includes(id))
  ) {
    throw new Error("workflow_recipient_scope_invalid");
  }
  if (TEMPLATED_KINDS.has(draft.kind)) {
    if (
      !draft.templateRef ||
      !(await ports.approvedTemplate(
        draft.orgId,
        draft.kind,
        draft.templateRef,
        draft.templateParams,
      ))
    ) {
      throw new Error("workflow_action_template_unavailable");
    }
  }
  if (draft.kind === "webhook") {
    if (
      !draft.webhookTargetId ||
      !(await ports.webhookTargetEnabled(draft.orgId, draft.webhookTargetId))
    ) {
      throw new Error("workflow_webhook_target_unavailable");
    }
  } else if (draft.webhookTargetId !== null) {
    throw new Error("workflow_webhook_target_unavailable");
  }

  const contextId = await ports.brokerContext(draft.orgId, draft.runId);
  if (!contextId) throw new Error("workflow_broker_context_unavailable");
  const tool = toolById(actionType.brokerToolId);
  if (!tool || tool.version !== actionType.brokerVersion) {
    throw new Error("workflow_broker_tool_unavailable");
  }

  const authority: AuthorityPort = {
    resolve: async (request) => {
      const resolved = await ports.broker.authority.resolve(request);
      if (!resolved) return null;
      const rung = resolved.ctx.effective;
      // Approval stands in for the rungs below autonomy. Shadow is never raised.
      const effective =
        rung === "propose_only" || rung === "act_with_approval" ? "act_autonomously" : rung;
      return { ...resolved, ctx: { ...resolved.ctx, effective } };
    },
  };
  const decision = await brokerToolCall(
    { authority, ledger: ports.broker.ledger },
    {
      twinContextId: contextId,
      tool,
      args: {
        kind: draft.kind,
        templateRef: draft.templateRef,
        templateParams: draft.templateParams,
        recipientIds: draft.recipientIds,
        webhookTargetId: draft.webhookTargetId,
      },
      idempotencyKey: approvedDraftDecisionKey(draft.draftId),
    },
  );
  if (!decision.ok) throw new Error("workflow_broker_unavailable");
  if (decision.decision.verdict !== "execute") throw new Error("workflow_approved_not_cleared");

  await ports.createSandboxOutbox({
    orgId: draft.orgId,
    runId: draft.runId,
    stepRunId: draft.stepRunId,
    idempotencyKey: draft.idempotencyKey,
    kind: draft.kind,
    category: draft.category,
    templateRef: draft.templateRef,
    templateParams: draft.templateParams,
    recipientIds: draft.recipientIds,
    audienceSelector: draft.audienceSelector,
    dataClass: draft.dataClass,
    webhookTargetId: draft.webhookTargetId,
    brokerDecisionId: decision.id,
    draftId: draft.draftId,
  });
  return { status: "executed" };
}
