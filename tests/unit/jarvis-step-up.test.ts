import { describe, expect, it } from "vitest";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { TimeAuthority, type Clock } from "../../frontend/src/lib/kernel/time-authority";
import { createMemoryWebAuthnStore } from "../../frontend/src/lib/auth/webauthn-memory-store";
import { parseWebAuthnConfig } from "../../frontend/src/lib/auth/webauthn-policy";
import {
  WebAuthnServiceError,
  createWebAuthnService,
  type WebAuthnVerifiers,
} from "../../frontend/src/lib/auth/webauthn.server";
import type { WebAuthnDirectory } from "../../frontend/src/lib/auth/webauthn-store";
import {
  STEP_UP_CONTEXT,
  isValidStepUpBinding,
  newStepUpNonce,
  stepUpChallenge,
  stepUpChallengeMatches,
  type StepUpBinding,
} from "../../frontend/src/lib/jarvis-bridge/step-up";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORIGIN = "https://app.sherivs.com";
const BASE_MS = Date.parse("2026-11-16T08:00:00.000Z");

const binding = (over: Partial<StepUpBinding> = {}): StepUpBinding => ({
  userId: OWNER,
  approvalId: "appr-1",
  decision: "approve",
  nonce: newStepUpNonce(),
  ...over,
});

describe("JARVIS step-up challenge binding", () => {
  it("is deterministic and bound to signer, approval, decision and nonce", () => {
    const b = binding();
    expect(stepUpChallenge(b)).toBe(stepUpChallenge({ ...b }));
    for (const change of [
      { userId: OTHER },
      { approvalId: "appr-2" },
      { decision: "deny" as const },
      { nonce: newStepUpNonce() },
    ]) {
      expect(stepUpChallenge({ ...b, ...change })).not.toBe(stepUpChallenge(b));
    }
    expect(STEP_UP_CONTEXT).toContain("step-up");
  });

  it("matches only the exact challenge and refuses malformed input", () => {
    const b = binding();
    expect(stepUpChallengeMatches(stepUpChallenge(b), b)).toBe(true);
    expect(stepUpChallengeMatches(stepUpChallenge({ ...b, approvalId: "appr-9" }), b)).toBe(false);
    expect(stepUpChallengeMatches(null, b)).toBe(false);
    expect(stepUpChallengeMatches("", b)).toBe(false);
    expect(isValidStepUpBinding({ ...b, nonce: "short" })).toBe(false);
    expect(isValidStepUpBinding({ ...b, approvalId: "a b|c" })).toBe(false);
    expect(() => stepUpChallenge({ ...b, decision: "maybe" as never })).toThrow();
  });
});

class MutableClock implements Clock {
  readonly issuer = "clock:step-up-test";
  constructor(public ms: number) {}
  nowMs(): number {
    return this.ms;
  }
}

function clientData(challenge: string, type: string): string {
  return Buffer.from(JSON.stringify({ type, origin: ORIGIN, challenge })).toString("base64url");
}

function assertion(challenge: string, credentialId: string): AuthenticationResponseJSON {
  return {
    id: credentialId,
    rawId: credentialId,
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData(challenge, "webauthn.get"),
      authenticatorData: "b".repeat(32),
      signature: "c".repeat(32),
    },
  } as AuthenticationResponseJSON;
}

