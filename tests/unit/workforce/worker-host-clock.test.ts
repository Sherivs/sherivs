/**
 * R5 WORKFORCE-CLOCK — governed clock adoption tests for the worker host.
 *
 * The coordinator follow-up "workforce clock adoption with test alignment"
 * (previously attempted and REVERTED because it changed denial PROVENANCE)
 * is adopted here WITHOUT changing default behavior. `worker-host.ts` gains
 * an OPTIONAL `deps.clock` (W3-INT's driver seam): supplied, it supersedes
 * `now` as the cycle's single time authority and is threaded into the leased
 * driver as its per-phase `clock`; absent (the default, every existing
 * caller), the host stays byte-identical to the pre-adoption behavior.
 *
 * Proven, at unit level (in-memory ports, no database, no process):
 *  (a) DEFAULT byte-identity: with no `deps.clock`, the host's full output
 *      (cycle results + stored execution records) is byte-identical to the
 *      PRE-adoption host — pinned verbatim (fixture captured byte-exact
 *      from the unmodified `worker-host.ts`). The fixture
 *      also pins the load-bearing deterministic single-instant provenance:
 *      the driver stamps acquisition/completion/failure/retry with ONE wake
 *      instant even when the clock moves mid-run.
 *  (b) Injection isolation: an adopted clock changes ONLY the mission-path
 *      act instants (the driver's per-phase outcome stamps — the intended
 *      timestamps); every decision, phase and stored field is unchanged, and
 *      where the act instant coincides with per-act sampling the adopted
 *      output is fully identical to the default.
 *  (c) Liveness-denial provenance under adoption is internally consistent:
 *      a completion act that lands past the lease TTL is DENIED by the store
 *      (fail-closed, zero writes) and the host reports that truthfully
 *      (`completion denied … — nothing persisted`), never claiming a
 *      persistence that did not happen; a failure act inside the TTL records
 *      its retry gate at the ACT instant, which really gates the adopted
 *      timeline.
 *  (d) Fail-closed: unparseable adopted-clock output denies at the lease
 *      gate (`invalid_input`) with ZERO state change and no executor run.
 *  (e) Supersession: a supplied `clock` is the single time authority —
 *      heartbeats extend the lease on the clock's timeline even when a stale
 *      `now` is also supplied.
 */

import { describe, expect, it } from "vitest";
import { createInMemoryMissionExecutionStore } from "@/lib/missions/mission-execution-store";
import type { MissionLeasePort, MissionRecordPort } from "@/lib/missions/mission-execution-store";
import type { MissionActorContext, MissionExecutionState } from "@/lib/missions/mission-execution";
import type { WorkerDefinition } from "@/lib/workforce/worker-definition";
import {
  buildWorkerMissionActor,
  validateWorkerRegistration,
  type WorkerDelegationGrantState,
} from "@/lib/workforce/worker-registry";
import {
  runWorkerHost,
  type WorkerAuthorityPort,
  type WorkerHostDeps,
} from "@/lib/workforce/worker-host";

