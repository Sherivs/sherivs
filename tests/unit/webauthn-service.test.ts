import { describe, expect, it } from "vitest";
import type { RateLimiter } from "../../frontend/src/lib/ai-gateway.server";
import { TimeAuthority, type Clock } from "../../frontend/src/lib/kernel/time-authority";
import { createMemoryWebAuthnStore } from "../../frontend/src/lib/auth/webauthn-memory-store";
import { parseWebAuthnConfig } from "../../frontend/src/lib/auth/webauthn-policy";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  WebAuthnServiceError,
  createWebAuthnService,
  type WebAuthnVerifiers,
} from "../../frontend/src/lib/auth/webauthn.server";
import type {
  WebAuthnDirectory,
  WebAuthnSessionMinter,
  WebAuthnUserProfile,
} from "../../frontend/src/lib/auth/webauthn-store";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORIGIN = "https://app.sherivs.com";
const BASE_MS = Date.parse("2026-10-28T08:00:00.000Z");

class MutableClock implements Clock {
  readonly issuer = "clock:webauthn-test";
  constructor(public ms: number) {}
  nowMs(): number {
    return this.ms;
  }
}

function clientData(challenge: string, origin = ORIGIN, type = "webauthn.create"): string {
  return Buffer.from(JSON.stringify({ type, origin, challenge })).toString("base64url");
}

function profile(id: string, email = `${id.slice(0, 8)}@sherivs.com`): WebAuthnUserProfile {
  return {
    id,
    email,
    emailConfirmed: true,
    displayName: "Member",
    tenantUserId: id === USER_A ? USER_A : null,
    schoolId: id === USER_A ? "school-a" : null,
  };
}

function allowLimiter(): RateLimiter {
  return { check: async () => ({ decision: "allow" as const }) };
}

function denyLimiter(): RateLimiter {
  return { check: async () => ({ decision: "deny" as const, retryAfterMs: 15_000 }) };
}

function verifiers(): Partial<WebAuthnVerifiers> {
  let n = 0;
  return {
    generateRegistrationOptions: async (opts) => {
      n += 1;
      return {
        challenge: `reg-challenge-${String(n).padStart(16, "0")}`,
        rp: { name: opts.rpName, id: opts.rpID },
        user: { id: "dXNlcg", name: opts.userName, displayName: opts.userDisplayName ?? "" },
        pubKeyCredParams: [],
      };
    },
    generateAuthenticationOptions: async (opts) => ({
      challenge: `auth-challenge-${String((n += 1)).padStart(16, "0")}`,
      rpId: opts.rpID,
      timeout: 60_000,
      userVerification: "required",
    }),
    verifyRegistrationResponse: async ({ expectedChallenge, expectedOrigin, expectedRPID }) => {
      const origin = Array.isArray(expectedOrigin) ? expectedOrigin[0] : expectedOrigin;
      const rpID = Array.isArray(expectedRPID) ? expectedRPID[0] : expectedRPID;
      if (origin !== ORIGIN) throw new Error("wrong origin");
      if (rpID !== "sherivs.com") throw new Error("wrong rp");
      return {
        verified: true,
        registrationInfo: {
          fmt: "none",
          aaguid: "00000000-0000-0000-0000-000000000000",
          credential: {
            id: `cred-${String(expectedChallenge).slice(-12)}`,
            publicKey: new Uint8Array(16).map((_, i) => i + 1),
            counter: 0,
          },
          credentialType: "public-key",
          attestationObject: new Uint8Array([1]),
          userVerified: true,
          credentialDeviceType: "singleDevice",
          credentialBackedUp: false,
          origin,
          rpID,
        },
      };
    },
    verifyAuthenticationResponse: async ({
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      credential,
    }) => {
      const origin = Array.isArray(expectedOrigin) ? expectedOrigin[0] : expectedOrigin;
      const rpID = Array.isArray(expectedRPID) ? expectedRPID[0] : expectedRPID;
      if (origin !== ORIGIN) throw new Error("wrong origin");
      if (rpID !== "sherivs.com") throw new Error("wrong rp");
      if (!credential.publicKey || credential.publicKey.length < 8) throw new Error("bad key");
      return {
        verified: true,
        authenticationInfo: {
          credentialID: credential.id,
          newCounter: Math.max(1, credential.counter + 1),
          userVerified: true,
          credentialDeviceType: "singleDevice",
          credentialBackedUp: false,
          origin,
          rpID,
        },
      };
    },
  };
}

