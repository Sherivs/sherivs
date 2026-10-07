import { describe, expect, it } from "vitest";

import {
  COREGRID_KEY_SCOPES,
  fingerprintOfHash,
  generateCoreGridApiKey,
  hashCoreGridApiKey,
  isWellFormedApiKey,
  keyTypeFromPrefix,
  parseCoreGridApiKey,
  validateCoreGridApiKeyRecord,
  verifyCoreGridApiKey,
  type CoreGridApiKeyRecord,
} from "../../frontend/src/lib/apikeys/apikey-contract";

const NOW = "2026-10-07T12:00:00.000Z";
const TENANT = "tenant-a";

/** Deterministic 32-byte entropy for reproducible tests. */
function pinnedRandom(seed: number) {
  return (length: number) => new Uint8Array(length).fill(seed);
}

function makeRecord(overrides: Partial<CoreGridApiKeyRecord> = {}): CoreGridApiKeyRecord {
  const generated = generateCoreGridApiKey("secret", pinnedRandom(3));
  return {
    apiKeyRef: `cgkey-${generated.fingerprint}`,
    tenantId: TENANT,
    type: "secret",
    keyHash: generated.keyHash,
    keyPreview: generated.keyPreview,
    fingerprint: generated.fingerprint,
    scopes: ["missions:read", "missions:write"],
    status: "active",
    createdBy: "operator",
    createdAt: "2026-10-01T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    note: null,
    ...overrides,
  };
}