const PRE_ADOPTION_FIXTURE_JSON = `{
  "happyPathCycle": {
    "workerId": "worker-1",
    "runtimeInstanceId": "runtime-abc",
    "executionId": "exec-1",
    "phases": [
      {
        "phase": "WAKE",
        "ok": true,
        "detail": "governed worker worker-1 (runtime runtime-abc) authorized for mission MISSION-V1-003-HOST"
      },
      {
        "phase": "EXECUTE",
        "ok": true,
        "detail": "evidence recorded; pending independent verification"
      },
      {
        "phase": "PERSIST",
        "ok": true,
        "detail": "1 evidence record(s) persisted with §12 provenance"
      },
      {
        "phase": "VERIFY",
        "ok": true,
        "detail": "verified: independent_criteria_and_evidence"
      },
      {
        "phase": "SLEEP",
        "ok": true,
        "detail": "cycle complete — host sleeps (library-form, no resident process)"
      }
    ],
    "wake": {
      "ok": true
    },
    "execute": {
      "leased": true,
      "stage": "evidenced",
      "lease": {
        "executionId": "exec-1",
        "leaseId": "exec-1:lease:1",
        "workerId": "worker-1",
        "attempt": 1,
        "acquiredAt": "2026-10-01T12:00:00.000Z",
        "leaseExpiresAt": "2026-10-01T12:00:30.000Z",
        "heartbeatIntervalMs": 10000
      },
      "outcome": "evidenced",
      "denyCode": null,
      "reason": "evidence recorded; pending independent verification"
    },
    "persist": {
      "ok": true,
      "evidenceCount": 1,
      "reason": "1 evidence record(s) persisted with §12 provenance"
    },
    "verify": {
      "attempted": true,
      "independent": true,
      "decision": "verified",
      "reason": "independent_criteria_and_evidence"
    },
    "sleep": {
      "state": "sleeping",
      "quarantined": false,
      "quarantine": {
        "quarantined": false,
        "failureCount": 0,
        "threshold": 99,
        "reason": null
      }
    }
  },
  "happyPathExecution": {
    "executionId": "exec-1",
    "tenantId": "tenant-alpha",
    "missionId": "MISSION-V1-003-HOST",
    "missionVersion": "1.0",
    "assignedBy": "operator-1",
    "lastWorkerId": "worker-1",
    "action": "record-observation",
    "idempotencyKey": "idem-host-00000001",
    "realityRef": "cg_entity:22222222-2222-4222-8222-222222222222",
    "stage": "verified",
    "attempt": 1,
    "failureCount": 0,
    "retryScheduledAt": null,
    "lease": null,
    "evidenceIds": [
      "exec-1:evidence:observation"
    ],
    "verificationDecision": "verified",
    "denyReason": null,
    "assignedAt": "2026-10-01T12:00:00.000Z",
    "updatedAt": "2026-10-01T12:00:10.000Z"
  },
  "failureCycle": {
    "workerId": "worker-1",
    "runtimeInstanceId": "runtime-abc",
    "executionId": "exec-1",
    "phases": [
      {
        "phase": "WAKE",
        "ok": true,
        "detail": "governed worker worker-1 (runtime runtime-abc) authorized for mission MISSION-V1-003-HOST"
      },
      {
        "phase": "EXECUTE",
        "ok": false,
        "detail": "flaky dependency"
      },
      {
        "phase": "PERSIST",
        "ok": true,
        "detail": "failure recorded with bounded-retry backoff: flaky dependency"
      },
      {
        "phase": "VERIFY",
        "ok": false,
        "detail": "skipped — verification requires evidenced work"
      },
      {
        "phase": "SLEEP",
        "ok": true,
        "detail": "cycle complete — host sleeps (library-form, no resident process)"
      }
    ],
    "wake": {
      "ok": true
    },
    "execute": {
      "leased": true,
      "stage": "requeued",
      "lease": {
        "executionId": "exec-1",
        "leaseId": "exec-1:lease:1",
        "workerId": "worker-1",
        "attempt": 1,
        "acquiredAt": "2026-10-01T12:00:00.000Z",
        "leaseExpiresAt": "2026-10-01T12:00:30.000Z",
        "heartbeatIntervalMs": 10000
      },
      "outcome": "failed",
      "denyCode": null,
      "reason": "flaky dependency"
    },
    "persist": {
      "ok": true,
      "evidenceCount": 0,
      "reason": "failure recorded with bounded-retry backoff: flaky dependency"
    },
    "verify": {
      "attempted": false,
      "independent": false,
      "decision": null,
      "reason": "no verification plan supplied — evidenced work awaits independent verification"
    },
    "sleep": {
      "state": "sleeping",
      "quarantined": false,
      "quarantine": {
        "quarantined": false,
        "failureCount": 1,
        "threshold": 99,
        "reason": null
      }
    }
  },
  "failureExecution": {
    "executionId": "exec-1",
    "tenantId": "tenant-alpha",
    "missionId": "MISSION-V1-003-HOST",
    "missionVersion": "1.0",
    "assignedBy": "operator-1",
    "lastWorkerId": "worker-1",
    "action": "record-observation",
    "idempotencyKey": "idem-host-00000001",
    "realityRef": "cg_entity:22222222-2222-4222-8222-222222222222",
    "stage": "requeued",
    "attempt": 1,
    "failureCount": 1,
    "retryScheduledAt": "2026-10-01T12:00:01.000Z",
    "lease": null,
    "evidenceIds": [],
    "verificationDecision": null,
    "denyReason": null,
    "assignedAt": "2026-10-01T12:00:00.000Z",
    "updatedAt": "2026-10-01T12:00:00.000Z"
  },
  "livenessDenialCycle": {
    "workerId": "worker-1",
    "runtimeInstanceId": "runtime-abc",
    "executionId": "exec-1",
    "phases": [
      {
        "phase": "WAKE",
        "ok": true,
        "detail": "governed worker worker-1 (runtime runtime-abc) authorized for mission MISSION-V1-003-HOST"
      },
      {
        "phase": "EXECUTE",
        "ok": false,
        "detail": "lease_expired_during_execution: lease expired at 2026-10-01T12:00:30.000Z — recover and re-lease"
      },
      {
        "phase": "PERSIST",
        "ok": true,
        "detail": "failure recorded with bounded-retry backoff: lease_expired_during_execution: lease expired at 2026-10-01T12:00:30.000Z — recover and re-lease"
      },
      {
        "phase": "VERIFY",
        "ok": false,
        "detail": "skipped — verification requires evidenced work"
      },
      {
        "phase": "SLEEP",
        "ok": true,
        "detail": "cycle complete — host sleeps (library-form, no resident process)"
      }
    ],
    "wake": {
      "ok": true
    },
    "execute": {
      "leased": true,
      "stage": "requeued",
      "lease": {
        "executionId": "exec-1",
        "leaseId": "exec-1:lease:1",
        "workerId": "worker-1",
        "attempt": 1,
        "acquiredAt": "2026-10-01T12:00:00.000Z",
        "leaseExpiresAt": "2026-10-01T12:00:30.000Z",
        "heartbeatIntervalMs": 10000
      },
      "outcome": "failed",
      "denyCode": null,
      "reason": "lease_expired_during_execution: lease expired at 2026-10-01T12:00:30.000Z — recover and re-lease"
    },
    "persist": {
      "ok": true,
      "evidenceCount": 0,
      "reason": "failure recorded with bounded-retry backoff: lease_expired_during_execution: lease expired at 2026-10-01T12:00:30.000Z — recover and re-lease"
    },
    "verify": {
      "attempted": false,
      "independent": false,
      "decision": null,
      "reason": "no verification plan supplied — evidenced work awaits independent verification"
    },
    "sleep": {
      "state": "sleeping",
      "quarantined": false,
      "quarantine": {
        "quarantined": false,
        "failureCount": 1,
        "threshold": 99,
        "reason": null
      }
    }
  },
  "livenessDenialExecution": {
    "executionId": "exec-1",
    "tenantId": "tenant-alpha",
    "missionId": "MISSION-V1-003-HOST",
    "missionVersion": "1.0",
    "assignedBy": "operator-1",
    "lastWorkerId": "worker-1",
    "action": "record-observation",
    "idempotencyKey": "idem-host-00000001",
    "realityRef": "cg_entity:22222222-2222-4222-8222-222222222222",
    "stage": "requeued",
    "attempt": 1,
    "failureCount": 1,
    "retryScheduledAt": "2026-10-01T12:00:01.000Z",
    "lease": null,
    "evidenceIds": [],
    "verificationDecision": null,
    "denyReason": null,
    "assignedAt": "2026-10-01T12:00:00.000Z",
    "updatedAt": "2026-10-01T12:00:00.000Z"
  }
}`;

