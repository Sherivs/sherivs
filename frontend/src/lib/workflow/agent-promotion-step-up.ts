/**
 * A3 (ADR-138): the server side of a passkey step-up for an agent promotion.
 *
 * Flow: (1) `begin` computes the digest of THIS promotion (org, agent, level, evidence) from server-held values and
 * asks the WebAuthn service for assertion options whose challenge binds the signer, the digest and a one-time nonce.
 * (2) `finish` verifies the assertion, records one evidence row (valid for four minutes, spent once), then calls the
 * database promotion, which spends the row. The database recomputes the digest, so evidence for one promotion can never
 * be spent on another. Nothing here grants anything: `wf_autonomy_promote` still decides.
 *
 * Dependency-injected so it is tested without a database or an authenticator.
 */
import { createHash, randomBytes } from "node:crypto";
import { agentPromotionDigest } from "./step-up-digest";

export const PROMOTION_STEP_UP_CONTEXT = "sherivs.a3.agent-promotion.v1";
/** The table allows at most five minutes; four leaves room for clock skew. */
export const STEP_UP_VALID_MS = 4 * 60_000;

const SAFE = /^[A-Za-z0-9._:-]{1,128}$/;
const NONCE = /^[A-Za-z0-9_-]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVELS = ["draft", "act_with_approval", "act_and_report"] as const;

export type PromotionRequest = {
  orgId: string;
  agentRef: string;
  toLevel: (typeof LEVELS)[number];
  evidenceId: string;
  reason: string;
};

export type StepUpFailureCode =
  "invalid_request" | "passkey_failed" | "evidence_not_recorded" | "promotion_refused";

export class StepUpError extends Error {
  readonly code: StepUpFailureCode;
  constructor(code: StepUpFailureCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function validatePromotion(req: PromotionRequest): void {
  const ok =
    UUID.test(req.orgId) &&
    UUID.test(req.evidenceId) &&
    SAFE.test(req.agentRef) &&
    (LEVELS as readonly string[]).includes(req.toLevel) &&
    req.reason.trim().length >= 10 &&
    req.reason.trim().length <= 300;
  if (!ok) throw new StepUpError("invalid_request", "invalid promotion request");
}

export function newNonce(): string {
  return randomBytes(16).toString("base64url");
}

/** The WebAuthn challenge (base64url): signer + promotion digest + one-time nonce. */
export function promotionChallenge(input: {
  userId: string;
  req: PromotionRequest;
  nonce: string;
}): string {
  if (!SAFE.test(input.userId) || !NONCE.test(input.nonce)) {
    throw new StepUpError("invalid_request", "invalid binding");
  }
  validatePromotion(input.req);
  const digest = agentPromotionDigest({
    orgId: input.req.orgId,
    agentRef: input.req.agentRef,
    toLevel: input.req.toLevel,
    evidenceId: input.req.evidenceId,
  });
  return createHash("sha256")
    .update([PROMOTION_STEP_UP_CONTEXT, input.userId, digest, input.nonce].join("|"), "utf8")
    .digest("base64url");
}

export function challengeMatches(signed: string | null, expected: string): boolean {
  if (!signed || signed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1)
    diff |= signed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export interface StepUpWebAuthn {
  assertionOptions(input: { userId: string; challenge: string }): Promise<unknown>;
  verifyAssertion(input: {
    userId: string;
    response: unknown;
    challengeAccepted: (signedChallenge: string) => boolean;
  }): Promise<{ verifiedAtMs: number }>;
}

export interface StepUpEvidenceStore {
  /** Inserts one evidence row (service role). */
  record(row: {
    userId: string;
    actionKind: "agent_promotion";
    subjectDigest: string;
    verifiedAt: string;
    expiresAt: string;
  }): Promise<void>;
}

export interface PromotionGate {
  /** Calls `wf_autonomy_promote`. Resolves with the database result or a refusal message. */
  promote(
    input: PromotionRequest & { actorId: string },
  ): Promise<{ ok: true; from: string; to: string } | { ok: false; message: string }>;
}

export function createAgentPromotionStepUp(deps: {
  webauthn: StepUpWebAuthn;
  evidence: StepUpEvidenceStore;
  gate: PromotionGate;
}) {
  return {
    async begin(input: { userId: string; req: PromotionRequest }) {
      validatePromotion(input.req);
      const nonce = newNonce();
      const challenge = promotionChallenge({ userId: input.userId, req: input.req, nonce });
      const options = await deps.webauthn.assertionOptions({ userId: input.userId, challenge });
      return { options, nonce };
    },

    async finish(input: {
      userId: string;
      req: PromotionRequest;
      nonce: string;
      response: unknown;
    }) {
      validatePromotion(input.req);
      const expected = promotionChallenge({
        userId: input.userId,
        req: input.req,
        nonce: input.nonce,
      });
      let verifiedAtMs: number;
      try {
        ({ verifiedAtMs } = await deps.webauthn.verifyAssertion({
          userId: input.userId,
          response: input.response,
          challengeAccepted: (signed) => challengeMatches(signed, expected),
        }));
      } catch {
        // No evidence is written and the reason is not revealed.
        throw new StepUpError("passkey_failed", "passkey verification failed");
      }
      const digest = agentPromotionDigest({
        orgId: input.req.orgId,
        agentRef: input.req.agentRef,
        toLevel: input.req.toLevel,
        evidenceId: input.req.evidenceId,
      });
      try {
        await deps.evidence.record({
          userId: input.userId,
          actionKind: "agent_promotion",
          subjectDigest: digest,
          verifiedAt: new Date(verifiedAtMs).toISOString(),
          expiresAt: new Date(verifiedAtMs + STEP_UP_VALID_MS).toISOString(),
        });
      } catch {
        throw new StepUpError("evidence_not_recorded", "step-up could not be recorded");
      }
      const result = await deps.gate.promote({ ...input.req, actorId: input.userId });
      if (!result.ok) throw new StepUpError("promotion_refused", result.message);
      return result;
    },
  };
}
