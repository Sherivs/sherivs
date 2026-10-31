/**
 * In-memory WebAuthn store for unit tests. Mirrors the SQL consume semantics:
 * one unused, unexpired row is claimed exactly once.
 */
import type {
  WebAuthnChallengeRecord,
  WebAuthnCredentialInsert,
  WebAuthnCredentialPatch,
  WebAuthnCredentialRecord,
  WebAuthnCeremony,
  WebAuthnPreferenceRecord,
  WebAuthnStore,
} from "./webauthn-store";

function id(): string {
  return crypto.randomUUID();
}

export function createMemoryWebAuthnStore(): WebAuthnStore & {
  challenges: WebAuthnChallengeRecord[];
  credentials: WebAuthnCredentialRecord[];
  preferences: WebAuthnPreferenceRecord[];
} {
  const challenges: WebAuthnChallengeRecord[] = [];
  const credentials: WebAuthnCredentialRecord[] = [];
  const preferences: WebAuthnPreferenceRecord[] = [];

  return {
    challenges,
    credentials,
    preferences,
    async insertChallenge(row) {
      if (challenges.some((c) => c.challenge === row.challenge)) {
        throw new Error("duplicate challenge");
      }
      const record: WebAuthnChallengeRecord = { id: row.id ?? id(), ...row };
      challenges.push(record);
      return record;
    },
    async consumeChallenge(challenge, ceremony: WebAuthnCeremony, nowMs) {
      const idx = challenges.findIndex(
        (c) =>
          c.challenge === challenge &&
          c.ceremony === ceremony &&
          c.expiresAtMs > nowMs &&
          !("consumed" in c && (c as WebAuthnChallengeRecord & { consumed?: boolean }).consumed),
      );
      if (idx < 0) return null;
      const record = challenges[idx];
      (record as WebAuthnChallengeRecord & { consumed?: boolean }).consumed = true;
      challenges.splice(idx, 1);
      return record;
    },
    async listCredentials(userId, rpId) {
      return credentials.filter((c) => c.userId === userId && (!rpId || c.rpId === rpId));
    },
    async getCredentialByCredentialId(credentialId) {
      return credentials.find((c) => c.credentialId === credentialId) ?? null;
    },
    async insertCredential(row: WebAuthnCredentialInsert) {
      if (credentials.some((c) => c.credentialId === row.credentialId)) {
        throw new Error("duplicate credential");
      }
      const record: WebAuthnCredentialRecord = {
        ...row,
        rpId: row.rpId || "sherivs.com",
        id: row.id ?? id(),
        createdAt: row.createdAt ?? "1970-01-01T00:00:00.000Z",
        lastUsedAt: null,
      };
      credentials.push(record);
      return record;
    },
    async updateCredential(recordId, userId, patch: WebAuthnCredentialPatch) {
      const record = credentials.find((c) => c.id === recordId && c.userId === userId);
      if (!record) return null;
      if (patch.label !== undefined) record.label = patch.label;
      if (patch.counter !== undefined) record.counter = patch.counter;
      if (patch.lastUsedAt !== undefined) record.lastUsedAt = patch.lastUsedAt;
      if (patch.backedUp !== undefined) record.backedUp = patch.backedUp;
      if (patch.deviceType !== undefined) record.deviceType = patch.deviceType;
      return record;
    },
    async deleteCredential(recordId, userId) {
      const idx = credentials.findIndex((c) => c.id === recordId && c.userId === userId);
      if (idx < 0) return false;
      credentials.splice(idx, 1);
      return true;
    },
    async countCredentials(userId, rpId) {
      return credentials.filter((c) => c.userId === userId && (!rpId || c.rpId === rpId)).length;
    },
    async getPreferences(userId) {
      return preferences.find((row) => row.userId === userId) ?? null;
    },
    async upsertPreferences(row) {
      const idx = preferences.findIndex((item) => item.userId === row.userId);
      const next: WebAuthnPreferenceRecord = {
        userId: row.userId,
        onboardingStatus: row.onboardingStatus,
        passkeyFirst: row.passkeyFirst,
      };
      if (idx < 0) preferences.push(next);
      else preferences[idx] = next;
      return next;
    },
  };
}
