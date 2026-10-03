/**
 * CoreGrid — recovery chaos battery (Squad A / A-007, M-R-101 groundwork).
 *
 * Failure-path tests for recovery tooling consuming the backup-manifest
 * contract (`frontend/src/lib/reliability/backup-manifest.ts`, owned by
 * A-003 — imported read-only). Recovery tooling is the last line of
 * defense after an incident: whatever it restores from must be proven
 * trustworthy, and anything else must fail CLOSED. This battery drives
 * hostile manifests through a typed recovery gate and pins four failure
 * classes (mission A-007):
 *
 *   1. CORRUPT MANIFEST — wrong shape, missing fields, unsupported schema
 *      version, path-traversing storage refs, empty sets. None of these
 *      may ever reach a restore.
 *   2. MISSING / BROKEN CHECKSUM — absent checksums, non-hex digests,
 *      wrong digest lengths per algorithm. Integrity claims that cannot
 *      be structurally verified are treated as absent (fail closed).
 *   3. EXPIRED BACKUP SET — expired, not-yet-valid, boundary-tight, and
 *      over-retention manifests are refused; the clock is always
 *      caller-injected (the shape-only validation trap is pinned).
 *   4. PARTIAL SCOPE — partial tenant coverage parses (explicit is
 *      honest) but can NEVER drive a full-tenant restore; unnamed,
 *      duplicated, or missing tenants abort the gate.
 *
 * The gate under chaos is the test-local harness below: it is the minimal
 * recovery-tooling posture (validate → lifetime check → coverage check →
 * restore-or-abort) built ONLY on the contract's exported schema and pure
 * queries. It never throws on hostile input — every failure is a typed
 * abort verdict with stated reasons (AGENTS §29: never silent).
 *
 * Pure and offline: no I/O, no network, no database, no secrets, no
 * wall clock (all time is injected constants).
 */
import { describe, expect, it } from "vitest";
import {
  BACKUP_MANIFEST_SCHEMA_VERSION,
  BackupManifestSchema,
  type BackupManifest,
  type BackupManifestIssue,
  type BackupManifestIssueCode,
  type Checksum,
  type ChecksumAlgorithm,
  backupManifestStatus,
  coversTenant,
  declaredRecordCount,
  isWellFormedChecksum,
  validateBackupManifest,
} from "../../frontend/src/lib/reliability/backup-manifest";

/* ─────────────────────────────────────────────────────────────
 * Deterministic fixture clock + digests
 * ────────────────────────────────────────────────────────────*/

const CAPTURED_AT_MS = 1_000_000;
const LIFETIME_MS = 60_000;
const EXPIRES_AT_MS = CAPTURED_AT_MS + LIFETIME_MS;
const INSIDE_WINDOW_MS = CAPTURED_AT_MS + 1;
const AFTER_EXPIRY_MS = EXPIRES_AT_MS + 1;

/** Lowercase-hex digests of the exact length each algorithm requires. */
const SHA256_HEX = "ab".repeat(32); // 64 chars
const SHA512_HEX = "cd".repeat(64); // 128 chars

function digestHexFor(algorithm: ChecksumAlgorithm): string {
  return algorithm === "sha256" ? SHA256_HEX : SHA512_HEX;
}

function rawChecksum(algorithm: ChecksumAlgorithm = "sha256"): Record<string, unknown> {
  return { algorithm, digest: digestHexFor(algorithm) };
}

function rawEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entryId: "entry-0001",
    kind: "records",
    storageRef: "sets/drill/entry-0001.json",
    byteSize: 2048,
    checksum: rawChecksum(),
    ...overrides,
  };
}

/** A fully valid raw manifest (untrusted input, as storage would hand it over). */
function rawManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
    manifestId: "manifest-drill-0001",
    capturedAtMs: CAPTURED_AT_MS,
    expiresAtMs: EXPIRES_AT_MS,
    scope: { families: [{ kind: "records", recordCount: 10 }] },
    tenantCoverage: { tenants: ["tenant-a", "tenant-b"], partial: false },
    entries: [rawEntry()],
    manifestChecksum: rawChecksum(),
    ...overrides,
  };
}

function corruptKey(
  raw: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const clone = structuredClone(raw);
  clone[key] = value;
  return clone;
}

function dropKey(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const clone = structuredClone(raw);
  delete clone[key];
  return clone;
}

/* ─────────────────────────────────────────────────────────────
 * The recovery gate (minimal recovery-tooling posture under chaos)
 * ────────────────────────────────────────────────────────────*/

