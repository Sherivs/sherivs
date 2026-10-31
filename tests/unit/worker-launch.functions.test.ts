/**
 * Sherivs — R7 WORKFORCE-SURFACE: worker mission launch surface.
 *
 * Behavioral + invariant proof for `frontend/src/lib/workforce/worker-launch.functions.ts`:
 *
 *   1. GATING — a non-platform-super caller is denied by the REAL
 *      `requirePlatformSuperAdmin` gate (driven against a fake RPC client)
 *      before anything launches: no execution read, no wake, and a fail-closed
 *      audit record of the denial (§27, §31: agent cannot exceed permissions).
 *   2. CREDENTIAL LAW — with `AI_API_KEY` unset, a fully authorized launch
 *      returns the typed BLOCKED_NO_CREDENTIAL outcome, attempts NOTHING (no
 *      lease acquired), and writes the audit row intent naming the missing
 *      environment variable (never its value) — never a fake success.
 *   3. VALIDATION — the Zod strict request contract rejects malformed requests.
 *   4. SUBSTRATE VALIDATION — an unknown execution / an unregistered worker
 *      is denied against the mission + registry ports, audited, without wake.
 *   5. LAUNCHED PATH — with credentials present and an injected executor, the
 *      launch drives the full governed host cycle (WAKE → EXECUTE → PERSIST →
 *      VERIFY → SLEEP) over in-memory ports and audits the attempt.
 *   6. §27 static invariants — the shipped server function carries the auth
 *      middleware, the canonical gate, the Zod validator, the credential gate
 *      and the fail-closed audit write (source-level pin, no network/DB).
 *
 * No live AI keys: the credential path is exercised through the injected
 * executor seam only (the live gateway executor stays EXTERNAL REVIEW PENDING).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveAiCredentialGate,
  WORKER_LAUNCH_AUDIT_ACTION,
  workerLaunchRequestSchema,
  type WorkerLaunchDeps,
} from "@/lib/workforce/worker-launch.functions";
import { executeWorkerMissionLaunch } from "@/lib/workforce/worker-launch-runtime.server";
import type { WriteAuditEntry } from "@/lib/server/write-audit";
import { requirePlatformSuperAdmin } from "@/lib/security-role-gate";
import { createInMemoryMissionExecutionStore } from "@/lib/missions/mission-execution-store";
import type { MissionLeasePort, MissionRecordPort } from "@/lib/missions/mission-execution-store";
import type { MissionActorContext } from "@/lib/missions/mission-authorization";
import type { MissionExecutionConfig } from "@/lib/missions/mission-execution";
import type { WorkerDefinition } from "@/lib/workforce/worker-definition";
import {
  buildWorkerMissionActor,
  validateWorkerRegistration,
  type WorkerDelegationGrantState,
} from "@/lib/workforce/worker-registry";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FAMILY_SRC = join(ROOT, "frontend/src/lib/workforce/worker-launch.functions.ts");
const CONTRACT_SRC = join(ROOT, "frontend/src/lib/workforce/worker-launch-contract.ts");
const RUNTIME_SRC = join(
  ROOT,
  "frontend/src/lib/workforce/worker-launch-runtime.server.ts",
);
const ROUTE_SRC = join(ROOT, "frontend/src/routes/_authenticated/super-admin/worker-missions.tsx");

/* ─────────────────────────────────────────────────────────────
 * Fixtures (worker registry + mission execution, in-memory only)
 * ────────────────────────────────────────────────────────────*/

const TENANT = "tenant-launch-alpha";
const T0 = "2026-10-03T12:00:00.000Z";
const MISSION_ID = "MISSION-V1-003-LAUNCH";
const VERSION = "1.0";
const ACTION = "record-observation";
const EXECUTION_ID = "exec-launch-1";
const WORKER_ID = "worker-launch-1";

const CONFIG: MissionExecutionConfig = {
  leaseTtlMs: 30_000,
  heartbeatIntervalMs: 10_000,
  maxAttempts: 3,
  retryBackoffBaseMs: 1_000,
  retryBackoffMaxMs: 60_000,
};

function missionOwner(): MissionActorContext {
  return {
    actorId: "mission-owner-1",
    tenantId: TENANT,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_owner",
  };
}

function missionOperator(): MissionActorContext {
  return {
    actorId: "mission-operator-1",
    tenantId: TENANT,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_operator",
  };
}