describe("CoreGrid API-key contract (PLATFORM-019)", () => {
  it("generates well-formed keys with class prefixes and derived storage facts", () => {
    const publishable = generateCoreGridApiKey("publishable", pinnedRandom(1));
    const secret = generateCoreGridApiKey("secret", pinnedRandom(2));
    expect(publishable.key.startsWith("cg_publishable_")).toBe(true);
    expect(secret.key.startsWith("cg_secret_")).toBe(true);
    expect(isWellFormedApiKey(publishable.key)).toBe(true);
    expect(isWellFormedApiKey(secret.key)).toBe(true);
    expect(publishable.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(publishable.keyHash).toBe(hashCoreGridApiKey(publishable.key));
    expect(publishable.fingerprint).toBe(fingerprintOfHash(publishable.keyHash));
    expect(publishable.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(publishable.keyPreview).toBe(publishable.key.slice(0, "cg_publishable_".length + 4));
    // Determinism: the same entropy produces the same key.
    expect(generateCoreGridApiKey("publishable", pinnedRandom(1)).key).toBe(publishable.key);
  });

  it("parses keys by class and rejects wrong prefixes or malformed material", () => {
    const secret = generateCoreGridApiKey("secret", pinnedRandom(4));
    expect(parseCoreGridApiKey(secret.key)).toEqual({ type: "secret", material: secret.material });
    expect(keyTypeFromPrefix("cg_publishable_")).toBe("publishable");
    expect(keyTypeFromPrefix("cg_secret_")).toBe("secret");
    expect(keyTypeFromPrefix("sb_publishable_")).toBeNull();
    expect(isWellFormedApiKey("cg_publishable_short")).toBe(false);
    expect(isWellFormedApiKey("cg_publishable_!!!invalid-material-chars!!!")).toBe(false);
    expect(isWellFormedApiKey("totally-unrelated")).toBe(false);
  });

  it("verifies a well-formed secret key for its granted scopes", () => {
    const generated = generateCoreGridApiKey("secret", pinnedRandom(5));
    const record = makeRecord({ keyHash: generated.keyHash, fingerprint: generated.fingerprint, keyPreview: generated.keyPreview });
    const verdict = verifyCoreGridApiKey({
      presentedKey: generated.key,
      record,
      now: NOW,
      requestedScopes: ["missions:read"],
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.tenantId).toBe(TENANT);
      expect(verdict.scopes).toEqual(["missions:read"]);
    }
  });

  it("denies a malformed key before any lookup", () => {
    const verdict = verifyCoreGridApiKey({
      presentedKey: "cg_secret_malformed",
      record: makeRecord(),
      now: NOW,
      requestedScopes: ["missions:read"],
    });
    expect(verdict).toEqual({ ok: false, code: "malformed_key", reason: expect.stringMatching(/malformed/) });
  });

  it("denies an unknown key, a class mismatch, and a hash mismatch", () => {
    const generated = generateCoreGridApiKey("secret", pinnedRandom(6));
    const verdict = verifyCoreGridApiKey({ presentedKey: generated.key, record: null, now: NOW, requestedScopes: [] });
    expect(verdict).toMatchObject({ ok: false, code: "unknown_key" });

    const publishable = generateCoreGridApiKey("publishable", pinnedRandom(7));
    // Record is of type secret, presented key is publishable → class mismatch.
    expect(
      verifyCoreGridApiKey({ presentedKey: publishable.key, record: makeRecord(), now: NOW, requestedScopes: [] }),
    ).toMatchObject({ ok: false, code: "unknown_key" });

    // Same class but a different material than the stored hash.
    const other = generateCoreGridApiKey("secret", pinnedRandom(8));
    expect(
      verifyCoreGridApiKey({ presentedKey: other.key, record: makeRecord(), now: NOW, requestedScopes: [] }),
    ).toMatchObject({ ok: false, code: "unknown_key" });
  });

  it("denies a revoked key even when scopes would otherwise match (revocation always wins)", () => {
    const generated = generateCoreGridApiKey("secret", pinnedRandom(9));
    const record = makeRecord({
      keyHash: generated.keyHash,
      fingerprint: generated.fingerprint,
      keyPreview: generated.keyPreview,
      status: "revoked",
      revokedAt: "2026-10-05T00:00:00.000Z",
      revokedBy: "operator",
      revokeReason: "rotation",
    });
    const verdict = verifyCoreGridApiKey({
      presentedKey: generated.key,
      record,
      now: NOW,
      requestedScopes: ["missions:read"],
    });
    expect(verdict).toMatchObject({ ok: false, code: "revoked_key" });
  });

  it("denies an expired key but allows one inside its validity window", () => {
    const generated = generateCoreGridApiKey("secret", pinnedRandom(10));
    const base = {
      keyHash: generated.keyHash,
      fingerprint: generated.fingerprint,
      keyPreview: generated.keyPreview,
    };
    const expired = makeRecord({ ...base, expiresAt: "2026-10-07T00:00:00.000Z" });
    expect(
      verifyCoreGridApiKey({ presentedKey: generated.key, record: expired, now: NOW, requestedScopes: ["missions:read"] }),
    ).toMatchObject({ ok: false, code: "expired_key" });

    const valid = makeRecord({ ...base, expiresAt: "2026-10-08T00:00:00.000Z" });
    expect(
      verifyCoreGridApiKey({ presentedKey: generated.key, record: valid, now: NOW, requestedScopes: ["missions:read"] }).ok,
    ).toBe(true);
  });

  it("keeps a publishable key inside its inherent ceiling and denies ungranted/unknown scopes", () => {
    const generated = generateCoreGridApiKey("publishable", pinnedRandom(11));
    const record = makeRecord({
      type: "publishable",
      keyHash: generated.keyHash,
      fingerprint: generated.fingerprint,
      keyPreview: generated.keyPreview,
      scopes: ["org:identify"],
    });
    // A corrupted row claiming org:write on a publishable key must still deny (class ceiling).
    const corrupted = makeRecord({
      type: "publishable",
      keyHash: generated.keyHash,
      fingerprint: generated.fingerprint,
      keyPreview: generated.keyPreview,
      scopes: ["org:write" as CoreGridApiKeyRecord["scopes"][number]],
    });
    expect(
      verifyCoreGridApiKey({ presentedKey: generated.key, record: corrupted, now: NOW, requestedScopes: ["org:write"] }),
    ).toMatchObject({ ok: false, code: "scope_outside_class_ceiling" });
    // Granted ceiling scope works.
    expect(
      verifyCoreGridApiKey({ presentedKey: generated.key, record, now: NOW, requestedScopes: ["org:identify"] }).ok,
    ).toBe(true);
    // Not granted → deny.
    const secretKey = generateCoreGridApiKey("secret", pinnedRandom(12));
    const secretRecord = makeRecord({
      keyHash: secretKey.keyHash,
      fingerprint: secretKey.fingerprint,
      keyPreview: secretKey.keyPreview,
    });
    expect(
      verifyCoreGridApiKey({
        presentedKey: secretKey.key,
        record: secretRecord,
        now: NOW,
        requestedScopes: ["communications:send"],
      }),
    ).toMatchObject({ ok: false, code: "scope_not_granted" });
    // Unknown scope → deny.
    expect(
      verifyCoreGridApiKey({
        presentedKey: secretKey.key,
        record: secretRecord,
        now: NOW,
        requestedScopes: ["platform:root" as (typeof COREGRID_KEY_SCOPES)[number]],
      }),
    ).toMatchObject({ ok: false, code: "scope_not_granted" });
  });

  it("rejects stored records that break coherence (revocation provenance, fingerprint binding)", () => {
    const generated = generateCoreGridApiKey("secret", pinnedRandom(14));
    const base = {
      keyHash: generated.keyHash,
      fingerprint: generated.fingerprint,
      keyPreview: generated.keyPreview,
    };
    // Revoked without who/when → unusable record (fail closed).
    expect(
      validateCoreGridApiKeyRecord(makeRecord({ ...base, status: "revoked", revokedAt: null, revokedBy: null })),
    ).toBeNull();
    // Active with revocation provenance → incoherent.
    expect(
      validateCoreGridApiKeyRecord(
        makeRecord({ ...base, status: "active", revokedAt: "2026-10-05T00:00:00.000Z", revokedBy: "someone" }),
      ),
    ).toBeNull();
    // Fingerprint not derived from the hash → incoherent.
    expect(
      validateCoreGridApiKeyRecord(makeRecord({ ...base, fingerprint: "000000000000" })),
    ).toBeNull();
    // Well-formed revoked record with provenance validates.
    expect(
      validateCoreGridApiKeyRecord(
        makeRecord({ ...base, status: "revoked", revokedAt: "2026-10-05T00:00:00.000Z", revokedBy: "operator", revokeReason: "rotation" }),
      ),
    ).not.toBeNull();
  });
});