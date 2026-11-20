import { describe, expect, it } from "vitest";
import { runWorkflowApprovalSweep } from "@/lib/workflow/workflow-approval-sweep.server";

const org = "f0800000-0000-4000-8000-000000000001";
const d1 = "f0810000-0000-4000-8000-000000000001";
const d2 = "f0810000-0000-4000-8000-000000000002";

function ports(ready: unknown[], dispatchFails: string[] = []) {
  const calls: string[] = [];
  const dispatched: string[] = [];
  return {
    calls,
    dispatched,
    ports: {
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        calls.push(args?.p_draft ? `${fn}:${args.p_draft}` : fn);
        if (fn === "wf_approved_drafts_ready") return { data: ready, error: null };
        if (fn === "wf_request_missing_draft_approvals") return { data: 0, error: null };
        if (fn === "wf_expire_approvals") return { data: {}, error: null };
        return { data: true, error: null };
      },
      dispatchApprovedDraft: async (_o: string, d: string) => {
        if (dispatchFails.includes(d)) throw new Error("workflow_approved_not_cleared");
        dispatched.push(d);
      },
    },
  };
}

describe("WF-08 sweep follow-up", () => {
  it("only resumes a draft whose executed record already exists (never dispatches it twice)", async () => {
    const t = ports([
      { org_id: org, draft_id: d1, needs_dispatch: false },
      { org_id: org, draft_id: d2, needs_dispatch: true },
    ]);
    const counts = await runWorkflowApprovalSweep(t.ports);
    expect(t.dispatched).toEqual([d2]);
    expect(t.calls).toContain(`wf_resume_after_dispatch:${d1}`);
    expect(t.calls).toContain(`wf_resume_after_dispatch:${d2}`);
    expect(counts).toMatchObject({ dispatched: 2, failed: 0 });
  });

  it("treats a missing needs_dispatch flag as needing dispatch (older database)", async () => {
    const t = ports([{ org_id: org, draft_id: d1 }]);
    await runWorkflowApprovalSweep(t.ports);
    expect(t.dispatched).toEqual([d1]);
  });

  it("notes a failed dispatch so the database can rotate it behind newer drafts, and keeps going", async () => {
    const t = ports(
      [
        { org_id: org, draft_id: d1, needs_dispatch: true },
        { org_id: org, draft_id: d2, needs_dispatch: true },
      ],
      [d1],
    );
    const counts = await runWorkflowApprovalSweep(t.ports);
    expect(t.calls).toContain(`wf_note_draft_dispatch_failure:${d1}`);
    expect(t.calls).not.toContain(`wf_note_draft_dispatch_failure:${d2}`);
    expect(t.dispatched).toEqual([d2]);
    expect(counts).toMatchObject({ dispatched: 1, failed: 1 });
  });

  it("does not note a failure when only the resume failed", async () => {
    const t = ports([{ org_id: org, draft_id: d1, needs_dispatch: false }]);
    const failing = {
      ...t.ports,
      rpc: async (fn: string, args?: Record<string, unknown>) =>
        fn === "wf_resume_after_dispatch"
          ? { data: null, error: { message: "x" } }
          : t.ports.rpc(fn, args),
    };
    const counts = await runWorkflowApprovalSweep(failing);
    expect(counts.failed).toBe(1);
    expect(t.calls.some((c) => c.startsWith("wf_note_draft_dispatch_failure"))).toBe(false);
  });
});
