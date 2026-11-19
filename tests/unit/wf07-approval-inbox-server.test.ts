import { describe, expect, it } from "vitest";
import {
  beginApprovalStepUp,
  decideApproval,
  listApprovals,
  viewApproval,
  type ApprovalInboxPorts,
  type ApprovalWebAuthnPort,
} from "@/lib/workflow/approval-inbox.server";
import { approvalErrorMessage, ApprovalInboxError } from "@/lib/workflow/approval-inbox";
import { approvalStepUpChallenge } from "@/lib/workflow/approval-step-up";

const actor = "a0000000-0000-4000-8000-000000000001";
const approval = "b0000000-0000-4000-8000-000000000001";
const digest = "a".repeat(64);
const nonce = "AAAAAAAAAAAAAAAAAAAAAA";
const stepUpId = "e0000000-0000-4000-8000-000000000001";

type Call = { fn: string; args: Record<string, unknown> };

function detailRow(patch: Record<string, unknown> = {}) {
  return {
    approval_id: approval,
    org_id: "c0000000-0000-4000-8000-000000000001",
    status: "pending",
    risk: "high",
    required_permission: "workflows.approve",
    category: "money_movement",
    requested_at: "2026-11-18T10:00:00Z",
    expires_at: "2026-11-25T10:00:00Z",
    requested_by_kind: "agent",
    summary: "Review drafted webhook action (money_movement)",
    digest,
    step_up_required: true,
    required: 2,
    votes: [],
    can_decide: true,
    blockers: [],
    draft: null,
    ...patch,
  };
}

function harness(
  options: {
    detail?: Record<string, unknown>;
    rpcError?: Record<string, { message: string }>;
    verify?: (input: Parameters<ApprovalWebAuthnPort["verifyAssertion"]>[0]) => Promise<unknown>;
    options?: () => Promise<unknown>;
  } = {},
) {
  const calls: Call[] = [];
  const webauthnCalls: string[] = [];
  const service: ApprovalWebAuthnPort = {
    assertionOptions: async (input) => {
      webauthnCalls.push("options");
      calls.push({ fn: "webauthn.assertionOptions", args: input as never });
      if (options.options) return (await options.options()) as never;
      return { challenge: input.challenge, rpId: "example.test" } as never;
    },
    verifyAssertion: async (input) => {
      webauthnCalls.push("verify");
      if (options.verify) return options.verify(input) as never;
      return { credentialRowId: "cred", verifiedAtMs: 0 } as never;
    },
  };
  const ports: ApprovalInboxPorts = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      const failure = options.rpcError?.[fn];
      if (failure) return { data: null, error: failure };
      switch (fn) {
        case "wf_inbox_list":
          return { data: [], error: null };
        case "wf_approval_view":
          return { data: detailRow(options.detail), error: null };
        case "wf_record_step_up":
          return {
            data: { step_up_id: stepUpId, expires_at: "2026-11-18T10:05:00Z" },
            error: null,
          };
        case "wf_decide_approval":
          return {
            data: { status: "pending", approvals: 1, required: 2, draft_id: null, org_id: "x" },
            error: null,
          };
        default:
          return { data: null, error: null };
      }
    },
    webauthn: async () => ({ service, origin: "https://app.example.test" }),
    rateKey: (userId) => `user:${userId}:203.0.113.9`,
    nonce: () => nonce,
  };
  return { ports, calls, webauthnCalls };
}

const names = (calls: Call[]) => calls.map((c) => c.fn);

