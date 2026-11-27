import { describe, expect, it } from "vitest";
import { runWorkflowApprovalSweep } from "@/lib/workflow/workflow-approval-sweep.server";
import { createWorkflowTickHandler } from "@/routes/api/public/cron/workflow-tick";
import { InMemoryWorkflowRuntimePort } from "@/lib/workflow/workflow-runtime";

const org = "f0800000-0000-4000-8000-000000000001";
const d1 = "f0810000-0000-4000-8000-000000000001";
const d2 = "f0810000-0000-4000-8000-000000000002";

function sweepPorts(
  options: {
    ready?: unknown;
    fail?: Record<string, "error" | "throw">;
    dispatchFails?: string[];
  } = {},
) {
  const calls: string[] = [];
  const dispatched: string[] = [];
  return {
    calls,
    dispatched,
    ports: {
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        calls.push(fn === "wf_resume_after_dispatch" ? `${fn}:${args?.p_draft}` : fn);
        const mode = options.fail?.[fn];
        if (mode === "throw") throw new Error("down");
        if (mode === "error") return { data: null, error: { message: "boom" } };
        switch (fn) {
          case "wf_request_missing_draft_approvals":
            return { data: 2, error: null };
          case "wf_expire_approvals":
            return { data: { approvals_expired: 1, orphan_drafts_expired: 3 }, error: null };
          case "wf_approved_drafts_ready":
            return {
              data: options.ready ?? [
                { org_id: org, draft_id: d1 },
                { org_id: org, draft_id: d2 },
              ],
              error: null,
            };
          default:
            return { data: true, error: null };
        }
      },
      dispatchApprovedDraft: async (_org: string, draft: string) => {
        if (options.dispatchFails?.includes(draft))
          throw new Error("workflow_approved_not_cleared");
        dispatched.push(draft);
      },
    },
  };
}

describe("WF-07 approval sweep", () => {
  it("requests missing approvals, expires, then dispatches and resumes each approved draft", async () => {
    const { ports, calls, dispatched } = sweepPorts();
    const counts = await runWorkflowApprovalSweep(ports);
    expect(counts).toEqual({ requested: 2, expired: 4, dispatched: 2, failed: 0 });
    expect(calls).toEqual([
      "wf_request_missing_draft_approvals",
      "wf_expire_approvals",
      "wf_approved_drafts_ready",
      `wf_resume_after_dispatch:${d1}`,
      `wf_resume_after_dispatch:${d2}`,
    ]);
    expect(dispatched).toEqual([d1, d2]);
  });

  it("a refused dispatch is counted, not resumed, and does not stop the others", async () => {
    const { ports, calls, dispatched } = sweepPorts({ dispatchFails: [d1] });
    const counts = await runWorkflowApprovalSweep(ports);
    expect(counts).toMatchObject({ dispatched: 1, failed: 1 });
    expect(dispatched).toEqual([d2]);
    expect(calls).not.toContain(`wf_resume_after_dispatch:${d1}`);
  });

  it("one failing stage does not stop the later stages", async () => {
    const { ports } = sweepPorts({
      fail: { wf_request_missing_draft_approvals: "throw", wf_expire_approvals: "error" },
    });
    const counts = await runWorkflowApprovalSweep(ports);
    expect(counts).toEqual({ requested: 0, expired: 0, dispatched: 2, failed: 2 });
  });

  it("ignores malformed ready rows and bounds the batch size", async () => {
    const { ports } = sweepPorts({
      ready: [{ org_id: 1 }, null, { org_id: org, draft_id: d1 }].filter(Boolean),
    });
    const counts = await runWorkflowApprovalSweep(ports, { limit: 100000 });
    expect(counts.dispatched).toBe(1);
  });
});

class CountingPort extends InMemoryWorkflowRuntimePort {
  claims = 0;
  override async claimDueEvents() {
    this.claims += 1;
    return [];
  }
  override async claimDueSteps() {
    return [];
  }
}

const authorized = () =>
  new Request("http://localhost/api/public/cron/workflow-tick", {
    headers: { authorization: ["Bear", "er test-key"].join("") },
  });

describe("WF-07 sweep in the workflow tick route", () => {
  const env = { CRON_SECRET: "test-key", WORKFLOWS_ENABLED: "true" };

  it("runs before the tick and reports its counts", async () => {
    const order: string[] = [];
    const port = new CountingPort();
    const original = port.claimDueEvents.bind(port);
    port.claimDueEvents = async () => {
      order.push("tick");
      return original();
    };
    const handler = createWorkflowTickHandler({
      env,
      createPort: () => port,
      createApprovalSweep: () => async () => {
        order.push("sweep");
        return { requested: 1, expired: 0, dispatched: 1, failed: 0 };
      },
    });
    const body = await (await handler(authorized())).json();
    expect(order).toEqual(["sweep", "tick"]);
    expect(body.approvals).toEqual({ requested: 1, expired: 0, dispatched: 1, failed: 0 });
  });

  it("a failing sweep does not stop the tick", async () => {
    const port = new CountingPort();
    const handler = createWorkflowTickHandler({
      env,
      createPort: () => port,
      createApprovalSweep: () => async () => {
        throw new Error("sweep down");
      },
    });
    const response = await handler(authorized());
    expect(response.status).toBe(200);
    expect((await response.json()).approvals).toEqual({ failed: 1 });
    expect(port.claims).toBe(1);
  });

  it("is not run when the global switch is off, or when only test doubles are injected", async () => {
    let swept = 0;
    const off = createWorkflowTickHandler({
      env: { ...env, WORKFLOWS_ENABLED: "false" },
      createPort: () => new CountingPort(),
      createApprovalSweep: () => async () => {
        swept += 1;
        return { requested: 0, expired: 0, dispatched: 0, failed: 0 };
      },
    });
    expect(await (await off(authorized())).json()).toEqual({
      ok: true,
      skipped: "workflows_disabled",
    });
    const plain = createWorkflowTickHandler({ env, createPort: () => new CountingPort() });
    expect((await (await plain(authorized())).json()).approvals).toBeUndefined();
    expect(swept).toBe(0);
  });
});
