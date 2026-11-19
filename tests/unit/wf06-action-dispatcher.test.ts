import { describe, expect, it } from "vitest";
import type { Decision } from "@/lib/tool-broker/broker";
import type { WorkflowActionDispatcherPorts } from "@/lib/workflow/workflow-action-dispatcher.server";
import { dispatchWorkflowAction } from "@/lib/workflow/workflow-action-dispatcher.server";

const orgId = "f0600000-0000-4000-8000-000000000001";
const runId = "f0610000-0000-4000-8000-000000000001";
const stepRunId = "f0620000-0000-4000-8000-000000000001";
const levels = {
  template: "act_and_report",
  tenant: "act_and_report",
  agent: "act_and_report",
} as const;

function dispatcher(overrides: Partial<WorkflowActionDispatcherPorts> = {}, hasBinding = true) {
  const decisions = new Map<string, { id: string; decision: Decision; argsDigest: string }>();
  const outbox = new Map<string, unknown>();
  const drafts: unknown[] = [];
  let brokerCalls = 0;
  const ports: WorkflowActionDispatcherPorts = {
    env: {
      WORKFLOW_DELIVERY_MODE: "sandbox",
      WORKFLOWS_ENABLED: "true",
      APP_ENV: "staging",
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
            effective: "act_autonomously",
          },
          state: {
            killSwitch: false,
            disabledTools: new Set(),
            callsThisHour: 0,
            binding: hasBinding
              ? {
                  connector: tool.connector,
                  scope: "tenant",
                  tenantRef: orgId,
                  secretRef: `vault://${tool.connector}/actions#v1`,
                  status: "active",
                }
              : null,
          },
        }),
      },
      ledger: {
        findDecision: async ({ twinContextId, toolId, idempotencyKey }) =>
          decisions.get(`${twinContextId}:${toolId}:${idempotencyKey}`) ?? null,
        appendDecision: async (input) => {
          brokerCalls += 1;
          const id = `decision-${brokerCalls}`;
          decisions.set(`${"context"}:${input.tool.id}:${input.idempotencyKey}`, {
            id,
            decision: input.decision,
            argsDigest: input.argsDigest,
          });
          return { id };
        },
      },
    },
    gate: {} as WorkflowActionDispatcherPorts["gate"],
    orgWorkflowsEnabled: async () => true,
    actionType: async (kind) => ({
      kind,
      category: "communication",
      brokerToolId: `workflow.action.${kind}`,
      brokerVersion: "1.0.0",
      effect: kind === "task" || kind === "wait" ? "internal_state" : "customer_visible",
      maxAutonomy: "act_and_report",
    }),
    approvedTemplate: async () => true,
    resolveRecipients: async (_org, ids) => ids,
    registeredWebhook: async () => null,
    brokerContext: async () => "context",
    createDraft: async (input) => {
      drafts.push(input);
    },
    createSandboxOutbox: async (input) => {
      outbox.set(`${input.orgId}:${input.idempotencyKey}`, input);
    },
    ...overrides,
  };
  return { ports, drafts, outbox, brokerCalls: () => brokerCalls };
}

function actionInput(
  action: unknown,
  patch: Partial<Parameters<typeof dispatchWorkflowAction>[1]> = {},
) {
  return {
    orgId,
    runId,
    stepRunId,
    idempotencyKey: "wf-step-run:action:0",
    actionClass: "communication",
    authorizedActions: [
      `workflow.action.${typeof action === "object" && action !== null && "kind" in action ? action.kind : "email"}`,
    ],
    autonomy: levels,
    action,
    ...patch,
  };
}

