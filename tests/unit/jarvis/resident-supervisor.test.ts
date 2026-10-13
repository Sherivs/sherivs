/**
 * CoreGrid — RUNTIME: Jarvis + Hermes resident supervisors (ACTIVE-V1).
 *
 * Residents are SEPARATE process supervisors that repeatedly invoke the
 * existing library (WAKE → one cycle → SLEEP). They are not god-agents
 * and they do not live inside the library runtime.
 *
 * Proof:
 *   1. supervisor scripts contain `while (true)` (or equivalent loop);
 *   2. library runtime still has no while(true)/setInterval/new Worker;
 *   3. `--rehearse` is one offline tick and exits 0 (spawned, no network);
 *   4. Jarvis live path without COREGRID_CYCLE_TENANT_ID exits 2
 *      BLOCKED_NO_CREDENTIAL (spawned, not --rehearse, no loop);
 *   5. K8s YAML is kind: Deployment and does not set replicas > 1.
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 * HUMAN AUTHORIZATION 2026-10-13: apply resident for Hermes and Jarvis.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const JARVIS_RESIDENT = join(ROOT, "scripts", "run-jarvis-resident.mjs");
const HERMES_RESIDENT = join(ROOT, "scripts", "run-hermes-resident.mjs");
const JARVIS_YAML = join(ROOT, "infrastructure", "deploy", "jarvis-resident.deployment.yaml");
const HERMES_YAML = join(ROOT, "infrastructure", "deploy", "hermes-resident.deployment.yaml");

const LIBRARY_RUNTIME = [
  join(ROOT, "frontend", "src", "lib", "jarvis", "enterprise-cycle-runtime.server.ts"),
  join(ROOT, "frontend", "src", "lib", "jarvis", "enterprise-cycle.functions.ts"),
  join(ROOT, "frontend", "src", "lib", "jarvis", "enterprise-loop.ts"),
  join(ROOT, "frontend", "src", "lib", "hermes", "hermes-cycle.ts"),
] as const;

const RESIDENT_LOOP = /\bwhile\s*\(\s*true\s*\)|\bfor\s*\(\s*;\s*;\s*\)/;
const LIBRARY_DAEMON = [/\bwhile\s*\(\s*true\s*\)/, /\bsetInterval\s*\(/, /\bnew\s+Worker\s*\(/] as const;

function stripComments(source: string, kind: "code" | "yaml"): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  if (kind === "yaml") return withoutBlock.replace(/^\s*#.*$/gm, "");
  return withoutBlock.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function offlineEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.COREGRID_CYCLE_TENANT_ID;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  delete env.SUPABASE_ACCESS_TOKEN;
  delete env.SUPABASE_URL;
  delete env.SUPABASE_ANON_KEY;
  delete env.AI_API_KEY;
  return env;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runResident(script: string, args: string[], env: NodeJS.ProcessEnv): RunResult {
  const result = spawnSync(process.execPath, [script, ...args], {
    env,
    encoding: "utf8",
    timeout: 25_000,
    cwd: ROOT,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

let artifactsDir = "";

beforeAll(() => {
  artifactsDir = join(tmpdir(), `resident-supervisor-${Date.now()}`);
  mkdirSync(artifactsDir, { recursive: true });
});

afterAll(() => {
  rmSync(artifactsDir, { recursive: true, force: true });
});

describe("resident supervisor source pins", () => {
  it("resident scripts contain while (true) OR equivalent loop", () => {
    for (const path of [JARVIS_RESIDENT, HERMES_RESIDENT]) {
      const source = stripComments(readFileSync(path, "utf8"), "code");
      expect(source, `${path} must contain a supervisor loop`).toMatch(RESIDENT_LOOP);
    }
  });

  it("library runtime still has no while(true)/setInterval/new Worker", () => {
    for (const path of LIBRARY_RUNTIME) {
      const source = stripComments(readFileSync(path, "utf8"), "code");
      for (const pattern of LIBRARY_DAEMON) {
        expect(source, `${path} must not contain ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("runtime header states the library is not the resident", () => {
    const runtime = readFileSync(LIBRARY_RUNTIME[0], "utf8");
    expect(runtime).toMatch(/scripts\/run-\*-resident\.mjs|run-jarvis-resident\.mjs/);
    expect(runtime).toMatch(/assertLeaseSubstrateGovernance/);
    const stripped = stripComments(runtime, "code");
    expect(stripped).not.toMatch(/\brunHermesCycle\b/);
  });
});

describe("resident --rehearse (one offline tick, exit 0, no network)", () => {
  it("jarvis resident --rehearse exits 0", () => {
    const run = runResident(
      JARVIS_RESIDENT,
      ["--rehearse"],
      offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsDir }),
    );
    const out = `${run.stdout}\n${run.stderr}`;
    expect(run.status, `jarvis --rehearse output:\n${out}`).toBe(0);
    expect(out.toLowerCase()).not.toMatch(/fetch\(|https\.request|net\.connect/);
  });

  it("hermes resident --rehearse exits 0", () => {
    const run = runResident(
      HERMES_RESIDENT,
      ["--rehearse"],
      offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsDir }),
    );
    const out = `${run.stdout}\n${run.stderr}`;
    expect(run.status, `hermes --rehearse output:\n${out}`).toBe(0);
    expect(out.toLowerCase()).not.toMatch(/fetch\(|https\.request|net\.connect/);
  });
});

describe("jarvis resident live credential gate", () => {
  it("missing tenant on live path exits 2 BLOCKED_NO_CREDENTIAL", () => {
    const run = runResident(
      JARVIS_RESIDENT,
      [],
      offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsDir }),
    );
    const out = `${run.stdout}\n${run.stderr}`;
    expect(run.status, `jarvis live missing-tenant output:\n${out}`).toBe(2);
    expect(out).toContain("BLOCKED_NO_CREDENTIAL");
    expect(out).toContain("COREGRID_CYCLE_TENANT_ID");
  });
});

describe("k8s resident deployments", () => {
  it("has kind: Deployment and does not set replicas > 1", () => {
    for (const path of [JARVIS_YAML, HERMES_YAML]) {
      const yaml = readFileSync(path, "utf8");
      const stripped = stripComments(yaml, "yaml");
      expect(stripped, path).toMatch(/kind:\s*Deployment/);
      expect(stripped, `${path} must not set replicas > 1`).not.toMatch(
        /replicas:\s*(?:[2-9]\d*|[1-9]\d+)/,
      );
    }
  });
});