type RecoveryVerdict =
  | { readonly action: "restore"; readonly manifest: BackupManifest }
  | { readonly action: "abort"; readonly source: "contract"; readonly issues: readonly BackupManifestIssue[] }
  | { readonly action: "abort"; readonly source: "gate"; readonly reason: string };

interface RecoveryGateOptions {
  /** Caller-injected observation time. Omitting it is itself hostile. */
  readonly nowMs?: number;
  readonly maxRetentionMs?: number;
  /** Tenants the operator asked to restore; every one must be covered. */
  readonly requiredTenants?: readonly string[];
}

function recoveryGate(raw: unknown, options: RecoveryGateOptions = {}): RecoveryVerdict {
  if (options.nowMs === undefined) {
    return {
      action: "abort",
      source: "gate",
      reason: "clock-not-injected: recovery tooling never judges freshness without an injected clock",
    };
  }
  const result = validateBackupManifest(raw, {
    nowMs: options.nowMs,
    maxRetentionMs: options.maxRetentionMs,
  });
  if (!result.ok) {
    return { action: "abort", source: "contract", issues: result.issues };
  }
  const manifest = result.manifest;
  if (manifest.tenantCoverage.partial) {
    return {
      action: "abort",
      source: "gate",
      reason: `manifest ${manifest.manifestId} declares PARTIAL tenant coverage; it may never drive a full-tenant restore`,
    };
  }
  for (const tenant of options.requiredTenants ?? []) {
    if (!coversTenant(manifest, tenant)) {
      return {
        action: "abort",
        source: "gate",
        reason: `required tenant ${tenant} is not covered by manifest ${manifest.manifestId}`,
      };
    }
  }
  return { action: "restore", manifest };
}

function contractAbortCodes(verdict: RecoveryVerdict): BackupManifestIssueCode[] {
  if (verdict.action !== "abort" || verdict.source !== "contract") return [];
  return verdict.issues.map((issue) => issue.code);
}

function expectContractAbort(raw: unknown, nowMs: number = INSIDE_WINDOW_MS): BackupManifestIssueCode[] {
  const verdict = recoveryGate(raw, { nowMs });
  if (verdict.action !== "abort" || verdict.source !== "contract") {
    throw new Error(`expected a contract abort, got: ${JSON.stringify(verdict)}`);
  }
  expect(verdict.issues.length).toBeGreaterThan(0);
  return contractAbortCodes(verdict);
}

/* ─────────────────────────────────────────────────────────────
 * 0. Control — the valid fixture restores (mutations below are
 *    therefore the CAUSE of every abort, not pre-existing damage).
 * ────────────────────────────────────────────────────────────*/