function harness(opts?: {
  limiter?: RateLimiter;
  clock?: MutableClock;
  mint?: WebAuthnSessionMinter["mint"];
  verifyAuth?: WebAuthnVerifiers["verifyAuthenticationResponse"];
  verifyReg?: WebAuthnVerifiers["verifyRegistrationResponse"];
  resolveConfig?: Parameters<typeof createWebAuthnService>[0]["resolveConfig"];
}) {
  const parsed = parseWebAuthnConfig({
    WEBAUTHN_RP_NAME: "Sherivs",
    WEBAUTHN_RP_ID: "sherivs.com",
    WEBAUTHN_ORIGIN: ORIGIN,
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const store = createMemoryWebAuthnStore();
  const users = new Map([
    [USER_A, profile(USER_A)],
    [USER_B, profile(USER_B)],
  ]);
  const directory: WebAuthnDirectory = {
    getUser: async (id) => users.get(id) ?? null,
  };
  const sessions: WebAuthnSessionMinter = {
    mint:
      opts?.mint ??
      (async (userId) => ({
        accessToken: `access-${userId}`,
        refreshToken: `refresh-${userId}`,
        expiresIn: 3600,
        userId,
      })),
  };
  const v = verifiers();
  if (opts?.verifyAuth) v.verifyAuthenticationResponse = opts.verifyAuth;
  if (opts?.verifyReg) v.verifyRegistrationResponse = opts.verifyReg;
  const clock = opts?.clock ?? new MutableClock(BASE_MS);
  const audits: Array<Record<string, unknown>> = [];
  const service = createWebAuthnService({
    store,
    directory,
    sessions,
    config: parsed.config,
    resolveConfig: opts?.resolveConfig,
    time: new TimeAuthority(clock),
    rateLimiter: opts?.limiter ?? allowLimiter(),
    audit: async (event) => {
      audits.push(event as unknown as Record<string, unknown>);
    },
    verifiers: v,
  });
  return { service, store, clock, audits };
}

function registrationResponse(challenge: string): RegistrationResponseJSON {
  return {
    id: "credential-response-id-0001",
    rawId: "credential-response-id-0001",
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData(challenge),
      attestationObject: "a".repeat(32),
      transports: ["internal"],
    },
  } as RegistrationResponseJSON;
}

function assertionResponse(
  challenge: string,
  credentialId: string,
  userId: string,
): AuthenticationResponseJSON {
  return {
    id: credentialId,
    rawId: credentialId,
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData(challenge, ORIGIN, "webauthn.get"),
      authenticatorData: "b".repeat(32),
      signature: "c".repeat(32),
      userHandle: Buffer.from(userId, "utf8").toString("base64url"),
    },
  } as AuthenticationResponseJSON;
}

