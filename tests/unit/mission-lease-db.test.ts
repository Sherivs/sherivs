/**
 * MISSION V1-003 — DB-backed mission lease port over `cg_mission_lease`.
 *
 * Proves, at unit level (offline, mocked Supabase client — no real database):
 *  1. acquireLease persists an ACTIVE cg_mission_lease row (tenant-scoped,
 *     attempt-counted, TTL-stamped) and returns the worker-facing grant;
 *  2. an active lease is exclusive (lease_held) until its heartbeat window
 *     lapses;
 *  3. heartbeatLease extends heartbeat_at/expires_at; a lapsed heartbeat
 *     denies with lease_expired (recover and re-lease);
 *  4. completeExecution success releases the lease with outcome 'succeeded'
 *     and persists §12 evidence through the composed record port;
 *  5. failExecution releases with outcome 'failed' + a bounded retry gate
 *     (retry_not_before) and the enriched stage requeues;
 *  6. an orphaned active lease is marked recovered and the work re-leases to
 *     a NEW worker (handoff);
 *  7. the worker gate (quarantine/revocation) denies at acquire with zero
 *     writes;
 *  8. untrusted lease rows are Zod-validated (fail closed);
 *  9. cross-tenant acquires fail closed with the SAME signal as unknown;
 * 10. a recorded verification decision projects onto the stage (verified is
 *     terminal — never leased again).
 */

import { describe, expect, it } from "vitest";
import {
  createDbMissionLeasePort,
  type MissionLeaseDbClient,
} from "@/lib/missions/mission-lease-db.server";
import { createDbMissionExecutionPorts } from "@/lib/missions/mission-execution-db.server";
import type { MissionActorContext } from "@/lib/missions/mission-authorization";
import type { WorkerLeaseGate } from "@/lib/missions/mission-lease-db.server";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const TENANT_A = "tenant-alpha";
const TENANT_B = "tenant-beta";
const T0 = "2026-10-01T12:00:00.000Z";
const EXECUTION_ID = "exec-1";
const MISSION_ID = "MISSION-V1-003-HOST";
const VERSION = "1.0";

function workerActor(id = "worker-1"): MissionActorContext {
  return {
    actorId: id,
    tenantId: TENANT_A,
    identityKind: "ai_agent",
    lifecycle: "active",
    role: "mission_operator",
    isAgent: true,
    extraPermissions: [
      { resource: "mission", action: "execute", scope: `${TENANT_A}:mission:${MISSION_ID}` },
    ],
  };
}

function operator(): MissionActorContext {
  return {
    actorId: "operator-1",
    tenantId: TENANT_A,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_operator",
  };
}

const MISSION_ROW: Row = {
  mission_id: MISSION_ID,
  version: VERSION,
  tenant_id: TENANT_A,
  purpose: "governed-worker-host-probe",
  authority_ref: "CONTROL-PLANE-06",
  context_ref: "context-1",
  owner_ref: "MISSIONS.md",
  non_scope: ["deploy"],
  authorized_actions: ["record-observation"],
  lifecycle: "authorized",
  expires_at: null,
};

const EXECUTION_ROW: Row = {
  id: EXECUTION_ID,
  idempotency_key: "idem-host-00000001",
  mission_id: MISSION_ID,
  mission_version: VERSION,
  tenant_id: TENANT_A,
  actor_id: "operator-1",
  action: "record-observation",
  reality_ref: "cg_entity:22222222-2222-4222-8222-222222222222",
  requested_at: T0,
  attempt_id: `${EXECUTION_ID}:1`,
  started_at: T0,
  status: "admitted",
  reason: null,
  external_effect: "recorded_intent",
};

function activeLeaseRow(overrides?: Partial<Row>): Row {
  return {
    lease_id: `${EXECUTION_ID}:lease:1`,
    execution_id: EXECUTION_ID,
    tenant_id: TENANT_A,
    mission_id: MISSION_ID,
    worker_id: "worker-1",
    acquired_at: T0,
    heartbeat_at: T0,
    expires_at: new Date(Date.parse(T0) + 30_000).toISOString(),
    attempt: 1,
    state: "active",
    outcome: null,
    completed_at: null,
    retry_not_before: null,
    ...overrides,
  };
}

