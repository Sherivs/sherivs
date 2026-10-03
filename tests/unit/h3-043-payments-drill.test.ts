/**
 * CoreGrid — H3 wave, team H3-043 (Payment Rail Drill Engineer), mission
 * E-043 (BLK-4 payment-rail drill). OFFLINE gate tests for
 * scripts/verify-payments-live.drill.mjs — WITHOUT touching any database or
 * network service, and WITHOUT ever executing a live TEST-MODE round:
 *
 *  - `--help` and `--rehearse` are fully offline: the rehearsal reads no
 *    credential, contacts no network, and proves the gate's credential-class
 *    vectors and the contract/reference/idempotency vectors through the real
 *    governed modules (paystack-testmode.server.ts + payment-contract.ts);
 *  - the gated TEST-MODE round is strictly credential-gated: without a TEST
 *    credential it fails closed to BLOCKED_NO_CREDENTIAL (exit 2) BEFORE any
 *    network contact — nothing is probed, no artifact is written;
 *  - a LIVE key (sk_live_…) is REFUSED BY DESIGN — it blocks exactly like a
 *    missing key (exit 2), and every other credential class is refused too;
 *  - unknown arguments are rejected with BLOCKED_USAGE (exit 2);
 *  - credential values are never printed, logged, or written to artifacts.
 *
 * Per mission law: these are OFFLINE gate tests only. No test here ever runs
 * the gated round with credentials, and no test ever contacts the provider.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "verify-payments-live.drill.mjs");

/** A fixture-shaped credential string — clearly not a real secret, never a value we must protect. */
const TEST_KEY_FIXTURE = "sk_test_h3_043_fixture_not_a_real_credential";
const LIVE_KEY_FIXTURE = "sk_live_h3_043_fixture_not_a_real_key";
const OTHER_KEY_FIXTURE = "pk_live_h3_043_fixture_wrong_class";
const SECRET_SENTINEL = "cg-h3-043-sentinel-credential-value";

function offlineEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.PAYSTACK_SECRET_KEY;
  delete env.PAYSTACK_BASE_URL;
  delete env.COREGRID_ARTIFACTS_DIR;
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

interface DrillRecord {
  mission: string;
  mode: string;
  databaseContact: boolean;
  networkContact: boolean;
  credentialRequired: boolean;
  credentialRead?: boolean;
  vectorsValidated?: number;
  findings: number;
  summary: string;
}

let artifactsDir = "";

beforeAll(() => {
  artifactsDir = join(tmpdir(), `h3-043-artifacts-${Date.now()}`);
  mkdirSync(artifactsDir, { recursive: true });
});

afterAll(() => {
  rmSync(artifactsDir, { recursive: true, force: true });
});

describe("H3-043 payment rail drill — offline rehearsal (--rehearse)", () => {
  it("passes fully offline: no credential read, no network, no database", () => {
    const run = runScript(["--rehearse"], offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsDir }));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("STATUS=REHEARSAL_PASS");
    expect(run.stdout).toContain("no credentials read, no network, no database");

    const record = JSON.parse(
      readFileSync(join(artifactsDir, "payments-drill-rehearsal.json"), "utf8"),
    ) as DrillRecord;
    expect(record.mode).toBe("rehearse");
    expect(record.databaseContact).toBe(false);
    expect(record.networkContact).toBe(false);
    expect(record.credentialRequired).toBe(false);
    expect(record.credentialRead).toBe(false);
    expect(record.findings).toBe(0);
    expect(record.summary).toBe("REHEARSAL_PASS");
  });

  it("proves the gate's credential-class vectors through the governed module", () => {
    const logText = readFileSync(join(artifactsDir, "payments-drill-rehearsal.log"), "utf8");
    expect(logText).toContain("PASS vector:test-class class=test");
    expect(logText).toContain("PASS vector:live-class-refused class=live denyCode=non_test_key");
    expect(logText).toContain("PASS vector:other-class-refused class=other denyCode=non_test_key");
    expect(logText).not.toContain("FINDING vector:");
  });

  it("proves the canonical-reference and idempotency vectors offline", () => {
    const logText = readFileSync(join(artifactsDir, "payments-drill-rehearsal.log"), "utf8");
    expect(logText).toContain("PASS vector:reference-valid");
    expect(logText).toContain("PASS vector:reference-zero-amount-refused");
    expect(logText).toContain("PASS vector:reference-empty-tenant-refused");
    expect(logText).toContain("PASS vector:idempotency-key-deterministic");
    expect(logText).toContain("cg_-prefixed, deterministic for the same canonical reference");
  });

  it("never prints, logs, or writes a credential value (sentinel probe)", () => {
    const run = runScript(["--rehearse"], offlineEnv({
      COREGRID_ARTIFACTS_DIR: artifactsDir,
      PAYSTACK_SECRET_KEY: SECRET_SENTINEL,
    }));
    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain(SECRET_SENTINEL);
    expect(run.stderr).not.toContain(SECRET_SENTINEL);
    const recordText = readFileSync(join(artifactsDir, "payments-drill-rehearsal.json"), "utf8");
    const logText = readFileSync(join(artifactsDir, "payments-drill-rehearsal.log"), "utf8");
    expect(recordText).not.toContain(SECRET_SENTINEL);
    expect(logText).not.toContain(SECRET_SENTINEL);
  });
});

