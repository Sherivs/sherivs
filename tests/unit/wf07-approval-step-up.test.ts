import { describe, expect, it } from "vitest";
import {
  APPROVAL_STEP_UP_CONTEXT,
  approvalStepUpChallenge,
  approvalStepUpChallengeMatches,
  isValidApprovalStepUpBinding,
  newApprovalStepUpNonce,
  type ApprovalStepUpBinding,
} from "@/lib/workflow/approval-step-up";

const binding: ApprovalStepUpBinding = {
  userId: "a0000000-0000-4000-8000-000000000001",
  approvalId: "b0000000-0000-4000-8000-000000000002",
  digest: "c".repeat(64),
  nonce: "AAAAAAAAAAAAAAAAAAAAAA",
};

describe("WF-07 passkey step-up binding", () => {
  it("is deterministic and base64url (43 characters for a SHA-256)", () => {
    const first = approvalStepUpChallenge(binding);
    expect(first).toBe(approvalStepUpChallenge({ ...binding }));
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("changes when any bound part changes: person, approval, content or request code", () => {
    const base = approvalStepUpChallenge(binding);
    const others = [
      { ...binding, userId: "a0000000-0000-4000-8000-000000000009" },
      { ...binding, approvalId: "b0000000-0000-4000-8000-000000000009" },
      { ...binding, digest: "d".repeat(64) },
      { ...binding, nonce: "BBBBBBBBBBBBBBBBBBBBBB" },
    ];
    for (const other of others) expect(approvalStepUpChallenge(other)).not.toBe(base);
  });

  it("refuses to sign a challenge made for a different approval or different content", () => {
    const signed = approvalStepUpChallenge(binding);
    expect(approvalStepUpChallengeMatches(signed, binding)).toBe(true);
    expect(
      approvalStepUpChallengeMatches(signed, {
        ...binding,
        approvalId: "b0000000-0000-4000-8000-000000000003",
      }),
    ).toBe(false);
    expect(approvalStepUpChallengeMatches(signed, { ...binding, digest: "e".repeat(64) })).toBe(
      false,
    );
  });

  it("rejects missing, short and malformed input instead of throwing a partial match", () => {
    expect(approvalStepUpChallengeMatches(null, binding)).toBe(false);
    expect(approvalStepUpChallengeMatches("", binding)).toBe(false);
    expect(approvalStepUpChallengeMatches("short", binding)).toBe(false);
    expect(
      approvalStepUpChallengeMatches(approvalStepUpChallenge(binding), { ...binding, nonce: "x" }),
    ).toBe(false);
    expect(() => approvalStepUpChallenge({ ...binding, digest: "not-a-digest" })).toThrow(
      "invalid_approval_step_up_binding",
    );
  });

  it("validates identifiers, digest and nonce shape", () => {
    expect(isValidApprovalStepUpBinding(binding)).toBe(true);
    expect(isValidApprovalStepUpBinding({ ...binding, userId: "not-a-uuid" })).toBe(false);
    expect(isValidApprovalStepUpBinding({ ...binding, approvalId: "1|2" })).toBe(false);
    expect(isValidApprovalStepUpBinding({ ...binding, digest: "C".repeat(64) })).toBe(false);
    expect(isValidApprovalStepUpBinding({ ...binding, nonce: "a|b" })).toBe(false);
  });

  it("is distinct from the Jarvis owner step-up context and issues fresh nonces", () => {
    expect(APPROVAL_STEP_UP_CONTEXT).toBe("sherivs.workflow.approval-step-up.v1");
    const a = newApprovalStepUpNonce();
    const b = newApprovalStepUpNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
  });

  it("treats the same UUID in upper case as the same person (the database stores lower case)", () => {
    expect(approvalStepUpChallenge({ ...binding, userId: binding.userId.toUpperCase() })).toBe(
      approvalStepUpChallenge(binding),
    );
  });
});