function expectOk<T>(result: { ok: boolean; value?: T; code?: string; reason?: string }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.reason}`);
  return result.value as T;
}

function expectDeny(
  result: { ok: boolean; code?: string; reason?: string },
  code: string,
): asserts result is { ok: false; code: string; reason: string } {
  if (result.ok) throw new Error(`expected denial ${code}, got ok`);
  if (result.code !== code) {
    throw new Error(`expected denial ${code}, got ${result.code}: ${result.reason}`);
  }
}

/* ─────────────────────────────────────────────────────────────
 * Structural fake Supabase client (stateful; no network, no DB)
 * ────────────────────────────────────────────────────────────*/

type Row = Record<string, unknown>;

interface FakeDb {
  client: MissionLeaseDbClient;
  tables: Map<string, Row[]>;
  writes: Array<{ table: string; op: "insert" | "upsert" | "update"; row: Row }>;
}

function fakeSupabaseDb(initial: Record<string, Row[]> = {}): FakeDb {
  const tables = new Map<string, Row[]>(Object.entries(initial).map(([t, rows]) => [t, [...rows]]));
  const writes: FakeDb["writes"] = [];

  const client = {
    from(table: string) {
      const rowsFor = (): Row[] => tables.get(table) ?? [];
      const makeQuery = (filters: Array<[string, string]>) => {
        const apply = (): Row[] =>
          rowsFor().filter((row) => filters.every(([column, value]) => row[column] === value));
        return {
          eq(column: string, value: string) {
            return makeQuery([...filters, [column, value]]);
          },
          maybeSingle: async () => {
            const found = apply();
            return { data: found[0] ?? null, error: null };
          },
          then(
            onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) {
            return Promise.resolve({ data: apply(), error: null }).then(onFulfilled, onRejected);
          },
        };
      };
      return {
        select() {
          return makeQuery([]);
        },
        insert(row: Row) {
          writes.push({ table, op: "insert", row });
          (tables.get(table) ?? tables.set(table, []).get(table)!).push(row);
          return Promise.resolve({ data: row, error: null });
        },
        upsert(row: Row) {
          writes.push({ table, op: "upsert", row });
          const rows = tables.get(table) ?? tables.set(table, []).get(table)!;
          rows.push(row);
          return Promise.resolve({ data: row, error: null });
        },
        update(patch: Row) {
          const applyUpdate = (): { data: Row[]; error: null } => {
            const updated: Row[] = [];
            for (const row of rowsFor()) {
              const matches = true; // filters applied via the eq chain below
              if (matches) updated.push(row);
            }
            return { data: updated, error: null };
          };
          const makeUpdate = (filters: Array<[string, string]>) => ({
            eq(column: string, value: string) {
              return makeUpdate([...filters, [column, value]]);
            },
            then(
              onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              writes.push({ table, op: "update", row: patch });
              for (const row of rowsFor()) {
                if (filters.every(([column, value]) => row[column] === value)) {
                  Object.assign(row, patch);
                }
              }
              return Promise.resolve(applyUpdate()).then(onFulfilled, onRejected);
            },
          });
          return makeUpdate([]);
        },
      };
    },
  };

  return { client: client as unknown as MissionLeaseDbClient, tables, writes };
}

function initialDb(): Record<string, Row[]> {
  return { cg_mission_intent: [MISSION_ROW], cg_execution_record: [EXECUTION_ROW] };
}

function leasePort(db: FakeDb, workerGate?: WorkerLeaseGate) {
  const records = createDbMissionExecutionPorts(db.client).records;
  return createDbMissionLeasePort(db.client, { records, workerGate });
}

/* ─────────────────────────────────────────────────────────────
 * 1–3. acquire / exclusivity / heartbeat
 * ────────────────────────────────────────────────────────────*/

describe("db lease port — acquireLease over cg_mission_lease", () => {
  it("persists an active tenant-scoped lease row and returns the grant", async () => {
    const db = fakeSupabaseDb(initialDb());
    const port = leasePort(db);
    const grant = expectOk(
      await port.acquireLease({
        actor: workerActor(),
        request: { tenantId: TENANT_A, executionId: EXECUTION_ID, workerId: "worker-1", now: T0 },
      }),
    );
    expect(grant.leaseId).toBe(`${EXECUTION_ID}:lease:1`);
    expect(grant.attempt).toBe(1);
    expect(grant.leaseExpiresAt).toBe(new Date(Date.parse(T0) + 30_000).toISOString());
    expect(grant.heartbeatIntervalMs).toBe(10_000);

    const leaseWrites = db.writes.filter((w) => w.table === "cg_mission_lease");
    expect(leaseWrites).toHaveLength(1);
    const row = leaseWrites[0]!.row;
    expect(row.tenant_id).toBe(TENANT_A);
    expect(row.worker_id).toBe("worker-1");
    expect(row.state).toBe("active");
    expect(row.attempt).toBe(1);
  });

  it("denies a second acquire while the active lease is alive (lease_held)", async () => {
    const db = fakeSupabaseDb(initialDb());
    const port = leasePort(db);
    await port.acquireLease({
      actor: workerActor(),
      request: { tenantId: TENANT_A, executionId: EXECUTION_ID, workerId: "worker-1", now: T0 },
    });
    const second = await port.acquireLease({
      actor: workerActor("worker-2"),
      request: { tenantId: TENANT_A, executionId: EXECUTION_ID, workerId: "worker-2", now: T0 },
    });
    expectDeny(second, "lease_held");
    expect(db.writes.filter((w) => w.table === "cg_mission_lease")).toHaveLength(1);
  });

  it("extends the heartbeat window and denies a lapsed heartbeat", async () => {
    const db = fakeSupabaseDb(initialDb());
    const port = leasePort(db);
    const grant = expectOk(
      await port.acquireLease({
        actor: workerActor(),
        request: { tenantId: TENANT_A, executionId: EXECUTION_ID, workerId: "worker-1", now: T0 },
      }),
    );

    const later = new Date(Date.parse(T0) + 5_000).toISOString();
    const beat = expectOk(
      await port.heartbeatLease({
        actor: workerActor(),
        request: {
          tenantId: TENANT_A,
          executionId: EXECUTION_ID,
          leaseId: grant.leaseId,
          workerId: "worker-1",
          now: later,
        },
      }),
    );
    expect(beat.leaseExpiresAt).toBe(new Date(Date.parse(T0) + 35_000).toISOString());
    const stored = db.tables.get("cg_mission_lease")![0]!;
    expect(stored.heartbeat_at).toBe(later);

    // A heartbeat past the (unextended) TTL window denies — recover and re-lease.
    const lapsed = await port.heartbeatLease({
      actor: workerActor(),
      request: {
        tenantId: TENANT_A,
        executionId: EXECUTION_ID,
        leaseId: grant.leaseId,
        workerId: "worker-1",
        now: new Date(Date.parse(T0) + 40_000).toISOString(),
      },
    });
    expectDeny(lapsed, "lease_expired");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4–5. completion / failure
 * ────────────────────────────────────────────────────────────*/

describe("db lease port — completeExecution / failExecution", () => {
  it("releases the lease with outcome 'succeeded' and persists §12 evidence", async () => {
    const db = fakeSupabaseDb(initialDb());
    const port = leasePort(db);
    const grant = expectOk(
      await port.acquireLease({
        actor: workerActor(),
        request: { tenantId: TENANT_A, executionId: EXECUTION_ID, workerId: "worker-1", now: T0 },
      }),
    );
    const later = new Date(Date.parse(T0) + 5_000).toISOString();
    const completed = expectOk(
      await port.completeExecution({
        actor: workerActor(),
        request: {
          tenantId: TENANT_A,
          executionId: EXECUTION_ID,
          leaseId: grant.leaseId,
          workerId: "worker-1",
          outcome: {
            outcome: "succeeded",
            evidence: [
              { evidenceKind: "observation", sourceRef: "runtime:runtime-a", lineage: [] },
            ],
          },
          now: later,
        },
      }),
    );
    expect(completed.execution.stage).toBe("evidenced");
    expect(completed.evidence).toHaveLength(1);
    const leaseRow = db.tables.get("cg_mission_lease")![0]!;
    expect(leaseRow.state).toBe("released");
    expect(leaseRow.outcome).toBe("succeeded");
    expect(db.writes.some((w) => w.table === "cg_foundation_evidence")).toBe(true);
    const evidenceRow = db.writes.find((w) => w.table === "cg_foundation_evidence")!.row;
    expect(String(evidenceRow.provenance)).toContain("worker:worker-1");
  });

  it("records the failure with a bounded retry gate and requeues", async () => {
    const db = fakeSupabaseDb(initialDb());
    const port = leasePort(db);
    const grant = expectOk(
      await port.acquireLease({
        actor: workerActor(),
        request: { tenantId: TENANT_A, executionId: EXECUTION_ID, workerId: "worker-1", now: T0 },
      }),
    );
    const failed = expectOk(
      await port.failExecution({
        actor: workerActor(),
        tenantId: TENANT_A,
        executionId: EXECUTION_ID,
        leaseId: grant.leaseId,
        workerId: "worker-1",
        reason: "flaky dependency",
        now: T0,
      }),
    );
    expect(failed.execution.stage).toBe("requeued");
    expect(failed.retryScheduledAt).toBe(new Date(Date.parse(T0) + 1_000).toISOString());
    const leaseRow = db.tables.get("cg_mission_lease")![0]!;
    expect(leaseRow.state).toBe("released");
    expect(leaseRow.outcome).toBe("failed");
    expect(leaseRow.retry_not_before).toBe(new Date(Date.parse(T0) + 1_000).toISOString());

    // The retry gate holds until retry_not_before.
    const early = await port.acquireLease({
      actor: workerActor("worker-2"),
      request: {
        tenantId: TENANT_A,
        executionId: EXECUTION_ID,
        workerId: "worker-2",
        now: new Date(Date.parse(T0) + 500).toISOString(),
      },
    });
    expectDeny(early, "retry_backoff");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. orphan recovery + handoff
 * ────────────────────────────────────────────────────────────*/

describe("db lease port — orphan recovery and handoff", () => {
  it("marks the unheartbeated lease recovered and re-leases to a NEW worker", async () => {
    const db = fakeSupabaseDb({ ...initialDb(), cg_mission_lease: [activeLeaseRow()] });
    const port = leasePort(db);
    const grant = expectOk(
      await port.acquireLease({
        actor: workerActor("worker-2"),
        request: {
          tenantId: TENANT_A,
          executionId: EXECUTION_ID,
          workerId: "worker-2",
          now: new Date(Date.parse(T0) + 40_000).toISOString(),
        },
      }),
    );
    expect(grant.workerId).toBe("worker-2");
    expect(grant.attempt).toBe(2);
    const rows = db.tables.get("cg_mission_lease")!;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.state).toBe("recovered");
    expect(rows[1]!.worker_id).toBe("worker-2");
    expect(rows[1]!.state).toBe("active");
  });

  it("sweeps expired leases via recoverOrphanedLeases", async () => {
    const db = fakeSupabaseDb({ ...initialDb(), cg_mission_lease: [activeLeaseRow()] });
    const port = leasePort(db);
    const recovered = expectOk(
      await port.recoverOrphanedLeases({
        actor: operator(),
        request: { tenantId: TENANT_A, now: new Date(Date.parse(T0) + 40_000).toISOString() },
      }),
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.workerId).toBe("worker-1");
    expect(db.tables.get("cg_mission_lease")![0]!.state).toBe("recovered");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7–10. gates, fail-closed posture
 * ────────────────────────────────────────────────────────────*/

describe("db lease port — worker gate, untrusted rows, tenant boundary", () => {
  it("denies a gated-out (quarantined) worker with ZERO writes", async () => {
    const db = fakeSupabaseDb(initialDb());
    const gate: WorkerLeaseGate = async () => ({
      ok: false,
      reason: "worker_quarantined:failure bound reached — no longer leased to",
    });
    const port = leasePort(db, gate);
    const denied = await port.acquireLease({
      actor: workerActor(),
      request: { tenantId: TENANT_A, executionId: EXECUTION_ID, workerId: "worker-1", now: T0 },
    });
    expectDeny(denied, "unauthorized");
    expect(denied.reason).toContain("worker_quarantined");
    expect(db.writes).toHaveLength(0);
  });

  it("fails closed on a malformed cg_mission_lease row", async () => {
    const db = fakeSupabaseDb({
      ...initialDb(),
      cg_mission_lease: [activeLeaseRow({ state: "somehow-active" })],
    });
    const port = leasePort(db);
    await expect(
      port.acquireLease({
        actor: workerActor("worker-2"),
        request: {
          tenantId: TENANT_A,
          executionId: EXECUTION_ID,
          workerId: "worker-2",
          now: new Date(Date.parse(T0) + 40_000).toISOString(),
        },
      }),
    ).rejects.toThrow(/mission lease load failed|row validation/i);
  });

  it("fails a cross-tenant acquire with the SAME signal as unknown", async () => {
    const db = fakeSupabaseDb(initialDb());
    const port = leasePort(db);
    const denied = await port.acquireLease({
      actor: workerActor(),
      request: { tenantId: TENANT_B, executionId: EXECUTION_ID, workerId: "worker-1", now: T0 },
    });
    expectDeny(denied, "cross_tenant");
    expect(denied.reason).toBe("execution not found in scope");
    expect(db.writes).toHaveLength(0);
  });

  it("never re-leases a verified execution (stage projection is terminal)", async () => {
    const db = fakeSupabaseDb({
      ...initialDb(),
      cg_mission_lease: [
        activeLeaseRow({ state: "released", outcome: "succeeded", completed_at: T0 }),
      ],
      cg_verification_result: [
        {
          verification_id: `${EXECUTION_ID}:verification`,
          execution_id: EXECUTION_ID,
          evidence_ids: [`${EXECUTION_ID}:evidence:observation`],
          decision: "verified",
          reason: "criteria met",
        },
      ],
    });
    const port = leasePort(db);
    const denied = await port.acquireLease({
      actor: workerActor("worker-2"),
      request: { tenantId: TENANT_A, executionId: EXECUTION_ID, workerId: "worker-2", now: T0 },
    });
    expectDeny(denied, "invalid_stage");
    expect(denied.reason).toContain("verified");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 11. Persisted executor of record (lastWorkerId, V1-003 §42 edit 4)
 * ────────────────────────────────────────────────────────────*/

describe("db lease port — persisted executor of record (lastWorkerId)", () => {
  it("surfaces the enriched execution read through getExecution", async () => {
    const db = fakeSupabaseDb(initialDb());
    const port = leasePort(db);
    // No lease rows yet: the record port's projection stands un-enriched.
    const before = await port.getExecution(TENANT_A, EXECUTION_ID);
    expect(before?.stage).toBe("assigned");
    expect(before?.lastWorkerId).toBeNull();

    const grant = expectOk(
      await port.acquireLease({
        actor: workerActor(),
        request: { tenantId: TENANT_A, executionId: EXECUTION_ID, workerId: "worker-1", now: T0 },
      }),
    );
    const leased = await port.getExecution(TENANT_A, EXECUTION_ID);
    expect(leased?.stage).toBe("leased");
    expect(leased?.lastWorkerId).toBe("worker-1");
    expect(leased?.lease?.leaseId).toBe(grant.leaseId);
  });

  it("keeps lastWorkerId persisted AFTER a succeeded release (post-release audit)", async () => {
    const db = fakeSupabaseDb(initialDb());
    const port = leasePort(db);
    const grant = expectOk(
      await port.acquireLease({
        actor: workerActor(),
        request: { tenantId: TENANT_A, executionId: EXECUTION_ID, workerId: "worker-1", now: T0 },
      }),
    );
    await port.completeExecution({
      actor: workerActor(),
      request: {
        tenantId: TENANT_A,
        executionId: EXECUTION_ID,
        leaseId: grant.leaseId,
        workerId: "worker-1",
        outcome: {
          outcome: "succeeded",
          evidence: [{ evidenceKind: "observation", sourceRef: "runtime:runtime-a", lineage: [] }],
        },
        now: new Date(Date.parse(T0) + 5_000).toISOString(),
      },
    });
    const released = await port.getExecution(TENANT_A, EXECUTION_ID);
    expect(released?.stage).toBe("evidenced");
    expect(released?.lease).toBeNull();
    // The lease row survives release (state → released, outcome → succeeded),
    // so the executor of record stays persisted for post-release audit.
    expect(released?.lastWorkerId).toBe("worker-1");
  });

  it("keeps the LAST attempt's worker as executor of record after a handoff", async () => {
    const db = fakeSupabaseDb({ ...initialDb(), cg_mission_lease: [activeLeaseRow()] });
    const port = leasePort(db);
    expectOk(
      await port.acquireLease({
        actor: workerActor("worker-2"),
        request: {
          tenantId: TENANT_A,
          executionId: EXECUTION_ID,
          workerId: "worker-2",
          now: new Date(Date.parse(T0) + 40_000).toISOString(),
        },
      }),
    );
    const handed = await port.getExecution(TENANT_A, EXECUTION_ID);
    expect(handed?.attempt).toBe(2);
    // The latest (attempt-2) lease holder is the executor of record; the
    // recovered attempt-1 worker is history, not the executor of record.
    expect(handed?.lastWorkerId).toBe("worker-2");
  });
});
