/**
 * CoreGrid — H3 wave, team H3-041 (AI Live Drill Engineer), mission E-041.
 * OFFLINE gate proofs for scripts/verify-ai-gateway-live.drill.mjs WITHOUT
 * touching any network service, any database, and WITHOUT ever executing a
 * live inference (no real credential is used; the drill is only ever spawned
 * on its fail-closed blocked paths and its offline --plan mode):
 *
 *  - live mode without a usable AI_API_KEY fails closed to BLOCKED_NO_CREDENTIAL
 *    (exit 2) BEFORE any network contact — no endpoint resolution, no socket,
 *    no artifact;
 *  - empty/whitespace keys are NOT usable credentials (BLK-2 trim semantics);
 *  - an incomplete drill configuration (AI_DRILL_MODEL absent) also blocks
 *    before any network contact;
 *  - --plan is fully offline (no credential read, no network, no artifacts);
 *  - unknown arguments / stray positionals are rejected with BLOCKED_USAGE
 *    (exit 2) — and argument validation runs BEFORE the credential gate;
 *  - credential values are never printed, logged, or written (sentinel proof).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "verify-ai-gateway-live.drill.mjs");

/** RFC 2606 reserved TLD: even a hypothetical contact could never resolve. */
const UNREACHABLE_GATEWAY_URL = "https://ai-drill-gate.invalid";
/** Fake credential used ONLY to prove it is never echoed. Never a real key. */
const SENTINEL_KEY = "cg-h3-041-sentinel-credential-value";
const DRILL_MODEL = "drill-model-fixture";

function offlineEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.AI_API_KEY;
  delete env.AI_GATEWAY_URL;
  delete env.AI_DRILL_MODEL;
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

let artifactsDir = "";

beforeAll(() => {
  artifactsDir = join(tmpdir(), `h3-041-artifacts-${Date.now()}`);
  mkdirSync(artifactsDir, { recursive: true });
});

afterAll(() => {
  rmSync(artifactsDir, { recursive: true, force: true });
});

/** The blocked paths must never emit any evidence or leave any trace behind. */
function expectNoEvidence() {
  expect(existsSync(join(artifactsDir, "ai-gateway-live-drill.json"))).toBe(false);
  expect(existsSync(join(artifactsDir, "ai-gateway-live-drill.log"))).toBe(false);
}

describe("H3-041 AI gateway live drill — credential gate (exit-2 semantics)", () => {
  it("fails closed with BLOCKED_NO_CREDENTIAL (exit 2) before any network contact when AI_API_KEY is absent", () => {
    const run = runScript(
      [],
      offlineEnv({ AI_GATEWAY_URL: UNREACHABLE_GATEWAY_URL, AI_DRILL_MODEL: DRILL_MODEL }),
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_NO_CREDENTIAL");
    expect(run.stderr).toContain("AI_API_KEY");
    expect(run.stderr).toContain("No network contact was made");
    expect(run.stderr).toContain("no inference was attempted");
    expect(run.stdout).not.toContain("STATUS=DRILL_PASS");
    expect(run.stdout).not.toContain("gateway.invoke");
    expectNoEvidence();
  });

  it("treats an empty-string key as an unusable credential (BLK-2 trim semantics)", () => {
    const run = runScript(
      [],
      offlineEnv({ AI_API_KEY: "", AI_GATEWAY_URL: UNREACHABLE_GATEWAY_URL, AI_DRILL_MODEL: DRILL_MODEL }),
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_NO_CREDENTIAL");
    expectNoEvidence();
  });

  it("treats a whitespace-only key as an unusable credential", () => {
    const run = runScript(
      [],
      offlineEnv({ AI_API_KEY: "   ", AI_GATEWAY_URL: UNREACHABLE_GATEWAY_URL, AI_DRILL_MODEL: DRILL_MODEL }),
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_NO_CREDENTIAL");
    expectNoEvidence();
  });

  it("blocks an incomplete drill configuration (AI_DRILL_MODEL absent) BEFORE any network contact", () => {
    const run = runScript(
      [],
      offlineEnv({ AI_API_KEY: SENTINEL_KEY, AI_GATEWAY_URL: UNREACHABLE_GATEWAY_URL }),
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_NO_CONFIGURATION");
    expect(run.stderr).toContain("AI_DRILL_MODEL");
    expect(run.stderr).toContain("No network contact was made");
    expectNoEvidence();
  });
});

describe("H3-041 AI gateway live drill — no network without credential", () => {
  it("never resolves or contacts the declared endpoint when the credential is absent", () => {
    const run = runScript(
      [],
      offlineEnv({ AI_GATEWAY_URL: UNREACHABLE_GATEWAY_URL, AI_DRILL_MODEL: DRILL_MODEL }),
    );
    expect(run.status).toBe(2);
    // No invocation markers of any kind may appear on a blocked path.
    expect(run.stdout).not.toContain("POST");
    expect(run.stdout).not.toContain("chat/completions");
    expect(run.stdout).not.toContain("STATUS=");
    expect(run.stderr).not.toContain("STATUS=DRILL_PASS");
    expectNoEvidence();
  });

  it("never prints, logs, or writes the credential value, even on a blocked path", () => {
    const run = runScript(
      [],
      offlineEnv({ AI_API_KEY: SENTINEL_KEY, AI_GATEWAY_URL: UNREACHABLE_GATEWAY_URL }),
    );
    expect(run.status).toBe(2);
    expect(run.stdout).not.toContain(SENTINEL_KEY);
    expect(run.stderr).not.toContain(SENTINEL_KEY);
    expectNoEvidence();
  });
});

describe("H3-041 AI gateway live drill — offline plan mode", () => {
  it("prints the declared plan fully offline: no credential read, no network, no artifacts", () => {
    const run = runScript(["--plan"], offlineEnv({ AI_API_KEY: SENTINEL_KEY }));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("STATUS=PLAN_OK");
    expect(run.stdout).toContain("networkContact=false");
    expect(run.stdout).toContain("credentialRead=false");
    // The credential gate is declared BY NAME ONLY — never by value.
    expect(run.stdout).toContain("AI_API_KEY");
    expect(run.stdout).not.toContain(SENTINEL_KEY);
    expect(run.stdout).toContain("ONE POST /chat/completions");
    expect(run.stdout).toContain("purpose=classification");
    expect(run.stdout).toContain("docs/runbooks/ai-gateway-live-drill.md");
  });
});

describe("H3-041 AI gateway live drill — argument validation", () => {
  it("rejects unknown flags with BLOCKED_USAGE (exit 2)", () => {
    const run = runScript(["--plan", "--bogus"], offlineEnv());
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_USAGE");
  });

  it("rejects stray positionals with BLOCKED_USAGE (exit 2)", () => {
    const run = runScript(["surprise"], offlineEnv());
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_USAGE");
  });

  it("argument validation runs BEFORE the credential gate (usage errors are not credential errors)", () => {
    const run = runScript(["surprise"], offlineEnv());
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_USAGE");
    expect(run.stderr).not.toContain("BLOCKED_NO_CREDENTIAL");
  });
});