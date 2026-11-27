import { describe, expect, it } from "vitest";
import type { Decision } from "@/lib/tool-broker/broker";
import type { WorkflowActionDispatcherPorts } from "@/lib/workflow/workflow-action-dispatcher.server";
import {
  dispatchWorkflowAction,
  enforceWorkflowQuota,
} from "@/lib/workflow/workflow-action-dispatcher.server";

const orgId = "f1200000-0000-4000-8000-000000000001";
const runId = "f1210000-0000-4000-8000-000000000001";
const stepRunId = "f1220000-0000-4000-8000-000000000001";
const levels = {
  template: "act_and_report",
  tenant: "act_and_report",
  agent: "act_and_report",
} as const;

function dispatcher(overrides: Partial<WorkflowActionDispatcherPorts> = {}, hasBinding = true) {
  const decisions = new Map<string, { id: string; decision: Decision; argsDigest: string }>();
  const outbox = new Map<string, unknown>();
  const drafts: unknown[] = [];
  const checks: Array<{ mode: string; kind: string; recipientCount: number }> = [];
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
    quotaCheck: async (check) => {
      checks.push(check);
      return { allowed: true, code: null };
    },
    createDraft: async (input) => {
      drafts.push(input);
    },
    createSandboxOutbox: async (input) => {
      outbox.set(`${input.orgId}:${input.idempotencyKey}`, input);
    },
    ...overrides,
  };
  return { ports, drafts, outbox, checks, brokerCalls: () => brokerCalls };
}

const email = {
  kind: "in_app",
  templateRef: "attendance.notice",
  dataClass: "internal",
  templateParams: { status: "absent" },
  recipientIds: [],
};
const input = (action: unknown) => ({
  orgId,
  runId,
  stepRunId,
  idempotencyKey: "wf-step-run:action:0",
  actionClass: "communication",
  authorizedActions: ["workflow.action.in_app"],
  autonomy: levels,
  action,
});
const draftOnly = {
  ...levels,
  template: "draft",
} as const;

describe("WF-12 quota pre-check in the action dispatcher", () => {
  it("checks in execute mode before the broker writes anything, and then records", async () => {
    const state = dispatcher();
    const result = await dispatchWorkflowAction(state.ports, input(email));
    expect(result).toEqual({ status: "executed" });
    expect(state.checks).toEqual([
      { orgId, runId, kind: "in_app", recipientCount: 0, mode: "execute" },
    ]);
  });

  it("refuses with a coded error and leaves no broker row, draft or record when the quota says no", async () => {
    const state = dispatcher({
      quotaCheck: async () => ({ allowed: false, code: "actions_per_hour" }),
    });
    await expect(dispatchWorkflowAction(state.ports, input(email))).rejects.toThrow(
      "workflow_quota_actions_per_hour",
    );
    expect(state.brokerCalls()).toBe(0);
    expect(state.drafts).toHaveLength(0);
    expect(state.outbox.size).toBe(0);
  });

  it("checks drafts in draft mode and writes no draft when refused", async () => {
    const ok = dispatcher();
    await dispatchWorkflowAction(ok.ports, { ...input(email), autonomy: draftOnly });
    expect(ok.checks).toEqual([{ orgId, runId, kind: "in_app", recipientCount: 0, mode: "draft" }]);
    expect(ok.drafts).toHaveLength(1);

    const refused = dispatcher({
      quotaCheck: async () => ({ allowed: false, code: "drafts_pending" }),
    });
    await expect(
      dispatchWorkflowAction(refused.ports, { ...input(email), autonomy: draftOnly }),
    ).rejects.toThrow("workflow_quota_drafts_pending");
    expect(refused.drafts).toHaveLength(0);
  });

  it("fails closed when the check throws, returns nothing, or the port is missing", async () => {
    for (const quotaCheck of [
      async () => {
        throw new Error("database down");
      },
      async () => undefined as never,
      async () => ({ allowed: "yes" as never, code: null }),
      undefined as never,
    ]) {
      const state = dispatcher({ quotaCheck });
      await expect(dispatchWorkflowAction(state.ports, input(email))).rejects.toThrow(
        "workflow_quota_unavailable",
      );
      expect(state.brokerCalls()).toBe(0);
      expect(state.outbox.size).toBe(0);
    }
  });

  it("never lets an odd refusal code through as a message", async () => {
    await expect(
      enforceWorkflowQuota(
        { quotaCheck: async () => ({ allowed: false, code: "x; DROP TABLE" }) },
        { orgId, runId, kind: "in_app", recipientCount: 0, mode: "draft" },
      ),
    ).rejects.toThrow("workflow_quota_unavailable");
    await expect(
      enforceWorkflowQuota(
        { quotaCheck: async () => ({ allowed: false, code: "spend_cap_day" }) },
        { orgId, runId, kind: "sms", recipientCount: 1, mode: "execute" },
      ),
    ).rejects.toThrow("workflow_quota_spend_cap_day");
  });
});
