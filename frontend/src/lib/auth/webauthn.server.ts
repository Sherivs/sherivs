/**
 * Server-side WebAuthn service (SimpleWebAuthn v13).
 *
 * Challenges are generated per ceremony, bound to the user (registration) or
 * the ceremony (discoverable authentication), expired, and consumed once.
 * Session minting is delegated to Supabase Auth — this module never issues
 * application cookies of its own.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import type { RateLimiter } from "@/lib/ai-gateway.server";
import {
  WEBAUTHN_MAX_PASSKEYS_PER_USER,
  WEBAUTHN_PUBLIC_ERROR,
  type PasskeyOnboardingState,
  type PasskeyOnboardingStatus,
  type WebAuthnConfig,
  type WebAuthnPublicErrorCode,
  challengeExpired,
  credentialIdPrefix,
  decideSignatureCounter,
  defaultPasskeyLabel,
  originAllowedForRp,
  parseOnboardingStatus,
  sanitizePasskeyLabel,
  userHandleFromUserId,
  userIdFromUtf8Handle,
} from "./webauthn-policy";
import type {
  MintedSupabaseSession,
  PasskeyListItem,
  WebAuthnCredentialRecord,
  WebAuthnDirectory,
  WebAuthnPreferenceRecord,
  WebAuthnSessionMinter,
  WebAuthnStore,
} from "./webauthn-store";

export class WebAuthnServiceError extends Error {
  readonly code: WebAuthnPublicErrorCode;
  readonly httpStatus: number;
  constructor(code: WebAuthnPublicErrorCode, httpStatus = 400) {
    super(WEBAUTHN_PUBLIC_ERROR[code]);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(Buffer.from(value, "base64url"));
  return copy;
}

export function challengeFromClientDataJSON(clientDataJSON: string): string | null {
  try {
    const json = Buffer.from(clientDataJSON, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as { challenge?: unknown };
    return typeof parsed.challenge === "string" && parsed.challenge.length >= 16
      ? parsed.challenge
      : null;
  } catch {
    return null;
  }
}

function userIdFromUserHandle(handle: string | null | undefined): string | null {
  if (!handle) return null;
  try {
    const text = Buffer.from(handle, "base64url").toString("utf8");
    return userIdFromUtf8Handle(text);
  } catch {
    return null;
  }
}

const ALLOWED_TRANSPORTS = new Set([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

function sanitizeTransports(raw: unknown): AuthenticatorTransportFuture[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is AuthenticatorTransportFuture =>
      typeof item === "string" && ALLOWED_TRANSPORTS.has(item),
  );
}

export type WebAuthnAuditEvent = {
  action: string;
  userId: string | null;
  tenantUserId: string | null;
  schoolId: string | null;
  actorEmail: string | null;
  recordId: string | null;
  outcome: "succeeded" | "failed" | "denied";
  details: Record<string, unknown>;
};

export type WebAuthnAuditor = (event: WebAuthnAuditEvent) => Promise<void>;

export type WebAuthnVerifiers = {
  generateRegistrationOptions: typeof generateRegistrationOptions;
  verifyRegistrationResponse: typeof verifyRegistrationResponse;
  generateAuthenticationOptions: typeof generateAuthenticationOptions;
  verifyAuthenticationResponse: typeof verifyAuthenticationResponse;
};

export type WebAuthnServiceDeps = {
  store: WebAuthnStore;
  directory: WebAuthnDirectory;
  sessions: WebAuthnSessionMinter;
  config: WebAuthnConfig;
  resolveConfig?: (origin: string) => Promise<WebAuthnConfig | null>;
  time: TimeAuthority;
  rateLimiter: RateLimiter;
  audit: WebAuthnAuditor;
  verifiers?: Partial<WebAuthnVerifiers>;
};

function publicCredential(row: WebAuthnCredentialRecord): PasskeyListItem {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    transports: row.transports,
  };
}

function toWebAuthnCredential(row: WebAuthnCredentialRecord): WebAuthnCredential {
  return {
    id: row.credentialId,
    publicKey: base64UrlToBytes(row.publicKey),
    counter: Number(row.counter) || 0,
    transports: sanitizeTransports(row.transports),
  };
}

export function createWebAuthnService(deps: WebAuthnServiceDeps) {
  const verify = {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
    ...deps.verifiers,
  };

  async function enforceRate(bucket: string, key: string): Promise<void> {
    const decision = await deps.rateLimiter.check(`webauthn:${bucket}:${key}`);
    if (decision.decision === "deny") {
      throw new WebAuthnServiceError("rate_limited", 429);
    }
  }

  async function auditSafe(event: WebAuthnAuditEvent): Promise<void> {
    try {
      await deps.audit(event);
    } catch {
      /* auth-path audit is best-effort so a ledger outage cannot leak details */
    }
  }

  async function ceremonyFor(origin: string): Promise<{ origin: string; config: WebAuthnConfig }> {
    if (deps.resolveConfig) {
      const config = await deps.resolveConfig(origin);
      if (!config) throw new WebAuthnServiceError("unavailable");
      return { origin, config };
    }
    if (!originAllowedForRp(origin, deps.config)) {
      throw new WebAuthnServiceError("unavailable");
    }
    return { origin, config: deps.config };
  }

  async function credentialsForRp(
    userId: string,
    rpId: string,
  ): Promise<WebAuthnCredentialRecord[]> {
    return deps.store.listCredentials(userId, rpId);
  }

  async function readPreferences(userId: string): Promise<{
    row: WebAuthnPreferenceRecord;
    available: boolean;
  }> {
    try {
      const stored = await deps.store.getPreferences(userId);
      return {
        available: true,
        row: stored ?? {
          userId,
          onboardingStatus: "pending",
          passkeyFirst: true,
        },
      };
    } catch {
      return {
        available: false,
        row: { userId, onboardingStatus: "dismissed", passkeyFirst: true },
      };
    }
  }

  async function markEnrolled(
    userId: string,
    patch: { passkeyFirst?: boolean } = {},
  ): Promise<void> {
    try {
      const current = await deps.store.getPreferences(userId);
      await deps.store.upsertPreferences({
        userId,
        onboardingStatus: "enrolled",
        passkeyFirst: patch.passkeyFirst ?? current?.passkeyFirst ?? true,
      });
    } catch {
      /* preference table may be unapplied; credentials still persist */
    }
  }

  return {
    platformConfig: deps.config,
    async registrationOptions(input: {
      userId: string;
      origin: string;
      rateKey: string;
      label?: string;
    }): Promise<PublicKeyCredentialCreationOptionsJSON> {
      await enforceRate("register", input.rateKey);
      const { origin, config } = await ceremonyFor(input.origin);
      const profile = await deps.directory.getUser(input.userId);
      if (!profile) throw new WebAuthnServiceError("unauthorized", 401);
      if (!profile.email || !profile.emailConfirmed) {
        throw new WebAuthnServiceError("email_required");
      }
      const existing = await credentialsForRp(input.userId, config.rpID);
      if (existing.length >= WEBAUTHN_MAX_PASSKEYS_PER_USER) {
        throw new WebAuthnServiceError("limit");
      }
      const options = await verify.generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpID,
        userName: profile.email,
        userDisplayName: profile.displayName || profile.email,
        userID: userHandleFromUserId(input.userId),
        attestationType: "none",
        excludeCredentials: existing.map((row) => ({
          id: row.credentialId,
          transports: sanitizeTransports(row.transports),
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
      });
      const now = deps.time.now();
      await deps.store.insertChallenge({
        challenge: options.challenge,
        ceremony: "registration",
        userId: input.userId,
        rpId: config.rpID,
        origin,
        expiresAtMs: now.atMs + config.challengeTtlMs,
      });
      await auditSafe({
        action: "webauthn.register.options",
        userId: input.userId,
        tenantUserId: profile.tenantUserId,
        schoolId: profile.schoolId,
        actorEmail: profile.email,
        recordId: null,
        outcome: "succeeded",
        details: { origin_host: new URL(origin).hostname },
      });
      return options;
    },

    async verifyRegistration(input: {
      userId: string;
      origin: string;
      rateKey: string;
      response: RegistrationResponseJSON;
      label?: string;
    }): Promise<PasskeyListItem> {
      await enforceRate("register-verify", input.rateKey);
      const { origin, config } = await ceremonyFor(input.origin);
      const profile = await deps.directory.getUser(input.userId);
      if (!profile) throw new WebAuthnServiceError("unauthorized", 401);
      const challenge = challengeFromClientDataJSON(input.response.response.clientDataJSON);
      if (!challenge) throw new WebAuthnServiceError("register_failed");
      const now = deps.time.now();
      const stored = await deps.store.consumeChallenge(challenge, "registration", now.atMs);
      if (!stored) {
        await auditSafe({
          action: "webauthn.register.verify",
          userId: input.userId,
          tenantUserId: profile.tenantUserId,
          schoolId: profile.schoolId,
          actorEmail: profile.email,
          recordId: null,
          outcome: "denied",
          details: { reason: "challenge_unusable" },
        });
        throw new WebAuthnServiceError("expired");
      }
      if (
        stored.userId !== input.userId ||
        stored.rpId !== config.rpID ||
        stored.origin !== origin
      ) {
        throw new WebAuthnServiceError("register_failed");
      }
      if (challengeExpired(stored.expiresAtMs, now.atMs)) {
        throw new WebAuthnServiceError("expired");
      }
      let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
      try {
        verification = await verify.verifyRegistrationResponse({
          response: input.response,
          expectedChallenge: stored.challenge,
          expectedOrigin: origin,
          expectedRPID: config.rpID,
          requireUserVerification: true,
        });
      } catch {
        throw new WebAuthnServiceError("register_failed");
      }
      if (!verification.verified || !verification.registrationInfo) {
        await auditSafe({
          action: "webauthn.register.verify",
          userId: input.userId,
          tenantUserId: profile.tenantUserId,
          schoolId: profile.schoolId,
          actorEmail: profile.email,
          recordId: null,
          outcome: "denied",
          details: { reason: "not_verified" },
        });
        throw new WebAuthnServiceError("register_failed");
      }
      const info = verification.registrationInfo;
      if (info.origin !== origin || (info.rpID && info.rpID !== config.rpID)) {
        throw new WebAuthnServiceError("register_failed");
      }
      const credentialId = info.credential.id;
      const existing = await deps.store.getCredentialByCredentialId(credentialId);
      if (existing) throw new WebAuthnServiceError("already_registered");
      const count = await deps.store.countCredentials(input.userId, config.rpID);
      if (count >= WEBAUTHN_MAX_PASSKEYS_PER_USER) throw new WebAuthnServiceError("limit");
      const label =
        sanitizePasskeyLabel(input.label) ?? defaultPasskeyLabel(now.at, info.credentialDeviceType);
      try {
        const row = await deps.store.insertCredential({
          userId: input.userId,
          credentialId,
          publicKey: bytesToBase64Url(info.credential.publicKey),
          counter: info.credential.counter,
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          transports: sanitizeTransports(input.response.response.transports),
          aaguid: info.aaguid ?? null,
          label,
          rpId: config.rpID,
        });
        await markEnrolled(input.userId, { passkeyFirst: true });
        await auditSafe({
          action: "webauthn.register.verify",
          userId: input.userId,
          tenantUserId: profile.tenantUserId,
          schoolId: profile.schoolId,
          actorEmail: profile.email,
          recordId: row.id,
          outcome: "succeeded",
          details: {
            credential_id_prefix: credentialIdPrefix(credentialId),
            device_type: row.deviceType,
          },
        });
        return publicCredential(row);
      } catch (err) {
        if (err instanceof Error && err.message.includes("duplicate")) {
          throw new WebAuthnServiceError("already_registered");
        }
        throw new WebAuthnServiceError("register_failed");
      }
    },

    async authenticationOptions(input: {
      origin: string;
      rateKey: string;
    }): Promise<PublicKeyCredentialRequestOptionsJSON> {
      await enforceRate("auth", input.rateKey);
      const { origin, config } = await ceremonyFor(input.origin);
      const options = await verify.generateAuthenticationOptions({
        rpID: config.rpID,
        userVerification: "required",
        timeout: config.challengeTtlMs,
      });
      const now = deps.time.now();
      await deps.store.insertChallenge({
        challenge: options.challenge,
        ceremony: "authentication",
        userId: null,
        rpId: config.rpID,
        origin,
        expiresAtMs: now.atMs + config.challengeTtlMs,
      });
      return options;
    },

    async verifyAuthentication(input: {
      origin: string;
      rateKey: string;
      response: AuthenticationResponseJSON;
    }): Promise<MintedSupabaseSession> {
      await enforceRate("auth-verify", input.rateKey);
      const { origin, config } = await ceremonyFor(input.origin);
      const challenge = challengeFromClientDataJSON(input.response.response.clientDataJSON);
      if (!challenge) throw new WebAuthnServiceError("auth_failed");
      const now = deps.time.now();
      const stored = await deps.store.consumeChallenge(challenge, "authentication", now.atMs);
      if (!stored || stored.rpId !== config.rpID || stored.origin !== origin) {
        throw new WebAuthnServiceError("auth_failed");
      }
      const credential = await deps.store.getCredentialByCredentialId(input.response.id);
      if (!credential || credential.rpId !== config.rpID) {
        await auditSafe({
          action: "webauthn.authenticate.verify",
          userId: null,
          tenantUserId: null,
          schoolId: null,
          actorEmail: null,
          recordId: null,
          outcome: "denied",
          details: { reason: "unknown_credential" },
        });
        throw new WebAuthnServiceError("auth_failed");
      }
      const handleUser = userIdFromUserHandle(input.response.response.userHandle);
      if (handleUser && handleUser !== credential.userId) {
        await auditSafe({
          action: "webauthn.authenticate.verify",
          userId: credential.userId,
          tenantUserId: null,
          schoolId: null,
          actorEmail: null,
          recordId: credential.id,
          outcome: "denied",
          details: { reason: "user_handle_mismatch" },
        });
        throw new WebAuthnServiceError("auth_failed");
      }
      let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
      try {
        verification = await verify.verifyAuthenticationResponse({
          response: input.response,
          expectedChallenge: stored.challenge,
          expectedOrigin: origin,
          expectedRPID: config.rpID,
          credential: toWebAuthnCredential(credential),
          requireUserVerification: true,
        });
      } catch {
        throw new WebAuthnServiceError("auth_failed");
      }
      if (!verification.verified) throw new WebAuthnServiceError("auth_failed");
      const info = verification.authenticationInfo;
      if (info.origin !== origin || info.rpID !== config.rpID) {
        throw new WebAuthnServiceError("auth_failed");
      }
      const counter = decideSignatureCounter(credential.counter, info.newCounter);
      if (!counter.ok) {
        await auditSafe({
          action: "webauthn.authenticate.verify",
          userId: credential.userId,
          tenantUserId: null,
          schoolId: null,
          actorEmail: null,
          recordId: credential.id,
          outcome: "denied",
          details: { reason: "cloned_authenticator" },
        });
        throw new WebAuthnServiceError("auth_failed");
      }
      await deps.store.updateCredential(credential.id, credential.userId, {
        counter: counter.next,
        lastUsedAt: now.at,
        backedUp: info.credentialBackedUp,
        deviceType: info.credentialDeviceType,
      });
      const profile = await deps.directory.getUser(credential.userId);
      try {
        const session = await deps.sessions.mint(credential.userId);
        await auditSafe({
          action: "webauthn.authenticate.verify",
          userId: credential.userId,
          tenantUserId: profile?.tenantUserId ?? null,
          schoolId: profile?.schoolId ?? null,
          actorEmail: profile?.email ?? null,
          recordId: credential.id,
          outcome: "succeeded",
          details: { credential_id_prefix: credentialIdPrefix(credential.credentialId) },
        });
        return session;
      } catch (err) {
        const code =
          err instanceof Error && "code" in err && err.code === "email_required"
            ? "email_required"
            : err instanceof Error && "code" in err && err.code === "email_unconfirmed"
              ? "email_required"
              : "session_failed";
        await auditSafe({
          action: "webauthn.authenticate.verify",
          userId: credential.userId,
          tenantUserId: profile?.tenantUserId ?? null,
          schoolId: profile?.schoolId ?? null,
          actorEmail: profile?.email ?? null,
          recordId: credential.id,
          outcome: "failed",
          details: { reason: "session_mint_failed" },
        });
        throw new WebAuthnServiceError(code, 500);
      }
    },

    async list(input: { userId: string; origin?: string }): Promise<PasskeyListItem[]> {
      const rpId = input.origin ? (await ceremonyFor(input.origin)).config.rpID : undefined;
      const rows = await deps.store.listCredentials(input.userId, rpId);
      return rows
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(publicCredential);
    },

    async rename(input: {
      userId: string;
      credentialId: string;
      label: string;
    }): Promise<PasskeyListItem> {
      const label = sanitizePasskeyLabel(input.label);
      if (!label) throw new WebAuthnServiceError("rename_failed");
      const row = await deps.store.updateCredential(input.credentialId, input.userId, { label });
      if (!row) throw new WebAuthnServiceError("not_found");
      const profile = await deps.directory.getUser(input.userId);
      await auditSafe({
        action: "webauthn.credential.rename",
        userId: input.userId,
        tenantUserId: profile?.tenantUserId ?? null,
        schoolId: profile?.schoolId ?? null,
        actorEmail: profile?.email ?? null,
        recordId: row.id,
        outcome: "succeeded",
        details: { credential_id_prefix: credentialIdPrefix(row.credentialId) },
      });
      return publicCredential(row);
    },

    async remove(input: {
      userId: string;
      credentialId: string;
      rateKey: string;
    }): Promise<{ ok: true }> {
      await enforceRate("remove", input.rateKey);
      const owned = (await deps.store.listCredentials(input.userId)).find(
        (item) => item.id === input.credentialId,
      );
      if (!owned) throw new WebAuthnServiceError("not_found");
      const deleted = await deps.store.deleteCredential(input.credentialId, input.userId);
      if (!deleted) throw new WebAuthnServiceError("not_found");
      const profile = await deps.directory.getUser(input.userId);
      await auditSafe({
        action: "webauthn.credential.remove",
        userId: input.userId,
        tenantUserId: profile?.tenantUserId ?? null,
        schoolId: profile?.schoolId ?? null,
        actorEmail: profile?.email ?? null,
        recordId: input.credentialId,
        outcome: "succeeded",
        details: { credential_id_prefix: credentialIdPrefix(owned.credentialId) },
      });
      return { ok: true };
    },

    async onboardingState(input: {
      userId: string;
      origin?: string;
    }): Promise<PasskeyOnboardingState> {
      const profile = await deps.directory.getUser(input.userId);
      if (!profile) throw new WebAuthnServiceError("unauthorized", 401);
      const rpId = input.origin ? (await ceremonyFor(input.origin)).config.rpID : undefined;
      const credentialCount = await deps.store.countCredentials(input.userId, rpId);
      const prefs = await readPreferences(input.userId);
      let onboardingStatus: PasskeyOnboardingStatus = parseOnboardingStatus(
        prefs.row.onboardingStatus,
      );
      if (prefs.available && credentialCount > 0 && onboardingStatus === "pending") {
        await markEnrolled(input.userId, { passkeyFirst: prefs.row.passkeyFirst });
        onboardingStatus = "enrolled";
      }
      return {
        credentialCount,
        onboardingStatus,
        passkeyFirst: prefs.row.passkeyFirst,
        preferencesAvailable: prefs.available,
      };
    },

    async dismissOnboarding(input: {
      userId: string;
      origin?: string;
    }): Promise<PasskeyOnboardingState> {
      const profile = await deps.directory.getUser(input.userId);
      if (!profile) throw new WebAuthnServiceError("unauthorized", 401);
      const rpId = input.origin ? (await ceremonyFor(input.origin)).config.rpID : undefined;
      const credentialCount = await deps.store.countCredentials(input.userId, rpId);
      if (credentialCount > 0) {
        await markEnrolled(input.userId);
        return this.onboardingState(input);
      }
      try {
        const current = await deps.store.getPreferences(input.userId);
        await deps.store.upsertPreferences({
          userId: input.userId,
          onboardingStatus: "dismissed",
          passkeyFirst: current?.passkeyFirst ?? true,
        });
      } catch {
        throw new WebAuthnServiceError("preference_failed");
      }
      await auditSafe({
        action: "webauthn.onboarding.dismiss",
        userId: input.userId,
        tenantUserId: profile.tenantUserId,
        schoolId: profile.schoolId,
        actorEmail: profile.email,
        recordId: input.userId,
        outcome: "succeeded",
        details: { reason: "skipped" },
      });
      return this.onboardingState(input);
    },

    async setPasskeyFirst(input: {
      userId: string;
      passkeyFirst: boolean;
      origin?: string;
    }): Promise<PasskeyOnboardingState> {
      const profile = await deps.directory.getUser(input.userId);
      if (!profile) throw new WebAuthnServiceError("unauthorized", 401);
      try {
        const current = await deps.store.getPreferences(input.userId);
        const rpId = input.origin ? (await ceremonyFor(input.origin)).config.rpID : undefined;
        const credentialCount = await deps.store.countCredentials(input.userId, rpId);
        const onboardingStatus: PasskeyOnboardingStatus =
          current?.onboardingStatus === "dismissed"
            ? "dismissed"
            : credentialCount > 0
              ? "enrolled"
              : (current?.onboardingStatus ?? "pending");
        await deps.store.upsertPreferences({
          userId: input.userId,
          onboardingStatus,
          passkeyFirst: input.passkeyFirst,
        });
      } catch {
        throw new WebAuthnServiceError("preference_failed");
      }
      await auditSafe({
        action: "webauthn.preference.passkey_first",
        userId: input.userId,
        tenantUserId: profile.tenantUserId,
        schoolId: profile.schoolId,
        actorEmail: profile.email,
        recordId: input.userId,
        outcome: "succeeded",
        details: { passkey_first: input.passkeyFirst },
      });
      return this.onboardingState(input);
    },
  };
}

export type WebAuthnService = ReturnType<typeof createWebAuthnService>;

export function createSystemTimeAuthority(): TimeAuthority {
  return new TimeAuthority(new SystemClock());
}
