/**
 * CoreGrid — four-eyes SECURITY+QUALITY invariants for governed
 * Jarvis/Hermes resident supervisors after HUMAN AUTHORIZATION 2026-10-13.
 *
 * This suite VERIFIES; it does not implement the supervisors. Proof style:
 * readFileSync source pins against the paths Runtime lands, plus a spawned
 * `--rehearse` of the Jarvis resident (no network). Missing production files
 * fail closed (`mustExist`). A violating mapping is never accommodated.
 *
 * New-world pins:
 *   Libraries still have NO setInterval(, while (true), new Worker(
 *   Resident supervisor scripts MUST exist and MUST contain while (true)
 *     or while(true).
 *   Deployment YAML MUST exist, kind: Deployment, replicas: 1 (not higher).
 *   enterprise-cycle-runtime.server.ts still MUST NOT call runHermesCycle
 *     (listing ≠ repair). Hermes resident script MAY jiti hermes-cycle.
 *   PHASE52_IMPLEMENTATION_AUTHORIZED remains false (do not weaken).
 *   Secrets: no sk_live in the new scripts.
 *   Jarvis resident --rehearse makes no network (spawn it).
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const PATHS = {
  cycleRuntime: "frontend/src/lib/jarvis/enterprise-cycle-runtime.server.ts",
  hermesCycle: "frontend/src/lib/hermes/hermes-cycle.ts",
  enterpriseLoop: "frontend/src/lib/jarvis/enterprise-loop.ts",
  findingsList: "frontend/src/lib/hermes/hermes-findings-list.ts",
  lockTs: "frontend/src/lib/missions/lease-substrate-gap-lock.ts",
  jarvisResident: "scripts/run-jarvis-resident.mjs",
  hermesResident: "scripts/run-hermes-resident.mjs",
  jarvisDeploy: "infrastructure/deploy/jarvis-resident.deployment.yaml",
  hermesDeploy: "infrastructure/deploy/hermes-resident.deployment.yaml",
  phase52Ts: "frontend/src/lib/workforce/phase52-attachment.ts",
  phase52Json: "architecture/COREGRID_V1_WORKFORCE_PHASE52_ATTACHMENT.json",
  phase52Extract: "architecture/COREGRID_PHASE52_JARVIS_HERMES_LEASE_EXTRACT.json",
  standingFleetTs: "frontend/src/lib/workforce/standing-fleet-claim.ts",
  phase52EnginesTs: "frontend/src/lib/workforce/phase52-v1-engines.ts",
} as const;

const LIBRARY_NO_DAEMON = [
  PATHS.cycleRuntime,
  PATHS.hermesCycle,
  PATHS.enterpriseLoop,
  PATHS.findingsList,
  PATHS.lockTs,
  PATHS.standingFleetTs,
  PATHS.phase52EnginesTs,
] as const;

const SUPERVISOR_SCRIPTS = [PATHS.jarvisResident, PATHS.hermesResident] as const;

const SUPERVISOR_DEPLOYS = [PATHS.jarvisDeploy, PATHS.hermesDeploy] as const;

const LIBRARY_DAEMON_PRIMITIVES = [
  /\bsetInterval\s*\(/,
  /\bwhile\s*\(\s*true\s*\)/,
  /\bnew\s+Worker\s*\(/,
] as const;

const WHILE_TRUE = /\bwhile\s*\(\s*true\s*\)/;

const SECRET_VALUE =
  /(?:sk_live_|sk_test_|whsec_|phc_|xox[baprs]-)[A-Za-z0-9]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}/;

function abs(rel: string): string {
  return join(ROOT, rel);
}

function mustExist(rel: string): string {
  const path = abs(rel);
  expect(existsSync(path), `four-eyes fail-closed: missing production module ${rel}`).toBe(true);
  return path;
}

function mustRead(rel: string): string {
  return readFileSync(mustExist(rel), "utf8");
}

/** Strip comments so a documented ban/requirement is not a false finding. */
function stripComments(source: string, kind: "code" | "yaml"): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  if (kind === "yaml") {
    return withoutBlock.replace(/^\s*#.*$/gm, "");
  }
  return withoutBlock.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function replicaCounts(yaml: string): number[] {
  const stripped = stripComments(yaml, "yaml");
  const counts: number[] = [];
  for (const match of stripped.matchAll(/\breplicas:\s*(\d+)/g)) {
    counts.push(Number(match[1]));
  }
  return counts;
}

function rehearsalArgs(script: string): string[] {
  if (script.includes("--rehearse")) return ["--rehearse"];
  if (script.includes("--rehearsal")) return ["--rehearsal"];
  if (script.includes("--offline")) return ["--offline"];
  return ["--rehearse"];
}

/* ─────────────────────────────────────────────────────────────
 * A. Libraries still have NO daemon primitives
 * ───────────────────────────────────────────────────────────── */

describe("A. libraries still have no setInterval / while(true) / new Worker(", () => {
  it.each(LIBRARY_NO_DAEMON)("%s remains a library (no resident-process primitives)", (rel) => {
    const source = stripComments(mustRead(rel), "code");
    for (const pattern of LIBRARY_DAEMON_PRIMITIVES) {
      expect(source, `${rel} must not contain ${pattern}`).not.toMatch(pattern);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * B. Resident supervisors MUST exist
 * ───────────────────────────────────────────────────────────── */

describe("B. governed Jarvis/Hermes resident supervisors MUST exist", () => {
  it.each(SUPERVISOR_SCRIPTS)("%s mustExist and MUST contain while (true) or while(true)", (rel) => {
    const stripped = stripComments(mustRead(rel), "code");
    expect(
      stripped,
      `${rel} MUST contain a resident loop (while (true) or while(true))`,
    ).toMatch(WHILE_TRUE);
  });

  it.each(SUPERVISOR_DEPLOYS)("%s mustExist with kind: Deployment and replicas: 1 (not higher)", (rel) => {
    const yaml = mustRead(rel);
    const stripped = stripComments(yaml, "yaml");
    expect(stripped, `${rel} MUST contain kind: Deployment`).toMatch(/\bkind:\s*Deployment\b/);
    const replicas = replicaCounts(yaml);
    expect(replicas.length, `${rel} MUST declare replicas`).toBeGreaterThan(0);
    for (const count of replicas) {
      expect(count, `${rel} replicas must be 1 (not higher)`).toBe(1);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * C. listing ≠ repair; Hermes resident MAY jiti hermes-cycle
 * ───────────────────────────────────────────────────────────── */

describe("C. listing ≠ repair (runtime MUST NOT call runHermesCycle)", () => {
  it("enterprise-cycle-runtime.server.ts still MUST NOT call runHermesCycle", () => {
    const stripped = stripComments(mustRead(PATHS.cycleRuntime), "code");
    expect(stripped, "runtime executable source MUST NOT contain runHermesCycle").not.toMatch(
      /\brunHermesCycle\b/,
    );
    expect(stripped).not.toMatch(/from\s+["'][^"']*hermes-cycle["']/);
    expect(stripped).not.toMatch(/import\(\s*["'][^"']*hermes-cycle["']\s*\)/);
  });

  it("Hermes resident script MAY jiti hermes-cycle (not forbidden; listing ≠ repair stays on Jarvis runtime)", () => {
    const source = mustRead(PATHS.hermesResident);
    const stripped = stripComments(source, "code");
    expect(stripped, "Hermes resident MUST contain a loop").toMatch(WHILE_TRUE);
    // Allowance: jiti/hermes-cycle/runHermesCycle in the Hermes supervisor is
    // permitted. Do not treat those tokens as a violation here.
    void /hermes-cycle|runHermesCycle|createJiti|\bjiti\b/.test(stripped);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Phase 52 remains classified (do not weaken)
 * ───────────────────────────────────────────────────────────── */

describe("Phase 52 implementation stays unauthorized", () => {
  it("PHASE52_IMPLEMENTATION_AUTHORIZED === false in TS+JSON", () => {
    const ts = mustRead(PATHS.phase52Ts);
    expect(ts).toMatch(/PHASE52_IMPLEMENTATION_AUTHORIZED\s*=\s*false/);
    const jsonText = mustRead(PATHS.phase52Json);
    const json = JSON.parse(jsonText) as { PHASE52_IMPLEMENTATION_AUTHORIZED?: unknown };
    expect(json.PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
  });

  it("extract JSON phase52ImplementationAuthorized remains false when present", () => {
    const jsonText = mustRead(PATHS.phase52Extract);
    const json = JSON.parse(jsonText) as { phase52ImplementationAuthorized?: unknown };
    expect(json.phase52ImplementationAuthorized).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * H. Secrets: no sk_live in new scripts
 * ───────────────────────────────────────────────────────────── */

describe("H. secrets hygiene on new resident scripts", () => {
  it.each([...SUPERVISOR_SCRIPTS, ...SUPERVISOR_DEPLOYS] as const)(
    "%s carries no sk_live / private-key VALUES",
    (rel) => {
      const source = mustRead(rel);
      expect(source, `${rel} must not embed secret values`).not.toMatch(SECRET_VALUE);
      expect(source, `${rel} must not embed sk_live values`).not.toMatch(/sk_live_/);
      expect(source, `${rel} must not embed private keys`).not.toMatch(
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
      );
    },
  );
});

/* ─────────────────────────────────────────────────────────────
 * I. Jarvis resident --rehearse makes no network (spawn it)
 * ───────────────────────────────────────────────────────────── */

describe("I. Jarvis resident --rehearse makes no network", () => {
  it("scripts/run-jarvis-resident.mjs --rehearse completes without network", () => {
    const source = mustRead(PATHS.jarvisResident);
    expect(source, "Jarvis resident MUST declare --rehearse").toMatch(/--rehearse/);
    const stripped = stripComments(source, "code");
    expect(stripped, "Jarvis resident MUST contain a loop").toMatch(WHILE_TRUE);

    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of [
      "AI_API_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ACCESS_TOKEN",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "COREGRID_CYCLE_TENANT_ID",
    ]) {
      delete env[name];
    }

    const rehearsal = spawnSync(process.execPath, [abs(PATHS.jarvisResident), ...rehearsalArgs(source)], {
      env,
      encoding: "utf8",
      timeout: 15_000,
    });
    const rehearsalOut = `${rehearsal.stdout ?? ""}\n${rehearsal.stderr ?? ""}`;
    expect(
      rehearsal.status,
      `Jarvis resident --rehearse must complete (not hang in while(true)); output:\n${rehearsalOut}`,
    ).not.toBe(null);
    expect(rehearsal.error, `Jarvis resident --rehearse spawn error: ${String(rehearsal.error)}`).toBeUndefined();
    expect(rehearsalOut.toLowerCase()).not.toMatch(/fetch\(|https\.request|net\.connect/);
    expect(rehearsalOut).not.toMatch(/\bsk_live_/);
  });
});
