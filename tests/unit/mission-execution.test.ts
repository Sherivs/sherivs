/**
 * MISSION V1-004 — general mission execution path (pure store).
 *
 * Proves, at unit level (pure in-memory contract — no database, no I/O):
 *  1. happy path: intent → assignment → lease → heartbeat → execute →
 *     evidence → independent verify, with §12 provenance on every record;
 *  2. duplicate intent + duplicate assignment are IDEMPOTENT replays with no
 *     new external effect (AGENTS §10);
 *  3. lease expiry recovery: an unheartbeated lease expires, is requeued and
 *     re-leased to another worker; the stale holder loses its rights;
 *  4. retry semantics: failures requeue with bounded exponential backoff and
 *     exhaust after the configured attempt budget;
 *  5. verifier separation: a worker's "done" reaches `evidenced`, never
 *     `verified`; self-verification is rejected and recorded as FAILED;
 *  6. cross-tenant access fails closed with the same signal as unknown
 *     (AGENTS §31: Tenant A cannot access Tenant B);
 *  7. authorization resolves through the NEUTRAL RBAC core: ungranted roles,
 *     suspended lifecycles and undelegated agents are denied (Invariant 12);
 *  8. inputs crossing the trust boundary are Zod-validated (fail closed);
 *  9. the driver seam (V1-003's execution callback) leases, executes and
 *     reports through the mission path.
 */

import { describe, expect, it } from "vitest";
import {
  createInMemoryMissionExecutionStore,
  runLeasedMissionExecution,
} from "@/lib/missions/mission-execution-store";
import { DEFAULT_MISSION_EXECUTION_CONFIG, nextRetryAt } from "@/lib/missions/mission-execution";
import type { MissionActorContext } from "@/lib/missions/mission-authorization";
import type { MissionIntentInput } from "@/lib/missions/mission-execution";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const TENANT_A = "tenant-alpha";
const TENANT_B = "tenant-beta";
const T0 = "2026-10-01T12:00:00.000Z";

const FAST_CONFIG = {
  ...DEFAULT_MISSION_EXECUTION_CONFIG,
  leaseTtlMs: 1_000,
  heartbeatIntervalMs: 400,
  retryBackoffBaseMs: 1_000,
  retryBackoffMaxMs: 8_000,
  maxAttempts: 3,
};

function owner(): MissionActorContext {
  return {
    actorId: "owner-1",
    tenantId: TENANT_A,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_owner",
  };
}

function operator(tenantId: string = TENANT_A): MissionActorContext {
  return {
    actorId: "operator-1",
    tenantId,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_operator",
  };
}

/** Workers are agent identities: authority flows ONLY via explicit delegation. */
function worker(tenantId: string = TENANT_A, actorId = "worker-1"): MissionActorContext {
  return {
    actorId,
    tenantId,
    identityKind: "ai_agent",
    lifecycle: "active",
    role: "mission_operator",
    isAgent: true,
    extraPermissions: [{ resource: "mission", action: "execute", scope: null }],
  };
}

/** A delegated agent holding BOTH execute and verify grants (for independence tests). */
function agentVerifier(tenantId: string = TENANT_A, actorId = "worker-1"): MissionActorContext {
  return {
    actorId,
    tenantId,
    identityKind: "ai_agent",
    lifecycle: "active",
    role: "mission_operator",
    isAgent: true,
    extraPermissions: [
      { resource: "mission", action: "execute", scope: null },
      { resource: "mission", action: "verify", scope: null },
    ],
  };
}

function verifier(tenantId: string = TENANT_A, actorId = "verifier-1"): MissionActorContext {
  return {
    actorId,
    tenantId,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_verifier",
  };
}

function intentInput(overrides?: Partial<MissionIntentInput>): MissionIntentInput {
  return {
    tenantId: TENANT_A,
    missionId: "MISSION-V1-004-GENERAL",
    version: "1.0",
    purpose: "general-mission-execution-probe",
    authorityRef: "CONTROL-PLANE-06",
    contextRef: "context-1",
    ownerRef: "MISSIONS.md",
    nonScope: ["deploy"],
    authorizedActions: ["record-observation", "compile-report"],
    expiresAt: null,
    ...overrides,
  };
}

function at(msLater: number): string {
  return new Date(Date.parse(T0) + msLater).toISOString();
}