async function seededStore(): Promise<MissionLeasePort & MissionRecordPort> {
  const store = createInMemoryMissionExecutionStore({ config: CONFIG });
  const seeded = await store.recordIntent({
    actor: missionOwner(),
    intent: {
      tenantId: TENANT,
      missionId: MISSION_ID,
      version: VERSION,
      purpose: "worker-launch-surface-probe",
      authorityRef: "CONTROL-PLANE-06",
      contextRef: "context-launch-1",
      ownerRef: "MISSIONS.md",
      nonScope: ["deploy"],
      authorizedActions: [ACTION],
      expiresAt: null,
    },
    now: T0,
  });
  if (!seeded.ok) throw new Error(`fixture intent rejected: ${seeded.reason}`);
  const assigned = await store.assignExecution({
    actor: missionOperator(),
    assignment: {
      tenantId: TENANT,
      missionId: MISSION_ID,
      version: VERSION,
      executionId: EXECUTION_ID,
      idempotencyKey: "idem-launch-00000001",
      action: ACTION,
      realityRef: "cg_entity:33333333-3333-4333-8333-333333333333",
      now: T0,
    },
  });
  if (!assigned.ok) throw new Error(`fixture assignment rejected: ${assigned.reason}`);
  return store;
}

/** A governed AI worker definition with an active mission-execution delegation grant. */
function governedWorker(): { definition: WorkerDefinition; grants: WorkerDelegationGrantState[] } {
  const registered = validateWorkerRegistration({
    tenantId: TENANT,
    definitionId: WORKER_ID,
    identityRef: "11111111-1111-4111-8111-111111111111",
    classification: "ai",
    capabilities: [{ capabilityId: `mission:execute:${MISSION_ID}`, description: "execute claim" }],
    maxRiskClass: "medium",
    resourceScopes: ["mission"],
    createdBy: "registrar-1",
    traceId: "trace-launch-1",
    correlationId: "correlation-launch-1",
  });
  if (!registered.ok) throw new Error(`fixture worker rejected: ${registered.errors.join("; ")}`);
  return {
    definition: registered.definition,
    grants: [
      {
        grantId: "grant-launch-1",
        definitionId: WORKER_ID,
        delegationRef: "delegation-launch-1",
        delegatedCapabilities: [`mission:execute:${MISSION_ID}`],
        maxGrantedRiskClass: "medium",
        state: "active",
      },
    ],
  };
}

/** Registry port backed by the REAL authority resolution (buildWorkerMissionActor). */
function registryPort(worker: ReturnType<typeof governedWorker>) {
  const quarantines: unknown[] = [];
  return {
    quarantines,
    resolveWorkerAuthority: async (input: {
      tenantId: string;
      definitionId: string;
      missionId: string;
    }) => {
      if (input.definitionId !== worker.definition.id) {
        return { ok: false as const, reason: `worker_not_registered:${input.definitionId}` };
      }
      return buildWorkerMissionActor({
        definition: worker.definition,
        grants: worker.grants,
        tenantId: input.tenantId,
        missionId: input.missionId,
      });
    },
    quarantineWorker: async (input: unknown) => {
      quarantines.push(input);
    },
  };
}

function launchDeps(overrides?: {
  env?: Record<string, string | undefined>;
  executor?: WorkerLaunchDeps["executor"];
}): Promise<WorkerLaunchDeps & { audits: WriteAuditEntry[]; readonly leaseAttempts: number }> {
  return (async () => {
    const audits: WriteAuditEntry[] = [];
    let leaseAttempts = 0;
    const store = await seededStore();
    // Lease-attempt counting wrapper: proves "nothing was attempted" claims.
    const missions: WorkerLaunchDeps["missions"] = {
      ...store,
      acquireLease: async (input) => {
        leaseAttempts += 1;
        return store.acquireLease(input);
      },
    };
    return {
      registry: registryPort(governedWorker()) as unknown as WorkerLaunchDeps["registry"],
      missions,
      audit: async (entry) => {
        audits.push(entry);
      },
      readEnv: (name) => overrides?.env?.[name],
      now: () => T0,
      newRuntimeInstanceId: () => "runtime-launch-test-1",
      executor: overrides?.executor,
      audits,
      get leaseAttempts() {
        return leaseAttempts;
      },
    };
  })();
}

function gateRpcClient(roleGranted: boolean): Parameters<typeof requirePlatformSuperAdmin>[0] {
  return {
    rpc: async () => ({ data: roleGranted, error: null }),
  } as unknown as Parameters<typeof requirePlatformSuperAdmin>[0];
}

