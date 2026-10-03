/**
 * CoreGrid — H3 wave, team H3-001 (Recovery Drill Runner Engineer), mission
 * A-001. Offline proofs for scripts/verify-recovery-drill.mjs WITHOUT touching
 * any database or network service:
 *
 *  - `--rehearse` is fully offline: it validates the declared drill plan
 *    invariants, the embedded recovery-target contracts (fail-closed RTO/RPO
 *    per record family), and the backup-manifest shapes (embedded Zod
 *    contract, exercised against known-good and known-bad vectors plus any
 *    manifests in the manifest store) — no SUPABASE_ACCESS_TOKEN, no network;
 *  - live mode is strictly credential-gated: without SUPABASE_ACCESS_TOKEN it
 *    fails closed to BLOCKED_NO_CREDENTIAL (exit 2) before doing anything;
 *  - credential values are never printed, logged, or written to artifacts;
 *  - manifest-store validation fails closed on invalid/expired manifests;
 *  - unknown arguments are rejected with BLOCKED_USAGE (exit 2).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "verify-recovery-drill.mjs");

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function offlineEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.SUPABASE_ACCESS_TOKEN;
  delete env.COREGRID_ARTIFACTS_DIR;
  delete env.COREGRID_RECOVERY_MANIFESTS_DIR;
  return { ...env, ...extra };
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(args: string[], env: NodeJS.ProcessEnv): RunResult {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

interface RehearsalRecord {
  mode: string;
  artifactsDir: string;
  manifestsDir: string;
  databaseContact: boolean;
  networkContact: boolean;
  credentialRequired: boolean;
  planSteps: number;
  manifestsValidated: number;
  findings: number;
}

/** A manifest-shaped fixture that satisfies the embedded backup-manifest contract. */
function validManifestFixture(): Record<string, unknown> {
  return {
    kind: "coregrid-recovery-backup-v1",
    manifestId: "test-backup-set-alpha",
    scope: {
      coverage: "tenant-full",
      recordFamilies: ["canonical-primitives"],
      tenantIds: ["tenant-a", "tenant-b"],
    },
    takenAt: "2026-10-03T00:00:00Z",
    expiresAt: "2026-10-04T00:00:00Z",
    checksums: {
      algorithm: "sha256",
      rowDigests: [
        { rowId: "row-1", digest: sha256("row-1") },
        { rowId: "row-2", digest: sha256("row-2") },
      ],
      manifestDigest: sha256("manifest"),
    },
    tenantCoverage: {
      tenants: [
        { tenantId: "tenant-a", rowCount: 1 },
        { tenantId: "tenant-b", rowCount: 1 },
      ],
    },
  };
}

let rehearsalArtifactsDir = "";
let manifestStoreDir = "";
let emptyStoreDir = "";

beforeAll(() => {
  rehearsalArtifactsDir = join(tmpdir(), `h3-001-artifacts-${Date.now()}`);
  manifestStoreDir = join(tmpdir(), `h3-001-manifests-${Date.now()}`);
  emptyStoreDir = join(tmpdir(), `h3-001-empty-store-${Date.now()}`);
  mkdirSync(rehearsalArtifactsDir, { recursive: true });
  mkdirSync(manifestStoreDir, { recursive: true });
  mkdirSync(emptyStoreDir, { recursive: true });
});

