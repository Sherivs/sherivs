/**
 * CoreGrid — RUNTIME: Jarvis enterprise-cycle wake surface.
 *
 * Behavioral + invariant proof for `frontend/src/lib/jarvis/enterprise-cycle.functions.ts`:
 *
 *   1. GATING — a non-platform-super caller is denied by the REAL
 *      `requirePlatformSuperAdmin` gate (driven against a fake RPC client)
 *      before anything runs: health port not called, and a fail-closed
 *      audit record of the denial (§27, §31: agent cannot exceed permissions).
 *   2. EXPIRED SESSION — denied before the role is consulted.
 *   3. VALIDATION — the Zod strict request contract rejects malformed requests.
 *   4. COMPLETED PATH — super-admin + empty health stub → cycle sleeps,
 *      zero detections, attempted true.
 *   5. DEGRADED redis → cycle detects redis_failure (Observability mapping).
 *   6. OPERATIONAL-only reports → zero detections.
 *   7. includeProviderHealth false → health port not called.
 *   8. Hermes port failure → hermes skipped with reason, cycle still completes.
 *   9. Injected Hermes FINDINGS (mission_stuck / worker_quarantined /
 *      mission_failed / empty / opted-out / missing port / throw / gate).
 *  10. §27 static invariants — functions/runtime/contract source pins.
 *  11. Script source pin: rehearsal, exit 2, jiti, no daemon.
 *  12. Workflow source pin: schedule, --rehearse, BLOCKED_NO_CREDENTIAL.
 *
 * No network or DB: ports are injected. Version-target: ACTIVE-V1.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENTERPRISE_CYCLE_AUDIT_ACTION,
  enterpriseCycleRequestSchema,
  type EnterpriseCycleDeps,
} from "@/lib/jarvis/enterprise-cycle.functions";
import { executeEnterpriseCycle } from "@/lib/jarvis/enterprise-cycle-runtime.server";
import type { WriteAuditEntry } from "@/lib/server/write-audit";
import { requirePlatformSuperAdmin } from "@/lib/security-role-gate";
import type { ProviderHealthObservationSource } from "@/lib/observability/provider-health-observation";
import type { HermesFindingObservationSource } from "@/lib/hermes/hermes-finding-observation";
import { JarvisCapability } from "@/lib/jarvis/jarvis-contract";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FAMILY_SRC = join(ROOT, "frontend/src/lib/jarvis/enterprise-cycle.functions.ts");
const CONTRACT_SRC = join(ROOT, "frontend/src/lib/jarvis/enterprise-cycle-contract.ts");
const RUNTIME_SRC = join(ROOT, "frontend/src/lib/jarvis/enterprise-cycle-runtime.server.ts");
const SCRIPT_SRC = join(ROOT, "scripts/run-jarvis-enterprise-cycle.mjs");
const WORKFLOW_SRC = join(ROOT, ".github/workflows/jarvis-enterprise-cycle.yml");

const TENANT = "tenant-cycle-alpha";
const T0 = "2026-10-13T08:00:00.000Z";

const RESIDENT_PROCESS = [
  /\bsetInterval\s*\(/,
  /\bwhile\s*\(\s*true\s*\)/,
  /\bnew\s+Worker\s*\(/,
  /\bkind:\s*Deployment\b/,
] as const;

function healthReport(
  partial: Pick<ProviderHealthObservationSource, "provider" | "state"> &
    Partial<ProviderHealthObservationSource>,
): ProviderHealthObservationSource {
  return {
    detail: partial.detail ?? `${partial.provider} ${partial.state}`,
    checkedAt: partial.checkedAt ?? T0,
    httpStatus: partial.httpStatus ?? null,
    durationMs: partial.durationMs ?? 0,
    ...partial,
    provider: partial.provider,
    state: partial.state,
  } as ProviderHealthObservationSource;
}

function hermesFinding(
  partial: Pick<HermesFindingObservationSource, "kind"> &
    Partial<HermesFindingObservationSource>,
): HermesFindingObservationSource {
  const kind = partial.kind;
  return {
    findingId: `${kind}:subject-1`,
    tenantId: TENANT,
    subjectRef: "subject-1",
    severity: "warning",
    summary: `${kind} observed`,
    evidenceRefs: ["ev-1"],
    observedAt: T0,
    claim: {
      source: "mission_record_port",
      sourceRef: "cg_mission_execution:subject-1",
      observedAt: T0,
      verified: true,
      confidence: "canonical",
      claim: "state of record",
    },
    ...partial,
    kind,
  };
}

function cycleDeps(overrides?: {
  env?: Record<string, string | undefined>;
  runProviderHealth?: EnterpriseCycleDeps["runProviderHealth"];
  runHermesObservation?: EnterpriseCycleDeps["runHermesObservation"];
  listHermesFindings?: EnterpriseCycleDeps["listHermesFindings"];
  grantedCapabilities?: readonly string[];
}): EnterpriseCycleDeps & {
  audits: WriteAuditEntry[];
  healthCalls: number;
  hermesCalls: number;
  findingsCalls: number;
} {
  const audits: WriteAuditEntry[] = [];
  let healthCalls = 0;
  let hermesCalls = 0;
  let findingsCalls = 0;
  const defaultHealth: EnterpriseCycleDeps["runProviderHealth"] = async () => {
    healthCalls += 1;
    return [];
  };
  return {
    audit: async (entry) => {
      audits.push(entry);
    },
    readEnv: (name) => overrides?.env?.[name],
    now: () => T0,
    grantedCapabilities: overrides?.grantedCapabilities ?? Object.values(JarvisCapability),
    runProviderHealth:
      overrides?.runProviderHealth === undefined
        ? defaultHealth
        : async (env) => {
            healthCalls += 1;
            return overrides.runProviderHealth!(env);
          },
    runHermesObservation:
      overrides?.runHermesObservation === undefined
        ? undefined
        : async (step) => {
            hermesCalls += 1;
            return overrides.runHermesObservation!(step);
          },
    listHermesFindings:
      overrides?.listHermesFindings === undefined
        ? undefined
        : async (input) => {
            findingsCalls += 1;
            return overrides.listHermesFindings!(input);
          },
    audits,
    get healthCalls() {
      return healthCalls;
    },
    get hermesCalls() {
      return hermesCalls;
    },
    get findingsCalls() {
      return findingsCalls;
    },
  };
}

function gateRpcClient(roleGranted: boolean): Parameters<typeof requirePlatformSuperAdmin>[0] {
  return {
    rpc: async () => ({ data: roleGranted, error: null }),
  } as unknown as Parameters<typeof requirePlatformSuperAdmin>[0];
}

const VALID_REQUEST = {
  tenantId: TENANT,
};

async function wake(
  deps: EnterpriseCycleDeps,
  overrides?: Partial<{ role: boolean; data: unknown; claims: { exp?: number; email?: string } }>,
) {
  const claims = overrides?.claims ?? {
    exp: Math.floor(Date.now() / 1000) + 600,
    email: "admin@coregrid.test",
  };
  return executeEnterpriseCycle(
    {
      supabase: gateRpcClient(overrides?.role ?? true),
      userId: "platform-admin-1",
      claims,
      data: overrides?.data ?? VALID_REQUEST,
    },
    deps,
  );
}

/* ─────────────────────────────────────────────────────────────
 * 1. GATING — non-platform-super callers are denied, never woken
 * ────────────────────────────────────────────────────────────*/

