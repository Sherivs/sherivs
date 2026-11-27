import { describe, expect, it } from "vitest";
import {
  ApprovalDecideInput,
  ApprovalInboxError,
  approvalDisplayState,
  approvalErrorFromDatabase,
  approvalErrorMessage,
  currentApprovals,
  isWaitingForSecondApprover,
  parseApprovalDetail,
  parseInboxList,
  safeApprovalMessage,
  type ApprovalDetail,
} from "@/lib/workflow/approval-inbox";

const me = "a0000000-0000-4000-8000-000000000001";
const other = "a0000000-0000-4000-8000-000000000002";
const approval = "b0000000-0000-4000-8000-000000000001";
const digest = "a".repeat(64);

function row(patch: Record<string, unknown> = {}) {
  return {
    approval_id: approval,
    org_id: "c0000000-0000-4000-8000-000000000001",
    status: "pending",
    risk: "high",
    required_permission: "workflows.approve",
    category: "safeguarding",
    requested_at: "2026-11-18T10:00:00Z",
    expires_at: "2026-11-25T10:00:00Z",
    requested_by_kind: "agent",
    summary: "Review drafted in_app action (safeguarding)",
    digest,
    step_up_required: true,
    required: 2,
    votes: [],
    can_decide: true,
    blockers: [],
    draft: {
      id: "d0000000-0000-4000-8000-000000000001",
      kind: "in_app",
      category: "safeguarding",
      status: "draft",
      template_ref: "welfare.notice",
      params: { child: "Tobi", contact: "mum@example.com" },
      recipient_count: 2,
      recipient_ids: [me, other],
      audience: null,
      data_class: "minor_sensitive",
      template_available: true,
      template_body: "Welfare note for {{child}} via {{contact}}",
    },
    ...patch,
  };
}

function detail(patch: Record<string, unknown> = {}): ApprovalDetail {
  return parseApprovalDetail(row(patch), me);
}

describe("WF-07 approval inbox shapes", () => {
  it("parses the list the database returns and rejects a malformed row", () => {
    const items = parseInboxList([
      {
        approval_id: approval,
        kind: "draft",
        action_kind: "sms",
        category: "mass_message",
        risk: "high",
        status: "pending",
        requested_at: "2026-11-18T10:00:00Z",
        expires_at: "2026-11-25T10:00:00Z",
        workflow: "attendance",
        approvals: 1,
        required: 2,
        voted_by_me: true,
      },
    ]);
    expect(items[0]).toMatchObject({
      approvalId: approval,
      approvals: 1,
      required: 2,
      votedByMe: true,
    });
    expect(() => parseInboxList([{ approval_id: "nope" }])).toThrow(ApprovalInboxError);
    expect(() => parseInboxList({ not: "a list" })).toThrow(ApprovalInboxError);
  });

  it("keeps raw approver ids and template source out of what the screen receives", () => {
    const parsed = detail({
      votes: [
        {
          approver_id: other,
          decision: "approve",
          decided_at: "2026-11-18T11:00:00Z",
          current: true,
        },
        { approver_id: me, decision: "approve", decided_at: "2026-11-18T12:00:00Z", current: true },
      ],
    });
    const text = JSON.stringify(parsed);
    expect(text).not.toContain(other);
    expect(text).not.toContain("template_body");
    expect(text).not.toContain("Welfare note for {{child}}");
    expect(text).not.toContain("recipient_ids");
    expect(parsed.votes.map((v) => v.approverRef)).toEqual([other.slice(0, 8), me.slice(0, 8)]);
    expect(parsed.votes.map((v) => v.mine)).toEqual([false, true]);
  });

  it("builds the preview with contact details masked", () => {
    const parsed = detail();
    expect(parsed.preview?.text).toBe("Welfare note for Tobi via m***@example.com");
    expect(parsed.preview?.masked).toBe(1);
    expect(parsed.draft?.paramKeys).toEqual(["child", "contact"]);
  });

  it("requires a well-formed content digest", () => {
    expect(() => detail({ digest: "short" })).toThrow(ApprovalInboxError);
  });

  it("maps database refusal codes to safe sentences and never leaks unknown text", () => {
    expect(approvalErrorFromDatabase({ message: "wf07:requester" }).code).toBe("requester");
    expect(approvalErrorFromDatabase({ message: "ERROR: wf07:stale_content (x)" }).code).toBe(
      "stale_content",
    );
    expect(approvalErrorFromDatabase({ message: "wf07:note_too_long" }).code).toBe(
      "invalid_request",
    );
    const unknown = approvalErrorFromDatabase({
      message: "relation wf_approval_decision violates ...",
    });
    expect(unknown.code).toBe("unavailable");
    expect(unknown.message).not.toContain("wf_approval_decision");
    expect(approvalErrorFromDatabase(null).code).toBe("unavailable");
  });

  it("shows only our own sentences to the person", () => {
    expect(safeApprovalMessage(new Error(approvalErrorMessage("expired")))).toBe(
      approvalErrorMessage("expired"),
    );
    expect(safeApprovalMessage(new Error("duplicate key value violates unique constraint"))).toBe(
      approvalErrorMessage("unavailable"),
    );
    expect(safeApprovalMessage("string")).toBe(approvalErrorMessage("unavailable"));
  });
});