describe("recovery chaos — control (valid manifest restores)", () => {
  it("a fully valid manifest parses, validates, and restores at an in-window clock", () => {
    const raw = rawManifest();
    expect(BackupManifestSchema.safeParse(raw).success).toBe(true);
    const verdict = recoveryGate(raw, {
      nowMs: INSIDE_WINDOW_MS,
      requiredTenants: ["tenant-a", "tenant-b"],
    });
    expect(verdict.action).toBe("restore");
    if (verdict.action === "restore") {
      expect(backupManifestStatus(verdict.manifest, INSIDE_WINDOW_MS)).toBe("current");
      expect(declaredRecordCount(verdict.manifest)).toBe(10);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 1. Corrupt manifest
 * ────────────────────────────────────────────────────────────*/

describe("recovery chaos — corrupt manifest fails closed", () => {
  it("non-object manifests (null, primitives, arrays) abort with invalid_input", () => {
    for (const hostile of [null, undefined, 42, "manifest", true, []]) {
      expect(contractAbortCodes(recoveryGate(hostile, { nowMs: INSIDE_WINDOW_MS }))).toEqual([
        "invalid_input",
      ]);
    }
  });

  it("every required field is load-bearing: dropping any one aborts", () => {
    const required = [
      "manifestId",
      "capturedAtMs",
      "expiresAtMs",
      "scope",
      "tenantCoverage",
      "entries",
      "manifestChecksum",
    ];
    for (const key of required) {
      const codes = expectContractAbort(dropKey(rawManifest(), key));
      expect(codes, `dropping ${key} must abort`).toEqual(["invalid_input"]);
    }
  });

  it("a missing or unsupported schemaVersion is named, not lumped into invalid_input", () => {
    expect(expectContractAbort(dropKey(rawManifest(), "schemaVersion"))).toEqual([
      "schema_version_unsupported",
    ]);
  });

  it("an unsupported schemaVersion aborts with schema_version_unsupported", () => {
    for (const wrong of [0, 2, 99, "1"]) {
      const codes = expectContractAbort(corruptKey(rawManifest(), "schemaVersion", wrong));
      expect(codes).toEqual(["schema_version_unsupported"]);
    }
  });

  it("a storageRef that is absolute or traverses upward can never smuggle a restore out of the backup set", () => {
    for (const hostileRef of [
      "/etc/coregrid/escape.json",
      "../outside-the-set.json",
      "sets/drill/../../outside.json",
      "a/b/../../../../c.json",
    ]) {
      const codes = expectContractAbort(
        corruptKey(rawManifest(), "entries", [rawEntry({ storageRef: hostileRef })]),
      );
      expect(codes, `storageRef ${hostileRef} must abort`).toEqual(["invalid_input"]);
    }
  });

  it("an empty backup set (zero entries) is not a backup set", () => {
    expect(expectContractAbort(corruptKey(rawManifest(), "entries", []))).toEqual(["invalid_input"]);
  });

  it("a scope declaring zero families does not parse", () => {
    expect(
      expectContractAbort(corruptKey(rawManifest(), "scope", { families: [] })),
    ).toEqual(["invalid_input"]);
  });

  it("hostile entry payloads (bad byteSize, empty ids, unknown kinds) abort", () => {
    const hostileEntries: Record<string, unknown>[] = [
      rawEntry({ byteSize: 0 }),
      rawEntry({ byteSize: -1 }),
      rawEntry({ byteSize: 1.5 }),
      rawEntry({ entryId: "" }),
      rawEntry({ kind: "secret-personal-dump" }),
      rawEntry({ storageRef: "" }),
    ];
    for (const entry of hostileEntries) {
      expect(
        expectContractAbort(corruptKey(rawManifest(), "entries", [entry])),
        `hostile entry ${JSON.stringify(entry)} must abort`,
      ).toEqual(["invalid_input"]);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Missing / broken checksum
 * ────────────────────────────────────────────────────────────*/

describe("recovery chaos — missing or broken checksums fail closed", () => {
  it("an entry with NO checksum at all is unrestoreable", () => {
    const { checksum, ...naked } = rawEntry();
    expect(checksum).toBeDefined();
    expect(expectContractAbort(corruptKey(rawManifest(), "entries", [naked]))).toEqual([
      "invalid_input",
    ]);
  });

  it("a manifest-level checksum that is absent aborts", () => {
    expect(expectContractAbort(dropKey(rawManifest(), "manifestChecksum"))).toEqual([
      "invalid_input",
    ]);
  });

  it("non-hex or uppercase digests are rejected (format gate)", () => {
    for (const digest of ["g".repeat(64), "zz", "", " ".repeat(64), "AB".repeat(32)]) {
      expect(
        expectContractAbort(
          corruptKey(rawManifest(), "entries", [rawEntry({ checksum: { algorithm: "sha256", digest } })]),
        ),
        `digest ${JSON.stringify(digest)} must abort`,
      ).toEqual(["invalid_input"]);
    }
  });

  it("a digest of the WRONG LENGTH for its algorithm is a typed checksum_digest_length issue", () => {
    const shortSha256 = { algorithm: "sha256", digest: SHA256_HEX.slice(0, 63) };
    const longSha256 = { algorithm: "sha256", digest: `${SHA256_HEX}a` };
    const shortSha512 = { algorithm: "sha512", digest: SHA512_HEX.slice(0, 127) };
    for (const checksum of [shortSha256, longSha256, shortSha512]) {
      const codes = expectContractAbort(
        corruptKey(rawManifest(), "entries", [rawEntry({ checksum })]),
      );
      expect(codes).toContain("checksum_digest_length");
    }
  });

  it("an algorithm/digest-length mismatch on the manifest checksum is caught, not absorbed", () => {
    const codes = expectContractAbort(
      corruptKey(rawManifest(), "manifestChecksum", { algorithm: "sha512", digest: SHA256_HEX }),
    );
    expect(codes).toContain("checksum_digest_length");
  });

  it("an unknown checksum algorithm does not parse", () => {
    expect(
      expectContractAbort(
        corruptKey(rawManifest(), "entries", [
          rawEntry({ checksum: { algorithm: "crc32-favorite", digest: "beef" } }),
        ]),
      ),
    ).toEqual(["invalid_input"]);
  });

  it("isWellFormedChecksum mirrors the gate for every broken checksum shape", () => {
    const wellFormed: Checksum = { algorithm: "sha256", digest: SHA256_HEX };
    expect(isWellFormedChecksum(wellFormed)).toBe(true);
    const broken: readonly Record<string, unknown>[] = [
      { algorithm: "sha256", digest: SHA256_HEX.slice(1) },
      { algorithm: "sha512", digest: SHA512_HEX.slice(0, 64) },
      { algorithm: "md5", digest: SHA256_HEX },
      { digest: SHA256_HEX },
    ];
    for (const candidate of broken) {
      expect(isWellFormedChecksum(candidate as Checksum), JSON.stringify(candidate)).toBe(false);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Expired backup set (clock-injected lifetime discipline)
 * ────────────────────────────────────────────────────────────*/

describe("recovery chaos — expired backup sets fail closed", () => {
  it("a manifest past its expiry aborts with the typed expired issue", () => {
    const verdict = recoveryGate(rawManifest(), { nowMs: AFTER_EXPIRY_MS });
    expect(verdict.action).toBe("abort");
    expect(contractAbortCodes(verdict)).toEqual(["expired"]);
  });

  it("expiry is strict at the boundary: expiresAtMs === now is already expired", () => {
    const verdict = recoveryGate(rawManifest(), { nowMs: EXPIRES_AT_MS });
    expect(contractAbortCodes(verdict)).toEqual(["expired"]);
    expect(backupManifestStatus(BackupManifestSchema.parse(rawManifest()), EXPIRES_AT_MS)).toBe(
      "expired",
    );
  });

  it("one millisecond before expiry the set is still restorable (no premature refusal)", () => {
    const verdict = recoveryGate(rawManifest(), { nowMs: EXPIRES_AT_MS - 1 });
    expect(verdict.action).toBe("restore");
  });

  it("a manifest captured in the future is not_yet_valid, never trusted", () => {
    const fromTheFuture = rawManifest({ capturedAtMs: AFTER_EXPIRY_MS, expiresAtMs: AFTER_EXPIRY_MS + LIFETIME_MS });
    const verdict = recoveryGate(fromTheFuture, { nowMs: INSIDE_WINDOW_MS });
    expect(contractAbortCodes(verdict)).toEqual(["not_yet_valid"]);
    expect(backupManifestStatus(BackupManifestSchema.parse(fromTheFuture), INSIDE_WINDOW_MS)).toBe(
      "not_yet_valid",
    );
  });

  it("a lifetime beyond the declared retention window aborts with retention_window_exceeded", () => {
    const verdict = recoveryGate(rawManifest(), {
      nowMs: INSIDE_WINDOW_MS,
      maxRetentionMs: LIFETIME_MS - 1,
    });
    expect(contractAbortCodes(verdict)).toEqual(["retention_window_exceeded"]);
  });

  it("an inverted lifetime (expiry not strictly after capture) aborts with lifetime_inverted", () => {
    // Equal timestamps: zero lifetime is not a lifetime. The contract's
    // fail-closed validator names it; recovery tooling must read THAT path.
    const zeroLifetime = validateBackupManifest(
      corruptKey(rawManifest(), "expiresAtMs", CAPTURED_AT_MS),
      { nowMs: INSIDE_WINDOW_MS },
    );
    expect(zeroLifetime.ok).toBe(false);
    if (!zeroLifetime.ok) {
      const codes = zeroLifetime.issues.map((issue) => issue.code);
      // A zero lifetime observed one tick later is ALSO expired — both
      // fail-closed verdicts are correct and both must be stated.
      expect(codes).toContain("lifetime_inverted");
      expect(codes).toContain("expired");
    }
    expect(
      expectContractAbort(
        corruptKey(rawManifest(), "expiresAtMs", CAPTURED_AT_MS - 1),
        AFTER_EXPIRY_MS,
      ),
    ).toContain("lifetime_inverted");
  });

  it("THE TRAP: shape-only validation (no clock) reports an expired manifest as ok — the gate must never call it that way", () => {
    const shapeOnly = validateBackupManifest(rawManifest());
    expect(shapeOnly.ok).toBe(true);
    const clockless = recoveryGate(rawManifest(), {});
    expect(clockless.action).toBe("abort");
    if (clockless.action === "abort" && clockless.source === "gate") {
      expect(clockless.reason).toContain("clock-not-injected");
    } else {
      throw new Error("a clockless gate call must abort");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Partial scope / tenant coverage
 * ────────────────────────────────────────────────────────────*/

describe("recovery chaos — partial scope and tenant coverage", () => {
  it("a PARTIAL manifest parses (explicit is honest) but can never drive a full-tenant restore", () => {
    const raw = rawManifest({
      tenantCoverage: { tenants: ["tenant-a"], partial: true },
    });
    expect(BackupManifestSchema.safeParse(raw).success).toBe(true);
    const verdict = recoveryGate(raw, { nowMs: INSIDE_WINDOW_MS, requiredTenants: ["tenant-a"] });
    expect(verdict.action).toBe("abort");
    if (verdict.action === "abort" && verdict.source === "gate") {
      expect(verdict.reason).toContain("PARTIAL");
    } else {
      throw new Error("a partial-coverage manifest must never restore");
    }
  });

  it("coverage naming ZERO tenants does not parse (multi-tenancy law: tenant context is mandatory)", () => {
    expect(
      expectContractAbort(
        corruptKey(rawManifest(), "tenantCoverage", { tenants: [], partial: false }),
      ),
    ).toEqual(["invalid_input"]);
  });

  it("duplicate tenant refs in coverage are a typed duplicate_tenant issue", () => {
    const codes = expectContractAbort(
      corruptKey(rawManifest(), "tenantCoverage", {
        tenants: ["tenant-a", "tenant-a"],
        partial: false,
      }),
    );
    expect(codes).toEqual(["duplicate_tenant"]);
  });

  it("a required tenant missing from coverage aborts the gate (restore exactly whom the operator asked for)", () => {
    const verdict = recoveryGate(rawManifest(), {
      nowMs: INSIDE_WINDOW_MS,
      requiredTenants: ["tenant-a", "tenant-c-not-covered"],
    });
    expect(verdict.action).toBe("abort");
    if (verdict.action === "abort" && verdict.source === "gate") {
      expect(verdict.reason).toContain("tenant-c-not-covered");
    } else {
      throw new Error("a restore request for an uncovered tenant must abort");
    }
  });

  it("a scope family declared twice is a typed scope_family_duplicate issue", () => {
    const codes = expectContractAbort(
      corruptKey(rawManifest(), "scope", {
        families: [
          { kind: "records", recordCount: 10 },
          { kind: "records", recordCount: 5 },
        ],
      }),
    );
    expect(codes).toEqual(["scope_family_duplicate"]);
  });

  it("a duplicated entryId is a typed duplicate_entry issue (each artifact named exactly once)", () => {
    const codes = expectContractAbort(
      corruptKey(rawManifest(), "entries", [rawEntry(), rawEntry({ byteSize: 4096 })]),
    );
    expect(codes).toEqual(["duplicate_entry"]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Chaos hygiene — issues aggregate, hostility never throws
 * ────────────────────────────────────────────────────────────*/

describe("recovery chaos — fail-closed hygiene", () => {
  it("ALL structural issues are reported, never truncated to the first", () => {
    const codes = expectContractAbort(
      corruptKey(
        corruptKey(
          corruptKey(rawManifest(), "entries", [rawEntry(), rawEntry()]),
          "tenantCoverage",
          { tenants: ["tenant-a", "tenant-a"], partial: false },
        ),
        "manifestChecksum",
        { algorithm: "sha256", digest: SHA256_HEX.slice(0, 10) },
      ),
    );
    expect(new Set(codes)).toEqual(
      new Set<BackupManifestIssueCode>(["duplicate_entry", "duplicate_tenant", "checksum_digest_length"]),
    );
  });

  it("the gate never throws on hostile input — every scenario resolves to a typed verdict", () => {
    const hostile: readonly unknown[] = [
      null,
      undefined,
      Symbol("hostile"),
      () => "hostile",
      { entries: [{ checksum: { algorithm: "sha256", digest: null } }] },
      corruptKey(rawManifest(), "capturedAtMs", Number.NaN),
      corruptKey(rawManifest(), "capturedAtMs", -1),
      corruptKey(rawManifest(), "expiresAtMs", Number.POSITIVE_INFINITY),
      corruptKey(rawManifest(), "scope", null),
      corruptKey(rawManifest(), "tenantCoverage", "tenant-a"),
    ];
    for (const raw of hostile) {
      let verdict: RecoveryVerdict;
      try {
        verdict = recoveryGate(raw, { nowMs: INSIDE_WINDOW_MS });
      } catch (error) {
        throw new Error(`the gate threw on hostile input ${String(raw)}: ${String(error)}`);
      }
      expect(verdict.action).toBe("abort");
    }
  });
});