afterAll(() => {
  for (const dir of [rehearsalArtifactsDir, manifestStoreDir, emptyStoreDir]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("H3-001 recovery drill runner — offline rehearsal", () => {
  it("passes fully offline with zero network and zero credential", () => {
    const run = runScript(["--rehearse"], offlineEnv({ COREGRID_ARTIFACTS_DIR: rehearsalArtifactsDir }));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("STATUS=REHEARSAL_PASS");
    expect(run.stdout).toContain("databaseContact=false");

    const recordPath = join(rehearsalArtifactsDir, "recovery-drill-rehearsal.json");
    expect(existsSync(recordPath)).toBe(true);
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as RehearsalRecord;
    expect(record.mode).toBe("rehearse");
    expect(record.databaseContact).toBe(false);
    expect(record.networkContact).toBe(false);
    expect(record.credentialRequired).toBe(false);
    expect(record.findings).toBe(0);
  });

  it("declares the full drill plan with reversal and verification counterparts", () => {
    const logText = readFileSync(join(rehearsalArtifactsDir, "recovery-drill-rehearsal.log"), "utf8");
    expect(logText).toContain("step:prepare kind=prepare");
    expect(logText).toContain("step:backup kind=backup");
    expect(logText).toContain("step:destroy kind=destroy destructive=true restores=restore verifies=verify-identity");
    expect(logText).toContain("step:restore kind=restore");
    expect(logText).toContain("step:verify-identity kind=verify");
    expect(logText).toContain("step:verify-evidence kind=evidence-integrity");
    expect(logText).toContain("step:cleanup kind=cleanup");
    const record = JSON.parse(readFileSync(join(rehearsalArtifactsDir, "recovery-drill-rehearsal.json"), "utf8")) as RehearsalRecord;
    expect(record.planSteps).toBe(7);
  });

  it("fail-closed targets: every scoped record family carries a declared RTO/RPO contract", () => {
    const logText = readFileSync(join(rehearsalArtifactsDir, "recovery-drill-rehearsal.log"), "utf8");
    for (const family of ["canonical-primitives", "evidence-ledger", "runtime-configuration", "worker-substrate"]) {
      expect(logText).toMatch(new RegExp(`target:${family} rto=\\d+m rpo=\\d+m owner=`));
    }
    expect(logText).not.toContain("has NO declared recovery target");
    expect(logText).not.toContain("conflicting recovery targets");
  });

  it("exercises the embedded manifest shape vectors offline", () => {
    const logText = readFileSync(join(rehearsalArtifactsDir, "recovery-drill-rehearsal.log"), "utf8");
    expect(logText).toContain("manifests: exercising the embedded backup-manifest contract against shape vectors.");
    expect(logText).not.toContain("was ACCEPTED");
  });
});

describe("H3-001 recovery drill runner — manifest-store enforcement (offline)", () => {
  it("accepts a valid backup manifest and reports it validated", () => {
    writeFileSync(join(manifestStoreDir, "alpha.json"), JSON.stringify(validManifestFixture(), null, 2));
    const run = runScript(["--rehearse"], offlineEnv({
      COREGRID_ARTIFACTS_DIR: rehearsalArtifactsDir,
      COREGRID_RECOVERY_MANIFESTS_DIR: manifestStoreDir,
    }));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("PASS manifest:alpha.json");
    const record = JSON.parse(readFileSync(join(rehearsalArtifactsDir, "recovery-drill-rehearsal.json"), "utf8")) as RehearsalRecord;
    expect(record.manifestsValidated).toBe(1);
  });

  it("fails closed on a shape-invalid backup manifest (exit 1, FINDING)", () => {
    const invalid = validManifestFixture() as Record<string, unknown>;
    invalid.kind = "coregrid-recovery-backup-v2";
    writeFileSync(join(manifestStoreDir, "beta.json"), JSON.stringify(invalid, null, 2));
    const run = runScript(["--rehearse"], offlineEnv({
      COREGRID_ARTIFACTS_DIR: rehearsalArtifactsDir,
      COREGRID_RECOVERY_MANIFESTS_DIR: manifestStoreDir,
    }));
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("FINDING manifest:beta.json");
    expect(run.stderr).toContain("STATUS=REHEARSAL_FINDINGS");
  });

  it("fails closed on an expired backup set (expiresAt not after takenAt)", () => {
    const expired = validManifestFixture() as Record<string, unknown>;
    const scope = { ...(expired.scope as Record<string, unknown>) };
    expired.scope = scope;
    expired.takenAt = "2026-10-03T00:00:00Z";
    expired.expiresAt = "2026-10-02T00:00:00Z";
    writeFileSync(join(manifestStoreDir, "gamma.json"), JSON.stringify(expired, null, 2));
    const run = runScript(["--rehearse"], offlineEnv({
      COREGRID_ARTIFACTS_DIR: rehearsalArtifactsDir,
      COREGRID_RECOVERY_MANIFESTS_DIR: manifestStoreDir,
    }));
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("FINDING manifest:gamma.json");
    expect(run.stdout).toContain("expired/invalid backup set must fail closed");
  });

  it("fails closed on tenant-coverage mismatch", () => {
    const mismatched = validManifestFixture() as Record<string, unknown>;
    const scope = { ...(mismatched.scope as Record<string, unknown>) };
    scope.tenantIds = ["tenant-a", "tenant-b", "tenant-c"];
    mismatched.scope = scope;
    writeFileSync(join(manifestStoreDir, "delta.json"), JSON.stringify(mismatched, null, 2));
    const run = runScript(["--rehearse"], offlineEnv({
      COREGRID_ARTIFACTS_DIR: rehearsalArtifactsDir,
      COREGRID_RECOVERY_MANIFESTS_DIR: manifestStoreDir,
    }));
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("tenant coverage mismatch");
  });

  it("passes with an empty manifest store (vectors carry the shape coverage)", () => {
    const run = runScript(["--rehearse"], offlineEnv({
      COREGRID_ARTIFACTS_DIR: rehearsalArtifactsDir,
      COREGRID_RECOVERY_MANIFESTS_DIR: emptyStoreDir,
    }));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("STATUS=REHEARSAL_PASS");
  });
});

describe("H3-001 recovery drill runner — credential gate and secret hygiene", () => {
  it("live mode without SUPABASE_ACCESS_TOKEN fails closed: BLOCKED_NO_CREDENTIAL, exit 2, nothing probed", () => {
    const artifactsDir = join(tmpdir(), `h3-001-gate-${Date.now()}`);
    try {
      const run = runScript([], offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsDir }));
      expect(run.status).toBe(2);
      expect(run.stderr).toContain("BLOCKED_NO_CREDENTIAL");
      expect(run.stderr).toContain("Nothing was probed");
      expect(existsSync(join(artifactsDir, "recovery-drill-live.json"))).toBe(false);
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true });
    }
  });

  it("never prints, logs, or writes the credential value (rehearsal runs token-free)", () => {
    const sentinel = "cg-h3-001-sentinel-credential-value";
    const run = runScript(["--rehearse"], offlineEnv({
      COREGRID_ARTIFACTS_DIR: rehearsalArtifactsDir,
      SUPABASE_ACCESS_TOKEN: sentinel,
    }));
    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain(sentinel);
    expect(run.stderr).not.toContain(sentinel);
    const recordText = readFileSync(join(rehearsalArtifactsDir, "recovery-drill-rehearsal.json"), "utf8");
    const logText = readFileSync(join(rehearsalArtifactsDir, "recovery-drill-rehearsal.log"), "utf8");
    expect(recordText).not.toContain(sentinel);
    expect(logText).not.toContain(sentinel);
  });

  it("rejects unknown arguments with BLOCKED_USAGE (exit 2)", () => {
    const run = runScript(["--rehearse", "--bogus"], offlineEnv({ COREGRID_ARTIFACTS_DIR: rehearsalArtifactsDir }));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_USAGE");
  });
});