describe("WebAuthn service ceremonies", () => {
  it("registers a passkey for the authenticated user and lists it without the public key", async () => {
    const { service } = harness();
    const options = await service.registrationOptions({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
    });
    const created = await service.verifyRegistration({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
      response: registrationResponse(options.challenge),
    });
    expect(created.label).toContain("This device");
    const listed = await service.list({ userId: USER_A });
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("publicKey");
    expect(listed[0]?.id).toBe(created.id);
  });

  it("rejects an invalid registration response", async () => {
    const { service } = harness({
      verifyReg: async () => ({ verified: false }),
    });
    const options = await service.registrationOptions({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
    });
    await expect(
      service.verifyRegistration({
        userId: USER_A,
        origin: ORIGIN,
        rateKey: USER_A,
        response: registrationResponse(options.challenge),
      }),
    ).rejects.toMatchObject({ code: "register_failed" });
  });

  it("rejects an expired registration challenge", async () => {
    const clock = new MutableClock(BASE_MS);
    const { service } = harness({ clock });
    const options = await service.registrationOptions({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
    });
    clock.ms = BASE_MS + 10 * 60_000;
    await expect(
      service.verifyRegistration({
        userId: USER_A,
        origin: ORIGIN,
        rateKey: USER_A,
        response: registrationResponse(options.challenge),
      }),
    ).rejects.toMatchObject({ code: "expired" });
  });

  it("rejects a replayed challenge", async () => {
    const { service } = harness();
    const options = await service.registrationOptions({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
    });
    const response = registrationResponse(options.challenge);
    await service.verifyRegistration({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
      response,
    });
    await expect(
      service.verifyRegistration({
        userId: USER_A,
        origin: ORIGIN,
        rateKey: USER_A,
        response,
      }),
    ).rejects.toMatchObject({ code: "expired" });
  });

  it("rejects the wrong origin and wrong RP ID", async () => {
    const { service } = harness();
    await expect(
      service.registrationOptions({
        userId: USER_A,
        origin: "https://evil.example",
        rateKey: USER_A,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });

    const options = await service.registrationOptions({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
    });
    const { service: rpFail } = harness({
      verifyReg: async () => {
        throw new Error("rp mismatch");
      },
    });
    await rpFail.registrationOptions({ userId: USER_A, origin: ORIGIN, rateKey: USER_A });
    await expect(
      rpFail.verifyRegistration({
        userId: USER_A,
        origin: ORIGIN,
        rateKey: USER_A,
        response: registrationResponse(options.challenge),
      }),
    ).rejects.toBeInstanceOf(WebAuthnServiceError);
  });

  it("establishes a Supabase session only after a verified assertion", async () => {
    let minted = 0;
    const { service, store } = harness({
      mint: async (userId) => {
        minted += 1;
        return { accessToken: "tok", refreshToken: "ref", expiresIn: 60, userId };
      },
    });
    const reg = await service.registrationOptions({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
    });
    await service.verifyRegistration({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
      response: registrationResponse(reg.challenge),
    });
    expect(minted).toBe(0);
    const credential = store.credentials[0];
    expect(credential?.userId).toBe(USER_A);
    const auth = await service.authenticationOptions({ origin: ORIGIN, rateKey: "ip" });
    const session = await service.verifyAuthentication({
      origin: ORIGIN,
      rateKey: "ip",
      response: assertionResponse(auth.challenge, credential!.credentialId, USER_A),
    });
    expect(minted).toBe(1);
    expect(session.userId).toBe(USER_A);
    expect(session.accessToken).toBe("tok");
  });

  it("rejects an invalid signature, unknown credential, and user-handle mismatch", async () => {
    const { service, store } = harness({
      verifyAuth: async () => {
        throw new Error("bad signature");
      },
    });
    const reg = await service.registrationOptions({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
    });
    await service.verifyRegistration({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
      response: registrationResponse(reg.challenge),
    });
    const auth = await service.authenticationOptions({ origin: ORIGIN, rateKey: "ip" });
    await expect(
      service.verifyAuthentication({
        origin: ORIGIN,
        rateKey: "ip",
        response: assertionResponse(auth.challenge, store.credentials[0]!.credentialId, USER_A),
      }),
    ).rejects.toMatchObject({ code: "auth_failed" });

    const { service: unknownSvc } = harness();
    const unknownOpts = await unknownSvc.authenticationOptions({ origin: ORIGIN, rateKey: "ip" });
    await expect(
      unknownSvc.verifyAuthentication({
        origin: ORIGIN,
        rateKey: "ip",
        response: assertionResponse(unknownOpts.challenge, "unknown-credential-id-xx", USER_A),
      }),
    ).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("rejects cross-user credential removal and rename", async () => {
    const { service } = harness();
    const options = await service.registrationOptions({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
    });
    const created = await service.verifyRegistration({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
      response: registrationResponse(options.challenge),
    });
    await expect(
      service.remove({ userId: USER_B, credentialId: created.id, rateKey: USER_B }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.rename({ userId: USER_B, credentialId: created.id, label: "Stolen" }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await service.list({ userId: USER_B })).toEqual([]);
    const remaining = await service.list({ userId: USER_A });
    expect(remaining).toHaveLength(1);
    await service.remove({ userId: USER_A, credentialId: created.id, rateKey: USER_A });
    expect(await service.list({ userId: USER_A })).toEqual([]);
  });

  it("does not mint a session when verification fails", async () => {
    let minted = 0;
    const { service } = harness({
      mint: async (userId) => {
        minted += 1;
        return { accessToken: "tok", refreshToken: "ref", expiresIn: 60, userId };
      },
    });
    const auth = await service.authenticationOptions({ origin: ORIGIN, rateKey: "ip" });
    await expect(
      service.verifyAuthentication({
        origin: ORIGIN,
        rateKey: "ip",
        response: assertionResponse(auth.challenge, "missing-credential-id-xx", USER_A),
      }),
    ).rejects.toMatchObject({ code: "auth_failed" });
    expect(minted).toBe(0);
  });

  it("rate-limits authentication options", async () => {
    const { service } = harness({ limiter: denyLimiter() });
    await expect(
      service.authenticationOptions({ origin: ORIGIN, rateKey: "ip" }),
    ).rejects.toMatchObject({ code: "rate_limited", httpStatus: 429 });
  });

  it("rejects an assertion whose userHandle does not match the stored user", async () => {
    const { service, store } = harness();
    const reg = await service.registrationOptions({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
    });
    await service.verifyRegistration({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
      response: registrationResponse(reg.challenge),
    });
    const auth = await service.authenticationOptions({ origin: ORIGIN, rateKey: "ip" });
    await expect(
      service.verifyAuthentication({
        origin: ORIGIN,
        rateKey: "ip",
        response: assertionResponse(auth.challenge, store.credentials[0]!.credentialId, USER_B),
      }),
    ).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("requires a known authenticated user to register", async () => {
    const { service } = harness();
    await expect(
      service.registrationOptions({
        userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        origin: ORIGIN,
        rateKey: "c",
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("shows first-login enrollment until the user skips or registers", async () => {
    const { service, store } = harness();
    const before = await service.onboardingState({ userId: USER_A });
    expect(before).toMatchObject({
      credentialCount: 0,
      onboardingStatus: "pending",
      passkeyFirst: true,
      preferencesAvailable: true,
    });
    const skipped = await service.dismissOnboarding({ userId: USER_A });
    expect(skipped.onboardingStatus).toBe("dismissed");
    expect(store.credentials).toHaveLength(0);
    await expect(service.dismissOnboarding({ userId: USER_B })).resolves.toMatchObject({
      onboardingStatus: "dismissed",
    });
  });

  it("marks onboarding enrolled only after a verified registration", async () => {
    const { service } = harness();
    await service.dismissOnboarding({ userId: USER_A });
    const options = await service.registrationOptions({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
    });
    await service.verifyRegistration({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
      response: registrationResponse(options.challenge),
    });
    const state = await service.onboardingState({ userId: USER_A });
    expect(state.credentialCount).toBe(1);
    expect(state.onboardingStatus).toBe("enrolled");
  });

  it("keeps passkey-first preference independent of whether a credential exists", async () => {
    const { service } = harness();
    const updated = await service.setPasskeyFirst({ userId: USER_A, passkeyFirst: false });
    expect(updated.passkeyFirst).toBe(false);
    expect(updated.credentialCount).toBe(0);
    expect(updated.onboardingStatus).toBe("pending");
    const other = await service.onboardingState({ userId: USER_B });
    expect(other.passkeyFirst).toBe(true);
  });

  it("records the RP ID and never a fingerprint or face modality", async () => {
    const { service, store } = harness();
    const options = await service.registrationOptions({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
    });
    await service.verifyRegistration({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
      response: registrationResponse(options.challenge),
    });
    expect(store.credentials[0]?.rpId).toBe("sherivs.com");
    expect(JSON.stringify(store.credentials[0])).not.toMatch(
      /fingerprint|face.?id|face.?recognition/i,
    );
    expect(store.credentials[0]).not.toHaveProperty("modality");
  });

  it("rejects a credential registered under a different RP ID", async () => {
    const { service, store } = harness();
    const options = await service.registrationOptions({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
    });
    await service.verifyRegistration({
      userId: USER_A,
      origin: ORIGIN,
      rateKey: USER_A,
      response: registrationResponse(options.challenge),
    });
    store.credentials[0]!.rpId = "school.edu.ng";
    const auth = await service.authenticationOptions({ origin: ORIGIN, rateKey: "ip" });
    await expect(
      service.verifyAuthentication({
        origin: ORIGIN,
        rateKey: "ip",
        response: assertionResponse(auth.challenge, store.credentials[0]!.credentialId, USER_A),
      }),
    ).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("fails closed when the origin has no authorized relying party", async () => {
    const { service } = harness({ resolveConfig: async () => null });
    await expect(
      service.authenticationOptions({ origin: "https://unverified.school.edu.ng", rateKey: "ip" }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