const VALID_REQUEST = {
  tenantId: TENANT,
  workerId: WORKER_ID,
  executionId: EXECUTION_ID,
};

async function launch(
  deps: WorkerLaunchDeps,
  overrides?: Partial<{ role: boolean; data: unknown; claims: { exp?: number; email?: string } }>,
) {
  const claims = overrides?.claims ?? {
    exp: Math.floor(Date.now() / 1000) + 600,
    email: "admin@coregrid.test",
  };
  return executeWorkerMissionLaunch(
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
 * 1. GATING — non-platform-super callers are denied, never launched
 * ────────────────────────────────────────────────────────────*/

describe("worker launch gating (§27 authorize before anything)", () => {
  it("denies a non-platform-super caller through the real gate, with no launch and an audited denial", async () => {
    const deps = await launchDeps();
    const outcome = await launch(deps, { role: false });

    expect(outcome.outcome).toBe("denied");
    if (outcome.outcome !== "denied") return;
    expect(outcome.code).toBe("gate_denied");
    expect(outcome.reason).toContain("platform super admin");

    // The real gate's canonical deny reason — the caller never got past it.
    expect(outcome.reason).toBe("Forbidden: platform super admin role required");

    // Nothing was attempted: no execution read, no lease, no wake.
    expect(deps.leaseAttempts).toBe(0);

    // The denial attempt IS audited (§27.6), attributed to the caller.
    expect(deps.audits).toHaveLength(1);
    const entry = deps.audits[0];
    expect(entry.action).toBe(WORKER_LAUNCH_AUDIT_ACTION);
    expect(entry.gate).toBe("requirePlatformSuperAdmin");
    expect(entry.outcome).toBe("failed");
    expect(entry.actorId).toBe("platform-admin-1");
    expect(entry.tenantId).toBe(TENANT);
    expect(entry.recordId).toBe(EXECUTION_ID);
    expect(entry.details).toMatchObject({ launch_outcome_code: "gate_denied" });
  });

  it("denies an expired session before the role is ever consulted (§31 expired access fails)", async () => {
    const deps = await launchDeps();
    const outcome = await launch(deps, {
      role: true,
      claims: { exp: Math.floor(Date.now() / 1000) - 600, email: "admin@coregrid.test" },
    });
    expect(outcome.outcome).toBe("denied");
    if (outcome.outcome !== "denied") return;
    expect(outcome.code).toBe("gate_denied");
    expect(deps.audits[0].outcome).toBe("failed");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. CREDENTIAL LAW — typed BLOCKED_NO_CREDENTIAL, never fake success
 * ────────────────────────────────────────────────────────────*/

describe("credential gate (F-13 T8 / BLK-2 fail-closed law)", () => {
  it("returns the typed BLOCKED_NO_CREDENTIAL outcome when AI_API_KEY is unset, attempts nothing, and audits the denial", async () => {
    const deps = await launchDeps({ env: { AI_API_KEY: undefined } });
    const outcome = await launch(deps);

    expect(outcome.outcome).toBe("blocked_no_credential");
    if (outcome.outcome !== "blocked_no_credential") return;
    expect(outcome.code).toBe("BLOCKED_NO_CREDENTIAL");
    expect(outcome.attempted).toBe(false);
    expect(outcome.missingEnvironment).toEqual(["AI_API_KEY"]);
    expect(outcome.reason).toContain("no provider contact was made");
    expect(outcome.reason).toContain("EXTERNAL REVIEW PENDING");

    // No lease was acquired: the worker was never woken.
    expect(deps.leaseAttempts).toBe(0);

    // The audit row intent: names the missing env var, never a value.
    expect(deps.audits).toHaveLength(1);
    const entry = deps.audits[0];
    expect(entry.action).toBe(WORKER_LAUNCH_AUDIT_ACTION);
    expect(entry.gate).toBe("requirePlatformSuperAdmin");
    expect(entry.outcome).toBe("failed");
    expect(entry.table).toBe("cg_execution_record");
    expect(entry.recordId).toBe(EXECUTION_ID);
    expect(entry.details).toMatchObject({
      blocked_code: "BLOCKED_NO_CREDENTIAL",
      missing_environment: ["AI_API_KEY"],
      launch_attempted: false,
    });
    // §29/§30: no secret material in the audit intent.
    expect(JSON.stringify(entry)).not.toMatch(/sk-|Bearer\s/i);
  });

  it("treats a blank AI_API_KEY as absent (whitespace is not a credential)", () => {
    expect(resolveAiCredentialGate(() => undefined)).toEqual({
      present: false,
      missing: ["AI_API_KEY"],
    });
    expect(resolveAiCredentialGate(() => "   ")).toEqual({
      present: false,
      missing: ["AI_API_KEY"],
    });
    expect(resolveAiCredentialGate(() => "sentinel-key")).toEqual({ present: true });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. VALIDATION — malformed requests are rejected
 * ────────────────────────────────────────────────────────────*/

describe("request validation (§26 Zod strict contract)", () => {
  it("accepts the valid request shape", () => {
    expect(workerLaunchRequestSchema.safeParse(VALID_REQUEST).success).toBe(true);
  });

  it("rejects missing fields", () => {
    expect(workerLaunchRequestSchema.safeParse({}).success).toBe(false);
    expect(workerLaunchRequestSchema.safeParse({ tenantId: TENANT }).success).toBe(false);
    expect(
      workerLaunchRequestSchema.safeParse({ tenantId: TENANT, workerId: WORKER_ID }).success,
    ).toBe(false);
  });

  it("rejects unknown fields (strict contract, no client smuggle)", () => {
    expect(
      workerLaunchRequestSchema.safeParse({ ...VALID_REQUEST, grantId: "grant-1" }).success,
    ).toBe(false);
  });

  it("rejects empty, oversized and non-string fields", () => {
    expect(workerLaunchRequestSchema.safeParse({ ...VALID_REQUEST, tenantId: "" }).success).toBe(
      false,
    );
    expect(
      workerLaunchRequestSchema.safeParse({ ...VALID_REQUEST, workerId: "x".repeat(200) }).success,
    ).toBe(false);
    expect(workerLaunchRequestSchema.safeParse({ ...VALID_REQUEST, executionId: 42 }).success).toBe(
      false,
    );
    expect(workerLaunchRequestSchema.safeParse(null).success).toBe(false);
  });

  it("audits and denies a malformed request reaching the core (defense in depth)", async () => {
    const deps = await launchDeps();
    const outcome = await launch(deps, { data: { tenantId: TENANT } });
    expect(outcome.outcome).toBe("denied");
    if (outcome.outcome !== "denied") return;
    expect(outcome.code).toBe("invalid_request");
    expect(deps.audits).toHaveLength(1);
    expect(deps.audits[0].details).toMatchObject({ launch_outcome_code: "invalid_request" });
    expect(deps.leaseAttempts).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. SUBSTRATE VALIDATION — unknown execution / unknown worker
 * ────────────────────────────────────────────────────────────*/

describe("substrate validation (mission + registry, before any wake)", () => {
  it("denies when the claimed execution does not exist in the tenant scope", async () => {
    const deps = await launchDeps();
    const outcome = await launch(deps, {
      data: { tenantId: TENANT, workerId: WORKER_ID, executionId: "exec-ghost" },
    });
    expect(outcome.outcome).toBe("denied");
    if (outcome.outcome !== "denied") return;
    expect(outcome.code).toBe("execution_not_found");
    expect(deps.leaseAttempts).toBe(0);
    expect(deps.audits[0].details).toMatchObject({ launch_outcome_code: "execution_not_found" });
  });

  it("denies a cross-tenant request with the same not-found signal (no existence oracle, §31)", async () => {
    const deps = await launchDeps();
    const outcome = await launch(deps, {
      data: { tenantId: "tenant-other", workerId: WORKER_ID, executionId: EXECUTION_ID },
    });
    expect(outcome.outcome).toBe("denied");
    if (outcome.outcome !== "denied") return;
    // The tenant-scoped execution read is the first substrate gate: another
    // tenant's executions are simply not visible (no existence oracle).
    expect(outcome.code).toBe("execution_not_found");
    expect(deps.leaseAttempts).toBe(0);
    expect(deps.audits[0].details).toMatchObject({
      launch_outcome_code: "execution_not_found",
    });
  });

  it("denies when the worker is not registered in the registry (fail-closed authority)", async () => {
    const deps = await launchDeps();
    const outcome = await launch(deps, {
      data: { tenantId: TENANT, workerId: "worker-ghost", executionId: EXECUTION_ID },
    });
    expect(outcome.outcome).toBe("denied");
    if (outcome.outcome !== "denied") return;
    expect(outcome.code).toBe("worker_not_launchable");
    expect(outcome.reason).toContain("worker_not_registered:worker-ghost");
    expect(deps.leaseAttempts).toBe(0);
    expect(deps.audits[0].details).toMatchObject({
      launch_outcome_code: "worker_not_launchable",
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. LAUNCHED PATH — full governed host cycle over injected ports
 * ────────────────────────────────────────────────────────────*/

describe("launched path (host cycle over in-memory ports, injected executor)", () => {
  it("runs WAKE → EXECUTE → PERSIST → VERIFY → SLEEP and audits the attempt", async () => {
    const deps = await launchDeps({
      env: { AI_API_KEY: "sentinel-key" },
      executor: async (handle) => {
        const beat = await handle.heartbeat();
        if (!beat.ok) return { outcome: "failed" as const, reason: beat.reason };
        return {
          outcome: "succeeded" as const,
          evidence: [
            {
              evidenceKind: "ai_worker_output",
              sourceRef: "test:snapshot:1",
              lineage: [`mission:${MISSION_ID}`],
            },
          ],
        };
      },
    });
    const outcome = await launch(deps);

    expect(outcome.outcome).toBe("launched");
    if (outcome.outcome !== "launched") return;
    expect(outcome.attempted).toBe(true);
    expect(outcome.host.wake).toEqual({ ok: true });
    expect(outcome.host.execute.outcome).toBe("evidenced");
    expect(outcome.host.persist.evidenceCount).toBe(1);
    expect(outcome.host.phases.map((phase) => phase.phase)).toEqual([
      "WAKE",
      "EXECUTE",
      "PERSIST",
      "VERIFY",
      "SLEEP",
    ]);

    expect(deps.leaseAttempts).toBe(1);
    expect(deps.audits).toHaveLength(1);
    const entry = deps.audits[0];
    expect(entry.outcome).toBe("succeeded");
    expect(entry.details).toMatchObject({
      launch_outcome_code: "launched",
      host_execute_outcome: "evidenced",
      evidence_count: 1,
    });
  });

  it("the default executor wires the mission work through the centralized AI gateway (§20, source pin)", () => {
    const src = readFileSync(RUNTIME_SRC, "utf8");
    expect(src).toMatch(/buildAiGatewayExecutor/);
    expect(src).toMatch(/invokeAiGateway/);
    expect(src).toMatch(/purpose:\s*"workflow_assistance"/);
    // §19 AI privacy: the prompt carries mission identifiers only.
    expect(src).toMatch(/execution\.missionId/);
    expect(src).not.toMatch(/prompt.*school|prompt.*student/i);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. §27 static invariants — the shipped surface carries the chain
 * ────────────────────────────────────────────────────────────*/

describe("§27 server-function invariants — worker-launch.functions.ts", () => {
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
  });

  it("4 VALIDATE: the Zod strict validator is wired into the server function", () => {
    expect(src).toMatch(/\.validator\(\(input: unknown\) => workerLaunchRequestSchema\.parse\(input\)\)/);
    expect(contract).toMatch(/\.strict\(\)/);
  });

  it("5 EXECUTE: the substrate is the sanctioned registry + mission ports — no raw vendor calls in the core", () => {
    expect(runtime).toMatch(/createWorkerRegistryDb/);
    expect(runtime).toMatch(/createDbMissionLeasePort/);
    expect(runtime).toMatch(/runWorkerHost/);
    expect(runtime).not.toMatch(/from ["'](@supabase\/supabase-js|twilio|paystack)["']/);
    // Server modules stay OUT of the client graph: the functions module may
    // only reach the runtime inside handler bodies (dynamic import).
    expect(src).not.toMatch(/^import\s+(?!type\b).*worker-launch-runtime\.server/m);
    expect(src).toMatch(/import\(\s*["']\.\/worker-launch-runtime\.server["']\s*\)/);
  });

  it("6 AUDIT: every attempt writes a fail-closed audit record; no secrets logged", () => {
    expect(runtime).toMatch(/writeAuditRecord/);
    expect(contract).toMatch(/WORKER_LAUNCH_AUDIT_ACTION = "workforce\.launch_worker_mission"/);
    expect(runtime).not.toMatch(/console\.log/);
    // Credential names only — never values — in the typed outcome.
    expect(runtime).toMatch(/missing_environment/);
  });
});

describe("route wiring invariants (the UI consumes the real server function)", () => {
  it("the hardcoded worker-missions console page is gone", () => {
    expect(existsSync(ROUTE_SRC)).toBe(false);
  });
});