describe("H3-043 payment rail drill — credential gate (BLOCKED_NO_CREDENTIAL, exit 2)", () => {
  it("blocks without a TEST credential: exit 2 BEFORE any network contact, nothing probed, no artifacts", () => {
    const gateDir = join(tmpdir(), `h3-043-gate-missing-${Date.now()}`);
    try {
      const run = runScript([], offlineEnv({ COREGRID_ARTIFACTS_DIR: gateDir }));
      expect(run.status).toBe(2);
      expect(run.stderr).toContain("BLOCKED_NO_CREDENTIAL");
      expect(run.stderr).toContain("PAYSTACK_SECRET_KEY is not set");
      expect(run.stderr).toContain("Nothing was probed; no network contact was made.");
      expect(existsSync(join(gateDir, "payments-drill-test-round.json"))).toBe(false);
      expect(existsSync(join(gateDir, "payments-drill-test-round.log"))).toBe(false);
    } finally {
      rmSync(gateDir, { recursive: true, force: true });
    }
  });

  it("refuses a LIVE key by design: blocks like a missing one, exit 2, no contact", () => {
    const gateDir = join(tmpdir(), `h3-043-gate-live-${Date.now()}`);
    try {
      const run = runScript([], offlineEnv({
        COREGRID_ARTIFACTS_DIR: gateDir,
        PAYSTACK_SECRET_KEY: LIVE_KEY_FIXTURE,
      }));
      expect(run.status).toBe(2);
      expect(run.stderr).toContain("BLOCKED_NO_CREDENTIAL");
      expect(run.stderr).toContain("live-key refusal");
      expect(run.stderr).toContain("BLK-4");
      expect(run.stderr).toContain("Nothing was probed; no network contact was made.");
      expect(existsSync(join(gateDir, "payments-drill-test-round.json"))).toBe(false);
    } finally {
      rmSync(gateDir, { recursive: true, force: true });
    }
  });

  it("refuses every other credential class (fail closed, exit 2)", () => {
    const gateDir = join(tmpdir(), `h3-043-gate-other-${Date.now()}`);
    try {
      const run = runScript([], offlineEnv({
        COREGRID_ARTIFACTS_DIR: gateDir,
        PAYSTACK_SECRET_KEY: OTHER_KEY_FIXTURE,
      }));
      expect(run.status).toBe(2);
      expect(run.stderr).toContain("BLOCKED_NO_CREDENTIAL");
      expect(run.stderr).toContain("credential-class refusal");
      expect(existsSync(join(gateDir, "payments-drill-test-round.json"))).toBe(false);
    } finally {
      rmSync(gateDir, { recursive: true, force: true });
    }
  });

  it("never echoes the credential value in the block message (sentinel probe)", () => {
    const run = runScript([], offlineEnv({ PAYSTACK_SECRET_KEY: SECRET_SENTINEL }));
    expect(run.status).toBe(2);
    expect(run.stderr).not.toContain(SECRET_SENTINEL);
  });
});

describe("H3-043 payment rail drill — argument validation (BLOCKED_USAGE, exit 2)", () => {
  it("rejects unknown flags with BLOCKED_USAGE (exit 2)", () => {
    const run = runScript(["--rehearse", "--bogus"], offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsDir }));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_USAGE");
    expect(run.stderr).toContain("--bogus");
  });

  it("rejects stray positional arguments with BLOCKED_USAGE (exit 2)", () => {
    const run = runScript(["unexpected"], offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsDir }));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_USAGE");
  });

  it("documents the exit-code contract in --help (offline, exit 0)", () => {
    const run = runScript(["--help"], offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsDir }));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("TEST-MODE");
    expect(run.stdout).toContain("BLOCKED_NO_CREDENTIAL");
    expect(run.stdout).toContain("live key (sk_live_…)");
    expect(run.stdout).toContain("REFUSED BY");
    expect(run.stdout).toContain("0  PASS");
    expect(run.stdout).toContain("1  FAIL / FINDING");
    expect(run.stdout).toContain("2  BLOCKED_NO_CREDENTIAL");
  });
});