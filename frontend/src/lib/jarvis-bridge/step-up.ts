/**
 * JARVIS-CONSOLE-01: passkey step-up binding (Authority: Owner; Origin: Owner request 2026-11-16;
 * Creator: Claude; Created: 2026-11-16; Status: Active).
 *
 * A T3 approval needs a fresh passkey assertion that is bound to ONE approval and ONE decision.
 * The WebAuthn challenge is not random: it is the SHA-256 of a canonical string that names the
 * signer, the approval, the decision and a server-issued nonce. The server also stores the
 * challenge as a one-time row, so a challenge can neither be invented by a client nor reused.
 * Replaying an assertion made for approval A against approval B, or approve against deny,
 * produces a different digest and is refused.
 *
 * M6 (ADR-148) extends the binding with an optional subject digest: the onboarding console binds
 * an approval to ONE request AND the sha-256 of ONE plan, so an assertion made while reviewing one
 * plan cannot approve an edited plan. Bindings without a digest produce exactly the same challenge
 * as before, so existing JARVIS approvals are unchanged.
 *
 * Pure and dependency-free so the binding can be tested without a database or an authenticator.
 */
import { createHash, randomBytes } from "node:crypto";

export const STEP_UP_CONTEXT = "sherivs.jarvis.step-up.v1";

export type StepUpDecision = "approve" | "deny";

export interface StepUpBinding {
  readonly userId: string;
  readonly approvalId: string;
  readonly decision: StepUpDecision;
  /** Server-issued, base64url, 16 random bytes. */
  readonly nonce: string;
  /** Optional lowercase hex sha-256 of the exact subject approved (for example a plan hash). */
  readonly subjectDigest?: string;
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const NONCE = /^[A-Za-z0-9_-]{22}$/;
const DIGEST = /^[0-9a-f]{64}$/;

export function newStepUpNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function isValidStepUpBinding(b: StepUpBinding): boolean {
  return (
    SAFE_ID.test(b.userId) &&
    SAFE_ID.test(b.approvalId) &&
    (b.decision === "approve" || b.decision === "deny") &&
    NONCE.test(b.nonce) &&
    (b.subjectDigest === undefined || DIGEST.test(b.subjectDigest))
  );
}

/** The WebAuthn challenge (base64url) for a binding. Throws on a malformed binding. */
export function stepUpChallenge(b: StepUpBinding): string {
  if (!isValidStepUpBinding(b)) throw new Error("invalid_step_up_binding");
  const parts = [STEP_UP_CONTEXT, b.userId, b.approvalId, b.decision, b.nonce];
  if (b.subjectDigest !== undefined) parts.push(`subject:${b.subjectDigest}`);
  const canonical = parts.join("|");
  return createHash("sha256").update(canonical, "utf8").digest("base64url");
}

/** Constant-shape comparison of the challenge a client signed against the one we expect. */
export function stepUpChallengeMatches(signed: string | null, b: StepUpBinding): boolean {
  if (!signed || !isValidStepUpBinding(b)) return false;
  const expected = stepUpChallenge(b);
  if (signed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1)
    diff |= signed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
