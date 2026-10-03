/**
 * MISSION V1-003 — DB-backed governed worker registry.
 *
 * Proves, at unit level (offline, mocked Supabase client — no real database):
 *  1. registerWorker persists an envelope-stamped `cg_worker_definition` row
 *     plus its `cg_worker_capability` claims; replay is idempotent (§10);
 *  2. grantDelegation writes the LIVE delegation-grant row ('active') AND the
 *     append-only `cg_worker_delegation` history row AND mirrors the
 *     delegation ref onto the definition;
 *  3. revokeDelegation stamps who/when/why and is idempotent;
 *  4. resolveWorkerAuthority maps active grants onto the neutral RBAC
 *     contribution (tenant-embedded extraPermissions) — revocation takes
 *     effect at the NEXT check (zero effective authority, observable denial);
 *  5. quarantineWorker records the ledger row and suspends the definition —
 *     the freeze is persistent and immediate (no longer leased to);
 *  6. the worker lease gate denies, with ZERO writes, every un-usable
 *     posture: unregistered, suspended, quarantined, fully revoked;
 *  7. an unstamped (anonymous-object, J-001) definition row never enters
 *     authority resolution (fail closed).
 */

import { describe, expect, it } from "vitest";
import {
  createWorkerRegistryDb,
  type WorkerRegistryDbClient,
} from "@/lib/workforce/worker-registry-db.server";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const TENANT_A = "tenant-alpha";
const TENANT_B = "tenant-beta";
const T0 = "2026-10-01T12:00:00.000Z";
const MISSION_ID = "MISSION-V1-003-HOST";

function registrationInput(definitionId = "worker-1", tenantId = TENANT_A) {
  return {
    tenantId,
    definitionId,
    identityRef: "11111111-1111-4111-8111-111111111111",
    classification: "ai" as const,
    capabilities: [
      { capabilityId: `mission:execute:${MISSION_ID}`, description: "execute the mission" },
      { capabilityId: `mission:create:${MISSION_ID}`, description: "create the mission" },
    ],
    maxRiskClass: "medium" as const,
    resourceScopes: ["mission"],
    createdBy: "registrar-1",
    traceId: "trace-registry-1",
    correlationId: "correlation-registry-1",
  };
}

function delegationInput() {
  return {
    tenantId: TENANT_A,
    definitionId: "worker-1",
    grantId: "grant-1",
    delegationRef: "RULING-3:delegation:0001",
    delegatedCapabilities: [`mission:execute:${MISSION_ID}`],
    maxGrantedRiskClass: "low" as const,
    grantedBy: "owner-1",
  };
}

function expectInvalid(result: { ok: boolean; reason?: string }, fragment: string): string {
  if (result.ok) throw new Error(`expected invalid (${fragment}), got ok`);
  if (!result.reason?.includes(fragment)) {
    throw new Error(`expected reason containing "${fragment}", got: ${result.reason}`);
  }
  return result.reason;
}

function assertOk<T extends { ok: boolean; reason?: string }>(
  result: T,
): asserts result is T & { ok: true } {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
}

/* ─────────────────────────────────────────────────────────────
 * Structural fake Supabase client (stateful; no network, no DB)
 * ────────────────────────────────────────────────────────────*/

type Row = Record<string, unknown>;

interface FakeDb {
  client: WorkerRegistryDbClient;
  tables: Map<string, Row[]>;
  writes: Array<{ table: string; op: "insert" | "upsert" | "update"; row: Row }>;
}