describe("WF-07 inbox server operations", () => {
  it("reads through the database functions with the verified actor", async () => {
    const { ports, calls } = harness();
    await listApprovals(ports, { actorId: actor, filter: "pending" });
    const detail = await viewApproval(ports, { actorId: actor, approvalId: approval });
    expect(detail.digest).toBe(digest);
    expect(calls[0]).toEqual({
      fn: "wf_inbox_list",
      args: { p_actor: actor, p_status: "pending", p_limit: 50 },
    });
    expect(calls[1]).toEqual({
      fn: "wf_approval_view",
      args: { p_actor: actor, p_approval: approval },
    });
  });

  it("maps a database refusal to a safe error", async () => {
    const { ports } = harness({ rpcError: { wf_approval_view: { message: "wf07:not_found" } } });
    await expect(
      viewApproval(ports, { actorId: actor, approvalId: approval }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("issues a passkey request whose challenge binds person, approval, digest and nonce", async () => {
    const { ports, calls } = harness();
    const begun = await beginApprovalStepUp(ports, { actorId: actor, approvalId: approval });
    expect(begun.nonce).toBe(nonce);
    expect(begun.digest).toBe(digest);
    const issued = calls.find((c) => c.fn === "webauthn.assertionOptions");
    expect(issued?.args.challenge).toBe(
      approvalStepUpChallenge({ userId: actor, approvalId: approval, digest, nonce }),
    );
    expect(issued?.args.userId).toBe(actor);
    expect(issued?.args.rateKey).toContain(actor);
  });

  it("does not prompt a person the rules exclude, a decided item, or a normal-risk item", async () => {
    for (const [detail, code] of [
      [{ can_decide: false, blockers: ["requester"] }, "requester"],
      [{ status: "approved", can_decide: false, blockers: ["not_pending"] }, "not_pending"],
      [{ risk: "normal", step_up_required: false, required: 1 }, "step_up_not_required"],
    ] as const) {
      const { ports, webauthnCalls } = harness({ detail });
      await expect(
        beginApprovalStepUp(ports, { actorId: actor, approvalId: approval }),
      ).rejects.toMatchObject({ code });
      expect(webauthnCalls).toEqual([]);
    }
  });

  it("audits a failed passkey request by reason code and tells the person safely", async () => {
    const { ports, calls } = harness({
      options: async () => {
        throw Object.assign(new Error("Passkeys are not available on this site yet."), {
          code: "unavailable",
        });
      },
    });
    await expect(
      beginApprovalStepUp(ports, { actorId: actor, approvalId: approval }),
    ).rejects.toMatchObject({ code: "passkey_unavailable" });
    expect(calls.at(-1)).toEqual({
      fn: "wf_audit_step_up_failed",
      args: { p_actor: actor, p_approval: approval, p_reason: "no_passkey" },
    });
  });

  it("approves a high-risk item only after verifying the assertion, then records and consumes it", async () => {
    const { ports, calls } = harness({
      verify: async (input) => {
        const expected = approvalStepUpChallenge({
          userId: actor,
          approvalId: approval,
          digest,
          nonce,
        });
        expect(input.challengeAccepted(expected)).toBe(true);
        expect(input.userId).toBe(actor);
        return { credentialRowId: "c", verifiedAtMs: 1 };
      },
    });
    const result = await decideApproval(ports, {
      actorId: actor,
      approvalId: approval,
      decision: "approve",
      digest,
      nonce,
      response: { id: "x".repeat(20) } as never,
    });
    expect(result).toMatchObject({ status: "pending", approvals: 1, required: 2 });
    expect(names(calls)).toEqual(["wf_record_step_up", "wf_decide_approval"]);
    expect(calls[0]?.args).toEqual({ p_actor: actor, p_approval: approval, p_digest: digest });
    expect(calls[1]?.args).toMatchObject({
      p_actor: actor,
      p_approval: approval,
      p_decision: "approve",
      p_digest: digest,
      p_step_up: stepUpId,
    });
  });

  it("an assertion signed for another approval is refused, audited, and decides nothing", async () => {
    const { ports, calls } = harness({
      verify: async (input) => {
        const foreign = approvalStepUpChallenge({
          userId: actor,
          approvalId: "b0000000-0000-4000-8000-000000000009",
          digest,
          nonce,
        });
        if (!input.challengeAccepted(foreign)) {
          throw Object.assign(new Error("Passkey sign-in did not succeed."), {
            code: "auth_failed",
          });
        }
        return {};
      },
    });
    await expect(
      decideApproval(ports, {
        actorId: actor,
        approvalId: approval,
        decision: "approve",
        digest,
        nonce,
        response: { id: "x".repeat(20) } as never,
      }),
    ).rejects.toMatchObject({ code: "step_up_failed" });
    expect(names(calls)).toEqual(["wf_audit_step_up_failed"]);
    expect(calls[0]?.args.p_reason).toBe("challenge_mismatch");
  });

  it("maps a rate limit and an invalid assertion to their own audit reasons", async () => {
    const limited = harness({
      verify: async () => {
        throw Object.assign(new Error("Too many passkey attempts."), { code: "rate_limited" });
      },
    });
    await expect(
      decideApproval(limited.ports, {
        actorId: actor,
        approvalId: approval,
        decision: "approve",
        digest,
        nonce,
        response: {} as never,
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(limited.calls[0]?.args.p_reason).toBe("assertion_rate_limited");
    expect(names(limited.calls)).not.toContain("wf_decide_approval");

    const invalid = harness({
      verify: async (input) => {
        input.challengeAccepted(
          approvalStepUpChallenge({ userId: actor, approvalId: approval, digest, nonce }),
        );
        throw new Error("signature check failed");
      },
    });
    await expect(
      decideApproval(invalid.ports, {
        actorId: actor,
        approvalId: approval,
        decision: "approve",
        digest,
        nonce,
        response: {} as never,
      }),
    ).rejects.toMatchObject({ code: "step_up_failed" });
    expect(invalid.calls[0]?.args.p_reason).toBe("assertion_invalid");
  });

  it("still refuses when the audit write itself fails", async () => {
    const { ports } = harness({
      rpcError: {},
      verify: async () => {
        throw new Error("bad");
      },
    });
    const failing: ApprovalInboxPorts = {
      ...ports,
      rpc: async (fn, args) => {
        if (fn === "wf_audit_step_up_failed") throw new Error("audit down");
        return ports.rpc(fn, args);
      },
    };
    await expect(
      decideApproval(failing, {
        actorId: actor,
        approvalId: approval,
        decision: "approve",
        digest,
        nonce,
        response: {} as never,
      }),
    ).rejects.toBeInstanceOf(ApprovalInboxError);
  });

  it("approving without proof reaches the database, which refuses a high-risk item", async () => {
    const { ports, calls, webauthnCalls } = harness({
      rpcError: { wf_decide_approval: { message: "wf07:step_up_invalid" } },
    });
    await expect(
      decideApproval(ports, { actorId: actor, approvalId: approval, decision: "approve", digest }),
    ).rejects.toMatchObject({ code: "step_up_invalid" });
    expect(webauthnCalls).toEqual([]);
    expect(calls[0]?.args.p_step_up).toBeNull();
  });

  it("rejecting needs no passkey and never touches WebAuthn", async () => {
    const { ports, calls, webauthnCalls } = harness();
    await decideApproval(ports, {
      actorId: actor,
      approvalId: approval,
      decision: "reject",
      digest,
      note: "Wrong class",
    });
    expect(webauthnCalls).toEqual([]);
    expect(names(calls)).toEqual(["wf_decide_approval"]);
    expect(calls[0]?.args).toMatchObject({
      p_decision: "reject",
      p_note: "Wrong class",
      p_step_up: null,
    });
  });

  it("surfaces stale content, requester and expiry as safe sentences", async () => {
    for (const code of ["stale_content", "requester", "expired", "already_voted"] as const) {
      const { ports } = harness({ rpcError: { wf_decide_approval: { message: `wf07:${code}` } } });
      await expect(
        decideApproval(ports, { actorId: actor, approvalId: approval, decision: "reject", digest }),
      ).rejects.toThrow(approvalErrorMessage(code));
    }
  });

  it("refuses a passkey proof that arrives without its request code", async () => {
    const { ports, webauthnCalls } = harness();
    await expect(
      decideApproval(ports, {
        actorId: actor,
        approvalId: approval,
        decision: "approve",
        digest,
        response: {} as never,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(webauthnCalls).toEqual([]);
  });

  it("treats a transport failure as unavailable and exposes nothing", async () => {
    const { ports } = harness();
    const down: ApprovalInboxPorts = {
      ...ports,
      rpc: async () => {
        throw new Error("ECONNRESET 10.0.0.1 secret-host");
      },
    };
    await expect(listApprovals(down, { actorId: actor, filter: "pending" })).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