describe("WF-07 what the detail view is in", () => {
  it("high risk and decidable: asks for a passkey", () => {
    expect(approvalDisplayState(detail())).toEqual({ kind: "needs_step_up" });
  });

  it("normal risk and decidable: ready, no passkey", () => {
    expect(
      approvalDisplayState(detail({ risk: "normal", step_up_required: false, required: 1 })),
    ).toEqual({
      kind: "ready",
    });
  });

  it("after my approval of a two-person item: waiting for the second approver", () => {
    const d = detail({
      can_decide: false,
      blockers: ["already_voted"],
      votes: [
        { approver_id: me, decision: "approve", decided_at: "2026-11-18T12:00:00Z", current: true },
      ],
    });
    expect(approvalDisplayState(d)).toEqual({ kind: "waiting_for_others", have: 1, need: 2 });
    expect(isWaitingForSecondApprover(d)).toBe(true);
  });

  it("when someone else has approved and I can still decide, I see the count, not a blocker", () => {
    const d = detail({
      votes: [
        {
          approver_id: other,
          decision: "approve",
          decided_at: "2026-11-18T12:00:00Z",
          current: true,
        },
      ],
    });
    expect(approvalDisplayState(d)).toEqual({ kind: "needs_step_up" });
    expect(currentApprovals(d)).toBe(1);
    expect(isWaitingForSecondApprover(d)).toBe(true);
  });

  it("explains why a person the rules exclude cannot decide", () => {
    for (const reason of ["requester", "author", "not_authorized"] as const) {
      expect(approvalDisplayState(detail({ can_decide: false, blockers: [reason] }))).toEqual({
        kind: "blocked",
        reason,
      });
    }
  });

  it("an approval cast on earlier content does not count towards the required number", () => {
    const d = detail({
      votes: [
        {
          approver_id: other,
          decision: "approve",
          decided_at: "2026-11-18T12:00:00Z",
          current: false,
        },
      ],
    });
    expect(currentApprovals(d)).toBe(0);
    expect(isWaitingForSecondApprover(d)).toBe(false);
  });

  it("decided and expired items are shown as decided", () => {
    for (const status of ["approved", "rejected", "expired", "cancelled"] as const) {
      expect(
        approvalDisplayState(detail({ status, can_decide: false, blockers: ["not_pending"] })),
      ).toEqual({
        kind: "decided",
        status,
      });
    }
  });
});

describe("WF-07 request validation", () => {
  const base = { approvalId: approval, decision: "approve", digest };

  it("accepts a reject without any passkey and an approve with or without proof", () => {
    expect(
      ApprovalDecideInput.safeParse({ ...base, decision: "reject", note: " too late " }).success,
    ).toBe(true);
    expect(ApprovalDecideInput.safeParse(base).success).toBe(true);
  });

  it("refuses a malformed digest, id, decision or oversized note", () => {
    expect(ApprovalDecideInput.safeParse({ ...base, digest: "abc" }).success).toBe(false);
    expect(ApprovalDecideInput.safeParse({ ...base, approvalId: "1" }).success).toBe(false);
    expect(ApprovalDecideInput.safeParse({ ...base, decision: "deny" }).success).toBe(false);
    expect(ApprovalDecideInput.safeParse({ ...base, note: "x".repeat(1001) }).success).toBe(false);
  });

  it("never takes the approver from the request: unknown keys are dropped", () => {
    const parsed = ApprovalDecideInput.parse({ ...base, approver: me, actorId: me, p_actor: me });
    expect(Object.keys(parsed).sort()).toEqual(["approvalId", "decision", "digest"]);
  });
});