function fakeSupabaseDb(): FakeDb {
  const tables = new Map<string, Row[]>();
  const writes: FakeDb["writes"] = [];

  const client = {
    from(table: string) {
      const rowsFor = (): Row[] => tables.get(table) ?? [];
      const makeQuery = (filters: Array<[string, string]>) => ({
        eq(column: string, value: string) {
          return makeQuery([...filters, [column, value]]);
        },
        maybeSingle: async () => {
          const found = rowsFor().filter((row) => filters.every(([c, v]) => row[c] === v));
          return { data: found[0] ?? null, error: null };
        },
        then(
          onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          const found = rowsFor().filter((row) => filters.every(([c, v]) => row[c] === v));
          return Promise.resolve({ data: found, error: null }).then(onFulfilled, onRejected);
        },
      });
      return {
        select() {
          return makeQuery([]);
        },
        insert(row: Row) {
          writes.push({ table, op: "insert", row });
          (tables.get(table) ?? tables.set(table, []).get(table)!).push({ ...row });
          return Promise.resolve({ data: row, error: null });
        },
        upsert(row: Row) {
          writes.push({ table, op: "upsert", row });
          (tables.get(table) ?? tables.set(table, []).get(table)!).push({ ...row });
          return Promise.resolve({ data: row, error: null });
        },
        update(patch: Row) {
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
                if (filters.every(([c, v]) => row[c] === v)) {
                  Object.assign(row, patch);
                }
              }
              return Promise.resolve({ data: rowsFor(), error: null }).then(
                onFulfilled,
                onRejected,
              );
            },
          });
          return makeUpdate([]);
        },
      };
    },
  };

  return { client: client as unknown as WorkerRegistryDbClient, tables, writes };
}

async function registeredDb() {
  const db = fakeSupabaseDb();
  const registry = createWorkerRegistryDb(db.client);
  const registered = await registry.registerWorker(registrationInput());
  assertOk(registered);
  return { db, registry };
}

/* ─────────────────────────────────────────────────────────────
 * 1–3. registration, delegation grant, revocation
 * ────────────────────────────────────────────────────────────*/

describe("worker registry db — registerWorker (§28 persistent identity)", () => {
  it("persists an envelope-stamped definition plus capability claim rows", async () => {
    const db = fakeSupabaseDb();
    const registry = createWorkerRegistryDb(db.client);
    const result = await registry.registerWorker(registrationInput());
    assertOk(result);
    expect(result.definitionId).toBe("worker-1");
    expect(result.replayed).toBe(false);

    const definitions = db.tables.get("cg_worker_definition")!;
    expect(definitions).toHaveLength(1);
    const definition = definitions[0]!;
    expect(definition.tenant_id).toBe(TENANT_A);
    expect(definition.lifecycle_state).toBe("provisioned");
    expect(definition.max_risk_class).toBe("medium");
    // Kernel envelope (V1CAP-002): the row is stamped, never anonymous.
    expect(definition.object_type).toBe("worker_definition");
    expect(definition.schema_version).toBe("1.0");
    expect(definition.provenance).toBeTruthy();

    const capabilities = db.tables.get("cg_worker_capability")!;
    expect(capabilities.map((c) => c.capability_id)).toEqual([
      `mission:execute:${MISSION_ID}`,
      `mission:create:${MISSION_ID}`,
    ]);
  });

  it("rejects an invalid registration with zero writes", async () => {
    const db = fakeSupabaseDb();
    const registry = createWorkerRegistryDb(db.client);
    const duplicate = await registry.registerWorker({
      ...registrationInput("worker-dup"),
      capabilities: [
        { capabilityId: "mission:execute:x", description: "a" },
        { capabilityId: "mission:execute:x", description: "b" },
      ],
    });
    expectInvalid(duplicate, "duplicate");
    expect(db.writes).toHaveLength(0);
  });

  it("replays an existing registration idempotently (canonical truth, §10)", async () => {
    const { db, registry } = await registeredDb();
    expect(db.writes).toHaveLength(3); // 1 definition + 2 capabilities
    const replay = await registry.registerWorker(registrationInput());
    assertOk(replay);
    expect(replay.replayed).toBe(true);
    expect(db.tables.get("cg_worker_definition")).toHaveLength(1);
    expect(db.writes).toHaveLength(3); // zero new writes on replay
  });
});

