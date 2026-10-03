/**
 * H3-003 — Backup Manifest Engineer (Squad A, M-R-101 groundwork).
 *
 * Offline unit suite for the typed backup-manifest contract
 * (`frontend/src/lib/reliability/backup-manifest.ts`). All clocks are
 * injected constants; no network, no database, no secrets.
 */

import { describe, expect, it } from "vitest";

import {
  BACKUP_MANIFEST_SCHEMA_VERSION,
  backupManifestStatus,
  coversTenant,
  declaredRecordCount,
  isWellFormedChecksum,
  validateBackupManifest,
  type BackupManifest,
  type Checksum,
} from "../../frontend/src/lib/reliability/backup-manifest";

/* ── Fixed fixtures (no randomness, no clock reads) ─────────── */

const CAPTURED_AT_MS = 1_000_000_000_000;
const EXPIRES_AT_MS = CAPTURED_AT_MS + 86_400_000; // one day lifetime

const sha256 = (hex: string): Checksum => ({ algorithm: "sha256", digest: hex });
const VALID_SHA256 = "a".repeat(64);

function baseManifest(): BackupManifest {
  return {
    schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
    manifestId: "backup-0001",
    capturedAtMs: CAPTURED_AT_MS,
    expiresAtMs: EXPIRES_AT_MS,
    scope: { families: [{ kind: "records", recordCount: 12 }] },
    tenantCoverage: { tenants: ["tenant-a"], partial: false },
    entries: [
      {
        entryId: "entry-1",
        kind: "records",
        storageRef: "sets/0001/records.part1",
        byteSize: 1024,
        checksum: sha256(VALID_SHA256),
      },
    ],
    manifestChecksum: sha256("b".repeat(64)),
  };
}

describe("well-formed manifests", () => {
  it("accepts a structurally valid manifest (shape-only pass)", () => {
    const result = validateBackupManifest(baseManifest());
    expect(result.ok).toBe(true);
  });

  it("accepts a manifest observed inside its lifetime", () => {
    const result = validateBackupManifest(baseManifest(), { nowMs: CAPTURED_AT_MS + 1000 });
    expect(result.ok).toBe(true);
  });

  it("accepts a declared-empty family (count 0 is honest emptiness)", () => {
    const manifest = {
      ...baseManifest(),
      scope: {
        families: [
          { kind: "records", recordCount: 12 },
          { kind: "attachments", recordCount: 0 },
        ],
      },
    } satisfies BackupManifest;
    const result = validateBackupManifest(manifest);
    expect(result.ok).toBe(true);
  });
});

describe("lifetime discipline (instant + expiry)", () => {
  it("rejects a manifest whose expiry is at or before its instant", () => {
    const manifest = { ...baseManifest(), expiresAtMs: CAPTURED_AT_MS };
    const result = validateBackupManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "lifetime_inverted")).toBe(true);
    }
  });

  it("rejects an expired manifest against the injected clock (fail closed)", () => {
    const result = validateBackupManifest(baseManifest(), { nowMs: EXPIRES_AT_MS });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "expired")).toBe(true);
    }
  });

  it("rejects a manifest captured after the observation time (not yet valid)", () => {
    const result = validateBackupManifest(baseManifest(), { nowMs: CAPTURED_AT_MS - 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "not_yet_valid")).toBe(true);
    }
  });

  it("enforces an optional maximum retention window", () => {
    const result = validateBackupManifest(baseManifest(), { maxRetentionMs: 3_600_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "retention_window_exceeded")).toBe(true);
    }
  });

  it("reports expired status lazily through the status query", () => {
    const manifest = baseManifest();
    expect(backupManifestStatus(manifest, CAPTURED_AT_MS + 1)).toBe("current");
    expect(backupManifestStatus(manifest, EXPIRES_AT_MS)).toBe("expired");
    expect(backupManifestStatus(manifest, CAPTURED_AT_MS - 1)).toBe("not_yet_valid");
  });
});

describe("tenant coverage (multi-tenancy law)", () => {
  it("rejects a manifest that names zero tenants", () => {
    const manifest = { ...baseManifest(), tenantCoverage: { tenants: [], partial: false } };
    const result = validateBackupManifest(manifest);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicated tenant refs", () => {
    const manifest = {
      ...baseManifest(),
      tenantCoverage: { tenants: ["tenant-a", "tenant-a"], partial: false },
    };
    const result = validateBackupManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "duplicate_tenant")).toBe(true);
    }
  });

  it("answers coverage queries exactly", () => {
    const manifest = baseManifest();
    expect(coversTenant(manifest, "tenant-a")).toBe(true);
    expect(coversTenant(manifest, "tenant-b")).toBe(false);
  });
});