/* ─────────────────────────────────────────────────────────────
 * Fixtures (self-contained; mirrors tests/unit/worker-host.test.ts
 * unmodified — ownership law: that file is another team's)
 * ────────────────────────────────────────────────────────────*/

const TENANT = "tenant-alpha";
const T0 = "2026-10-01T12:00:00.000Z";
const MISSION_ID = "MISSION-V1-003-HOST";
const VERSION = "1.0";
const ACTION = "record-observation";

const CONFIG = {
  leaseTtlMs: 30_000,
  heartbeatIntervalMs: 10_000,
  maxAttempts: 3,
  retryBackoffBaseMs: 1_000,
  retryBackoffMaxMs: 60_000,
} as const;

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
function workerRegistration() {
  return validateWorkerRegistration({
    tenantId: TENANT,
    definitionId: "worker-1",
    identityRef: "11111111-1111-4111-8111-111111111111",
    classification: "ai",
    capabilities: [
      { capabilityId: `mission:execute:${MISSION_ID}`, description: "claim execute" },
      { capabilityId: `mission:create:${MISSION_ID}`, description: "claim create" },
    ],
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
    authorityPort(): WorkerAuthorityPort {
      return {
        async resolveAuthority({ tenantId, workerId, missionId }) {
          if (workerId !== state.definition.id) {
            return { ok: false, reason: `worker_not_registered:${workerId}` };
          }
          return buildWorkerMissionActor({
            definition: state.definition,
            grants: state.grants,
            tenantId,
            missionId,
          });
        },
      };
    },
  };
  return registry;
}

interface Harness {
  store: ReturnType<typeof createInMemoryMissionExecutionStore>;
  clock: ReturnType<typeof fakeClock>;
  deps: WorkerHostDeps;
}

/**
 * `adopt: true` supplies the harness's own fake clock as the host's governed
 * `deps.clock` (same function instance as `deps.now` — one time authority).
 * `frozenNow` replaces `deps.now` (used to prove clock supersession).
 */
async function harness(opts?: { adopt?: boolean; frozenNow?: () => string }): Promise<Harness> {
  const store = await seededStore();
  const registered = workerRegistration();
  if (!registered.ok) throw new Error("fixture registration rejected");
  const registry = fakeRegistry(registered.definition);
  registry.grant({
    grantId: "grant-1",
    delegationRef: "delegation-1",
    delegatedCapabilities: [`mission:execute:${MISSION_ID}`],
    maxGrantedRiskClass: "low",
    state: "active",
  });
  const clock = fakeClock();
  const ports: MissionLeasePort & Pick<MissionRecordPort, "getExecution" | "verifyExecution"> =
    store;
  const deps: WorkerHostDeps = {
    missions: ports,
    authority: registry.authorityPort(),
    quarantineThreshold: 99,
    now: opts?.frozenNow ?? clock.now,
    ...(opts?.adopt ? { clock: clock.now } : {}),
  };
  return { store, clock, deps };
}

const baseInput = {
  tenantId: TENANT,
  workerId: "worker-1",
  runtimeInstanceId: "runtime-abc",
  executionId: "exec-1",
} as const;

/* ─────────────────────────────────────────────────────────────
 * (a) Default-clock byte-identity against the pre-adoption fixture
 * ────────────────────────────────────────────────────────────*/

describe("worker host governed clock — default path byte-identity", () => {
  it("produces byte-identical output to the pre-adoption host (pinned fixture)", async () => {
    const dump: Record<string, unknown> = {};

    // Scenario A — happy path with heartbeat, evidence, independent verify.
    {
      const h = await harness();
      const result = await runWorkerHost(h.deps, {
        ...baseInput,
        execute: async ({ heartbeat }) => {
          h.clock.advance(5_000);
          await heartbeat();
          h.clock.advance(5_000);
          return {
            outcome: "succeeded" as const,
            evidence: [
              {
                evidenceKind: "observation",
                sourceRef: "runtime:runtime-abc|cg_entity:22222222-2222-4222-8222-222222222222",
                lineage: ["cg_entity:22222222-2222-4222-8222-222222222222"],
              },
            ],
          };
        },
        verify: async () => ({ actor: verifierActor(), criteriaMet: true }),
      });
      dump.happyPathCycle = result;
      dump.happyPathExecution = await h.store.getExecution(TENANT, "exec-1");
    }

    // Scenario B — failure provenance: bounded-retry stamp under the default.
    {
      const h = await harness();
      const result = await runWorkerHost(h.deps, {
        ...baseInput,
        execute: async () => ({ outcome: "failed" as const, reason: "flaky dependency" }),
      });
      dump.failureCycle = result;
      dump.failureExecution = await h.store.getExecution(TENANT, "exec-1");
    }

    // Scenario C — liveness denial: success rewritten after the TTL lapses.
    {
      const h = await harness();
      const result = await runWorkerHost(h.deps, {
        ...baseInput,
        execute: async () => {
          h.clock.advance(40_000);
          return {
            outcome: "succeeded" as const,
            evidence: [
              { evidenceKind: "observation", sourceRef: "runtime:runtime-abc", lineage: [] },
            ],
          };
        },
      });
      dump.livenessDenialCycle = result;
      dump.livenessDenialExecution = await h.store.getExecution(TENANT, "exec-1");
    }

    // BYTE-identity: the serialization must equal the fixture captured from
    // the pre-adoption worker-host.ts, byte for byte (key order included).
    expect(JSON.stringify(dump, null, 2)).toBe(PRE_ADOPTION_FIXTURE_JSON);

    // The pinned provenance, stated explicitly: the single wake instant
    // stamps the failure record even when the clock moved 40s mid-run.
    const liveness = dump.livenessDenialExecution as MissionExecutionState;
    expect(liveness.retryScheduledAt).toBe("2026-10-01T12:00:01.000Z");
  });
});

/* ─────────────────────────────────────────────────────────────
 * (b) Injection changes ONLY the intended timestamps
 * ────────────────────────────────────────────────────────────*/

describe("worker host governed clock — injected clock isolation", () => {
  it("leaves the whole cycle identical when act instants coincide with per-act sampling", async () => {
    const run = async (adopt?: boolean) => {
      const h = await harness({ adopt });
      const result = await runWorkerHost(h.deps, {
        ...baseInput,
        execute: async ({ heartbeat }) => {
          h.clock.advance(5_000);
          await heartbeat();
          h.clock.advance(5_000);
          return {
            outcome: "succeeded" as const,
            evidence: [
              {
                evidenceKind: "observation",
                sourceRef: "runtime:runtime-abc|cg_entity:22222222-2222-4222-8222-222222222222",
                lineage: ["cg_entity:22222222-2222-4222-8222-222222222222"],
              },
            ],
          };
        },
        verify: async () => ({ actor: verifierActor(), criteriaMet: true }),
      });
      return { result, execution: await h.store.getExecution(TENANT, "exec-1") };
    };

    const def = await run(false);
    const adopted = await run(true);

    expect(adopted.result).toEqual(def.result);
    expect(adopted.execution).toEqual(def.execution);
    expect(adopted.execution?.stage).toBe("verified");
  });

  it("moves ONLY the driver's outcome stamps to the act instants (failure path)", async () => {
    const run = async (adopt?: boolean) => {
      const h = await harness({ adopt });
      const result = await runWorkerHost(h.deps, {
        ...baseInput,
        execute: async () => {
          h.clock.advance(7_000); // the failure ACT happens at T0+7s
          return { outcome: "failed" as const, reason: "flaky dependency" };
        },
      });
      return { result, execution: await h.store.getExecution(TENANT, "exec-1") };
    };

    const def = await run(false);
    const adopted = await run(true);

    // The cycle decision surface is untouched by adoption.
    expect(adopted.result).toEqual(def.result);

    // The ONLY stored differences are the driver's per-phase outcome stamps:
    // the retry gate and the record's update instant now bind to the ACT
    // instant (T0+7s) instead of the frozen wake instant (T0).
    const defExec = def.execution!;
    const adoptedExec = adopted.execution!;
    expect(defExec.retryScheduledAt).toBe("2026-10-01T12:00:01.000Z");
    expect(adoptedExec.retryScheduledAt).toBe("2026-10-01T12:00:08.000Z");
    expect(defExec.updatedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(adoptedExec.updatedAt).toBe("2026-10-01T12:00:07.000Z");
    const { retryScheduledAt: _d1, updatedAt: _d2, ...defRest } = defExec;
    const { retryScheduledAt: _a1, updatedAt: _a2, ...adoptedRest } = adoptedExec;
    expect(adoptedRest).toEqual(defRest);
  });
});

/* ─────────────────────────────────────────────────────────────
 * (c) Liveness-denial provenance under adoption is consistent
 * ────────────────────────────────────────────────────────────*/

describe("worker host governed clock — liveness denial provenance", () => {
  it("denies the past-TTL completion act and reports it truthfully (fail-closed, zero writes)", async () => {
    const h = await harness({ adopt: true });
    const result = await runWorkerHost(h.deps, {
      ...baseInput,
      execute: async () => {
        h.clock.advance(40_000); // past the 30s TTL, no heartbeat
        return {
          outcome: "succeeded" as const,
          evidence: [
            { evidenceKind: "observation", sourceRef: "runtime:runtime-abc", lineage: [] },
          ],
        };
      },
    });

    // The host's fail-closed liveness gate rewrites the success; the
    // completion ACT at T0+40s is then denied `lease_expired` by the store —
    // the adopted per-phase instant binds the act to its real instant.
    expect(result.execute.leased).toBe(true);
    expect(result.execute.outcome).toBe("failed");
    expect(result.execute.denyCode).toBe("lease_expired");
    expect(result.execute.reason).toContain("lease expired at 2026-10-01T12:00:30.000Z");

    // Internally consistent provenance: the record was NOT stamped against
    // the expired lease — it keeps the expired-lease truth (stage `leased`,
    // no failure, no retry gate), and the denial instant (T0+40s) is after
    // the expiry the gate observed (T0+30s).
    const execution = await h.store.getExecution(TENANT, "exec-1");
    expect(execution?.stage).toBe("leased");
    expect(execution?.lease?.leaseExpiresAt).toBe("2026-10-01T12:00:30.000Z");
    expect(execution?.failureCount).toBe(0);
    expect(execution?.retryScheduledAt).toBeNull();
    expect(execution?.updatedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(Date.parse("2026-10-01T12:00:40.000Z")).toBeGreaterThan(
      Date.parse(execution!.lease!.leaseExpiresAt),
    );

    // The host does NOT claim a persistence that did not happen.
    expect(result.persist.ok).toBe(false);
    expect(result.persist.reason).toContain("completion denied (lease_expired)");
    expect(result.persist.reason).toContain("nothing persisted");

    // The next acquire recovers the orphaned lease inline and advances the
    // attempt — the stale holder's rights ended atomically at expiry.
    h.clock.advance(500);
    const reLease = await h.store.acquireLease({
      actor: operator(),
      request: {
        tenantId: TENANT,
        executionId: "exec-1",
        workerId: "worker-1",
        now: h.clock.now(),
      },
    });
    expect(reLease.ok).toBe(true);
    if (reLease.ok) expect(reLease.value.attempt).toBe(2);
  });

  it("records the bounded-retry gate when the failure act lands inside the TTL", async () => {
    // A failure act at T0+20s (inside the 30s TTL) is completed normally,
    // with its stamps bound to the ACT instant on the adopted timeline.
    const h = await harness({ adopt: true });
    const result = await runWorkerHost(h.deps, {
      ...baseInput,
      execute: async () => {
        h.clock.advance(20_000);
        return { outcome: "failed" as const, reason: "flaky dependency" };
      },
    });
    expect(result.execute.outcome).toBe("failed");
    expect(result.execute.denyCode).toBeNull();
    expect(result.execute.reason).toBe("flaky dependency");
    expect(result.persist.ok).toBe(true);
    expect(result.persist.reason).toContain(
      "failure recorded with bounded-retry backoff: flaky dependency",
    );
    // The failure record binds to the ACT instant (T0+20s), and its retry
    // gate is internally consistent: act instant + backoff base.
    const execution = await h.store.getExecution(TENANT, "exec-1");
    expect(execution?.stage).toBe("requeued");
    expect(execution?.failureCount).toBe(1);
    expect(execution?.updatedAt).toBe("2026-10-01T12:00:20.000Z");
    expect(execution?.retryScheduledAt).toBe("2026-10-01T12:00:21.000Z");

    // The scheduled gate REALLY gates on the adopted timeline: an immediate
    // re-lease inside the window is denied; past the window it is granted
    // (attempt 2).
    h.clock.advance(500); // T0+20.5s — inside the window (gate at T0+21s)
    const tooEarly = await h.store.acquireLease({
      actor: operator(),
      request: {
        tenantId: TENANT,
        executionId: "exec-1",
        workerId: "worker-1",
        now: h.clock.now(),
      },
    });
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.code).toBe("retry_backoff");

    h.clock.advance(1_000); // T0+21.5s — past the gate
    const reLease = await h.store.acquireLease({
      actor: operator(),
      request: {
        tenantId: TENANT,
        executionId: "exec-1",
        workerId: "worker-1",
        now: h.clock.now(),
      },
    });
    expect(reLease.ok).toBe(true);
    if (reLease.ok) expect(reLease.value.attempt).toBe(2);
  });
});

/* ─────────────────────────────────────────────────────────────
 * (d) Fail-closed: unparseable adopted clock denies with zero writes
 * ────────────────────────────────────────────────────────────*/

describe("worker host governed clock — fail-closed adoption", () => {
  it("denies the cycle at the lease gate when the adopted clock emits an unparseable instant", async () => {
    const h = await harness({ adopt: true });
    const before = await h.store.getExecution(TENANT, "exec-1");
    const corruptedClock = () => "not-a-timestamp";
    const result = await runWorkerHost(
      { ...h.deps, clock: corruptedClock },
      {
        ...baseInput,
        execute: async () => {
          throw new Error("must never execute under an unparseable clock");
        },
      },
    );

    expect(result.execute.leased).toBe(false);
    expect(result.execute.outcome).toBe("not_leased");
    expect(result.execute.denyCode).toBe("invalid_input");
    // ZERO state change: the execution record is untouched.
    const after = await h.store.getExecution(TENANT, "exec-1");
    expect(after).toEqual(before);
  });
});

/* ─────────────────────────────────────────────────────────────
 * (e) Supersession: `clock` is the single time authority
 * ────────────────────────────────────────────────────────────*/

describe("worker host governed clock — supersession of `now`", () => {
  it("drives liveness gating on the adopted clock even when a stale `now` is supplied", async () => {
    // `now` is frozen at T0 (a stale authority); the governed clock advances.
    const h = await harness({ adopt: true, frozenNow: () => T0 });
    const heartbeats: string[] = [];
    const result = await runWorkerHost(h.deps, {
      ...baseInput,
      execute: async ({ heartbeat }) => {
        h.clock.advance(5_000);
        const beat = await heartbeat();
        expect(beat.ok).toBe(true);
        if (beat.ok) heartbeats.push(beat.leaseExpiresAt);
        h.clock.advance(5_000);
        return {
          outcome: "succeeded" as const,
          evidence: [
            { evidenceKind: "observation", sourceRef: "runtime:runtime-abc", lineage: [] },
          ],
        };
      },
      verify: async () => ({ actor: verifierActor(), criteriaMet: true }),
    });

    expect(result.execute.outcome).toBe("evidenced");
    // The heartbeat extension binds to the ADOPTED clock (T0+5s + 30s TTL),
    // not the frozen `now` (which would give T0+30s).
    expect(heartbeats).toEqual(["2026-10-01T12:00:35.000Z"]);
    // The verification act instant also comes from the adopted clock.
    const execution = await h.store.getExecution(TENANT, "exec-1");
    expect(execution?.updatedAt).toBe("2026-10-01T12:00:10.000Z");
  });
});
