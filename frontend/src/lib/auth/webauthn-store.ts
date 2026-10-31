/**
 * WebAuthn persistence contracts. Implementations live in .server.ts so the
 * service-role client never reaches the browser bundle.
 */
import type { PasskeyOnboardingStatus } from "./webauthn-policy";

export type { PasskeyOnboardingStatus };

export type WebAuthnCeremony = "registration" | "authentication";

export type WebAuthnChallengeRecord = {
  id: string;
  challenge: string;
  ceremony: WebAuthnCeremony;
  userId: string | null;
  rpId: string;
  origin: string;
  expiresAtMs: number;
};

export type WebAuthnCredentialRecord = {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports: string[];
  aaguid: string | null;
  label: string;
  rpId: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type WebAuthnCredentialInsert = Omit<
  WebAuthnCredentialRecord,
  "id" | "createdAt" | "lastUsedAt"
> & {
  id?: string;
  createdAt?: string;
};

export type WebAuthnCredentialPatch = {
  label?: string;
  counter?: number;
  lastUsedAt?: string;
  backedUp?: boolean;
  deviceType?: WebAuthnCredentialRecord["deviceType"];
};

export type WebAuthnPreferenceRecord = {
  userId: string;
  onboardingStatus: PasskeyOnboardingStatus;
  passkeyFirst: boolean;
};

export interface WebAuthnStore {
  insertChallenge(
    row: Omit<WebAuthnChallengeRecord, "id"> & { id?: string },
  ): Promise<WebAuthnChallengeRecord>;
  consumeChallenge(
    challenge: string,
    ceremony: WebAuthnCeremony,
    nowMs: number,
  ): Promise<WebAuthnChallengeRecord | null>;
  listCredentials(userId: string, rpId?: string): Promise<WebAuthnCredentialRecord[]>;
  getCredentialByCredentialId(credentialId: string): Promise<WebAuthnCredentialRecord | null>;
  insertCredential(row: WebAuthnCredentialInsert): Promise<WebAuthnCredentialRecord>;
  updateCredential(
    id: string,
    userId: string,
    patch: WebAuthnCredentialPatch,
  ): Promise<WebAuthnCredentialRecord | null>;
  deleteCredential(id: string, userId: string): Promise<boolean>;
  countCredentials(userId: string, rpId?: string): Promise<number>;
  getPreferences(userId: string): Promise<WebAuthnPreferenceRecord | null>;
  upsertPreferences(row: WebAuthnPreferenceRecord): Promise<WebAuthnPreferenceRecord>;
}

export type WebAuthnUserProfile = {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
  displayName: string | null;
  tenantUserId: string | null;
  schoolId: string | null;
};

export interface WebAuthnDirectory {
  getUser(userId: string): Promise<WebAuthnUserProfile | null>;
}

export type MintedSupabaseSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId: string;
};

export type PasskeyListItem = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: WebAuthnCredentialRecord["deviceType"];
  backedUp: boolean;
  transports: string[];
};

export interface WebAuthnSessionMinter {
  mint(userId: string): Promise<MintedSupabaseSession>;
}