function expectOk<T>(result: { ok: boolean; value?: T; code?: string; reason?: string }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.reason}`);
  return result.value as T;
}

function expectDeny(result: { ok: boolean; code?: string; reason?: string }, code: string): string {
  if (result.ok) throw new Error(`expected denial ${code}, got ok`);
  if (result.code !== code) {
    throw new Error(`expected denial ${code}, got ${result.code}: ${result.reason}`);
  }
  return result.reason ?? "";
}

async function seedAssignedExecution() {
  const store = createInMemoryMissionExecutionStore({ config: FAST_CONFIG });
  await store.recordIntent({ actor: owner(), intent: intentInput(), now: T0 });
  const assigned = expectOk(
    await store.assignExecution({
      actor: operator(),
      assignment: {
        tenantId: TENANT_A,
        missionId: "MISSION-V1-004-GENERAL",
        version: "1.0",
        executionId: "exec-1",
        idempotencyKey: "idem-key-0000001",
        action: "record-observation",
        realityRef: "cg_entity:11111111-1111-4111-8111-111111111111",
        now: T0,
      },
    }),
  );
  return { store, assigned };
}

/* ─────────────────────────────────────────────────────────────
 * 1. Happy path
 * ────────────────────────────────────────────────────────────*/

describe("mission execution happy path (V1-004)", () => {
  it("runs intent → assignment → lease → execute → evidence → verify", async () => {
    const { store } = await seedAssignedExecution();

    const grant = expectOk(
      await store.acquireLease({
        actor: worker(),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: T0 },
      }),
    );
    expect(grant.attempt).toBe(1);
    expect(grant.leaseId).toBe("exec-1:lease:1");

    const heartbeated = expectOk(
      await store.heartbeatLease({
        actor: worker(),
        request: {
          tenantId: TENANT_A,
          executionId: "exec-1",
          leaseId: grant.leaseId,
          workerId: "worker-1",
          now: at(400),
        },
      }),
    );
    expect(Date.parse(heartbeated.leaseExpiresAt)).toBeGreaterThan(Date.parse(at(400)));

    const completed = expectOk(
      await store.completeExecution({
        actor: worker(),
        request: {
          tenantId: TENANT_A,
          executionId: "exec-1",
          leaseId: grant.leaseId,
          workerId: "worker-1",
          outcome: {
            outcome: "succeeded",
            evidence: [
              {
                evidenceKind: "observation",
                sourceRef: "cg_entity:1111",
                lineage: ["cg_entity:1111"],
              },
            ],
          },
          now: at(500),
        },
      }),
    );
    // A worker's done is NOT verification: the stage is `evidenced`.
    expect(completed.execution.stage).toBe("evidenced");
    expect(completed.execution.verificationDecision).toBeNull();
    expect(completed.execution.lease).toBeNull();
    // Provenance (§12): who / when / source on the evidence record.
    expect(completed.evidence[0].actorId).toBe("worker-1");
    expect(completed.evidence[0].recordedAt).toBe(at(500));
    expect(completed.evidence[0].provenance).toContain("worker:worker-1");
    expect(completed.evidence[0].provenance).toContain("execution:exec-1");
    expect(completed.evidence[0].provenance).toContain("source:cg_entity:1111");
    expect(completed.evidence[0].integrity).toHaveLength(64);

    const verified = expectOk(
      await store.verifyExecution(verifier(), {
        tenantId: TENANT_A,
        executionId: "exec-1",
        criteriaMet: true,
        now: at(600),
      }),
    );
    expect(verified.verification.decision).toBe("verified");
    expect(verified.execution.stage).toBe("verified");
    expect(verified.execution.verificationDecision).toBe("verified");
    expect(verified.replayed).toBe(false);

    // Verification is replay-protected: the recorded decision stands.
    const secondVerify = expectOk(
      await store.verifyExecution(verifier(), {
        tenantId: TENANT_A,
        executionId: "exec-1",
        criteriaMet: false,
        now: at(700),
      }),
    );
    expect(secondVerify.replayed).toBe(true);
    expect(secondVerify.verification.decision).toBe("verified");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Idempotency (duplicate intent / assignment)
 * ────────────────────────────────────────────────────────────*/

describe("mission execution idempotency (V1-004, AGENTS §10)", () => {
  it("replays a duplicate intent without creating a second declaration", async () => {
    const store = createInMemoryMissionExecutionStore({ config: FAST_CONFIG });
    const first = expectOk(
      await store.recordIntent({ actor: owner(), intent: intentInput(), now: T0 }),
    );
    const duplicate = expectOk(
      await store.recordIntent({ actor: owner(), intent: intentInput(), now: at(100) }),
    );
    expect(first.replayed).toBe(false);
    expect(duplicate.replayed).toBe(true);
    expect(duplicate.intent.missionId).toBe(first.intent.missionId);
  });

  it("replays a duplicate assignment (same idempotency key) with no new external effect", async () => {
    const { store } = await seedAssignedExecution();
    const replay = expectOk(
      await store.assignExecution({
        actor: operator(),
        assignment: {
          tenantId: TENANT_A,
          missionId: "MISSION-V1-004-GENERAL",
          version: "1.0",
          executionId: "exec-other",
          idempotencyKey: "idem-key-0000001",
          action: "record-observation",
          realityRef: "cg_entity:11111111-1111-4111-8111-111111111111",
          now: at(100),
        },
      }),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.execution.executionId).toBe("exec-1");
  });

  it("replays when the same execution id is assigned twice", async () => {
    const { store } = await seedAssignedExecution();
    const replay = expectOk(
      await store.assignExecution({
        actor: operator(),
        assignment: {
          tenantId: TENANT_A,
          missionId: "MISSION-V1-004-GENERAL",
          version: "1.0",
          executionId: "exec-1",
          idempotencyKey: "idem-key-0000002",
          action: "record-observation",
          realityRef: "cg_entity:11111111-1111-4111-8111-111111111111",
          now: at(100),
        },
      }),
    );
    expect(replay.replayed).toBe(true);
  });

  it("denies an action outside the mission's authorized actions (admission, fail-closed)", async () => {
    const store = createInMemoryMissionExecutionStore({ config: FAST_CONFIG });
    await store.recordIntent({ actor: owner(), intent: intentInput(), now: T0 });
    const denied = expectOk(
      await store.assignExecution({
        actor: operator(),
        assignment: {
          tenantId: TENANT_A,
          missionId: "MISSION-V1-004-GENERAL",
          version: "1.0",
          executionId: "exec-oos",
          idempotencyKey: "idem-key-0000003",
          action: "deploy",
          realityRef: "cg_entity:11111111-1111-4111-8111-111111111111",
          now: T0,
        },
      }),
    );
    expect(denied.execution.stage).toBe("denied");
    expect(denied.execution.denyReason).toBe("out_of_scope");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Lease expiry recovery (heartbeat semantics)
 * ────────────────────────────────────────────────────────────*/

describe("mission lease expiry recovery (V1-004)", () => {
  it("expires an unheartbeated lease, recovers it, and re-leases to a new worker", async () => {
    const { store } = await seedAssignedExecution();
    const firstGrant = expectOk(
      await store.acquireLease({
        actor: worker(),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: T0 },
      }),
    );

    // Past the TTL without a heartbeat: the stale holder cannot heartbeat.
    expectDeny(
      await store.heartbeatLease({
        actor: worker(),
        request: {
          tenantId: TENANT_A,
          executionId: "exec-1",
          leaseId: firstGrant.leaseId,
          workerId: "worker-1",
          now: at(2_000),
        },
      }),
      "lease_expired",
    );

    const recovered = expectOk(
      await store.recoverOrphanedLeases({
        actor: operator(),
        request: { tenantId: TENANT_A, now: at(2_000) },
      }),
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0].executionId).toBe("exec-1");
    expect(recovered[0].expiredLeaseId).toBe(firstGrant.leaseId);
    expect(recovered[0].workerId).toBe("worker-1");

    const secondGrant = expectOk(
      await store.acquireLease({
        actor: worker(TENANT_A, "worker-2"),
        request: {
          tenantId: TENANT_A,
          executionId: "exec-1",
          workerId: "worker-2",
          now: at(2_100),
        },
      }),
    );
    expect(secondGrant.attempt).toBe(2);
    expect(secondGrant.leaseId).toBe("exec-1:lease:2");

    // The stale holder's rights are gone: its lease token completes nothing.
    expectDeny(
      await store.completeExecution({
        actor: worker(TENANT_A, "worker-1"),
        request: {
          tenantId: TENANT_A,
          executionId: "exec-1",
          leaseId: firstGrant.leaseId,
          workerId: "worker-1",
          outcome: {
            outcome: "succeeded",
            evidence: [{ evidenceKind: "observation", sourceRef: "cg_entity:stale", lineage: [] }],
          },
          now: at(2_200),
        },
      }),
      "lease_not_held",
    );
  });

  it("keeps an active lease exclusive against a second worker", async () => {
    const { store } = await seedAssignedExecution();
    await store.acquireLease({
      actor: worker(),
      request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: T0 },
    });
    expectDeny(
      await store.acquireLease({
        actor: worker(TENANT_A, "worker-2"),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-2", now: at(100) },
      }),
      "lease_held",
    );
  });

  it("extends the lease window through heartbeats", async () => {
    const { store } = await seedAssignedExecution();
    const grant = expectOk(
      await store.acquireLease({
        actor: worker(),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: T0 },
      }),
    );
    // Heartbeat every 400ms keeps the lease alive past the 1s TTL.
    for (const tick of [400, 800, 1_200]) {
      const beat = expectOk(
        await store.heartbeatLease({
          actor: worker(),
          request: {
            tenantId: TENANT_A,
            executionId: "exec-1",
            leaseId: grant.leaseId,
            workerId: "worker-1",
            now: at(tick),
          },
        }),
      );
      expect(Date.parse(beat.leaseExpiresAt)).toBeGreaterThan(Date.parse(at(tick)));
    }
    // Completion still accepted while the heartbeat window is fresh.
    const done = expectOk(
      await store.completeExecution({
        actor: worker(),
        request: {
          tenantId: TENANT_A,
          executionId: "exec-1",
          leaseId: grant.leaseId,
          workerId: "worker-1",
          outcome: {
            outcome: "succeeded",
            evidence: [{ evidenceKind: "observation", sourceRef: "cg_entity:1111", lineage: [] }],
          },
          now: at(1_300),
        },
      }),
    );
    expect(done.execution.stage).toBe("evidenced");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Retry semantics (bounded backoff)
 * ────────────────────────────────────────────────────────────*/

describe("mission retry semantics (V1-004)", () => {
  it("requeues a failed attempt with bounded exponential backoff", async () => {
    const { store } = await seedAssignedExecution();
    const grant = expectOk(
      await store.acquireLease({
        actor: worker(),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: T0 },
      }),
    );
    const failed = expectOk(
      await store.failExecution({
        actor: worker(),
        tenantId: TENANT_A,
        executionId: "exec-1",
        leaseId: grant.leaseId,
        workerId: "worker-1",
        reason: "transient-tool-failure",
        now: at(50),
      }),
    );
    expect(failed.execution.stage).toBe("requeued");
    expect(failed.execution.failureCount).toBe(1);
    // Backoff is bounded exponential from the failure instant.
    const retryAt = new Date(Date.parse(at(50)) + nextRetryAt(FAST_CONFIG, 1)).toISOString();
    expect(failed.retryScheduledAt).toBe(retryAt);

    // Backoff is enforced: an immediate re-lease is denied.
    expectDeny(
      await store.acquireLease({
        actor: worker(),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: at(60) },
      }),
      "retry_backoff",
    );

    const retried = expectOk(
      await store.acquireLease({
        actor: worker(),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: retryAt },
      }),
    );
    expect(retried.attempt).toBe(2);
  });

  it("exhausts the bounded attempt budget and stops leasing", async () => {
    const { store } = await seedAssignedExecution();
    let now = 0;
    for (let attempt = 1; attempt <= FAST_CONFIG.maxAttempts; attempt += 1) {
      const grant = expectOk(
        await store.acquireLease({
          actor: worker(),
          request: {
            tenantId: TENANT_A,
            executionId: "exec-1",
            workerId: "worker-1",
            now: at(now),
          },
        }),
      );
      const failedAt = now + 10;
      const failed = expectOk(
        await store.failExecution({
          actor: worker(),
          tenantId: TENANT_A,
          executionId: "exec-1",
          leaseId: grant.leaseId,
          workerId: "worker-1",
          reason: `failure-${attempt}`,
          now: at(failedAt),
        }),
      );
      if (attempt === FAST_CONFIG.maxAttempts) {
        expect(failed.execution.stage).toBe("exhausted");
        expect(failed.retryScheduledAt).toBeNull();
      } else {
        expect(failed.execution.stage).toBe("requeued");
        expect(failed.retryScheduledAt).toBe(
          new Date(Date.parse(at(failedAt)) + nextRetryAt(FAST_CONFIG, attempt)).toISOString(),
        );
      }
      now = failedAt + nextRetryAt(FAST_CONFIG, attempt) + 1;
    }
    expectDeny(
      await store.acquireLease({
        actor: worker(),
        request: {
          tenantId: TENANT_A,
          executionId: "exec-1",
          workerId: "worker-1",
          now: at(now + 1_000_000),
        },
      }),
      "attempts_exhausted",
    );

    // The terminal-exhausted write nulls the stored retry gate (V1-003 §42
    // reported edit 2, reconciled by W3-INT): the returned value was already
    // null, and the STORED execution must not carry a backoff stamp it can
    // never honor.
    const stored = await store.getExecution(TENANT_A, "exec-1");
    expect(stored?.stage).toBe("exhausted");
    expect(stored?.retryScheduledAt).toBeNull();
  });

  it("records a reported failure through completeExecution (outcome failed)", async () => {
    const { store } = await seedAssignedExecution();
    const grant = expectOk(
      await store.acquireLease({
        actor: worker(),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: T0 },
      }),
    );
    const reported = expectOk(
      await store.completeExecution({
        actor: worker(),
        request: {
          tenantId: TENANT_A,
          executionId: "exec-1",
          leaseId: grant.leaseId,
          workerId: "worker-1",
          outcome: { outcome: "failed", reason: "worker-reported-failure" },
          now: at(100),
        },
      }),
    );
    expect(reported.execution.stage).toBe("requeued");
    expect(reported.execution.failureCount).toBe(1);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Verifier separation
 * ────────────────────────────────────────────────────────────*/

describe("verifier separation (V1-004, mechanism 09)", () => {
  it("never lets completion flip an execution to verified", async () => {
    const { store } = await seedAssignedExecution();
    const grant = expectOk(
      await store.acquireLease({
        actor: worker(),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: T0 },
      }),
    );
    const done = expectOk(
      await store.completeExecution({
        actor: worker(),
        request: {
          tenantId: TENANT_A,
          executionId: "exec-1",
          leaseId: grant.leaseId,
          workerId: "worker-1",
          outcome: {
            outcome: "succeeded",
            evidence: [{ evidenceKind: "observation", sourceRef: "cg_entity:1111", lineage: [] }],
          },
          now: at(100),
        },
      }),
    );
    expect(done.execution.stage).toBe("evidenced");
    expect(done.execution.verificationDecision).toBeNull();
  });

  it("rejects an executor as verifier and records the independence failure", async () => {
    const { store } = await seedAssignedExecution();
    const grant = expectOk(
      await store.acquireLease({
        actor: worker(),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: T0 },
      }),
    );
    await store.completeExecution({
      actor: worker(),
      request: {
        tenantId: TENANT_A,
        executionId: "exec-1",
        leaseId: grant.leaseId,
        workerId: "worker-1",
        outcome: {
          outcome: "succeeded",
          evidence: [{ evidenceKind: "observation", sourceRef: "cg_entity:1111", lineage: [] }],
        },
        now: at(100),
      },
    });

    // The executing worker cannot verify its own work (identity equivalence);
    // it holds a verify delegation, so the denial is the INDEPENDENCE check.
    const selfVerified = expectOk(
      await store.verifyExecution(agentVerifier(TENANT_A, "worker-1"), {
        tenantId: TENANT_A,
        executionId: "exec-1",
        criteriaMet: true,
        now: at(200),
      }),
    );
    expect(selfVerified.verification.decision).toBe("failed");
    expect(selfVerified.verification.reason).toBe("verification_independence_failed");
    expect(selfVerified.execution.stage).toBe("evidenced");
    expect(selfVerified.execution.verificationDecision).toBe("failed");

    // The recorded failure is canonical truth (§10): a later verification
    // attempt REPLAYS it — the decision is never re-made or overwritten.
    const replayed = expectOk(
      await store.verifyExecution(verifier(), {
        tenantId: TENANT_A,
        executionId: "exec-1",
        criteriaMet: true,
        now: at(300),
      }),
    );
    expect(replayed.replayed).toBe(true);
    expect(replayed.verification.decision).toBe("failed");
    expect(replayed.execution.stage).toBe("evidenced");
  });

  it("honors effective-identity equivalence: a delegated alias of the executor is not independent", async () => {
    const store = createInMemoryMissionExecutionStore({
      config: FAST_CONFIG,
      // worker-1 and worker-1-alias resolve to the same effective identity.
      identityRegistry: [
        { identityRef: "worker-1", effectiveIdentityRef: "principal-1", identityKind: "ai_agent" },
        {
          identityRef: "worker-1-alias",
          effectiveIdentityRef: "principal-1",
          identityKind: "ai_agent",
        },
      ],
    });
    await store.recordIntent({ actor: owner(), intent: intentInput(), now: T0 });
    await store.assignExecution({
      actor: operator(),
      assignment: {
        tenantId: TENANT_A,
        missionId: "MISSION-V1-004-GENERAL",
        version: "1.0",
        executionId: "exec-1",
        idempotencyKey: "idem-key-0000009",
        action: "record-observation",
        realityRef: "cg_entity:1111",
        now: T0,
      },
    });
    const grant = expectOk(
      await store.acquireLease({
        actor: worker(),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: T0 },
      }),
    );
    await store.completeExecution({
      actor: worker(),
      request: {
        tenantId: TENANT_A,
        executionId: "exec-1",
        leaseId: grant.leaseId,
        workerId: "worker-1",
        outcome: {
          outcome: "succeeded",
          evidence: [{ evidenceKind: "observation", sourceRef: "cg_entity:1111", lineage: [] }],
        },
        now: at(100),
      },
    });
    const aliasVerified = expectOk(
      await store.verifyExecution(agentVerifier(TENANT_A, "worker-1-alias"), {
        tenantId: TENANT_A,
        executionId: "exec-1",
        criteriaMet: true,
        now: at(200),
      }),
    );
    expect(aliasVerified.verification.decision).toBe("failed");
    expect(aliasVerified.verification.reason).toBe("verification_independence_failed");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Cross-tenant denial (fail closed)
 * ────────────────────────────────────────────────────────────*/

describe("cross-tenant denial (V1-004, AGENTS §31)", () => {
  it("fails closed for tenant-B actors against tenant-A executions with the same signal as unknown", async () => {
    const { store } = await seedAssignedExecution();

    // Lease: cross-tenant and unknown executions share one deny code.
    const leaseDeny = expectDeny(
      await store.acquireLease({
        actor: worker(TENANT_B, "worker-b"),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-b", now: T0 },
      }),
      "cross_tenant",
    );
    const unknownDeny = expectDeny(
      await store.acquireLease({
        actor: worker(TENANT_A, "worker-1"),
        request: {
          tenantId: TENANT_A,
          executionId: "exec-does-not-exist",
          workerId: "worker-1",
          now: T0,
        },
      }),
      "cross_tenant",
    );
    expect(leaseDeny).toBe(unknownDeny);

    // Reads: another tenant's rows are not visible.
    expect(await store.getExecution(TENANT_B, "exec-1")).toBeNull();

    // Verification and recovery: same fail-closed signal.
    expectDeny(
      await store.verifyExecution(verifier(TENANT_B), {
        tenantId: TENANT_A,
        executionId: "exec-1",
        criteriaMet: true,
        now: T0,
      }),
      "cross_tenant",
    );
    const recovery = expectOk(
      await store.recoverOrphanedLeases({
        actor: operator(TENANT_B),
        request: { tenantId: TENANT_B, now: T0 },
      }),
    );
    expect(recovery).toHaveLength(0);

    // Intent declarations are tenant-scoped too.
    expectDeny(
      await store.recordIntent({
        actor: owner(),
        intent: intentInput({ tenantId: TENANT_B }),
        now: T0,
      }),
      "cross_tenant",
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Neutral RBAC authorization (V1-006 core)
 * ────────────────────────────────────────────────────────────*/

describe("neutral RBAC authorization (V1-004)", () => {
  it("denies an actor whose role carries no mission grants (default DENY)", async () => {
    const store = createInMemoryMissionExecutionStore({ config: FAST_CONFIG });
    await store.recordIntent({ actor: owner(), intent: intentInput(), now: T0 });
    expectDeny(
      await store.assignExecution({
        actor: { ...operator(), role: "read_only" },
        assignment: {
          tenantId: TENANT_A,
          missionId: "MISSION-V1-004-GENERAL",
          version: "1.0",
          executionId: "exec-1",
          idempotencyKey: "idem-key-0000010",
          action: "record-observation",
          realityRef: "cg_entity:1111",
          now: T0,
        },
      }),
      "unauthorized",
    );
  });

  it("denies a suspended identity lifecycle (fail closed)", async () => {
    const { store } = await seedAssignedExecution();
    expectDeny(
      await store.acquireLease({
        actor: { ...worker(), lifecycle: "suspended" },
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: T0 },
      }),
      "unauthorized",
    );
  });

  it("denies an undelegated agent (Invariant 12: role membership is never agent authority)", async () => {
    const store = createInMemoryMissionExecutionStore({ config: FAST_CONFIG });
    await store.recordIntent({ actor: owner(), intent: intentInput(), now: T0 });
    expectDeny(
      await store.assignExecution({
        actor: { ...worker(), extraPermissions: undefined },
        assignment: {
          tenantId: TENANT_A,
          missionId: "MISSION-V1-004-GENERAL",
          version: "1.0",
          executionId: "exec-1",
          idempotencyKey: "idem-key-0000011",
          action: "record-observation",
          realityRef: "cg_entity:1111",
          now: T0,
        },
      }),
      "unauthorized",
    );
  });

  it("denies a verifier role an execute capability and an operator a verify capability", async () => {
    const store = createInMemoryMissionExecutionStore({ config: FAST_CONFIG });
    await store.recordIntent({ actor: owner(), intent: intentInput(), now: T0 });
    // verifier role cannot assign (no execute grant).
    expectDeny(
      await store.assignExecution({
        actor: verifier(),
        assignment: {
          tenantId: TENANT_A,
          missionId: "MISSION-V1-004-GENERAL",
          version: "1.0",
          executionId: "exec-1",
          idempotencyKey: "idem-key-0000012",
          action: "record-observation",
          realityRef: "cg_entity:1111",
          now: T0,
        },
      }),
      "unauthorized",
    );
    // operator role cannot verify (no verify grant).
    await store.assignExecution({
      actor: operator(),
      assignment: {
        tenantId: TENANT_A,
        missionId: "MISSION-V1-004-GENERAL",
        version: "1.0",
        executionId: "exec-1",
        idempotencyKey: "idem-key-0000012",
        action: "record-observation",
        realityRef: "cg_entity:1111",
        now: T0,
      },
    });
    const grant = expectOk(
      await store.acquireLease({
        actor: worker(),
        request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-1", now: T0 },
      }),
    );
    await store.completeExecution({
      actor: worker(),
      request: {
        tenantId: TENANT_A,
        executionId: "exec-1",
        leaseId: grant.leaseId,
        workerId: "worker-1",
        outcome: {
          outcome: "succeeded",
          evidence: [{ evidenceKind: "observation", sourceRef: "cg_entity:1111", lineage: [] }],
        },
        now: at(100),
      },
    });
    expectDeny(
      await store.verifyExecution(operator(), {
        tenantId: TENANT_A,
        executionId: "exec-1",
        criteriaMet: true,
        now: at(200),
      }),
      "unauthorized",
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * 8. Trust-boundary validation (Zod, fail closed)
 * ────────────────────────────────────────────────────────────*/

describe("trust-boundary validation (V1-004)", () => {
  it("rejects malformed inputs with invalid_input before any state change", async () => {
    const store = createInMemoryMissionExecutionStore({ config: FAST_CONFIG });
    expectDeny(
      await store.recordIntent({
        actor: owner(),
        intent: intentInput({ authorityRef: "   " }),
        now: T0,
      }),
      "invalid_input",
    );
    expectDeny(
      await store.acquireLease({
        actor: worker(),
        request: {
          tenantId: TENANT_A,
          executionId: "exec-1",
          workerId: "worker-1",
          now: "not-a-timestamp",
        },
      }),
      "invalid_input",
    );
  });

  it("rejects an invalid store configuration up front", () => {
    expect(() =>
      createInMemoryMissionExecutionStore({
        config: { ...FAST_CONFIG, heartbeatIntervalMs: 10_000, leaseTtlMs: 1_000 },
      }),
    ).toThrow(/heartbeatIntervalMs/);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 9. Driver seam (V1-003 implements `execute`)
 * ────────────────────────────────────────────────────────────*/

describe("driver seam: runLeasedMissionExecution (V1-004 → V1-003)", () => {
  it("leases, invokes the executor callback with the grant, and evidences success", async () => {
    const { store } = await seedAssignedExecution();
    let observedGrant: string | null = null;
    const result = await runLeasedMissionExecution(store, {
      worker: worker(),
      tenantId: TENANT_A,
      executionId: "exec-1",
      now: T0,
      execute: async (grant) => {
        observedGrant = grant.leaseId;
        return {
          outcome: "succeeded" as const,
          evidence: [{ evidenceKind: "observation", sourceRef: "cg_entity:1111", lineage: [] }],
        };
      },
    });
    expect(observedGrant).toBe("exec-1:lease:1");
    expect(result.leased).toBe(true);
    expect(result.outcome).toBe("evidenced");
    expect(result.stage).toBe("evidenced");

    const execution = await store.getExecution(TENANT_A, "exec-1");
    expect(execution?.stage).toBe("evidenced");
  });

  it("reports a failed executor callback as a requeue with backoff", async () => {
    const { store } = await seedAssignedExecution();
    const result = await runLeasedMissionExecution(store, {
      worker: worker(),
      tenantId: TENANT_A,
      executionId: "exec-1",
      now: T0,
      execute: async () => ({ outcome: "failed" as const, reason: "runtime-crash" }),
    });
    expect(result.outcome).toBe("failed");
    const execution = await store.getExecution(TENANT_A, "exec-1");
    expect(execution?.stage).toBe("requeued");
    expect(execution?.failureCount).toBe(1);
  });

  it("returns the typed denial when the lease cannot be acquired", async () => {
    const { store } = await seedAssignedExecution();
    await store.acquireLease({
      actor: worker(TENANT_A, "worker-2"),
      request: { tenantId: TENANT_A, executionId: "exec-1", workerId: "worker-2", now: T0 },
    });
    const result = await runLeasedMissionExecution(store, {
      worker: worker(),
      tenantId: TENANT_A,
      executionId: "exec-1",
      now: at(100),
      execute: async () => ({ outcome: "failed" as const, reason: "unreachable" }),
    });
    expect(result.leased).toBe(false);
    expect(result.outcome).toBe("not_leased");
    expect(result.denyCode).toBe("lease_held");
  });

  it("records the executor of record (lastWorkerId) on the execution", async () => {
    const { store } = await seedAssignedExecution();
    const result = await runLeasedMissionExecution(store, {
      worker: worker(TENANT_A, "worker-7"),
      tenantId: TENANT_A,
      executionId: "exec-1",
      now: T0,
      execute: async () => ({
        outcome: "succeeded" as const,
        evidence: [{ evidenceKind: "observation", sourceRef: "cg_entity:1111", lineage: [] }],
      }),
    });
    expect(result.outcome).toBe("evidenced");
    const execution = await store.getExecution(TENANT_A, "exec-1");
    expect(execution?.lastWorkerId).toBe("worker-7");
  });

  it("threads per-phase instants from the injected clock (completion ≠ wake instant)", async () => {
    const { store } = await seedAssignedExecution();
    // The host's injected clock advances DURING the executor callback (work
    // takes 500ms); the driver samples it at each phase boundary.
    let nowMs = Date.parse(T0);
    const result = await runLeasedMissionExecution(store, {
      worker: worker(),
      tenantId: TENANT_A,
      executionId: "exec-1",
      now: T0,
      clock: () => new Date(nowMs).toISOString(),
      execute: async () => {
        nowMs += 500; // inside the 1s FAST_CONFIG lease TTL
        return {
          outcome: "succeeded" as const,
          evidence: [{ evidenceKind: "observation", sourceRef: "cg_entity:1111", lineage: [] }],
        };
      },
    });
    expect(result.outcome).toBe("evidenced");

    // The lease was acquired at the WAKE instant…
    expect(result.lease?.acquiredAt).toBe(T0);
    // …but the completion act (evidence §12 stamps, updatedAt) binds to the
    // act instant sampled at the outcome-report phase boundary.
    const execution = await store.getExecution(TENANT_A, "exec-1");
    expect(execution?.updatedAt).toBe(at(500));
    expect(execution?.evidenceIds).toEqual(["exec-1:evidence:observation"]);
  });

  it("schedules the retry from the failure act instant, not the wake instant", async () => {
    const { store } = await seedAssignedExecution();
    const failedAt = at(100); // the act instant sampled at the report phase
    const result = await runLeasedMissionExecution(store, {
      worker: worker(),
      tenantId: TENANT_A,
      executionId: "exec-1",
      now: T0,
      clock: () => failedAt,
      execute: async () => ({ outcome: "failed" as const, reason: "transient fault" }),
    });
    expect(result.outcome).toBe("failed");
    // Backoff is bounded exponential from the FAILURE instant (act instant),
    // not from the wake instant T0.
    const expectedRetry = new Date(
      Date.parse(failedAt) + nextRetryAt(FAST_CONFIG, 1),
    ).toISOString();
    const execution = await store.getExecution(TENANT_A, "exec-1");
    expect(execution?.retryScheduledAt).toBe(expectedRetry);
  });

  it("keeps the single-`now` deterministic behavior when no clock is supplied", async () => {
    const { store } = await seedAssignedExecution();
    const result = await runLeasedMissionExecution(store, {
      worker: worker(),
      tenantId: TENANT_A,
      executionId: "exec-1",
      now: T0,
      execute: async () => ({
        outcome: "succeeded" as const,
        evidence: [{ evidenceKind: "observation", sourceRef: "cg_entity:1111", lineage: [] }],
      }),
    });
    expect(result.lease?.acquiredAt).toBe(T0);
    const execution = await store.getExecution(TENANT_A, "exec-1");
    expect(execution?.updatedAt).toBe(T0);
  });
});
