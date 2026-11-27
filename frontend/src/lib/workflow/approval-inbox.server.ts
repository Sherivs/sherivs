/**
 * WF-07: server operations behind the tenant approval inbox (ADR-122). Ports only: no database,
 * WebAuthn or request import, so the whole decision path runs in a unit test and in the sim e2e
 * against the real functions without a browser.
 *
 * Authority is the database's, not this file's. Every call passes the VERIFIED user id (from the
 * signed-in session, never from the request body) to a SECURITY DEFINER function that checks
 * `workflows.approve`, the requester and author rules, the one-vote rule and the content digest.
 * This module adds the part the database cannot do: verifying a WebAuthn assertion. A passkey
 * confirmation is bound to one approval and the content digest the approver saw (approval-step-up.ts),
 * is verified here, and is then recorded as single-use evidence valid for at most five minutes
 * (`wf_record_step_up`). `wf_decide_approval` consumes it. A failed check is audited by reason code.
 */
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import {
  ApprovalInboxError,
  approvalErrorFromDatabase,
  parseApprovalDetail,
  parseInboxList,
  type ApprovalDecideRequest,
  type ApprovalDetail,
  type ApprovalInboxFilter,
  type ApprovalInboxItem,
} from "./approval-inbox";
import {
  approvalStepUpChallenge,
  approvalStepUpChallengeMatches,
  isValidApprovalStepUpBinding,
  type ApprovalStepUpBinding,
} from "./approval-step-up";

export interface ApprovalRpcResult {
  readonly data: unknown;
  readonly error: { readonly message?: unknown; readonly code?: unknown } | null;
}

export interface ApprovalWebAuthnPort {
  assertionOptions(input: {
    userId: string;
    origin: string;
    rateKey: string;
    challenge: string;
  }): Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAssertion(input: {
    userId: string;
    origin: string;
    rateKey: string;
    response: AuthenticationResponseJSON;
    challengeAccepted: (signedChallenge: string) => boolean;
  }): Promise<unknown>;
}

export interface ApprovalInboxPorts {
  readonly rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<ApprovalRpcResult>;
  /** Created only when a passkey is needed, so reading the inbox never loads WebAuthn. */
  readonly webauthn: () => Promise<{ service: ApprovalWebAuthnPort; origin: string }>;
  readonly rateKey: (userId: string) => string;
  readonly nonce: () => string;
}

async function call(
  ports: ApprovalInboxPorts,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let result: ApprovalRpcResult;
  try {
    result = await ports.rpc(fn, args);
  } catch {
    throw new ApprovalInboxError("unavailable");
  }
  if (result.error) throw approvalErrorFromDatabase(result.error);
  return result.data;
}

export async function listApprovals(
  ports: ApprovalInboxPorts,
  input: { actorId: string; filter: ApprovalInboxFilter },
): Promise<ApprovalInboxItem[]> {
  const data = await call(ports, "wf_inbox_list", {
    p_actor: input.actorId,
    p_status: input.filter,
    p_limit: 50,
  });
  return parseInboxList(data);
}

export async function viewApproval(
  ports: ApprovalInboxPorts,
  input: { actorId: string; approvalId: string },
): Promise<ApprovalDetail> {
  const data = await call(ports, "wf_approval_view", {
    p_actor: input.actorId,
    p_approval: input.approvalId,
  });
  return parseApprovalDetail(data, input.actorId);
}

type WebAuthnFailure =
  "assertion_invalid" | "assertion_rate_limited" | "challenge_mismatch" | "no_passkey";

function webAuthnFailureReason(err: unknown): WebAuthnFailure {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "rate_limited") return "assertion_rate_limited";
  if (code === "unavailable") return "no_passkey";
  return "assertion_invalid";
}

async function auditStepUpFailure(
  ports: ApprovalInboxPorts,
  actorId: string,
  approvalId: string,
  reason: WebAuthnFailure,
): Promise<void> {
  try {
    await ports.rpc("wf_audit_step_up_failed", {
      p_actor: actorId,
      p_approval: approvalId,
      p_reason: reason,
    });
  } catch {
    /* the refusal is still returned; the audit write is best effort for failures only */
  }
}

function failureToError(reason: WebAuthnFailure): ApprovalInboxError {
  if (reason === "assertion_rate_limited") return new ApprovalInboxError("rate_limited");
  if (reason === "no_passkey") return new ApprovalInboxError("passkey_unavailable");
  return new ApprovalInboxError("step_up_failed");
}

