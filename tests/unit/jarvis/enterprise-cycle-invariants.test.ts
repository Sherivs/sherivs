/**
 * CoreGrid — four-eyes SECURITY+QUALITY invariants for the Jarvis enterprise
 * wake (ACTIVE-V1). This suite VERIFIES; it does not implement production
 * modules (Observability / Runtime / Architecture own those).
 *
 * Proof style: readFileSync source pins against the paths other teams land,
 * plus behavioral imports when those modules load cleanly. Missing production
 * files fail closed. A violating mapping is never accommodated.
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DETECTABLE_CONDITIONS } from "@/lib/jarvis/enterprise-loop";
import type { ProviderHealthReport } from "@/lib/observability/provider-health.server";
import { isWorkerActivatable } from "@/lib/workforce/v1-workforce-lock";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const PATHS = {
  healthObservation: "frontend/src/lib/observability/provider-health-observation.ts",
  cycleContract: "frontend/src/lib/jarvis/enterprise-cycle-contract.ts",
  cycleFunctions: "frontend/src/lib/jarvis/enterprise-cycle.functions.ts",
  cycleRuntime: "frontend/src/lib/jarvis/enterprise-cycle-runtime.server.ts",
  enterpriseLoop: "frontend/src/lib/jarvis/enterprise-loop.ts",
  hermesCycle: "frontend/src/lib/hermes/hermes-cycle.ts",
  phase52Ts: "frontend/src/lib/workforce/phase52-attachment.ts",
  phase52Json: "architecture/COREGRID_V1_WORKFORCE_PHASE52_ATTACHMENT.json",
  cycleScript: "scripts/run-jarvis-enterprise-cycle.mjs",
  cycleWorkflow: ".github/workflows/jarvis-enterprise-cycle.yml",
} as const;

const FROZEN_WORKER_IDS = [
  "sdk_engineer",
  "ml_engineer",
  "knowledge_engineer",
  "intelligence_research_agent",
  "growth_intelligence_agent",
  "customer_success_agent",
] as const;

const TENANT = "tenant-alpha";
const NOW = "2026-10-13T08:00:00.000Z";

const SECRET_VALUE = /(?:sk_live_|sk_test_|whsec_|phc_|xox[baprs]-)[A-Za-z0-9]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}/;

const RESIDENT_PROCESS = [
  /\bsetInterval\s*\(/,
  /\bwhile\s*\(\s*true\s*\)/,
  /\bnew\s+Worker\s*\(/,
  /\bkind:\s*Deployment\b/,
] as const;

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

/** Strip comments so a documented ban on resident-process tokens is not a false finding. */
function stripComments(source: string, kind: "code" | "yaml"): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  if (kind === "yaml") {
    return withoutBlock.replace(/^\s*#.*$/gm, "");
  }
  return withoutBlock.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function healthReport(partial: Partial<ProviderHealthReport> & Pick<ProviderHealthReport, "provider" | "state">): ProviderHealthReport {
  return {
    detail: partial.detail ?? `${partial.provider} ${partial.state}`,
    checkedAt: partial.checkedAt ?? NOW,
    httpStatus: partial.httpStatus ?? null,
    durationMs: partial.durationMs ?? 0,
    ...partial,
    provider: partial.provider,
    state: partial.state,
  };
}

function observationKinds(result: unknown): string[] {
  if (!Array.isArray(result)) return [];
  const kinds: string[] = [];
  for (const item of result) {
    if (item === null || typeof item !== "object") continue;
    const record = item as { kind?: unknown; condition?: unknown };
    if (typeof record.kind === "string") kinds.push(record.kind);
    else if (typeof record.condition === "string") kinds.push(record.condition);
  }
  return kinds;
}

function callStamp(
  fn: (input: { tenantRef: string; reports: readonly ProviderHealthReport[] }) => unknown,
  reports: readonly ProviderHealthReport[],
): unknown {
  // Specified Observability contract: stampProviderHealthObservations({ tenantRef, reports }).
  // Do not guess arity — a reports-only call would look like a missing tenant and stamp nothing.
  return fn({ tenantRef: TENANT, reports });
}

function workflowOnKeys(yaml: string): string[] {
  const stripped = stripComments(yaml, "yaml");
  const match = stripped.match(/^on:\s*(?:\[([^\]]+)\]|\n((?:[ \t]+.*\n)*))/m);
  if (!match) return [];
  if (match[1]) {
    return match[1]
      .split(",")
      .map((item) => item.trim().replace(/['"]/g, ""))
      .filter(Boolean);
  }
  const block = match[2] ?? "";
  const keys: string[] = [];
  for (const line of block.split("\n")) {
    const key = line.match(/^[ \t]{2}([A-Za-z_][\w]*)\s*:/);
    if (key) keys.push(key[1]);
  }
  return keys;
}

function rehearsalArgs(script: string): string[] {
  if (script.includes("--rehearse")) return ["--rehearse"];
  if (script.includes("--rehearsal")) return ["--rehearsal"];
  if (script.includes("--offline")) return ["--offline"];
  return ["--rehearse"];
}

function liveArgs(script: string): string[] {
  if (script.includes("--live")) return ["--live"];
  return [];
}

/* ─────────────────────────────────────────────────────────────
 * A. No resident process
 * ───────────────────────────────────────────────────────────── */

describe("A. no resident Jarvis/Hermes process", () => {
  const libraryFiles = [PATHS.enterpriseLoop, PATHS.hermesCycle] as const;
  const landedCycleFiles = [PATHS.cycleRuntime, PATHS.cycleScript, PATHS.cycleWorkflow] as const;

  it.each(libraryFiles)("%s remains a library (no resident-process primitives)", (rel) => {
    const source = stripComments(mustRead(rel), rel.endsWith(".yml") ? "yaml" : "code");
    for (const pattern of RESIDENT_PROCESS) {
      expect(source, `${rel} must not contain ${pattern}`).not.toMatch(pattern);
    }
  });

  it.each(landedCycleFiles)("%s must exist and must not start a resident process", (rel) => {
    const source = stripComments(mustRead(rel), rel.endsWith(".yml") ? "yaml" : "code");
    for (const pattern of RESIDENT_PROCESS) {
      expect(source, `${rel} must not contain ${pattern}`).not.toMatch(pattern);
    }
  });

  it("runJarvisEnterpriseCycle remains an exported library function", () => {
    const source = mustRead(PATHS.enterpriseLoop);
    expect(source).toMatch(/export\s+function\s+runJarvisEnterpriseCycle\b/);
  });

  it("runHermesCycle remains an exported library function", () => {
    const source = mustRead(PATHS.hermesCycle);
    expect(source).toMatch(/export\s+(?:async\s+)?function\s+runHermesCycle\b/);
  });

  it("workflow triggers are schedule + workflow_dispatch only", () => {
    const yaml = mustRead(PATHS.cycleWorkflow);
    const keys = workflowOnKeys(yaml);
    expect(keys, "workflow on: keys").toEqual(expect.arrayContaining(["schedule", "workflow_dispatch"]));
    expect(keys.sort()).toEqual(["schedule", "workflow_dispatch"].sort());
    expect(keys).not.toContain("push");
    expect(keys).not.toContain("pull_request");
  });
});

/* ─────────────────────────────────────────────────────────────
 * B. Honest provider health
 * ───────────────────────────────────────────────────────────── */

describe("B. honest provider-health observation stamps", () => {
  it("maps NOT_CONFIGURED → provider_not_configured (never provider_outage)", () => {
    const source = mustRead(PATHS.healthObservation);
    expect(source).toMatch(/stampProviderHealthObservations/);
    expect(source).toMatch(/provider_not_configured/);
    expect(source).toMatch(/NOT_CONFIGURED/);
    expect(source).not.toMatch(/["']NOT_CONFIGURED["']\s*:\s*["']provider_outage["']/);
    expect(source).not.toMatch(/NOT_CONFIGURED\s*[:=>]+(?:\s*\{[^}]{0,120}){0,1}[^;\n]{0,80}["']provider_outage["']/);
  });

  it("maps NOT_REQUIRED → provider_not_required (never redis_failure)", () => {
    const source = mustRead(PATHS.healthObservation);
    expect(source).toMatch(/provider_not_required/);
    expect(source).toMatch(/NOT_REQUIRED/);
    expect(source).not.toMatch(/["']NOT_REQUIRED["']\s*:\s*["']redis_failure["']/);
    expect(source).not.toMatch(/NOT_REQUIRED\s*[:=>]+(?:\s*\{[^}]{0,120}){0,1}[^;\n]{0,80}["']redis_failure["']/);
  });

  it("DEGRADED redis → redis_failure; DEGRADED resend → email_failure; other DEGRADED → provider_outage", () => {
    const source = mustRead(PATHS.healthObservation);
    expect(source).toMatch(/redis_failure/);
    expect(source).toMatch(/email_failure/);
    expect(source).toMatch(/provider_outage/);
    expect(source).toMatch(/DEGRADED/);
    expect(source).toMatch(/\bredis\b/);
    expect(source).toMatch(/\bresend\b/);
  });

  it("does not invent numeric latency/error-rate observations", () => {
    const source = mustRead(PATHS.healthObservation);
    expect(source).not.toMatch(/\berror[_-]?rate\s*[:=]\s*\d/i);
    expect(source).not.toMatch(/\blatency(?:Ms|_ms)?\s*[:=]\s*\d+/i);
    expect(source).not.toMatch(/\bp99(?:Latency)?\s*[:=]\s*\d/i);
    expect(source).not.toMatch(/\b(?:errorRate|latencyMs)\s*:\s*\d+(?:\.\d+)?/);
  });

  it("behavioral: stampProviderHealthObservations([]) === [] and honest state mapping", async () => {
    mustExist(PATHS.healthObservation);
    const mod = (await import("@/lib/observability/provider-health-observation")) as {
      stampProviderHealthObservations?: (input: {
        tenantRef: string;
        reports: readonly ProviderHealthReport[];
      }) => unknown;
    };
    expect(mod.stampProviderHealthObservations, "Observability must export stampProviderHealthObservations").toEqual(
      expect.any(Function),
    );
    const stamp = mod.stampProviderHealthObservations as (input: {
      tenantRef: string;
      reports: readonly ProviderHealthReport[];
    }) => unknown;

    const empty = callStamp(stamp, []);
    expect(empty).toEqual([]);

    const notConfigured = observationKinds(
      callStamp(stamp, [healthReport({ provider: "paystack", state: "NOT_CONFIGURED" })]),
    );
    expect(notConfigured).toContain("provider_not_configured");
    expect(notConfigured).not.toContain("provider_outage");

    const notRequired = observationKinds(
      callStamp(stamp, [healthReport({ provider: "redis", state: "NOT_REQUIRED" })]),
    );
    expect(notRequired).toContain("provider_not_required");
    expect(notRequired).not.toContain("redis_failure");

    const operational = observationKinds(
      callStamp(stamp, [healthReport({ provider: "supabase", state: "OPERATIONAL" })]),
    );
    for (const kind of operational) {
      expect(DETECTABLE_CONDITIONS, `OPERATIONAL must not map to detectable ${kind}`).not.toContain(kind);
    }

    const authenticated = observationKinds(
      callStamp(stamp, [healthReport({ provider: "resend", state: "AUTHENTICATED" })]),
    );
    for (const kind of authenticated) {
      expect(DETECTABLE_CONDITIONS, `AUTHENTICATED must not map to detectable ${kind}`).not.toContain(kind);
    }

    const redisDegraded = observationKinds(
      callStamp(stamp, [healthReport({ provider: "redis", state: "DEGRADED", httpStatus: 503, durationMs: 41 })]),
    );
    expect(redisDegraded).toContain("redis_failure");

    const resendDegraded = observationKinds(
      callStamp(stamp, [healthReport({ provider: "resend", state: "DEGRADED", httpStatus: 503, durationMs: 41 })]),
    );
    expect(resendDegraded).toContain("email_failure");

    const otherDegraded = observationKinds(
      callStamp(stamp, [healthReport({ provider: "paystack", state: "DEGRADED", httpStatus: 503, durationMs: 41 })]),
    );
    expect(otherDegraded).toContain("provider_outage");
  });
});

/* ─────────────────────────────────────────────────────────────
 * C. Constitution §27 / secrets
 * ───────────────────────────────────────────────────────────── */

describe("C. §27 wake surface and secrets hygiene", () => {
  it("functions module: requireSupabaseAuth middleware, dynamic runtime import, no static server import", () => {
    const source = mustRead(PATHS.cycleFunctions);
    expect(source).toMatch(/requireSupabaseAuth/);
    expect(source).toMatch(/\.middleware\(\[\s*requireSupabaseAuth\s*\]\)/);
    expect(source).toMatch(/import\(\s*["'][^"']*enterprise-cycle-runtime\.server["']\s*\)/);
    expect(source).not.toMatch(/^import\s+(?!type\b).*enterprise-cycle-runtime\.server/m);
  });

  it("runtime: requirePlatformSuperAdmin, writeAuditRecord, tokenMsRemaining/sessionValid", () => {
    const source = mustRead(PATHS.cycleRuntime);
    expect(source).toMatch(/requirePlatformSuperAdmin/);
    expect(source).toMatch(/writeAuditRecord/);
    expect(source).toMatch(/tokenMsRemaining/);
    expect(source).toMatch(/sessionValid/);
  });

  it("contract: .strict() request schema and audit action jarvis.enterprise_cycle", () => {
    const source = mustRead(PATHS.cycleContract);
    expect(source).toMatch(/\.strict\(\s*\)/);
    expect(source).toMatch(/jarvis\.enterprise_cycle/);
    expect(source).toMatch(/tenantId/);
  });

  it("new cycle files carry no secret VALUES (names are allowed)", () => {
    const rels = [
      PATHS.healthObservation,
      PATHS.cycleContract,
      PATHS.cycleFunctions,
      PATHS.cycleRuntime,
      PATHS.phase52Ts,
      PATHS.cycleScript,
      PATHS.cycleWorkflow,
      PATHS.phase52Json,
    ] as const;
    for (const rel of rels) {
      const source = mustRead(rel);
      expect(source, `${rel} must not embed secret values`).not.toMatch(SECRET_VALUE);
      expect(source, `${rel} must not assign a password literal`).not.toMatch(
        /\bpassword\s*[:=]\s*["'][^"']{4,}["']/i,
      );
    }
  });

  it("script exits 2 BLOCKED_NO_CREDENTIAL without network; rehearsal makes no network", () => {
    const source = mustRead(PATHS.cycleScript);
    expect(source).toMatch(/BLOCKED_NO_CREDENTIAL/);
    expect(source).toMatch(/process\.exit\(\s*2\s*\)|exitCode\s*=\s*2/);
    expect(source.toLowerCase()).toMatch(/rehears/);
    const stripped = stripComments(source, "code");
    for (const pattern of RESIDENT_PROCESS) {
      expect(stripped).not.toMatch(pattern);
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of [
      "AI_API_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ACCESS_TOKEN",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
    ]) {
      delete env[name];
    }

    const live = spawnSync(process.execPath, [abs(PATHS.cycleScript), ...liveArgs(source)], {
      env,
      encoding: "utf8",
      timeout: 15_000,
    });
    const liveOut = `${live.stdout ?? ""}\n${live.stderr ?? ""}`;
    expect(live.status, `live missing-credential stdout/stderr:\n${liveOut}`).toBe(2);
    expect(liveOut).toContain("BLOCKED_NO_CREDENTIAL");

    const rehearsal = spawnSync(process.execPath, [abs(PATHS.cycleScript), ...rehearsalArgs(source)], {
      env,
      encoding: "utf8",
      timeout: 15_000,
    });
    const rehearsalOut = `${rehearsal.stdout ?? ""}\n${rehearsal.stderr ?? ""}`;
    expect(rehearsalOut.toLowerCase()).not.toMatch(/fetch\(|https\.request|net\.connect/);
    expect(rehearsal.status, `rehearsal should not attempt network; output:\n${rehearsalOut}`).not.toBe(null);
  });

  it("runtime exports executeEnterpriseCycle or runEnterpriseCycleLibrary", async () => {
    mustExist(PATHS.cycleRuntime);
    const mod = (await import("@/lib/jarvis/enterprise-cycle-runtime.server")) as Record<string, unknown>;
    const exported = mod.executeEnterpriseCycle ?? mod.runEnterpriseCycleLibrary;
    expect(exported, "Runtime must export executeEnterpriseCycle or runEnterpriseCycleLibrary").toEqual(
      expect.any(Function),
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * D. Phase 52 classified attachment — not implementation authorization
 * ───────────────────────────────────────────────────────────── */

describe("D. Phase 52 attachment is locked, not authorized", () => {
  it("PHASE52_IMPLEMENTATION_AUTHORIZED === false in the architecture JSON", () => {
    const jsonText = mustRead(PATHS.phase52Json);
    expect(jsonText).toMatch(/PHASE52_IMPLEMENTATION_AUTHORIZED/);
    const json = JSON.parse(jsonText) as { PHASE52_IMPLEMENTATION_AUTHORIZED?: unknown };
    expect(json.PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
  });

  it("PHASE52_IMPLEMENTATION_AUTHORIZED === false in the attachment TypeScript module", () => {
    const ts = mustRead(PATHS.phase52Ts);
    expect(ts).toMatch(/PHASE52_IMPLEMENTATION_AUTHORIZED/);
    expect(ts).toMatch(/PHASE52_IMPLEMENTATION_AUTHORIZED\s*=\s*false/);
  });

  it("phase52Registered is false", () => {
    const ts = mustRead(PATHS.phase52Ts);
    expect(ts).toMatch(/phase52Registered/);
    expect(ts).toMatch(/phase52Registered\s*(?:=|:)\s*false/);
  });

  it("frozen worker ids are not implementable", () => {
    const ts = mustRead(PATHS.phase52Ts);
    for (const workerId of FROZEN_WORKER_IDS) {
      expect(ts, `phase52 attachment must name frozen worker ${workerId}`).toContain(workerId);
      expect(isWorkerActivatable(workerId), `${workerId} must not be activatable on the V1 lock`).toBe(false);
    }
    expect(ts).toMatch(/implementable|do_not_implement|not implementable|FREEZE/i);
  });

  it("behavioral: attachment module refuses implementation authorization", async () => {
    mustExist(PATHS.phase52Ts);
    const mod = (await import("@/lib/workforce/phase52-attachment")) as Record<string, unknown>;
    if ("PHASE52_IMPLEMENTATION_AUTHORIZED" in mod) {
      expect(mod.PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
    }
    if ("phase52Registered" in mod) {
      expect(mod.phase52Registered).toBe(false);
    }
    const implementable = mod.isPhase52WorkerImplementable ?? mod.isWorkerImplementable;
    if (typeof implementable === "function") {
      for (const workerId of FROZEN_WORKER_IDS) {
        expect((implementable as (id: string) => unknown)(workerId)).toBe(false);
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * E. Tenant isolation
 * ───────────────────────────────────────────────────────────── */

describe("E. tenant isolation on the enterprise cycle wake", () => {
  it("request schema requires tenantId", () => {
    const source = mustRead(PATHS.cycleContract);
    expect(source).toMatch(/tenantId\s*:\s*z\.string\(/);
    expect(source).toMatch(/\.strict\(\s*\)/);
  });

  it("cycle runtime passes tenantRef from the validated request into runJarvisEnterpriseCycle", () => {
    const source = mustRead(PATHS.cycleRuntime);
    expect(source).toMatch(/runJarvisEnterpriseCycle/);
    expect(source).toMatch(/tenantRef\s*:\s*(?:[A-Za-z_][\w.]*\.)?tenantId\b/);
  });
});
