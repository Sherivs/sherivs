import { describe, expect, it } from "vitest";
import type { Decision } from "@/lib/tool-broker/broker";
import {
  approvedDraftDecisionKey,
  dispatchApprovedWorkflowDraft,
  type ApprovedDraftPorts,
  type ApprovedWorkflowDraft,
} from "@/lib/workflow/workflow-approved-draft.server";

const orgId = "f0700000-0000-4000-8000-000000000001";
const draftId = "f0710000-0000-4000-8000-000000000001";
const approvalId = "f0720000-0000-4000-8000-000000000001";
const user = "f0730000-0000-4000-8000-000000000001";

const approved: ApprovedWorkflowDraft = {
  draftId,
  approvalId,
  orgId,
  runId: "f0740000-0000-4000-8000-000000000001",
  stepRunId: "f0750000-0000-4000-8000-000000000001",
  idempotencyKey: "wf-step-run:action:0",
  kind: "in_app",
  category: "safeguarding",
  templateRef: "welfare.notice",
  templateParams: { child: "Tobi" },
  recipientIds: [user],
  audienceSelector: null,
  dataClass: "minor_sensitive",
  webhookTargetId: null,
};

function setup(
  options: {
    draft?: ApprovedWorkflowDraft | null;
    effective?: "shadow" | "propose_only" | "act_with_approval" | "act_autonomously";
    killSwitch?: boolean;
    env?: Record<string, string>;
    overrides?: Partial<ApprovedDraftPorts>;
  } = {},
) {
  const decisions = new Map<string, { id: string; decision: Decision; argsDigest: string }>();
  const outbox: unknown[] = [];
  const brokerKeys: string[] = [];
  const ports: ApprovedDraftPorts = {
    env: {
      WORKFLOW_DELIVERY_MODE: "sandbox",
      WORKFLOWS_ENABLED: "true",
      APP_ENV: "staging",
      ...options.env,
    },
    broker: {
      authority: {
        resolve: async ({ tool }) => ({
          ctx: {
            kind: "tenant_membership",
            tenantRef: orgId,
            status: "active",
            permissions: new Set(["workflows.run"]),
            capability: {
              id: "workflow-delivery",
              tier: tool.tier,
              requiresPermission: "workflows.run",
              connector: tool.connector,
            },
            effective: options.effective ?? "propose_only",
          },
          state: {
            killSwitch: options.killSwitch ?? false,
            disabledTools: new Set(),
            callsThisHour: 0,
            binding: {
              connector: tool.connector,
              scope: "tenant",
              tenantRef: orgId,
              secretRef: `vault://${tool.connector}/actions#v1`,
              status: "active",
            },
          },
        }),
      },
      ledger: {
        findDecision: async ({ toolId, idempotencyKey }) =>
          decisions.get(`${toolId}:${idempotencyKey}`) ?? null,
        appendDecision: async (input) => {
          brokerKeys.push(String(input.idempotencyKey));
          const id = `decision-${brokerKeys.length}`;
          decisions.set(`${input.tool.id}:${input.idempotencyKey}`, {
            id,
            decision: input.decision,
            argsDigest: input.argsDigest,
          });
          return { id };
        },
      },
    },
    gate: {} as ApprovedDraftPorts["gate"],
    orgWorkflowsEnabled: async () => true,
    actionType: async (kind) => ({
      kind,
      category: "communication",
      brokerToolId: `workflow.action.${kind}`,
      brokerVersion: "1.0.0",
      effect: "internal_state",
      maxAutonomy: "act_and_report",
    }),
    approvedTemplate: async () => true,
    resolveRecipients: async (_org, ids) => ids,
    registeredWebhook: async () => null,
    brokerContext: async () => "context",
    quotaCheck: async () => ({ allowed: true, code: null }),
    createDraft: async () => {
      throw new Error("an approved draft must never create another draft");
    },
    createSandboxOutbox: async (input) => {
      outbox.push(input);
    },
    approvedDraft: async () => (options.draft === undefined ? approved : options.draft),
    webhookTargetEnabled: async () => true,
    ...options.overrides,
  };
  return { ports, outbox, brokerKeys };
}