/**
 * Issues the passkey request for one approval. The digest is read from the database now, so the
 * challenge binds to the content as it stands, and a person the rules exclude never gets a prompt.
 */
export async function beginApprovalStepUp(
  ports: ApprovalInboxPorts,
  input: { actorId: string; approvalId: string },
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; nonce: string; digest: string }> {
  const detail = await viewApproval(ports, input);
  if (detail.status !== "pending") throw new ApprovalInboxError("not_pending");
  if (!detail.canDecide) throw new ApprovalInboxError(detail.blockers[0] ?? "not_authorized");
  if (!detail.stepUpRequired) throw new ApprovalInboxError("step_up_not_required");
  const binding: ApprovalStepUpBinding = {
    userId: input.actorId,
    approvalId: input.approvalId,
    digest: detail.digest,
    nonce: ports.nonce(),
  };
  if (!isValidApprovalStepUpBinding(binding)) throw new ApprovalInboxError("invalid_request");
  try {
    const { service, origin } = await ports.webauthn();
    const options = await service.assertionOptions({
      userId: input.actorId,
      origin,
      rateKey: ports.rateKey(input.actorId),
      challenge: approvalStepUpChallenge(binding),
    });
    return { options, nonce: binding.nonce, digest: detail.digest };
  } catch (err) {
    const reason = webAuthnFailureReason(err);
    await auditStepUpFailure(ports, input.actorId, input.approvalId, reason);
    throw failureToError(reason);
  }
}

export interface ApprovalDecisionResult {
  readonly status: "pending" | "approved" | "rejected";
  readonly approvals: number;
  readonly required: number;
  readonly draftId: string | null;
}

function parseDecisionResult(data: unknown): ApprovalDecisionResult {
  const row = (data ?? {}) as Record<string, unknown>;
  const status = row.status;
  if (status !== "pending" && status !== "approved" && status !== "rejected") {
    throw new ApprovalInboxError("unavailable");
  }
  const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
  return {
    status,
    approvals: count(row.approvals),
    required: Math.max(1, count(row.required)),
    draftId: typeof row.draft_id === "string" ? row.draft_id : null,
  };
}

/**
 * Records one person's decision. Rejecting needs no passkey (it moves to the safe state). Approving
 * a high-risk item needs a verified passkey assertion bound to this approval and this digest.
 */
export async function decideApproval(
  ports: ApprovalInboxPorts,
  input: ApprovalDecideRequest & { actorId: string },
): Promise<ApprovalDecisionResult> {
  let stepUpId: string | null = null;
  if (input.decision === "approve" && input.response) {
    const nonce = input.nonce;
    const binding: ApprovalStepUpBinding = {
      userId: input.actorId,
      approvalId: input.approvalId,
      digest: input.digest,
      nonce: nonce ?? "",
    };
    if (!nonce || !isValidApprovalStepUpBinding(binding)) {
      throw new ApprovalInboxError("invalid_request");
    }
    let mismatch = false;
    try {
      const { service, origin } = await ports.webauthn();
      await service.verifyAssertion({
        userId: input.actorId,
        origin,
        rateKey: ports.rateKey(input.actorId),
        response: input.response as unknown as AuthenticationResponseJSON,
        challengeAccepted: (signed) => {
          const ok = approvalStepUpChallengeMatches(signed, binding);
          if (!ok) mismatch = true;
          return ok;
        },
      });
    } catch (err) {
      const reason: WebAuthnFailure = mismatch ? "challenge_mismatch" : webAuthnFailureReason(err);
      await auditStepUpFailure(ports, input.actorId, input.approvalId, reason);
      throw failureToError(reason);
    }
    const recorded = (await call(ports, "wf_record_step_up", {
      p_actor: input.actorId,
      p_approval: input.approvalId,
      p_digest: input.digest,
    })) as { step_up_id?: unknown } | null;
    if (!recorded || typeof recorded.step_up_id !== "string") {
      throw new ApprovalInboxError("unavailable");
    }
    stepUpId = recorded.step_up_id;
  }
  const data = await call(ports, "wf_decide_approval", {
    p_actor: input.actorId,
    p_approval: input.approvalId,
    p_decision: input.decision,
    p_note: input.note && input.note.length > 0 ? input.note : null,
    p_digest: input.digest,
    p_step_up: stepUpId,
  });
  return parseDecisionResult(data);
}