describe("enterprise cycle gating (§27 authorize before anything)", () => {
  it("denies a non-platform-super caller through the real gate, health port not called, audited", async () => {
    const deps = cycleDeps();
    const outcome = await wake(deps, { role: false });

    expect(outcome.outcome).toBe("denied");
    if (outcome.outcome !== "denied") return;
    expect(outcome.code).toBe("gate_denied");
    expect(outcome.reason).toBe("Forbidden: platform super admin role required");

    expect(deps.healthCalls).toBe(0);
    expect(deps.findingsCalls).toBe(0);

    expect(deps.audits).toHaveLength(1);
    const entry = deps.audits[0];
    expect(entry.action).toBe(ENTERPRISE_CYCLE_AUDIT_ACTION);
    expect(entry.gate).toBe("requirePlatformSuperAdmin");
    expect(entry.outcome).toBe("failed");
    expect(entry.actorId).toBe("platform-admin-1");
    expect(entry.tenantId).toBe(TENANT);
    expect(entry.table).toBe("cg_event");
    expect(entry.details).toMatchObject({ cycle_outcome_code: "gate_denied" });
  });

  it("denies an expired session before the role is ever consulted (§31 expired access fails)", async () => {
    const deps = cycleDeps();
    const outcome = await wake(deps, {
      role: true,
      claims: { exp: Math.floor(Date.now() / 1000) - 600, email: "admin@coregrid.test" },
    });
    expect(outcome.outcome).toBe("denied");
    if (outcome.outcome !== "denied") return;
    expect(outcome.code).toBe("gate_denied");
    expect(deps.healthCalls).toBe(0);
    expect(deps.findingsCalls).toBe(0);
    expect(deps.audits[0].outcome).toBe("failed");
  });

  it("gate denied still does not call listHermesFindings", async () => {
    const deps = cycleDeps({
      listHermesFindings: async () => [hermesFinding({ kind: "mission_stuck" })],
    });
    const outcome = await wake(deps, { role: false });
    expect(outcome.outcome).toBe("denied");
    expect(deps.findingsCalls).toBe(0);
    expect(deps.healthCalls).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. VALIDATION — malformed requests are rejected
 * ────────────────────────────────────────────────────────────*/

describe("request validation (§26 Zod strict contract)", () => {
  it("accepts the valid request shape", () => {
    expect(enterpriseCycleRequestSchema.safeParse(VALID_REQUEST).success).toBe(true);
  });

  it("rejects missing tenantId", () => {
    expect(enterpriseCycleRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown fields (strict contract, no client smuggle)", () => {
    expect(
      enterpriseCycleRequestSchema.safeParse({ ...VALID_REQUEST, grantId: "grant-1" }).success,
    ).toBe(false);
  });

  it("rejects empty, oversized and non-string tenantId", () => {
    expect(enterpriseCycleRequestSchema.safeParse({ tenantId: "" }).success).toBe(false);
    expect(enterpriseCycleRequestSchema.safeParse({ tenantId: "x".repeat(200) }).success).toBe(
      false,
    );
    expect(enterpriseCycleRequestSchema.safeParse({ tenantId: 42 }).success).toBe(false);
    expect(enterpriseCycleRequestSchema.safeParse(null).success).toBe(false);
  });

  it("audits and denies a malformed request reaching the core (defense in depth)", async () => {
    const deps = cycleDeps();
    const outcome = await wake(deps, { data: { nightMode: true } });
    expect(outcome.outcome).toBe("denied");
    if (outcome.outcome !== "denied") return;
    expect(outcome.code).toBe("invalid_request");
    expect(deps.healthCalls).toBe(0);
    expect(deps.audits).toHaveLength(1);
    expect(deps.audits[0].details).toMatchObject({ cycle_outcome_code: "invalid_request" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4–8. COMPLETED PATH — library cycle over injected ports
 * ────────────────────────────────────────────────────────────*/

describe("completed path (library cycle over injected ports)", () => {
  it("super-admin + empty health stub completes, cycle sleeps, zero detections, attempted true", async () => {
    const deps = cycleDeps();
    const outcome = await wake(deps);

    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome !== "completed") return;
    expect(outcome.attempted).toBe(true);
    expect(outcome.cycle.detections).toEqual([]);
    expect(outcome.cycle.phases.map((phase) => phase.phase)).toContain("SLEEP");
    expect(outcome.cycle.sleep.reason.length).toBeGreaterThan(0);
    expect(outcome.health.ran).toBe(true);
    expect(outcome.health.reportCount).toBe(0);
    expect(outcome.health.skipReason).toBeNull();
    expect(outcome.briefingHeader).toContain("Morning executive report");
    expect(deps.healthCalls).toBe(1);
    expect(deps.audits).toHaveLength(1);
    expect(deps.audits[0].outcome).toBe("succeeded");
    expect(deps.audits[0].action).toBe(ENTERPRISE_CYCLE_AUDIT_ACTION);
    expect(deps.audits[0].table).toBe("cg_event");
    expect(deps.audits[0].details).toMatchObject({ cycle_outcome_code: "completed" });
    expect(JSON.stringify(deps.audits[0])).not.toMatch(/sk-|Bearer\s/i);
  });

  it("super-admin + injected DEGRADED redis report → cycle detects redis_failure", async () => {
    const deps = cycleDeps({
      runProviderHealth: async () => [
        healthReport({ provider: "redis", state: "DEGRADED", httpStatus: 503, durationMs: 41 }),
      ],
    });
    const outcome = await wake(deps);
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome !== "completed") return;
    expect(outcome.attempted).toBe(true);
    expect(outcome.health.ran).toBe(true);
    expect(outcome.health.reportCount).toBe(1);
    expect(outcome.cycle.detections.map((d) => d.condition)).toContain("redis_failure");
  });

  it("super-admin + injected OPERATIONAL-only reports → zero detections", async () => {
    const deps = cycleDeps({
      runProviderHealth: async () => [
        healthReport({ provider: "supabase", state: "OPERATIONAL" }),
        healthReport({ provider: "resend", state: "OPERATIONAL" }),
      ],
    });
    const outcome = await wake(deps);
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome !== "completed") return;
    expect(outcome.cycle.detections).toEqual([]);
    expect(outcome.health.ran).toBe(true);
    expect(outcome.health.reportCount).toBe(2);
  });

  it("includeProviderHealth false → health port not called", async () => {
    const deps = cycleDeps();
    const outcome = await wake(deps, {
      data: { tenantId: TENANT, includeProviderHealth: false },
    });
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome !== "completed") return;
    expect(deps.healthCalls).toBe(0);
    expect(outcome.health.ran).toBe(false);
    expect(outcome.health.skipReason).toMatch(/includeProviderHealth=false/);
    expect(outcome.cycle.detections).toEqual([]);
  });

  it("Hermes port failure → hermes skipped with reason, cycle still completes", async () => {
    const deps = cycleDeps({
      runHermesObservation: async () => {
        throw new Error("hermes substrate unavailable");
      },
    });
    const outcome = await wake(deps);
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome !== "completed") return;
    expect(outcome.attempted).toBe(true);
    expect(deps.hermesCalls).toBe(1);
    expect(outcome.hermes.ran).toBe(false);
    expect(outcome.hermes.consumed).toBe("failed");
    expect(outcome.hermes.skipReason).toContain("hermes substrate unavailable");
    expect(outcome.cycle.phases.map((phase) => phase.phase)).toContain("SLEEP");
    expect(outcome.hermes.findingsStamped).toBe(0);
    expect(outcome.hermes.findingsSkipReason).toMatch(/not injected/);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 9. HERMES FINDINGS — stamp already-listed findings; never invent
 * ────────────────────────────────────────────────────────────*/

describe("Hermes findings consumption (injected port, Observability stamp)", () => {
  it("injected mission_stuck finding with evidence → cycle detects mission_timeout", async () => {
    const deps = cycleDeps({
      listHermesFindings: async () => [
        hermesFinding({
          kind: "mission_stuck",
          findingId: "mission_stuck:exec-stuck",
          subjectRef: "exec-stuck",
          summary: "assigned execution exec-stuck is stale",
          evidenceRefs: ["cg_foundation_evidence:exec-stuck"],
        }),
      ],
    });
    const outcome = await wake(deps);
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome !== "completed") return;
    expect(deps.findingsCalls).toBe(1);
    expect(outcome.hermes.findingsStamped).toBe(1);
    expect(outcome.hermes.findingsSkipReason).toBeNull();
    expect(outcome.cycle.detections.map((d) => d.condition)).toContain("mission_timeout");
    expect(deps.audits[0].details).toMatchObject({ hermes_findings_stamped: 1 });
  });

  it("injected worker_quarantined finding → cycle detects worker_failure", async () => {
    const deps = cycleDeps({
      listHermesFindings: async () => [
        hermesFinding({
          kind: "worker_quarantined",
          findingId: "worker_quarantined:worker-7",
          subjectRef: "worker-7",
          summary: "worker worker-7 quarantined after repeated failures",
          severity: "critical",
        }),
      ],
    });
    const outcome = await wake(deps);
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome !== "completed") return;
    expect(outcome.hermes.findingsStamped).toBe(1);
    expect(outcome.hermes.findingsSkipReason).toBeNull();
    expect(outcome.cycle.detections.map((d) => d.condition)).toContain("worker_failure");
  });

  it("injected mission_failed finding → NO detection from that kind (Hermes owns repair)", async () => {
    const deps = cycleDeps({
      listHermesFindings: async () => [
        hermesFinding({
          kind: "mission_failed",
          findingId: "mission_failed:exec-4",
          subjectRef: "exec-4",
          summary: "mission exec-4 failed its lawful path",
        }),
      ],
    });
    const outcome = await wake(deps);
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome !== "completed") return;
    expect(outcome.hermes.findingsStamped).toBe(1);
    expect(outcome.hermes.findingsSkipReason).toBeNull();
    expect(outcome.cycle.detections.map((d) => d.condition)).not.toContain("mission_timeout");
    expect(outcome.cycle.detections.map((d) => d.condition)).not.toContain("worker_failure");
    expect(outcome.cycle.detections).toEqual([]);
  });

  it("empty findings array from the port → zero hermes detections, cycle still completes, findingsStamped 0", async () => {
    const deps = cycleDeps({
      listHermesFindings: async () => [],
    });
    const outcome = await wake(deps);
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome !== "completed") return;
    expect(deps.findingsCalls).toBe(1);
    expect(outcome.hermes.findingsStamped).toBe(0);
    expect(outcome.hermes.findingsSkipReason).toBeNull();
    expect(outcome.cycle.detections).toEqual([]);
    expect(outcome.cycle.phases.map((phase) => phase.phase)).toContain("SLEEP");
  });

  it("includeHermesObservation false → listHermesFindings not called", async () => {
    const deps = cycleDeps({
      listHermesFindings: async () => [hermesFinding({ kind: "mission_stuck" })],
    });
    const outcome = await wake(deps, {
      data: { tenantId: TENANT, includeHermesObservation: false },
    });
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome !== "completed") return;
    expect(deps.findingsCalls).toBe(0);
    expect(outcome.hermes.findingsStamped).toBe(0);
    expect(outcome.hermes.findingsSkipReason).toMatch(/includeHermesObservation=false/);
    expect(outcome.cycle.detections).toEqual([]);
  });

  it("missing listHermesFindings port → findingsSkipReason mentions not injected; nothing invented", async () => {
    const deps = cycleDeps();
    const outcome = await wake(deps);
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome !== "completed") return;
    expect(deps.findingsCalls).toBe(0);
    expect(outcome.hermes.findingsStamped).toBe(0);
    expect(outcome.hermes.findingsSkipReason).toMatch(/not injected/);
    expect(outcome.cycle.detections).toEqual([]);
  });

  it("listHermesFindings throw → cycle still completes; health stamps still flow if present", async () => {
    const deps = cycleDeps({
      runProviderHealth: async () => [
        healthReport({ provider: "redis", state: "DEGRADED", httpStatus: 503, durationMs: 41 }),
      ],
      listHermesFindings: async () => {
        throw new Error("findings substrate unavailable");
      },
    });
    const outcome = await wake(deps);
    expect(outcome.outcome).toBe("completed");
    if (outcome.outcome !== "completed") return;
    expect(outcome.attempted).toBe(true);
    expect(deps.findingsCalls).toBe(1);
    expect(outcome.hermes.findingsStamped).toBe(0);
    expect(outcome.hermes.findingsSkipReason).toContain("findings substrate unavailable");
    expect(outcome.health.ran).toBe(true);
    expect(outcome.cycle.detections.map((d) => d.condition)).toContain("redis_failure");
    expect(outcome.cycle.phases.map((phase) => phase.phase)).toContain("SLEEP");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 9. §27 static invariants — the shipped surface carries the chain
 * ────────────────────────────────────────────────────────────*/

describe("§27 server-function invariants — enterprise-cycle.functions.ts", () => {
  const src = readFileSync(FAMILY_SRC, "utf8");
  const runtime = readFileSync(RUNTIME_SRC, "utf8");
  const contract = readFileSync(CONTRACT_SRC, "utf8");

  it("1 AUTHENTICATE: requireSupabaseAuth middleware on the server function", () => {
    expect(src).toMatch(/\.middleware\(\[\s*requireSupabaseAuth\s*\]\)/);
  });

  it("2+3 AUTHORIZE: the canonical platform super-admin gate with lifecycle/session threading", () => {
    expect(runtime).toMatch(/requirePlatformSuperAdmin\(/);
    expect(runtime).toMatch(/lifecycle:\s*null/);
    expect(runtime).toMatch(/sessionValid/);
    expect(runtime).toMatch(/tokenMsRemaining/);
    expect(runtime).toMatch(/writeAuditRecord/);
  });

  it("4 VALIDATE: the Zod strict validator is wired into the server function", () => {
    expect(src).toMatch(
      /\.validator\(\(input: unknown\) => enterpriseCycleRequestSchema\.parse\(input\)\)/,
    );
    expect(contract).toMatch(/\.strict\(\)/);
    expect(contract).toMatch(/tenantId/);
    expect(contract).toMatch(/ENTERPRISE_CYCLE_AUDIT_ACTION = "jarvis\.enterprise_cycle"/);
  });

  it("5 EXECUTE: dynamic import of runtime.server inside the handler; no static server import", () => {
    expect(src).not.toMatch(/^import\s+(?!type\b).*enterprise-cycle-runtime\.server/m);
    expect(src).toMatch(/import\(\s*["']\.\/enterprise-cycle-runtime\.server["']\s*\)/);
    expect(runtime).toMatch(/runJarvisEnterpriseCycle/);
    expect(runtime).toMatch(/tenantRef\s*:\s*(?:[A-Za-z_][\w.]*\.)?tenantId\b/);
    expect(runtime).toMatch(/stampProviderHealthObservations/);
    expect(runtime).toMatch(/runHermesEventObservationStep/);
    expect(runtime).toMatch(/stampHermesFindings/);
    expect(runtime).toMatch(/hermes-finding-observation/);
    expect(runtime).not.toMatch(/\brunHermesCycle\b/);
    expect(src).toMatch(/runJarvisEnterpriseCycleWake/);
  });

  it("runtime imports stampHermesFindings; no runHermesCycle call; no setInterval", () => {
    expect(runtime).toMatch(/stampHermesFindings/);
    expect(runtime).toMatch(/from\s+["']@\/lib\/hermes\/hermes-finding-observation["']/);
    expect(runtime).not.toMatch(/\brunHermesCycle\b/);
    expect(runtime).not.toMatch(/from\s+["'][^"']*hermes-cycle["']/);
    expect(runtime).not.toMatch(/\bsetInterval\s*\(/);
    expect(runtime).not.toMatch(/\bwhile\s*\(\s*true\s*\)/);
    expect(runtime).not.toMatch(/\bnew\s+Worker\s*\(/);
    expect(contract).toMatch(/listHermesFindings/);
    expect(contract).toMatch(/HermesFindingObservationSource/);
    expect(contract).toMatch(/findingsStamped/);
    expect(contract).toMatch(/findingsSkipReason/);
  });

  it("6 AUDIT: every attempt writes a fail-closed audit record; no secrets logged", () => {
    expect(runtime).toMatch(/writeAuditRecord/);
    expect(contract).toMatch(/ENTERPRISE_CYCLE_AUDIT_ACTION = "jarvis\.enterprise_cycle"/);
    expect(runtime).not.toMatch(/console\.log/);
    expect(contract).toMatch(/cg_event/);
  });

  it("no resident process primitives in functions/runtime/contract", () => {
    for (const source of [src, runtime, contract]) {
      for (const pattern of RESIDENT_PROCESS) {
        expect(source).not.toMatch(pattern);
      }
    }
  });
});

describe("script source pin — run-jarvis-enterprise-cycle.mjs", () => {
  const script = readFileSync(SCRIPT_SRC, "utf8");

  it("rehearses offline via jiti, exits 2 BLOCKED_NO_CREDENTIAL, is not a daemon", () => {
    expect(script).toMatch(/--rehearse/);
    expect(script).toMatch(/createJiti/);
    expect(script).toMatch(/BLOCKED_NO_CREDENTIAL/);
    expect(script).toMatch(/process\.exit\(\s*2\s*\)/);
    expect(script).toMatch(/BLOCKED_USAGE/);
    expect(script).toMatch(/runJarvisEnterpriseCycle/);
    expect(script).toMatch(/rehearsal-tenant/);
    expect(script).toMatch(/runEnterpriseCycleLibrary/);
    expect(script).toMatch(/Does NOT import provider-health\.server/);
    expect(script).toMatch(/if \(REHEARSE\)/);
    for (const pattern of RESIDENT_PROCESS) {
      expect(script).not.toMatch(pattern);
    }
  });
});

describe("workflow source pin — jarvis-enterprise-cycle.yml", () => {
  const yaml = readFileSync(WORKFLOW_SRC, "utf8");

  it("schedules a wake, always rehearses, treats missing secret as BLOCKED_NO_CREDENTIAL", () => {
    expect(yaml).toMatch(/schedule:/);
    expect(yaml).toMatch(/workflow_dispatch:/);
    expect(yaml).toMatch(/cron:\s*"41 5 \* \* \*"/);
    expect(yaml).toMatch(/--rehearse/);
    expect(yaml).toMatch(/BLOCKED_NO_CREDENTIAL/);
    expect(yaml).toMatch(/COREGRID_CYCLE_TENANT_ID/);
    expect(yaml).not.toMatch(/^\s*concurrency:/m);
    expect(yaml).not.toMatch(/group:\s*canonical-db-batteries/);
    expect(yaml).toMatch(/if-no-files-found:\s*ignore/);
    expect(yaml).toMatch(/contents:\s*read/);
    for (const pattern of RESIDENT_PROCESS) {
      expect(yaml).not.toMatch(pattern);
    }
  });
});
