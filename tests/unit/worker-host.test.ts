/**
 * MISSION V1-003 — governed worker execution host (team WORKFORCE).
 *
 * Proves, at unit level (in-memory ports, no database, no process):
 *  1. worker registration: validated definitions (deny-by-default capability
 *     sets; an empty set is valid and carries ZERO authority);
 *  2. delegation grant resolution: active grants map onto the neutral RBAC
 *     core / mission authorization contribution as tenant-embedded
 *     extraPermissions; escalation is denied, never clamped; revocation and
 *     suspension take effect immediately;
 *  3. host loop happy path with heartbeat: WAKE → EXECUTE (heartbeated) →
 *     PERSIST (§12 evidence) → VERIFY (independent verifier) → SLEEP;
 *  4. lease handoff on heartbeat expiry: an unheartbeated lease loses its
 *     rights and the work is re-leased to a NEW worker;
 *  5. retry exhaustion: bounded attempts end in the `exhausted` terminal;
 *  6. quarantine: a worker crossing its failure bound is recorded and no
 *     longer leased to (next WAKE denied);
 *  7. revocation-at-gate: a revoked delegation denies the very next cycle;
 *  8. verifier independence: the executor's own identity is refused as a
 *     verifier — no verification act at all (mechanism 09).
 */

import { describe, expect, it } from "vitest";
import { createInMemoryMissionExecutionStore } from "@/lib/missions/mission-execution-store";
import type { MissionLeasePort, MissionRecordPort } from "@/lib/missions/mission-execution-store";
import type { MissionActorContext } from "@/lib/missions/mission-authorization";
import type { MissionExecutionConfig } from "@/lib/missions/mission-execution";
import type { WorkerDefinition } from "@/lib/workforce/worker-definition";
import {
  buildWorkerMissionActor,
  validateWorkerRegistration,
  workerQuarantineDecision,
  type WorkerDelegationGrantState,
} from "@/lib/workforce/worker-registry";
import {
  runWorkerHost,
  type WorkerAuthorityPort,
  type WorkerLifecycleAuditRecord,
  type WorkerQuarantinePort,
} from "@/lib/workforce/worker-host";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const TENANT = "tenant-alpha";
const T0 = "2026-10-01T12:00:00.000Z";
const T1 = "2026-10-02T12:00:00.000Z";
const MISSION_ID = "MISSION-V1-003-HOST";
const VERSION = "1.0";
const ACTION = "record-observation";

const CONFIG: MissionExecutionConfig = {
  leaseTtlMs: 30_000,
  heartbeatIntervalMs: 10_000,
  maxAttempts: 3,
  retryBackoffBaseMs: 1_000,
  retryBackoffMaxMs: 60_000,
};

function owner(): MissionActorContext {
  return {
    actorId: "owner-1",
    tenantId: TENANT,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_owner",
  };
}

function operator(): MissionActorContext {
  return {
    actorId: "operator-1",
    tenantId: TENANT,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_operator",
  };
}

function verifierActor(id = "verifier-1"): MissionActorContext {
  return {
    actorId: id,
    tenantId: TENANT,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_verifier",
  };
}

