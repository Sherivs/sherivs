/**
 * WF-07: passkey step-up binding for workflow approvals (ADR-122).
 *
 * Approving a high-risk item needs a fresh passkey assertion bound to ONE approval and the exact
 * content the approver saw. The WebAuthn challenge is not random: it is the SHA-256 of a canonical
 * string naming the signer, the approval, the content digest (computed in SQL) and a server-issued
 * nonce. The WebAuthn service also stores the challenge as a one-time row, so a challenge can
 * neither be invented by a client nor reused. An assertion made for another approval, another
 * person, or earlier content produces a different digest and is refused. After the server verifies
 * the assertion it records the result through `wf_record_step_up`, which stores single-use evidence
 * valid for at most five minutes. Only approving needs a step-up; rejecting moves to the safe state.
 *
 * Pure so the binding can be tested without a database or an authenticator.
 */
import { createHash, randomBytes } from "node:crypto";

export const APPROVAL_STEP_UP_CONTEXT = "sherivs.workflow.approval-step-up.v1";

export interface ApprovalStepUpBinding {
  readonly userId: string;
  readonly approvalId: string;
  /** Lower-case hex SHA-256 from `wf_approval_view` (never supplied by a client as proof). */
  readonly digest: string;
  /** Server-issued, base64url, 16 random bytes. */
  readonly nonce: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{22}$/;

export function newApprovalStepUpNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function isValidApprovalStepUpBinding(b: ApprovalStepUpBinding): boolean {
  return (
    UUID.test(b.userId) && UUID.test(b.approvalId) && DIGEST.test(b.digest) && NONCE.test(b.nonce)
  );
}

/** The WebAuthn challenge (base64url) for a binding. Throws on a malformed binding. */
export function approvalStepUpChallenge(b: ApprovalStepUpBinding): string {
  if (!isValidApprovalStepUpBinding(b)) throw new Error("invalid_approval_step_up_binding");
  const canonical = [
    APPROVAL_STEP_UP_CONTEXT,
    b.userId.toLowerCase(),
    b.approvalId.toLowerCase(),
    "approve",
    b.digest,
    b.nonce,
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("base64url");
}

/** Constant-shape comparison of the challenge a client signed against the one we expect. */
export function approvalStepUpChallengeMatches(
  signed: string | null,
  b: ApprovalStepUpBinding,
): boolean {
  if (!signed || !isValidApprovalStepUpBinding(b)) return false;
  const expected = approvalStepUpChallenge(b);
  if (signed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= signed.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
