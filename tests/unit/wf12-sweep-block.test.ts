import { describe, expect, it } from "vitest";
import { runWorkflowApprovalSweep } from "@/lib/workflow/workflow-approval-sweep.server";

const org = "f1200000-0000-4000-8000-000000000001";
const draft = "f1210000-0000-4000-8000-000000000001";

function run(error: Error) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  return {
    calls,
    result: runWorkflowApprovalSweep({
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (fn === "wf_approved_drafts_ready") {
          return { data: [{ org_id: org, draft_id: draft, needs_dispatch: true }], error: null };
        }
        return { data: 0, error: null };
      },
      dispatchApprovedDraft: async () => {
        throw error;
      },
    }),
  };
}

describe("WF-12: an approved draft that can never execute is parked, not retried every pass", () => {
  for (const code of ["spend_rate_unknown", "kind_unknown"]) {
    it(`parks a draft refused with ${code}`, async () => {
      const { calls, result } = run(new Error(`workflow_quota_${code}`));
      expect((await result).failed).toBe(1);
      expect(calls.filter((c) => c.fn === "wf_block_draft_dispatch")).toEqual([
        { fn: "wf_block_draft_dispatch", args: { p_org: org, p_draft: draft, p_code: code } },
      ]);
      expect(calls.some((c) => c.fn === "wf_note_draft_dispatch_failure")).toBe(false);
    });
  }

  it("still notes an ordinary failure, and a cap that can clear with time is not parked", async () => {
    for (const message of ["workflow_quota_spend_cap_day", "workflow_delivery_refused", "boom"]) {
      const { calls, result } = run(new Error(message));
      await result;
      expect(calls.some((c) => c.fn === "wf_block_draft_dispatch")).toBe(false);
      expect(calls.some((c) => c.fn === "wf_note_draft_dispatch_failure")).toBe(true);
    }
  });
});