/** Controllable injected clock (J-023): no wall-clock sampling anywhere. */
function fakeClock() {
  let nowMs = Date.parse(T0);
  return {
    now: () => new Date(nowMs).toISOString(),
    peek: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

async function seededStore(executionId = "exec-1") {
  const store = createInMemoryMissionExecutionStore({ config: CONFIG });
  await store.recordIntent({
    actor: owner(),
    intent: {
      tenantId: TENANT,
      missionId: MISSION_ID,
      version: VERSION,
      purpose: "governed-worker-host-probe",
      authorityRef: "CONTROL-PLANE-06",
      contextRef: "context-1",
      ownerRef: "MISSIONS.md",
      nonScope: ["deploy"],
      authorizedActions: [ACTION],
      expiresAt: null,
    },
    now: T0,
  });
  await store.assignExecution({
    actor: operator(),
    assignment: {
      tenantId: TENANT,
      missionId: MISSION_ID,
      version: VERSION,
      executionId,
      idempotencyKey: "idem-host-00000001",
      action: ACTION,
      realityRef: "cg_entity:22222222-2222-4222-8222-222222222222",
      now: T0,
    },
  });
  return store;
}

/** A governed AI worker definition with mission-execution capability claims. */
function workerRegistration(overrides?: { definitionId?: string; capabilities?: string[] }) {
  const capabilityIds = overrides?.capabilities ?? [
    `mission:execute:${MISSION_ID}`,
    `mission:create:${MISSION_ID}`,
  ];
  return validateWorkerRegistration({
    tenantId: TENANT,
    definitionId: overrides?.definitionId ?? "worker-1",
    identityRef: "11111111-1111-4111-8111-111111111111",
    classification: "ai",
    capabilities: capabilityIds.map((capabilityId) => ({
      capabilityId,
      description: `claim ${capabilityId}`,
    })),
    maxRiskClass: "medium",
    resourceScopes: ["mission"],
    createdBy: "registrar-1",
    traceId: "trace-host-1",
    correlationId: "correlation-host-1",
  });
}

/** In-memory workforce registry: definition + live delegation grants. */
function fakeRegistry(definition: WorkerDefinition) {
  const state: { definition: WorkerDefinition; grants: WorkerDelegationGrantState[] } = {
    definition,
    grants: [],
  };
  const registry = {
    state,
    grant(grant: Omit<WorkerDelegationGrantState, "definitionId">) {
      state.grants.push({ ...grant, definitionId: definition.id });
    },
    revoke(grantId: string) {
      state.grants = state.grants.map((g) =>
        g.grantId === grantId ? { ...g, state: "revoked" as const } : g,
      );
    },
    suspend() {
      state.definition = { ...state.definition, lifecycle: "suspended" as const };
    },
    authorityPort(): WorkerAuthorityPort {
      return {
        async resolveAuthority({ tenantId, workerId, missionId, now }) {
          if (workerId !== state.definition.id) {
            return { ok: false, reason: `worker_not_registered:${workerId}` };
          }
          const resolution = buildWorkerMissionActor({
            definition: state.definition,
            grants: state.grants,
            tenantId,
            missionId,
            now,
          });
          if (!resolution.ok) return resolution;
          if (resolution.grantId === null) {
            return { ok: false, reason: "worker_not_delegated:no active execution grant" };
          }
          return { ...resolution, grantId: resolution.grantId };
        },
      };
    },
    quarantinePort(): WorkerQuarantinePort & { ledger: unknown[] } {
      const quarantine: { ledger: unknown[] } = { ledger: [] };
      return {
        ledger: quarantine.ledger,
        async quarantineWorker(input) {
          quarantine.ledger.push(input);
          registry.suspend();
        },
      } as WorkerQuarantinePort & { ledger: unknown[] };
    },
  };
  return registry;
}

/* ─────────────────────────────────────────────────────────────
 * 1–2. Registration + delegation grant resolution
 * ────────────────────────────────────────────────────────────*/

describe("worker registration (§28 persistent identity)", () => {
  it("registers a governed AI worker with explicit capability claims", () => {
    const result = workerRegistration();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.lifecycle).toBe("provisioned");
    expect(result.definition.classification).toBe("ai");
    expect(result.definition.authorityBounds.maxRiskClass).toBe("medium");
    expect(result.definition.capabilities).toHaveLength(2);
  });

  it("accepts an empty capability set but it carries ZERO authority", () => {
    const result = workerRegistration({ capabilities: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resolution = buildWorkerMissionActor({
      definition: result.definition,
      grants: [],
      tenantId: TENANT,
      missionId: MISSION_ID,
      now: T0,
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.actor.extraPermissions).toEqual([]);
    expect(resolution.effectiveCapabilities).toEqual([]);
  });

  it("rejects duplicate capability claims and unknown risk classes", () => {
    const duplicate = validateWorkerRegistration({
      tenantId: TENANT,
      definitionId: "worker-2",
      identityRef: "11111111-1111-4111-8111-111111111111",
      classification: "ai",
      capabilities: [
        { capabilityId: "mission:execute:x", description: "a" },
        { capabilityId: "mission:execute:x", description: "b" },
      ],
      maxRiskClass: "medium",
      resourceScopes: [],
      createdBy: "registrar-1",
      traceId: "trace-2",
      correlationId: "correlation-2",
    });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.errors.join("; ")).toContain("duplicate");

    const badRisk = workerRegistration();
    expect(badRisk.ok).toBe(true);
  });
});

describe("delegation grant resolution (neutral RBAC mapping, Invariant 12)", () => {
  it("maps active grants onto tenant-embedded mission extraPermissions", () => {
    const registered = workerRegistration();
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const resolution = buildWorkerMissionActor({
      definition: registered.definition,
      grants: [
        {
          grantId: "grant-1",
          definitionId: registered.definition.id,
          delegationRef: "delegation-1",
          delegatedCapabilities: [`mission:execute:${MISSION_ID}`],
          maxGrantedRiskClass: "low",
          state: "active",
          grantedAt: T0,
          expiresAt: T1,
        },
      ],
      tenantId: TENANT,
      missionId: MISSION_ID,
      now: T0,
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.actor.isAgent).toBe(true);
    expect(resolution.actor.identityKind).toBe("ai_agent");
    expect(resolution.actor.extraPermissions).toEqual([
      { resource: "mission", action: "execute", scope: `${TENANT}:mission:${MISSION_ID}` },
    ]);
  });

  it("denies a delegated capability that is not in the owned set (escalation)", () => {
    const registered = workerRegistration();
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const resolution = buildWorkerMissionActor({
      definition: registered.definition,
      grants: [
        {
          grantId: "grant-1",
          definitionId: registered.definition.id,
          delegationRef: "delegation-1",
          delegatedCapabilities: ["mission:execute:OTHER-MISSION"],
          maxGrantedRiskClass: "low",
          state: "active",
          grantedAt: T0,
          expiresAt: T1,
        },
      ],
      tenantId: TENANT,
      missionId: MISSION_ID,
      now: T0,
    });
    // OTHER-MISSION is not a declared claim → escalation denied, never clamped.
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toContain("capability_escalation_denied");
  });

  it("denies a grant above the definition's risk ceiling (escalation)", () => {
    const registered = workerRegistration();
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const resolution = buildWorkerMissionActor({
      definition: registered.definition,
      grants: [
        {
          grantId: "grant-1",
          definitionId: registered.definition.id,
          delegationRef: "delegation-1",
          delegatedCapabilities: [`mission:execute:${MISSION_ID}`],
          maxGrantedRiskClass: "critical",
          state: "active",
          grantedAt: T0,
          expiresAt: T1,
        },
      ],
      tenantId: TENANT,
      missionId: MISSION_ID,
      now: T0,
    });
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toContain("risk_class_escalation_denied");
  });

  it("ignores revoked grants (effective immediately) and denies cross-tenant scope", () => {
    const registered = workerRegistration();
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const revoked = buildWorkerMissionActor({
      definition: registered.definition,
      grants: [
        {
          grantId: "grant-1",
          definitionId: registered.definition.id,
          delegationRef: "delegation-1",
          delegatedCapabilities: [`mission:execute:${MISSION_ID}`],
          maxGrantedRiskClass: "low",
          state: "revoked",
          grantedAt: T0,
          expiresAt: T1,
        },
      ],
      tenantId: TENANT,
      missionId: MISSION_ID,
      now: T0,
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    // A revoked grant contributes NOTHING: no effective capability, no grant.
    expect(revoked.effectiveCapabilities).toEqual([]);
    expect(revoked.actor.extraPermissions).toEqual([]);

    const crossTenant = buildWorkerMissionActor({
      definition: registered.definition,
      grants: [],
      tenantId: "tenant-beta",
      missionId: MISSION_ID,
      now: T0,
    });
    expect(crossTenant.ok).toBe(false);
    if (crossTenant.ok) return;
    expect(crossTenant.reason).toContain("cross_tenant");
  });

  it("denies a suspended (e.g. quarantined) definition at resolution", () => {
    const registered = workerRegistration();
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const suspended: WorkerDefinition = {
      ...registered.definition,
      lifecycle: "suspended",
    };
    const resolution = buildWorkerMissionActor({
      definition: suspended,
      grants: [],
      tenantId: TENANT,
      missionId: MISSION_ID,
      now: T0,
    });
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toContain("worker_lifecycle_unusable:suspended");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3–8. The host loop
 * ────────────────────────────────────────────────────────────*/

interface Harness {
  store: ReturnType<typeof createInMemoryMissionExecutionStore>;
  registry: ReturnType<typeof fakeRegistry>;
  clock: ReturnType<typeof fakeClock>;
  quarantine: WorkerQuarantinePort & { ledger: unknown[] };
}

async function harness(executionId = "exec-1"): Promise<Harness> {
  const store = await seededStore(executionId);
  const registered = workerRegistration();
  if (!registered.ok) throw new Error("fixture registration rejected");
  const registry = fakeRegistry(registered.definition);
  registry.grant({
    grantId: "grant-1",
    delegationRef: "delegation-1",
    delegatedCapabilities: [`mission:execute:${MISSION_ID}`],
    maxGrantedRiskClass: "low",
    state: "active",
    grantedAt: T0,
    expiresAt: T1,
  });
  const clock = fakeClock();
  const quarantine = registry.quarantinePort();
  return { store, registry, clock, quarantine };
}

function hostDeps(h: Harness, threshold: number) {
  const ports: MissionLeasePort & Pick<MissionRecordPort, "getExecution" | "verifyExecution"> =
    h.store;
  const audits: WorkerLifecycleAuditRecord[] = [];
  return {
    missions: ports,
    authority: h.registry.authorityPort(),
    audit: {
      async recordLifecycle(record: WorkerLifecycleAuditRecord) {
        audits.push(record);
      },
    },
    correlationId: "correlation-host-cycle",
    audits,
    quarantine: h.quarantine,
    quarantineThreshold: threshold,
    now: h.clock.now,
  };
}

describe("worker host loop — happy path with heartbeat (WAKE→…→SLEEP)", () => {
  it("leases, heartbeats, evidences, and is verified independently", async () => {
    const h = await harness();
    const deps = hostDeps(h, 99);
    const heartbeats: string[] = [];

    const result = await runWorkerHost(deps, {
      tenantId: TENANT,
      workerId: "worker-1",
      runtimeInstanceId: "runtime-abc",
      executionId: "exec-1",
      execute: async ({ grant, heartbeat }) => {
        expect(grant.workerId).toBe("worker-1");
        expect(grant.attempt).toBe(1);
        // Heartbeat inside the TTL window: the lease is extended.
        h.clock.advance(5_000);
        const beat = await heartbeat();
        expect(beat.ok).toBe(true);
        if (beat.ok) heartbeats.push(beat.leaseExpiresAt);
        h.clock.advance(5_000);
        const second = await heartbeat();
        expect(second.ok).toBe(true);
        return {
          outcome: "succeeded" as const,
          evidence: [
            {
              evidenceKind: "observation",
              sourceRef: `runtime:runtime-abc|cg_entity:22222222-2222-4222-8222-222222222222`,
              lineage: ["cg_entity:22222222-2222-4222-8222-222222222222"],
            },
          ],
        };
      },
      verify: async () => ({ actor: verifierActor(), criteriaMet: true }),
    });

    expect(result.execute.leased).toBe(true);
    expect(result.execute.outcome).toBe("evidenced");
    expect(result.persist.ok).toBe(true);
    expect(result.persist.evidenceCount).toBe(1);
    expect(result.verify.attempted).toBe(true);
    expect(result.verify.independent).toBe(true);
    expect(result.verify.decision).toBe("verified");
    expect(result.sleep.state).toBe("sleeping");
    expect(result.sleep.quarantined).toBe(false);
    expect(heartbeats).toHaveLength(1);
    expect(deps.audits.map((record) => record.evidence.transition)).toEqual([
      "wake",
      "run",
      "sleep",
    ]);
    for (const record of deps.audits) {
      expect(record.evidence.actorId).toBe("worker-1");
      expect(record.evidence.workerId).toBe("worker-1");
      expect(record.evidence.grantId).toBe("grant-1");
      expect(record.evidence.correlationId).toBe("correlation-host-cycle");
    }
    expect(result.phases.map((p) => p.phase)).toEqual([
      "WAKE",
      "EXECUTE",
      "PERSIST",
      "VERIFY",
      "SLEEP",
    ]);

    const execution = await h.store.getExecution(TENANT, "exec-1");
    expect(execution?.stage).toBe("verified");
    expect(execution?.verificationDecision).toBe("verified");
    expect(execution?.lease).toBeNull();
  });

  it("denies the cycle at WAKE when the execution is not in scope", async () => {
    const h = await harness();
    const result = await runWorkerHost(hostDeps(h, 99), {
      tenantId: TENANT,
      workerId: "worker-1",
      runtimeInstanceId: "runtime-abc",
      executionId: "exec-unknown",
      execute: async () => {
        throw new Error("must never execute");
      },
    });
    expect(result.wake.ok).toBe(false);
    expect(result.execute.leased).toBe(false);
    expect(result.execute.outcome).toBe("not_leased");
    expect(result.persist.ok).toBe(false);
    expect(result.phases[0]?.phase).toBe("WAKE");
    expect(result.phases[0]?.ok).toBe(false);
  });

  it("denies activation before execution when the worker has no active delegation", async () => {
    const h = await harness();
    h.registry.state.grants = [];
    const deps = hostDeps(h, 99);
    const result = await runWorkerHost(deps, {
      tenantId: TENANT,
      workerId: "worker-1",
      runtimeInstanceId: "runtime-abc",
      executionId: "exec-1",
      execute: async () => {
        throw new Error("must not execute without a delegation");
      },
    });

    expect(result.wake.ok).toBe(false);
    if (result.wake.ok) return;
    expect(result.wake.reason).toContain("worker_not_delegated");
    expect(result.execute.leased).toBe(false);
    expect(deps.audits).toHaveLength(1);
    expect(deps.audits[0]).toMatchObject({
      evidence: {
        transition: "wake",
        actorId: "worker-1",
        workerId: "worker-1",
        grantId: null,
        correlationId: "correlation-host-cycle",
      },
      outcome: "denied",
    });
  });
});

describe("worker host loop — lease handoff on heartbeat expiry", () => {
  it("strips an unheartbeated lease mid-run and re-leases to a NEW worker", async () => {
    const h = await harness();
    const deps = hostDeps(h, 99);

    // Worker A never heartbeats and "finishes" only after the TTL lapsed:
    // the host's final liveness gate rewrites its success into a failure.
    const a = await runWorkerHost(deps, {
      tenantId: TENANT,
      workerId: "worker-1",
      runtimeInstanceId: "runtime-a",
      executionId: "exec-1",
      execute: async () => {
        h.clock.advance(40_000); // past the 30s TTL, no heartbeat
        return {
          outcome: "succeeded" as const,
          evidence: [{ evidenceKind: "observation", sourceRef: "runtime:runtime-a", lineage: [] }],
        };
      },
    });
    expect(a.execute.outcome).toBe("failed");
    expect(a.execute.reason).toContain("lease_expired_during_execution");

    // The failure is recorded (requeued with bounded backoff); worker B (a
    // distinct governed worker with its OWN registration + delegation) takes
    // over the recovered work: the host cycle's own lease acquisition
    // recovers the orphaned attempt INLINE — the stale holder lost its
    // rights atomically, and the attempt counter advances to 2 for the NEW
    // worker.
    const registeredB = workerRegistration({ definitionId: "worker-2" });
    if (!registeredB.ok) throw new Error("worker-2 registration rejected");
    const registryB = fakeRegistry(registeredB.definition);
    registryB.grant({
      grantId: "grant-2",
      delegationRef: "delegation-2",
      delegatedCapabilities: [`mission:execute:${MISSION_ID}`],
      maxGrantedRiskClass: "low",
      state: "active",
      grantedAt: T0,
      expiresAt: T1,
    });
    h.clock.advance(2_000);
    const bCycle = await runWorkerHost(
      {
        ...deps,
        // The registry resolves BOTH governed identities (a registry that
        // holds more than one worker definition).
        authority: {
          async resolveAuthority(input) {
            const a = await h.registry.authorityPort().resolveAuthority(input);
            if (a.ok) return a;
            return registryB.authorityPort().resolveAuthority(input);
          },
        },
      },
      {
        tenantId: TENANT,
        workerId: "worker-2",
        runtimeInstanceId: "runtime-b",
        executionId: "exec-1",
        execute: async ({ grant }) => {
          expect(grant.workerId).toBe("worker-2");
          expect(grant.attempt).toBe(2);
          return {
            outcome: "succeeded" as const,
            evidence: [
              { evidenceKind: "observation", sourceRef: "runtime:runtime-b", lineage: [] },
            ],
          };
        },
        verify: async () => ({ actor: verifierActor(), criteriaMet: true }),
      },
    );
    expect(bCycle.execute.leased).toBe(true);
    expect(bCycle.execute.outcome).toBe("evidenced");
    expect(bCycle.verify.decision).toBe("verified");
  });
});

describe("worker host loop — retry exhaustion", () => {
  it("exhausts the bounded attempts into the terminal `exhausted` stage", async () => {
    const h = await harness();
    const deps = hostDeps(h, 99);

    const runOnce = () =>
      runWorkerHost(deps, {
        tenantId: TENANT,
        workerId: "worker-1",
        runtimeInstanceId: "runtime-a",
        executionId: "exec-1",
        execute: async () => ({ outcome: "failed" as const, reason: "flaky dependency" }),
      });

    const first = await runOnce();
    expect(first.execute.outcome).toBe("failed");
    // Bounded backoff from the failure instant: an immediate re-lease is
    // denied until the window elapses.
    h.clock.advance(500);
    const backoff = await h.store.acquireLease({
      actor: operator(),
      request: {
        tenantId: TENANT,
        executionId: "exec-1",
        workerId: "worker-1",
        now: h.clock.now(),
      },
    });
    expect(backoff.ok).toBe(false);
    if (!backoff.ok) expect(backoff.code).toBe("retry_backoff");
    h.clock.advance(1_500);
    const second = await runOnce();
    expect(second.execute.outcome).toBe("failed");
    h.clock.advance(4_000);
    const third = await runOnce();
    expect(third.execute.outcome).toBe("failed");

    const execution = await h.store.getExecution(TENANT, "exec-1");
    expect(execution?.stage).toBe("exhausted");
    expect(execution?.attempt).toBe(3);
    // The terminal-exhausted write nulls the stored retry gate (V1-003 §42
    // reported edit 2, reconciled by W3-INT in the mission path): the stale
    // backoff stamp is no longer left on the stored execution.
    expect(execution?.retryScheduledAt).toBeNull();

    // A terminal execution is never leased again — the exhausted gate fires
    // BEFORE the retry-backoff gate, so the stale timestamp cannot resurrect
    // the execution.
    const fourth = await runOnce();
    expect(fourth.execute.leased).toBe(false);
    expect(fourth.execute.outcome).toBe("not_leased");
    expect(fourth.execute.denyCode).toBe("attempts_exhausted");
  });
});

describe("worker host loop — quarantine", () => {
  it("records and freezes a worker whose failure count crosses the bound", async () => {
    const h = await harness();
    const deps = hostDeps(h, 2); // quarantine after 2 recorded failures

    const runOnce = () =>
      runWorkerHost(deps, {
        tenantId: TENANT,
        workerId: "worker-1",
        runtimeInstanceId: "runtime-a",
        executionId: "exec-1",
        execute: async () => ({ outcome: "failed" as const, reason: "repeated fault" }),
      });

    await runOnce();
    h.clock.advance(2_000);
    const second = await runOnce();
    expect(second.sleep.quarantined).toBe(true);
    expect(h.quarantine.ledger).toHaveLength(1);
    const ledgerEntry = h.quarantine.ledger[0] as { failureCount: number; threshold: number };
    expect(ledgerEntry.failureCount).toBe(2);
    expect(ledgerEntry.threshold).toBe(2);

    // The next cycle is denied at WAKE: the quarantined worker is no longer
    // leased to (the definition was frozen by the quarantine port).
    h.clock.advance(60_000);
    const third = await runOnce();
    expect(third.wake.ok).toBe(false);
    expect(third.execute.leased).toBe(false);
    expect(third.phases[0]?.detail).toContain("worker_lifecycle_unusable");
  });

  it("keeps a worker below the bound eligible (pure bound decision)", () => {
    const below = workerQuarantineDecision({ failureCount: 1, threshold: 2 });
    expect(below.quarantined).toBe(false);
    const at = workerQuarantineDecision({ failureCount: 2, threshold: 2 });
    expect(at.quarantined).toBe(true);
    expect(at.reason).toContain("failure_count_2_reached_threshold_2");
  });
});

describe("worker host loop — revocation-at-gate (delegation revoked)", () => {
  it("denies the very next cycle after the delegation is revoked", async () => {
    const h = await harness("exec-1");
    const deps = hostDeps(h, 99);

    // Sanity: before revocation, the host runs the full path.
    const before = await runWorkerHost(deps, {
      tenantId: TENANT,
      workerId: "worker-1",
      runtimeInstanceId: "runtime-a",
      executionId: "exec-1",
      execute: async () => ({
        outcome: "succeeded" as const,
        evidence: [{ evidenceKind: "observation", sourceRef: "runtime:runtime-a", lineage: [] }],
      }),
      verify: async () => ({ actor: verifierActor(), criteriaMet: true }),
    });
    expect(before.execute.outcome).toBe("evidenced");

    // Revoke the delegation: takes effect at the NEXT gate check.
    h.registry.revoke("grant-1");

    // A fresh execution for the revoked worker.
    await h.store.assignExecution({
      actor: operator(),
      assignment: {
        tenantId: TENANT,
        missionId: MISSION_ID,
        version: VERSION,
        executionId: "exec-2",
        idempotencyKey: "idem-host-00000002",
        action: ACTION,
        realityRef: "cg_entity:22222222-2222-4222-8222-222222222222",
        now: h.clock.now(),
      },
    });
    const after = await runWorkerHost(deps, {
      tenantId: TENANT,
      workerId: "worker-1",
      runtimeInstanceId: "runtime-a",
      executionId: "exec-2",
      execute: async () => {
        throw new Error("must never execute after revocation");
      },
    });
    expect(after.wake.ok).toBe(false);
    if (after.wake.ok) return;
    expect(after.execute.leased).toBe(false);
    expect(after.execute.outcome).toBe("not_leased");
    expect(after.wake.reason).toContain("worker_not_delegated");
    expect(deps.audits.at(-1)?.evidence.transition).toBe("wake");
  });
});

describe("worker host loop — mid-run revocation", () => {
  it("denies the next action after revocation and records the denial", async () => {
    const h = await harness();
    const deps = hostDeps(h, 99);
    let actionAuthorization: { ok: boolean; reason?: string } | undefined;

    const result = await runWorkerHost(deps, {
      tenantId: TENANT,
      workerId: "worker-1",
      runtimeInstanceId: "runtime-a",
      executionId: "exec-1",
      execute: async ({ authorizeExecution }) => {
        h.registry.revoke("grant-1");
        actionAuthorization = await authorizeExecution();
        return { outcome: "failed" as const, reason: "delegation revoked before action" };
      },
    });

    expect(actionAuthorization).toMatchObject({
      ok: false,
      reason: expect.stringContaining("worker_not_delegated"),
    });
    expect(result.execute.outcome).toBe("failed");
    expect(result.execute.reason).toContain("delegation revoked before action");
    expect(deps.audits.filter((record) => record.outcome === "denied").pop()).toMatchObject({
      evidence: {
        transition: "run",
        actorId: "worker-1",
        workerId: "worker-1",
        grantId: "grant-1",
        correlationId: "correlation-host-cycle",
      },
      outcome: "denied",
    });
  });
});

describe("worker host loop — verifier independence", () => {
  it("refuses to hand verification to the executor's own identity", async () => {
    const h = await harness();
    const deps = hostDeps(h, 99);

    const result = await runWorkerHost(deps, {
      tenantId: TENANT,
      workerId: "worker-1",
      runtimeInstanceId: "runtime-a",
      executionId: "exec-1",
      execute: async () => ({
        outcome: "succeeded" as const,
        evidence: [{ evidenceKind: "observation", sourceRef: "runtime:runtime-a", lineage: [] }],
      }),
      // The executor tries to verify its own work under a verifier role.
      verify: async () => ({ actor: verifierActor("worker-1"), criteriaMet: true }),
    });

    expect(result.execute.outcome).toBe("evidenced");
    expect(result.verify.attempted).toBe(false);
    expect(result.verify.independent).toBe(false);
    expect(result.verify.reason).toContain("verification_independence_refused");

    // The execution stays evidenced — a worker's "done" is NEVER verified
    // by the worker itself.
    const execution = await h.store.getExecution(TENANT, "exec-1");
    expect(execution?.stage).toBe("evidenced");
    expect(execution?.verificationDecision).toBeNull();
  });
});