describe("WF-07 dispatch of an approved draft", () => {
  it("records the draft field for field in the sandbox outbox, linked to the draft, under the approved-draft broker key", async () => {
    const { ports, outbox, brokerKeys } = setup();
    await expect(dispatchApprovedWorkflowDraft(ports, { orgId, draftId })).resolves.toEqual({
      status: "executed",
    });
    expect(brokerKeys).toEqual([approvedDraftDecisionKey(draftId)]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      draftId,
      orgId,
      kind: "in_app",
      category: "safeguarding",
      templateRef: "welfare.notice",
      templateParams: { child: "Tobi" },
      recipientIds: [user],
      dataClass: "minor_sensitive",
      idempotencyKey: "wf-step-run:action:0",
      brokerDecisionId: "decision-1",
    });
  });

  it("treats approval as the missing rung for propose_only and act_with_approval, but never raises shadow", async () => {
    for (const effective of ["propose_only", "act_with_approval", "act_autonomously"] as const) {
      const { ports, outbox } = setup({ effective });
      await dispatchApprovedWorkflowDraft(ports, { orgId, draftId });
      expect(outbox).toHaveLength(1);
    }
    const shadow = setup({ effective: "shadow" });
    await expect(dispatchApprovedWorkflowDraft(shadow.ports, { orgId, draftId })).rejects.toThrow(
      "workflow_approved_not_cleared",
    );
    expect(shadow.outbox).toHaveLength(0);
  });

  it("the kill switch still denies an approved draft", async () => {
    const { ports, outbox } = setup({ killSwitch: true });
    await expect(dispatchApprovedWorkflowDraft(ports, { orgId, draftId })).rejects.toThrow(
      "workflow_approved_not_cleared",
    );
    expect(outbox).toHaveLength(0);
  });

  it("is sandbox only: live delivery of an approved draft is refused, and so is delivery off", async () => {
    const live = setup({
      env: { WORKFLOW_DELIVERY_MODE: "live", APP_ENV: "production" },
      draft: { ...approved, kind: "email", category: "money_movement" },
    });
    await expect(dispatchApprovedWorkflowDraft(live.ports, { orgId, draftId })).rejects.toThrow(
      "workflow_approved_live_unsupported",
    );
    expect(live.outbox).toHaveLength(0);
    const off = setup({
      env: { WORKFLOW_DELIVERY_MODE: "off" },
      draft: { ...approved, kind: "email" },
    });
    await expect(dispatchApprovedWorkflowDraft(off.ports, { orgId, draftId })).rejects.toThrow(
      "workflow_delivery_refused",
    );
    const disabled = setup({
      env: { WORKFLOWS_ENABLED: "false" },
      draft: { ...approved, kind: "sms" },
    });
    await expect(dispatchApprovedWorkflowDraft(disabled.ports, { orgId, draftId })).rejects.toThrow(
      "workflow_delivery_refused",
    );
  });

  it("does nothing for a draft that is not approved, not found, or for another organisation", async () => {
    const missing = setup({ draft: null });
    await expect(dispatchApprovedWorkflowDraft(missing.ports, { orgId, draftId })).rejects.toThrow(
      "workflow_approved_draft_unavailable",
    );
    const foreign = setup({
      draft: { ...approved, orgId: "f0700000-0000-4000-8000-000000000009" },
    });
    await expect(dispatchApprovedWorkflowDraft(foreign.ports, { orgId, draftId })).rejects.toThrow(
      "workflow_approved_draft_unavailable",
    );
    expect(missing.outbox.length + foreign.outbox.length).toBe(0);
    await expect(
      dispatchApprovedWorkflowDraft(missing.ports, { orgId: "nope", draftId }),
    ).rejects.toThrow("workflow_action_scope_invalid");
  });

  it("re-checks the organisation switch, recipients and template at dispatch time", async () => {
    const off = setup({ overrides: { orgWorkflowsEnabled: async () => false } });
    await expect(dispatchApprovedWorkflowDraft(off.ports, { orgId, draftId })).rejects.toThrow(
      "workflow_organization_disabled",
    );
    const left = setup({ overrides: { resolveRecipients: async () => [] } });
    await expect(dispatchApprovedWorkflowDraft(left.ports, { orgId, draftId })).rejects.toThrow(
      "workflow_recipient_scope_invalid",
    );
    const pulled = setup({ overrides: { approvedTemplate: async () => false } });
    await expect(dispatchApprovedWorkflowDraft(pulled.ports, { orgId, draftId })).rejects.toThrow(
      "workflow_action_template_unavailable",
    );
    for (const state of [off, left, pulled]) expect(state.outbox).toHaveLength(0);
  });

  it("a webhook draft needs its registered target still enabled; a non-webhook never carries one", async () => {
    const webhook: ApprovedWorkflowDraft = {
      ...approved,
      kind: "webhook",
      category: "external_authority_share",
      templateRef: null,
      templateParams: {},
      webhookTargetId: "f0760000-0000-4000-8000-000000000001",
    };
    const ok = setup({ draft: webhook });
    await dispatchApprovedWorkflowDraft(ok.ports, { orgId, draftId });
    expect(ok.outbox[0]).toMatchObject({ webhookTargetId: webhook.webhookTargetId });
    const disabled = setup({
      draft: webhook,
      overrides: { webhookTargetEnabled: async () => false },
    });
    await expect(dispatchApprovedWorkflowDraft(disabled.ports, { orgId, draftId })).rejects.toThrow(
      "workflow_webhook_target_unavailable",
    );
    const stray = setup({ draft: { ...approved, webhookTargetId: webhook.webhookTargetId } });
    await expect(dispatchApprovedWorkflowDraft(stray.ports, { orgId, draftId })).rejects.toThrow(
      "workflow_webhook_target_unavailable",
    );
  });

  it("is idempotent at the broker: a second dispatch replays the recorded decision", async () => {
    const { ports, brokerKeys, outbox } = setup();
    await dispatchApprovedWorkflowDraft(ports, { orgId, draftId });
    await dispatchApprovedWorkflowDraft(ports, { orgId, draftId });
    expect(brokerKeys).toHaveLength(1);
    expect(outbox).toHaveLength(2);
    expect((outbox[1] as { brokerDecisionId: string }).brokerDecisionId).toBe("decision-1");
  });

  it("uses a broker key the outbox guard accepts and no other form", () => {
    expect(approvedDraftDecisionKey(draftId)).toBe(`wf-approved:${draftId}`);
  });
});
