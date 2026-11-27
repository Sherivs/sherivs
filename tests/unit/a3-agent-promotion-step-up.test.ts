import { describe, expect, it } from "vitest";
import {
  STEP_UP_VALID_MS,
  StepUpError,
  challengeMatches,
  createAgentPromotionStepUp,
  newNonce,
  promotionChallenge,
  type PromotionRequest,
} from "../../frontend/src/lib/workflow/agent-promotion-step-up";
import { agentPromotionDigest } from "../../frontend/src/lib/workflow/step-up-digest";

const ORG = "11111111-1111-4111-8111-111111111111";
const EVIDENCE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const req: PromotionRequest = {
  orgId: ORG,
  agentRef: "ledger",
  toLevel: "draft",
  evidenceId: EVIDENCE,
  reason: "Evidence suite passed twice",
};

function harness(opts: { verifyFails?: boolean; recordFails?: boolean; refuse?: boolean } = {}) {
  const calls: string[] = [];
  const rows: Array<Record<string, unknown>> = [];
  let accepted: ((s: string) => boolean) | null = null;
  const svc = createAgentPromotionStepUp({
    webauthn: {
      async assertionOptions(i) {
        calls.push("options");
        return { challenge: i.challenge };
      },
      async verifyAssertion(i) {
        calls.push("verify");
        accepted = i.challengeAccepted;
        if (opts.verifyFails) throw new Error("auth_failed");
        return { verifiedAtMs: Date.parse("2026-11-30T12:00:00Z") };
      },
    },
    evidence: {
      async record(row) {
        calls.push("record");
        if (opts.recordFails) throw new Error("x");
        rows.push(row);
      },
    },
    gate: {
      async promote() {
        calls.push("promote");
        return opts.refuse
          ? { ok: false as const, message: "The promotion was refused." }
          : { ok: true as const, from: "suggest", to: "draft" };
      },
    },
  });
  return { svc, calls, rows, accepted: () => accepted };
}

describe("agent promotion step-up", () => {
  it("binds the challenge to the signer, the promotion and the nonce", () => {
    const nonce = newNonce();
    const base = promotionChallenge({ userId: USER, req, nonce });
    expect(promotionChallenge({ userId: USER, req, nonce })).toBe(base);
    expect(promotionChallenge({ userId: USER, req, nonce: newNonce() })).not.toBe(base);
    expect(promotionChallenge({ userId: "someone-else", req, nonce })).not.toBe(base);
    expect(
      promotionChallenge({ userId: USER, req: { ...req, toLevel: "act_with_approval" }, nonce }),
    ).not.toBe(base);
    expect(promotionChallenge({ userId: USER, req: { ...req, evidenceId: ORG }, nonce })).not.toBe(
      base,
    );
  });

  it("records the evidence for exactly the digest the database recomputes, then promotes", async () => {
    const h = harness();
    const { nonce } = await h.svc.begin({ userId: USER, req });
    const out = await h.svc.finish({ userId: USER, req, nonce, response: {} });
    expect(out).toEqual({ ok: true, from: "suggest", to: "draft" });
    expect(h.calls).toEqual(["options", "verify", "record", "promote"]);
    expect(h.rows[0]).toMatchObject({
      userId: USER,
      actionKind: "agent_promotion",
      subjectDigest: agentPromotionDigest({
        orgId: ORG,
        agentRef: "ledger",
        toLevel: "draft",
        evidenceId: EVIDENCE,
      }),
    });
    const verified = Date.parse(String(h.rows[0]?.verifiedAt));
    expect(Date.parse(String(h.rows[0]?.expiresAt)) - verified).toBe(STEP_UP_VALID_MS);
    expect(STEP_UP_VALID_MS).toBeLessThanOrEqual(5 * 60_000);
  });

  it("only accepts the challenge issued for this promotion", async () => {
    const h = harness();
    const { nonce } = await h.svc.begin({ userId: USER, req });
    await h.svc.finish({ userId: USER, req, nonce, response: {} });
    const accept = h.accepted();
    expect(accept?.(promotionChallenge({ userId: USER, req, nonce }))).toBe(true);
    expect(
      accept?.(
        promotionChallenge({ userId: USER, req: { ...req, toLevel: "act_and_report" }, nonce }),
      ),
    ).toBe(false);
    expect(accept?.("")).toBe(false);
  });

  it("writes no evidence and does not promote when the passkey fails", async () => {
    const h = harness({ verifyFails: true });
    await expect(
      h.svc.finish({ userId: USER, req, nonce: newNonce(), response: {} }),
    ).rejects.toMatchObject({
      code: "passkey_failed",
    });
    expect(h.calls).toEqual(["verify"]);
    expect(h.rows).toHaveLength(0);
  });

  it("does not promote when the evidence cannot be recorded", async () => {
    const h = harness({ recordFails: true });
    await expect(
      h.svc.finish({ userId: USER, req, nonce: newNonce(), response: {} }),
    ).rejects.toMatchObject({
      code: "evidence_not_recorded",
    });
    expect(h.calls).toEqual(["verify", "record"]);
  });

  it("surfaces a refused promotion without leaking detail", async () => {
    const h = harness({ refuse: true });
    const err = await h.svc
      .finish({ userId: USER, req, nonce: newNonce(), response: {} })
      .catch((e) => e);
    expect(err).toBeInstanceOf(StepUpError);
    expect((err as StepUpError).code).toBe("promotion_refused");
  });

  it("refuses malformed requests before touching the authenticator", async () => {
    const h = harness();
    for (const bad of [
      { ...req, orgId: "nope" },
      { ...req, toLevel: "suggest" as never },
      { ...req, reason: "short" },
      { ...req, agentRef: "has space" },
    ]) {
      await expect(h.svc.begin({ userId: USER, req: bad })).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
    expect(h.calls).toEqual([]);
  });

  it("compares challenges in constant shape", () => {
    expect(challengeMatches("abc", "abc")).toBe(true);
    expect(challengeMatches("abc", "abd")).toBe(false);
    expect(challengeMatches(null, "abc")).toBe(false);
    expect(challengeMatches("ab", "abc")).toBe(false);
  });
});