function setup(opts?: { verified?: boolean }) {
  const parsed = parseWebAuthnConfig({
    WEBAUTHN_RP_NAME: "Sherivs",
    WEBAUTHN_RP_ID: "sherivs.com",
    WEBAUTHN_ORIGIN: ORIGIN,
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const store = createMemoryWebAuthnStore();
  const clock = new MutableClock(BASE_MS);
  const audits: Array<Record<string, unknown>> = [];
  const verifiers: Partial<WebAuthnVerifiers> = {
    // Honours the caller's challenge exactly as the real generator does.
    generateAuthenticationOptions: async (o) => ({
      challenge: String(o.challenge),
      rpId: o.rpID,
      timeout: 60_000,
      userVerification: "required",
      allowCredentials: o.allowCredentials as never,
    }),
    generateRegistrationOptions: async (o) => ({
      challenge: "reg-challenge-0000000001",
      rp: { name: o.rpName, id: o.rpID },
      user: { id: "dXNlcg", name: o.userName, displayName: "" },
      pubKeyCredParams: [],
    }),
    verifyRegistrationResponse: async ({ expectedOrigin, expectedRPID }) => ({
      verified: true,
      registrationInfo: {
        fmt: "none",
        aaguid: "00000000-0000-0000-0000-000000000000",
        credential: {
          id: "cred-owner-0001",
          publicKey: new Uint8Array(16).map((_, i) => i + 1),
          counter: 0,
        },
        credentialType: "public-key",
        attestationObject: new Uint8Array([1]),
        userVerified: true,
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
        origin: String(expectedOrigin),
        rpID: String(expectedRPID),
      },
    }),
    verifyAuthenticationResponse: (async ({
      expectedOrigin,
      expectedRPID,
      credential,
    }: Parameters<WebAuthnVerifiers["verifyAuthenticationResponse"]>[0]) =>
      opts?.verified === false
        ? { verified: false }
        : {
            verified: true,
            authenticationInfo: {
              credentialID: credential.id,
              newCounter: credential.counter + 1,
              userVerified: true,
              credentialDeviceType: "singleDevice",
              credentialBackedUp: false,
              origin: String(expectedOrigin),
              rpID: String(expectedRPID),
            },
          }) as never,
  };
  const directory: WebAuthnDirectory = {
    getUser: async (id) => ({
      id,
      email: `${id.slice(0, 8)}@sherivs.com`,
      emailConfirmed: true,
      displayName: "Owner",
      tenantUserId: null,
      schoolId: null,
    }),
  };
  const service = createWebAuthnService({
    store,
    directory,
    sessions: {
      mint: async () => {
        throw new Error("step-up must never mint a session");
      },
    },
    config: parsed.config,
    time: new TimeAuthority(clock),
    rateLimiter: { check: async () => ({ decision: "allow" as const }) },
    audit: async (e) => {
      audits.push(e as unknown as Record<string, unknown>);
    },
    verifiers,
  });
  return { service, store, clock, audits };
}

async function enroll(service: ReturnType<typeof setup>["service"], userId: string) {
  const reg = await service.registrationOptions({ userId, origin: ORIGIN, rateKey: userId });
  const response = {
    id: "credential-response-id-0001",
    rawId: "credential-response-id-0001",
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData(reg.challenge, "webauthn.create"),
      attestationObject: "a".repeat(32),
      transports: ["internal"],
    },
  } as RegistrationResponseJSON;
  await service.verifyRegistration({ userId, origin: ORIGIN, rateKey: userId, response });
}

const accepted = (b: StepUpBinding) => (signed: string) => stepUpChallengeMatches(signed, b);

describe("JARVIS step-up through the WebAuthn service", () => {
  it("verifies an assertion bound to this approval and decision, and mints no session", async () => {
    const { service, audits } = setup();
    await enroll(service, OWNER);
    const b = binding();
    const options = await service.assertionOptions({
      userId: OWNER,
      origin: ORIGIN,
      rateKey: OWNER,
      challenge: stepUpChallenge(b),
    });
    expect(options.challenge).toBe(stepUpChallenge(b));
    const stored = await service.list({ userId: OWNER });
    const credentialId = "cred-owner-0001";
    const result = await service.verifyAssertion({
      userId: OWNER,
      origin: ORIGIN,
      rateKey: OWNER,
      response: assertion(options.challenge, credentialId),
      challengeAccepted: accepted(b),
    });
    expect(result.verifiedAtMs).toBe(BASE_MS);
    expect(result.credentialRowId).toBe(stored[0]?.id);
    expect(audits.at(-1)).toMatchObject({
      action: "webauthn.step_up.verify",
      outcome: "succeeded",
    });
  });

  it("refuses to issue options when the user has no passkey", async () => {
    const { service } = setup();
    await expect(
      service.assertionOptions({
        userId: OWNER,
        origin: ORIGIN,
        rateKey: OWNER,
        challenge: stepUpChallenge(binding()),
      }),
    ).rejects.toBeInstanceOf(WebAuthnServiceError);
  });

  it("refuses an assertion made for a different approval or decision", async () => {
    const { service } = setup();
    await enroll(service, OWNER);
    const issued = binding();
    const options = await service.assertionOptions({
      userId: OWNER,
      origin: ORIGIN,
      rateKey: OWNER,
      challenge: stepUpChallenge(issued),
    });
    for (const want of [
      { ...issued, approvalId: "appr-2" },
      { ...issued, decision: "deny" as const },
    ]) {
      await expect(
        service.verifyAssertion({
          userId: OWNER,
          origin: ORIGIN,
          rateKey: OWNER,
          response: assertion(options.challenge, "cred-owner-0001"),
          challengeAccepted: accepted(want),
        }),
      ).rejects.toMatchObject({ code: "auth_failed" });
    }
  });

  it("is one-time: the same assertion cannot be replayed", async () => {
    const { service } = setup();
    await enroll(service, OWNER);
    const b = binding();
    const options = await service.assertionOptions({
      userId: OWNER,
      origin: ORIGIN,
      rateKey: OWNER,
      challenge: stepUpChallenge(b),
    });
    const input = {
      userId: OWNER,
      origin: ORIGIN,
      rateKey: OWNER,
      response: assertion(options.challenge, "cred-owner-0001"),
      challengeAccepted: accepted(b),
    };
    await service.verifyAssertion(input);
    await expect(service.verifyAssertion(input)).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("expires with the challenge", async () => {
    const { service, clock } = setup();
    await enroll(service, OWNER);
    const b = binding();
    const options = await service.assertionOptions({
      userId: OWNER,
      origin: ORIGIN,
      rateKey: OWNER,
      challenge: stepUpChallenge(b),
    });
    clock.ms += 60 * 60 * 1000;
    await expect(
      service.verifyAssertion({
        userId: OWNER,
        origin: ORIGIN,
        rateKey: OWNER,
        response: assertion(options.challenge, "cred-owner-0001"),
        challengeAccepted: accepted(b),
      }),
    ).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("refuses another user's challenge and another user's credential", async () => {
    const { service } = setup();
    await enroll(service, OWNER);
    const b = binding();
    const options = await service.assertionOptions({
      userId: OWNER,
      origin: ORIGIN,
      rateKey: OWNER,
      challenge: stepUpChallenge(b),
    });
    await expect(
      service.verifyAssertion({
        userId: OTHER,
        origin: ORIGIN,
        rateKey: OTHER,
        response: assertion(options.challenge, "cred-owner-0001"),
        challengeAccepted: accepted({ ...b, userId: OTHER }),
      }),
    ).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("refuses when the authenticator signature does not verify", async () => {
    const { service } = setup({ verified: false });
    await enroll(service, OWNER);
    const b = binding();
    const options = await service.assertionOptions({
      userId: OWNER,
      origin: ORIGIN,
      rateKey: OWNER,
      challenge: stepUpChallenge(b),
    });
    await expect(
      service.verifyAssertion({
        userId: OWNER,
        origin: ORIGIN,
        rateKey: OWNER,
        response: assertion(options.challenge, "cred-owner-0001"),
        challengeAccepted: accepted(b),
      }),
    ).rejects.toMatchObject({ code: "auth_failed" });
  });
});