describe("checksums", () => {
  it("rejects a digest that is too short for the declared algorithm", () => {
    const manifest = {
      ...baseManifest(),
      entries: [
        {
          entryId: "entry-1",
          kind: "records",
          storageRef: "sets/0001/records.part1",
          byteSize: 1024,
          checksum: sha256("a".repeat(63)),
        },
      ],
    } satisfies BackupManifest;
    const result = validateBackupManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "checksum_digest_length")).toBe(true);
    }
  });

  it("rejects a non-hex digest", () => {
    const manifest = {
      ...baseManifest(),
      entries: [
        {
          entryId: "entry-1",
          kind: "records",
          storageRef: "sets/0001/records.part1",
          byteSize: 1024,
          checksum: sha256("z".repeat(64)),
        },
      ],
    } satisfies BackupManifest;
    const result = validateBackupManifest(manifest);
    expect(result.ok).toBe(false);
  });

  it("rejects uppercase digests (canonical lowercase hex only)", () => {
    const manifest = {
      ...baseManifest(),
      entries: [
        {
          entryId: "entry-1",
          kind: "records",
          storageRef: "sets/0001/records.part1",
          byteSize: 1024,
          checksum: sha256("A".repeat(64)),
        },
      ],
    } satisfies BackupManifest;
    expect(validateBackupManifest(manifest).ok).toBe(false);
  });

  it("rejects unknown checksum algorithms", () => {
    const raw = { ...baseManifest(), manifestChecksum: { algorithm: "md5", digest: "a".repeat(32) } };
    expect(validateBackupManifest(raw).ok).toBe(false);
  });

  it("checks digest length per algorithm via the format helper", () => {
    expect(isWellFormedChecksum(sha256(VALID_SHA256))).toBe(true);
    expect(isWellFormedChecksum({ algorithm: "sha512", digest: "c".repeat(128) })).toBe(true);
    expect(isWellFormedChecksum({ algorithm: "sha512", digest: "c".repeat(64) })).toBe(false);
  });
});

describe("scope and entries", () => {
  it("rejects a manifest with an empty scope", () => {
    const manifest = { ...baseManifest(), scope: { families: [] } };
    expect(validateBackupManifest(manifest).ok).toBe(false);
  });

  it("rejects duplicated scope families", () => {
    const manifest = {
      ...baseManifest(),
      scope: {
        families: [
          { kind: "records", recordCount: 1 },
          { kind: "records", recordCount: 2 },
        ],
      },
    } satisfies BackupManifest;
    const result = validateBackupManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "scope_family_duplicate")).toBe(true);
    }
  });

  it("rejects negative record counts", () => {
    const manifest = { ...baseManifest(), scope: { families: [{ kind: "records", recordCount: -1 }] } };
    expect(validateBackupManifest(manifest).ok).toBe(false);
  });

  it("rejects an empty entries list", () => {
    const manifest = { ...baseManifest(), entries: [] };
    expect(validateBackupManifest(manifest).ok).toBe(false);
  });

  it("rejects duplicated entry ids", () => {
    const manifest = {
      ...baseManifest(),
      entries: [
        baseManifest().entries[0],
        {
          entryId: "entry-1",
          kind: "audit",
          storageRef: "sets/0001/audit.part1",
          byteSize: 8,
          checksum: sha256("c".repeat(64)),
        },
      ],
    } satisfies BackupManifest;
    const result = validateBackupManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "duplicate_entry")).toBe(true);
    }
  });

  it("rejects zero or negative byte sizes", () => {
    const entry = { ...baseManifest().entries[0], byteSize: 0 };
    const manifest = { ...baseManifest(), entries: [entry] };
    expect(validateBackupManifest(manifest).ok).toBe(false);
  });

  it("rejects absolute storage refs and upward traversal", () => {
    const absolute = {
      ...baseManifest().entries[0],
      storageRef: "/etc/passwd",
    };
    const traversal = {
      ...baseManifest().entries[0],
      storageRef: "sets/../../escape",
    };
    expect(validateBackupManifest({ ...baseManifest(), entries: [absolute] }).ok).toBe(false);
    expect(validateBackupManifest({ ...baseManifest(), entries: [traversal] }).ok).toBe(false);
  });
});

describe("versioning and untrusted input", () => {
  it("rejects an unsupported schema version with the typed code", () => {
    const raw = { ...baseManifest(), schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION + 1 };
    const result = validateBackupManifest(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe("schema_version_unsupported");
    }
  });

  it("rejects non-object garbage without throwing", () => {
    for (const garbage of [null, undefined, 42, "manifest", []]) {
      const result = validateBackupManifest(garbage);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues[0].code).toBe("invalid_input");
      }
    }
  });

  it("accumulates multiple issues instead of failing on the first", () => {
    const raw = {
      ...baseManifest(),
      tenantCoverage: { tenants: ["tenant-a", "tenant-a"], partial: false },
      manifestChecksum: sha256("b".repeat(63)),
    };
    const result = validateBackupManifest(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("queries", () => {
  it("sums declared record counts across families", () => {
    const manifest = {
      ...baseManifest(),
      scope: {
        families: [
          { kind: "records", recordCount: 12 },
          { kind: "audit", recordCount: 30 },
        ],
      },
    } satisfies BackupManifest;
    expect(declaredRecordCount(manifest)).toBe(42);
  });
});