describe("WF-06 action dispatcher", () => {
  it("writes capped mass communication as a draft without calling the broker", async () => {
    const state = dispatcher();
    const recipients = Array.from(
      { length: 26 },
      (_, index) => `f0600000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`,
    );
    const result = await dispatchWorkflowAction(
      state.ports,
      actionInput({
        kind: "sms",
        templateRef: "attendance.notice",
        recipientIds: recipients,
      }),
    );
    expect(result).toEqual({ status: "draft" });
    expect(state.drafts).toHaveLength(1);
    expect(state.drafts[0]).toMatchObject({ category: "mass_message", recipientIds: recipients });
    expect(state.brokerCalls()).toBe(0);
    expect(state.outbox.size).toBe(0);
  });

  it("uses the registered action category when the workflow step understates its risk", async () => {
    const state = dispatcher({
      actionType: async (kind) => ({
        kind,
        category: "safeguarding",
        brokerToolId: `workflow.action.${kind}`,
        brokerVersion: "1.0.0",
        effect: "customer_visible",
        maxAutonomy: "act_and_report",
      }),
    });
    const result = await dispatchWorkflowAction(
      state.ports,
      actionInput({
        kind: "sms",
        templateRef: "attendance.notice",
        recipientIds: ["f0600000-0000-4000-8000-000000000002"],
      }),
    );
    expect(result).toEqual({ status: "draft" });
    expect(state.drafts).toHaveLength(1);
    expect(state.drafts[0]).toMatchObject({ category: "safeguarding" });
    expect(state.brokerCalls()).toBe(0);
  });

  it("preserves audience-selector intent in a capped draft", async () => {
    const state = dispatcher();
    const result = await dispatchWorkflowAction(
      state.ports,
      actionInput({
        kind: "sms",
        templateRef: "attendance.notice",
        audienceSelector: "all_guardians",
      }),
    );
    expect(result).toEqual({ status: "draft" });
    expect(state.drafts[0]).toMatchObject({
      category: "mass_message",
      audienceSelector: "all_guardians",
      recipientIds: [],
    });
    expect(state.brokerCalls()).toBe(0);
  });

  it("drafts registry entries with a money effect without invoking the broker", async () => {
    const state = dispatcher({
      actionType: async (kind) => ({
        kind,
        category: "communication",
        brokerToolId: `workflow.action.${kind}`,
        brokerVersion: "1.0.0",
        effect: "money",
        maxAutonomy: "act_and_report",
      }),
    });
    const result = await dispatchWorkflowAction(
      state.ports,
      actionInput({
        kind: "sms",
        templateRef: "attendance.notice",
        recipientIds: [],
      }),
    );
    expect(result).toEqual({ status: "draft" });
    expect(state.drafts[0]).toMatchObject({ category: "money_movement" });
    expect(state.brokerCalls()).toBe(0);
  });

  it("drafts unregistered webhook targets without calling the broker", async () => {
    const state = dispatcher();
    const result = await dispatchWorkflowAction(
      state.ports,
      actionInput({
        kind: "webhook",
        targetUrl: "https://hooks.example.test/workflow",
      }),
    );
    expect(result).toEqual({ status: "draft" });
    expect(state.drafts[0]).toMatchObject({
      category: "unregistered_webhook",
      webhookTargetId: null,
    });
    expect(state.brokerCalls()).toBe(0);
    expect(state.outbox.size).toBe(0);
  });

  it("records sandbox actions through the broker and an idempotent outbox", async () => {
    const state = dispatcher();
    const input = actionInput({
      kind: "in_app",
      templateRef: "attendance.notice",
      templateParams: { status: "absent" },
      recipientIds: [],
    });
    expect(await dispatchWorkflowAction(state.ports, input)).toEqual({ status: "executed" });
    expect(await dispatchWorkflowAction(state.ports, input)).toEqual({ status: "executed" });
    expect(state.brokerCalls()).toBe(1);
    expect(state.outbox.size).toBe(1);
  });

  it("keeps sandbox actions as drafts when the broker has no active connector binding", async () => {
    const state = dispatcher({}, false);
    const result = await dispatchWorkflowAction(
      state.ports,
      actionInput({
        kind: "in_app",
        templateRef: "attendance.notice",
        recipientIds: [],
      }),
    );
    expect(result).toEqual({ status: "draft" });
    expect(state.drafts).toHaveLength(1);
    expect(state.outbox.size).toBe(0);
    expect(state.brokerCalls()).toBe(1);
  });

  it("routes task and wait actions through broker decisions in sandbox mode", async () => {
    const state = dispatcher();
    for (const kind of ["task", "wait"] as const) {
      const result = await dispatchWorkflowAction(
        state.ports,
        actionInput({ kind }, { idempotencyKey: `wf-step-run:${kind}` }),
      );
      expect(result).toEqual({ status: "executed" });
    }
    expect(state.brokerCalls()).toBe(2);
    expect(state.outbox.size).toBe(2);
    expect(state.drafts).toHaveLength(0);
  });

  it("refuses live mode outside production before the broker or adapter is called", async () => {
    const state = dispatcher({
      env: {
        WORKFLOW_DELIVERY_MODE: "live",
        WORKFLOWS_ENABLED: "true",
        APP_ENV: "staging",
      },
    });
    await expect(
      dispatchWorkflowAction(
        state.ports,
        actionInput({
          kind: "in_app",
          templateRef: "attendance.notice",
          recipientIds: [],
        }),
      ),
    ).rejects.toThrow("workflow_delivery_refused");
    expect(state.brokerCalls()).toBe(0);
    expect(state.outbox.size).toBe(0);
  });

  it("refuses production live mode before ledgering when no broker adapter is available", async () => {
    const state = dispatcher({
      env: {
        WORKFLOW_DELIVERY_MODE: "live",
        WORKFLOWS_ENABLED: "true",
        APP_ENV: "production",
      },
    });
    await expect(
      dispatchWorkflowAction(
        state.ports,
        actionInput({
          kind: "in_app",
          templateRef: "attendance.notice",
          recipientIds: [],
        }),
      ),
    ).rejects.toThrow("workflow_live_adapter_unavailable");
    expect(state.brokerCalls()).toBe(0);
    expect(state.outbox.size).toBe(0);
  });

  it("refuses recipients that the server cannot resolve inside the run organization", async () => {
    const state = dispatcher({
      resolveRecipients: async () => null,
    });
    await expect(
      dispatchWorkflowAction(
        state.ports,
        actionInput({
          kind: "sms",
          templateRef: "attendance.notice",
          recipientIds: ["f0600000-0000-4000-8000-000000000002"],
        }),
      ),
    ).rejects.toThrow("workflow_recipient_scope_invalid");
    expect(state.drafts).toHaveLength(0);
    expect(state.brokerCalls()).toBe(0);
  });
});