describe("worker registry db — grantDelegation / revokeDelegation", () => {
  it("writes the live grant, the append-only history row, and mirrors the ref", async () => {
    const { db, registry } = await registeredDb();
    const result = await registry.grantDelegation(delegationInput());
    assertOk(result);
    expect(result.grantId).toBe("grant-1");
    expect(result.replayed).toBe(false);

    const grants = db.tables.get("cg_worker_delegation_grant")!;
    expect(grants).toHaveLength(1);
    expect(grants[0]!.state).toBe("active");
    expect(grants[0]!.max_granted_risk_class).toBe("low");

    const history = db.tables.get("cg_worker_delegation")!;
    expect(history).toHaveLength(1);
    expect(history[0]!.recorded_by).toBe("owner-1");

    const definition = db.tables.get("cg_worker_definition")![0]!;
    expect(definition.delegation_history_refs).toEqual(["RULING-3:delegation:0001"]);
  });

  it("refuses a grant for an unregistered worker (zero writes)", async () => {
    const db = fakeSupabaseDb();
    const registry = createWorkerRegistryDb(db.client);
    const denied = await registry.grantDelegation(delegationInput());
    expectInvalid(denied, "not registered in tenant");
    expect(db.writes).toHaveLength(0);
  });

  it("stamps who/when/why on revocation and replays idempotently", async () => {
    const { db, registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const revoked = await registry.revokeDelegation({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      grantId: "grant-1",
      revokedBy: "owner-1",
      reason: "operator-directed revocation",
      now: T0,
    });
    assertOk(revoked);
    expect(revoked.replayed).toBe(false);
    const grant = db.tables.get("cg_worker_delegation_grant")![0]!;
    expect(grant.state).toBe("revoked");
    expect(grant.revoked_by).toBe("owner-1");
    expect(grant.revoked_at).toBe(T0);
    expect(grant.revoked_reason).toBe("operator-directed revocation");

    const replay = await registry.revokeDelegation({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      grantId: "grant-1",
      revokedBy: "owner-1",
      reason: "operator-directed revocation",
      now: T0,
    });
    assertOk(replay);
    expect(replay.replayed).toBe(true);
  });

  it("refuses to revoke a grant that belongs to another worker", async () => {
    const { registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const denied = await registry.revokeDelegation({
      tenantId: TENANT_A,
      definitionId: "worker-OTHER",
      grantId: "grant-1",
      revokedBy: "owner-1",
      reason: "wrong owner",
      now: T0,
    });
    expectInvalid(denied, "does not belong to worker");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. authority resolution (neutral RBAC contribution)
 * ────────────────────────────────────────────────────────────*/

describe("worker registry db — resolveWorkerAuthority", () => {
  it("resolves the governed worker's actor with tenant-embedded extraPermissions", async () => {
    const { registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const resolved = await registry.resolveWorkerAuthority({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      missionId: MISSION_ID,
    });
    assertOk(resolved);
    expect(resolved.actor.actorId).toBe("worker-1");
    expect(resolved.actor.isAgent).toBe(true);
    expect(resolved.actor.extraPermissions).toEqual([
      { resource: "mission", action: "execute", scope: `${TENANT_A}:mission:${MISSION_ID}` },
    ]);
  });

  it("denies cross-tenant resolution with the worker's tenant scope mismatch", async () => {
    const { registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const denied = await registry.resolveWorkerAuthority({
      tenantId: TENANT_B,
      definitionId: "worker-1",
      missionId: MISSION_ID,
    });
    expectInvalid(denied, "not registered in tenant");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5–6. quarantine + the read-time worker lease gate
 * ────────────────────────────────────────────────────────────*/

describe("worker registry db — quarantineWorker + workerLeaseGate", () => {
  it("records the quarantine ledger row and suspends the definition", async () => {
    const { db, registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const quarantined = await registry.quarantineWorker({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      reason: "failure_count_2_reached_threshold_2",
      failureCount: 2,
      threshold: 2,
      quarantinedBy: "worker-host",
      now: T0,
    });
    assertOk(quarantined);

    const ledger = db.tables.get("cg_worker_quarantine")!;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.state).toBe("quarantined");
    expect(ledger[0]!.failure_count).toBe(2);
    expect(db.tables.get("cg_worker_definition")![0]!.lifecycle_state).toBe("suspended");

    // The freeze is immediate: authority no longer resolves (the registry
    // checks the quarantine ledger first) and the lease gate denies on the
    // suspended lifecycle.
    const authority = await registry.resolveWorkerAuthority({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      missionId: MISSION_ID,
    });
    expectInvalid(authority, "worker_quarantined");
    const gate = await registry.workerLeaseGate()({
      tenantId: TENANT_A,
      workerId: "worker-1",
      now: T0,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("worker_lifecycle_unusable:suspended");
  });

  it("allows the gate for a registered, delegated, unquarantined worker", async () => {
    const { registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const gate = await registry.workerLeaseGate()({
      tenantId: TENANT_A,
      workerId: "worker-1",
      now: T0,
    });
    expect(gate.ok).toBe(true);
  });

  it("denies the gate for every un-usable posture with zero gate-time writes", async () => {
    const { db, registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const gate = registry.workerLeaseGate();

    const unregistered = await gate({ tenantId: TENANT_A, workerId: "worker-ghost", now: T0 });
    expect(unregistered.ok).toBe(false);
    if (!unregistered.ok) {
      expect(unregistered.reason).toContain("worker_not_registered:worker-ghost");
    }

    await registry.revokeDelegation({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      grantId: "grant-1",
      revokedBy: "owner-1",
      reason: "all authority withdrawn",
      now: T0,
    });
    const fullyRevoked = await gate({ tenantId: TENANT_A, workerId: "worker-1", now: T0 });
    expect(fullyRevoked.ok).toBe(false);
    if (!fullyRevoked.ok) {
      expect(fullyRevoked.reason).toContain("worker_not_delegated");
    }

    // The gate itself is READ-TIME: no writes beyond the registration (3),
    // the grant (2 inserts + 1 mirror update) and the revocation (1 update),
    // and never a lease write.
    expect(db.writes).toHaveLength(7);
    expect(db.writes.filter((w) => w.op === "update")).toHaveLength(2); // ref mirror + revocation
    expect(db.writes.some((w) => w.table === "cg_mission_lease")).toBe(false);
  });

  it("keeps revocation effective at the NEXT authority check (zero effective authority)", async () => {
    const { registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const before = await registry.resolveWorkerAuthority({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      missionId: MISSION_ID,
    });
    assertOk(before);
    expect(before.actor.extraPermissions).toHaveLength(1);

    await registry.revokeDelegation({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      grantId: "grant-1",
      revokedBy: "owner-1",
      reason: "revoked mid-mission",
      now: T0,
    });

    const after = await registry.resolveWorkerAuthority({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      missionId: MISSION_ID,
    });
    assertOk(after);
    // The revoked grant contributes NOTHING: the actor still resolves (so the
    // denial is OBSERVABLE at the engine under Invariant 12), but carries zero
    // extraPermissions.
    expect(after.actor.extraPermissions).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. untrusted rows fail closed (J-001 anonymous-object gate)
 * ────────────────────────────────────────────────────────────*/

describe("worker registry db — untrusted definition rows", () => {
  it("refuses to resolve authority from an unstamped definition row", async () => {
    const db = fakeSupabaseDb();
    const registry = createWorkerRegistryDb(db.client);
    await registry.registerWorker(registrationInput());
    // Simulate a tampered/partial row: strip the kernel envelope.
    const definition = db.tables.get("cg_worker_definition")![0]!;
    delete definition.object_type;
    delete definition.provenance;

    await expect(
      registry.resolveWorkerAuthority({
        tenantId: TENANT_A,
        definitionId: "worker-1",
        missionId: MISSION_ID,
      }),
    ).rejects.toThrow(/kernel|envelope|persistent kernel object/i);
  });
});
